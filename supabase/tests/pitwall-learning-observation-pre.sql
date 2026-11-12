-- ============================================================================
-- T13-S1 — pre-migratie bewijs (disposable DB)
--
-- Draait vóór de forward-migratie en legt drie dingen vast:
--   1. de kolom/functies bestaan nog niet (de echte uitgangssituatie);
--   2. de bestaande v1-hash van een vaste legacy-rij (bekende vector);
--   3. dat de oude schrijver een `observation`-rij ACCEPT en STIL STRIST — de
--      gap die deze package sluit.
--
-- Alleen synthetische data. De guard weigert elke andere database of route.
-- ============================================================================

DO $guard$
BEGIN
  IF current_database() <> 'pitwall_learning_p2_observation_s1'
     OR current_setting('data_directory') <> '/work/data' THEN
    RAISE EXCEPTION 'T13-S1 PRE: wrong database or data_directory';
  END IF;
  IF inet_server_addr() IS NOT NULL THEN
    RAISE EXCEPTION 'T13-S1 PRE: TCP connection is not allowed';
  END IF;
END
$guard$;

SET request.jwt.claim.role = 'service_role';

-- ---------------------------------------------------------------------------
-- 1. Uitgangssituatie
-- ---------------------------------------------------------------------------
DO $pre$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'simhub_lap_summaries'
       AND column_name = 'observation'
  ) THEN
    RAISE EXCEPTION 'PRE-1: observation column already exists';
  END IF;
  IF to_regprocedure('public.simhub_observation_v1_available()') IS NOT NULL
     OR to_regprocedure('public.simhub_lap_row_hash_v2(public.simhub_lap_summaries)') IS NOT NULL
     OR to_regprocedure('public.simhub_observation_row_disposition(jsonb,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'PRE-2: T13 helpers already exist';
  END IF;
  IF to_regprocedure('public.simhub_lap_row_hash(public.simhub_lap_summaries)') IS NULL
     OR to_regprocedure('public.simhub_persist_measurement_batch(uuid,text,jsonb,jsonb)') IS NULL
     OR to_regprocedure('public.simhub_persist_v3(text,text,bigint,timestamp with time zone,jsonb,text,jsonb,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'PRE-3: baseline writer missing';
  END IF;
  IF to_regclass('pitwall_learning.runtime_settings') IS NULL
     OR to_regclass('pitwall_learning.capture_batches') IS NULL THEN
    RAISE EXCEPTION 'PRE-4: P1 baseline missing';
  END IF;
  RAISE NOTICE 'PASS PRE-1 column and T13 helpers absent';
  RAISE NOTICE 'PASS PRE-2 baseline writer and P1 present';
END
$pre$;

-- ---------------------------------------------------------------------------
-- 2. Synthetische accounts en apparaten
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email, aud, role, is_sso_user) VALUES
  ('a0000000-0000-4000-8000-0000000000b1', 't13-owner@example.invalid',
   'authenticated', 'authenticated', false),
  ('a0000000-0000-4000-8000-0000000000b2', 't13-other@example.invalid',
   'authenticated', 'authenticated', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.simhub_devices (
  id, owner_user_id, token_hash, device_name, connector_id, device_status
) VALUES
  ('d0000000-0000-4000-8000-0000000000a1',
   'a0000000-0000-4000-8000-0000000000b1', repeat('a', 64),
   'T13-S1-A', 'T13-S1-A', 'active_unbound'),
  ('d0000000-0000-4000-8000-0000000000a2',
   'a0000000-0000-4000-8000-0000000000b2', repeat('b', 64),
   'T13-S1-B', 'T13-S1-B', 'active_unbound')
ON CONFLICT (id) DO NOTHING;

INSERT INTO pitwall_learning.account_policy (
  owner_user_id, capture_enabled, policy_version
) VALUES
  ('a0000000-0000-4000-8000-0000000000b1', true, 1),
  ('a0000000-0000-4000-8000-0000000000b2', true, 1)
ON CONFLICT (owner_user_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Bekende v1-hashvector: één vaste legacy-rij via de echte schrijver.
-- ---------------------------------------------------------------------------
DO $vector$
DECLARE
  v_row jsonb;
  v_ack jsonb;
BEGIN
  v_row := jsonb_build_array(jsonb_build_object(
    'summaryUid', '11111111-1111-4111-8111-111111111111',
    'summaryId', 'T13-V1',
    'segmentId', 'segment-1',
    'observedSessionId', 'session-1',
    'lapNumber', 1,
    'startedAt', '2026-11-12T10:00:00.000Z',
    'endedAt', '2026-11-12T10:01:40.000Z',
    'currentDriverName', 'Test Driver',
    'aggregationVersion', 1,
    'recordRevision', 1,
    'complete', false,
    'pitLap', false,
    'driverChanged', false
  ));
  v_ack := public.simhub_persist_measurement_batch(
    'd0000000-0000-4000-8000-0000000000a1', 'session-1', NULL, v_row);
  IF v_ack #>> '{laps,accepted,0,id}' IS DISTINCT FROM
     '11111111-1111-4111-8111-111111111111' THEN
    RAISE EXCEPTION 'PRE-5 legacy vector row not accepted: %', v_ack;
  END IF;

  INSERT INTO public.t13_test_vectors (label, hash, payload)
  SELECT 'v1-legacy-1', l.content_hash, to_jsonb(l) - 'id' - 'received_at'
    FROM public.simhub_lap_summaries l
   WHERE l.summary_uid = '11111111-1111-4111-8111-111111111111';
  RAISE NOTICE 'PASS PRE-3 legacy v1 vector stored: %',
    (SELECT hash FROM public.t13_test_vectors WHERE label = 'v1-legacy-1');
END
$vector$;

-- ---------------------------------------------------------------------------
-- 4. De oude schrijver accepteert en strippt een observation-rij.
-- ---------------------------------------------------------------------------
DO $strip$
DECLARE
  v_row jsonb;
  v_ack jsonb;
  v_hash text;
BEGIN
  v_row := jsonb_build_array(jsonb_build_object(
    'summaryUid', '12121212-1212-4212-8212-121212121212',
    'summaryId', 'T13-PRE-STRIP',
    'segmentId', 'segment-1',
    'observedSessionId', 'session-1',
    'lapNumber', 2,
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
        'trackName', 'Circuit de Spa-Francorchamps', 'trackConfig', 'Endurance')
    )
  ));
  v_ack := public.simhub_persist_measurement_batch(
    'd0000000-0000-4000-8000-0000000000a1', 'session-1', NULL, v_row);
  IF v_ack #>> '{laps,accepted,0,id}' IS DISTINCT FROM
     '12121212-1212-4212-8212-121212121212' THEN
    RAISE EXCEPTION 'PRE-6 old writer did not accept the observation row: %', v_ack;
  END IF;
  SELECT l.content_hash INTO v_hash
    FROM public.simhub_lap_summaries l
   WHERE l.summary_uid = '12121212-1212-4212-8212-121212121212';
  -- De hash is exact de v1-hash van dezelfde velden zonder observation: de rij
  -- is geaccepteerd en het blok is verdwenen. Dat is de gap.
  IF v_hash IS DISTINCT FROM public.simhub_lap_row_hash(
       (SELECT l FROM public.simhub_lap_summaries l
         WHERE l.summary_uid = '12121212-1212-4212-8212-121212121212')) THEN
    RAISE EXCEPTION 'PRE-6 hash is not the v1 hash';
  END IF;
  RAISE NOTICE 'PASS PRE-4 old writer accepted and silently stripped observation (gap reproduced)';

  DELETE FROM public.simhub_lap_summaries
   WHERE summary_uid = '12121212-1212-4212-8212-121212121212';
END
$strip$;
