-- ============================================================================
-- Rollback voor 20261112134500_pitwall_learning_observation_capture.sql
--
-- Dit is een DATA-PRESERVING DISABLE-AMENDMENT, geen schema-down.
--
-- Bewust WEL:
--   * `observation_enabled` op FALSE (idempotent);
--   * de P1-capturefuncties terug naar hun exacte P1-projectie zonder
--     `observation`, zodat er tijdens de disable niets nieuws in de outbox
--     belandt;
--   * oude en nieuwe rijen blijven leesbaar.
--
-- Bewust NIET:
--   * geen DROP COLUMN, geen DROP CONSTRAINT, geen DROP FUNCTION;
--   * geen DELETE of bulkverwijdering van meetrijen of P1-bewijs;
--   * geen herschrijving van bestaande v1- of v2-hashes;
--   * geen terugzetting van de oude schrijver.
--
-- Waarom de oude schrijver niet terugkomt: die kent `observation` niet en zou
-- een herverzonden observation-rij stil accepteren en strippen, terwijl de
-- opgeslagen v2-hash als conflict wordt herclassificeerd. Dat is geen veilige
-- rollback maar dataverlies met een groene exit. De nieuwe schrijver blijft dus
-- staan en weigert na deze rollback elke observation-rij expliciet met
-- `observation_unavailable`; legacy-rijen schrijven exact als vóór T13-S1.
--
-- Heractiveren is een aparte, gecontroleerde stap: forward opnieuw toepassen
-- kan niet (de guard weigert bestaande objecten), dus activatie gebeurt door
-- `observation_enabled` bewust op TRUE te zetten én de P1-projectie opnieuw toe
-- te passen. Beide vereisen een nieuwe goedgekeurde wijziging.
--
-- Forward en rollback zijn transactioneel aan te bieden (geen eigen
-- BEGIN/COMMIT).
-- ============================================================================

DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'simhub_lap_summaries'
       AND column_name = 'observation'
  ) THEN
    RAISE EXCEPTION 'T13-S1 column is missing; nothing to disable';
  END IF;
  IF to_regprocedure('public.simhub_observation_v1_available()') IS NULL THEN
    RAISE EXCEPTION 'T13-S1 probe is missing; nothing to disable';
  END IF;
END
$guard$;

-- 1. Capture uit. De schrijver weigert daarna observation-rijen rij-level.
UPDATE pitwall_learning.runtime_settings
   SET observation_enabled = false,
       updated_at = now()
 WHERE id = 1
   AND observation_enabled IS DISTINCT FROM false;

-- 2. P1-projectie terug naar de exacte P1-vorm (zonder observation).
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
          'coverage', n.coverage
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
          'coverage', n.coverage
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
-- 3. Slotcontrole: de kolom en de historische rijen zijn er nog. Geen enkele
--    destructieve actie in deze rollback.
DO $check$
DECLARE
  v_rows integer;
BEGIN
  SELECT count(*) INTO v_rows
    FROM public.simhub_lap_summaries
   WHERE observation IS NOT NULL;
  RAISE NOTICE 'T13-S1 rollback: % observation rows retained', v_rows;
END
$check$;
