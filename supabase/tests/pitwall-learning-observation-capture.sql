-- ============================================================================
-- T13-S1 — acceptatiematrix op de disposable PostgreSQL 15.19-container
--
-- Draait NA de forward-migratie. Elke PASS-regel is een echte assertie; een
-- fout stopt de stream met ON_ERROR_STOP. Alleen synthetische data.
-- ============================================================================

DO $guard$
BEGIN
  IF current_database() <> 'pitwall_learning_p2_observation_s1'
     OR current_setting('data_directory') <> '/work/data' THEN
    RAISE EXCEPTION 'T13-S1 TEST: wrong database or data_directory';
  END IF;
  IF inet_server_addr() IS NOT NULL THEN
    RAISE EXCEPTION 'T13-S1 TEST: TCP connection is not allowed';
  END IF;
END
$guard$;

SET request.jwt.claim.role = 'service_role';

-- ---------------------------------------------------------------------------
-- Testhulpen (alleen deze sessie)
-- ---------------------------------------------------------------------------
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

-- Een volledig geldig blok; `p_device` staat als ruwe tekst in capture.deviceId.
CREATE FUNCTION pg_temp.obs(p_device text, p_patch jsonb DEFAULT '{}'::jsonb)
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
      'trackConfig', 'Endurance',
      'sessionUniqueId', 987654,
      'sessionNumber', 0)
  ) || coalesce(p_patch, '{}'::jsonb)
$fn$;

CREATE FUNCTION pg_temp.lap(
  p_uid uuid,
  p_lap integer,
  p_rev integer,
  p_extra jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT jsonb_build_object(
    'summaryUid', p_uid,
    'summaryId', 'T13-' || p_lap::text,
    'segmentId', 'segment-1',
    'observedSessionId', 'session-1',
    'lapNumber', p_lap,
    'startedAt', '2026-11-12T10:00:00.000Z',
    'endedAt', '2026-11-12T10:01:40.000Z',
    'currentDriverName', 'Test Driver',
    'aggregationVersion', 1,
    'recordRevision', p_rev,
    'complete', false,
    'pitLap', false,
    'driverChanged', false
  ) || coalesce(p_extra, '{}'::jsonb)
$fn$;

-- simhub_apply_lap_row leest snake_case kolomnamen (jsonb_populate_record).
CREATE FUNCTION pg_temp.apply_row(
  p_uid uuid,
  p_lap integer,
  p_rev integer,
  p_extra jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT jsonb_build_object(
    'summary_uid', p_uid,
    'summary_id', 'T13-DIRECT-' || p_lap::text,
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
    'record_revision', p_rev,
    'complete', false,
    'pit_lap', false,
    'driver_changed', false
  ) || coalesce(p_extra, '{}'::jsonb)
$fn$;

CREATE FUNCTION pg_temp.batch(p_laps jsonb)
RETURNS jsonb
LANGUAGE sql
AS $fn$
  SELECT public.simhub_persist_measurement_batch(pg_temp.dev_a(), 'session-1', NULL, p_laps)
$fn$;

CREATE FUNCTION pg_temp.lap_count() RETURNS bigint LANGUAGE sql AS
$$ SELECT count(*) FROM public.simhub_lap_summaries $$;

CREATE FUNCTION pg_temp.stored(p_uid uuid) RETURNS public.simhub_lap_summaries
LANGUAGE sql
AS $$ SELECT l FROM public.simhub_lap_summaries l WHERE l.summary_uid = p_uid $$;

-- ---------------------------------------------------------------------------
-- A. Object readback
-- ---------------------------------------------------------------------------
DO $a$
DECLARE
  v_cons integer;
BEGIN
  PERFORM pg_temp.ok(
    (SELECT data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'simhub_lap_summaries'
        AND column_name = 'observation') = 'jsonb',
    'A1 observation column is jsonb');
  PERFORM pg_temp.ok(
    (SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'simhub_lap_summaries'
        AND column_name = 'observation') = 'YES',
    'A2 observation is nullable');

  SELECT count(*) INTO v_cons FROM pg_constraint
   WHERE conrelid = 'public.simhub_lap_summaries'::regclass
     AND conname IN ('simhub_lap_summaries_observation_size',
                     'simhub_lap_summaries_observation_fence');
  PERFORM pg_temp.ok(v_cons = 2, 'A3 both observation constraints exist');

  PERFORM pg_temp.ok(
    NOT (SELECT observation_enabled FROM pitwall_learning.runtime_settings WHERE id = 1),
    'A4 kill switch defaults to FALSE');

  PERFORM pg_temp.ok(
    to_regprocedure('public.simhub_lap_row_hash_v2(public.simhub_lap_summaries)') IS NOT NULL
    AND to_regprocedure('public.simhub_observation_row_disposition(jsonb,uuid)') IS NOT NULL
    AND to_regprocedure('public.simhub_observation_v1_available()') IS NOT NULL
    AND to_regprocedure('public.simhub_observation_capture_enabled()') IS NOT NULL,
    'A5 hash v2, disposition, probe and flag helper exist');

  PERFORM pg_temp.ok(
    to_regprocedure('public.simhub_lap_row_hash(public.simhub_lap_summaries)') IS NOT NULL,
    'A6 v1 hash function still present');
END
$a$;

-- ---------------------------------------------------------------------------
-- B. Legacy: exact dezelfde v1-hash, geen observation-property
-- ---------------------------------------------------------------------------
DO $b$
DECLARE
  v_ack jsonb;
  v_row public.simhub_lap_summaries;
  v_expected text;
BEGIN
  v_expected := (SELECT hash FROM public.t13_test_vectors WHERE label = 'v1-legacy-1');
  PERFORM pg_temp.ok(v_expected = 'c4b83791d22eb561980e76bdb63bb657',
    'B1 frozen pre-migration vector is the known literal');

  v_ack := pg_temp.batch(jsonb_build_array(pg_temp.lap(
    '11111111-1111-4111-8111-111111111111', 1, 1)));
  PERFORM pg_temp.ok(v_ack #>> '{laps,duplicates,0,id}' =
    '11111111-1111-4111-8111-111111111111', 'B2 identical legacy retry is duplicate');
  PERFORM pg_temp.ok(
    (SELECT count(*) FROM jsonb_array_elements(v_ack->'laps'->'duplicates')) = 1,
    'B3 duplicate ACK is bounded and present');

  v_row := pg_temp.stored('11111111-1111-4111-8111-111111111111');
  PERFORM pg_temp.ok(v_row.observation IS NULL, 'B4 legacy row has NULL observation');
  PERFORM pg_temp.ok(v_row.content_hash = v_expected, 'B5 legacy hash unchanged after upgrade');
  PERFORM pg_temp.ok(v_row.content_hash = public.simhub_lap_row_hash(v_row),
    'B6 legacy hash still equals the v1 formula');
END
$b$;

-- ---------------------------------------------------------------------------
-- C. Feature OFF: observation row is refused, nothing stored, nothing captured
-- ---------------------------------------------------------------------------
DO $c$
DECLARE
  v_before bigint := pg_temp.lap_count();
  v_ack jsonb;
BEGIN
  v_ack := pg_temp.batch(jsonb_build_array(
    pg_temp.lap('22222222-2222-4222-8222-222222222222', 2, 1,
                jsonb_build_object('observation', pg_temp.obs(pg_temp.dev_a()::text)))));
  PERFORM pg_temp.ok(v_ack #>> '{laps,rejected,0,reason}' = 'observation_unavailable',
    'C1 flag off rejects the row with observation_unavailable');
  PERFORM pg_temp.ok((v_ack->'laps'->'accepted') = '[]'::jsonb,
    'C2 no accepted rows while off');
  PERFORM pg_temp.ok(pg_temp.lap_count() = v_before,
    'C3 no measurement row inserted while off');

  -- Mixed batch: legacy row survives next to the refused observed row.
  v_ack := pg_temp.batch(jsonb_build_array(
    pg_temp.lap('33333333-3333-4333-8333-333333333333', 3, 1),
    pg_temp.lap('22222222-2222-4222-8222-222222222222', 2, 1,
                jsonb_build_object('observation', pg_temp.obs(pg_temp.dev_a()::text)))));
  PERFORM pg_temp.ok(v_ack #>> '{laps,accepted,0,id}' =
    '33333333-3333-4333-8333-333333333333', 'C4 legacy neighbour still accepted');
  PERFORM pg_temp.ok(v_ack #>> '{laps,rejected,0,reason}' = 'observation_unavailable',
    'C5 observed row still explicitly refused');
  PERFORM pg_temp.ok((v_ack->'laps'->'block_error') IS NULL OR
    (v_ack->'laps'->'block_error') = 'null'::jsonb,
    'C6 the series itself is not failed');
END
$c$;

-- ---------------------------------------------------------------------------
-- D. Feature ON: accept, raw preservation, conditional v2 hash
-- ---------------------------------------------------------------------------
DO $d$
DECLARE
  v_obs jsonb;
  v_ack jsonb;
  v_row public.simhub_lap_summaries;
  v_v1 text;
BEGIN
  UPDATE pitwall_learning.runtime_settings
     SET observation_enabled = true, updated_at = now() WHERE id = 1;
  PERFORM pg_temp.ok(public.simhub_observation_capture_enabled(),
    'D1 capture switch can be enabled');

  v_obs := pg_temp.obs(upper(pg_temp.dev_a()::text));
  v_obs := jsonb_set(v_obs, '{interval,firstSampleAt}',
                     '"2026-11-12T10:00:00.0500001Z"');
  v_obs := jsonb_set(v_obs, '{interval,lastSampleAt}',
                     '"2026-11-12T10:01:39.9500001Z"');
  v_obs := jsonb_set(v_obs, '{refuel,observedAddedLitres}', '2.4000000000000004');
  v_obs := jsonb_set(v_obs, '{context,trackName}', '" Circuit de Spa "');

  v_ack := pg_temp.batch(jsonb_build_array(
    pg_temp.lap('44444444-4444-4444-8444-444444444444', 4, 1,
                jsonb_build_object('observation', v_obs))));
  PERFORM pg_temp.ok(v_ack #>> '{laps,accepted,0,id}' =
    '44444444-4444-4444-8444-444444444444', 'D2 observed row accepted');

  v_row := pg_temp.stored('44444444-4444-4444-8444-444444444444');
  PERFORM pg_temp.ok(v_row.observation IS NOT NULL, 'D3 observation column populated');
  PERFORM pg_temp.ok(v_row.observation #>> '{capture,deviceId}' = upper(pg_temp.dev_a()::text),
    'D4 UUID case preserved exactly');
  PERFORM pg_temp.ok(v_row.observation #>> '{interval,firstSampleAt}' =
    '2026-11-12T10:00:00.0500001Z', 'D5 7-digit timestamp preserved');
  PERFORM pg_temp.ok(v_row.observation #>> '{refuel,observedAddedLitres}' =
    '2.4000000000000004', 'D6 double precision preserved');
  PERFORM pg_temp.ok(v_row.observation #>> '{context,trackName}' = ' Circuit de Spa ',
    'D7 no trimming');
  PERFORM pg_temp.ok(NOT (v_row.observation ? 'ownerUserId')
    AND NOT (v_row.observation ? 'owner_user_id')
    AND NOT (v_row.observation ? 'driverId'),
    'D8 no owner/PII keys in the block');

  v_v1 := public.simhub_lap_row_hash(v_row);
  PERFORM pg_temp.ok(v_row.content_hash = public.simhub_lap_row_hash_v2(v_row),
    'D9 content hash is v2 for an observed row');
  PERFORM pg_temp.ok(v_row.content_hash IS DISTINCT FROM v_v1,
    'D10 v2 differs from v1 for the same row');
  PERFORM pg_temp.ok(
    v_row.content_hash ~ '^[0-9a-f]{32}$', 'D11 hash shape stays 32 hex');

  -- Exacte retry -> duplicate; andere observation bij dezelfde revisie -> conflict.
  v_ack := pg_temp.batch(jsonb_build_array(
    pg_temp.lap('44444444-4444-4444-8444-444444444444', 4, 1,
                jsonb_build_object('observation', v_obs))));
  PERFORM pg_temp.ok(
    (SELECT count(*) FROM jsonb_array_elements(v_ack->'laps'->'duplicates')) = 1,
    'D12 exact retry is duplicate, not conflict');

  v_ack := pg_temp.batch(jsonb_build_array(
    pg_temp.lap('44444444-4444-4444-8444-444444444444', 4, 1,
                jsonb_build_object('observation',
                  jsonb_set(v_obs, '{pitRoad,firstAt}', '"2026-11-12T10:00:06.000Z"')))));
  PERFORM pg_temp.ok(v_ack #>> '{laps,rejected,0,reason}' = 'revision_conflict',
    'D13 same revision with changed observation is revision_conflict');

  -- Hogere revisie met andere observation -> superseded, kolom bijgewerkt.
  v_ack := pg_temp.batch(jsonb_build_array(
    pg_temp.lap('44444444-4444-4444-8444-444444444444', 4, 2,
                jsonb_build_object('observation',
                  jsonb_set(v_obs, '{refuel,observedAddedLitres}', '3.1')))));
  PERFORM pg_temp.ok(
    (SELECT count(*) FROM jsonb_array_elements(v_ack->'laps'->'superseded')) = 1,
    'D14 higher revision supersedes');
  PERFORM pg_temp.ok(
    (pg_temp.stored('44444444-4444-4444-8444-444444444444')).observation
      #>> '{refuel,observedAddedLitres}' = '3.1',
    'D15 superseded row carries the new observation');
  PERFORM pg_temp.ok(
    (pg_temp.stored('44444444-4444-4444-8444-444444444444')).record_revision = 2,
    'D16 revision stored');

  -- Lagere revisie is stale en raakt de kolom niet.
  v_ack := pg_temp.batch(jsonb_build_array(
    pg_temp.lap('44444444-4444-4444-8444-444444444444', 4, 1,
                jsonb_build_object('observation',
                  jsonb_set(v_obs, '{refuel,observedAddedLitres}', '9.9')))));
  PERFORM pg_temp.ok(v_ack #>> '{laps,rejected,0,reason}' = 'stale_revision',
    'D17 lower revision is stale_revision');
  PERFORM pg_temp.ok(
    (pg_temp.stored('44444444-4444-4444-8444-444444444444')).observation
      #>> '{refuel,observedAddedLitres}' = '3.1',
    'D18 stale row never overwrites the stored observation');
END
$d$;

-- ---------------------------------------------------------------------------
-- E. Ongeldige blokken: rijafwijzing, nooit legacy, nooit opslag
-- ---------------------------------------------------------------------------
DO $e$
DECLARE
  v_before bigint := pg_temp.lap_count();
  v_ack jsonb;
  v_cases jsonb := '[]'::jsonb;
BEGIN
  -- null
  v_ack := pg_temp.batch(jsonb_build_array(
    pg_temp.lap('50000000-0000-4000-8000-000000000001', 5, 1,
                jsonb_build_object('observation', 'null'::jsonb))));
  PERFORM pg_temp.ok(v_ack #>> '{laps,rejected,0,reason}' = 'observation_null',
    'E1 explicit JSON null is observation_null');

  -- pitRoad:false
  v_ack := pg_temp.batch(jsonb_build_array(
    pg_temp.lap('50000000-0000-4000-8000-000000000002', 6, 1,
      jsonb_build_object('observation',
        jsonb_set(pg_temp.obs(pg_temp.dev_a()::text), '{pitRoad,value}', 'false')))));
  PERFORM pg_temp.ok(v_ack #>> '{laps,rejected,0,reason}' = 'observation_invalid',
    'E2 pitRoad:false is invalid, not a legacy row');

  -- refuel:0
  v_ack := pg_temp.batch(jsonb_build_array(
    pg_temp.lap('50000000-0000-4000-8000-000000000003', 7, 1,
      jsonb_build_object('observation',
        jsonb_set(pg_temp.obs(pg_temp.dev_a()::text), '{refuel,observedAddedLitres}', '0')))));
  PERFORM pg_temp.ok(v_ack #>> '{laps,rejected,0,reason}' = 'observation_invalid',
    'E3 refuel:0 is invalid');

  -- unknown key
  v_ack := pg_temp.batch(jsonb_build_array(
    pg_temp.lap('50000000-0000-4000-8000-000000000004', 8, 1,
      jsonb_build_object('observation',
        pg_temp.obs(pg_temp.dev_a()::text, '{"ownerUserId":"x"}'::jsonb)))));
  PERFORM pg_temp.ok(v_ack #>> '{laps,rejected,0,reason}' = 'observation_invalid',
    'E4 unknown/owner key is invalid');

  -- bad UUID
  v_ack := pg_temp.batch(jsonb_build_array(
    pg_temp.lap('50000000-0000-4000-8000-000000000005', 9, 1,
      jsonb_build_object('observation', pg_temp.obs('not-a-uuid')))));
  PERFORM pg_temp.ok(v_ack #>> '{laps,rejected,0,reason}' = 'observation_invalid',
    'E5 bad device UUID is invalid');

  -- samples 0 / bad timestamp / inverted interval
  v_ack := pg_temp.batch(jsonb_build_array(
    pg_temp.lap('50000000-0000-4000-8000-000000000006', 10, 1,
      jsonb_build_object('observation',
        jsonb_set(pg_temp.obs(pg_temp.dev_a()::text), '{interval,samples}', '0')))));
  PERFORM pg_temp.ok(v_ack #>> '{laps,rejected,0,reason}' = 'observation_invalid',
    'E6 samples 0 is invalid');
  v_ack := pg_temp.batch(jsonb_build_array(
    pg_temp.lap('50000000-0000-4000-8000-000000000007', 11, 1,
      jsonb_build_object('observation',
        jsonb_set(pg_temp.obs(pg_temp.dev_a()::text), '{interval,firstSampleAt}',
                  '"2026-02-30T10:00:00.000Z"')))));
  PERFORM pg_temp.ok(v_ack #>> '{laps,rejected,0,reason}' = 'observation_invalid',
    'E7 impossible calendar date is invalid');
  v_ack := pg_temp.batch(jsonb_build_array(
    pg_temp.lap('50000000-0000-4000-8000-000000000008', 12, 1,
      jsonb_build_object('observation',
        jsonb_set(pg_temp.obs(pg_temp.dev_a()::text), '{interval,firstSampleAt}',
                  '"2026-11-12T10:02:00.000Z"')))));
  PERFORM pg_temp.ok(v_ack #>> '{laps,rejected,0,reason}' = 'observation_invalid',
    'E8 first after last is invalid');

  PERFORM pg_temp.ok(pg_temp.lap_count() = v_before,
    'E9 no invalid observation row was stored');
END
$e$;

-- ---------------------------------------------------------------------------
-- F. Device-mismatch: hele meetrij weg, andere rijen door
-- ---------------------------------------------------------------------------
DO $f$
DECLARE
  v_before bigint := pg_temp.lap_count();
  v_ack jsonb;
BEGIN
  v_ack := pg_temp.batch(jsonb_build_array(
    pg_temp.lap('60000000-0000-4000-8000-000000000001', 13, 1,
      jsonb_build_object('observation', pg_temp.obs(pg_temp.dev_b()::text))),
    pg_temp.lap('60000000-0000-4000-8000-000000000002', 14, 1,
      jsonb_build_object('observation', pg_temp.obs(pg_temp.dev_a()::text)))));

  PERFORM pg_temp.ok(v_ack #>> '{laps,rejected,0,reason}' = 'observation_device_mismatch',
    'F1 foreign capture.deviceId is a row-level mismatch');
  PERFORM pg_temp.ok(v_ack #>> '{laps,accepted,0,id}' =
    '60000000-0000-4000-8000-000000000002', 'F2 matching row in the same batch is accepted');
  PERFORM pg_temp.ok(pg_temp.lap_count() = v_before + 1,
    'F3 only one of the two rows was stored');
  PERFORM pg_temp.ok(
    NOT EXISTS (SELECT 1 FROM public.simhub_lap_summaries
                 WHERE summary_uid = '60000000-0000-4000-8000-000000000001'),
    'F4 foreign row has no measurement row at all');
  PERFORM pg_temp.ok((SELECT count(*) FROM jsonb_array_elements(v_ack->'laps'->'rejected')) = 1,
    'F5 exactly one bounded rejection');
END
$f$;

-- ---------------------------------------------------------------------------
-- G. Echte RPC-route simhub_persist_v3: device komt uit de tokenrij
-- ---------------------------------------------------------------------------
DO $g$
DECLARE
  v_before bigint := pg_temp.lap_count();
  v_result record;
BEGIN
  SELECT * INTO v_result FROM public.simhub_persist_v3(
    repeat('a', 64), 'v3-session', 1, '2026-11-12T10:00:00Z'::timestamptz,
    '{}'::jsonb, NULL, NULL,
    jsonb_build_array(
      pg_temp.lap('70000000-0000-4000-8000-000000000001', 15, 1,
        jsonb_build_object('observation', pg_temp.obs(pg_temp.dev_b()::text))),
      pg_temp.lap('70000000-0000-4000-8000-000000000002', 16, 1)));

  PERFORM pg_temp.ok(v_result.result = 'accepted', 'G1 v3 frame itself accepted');
  PERFORM pg_temp.ok(v_result.measurement_ack #>> '{laps,rejected,0,reason}' =
    'observation_device_mismatch', 'G2 v3 passes the token device, not the row');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.simhub_lap_summaries
                                  WHERE summary_uid = '70000000-0000-4000-8000-000000000001'),
    'G3 foreign observation row not inserted through the real RPC');
  PERFORM pg_temp.ok(pg_temp.lap_count() = v_before + 1,
    'G4 the healthy row in the same v3 frame was stored');
END
$g$;

-- ---------------------------------------------------------------------------
-- H. Directe rijfunctie en directe tabelwrite
-- ---------------------------------------------------------------------------
DO $h$
DECLARE
  v_before bigint := pg_temp.lap_count();
  v_result text;
  v_sqlstate text;
  v_constraint text;
  v_pad integer;
  v_obs jsonb;
BEGIN
  v_result := public.simhub_apply_lap_row(
    pg_temp.apply_row('80000000-0000-4000-8000-000000000001', 17, 1,
      jsonb_build_object('observation', pg_temp.obs(pg_temp.dev_b()::text))));
  PERFORM pg_temp.ok(v_result = 'rejected:observation_device_mismatch',
    'H1 direct apply_lap_row refuses the foreign row');
  PERFORM pg_temp.ok(pg_temp.lap_count() = v_before,
    'H2 direct apply_lap_row inserted nothing');

  -- Directe tabelwrite met vreemd device: de CHECK-fence weigert.
  BEGIN
    INSERT INTO public.simhub_lap_summaries (
      summary_uid, summary_id, device_id, lap_number, started_at, ended_at,
      aggregation_version, record_revision, content_hash, observation)
    VALUES ('80000000-0000-4000-8000-000000000002', 'direct', pg_temp.dev_a()::text,
            18, '2026-11-12T10:00:00Z', '2026-11-12T10:01:40Z', 1, 1,
            repeat('0', 32), pg_temp.obs(pg_temp.dev_b()::text));
    RAISE EXCEPTION 'H3 direct foreign insert was not blocked';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    PERFORM pg_temp.ok(v_constraint = 'simhub_lap_summaries_observation_fence',
      'H3 direct foreign insert blocked by the fence');
  END;

  -- Exacte jsonb-grens: zoek de padlengte waarbij pg_column_size = 4096.
  v_pad := 3000;
  LOOP
    v_obs := jsonb_build_object(
      'capture', jsonb_build_object('deviceId', pg_temp.dev_a()::text),
      'pad', repeat('x', v_pad));
    EXIT WHEN pg_column_size(v_obs) >= 4096 OR v_pad > 5000;
    v_pad := v_pad + 1;
  END LOOP;
  PERFORM pg_temp.ok(pg_column_size(v_obs) = 4096,
    'H4 constructed exactly 4096 jsonb bytes');

  INSERT INTO public.simhub_lap_summaries (
    summary_uid, summary_id, device_id, lap_number, started_at, ended_at,
    aggregation_version, record_revision, content_hash, observation)
  VALUES ('80000000-0000-4000-8000-000000000003', 'direct-4096', pg_temp.dev_a()::text,
          19, '2026-11-12T10:00:00Z', '2026-11-12T10:01:40Z', 1, 1,
          repeat('0', 32), v_obs);
  -- jsonb is TOASTbaar: de opgeslagen waarde kan gecomprimeerd zijn. De CHECK
  -- ziet de onverpakte insertwaarde (hierboven exact 4096); de readback bewijst
  -- dat de waarde ongewijzigd terugkomt en binnen de grens blijft.
  PERFORM pg_temp.ok(
    (SELECT observation FROM public.simhub_lap_summaries
      WHERE summary_uid = '80000000-0000-4000-8000-000000000003') = v_obs,
    'H5 4096-byte observation round-trips without loss');
  PERFORM pg_temp.ok(
    (SELECT pg_column_size(observation) FROM public.simhub_lap_summaries
      WHERE summary_uid = '80000000-0000-4000-8000-000000000003') <= 4096,
    'H5b stored observation stays within the DB bound');

  -- jsonb-stringlengtes zijn 4-byte uitgelijnd: één teken meer kan dezelfde
  -- pg_column_size houden. Blijf ophogen tot de drempel echt overschreden is.
  LOOP
    v_pad := v_pad + 1;
    v_obs := jsonb_build_object(
      'capture', jsonb_build_object('deviceId', pg_temp.dev_a()::text),
      'pad', repeat('x', v_pad));
    EXIT WHEN pg_column_size(v_obs) > 4096 OR v_pad > 6000;
  END LOOP;
  PERFORM pg_temp.ok(pg_column_size(v_obs) > 4096,
    'H6a constructed a value above the DB bound');
  BEGIN
    INSERT INTO public.simhub_lap_summaries (
      summary_uid, summary_id, device_id, lap_number, started_at, ended_at,
      aggregation_version, record_revision, content_hash, observation)
    VALUES ('80000000-0000-4000-8000-000000000004', 'direct-over', pg_temp.dev_a()::text,
            20, '2026-11-12T10:00:00Z', '2026-11-12T10:01:40Z', 1, 1,
            repeat('0', 32), v_obs);
    RAISE EXCEPTION 'H6 an oversized observation was not blocked';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    PERFORM pg_temp.ok(v_constraint = 'simhub_lap_summaries_observation_size',
      'H6 4097-byte observation blocked by the size bound');
  END;

  DELETE FROM public.simhub_lap_summaries
   WHERE summary_uid IN ('80000000-0000-4000-8000-000000000003');
END
$h$;

-- ---------------------------------------------------------------------------
-- I. P1-projectie: alleen de ruwe observation, geen owner, hash = rijhash
-- ---------------------------------------------------------------------------
DO $i$
DECLARE
  v_batch jsonb;
  v_item jsonb;
  v_hash text;
BEGIN
  UPDATE pitwall_learning.runtime_settings SET capture_enabled = true WHERE id = 1;

  PERFORM pg_temp.batch(jsonb_build_array(
    pg_temp.lap('90000000-0000-4000-8000-000000000001', 21, 1,
      jsonb_build_object('observation', pg_temp.obs(pg_temp.dev_a()::text))),
    pg_temp.lap('90000000-0000-4000-8000-000000000002', 22, 1)));

  SELECT b.payload INTO v_batch
    FROM pitwall_learning.capture_batches b
   WHERE b.source_kind = 'lap_summary'
     AND b.payload @> jsonb_build_array(jsonb_build_object(
       'source_uid', '90000000-0000-4000-8000-000000000001'))
   ORDER BY b.received_at DESC
   LIMIT 1;

  PERFORM pg_temp.ok(v_batch IS NOT NULL, 'I1 P1 captured the lap statement');
  SELECT e INTO v_item
    FROM jsonb_array_elements(v_batch) e
   WHERE e->>'source_uid' = '90000000-0000-4000-8000-000000000001';
  -- Het P1-item is {device_id, source_uid, ..., payload}; de meetvelden horen
  -- in `payload`, niet op de item-root.
  PERFORM pg_temp.ok(v_item->'payload' ? 'observation',
    'I2 observed row carries observation in P1');
  PERFORM pg_temp.ok(v_item #>> '{payload,observation,capture,deviceId}' = pg_temp.dev_a()::text,
    'I3 P1 keeps the validated raw device string');

  PERFORM pg_temp.ok(NOT (v_item ? 'owner_user_id') AND NOT (v_item ? 'ownerUserId')
    AND NOT (v_item->'payload' ? 'owner_user_id')
    AND NOT (v_item->'payload' ? 'current_driver_name'),
    'I4 P1 item has no owner or driver name');

  SELECT l.content_hash INTO v_hash
    FROM public.simhub_lap_summaries l
   WHERE l.summary_uid = '90000000-0000-4000-8000-000000000001';
  PERFORM pg_temp.ok(v_item->>'content_hash' = v_hash,
    'I5 P1 content_hash equals the stored v2 row hash');

  SELECT e INTO v_item
    FROM jsonb_array_elements(v_batch) e
   WHERE e->>'source_uid' = '90000000-0000-4000-8000-000000000002';
  PERFORM pg_temp.ok(NOT (v_item->'payload' ? 'observation'),
    'I6 legacy item has no observation key at all (byte-stable)');

  -- De P1-payload past ruim binnen het bestaande 16 KiB-itembudget.
  PERFORM pg_temp.ok(pg_column_size(v_batch) < 16384,
    'I7 statement payload stays inside the existing P1 item budget');

  UPDATE pitwall_learning.runtime_settings SET worker_enabled = true WHERE id = 1;
END
$i$;

CREATE TEMP TABLE t13_claimed AS
  SELECT pitwall_learning.claim_jobs(20, 60) AS jobs;

CREATE TEMP TABLE t13_job AS
  SELECT (j->>'job_id')::uuid AS job_id,
         (j->>'lease_token')::uuid AS lease_token
    FROM jsonb_array_elements((SELECT jobs FROM t13_claimed LIMIT 1)) j
   WHERE j->>'kind' = 'materialize_capture_batch';

DO $i2$
DECLARE
  v_job record;
  v_outcome jsonb;
  v_rev pitwall_learning.source_revisions%ROWTYPE;
  v_stored public.simhub_lap_summaries;
BEGIN
  PERFORM pg_temp.ok((SELECT count(*) FROM t13_job) > 0,
    'I8 materialize job claimable');
  SELECT * INTO v_job FROM t13_job LIMIT 1;
  v_outcome := pitwall_learning.materialize_capture_batch(v_job.job_id, v_job.lease_token);
  PERFORM pg_temp.ok((v_outcome->>'ok')::boolean IS TRUE,
    'I9 materialization completed');

  SELECT * INTO v_stored FROM public.simhub_lap_summaries
   WHERE summary_uid = '90000000-0000-4000-8000-000000000001';
  SELECT * INTO v_rev FROM pitwall_learning.source_revisions
   WHERE source_kind = 'lap_summary'
     AND source_uid = '90000000-0000-4000-8000-000000000001'
     AND record_revision = 1;

  PERFORM pg_temp.ok(v_rev.id IS NOT NULL, 'I10 source revision materialized');
  PERFORM pg_temp.ok(v_rev.content_hash = v_stored.content_hash,
    'I11 P1 revision takes the server v2 hash, no reserialization');
  PERFORM pg_temp.ok(v_rev.payload->'observation' = v_stored.observation,
    'I12 P1 payload observation is byte-equal to the stored block');
  PERFORM pg_temp.ok(v_rev.owner_user_id = 'a0000000-0000-4000-8000-0000000000b1'
    AND v_rev.owner_basis = 'device_owner_at_receipt',
    'I13 owner comes from the receipt device, separately from payload');
  PERFORM pg_temp.ok(NOT (v_rev.payload ? 'owner_user_id')
    AND NOT (v_rev.payload ? 'ownerUserId'),
    'I14 no owner id inside the P1 payload');
END
$i2$;

-- ---------------------------------------------------------------------------
-- J. ACL: geen rechten voor anon/authenticated
-- ---------------------------------------------------------------------------
DO $j$
BEGIN
  PERFORM pg_temp.ok(NOT has_function_privilege('anon',
    'public.simhub_observation_v1_available()', 'EXECUTE'), 'J1 anon cannot probe');
  PERFORM pg_temp.ok(NOT has_function_privilege('authenticated',
    'public.simhub_observation_v1_available()', 'EXECUTE'), 'J2 authenticated cannot probe');
  PERFORM pg_temp.ok(NOT has_function_privilege('anon',
    'public.simhub_observation_capture_enabled()', 'EXECUTE'), 'J3 anon cannot read the switch');
  PERFORM pg_temp.ok(NOT has_function_privilege('authenticated',
    'public.simhub_persist_measurement_batch(uuid,text,jsonb,jsonb)', 'EXECUTE'),
    'J4 authenticated cannot write measurements');
  PERFORM pg_temp.ok(has_function_privilege('service_role',
    'public.simhub_persist_measurement_batch(uuid,text,jsonb,jsonb)', 'EXECUTE'),
    'J5 service_role keeps the writer');
  PERFORM pg_temp.ok(has_function_privilege('service_role',
    'public.simhub_observation_v1_available()', 'EXECUTE'), 'J6 service_role may probe');
  PERFORM pg_temp.ok(NOT has_function_privilege('anon',
    'public.simhub_observation_v1_valid(jsonb)', 'EXECUTE'), 'J7 anon cannot call the validator');
  PERFORM pg_temp.ok(
    (SELECT bool_and(p.prosecdef)
        AND bool_and(array_to_string(p.proconfig, ',') LIKE '%search_path=%')
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('simhub_observation_capture_enabled',
                          'simhub_observation_v1_available')),
    'J8 SECURITY DEFINER helpers pin search_path');
END
$j$;
