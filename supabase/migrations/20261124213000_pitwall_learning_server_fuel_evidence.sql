-- Personal fuel learning — server-derived fuel facts for laps the connector
-- already delivers.
--
-- Why this exists: the 0.7.6.3+ connector carries a v2 fuel observation on the
-- lap summary only after its local observation ledger captured that lap. That
-- ledger only opens when the device has a complete observation binding, and
-- the binding bootstrap (a 202 answer with identity metadata) has not completed
-- on any device in the field. Result: 2744 stored lap summaries, zero
-- observation blocks, zero qualified observations, zero examples, zero models.
--
-- The lap summary itself already carries every fuel-quality fact that the
-- observation adds (complete, pit_lap, driver_changed, invalid_reasons,
-- fuel_added_litres_observed, sampled coverage, fuel start/end). What is
-- missing for qualification is only identity: car, track, layout and driver.
-- simhub_persist_v3 writes that identity for the same transport session in
-- simhub_telemetry_latest, in the same transaction.
--
-- This function therefore returns *facts only*; it never invents a value. When
-- any required fact is missing (older session no longer in the snapshot,
-- incomplete coverage, pit/driver-change, refuel) it returns NULL and the lap
-- simply stays unqualified, exactly as today. The worker builds the observation
-- contract from these facts, so the existing record/forecast/example/model
-- chain is unchanged.
--
-- Read-only: no table is written, no existing row or policy is altered.
BEGIN;

DO $guard$
BEGIN
  IF to_regprocedure('pitwall_learning.fuel_worker_source(uuid,uuid)') IS NULL
     OR to_regprocedure('pitwall_learning.connector_supports_fuel_learning(text)') IS NULL THEN
    RAISE EXCEPTION 'server fuel evidence requires the fuel worker functions';
  END IF;
  IF to_regclass('public.simhub_lap_summaries') IS NULL
     OR to_regclass('public.simhub_telemetry_latest') IS NULL THEN
    RAISE EXCEPTION 'server fuel evidence baseline objects are missing';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION pitwall_learning.fuel_worker_server_source(p_job uuid, p_lease uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pitwall_learning, public, pg_temp
AS $fn$
DECLARE
  r pitwall_learning.source_revisions%ROWTYPE;
  v pitwall_learning.fuel_visibility%ROWTYPE;
  a pitwall_learning.account_policy%ROWTYPE;
  lap public.simhub_lap_summaries%ROWTYPE;
  identity jsonb;
  collection_at timestamptz;
  cov jsonb;
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
BEGIN
  IF NOT pitwall_learning.fuel_worker_allowed() THEN RETURN NULL; END IF;

  -- Same leased job, same source kind and the same owner/policy gates as
  -- fuel_worker_source. The caller must already have run that function, so a
  -- fuel_visibility row exists and the visibility timestamp is authoritative.
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

  -- Never learn from a device whose connector cannot produce the fuel-quality
  -- facts at all; the stored lap row must come from the same capable device.
  IF NOT EXISTS (
    SELECT 1 FROM public.simhub_telemetry_latest t
     WHERE t.device_id::text = r.device_id
       AND t.owner_user_id = r.owner_user_id
       AND pitwall_learning.connector_supports_fuel_learning(t.connector_version)
  ) THEN RETURN NULL; END IF;

  SELECT greatest(fuel_collection_started_at, a.created_at, a.updated_at) INTO collection_at
    FROM pitwall_learning.runtime_settings WHERE id = 1;
  IF collection_at IS NULL THEN RETURN NULL; END IF;

  -- The stored lap aggregate for exactly this revision.
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
  -- Sampled coverage must span the lap: an incomplete sample train is not a
  -- measured lap. 2% tolerance for the sampling boundary at lap start/end.
  IF valid_seconds < 0.98 * lap_seconds OR valid_seconds > lap_seconds + 1 THEN RETURN NULL; END IF;

  fuel_start := lap.fuel_start_litres;
  fuel_end := lap.fuel_end_litres;
  IF fuel_start IS NULL OR fuel_end IS NULL THEN RETURN NULL; END IF;
  used := fuel_start - fuel_end;
  IF used < 0.2 OR used > 15 THEN RETURN NULL; END IF;

  -- Identity of the same transport session, written by the same persist call.
  SELECT t.v3_normalized -> 'identity' INTO identity
    FROM public.simhub_telemetry_latest t
   WHERE t.device_id::text = r.device_id
     AND t.v3_normalized ->> 'transportSessionId' = lap.delivered_session_id
   LIMIT 1;
  IF identity IS NULL THEN RETURN NULL; END IF;

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

  -- The lap must have started after collection was switched on for this account.
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
$fn$;

REVOKE ALL ON FUNCTION pitwall_learning.fuel_worker_server_source(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION pitwall_learning.fuel_worker_server_source(uuid, uuid)
  TO pitwall_learning_worker;

-- First activation model may be fitted from fewer than 100 labelled laps.
-- The bound keeps a real fit (a minimum of 20 paired laps) and stays
-- configurable per deployment without touching the worker code.
ALTER TABLE pitwall_learning.runtime_settings
  ADD COLUMN min_examples integer NOT NULL DEFAULT 40
  CHECK (min_examples BETWEEN 20 AND 500);

CREATE OR REPLACE FUNCTION pitwall_learning.fuel_worker_window(p_owner uuid, p_context text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pitwall_learning,pg_temp AS $fn$
DECLARE observations jsonb; forecasts jsonb; examples_out jsonb; min_examples integer;
BEGIN
 IF NOT pitwall_learning.fuel_worker_allowed() OR octet_length(p_context)>1024 OR NOT EXISTS(
   SELECT 1 FROM pitwall_learning.account_policy WHERE owner_user_id=p_owner AND capture_enabled AND personal_fit_enabled
 ) THEN RETURN NULL; END IF;
 SELECT rs.min_examples INTO min_examples FROM pitwall_learning.runtime_settings rs WHERE rs.id=1;
 SELECT coalesce(jsonb_agg(q.qualified_data ORDER BY q.first_visible_at),'[]') INTO observations FROM (
  SELECT v.qualified_data,v.first_visible_at FROM pitwall_learning.fuel_visibility v
  JOIN pitwall_learning.source_revisions r ON r.id=v.source_revision_id
  JOIN pitwall_learning.account_policy a ON a.owner_user_id=v.owner_user_id
  WHERE v.owner_user_id=p_owner AND a.policy_version=v.policy_version
    AND v.qualified_data->>'context'=p_context AND v.first_visible_at>clock_timestamp()-interval '180 days'
    AND NOT EXISTS(SELECT 1 FROM pitwall_learning.source_revisions n WHERE n.device_id=r.device_id AND n.source_kind=r.source_kind
      AND n.source_uid=r.source_uid AND (n.record_revision>r.record_revision OR (n.record_revision=r.record_revision AND n.content_hash<>r.content_hash)))
  ORDER BY v.first_visible_at DESC LIMIT 1000
 ) q;
 SELECT coalesce(jsonb_agg(q.forecast),'[]') INTO forecasts FROM (
  SELECT p.prediction || jsonb_build_object('id',p.id,'knownAt',ceil(extract(epoch FROM p.as_of)*1000)) AS forecast
  FROM pitwall_learning.predictions p JOIN pitwall_learning.models m ON m.id=p.model_id
  JOIN pitwall_learning.account_policy a ON a.owner_user_id=m.owner_user_id
  WHERE m.owner_user_id=p_owner AND m.fuel_context=p_context AND p.policy_version=a.policy_version
    AND p.retention_expires_at>clock_timestamp()
  ORDER BY p.as_of DESC LIMIT 1000
 ) q;
 SELECT coalesce(jsonb_agg(q.label),'[]') INTO examples_out FROM (
  SELECT e.label FROM pitwall_learning.examples e JOIN pitwall_learning.account_policy a ON a.owner_user_id=e.owner_user_id
  WHERE e.owner_user_id=p_owner AND e.feature_version='previous-complete-lap-v1'
    AND e.label->>'context'=p_context AND e.label->>'policyVersion'=a.policy_version::text
    AND e.retention_expires_at>clock_timestamp() ORDER BY e.created_at DESC LIMIT 1000
 ) q;
 RETURN jsonb_build_object('observations',observations,'forecasts',forecasts,'examples',examples_out,
   'asOf',ceil(extract(epoch FROM clock_timestamp())*1000),'minExamples',coalesce(min_examples,100));
END $fn$;
REVOKE ALL ON FUNCTION pitwall_learning.fuel_worker_window(uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION pitwall_learning.fuel_worker_window(uuid,text) TO pitwall_learning_worker;

COMMIT;
