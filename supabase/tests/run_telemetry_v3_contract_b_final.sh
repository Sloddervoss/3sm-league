#!/usr/bin/env bash
# Full regression + Contract B test suite
set -euo pipefail

export PATH="/home/hermes/rpms/pg15/usr/pgsql-15/bin:$PATH"
export LD_LIBRARY_PATH="/home/hermes/rpms/pg15/usr/pgsql-15/lib:/home/hermes/rpms/icu67/usr/lib/x86_64-linux-gnu"
PSQL=(psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 55432 -U postgres)
ROOT="/home/hermes/projects/3sm-league"
DB="test_phase_f"

FIXTURE="$ROOT/supabase/tests/fixtures/pre_phase_e_telemetry_production_baseline.sql"
ME="$ROOT/supabase/migrations/20260902190000_endurance_v3_persistence.sql"
RE="$ROOT/supabase/rollback/20260902190000_endurance_v3_persistence.rollback.sql"
MF="$ROOT/supabase/migrations/20260902220000_endurance_v3_strategy.sql"
RF="$ROOT/supabase/rollback/20260902220000_endurance_v3_strategy.rollback.sql"
M_RLS="$ROOT/supabase/migrations/20260902220001_endurance_v3_strategy_rls_compat.sql"
M_TEAM_READ="$ROOT/supabase/migrations/20260902220002_endurance_v3_strategy_team_read.sql"
R_TEAM_READ="$ROOT/supabase/rollback/20260902220002_endurance_v3_strategy_team_read.rollback.sql"
R_RLS="$ROOT/supabase/rollback/20260902220001_endurance_v3_strategy_rls_compat.rollback.sql"
TEST_EP="$ROOT/supabase/tests/telemetry_v3_persistence_test.sql"
TEST_EA="$ROOT/supabase/tests/telemetry_v3_acceptance_test.sql"
TEST_F="$ROOT/supabase/tests/telemetry_v3_strategy_test.sql"
TEST_BR="$ROOT/supabase/tests/pre_phase_e_telemetry_production_baseline_test.sql"

dropdb --if-exists -h 127.0.0.1 -p 55432 -U postgres "$DB" 2>/dev/null
createdb -h 127.0.0.1 -p 55432 -U postgres "$DB"
echo "--- created disposable db $DB ---"

# Fixture
"${PSQL[@]}" -d "$DB" -f "$FIXTURE" >/dev/null
"${PSQL[@]}" -d "$DB" -c "ALTER ROLE service_role BYPASSRLS;" >/dev/null

# Stubs
"${PSQL[@]}" -d "$DB" <<'STUBS' >/dev/null
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT COALESCE(current_setting('request.jwt.claim.role', true), 'anon') $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.sub', true),'')::uuid, '00000000-0000-0000-0000-000000000000') $$;
REVOKE ALL ON FUNCTION auth.uid() FROM PUBLIC; GRANT ALL ON FUNCTION auth.uid() TO authenticated;
ALTER TABLE public.simhub_devices ADD COLUMN token_hash text, ADD COLUMN revoked_at timestamptz, ADD COLUMN endurance_event_id uuid, ADD COLUMN endurance_team_id uuid, ADD COLUMN owner_user_id uuid, ADD COLUMN race_id uuid, ADD COLUMN team_id uuid, ADD COLUMN device_status text DEFAULT 'active_binding', ADD COLUMN device_role text DEFAULT 'primary', ADD COLUMN connector_id text DEFAULT 'test', ADD COLUMN device_name text DEFAULT 'test', ADD COLUMN last_seen_at timestamptz, ADD COLUMN last_session_id text, ADD COLUMN last_sequence bigint, ADD COLUMN updated_at timestamptz;
CREATE TABLE public.endurance_registrations (event_id uuid NOT NULL, user_id uuid NOT NULL, status text NOT NULL);
CREATE TABLE public.simhub_device_sessions (device_id uuid NOT NULL, session_id text NOT NULL, last_sequence bigint NOT NULL, first_seen_at timestamptz NOT NULL, last_seen_at timestamptz NOT NULL, PRIMARY KEY(device_id,session_id));
GRANT ALL ON public.simhub_devices, public.endurance_registrations, public.simhub_device_sessions TO service_role;
GRANT ALL ON public.endurance_teams, public.endurance_events TO service_role;
CREATE TYPE public.endurance_run_kind AS ENUM ('practice','qualifying','race');
CREATE TYPE public.endurance_race_run_status AS ENUM ('active','completed','ended','cancelled');
CREATE TABLE public.endurance_race_runs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES public.endurance_events(id), team_id uuid NOT NULL REFERENCES public.endurance_teams(id), run_kind public.endurance_run_kind NOT NULL, status public.endurance_race_run_status NOT NULL DEFAULT 'active');
GRANT ALL ON public.endurance_race_runs TO service_role;
CREATE OR REPLACE FUNCTION public.authorized_role_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE OR REPLACE FUNCTION public.authorized_role(p_uid uuid, p_role text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION public.user_teams() RETURNS SETOF uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid WHERE false $$;
CREATE OR REPLACE FUNCTION public.simhub_get_active_race_run(p_event_id uuid, p_team_id uuid, p_run_kind text) RETURNS TABLE(id uuid) LANGUAGE sql STABLE AS $$ SELECT id FROM public.endurance_race_runs WHERE event_id = p_event_id AND team_id = p_team_id AND run_kind::text = p_run_kind AND status = 'active' LIMIT 1 $$;
CREATE TABLE IF NOT EXISTS public.user_roles (user_id uuid NOT NULL, role text NOT NULL, UNIQUE(user_id, role));
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY; GRANT ALL ON public.user_roles TO service_role, authenticated;
CREATE OR REPLACE FUNCTION public.is_endurance_staff(_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _user_id AND r.role = ANY ('{super_admin,endurance_manager,tester}'::text[])) $$;
REVOKE ALL ON FUNCTION public.is_endurance_staff(uuid) FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION public.is_endurance_staff(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.is_endurance_manager(_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _user_id AND r.role = ANY ('{super_admin,endurance_manager}'::text[])) $$;
REVOKE ALL ON FUNCTION public.is_endurance_manager(uuid) FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION public.is_endurance_manager(uuid) TO authenticated;
CREATE TABLE IF NOT EXISTS public.endurance_team_members (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), team_id UUID NOT NULL REFERENCES public.endurance_teams(id) ON DELETE CASCADE, user_id UUID NOT NULL, role TEXT NOT NULL DEFAULT 'driver', UNIQUE (team_id, user_id));
GRANT ALL ON public.endurance_team_members TO service_role, authenticated;
STUBS
"${PSQL[@]}" -d "$DB" -c "INSERT INTO auth.users(id) VALUES ('00000000-0000-0000-0000-0000000000a1') ON CONFLICT DO NOTHING;" >/dev/null
echo "stubs applied"

# Precondition
ABSENT=$("${PSQL[@]}" -d "$DB" -Atc "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='endurance_telemetry_events' AND column_name='race_run_id';")
[ "$ABSENT" = "0" ]
echo "PASS precondition"

# Baseline
"${PSQL[@]}" -d "$DB" -f "$TEST_BR" | grep -v NOTICE
echo "PASS BR01-BR21"

# Phase E + F + RLS + Team-read
"${PSQL[@]}" -d "$DB" -f "$ME" >/dev/null
"${PSQL[@]}" -d "$DB" -f "$MF" >/dev/null
"${PSQL[@]}" -d "$DB" -f "$M_RLS" >/dev/null
"${PSQL[@]}" -d "$DB" -f "$M_TEAM_READ" >/dev/null
echo "applied migrations E+F+RLS+team-read"

# Verify policy state
POL_TEAM=$("${PSQL[@]}" -d "$DB" -Atc "
  SELECT pg_get_expr(p.polqual, c.oid)
  FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname='endurance_strategy_latest' AND p.polname='endurance_strategy_latest_team_read';")
case "$POL_TEAM" in
  *endurance_team_members*) echo "PASS team_read uses own-team membership: $POL_TEAM" ;;
  *) echo "FAIL team_read wrong: $POL_TEAM"; exit 1 ;;
esac
POL_STAFF=$("${PSQL[@]}" -d "$DB" -Atc "
  SELECT pg_get_expr(p.polqual, c.oid)
  FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname='endurance_strategy_latest' AND p.polname='endurance_strategy_latest_staff_read';")
case "$POL_STAFF" in
  *is_endurance_staff*) echo "PASS staff_read: $POL_STAFF" ;;
  *) echo "FAIL staff_read wrong: $POL_STAFF"; exit 1 ;;
esac

# Phase E persistence + Phase F strategy + Phase E acceptance
"${PSQL[@]}" -d "$DB" -f "$TEST_EP" | grep -v NOTICE | grep '.'
echo "PASS P01-P20"
"${PSQL[@]}" -d "$DB" -f "$TEST_F" | grep -v NOTICE | grep '.'
echo "PASS Phase F strategy tests"
"${PSQL[@]}" -d "$DB" -f "$TEST_EA" | grep -v NOTICE | grep '.'
echo "PASS A01-A97"

# ---- Contract B fixtures & verification -----
# Create users/teams/memberships via service_role
"${PSQL[@]}" -d "$DB" >/dev/null <<FIX
INSERT INTO auth.users(id) VALUES ('aaaaaaaa-0000-0000-0000-0000000000aa'),('bbbbbbbb-0000-0000-0000-0000000000bb'),('cccccccc-0000-0000-0000-0000000000cc'),('dddddddd-0000-0000-0000-0000000000dd') ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles(user_id,role) VALUES ('aaaaaaaa-0000-0000-0000-0000000000aa','endurance_manager') ON CONFLICT DO NOTHING;
INSERT INTO public.endurance_events(id) VALUES ('eeeeeeee-0000-0000-0000-000000000001') ON CONFLICT DO NOTHING;
INSERT INTO public.endurance_teams(id) VALUES ('eeeeeeee-0000-0000-0000-0000000000a1'),('eeeeeeee-0000-0000-0000-0000000000b1') ON CONFLICT DO NOTHING;
INSERT INTO public.endurance_team_members(id,team_id,user_id,role) VALUES (gen_random_uuid(),'eeeeeeee-0000-0000-0000-0000000000a1','bbbbbbbb-0000-0000-0000-0000000000bb','driver'),(gen_random_uuid(),'eeeeeeee-0000-0000-0000-0000000000b1','cccccccc-0000-0000-0000-0000000000cc','driver') ON CONFLICT DO NOTHING;
INSERT INTO public.endurance_race_runs(id,event_id,team_id,run_kind,status) VALUES ('aaaaaaaa-0000-0000-0000-0000000000aa','eeeeeeee-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-0000000000a1','race','active'),('bbbbbbbb-0000-0000-0000-0000000000bb','eeeeeeee-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-0000000000b1','race','active') ON CONFLICT DO NOTHING;
SET ROLE service_role; SET SESSION request.jwt.claim.role='service_role';
INSERT INTO public.endurance_strategy_latest(race_run_id,event_id,team_id) VALUES ('aaaaaaaa-0000-0000-0000-0000000000aa','eeeeeeee-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-0000000000a1'),('bbbbbbbb-0000-0000-0000-0000000000bb','eeeeeeee-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-0000000000b1') ON CONFLICT (race_run_id) DO NOTHING;
INSERT INTO public.endurance_strategy_lap_samples(race_run_id,completed_laps,event_id,team_id,source_device_id,source_session_id,source_sequence,fuel_stint_id,captured_at) VALUES ('aaaaaaaa-0000-0000-0000-0000000000aa',1,'eeeeeeee-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-0000000000a1','f1000000-0000-0000-0000-0000000000f1','sess',1,1,now()),('bbbbbbbb-0000-0000-0000-0000000000bb',1,'eeeeeeee-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-0000000000b1','f1000000-0000-0000-0000-0000000000f1','sess2',1,1,now()) ON CONFLICT DO NOTHING;
RESET ROLE; RESET request.jwt.claim.role; RESET request.jwt.claim.sub;
FIX
echo "Contract B fixture loaded"

# RUN R01-R14
FAIL=0
r() {
  local desc="$1" cmd="$2" expected="$3"; shift 3
  local out tmp=$(mktemp)
  "${PSQL[@]}" -d "$DB" -Atc "$cmd" >"$tmp" 2>/dev/null
  local rc=$?
  out=$(cat "$tmp" | tail -1); rm "$tmp"
  case "$expected" in
    rows:*) local min=${expected#rows:}; [ "$out" -ge "$min" ] 2>/dev/null && echo "PASS $desc (got $out)" || { echo "FAIL $desc: got $out (expected >=$min)"; FAIL=1; } ;;
    deny*) [ "$rc" != 0 ] && echo "PASS $desc (denied)" || { echo "FAIL $desc: expected denial, got: $out"; FAIL=1; } ;;
    zero*) [ "$out" = "0" ] && echo "PASS $desc (0 rows)" || { echo "FAIL $desc: got $out rows (expected 0)"; FAIL=1; } ;;
    *) [ "$out" = "$expected" ] && echo "PASS $desc" || { echo "FAIL $desc: got \"$out\" (expected \"$expected\")"; FAIL=1; } ;;
  esac
}

r "R01: staff reads Team A" "SET ROLE authenticated; SET SESSION request.jwt.claim.role='authenticated'; SET SESSION request.jwt.claim.sub='aaaaaaaa-0000-0000-0000-0000000000aa'; SELECT count(*) FROM public.endurance_strategy_latest WHERE team_id='eeeeeeee-0000-0000-0000-0000000000a1';" "rows:1"
r "R02: staff reads Team B" "SET ROLE authenticated; SET SESSION request.jwt.claim.role='authenticated'; SET SESSION request.jwt.claim.sub='aaaaaaaa-0000-0000-0000-0000000000aa'; SELECT count(*) FROM public.endurance_strategy_latest WHERE team_id='eeeeeeee-0000-0000-0000-0000000000b1';" "rows:1"
r "R03: User A reads own Team A" "SET ROLE authenticated; SET SESSION request.jwt.claim.role='authenticated'; SET SESSION request.jwt.claim.sub='bbbbbbbb-0000-0000-0000-0000000000bb'; SELECT count(*) FROM public.endurance_strategy_latest WHERE team_id='eeeeeeee-0000-0000-0000-0000000000a1';" "rows:1"
r "R04: User A blocked from Team B" "SET ROLE authenticated; SET SESSION request.jwt.claim.role='authenticated'; SET SESSION request.jwt.claim.sub='bbbbbbbb-0000-0000-0000-0000000000bb'; SELECT count(*) FROM public.endurance_strategy_latest WHERE team_id='eeeeeeee-0000-0000-0000-0000000000b1';" "zero:0"
r "R05: User B reads own Team B" "SET ROLE authenticated; SET SESSION request.jwt.claim.role='authenticated'; SET SESSION request.jwt.claim.sub='cccccccc-0000-0000-0000-0000000000cc'; SELECT count(*) FROM public.endurance_strategy_latest WHERE team_id='eeeeeeee-0000-0000-0000-0000000000b1';" "rows:1"
r "R06: User B blocked from Team A" "SET ROLE authenticated; SET SESSION request.jwt.claim.role='authenticated'; SET SESSION request.jwt.claim.sub='cccccccc-0000-0000-0000-0000000000cc'; SELECT count(*) FROM public.endurance_strategy_latest WHERE team_id='eeeeeeee-0000-0000-0000-0000000000a1';" "zero:0"
r "R07: non-member sees 0 rows" "SET ROLE authenticated; SET SESSION request.jwt.claim.role='authenticated'; SET SESSION request.jwt.claim.sub='dddddddd-0000-0000-0000-0000000000dd'; SELECT count(*) FROM public.endurance_strategy_latest;" "zero:0"
r "R08: anon denied" "SET ROLE anon; SET SESSION request.jwt.claim.role='anon'; SELECT count(*) FROM public.endurance_strategy_latest;" "deny:1"
r "R09: team member INSERT denied" "SET ROLE authenticated; SET SESSION request.jwt.claim.role='authenticated'; SET SESSION request.jwt.claim.sub='bbbbbbbb-0000-0000-0000-0000000000bb'; INSERT INTO public.endurance_strategy_latest(race_run_id,event_id,team_id) VALUES ('ffffffff-0000-0000-0000-0000000000ff','eeeeeeee-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-0000000000a1');" "deny:1"
r "R10: team member UPDATE denied" "SET ROLE authenticated; SET SESSION request.jwt.claim.role='authenticated'; SET SESSION request.jwt.claim.sub='bbbbbbbb-0000-0000-0000-0000000000bb'; UPDATE public.endurance_strategy_latest SET strategy_status='ready' WHERE race_run_id='aaaaaaaa-0000-0000-0000-0000000000aa';" "deny:1"
r "R11: team member DELETE denied" "SET ROLE authenticated; SET SESSION request.jwt.claim.role='authenticated'; SET SESSION request.jwt.claim.sub='bbbbbbbb-0000-0000-0000-0000000000bb'; DELETE FROM public.endurance_strategy_latest WHERE race_run_id='aaaaaaaa-0000-0000-0000-0000000000aa';" "deny:1"
"${PSQL[@]}" -d "$DB" -Atc "SET ROLE service_role; SET SESSION request.jwt.claim.role='service_role'; UPDATE public.endurance_strategy_latest SET strategy_status='ready' WHERE race_run_id='aaaaaaaa-0000-0000-0000-0000000000aa';" >/dev/null
r "R12: service_role mutation" "SET ROLE service_role; SET SESSION request.jwt.claim.role='service_role'; SELECT count(*) FROM public.endurance_strategy_latest WHERE strategy_status='ready' AND race_run_id='aaaaaaaa-0000-0000-0000-0000000000aa';" "rows:1"
r "R13: lap_samples backend-only" "SET ROLE authenticated; SET SESSION request.jwt.claim.role='authenticated'; SET SESSION request.jwt.claim.sub='bbbbbbbb-0000-0000-0000-0000000000bb'; SELECT count(*) FROM public.endurance_strategy_lap_samples;" "deny:1"
r "R14: exact 1 own-team row" "SET ROLE authenticated; SET SESSION request.jwt.claim.role='authenticated'; SET SESSION request.jwt.claim.sub='bbbbbbbb-0000-0000-0000-0000000000bb'; SELECT count(*) FROM public.endurance_strategy_latest;" "1"

if [ "$FAIL" = "1" ]; then echo "CONTRACT B TESTS: FAIL"; exit 1; fi
echo "CONTRACT B TESTS R01-R14: ALL PASS"

# ---- RPC/rollback persistence test -----
"${PSQL[@]}" -d "$DB" -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
BEGIN;
INSERT INTO auth.users(id) VALUES ('e1010101-0000-0000-0000-0000000000b1') ON CONFLICT DO NOTHING;
INSERT INTO public.simhub_devices(id,token_hash,owner_user_id,endurance_event_id,endurance_team_id,device_status,device_role,connector_id,device_name) VALUES ('e1010101-0000-0000-0000-0000000000b1',repeat('f',64),'e1010101-0000-0000-0000-0000000000b1','e0e0e0e0-0000-0000-0000-0000000000a1','f00f0000-0000-0000-0000-0000000000a1','active_binding','primary','test','test');
INSERT INTO public.endurance_registrations VALUES ('e0e0e0e0-0000-0000-0000-0000000000a1','e1010101-0000-0000-0000-0000000000b1','accepted');
INSERT INTO public.endurance_events(id) VALUES ('e0e0e0e0-0000-0000-0000-0000000000a1') ON CONFLICT DO NOTHING;
INSERT INTO public.endurance_teams(id) VALUES ('f00f0000-0000-0000-0000-0000000000a1') ON CONFLICT DO NOTHING;
INSERT INTO public.endurance_race_runs(id,event_id,team_id,run_kind,status) VALUES ('e2020202-0000-0000-0000-0000000000b1','e0e0e0e0-0000-0000-0000-0000000000a1','f00f0000-0000-0000-0000-0000000000a1','race','active') ON CONFLICT (id) DO NOTHING;
SET LOCAL role service_role; SET LOCAL request.jwt.claim.role='service_role';
DO $$ DECLARE r text; c int; BEGIN
 SELECT result INTO r FROM public.simhub_persist_v3(repeat('f',64),'s-b',1,clock_timestamp(),'{"timing":{"completedLaps":1},"raceState":{"incidents":0},"track":{"onPitRoad":false},"session":{"flags":["green"]}}'); IF r<>'accepted' THEN RAISE EXCEPTION 'RPC baseline %',r; END IF;
 UPDATE public.simhub_devices SET last_seen_at=clock_timestamp()-interval '1 second' WHERE id='e1010101-0000-0000-0000-0000000000b1';
 SELECT result INTO r FROM public.simhub_persist_v3(repeat('f',64),'s-b',2,clock_timestamp(),'{"timing":{"completedLaps":2},"raceState":{"incidents":1},"track":{"onPitRoad":true},"session":{"flags":["yellow"]}}'); IF r<>'accepted' THEN RAISE EXCEPTION 'RPC transition %',r; END IF;
 SELECT count(*) INTO c FROM public.endurance_telemetry_events WHERE device_id='e1010101-0000-0000-0000-0000000000b1'; IF c<>2 THEN RAISE EXCEPTION 'expected 2 events got %',c; END IF;
 UPDATE public.simhub_devices SET device_role='standby' WHERE id='e1010101-0000-0000-0000-0000000000b1'; SELECT result INTO r FROM public.simhub_persist_v3(repeat('f',64),'s-b',3,clock_timestamp(),'{}'); IF r<>'not_authority' THEN RAISE EXCEPTION 'former primary %',r; END IF;
END $$;
ROLLBACK;
SQL
echo "PASS RPC atomic persistence + former-primary"

# ---- Concurrency ----
"${PSQL[@]}" -d "$DB" -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
INSERT INTO auth.users(id) VALUES ('e3030303-0000-0000-0000-0000000000aa') ON CONFLICT DO NOTHING;
INSERT INTO public.simhub_devices(id) VALUES ('e4040404-0000-0000-0000-000000000001') ON CONFLICT DO NOTHING;
INSERT INTO public.endurance_events(id) VALUES ('e5050505-0000-0000-0000-000000000001') ON CONFLICT DO NOTHING;
INSERT INTO public.endurance_teams(id) VALUES ('e6060606-0000-0000-0000-000000000001') ON CONFLICT DO NOTHING;
INSERT INTO public.endurance_race_runs(id,event_id,team_id,run_kind,status) VALUES ('e7070707-0000-0000-0000-000000000001','e5050505-0000-0000-0000-000000000001','e6060606-0000-0000-0000-000000000001','race','active') ON CONFLICT DO NOTHING;
SQL
for w in 1 2; do
  ("${PSQL[@]}" -d "$DB" -v ON_ERROR_STOP=1 >/dev/null <<SQL
  BEGIN; INSERT INTO public.endurance_telemetry_events (device_id,event_id,team_id,session_id,event_type,event_key,sequence,captured_at,event_detection_source,completed_laps,race_run_id) VALUES ('e4040404-0000-0000-0000-000000000001','e5050505-0000-0000-0000-000000000001','e6060606-0000-0000-0000-000000000001','conc','lap_completed','conc:81',1,now(),'conctest',81,'e7070707-0000-0000-0000-000000000001') ON CONFLICT DO NOTHING; COMMIT;
SQL
  ) &
done
wait
CONC=$("${PSQL[@]}" -d "$DB" -Atc "SELECT count(*) FROM public.endurance_telemetry_events WHERE race_run_id='e7070707-0000-0000-0000-000000000001' AND event_type='lap_completed' AND completed_laps=81;")
[ "$CONC" = "1" ] || { echo "FATAL: concurrency $CONC rows, expected 1"; exit 1; }
echo "PASS concurrency dedupe"

# ---- Rollback chain ----
"${PSQL[@]}" -d "$DB" -f "$R_TEAM_READ" >/dev/null; echo "rollback team-read"
POL_CK=$("${PSQL[@]}" -d "$DB" -Atc "SELECT pg_get_expr(p.polqual,c.oid) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid WHERE p.polname='endurance_strategy_latest_team_read' AND c.relname='endurance_strategy_latest';")
case "$POL_CK" in *is_endurance_staff*) echo "PASS team-read rollback => staff-only" ;; *) echo "FAIL team-read rollback: $POL_CK"; exit 1 ;; esac

"${PSQL[@]}" -d "$DB" -f "$R_RLS" >/dev/null; echo "rollback RLS compat"
"${PSQL[@]}" -d "$DB" -f "$RF" >/dev/null; echo "rollback Phase F"
REM=$("${PSQL[@]}" -d "$DB" -Atc "SELECT count(*) FROM pg_class WHERE relname IN ('endurance_strategy_lap_samples','endurance_strategy_latest') AND relnamespace='public'::regnamespace;")
[ "$REM" = "0" ] || { echo "FATAL: Phase F tables remain ($REM)"; exit 1; }
echo "PASS Phase F tables removed"
"${PSQL[@]}" -d "$DB" -f "$RE" >/dev/null; echo "rollback Phase E"
"${PSQL[@]}" -d "$DB" -Atc "SELECT (to_regclass('public.endurance_telemetry_events') IS NOT NULL);" | grep -q t || { echo "FATAL: base table gone"; exit 1; }
echo "PASS base tables retained"

# Final
echo ""
echo "FULL REGRESSION + CONTRACT B: ALL PASS"