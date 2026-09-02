-- Disposable verifier for the recovered PRE-PHASE-E baseline fixture.
\set ON_ERROR_STOP on
DO $$
DECLARE
  v_count integer;
  v_def text;
BEGIN
  IF current_database() NOT IN ('test_pre_phase_e_baseline', 'test_phase_f') THEN
    RAISE EXCEPTION 'ABORT: expected test_pre_phase_e_baseline or test_phase_f, got %', current_database();
  END IF;

  SELECT count(*) INTO v_count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname='endurance_telemetry_events' AND c.relkind='r';
  IF v_count <> 1 THEN RAISE EXCEPTION 'BR01 event table missing'; END IF;
  RAISE NOTICE 'BR01 PASS';

  SELECT count(*) INTO v_count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname='simhub_telemetry_latest' AND c.relkind='r';
  IF v_count <> 1 THEN RAISE EXCEPTION 'BR02 latest table missing'; END IF;
  RAISE NOTICE 'BR02 PASS';

  SELECT count(*) INTO v_count FROM information_schema.columns
   WHERE table_schema='public' AND table_name='endurance_telemetry_events';
  IF v_count <> 26 THEN RAISE EXCEPTION 'BR03 event columns expected 26 got %', v_count; END IF;
  RAISE NOTICE 'BR03 PASS';

  SELECT count(*) INTO v_count FROM information_schema.columns
   WHERE table_schema='public' AND table_name='simhub_telemetry_latest';
  IF v_count <> 21 THEN RAISE EXCEPTION 'BR04 latest columns expected 21 got %', v_count; END IF;
  RAISE NOTICE 'BR04 PASS';

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='endurance_telemetry_events_pkey' AND contype='p' AND pg_get_constraintdef(oid)='PRIMARY KEY (id)') THEN
    RAISE EXCEPTION 'BR05 event PK mismatch'; END IF;
  RAISE NOTICE 'BR05 PASS';

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='simhub_telemetry_latest_pkey' AND contype='p' AND pg_get_constraintdef(oid)='PRIMARY KEY (device_id)') THEN
    RAISE EXCEPTION 'BR06 latest PK mismatch'; END IF;
  RAISE NOTICE 'BR06 PASS';

  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='endurance_telemetry_events_key_uniq'
    AND indexdef ILIKE '%(device_id, session_id, event_key)%') THEN RAISE EXCEPTION 'BR07 event unique mismatch'; END IF;
  RAISE NOTICE 'BR07 PASS';

  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint WHERE conname='endurance_telemetry_events_event_type_check';
  IF v_def IS NULL OR NOT (v_def LIKE '%sample%' AND v_def LIKE '%lap_completed%' AND v_def LIKE '%pit_entry%' AND v_def LIKE '%pit_exit%' AND v_def LIKE '%fuel_added%' AND v_def LIKE '%driver_change%' AND v_def LIKE '%stint_start%' AND v_def LIKE '%stint_end%' AND v_def LIKE '%flag_change%' AND v_def LIKE '%car_state_change%') THEN
    RAISE EXCEPTION 'BR08 event type check mismatch: %', v_def; END IF;
  RAISE NOTICE 'BR08 PASS';

  SELECT count(*) INTO v_count FROM pg_constraint WHERE conrelid='public.endurance_telemetry_events'::regclass AND contype='f';
  IF v_count <> 3 THEN RAISE EXCEPTION 'BR09 event FKs expected 3 got %', v_count; END IF;
  RAISE NOTICE 'BR09 PASS';

  SELECT count(*) INTO v_count FROM pg_constraint WHERE conrelid='public.simhub_telemetry_latest'::regclass AND contype='f';
  IF v_count <> 4 THEN RAISE EXCEPTION 'BR10 latest FKs expected 4 got %', v_count; END IF;
  SELECT count(*) INTO v_count FROM pg_constraint WHERE conrelid='public.simhub_telemetry_latest'::regclass AND contype='c';
  IF v_count <> 7 THEN RAISE EXCEPTION 'BR10 latest checks expected 7 got %', v_count; END IF;
  RAISE NOTICE 'BR10 PASS';

  SELECT count(*) INTO v_count FROM pg_indexes WHERE schemaname='public' AND tablename='endurance_telemetry_events';
  IF v_count <> 4 THEN RAISE EXCEPTION 'BR11 event indexes expected 4 got %', v_count; END IF;
  RAISE NOTICE 'BR11 PASS';

  SELECT count(*) INTO v_count FROM pg_indexes WHERE schemaname='public' AND tablename='simhub_telemetry_latest';
  IF v_count <> 2 THEN RAISE EXCEPTION 'BR12 latest indexes expected 2 got %', v_count; END IF;
  RAISE NOTICE 'BR12 PASS';

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.endurance_telemetry_events'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.simhub_telemetry_latest'::regclass) THEN RAISE EXCEPTION 'BR13 RLS disabled'; END IF;
  RAISE NOTICE 'BR13 PASS';

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='endurance_telemetry_events' AND policyname='staff read full endurance telemetry events' AND cmd='SELECT')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='simhub_telemetry_latest' AND policyname='Staff can read active latest SimHub telemetry' AND cmd='SELECT') THEN RAISE EXCEPTION 'BR14 policy mismatch'; END IF;
  RAISE NOTICE 'BR14 PASS';

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='simhub_telemetry_latest' AND column_name IN ('race_run_id','v3_normalized')) THEN RAISE EXCEPTION 'BR15/BR16 candidate columns must be absent'; END IF;
  RAISE NOTICE 'BR15 PASS'; RAISE NOTICE 'BR16 PASS';

  IF to_regprocedure('public.simhub_persist_v3(jsonb)') IS NOT NULL THEN RAISE EXCEPTION 'BR17 Phase E RPC exists'; END IF;
  RAISE NOTICE 'BR17 PASS';
  IF to_regclass('public.endurance_source_segments') IS NOT NULL THEN RAISE EXCEPTION 'BR18 Phase E source segment table exists'; END IF;
  RAISE NOTICE 'BR18 PASS';

  IF (SELECT relreplident FROM pg_class WHERE oid='public.simhub_telemetry_latest'::regclass) <> 'f' THEN RAISE EXCEPTION 'BR19 latest replica identity is not FULL'; END IF;
  RAISE NOTICE 'BR19 PASS';

  IF ARRAY(SELECT column_name || ':' || udt_name || ':' || is_nullable || ':' || COALESCE(column_default,'')
           FROM information_schema.columns WHERE table_schema='public' AND table_name='endurance_telemetry_events' ORDER BY ordinal_position)
     <> ARRAY['id:uuid:NO:gen_random_uuid()', 'device_id:uuid:NO:', 'event_id:uuid:NO:', 'team_id:uuid:NO:', 'session_id:text:NO:', 'event_type:text:NO:', 'event_key:text:NO:', 'sequence:int8:NO:', 'captured_at:timestamptz:NO:', 'received_at:timestamptz:NO:clock_timestamp()', 'lap:int4:YES:', 'completed_laps:int4:YES:', 'driver_id:text:YES:', 'stint_elapsed_s:numeric:YES:', 'session_time_s:numeric:YES:', 'fuel_litres:numeric:YES:', 'fuel_per_lap_litres:numeric:YES:', 'fuel_added_est_litres:numeric:YES:', 'laps_remaining_est:numeric:YES:', 'lap_time_from_deltas_s:numeric:YES:', 'in_pit_lane:bool:YES:', 'incidents:int4:YES:', 'flag:text:YES:', 'is_in_car:bool:YES:', 'event_detection_source:text:NO:', 'payload:jsonb:YES:'] THEN
    RAISE EXCEPTION 'BR20 event exact column contract mismatch'; END IF;
  IF ARRAY(SELECT column_name || ':' || udt_name || ':' || is_nullable || ':' || COALESCE(column_default,'')
           FROM information_schema.columns WHERE table_schema='public' AND table_name='simhub_telemetry_latest' ORDER BY ordinal_position)
     <> ARRAY['device_id:uuid:NO:', 'owner_user_id:uuid:NO:', 'race_id:uuid:YES:', 'team_id:uuid:YES:', 'session_id:text:NO:', 'sequence:int8:NO:', 'captured_at:timestamptz:NO:', 'received_at:timestamptz:NO:now()', 'connector_id:text:NO:', 'simhub_version:text:NO:', 'game:text:NO:', 'telemetry:jsonb:NO:', 'endurance_event_id:uuid:YES:', 'endurance_team_id:uuid:YES:', 'driver_id:text:YES:', 'current_driver_id:text:YES:', 'current_driver_name:text:YES:', 'car_id:text:YES:', 'car_name:text:YES:', 'track_name:text:YES:', 'track_config:text:YES:'] THEN
    RAISE EXCEPTION 'BR20 latest exact column contract mismatch'; END IF;
  RAISE NOTICE 'BR20 PASS';

  IF NOT has_table_privilege('authenticated', 'public.endurance_telemetry_events', 'SELECT,INSERT,UPDATE,DELETE')
     OR NOT has_table_privilege('service_role', 'public.endurance_telemetry_events', 'SELECT,INSERT,UPDATE,DELETE')
     OR NOT has_table_privilege('authenticated', 'public.simhub_telemetry_latest', 'SELECT')
     OR has_table_privilege('authenticated', 'public.simhub_telemetry_latest', 'INSERT')
     OR has_table_privilege('anon', 'public.endurance_telemetry_events', 'SELECT')
     OR has_table_privilege('anon', 'public.simhub_telemetry_latest', 'SELECT') THEN
    RAISE EXCEPTION 'BR21 recovered grant contract mismatch'; END IF;
  RAISE NOTICE 'BR21 PASS';
END $$;
