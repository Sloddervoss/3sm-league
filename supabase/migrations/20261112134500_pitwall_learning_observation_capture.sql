-- ============================================================================
-- T13-S1 — observation capture op de server (default UIT)
--
-- Scope:
--   * nullable `public.simhub_lap_summaries.observation` (jsonb) met twee
--     onafhankelijke grenzen: 4096 bytes jsonb op de kolom, 2048 bytes op de
--     wire (afgedwongen door de goedgekeurde pure parser op de Edge);
--   * rijgebonden device-poort in `simhub_persist_measurement_batch` EN
--     `simhub_apply_lap_row`: het device komt uit p_device_id, nooit uit de rij;
--     een mismatch weigert de hele meetrij (geen insert/update, geen P1);
--   * conditionele hash v2 (`simhub_lap_row_hash_v2`) alleen bij non-null
--     observation; `simhub_lap_row_hash` (v1) blijft byte-identiek;
--   * P1-projectie van uitsluitend de geaccepteerde ruwe observation, via
--     de bestaande dunne statement-triggers;
--   * kill switch `pitwall_learning.runtime_settings.observation_enabled`
--     DEFAULT FALSE en een service-role-probe voor de Edge.
--
-- Bewust niet:
--   * geen nieuwe tabel, geen quarantaineopslag, geen retentie/evictie;
--   * geen backfill en geen herschrijving van bestaande hashes of rijen;
--   * geen grants/policies op gedeelde public-tabellen;
--   * geen producer-, Edge-deploy- of productieapply in dit bestand.
--
-- Forward is één transactie (geen eigen BEGIN/COMMIT). Paired rollback:
-- supabase/rollbacks/<ts>_pitwall_learning_observation_capture.sql — een
-- data-preserving disable-amendment, geen schema-down.
--
-- Toepassen als supabase_admin of superuser: de private P1-tabel heeft RLS
-- zonder policies, dus de lezende functies moeten eigendom van de schema-eigenaar
-- houden (dezelfde regel als de P1-migratie).
-- ============================================================================

DO $guard$
BEGIN
  IF to_regclass('public.simhub_lap_summaries') IS NULL
     OR to_regclass('public.simhub_measurement_events') IS NULL
     OR to_regclass('public.simhub_devices') IS NULL
     OR to_regclass('pitwall_learning.runtime_settings') IS NULL
     OR to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'T13-S1 baseline objects are missing';
  END IF;
  IF to_regprocedure('public.simhub_persist_measurement_batch(uuid,text,jsonb,jsonb)') IS NULL
     OR to_regprocedure('public.simhub_apply_lap_row(jsonb)') IS NULL
     OR to_regprocedure('public.simhub_lap_row_hash(public.simhub_lap_summaries)') IS NULL THEN
    RAISE EXCEPTION 'T13-S1 requires the reviewed plugin08 writer';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'simhub_lap_summaries'
       AND column_name = 'observation'
  ) THEN
    RAISE EXCEPTION 'simhub_lap_summaries.observation already exists; refusing to adopt it';
  END IF;
  IF to_regprocedure('public.simhub_observation_row_disposition(jsonb,uuid)') IS NOT NULL
     OR to_regprocedure('public.simhub_lap_row_hash_v2(public.simhub_lap_summaries)') IS NOT NULL THEN
    RAISE EXCEPTION 'T13-S1 helper objects already exist; refusing to adopt them';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    RAISE EXCEPTION 'role supabase_admin is required (P1 schema owner)';
  END IF;
  IF NOT (pg_has_role(current_user, 'supabase_admin', 'MEMBER')
          OR (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)) THEN
    RAISE EXCEPTION 'apply as supabase_admin or superuser; private RLS tables are read by these functions';
  END IF;
END
$guard$;

-- ---------------------------------------------------------------------------
-- 1. Kolom en de twee onafhankelijke grenzen
-- ---------------------------------------------------------------------------
ALTER TABLE public.simhub_lap_summaries
  ADD COLUMN observation jsonb NULL;

-- Zonder dit comprimeert TOAST een grote jsonb en dan meet pg_column_size de
-- gecomprimeerde waarde: de 4096-grens zou dan niet deterministisch zijn en een
-- 4097-byte maar goed comprimeerbare waarde zou passeren. EXTERNAL bewaart
-- buiten de pagina maar zonder compressie, zodat de CHECK exact meet wat hij
-- zegt te meten.
ALTER TABLE public.simhub_lap_summaries
  ALTER COLUMN observation SET STORAGE EXTERNAL;

ALTER TABLE public.simhub_lap_summaries
  ADD CONSTRAINT simhub_lap_summaries_observation_size
  CHECK (observation IS NULL OR pg_column_size(observation) <= 4096);

-- De fence is een tweede, declaratieve wachter: zelfs een directe tabelwrite
-- kan geen observation rijden waarvan capture.deviceId niet de rij zelf is.
-- Formaat eerst, daarna pas case-ongevoelig vergelijken.
ALTER TABLE public.simhub_lap_summaries
  ADD CONSTRAINT simhub_lap_summaries_observation_fence
  CHECK (
    observation IS NULL
    OR (
      jsonb_typeof(observation) = 'object'
      AND jsonb_typeof(observation->'capture') = 'object'
      AND coalesce(
        (observation->'capture'->>'deviceId')
          ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND lower(observation->'capture'->>'deviceId') = lower(device_id),
        false)
    )
  );

COMMENT ON COLUMN public.simhub_lap_summaries.observation IS
  'T13-S1 capture-only observation v1. NULL = legacy row. Raw validated values, no owner/PII. DB bound 4096 bytes; wire bound 2048 is enforced by the approved parser.';
COMMENT ON CONSTRAINT simhub_lap_summaries_observation_fence ON public.simhub_lap_summaries IS
  'T13-S1: an observation row may only exist on its own device. Format validated before case-insensitive comparison.';

-- ---------------------------------------------------------------------------
-- 2. Kill switch, default UIT
-- ---------------------------------------------------------------------------
ALTER TABLE pitwall_learning.runtime_settings
  ADD COLUMN observation_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN pitwall_learning.runtime_settings.observation_enabled IS
  'T13-S1 capture switch. Default FALSE. Writes are rejected row-level with observation_unavailable while off; nothing is stripped.';

-- ---------------------------------------------------------------------------
-- 3. Pure hulpfuncties
-- ---------------------------------------------------------------------------

-- Exacte, tijdzone-vrije volgorde op de bounded ISO-vorm. Geen timestamptz-cast:
-- die zou 7 fractiecijfers naar microseconden afronden.
CREATE FUNCTION public.simhub_observation_ts_le(p_left text, p_right text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $fn$
  SELECT left(p_left, 19) < left(p_right, 19)
      OR (
        left(p_left, 19) = left(p_right, 19)
        AND lpad(coalesce(substring(p_left FROM '\.([0-9]{1,7})'), ''), 9, '0')
          <= lpad(coalesce(substring(p_right FROM '\.([0-9]{1,7})'), ''), 9, '0')
      )
$fn$;

CREATE FUNCTION public.simhub_observation_ts_valid(p_value text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF p_value IS NULL
     OR p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,7})?Z$' THEN
    RETURN false;
  END IF;
  -- Kalendervalidatie zonder timestamptz: 2026-02-30 moet hier al vallen.
  BEGIN
    PERFORM left(p_value, 10)::date;
  EXCEPTION WHEN others THEN
    RETURN false;
  END;
  RETURN substring(p_value FROM 12 FOR 2)::integer BETWEEN 0 AND 23
     AND substring(p_value FROM 15 FOR 2)::integer BETWEEN 0 AND 59
     AND substring(p_value FROM 18 FOR 2)::integer BETWEEN 0 AND 59
     AND substring(p_value FROM 1 FOR 4)::integer BETWEEN 1970 AND 9999;
END
$fn$;

-- Tekstgrens met dezelfde betekenis als de parser: 1..N UTF-8-bytes, geen
-- ASCII-controls en geen C1-controls. Geen trim en geen normalisatie.
CREATE FUNCTION public.simhub_observation_text_valid(p_value text, p_max integer)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $fn$
  SELECT p_value IS NOT NULL
     AND octet_length(p_value) BETWEEN 1 AND p_max
     AND p_value !~ '[[:cntrl:]]'
     AND translate(p_value,
                   (SELECT string_agg(chr(i), '' ORDER BY i)
                      FROM generate_series(128, 159) AS i),
                   '') = p_value
$fn$;

-- Structurele subset van de goedgekeurde parser: allowlist, verplichte sleutels,
-- types/caps, UUID-formaat, tijdorde en feit-aanwezigheid. De exacte decimale
-- budgetinvarianten (maxGap/unknown/edges) blijven eigendom van de TS-parser;
-- die is de enige bron van wire-rijen.
CREATE FUNCTION public.simhub_observation_v1_valid(p jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_key text;
  v_iv jsonb;
  v_first text;
  v_last text;
  v_fact integer := 0;
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RETURN false; END IF;
  IF pg_column_size(p) > 4096 THEN RETURN false; END IF;

  FOR v_key IN SELECT jsonb_object_keys(p) LOOP
    IF v_key NOT IN ('version', 'capture', 'interval', 'pitRoad', 'refuel',
                     'driverNameContinuity', 'context') THEN
      RETURN false;
    END IF;
  END LOOP;

  -- version: verplicht, getal en exact 1. De expliciete `?`-toets is nodig:
  -- jsonb_typeof(missing) is SQL NULL, en `NULL <> 'number'` is geen TRUE.
  IF NOT (p ? 'version')
     OR jsonb_typeof(p->'version') IS DISTINCT FROM 'number'
     OR (p->>'version')::numeric IS DISTINCT FROM 1 THEN
    RETURN false;
  END IF;

  -- capture: verplicht object met exact deviceId. Het deviceId wordt hier
  -- alleen op vorm gecontroleerd; de identiteitsvergelijking gebeurt in
  -- simhub_observation_row_disposition tegen het serverdevice.
  IF NOT (p ? 'capture')
     OR jsonb_typeof(p->'capture') IS DISTINCT FROM 'object' THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(p->'capture') AS k WHERE k <> 'deviceId'
  ) THEN
    RETURN false;
  END IF;
  IF NOT (p->'capture' ? 'deviceId')
     OR jsonb_typeof(p->'capture'->'deviceId') IS DISTINCT FROM 'string'
     OR (p->'capture'->>'deviceId') !~* v_uuid THEN
    RETURN false;
  END IF;

  -- interval: verplicht object met exact de zeven coverage-velden.
  IF NOT (p ? 'interval')
     OR jsonb_typeof(p->'interval') IS DISTINCT FROM 'object' THEN
    RETURN false;
  END IF;
  v_iv := p->'interval';
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(v_iv) AS k
     WHERE k NOT IN ('firstSampleAt', 'lastSampleAt', 'samples',
                     'maxGapSeconds', 'unknownSeconds',
                     'edgeBeforeSeconds', 'edgeAfterSeconds')
  ) THEN
    RETURN false;
  END IF;
  IF NOT (v_iv ? 'firstSampleAt')
     OR NOT (v_iv ? 'lastSampleAt')
     OR jsonb_typeof(v_iv->'firstSampleAt') IS DISTINCT FROM 'string'
     OR jsonb_typeof(v_iv->'lastSampleAt') IS DISTINCT FROM 'string' THEN
    RETURN false;
  END IF;
  v_first := v_iv->>'firstSampleAt';
  v_last := v_iv->>'lastSampleAt';
  IF NOT public.simhub_observation_ts_valid(v_first)
     OR NOT public.simhub_observation_ts_valid(v_last) THEN
    RETURN false;
  END IF;
  IF NOT public.simhub_observation_ts_le(v_first, v_last) THEN
    RETURN false;
  END IF;

  IF NOT (v_iv ? 'samples')
     OR jsonb_typeof(v_iv->'samples') IS DISTINCT FROM 'number'
     OR (v_iv->>'samples')::numeric < 1
     OR (v_iv->>'samples')::numeric > 1000000
     OR (v_iv->>'samples')::numeric
        IS DISTINCT FROM trunc((v_iv->>'samples')::numeric) THEN
    RETURN false;
  END IF;

  IF NOT (v_iv ? 'maxGapSeconds')
     OR NOT (v_iv ? 'unknownSeconds')
     OR NOT (v_iv ? 'edgeBeforeSeconds')
     OR NOT (v_iv ? 'edgeAfterSeconds')
     OR jsonb_typeof(v_iv->'maxGapSeconds') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_iv->'unknownSeconds') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_iv->'edgeBeforeSeconds') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_iv->'edgeAfterSeconds') IS DISTINCT FROM 'number'
     OR (v_iv->>'maxGapSeconds')::numeric < 0
     OR (v_iv->>'maxGapSeconds')::numeric > 86400
     OR (v_iv->>'unknownSeconds')::numeric < 0
     OR (v_iv->>'unknownSeconds')::numeric > 86400
     OR (v_iv->>'edgeBeforeSeconds')::numeric < 0
     OR (v_iv->>'edgeBeforeSeconds')::numeric > 86400
     OR (v_iv->>'edgeAfterSeconds')::numeric < 0
     OR (v_iv->>'edgeAfterSeconds')::numeric > 86400 THEN
    RETURN false;
  END IF;

  -- pitRoad: alleen {value:true, firstAt}; false/0/null is een verboden feit.
  IF p ? 'pitRoad' THEN
    IF jsonb_typeof(p->'pitRoad') IS DISTINCT FROM 'object' THEN RETURN false; END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_object_keys(p->'pitRoad') AS k
       WHERE k NOT IN ('value', 'firstAt')
    ) THEN
      RETURN false;
    END IF;
    IF NOT (p->'pitRoad' ? 'value')
       OR jsonb_typeof(p->'pitRoad'->'value') IS DISTINCT FROM 'boolean'
       OR (p->'pitRoad'->>'value')::boolean IS NOT TRUE THEN
      RETURN false;
    END IF;
    IF NOT (p->'pitRoad' ? 'firstAt')
       OR jsonb_typeof(p->'pitRoad'->'firstAt') IS DISTINCT FROM 'string'
       OR NOT public.simhub_observation_ts_valid(p->'pitRoad'->>'firstAt')
       OR NOT public.simhub_observation_ts_le(v_first, p->'pitRoad'->>'firstAt')
       OR NOT public.simhub_observation_ts_le(p->'pitRoad'->>'firstAt', v_last) THEN
      RETURN false;
    END IF;
    v_fact := v_fact + 1;
  END IF;

  -- refuel: alleen een waargenomen positieve stap; alle vier de kernvelden
  -- zijn verplicht zodra het blok aanwezig is.
  IF p ? 'refuel' THEN
    IF jsonb_typeof(p->'refuel') IS DISTINCT FROM 'object' THEN RETURN false; END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_object_keys(p->'refuel') AS k
       WHERE k NOT IN ('observedAddedLitres', 'firstAt', 'positiveSteps',
                       'resolutionLitres', 'maxUndetectedLitres')
    ) THEN
      RETURN false;
    END IF;
    IF NOT (p->'refuel' ? 'observedAddedLitres')
       OR NOT (p->'refuel' ? 'positiveSteps')
       OR NOT (p->'refuel' ? 'resolutionLitres')
       OR NOT (p->'refuel' ? 'firstAt')
       OR jsonb_typeof(p->'refuel'->'observedAddedLitres') IS DISTINCT FROM 'number'
       OR jsonb_typeof(p->'refuel'->'positiveSteps') IS DISTINCT FROM 'number'
       OR jsonb_typeof(p->'refuel'->'resolutionLitres') IS DISTINCT FROM 'number'
       OR jsonb_typeof(p->'refuel'->'firstAt') IS DISTINCT FROM 'string' THEN
      RETURN false;
    END IF;
    IF (p->'refuel'->>'observedAddedLitres')::numeric <= 0
       OR (p->'refuel'->>'observedAddedLitres')::numeric > 300 THEN
      RETURN false;
    END IF;
    IF (p->'refuel'->>'positiveSteps')::numeric < 1
       OR (p->'refuel'->>'positiveSteps')::numeric > 10000
       OR (p->'refuel'->>'positiveSteps')::numeric
          IS DISTINCT FROM trunc((p->'refuel'->>'positiveSteps')::numeric) THEN
      RETURN false;
    END IF;
    IF (p->'refuel'->>'resolutionLitres')::numeric < 0.001
       OR (p->'refuel'->>'resolutionLitres')::numeric > 1 THEN
      RETURN false;
    END IF;
    IF NOT public.simhub_observation_ts_valid(p->'refuel'->>'firstAt')
       OR NOT public.simhub_observation_ts_le(v_first, p->'refuel'->>'firstAt')
       OR NOT public.simhub_observation_ts_le(p->'refuel'->>'firstAt', v_last) THEN
      RETURN false;
    END IF;
    IF p->'refuel' ? 'maxUndetectedLitres' THEN
      IF jsonb_typeof(p->'refuel'->'maxUndetectedLitres') IS DISTINCT FROM 'number'
         OR (p->'refuel'->>'maxUndetectedLitres')::numeric
            < (p->'refuel'->>'resolutionLitres')::numeric
         OR (p->'refuel'->>'maxUndetectedLitres')::numeric > 300 THEN
        RETURN false;
      END IF;
    END IF;
    v_fact := v_fact + 1;
  END IF;

  IF p ? 'driverNameContinuity' THEN
    IF jsonb_typeof(p->'driverNameContinuity') IS DISTINCT FROM 'object' THEN RETURN false; END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_object_keys(p->'driverNameContinuity') AS k WHERE k <> 'value'
    ) THEN
      RETURN false;
    END IF;
    IF NOT (p->'driverNameContinuity' ? 'value')
       OR jsonb_typeof(p->'driverNameContinuity'->'value') IS DISTINCT FROM 'string'
       OR (p->'driverNameContinuity'->>'value') IS NULL
       OR (p->'driverNameContinuity'->>'value') NOT IN ('unchanged', 'changed') THEN
      RETURN false;
    END IF;
    v_fact := v_fact + 1;
  END IF;

  -- context: de vier identiteitsvelden zijn verplicht; session-velden zijn
  -- optioneel maar een expliciete null of verkeerd type is ongeldig.
  IF p ? 'context' THEN
    IF jsonb_typeof(p->'context') IS DISTINCT FROM 'object' THEN RETURN false; END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_object_keys(p->'context') AS k
       WHERE k NOT IN ('carId', 'trackId', 'trackName', 'trackConfig',
                       'sessionUniqueId', 'sessionNumber')
    ) THEN
      RETURN false;
    END IF;
    IF NOT (p->'context' ? 'carId')
       OR jsonb_typeof(p->'context'->'carId') IS DISTINCT FROM 'string'
       OR NOT public.simhub_observation_text_valid(p->'context'->>'carId', 64) THEN
      RETURN false;
    END IF;
    IF NOT (p->'context' ? 'trackName')
       OR jsonb_typeof(p->'context'->'trackName') IS DISTINCT FROM 'string'
       OR NOT public.simhub_observation_text_valid(p->'context'->>'trackName', 128) THEN
      RETURN false;
    END IF;
    IF NOT (p->'context' ? 'trackConfig')
       OR jsonb_typeof(p->'context'->'trackConfig') IS DISTINCT FROM 'string'
       OR NOT public.simhub_observation_text_valid(p->'context'->>'trackConfig', 128) THEN
      RETURN false;
    END IF;
    IF NOT (p->'context' ? 'trackId')
       OR jsonb_typeof(p->'context'->'trackId') IS DISTINCT FROM 'number'
       OR (p->'context'->>'trackId')::numeric < 1
       OR (p->'context'->>'trackId')::numeric > 2147483647
       OR (p->'context'->>'trackId')::numeric
          IS DISTINCT FROM trunc((p->'context'->>'trackId')::numeric) THEN
      RETURN false;
    END IF;
    IF p->'context' ? 'sessionUniqueId' THEN
      IF jsonb_typeof(p->'context'->'sessionUniqueId') IS DISTINCT FROM 'number'
         OR (p->'context'->>'sessionUniqueId')::numeric < 0
         OR (p->'context'->>'sessionUniqueId')::numeric > 2147483647
         OR (p->'context'->>'sessionUniqueId')::numeric
            IS DISTINCT FROM trunc((p->'context'->>'sessionUniqueId')::numeric) THEN
        RETURN false;
      END IF;
    END IF;
    IF p->'context' ? 'sessionNumber' THEN
      IF jsonb_typeof(p->'context'->'sessionNumber') IS DISTINCT FROM 'number'
         OR (p->'context'->>'sessionNumber')::numeric < 0
         OR (p->'context'->>'sessionNumber')::numeric > 1000
         OR (p->'context'->>'sessionNumber')::numeric
            IS DISTINCT FROM trunc((p->'context'->>'sessionNumber')::numeric) THEN
        RETURN false;
      END IF;
    END IF;
    v_fact := v_fact + 1;
  END IF;

  -- Alleen volledig gevalideerde descriptoren tellen; een leeg object is hier
  -- dus nooit een feit (het is hierboven al afgekeurd).
  IF v_fact < 1 THEN RETURN false; END IF;

  RETURN true;
EXCEPTION WHEN others THEN
  -- Nooit throwen op vreemde JSON: een onverwachte vorm is ongeldig, geen fout
  -- in de schrijver.
  RETURN false;
END
$fn$;

-- Eén beslissing per meetrij. `observation_absent` is de enige legacy-uitkomst.
CREATE FUNCTION public.simhub_observation_row_disposition(p_row jsonb, p_device_id uuid)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_obs jsonb;
  v_dev text;
BEGIN
  IF p_row IS NULL OR jsonb_typeof(p_row) <> 'object' THEN
    RETURN 'row_invalid';
  END IF;
  IF NOT (p_row ? 'observation') THEN
    RETURN 'observation_absent';
  END IF;
  v_obs := p_row->'observation';
  IF v_obs = 'null'::jsonb THEN
    RETURN 'observation_null';
  END IF;
  IF jsonb_typeof(v_obs) <> 'object'
     OR NOT public.simhub_observation_v1_valid(v_obs) THEN
    RETURN 'observation_invalid';
  END IF;
  IF p_device_id IS NULL THEN
    RETURN 'observation_device_invalid';
  END IF;
  v_dev := v_obs->'capture'->>'deviceId';
  IF v_dev IS NULL THEN
    RETURN 'observation_invalid';
  END IF;
  -- Formaat is hierboven gevalideerd; nu pas mag case-ongevoelig vergeleken
  -- worden. p_device_id::text is de canonieke lowercase UUID.
  IF lower(v_dev) <> p_device_id::text THEN
    RETURN 'observation_device_mismatch';
  END IF;
  RETURN 'observation_accepted';
END
$fn$;

-- De opgeslagen-rij-hash. v1 blijft ongemoeid; v2 is exact dezelfde set velden
-- plus de gevalideerde ruwe observation. Alleen bij non-null observation
-- gebruiken de schrijvers deze functie.
CREATE FUNCTION public.simhub_lap_row_hash_v2(p public.simhub_lap_summaries)
RETURNS text
LANGUAGE sql
STABLE
AS $fn$
  SELECT md5(jsonb_build_object(
    'segmentId', p.segment_id, 'observedSessionId', p.observed_session_id,
    'lapNumber', p.lap_number,
    'startedAt', p.started_at, 'endedAt', p.ended_at,
    'currentDriverName', p.current_driver_name,
    'aggregationVersion', p.aggregation_version, 'complete', p.complete,
    'invalidReasons', p.invalid_reasons, 'pitLap', p.pit_lap,
    'driverChanged', p.driver_changed,
    'tmin', p.track_temp_c_min, 'tmax', p.track_temp_c_max,
    'tmean', p.track_temp_c_mean, 'amean', p.air_temp_c_mean,
    'fs', p.fuel_start_litres, 'fe', p.fuel_end_litres,
    'fi', p.fuel_level_integral_litre_seconds,
    'fa', p.fuel_added_litres_observed,
    'ai', p.abs_lat_accel_integral_g_seconds,
    'ai2', p.lat_accel_squared_integral_g2_seconds,
    'amax', p.max_abs_lat_accel_g, 'ali', p.abs_long_accel_integral_g_seconds,
    'vd', p.valid_duration_seconds, 'sc', p.sample_count, 'gap', p.max_gap_seconds,
    'pitIds', p.pit_visit_ids, 'wearIds', p.wear_observation_ids,
    'cov', p.coverage,
    'observation', p.observation,
    'supersedesSummaryUid', p.supersedes_summary_uid)::text)
$fn$;

-- Leest de private kill switch. SECURITY DEFINER met gepinde search_path; de
-- functie is eigendom van de schema-eigenaar (RLS-eigenaar), zodat de aanvrager
-- nooit tabelrechten nodig heeft.
CREATE FUNCTION public.simhub_observation_capture_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pitwall_learning, pg_temp
AS $fn$
  SELECT coalesce(
    (SELECT rs.observation_enabled FROM pitwall_learning.runtime_settings rs WHERE rs.id = 1),
    false)
$fn$;

-- De Edge-probe: waar alleen als de hele package bestaat én de schakelaar aan
-- staat. Geen tabeltoegang voor de aanvrager.
CREATE FUNCTION public.simhub_observation_v1_available()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $fn$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RETURN false;
  END IF;
  RETURN public.simhub_observation_capture_enabled();
END
$fn$;

-- ---------------------------------------------------------------------------
-- 4. Rij-voor-rij terugval
-- ---------------------------------------------------------------------------
create or replace function public.simhub_apply_lap_row(p jsonb)
returns text
language plpgsql
as $function$
declare
  v_new public.simhub_lap_summaries;
  v_cur_rev integer;
  v_cur_hash text;
  v_cur_sup uuid;
  v_obs_disp text;
  v_obs_enabled boolean;
begin
  v_new := jsonb_populate_record(null::public.simhub_lap_summaries, p);

  -- T13-S1: dezelfde poort als het set-based snelpad. Een directe aanroep mag
  -- geen vreemde observation-rij schrijven. Het device_id in deze payload is
  -- door de server opgebouwd; een niet-UUID device kan nooit een observed row
  -- dragen.
  v_obs_disp := public.simhub_observation_row_disposition(
    p,
    case
      when v_new.device_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then v_new.device_id::uuid
    end);
  if v_obs_disp in ('observation_null', 'observation_invalid',
                    'observation_device_mismatch', 'observation_device_invalid',
                    'row_invalid') then
    return 'rejected:' || v_obs_disp;
  end if;
  if v_obs_disp = 'observation_accepted' then
    v_obs_enabled := public.simhub_observation_capture_enabled();
    if not coalesce(v_obs_enabled, false) then
      return 'rejected:observation_unavailable';
    end if;
  end if;
  select l.record_revision, l.content_hash, l.supersedes_summary_uid
    into v_cur_rev, v_cur_hash, v_cur_sup
    from public.simhub_lap_summaries l
   where l.device_id = v_new.device_id and l.summary_uid = v_new.summary_uid;

  if not found then
    insert into public.simhub_lap_summaries (
      id, summary_uid, summary_id, device_id, observed_session_id, delivered_session_id,
      transport_session_id, segment_id, lap_number, started_at, ended_at,
      current_driver_id, current_driver_name, aggregation_version, complete,
      invalid_reasons, pit_lap, driver_changed, track_temp_c_mean, track_temp_c_min,
      track_temp_c_max, air_temp_c_mean, fuel_start_litres, fuel_end_litres,
      fuel_level_integral_litre_seconds, fuel_added_litres_observed,
      abs_lat_accel_integral_g_seconds, lat_accel_squared_integral_g2_seconds,
      max_abs_lat_accel_g, abs_long_accel_integral_g_seconds, valid_duration_seconds,
      sample_count, max_gap_seconds, pit_visit_ids, wear_observation_ids, coverage,
      record_revision, content_hash, supersedes_summary_uid, observation)
    values (
      coalesce(v_new.id, gen_random_uuid()), v_new.summary_uid, v_new.summary_id,
      v_new.device_id, v_new.observed_session_id, v_new.delivered_session_id,
      v_new.transport_session_id, v_new.segment_id, v_new.lap_number,
      v_new.started_at, v_new.ended_at, v_new.current_driver_id,
      v_new.current_driver_name, v_new.aggregation_version, v_new.complete,
      v_new.invalid_reasons, v_new.pit_lap, v_new.driver_changed,
      v_new.track_temp_c_mean, v_new.track_temp_c_min, v_new.track_temp_c_max,
      v_new.air_temp_c_mean, v_new.fuel_start_litres, v_new.fuel_end_litres,
      v_new.fuel_level_integral_litre_seconds, v_new.fuel_added_litres_observed,
      v_new.abs_lat_accel_integral_g_seconds,
      v_new.lat_accel_squared_integral_g2_seconds, v_new.max_abs_lat_accel_g,
      v_new.abs_long_accel_integral_g_seconds, v_new.valid_duration_seconds,
      v_new.sample_count, v_new.max_gap_seconds, v_new.pit_visit_ids,
      v_new.wear_observation_ids, v_new.coverage, v_new.record_revision,
      case when v_new.observation is null
           then public.simhub_lap_row_hash(v_new)
           else public.simhub_lap_row_hash_v2(v_new) end,
      v_new.supersedes_summary_uid, v_new.observation);
    return 'accepted';
  end if;

  v_new.supersedes_summary_uid := coalesce(v_new.supersedes_summary_uid, v_cur_sup);
  -- T13-S1: v2 alleen bij een non-null observation; anders blijft de bestaande
  -- v1-formule exact zoals hij was.
  v_new.content_hash := case when v_new.observation is null
                             then public.simhub_lap_row_hash(v_new)
                             else public.simhub_lap_row_hash_v2(v_new) end;

  if v_new.record_revision > v_cur_rev then
    update public.simhub_lap_summaries l
       set summary_id = v_new.summary_id,
           observed_session_id = v_new.observed_session_id,
           delivered_session_id = v_new.delivered_session_id,
           transport_session_id = v_new.transport_session_id,
           segment_id = v_new.segment_id,
           lap_number = v_new.lap_number,
           started_at = v_new.started_at,
           ended_at = v_new.ended_at,
           current_driver_id = v_new.current_driver_id,
           current_driver_name = v_new.current_driver_name,
           aggregation_version = v_new.aggregation_version,
           complete = v_new.complete,
           invalid_reasons = v_new.invalid_reasons,
           pit_lap = v_new.pit_lap,
           driver_changed = v_new.driver_changed,
           track_temp_c_mean = v_new.track_temp_c_mean,
           track_temp_c_min = v_new.track_temp_c_min,
           track_temp_c_max = v_new.track_temp_c_max,
           air_temp_c_mean = v_new.air_temp_c_mean,
           fuel_start_litres = v_new.fuel_start_litres,
           fuel_end_litres = v_new.fuel_end_litres,
           fuel_level_integral_litre_seconds = v_new.fuel_level_integral_litre_seconds,
           fuel_added_litres_observed = v_new.fuel_added_litres_observed,
           abs_lat_accel_integral_g_seconds = v_new.abs_lat_accel_integral_g_seconds,
           lat_accel_squared_integral_g2_seconds = v_new.lat_accel_squared_integral_g2_seconds,
           max_abs_lat_accel_g = v_new.max_abs_lat_accel_g,
           abs_long_accel_integral_g_seconds = v_new.abs_long_accel_integral_g_seconds,
           valid_duration_seconds = v_new.valid_duration_seconds,
           sample_count = v_new.sample_count,
           max_gap_seconds = v_new.max_gap_seconds,
           pit_visit_ids = v_new.pit_visit_ids,
           wear_observation_ids = v_new.wear_observation_ids,
           coverage = v_new.coverage,
           observation = v_new.observation,
           record_revision = v_new.record_revision,
           supersedes_summary_uid = v_new.supersedes_summary_uid,
           content_hash = v_new.content_hash,
           received_at = now()
     where l.device_id = v_new.device_id
       and l.summary_uid = v_new.summary_uid
       and l.record_revision = v_cur_rev;
    if found then
      return 'superseded';
    end if;
    return 'stale_revision';
  end if;

  if v_new.record_revision = v_cur_rev and v_new.content_hash = v_cur_hash then
    return 'duplicate';
  end if;
  if v_new.record_revision = v_cur_rev then
    return 'revision_conflict';
  end if;
  return 'stale_revision';
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Batchschrijver (set-based snelpad + terugval), uitgebreid met de
--    observation-poort, de kolom en de conditionele hash.
-- ---------------------------------------------------------------------------
create or replace function public.simhub_persist_measurement_batch(
  p_device_id uuid,
  p_session_id text,
  p_events jsonb,
  p_laps jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $function$
declare
  v_max_events constant integer := 200;
  v_max_laps constant integer := 20;
  v_max_rejects constant integer := 200;
  v_device text := p_device_id::text;
  v_delivered text := nullif(btrim(p_session_id), '');

  v_rec record;
  v_label text;
  v_name text;
  ev_recv integer := 0;
  -- Elke bevestiging is een object {id, record_revision}: zonder de
  -- bevestigde revisie weet een outbox met meerdere revisies van dezelfde UUID
  -- niet welke versie de server heeft aangenomen.
  ev_acc jsonb := '[]'::jsonb;
  ev_dup jsonb := '[]'::jsonb;
  ev_sup jsonb := '[]'::jsonb;
  ev_rej jsonb := '[]'::jsonb;
  ev_block text;
  lp_recv integer := 0;
  lp_acc jsonb := '[]'::jsonb;
  lp_dup jsonb := '[]'::jsonb;
  lp_sup jsonb := '[]'::jsonb;
  lp_rej jsonb := '[]'::jsonb;
  lp_block text;

  v_uid uuid; v_seg text; v_pit text; v_kind text; v_obs text;
  v_at timestamptz; v_st double precision; v_tick bigint;
  v_wb jsonb; v_wa jsonb; v_sg jsonb; v_ev jsonb; v_conf double precision;
  v_rev integer; v_supersedes uuid; v_hash text; v_prev_rev integer; v_prev_hash text;
  v_prev_sup uuid; v_stored_sup uuid;
  -- Snelpad: rijen worden gevalideerd en geclassificeerd in de lus, maar
  -- geschreven in één set-based statement. Mislukt dat, dan volgt een
  -- rij-voor-rij terugval met dezelfde al gevalideerde waarden.
  ev_ins jsonb := '[]'::jsonb;
  ev_upd jsonb := '[]'::jsonb;
  -- Duplicaatkandidaten: zij worden niet geschreven, maar de terugval moet ze
  -- wél opnieuw kunnen classificeren. Daarom bewaren we hun volledige rij.
  ev_dup_rows jsonb := '[]'::jsonb;
  lp_ins jsonb := '[]'::jsonb;
  lp_upd jsonb := '[]'::jsonb;
  lp_dup_rows jsonb := '[]'::jsonb;
  v_prev jsonb;
  -- Hoogste revisie per identiteit binnen deze batch: één winnaar per UUID.
  v_batch_max jsonb;
  v_batch_rev integer;
  v_apply record;
  v_updated integer;

  v_sum uuid; v_lap integer; v_drv_id uuid; v_drv_name text; v_agg integer; v_complete boolean;
  v_event uuid; v_team uuid;
  v_cov jsonb;
  v_reasons text[]; v_pitlap boolean; v_drvchg boolean; v_cover_reasons text[];
  v_tmean double precision; v_tmin double precision; v_tmax double precision; v_amean double precision;
  v_fs double precision; v_fe double precision; v_fi double precision; v_fa double precision;
  v_ai double precision; v_ai2 double precision; v_amax double precision; v_ali double precision;
  v_vd double precision; v_sc double precision; v_gap double precision;
  v_pitids text[]; v_wearids text[];
  -- T13-S1: rijgebonden observation. NULL = legacy. Geen ander pad schrijft
  -- deze kolom.
  v_lap_obs jsonb;
  v_obs_disp text;
  v_obs_enabled boolean := false;
  v_hash_row public.simhub_lap_summaries;
  v_apply_result text;
begin
  -- De server is de baas over apparaat en afleversessie. Wat de client daarover
  -- meeschuift, wordt nooit gebruikt.
  if auth.role() is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  if p_device_id is null or v_delivered is null or char_length(v_delivered) not between 1 and 120 then
    return jsonb_build_object('ok', false, 'error', 'invalid_arguments');
  end if;

  -- De rijder van een ronde wordt SERVER-SIDE geresolveerd. De client kent
  -- alleen de SimHub-naam; een UUID die hij zelf invult is per definitie
  -- onbetrouwbaar (en meestal helemaal niet bekend). Event en team komen uit de
  -- apparaatbinding, dezelfde bron die het kernframe gebruikt.
  select d.endurance_event_id, d.endurance_team_id into v_event, v_team
    from public.simhub_devices d
   where d.id = p_device_id;

  -- -------------------------------------------------------------------------
  -- Meetgebeurtenissen
  -- -------------------------------------------------------------------------
  if p_events is not null then
    begin
      -- Ook een afgekeurde reeks is ontvangen: het totaal beschrijft de
      -- aangeboden reeks, niet wat er na inkorting overbleef.
      if jsonb_typeof(p_events) = 'array' then
        ev_recv := jsonb_array_length(p_events);
      end if;
      if jsonb_typeof(p_events) <> 'array' then
        ev_block := 'not_an_array';
      elsif jsonb_array_length(p_events) > v_max_events then
        ev_block := 'too_many';
      else
        -- Eén query voor de bestaande stand van alle aangeboden UUID's in
        -- plaats van een SELECT per rij.
        -- Ook de verwijzing wordt ingelezen: de hash van een hogere revisie
        -- zonder verwijzing gaat over de verwijzing die blijft staan.
        select coalesce(jsonb_object_agg(e.event_uid::text,
                                         jsonb_build_object('rev', e.record_revision,
                                                            'hash', e.content_hash,
                                                            'sup', e.supersedes_event_uid)), '{}'::jsonb)
          into v_prev
          from public.simhub_measurement_events e
         where e.device_id = v_device
           and e.event_uid in (
             select (x.value->>'eventUid')::uuid
               from jsonb_array_elements(p_events) x
              where public.simhub_jvalid(x.value->'eventUid', 'uuid'));

        -- Dezelfde UUID kan meerdere keren in één batch zitten. Alleen de
        -- hoogste revisie mag landen; welke dan ook, nooit twee schrijfacties op
        -- één doelrij in één statement (review 3, punt 8).
        select coalesce(jsonb_object_agg(x.uid, x.rev), '{}'::jsonb)
          into v_batch_max
          from (select x.value->>'eventUid' as uid,
                       max(case when x.value ? 'recordRevision'
                                 and public.simhub_jvalid(x.value->'recordRevision', 'integer', 1, 100000)
                                then (x.value->>'recordRevision')::integer
                                else 1 end) as rev
                  from jsonb_array_elements(p_events) x
                 -- Alleen rijen met een bruikbare UUID; de rest wordt straks
                 -- per rij afgewezen en hoort hier niet in de uitslag.
                 where jsonb_typeof(x.value) = 'object'
                   and jsonb_typeof(x.value->'eventUid') = 'string'
                   and public.simhub_jvalid(x.value->'eventUid', 'uuid')
                 group by 1) x;
        for v_rec in
          select t.value as row, t.ord as ord
            from jsonb_array_elements(p_events) with ordinality as t(value, ord)
        loop
          -- Eén rij per subtransactie: een fout in deze rij kost nooit de andere
          -- rijen, het frame of de rondeaggregaten.
          begin
            v_label := null;
            if jsonb_typeof(v_rec.row) <> 'object' then
              ev_rej := public.simhub_ack_reject(ev_rej, null, v_rec.ord - 1, 'not_an_object', v_max_rejects);
              continue;
            end if;

            v_label := nullif(btrim(coalesce(v_rec.row->>'eventId', '')), '');
            if v_rec.row->'eventUid' is null or v_rec.row->'eventUid' = 'null'::jsonb then
              ev_rej := public.simhub_ack_reject(ev_rej, v_label, v_rec.ord - 1, 'event_uid_missing', v_max_rejects);
              continue;
            end if;
            if not public.simhub_jvalid(v_rec.row->'eventUid', 'uuid') then
              ev_rej := public.simhub_ack_reject(ev_rej, v_label, v_rec.ord - 1, 'event_uid_invalid', v_max_rejects);
              continue;
            end if;
            v_uid := public.simhub_juuid(v_rec.row->'eventUid');
            v_name := v_label;
            v_label := v_uid::text;

            if v_rec.row->'kind' is null or (v_rec.row->>'kind') !~ '^[a-z0-9._-]{1,64}$' then
              ev_rej := public.simhub_ack_reject(ev_rej, v_label, v_rec.ord - 1, 'kind_invalid', v_max_rejects);
              continue;
            end if;
            v_kind := btrim(v_rec.row->>'kind');

            if not public.simhub_jvalid(v_rec.row->'segmentId', 'string', 1, 64)
               or not public.simhub_jvalid(v_rec.row->'pitVisitId', 'string', 1, 64)
               or not public.simhub_jvalid(v_rec.row->'observedSessionId', 'string', 1, 120) then
              ev_rej := public.simhub_ack_reject(ev_rej, v_label, v_rec.ord - 1, 'identifier_invalid', v_max_rejects);
              continue;
            end if;
            v_seg := public.simhub_jtext(v_rec.row->'segmentId');
            v_pit := public.simhub_jtext(v_rec.row->'pitVisitId');
            -- De oorspronkelijke waarnemingssessie komt van de client en blijft bij
            -- herverzending gelijk; de afleversessie is wat de server nu ziet.
            v_obs := public.simhub_jtext(v_rec.row->'observedSessionId');

            if not public.simhub_jvalid(v_rec.row->'observedAt', 'timestamp') then
              ev_rej := public.simhub_ack_reject(ev_rej, v_label, v_rec.ord - 1, 'observed_at_invalid', v_max_rejects);
              continue;
            end if;
            if not public.simhub_jvalid(v_rec.row->'sessionTimeSeconds', 'number', 0, 604800) then
              ev_rej := public.simhub_ack_reject(ev_rej, v_label, v_rec.ord - 1, 'session_time_invalid', v_max_rejects);
              continue;
            end if;
            if not public.simhub_jvalid(v_rec.row->'sdkTick', 'bigint', 0, 9007199254740991) then
              ev_rej := public.simhub_ack_reject(ev_rej, v_label, v_rec.ord - 1, 'sdk_tick_invalid', v_max_rejects);
              continue;
            end if;
            if not public.simhub_jvalid(v_rec.row->'confidence', 'number', 0, 1) then
              ev_rej := public.simhub_ack_reject(ev_rej, v_label, v_rec.ord - 1, 'confidence_invalid', v_max_rejects);
              continue;
            end if;

            v_at := public.simhub_jtimestamptz(v_rec.row->'observedAt');
            v_st := public.simhub_jdouble(v_rec.row->'sessionTimeSeconds');
            v_tick := public.simhub_jbigint(v_rec.row->'sdkTick');
            v_conf := public.simhub_jdouble(v_rec.row->'confidence');
            v_wb := v_rec.row->'wearBefore';
            v_wa := v_rec.row->'wearAfter';
            v_sg := v_rec.row->'setGeneration';
            v_ev := v_rec.row->'evidence';
            if v_ev = 'null'::jsonb then v_ev := null; end if;
            if v_wb = 'null'::jsonb then v_wb := null; end if;
            if v_wa = 'null'::jsonb then v_wa := null; end if;
            if v_sg = 'null'::jsonb then v_sg := null; end if;

            -- Eén budgetmaat: de jsonb-bytes die de database straks opslaat. Een
            -- te groot bewijs is een expliciete afwijzing, geen stille null.
            if v_ev is not null and (jsonb_typeof(v_ev) <> 'object' or pg_column_size(v_ev) > 4096) then
              ev_rej := public.simhub_ack_reject(ev_rej, v_label, v_rec.ord - 1, 'evidence_too_large', v_max_rejects);
              continue;
            end if;
            if v_wb is not null and (jsonb_typeof(v_wb) <> 'object' or pg_column_size(v_wb) > 2048) then
              ev_rej := public.simhub_ack_reject(ev_rej, v_label, v_rec.ord - 1, 'wear_before_invalid', v_max_rejects);
              continue;
            end if;
            if v_wa is not null and (jsonb_typeof(v_wa) <> 'object' or pg_column_size(v_wa) > 2048) then
              ev_rej := public.simhub_ack_reject(ev_rej, v_label, v_rec.ord - 1, 'wear_after_invalid', v_max_rejects);
              continue;
            end if;
            if v_sg is not null and (jsonb_typeof(v_sg) <> 'object' or pg_column_size(v_sg) > 2048) then
              ev_rej := public.simhub_ack_reject(ev_rej, v_label, v_rec.ord - 1, 'set_generation_invalid', v_max_rejects);
              continue;
            end if;
            -- Inhoudelijk contract voor wear en bewijs: geen vrije vorm meer.
            if not public.simhub_wear_v1_valid(v_wb) then
              ev_rej := public.simhub_ack_reject(ev_rej, v_label, v_rec.ord - 1, 'wear_before_contract', v_max_rejects);
              continue;
            end if;
            if not public.simhub_wear_v1_valid(v_wa) then
              ev_rej := public.simhub_ack_reject(ev_rej, v_label, v_rec.ord - 1, 'wear_after_contract', v_max_rejects);
              continue;
            end if;
            if not public.simhub_set_generation_valid(v_sg) then
              ev_rej := public.simhub_ack_reject(ev_rej, v_label, v_rec.ord - 1, 'set_generation_contract', v_max_rejects);
              continue;
            end if;
            if not public.simhub_evidence_v1_valid(v_ev) then
              ev_rej := public.simhub_ack_reject(ev_rej, v_label, v_rec.ord - 1, 'evidence_contract', v_max_rejects);
              continue;
            end if;
            -- Een wear-waarneming zonder bewijsgrond of zonder confidence is geen
            -- waarneming: weigeren, niet als 'zeker' opslaan.
            if (v_wb is not null or v_wa is not null) and v_ev is null then
              ev_rej := public.simhub_ack_reject(ev_rej, v_label, v_rec.ord - 1, 'evidence_missing', v_max_rejects);
              continue;
            end if;
            if (v_wb is not null or v_wa is not null) and v_conf is null then
              ev_rej := public.simhub_ack_reject(ev_rej, v_label, v_rec.ord - 1, 'confidence_missing', v_max_rejects);
              continue;
            end if;
            if not public.simhub_jvalid(v_rec.row->'recordRevision', 'integer', 1, 100000) then
              ev_rej := public.simhub_ack_reject(ev_rej, v_label, v_rec.ord - 1, 'revision_invalid', v_max_rejects);
              continue;
            end if;
            if not public.simhub_jvalid(v_rec.row->'supersedesEventUid', 'uuid') then
              ev_rej := public.simhub_ack_reject(ev_rej, v_label, v_rec.ord - 1, 'supersedes_invalid', v_max_rejects);
              continue;
            end if;
            v_rev := coalesce(public.simhub_jint(v_rec.row->'recordRevision'), 1);
            v_supersedes := public.simhub_juuid(v_rec.row->'supersedesEventUid');

            -- Binnen deze batch wint de hoogste revisie. Een lagere revisie
            -- van dezelfde UUID wordt stale en wordt niet ingepland, ook niet
            -- als zij hoger is dan wat de tabel nu bevat (review 3, punt 8).
            v_batch_rev := null;
            if v_batch_max ? v_uid::text then
              v_batch_rev := (v_batch_max ->> v_uid::text)::integer;
            end if;
            if v_batch_rev is not null and v_rev < v_batch_rev then
              ev_rej := public.simhub_ack_reject(ev_rej, v_label, v_rec.ord - 1, 'stale_revision', v_max_rejects);
              continue;
            end if;

            -- De stand waartegen deze rij geclassificeerd wordt. Die schuift
            -- binnen deze batch mee met wat al is ingepland: de hoogste revisie
            -- wint en een lagere wordt stale in plaats van alsnog geschreven
            -- (review 3, punt 8).
            v_prev_rev := null;
            v_prev_hash := null;
            v_prev_sup := null;
            if v_prev ? v_uid::text then
              v_prev_rev := (v_prev -> v_uid::text ->> 'rev')::integer;
              v_prev_hash := v_prev -> v_uid::text ->> 'hash';
              v_prev_sup := nullif(v_prev -> v_uid::text ->> 'sup', '')::uuid;
            end if;
            -- De verwijzing die de rij straks werkelijk draagt: ontbreekt zij
            -- bij een hogere revisie, dan blijft de bestaande staan. De hash
            -- gaat daarover, niet over null (review 3, punt 9).
            v_stored_sup := case when v_prev_rev is null then v_supersedes
                                 else coalesce(v_supersedes, v_prev_sup) end;

            -- Inhoudelijke vingerafdruk over de opgeslagen rij: dezelfde
            -- revisie met andere inhoud is een conflict, geen stille negeeractie.
            v_hash := public.simhub_event_row_hash(jsonb_populate_record(
              null::public.simhub_measurement_events,
              jsonb_build_object(
                'segment_id', v_seg, 'observed_session_id', v_obs, 'pit_visit_id', v_pit,
                'kind', v_kind, 'observed_at', v_at, 'session_time_seconds', v_st,
                'sdk_tick', v_tick, 'wear_before', v_wb, 'wear_after', v_wa,
                'set_generation', v_sg, 'evidence', v_ev, 'confidence', v_conf,
                'supersedes_event_uid', v_stored_sup)));

            if v_prev_rev is null then
              -- Nieuw: later in één statement ingevoegd.
              ev_ins := ev_ins || jsonb_build_object(
                'id', gen_random_uuid(),
                'device_id', v_device, 'event_uid', v_uid, 'event_id', v_name,
                'observed_session_id', v_obs, 'delivered_session_id', v_delivered,
                'transport_session_id', v_delivered, 'segment_id', v_seg,
                'pit_visit_id', v_pit, 'kind', v_kind, 'observed_at', v_at,
                'session_time_seconds', v_st, 'sdk_tick', v_tick,
                'wear_before', v_wb, 'wear_after', v_wa, 'set_generation', v_sg,
                'evidence', v_ev, 'confidence', v_conf, 'record_revision', v_rev,
                'content_hash', v_hash, 'supersedes_event_uid', v_stored_sup,
                '_label', v_label, '_index', v_rec.ord - 1);
              ev_acc := ev_acc || jsonb_build_object('id', v_uid::text, 'record_revision', v_rev);
              -- De batchstand schuift mee: een volgende, lagere revisie van
              -- dezelfde UUID is vanaf hier stale.
              v_prev := v_prev || jsonb_build_object(v_uid::text,
                          jsonb_build_object('rev', v_rev, 'hash', v_hash, 'sup', v_stored_sup));
            elsif v_rev > v_prev_rev then
              -- Hogere revisie: later in één statement bijgewerkt.
              ev_upd := ev_upd || jsonb_build_object(
                'device_id', v_device, 'event_uid', v_uid, 'event_id', v_name,
                'observed_session_id', v_obs, 'delivered_session_id', v_delivered,
                'transport_session_id', v_delivered, 'segment_id', v_seg,
                'pit_visit_id', v_pit, 'kind', v_kind, 'observed_at', v_at,
                'session_time_seconds', v_st, 'sdk_tick', v_tick,
                'wear_before', v_wb, 'wear_after', v_wa, 'set_generation', v_sg,
                'evidence', v_ev, 'confidence', v_conf, 'record_revision', v_rev,
                'content_hash', v_hash, 'supersedes_event_uid', v_stored_sup,
                '_label', v_label, '_index', v_rec.ord - 1);
              ev_sup := ev_sup || jsonb_build_object('id', v_uid::text, 'record_revision', v_rev);
              v_prev := v_prev || jsonb_build_object(v_uid::text,
                          jsonb_build_object('rev', v_rev, 'hash', v_hash, 'sup', v_stored_sup));
            elsif v_rev = v_prev_rev and v_hash is not distinct from v_prev_hash then
              -- Zelfde revisie, zelfde inhoud: herverzending uit de oude outbox.
              ev_dup := ev_dup || jsonb_build_object('id', v_uid::text, 'record_revision', v_prev_rev);
              -- Dezelfde velden als een insert of update, zodat de terugval deze
              -- rij opnieuw tegen de actuele stand kan classificeren. De
              -- bevestiging alleen is niet genoeg: viel het snelpad terug, dan
              -- zou deze rij uit alle uitslaglijsten verdwijnen (review 4).
              ev_dup_rows := ev_dup_rows || jsonb_build_object(
                'device_id', v_device, 'event_uid', v_uid, 'event_id', v_name,
                'observed_session_id', v_obs, 'delivered_session_id', v_delivered,
                'transport_session_id', v_delivered, 'segment_id', v_seg,
                'pit_visit_id', v_pit, 'kind', v_kind, 'observed_at', v_at,
                'session_time_seconds', v_st, 'sdk_tick', v_tick,
                'wear_before', v_wb, 'wear_after', v_wa, 'set_generation', v_sg,
                'evidence', v_ev, 'confidence', v_conf, 'record_revision', v_rev,
                'content_hash', v_hash, 'supersedes_event_uid', v_stored_sup,
                '_label', v_label, '_index', v_rec.ord - 1);
            elsif v_rev = v_prev_rev then
              ev_rej := public.simhub_ack_reject(ev_rej, v_label, v_rec.ord - 1, 'revision_conflict', v_max_rejects);
            else
              ev_rej := public.simhub_ack_reject(ev_rej, v_label, v_rec.ord - 1, 'stale_revision', v_max_rejects);
            end if;
          exception when others then
            ev_rej := public.simhub_ack_reject(ev_rej, v_label, v_rec.ord - 1, 'row_failed:' || sqlstate, v_max_rejects);
          end;
        end loop;

        -- Set-based snelpad: alle nieuwe rijen in één INSERT, alle hogere
        -- revisies in één UPDATE. Mislukt dat (bijvoorbeeld twee dezelfde
        -- UUID's in één batch), dan wordt de hele toepassing teruggedraaid en
        -- volgt de rij-voor-rij terugval hieronder.
        if jsonb_array_length(ev_ins) > 0 or jsonb_array_length(ev_upd) > 0 then
          begin
            if jsonb_array_length(ev_ins) > 0 then
              insert into public.simhub_measurement_events (
                id, device_id, event_uid, event_id, observed_session_id, delivered_session_id,
                transport_session_id, segment_id, pit_visit_id, kind, observed_at,
                session_time_seconds, sdk_tick, wear_before, wear_after, set_generation,
                evidence, confidence, record_revision, content_hash, supersedes_event_uid)
              select r.id, r.device_id, r.event_uid, r.event_id, r.observed_session_id,
                     r.delivered_session_id, r.transport_session_id, r.segment_id,
                     r.pit_visit_id, r.kind, r.observed_at, r.session_time_seconds,
                     r.sdk_tick, r.wear_before, r.wear_after, r.set_generation,
                     r.evidence, r.confidence, r.record_revision, r.content_hash,
                     r.supersedes_event_uid
                from jsonb_populate_recordset(null::public.simhub_measurement_events, ev_ins) r;
            end if;
            if jsonb_array_length(ev_upd) > 0 then
              update public.simhub_measurement_events e
                 set event_id = u.event_id,
                     observed_session_id = u.observed_session_id,
                     delivered_session_id = u.delivered_session_id,
                     transport_session_id = u.transport_session_id,
                     segment_id = u.segment_id,
                     pit_visit_id = u.pit_visit_id,
                     kind = u.kind,
                     observed_at = u.observed_at,
                     session_time_seconds = u.session_time_seconds,
                     sdk_tick = u.sdk_tick,
                     wear_before = u.wear_before,
                     wear_after = u.wear_after,
                     set_generation = u.set_generation,
                     evidence = u.evidence,
                     confidence = u.confidence,
                     record_revision = u.record_revision,
                     -- De verwijzing is al tegen de bestaande stand verrekend
                     -- en zit zo in de hash; hier geen tweede COALESCE.
                     supersedes_event_uid = u.supersedes_event_uid,
                     content_hash = u.content_hash,
                     received_at = now()
                from jsonb_populate_recordset(null::public.simhub_measurement_events, ev_upd) u
               where e.device_id = u.device_id and e.event_uid = u.event_uid
                 -- Monotoon, ook op de plek waar het echt gebeurt.
                 and e.record_revision < u.record_revision;
              get diagnostics v_updated = row_count;
              -- Niet alle aangeboden revisies zijn bijgewerkt (rij verdwenen of
              -- intussen hoger?): dan liever de rij-voor-rij terugval dan een
              -- onjuiste ACK.
              if v_updated <> jsonb_array_length(ev_upd) then
                raise exception 'fast_path_incomplete' using errcode = 'P0001';
              end if;
            end if;
          exception when others then
            -- Alles terug en opnieuw, rij voor rij. Elke rij wordt opnieuw
            -- geclassificeerd tegen de rijstand van dít moment, niet tegen de
            -- stand die bij aanvang van de batch is ingelezen. Zo kan een lagere
            -- revisie een hogere nooit overschrijven en wordt er niets bevestigd
            -- dat niet is opgeslagen (review 3, punt 8).
            --
            -- Ook de duplicaatkandidaten gaan mee: zij zijn niet ingepland,
            -- maar zonder herclassificatie zouden ze uit alle uitslaglijsten
            -- verdwijnen (review 4). De oorspronkelijke batchvolgorde blijft
            -- staan, zodat een duplicaat van een rij die in dezelfde batch
            -- wordt ingevoegd opnieuw als duplicaat eindigt.
            ev_acc := '[]'::jsonb;
            ev_dup := '[]'::jsonb;
            ev_sup := '[]'::jsonb;
            for v_apply in
              select value as row
                from jsonb_array_elements(ev_ins || ev_upd || ev_dup_rows)
               order by (value->>'_index')::integer
            loop
              begin
                case public.simhub_apply_event_row(v_apply.row - '_label' - '_index')
                  when 'accepted' then
                    ev_acc := ev_acc || jsonb_build_object('id', v_apply.row->>'event_uid',
                                                           'record_revision', (v_apply.row->>'record_revision')::integer);
                  when 'superseded' then
                    ev_sup := ev_sup || jsonb_build_object('id', v_apply.row->>'event_uid',
                                                           'record_revision', (v_apply.row->>'record_revision')::integer);
                  when 'duplicate' then
                    ev_dup := ev_dup || jsonb_build_object('id', v_apply.row->>'event_uid',
                                                           'record_revision', (v_apply.row->>'record_revision')::integer);
                  when 'revision_conflict' then
                    ev_rej := public.simhub_ack_reject(ev_rej, v_apply.row->>'_label',
                                                       (v_apply.row->>'_index')::integer, 'revision_conflict', v_max_rejects);
                  when 'stale_revision' then
                    ev_rej := public.simhub_ack_reject(ev_rej, v_apply.row->>'_label',
                                                       (v_apply.row->>'_index')::integer, 'stale_revision', v_max_rejects);
                  else
                    ev_rej := public.simhub_ack_reject(ev_rej, v_apply.row->>'_label',
                                                       (v_apply.row->>'_index')::integer, 'row_failed:P0001', v_max_rejects);
                end case;
              exception when others then
                ev_rej := public.simhub_ack_reject(ev_rej, v_apply.row->>'_label',
                                                   (v_apply.row->>'_index')::integer,
                                                   'row_failed:' || sqlstate, v_max_rejects);
              end;
            end loop;
          end;
        end if;

      end if;
    exception when others then
      -- De hele reekstransactie is teruggedraaid: dan mag de ACK geen enkele
      -- bevestiging meer noemen. Anders claimt hij rijen die niet bestaan.
      ev_block := 'series_failed:' || sqlstate;
      ev_acc := '[]'::jsonb;
      ev_dup := '[]'::jsonb;
      ev_sup := '[]'::jsonb;
    end;
  end if;

  -- -------------------------------------------------------------------------
  -- Rondeaggregaten
  -- -------------------------------------------------------------------------
  if p_laps is not null then
    begin
      if jsonb_typeof(p_laps) = 'array' then
        lp_recv := jsonb_array_length(p_laps);
      end if;
      if jsonb_typeof(p_laps) <> 'array' then
        lp_block := 'not_an_array';
      elsif jsonb_array_length(p_laps) > v_max_laps then
        lp_block := 'too_many';
      else
        -- T13-S1: één keer per batch lezen, niet per rij. De helper is
        -- SECURITY DEFINER met gepinde search_path.
        v_obs_enabled := public.simhub_observation_capture_enabled();
        -- Ook de verwijzing, om dezelfde reden als bij de gebeurtenissen.
        select coalesce(jsonb_object_agg(l.summary_uid::text,
                                         jsonb_build_object('rev', l.record_revision,
                                                            'hash', l.content_hash,
                                                            'sup', l.supersedes_summary_uid)), '{}'::jsonb)
          into v_prev
          from public.simhub_lap_summaries l
         where l.device_id = v_device
           and l.summary_uid in (
             select (x.value->>'summaryUid')::uuid
               from jsonb_array_elements(p_laps) x
              where public.simhub_jvalid(x.value->'summaryUid', 'uuid'));

        -- Dezelfde ronde kan meerdere keren in één batch zitten; alleen de
        -- hoogste revisie landt (review 3, punt 8).
        select coalesce(jsonb_object_agg(x.uid, x.rev), '{}'::jsonb)
          into v_batch_max
          from (select x.value->>'summaryUid' as uid,
                       max(case when x.value ? 'recordRevision'
                                 and public.simhub_jvalid(x.value->'recordRevision', 'integer', 1, 100000)
                                then (x.value->>'recordRevision')::integer
                                else 1 end) as rev
                  from jsonb_array_elements(p_laps) x
                 where jsonb_typeof(x.value) = 'object'
                   and jsonb_typeof(x.value->'summaryUid') = 'string'
                   and public.simhub_jvalid(x.value->'summaryUid', 'uuid')
                 group by 1) x;
        for v_rec in
          select t.value as row, t.ord as ord
            from jsonb_array_elements(p_laps) with ordinality as t(value, ord)
        loop
          begin
            v_label := null;
            if jsonb_typeof(v_rec.row) <> 'object' then
              lp_rej := public.simhub_ack_reject(lp_rej, null, v_rec.ord - 1, 'not_an_object', v_max_rejects);
              continue;
            end if;

            v_label := nullif(btrim(coalesce(v_rec.row->>'summaryId', '')), '');
            if v_rec.row->'summaryUid' is null or v_rec.row->'summaryUid' = 'null'::jsonb then
              lp_rej := public.simhub_ack_reject(lp_rej, v_label, v_rec.ord - 1, 'summary_uid_missing', v_max_rejects);
              continue;
            end if;
            if not public.simhub_jvalid(v_rec.row->'summaryUid', 'uuid') then
              lp_rej := public.simhub_ack_reject(lp_rej, v_label, v_rec.ord - 1, 'summary_uid_invalid', v_max_rejects);
              continue;
            end if;
            v_sum := public.simhub_juuid(v_rec.row->'summaryUid');
            v_name := v_label;
            v_label := v_sum::text;

            if jsonb_typeof(v_rec.row->'lapNumber') <> 'number'
               or not public.simhub_jvalid(v_rec.row->'lapNumber', 'integer', 0, 100000) then
              lp_rej := public.simhub_ack_reject(lp_rej, v_label, v_rec.ord - 1, 'lap_number_invalid', v_max_rejects);
              continue;
            end if;
            v_lap := public.simhub_jint(v_rec.row->'lapNumber');

            if not public.simhub_jvalid(v_rec.row->'segmentId', 'string', 1, 64)
               or not public.simhub_jvalid(v_rec.row->'observedSessionId', 'string', 1, 120)
               or not public.simhub_jvalid(v_rec.row->'startedAt', 'timestamp')
               or not public.simhub_jvalid(v_rec.row->'endedAt', 'timestamp')
               or not public.simhub_jvalid(v_rec.row->'currentDriverName', 'string', 1, 64)
               or not public.simhub_jvalid(v_rec.row->'aggregationVersion', 'integer', 1, 1000)
               or not public.simhub_jvalid(v_rec.row->'complete', 'boolean')
               or not public.simhub_jvalid(v_rec.row->'pitLap', 'boolean')
               or not public.simhub_jvalid(v_rec.row->'driverChanged', 'boolean') then
              lp_rej := public.simhub_ack_reject(lp_rej, v_label, v_rec.ord - 1, 'field_invalid', v_max_rejects);
              continue;
            end if;

            -- Temperatuur, brandstof en belasting: elke waarde moet eindig zijn en
            -- binnen een fysiek mogelijke band liggen. Geen enkele cast mag hier
            -- nog kunnen klappen.
            if not public.simhub_jvalid(v_rec.row->'trackTempCMean', 'number', -60, 120)
               or not public.simhub_jvalid(v_rec.row->'trackTempCMin', 'number', -60, 120)
               or not public.simhub_jvalid(v_rec.row->'trackTempCMax', 'number', -60, 120)
               or not public.simhub_jvalid(v_rec.row->'airTempCMean', 'number', -60, 120) then
              lp_rej := public.simhub_ack_reject(lp_rej, v_label, v_rec.ord - 1, 'temperature_invalid', v_max_rejects);
              continue;
            end if;
            if not public.simhub_jvalid(v_rec.row->'fuelStartLitres', 'number', 0, 300)
               or not public.simhub_jvalid(v_rec.row->'fuelEndLitres', 'number', 0, 300)
               or not public.simhub_jvalid(v_rec.row->'fuelLevelIntegralLitreSeconds', 'number', 0, 1200000)
               or not public.simhub_jvalid(v_rec.row->'fuelAddedLitresObserved', 'number', 0, 300) then
              lp_rej := public.simhub_ack_reject(lp_rej, v_label, v_rec.ord - 1, 'fuel_invalid', v_max_rejects);
              continue;
            end if;
            if not public.simhub_jvalid(v_rec.row->'absLatAccelIntegralGSeconds', 'number', 0, 600000)
               or not public.simhub_jvalid(v_rec.row->'latAccelSquaredIntegralG2Seconds', 'number', 0, 6000000)
               or not public.simhub_jvalid(v_rec.row->'maxAbsLatAccelG', 'number', 0, 10)
               or not public.simhub_jvalid(v_rec.row->'absLongAccelIntegralGSeconds', 'number', 0, 600000) then
              lp_rej := public.simhub_ack_reject(lp_rej, v_label, v_rec.ord - 1, 'load_invalid', v_max_rejects);
              continue;
            end if;
            if not public.simhub_jvalid(v_rec.row->'validDurationSeconds', 'number', 0, 86400)
               or not public.simhub_jvalid(v_rec.row->'maxGapSeconds', 'number', 0, 86400) then
              lp_rej := public.simhub_ack_reject(lp_rej, v_label, v_rec.ord - 1, 'coverage_invalid', v_max_rejects);
              continue;
            end if;
            if not public.simhub_jvalid(v_rec.row->'sampleCount', 'integer', 0, 100000000) then
              lp_rej := public.simhub_ack_reject(lp_rej, v_label, v_rec.ord - 1, 'sample_count_invalid', v_max_rejects);
              continue;
            end if;
            if public.simhub_jtimestamptz(v_rec.row->'startedAt') is not null
               and public.simhub_jtimestamptz(v_rec.row->'endedAt') is not null
               and public.simhub_jtimestamptz(v_rec.row->'endedAt') < public.simhub_jtimestamptz(v_rec.row->'startedAt') then
              lp_rej := public.simhub_ack_reject(lp_rej, v_label, v_rec.ord - 1, 'window_inverted', v_max_rejects);
              continue;
            end if;
            if public.simhub_jdouble(v_rec.row->'trackTempCMin') is not null
               and public.simhub_jdouble(v_rec.row->'trackTempCMax') is not null
               and public.simhub_jdouble(v_rec.row->'trackTempCMax') < public.simhub_jdouble(v_rec.row->'trackTempCMin') then
              lp_rej := public.simhub_ack_reject(lp_rej, v_label, v_rec.ord - 1, 'temperature_inverted', v_max_rejects);
              continue;
            end if;

            v_seg := public.simhub_jtext(v_rec.row->'segmentId');
            v_obs := public.simhub_jtext(v_rec.row->'observedSessionId');
            -- Een UUID is geen clientgegeven. Wie hem toch meestuurt, krijgt een
            -- afwijzing met reden in plaats van een stil genegeerd veld.
            if v_rec.row ? 'currentDriverId' and v_rec.row->'currentDriverId' <> 'null'::jsonb then
              lp_rej := public.simhub_ack_reject(lp_rej, v_label, v_rec.ord - 1, 'client_driver_id_forbidden', v_max_rejects);
              continue;
            end if;
            v_drv_name := nullif(btrim(coalesce(v_rec.row->>'currentDriverName', '')), '');
            v_drv_id := null;
            if v_drv_name is not null then
              -- Naam -> user_id, binnen het team van dit apparaat en anders
              -- globaal. Geen match of twijfel: leeg, nooit een gok.
              v_drv_id := public.simhub_resolve_driver_user(v_event, v_team, v_drv_name)::uuid;
            end if;
            v_agg := coalesce(public.simhub_jint(v_rec.row->'aggregationVersion'), 1);
            v_complete := public.simhub_jbool(v_rec.row->'complete');
            v_reasons := public.simhub_jtextarray(v_rec.row->'invalidReasons', 16);
            v_pitlap := public.simhub_jbool(v_rec.row->'pitLap');
            v_drvchg := public.simhub_jbool(v_rec.row->'driverChanged');
            -- Een rijderwissel binnen de ronde en tóch één naam: tegenstrijdig.
            -- Niet normaliseren (welke van de twee zou het zijn?), maar weigeren.
            if v_drvchg is true and v_drv_name is not null then
              lp_rej := public.simhub_ack_reject(lp_rej, v_label, v_rec.ord - 1, 'driver_changed_with_driver', v_max_rejects);
              continue;
            end if;
            v_tmean := public.simhub_jdouble(v_rec.row->'trackTempCMean');
            v_tmin := public.simhub_jdouble(v_rec.row->'trackTempCMin');
            v_tmax := public.simhub_jdouble(v_rec.row->'trackTempCMax');
            v_amean := public.simhub_jdouble(v_rec.row->'airTempCMean');
            v_fs := public.simhub_jdouble(v_rec.row->'fuelStartLitres');
            v_fe := public.simhub_jdouble(v_rec.row->'fuelEndLitres');
            v_fi := public.simhub_jdouble(v_rec.row->'fuelLevelIntegralLitreSeconds');
            v_fa := public.simhub_jdouble(v_rec.row->'fuelAddedLitresObserved');
            v_ai := public.simhub_jdouble(v_rec.row->'absLatAccelIntegralGSeconds');
            v_ai2 := public.simhub_jdouble(v_rec.row->'latAccelSquaredIntegralG2Seconds');
            v_amax := public.simhub_jdouble(v_rec.row->'maxAbsLatAccelG');
            v_ali := public.simhub_jdouble(v_rec.row->'absLongAccelIntegralGSeconds');
            v_vd := public.simhub_jdouble(v_rec.row->'validDurationSeconds');
            v_sc := public.simhub_jdouble(v_rec.row->'sampleCount');
            v_gap := public.simhub_jdouble(v_rec.row->'maxGapSeconds');
            v_pitids := public.simhub_jtextarray(v_rec.row->'pitVisitIds', 32);
            v_wearids := public.simhub_jtextarray(v_rec.row->'wearObservationIds', 64);
            v_cov := v_rec.row->'coverage';
            if v_cov = 'null'::jsonb then v_cov := null; end if;
            -- Dekking per metriekgroep. Een waarde zonder dekking is geen meting:
            -- de rij wordt geweigerd in plaats van als 'compleet' opgeslagen met
            -- een lege dekking.
            if not public.simhub_coverage_valid(v_cov) then
              lp_rej := public.simhub_ack_reject(lp_rej, v_label, v_rec.ord - 1, 'coverage_contract', v_max_rejects);
              continue;
            end if;
            if (v_tmean is not null or v_tmin is not null or v_tmax is not null or v_amean is not null)
               and not public.simhub_coverage_has(v_cov, 'temperature') then
              lp_rej := public.simhub_ack_reject(lp_rej, v_label, v_rec.ord - 1, 'coverage_missing:temperature', v_max_rejects);
              continue;
            end if;
            if (v_fi is not null or v_fa is not null) and not public.simhub_coverage_has(v_cov, 'fuel') then
              lp_rej := public.simhub_ack_reject(lp_rej, v_label, v_rec.ord - 1, 'coverage_missing:fuel', v_max_rejects);
              continue;
            end if;
            if (v_ai is not null or v_ai2 is not null or v_amax is not null or v_ali is not null)
               and not public.simhub_coverage_has(v_cov, 'load') then
              lp_rej := public.simhub_ack_reject(lp_rej, v_label, v_rec.ord - 1, 'coverage_missing:load', v_max_rejects);
              continue;
            end if;
            -- "Compleet" is een claim over de hele ronde. Onvoldoende dekking
            -- is geen framefout: de ronde blijft geldig, maar de claim gaat naar
            -- false en de reden komt in invalid_reasons. Dezelfde regel als in de
            -- Edge-parser (coverageVerdict).
            if v_complete is true then
              v_cover_reasons := public.simhub_coverage_reasons(
                v_cov,
                public.simhub_jtimestamptz(v_rec.row->'startedAt'),
                public.simhub_jtimestamptz(v_rec.row->'endedAt'));
              if cardinality(v_cover_reasons) > 0 then
                v_complete := false;
                v_reasons := (select array_agg(x order by x)
                                from (select distinct unnest(coalesce(v_reasons, '{}'::text[])
                                                            || v_cover_reasons) as x
                                       limit 16) q);
              end if;
            end if;
            -- De vlakke dekkingskolommen zijn een samenvatting van de groepen; ze
            -- worden afgeleid en nooit uit de payload overgenomen.
            if v_cov is not null then
              v_vd := public.simhub_coverage_valid_duration(v_cov);
              v_gap := public.simhub_coverage_max_gap(v_cov);
              v_sc := public.simhub_coverage_sample_total(v_cov)::double precision;
            end if;
            if not public.simhub_jvalid(v_rec.row->'recordRevision', 'integer', 1, 100000) then
              lp_rej := public.simhub_ack_reject(lp_rej, v_label, v_rec.ord - 1, 'revision_invalid', v_max_rejects);
              continue;
            end if;
            if not public.simhub_jvalid(v_rec.row->'supersedesSummaryUid', 'uuid') then
              lp_rej := public.simhub_ack_reject(lp_rej, v_label, v_rec.ord - 1, 'supersedes_invalid', v_max_rejects);
              continue;
            end if;
            v_rev := coalesce(public.simhub_jint(v_rec.row->'recordRevision'), 1);
            v_supersedes := public.simhub_juuid(v_rec.row->'supersedesSummaryUid');

            -- ---------------------------------------------------------------
            -- T13-S1: observation-poort, vóór enige schrijfactie.
            --  * afwezig          -> legacy (kolom NULL, v1-hash, geen extra key)
            --  * null/ongeldig    -> rijafwijzing, nooit stil legacy
            --  * device-mismatch  -> HELE meetrij geweigerd: geen insert/update
            --                        en dus ook geen P1-capture voor deze rij
            --  * flag uit         -> observation_unavailable
            -- Het device komt uit p_device_id (servercontext), nooit uit de rij.
            -- ---------------------------------------------------------------
            v_obs_disp := public.simhub_observation_row_disposition(v_rec.row, p_device_id);
            v_lap_obs := null;
            if v_obs_disp = 'observation_accepted' then
              if not coalesce(v_obs_enabled, false) then
                lp_rej := public.simhub_ack_reject(lp_rej, v_label, v_rec.ord - 1,
                                                   'observation_unavailable', v_max_rejects);
                continue;
              end if;
              v_lap_obs := v_rec.row->'observation';
            elsif v_obs_disp <> 'observation_absent' then
              lp_rej := public.simhub_ack_reject(lp_rej, v_label, v_rec.ord - 1,
                                                 v_obs_disp, v_max_rejects);
              continue;
            end if;

            -- Hoogste revisie binnen deze batch wint; een lagere wordt stale.
            v_batch_rev := null;
            if v_batch_max ? v_sum::text then
              v_batch_rev := (v_batch_max ->> v_sum::text)::integer;
            end if;
            if v_batch_rev is not null and v_rev < v_batch_rev then
              lp_rej := public.simhub_ack_reject(lp_rej, v_label, v_rec.ord - 1, 'stale_revision', v_max_rejects);
              continue;
            end if;

            -- De stand waartegen deze ronde geclassificeerd wordt; binnen deze
            -- batch schuift die mee met wat al is ingepland (review 3, punt 8).
            v_prev_rev := null;
            v_prev_hash := null;
            v_prev_sup := null;
            if v_prev ? v_sum::text then
              v_prev_rev := (v_prev -> v_sum::text ->> 'rev')::integer;
              v_prev_hash := v_prev -> v_sum::text ->> 'hash';
              v_prev_sup := nullif(v_prev -> v_sum::text ->> 'sup', '')::uuid;
            end if;
            -- De verwijzing die de rij straks werkelijk draagt (review 3, punt 9).
            v_stored_sup := case when v_prev_rev is null then v_supersedes
                                 else coalesce(v_supersedes, v_prev_sup) end;

            -- Vingerafdruk over de opgeslagen rij, via dezelfde functie als de
            -- terugval en de backfill.
            v_hash_row := jsonb_populate_record(
              null::public.simhub_lap_summaries,
              jsonb_build_object(
                'segment_id', v_seg, 'observed_session_id', v_obs, 'lap_number', v_lap,
                'started_at', public.simhub_jtimestamptz(v_rec.row->'startedAt'),
                'ended_at', public.simhub_jtimestamptz(v_rec.row->'endedAt'),
                'current_driver_name', v_drv_name, 'aggregation_version', v_agg,
                'complete', v_complete, 'invalid_reasons', v_reasons, 'pit_lap', v_pitlap,
                'driver_changed', v_drvchg,
                'track_temp_c_min', v_tmin, 'track_temp_c_max', v_tmax,
                'track_temp_c_mean', v_tmean, 'air_temp_c_mean', v_amean,
                'fuel_start_litres', v_fs, 'fuel_end_litres', v_fe,
                'fuel_level_integral_litre_seconds', v_fi,
                'fuel_added_litres_observed', v_fa,
                'abs_lat_accel_integral_g_seconds', v_ai,
                'lat_accel_squared_integral_g2_seconds', v_ai2,
                'max_abs_lat_accel_g', v_amax, 'abs_long_accel_integral_g_seconds', v_ali,
                'valid_duration_seconds', v_vd, 'sample_count', v_sc,
                'max_gap_seconds', v_gap, 'pit_visit_ids', v_pitids,
                'wear_observation_ids', v_wearids, 'coverage', v_cov,
                'observation', v_lap_obs,
                'supersedes_summary_uid', v_stored_sup));
            -- v2 alleen bij een non-null observation; anders exact v1.
            v_hash := case when v_lap_obs is null
                           then public.simhub_lap_row_hash(v_hash_row)
                           else public.simhub_lap_row_hash_v2(v_hash_row) end;

            if v_prev_rev is null then
              lp_ins := lp_ins || jsonb_build_object(
                'id', gen_random_uuid(),
                'summary_uid', v_sum, 'summary_id', v_name, 'device_id', v_device,
                'observed_session_id', v_obs, 'delivered_session_id', v_delivered,
                'transport_session_id', v_delivered, 'segment_id', v_seg,
                'lap_number', v_lap,
                'started_at', public.simhub_jtimestamptz(v_rec.row->'startedAt'),
                'ended_at', public.simhub_jtimestamptz(v_rec.row->'endedAt'),
                'current_driver_id', v_drv_id, 'current_driver_name', v_drv_name,
                'aggregation_version', v_agg, 'complete', v_complete,
                'invalid_reasons', v_reasons, 'pit_lap', v_pitlap,
                'driver_changed', v_drvchg, 'track_temp_c_mean', v_tmean,
                'track_temp_c_min', v_tmin, 'track_temp_c_max', v_tmax,
                'air_temp_c_mean', v_amean, 'fuel_start_litres', v_fs,
                'fuel_end_litres', v_fe, 'fuel_level_integral_litre_seconds', v_fi,
                'fuel_added_litres_observed', v_fa,
                'abs_lat_accel_integral_g_seconds', v_ai,
                'lat_accel_squared_integral_g2_seconds', v_ai2,
                'max_abs_lat_accel_g', v_amax,
                'abs_long_accel_integral_g_seconds', v_ali,
                'valid_duration_seconds', v_vd, 'sample_count', v_sc::bigint,
                'max_gap_seconds', v_gap, 'pit_visit_ids', v_pitids,
                'wear_observation_ids', v_wearids, 'coverage', v_cov,
                'record_revision', v_rev, 'content_hash', v_hash,
                'observation', v_lap_obs, 'supersedes_summary_uid', v_stored_sup,
                '_label', v_label, '_index', v_rec.ord - 1);
              lp_acc := lp_acc || jsonb_build_object('id', v_sum::text, 'record_revision', v_rev);
              v_prev := v_prev || jsonb_build_object(v_sum::text,
                          jsonb_build_object('rev', v_rev, 'hash', v_hash, 'sup', v_stored_sup));
            elsif v_rev > v_prev_rev then
              lp_upd := lp_upd || jsonb_build_object(
                'summary_uid', v_sum, 'summary_id', v_name, 'device_id', v_device,
                'observed_session_id', v_obs, 'delivered_session_id', v_delivered,
                'transport_session_id', v_delivered, 'segment_id', v_seg,
                'lap_number', v_lap,
                'started_at', public.simhub_jtimestamptz(v_rec.row->'startedAt'),
                'ended_at', public.simhub_jtimestamptz(v_rec.row->'endedAt'),
                'current_driver_id', v_drv_id, 'current_driver_name', v_drv_name,
                'aggregation_version', v_agg, 'complete', v_complete,
                'invalid_reasons', v_reasons, 'pit_lap', v_pitlap,
                'driver_changed', v_drvchg, 'track_temp_c_mean', v_tmean,
                'track_temp_c_min', v_tmin, 'track_temp_c_max', v_tmax,
                'air_temp_c_mean', v_amean, 'fuel_start_litres', v_fs,
                'fuel_end_litres', v_fe, 'fuel_level_integral_litre_seconds', v_fi,
                'fuel_added_litres_observed', v_fa,
                'abs_lat_accel_integral_g_seconds', v_ai,
                'lat_accel_squared_integral_g2_seconds', v_ai2,
                'max_abs_lat_accel_g', v_amax,
                'abs_long_accel_integral_g_seconds', v_ali,
                'valid_duration_seconds', v_vd, 'sample_count', v_sc::bigint,
                'max_gap_seconds', v_gap, 'pit_visit_ids', v_pitids,
                'wear_observation_ids', v_wearids, 'coverage', v_cov,
                'record_revision', v_rev, 'content_hash', v_hash,
                'observation', v_lap_obs, 'supersedes_summary_uid', v_stored_sup,
                '_label', v_label, '_index', v_rec.ord - 1);
              lp_sup := lp_sup || jsonb_build_object('id', v_sum::text, 'record_revision', v_rev);
              v_prev := v_prev || jsonb_build_object(v_sum::text,
                          jsonb_build_object('rev', v_rev, 'hash', v_hash, 'sup', v_stored_sup));
            elsif v_rev = v_prev_rev and v_hash is not distinct from v_prev_hash then
              lp_dup := lp_dup || jsonb_build_object('id', v_sum::text, 'record_revision', v_prev_rev);
              -- Dezelfde velden als een insert of update: de terugval
              -- herclassificeert ook dit duplicaat (review 4).
              lp_dup_rows := lp_dup_rows || jsonb_build_object(
                'summary_uid', v_sum, 'summary_id', v_name, 'device_id', v_device,
                'observed_session_id', v_obs, 'delivered_session_id', v_delivered,
                'transport_session_id', v_delivered, 'segment_id', v_seg,
                'lap_number', v_lap,
                'started_at', public.simhub_jtimestamptz(v_rec.row->'startedAt'),
                'ended_at', public.simhub_jtimestamptz(v_rec.row->'endedAt'),
                'current_driver_id', v_drv_id, 'current_driver_name', v_drv_name,
                'aggregation_version', v_agg, 'complete', v_complete,
                'invalid_reasons', v_reasons, 'pit_lap', v_pitlap,
                'driver_changed', v_drvchg, 'track_temp_c_mean', v_tmean,
                'track_temp_c_min', v_tmin, 'track_temp_c_max', v_tmax,
                'air_temp_c_mean', v_amean, 'fuel_start_litres', v_fs,
                'fuel_end_litres', v_fe, 'fuel_level_integral_litre_seconds', v_fi,
                'fuel_added_litres_observed', v_fa,
                'abs_lat_accel_integral_g_seconds', v_ai,
                'lat_accel_squared_integral_g2_seconds', v_ai2,
                'max_abs_lat_accel_g', v_amax,
                'abs_long_accel_integral_g_seconds', v_ali,
                'valid_duration_seconds', v_vd, 'sample_count', v_sc::bigint,
                'max_gap_seconds', v_gap, 'pit_visit_ids', v_pitids,
                'wear_observation_ids', v_wearids, 'coverage', v_cov,
                'record_revision', v_rev, 'content_hash', v_hash,
                'observation', v_lap_obs, 'supersedes_summary_uid', v_stored_sup,
                '_label', v_label, '_index', v_rec.ord - 1);
            elsif v_rev = v_prev_rev then
              lp_rej := public.simhub_ack_reject(lp_rej, v_label, v_rec.ord - 1, 'revision_conflict', v_max_rejects);
            else
              lp_rej := public.simhub_ack_reject(lp_rej, v_label, v_rec.ord - 1, 'stale_revision', v_max_rejects);
            end if;
          exception when others then
            lp_rej := public.simhub_ack_reject(lp_rej, v_label, v_rec.ord - 1, 'row_failed:' || sqlstate, v_max_rejects);
          end;
        end loop;

        if jsonb_array_length(lp_ins) > 0 or jsonb_array_length(lp_upd) > 0 then
          begin
            if jsonb_array_length(lp_ins) > 0 then
              insert into public.simhub_lap_summaries (
                id, summary_uid, summary_id, device_id, observed_session_id, delivered_session_id,
                transport_session_id, segment_id, lap_number, started_at, ended_at,
                current_driver_id, current_driver_name, aggregation_version, complete,
                invalid_reasons, pit_lap, driver_changed, track_temp_c_mean, track_temp_c_min,
                track_temp_c_max, air_temp_c_mean, fuel_start_litres, fuel_end_litres,
                fuel_level_integral_litre_seconds, fuel_added_litres_observed,
                abs_lat_accel_integral_g_seconds, lat_accel_squared_integral_g2_seconds,
                max_abs_lat_accel_g, abs_long_accel_integral_g_seconds, valid_duration_seconds,
                sample_count, max_gap_seconds, pit_visit_ids, wear_observation_ids, coverage,
                record_revision, content_hash, supersedes_summary_uid, observation)
              select r.id, r.summary_uid, r.summary_id, r.device_id, r.observed_session_id,
                     r.delivered_session_id, r.transport_session_id, r.segment_id, r.lap_number,
                     r.started_at, r.ended_at, r.current_driver_id, r.current_driver_name,
                     r.aggregation_version, r.complete, r.invalid_reasons, r.pit_lap,
                     r.driver_changed, r.track_temp_c_mean, r.track_temp_c_min,
                     r.track_temp_c_max, r.air_temp_c_mean, r.fuel_start_litres,
                     r.fuel_end_litres, r.fuel_level_integral_litre_seconds,
                     r.fuel_added_litres_observed, r.abs_lat_accel_integral_g_seconds,
                     r.lat_accel_squared_integral_g2_seconds, r.max_abs_lat_accel_g,
                     r.abs_long_accel_integral_g_seconds, r.valid_duration_seconds,
                     r.sample_count, r.max_gap_seconds, r.pit_visit_ids,
                     r.wear_observation_ids, r.coverage, r.record_revision, r.content_hash,
                     r.supersedes_summary_uid, r.observation
                from jsonb_populate_recordset(null::public.simhub_lap_summaries, lp_ins) r;
            end if;
            if jsonb_array_length(lp_upd) > 0 then
              update public.simhub_lap_summaries l
                 set summary_id = u.summary_id,
                     observed_session_id = u.observed_session_id,
                     delivered_session_id = u.delivered_session_id,
                     transport_session_id = u.transport_session_id,
                     segment_id = u.segment_id,
                     lap_number = u.lap_number,
                     started_at = u.started_at,
                     ended_at = u.ended_at,
                     current_driver_id = u.current_driver_id,
                     current_driver_name = u.current_driver_name,
                     aggregation_version = u.aggregation_version,
                     complete = u.complete,
                     invalid_reasons = u.invalid_reasons,
                     pit_lap = u.pit_lap,
                     driver_changed = u.driver_changed,
                     track_temp_c_mean = u.track_temp_c_mean,
                     track_temp_c_min = u.track_temp_c_min,
                     track_temp_c_max = u.track_temp_c_max,
                     air_temp_c_mean = u.air_temp_c_mean,
                     fuel_start_litres = u.fuel_start_litres,
                     fuel_end_litres = u.fuel_end_litres,
                     fuel_level_integral_litre_seconds = u.fuel_level_integral_litre_seconds,
                     fuel_added_litres_observed = u.fuel_added_litres_observed,
                     abs_lat_accel_integral_g_seconds = u.abs_lat_accel_integral_g_seconds,
                     lat_accel_squared_integral_g2_seconds = u.lat_accel_squared_integral_g2_seconds,
                     max_abs_lat_accel_g = u.max_abs_lat_accel_g,
                     abs_long_accel_integral_g_seconds = u.abs_long_accel_integral_g_seconds,
                     valid_duration_seconds = u.valid_duration_seconds,
                     sample_count = u.sample_count,
                     max_gap_seconds = u.max_gap_seconds,
                     pit_visit_ids = u.pit_visit_ids,
                     wear_observation_ids = u.wear_observation_ids,
                     coverage = u.coverage,
                     record_revision = u.record_revision,
                     -- Al verrekend met de bestaande stand en zo gehasht.
                     supersedes_summary_uid = u.supersedes_summary_uid,
                     observation = u.observation,
                     content_hash = u.content_hash,
                     received_at = now()
                from jsonb_populate_recordset(null::public.simhub_lap_summaries, lp_upd) u
               where l.device_id = u.device_id and l.summary_uid = u.summary_uid
                 and l.record_revision < u.record_revision;
              get diagnostics v_updated = row_count;
              if v_updated <> jsonb_array_length(lp_upd) then
                raise exception 'fast_path_incomplete' using errcode = 'P0001';
              end if;
            end if;
          exception when others then
            -- Alles terug en opnieuw, rij voor rij, met herclassificatie tegen
            -- de rijstand van dít moment (review 3, punt 8). De duplicaat-
            -- kandidaten doen mee, anders verdwijnen zij uit alle uitslag-
            -- lijsten (review 4), in de oorspronkelijke batchvolgorde.
            lp_acc := '[]'::jsonb;
            lp_dup := '[]'::jsonb;
            lp_sup := '[]'::jsonb;
            for v_apply in
              select value as row
                from jsonb_array_elements(lp_ins || lp_upd || lp_dup_rows)
               order by (value->>'_index')::integer
            loop
              begin
                v_apply_result := public.simhub_apply_lap_row(v_apply.row - '_label' - '_index');
                if v_apply_result = 'accepted' then
                  lp_acc := lp_acc || jsonb_build_object('id', v_apply.row->>'summary_uid',
                                                         'record_revision', (v_apply.row->>'record_revision')::integer);
                elsif v_apply_result = 'superseded' then
                  lp_sup := lp_sup || jsonb_build_object('id', v_apply.row->>'summary_uid',
                                                         'record_revision', (v_apply.row->>'record_revision')::integer);
                elsif v_apply_result = 'duplicate' then
                  lp_dup := lp_dup || jsonb_build_object('id', v_apply.row->>'summary_uid',
                                                         'record_revision', (v_apply.row->>'record_revision')::integer);
                elsif v_apply_result = 'revision_conflict' then
                  lp_rej := public.simhub_ack_reject(lp_rej, v_apply.row->>'_label',
                                                     (v_apply.row->>'_index')::integer, 'revision_conflict', v_max_rejects);
                elsif v_apply_result = 'stale_revision' then
                  lp_rej := public.simhub_ack_reject(lp_rej, v_apply.row->>'_label',
                                                     (v_apply.row->>'_index')::integer, 'stale_revision', v_max_rejects);
                elsif v_apply_result like 'rejected:%' then
                  lp_rej := public.simhub_ack_reject(lp_rej, v_apply.row->>'_label',
                                                     (v_apply.row->>'_index')::integer,
                                                     substr(v_apply_result, 10), v_max_rejects);
                else
                  lp_rej := public.simhub_ack_reject(lp_rej, v_apply.row->>'_label',
                                                     (v_apply.row->>'_index')::integer, 'row_failed:P0001', v_max_rejects);
                end if;
              exception when others then
                lp_rej := public.simhub_ack_reject(lp_rej, v_apply.row->>'_label',
                                                   (v_apply.row->>'_index')::integer,
                                                   'row_failed:' || sqlstate, v_max_rejects);
              end;
            end loop;
          end;
        end if;

      end if;
    exception when others then
      lp_block := 'series_failed:' || sqlstate;
      lp_acc := '[]'::jsonb;
      lp_dup := '[]'::jsonb;
      lp_sup := '[]'::jsonb;
    end;
  end if;

  return jsonb_build_object(
    'ok', true,
    'device_id', v_device,
    'delivered_session_id', v_delivered,
    'events', jsonb_build_object(
      'received', ev_recv,
      'accepted', ev_acc,
      'duplicates', ev_dup,
      'superseded', ev_sup,
      'rejected', ev_rej,
      'block_error', ev_block),
    'laps', jsonb_build_object(
      'received', lp_recv,
      'accepted', lp_acc,
      'duplicates', lp_dup,
      'superseded', lp_sup,
      'rejected', lp_rej,
      'block_error', lp_block));
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6. P1: uitsluitend de geaccepteerde ruwe observation in de bestaande
--    dunne statement-triggers. Geen extra tabel, geen per-rij SELECT.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pitwall_learning.capture_lap_summaries_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pitwall_learning, pg_temp
SET lock_timeout = '50ms'
AS $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pitwall_learning.runtime_settings rs
     WHERE rs.id = 1 AND rs.capture_enabled
  ) THEN
    RETURN NULL;
  END IF;

  PERFORM pitwall_learning.capture_source_batch(
    'lap_summary',
    (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'device_id', n.device_id,
        'source_uid', n.summary_uid,
        'record_revision', n.record_revision,
        'content_hash', n.content_hash,
        'observed_at', coalesce(n.started_at, n.ended_at),
        'source_received_at', n.received_at,
        'payload', jsonb_strip_nulls(jsonb_build_object(
          'observed_session_id', n.observed_session_id,
          'delivered_session_id', n.delivered_session_id,
          'segment_id', n.segment_id,
          'lap_number', n.lap_number,
          'started_at', n.started_at,
          'ended_at', n.ended_at,
          'aggregation_version', n.aggregation_version,
          'complete', n.complete,
          'invalid_reasons', n.invalid_reasons,
          'pit_lap', n.pit_lap,
          'driver_changed', n.driver_changed,
          'track_temp_c_mean', n.track_temp_c_mean,
          'track_temp_c_min', n.track_temp_c_min,
          'track_temp_c_max', n.track_temp_c_max,
          'air_temp_c_mean', n.air_temp_c_mean,
          'fuel_start_litres', n.fuel_start_litres,
          'fuel_end_litres', n.fuel_end_litres,
          'fuel_level_integral_litre_seconds', n.fuel_level_integral_litre_seconds,
          'fuel_added_litres_observed', n.fuel_added_litres_observed,
          'abs_lat_accel_integral_g_seconds', n.abs_lat_accel_integral_g_seconds,
          'lat_accel_squared_integral_g2_seconds', n.lat_accel_squared_integral_g2_seconds,
          'max_abs_lat_accel_g', n.max_abs_lat_accel_g,
          'abs_long_accel_integral_g_seconds', n.abs_long_accel_integral_g_seconds,
          'valid_duration_seconds', n.valid_duration_seconds,
          'sample_count', n.sample_count,
          'max_gap_seconds', n.max_gap_seconds,
          'coverage', n.coverage,
          -- T13-S1: uitsluitend de geaccepteerde, ruwe observation. Geen
          -- owner-ID, geen namen, geen frame. jsonb_strip_nulls laat een
          -- legacy-rij bytegelijk (sleutel verdwijnt bij NULL).
          'observation', n.observation
        ))
      )), '[]'::jsonb)
      FROM new_rows n)
  );
  RETURN NULL;
EXCEPTION WHEN others THEN
  RAISE WARNING 'pitwall_learning capture skipped' USING ERRCODE = 'PWL01';
  RETURN NULL;
END
$fn$;

CREATE OR REPLACE FUNCTION pitwall_learning.capture_lap_summaries_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pitwall_learning, pg_temp
SET lock_timeout = '50ms'
AS $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pitwall_learning.runtime_settings rs
     WHERE rs.id = 1 AND rs.capture_enabled
  ) THEN
    RETURN NULL;
  END IF;

  PERFORM pitwall_learning.capture_source_batch(
    'lap_summary',
    (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'device_id', n.device_id,
        'source_uid', n.summary_uid,
        'record_revision', n.record_revision,
        'content_hash', n.content_hash,
        'observed_at', coalesce(n.started_at, n.ended_at),
        'source_received_at', n.received_at,
        'payload', jsonb_strip_nulls(jsonb_build_object(
          'observed_session_id', n.observed_session_id,
          'delivered_session_id', n.delivered_session_id,
          'segment_id', n.segment_id,
          'lap_number', n.lap_number,
          'started_at', n.started_at,
          'ended_at', n.ended_at,
          'aggregation_version', n.aggregation_version,
          'complete', n.complete,
          'invalid_reasons', n.invalid_reasons,
          'pit_lap', n.pit_lap,
          'driver_changed', n.driver_changed,
          'track_temp_c_mean', n.track_temp_c_mean,
          'track_temp_c_min', n.track_temp_c_min,
          'track_temp_c_max', n.track_temp_c_max,
          'air_temp_c_mean', n.air_temp_c_mean,
          'fuel_start_litres', n.fuel_start_litres,
          'fuel_end_litres', n.fuel_end_litres,
          'fuel_level_integral_litre_seconds', n.fuel_level_integral_litre_seconds,
          'fuel_added_litres_observed', n.fuel_added_litres_observed,
          'abs_lat_accel_integral_g_seconds', n.abs_lat_accel_integral_g_seconds,
          'lat_accel_squared_integral_g2_seconds', n.lat_accel_squared_integral_g2_seconds,
          'max_abs_lat_accel_g', n.max_abs_lat_accel_g,
          'abs_long_accel_integral_g_seconds', n.abs_long_accel_integral_g_seconds,
          'valid_duration_seconds', n.valid_duration_seconds,
          'sample_count', n.sample_count,
          'max_gap_seconds', n.max_gap_seconds,
          'coverage', n.coverage,
          -- T13-S1: uitsluitend de geaccepteerde, ruwe observation. Geen
          -- owner-ID, geen namen, geen frame. jsonb_strip_nulls laat een
          -- legacy-rij bytegelijk (sleutel verdwijnt bij NULL).
          'observation', n.observation
        ))
      )), '[]'::jsonb)
      FROM new_rows n
      JOIN old_rows o ON o.id = n.id
     WHERE (n.record_revision, n.content_hash)
           IS DISTINCT FROM (o.record_revision, o.content_hash))
  );
  RETURN NULL;
EXCEPTION WHEN others THEN
  RAISE WARNING 'pitwall_learning capture skipped' USING ERRCODE = 'PWL01';
  RETURN NULL;
END
$fn$;
-- ---------------------------------------------------------------------------
-- 7. Rechten: niets voor anon/authenticated, alleen service_role voor de
--    bestaande schrijf-API en de probe.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.simhub_observation_ts_le(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.simhub_observation_ts_valid(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.simhub_observation_text_valid(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.simhub_observation_v1_valid(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.simhub_observation_row_disposition(jsonb, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.simhub_lap_row_hash_v2(public.simhub_lap_summaries) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.simhub_observation_capture_enabled() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.simhub_observation_v1_available() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.simhub_observation_capture_enabled() TO service_role;
GRANT EXECUTE ON FUNCTION public.simhub_observation_v1_available() TO service_role;
GRANT EXECUTE ON FUNCTION public.simhub_lap_row_hash_v2(public.simhub_lap_summaries) TO service_role;
-- De gedocumenteerde directe terugval `simhub_apply_lap_row` is SECURITY
-- INVOKER. De service_role roept hem rechtstreeks aan en heeft daarom EXECUTE
-- nodig op de volledige pure helperketen: dispositie -> validator ->
-- ts/text-helpers. Alleen service_role; PUBLIC/anon/authenticated blijven
-- expliciet geweigerd. Zo blijft dit een minimale grant en geen
-- SECURITY DEFINER-permission-bypass.
GRANT EXECUTE ON FUNCTION public.simhub_observation_row_disposition(jsonb, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.simhub_observation_v1_valid(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.simhub_observation_ts_le(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.simhub_observation_ts_valid(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.simhub_observation_text_valid(text, integer) TO service_role;

COMMENT ON FUNCTION public.simhub_observation_v1_available() IS
  'T13-S1 reader capability for the Edge. True only when the full package exists and observation_enabled is on. service_role only.';
COMMENT ON FUNCTION public.simhub_observation_row_disposition(jsonb, uuid) IS
  'T13-S1 row decision: absent legacy, invalid/null reject, UUID-equivalent device mismatch, else accept. Device is the server context, never the row.';
COMMENT ON FUNCTION public.simhub_lap_row_hash_v2(public.simhub_lap_summaries) IS
  'T13-S1 content hash over the stored row plus the validated raw observation. v1 remains byte-identical; v2 is used only when observation is non-null.';
COMMENT ON FUNCTION public.simhub_persist_measurement_batch(uuid, text, jsonb, jsonb) IS
  'Interne schrijver voor meetgebeurtenissen en rondeaggregaten. Set-based snelpad met rij-voor-rij terugval. T13-S1: een observation-rij is rijgebonden aan p_device_id, wordt bij mismatch/null/ongeldig geweigerd en krijgt alleen dan hash v2.';
