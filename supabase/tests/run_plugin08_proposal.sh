#!/usr/bin/env bash
# ============================================================================
# Plugin 0.7.2.0 — serverkant lokaal testen
#
# Draait de DDL, de serverkant en de tests in een WEGWERPDATABASE. Raakt niets
# anders aan: geen productie, geen bestaande database, geen Supabase-project.
#
#   ./supabase/tests/run_plugin08_proposal.sh
#
# Vereist: psql (PostgreSQL 15 of nieuwer) en createdb/dropdb.
# De database heet standaard plugin08_proposal; hij wordt aan het eind weer
# weggegooid, ook als een test faalt.
#
# Exitcode 0 = alles PASS.
# ============================================================================
set -euo pipefail

DB="${PLUGIN08_TEST_DB:-plugin08_proposal}"
export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PSQL=(psql -X -v ON_ERROR_STOP=1 -q -d "$DB")

cleanup() {
  dropdb --if-exists "$DB" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "== wegwerpdatabase $DB =="
dropdb --if-exists "$DB" >/dev/null 2>&1 || true
createdb "$DB"

echo "== testfixture (geen productieschema) =="
"${PSQL[@]}" -f "$ROOT/supabase/tests/fixtures/plugin08_stub_schema.sql"

MIGRATIES=(
  20261031180000_plugin08_measurement_events
  20261031180100_plugin08_lap_summaries
  20261031180200_plugin08_connector_control
  20261031180300_plugin08_persist_v3_aggregates
  20261031190000_plugin08_measurement_identity
  20261031190100_plugin08_measurement_revisions
  20261031190200_plugin08_measurement_ack
  20261031190300_plugin08_wear_contract
  20261031190400_plugin08_lap_coverage
  20261031190500_plugin08_safe_casts
  20261031190600_plugin08_snapshot_strip
  20261031190700_plugin08_control_limits
  20261031190800_plugin08_retention
  20261031200000_plugin08_lap_driver_semantics
  20261031200100_plugin08_ack_revisions
  20261031200200_plugin08_complete_coverage
  20261031200300_plugin08_wear_version_required
  20261031200400_plugin08_measurement_fast_path
  20261031200500_plugin08_supersedes_hash
)

for migratie in "${MIGRATIES[@]}"; do
  echo "== migratie $migratie =="
  "${PSQL[@]}" -1 -f "$ROOT/supabase/migrations/$migratie.sql"
done

echo "== SQL-tests: structuur en terugwaartse compatibiliteit =="
"${PSQL[@]}" -f "$ROOT/supabase/tests/plugin08_server_proposal.sql"

echo "== SQL-tests: de reparaties uit de review =="
"${PSQL[@]}" -f "$ROOT/supabase/tests/plugin08_review_repairs.sql"

echo "== SQL-tests: de tweede review =="
"${PSQL[@]}" -f "$ROOT/supabase/tests/plugin08_review2_repairs.sql"

echo "== SQL-tests: supersedes in de content-hash =="
"${PSQL[@]}" -f "$ROOT/supabase/tests/plugin08_supersedes_hash.sql"

echo "== body-diff simhub_persist_v3 =="
(cd "$ROOT" && node supabase/tests/plugin08_persist_body_diff.mjs)

echo "== echte meetrijen voor de rollbackcontrole (review 2, punt 3) =="
"${PSQL[@]}" -f "$ROOT/supabase/tests/plugin08_review2_rollback_seed.sql"

echo "== markerrijen voor de rollbackcontrole =="
"${PSQL[@]}" -c "
  insert into public.simhub_measurement_events
    (device_id, event_uid, event_id, kind, observed_session_id, delivered_session_id, content_hash)
  values ('11111111-1111-4111-8111-111111111111',
          'cccccccc-0000-4000-8000-000000000001',
          'rollback-marker', 'rollback-marker', 'sess-1', 'sess-1', md5('marker'));
  insert into public.simhub_lap_summaries
    (summary_uid, summary_id, device_id, lap_number, content_hash)
  values ('cccccccc-0000-4000-8000-000000000002', 'rollback-marker',
          '11111111-1111-4111-8111-111111111111', 1, md5('marker'));
"

echo "== rollbacks, van nieuw naar oud =="
for (( i=${#MIGRATIES[@]}-1; i>=0; i-- )); do
  migratie="${MIGRATIES[$i]}"
  echo "== rollback $migratie =="
  "${PSQL[@]}" -1 -f "$ROOT/supabase/rollback/$migratie.rollback.sql"
  if [ "$migratie" = "20261031190000_plugin08_measurement_identity" ]; then
    # Idempotentie: dezelfde rollback nog een keer, met echte meetrijen in de
    # tabellen. Daarna de controle op gegevensbehoud en de oude schrijver.
    echo "== rollback 20261031190000 nogmaals (idempotentie) =="
    "${PSQL[@]}" -1 -f "$ROOT/supabase/rollback/$migratie.rollback.sql"
    echo "== rollbackcontrole met echte meetrijen (review 2) =="
    "${PSQL[@]}" -f "$ROOT/supabase/tests/plugin08_review2_rollback_check.sql"
  fi
done

echo "== rollbackcontrole (gegevensbehoud) =="
"${PSQL[@]}" -f "$ROOT/supabase/tests/plugin08_rollback_phase.sql"


echo "== Deno-tests (parser, protocol en isolatie) =="
if command -v deno >/dev/null 2>&1; then
  (cd "$ROOT" && deno test --allow-env --allow-read supabase/functions/_shared/)
else
  echo "deno niet gevonden: parser- en isolatietests overgeslagen" >&2
  exit 1
fi

echo
echo "ALLES PASS"
