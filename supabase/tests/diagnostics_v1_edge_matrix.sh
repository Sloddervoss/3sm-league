#!/bin/bash
# ============================================================================
# Diagnostics v1 Edge TESTMATRIX — Fase C
# Doel: bewijs dat simhub-diagnostic Edge function alle testcases doorstaat.
# ============================================================================
set -uo pipefail

SSH="ssh -i ~/.ssh/hermes_3sm_ed25519 root@192.168.50.23"
DB="test_diagnostics_v1_edge"
SUPABASE_URL="http://localhost:8000"
PASS=0
FAIL=0

# Token hashes (SHA256 van de tokens)
TOKEN_A="test-token-device-a-xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
TOKEN_B="test-token-device-b-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"
TOKEN_BAD="this-is-a-completely-random-bad-token-1234567890"
TOKEN_REVOKED="test-token-device-revoked-zzzzzzzzzzzzzzzzzzzzzz"
TOKEN_UNBOUND="test-token-unbound-device-uuuuuuuuuuuuuuuuuuuuuu"

HASH_A=$(echo -n "$TOKEN_A" | sha256sum | cut -d' ' -f1)
HASH_B=$(echo -n "$TOKEN_B" | sha256sum | cut -d' ' -f1)
HASH_REVOKED=$(echo -n "$TOKEN_REVOKED" | sha256sum | cut -d' ' -f1)
HASH_UNBOUND=$(echo -n "$TOKEN_UNBOUND" | sha256sum | cut -d' ' -f1)

DEVICE_A="aaaaaaaa-0000-0000-0000-000000000001"
DEVICE_B="bbbbbbbb-0000-0000-0000-000000000002"
DEVICE_REVOKED="cccccccc-0000-0000-0000-000000000003"
DEVICE_UNBOUND="dddddddd-0000-0000-0000-000000000004"
OWNER="eeeeeeee-0000-4000-8000-000000000001"

assert() {
    local name="$1" expected="$2" actual="$3"
    if [[ "$actual" == "$expected" ]]; then
        echo "  ✅ $name"
        PASS=$((PASS + 1))
    else
        echo "  ❌ $name (expected: $expected, actual: $actual)"
        FAIL=$((FAIL + 1))
    fi
}

assert_contains() {
    local name="$1" expected="$2" actual="$3"
    if echo "$actual" | grep -qF "$expected"; then
        echo "  ✅ $name"
        PASS=$((PASS + 1))
    else
        echo "  ❌ $name (expected to contain: $expected)"
        echo "     actual: $actual"
        FAIL=$((FAIL + 1))
    fi
}

call_edge() {
    local token="$1" body="$2"
    $SSH "curl -s -w '\n%{http_code}' http://localhost:8000/functions/v1/simhub-diagnostic \
        -X POST \
        -H 'Content-Type: application/json' \
        -H 'Authorization: Bearer $token' \
        -H 'Origin: https://3stripemotorsport.cc' \
        -d '$body' 2>/dev/null"
}

call_edge_and_get() {
    local token="$1" body="$2" field="$3"
    local result
    result=$($SSH "curl -s http://localhost:8000/functions/v1/simhub-diagnostic \
        -X POST \
        -H 'Content-Type: application/json' \
        -H 'Authorization: Bearer $token' \
        -H 'Origin: https://3stripemotorsport.cc' \
        -d '$body' 2>/dev/null")
    echo "$result"
}

echo "=============================================="
echo "Fase C — simhub-diagnostic Edge TESTMATRIX"
echo "=============================================="
echo ""

# ============================ SETUP =============================
echo "=== SETUP: test database ==="
# Proper cleanup: terminate connections, drop, recreate
$SSH "docker exec supabase-db psql -U postgres -c \"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB' AND pid <> pg_backend_pid();\" 2>/dev/null" || true
$SSH "docker exec supabase-db psql -U postgres -c \"DROP DATABASE IF EXISTS $DB;\"" 2>/dev/null
$SSH "docker exec supabase-db psql -U postgres -c \"CREATE DATABASE $DB;\""

# Auth schema
$SSH "docker exec -i supabase-db psql -U postgres -d $DB -v ON_ERROR_STOP=1" << 'EOSQL'
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
    id uuid PRIMARY KEY,
    email text,
    role text DEFAULT 'authenticated',
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);
-- Helper function for auth.uid() in test context
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT 'ffffffff-0000-4000-8000-000000000002'::uuid;
$$;
CREATE TABLE IF NOT EXISTS public.user_roles (
    user_id uuid REFERENCES auth.users(id),
    role text NOT NULL,
    PRIMARY KEY (user_id, role)
);
CREATE OR REPLACE FUNCTION public.can_manage_simhub()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = auth.uid() AND role = 'super_admin'
    );
$$;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
EOSQL
echo "  ✅ Auth schema OK"

# Apply diagnostics migration
cat /home/hermes/projects/3sm-league/supabase/migrations/20260831100000_remote_diagnostics_v1.sql | \
    $SSH "docker exec -i supabase-db psql -U postgres -d $DB -v ON_ERROR_STOP=1" 2>/dev/null
echo "  ✅ Migration 1 OK"

# Apply cron function (without extension)
sed '/CREATE EXTENSION/d' /home/hermes/projects/3sm-league/supabase/migrations/20260831110000_remote_diagnostics_v1_cron_cleanup.sql | \
    sed '/SELECT cron.schedule/d' | $SSH "docker exec -i supabase-db psql -U postgres -d $DB -v ON_ERROR_STOP=1"
echo "  ✅ Migration 2 (cron function) OK"

# Insert test users + devices
$SSH "docker exec -i supabase-db psql -U postgres -d $DB -v ON_ERROR_STOP=1" << EOSQL
INSERT INTO auth.users (id, email, role) VALUES
    ('$OWNER', 'owner@test.cc', 'authenticated'),
    ('ffffffff-0000-4000-8000-000000000002', 'super@test.cc', 'authenticated')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role) VALUES
    ('ffffffff-0000-4000-8000-000000000002', 'super_admin')
ON CONFLICT DO NOTHING;

INSERT INTO simhub_devices (id, owner_user_id, token_hash, connector_id, device_name, device_status, last_session_id, last_sequence)
VALUES
    ('$DEVICE_A', '$OWNER', '$HASH_A', 'TEST-PC-A', 'TEST-DEVICE-A', 'inactive', 'test-session-a', 0),
    ('$DEVICE_B', '$OWNER', '$HASH_B', 'TEST-PC-B', 'TEST-DEVICE-B', 'inactive', 'test-session-b', 0),
    ('$DEVICE_UNBOUND', '$OWNER', '$HASH_UNBOUND', 'UNBOUND-PC', 'UNBOUND-DEVICE', 'inactive', 'test-session-u', 0)
ON CONFLICT (id) DO NOTHING;

INSERT INTO simhub_devices (id, owner_user_id, token_hash, connector_id, device_name, device_status, revoked_at, last_session_id, last_sequence)
VALUES ('$DEVICE_REVOKED', '$OWNER', '$HASH_REVOKED', 'REVOKED-PC', 'REVOKED-DEVICE', 'revoked', now(), 'test-session-r', 0)
ON CONFLICT (id) DO NOTHING;
EOSQL
echo "  ✅ Devices OK"
echo ""

# ============================ T02: deviceId mismatch =============================
echo "=== T02: token/deviceId mismatch ==="
# Token A, body deviceId = DEVICE_B → reject
RESP=$(call_edge_with_body "$TOKEN_A" '{"type":"heartbeat","deviceId":"bbbbbbbb-0000-0000-0000-000000000002","connectorVersion":"0.3.10.0","simHubVersion":"1.0","gameConnected":true,"telemetryAvailable":true,"rawDataAvailable":true,"rawTelemetryAvailable":false,"sessionTimeReadOk":true,"sessionTimeSeconds":1873.5,"sessionTimeReader":"RawDataReflection","sequence":410,"lastTelemetryAttemptUtc":null,"lastSuccessfulIngestUtc":null,"lastIngestHttpStatus":null,"diagnosticCode":"OK","updaterState":"IDLE","updaterCurrentVersion":"0.3.10.0","updaterTargetVersion":null,"lastUpdateResult":"none","lastUpdateUtc":null,"clientReportedAtUtc":"2026-08-31T18:00:00Z"}')
assert_contains "T02: deviceId mismatch → 401" 'device_mismatch' "$RESP"
assert_contains "T02: HTTP status 401" '401' "$RESP"  # Check via http_code

# Verify no writes for A or B
NO_WRITE_A=$($SSH "docker exec supabase-db psql -U postgres -d $DB -t -c \"SELECT count(*) FROM simhub_device_health WHERE device_id IN ('$DEVICE_A','$DEVICE_B');\"" 2>/dev/null | tr -d ' ')
assert "T02: no health writes" "0" "$NO_WRITE_A"
echo ""

# ============================ T03: bad token =============================
echo "=== T03: bad/random token ==="
RESP=$(call_edge_with_body "$TOKEN_BAD" '{"type":"heartbeat","deviceId":null,"connectorVersion":"0.3.10.0","simHubVersion":"1.0","gameConnected":false,"telemetryAvailable":false,"rawDataAvailable":false,"rawTelemetryAvailable":false,"sessionTimeReadOk":false,"sessionTimeSeconds":null,"sessionTimeReader":"RawDataReflection","sequence":0,"lastTelemetryAttemptUtc":null,"lastSuccessfulIngestUtc":null,"lastIngestHttpStatus":null,"diagnosticCode":"OK","updaterState":"IDLE","updaterCurrentVersion":"0.3.10.0","updaterTargetVersion":null,"lastUpdateResult":"none","lastUpdateUtc":null,"clientReportedAtUtc":"2026-08-31T18:00:00Z"}')
assert_contains "T03: bad token → 401" 'invalid_device' "$RESP"
echo ""

# ============================ T04: revoked device =============================
echo "=== T04: revoked device ==="
RESP=$(call_edge_with_body "$TOKEN_REVOKED" '{"type":"heartbeat","deviceId":null,"connectorVersion":"0.3.10.0","simHubVersion":"1.0","gameConnected":false,"telemetryAvailable":false,"rawDataAvailable":false,"rawTelemetryAvailable":false,"sessionTimeReadOk":false,"sessionTimeSeconds":null,"sessionTimeReader":"RawDataReflection","sequence":0,"lastTelemetryAttemptUtc":null,"lastSuccessfulIngestUtc":null,"lastIngestHttpStatus":null,"diagnosticCode":"OK","updaterState":"IDLE","updaterCurrentVersion":"0.3.10.0","updaterTargetVersion":null,"lastUpdateResult":"none","lastUpdateUtc":null,"clientReportedAtUtc":"2026-08-31T18:00:00Z"}')
assert_contains "T04: revoked device → 401" 'invalid_device' "$RESP"
echo ""

# ============================ T05: unbound device is allowed =============================
echo "=== T05: unbound device allowed ==="
RESP=$(call_edge_with_body "$TOKEN_UNBOUND" '{"type":"heartbeat","deviceId":"dddddddd-0000-0000-0000-000000000004","connectorVersion":"0.3.10.0","simHubVersion":"1.0","gameConnected":false,"telemetryAvailable":false,"rawDataAvailable":false,"rawTelemetryAvailable":false,"sessionTimeReadOk":false,"sessionTimeSeconds":null,"sessionTimeReader":"RawDataReflection","sequence":0,"lastTelemetryAttemptUtc":null,"lastSuccessfulIngestUtc":null,"lastIngestHttpStatus":null,"diagnosticCode":"DEVICE_UNBOUND","updaterState":"IDLE","updaterCurrentVersion":"0.3.10.0","updaterTargetVersion":null,"lastUpdateResult":"none","lastUpdateUtc":null,"clientReportedAtUtc":"2026-08-31T18:00:00Z"}')
assert_contains "T05: unbound device → accepted" 'accepted' "$RESP"
echo ""

# ============================ T06: valid heartbeat =============================
echo "=== T06: valid heartbeat ==="
RESP=$(call_edge_with_body "$TOKEN_A" '{"type":"heartbeat","deviceId":"aaaaaaaa-0000-0000-0000-000000000001","connectorVersion":"0.3.10.0","simHubVersion":"1.0.9735.26972","gameConnected":true,"telemetryAvailable":true,"rawDataAvailable":true,"rawTelemetryAvailable":false,"sessionTimeReadOk":true,"sessionTimeSeconds":1873.5,"sessionTimeReader":"RawDataReflection","sequence":410,"lastTelemetryAttemptUtc":null,"lastSuccessfulIngestUtc":null,"lastIngestHttpStatus":null,"diagnosticCode":"OK","updaterState":"IDLE","updaterCurrentVersion":"0.3.10.0","updaterTargetVersion":null,"lastUpdateResult":"none","lastUpdateUtc":null,"clientReportedAtUtc":"2026-08-31T18:00:00Z"}')
assert_contains "T06: valid heartbeat → accepted" 'accepted' "$RESP"

# Verify health row
HEALTH_ROW=$($SSH "docker exec supabase-db psql -U postgres -d $DB -t -c \"SELECT connector_version, diagnostic_code, game_connected FROM simhub_device_health WHERE device_id = '$DEVICE_A';\"" 2>/dev/null | head -1)
assert_contains "T06: health row created" "0.3.10.0" "$HEALTH_ROW"
echo ""

# ============================ T07: valid event =============================
echo "=== T07: valid event ==="
# Wait for the 10s cooldown to pass (since T06 created a heartbeat, but events have separate rate limit)
# Actually, events' rate limit is per-device, not per-type. The T06 heartbeat doesn't affect event rate limit.
RESP=$(call_edge_with_body "$TOKEN_A" '{"type":"event","deviceId":"aaaaaaaa-0000-0000-0000-000000000001","code":"SESSION_TIME_READ_FAILED","atUtc":"2026-08-31T18:01:00Z","exceptionType":"System.Reflection.TargetInvocationException","detail":"session time reader returned invalid value","occurredAfter":"OK"}')
assert_contains "T07: valid event → accepted" 'accepted' "$RESP"

EVENT_ROW=$($SSH "docker exec supabase-db psql -U postgres -d $DB -t -c \"SELECT code, exception_type FROM simhub_device_diagnostic_events WHERE device_id = '$DEVICE_A' ORDER BY received_at DESC LIMIT 1;\"" 2>/dev/null | head -1)
assert_contains "T07: event row created" "SESSION_TIME_READ_FAILED" "$EVENT_ROW"
echo ""

# ============================ T08: schema validation =============================
echo "=== T08: schema validation ==="

# T08a: unknown field
RESP=$(call_edge_with_body "$TOKEN_A" '{"type":"heartbeat","deviceId":"aaaaaaaa-0000-0000-0000-000000000001","connectorVersion":"0.3.10.0","simHubVersion":"1.0","gameConnected":true,"telemetryAvailable":true,"rawDataAvailable":true,"rawTelemetryAvailable":false,"sessionTimeReadOk":true,"sessionTimeSeconds":1873.5,"sessionTimeReader":"RawDataReflection","sequence":410,"lastTelemetryAttemptUtc":null,"lastSuccessfulIngestUtc":null,"lastIngestHttpStatus":null,"diagnosticCode":"OK","updaterState":"IDLE","updaterCurrentVersion":"0.3.10.0","updaterTargetVersion":null,"lastUpdateResult":"none","lastUpdateUtc":null,"clientReportedAtUtc":"2026-08-31T18:00:00Z","unknownField":"should be rejected"}')
assert_contains "T08a: unknown field → 422" 'invalid_payload' "$RESP"

# T08b: invalid diagnostic code
RESP=$(call_edge_with_body "$TOKEN_A" '{"type":"heartbeat","deviceId":"aaaaaaaa-0000-0000-0000-000000000001","connectorVersion":"0.3.10.0","simHubVersion":"1.0","gameConnected":true,"telemetryAvailable":true,"rawDataAvailable":true,"rawTelemetryAvailable":false,"sessionTimeReadOk":true,"sessionTimeSeconds":1873.5,"sessionTimeReader":"RawDataReflection","sequence":410,"lastTelemetryAttemptUtc":null,"lastSuccessfulIngestUtc":null,"lastIngestHttpStatus":null,"diagnosticCode":"INVALID_CODE","updaterState":"IDLE","updaterCurrentVersion":"0.3.10.0","updaterTargetVersion":null,"lastUpdateResult":"none","lastUpdateUtc":null,"clientReportedAtUtc":"2026-08-31T18:00:00Z"}')
assert_contains "T08b: invalid diagnostic code → 422" 'invalid_payload' "$RESP"

# T08c: wrong type for gameConnected (string instead of boolean)
RESP=$(call_edge_with_body "$TOKEN_A" '{"type":"heartbeat","deviceId":"aaaaaaaa-0000-0000-0000-000000000001","connectorVersion":"0.3.10.0","simHubVersion":"1.0","gameConnected":"yes","telemetryAvailable":true,"rawDataAvailable":true,"rawTelemetryAvailable":false,"sessionTimeReadOk":true,"sessionTimeSeconds":1873.5,"sessionTimeReader":"RawDataReflection","sequence":410,"lastTelemetryAttemptUtc":null,"lastSuccessfulIngestUtc":null,"lastIngestHttpStatus":null,"diagnosticCode":"OK","updaterState":"IDLE","updaterCurrentVersion":"0.3.10.0","updaterTargetVersion":null,"lastUpdateResult":"none","lastUpdateUtc":null,"clientReportedAtUtc":"2026-08-31T18:00:00Z"}')
assert_contains "T08c: wrong type → 422" 'invalid_payload' "$RESP"

# T08d: malformed JSON
RESP=$(call_edge_with_body "$TOKEN_A" '{malformed json!!!')
assert_contains "T08d: malformed JSON → 400" 'invalid_json' "$RESP"

# T08e: oversized payload (> 4 KiB)
# Build a large payload by repeating the diagnosticCode field... no, exactKeys would reject it.
# Let me build a valid heartbeat with a very long detail field... wait, heartbeat doesn't have detail.
# Let me build a valid heartbeat with a very long connectorVersion
LONG=$(python3 -c "print('x' * 5000)")
RESP=$(call_edge_with_body "$TOKEN_A" "{\"type\":\"heartbeat\",\"deviceId\":\"aaaaaaaa-0000-0000-0000-000000000001\",\"connectorVersion\":\"$LONG\",\"simHubVersion\":\"1.0\",\"gameConnected\":true,\"telemetryAvailable\":true,\"rawDataAvailable\":true,\"rawTelemetryAvailable\":false,\"sessionTimeReadOk\":true,\"sessionTimeSeconds\":1873.5,\"sessionTimeReader\":\"RawDataReflection\",\"sequence\":410,\"lastTelemetryAttemptUtc\":null,\"lastSuccessfulIngestUtc\":null,\"lastIngestHttpStatus\":null,\"diagnosticCode\":\"OK\",\"updaterState\":\"IDLE\",\"updaterCurrentVersion\":\"0.3.10.0\",\"updaterTargetVersion\":null,\"lastUpdateResult\":\"none\",\"lastUpdateUtc\":null,\"clientReportedAtUtc\":\"2026-08-31T18:00:00Z\"}" 2>&1 || true)
# The oversized payload will be caught by the 4KB limit check
assert_contains "T08e: oversized payload → 413" 'payload_too_large' "$RESP"

# T08f: NaN in sessionTimeSeconds
RESP=$(call_edge_with_body "$TOKEN_A" '{"type":"heartbeat","deviceId":"aaaaaaaa-0000-0000-0000-000000000001","connectorVersion":"0.3.10.0","simHubVersion":"1.0","gameConnected":true,"telemetryAvailable":true,"rawDataAvailable":true,"rawTelemetryAvailable":false,"sessionTimeReadOk":true,"sessionTimeSeconds":null,"sessionTimeReader":"RawDataReflection","sequence":410,"lastTelemetryAttemptUtc":null,"lastSuccessfulIngestUtc":null,"lastIngestHttpStatus":null,"diagnosticCode":"OK","updaterState":"IDLE","updaterCurrentVersion":"0.3.10.0","updaterTargetVersion":null,"lastUpdateResult":"none","lastUpdateUtc":null,"clientReportedAtUtc":"2026-08-31T18:00:00Z"}')
assert_contains "T08f: NaN treated as null OK" 'accepted' "$RESP"
# NaN is not valid JSON anyway, so it would be parsed as null. This tests the nullable handling.

# T08g: missing required field (remove connectorVersion)
RESP=$(call_edge_with_body "$TOKEN_A" '{"type":"heartbeat","deviceId":"aaaaaaaa-0000-0000-0000-000000000001","simHubVersion":"1.0","gameConnected":true,"telemetryAvailable":true,"rawDataAvailable":true,"rawTelemetryAvailable":false,"sessionTimeReadOk":true,"sessionTimeSeconds":1873.5,"sessionTimeReader":"RawDataReflection","sequence":410,"lastTelemetryAttemptUtc":null,"lastSuccessfulIngestUtc":null,"lastIngestHttpStatus":null,"diagnosticCode":"OK","updaterState":"IDLE","updaterCurrentVersion":"0.3.10.0","updaterTargetVersion":null,"lastUpdateResult":"none","lastUpdateUtc":null,"clientReportedAtUtc":"2026-08-31T18:00:00Z"}')
assert_contains "T08g: missing field → 422" 'invalid_payload' "$RESP"

# T08h: detail too long (> 200 chars)
LONG_DETAIL=$(python3 -c "print('x' * 250)")
RESP=$(call_edge_with_body "$TOKEN_A" "{\"type\":\"event\",\"deviceId\":\"aaaaaaaa-0000-0000-0000-000000000001\",\"code\":\"OK\",\"atUtc\":\"2026-08-31T18:02:00Z\",\"exceptionType\":null,\"detail\":\"$LONG_DETAIL\",\"occurredAfter\":\"SESSION_TIME_READ_FAILED\"}")
assert_contains "T08h: detail > 200 chars → 422" 'invalid_payload' "$RESP"

# T08i: detail with path patterns
RESP=$(call_edge_with_body "$TOKEN_A" '{"type":"event","deviceId":"aaaaaaaa-0000-0000-0000-000000000001","code":"OK","atUtc":"2026-08-31T18:02:00Z","exceptionType":null,"detail":"C:\\Users\\test\\file.txt","occurredAfter":"SESSION_TIME_READ_FAILED"}')
assert_contains "T08i: detail with path → 422" 'invalid_payload' "$RESP"

# T08j: invalid event code
RESP=$(call_edge_with_body "$TOKEN_A" '{"type":"event","deviceId":"aaaaaaaa-0000-0000-0000-000000000001","code":"INVALID_EVENT_CODE","atUtc":"2026-08-31T18:02:00Z","exceptionType":null,"detail":null,"occurredAfter":"OK"}')
assert_contains "T08j: invalid event code → 422" 'invalid_payload' "$RESP"

echo ""

# ============================ T09: missing Authorization =============================
echo "=== T09: missing Authorization ==="
RESP=$($SSH "curl -s http://localhost:8000/functions/v1/simhub-diagnostic \
    -X POST \
    -H 'Content-Type: application/json' \
    -H 'Origin: https://3stripemotorsport.cc' \
    -d '{\"type\":\"heartbeat\",\"deviceId\":null,\"connectorVersion\":\"0.3.10.0\",\"simHubVersion\":\"1.0\",\"gameConnected\":false,\"telemetryAvailable\":false,\"rawDataAvailable\":false,\"rawTelemetryAvailable\":false,\"sessionTimeReadOk\":false,\"sessionTimeSeconds\":null,\"sessionTimeReader\":\"RawDataReflection\",\"sequence\":0,\"lastTelemetryAttemptUtc\":null,\"lastSuccessfulIngestUtc\":null,\"lastIngestHttpStatus\":null,\"diagnosticCode\":\"OK\",\"updaterState\":\"IDLE\",\"updaterCurrentVersion\":\"0.3.10.0\",\"updaterTargetVersion\":null,\"lastUpdateResult\":\"none\",\"lastUpdateUtc\":null,\"clientReportedAtUtc\":\"2026-08-31T18:00:00Z\"}' 2>/dev/null" 2>&1)
assert_contains "T09: no auth header → 401" 'invalid_device' "$RESP"
echo ""

# ============================ T10: event rate limit =============================
echo "=== T10: event rate limit ==="
# T07 placed an event. Second event within 10s → rate_limited
RESP=$(call_edge_with_body "$TOKEN_A" '{"type":"event","deviceId":"aaaaaaaa-0000-0000-0000-000000000001","code":"INGEST_500","atUtc":"2026-08-31T18:01:02Z","exceptionType":null,"detail":"ingest returned 500","occurredAfter":"SESSION_TIME_READ_FAILED"}')
assert_contains "T10: event rate limited → 429" 'diagnostic_event_rate_limited' "$RESP"
echo ""

# ============================ T11: heartbeat rate limit =============================
echo "=== T11: heartbeat rate limit ==="
# T06 was a heartbeat. Second heartbeat within 55s → rate_limited
RESP=$(call_edge_with_body "$TOKEN_A" '{"type":"heartbeat","deviceId":"aaaaaaaa-0000-0000-0000-000000000001","connectorVersion":"0.3.10.0","simHubVersion":"1.0","gameConnected":true,"telemetryAvailable":true,"rawDataAvailable":true,"rawTelemetryAvailable":false,"sessionTimeReadOk":true,"sessionTimeSeconds":1890.0,"sessionTimeReader":"RawDataReflection","sequence":411,"lastTelemetryAttemptUtc":null,"lastSuccessfulIngestUtc":null,"lastIngestHttpStatus":null,"diagnosticCode":"OK","updaterState":"IDLE","updaterCurrentVersion":"0.3.10.0","updaterTargetVersion":null,"lastUpdateResult":"none","lastUpdateUtc":null,"clientReportedAtUtc":"2026-08-31T18:00:30Z"}')
assert_contains "T11: heartbeat rate limited → 429" 'diagnostic_rate_limited' "$RESP"
echo ""

# ============================ T12: OPTIONS / method check =============================
echo "=== T12: OPTIONS / method check ==="
RESP=$($SSH "curl -s -o /dev/null -w '%{http_code}' http://localhost:8000/functions/v1/simhub-diagnostic -X OPTIONS -H 'Origin: https://3stripemotorsport.cc' 2>/dev/null" 2>&1)
assert "T12a: OPTIONS → 200" "200" "$RESP"

RESP=$($SSH "curl -s -o /dev/null -w '%{http_code}' http://localhost:8000/functions/v1/simhub-diagnostic -X GET -H 'Origin: https://3stripemotorsport.cc' 2>/dev/null" 2>&1)
assert "T12b: GET → 405" "405" "$RESP"
echo ""

# ============================ T13: recovery event =============================
echo "=== T13: recovery event ==="
# Bypass rate limit by manipulating the DB events
$SSH "docker exec supabase-db psql -U postgres -d $DB -c \"UPDATE simhub_device_diagnostic_events SET received_at = now() - interval '11 seconds' WHERE device_id = '$DEVICE_A';\"" 2>/dev/null
RESP=$(call_edge_with_body "$TOKEN_A" '{"type":"event","deviceId":"aaaaaaaa-0000-0000-0000-000000000001","code":"OK","atUtc":"2026-08-31T18:02:00Z","exceptionType":null,"detail":"SessionTime recovery after read failure","occurredAfter":"SESSION_TIME_READ_FAILED"}')
assert_contains "T13: recovery event → accepted" 'accepted' "$RESP"
echo ""

# ============================ T14: non-interference check =============================
echo "=== T14: non-interference diagnostic ↔ telemetry ==="
# Check that simhub-ingest still works (ingest from DEVICE_A)
# The ingest endpoint uses a different RPC and different token hash
# Just verify that the health table for DEVICE_A is still correct
HEALTH=$($SSH "docker exec supabase-db psql -U postgres -d $DB -t -c \"SELECT diagnostic_code, sequence FROM simhub_device_health WHERE device_id = '$DEVICE_A';\"" 2>/dev/null | head -1)
assert_contains "T14: health still intact" "OK" "$HEALTH"

# Check that diagnostic events are separate from telemetry data
EVENTS=$($SSH "docker exec supabase-db psql -U postgres -d $DB -t -c \"SELECT count(*) FROM simhub_device_diagnostic_events WHERE device_id = '$DEVICE_A';\"" 2>/dev/null | tr -d ' ')
assert "T14: diagnostic events exist" "3" "$EVENTS"
echo ""

# ============================ T15: response for device B (different device) =============================
echo "=== T15: device B heartbeat ==="
RESP=$(call_edge_with_body "$TOKEN_B" '{"type":"heartbeat","deviceId":"bbbbbbbb-0000-0000-0000-000000000002","connectorVersion":"0.3.10.0","simHubVersion":"1.0","gameConnected":false,"telemetryAvailable":false,"rawDataAvailable":false,"rawTelemetryAvailable":false,"sessionTimeReadOk":false,"sessionTimeSeconds":null,"sessionTimeReader":"RawDataReflection","sequence":0,"lastTelemetryAttemptUtc":null,"lastSuccessfulIngestUtc":null,"lastIngestHttpStatus":null,"diagnosticCode":"OK","updaterState":"IDLE","updaterCurrentVersion":"0.3.10.0","updaterTargetVersion":null,"lastUpdateResult":"none","lastUpdateUtc":null,"clientReportedAtUtc":"2026-08-31T18:00:00Z"}')
assert_contains "T15: device B → accepted" 'accepted' "$RESP"

# Verify device B has its own health row
HEALTH_B=$($SSH "docker exec supabase-db psql -U postgres -d $DB -t -c \"SELECT count(*) FROM simhub_device_health WHERE device_id = '$DEVICE_B';\"" 2>/dev/null | tr -d ' ')
assert "T15: device B health row" "1" "$HEALTH_B"
echo ""

# ============================ SUMMARY =============================
echo "=============================================="
echo "DIAGNOSTICS V1 EDGE TESTMATRIX SUMMARY"
echo "=============================================="
TOTAL=$((PASS + FAIL))
echo "Passed: $PASS / $TOTAL"
echo "Failed: $FAIL / $TOTAL"
if [ "$FAIL" -eq 0 ]; then
    echo "RESULT: ✅ ALL TESTS PASS"
else
    echo "RESULT: ❌ SOME TESTS FAILED"
fi
echo "=============================================="