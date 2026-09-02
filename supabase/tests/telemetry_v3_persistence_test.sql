-- ============================================================================
-- Telemetry V3 Phase E — disposable DB test matrix.
--   * Applies AFTER: pre_phase_e_telemetry_production_baseline.sql (authoritative
--     pre-Phase-E fixture) AND a minimal Phase B endurance_race_runs stub AND the
--     Phase E forward migration 20260902190000_endurance_v3_persistence.sql.
--   * Runs entirely inside a transaction and rolls itself back (discards test rows).
--   * The same-role writes below run as service_role (BYPASSRLS in Supabase and in
--     this disposable instance) exactly as the V3 Edge's service client does.
--   * Rollback + retained-base-object checks live in the runner script.
-- ============================================================================
\set ON_ERROR_STOP on
DO $$
BEGIN
  IF current_database() NOT IN ('test_pre_phase_e_baseline', 'phase_e_test') THEN
    RAISE EXCEPTION 'ABORT: phase-e persistence test forbidden on %', current_database();
  END IF;
END $$;

BEGIN;

-- Fix parent stubs created by the fixture.
INSERT INTO auth.users (id) VALUES ('00000000-0000-0000-0000-0000000000a1') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.simhub_devices (id) VALUES ('d0d0d0d0-0000-0000-0000-0000000000a1') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.endurance_events (id) VALUES ('e0e0e0e0-0000-0000-0000-0000000000a1') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.endurance_teams (id) VALUES ('f00f0000-0000-0000-0000-0000000000a1') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.races (id) VALUES ('b00b0000-0000-0000-0000-0000000000a1') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.teams (id) VALUES ('c00c0000-0000-0000-0000-0000000000a1') ON CONFLICT (id) DO NOTHING;
UPDATE public.simhub_devices SET token_hash=repeat('a',64), owner_user_id='00000000-0000-0000-0000-0000000000a1', endurance_event_id='e0e0e0e0-0000-0000-0000-0000000000a1', endurance_team_id='f00f0000-0000-0000-0000-0000000000a1', device_status='active_binding', device_role='primary', connector_id='test', device_name='test' WHERE id='d0d0d0d0-0000-0000-0000-0000000000a1';
INSERT INTO public.endurance_registrations(event_id,user_id,status) VALUES ('e0e0e0e0-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a1','accepted');
INSERT INTO public.endurance_race_runs (id,event_id,team_id,run_kind,status) VALUES ('a5a5a5a5-0000-0000-0000-0000000000a1','e0e0e0e0-0000-0000-0000-0000000000a1','f00f0000-0000-0000-0000-0000000000a1','race','active') ON CONFLICT (id) DO NOTHING;

SET LOCAL role service_role;
SET LOCAL request.jwt.claim.role = 'service_role';

DO $$
DECLARE
  v_count INTEGER;
  v_cols TEXT;
  v_check TEXT;
  v_row RECORD;
  v_bad BOOLEAN := false;
  v_device UUID := 'd0d0d0d0-0000-0000-0000-0000000000a1';
  v_event UUID := 'e0e0e0e0-0000-0000-0000-0000000000a1';
  v_team UUID := 'f00f0000-0000-0000-0000-0000000000a1';
  v_run  UUID := 'a5a5a5a5-0000-0000-0000-0000000000a1';
  v_owner UUID := '00000000-0000-0000-0000-0000000000a1';
BEGIN

  -- ===== Structural assertions: Phase E columns present =====================
  SELECT string_agg(column_name, ',' ORDER BY column_name) INTO v_cols
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='endurance_telemetry_events'
     AND column_name IN ('race_run_id');
  IF v_cols IS DISTINCT FROM 'race_run_id' THEN
    RAISE EXCEPTION 'P01 events.race_run_id missing; got %', v_cols;
  END IF;

  SELECT string_agg(column_name, ',' ORDER BY column_name) INTO v_cols
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='simhub_telemetry_latest'
     AND column_name IN ('race_run_id','v3_normalized');
  IF v_cols IS DISTINCT FROM 'race_run_id,v3_normalized' THEN
    RAISE EXCEPTION 'P02 latest race_run_id/v3_normalized missing; got %', v_cols;
  END IF;

  -- ===== Structural assertions: check constraint extended additively ========
  SELECT pg_get_constraintdef(oid) INTO v_check
    FROM pg_constraint
   WHERE conname = 'endurance_telemetry_events_event_type_check';
  IF v_check IS NULL THEN RAISE EXCEPTION 'P03 event_type check missing'; END IF;
  IF v_check NOT LIKE '%incident_count_changed%' THEN RAISE EXCEPTION 'P03 check lacks incident_count_changed'; END IF;
  IF v_check NOT LIKE '%flag_change%' THEN RAISE EXCEPTION 'P03 check lost flag_change'; END IF;
  IF v_check NOT LIKE '%lap_completed%' OR v_check NOT LIKE '%sample%' THEN
    RAISE EXCEPTION 'P03 check lost existing types';
  END IF;

  -- ===== V3 sample event reuses existing columns + race_run_id ==============
  INSERT INTO public.endurance_telemetry_events (
    device_id, event_id, team_id, session_id, event_type, event_key, sequence,
    captured_at, received_at, completed_laps, incidents, in_pit_lane, flag,
    is_in_car, event_detection_source, payload, race_run_id
  ) VALUES (
    v_device, v_event, v_team, 'v3-session-1', 'sample', 'seq:1', 1,
    now(), now(), 12, 3, false, 'green', true, 'v3_sample',
    '{"protocolVersion":3,"session":{"flags":["green"]}}'::jsonb, v_run
  );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN RAISE EXCEPTION 'P10 sample insert failed'; END IF;

  -- ===== flag mapping -> existing flag_change type ==========================
  INSERT INTO public.endurance_telemetry_events (
    device_id, event_id, team_id, session_id, event_type, event_key, sequence,
    captured_at, received_at, flag, event_detection_source, payload, race_run_id
  ) VALUES (
    v_device, v_event, v_team, 'v3-session-1', 'flag_change', 'flag:2', 2,
    now(), now(), 'yellow', 'v3_transition',
    '{"protocolVersion":3,"session":{"flags":["yellow"]}}'::jsonb, v_run
  );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN RAISE EXCEPTION 'P11 flag_change insert failed'; END IF;

  -- ===== incident_count_changed allowed by extended check ===================
  INSERT INTO public.endurance_telemetry_events (
    device_id, event_id, team_id, session_id, event_type, event_key, sequence,
    captured_at, received_at, incidents, event_detection_source, payload, race_run_id
  ) VALUES (
    v_device, v_event, v_team, 'v3-session-1', 'incident_count_changed', 'incident:5', 3,
    now(), now(), 5, 'v3_transition',
    '{"protocolVersion":3,"raceState":{"incidents":5}}'::jsonb, v_run
  );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN RAISE EXCEPTION 'P12 incident_count_changed insert failed'; END IF;

  -- ===== dedupe via existing (device_id, session_id, event_key) UNIQUE ======
  INSERT INTO public.endurance_telemetry_events (
    device_id, event_id, team_id, session_id, event_type, event_key, sequence,
    captured_at, received_at, completed_laps, event_detection_source, race_run_id
  ) VALUES (
    v_device, v_event, v_team, 'v3-session-1', 'lap_completed', 'lap:13', 4,
    now(), now(), 13, 'v3_transition', v_run
  ) ON CONFLICT (device_id, session_id, event_key) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN RAISE EXCEPTION 'P13a lap insert failed'; END IF;
  -- Replay the same (device, session, event_key) row -> ignored, count stays 1.
  INSERT INTO public.endurance_telemetry_events (
    device_id, event_id, team_id, session_id, event_type, event_key, sequence,
    captured_at, received_at, completed_laps, event_detection_source, race_run_id
  ) VALUES (
    v_device, v_event, v_team, 'v3-session-1', 'lap_completed', 'lap:13', 5,
    now(), now(), 13, 'v3_transition', v_run
  ) ON CONFLICT (device_id, session_id, event_key) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN RAISE EXCEPTION 'P13b expected dedupe no-op, got %', v_count; END IF;

  -- ===== invalid event_type must still be REJECTED by the check =============
  BEGIN
    INSERT INTO public.endurance_telemetry_events (
      device_id, event_id, team_id, session_id, event_type, event_key, sequence,
      captured_at, received_at, event_detection_source
    ) VALUES (
      v_device, v_event, v_team, 'v3-session-1', 'bogus_type', 'x:1', 6,
      now(), now(), 'v3_transition'
    );
    RAISE EXCEPTION 'P14 invalid event_type accepted';
  EXCEPTION WHEN check_violation THEN
    NULL; -- expected
  END;

  -- ===== FK race_run_id enforced ============================================
  BEGIN
    INSERT INTO public.endurance_telemetry_events (
      device_id, event_id, team_id, session_id, event_type, event_key, sequence,
      captured_at, received_at, event_detection_source, race_run_id
    ) VALUES (
      v_device, v_event, v_team, 'v3-session-1', 'sample', 'seq:9', 7,
      now(), now(), 'v3_sample', '11111111-1111-1111-1111-111111111111'
    );
    RAISE EXCEPTION 'P15 nonexistent race_run_id accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL; -- expected
  END;

  -- ===== latest carries race_run_id + v3_normalized =========================
  INSERT INTO public.simhub_telemetry_latest (
    device_id, owner_user_id, race_id, team_id, endurance_event_id, endurance_team_id,
    session_id, sequence, captured_at, received_at, connector_id, simhub_version,
    game, race_run_id, v3_normalized, telemetry
  ) VALUES (
    v_device, v_owner, NULL, NULL, v_event, v_team,
    'v3-session-1', 1, now(), now(), 'connector-a', 'v3-device', 'IRacing',
    v_run, '{"protocolVersion":3,"timing":{"completedLaps":12}}'::jsonb,
    '{"protocolVersion":3}'::jsonb
  );
  SELECT count(*) INTO v_count FROM public.simhub_telemetry_latest
   WHERE device_id = v_device AND race_run_id = v_run AND v3_normalized IS NOT NULL;
  IF v_count <> 1 THEN RAISE EXCEPTION 'P20 latest upsert with race_run_id/v3_normalized failed'; END IF;

  RAISE NOTICE 'PHASE E PERSISTENCE TESTS P01-P20 PASS';
END $$;

ROLLBACK;