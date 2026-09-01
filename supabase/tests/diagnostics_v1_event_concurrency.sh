#!/usr/bin/env bash
# Requires a disposable DB where diagnostics_v1_rpc_matrix.sql fixtures exist.
# Uses the real RPC twice in parallel and proves device-row serialization.
set -euo pipefail

: "${PGHOST:?set PGHOST}"
: "${PGPORT:?set PGPORT}"
: "${PGUSER:?set PGUSER}"
: "${PGDATABASE:?set PGDATABASE}"

psql_cmd=(psql -X -v ON_ERROR_STOP=1)
device_id='60000000-0000-0000-0000-000000000006'
token_hash='6666666666666666666666666666666666666666666666666666666666666666'
event='{"type":"event","deviceId":null,"code":"INGEST_500","atUtc":"2026-08-31T18:12:00Z","exceptionType":null,"detail":"concurrency probe","occurredAfter":"OK"}'
workdir=$(mktemp -d)
trap 'rm -rf "$workdir"' EXIT

"${psql_cmd[@]}" <<SQL
DELETE FROM simhub_device_diagnostic_events WHERE device_id = '$device_id';
INSERT INTO simhub_device_diagnostic_events (device_id, code, detail, received_at)
SELECT '$device_id', 'RAW_DATA_UNAVAILABLE', 'concurrency-seed-' || gs, now() - interval '11 seconds'
FROM generate_series(1, 99) AS gs;
SQL

run_rpc() {
  "${psql_cmd[@]}" -Atqc "SELECT simhub_insert_diagnostic_event('$token_hash', '$event'::jsonb);"
}
run_rpc >"$workdir/one" & first=$!
run_rpc >"$workdir/two" & second=$!
wait "$first"
wait "$second"

accepted=$(grep -h '"accepted"' "$workdir/one" "$workdir/two" | wc -l | tr -d '[:space:]')
limited=$(grep -h '"diagnostic_event_rate_limited"' "$workdir/one" "$workdir/two" | wc -l | tr -d '[:space:]')
final_count=$("${psql_cmd[@]}" -Atqc "SELECT count(*) FROM simhub_device_diagnostic_events WHERE device_id = '$device_id';")

if [[ "$accepted" != 1 || "$limited" != 1 || "$final_count" != 100 ]]; then
  printf 'concurrency invariant failed: accepted=%s limited=%s count=%s\n' "$accepted" "$limited" "$final_count" >&2
  exit 1
fi
printf 'PASS concurrency invariant: accepted=1 rate_limited=1 count=100\n'
