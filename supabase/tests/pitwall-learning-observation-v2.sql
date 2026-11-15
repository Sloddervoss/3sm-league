-- Focused test on an EXISTING disposable rehearsal database after forward migration.
-- No production, no new lab. Run psql -X -v ON_ERROR_STOP=1 -f this-file.
BEGIN;
DO $test$
DECLARE
  v1 jsonb := '{"version":1,"capture":{"deviceId":"aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"},"interval":{"firstSampleAt":"2026-11-14T12:00:00.000Z","lastSampleAt":"2026-11-14T12:00:01.000Z","samples":3,"maxGapSeconds":0.5,"unknownSeconds":0,"edgeBeforeSeconds":0,"edgeAfterSeconds":0},"driverNameContinuity":{"value":"unchanged"}}';
  v2 jsonb;
  bad jsonb;
BEGIN
  IF inet_server_addr() IS NOT NULL OR current_database() NOT LIKE 'pitwall_learning%' THEN
    RAISE EXCEPTION 'disposable local rehearsal database required';
  END IF;
  v2 := jsonb_set(v1, '{version}', '2') || '{"fuelQuality":{"pitRoad":false,"refuel":false,"resetOrTow":null,"driverId":"sim-driver-42","driverChanged":false}}';
  IF NOT public.simhub_observation_v1_valid(v1) OR NOT public.simhub_observation_v1_valid(v2) THEN
    RAISE EXCEPTION 'v1/v2 rejected'; END IF;
  IF public.simhub_observation_row_disposition(jsonb_build_object('observation',v2), 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee') <> 'observation_accepted' THEN
    RAISE EXCEPTION 'real capture row seam rejected v2'; END IF;
  IF public.simhub_observation_row_disposition(jsonb_build_object('observation',v2), 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee') <> 'observation_device_mismatch' THEN
    RAISE EXCEPTION 'device fence bypassed'; END IF;
  FOREACH bad IN ARRAY ARRAY[
    jsonb_set(v2, '{fuelQuality}', 'null'),
    jsonb_set(v2, '{fuelQuality,pitRoad}', '0'),
    jsonb_set(v2, '{fuelQuality,driverId}', '""'),
    v2 #- '{fuelQuality,driverChanged}',
    jsonb_set(v2, '{fuelQuality,unknown}', 'false'),
    jsonb_set(v2, '{version}', '1')
  ] LOOP
    IF public.simhub_observation_v1_valid(bad) THEN RAISE EXCEPTION 'malformed quality accepted: %', bad; END IF;
  END LOOP;
  CREATE TEMP TABLE normal_v2_retained (observation jsonb);
  INSERT INTO normal_v2_retained VALUES (v2);
  RAISE NOTICE 'PASS v1/v2 capture validator, exact nullable keys, device fence';
END
$test$;
\ir ../rollbacks/20261114160000_pitwall_learning_observation_v2_capture.sql
DO $rollback$
DECLARE p jsonb;
BEGIN
  SELECT observation INTO p FROM normal_v2_retained;
  IF public.simhub_observation_v1_valid(p) THEN RAISE EXCEPTION 'rollback still accepts v2'; END IF;
  IF p->'fuelQuality'->'resetOrTow' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'retained facts changed'; END IF;
  IF NOT public.simhub_observation_v1_valid(jsonb_set(p - 'fuelQuality','{version}','1')) THEN RAISE EXCEPTION 'rollback broke v1'; END IF;
  RAISE NOTICE 'PASS rollback refuses new v2, preserves retained raw facts and accepts v1';
END
$rollback$;
ROLLBACK;
