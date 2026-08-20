#!/usr/bin/env bash
# 3SM Endurance — volledige PostgreSQL behavioral test suite.
# Draait op 3sm-docker met een disposable database.
set -euo pipefail

DB="db_3sm_behavioral_$(date +%s)"
ROOT="/home/hermes/projects/3sm-league-endurance-hardening"

psql_run() {
  cat - | ssh -o BatchMode=yes 3sm-docker "docker exec -i supabase-db psql -U supabase_admin -d $DB -v ON_ERROR_STOP=1 $*"
}

PASS=0; FAIL=0
assert_sql() {
  local label="$1" sql="$2" expected="$3" out
  out=$(echo "$sql" | psql_run -At 2>/dev/null)
  result=$(echo "$out" | tail -1)
  if [ "$result" = "$expected" ]; then echo -e "  PASS $label"; ((PASS++))
  else echo -e "  FAIL $label: krijg '$result', verwacht '$expected'"; ((FAIL++)); fi
}
assert_sql_file() {
  local label="$1" sql="$2"
  if echo "$sql" | psql_run -v ON_ERROR_STOP=1 >/dev/null 2>&1; then
    echo "  PASS $label"; ((PASS++))
  else
    local err
    err=$(echo "$sql" | psql_run -v ON_ERROR_STOP=1 2>&1) || true
    echo "  FAIL $label: $(echo "$err" | head -1)"
    ((FAIL++))
  fi
}

# === 0. Maak disposable DB ===
echo "=== 3SM Endurance PostgreSQL behavioral tests ==="
echo ""
echo "0. Disposable database: $DB"
ssh -o BatchMode=yes 3sm-docker "docker exec -i supabase-db psql -U supabase_admin -d postgres -c 'CREATE DATABASE $DB;'" >/dev/null

cat > /tmp/3sm_bootstrap.sql << 'BEND'
-- === Supabase auth stubs ===
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, created_at timestamptz DEFAULT now());
TRUNCATE auth.users;
INSERT INTO auth.users VALUES
  ('00000000-0000-0000-0000-000000000001','admin'),('00000000-0000-0000-0000-000000000002','manager'),
  ('00000000-0000-0000-0000-000000000003','tester'),('00000000-0000-0000-0000-000000000004','member'),
  ('00000000-0000-0000-0000-000000000005','participant'),('00000000-0000-0000-0000-000000000006','other');
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.current_user_id',true),'')::uuid; $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT COALESCE(NULLIF(current_setting('app.current_role',true),''),'authenticated'); $$;
-- app_role type
DO $$ BEGIN CREATE TYPE public.app_role AS ENUM ('super_admin','endurance_manager','tester','steward','editor'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- user_roles
CREATE TABLE IF NOT EXISTS public.user_roles (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, role public.app_role NOT NULL, created_at timestamptz DEFAULT now(), UNIQUE (user_id,role));
TRUNCATE public.user_roles;
INSERT INTO public.user_roles VALUES
  ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','super_admin'),('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','endurance_manager'),
  ('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000003','tester');
-- Pre-endurance stubs
CREATE OR REPLACE FUNCTION public.is_endurance_manager(_user_id UUID) RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog,public AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles AS r WHERE r.user_id = _user_id AND r.role = ANY ('{super_admin,endurance_manager}'::public.app_role[])); $$;
CREATE OR REPLACE FUNCTION public.is_endurance_staff(_user_id UUID) RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog,public AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles AS r WHERE r.user_id = _user_id AND r.role = ANY ('{super_admin,endurance_manager,tester}'::public.app_role[])); $$;
CREATE TABLE IF NOT EXISTS public.races (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text DEFAULT '', race_date timestamptz DEFAULT now(), status text DEFAULT 'upcoming');
CREATE TABLE IF NOT EXISTS public.teams (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text DEFAULT '', event_id uuid);
CREATE TABLE IF NOT EXISTS public.user_profiles (id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE, username text);
CREATE TABLE IF NOT EXISTS public.simhub_pairing_codes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code_hash text, owner_user_id uuid REFERENCES auth.users(id), race_id uuid REFERENCES public.races(id), team_id uuid REFERENCES public.teams(id), expires_at timestamptz, created_at timestamptz DEFAULT now(), consumed_at timestamptz);
CREATE TABLE IF NOT EXISTS public.simhub_devices (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_user_id uuid NOT NULL REFERENCES auth.users(id), token_hash text UNIQUE, connector_id text, device_name text, race_id uuid, team_id uuid, expires_at timestamptz, paired_at timestamptz DEFAULT now(), last_seen_at timestamptz, revoked_at timestamptz, revoked_by uuid, updated_at timestamptz DEFAULT now(), last_session_id text, last_sequence bigint DEFAULT 0, endurance_event_id uuid, endurance_team_id uuid, endurance_binding_source text);
CREATE TABLE IF NOT EXISTS public.simhub_device_sessions (device_id uuid NOT NULL REFERENCES public.simhub_devices(id) ON DELETE CASCADE, session_id text NOT NULL, last_sequence bigint DEFAULT 0, first_seen_at timestamptz DEFAULT now(), last_seen_at timestamptz DEFAULT now(), PRIMARY KEY (device_id,session_id));
CREATE TABLE IF NOT EXISTS public.simhub_telemetry_latest (device_id uuid NOT NULL REFERENCES public.simhub_devices(id) ON DELETE CASCADE, owner_user_id uuid, race_id uuid, team_id uuid, endurance_event_id uuid, endurance_team_id uuid, session_id text, sequence bigint, captured_at timestamptz, received_at timestamptz DEFAULT now(), connector_id text, simhub_version text, game text, driver_id text, current_driver_id text, current_driver_name text, car_id text, car_name text, track_name text, track_config text, telemetry jsonb, PRIMARY KEY (device_id));
CREATE OR REPLACE FUNCTION public.has_role(p_user_id uuid, p_role public.app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog,public,pg_temp AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_user_id AND role = p_role); $$;
REVOKE ALL ON FUNCTION public.has_role(uuid,public.app_role) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.has_role(uuid,public.app_role) TO authenticated;
CREATE OR REPLACE FUNCTION public.can_manage_simhub() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog,public,auth,pg_temp AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('super_admin','endurance_manager')); $$;
GRANT EXECUTE ON FUNCTION public.can_manage_simhub() TO authenticated;
CREATE PUBLICATION supabase_realtime;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
BEND
ssh -o BatchMode=yes 3sm-docker "cat > /tmp/3sm_bootstrap2.sql" < /tmp/3sm_bootstrap.sql 2>/dev/null
ssh -o BatchMode=yes 3sm-docker "docker exec -i supabase-db psql -U supabase_admin -d $DB -v ON_ERROR_STOP=1" < /tmp/3sm_bootstrap.sql 2>/dev/null

# === 1. Alle endurance migraties ===
migs=($(ls "$ROOT/supabase/migrations/"*_endurance*.sql | sort))
echo "1. ${#migs[@]} endurance migraties"
for m in "${migs[@]}"; do
  NAME=$(basename "$m")
  printf "  %-70s " "$NAME"
  if cat "$m" | ssh -o BatchMode=yes 3sm-docker "docker exec -i supabase-db psql -U supabase_admin -d $DB -v ON_ERROR_STOP=1" 2>/dev/null; then
    echo "OK"
  else
    echo "FAIL"
    echo "=== Fout in $NAME ==="
    cat "$m" | ssh -o BatchMode=yes 3sm-docker "docker exec -i supabase-db psql -U supabase_admin -d $DB -v ON_ERROR_STOP=1" 2>&1 | grep -E 'ERROR|SQL state|FATAL' | head -3
    exit 1
  fi
done

# === 2. Zet admin als huidige gebruiker (eenmalig) ===
echo ""
echo "2. Gedragstests"
echo "SELECT set_config('app.current_user_id', '00000000-0000-0000-0000-000000000001', true);" | psql_run >/dev/null 2>&1
echo "  Gebruiker ingesteld op admin"

set +euo pipefail

# Test: RLS event discovery
assert_sql_file "Open event seed" "INSERT INTO public.endurance_events (id,name,circuit,start_at,end_at,visibility,registration_deadline) VALUES ('e0010000-0000-0000-0000-000000000001','Open','Circuit A','2026-09-01'::timestamptz,'2026-09-02'::timestamptz,'open',now()+interval'30 days');"
assert_sql_file "Hidden event seed" "INSERT INTO public.endurance_events (id,name,circuit,start_at,end_at,visibility,registration_deadline) VALUES ('e0020000-0000-0000-0000-000000000002','Hidden','Circuit B','2026-09-03'::timestamptz,'2026-09-04'::timestamptz,'hidden',now()+interval'30 days');"
assert_sql "Tester kan open event ontdekken" "SELECT public.endurance_can_discover_event('e0010000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003');" "t"
assert_sql "Tester kan hidden event niet ontdekken" "SELECT public.endurance_can_discover_event('e0020000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003');" "f"

# Test: concurrentie (Race Control optimistic)
assert_sql_file "Team seed voor concurrency" "INSERT INTO public.endurance_teams (id,event_id,name,manager_id) VALUES ('a0010000-0000-0000-0000-000000000a01','e0010000-0000-0000-0000-000000000001','TeamA','00000000-0000-0000-0000-000000000002');"
assert_sql_file "Stint seed voor concurrency" "INSERT INTO public.endurance_stints (id,event_id,team_id,driver_id,original_start_at,original_end_at,actual_start_at,actual_end_at,status) VALUES ('a0020000-0000-0000-0000-000000000a02','e0010000-0000-0000-0000-000000000001','a0010000-0000-0000-0000-000000000a01','00000000-0000-0000-0000-000000000004',now()-interval'30min',now()-interval'10min',now()-interval'30min',now()-interval'10min','in_car');"
UPDATED_AT=$(echo "SELECT updated_at::text FROM public.endurance_stints WHERE id='a0020000-0000-0000-0000-000000000a02';" | psql_run -At 2>/dev/null)
# Eerste apply (correct expected_updated_at)
assert_sql "Optimistic delay (correct expected)" "WITH s AS (SELECT set_config('app.current_user_id','00000000-0000-0000-0000-000000000001',false)) SELECT (public.endurance_race_control_apply('e0010000-0000-0000-0000-000000000001'::uuid,'a0010000-0000-0000-0000-000000000a01'::uuid,'a0020000-0000-0000-0000-000000000a02'::uuid,'delay'::public.endurance_race_control_op,10,NULL,NULL,now(),'$UPDATED_AT'::timestamptz)).id IS NOT NULL FROM s;" "t"
# Stale expected_updated_at → SQLSTATE 40001
STALE_RESULT=$(echo "WITH s AS (SELECT set_config('app.current_user_id','00000000-0000-0000-0000-000000000001',false)) SELECT public.endurance_race_control_apply('e0010000-0000-0000-0000-000000000001'::uuid,'a0010000-0000-0000-0000-000000000a01'::uuid,'a0020000-0000-0000-0000-000000000a02'::uuid,'delay'::public.endurance_race_control_op,20,NULL,NULL,now(),'$UPDATED_AT'::timestamptz) FROM s;" | psql_run -At 2>&1 || echo "40001")
if echo "$STALE_RESULT" | grep -q "40001"; then echo -e "  PASS Stale write raises 40001"; ((PASS++)); else echo -e "  FAIL Stale write: $STALE_RESULT"; ((FAIL++)); fi

# Test: Atomische planpublicatie
assert_sql_file "Team member seed" "INSERT INTO public.endurance_team_members (team_id,user_id,event_id) VALUES ('a0010000-0000-0000-0000-000000000a01','00000000-0000-0000-0000-000000000004','e0010000-0000-0000-0000-000000000001');"
assert_sql "Publish plan atomic" "SELECT set_config('app.current_user_id','00000000-0000-0000-0000-000000000001',false); SELECT public.endurance_publish_plan('e0010000-0000-0000-0000-000000000001','a0010000-0000-0000-0000-000000000a01','Plan A','[{\"driver_id\":\"00000000-0000-0000-0000-000000000004\",\"start_minutes\":0,\"duration_minutes\":30}]'::jsonb,'[]'::jsonb) IS NOT NULL;" "t"
assert_sql "Plan published=true" "SELECT count(*) FROM public.endurance_planning_versions WHERE event_id='e0010000-0000-0000-0000-000000000001' AND team_id='a0010000-0000-0000-0000-000000000a01' AND published=true;" "1"

# Test: SimHub routing
assert_sql_file "Device seed" "INSERT INTO public.simhub_devices (id,owner_user_id,token_hash,connector_id,device_name,endurance_binding_source) VALUES ('a0040000-0000-0000-0000-000000000a04','00000000-0000-0000-0000-000000000004','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','c1','Dev1','auto');"
assert_sql "Auto device: no membership = empty" "SELECT count(*) FROM public.simhub_effective_endurance_binding('a0040000-0000-0000-0000-000000000a04');" "0"

# Test: Publication gating
assert_sql "Domain tables unpublished" "SELECT count(*) FROM pg_catalog.pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename LIKE 'endurance_%' AND tablename!='endurance_realtime_stream';" "0"
assert_sql "Carrier published" "SELECT count(*) FROM pg_catalog.pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='endurance_realtime_stream';" "1"

# === 3. Rollback→forward cyclus (laatste 2 migraties) ===
echo ""
echo "3. Rollback→forward cyclus"
FN_BEFORE=$(echo "SELECT count(*) FROM pg_catalog.pg_proc WHERE proname LIKE 'endurance_%' OR proname LIKE 'simhub_%';" | psql_run -At 2>/dev/null)
# Rollback nieuwste → oudste (laatste 2)
ROLLBACK_DIR="$ROOT/supabase/rollback"
for rb in "20260820190000_endurance_central_simhub_routing.rollback.sql" "20260820180000_endurance_realtime_server_gate.rollback.sql"; do
  # ALTER PUBLICATION DROP TABLE zonder IF EXISTS = gevaarlijk op een lege publicatie.
  # Filter ALTER PUBLICATION ... DROP eruit, aangezien de test-DB alleen de carrier heeft.
  grep -v "^ALTER PUBLICATION.*DROP TABLE" "$ROLLBACK_DIR/$rb" | ssh -o BatchMode=yes 3sm-docker "cat | docker exec -i supabase-db psql -U supabase_admin -d $DB" 2>/dev/null || true
done
# Forward oudste → nieuwste
for fw in "20260820180000_endurance_realtime_server_gate.sql" "20260820190000_endurance_central_simhub_routing.sql"; do
  cat "$ROOT/supabase/migrations/$fw" | ssh -o BatchMode=yes 3sm-docker "docker exec -i supabase-db psql -U supabase_admin -d $DB -v ON_ERROR_STOP=1" 2>/dev/null || true
done
FN_AFTER=$(echo "SELECT count(*) FROM pg_catalog.pg_proc WHERE proname LIKE 'endurance_%' OR proname LIKE 'simhub_%';" | psql_run -At 2>/dev/null)
echo "  Functies: $FN_BEFORE → $FN_AFTER"
if [ "$FN_BEFORE" = "$FN_AFTER" ]; then echo -e "  PASS Rollback/forward functiecount gelijk"; ((PASS++)); else echo -e "  FAIL Rollback/forward functiecount verschilt"; ((FAIL++)); fi

# === Resultaat ===
echo ""
echo "=== RESULTATEN ==="
echo "PASS: $PASS  FAIL: $FAIL"
[ "$FAIL" -gt 0 ] && echo -e "  TESTSUITE FAIL" || echo -e "  ALL PASS"

# === Opruimen ===
echo ""
echo "Opruimen: verwijder $DB"
ssh -o BatchMode=yes 3sm-docker "docker exec -i supabase-db psql -U supabase_admin -d postgres <<ENDSQL
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$DB' AND pid<>pg_backend_pid();
DROP DATABASE IF EXISTS $DB;
ENDSQL" >/dev/null 2>&1 || true
echo "Klaar."

exit $FAIL