-- ============================================================================
-- T13-S1 — post-rollback bewijs (disposable DB)
--
-- De rollback is een disable-amendment: kolom, constraints, functies en alle
-- historische rijen blijven bestaan; capture staat uit en de P1-projectie is
-- terug op de exacte P1-vorm.
-- ============================================================================

DO $guard$
BEGIN
  IF current_database() <> 'pitwall_learning_p2_observation_s1'
     OR current_setting('data_directory') <> '/work/data' THEN
    RAISE EXCEPTION 'T13-S1 POST: wrong database or data_directory';
  END IF;
  IF inet_server_addr() IS NOT NULL THEN
    RAISE EXCEPTION 'T13-S1 POST: TCP connection is not allowed';
  END IF;
END
$guard$;

SET request.jwt.claim.role = 'service_role';

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

DO $post$
DECLARE
  v_hist public.simhub_lap_summaries;
  v_ack jsonb;
  v_before bigint;
  v_legacy public.simhub_lap_summaries;
  v_item jsonb;
  v_batch jsonb;
BEGIN
  -- 1. Schema en historie zijn niet gedropt.
  PERFORM pg_temp.ok(
    (SELECT data_type FROM information_schema.columns
      WHERE table_schema='public' AND table_name='simhub_lap_summaries'
        AND column_name='observation') = 'jsonb',
    'R1 observation column retained after rollback');
  PERFORM pg_temp.ok(
    (SELECT count(*) FROM pg_constraint
      WHERE conrelid='public.simhub_lap_summaries'::regclass
        AND conname IN ('simhub_lap_summaries_observation_size',
                        'simhub_lap_summaries_observation_fence')) = 2,
    'R2 both observation constraints retained');

  SELECT * INTO v_hist FROM public.simhub_lap_summaries
   WHERE summary_uid = '44444444-4444-4444-8444-444444444444';
  PERFORM pg_temp.ok(v_hist.observation IS NOT NULL
    AND v_hist.record_revision = 2, 'R3 historical observation row retained');
  PERFORM pg_temp.ok(v_hist.content_hash = public.simhub_lap_row_hash_v2(v_hist),
    'R4 historical v2 hash retained and still correct');
  -- Vijf geaccepteerde observation-rijen uit de matrix (D, F, I en de twee
  -- concurrency-races); geen enkele is door de rollback verwijderd of gestript.
  PERFORM pg_temp.ok(
    (SELECT count(*) FROM public.simhub_lap_summaries WHERE observation IS NOT NULL) = 5,
    'R5 all accepted observed rows retained, none erased');
  PERFORM pg_temp.ok(
    (SELECT count(*) FROM pitwall_learning.capture_batches) > 0,
    'R6 P1 capture evidence retained');

  -- 2. Feature staat uit en de probe liegt niet.
  PERFORM pg_temp.ok(NOT public.simhub_observation_capture_enabled(),
    'R7 kill switch is FALSE after rollback');
  PERFORM pg_temp.ok(NOT public.simhub_observation_v1_available(),
    'R8 reader probe is FALSE after rollback');

  -- 3. Legacy write werkt exact als vóór T13-S1.
  v_before := (SELECT count(*) FROM public.simhub_lap_summaries);
  v_ack := public.simhub_persist_measurement_batch(
    'd0000000-0000-4000-8000-0000000000a1', 'session-1', NULL,
    jsonb_build_array(jsonb_build_object(
      'summaryUid', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'summaryId', 'T13-POST-LEGACY',
      'segmentId', 'segment-1',
      'observedSessionId', 'session-1',
      'lapNumber', 30,
      'startedAt', '2026-11-12T10:00:00.000Z',
      'endedAt', '2026-11-12T10:01:40.000Z',
      'currentDriverName', 'Test Driver',
      'aggregationVersion', 1,
      'recordRevision', 1,
      'complete', false,
      'pitLap', false,
      'driverChanged', false)));
  PERFORM pg_temp.ok(v_ack #>> '{laps,accepted,0,id}' =
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'R9 legacy row still accepted');
  SELECT * INTO v_legacy FROM public.simhub_lap_summaries
   WHERE summary_uid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  PERFORM pg_temp.ok(v_legacy.observation IS NULL, 'R10 legacy row has NULL observation');
  PERFORM pg_temp.ok(v_legacy.content_hash = public.simhub_lap_row_hash(v_legacy),
    'R11 legacy row still uses the untouched v1 hash');
  PERFORM pg_temp.ok(
    (SELECT count(*) FROM public.simhub_lap_summaries) = v_before + 1,
    'R12 exactly one legacy row added');

  -- 4. Observation wordt expliciet geweigerd, niet gestript.
  v_ack := public.simhub_persist_measurement_batch(
    'd0000000-0000-4000-8000-0000000000a1', 'session-1', NULL,
    jsonb_build_array(jsonb_build_object(
      'summaryUid', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'summaryId', 'T13-POST-OBS',
      'segmentId', 'segment-1',
      'observedSessionId', 'session-1',
      'lapNumber', 31,
      'startedAt', '2026-11-12T10:00:00.000Z',
      'endedAt', '2026-11-12T10:01:40.000Z',
      'currentDriverName', 'Test Driver',
      'aggregationVersion', 1,
      'recordRevision', 1,
      'complete', false,
      'pitLap', false,
      'driverChanged', false,
      'observation', jsonb_build_object(
        'version', 1,
        'capture', jsonb_build_object('deviceId', 'd0000000-0000-4000-8000-0000000000a1'),
        'interval', jsonb_build_object(
          'firstSampleAt', '2026-11-12T10:00:00.050Z',
          'lastSampleAt', '2026-11-12T10:01:39.950Z',
          'samples', 41, 'maxGapSeconds', 0.5, 'unknownSeconds', 0.1,
          'edgeBeforeSeconds', 0.05, 'edgeAfterSeconds', 0.05),
        'context', jsonb_build_object(
          'carId', '1321', 'trackId', 42,
          'trackName', 'Circuit de Spa-Francorchamps', 'trackConfig', 'Endurance'))
    )));
  PERFORM pg_temp.ok(v_ack #>> '{laps,rejected,0,reason}' = 'observation_unavailable',
    'R13 post-rollback observation row is explicitly refused');
  PERFORM pg_temp.ok(NOT EXISTS (
    SELECT 1 FROM public.simhub_lap_summaries
     WHERE summary_uid = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
    'R14 refused row left no measurement row');

  -- 5. P1-projectie is terug op de P1-vorm: geen observation-sleutel.
  PERFORM pg_temp.ok(
    (SELECT pg_get_functiondef(p.oid) FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='pitwall_learning'
       AND p.proname='capture_lap_summaries_insert') NOT LIKE '%''observation''%',
    'R15 P1 insert projection no longer projects observation');
  PERFORM pg_temp.ok(
    (SELECT pg_get_functiondef(p.oid) FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='pitwall_learning'
       AND p.proname='capture_lap_summaries_update') NOT LIKE '%''observation''%',
    'R16 P1 update projection no longer projects observation');

  UPDATE pitwall_learning.runtime_settings SET capture_enabled = true WHERE id = 1;
  PERFORM public.simhub_persist_measurement_batch(
    'd0000000-0000-4000-8000-0000000000a1', 'session-1', NULL,
    jsonb_build_array(jsonb_build_object(
      'summaryUid', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'summaryId', 'T13-POST-P1',
      'segmentId', 'segment-1',
      'observedSessionId', 'session-1',
      'lapNumber', 32,
      'startedAt', '2026-11-12T10:00:00.000Z',
      'endedAt', '2026-11-12T10:01:40.000Z',
      'currentDriverName', 'Test Driver',
      'aggregationVersion', 1,
      'recordRevision', 1,
      'complete', false,
      'pitLap', false,
      'driverChanged', false)));
  SELECT b.payload INTO v_batch
    FROM pitwall_learning.capture_batches b
   WHERE b.source_kind = 'lap_summary'
     AND b.payload @> jsonb_build_array(jsonb_build_object(
       'source_uid', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'))
   ORDER BY b.received_at DESC LIMIT 1;
  SELECT e INTO v_item FROM jsonb_array_elements(v_batch) e
   WHERE e->>'source_uid' = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  PERFORM pg_temp.ok(v_item IS NOT NULL AND NOT (v_item ? 'observation'),
    'R17 post-rollback legacy P1 payload has no observation key');

  DROP TABLE IF EXISTS public.t13_test_vectors;
END
$post$;
