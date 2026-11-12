-- ============================================================================
-- T13-S1 B2/B3 — echte service_role-matrix en fail-closed NULL-matrix
--
-- Draait NA de forward-migratie op de disposable container. Elke PASS is een
-- echte assertie; ON_ERROR_STOP stopt bij de eerste fout. Alleen synthetische
-- data, geen productieverbinding.
-- ============================================================================

DO $guard$
BEGIN
  IF current_database() <> 'pitwall_learning_p2_observation_s1'
     OR current_setting('data_directory') <> '/work/data' THEN
    RAISE EXCEPTION 'T13-S1 ROLE/NULL TEST: wrong database or data_directory';
  END IF;
  IF inet_server_addr() IS NOT NULL THEN
    RAISE EXCEPTION 'T13-S1 ROLE/NULL TEST: TCP connection is not allowed';
  END IF;
END
$guard$;

CREATE FUNCTION pg_temp.ok(p_ok boolean, p_name text)
RETURNS void
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF p_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: %', p_name;
  END IF;
  RAISE NOTICE 'PASS %', p_name;
END
$fn$;

CREATE FUNCTION pg_temp.dev_a() RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT 'd0000000-0000-4000-8000-0000000000a1'::uuid $$;
CREATE FUNCTION pg_temp.dev_b() RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT 'd0000000-0000-4000-8000-0000000000a2'::uuid $$;

CREATE FUNCTION pg_temp.obs(p_device text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT jsonb_build_object(
    'version', 1,
    'capture', jsonb_build_object('deviceId', p_device),
    'interval', jsonb_build_object(
      'firstSampleAt', '2026-11-12T10:00:00.050Z',
      'lastSampleAt', '2026-11-12T10:01:39.950Z',
      'samples', 41,
      'maxGapSeconds', 0.5,
      'unknownSeconds', 0.1,
      'edgeBeforeSeconds', 0.05,
      'edgeAfterSeconds', 0.05),
    'pitRoad', jsonb_build_object('value', true, 'firstAt', '2026-11-12T10:00:05.000Z'),
    'refuel', jsonb_build_object(
      'observedAddedLitres', 2.4,
      'firstAt', '2026-11-12T10:00:10.000Z',
      'positiveSteps', 2,
      'resolutionLitres', 0.01),
    'driverNameContinuity', jsonb_build_object('value', 'unchanged'),
    'context', jsonb_build_object(
      'carId', '1321',
      'trackId', 42,
      'trackName', 'Circuit de Spa-Francorchamps',
      'trackConfig', 'Endurance')
  )
$fn$;

CREATE FUNCTION pg_temp.lap(p_uid uuid, p_lap integer, p_obs jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT jsonb_build_object(
    'summaryUid', p_uid,
    'summaryId', 'T13S1-RN-' || p_lap::text,
    'segmentId', 'segment-1',
    'observedSessionId', 'session-1',
    'lapNumber', p_lap,
    'startedAt', '2026-11-12T10:00:00.000Z',
    'endedAt', '2026-11-12T10:01:40.000Z',
    'currentDriverName', 'Test Driver',
    'aggregationVersion', 1,
    'recordRevision', 1,
    'complete', false,
    'pitLap', false,
    'driverChanged', false
  ) || case when p_obs is null then '{}'::jsonb
            else jsonb_build_object('observation', p_obs) end
$fn$;

CREATE FUNCTION pg_temp.apply_row(p_uid uuid, p_lap integer, p_obs jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT jsonb_build_object(
    'summary_uid', p_uid,
    'summary_id', 'T13S1-RN-DIRECT-' || p_lap::text,
    'device_id', pg_temp.dev_a()::text,
    'segment_id', 'segment-1',
    'observed_session_id', 'session-1',
    'delivered_session_id', 'session-1',
    'transport_session_id', 'session-1',
    'lap_number', p_lap,
    'started_at', '2026-11-12T10:00:00.000Z',
    'ended_at', '2026-11-12T10:01:40.000Z',
    'current_driver_name', 'Test Driver',
    'aggregation_version', 1,
    'record_revision', 1,
    'complete', false,
    'pit_lap', false,
    'driver_changed', false
  ) || case when p_obs is null then '{}'::jsonb
            else jsonb_build_object('observation', p_obs) end
$fn$;

SET request.jwt.claim.role = 'service_role';
UPDATE pitwall_learning.runtime_settings
   SET observation_enabled = true, capture_enabled = true
 WHERE id = 1;

-- Vanaf hier is de sessie ECHT service_role, niet postgres.
SET ROLE service_role;
DO $b2$
DECLARE
  v_result text;
  v_uid uuid;
  v_obs jsonb;
  v_hash text;
BEGIN
  -- B2a: de pure helperketen is uitvoerbaar zonder permission denied.
  PERFORM pg_temp.ok(public.simhub_observation_ts_le('2026-11-12T10:00:00.050Z',
                                                     '2026-11-12T10:00:00.0500001Z'),
                     'B2a ts_le helper executable');
  PERFORM pg_temp.ok(public.simhub_observation_ts_valid('2026-11-12T10:00:00.0500001Z'),
                     'B2b ts_valid helper executable');
  PERFORM pg_temp.ok(public.simhub_observation_text_valid('Spa', 8),
                     'B2c text_valid helper executable');
  PERFORM pg_temp.ok(public.simhub_observation_v1_valid(pg_temp.obs(pg_temp.dev_a()::text)),
                     'B2d validator executable and accepts valid');
  PERFORM pg_temp.ok(public.simhub_observation_row_disposition(
                       jsonb_build_object('observation', pg_temp.obs(pg_temp.dev_a()::text)),
                       pg_temp.dev_a()) = 'observation_accepted',
                     'B2e disposition executable and accepts');

  -- B2f: directe legacy-terugval werkt als service_role.
  v_uid := '9e000000-0000-4000-8000-000000000001';
  v_result := public.simhub_apply_lap_row(pg_temp.apply_row(v_uid, 61, null));
  PERFORM pg_temp.ok(v_result = 'accepted', 'B2f direct legacy fallback accepted');
  PERFORM pg_temp.ok((SELECT observation IS NULL AND content_hash = public.simhub_lap_row_hash(l)
                        FROM public.simhub_lap_summaries l WHERE summary_uid = v_uid),
                     'B2g direct legacy stored with NULL observation and v1 hash');

  -- B2h: directe observed-terugval werkt als service_role.
  v_uid := '9e000000-0000-4000-8000-000000000002';
  v_obs := pg_temp.obs(pg_temp.dev_a()::text);
  v_result := public.simhub_apply_lap_row(pg_temp.apply_row(v_uid, 62, v_obs));
  PERFORM pg_temp.ok(v_result = 'accepted', 'B2h direct observed fallback accepted');
  SELECT content_hash INTO v_hash FROM public.simhub_lap_summaries WHERE summary_uid = v_uid;
  PERFORM pg_temp.ok((SELECT observation = v_obs FROM public.simhub_lap_summaries
                       WHERE summary_uid = v_uid),
                     'B2i direct observed stored raw');
  PERFORM pg_temp.ok((SELECT content_hash = public.simhub_lap_row_hash_v2(l)
                        FROM public.simhub_lap_summaries l WHERE summary_uid = v_uid),
                     'B2j direct observed uses v2 hash');

  -- B2k: directe vreemde observation blijft geweigerd, zonder rij.
  v_uid := '9e000000-0000-4000-8000-000000000003';
  v_result := public.simhub_apply_lap_row(
    pg_temp.apply_row(v_uid, 63, pg_temp.obs(pg_temp.dev_b()::text)));
  PERFORM pg_temp.ok(v_result = 'rejected:observation_device_mismatch',
                     'B2k direct foreign observation rejected');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.simhub_lap_summaries
                                  WHERE summary_uid = v_uid),
                     'B2l direct foreign observation stored nothing');

  -- B2r-t: de directe terugval gebruikt dezelfde fail-closed poort.
  v_uid := '9e000000-0000-4000-8000-000000000004';
  v_result := public.simhub_apply_lap_row(
    pg_temp.apply_row(v_uid, 64, pg_temp.obs(pg_temp.dev_a()::text) - 'version'));
  PERFORM pg_temp.ok(v_result = 'rejected:observation_invalid',
                     'B2r direct missing-version observation rejected');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.simhub_lap_summaries
                                  WHERE summary_uid = v_uid),
                     'B2s direct missing-version stored nothing');
  v_uid := '9e000000-0000-4000-8000-000000000005';
  v_result := public.simhub_apply_lap_row(pg_temp.apply_row(v_uid, 65, 'null'::jsonb));
  PERFORM pg_temp.ok(v_result = 'rejected:observation_null',
                     'B2t direct explicit-null observation rejected');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.simhub_lap_summaries
                                  WHERE summary_uid = v_uid),
                     'B2u direct explicit-null stored nothing');

  -- B2m: catalogus-effectieve rechten op de HELE keten.
  PERFORM pg_temp.ok(
    (SELECT bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE'))
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('simhub_observation_ts_le', 'simhub_observation_ts_valid',
                          'simhub_observation_text_valid', 'simhub_observation_v1_valid',
                          'simhub_observation_row_disposition')),
    'B2m service_role may execute the entire helper chain');
  PERFORM pg_temp.ok(
    (SELECT bool_and(NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                 AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE'))
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('simhub_observation_ts_le', 'simhub_observation_ts_valid',
                          'simhub_observation_text_valid', 'simhub_observation_v1_valid',
                          'simhub_observation_row_disposition')),
    'B2n anon/authenticated denied on the entire helper chain');
  PERFORM pg_temp.ok(
    (SELECT bool_and(NOT EXISTS (
        SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
         WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('simhub_observation_ts_le', 'simhub_observation_ts_valid',
                          'simhub_observation_text_valid', 'simhub_observation_v1_valid',
                          'simhub_observation_row_disposition')),
    'B2o PUBLIC has no EXECUTE on the helper chain');
END
$b2$;

-- B3: elke verplichte sleutel, elk type, elke enum en expliciete null.
DO $b3$
DECLARE
  v_base jsonb := pg_temp.obs(pg_temp.dev_a()::text);
  v_case record;
  v_ok boolean;
  v_disp text;
BEGIN
  FOR v_case IN
    SELECT c->>'name' AS name, c->'value' AS value
      FROM jsonb_array_elements(jsonb_build_array(
      jsonb_build_object('name', 'missing_version', 'value', v_base - 'version'),
      jsonb_build_object('name', 'null_version', 'value', v_base || '{"version":null}'::jsonb),
      jsonb_build_object('name', 'wrongtype_version', 'value', v_base || '{"version":"1"}'::jsonb),
      jsonb_build_object('name', 'missing_capture', 'value', v_base - 'capture'),
      jsonb_build_object('name', 'missing_deviceid', 'value', v_base #- '{capture,deviceId}'),
      jsonb_build_object('name', 'null_deviceid', 'value', v_base || '{"capture":{"deviceId":null}}'::jsonb),
      jsonb_build_object('name', 'missing_interval', 'value', v_base - 'interval'),
      jsonb_build_object('name', 'missing_firstsample', 'value', v_base #- '{interval,firstSampleAt}'),
      jsonb_build_object('name', 'missing_lastsample', 'value', v_base #- '{interval,lastSampleAt}'),
      jsonb_build_object('name', 'missing_samples', 'value', v_base #- '{interval,samples}'),
      jsonb_build_object('name', 'wrongtype_samples', 'value',
                         jsonb_set(v_base, '{interval,samples}', '"41"'::jsonb)),
      jsonb_build_object('name', 'missing_maxgap', 'value', v_base #- '{interval,maxGapSeconds}'),
      jsonb_build_object('name', 'null_maxgap', 'value', jsonb_set(v_base, '{interval,maxGapSeconds}', 'null'::jsonb)),
      jsonb_build_object('name', 'missing_unknownseconds', 'value', v_base #- '{interval,unknownSeconds}'),
      jsonb_build_object('name', 'missing_edgebefore', 'value', v_base #- '{interval,edgeBeforeSeconds}'),
      jsonb_build_object('name', 'missing_edgeafter', 'value', v_base #- '{interval,edgeAfterSeconds}'),
      jsonb_build_object('name', 'missing_pitroad_value', 'value', v_base #- '{pitRoad,value}'),
      jsonb_build_object('name', 'null_pitroad_value', 'value', jsonb_set(v_base, '{pitRoad,value}', 'null'::jsonb)),
      jsonb_build_object('name', 'false_pitroad_value', 'value', jsonb_set(v_base, '{pitRoad,value}', 'false'::jsonb)),
      jsonb_build_object('name', 'missing_refuel_litres', 'value', v_base #- '{refuel,observedAddedLitres}'),
      jsonb_build_object('name', 'null_refuel_litres', 'value', jsonb_set(v_base, '{refuel,observedAddedLitres}', 'null'::jsonb)),
      jsonb_build_object('name', 'missing_refuel_firstat', 'value', v_base #- '{refuel,firstAt}'),
      jsonb_build_object('name', 'missing_refuel_steps', 'value', v_base #- '{refuel,positiveSteps}'),
      jsonb_build_object('name', 'zero_refuel_steps', 'value', jsonb_set(v_base, '{refuel,positiveSteps}', '0'::jsonb)),
      jsonb_build_object('name', 'missing_refuel_resolution', 'value', v_base #- '{refuel,resolutionLitres}'),
      jsonb_build_object('name', 'zero_refuel_resolution', 'value', jsonb_set(v_base, '{refuel,resolutionLitres}', '0'::jsonb)),
      jsonb_build_object('name', 'empty_dnc', 'value', v_base || '{"driverNameContinuity":{}}'::jsonb),
      jsonb_build_object('name', 'null_dnc_value', 'value', v_base || '{"driverNameContinuity":{"value":null}}'::jsonb),
      jsonb_build_object('name', 'wrong_enum_dnc', 'value', v_base || '{"driverNameContinuity":{"value":"bogus"}}'::jsonb),
      jsonb_build_object('name', 'empty_context', 'value', v_base || '{"context":{}}'::jsonb),
      jsonb_build_object('name', 'missing_trackid', 'value', v_base #- '{context,trackId}'),
      jsonb_build_object('name', 'null_trackid', 'value', jsonb_set(v_base, '{context,trackId}', 'null'::jsonb)),
      jsonb_build_object('name', 'wrongtype_trackid', 'value',
                         jsonb_set(v_base, '{context,trackId}', '"42"'::jsonb)),
      jsonb_build_object('name', 'missing_carid', 'value', v_base #- '{context,carId}'),
      jsonb_build_object('name', 'empty_carid', 'value', jsonb_set(v_base, '{context,carId}', '""'::jsonb)),
      jsonb_build_object('name', 'missing_trackname', 'value', v_base #- '{context,trackName}'),
      jsonb_build_object('name', 'missing_trackconfig', 'value', v_base #- '{context,trackConfig}'),
      jsonb_build_object('name', 'null_session_number', 'value',
                         jsonb_set(v_base, '{context,sessionNumber}', 'null'::jsonb)),
      jsonb_build_object('name', 'unknown_root_key', 'value', v_base || '{"ownerUserId":"x"}'::jsonb)
    )) AS c
  LOOP
    v_ok := public.simhub_observation_v1_valid(v_case.value);
    v_disp := public.simhub_observation_row_disposition(
      jsonb_build_object('observation', v_case.value), pg_temp.dev_a());
    PERFORM pg_temp.ok(v_ok IS FALSE, 'B3 ' || (v_case.name) || ' rejected by validator');
    PERFORM pg_temp.ok(v_disp = 'observation_invalid',
                       'B3 ' || (v_case.name) || ' rejected by disposition');
  END LOOP;
END
$b3$;

-- B3 mixed batch: alleen legacy en geldig observed mogen landen.
DO $mix$
DECLARE
  v_ack jsonb;
  v_bad text[] := ARRAY[
    '9e100000-0000-4000-8000-000000000002',
    '9e100000-0000-4000-8000-000000000004',
    '9e100000-0000-4000-8000-000000000005',
    '9e100000-0000-4000-8000-000000000006'];
BEGIN
  v_ack := public.simhub_persist_measurement_batch(
    pg_temp.dev_a(), 'session-role-null', NULL,
    jsonb_build_array(
      pg_temp.lap('9e100000-0000-4000-8000-000000000001', 71, null),
      pg_temp.lap('9e100000-0000-4000-8000-000000000002', 72,
                  pg_temp.obs(pg_temp.dev_a()::text) - 'version'),
      pg_temp.lap('9e100000-0000-4000-8000-000000000003', 73,
                  pg_temp.obs(pg_temp.dev_a()::text)),
      pg_temp.lap('9e100000-0000-4000-8000-000000000004', 74, 'null'::jsonb),
      pg_temp.lap('9e100000-0000-4000-8000-000000000005', 75,
                  pg_temp.obs(pg_temp.dev_a()::text) || '{"driverNameContinuity":{}}'::jsonb),
      pg_temp.lap('9e100000-0000-4000-8000-000000000006', 76,
                  (pg_temp.obs(pg_temp.dev_a()::text) #- '{context,trackId}') || '{"context":{"carId":"1321","trackName":"Spa","trackConfig":"Endurance"}}'::jsonb)));

  PERFORM pg_temp.ok(jsonb_array_length(v_ack #> '{laps,accepted}') = 2,
                     'B3 mixed batch accepts exactly legacy + valid observed');
  PERFORM pg_temp.ok(jsonb_array_length(v_ack #> '{laps,rejected}') = 4,
                     'B3 mixed batch rejects all four bad observed rows');
  PERFORM pg_temp.ok((SELECT count(*) = 2 FROM public.simhub_lap_summaries
                       WHERE summary_uid IN ('9e100000-0000-4000-8000-000000000001',
                                             '9e100000-0000-4000-8000-000000000003')),
                     'B3 only legacy + valid observed stored');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.simhub_lap_summaries
                                  WHERE summary_uid = ANY (v_bad::uuid[])),
                     'B3 no malformed observed row stored');
  PERFORM pg_temp.ok((SELECT observation IS NOT NULL AND
                             content_hash = public.simhub_lap_row_hash_v2(l)
                        FROM public.simhub_lap_summaries l
                       WHERE summary_uid = '9e100000-0000-4000-8000-000000000003'),
                     'B3 valid observed row keeps raw block and v2 hash');
  PERFORM pg_temp.ok((SELECT observation IS NULL AND content_hash = public.simhub_lap_row_hash(l)
                        FROM public.simhub_lap_summaries l
                       WHERE summary_uid = '9e100000-0000-4000-8000-000000000001'),
                     'B3 legacy row keeps NULL observation and v1 hash');
END
$mix$;

RESET ROLE;

-- P1 is een private schema; deze readback hoort bij de DB-eigenaar, niet bij
-- de service_role die de schrijver aanroept.
DO $p1$
BEGIN
  PERFORM pg_temp.ok(NOT EXISTS (
    SELECT 1
      FROM pitwall_learning.capture_batches b,
           jsonb_array_elements(b.payload) e
     WHERE b.source_kind = 'lap_summary'
       AND e->>'source_uid' IN (
         '9e100000-0000-4000-8000-000000000002',
         '9e100000-0000-4000-8000-000000000004',
         '9e100000-0000-4000-8000-000000000005',
         '9e100000-0000-4000-8000-000000000006')),
    'B3 no P1 capture item for a rejected observed row');
END
$p1$;

-- B2p/q: echte SET ROLE anon/authenticated worden geweigerd.
DO $neg$
BEGIN
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    PERFORM public.simhub_observation_row_disposition(
      jsonb_build_object('observation', pg_temp.obs(pg_temp.dev_a()::text)), pg_temp.dev_a());
    RAISE EXCEPTION 'FAIL: anon reached the disposition helper';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.ok(current_user = session_user, 'B2p RESET ROLE restored the session user');

  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.simhub_observation_v1_valid(pg_temp.obs(pg_temp.dev_a()::text));
    RAISE EXCEPTION 'FAIL: authenticated reached the validator';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.ok(current_user = session_user, 'B2q RESET ROLE restored the session user');
END
$neg$;
