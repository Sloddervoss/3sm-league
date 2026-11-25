-- Leerdata scheiden van testritten.
--
-- De connector stuurt sinds 0.7.6.6 de sessiesoort mee. Tot nu toe kwam die
-- nergens in de leerketen voor, waardoor offline testen (spawnen, teleporteren,
-- drie rondjes controleren) en echte practice/race in één pool terechtkwamen.
-- In de praktijk is dat geen randgeval: van de 235 sessies in de laatste tien
-- dagen hadden er 124 vijf ronden of minder.
--
-- Daarom: geen enkel feit zonder sessiesoort, en nooit een Test-sessie. Wat de
-- server niet kan bewijzen, leert hij niet. Dit is een poort, geen correctie: er
-- wordt niets heringedeeld of geraden.
BEGIN;

DO $guard$
BEGIN
  IF to_regprocedure('pitwall_learning.fuel_worker_server_source(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'session gating requires fuel_worker_server_source';
  END IF;
END
$guard$;

-- 1. Sessiesoort uit hetzelfde frame als de identiteit, en dezelfde poort in de
--    fuel-feiten: onbekend of Test levert geen feiten op.
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
     AND t.v3_normalized ->> 'transportSessionId' = lap.delivered_session_id
   LIMIT 1;
  IF identity IS NULL THEN RETURN NULL; END IF;

  -- Poort: zonder sessiesoort is de ronde niet toe te schrijven, en een Test-
  -- sessie is precies het spul dat de leerdata vervuilt.
  session_type := nullif(btrim(coalesce(session_type, '')), '');
  IF session_type IS NULL THEN RETURN NULL; END IF;
  IF lower(session_type) LIKE 'test%' OR lower(session_type) LIKE '%offline%' THEN RETURN NULL; END IF;

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
    'sessionKey', lap.delivered_session_id,
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

-- 2. Pitverlies alleen uit races: de mediaan in de leesfunctie negeert elke
--    andere sessiesoort. Practice-stops blijven bewaard (ze zijn echt), maar
--    horen niet in het raceverlies.
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
     AND lower(coalesce(session_type, '')) LIKE 'race%';

  IF samples = 0 THEN
    RETURN jsonb_build_object('source', 'none', 'samples', 0);
  END IF;

  RETURN jsonb_build_object(
    'source', CASE WHEN samples >= 3 AND stretches >= 3 THEN 'personal' ELSE 'insufficient' END,
    'samples', samples,
    'stretches', stretches,
    'laneSeconds', round(lane, 3),
    'standingSeconds', round(standing, 3),
    'stretchSeconds', CASE WHEN stretches >= 3 THEN round(stretch, 3) END,
    'lossSeconds', CASE WHEN samples >= 3 AND stretches >= 3 THEN round(lane - stretch, 3) END,
    'lastObservedAt', last_seen);
END
$fn$;

-- 3. Opruimen: de geleerde brandstofobservaties uit de proef (24-11) zijn met
--    onbekende sessiesoort vastgelegd en horen niet in de leerdata. Ze worden
--    niet hergebruikt; de kolommen blijven staan zodat de keten intact is.
DO $cleanup$
DECLARE verwijderd integer;
BEGIN
  WITH weg AS (
    DELETE FROM pitwall_learning.predictions p
     USING pitwall_learning.fuel_visibility v
     WHERE p.source_revision_id = v.source_revision_id
       AND v.qualified_data IS NOT NULL
       AND v.qualified_data ->> 'sessionType' IS NULL
    RETURNING 1)
  SELECT count(*) INTO verwijderd FROM weg;
  RAISE NOTICE 'proefvoorspellingen verwijderd: %', verwijderd;

  WITH weg AS (
    UPDATE pitwall_learning.fuel_visibility
       SET qualified_data = NULL
     WHERE qualified_data IS NOT NULL
       AND qualified_data ->> 'sessionType' IS NULL
    RETURNING 1)
  SELECT count(*) INTO verwijderd FROM weg;
  RAISE NOTICE 'proefobservaties losgemaakt: %', verwijderd;
END
$cleanup$;

COMMENT ON FUNCTION pitwall_learning.fuel_worker_server_source(uuid, uuid) IS
  'Server-derived fuel facts for one stored lap, only from an attributable non-Test session.';

COMMIT;
