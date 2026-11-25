-- Preserve legacy telemetry and unproven historical pit rows, but never learn from them.
-- Deploy before offering the connector that attaches observedSessionId to its snapshots.
BEGIN;

ALTER TABLE pitwall_learning.pit_visits
  ADD COLUMN race_verified boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION pitwall_learning.fuel_worker_server_source(p_job uuid, p_lease uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pitwall_learning', 'public', 'pg_temp'
AS $function$
DECLARE
  r pitwall_learning.source_revisions%ROWTYPE;
  v pitwall_learning.fuel_visibility%ROWTYPE;
  a pitwall_learning.account_policy%ROWTYPE;
  lap public.simhub_lap_summaries%ROWTYPE;
  identity jsonb;
  collection_at timestamptz;
  driver text;
  car text;
  track double precision;
  layout text;
  seen_at timestamptz;
  samples numeric;
  max_gap numeric;
  valid_seconds numeric;
  lap_seconds numeric;
  fuel_start numeric;
  fuel_end numeric;
  used numeric;
  session_type text;
BEGIN
  IF NOT pitwall_learning.fuel_worker_allowed() THEN RETURN NULL; END IF;

  SELECT s.* INTO r
    FROM pitwall_learning.jobs j
    JOIN pitwall_learning.source_revisions s ON s.id = j.source_revision_id
   WHERE j.id = p_job AND j.kind = 'source_validate' AND j.status = 'leased'
     AND j.lease_token = p_lease AND j.lease_expires_at > clock_timestamp()
     AND s.source_kind = 'lap_summary';
  IF NOT FOUND OR r.owner_user_id IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO v FROM pitwall_learning.fuel_visibility WHERE source_revision_id = r.id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  seen_at := v.first_visible_at;

  SELECT * INTO a FROM pitwall_learning.account_policy WHERE owner_user_id = r.owner_user_id;
  IF NOT FOUND OR NOT (a.capture_enabled AND a.personal_fit_enabled)
     OR a.policy_version <> r.account_policy_version
     OR v.policy_version <> a.policy_version
     OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = r.owner_user_id) THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.simhub_telemetry_latest t
     WHERE t.device_id::text = r.device_id
       AND t.owner_user_id = r.owner_user_id
       AND pitwall_learning.connector_supports_fuel_learning(t.connector_version)
  ) THEN RETURN NULL; END IF;

  SELECT greatest(fuel_collection_started_at, a.created_at, a.updated_at) INTO collection_at
    FROM pitwall_learning.runtime_settings WHERE id = 1;
  IF collection_at IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO lap FROM public.simhub_lap_summaries WHERE summary_uid = r.source_uid;
  IF NOT FOUND OR lap.complete IS NOT TRUE THEN RETURN NULL; END IF;
  IF lap.pit_lap IS TRUE OR lap.driver_changed IS TRUE THEN RETURN NULL; END IF;
  IF lap.invalid_reasons IS NOT NULL AND array_length(lap.invalid_reasons, 1) > 0 THEN RETURN NULL; END IF;
  IF coalesce(lap.fuel_added_litres_observed, 0) <> 0 THEN RETURN NULL; END IF;

  samples := (lap.coverage #>> '{fuel,sampleCount}')::numeric;
  max_gap := (lap.coverage #>> '{fuel,maxGapSeconds}')::numeric;
  valid_seconds := (lap.coverage #>> '{fuel,validDurationSeconds}')::numeric;
  IF samples IS NULL OR samples < 2 THEN RETURN NULL; END IF;
  IF max_gap IS NULL OR max_gap < 0 OR max_gap > 1 THEN RETURN NULL; END IF;
  IF valid_seconds IS NULL OR valid_seconds <= 0 THEN RETURN NULL; END IF;

  IF lap.started_at IS NULL OR lap.ended_at IS NULL OR lap.lap_number IS NULL OR lap.lap_number < 1 THEN RETURN NULL; END IF;
  lap_seconds := extract(epoch FROM (lap.ended_at - lap.started_at));
  IF lap_seconds <= 0 OR lap_seconds > 1800 THEN RETURN NULL; END IF;
  IF valid_seconds < 0.98 * lap_seconds OR valid_seconds > lap_seconds + 1 THEN RETURN NULL; END IF;

  fuel_start := lap.fuel_start_litres;
  fuel_end := lap.fuel_end_litres;
  IF fuel_start IS NULL OR fuel_end IS NULL THEN RETURN NULL; END IF;
  used := fuel_start - fuel_end;
  IF used < 0.2 OR used > 15 THEN RETURN NULL; END IF;

  SELECT t.v3_normalized -> 'identity', t.v3_normalized #>> '{session,sessionType}'
    INTO identity, session_type
    FROM public.simhub_telemetry_latest t
   WHERE t.device_id::text = r.device_id
     AND t.owner_user_id = r.owner_user_id
     AND t.v3_normalized ->> 'transportSessionId' = lap.delivered_session_id
     AND nullif(t.v3_normalized #>> '{session,observedSessionId}', '') = lap.observed_session_id
   LIMIT 1;
  IF identity IS NULL THEN RETURN NULL; END IF;

  -- A delayed lap may have been captured in practice and delivered during the race.
  -- The immutable lap's observed session must match; no transport-only fallback.
  IF lower(btrim(coalesce(session_type, ''))) <> 'race' THEN RETURN NULL; END IF;
  session_type := 'Race';

  car := nullif(identity ->> 'carId', '');
  layout := coalesce(nullif(identity ->> 'trackConfig', ''), 'default');
  BEGIN
    track := (identity ->> 'trackId')::numeric;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
  IF car IS NULL OR char_length(car) > 120 THEN RETURN NULL; END IF;
  IF track IS NULL OR track < 0 OR track <> floor(track) THEN RETURN NULL; END IF;
  IF char_length(layout) > 120 THEN RETURN NULL; END IF;

  driver := coalesce(nullif(lap.current_driver_name, ''), nullif(identity ->> 'currentDriverName', ''),
                     nullif(identity ->> 'currentDriverId', ''));
  IF driver IS NULL OR char_length(driver) > 120 OR btrim(driver) <> driver THEN RETURN NULL; END IF;

  IF extract(epoch FROM lap.started_at) * 1000 < ceil(extract(epoch FROM collection_at) * 1000) + 1 THEN
    RETURN NULL;
  END IF;
  IF seen_at IS NULL OR seen_at < lap.ended_at OR seen_at - lap.ended_at > interval '5 minutes' THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'id', r.id,
    'owner', r.owner_user_id,
    'device', r.device_id,
    'policyVersion', a.policy_version,
    'knownAt', ceil(extract(epoch FROM seen_at) * 1000),
    'collectionStartedAt', ceil(extract(epoch FROM collection_at) * 1000),
    'allowed', true,
    'superseded', false,
    'driver', driver,
    'car', car,
    'track', track::bigint,
    'layout', layout,
    'sessionType', session_type,
    'sessionKey', lap.delivered_session_id || ':' || lap.observed_session_id,
    'lap', lap.lap_number,
    'startedAt', ceil(extract(epoch FROM lap.started_at) * 1000),
    'endedAt', ceil(extract(epoch FROM lap.ended_at) * 1000),
    'samples', samples::bigint,
    'maxGapSeconds', max_gap,
    'validDurationSeconds', valid_seconds,
    'lapDurationSeconds', lap_seconds,
    'fuelStartLitres', fuel_start,
    'fuelEndLitres', fuel_end
  );
END
$function$;

CREATE OR REPLACE FUNCTION pitwall_learning.ingest_pit_visits(
  p_owner uuid,
  p_device uuid,
  p_transport text,
  p_identity jsonb,
  p_session_type text,
  p_observed_at timestamptz,
  p_visits jsonb
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pitwall_learning', 'pg_temp'
AS $fn$
DECLARE
  driver text;
  car text;
  track text;
  config text;
  inserted integer := 0;
  visit jsonb;
BEGIN
  IF lower(btrim(coalesce(p_session_type, ''))) <> 'race' THEN RETURN 0; END IF;
  IF p_owner IS NULL OR p_device IS NULL OR p_transport IS NULL OR p_observed_at IS NULL THEN
    RETURN 0;
  END IF;
  IF p_visits IS NULL OR jsonb_typeof(p_visits) <> 'array' THEN
    RETURN 0;
  END IF;

  driver := coalesce(nullif(btrim(coalesce(p_identity ->> 'currentDriverName', '')), ''),
                     nullif(btrim(coalesce(p_identity ->> 'currentDriverId', '')), ''));
  car := nullif(btrim(coalesce(p_identity ->> 'carId', '')), '');
  track := nullif(btrim(coalesce(p_identity ->> 'trackName', '')), '');
  IF track IS NULL AND (p_identity ->> 'trackId') ~ '^[0-9]+$' THEN
    track := p_identity ->> 'trackId';
  END IF;
  config := coalesce(nullif(btrim(coalesce(p_identity ->> 'trackConfig', '')), ''), '');

  IF driver IS NULL OR car IS NULL OR track IS NULL THEN
    RETURN 0;
  END IF;

  FOR visit IN SELECT * FROM jsonb_array_elements(p_visits) LOOP
    -- Alleen bezoeken die de connector zelf goedkeurde, met een volledige meting.
    CONTINUE WHEN visit ->> 'skipped' IS NOT NULL;
    CONTINUE WHEN coalesce((visit ->> 'jumped')::boolean, false);
    CONTINUE WHEN (visit ->> 'entryPct') IS NULL OR (visit ->> 'exitPct') IS NULL;
    CONTINUE WHEN (visit ->> 'laneSeconds') IS NULL OR (visit ->> 'standingSeconds') IS NULL;

    BEGIN
      INSERT INTO pitwall_learning.pit_visits (
        owner_user_id, device_id, transport_session_id, driver, car, track, track_config,
        session_type, entry_pct, exit_pct, lane_seconds, standing_seconds, stretch_seconds, observed_at, race_verified)
      VALUES (
        p_owner, p_device, p_transport, driver, car, track, config,
        nullif(btrim(coalesce(p_session_type, '')), ''),
        (visit ->> 'entryPct')::numeric, (visit ->> 'exitPct')::numeric,
        (visit ->> 'laneSeconds')::numeric, (visit ->> 'standingSeconds')::numeric,
        (visit ->> 'stretchSeconds')::numeric, p_observed_at, true)
      ON CONFLICT (device_id, transport_session_id, entry_pct, exit_pct, lane_seconds) DO NOTHING;
      IF FOUND THEN inserted := inserted + 1; END IF;
    EXCEPTION WHEN others THEN
      -- Een onbruikbaar bezoek mag het frame nooit laten mislukken.
      CONTINUE;
    END;
  END LOOP;

  RETURN inserted;
END
$fn$;

-- Trigger: elk frame dat pitbezoeken meebrengt, legt ze vast. Zonder blok doet
-- de trigger niets (één goedkope check op de jsonb-sleutel).
CREATE OR REPLACE FUNCTION pitwall_learning.capture_pit_visits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pitwall_learning', 'pg_temp'
AS $trg$
DECLARE
  visits jsonb;
BEGIN
  IF lower(btrim(coalesce(NEW.v3_normalized #>> '{session,sessionType}', ''))) <> 'race'
     OR nullif(NEW.v3_normalized #>> '{session,observedSessionId}', '') IS NULL THEN
    RETURN NEW;
  END IF;
  visits := NEW.v3_normalized -> 'pitVisits';
  IF jsonb_typeof(visits) IS DISTINCT FROM 'array' THEN
    RETURN NEW;
  END IF;
  IF jsonb_array_length(visits) = 0 THEN
    RETURN NEW;
  END IF;
  BEGIN
    PERFORM pitwall_learning.ingest_pit_visits(
      NEW.owner_user_id,
      NEW.device_id,
      NEW.v3_normalized ->> 'transportSessionId',
      NEW.v3_normalized -> 'identity',
      NEW.v3_normalized #>> '{session,sessionType}',
      coalesce((NEW.v3_normalized ->> 'capturedAt')::timestamptz, clock_timestamp()),
      visits);
  EXCEPTION WHEN others THEN
    -- Nooit de telemetrie-schrijfroute blokkeren.
    NULL;
  END;
  RETURN NEW;
END
$trg$;

CREATE OR REPLACE FUNCTION pitwall_learning.circuit_pit_loss(
  p_track text,
  p_track_config text DEFAULT ''
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pitwall_learning', 'public', 'pg_temp'
AS $fn$
  WITH allowed AS (
    SELECT owner_user_id FROM pitwall_learning.account_policy WHERE pooling_enabled IS TRUE
  ), race_stops AS (
    SELECT v.lane_seconds, v.standing_seconds, v.stretch_seconds
      FROM pitwall_learning.pit_visits v
      JOIN allowed a ON a.owner_user_id = v.owner_user_id
     WHERE lower(v.track) = lower(btrim(p_track))
       AND lower(v.track_config) = lower(coalesce(p_track_config, ''))
       AND v.race_verified AND lower(btrim(coalesce(v.session_type, ''))) = 'race'
  )
  SELECT jsonb_build_object(
    'samples', count(*),
    'stretches', count(stretch_seconds),
    'laneSeconds', round(percentile_cont(0.5) WITHIN GROUP (ORDER BY lane_seconds)::numeric, 3),
    'standingSeconds', round(percentile_cont(0.5) WITHIN GROUP (ORDER BY standing_seconds)::numeric, 3),
    'stretchSeconds', CASE WHEN count(stretch_seconds) >= 3
      THEN round(percentile_cont(0.5) WITHIN GROUP (ORDER BY stretch_seconds)::numeric, 3) END,
    'lossSeconds', CASE WHEN count(*) >= 6 AND count(stretch_seconds) >= 3
      THEN round((percentile_cont(0.5) WITHIN GROUP (ORDER BY lane_seconds)
               - percentile_cont(0.5) WITHIN GROUP (ORDER BY stretch_seconds))::numeric, 3) END)
  FROM race_stops;
$fn$;

REVOKE ALL ON FUNCTION pitwall_learning.circuit_pit_loss(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION pitwall_learning.circuit_pit_loss(text, text) TO authenticated, service_role;

-- Leesfunctie: persoonlijk én circuit, nooit gemengd.
CREATE OR REPLACE FUNCTION public.pitwall_pit_loss_learned_v1(
  p_car text,
  p_track text,
  p_track_config text DEFAULT ''
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pitwall_learning', 'pg_temp'
AS $fn$
DECLARE
  v_owner uuid := auth.uid();
  v_config text := coalesce(p_track_config, '');
  samples integer;
  stretches integer;
  lane numeric;
  standing numeric;
  stretch numeric;
  last_seen timestamptz;
  circuit jsonb;
BEGIN
  IF v_owner IS NULL THEN
    RETURN jsonb_build_object('source', 'unauthenticated', 'samples', 0);
  END IF;
  IF p_car IS NULL OR p_track IS NULL OR btrim(p_car) = '' OR btrim(p_track) = '' THEN
    RETURN jsonb_build_object('source', 'missing_context', 'samples', 0);
  END IF;

  SELECT count(*), count(stretch_seconds),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY lane_seconds),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY standing_seconds),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY stretch_seconds),
         max(observed_at)
    INTO samples, stretches, lane, standing, stretch, last_seen
    FROM pitwall_learning.pit_visits
   WHERE owner_user_id = v_owner
     AND lower(car) = lower(btrim(p_car))
     AND lower(track) = lower(btrim(p_track))
     AND lower(track_config) = lower(v_config)
     AND race_verified AND lower(btrim(coalesce(session_type, ''))) = 'race';

  circuit := pitwall_learning.circuit_pit_loss(p_track, p_track_config);
  IF circuit IS NULL THEN
    circuit := jsonb_build_object('samples', 0);
  END IF;
  circuit := circuit || jsonb_build_object(
    'source', CASE WHEN (circuit ->> 'lossSeconds') IS NOT NULL THEN 'circuit' ELSE 'none' END);

  IF samples = 0 THEN
    RETURN jsonb_build_object('source', 'none', 'samples', 0, 'circuit', circuit);
  END IF;

  RETURN jsonb_build_object(
    'source', CASE WHEN samples >= 3 AND stretches >= 3 THEN 'personal' ELSE 'insufficient' END,
    'samples', samples,
    'stretches', stretches,
    'laneSeconds', round(lane, 3),
    'standingSeconds', round(standing, 3),
    'stretchSeconds', CASE WHEN stretches >= 3 THEN round(stretch, 3) END,
    'lossSeconds', CASE WHEN samples >= 3 AND stretches >= 3 THEN round(lane - stretch, 3) END,
    'lastObservedAt', last_seen,
    'circuit', circuit);
END
$fn$;

COMMENT ON FUNCTION pitwall_learning.fuel_worker_server_source(uuid, uuid) IS
  'Fuel facts only for a stored lap matched to the same observed race session.';

COMMIT;
