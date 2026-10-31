#!/usr/bin/env bash
# ============================================================================
# Plugin 0.8 — servervoorstel lokaal testen
#
# Draait de DDL, de serverkant en de tests in een WEGWERPDATABANK. Raakt niets
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

for migratie in \
  20261031180000_plugin08_measurement_events \
  20261031180100_plugin08_lap_summaries \
  20261031180200_plugin08_connector_control \
  20261031180300_plugin08_persist_v3_aggregates
do
  echo "== migratie $migratie =="
  "${PSQL[@]}" -1 -f "$ROOT/supabase/migrations/$migratie.sql"
done

echo "== SQL-tests =="
"${PSQL[@]}" -f "$ROOT/supabase/tests/plugin08_server_proposal.sql"

echo "== body-diff simhub_persist_v3 =="
(cd "$ROOT" && node supabase/tests/plugin08_persist_body_diff.mjs)

echo "== rollbacks, in de voorgeschreven volgorde =="
for migratie in \
  20261031180300_plugin08_persist_v3_aggregates \
  20261031180200_plugin08_connector_control \
  20261031180100_plugin08_lap_summaries \
  20261031180000_plugin08_measurement_events
do
  "${PSQL[@]}" -1 -f "$ROOT/supabase/rollback/$migratie.rollback.sql"
done

echo "== rollbackcontrole =="
"${PSQL[@]}" -f "$ROOT/supabase/tests/plugin08_rollback_phase.sql"

echo "== Deno-tests (parser en isolatie) =="
if command -v deno >/dev/null 2>&1; then
  (cd "$ROOT" && deno test --allow-env --allow-read supabase/functions/_shared/)
else
  echo "deno niet gevonden: parser- en isolatietests overgeslagen" >&2
  exit 1
fi

echo
echo "ALLES PASS"
