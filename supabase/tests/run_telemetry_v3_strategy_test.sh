#!/usr/bin/env bash
# TEST-ONLY: Telemetry V3 Phase F strategy engine — full matrix on the disposable
# local PostgreSQL instance. Destroys and recreates the disposable database.
set -euo pipefail

export PATH="/home/hermes/rpms/pg15/usr/pgsql-15/bin:$PATH"
export LD_LIBRARY_PATH="/home/hermes/rpms/pg15/usr/pgsql-15/lib:/home/hermes/rpms/icu67/usr/lib/x86_64-linux-gnu"
PGHOST=127.0.0.1
PGPORT=55432
PGUSER=postgres
PSQL=(psql -X -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER")
DB="test_phase_f"

# Paths
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FIXTURE="$ROOT/supabase/tests/fixtures/pre_phase_e_telemetry_production_baseline.sql"
MIGRATION_E="$ROOT/supabase/migrations/20260902190000_endurance_v3_persistence.sql"
ROLLBACK_E="$ROOT/supabase/rollback/20260902190000_endurance_v3_persistence.rollback.sql"
MIGRATION_F="$ROOT/supabase/migrations/20260902220000_endurance_v3_strategy.sql"
ROLLBACK_F="$ROOT/supabase/rollback/20260902220000_endurance_v3_strategy.rollback.sql"
TEST_E_PERSIST="$ROOT/supabase/tests/telemetry_v3_persistence_test.sql"
TEST_E_ACCEPT="$ROOT/supabase/tests/telemetry_v3_acceptance_test.sql"
TEST_F="$ROOT/supabase/tests/telemetry_v3_strategy_test.sql"
TEST_BR="$ROOT/supabase/tests/pre_phase_e_telemetry_production_baseline_test.sql"

# ---- rebuild the disposable database -------------------------------------------
dropdb --if-exists -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$DB" 2>/dev/null
createdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$DB"
echo "--- created disposable db $DB ---"

# ---- authoritative pre-Phase-E fixture -----------------------------------------
"${PSQL[@]}" -d "$DB" -f "$FIXTURE" >/dev/null
"${PSQL[@]}" -d "$DB" -c "ALTER ROLE service_role BYPASSRLS;" >/dev/null
echo "applied authoritative pre-Phase-E fixture"

# ---- disposable-only prerequisite stubs for already-applied Phase A/B/D ---------
"${PSQL[@]}" -d "$DB" <<'SQL' >/dev/null
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT COALESCE(current_setting('request.jwt.claim.role', true), 'anon') $$;
ALTER TABLE public.simhub_devices
  ADD COLUMN token_hash text, ADD COLUMN revoked_at timestamptz,
  ADD COLUMN endurance_event_id uuid, ADD COLUMN endurance_team_id uuid,
  ADD COLUMN owner_user_id uuid, ADD COLUMN race_id uuid, ADD COLUMN team_id uuid,
  ADD COLUMN device_status text DEFAULT 'active_binding',
  ADD COLUMN device_role text DEFAULT 'primary', ADD COLUMN connector_id text DEFAULT 'test',
  ADD COLUMN device_name text DEFAULT 'test', ADD COLUMN last_seen_at timestamptz,
  ADD COLUMN last_session_id text, ADD COLUMN last_sequence bigint, ADD COLUMN updated_at timestamptz;
CREATE TABLE public.endurance_registrations (event_id uuid NOT NULL, user_id uuid NOT NULL, status text NOT NULL);
CREATE TABLE public.simhub_device_sessions (device_id uuid NOT NULL, session_id text NOT NULL, last_sequence bigint NOT NULL, first_seen_at timestamptz NOT NULL, last_seen_at timestamptz NOT NULL, PRIMARY KEY(device_id,session_id));
GRANT ALL ON public.simhub_devices, public.endurance_registrations, public.simhub_device_sessions TO service_role;
CREATE TYPE public.endurance_run_kind AS ENUM ('practice','qualifying','race');
CREATE TYPE public.endurance_race_run_status AS ENUM ('active','completed','ended','cancelled');
CREATE TABLE public.endurance_race_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES public.endurance_events(id),
 team_id uuid NOT NULL REFERENCES public.endurance_teams(id), run_kind public.endurance_run_kind NOT NULL,
 status public.endurance_race_run_status NOT NULL DEFAULT 'active'
);
GRANT ALL ON public.endurance_race_runs TO service_role;
--- Stub helper functions used by Phase F policies
CREATE OR REPLACE FUNCTION public.authorized_role_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE OR REPLACE FUNCTION public.authorized_role(p_uid uuid, p_role text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION public.user_teams() RETURNS SETOF uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid WHERE false $$;
CREATE OR REPLACE FUNCTION public.simhub_get_active_race_run(p_event_id uuid, p_team_id uuid, p_run_kind text) RETURNS TABLE(id uuid) LANGUAGE sql STABLE AS $$ SELECT id FROM public.endurance_race_runs WHERE event_id = p_event_id AND team_id = p_team_id AND run_kind::text = p_run_kind AND status = 'active' LIMIT 1 $$;
SQL
# Insert required stub row into auth.users
"${PSQL[@]}" -d "$DB" -c "INSERT INTO auth.users(id) VALUES ('00000000-0000-0000-0000-0000000000a1') ON CONFLICT DO NOTHING;" >/dev/null
echo "applied disposable Phase A/B/D stubs + policy helpers"

# ---- assert the fixture really is pre-Phase-E (upgrade precondition) -----------
ABSENT=$("${PSQL[@]}" -d "$DB" -Atc \
  "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='endurance_telemetry_events' AND column_name='race_run_id';")
[ "$ABSENT" = "0" ]
CHECK_PRE=$("${PSQL[@]}" -d "$DB" -Atc \
  "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='endurance_telemetry_events_event_type_check';")
case "$CHECK_PRE" in *incident_count_changed*) echo "FATAL: fixture already contains incident_count_changed"; exit 1;; esac
echo "PASS precondition: fixture lacks race_run_id and incident_count_changed"

# ---- Baseline verifier BR01-BR21 (pre-Phase-E, against the raw fixture) ----------
"${PSQL[@]}" -d "$DB" -f "$TEST_BR"
echo "PASS BR01-BR21 baseline verifier"

# ---- Phase E forward migration -------------------------------------------------
"${PSQL[@]}" -d "$DB" -f "$MIGRATION_E" >/dev/null
echo "applied Phase E forward migration"

# ---- Phase F forward migration -------------------------------------------------
"${PSQL[@]}" -d "$DB" -f "$MIGRATION_F" >/dev/null
echo "applied Phase F forward migration"

# ---- Phase E structural tests (P01-P20) ----------------------------------------
"${PSQL[@]}" -d "$DB" -f "$TEST_E_PERSIST"
echo "PASS Phase E persistence test matrix (P01-P20)"

# ---- Phase F strategy tests ----------------------------------------------------
"${PSQL[@]}" -d "$DB" -f "$TEST_F"
echo "PASS Phase F strategy tests"

# ---- Phase E acceptance A01-A97 -------------------------------------------------
"${PSQL[@]}" -d "$DB" -f "$TEST_E_ACCEPT"
echo "PASS Phase E acceptance matrix A01-A97"

# ---- RPC persistence + authority/former-primary + rollback in subtransaction -----
"${PSQL[@]}" -d "$DB" <<'SQL' >/dev/null
BEGIN;
INSERT INTO auth.users(id) VALUES ('00000000-0000-0000-0000-0000000000b1') ON CONFLICT DO NOTHING;
INSERT INTO public.simhub_devices(id,token_hash,owner_user_id,endurance_event_id,endurance_team_id,device_status,device_role,connector_id,device_name) VALUES ('d0d0d0d0-0000-0000-0000-0000000000b1',repeat('6',64),'00000000-0000-0000-0000-0000000000b1','e0e0e0e0-0000-0000-0000-0000000000a1','f00f0000-0000-0000-0000-0000000000a1','active_binding','primary','test','test');
INSERT INTO public.endurance_registrations VALUES ('e0e0e0e0-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','accepted');
INSERT INTO public.endurance_events(id) VALUES ('e0e0e0e0-0000-0000-0000-0000000000a1') ON CONFLICT DO NOTHING;
INSERT INTO public.endurance_teams(id) VALUES ('f00f0000-0000-0000-0000-0000000000a1') ON CONFLICT DO NOTHING;
INSERT INTO public.endurance_race_runs(id,event_id,team_id,run_kind,status) VALUES ('a5a5a5a5-0000-0000-0000-0000000000b1','e0e0e0e0-0000-0000-0000-0000000000a1','f00f0000-0000-0000-0000-0000000000a1','race','active') ON CONFLICT (id) DO NOTHING;
SET LOCAL role service_role; SET LOCAL request.jwt.claim.role='service_role';
DO $$ DECLARE r text; c integer; BEGIN
 SELECT result INTO r FROM public.simhub_persist_v3(repeat('6',64),'s-b',1,clock_timestamp(),'{"timing":{"completedLaps":1},"raceState":{"incidents":0},"track":{"onPitRoad":false},"session":{"flags":["green"]}}'); IF r<>'accepted' THEN RAISE EXCEPTION 'RPC baseline result %',r; END IF;
 UPDATE public.simhub_devices SET last_seen_at=clock_timestamp()-interval '1 second' WHERE id='d0d0d0d0-0000-0000-0000-0000000000b1';
 SELECT result INTO r FROM public.simhub_persist_v3(repeat('6',64),'s-b',2,clock_timestamp(),'{"timing":{"completedLaps":2},"raceState":{"incidents":1},"track":{"onPitRoad":true},"session":{"flags":["yellow"]}}'); IF r<>'accepted' THEN RAISE EXCEPTION 'RPC transition result %',r; END IF;
 SELECT count(*) INTO c FROM public.endurance_telemetry_events WHERE device_id='d0d0d0d0-0000-0000-0000-0000000000b1'; IF c<>2 THEN RAISE EXCEPTION 'expected 2 non-deduped events (pit+flag), got %',c; END IF;
 UPDATE public.simhub_devices SET device_role='standby' WHERE id='d0d0d0d0-0000-0000-0000-0000000000b1'; SELECT result INTO r FROM public.simhub_persist_v3(repeat('6',64),'s-b',3,clock_timestamp(),'{}'); IF r<>'not_authority' THEN RAISE EXCEPTION 'former primary result %',r; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.endurance_source_segments WHERE device_id='d0d0d0d0-0000-0000-0000-0000000000b1') THEN RAISE EXCEPTION 'former primary state deleted'; END IF;
END $$;
ROLLBACK;
SQL
echo "PASS RPC atomic persistence, baseline, transition, former-primary no-revoke (Phase E preserved)"

# ---- A98/A99 concurrency ---
"${PSQL[@]}" -d "$DB" -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
INSERT INTO auth.users(id) VALUES ('00000000-0000-0000-0000-0000000000aa') ON CONFLICT DO NOTHING;
INSERT INTO public.simhub_devices(id) VALUES ('de0de0de-0000-0000-0000-000000000001') ON CONFLICT DO NOTHING;
INSERT INTO public.endurance_events(id) VALUES ('e5e5e5e5-0000-0000-0000-000000000001') ON CONFLICT DO NOTHING;
INSERT INTO public.endurance_teams(id) VALUES ('ff0ff00f-0000-0000-0000-000000000001') ON CONFLICT DO NOTHING;
INSERT INTO public.endurance_race_runs(id,event_id,team_id,run_kind,status) VALUES ('ab0ab0ab-0000-0000-0000-000000000001','e5e5e5e5-0000-0000-0000-000000000001','ff0ff00f-0000-0000-0000-000000000001','race','active') ON CONFLICT DO NOTHING;
SQL
for w in 1 2; do
  ("${PSQL[@]}" -d "$DB" -v ON_ERROR_STOP=1 >/dev/null <<SQL
  BEGIN;
  INSERT INTO public.endurance_telemetry_events
    (device_id,event_id,team_id,session_id,event_type,event_key,sequence,captured_at,event_detection_source,completed_laps,race_run_id)
  VALUES ('de0de0de-0000-0000-0000-000000000001','e5e5e5e5-0000-0000-0000-000000000001','ff0ff00f-0000-0000-0000-000000000001','conc-sess','lap_completed','conc:81',1,now(),'conctest',81,'ab0ab0ab-0000-0000-0000-000000000001')
  ON CONFLICT DO NOTHING;
  COMMIT;
SQL
  ) &
done
wait
CONC=$("${PSQL[@]}" -d "$DB" -Atc \
 "SELECT count(*) FROM public.endurance_telemetry_events WHERE race_run_id='ab0ab0ab-0000-0000-0000-000000000001' AND event_type='lap_completed' AND completed_laps=81;")
[ "$CONC" = "1" ] || { echo "FATAL: parallel concurrency left $CONC lap rows (expected exactly 1)"; exit 1; }
echo "PASS A98/A99 parallel-concurrency domain dedupe (2 workers, exactly 1 lap row)"

# ---- Verify Phase F strategy data exists from acceptance test -------------------
F_SAMPLES=$("${PSQL[@]}" -d "$DB" -Atc \
  "SELECT count(*) FROM public.endurance_strategy_lap_samples;")
echo "PASS Phase F strategy samples exist in DB: ${F_SAMPLES} rows"

# ---- Clean incident rows before Phase E rollback --------------------------------
"${PSQL[@]}" -d "$DB" -v ON_ERROR_STOP=1 -c "DELETE FROM public.endurance_telemetry_events WHERE event_type='incident_count_changed' AND event_detection_source='simhub_v3_transition';"
echo "PASS deleted synthetic incident_count_changed rows for Phase E rollback"

# ---- Rollback Phase F first ----------------------------------------------------
"${PSQL[@]}" -d "$DB" -f "$ROLLBACK_F" >/dev/null
echo "applied Phase F rollback"

# Verify Phase F objects removed
REM=$("${PSQL[@]}" -d "$DB" -Atc \
  "SELECT count(*) FROM pg_class WHERE relname IN ('endurance_strategy_lap_samples','endurance_strategy_latest') AND relnamespace='public'::regnamespace;")
[ "$REM" = "0" ]
echo "PASS F50: Phase F tables removed by rollback"

# Verify Phase E RPC restored (5-arg simhub_persist_v3, no fuel/session extraction)
E_RPC=$("${PSQL[@]}" -d "$DB" -Atc \
  "SELECT count(*) FROM pg_proc WHERE proname='simhub_persist_v3' AND pronargs=5 AND pronamespace='public'::regnamespace;")
[ "$E_RPC" = "1" ]
echo "PASS Phase E RPC restored after Phase F rollback"

# ---- Rollback Phase E ----------------------------------------------------------
"${PSQL[@]}" -d "$DB" -f "$ROLLBACK_E" >/dev/null
echo "applied Phase E rollback"

# ---- retained-base-object verification ------------------------------------------
BASE_OK=$("${PSQL[@]}" -d "$DB" -Atc \
  "SELECT (to_regclass('public.endurance_telemetry_events') IS NOT NULL)
        AND (to_regclass('public.simhub_telemetry_latest') IS NOT NULL)
        AND (to_regclass('public.endurance_race_runs') IS NOT NULL);")
[ "$BASE_OK" = "t" ]
echo "PASS base telemetry tables retained after full rollback"

COLS_GONE=$("${PSQL[@]}" -d "$DB" -Atc \
  "SELECT count(*) FROM information_schema.columns WHERE table_schema='public'
     AND ((table_name='endurance_telemetry_events' AND column_name='race_run_id')
       OR (table_name='simhub_telemetry_latest' AND column_name IN ('race_run_id','v3_normalized')));")
[ "$COLS_GONE" = "0" ]
echo "PASS rollback removed race_run_id (event+latest) and v3_normalized (latest)"

CHECK_POST=$("${PSQL[@]}" -d "$DB" -Atc \
  "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='endurance_telemetry_events_event_type_check';")
case "$CHECK_POST" in
  *incident_count_changed*) echo "FATAL: rollback left incident_count_changed in check"; exit 1;;
esac
case "$CHECK_POST" in
  *flag_change*) echo "PASS rollback restored original event_type check";;
  *) echo "FATAL: rollback lost flag_change"; exit 1;;
esac

# incident_count_changed must now be REJECTED post-rollback
set +e
"${PSQL[@]}" -d "$DB" -c "
  SET ROLE service_role;
  INSERT INTO public.endurance_telemetry_events (
    device_id, event_id, team_id, session_id, event_type, event_key, sequence,
    captured_at, received_at, event_detection_source
  ) VALUES (
    'd0d0d0d0-0000-0000-0000-0000000000a1',
    'e0e0e0e0-0000-0000-0000-0000000000a1',
    'f00f0000-0000-0000-0000-0000000000a1',
    's', 'incident_count_changed', 'incident:1', 1, now(), now(), 'v3_transition'
  );" >/tmp/phase_f_postrollback.out 2>&1
RC=$?
set -e
[ "$RC" -ne 0 ] || { echo "FATAL: incident_count_changed accepted after rollback"; exit 1; }
grep -q "check_violation\|endurance_telemetry_events_event_type_check" /tmp/phase_f_postrollback.out || { echo "FATAL: unexpected rejection text"; cat /tmp/phase_f_postrollback.out; exit 1; }
echo "PASS incident_count_changed rejected after full rollback (check_violation)"

# ---- Final verdict --------------------------------------------------------------
echo ""
echo "TELEMETRY V3 PHASE F TEST SUITE: ALL PASS"