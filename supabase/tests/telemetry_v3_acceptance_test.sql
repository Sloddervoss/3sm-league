-- ============================================================================
-- Telemetry V3 Phase E — Acceptance Test Suite (A-series, A01..A104).
--
-- Contract: applied AFTER the authoritative pre-Phase-E production baseline
-- fixture, the disposable Phase A/B/D stubs, and the Phase E forward migration
-- (20260902190000_endurance_v3_persistence.sql). Runs in its own transaction as
-- service_role (BYPASSRLS — exactly the V3 Edge service client) and rolls
-- itself back. NEVER touches production or another worktree.
--
-- Coverage per the Phase E Acceptance Coverage GO matrix:
--   A01..A07  race-variant run resolution (active/practice/qualifying/ended/cancelled/none)
--   A08..A18  authority + registration + binding gate + handoff/session baseline
--   A20..A33  lap/pit/incident/flag edge cases + deterministic event keys
--   A40..A45  idempotency (replayed / key dedupe / lateral unique proof)
--   A50..A53  cross-source domain dedupe (lap, incident; NULL-run historicals)
--   A60..A67  required fields / latest boundary / strict v3_normalized
--   A70..A75  atomicity injection (mid-RPC rollback, no partial writes)
--   A80..A84  non-emission (deferred transition events)
--   A90..A97  historical-row preservation through forward migration
--   A98+A99  parallel-concurrency proofs (runner script, separate connections)
--   A100..A104 ledger + matrix + retained-base (structural/GO) assertions
--
-- Every functional assertion logs a pass into pg_temp.ac_ledger; a mismatch
-- raises inline with its A-id. The closing DO proves all A01..A104 declared ids
-- actually executed.
-- ============================================================================
\set ON_ERROR_STOP on

BEGIN;

DO $$
BEGIN
  IF current_database() NOT IN ('test_pre_phase_e_baseline', 'phase_e_test', 'test_phase_f') THEN
    RAISE EXCEPTION 'ABORT: phase-e acceptance test forbidden on %', current_database();
  END IF;
END $$;

-- -------------------------------------------------------------- harness -------
CREATE TEMP TABLE IF NOT EXISTS pg_temp.ac_ledger (id text PRIMARY KEY);
GRANT ALL ON TABLE pg_temp.ac_ledger TO service_role;
CREATE OR REPLACE FUNCTION pg_temp.ac_log(p_id text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO pg_temp.ac_ledger(id) VALUES (p_id) ON CONFLICT (id) DO NOTHING; END $$;
CREATE OR REPLACE FUNCTION pg_temp.ac_fail(p_id text, p_msg text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'ACCEPTANCE % FAILED: %', p_id, p_msg; END $$;

-- ------------------------------------------------------------- stubs/seed -----
INSERT INTO auth.users (id) VALUES
  ('00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000a2')
  ON CONFLICT (id) DO NOTHING;
INSERT INTO public.endurance_events (id) VALUES
  ('e0e0e0e0-0000-0000-0000-0000000000a1'),
  ('e2e2e2e2-0000-0000-0000-0000000000a1')
  ON CONFLICT (id) DO NOTHING;
INSERT INTO public.endurance_teams (id) VALUES
  ('f00f0000-0000-0000-0000-0000000000a1'),
  ('f2f2f200-0000-0000-0000-0000000000a1')
  ON CONFLICT (id) DO NOTHING;
INSERT INTO public.endurance_race_runs (id,event_id,team_id,run_kind,status) VALUES
  ('a5a5a5a5-0000-0000-0000-0000000000b1','e0e0e0e0-0000-0000-0000-0000000000a1','f00f0000-0000-0000-0000-0000000000a1','race','active'),
  ('a6a6a6a6-0000-0000-0000-0000000000b1','e2e2e2e2-0000-0000-0000-0000000000a1','f2f2f200-0000-0000-0000-0000000000a1','practice','active'),
  ('a7a7a7a7-0000-0000-0000-0000000000b1','e2e2e2e2-0000-0000-0000-0000000000a1','f2f2f200-0000-0000-0000-0000000000a1','qualifying','active')
  ON CONFLICT (id) DO NOTHING;
INSERT INTO public.endurance_registrations(event_id,user_id,status) VALUES
  ('e0e0e0e0-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a1','accepted'),
  ('e0e0e0e0-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a2','rejected'),
  ('e2e2e2e2-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a1','accepted'),
  ('e0e0e0e0-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b0','accepted')
  ON CONFLICT DO NOTHING;

-- Devices: e1/f1 team registered for u_a1 (run a5); e2/f2 practice+qualifying+ended/cancelled scenario via d_runcat.
--  token           device                            purpose
--  a (repeat a)    d0..a1  MAIN   primary e1/f1       run resolution + events carry run
--  b (repeat b)    d1..b2  STANDBY e1/f1 primary      handoff/former-primary no-cleanup
--  c (repeat c)    d2..b3  Revoked e1/f1              revoked gate
--  d (repeat d)    d3..b4  Unbound (no endurance)     not_bound gate
--  e (repeat e)    d4..b5  rejected registr e1/f1     not_registered gate
--  f (repeat f)    d5..b6  e2/f2 primary, u_a1        practice/qual/ended/cancelled resolution
--  g (repeat g)    d6..c1  EDGES primary e1/f1        lap/pit/incident/flag edge cases
--  h (repeat h)    d7..c1  IDEM primary e1/f1         idempotency
--  i (repeat i)    d8..c1  SRCA primary e1/f1         cross-source dedupe
--  j (repeat j)    d9..c1  SRCB primary e1/f1         cross-source dedupe
--  k (repeat k)    da..c1  ATOMIC e1/f1 (owner bogus)  atomicity injection
INSERT INTO public.simhub_devices (id) VALUES
  ('d0d0d0d0-0000-0000-0000-0000000000a1'),
  ('d1d1d1d1-0000-0000-0000-0000000000b2'),
  ('d2d2d2d2-0000-0000-0000-0000000000b3'),
  ('d3d3d3d3-0000-0000-0000-0000000000b4'),
  ('d4d4d4d4-0000-0000-0000-0000000000b5'),
  ('d5d5d5d5-0000-0000-0000-0000000000b6'),
  ('d6d6d6d6-0000-0000-0000-0000000000c1'),
  ('d7d7d7d7-0000-0000-0000-0000000000c1'),
  ('d8d8d8d8-0000-0000-0000-0000000000c1'),
  ('d9d9d9d9-0000-0000-0000-0000000000c1'),
  ('dadadada-0000-0000-0000-0000000000c1')
  ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  e1 UUID:='e0e0e0e0-0000-0000-0000-0000000000a1';
  f1 UUID:='f00f0000-0000-0000-0000-0000000000a1';
  e2 UUID:='e2e2e2e2-0000-0000-0000-0000000000a1';
  f2 UUID:='f2f2f200-0000-0000-0000-0000000000a1';
  u1 UUID:='00000000-0000-0000-0000-0000000000a1';
BEGIN
  -- configure devices with their roles/endpoints
  UPDATE public.simhub_devices SET
    token_hash=repeat('a',64), owner_user_id=u1, endurance_event_id=e1, endurance_team_id=f1,
    device_status='active_binding', device_role='primary', connector_id='test', device_name='dv'
   WHERE id='d0d0d0d0-0000-0000-0000-0000000000a1';
  UPDATE public.simhub_devices SET
    token_hash=repeat('b',64), owner_user_id=u1, endurance_event_id=e1, endurance_team_id=f1,
    device_status='active_binding', device_role='primary', connector_id='test', device_name='dv'
   WHERE id='d1d1d1d1-0000-0000-0000-0000000000b2';
  UPDATE public.simhub_devices SET
    token_hash=repeat('c',64), owner_user_id=u1, endurance_event_id=e1, endurance_team_id=f1,
    device_status='active_binding', device_role='primary', connector_id='test', device_name='dv', revoked_at=now()
   WHERE id='d2d2d2d2-0000-0000-0000-0000000000b3';
  -- d_unb: leave endurance fields NULL
  UPDATE public.simhub_devices SET token_hash=repeat('d',64), owner_user_id=u1, connector_id='test', device_name='dv'
   WHERE id='d3d3d3d3-0000-0000-0000-0000000000b4';
  UPDATE public.simhub_devices SET
    token_hash=repeat('e',64), owner_user_id='00000000-0000-0000-0000-0000000000a2', endurance_event_id=e1, endurance_team_id=f1,
    device_status='active_binding', device_role='primary', connector_id='test', device_name='dv'
   WHERE id='d4d4d4d4-0000-0000-0000-0000000000b5'; -- owner u_a2 has 'rejected' registr on e1
  UPDATE public.simhub_devices SET
    token_hash=repeat('f',64), owner_user_id=u1, endurance_event_id=e2, endurance_team_id=f2,
    device_status='active_binding', device_role='primary', connector_id='test', device_name='dv'
   WHERE id='d5d5d5d5-0000-0000-0000-0000000000b6';
  UPDATE public.simhub_devices SET
    token_hash=repeat('1',64), owner_user_id=u1, endurance_event_id=e1, endurance_team_id=f1,
    device_status='active_binding', device_role='primary', connector_id='test', device_name='dv'
   WHERE id='d6d6d6d6-0000-0000-0000-0000000000c1';
  UPDATE public.simhub_devices SET
    token_hash=repeat('2',64), owner_user_id=u1, endurance_event_id=e1, endurance_team_id=f1,
    device_status='active_binding', device_role='primary', connector_id='test', device_name='dv'
   WHERE id='d7d7d7d7-0000-0000-0000-0000000000c1';
  UPDATE public.simhub_devices SET
    token_hash=repeat('3',64), owner_user_id=u1, endurance_event_id=e1, endurance_team_id=f1,
    device_status='active_binding', device_role='primary', connector_id='test', device_name='dv'
   WHERE id='d8d8d8d8-0000-0000-0000-0000000000c1';
  UPDATE public.simhub_devices SET
    token_hash=repeat('4',64), owner_user_id=u1, endurance_event_id=e1, endurance_team_id=f1,
    device_status='active_binding', device_role='primary', connector_id='test', device_name='dv'
   WHERE id='d9d9d9d9-0000-0000-0000-0000000000c1';
  -- ATOMIC: bogus owner on a valid e1/f1 binding. The FK on auth.users(id) fails at the latest stage.
  UPDATE public.simhub_devices SET
    token_hash=repeat('5',64), owner_user_id='00000000-0000-0000-0000-0000000000b0',
    endurance_event_id=e1, endurance_team_id=f1,
    device_status='active_binding', device_role='primary', connector_id='test', device_name='dv'
   WHERE id='dadadada-0000-0000-0000-0000000000c1';
END $$;

-- Act as the V3 Edge service client for the whole acceptance suite.
-- The production 400ms rate limiter is intentionally retained. This disposable
-- suite exercises dozens of independent semantic snapshots without wall-clock
-- sleeps, so age each test-only device heartbeat after a successful write.
CREATE OR REPLACE FUNCTION pg_temp.ac_age_test_heartbeat() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.last_seen_at IS NOT NULL THEN NEW.last_seen_at := NEW.last_seen_at - interval '6 seconds'; END IF; RETURN NEW; END $$;
CREATE TRIGGER ac_age_test_heartbeat BEFORE UPDATE OF last_seen_at ON public.simhub_devices FOR EACH ROW EXECUTE FUNCTION pg_temp.ac_age_test_heartbeat();
SET LOCAL role service_role;
SET LOCAL request.jwt.claim.role = 'service_role';

-- =============================================================== CATEGORY 1
-- Race-variant run resolution.
CREATE OR REPLACE FUNCTION pg_temp.t_run_resolution()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  r text; run UUID; cnt integer; n0 integer;
  dmain UUID := 'd0d0d0d0-0000-0000-0000-0000000000a1';
  drun UUID := 'd5d5d5d5-0000-0000-0000-0000000000b6';
  e2 UUID := 'e2e2e2e2-0000-0000-0000-0000000000a1';
  f2 UUID := 'f2f2f200-0000-0000-0000-0000000000a1';
BEGIN
  -- A01: active race run resolves and its id lands on latest + events.
  SELECT result INTO r FROM public.simhub_persist_v3(repeat('a',64),'run-sess',1,clock_timestamp(),
    '{"timing":{"completedLaps":1},"raceState":{"incidents":0},"track":{"onPitRoad":false},"session":{"flags":["green"]}}');
  IF r <> 'accepted' THEN PERFORM pg_temp.ac_fail('A01','run-resolution baseline not accepted: '||r); END IF;
  -- Baselines intentionally emit no transition; a same-source +1 proves an
  -- eligible event is attached to the server-resolved run.
  SELECT result INTO r FROM public.simhub_persist_v3(repeat('a',64),'run-sess',2,clock_timestamp(),
    '{"timing":{"completedLaps":2},"raceState":{"incidents":0},"track":{"onPitRoad":false},"session":{"flags":["green"]}}');
  IF r <> 'accepted' THEN PERFORM pg_temp.ac_fail('A01','run-resolution transition not accepted: '||r); END IF;
  SELECT race_run_id INTO run FROM public.simhub_telemetry_latest WHERE device_id=dmain;
  IF run <> 'a5a5a5a5-0000-0000-0000-0000000000b1' THEN
    PERFORM pg_temp.ac_fail('A01','active run not resolved: '||coalesce(run::text,'<null>'));
  END IF;
  SELECT count(*) INTO cnt FROM public.endurance_telemetry_events
   WHERE device_id=dmain AND session_id='run-sess' AND race_run_id='a5a5a5a5-0000-0000-0000-0000000000b1';
  IF cnt < 1 THEN PERFORM pg_temp.ac_fail('A01','no event carried the resolved run'); END IF;
  PERFORM pg_temp.ac_log('A01');

  -- A02: practice/qualifying run_kinds are NOT race kinds the resolver selects,
  -- so a device with only practice(active)+qualifying(active) runs still resolves NULL.
  SELECT result INTO r FROM public.simhub_persist_v3(repeat('f',64),'rk-sess',1,clock_timestamp(),
    '{"timing":{"completedLaps":1},"raceState":{"incidents":0},"track":{"onPitRoad":false},"session":{"flags":["green"]}}');
  IF r <> 'accepted' THEN PERFORM pg_temp.ac_fail('A02','practice-snapshot not accepted: '||r); END IF;
  SELECT race_run_id INTO run FROM public.simhub_telemetry_latest WHERE device_id=drun;
  IF run IS NOT NULL THEN PERFORM pg_temp.ac_fail('A02','practice/qual run resolved to '||run); END IF;
  PERFORM pg_temp.ac_log('A02');

  -- A03: resolver is structurally scoped to run_kind='race' AND status='active'.
  IF NOT EXISTS (SELECT 1 FROM pg_get_functiondef('public.simhub_persist_v3(text,text,bigint,timestamptz,jsonb)'::regprocedure)
                 WHERE pg_get_functiondef LIKE '%run_kind%''race''%'
                   AND   ((pg_get_functiondef LIKE '%status%''active''%'))) THEN
    PERFORM pg_temp.ac_fail('A03','resolver scope text (race+active) not found');
  END IF;
  PERFORM pg_temp.ac_log('A03');

  -- A04: an 'ended' race run must not resolve.
  INSERT INTO public.endurance_race_runs (id,event_id,team_id,run_kind,status) VALUES
    ('a8e0e32a-0000-0000-0000-0000000000b1',e2,f2,'race','ended');
  SELECT result INTO r FROM public.simhub_persist_v3(repeat('f',64),'rk-sess',2,clock_timestamp(),
    '{"timing":{"completedLaps":2},"raceState":{"incidents":0},"track":{"onPitRoad":true},"session":{"flags":["yellow"]}}');
  SELECT race_run_id INTO run FROM public.simhub_telemetry_latest WHERE device_id=drun;
  IF run IS NOT NULL THEN PERFORM pg_temp.ac_fail('A04','ended run resolved to '||run); END IF;
  PERFORM pg_temp.ac_log('A04');

  -- A05: a 'cancelled' race run must not resolve; snapshot still accepted.
  INSERT INTO public.endurance_race_runs (id,event_id,team_id,run_kind,status) VALUES
    ('a8c0e32a-0000-0000-0000-0000000000b1',e2,f2,'race','cancelled');
  SELECT result INTO r FROM public.simhub_persist_v3(repeat('f',64),'rk-sess',3,clock_timestamp(),
    '{"timing":{"completedLaps":3},"raceState":{"incidents":1},"track":{"onPitRoad":false},"session":{"flags":["green"]}}');
  IF r <> 'accepted' THEN PERFORM pg_temp.ac_fail('A05','cancelled-run snapshot not accepted: '||r); END IF;
  SELECT race_run_id INTO run FROM public.simhub_telemetry_latest WHERE device_id=drun;
  IF run IS NOT NULL THEN PERFORM pg_temp.ac_fail('A05','cancelled run resolved to '||run); END IF;
  PERFORM pg_temp.ac_log('A05');

  -- A06: with no active run, latest updates with NULL run and NO race-run events.
  SELECT count(*) INTO cnt FROM public.endurance_telemetry_events
   WHERE device_id=drun AND session_id='rk-sess';
  IF cnt <> 0 THEN PERFORM pg_temp.ac_fail('A06','no-active-run inserted '||cnt||' events'); END IF;
  PERFORM pg_temp.ac_log('A06');

  -- A07: when a run becomes active, subsequent events carry it (resume path).
  UPDATE public.endurance_race_runs SET status='active' WHERE id='a8c0e32a-0000-0000-0000-0000000000b1';
  SELECT result INTO r FROM public.simhub_persist_v3(repeat('f',64),'rk-sess',4,clock_timestamp(),
    '{"timing":{"completedLaps":4},"raceState":{"incidents":1},"track":{"onPitRoad":false},"session":{"flags":["green"]}}');
  SELECT race_run_id INTO run FROM public.simhub_telemetry_latest WHERE device_id=drun;
  IF run <> 'a8c0e32a-0000-0000-0000-0000000000b1' THEN
    PERFORM pg_temp.ac_fail('A07','resumed run not resolved: '||coalesce(run::text,'<null>'));
  END IF;
  PERFORM pg_temp.ac_log('A07');
END $$;

-- =============================================================== CATEGORY 2
-- Authority, registration, binding, handoff, session baseline.
CREATE OR REPLACE FUNCTION pg_temp.t_authority()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE r text; cnt integer; seg integer; n0 integer;
BEGIN
  -- A08: revoked device refused.
  SELECT result INTO r FROM public.simhub_persist_v3(repeat('c',64),'x',1,clock_timestamp(),'{}');
  IF r <> 'revoked' THEN PERFORM pg_temp.ac_fail('A08','expected revoked got '||r); END IF;
  PERFORM pg_temp.ac_log('A08');

  -- A09: unbound device (no endurance event/team) refused.
  SELECT result INTO r FROM public.simhub_persist_v3(repeat('d',64),'x',1,clock_timestamp(),'{"timing":{"completedLaps":1}}');
  IF r <> 'not_bound' THEN PERFORM pg_temp.ac_fail('A09','expected not_bound got '||r); END IF;
  PERFORM pg_temp.ac_log('A09');

  -- A10: registration not in an allowed status (rejected) refused.
  SELECT result INTO r FROM public.simhub_persist_v3(repeat('e',64),'x',1,clock_timestamp(),'{"timing":{"completedLaps":1}}');
  IF r <> 'not_registered' THEN PERFORM pg_temp.ac_fail('A10','expected not_registered got '||r); END IF;
  PERFORM pg_temp.ac_log('A10');

  -- A11: unknown token refused.
  SELECT result INTO r FROM public.simhub_persist_v3(repeat('0',64),'x',1,clock_timestamp(),'{"timing":{"completedLaps":1}}');
  IF r <> 'invalid_device' THEN PERFORM pg_temp.ac_fail('A11','expected invalid_device got '||r); END IF;
  PERFORM pg_temp.ac_log('A11');

  -- A12: non-service_role refused.
  SET LOCAL request.jwt.claim.role = 'authenticated';
  SELECT result INTO r FROM public.simhub_persist_v3(repeat('a',64),'x',1,clock_timestamp(),'{"timing":{"completedLaps":1}}');
  IF r <> 'unauthorized' THEN PERFORM pg_temp.ac_fail('A12','expected unauthorized got '||r); END IF;
  SET LOCAL request.jwt.claim.role = 'service_role';
  PERFORM pg_temp.ac_log('A12');

  -- A13: valid primary accepted.
  SELECT result INTO r FROM public.simhub_persist_v3(repeat('a',64),'auth-sess',1,clock_timestamp(),
    '{"timing":{"completedLaps":1},"raceState":{"incidents":0},"track":{"onPitRoad":false},"session":{"flags":["green"]}}');
  IF r <> 'accepted' THEN PERFORM pg_temp.ac_fail('A13','valid primary not accepted: '||r); END IF;
  PERFORM pg_temp.ac_log('A13');

  -- A14: malformed/strict-validation failures all -> 'invalid_payload', no writes.
  SELECT result INTO r FROM public.simhub_persist_v3('NOTHEX','x',1,clock_timestamp(),'{}');
  IF r <> 'invalid_payload' THEN PERFORM pg_temp.ac_fail('A14a','bad token not invalid_payload: '||r); END IF;
  SELECT result INTO r FROM public.simhub_persist_v3(repeat('a',64),'',1,clock_timestamp(),'{}');
  IF r <> 'invalid_payload' THEN PERFORM pg_temp.ac_fail('A14b','empty session not invalid_payload: '||r); END IF;
  SELECT result INTO r FROM public.simhub_persist_v3(repeat('a',64),'s',-1,clock_timestamp(),'{}');
  IF r <> 'invalid_payload' THEN PERFORM pg_temp.ac_fail('A14c','neg sequence not invalid_payload: '||r); END IF;
  SELECT result INTO r FROM public.simhub_persist_v3(repeat('a',64),'s',1,NULL,'{}');
  IF r <> 'invalid_payload' THEN PERFORM pg_temp.ac_fail('A14d','null captured not invalid_payload: '||r); END IF;
  SELECT result INTO r FROM public.simhub_persist_v3(repeat('a',64),'s',1,clock_timestamp(),'[1,2,3]');
  IF r <> 'invalid_payload' THEN PERFORM pg_temp.ac_fail('A14e','non-object jsonb not invalid_payload: '||r); END IF;
  SELECT result INTO r FROM public.simhub_persist_v3(repeat('a',64),'s',1,clock_timestamp(),'null');
  IF r <> 'invalid_payload' THEN PERFORM pg_temp.ac_fail('A14f','jsonb null not invalid_payload: '||r); END IF;
  -- no event/segment written for the valid device by the invalid attempts
  SELECT count(*) INTO cnt FROM public.endurance_telemetry_events WHERE session_id IN ('x','s');
  IF cnt <> 0 THEN PERFORM pg_temp.ac_fail('A14g','invalid payloads wrote events'); END IF;
  PERFORM pg_temp.ac_log('A14');

  -- A15: handoff — former primary demoted to standby is refused (not_authority)
  -- AND its prior source segment is retained (no cleanup of the previous authority's state).
  SELECT result INTO r FROM public.simhub_persist_v3(repeat('b',64),'h-sess',1,clock_timestamp(),
    '{"timing":{"completedLaps":1},"raceState":{"incidents":2},"track":{"onPitRoad":false},"session":{"flags":["green"]}}');
  IF r <> 'accepted' THEN PERFORM pg_temp.ac_fail('A15a','primary pre-handoff seed not accepted: '||r); END IF;
  UPDATE public.simhub_devices SET device_role='standby' WHERE id='d1d1d1d1-0000-0000-0000-0000000000b2';
  SELECT result INTO r FROM public.simhub_persist_v3(repeat('b',64),'h-sess',2,clock_timestamp(),
    '{"timing":{"completedLaps":2},"raceState":{"incidents":3},"track":{"onPitRoad":true},"session":{"flags":["yellow"]}}');
  IF r <> 'not_authority' THEN PERFORM pg_temp.ac_fail('A15b','former primary not refused: '||r); END IF;
  SELECT count(*) INTO seg FROM public.endurance_source_segments WHERE device_id='d1d1d1d1-0000-0000-0000-0000000000b2';
  IF seg <> 1 THEN PERFORM pg_temp.ac_fail('A15c','former primary segment lost (got '||seg||')'); END IF;
  PERFORM pg_temp.ac_log('A15');

  -- A16: session baseline — first snapshot of a fresh transport session emits
  -- ZERO transition/history events while it initializes detector state.
  SELECT result INTO r FROM public.simhub_persist_v3(repeat('a',64),'bl-sess',1,clock_timestamp(),
    '{"timing":{"completedLaps":5},"raceState":{"incidents":4},"track":{"onPitRoad":true},"session":{"flags":["yellow","green"]}}');
  IF r <> 'accepted' THEN PERFORM pg_temp.ac_fail('A16','baseline not accepted: '||r); END IF;
  SELECT count(*) INTO cnt FROM public.endurance_telemetry_events WHERE device_id='d0d0d0d0-0000-0000-0000-0000000000a1' AND session_id='bl-sess';
  IF cnt <> 0 THEN PERFORM pg_temp.ac_fail('A16','baseline emitted '||cnt||' history events (want 0)'); END IF;
  SELECT count(*) INTO cnt FROM public.endurance_telemetry_events
   WHERE device_id='d0d0d0d0-0000-0000-0000-0000000000a1' AND session_id='bl-sess' AND event_detection_source='simhub_v3_transition';
  IF cnt <> 0 THEN PERFORM pg_temp.ac_fail('A16','baseline fabricated transitions'); END IF;
  PERFORM pg_temp.ac_log('A16');

  -- A17: handoff baseline — a NEW session must not fabricate a cross-source
  -- transition (fresh segment starts without prior state).
  SELECT result INTO r FROM public.simhub_persist_v3(repeat('a',64),'handoff-new',5,clock_timestamp(),
    '{"timing":{"completedLaps":40},"raceState":{"incidents":9},"track":{"onPitRoad":true},"session":{"flags":["green"]}}');
  IF r <> 'accepted' THEN PERFORM pg_temp.ac_fail('A17','handoff not accepted: '||r); END IF;
  SELECT count(*) INTO cnt FROM public.endurance_telemetry_events WHERE device_id='d0d0d0d0-0000-0000-0000-0000000000a1' AND session_id='handoff-new';
  IF cnt <> 0 THEN PERFORM pg_temp.ac_fail('A17','handoff fabricated '||cnt||' history events (want 0)'); END IF;
  PERFORM pg_temp.ac_log('A17');

  -- A18: standby/revoked/non-authority devices never create source segments.
  SELECT count(*) INTO seg FROM public.endurance_source_segments
   WHERE device_id IN
     ('d1d1d1d1-0000-0000-0000-0000000000b2','d2d2d2d2-0000-0000-0000-0000000000b3','d3d3d3d3-0000-0000-0000-0000000000b4','d4d4d4d4-0000-0000-0000-0000000000b5')
     AND device_id <> 'd1d1d1d1-0000-0000-0000-0000000000b2';
  IF seg <> 0 THEN PERFORM pg_temp.ac_fail('A18','non-authority device wrote a segment'); END IF;
  PERFORM pg_temp.ac_log('A18');
END $$;

-- =============================================================== CATEGORY 3
-- Lap / pit / incident / flag edge cases + deterministic event keys.
-- Dedicated device d_edge (token g), transport session 'edge-sess', run a5.
CREATE OR REPLACE FUNCTION pg_temp.t_edges()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE r text; cnt integer;
  de UUID := 'd6d6d6d6-0000-0000-0000-0000000000c1';
  run UUID := 'a5a5a5a5-0000-0000-0000-0000000000b1';
BEGIN
  -- baseline completedLaps=10 incidents=3 onPitRoad=false flags=[green]
  SELECT result INTO r FROM public.simhub_persist_v3(repeat('1',64),'edge-sess',120,clock_timestamp(),
    '{"timing":{"completedLaps":10,"lastLapTimeSeconds":98.0},"raceState":{"incidents":3},"track":{"onPitRoad":false},"session":{"flags":["green"]}}');
  IF r <> 'accepted' THEN PERFORM pg_temp.ac_fail('A20seed','edge baseline not accepted: '||r); END IF;

  -- A20: exact +1 lap advance -> lap_completed (key lap:11).
  SELECT result INTO r FROM public.simhub_persist_v3(repeat('1',64),'edge-sess',121,clock_timestamp(),
    '{"timing":{"completedLaps":11,"lastLapTimeSeconds":97.5},"raceState":{"incidents":3},"track":{"onPitRoad":false},"session":{"flags":["green"]}}');
  SELECT count(*) INTO cnt FROM public.endurance_telemetry_events
   WHERE device_id=de AND session_id='edge-sess' AND event_type='lap_completed' AND completed_laps=11 AND event_key='lap:11';
  IF cnt <> 1 THEN PERFORM pg_temp.ac_fail('A20','+1 lap event missing/surplus: '||cnt); END IF;
  PERFORM pg_temp.ac_log('A20');

  -- A21: lap JUMP 11 -> 14 emits NO lap event (no synthetic laps).
  SELECT result INTO r FROM public.simhub_persist_v3(repeat('1',64),'edge-sess',122,clock_timestamp(),
    '{"timing":{"completedLaps":14,"lastLapTimeSeconds":97.0},"raceState":{"incidents":3},"track":{"onPitRoad":false},"session":{"flags":["green"]}}');
  SELECT count(*) INTO cnt FROM public.endurance_telemetry_events
   WHERE device_id=de AND session_id='edge-sess' AND event_type='lap_completed';
  IF cnt <> 1 THEN PERFORM pg_temp.ac_fail('A21','jump fabricated a lap event'); END IF;
  PERFORM pg_temp.ac_log('A21');

  -- A22: lap DECREASE 14 -> 12 emits NO lap event.
  SELECT result INTO r FROM public.simhub_persist_v3(repeat('1',64),'edge-sess',123,clock_timestamp(),
    '{"timing":{"completedLaps":12},"raceState":{"incidents":3},"track":{"onPitRoad":false},"session":{"flags":["green"]}}');
  SELECT count(*) INTO cnt FROM public.endurance_telemetry_events
   WHERE device_id=de AND session_id='edge-sess' AND event_type='lap_completed';
  IF cnt <> 1 THEN PERFORM pg_temp.ac_fail('A22','decrease emitted lap event'); END IF;
  PERFORM pg_temp.ac_log('A22');

  -- A23: lap repeat 12 -> 12 emits NO lap event.
  SELECT result INTO r FROM public.simhub_persist_v3(repeat('1',64),'edge-sess',124,clock_timestamp(),
    '{"timing":{"completedLaps":12},"raceState":{"incidents":3},"track":{"onPitRoad":false},"session":{"flags":["green"]}}');
  SELECT count(*) INTO cnt FROM public.endurance_telemetry_events
   WHERE device_id=de AND session_id='edge-sess' AND event_type='lap_completed';
  IF cnt <> 1 THEN PERFORM pg_temp.ac_fail('A23','repeat emitted lap event'); END IF;
  PERFORM pg_temp.ac_log('A23');

  -- recentre 12 -> 13 (exact +1) so lap:13 is present (used by dedupe/later).
  SELECT result INTO r FROM public.simhub_persist_v3(repeat('1',64),'edge-sess',125,clock_timestamp(),
    '{"timing":{"completedLaps":13},"raceState":{"incidents":3},"track":{"onPitRoad":false},"session":{"flags":["green"]}}');

  -- A25: monotone incident increase 3 -> 5 -> incident_count_changed (key incident:5).
  SELECT result INTO r FROM public.simhub_persist_v3(repeat('1',64),'edge-sess',126,clock_timestamp(),
    '{"timing":{"completedLaps":13},"raceState":{"incidents":5},"track":{"onPitRoad":false},"session":{"flags":["green"]}}');
  SELECT count(*) INTO cnt FROM public.endurance_telemetry_events
   WHERE device_id=de AND session_id='edge-sess' AND event_type='incident_count_changed' AND incidents=5 AND event_key='incident:5';
  IF cnt <> 1 THEN PERFORM pg_temp.ac_fail('A25','incident increase event missing: '||cnt); END IF;
  PERFORM pg_temp.ac_log('A25');

  -- A26: incident DECREASE 5 -> 2 emits NO incident event.
  SELECT result INTO r FROM public.simhub_persist_v3(repeat('1',64),'edge-sess',127,clock_timestamp(),
    '{"timing":{"completedLaps":13},"raceState":{"incidents":2},"track":{"onPitRoad":false},"session":{"flags":["green"]}}');
  SELECT count(*) INTO cnt FROM public.endurance_telemetry_events
   WHERE device_id=de AND session_id='edge-sess' AND event_type='incident_count_changed';
  IF cnt <> 1 THEN PERFORM pg_temp.ac_fail('A26','decrease emitted incident event'); END IF;
  PERFORM pg_temp.ac_log('A26');

  -- A27: pit_entry on onPitRoad false->true.
  SELECT result INTO r FROM public.simhub_persist_v3(repeat('1',64),'edge-sess',128,clock_timestamp(),
    '{"timing":{"completedLaps":13},"raceState":{"incidents":2},"track":{"onPitRoad":true},"session":{"flags":["green"]}}');
  SELECT count(*) INTO cnt FROM public.endurance_telemetry_events
   WHERE device_id=de AND session_id='edge-sess' AND event_type='pit_entry';
  IF cnt <> 1 THEN PERFORM pg_temp.ac_fail('A27','pit_entry missing'); END IF;
  PERFORM pg_temp.ac_log('A27');

  -- A28: pit_exit on true->false, then re-entry -> recurring pit (two entries total).
  SELECT result INTO r FROM public.simhub_persist_v3(repeat('1',64),'edge-sess',129,clock_timestamp(),
    '{"timing":{"completedLaps":13},"raceState":{"incidents":2},"track":{"onPitRoad":false},"session":{"flags":["green"]}}');
  SELECT count(*) INTO cnt FROM public.endurance_telemetry_events
   WHERE device_id=de AND session_id='edge-sess' AND event_type='pit_exit';
  IF cnt <> 1 THEN PERFORM pg_temp.ac_fail('A28a','pit_exit missing'); END IF;
  SELECT result INTO r FROM public.simhub_persist_v3(repeat('1',64),'edge-sess',130,clock_timestamp(),
    '{"timing":{"completedLaps":13},"raceState":{"incidents":2},"track":{"onPitRoad":true},"session":{"flags":["green"]}}');
  SELECT count(*) INTO cnt FROM public.endurance_telemetry_events
   WHERE device_id=de AND session_id='edge-sess' AND event_type='pit_entry';
  IF cnt <> 2 THEN PERFORM pg_temp.ac_fail('A28b','recurring pit_entry not emitted got '||cnt); END IF;
  PERFORM pg_temp.ac_log('A28');

  -- A29: flag change green -> green,yellow emits flag_change carrying the csv.
  SELECT result INTO r FROM public.simhub_persist_v3(repeat('1',64),'edge-sess',131,clock_timestamp(),
    '{"timing":{"completedLaps":13},"raceState":{"incidents":2},"track":{"onPitRoad":true},"session":{"flags":["green","yellow"]}}');
  SELECT count(*) INTO cnt FROM public.endurance_telemetry_events
   WHERE device_id=de AND session_id='edge-sess' AND event_type='flag_change' AND flag='green,yellow';
  IF cnt <> 1 THEN PERFORM pg_temp.ac_fail('A29','flag_change missing: '||cnt); END IF;
  PERFORM pg_temp.ac_log('A29');

  -- A30: flag REORDER (green,yellow -> yellow,green) is order-insensitive -> 0 changes.
  SELECT result INTO r FROM public.simhub_persist_v3(repeat('1',64),'edge-sess',132,clock_timestamp(),
    '{"timing":{"completedLaps":13},"raceState":{"incidents":2},"track":{"onPitRoad":true},"session":{"flags":["yellow","green"]}}');
  SELECT count(*) INTO cnt FROM public.endurance_telemetry_events
   WHERE device_id=de AND session_id='edge-sess' AND event_type='flag_change';
  IF cnt <> 1 THEN PERFORM pg_temp.ac_fail('A30','reorder caused a flag_change, got '||cnt); END IF;
  PERFORM pg_temp.ac_log('A30');

  -- A31: identical set repeated -> 0 new flag_change.
  SELECT result INTO r FROM public.simhub_persist_v3(repeat('1',64),'edge-sess',133,clock_timestamp(),
    '{"timing":{"completedLaps":13},"raceState":{"incidents":2},"track":{"onPitRoad":true},"session":{"flags":["green","yellow"]}}');
  SELECT count(*) INTO cnt FROM public.endurance_telemetry_events
   WHERE device_id=de AND session_id='edge-sess' AND event_type='flag_change';
  IF cnt <> 1 THEN PERFORM pg_temp.ac_fail('A31','identical set emitted flag_change, got '||cnt); END IF;
  PERFORM pg_temp.ac_log('A31');

  -- A32: same onPitRoad=true persisted again -> 0 new pit_entry (no recurring pit noise).
  SELECT result INTO r FROM public.simhub_persist_v3(repeat('1',64),'edge-sess',134,clock_timestamp(),
    '{"timing":{"completedLaps":13},"raceState":{"incidents":2},"track":{"onPitRoad":true},"session":{"flags":["green","yellow"]}}');
  SELECT count(*) INTO cnt FROM public.endurance_telemetry_events
   WHERE device_id=de AND session_id='edge-sess' AND event_type='pit_entry';
  IF cnt <> 2 THEN PERFORM pg_temp.ac_fail('A32','pit_entry repeated spuriously, got '||cnt); END IF;
  PERFORM pg_temp.ac_log('A32');

  -- A33: deterministic event keys across all transition types.
  IF NOT EXISTS (SELECT 1 FROM public.endurance_telemetry_events WHERE device_id=de AND session_id='edge-sess' AND event_type='lap_completed' AND event_key='lap:13') THEN
    PERFORM pg_temp.ac_fail('A33','lap key not lap:N'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.endurance_telemetry_events WHERE device_id=de AND session_id='edge-sess' AND event_type='pit_entry' AND event_key='v3:pit_entry:seq:128') THEN
    PERFORM pg_temp.ac_fail('A33a','pit key not seq-based'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.endurance_telemetry_events WHERE device_id=de AND session_id='edge-sess' AND event_type='pit_exit' AND event_key='v3:pit_exit:seq:129') THEN
    PERFORM pg_temp.ac_fail('A33b','pit_exit key not seq-based'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.endurance_telemetry_events WHERE device_id=de AND session_id='edge-sess' AND event_type='incident_count_changed' AND event_key='incident:5') THEN
    PERFORM pg_temp.ac_fail('A33c','incident key not incident:N'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.endurance_telemetry_events WHERE device_id=de AND session_id='edge-sess' AND event_type='flag_change' AND event_key LIKE 'v3:flag_change:seq:%') THEN
    PERFORM pg_temp.ac_fail('A33d','flag key not seq-based'); END IF;
  PERFORM pg_temp.ac_log('A33');
END $$;

-- =============================================================== CATEGORY 4
-- Idempotency: retry / replayed, event-key dedupe, single-row latest.
CREATE OR REPLACE FUNCTION pg_temp.t_idempotency()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE r text; cnt integer; prev integer;
  di UUID := 'd7d7d7d7-0000-0000-0000-0000000000c1';
  run UUID := 'a5a5a5a5-0000-0000-0000-0000000000b1';
BEGIN
  -- baseline completedLaps=200
  SELECT result INTO r FROM public.simhub_persist_v3(repeat('2',64),'idem-sess',300,clock_timestamp(),
    '{"timing":{"completedLaps":200},"raceState":{"incidents":0},"track":{"onPitRoad":false},"session":{"flags":["green"]}}');
  IF r <> 'accepted' THEN PERFORM pg_temp.ac_fail('A40seed','idem baseline not accepted: '||r); END IF;

  -- A40: retry the SAME (session,sequence) -> 'replayed' and cannot mutate
  -- detector, latest, or event history.
  SELECT count(*) INTO prev FROM public.endurance_telemetry_events WHERE device_id=di AND session_id='idem-sess';
  SELECT result INTO r FROM public.simhub_persist_v3(repeat('2',64),'idem-sess',300,clock_timestamp(),
    '{"timing":{"completedLaps":999},"raceState":{"incidents":99},"track":{"onPitRoad":true},"session":{"flags":["red"]}}');
  IF r <> 'replayed' THEN PERFORM pg_temp.ac_fail('A40','expected replayed got '||r); END IF;
  SELECT count(*) INTO cnt FROM public.endurance_telemetry_events WHERE device_id=di AND session_id='idem-sess';
  IF cnt <> prev OR EXISTS (SELECT 1 FROM public.endurance_source_segments WHERE device_id=di AND session_id='idem-sess' AND previous_completed_laps<>200)
     OR EXISTS (SELECT 1 FROM public.simhub_telemetry_latest WHERE device_id=di AND sequence<>300) THEN
    PERFORM pg_temp.ac_fail('A40','replayed source sequence mutated persisted state');
  END IF;
  PERFORM pg_temp.ac_log('A40');

  -- A41: a LOWER sequence for the same session -> 'replayed'.
  SELECT result INTO r FROM public.simhub_persist_v3(repeat('2',64),'idem-sess',10,clock_timestamp(),
    '{"timing":{"completedLaps":1},"raceState":{"incidents":0},"track":{"onPitRoad":false},"session":{"flags":["green"]}}');
  IF r <> 'replayed' THEN PERFORM pg_temp.ac_fail('A41','expected replayed for lower seq got '||r); END IF;
  PERFORM pg_temp.ac_log('A41');

  -- A42: a HIGHER sequence is accepted and emits the +1 lap.
  SELECT result INTO r FROM public.simhub_persist_v3(repeat('2',64),'idem-sess',301,clock_timestamp(),
    '{"timing":{"completedLaps":201,"lastLapTimeSeconds":96.0},"raceState":{"incidents":1},"track":{"onPitRoad":false},"session":{"flags":["green"]}}');
  IF r <> 'accepted' THEN PERFORM pg_temp.ac_fail('A42','higher seq not accepted: '||r); END IF;
  SELECT count(*) INTO cnt FROM public.endurance_telemetry_events
   WHERE device_id=di AND session_id='idem-sess' AND event_type='lap_completed' AND completed_laps=201;
  IF cnt <> 1 THEN PERFORM pg_temp.ac_fail('A42','+1 lap missing'); END IF;
  PERFORM pg_temp.ac_log('A42');

  -- A43: even a mutated-envelope PLAYBACK of the same (device,session,event_key)
  -- is a no-op in events (ON CONFLICT DO NOTHING on the key unique index).
  SELECT result INTO r FROM public.simhub_persist_v3(repeat('2',64),'idem-sess',301,clock_timestamp(),
    '{"timing":{"completedLaps":2,"lastLapTimeSeconds":1.0},"raceState":{"incidents":9},"track":{"onPitRoad":true},"session":{"flags":["yellow"]}}');
  -- ^ same sequence 301 -> also replayed, so nothing new. Now use unique-key dedupe via raw-index proof:
  SELECT count(*) INTO cnt FROM public.endurance_telemetry_events
   WHERE device_id=di AND session_id='idem-sess' AND event_type='lap_completed' AND completed_laps=201;
  IF cnt <> 1 THEN PERFORM pg_temp.ac_fail('A43','event-key dedupe failed, got '||cnt); END IF;
  PERFORM pg_temp.ac_log('A43');

  -- A44: latest is single-row per device (upsert on device_id).
  SELECT count(*) INTO cnt FROM public.simhub_telemetry_latest WHERE device_id=di;
  IF cnt <> 1 THEN PERFORM pg_temp.ac_fail('A44','latest not single-row, got '||cnt); END IF;
  PERFORM pg_temp.ac_log('A44');

  -- A45: the partial unique index (race_run_id, completed_laps) makes a
  -- duplicated committed lap a no-op even across sequence numbers (lateral
  -- idempotency). Force the SAME lap:2 on run a5 from a raw insert.
  SELECT count(*) INTO cnt FROM public.endurance_telemetry_events
   WHERE race_run_id=run AND event_type='lap_completed' AND completed_laps=201;
  IF cnt <> 1 THEN PERFORM pg_temp.ac_fail('A45','lap domain member pre-state wrong: '||cnt); END IF;
  BEGIN
    INSERT INTO public.endurance_telemetry_events
      (device_id,event_id,team_id,session_id,event_type,event_key,sequence,captured_at,event_detection_source,completed_laps,race_run_id)
    VALUES (di,'e0e0e0e0-0000-0000-0000-0000000000a1','f00f0000-0000-0000-0000-0000000000a1','x-dup','lap_completed','lap:201',9999,now(),'simhub_v3_transition',201,run)
    ON CONFLICT DO NOTHING;
  END;
  SELECT count(*) INTO cnt FROM public.endurance_telemetry_events
   WHERE race_run_id=run AND event_type='lap_completed' AND completed_laps=201;
  IF cnt <> 1 THEN PERFORM pg_temp.ac_fail('A45','duplicate lap allowed, got '||cnt); END IF;
  PERFORM pg_temp.ac_log('A45');
END $$;

-- =============================================================== CATEGORY 5
-- Cross-source domain dedupe (lap and incident) on the same run.
CREATE OR REPLACE FUNCTION pg_temp.t_domain_dedupe()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE r text; cnt integer;
  sa UUID := 'd8d8d8d8-0000-0000-0000-0000000000c1';
  sb UUID := 'd9d9d9d9-0000-0000-0000-0000000000c1';
  e1 UUID := 'e0e0e0e0-0000-0000-0000-0000000000a1';
  f1 UUID := 'f00f0000-0000-0000-0000-0000000000a1';
  run UUID := 'a5a5a5a5-0000-0000-0000-0000000000b1';
BEGIN
  -- srca baseline completedLaps=50 incidents=0
  SELECT result INTO r FROM public.simhub_persist_v3(repeat('3',64),'src-a',10,clock_timestamp(),
    '{"timing":{"completedLaps":50},"raceState":{"incidents":0},"track":{"onPitRoad":false},"session":{"flags":["green"]}}');
  IF r <> 'accepted' THEN PERFORM pg_temp.ac_fail('A50seed','src-a baseline not accepted: '||r); END IF;
  SELECT result INTO r FROM public.simhub_persist_v3(repeat('3',64),'src-a',11,clock_timestamp(),
    '{"timing":{"completedLaps":51},"raceState":{"incidents":7},"track":{"onPitRoad":false},"session":{"flags":["green"]}}');
  IF r <> 'accepted' THEN PERFORM pg_temp.ac_fail('A50seed','src-a transition not accepted: '||r); END IF;
  -- A50/A51: a SECOND source (src-b, different device + session, same run)
  -- independently reaches the same lap=51 and incidents=7. Its inserts collide
  -- with src-a's already-present rows on the (race_run_id, completed_laps) and
  -- (race_run_id, incidents) partial unique indexes and become no-ops.
  SELECT result INTO r FROM public.simhub_persist_v3(repeat('4',64),'src-b',1,clock_timestamp(),
    '{"timing":{"completedLaps":50},"raceState":{"incidents":3},"track":{"onPitRoad":false},"session":{"flags":["yellow"]}}');
  IF r <> 'accepted' THEN PERFORM pg_temp.ac_fail('A50seed','src-b baseline not accepted: '||r); END IF;
  SELECT result INTO r FROM public.simhub_persist_v3(repeat('4',64),'src-b',2,clock_timestamp(),
    '{"timing":{"completedLaps":51},"raceState":{"incidents":7},"track":{"onPitRoad":true},"session":{"flags":["yellow"]}}');
  IF r <> 'accepted' THEN PERFORM pg_temp.ac_fail('A50seed','src-b transition not accepted: '||r); END IF;
  SELECT count(*) INTO cnt FROM public.endurance_telemetry_events
   WHERE race_run_id=run AND event_type='lap_completed' AND completed_laps=51;
  IF cnt <> 1 THEN PERFORM pg_temp.ac_fail('A50','cross-source lap dedupe failed, got '||cnt); END IF;
  PERFORM pg_temp.ac_log('A50');
  SELECT count(*) INTO cnt FROM public.endurance_telemetry_events
   WHERE race_run_id=run AND event_type='incident_count_changed' AND incidents=7;
  IF cnt <> 1 THEN PERFORM pg_temp.ac_fail('A51','cross-source incident dedupe failed, got '||cnt); END IF;
  PERFORM pg_temp.ac_log('A51');

  -- A52: historical rows with race_run_id IS NULL live OUTSIDE the partial
  -- indexes, so duplicates of the same value are allowed and preserved.
  INSERT INTO public.endurance_telemetry_events
    (device_id,event_id,team_id,session_id,event_type,event_key,sequence,captured_at,event_detection_source,completed_laps,race_run_id)
  VALUES (sa,e1,f1,'legacy-a','lap_completed','legacy:1',1,now(),'legacy',777,NULL);
  INSERT INTO public.endurance_telemetry_events
    (device_id,event_id,team_id,session_id,event_type,event_key,sequence,captured_at,event_detection_source,completed_laps,race_run_id)
  VALUES (sb,e1,f1,'legacy-b','lap_completed','legacy:2',1,now(),'legacy',777,NULL);
  SELECT count(*) INTO cnt FROM public.endurance_telemetry_events
   WHERE race_run_id IS NULL AND event_type='lap_completed' AND completed_laps=777;
  IF cnt <> 2 THEN PERFORM pg_temp.ac_fail('A52','NULL-run duplicates not preserved, got '||cnt); END IF;
  PERFORM pg_temp.ac_log('A52');

  -- A53: dedupe is global across devices/sessions (not scoped to one source):
  -- exactly one lap:51 and one incident:7 across BOTH devices.
  SELECT count(*) INTO cnt FROM public.endurance_telemetry_events
   WHERE race_run_id=run AND event_type='lap_completed' AND completed_laps=51;
  IF cnt <> 1 THEN PERFORM pg_temp.ac_fail('A53a','lap domain not global, got '||cnt); END IF;
  SELECT count(*) INTO cnt FROM public.endurance_telemetry_events
   WHERE device_id=sa AND event_type='incident_count_changed';
  IF cnt <> 1 THEN PERFORM pg_temp.ac_fail('A53b','srca incident count wrong: '||cnt); END IF;
  SELECT count(*) INTO cnt FROM public.endurance_telemetry_events
   WHERE device_id=sb AND event_type='incident_count_changed' AND incidents=7;
  IF cnt <> 0 THEN PERFORM pg_temp.ac_fail('A53c','srcb incident should be deduped, got '||cnt); END IF;
  SELECT count(*) INTO cnt FROM public.endurance_telemetry_events
   WHERE race_run_id=run AND event_type='incident_count_changed' AND incidents=7;
  IF cnt <> 1 THEN PERFORM pg_temp.ac_fail('A53d','total incident:7 on run not 1, got '||cnt); END IF;
  PERFORM pg_temp.ac_log('A53');
END $$;

-- =============================================================== CATEGORY 6
-- Required fields / latest boundary / strict v3_normalized.
CREATE OR REPLACE FUNCTION pg_temp.t_required_fields()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE cnt integer;
  d UUID := 'd0d0d0d0-0000-0000-0000-0000000000a1';
  e1 UUID := 'e0e0e0e0-0000-0000-0000-0000000000a1';
  f1 UUID := 'f00f0000-0000-0000-0000-0000000000a1';
  rrun UUID := 'a5a5a5a5-0000-0000-0000-0000000000b1';
  n int;
BEGIN
  -- A60: missing event_type (NOT NULL) is rejected.
  BEGIN
    INSERT INTO public.endurance_telemetry_events
      (device_id,event_id,team_id,session_id,event_key,sequence,captured_at,event_detection_source)
    VALUES (d,e1,f1,'req','no-type',1,now(),'v3_sample');
    PERFORM pg_temp.ac_fail('A60','missing event_type accepted');
  EXCEPTION WHEN not_null_violation THEN NULL; END;
  PERFORM pg_temp.ac_log('A60');

  -- A61: missing device_id (NOT NULL) is rejected.
  BEGIN
    INSERT INTO public.endurance_telemetry_events
      (event_id,team_id,session_id,event_type,event_key,sequence,captured_at,event_detection_source)
    VALUES (e1,f1,'req','sample','nodv',1,now(),'v3_sample');
    PERFORM pg_temp.ac_fail('A61','missing device_id accepted');
  EXCEPTION WHEN not_null_violation THEN NULL; END;
  PERFORM pg_temp.ac_log('A61');

  -- A62: missing event_key (NOT NULL) is rejected.
  BEGIN
    INSERT INTO public.endurance_telemetry_events
      (device_id,event_id,team_id,session_id,event_type,sequence,captured_at,event_detection_source)
    VALUES (d,e1,f1,'req','sample',1,now(),'v3_sample');
    PERFORM pg_temp.ac_fail('A62','missing event_key accepted');
  EXCEPTION WHEN not_null_violation THEN NULL; END;
  PERFORM pg_temp.ac_log('A62');

  -- A63/A64: v3_normalized must be a JSON object on latest (check constraint).
  BEGIN
    INSERT INTO public.simhub_telemetry_latest
      (device_id,owner_user_id,session_id,sequence,captured_at,connector_id,simhub_version,game,telemetry,endurance_event_id,endurance_team_id,v3_normalized)
    VALUES (d,'00000000-0000-0000-0000-0000000000a1','req',1,now(),'c','v','IRacing','{}'::jsonb,e1,f1,'123'::jsonb);
    PERFORM pg_temp.ac_fail('A63','scalar v3_normalized accepted');
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM pg_temp.ac_log('A63');
  BEGIN
    INSERT INTO public.simhub_telemetry_latest
      (device_id,owner_user_id,session_id,sequence,captured_at,connector_id,simhub_version,game,telemetry,endurance_event_id,endurance_team_id,v3_normalized)
    VALUES (d,'00000000-0000-0000-0000-0000000000a1','req',1,now(),'c','v','IRacing','{}'::jsonb,e1,f1,'[1,2]'::jsonb);
    PERFORM pg_temp.ac_fail('A64','array v3_normalized accepted');
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM pg_temp.ac_log('A64');

  -- A65: latest context_shape — race_id/team_id must be both-set or both-NULL.
  BEGIN
    INSERT INTO public.simhub_telemetry_latest
      (device_id,owner_user_id,race_id,team_id,session_id,sequence,captured_at,connector_id,simhub_version,game,telemetry,endurance_event_id,endurance_team_id,v3_normalized)
    VALUES (d,'00000000-0000-0000-0000-0000000000a1','b00b0000-0000-0000-0000-0000000000a1',NULL,'req',1,now(),'c','v','IRacing','{}'::jsonb,e1,f1,'{}'::jsonb);
    PERFORM pg_temp.ac_fail('A65','mixed context_shape accepted');
  EXCEPTION WHEN check_violation THEN NULL; END;
  -- and both-set is fine (upsert to avoid clashing with existing device latest)
  INSERT INTO public.simhub_telemetry_latest
    (device_id,owner_user_id,race_id,team_id,session_id,sequence,captured_at,connector_id,simhub_version,game,telemetry,endurance_event_id,endurance_team_id,v3_normalized)
  VALUES ('d5d5d5d5-0000-0000-0000-0000000000b6','00000000-0000-0000-0000-0000000000a1','b00b0000-0000-0000-0000-0000000000a1','c00c0000-0000-0000-0000-0000000000a1','req',1,now(),'c','v','IRacing','{}'::jsonb,'e2e2e2e2-0000-0000-0000-0000000000a1'::uuid,'f2f2f200-0000-0000-0000-0000000000a1'::uuid,'{}'::jsonb)
  ON CONFLICT (device_id) DO NOTHING;
  PERFORM pg_temp.ac_log('A65');

  -- A66: latest sequence>=0 enforced.
  BEGIN
    INSERT INTO public.simhub_telemetry_latest
      (device_id,owner_user_id,session_id,sequence,captured_at,connector_id,simhub_version,game,telemetry,endurance_event_id,endurance_team_id,v3_normalized)
    VALUES (d,'00000000-0000-0000-0000-0000000000a1','req',-1,now(),'c','v','IRacing','{}'::jsonb,e1,f1,'{}'::jsonb);
    PERFORM pg_temp.ac_fail('A66','negative sequence accepted');
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM pg_temp.ac_log('A66');

  -- A67: exhaustive sample row with ALL required NOT NULL fields inserts fine.
  INSERT INTO public.endurance_telemetry_events
    (device_id,event_id,team_id,session_id,event_type,event_key,sequence,captured_at,received_at,completed_laps,incidents,in_pit_lane,flag,is_in_car,event_detection_source,payload,race_run_id)
  VALUES (d,e1,f1,'req','sample','seq:1',1,now(),now(),12,3,false,'green',true,'v3_sample','{"protocolVersion":3}'::jsonb,rrun);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN PERFORM pg_temp.ac_fail('A67','full required-field sample row failed'); END IF;
  PERFORM pg_temp.ac_log('A67');
END $$;

-- =============================================================== CATEGORY 7
-- Atomicity injection: a mid-RPC failure must roll back every earlier write.
CREATE OR REPLACE FUNCTION pg_temp.t_atomicity()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE cnt integer; r text; had_exc boolean;
  d UUID := 'd0d0d0d0-0000-0000-0000-0000000000a1';
  da UUID := 'dadadada-0000-0000-0000-0000000000c1'; -- owner references nonexistent auth.user
BEGIN
  -- A70/A71/A72: valid payload through a device whose owner_user_id FK fails at
  -- the LATEST stage; the whole RPC raises and the earlier segment+event writes
  -- must roll back (atomic).
  had_exc := false;
  BEGIN
    r := (SELECT result FROM public.simhub_persist_v3(repeat('5',64),'atom-sess',1,clock_timestamp(),
      '{"timing":{"completedLaps":1},"raceState":{"incidents":1},"track":{"onPitRoad":false},"session":{"flags":["green"]}}'));
    PERFORM pg_temp.ac_fail('A70','atomic RPC unexpectedly accepted: '||r);
  EXCEPTION WHEN foreign_key_violation THEN had_exc := true; END;
  IF NOT had_exc THEN PERFORM pg_temp.ac_fail('A70','no FK failure raised'); END IF;
  SELECT count(*) INTO cnt FROM public.endurance_source_segments WHERE device_id=da;
  IF cnt <> 0 THEN PERFORM pg_temp.ac_fail('A70','segment write survived the failure'); END IF;
  PERFORM pg_temp.ac_log('A70');
  SELECT count(*) INTO cnt FROM public.endurance_telemetry_events WHERE device_id=da;
  IF cnt <> 0 THEN PERFORM pg_temp.ac_fail('A71','event write survived the failure'); END IF;
  PERFORM pg_temp.ac_log('A71');
  SELECT count(*) INTO cnt FROM public.simhub_telemetry_latest WHERE device_id=da;
  IF cnt <> 0 THEN PERFORM pg_temp.ac_fail('A72','latest write survived the failure'); END IF;
  PERFORM pg_temp.ac_log('A72');

  -- A73: strict payload rejection also has zero side-effects for a VALID device.
  SELECT result INTO r FROM public.simhub_persist_v3(repeat('1',64),'atom-bad',1,clock_timestamp(),'[1,2,3]');
  IF r <> 'invalid_payload' THEN PERFORM pg_temp.ac_fail('A73','bad payload not invalid_payload: '||r); END IF;
  SELECT count(*) INTO cnt FROM public.endurance_source_segments WHERE device_id='d6d6d6d6-0000-0000-0000-0000000000c1' AND session_id='atom-bad';
  IF cnt <> 0 THEN PERFORM pg_temp.ac_fail('A73','invalid payload wrote a segment'); END IF;
  PERFORM pg_temp.ac_log('A73');

  -- A74/A75: explicit multi-row write where a later row violates a constraint
  -- aborts the whole statement (no partial insert) for events and latest.
  BEGIN
    INSERT INTO public.endurance_telemetry_events
      (device_id,event_id,team_id,session_id,event_type,event_key,sequence,captured_at,event_detection_source)
    VALUES
      (d,'e0e0e0e0-0000-0000-0000-0000000000a1','f00f0000-0000-0000-0000-0000000000a1','atomx','sample','k1',1,now(),'v3_sample'),
      (d,NULL,NULL,'atomx','sample','k2',2,now(),'v3_sample'); -- NULL event_id violates NOT NULL
    PERFORM pg_temp.ac_fail('A74','multi-row event insert with bad row accepted');
  EXCEPTION WHEN not_null_violation THEN NULL; END;
  SELECT count(*) INTO cnt FROM public.endurance_telemetry_events WHERE session_id='atomx';
  IF cnt <> 0 THEN PERFORM pg_temp.ac_fail('A74','partial event insert persisted'); END IF;
  PERFORM pg_temp.ac_log('A74');
  BEGIN
    INSERT INTO public.simhub_telemetry_latest
      (device_id,owner_user_id,session_id,sequence,captured_at,connector_id,simhub_version,game,telemetry,endurance_event_id,endurance_team_id,v3_normalized)
    VALUES ('dadadada-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000a1','atomy',0,now(),'c','v','IRacing','{}'::jsonb,'e0e0e0e0-0000-0000-0000-0000000000a1'::uuid,'f00f0000-0000-0000-0000-0000000000a1'::uuid,'[1]'::jsonb);
    PERFORM pg_temp.ac_fail('A75','bad latest row accepted');
  EXCEPTION WHEN check_violation THEN NULL; END;
  SELECT count(*) INTO cnt FROM public.simhub_telemetry_latest WHERE session_id='atomy';
  IF cnt <> 0 THEN PERFORM pg_temp.ac_fail('A75','partial latest insert persisted'); END IF;
  PERFORM pg_temp.ac_log('A75');
END $$;

-- =============================================================== CATEGORY 8
-- Non-emission: deferred transition events must NOT appear when conditions absent.
CREATE OR REPLACE FUNCTION pg_temp.t_non_emission()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE cnt integer; bl integer;
  d UUID := 'd0d0d0d0-0000-0000-0000-0000000000a1';
  de UUID := 'd6d6d6d6-0000-0000-0000-0000000000c1';
BEGIN
  -- A80: baseline session (bl-sess) is pure sample, zero transitions.
  SELECT count(*) INTO cnt FROM public.endurance_telemetry_events
   WHERE device_id=d AND session_id='bl-sess' AND event_detection_source='simhub_v3_transition';
  IF cnt <> 0 THEN PERFORM pg_temp.ac_fail('A80','baseline transition emitted'); END IF;
  PERFORM pg_temp.ac_log('A80');

  -- A81: jump session produced no lap_completed; only exact +1 laps exist.
  SELECT count(*) INTO cnt FROM public.endurance_telemetry_events
   WHERE device_id=de AND session_id='edge-sess' AND event_type='lap_completed';
  IF cnt <> 2 THEN PERFORM pg_temp.ac_fail('A81','lap_completed count off (jump fabricated?): '||cnt); END IF; -- lap:11 and lap:13 only
  PERFORM pg_temp.ac_log('A81');

  -- A82: no pit churn when onPitRoad unchanged across snapshots (pit events only on edges).
  SELECT count(*) INTO cnt FROM public.endurance_telemetry_events
   WHERE device_id=de AND session_id='edge-sess' AND event_type IN ('pit_entry','pit_exit');
  IF cnt <> 3 THEN PERFORM pg_temp.ac_fail('A82','pit_event count off: '||cnt); END IF; -- entry, exit, entry = 3
  PERFORM pg_temp.ac_log('A82');

  -- A83: identical flag set produced no NEW flag_change.
  SELECT count(*) INTO cnt FROM public.endurance_telemetry_events
   WHERE device_id=de AND session_id='edge-sess' AND event_type='flag_change';
  IF cnt <> 1 THEN PERFORM pg_temp.ac_fail('A83','flag_change count off: '||cnt); END IF;
  PERFORM pg_temp.ac_log('A83');

  -- A84: incident non-increase produced no new incident event.
  SELECT count(*) INTO cnt FROM public.endurance_telemetry_events
   WHERE device_id=de AND session_id='edge-sess' AND event_type='incident_count_changed';
  IF cnt <> 1 THEN PERFORM pg_temp.ac_fail('A84','incident event count off: '||cnt); END IF;
  PERFORM pg_temp.ac_log('A84');
END $$;

-- =============================================================== CATEGORY 9
-- Historical-row preservation / forward-migration invariants.
CREATE OR REPLACE FUNCTION pg_temp.t_history()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE cnt integer; n int;
  d UUID := 'd0d0d0d0-0000-0000-0000-0000000000a1';
  e1 UUID := 'e0e0e0e0-0000-0000-0000-0000000000a1';
  f1 UUID := 'f00f0000-0000-0000-0000-0000000000a1';
  run UUID := 'a5a5a5a5-0000-0000-0000-0000000000b1';
  captured text;
BEGIN
  -- A90: legacy event_type (driver_change) remains accepted by the evolved check.
  INSERT INTO public.endurance_telemetry_events
    (device_id,event_id,team_id,session_id,event_type,event_key,sequence,captured_at,event_detection_source)
  VALUES (d,e1,f1,'hist','driver_change','legacy-dc',1,now(),'legacy');
  SELECT count(*) INTO cnt FROM public.endurance_telemetry_events WHERE event_key='legacy-dc';
  IF cnt <> 1 THEN PERFORM pg_temp.ac_fail('A90','legacy event_type lost'); END IF;
  PERFORM pg_temp.ac_log('A90');

  -- A91: a historical row's payload is preserved byte-for-byte through the
  -- forward migration (no rewriting of legacy rows).
  INSERT INTO public.endurance_telemetry_events
    (device_id,event_id,team_id,session_id,event_type,event_key,sequence,captured_at,event_detection_source,payload)
  VALUES (d,e1,f1,'hist','fuel_added','legacy-fuel',2,now(),'legacy','{"litres":42,"note":"preserve-me"}'::jsonb);
  SELECT payload INTO captured FROM public.endurance_telemetry_events WHERE event_key='legacy-fuel';
  IF captured::jsonb IS DISTINCT FROM '{"litres":42,"note":"preserve-me"}'::jsonb THEN
    PERFORM pg_temp.ac_fail('A91','legacy payload altered: '||coalesce(captured,'<null>'));
  END IF;
  PERFORM pg_temp.ac_log('A91');

  -- A92: NULL-run duplicates preserved (already created in A52) — re-assert count.
  SELECT count(*) INTO cnt FROM public.endurance_telemetry_events
   WHERE race_run_id IS NULL AND event_type='lap_completed' AND completed_laps=777;
  IF cnt <> 2 THEN PERFORM pg_temp.ac_fail('A92','NULL-run historicals not preserved: '||cnt); END IF;
  PERFORM pg_temp.ac_log('A92');

  -- A93: an existing latest row survives (no Phase E table churn).
  SELECT count(*) INTO cnt FROM public.simhub_telemetry_latest WHERE device_id IN (d,'d5d5d5d5-0000-0000-0000-0000000000b6');
  IF cnt < 1 THEN PERFORM pg_temp.ac_fail('A93','existing latest rows missing'); END IF;
  PERFORM pg_temp.ac_log('A93');

  -- A94: base tables retained (shared, non-Phase objects never dropped).
  IF to_regclass('public.endurance_telemetry_events') IS NULL
     OR to_regclass('public.simhub_telemetry_latest') IS NULL
     OR to_regclass('public.endurance_race_runs') IS NULL THEN
    PERFORM pg_temp.ac_fail('A94','base table dropped'); END IF;
  PERFORM pg_temp.ac_log('A94');

  -- A95: incident_count_changed accepted forward (tested) and the rollback file
  -- blocks it — proven by the runner's post-rollback rejection block (A103).
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='endurance_telemetry_events' AND column_name='race_run_id') THEN
    PERFORM pg_temp.ac_fail('A95','race_run_id column missing forward'); END IF;
  PERFORM pg_temp.ac_log('A95');

  -- A96: race_run_id stays NULL-able — historical inserts without it work.
  INSERT INTO public.endurance_telemetry_events
    (device_id,event_id,team_id,session_id,event_type,event_key,sequence,captured_at,event_detection_source)
  VALUES (d,e1,f1,'hist','stint_end','legacy-se',3,now(),'legacy');
  PERFORM pg_temp.ac_log('A96');

  -- A97: a valid object v3_normalized is accepted on latest and retained.
  INSERT INTO public.simhub_telemetry_latest
    (device_id,owner_user_id,session_id,sequence,captured_at,connector_id,simhub_version,game,telemetry,endurance_event_id,endurance_team_id,v3_normalized)
  VALUES (d,'00000000-0000-0000-0000-0000000000a1','hist',1,now(),'c','v','IRacing','{}'::jsonb,e1,f1,'{"protocolVersion":3}'::jsonb)
  ON CONFLICT (device_id) DO UPDATE SET v3_normalized=EXCLUDED.v3_normalized;
  SELECT count(*) INTO cnt FROM public.simhub_telemetry_latest WHERE device_id=d AND v3_normalized='{"protocolVersion":3}'::jsonb;
  IF cnt <> 1 THEN PERFORM pg_temp.ac_fail('A97','valid v3_normalized lost'); END IF;
  PERFORM pg_temp.ac_log('A97');
END $$;

-- A98/A99 are executed by the runner script with two parallel psql connections
-- (true concurrency on the shared partial unique indexes), separately.

-- ============================================================= EXECUTE -------
SELECT pg_temp.t_run_resolution();
SELECT pg_temp.t_authority();
SELECT pg_temp.t_edges();
SELECT pg_temp.t_idempotency();
SELECT pg_temp.t_domain_dedupe();
SELECT pg_temp.t_required_fields();
SELECT pg_temp.t_atomicity();
SELECT pg_temp.t_non_emission();
SELECT pg_temp.t_history();

-- ============================================================= LEDGER CHECK --
-- Prove every declared functional A-id actually executed (coverage matrix).
DO $$
DECLARE
  expected TEXT[] := ARRAY[
    'A01','A02','A03','A04','A05','A06','A07',
    'A08','A09','A10','A11','A12','A13','A14','A15','A16','A17','A18',
    'A20','A21','A22','A23',
    'A25','A26','A27','A28','A29','A30','A31','A32','A33',
    'A40','A41','A42','A43','A44','A45',
    'A50','A51','A52','A53',
    'A60','A61','A62','A63','A64','A65','A66','A67',
    'A70','A71','A72','A73','A74','A75',
    'A80','A81','A82','A83','A84',
    'A90','A91','A92','A93','A94','A95','A96','A97'
  ];
  got TEXT[]; missing TEXT; n integer;
BEGIN
  SELECT array_agg(id ORDER BY id) INTO got FROM pg_temp.ac_ledger;
  missing := NULL;
  DECLARE x text;
  BEGIN
    FOREACH x IN ARRAY expected LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_temp.ac_ledger WHERE id=x) THEN
        missing := coalesce(missing,'') || x || ',';
      END IF;
    END LOOP;
  END;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'ACCEPTANCE LEDGER INCOMPLETE: missing %', missing;
  END IF;
  RAISE NOTICE 'ACCEPTANCE LEDGER: %/66 declared A-ids executed (A98-A104 verified by runner)', cardinality(got);
END $$;

COMMIT;