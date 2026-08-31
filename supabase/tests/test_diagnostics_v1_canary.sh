#!/usr/bin/env bash
# ==============================================================================
# Fase C Canary + Quick Matrix — Remote Diagnostics v1
# Loopt lokaal op Hermes-host, roept test PostgREST op 192.168.50.23:3001 aan.
# Alle RPCs via RETURNS jsonb (scalar) contract.
# ==============================================================================
set -euo pipefail

BASE="http://192.168.50.23:3001/rpc"
HEADERS=(-H "Content-Type: application/json" -H "Accept: application/json")

# Token hashes (64-char hex) voor test devices in test_diagnostics_v1
TOKEN_A="025d8db15e119cf6f20f667973d05435c7fae06944e3146811731d2eed6c9ab8"
TOKEN_B="b7e8c9d0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b789"
TOKEN_REVOKED="0000111122223333444455556666777788889999aaaabbbbccccddddeeeeffff"
TOKEN_UNBOUND="aaaaaaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa7777bbbb"
TOKEN_BAD="0000000000000000000000000000000000000000000000000000000000000000"
TOKEN_SCHEMA="ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"

PASS=0
FAIL=0

run_test() {
    local desc="$1"
    local method="$2"
    local expected_status="$3"
    local expected_body_contains="$4"
    local body="$5"
    
    local response
    response=$(curl -s -w '\nHTTP:%{http_code}' "$BASE/$method" -X POST "${HEADERS[@]}" -d "$body" 2>/dev/null)
    local http_code
    http_code=$(echo "$response" | grep 'HTTP:' | sed 's/HTTP://')
    local resp_body
    resp_body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" = "$expected_status" ] && echo "$resp_body" | grep -q "$expected_body_contains"; then
        echo "PASS: $desc"
        PASS=$((PASS+1))
    else
        echo "FAIL: $desc"
        echo "  Expected: HTTP $expected_status, body contains '$expected_body_contains'"
        echo "  Got:      HTTP $http_code, body: $resp_body"
        FAIL=$((FAIL+1))
    fi
}

echo "=========================================="
echo "  Fase C Canary + Quick Matrix"
echo "  $(date -u)"
echo "=========================================="
echo ""

# === 0. CANARY ===
echo "--- 0. Canary ---"
run_test "Database identity = test_diagnostics_v1" \
    "diagnostics_test_database_identity" "200" "test_diagnostics_v1" "{}"

# === 1. HEARTBEAT ===
echo "--- 1. Heartbeat ---"
HEALTH_A='{"type":"heartbeat","deviceId":"aaaaaaaa-0000-0000-0000-000000000001","connectorVersion":"0.3.10.0","simHubVersion":"1.0.9735.26972","gameConnected":true,"telemetryAvailable":true,"rawDataAvailable":true,"rawTelemetryAvailable":false,"sessionTimeReadOk":true,"sessionTimeSeconds":1873.5,"sessionTimeReader":"RawDataReflection","sequence":410,"lastTelemetryAttemptUtc":null,"lastSuccessfulIngestUtc":null,"lastIngestHttpStatus":null,"diagnosticCode":"OK","updaterState":"IDLE","updaterCurrentVersion":"0.3.10.0","updaterTargetVersion":null,"lastUpdateResult":"none","lastUpdateUtc":null,"clientReportedAtUtc":"2026-08-31T18:00:00Z"}'
HEALTH_B='{"type":"heartbeat","deviceId":"bbbbbbbb-0000-0000-0000-000000000002","connectorVersion":"0.3.10.0","simHubVersion":"1.0.9735.26972","gameConnected":true,"telemetryAvailable":true,"rawDataAvailable":true,"rawTelemetryAvailable":false,"sessionTimeReadOk":true,"sessionTimeSeconds":1000,"sessionTimeReader":"RawDataReflection","sequence":1,"diagnosticCode":"OK","updaterState":"IDLE","updaterCurrentVersion":"0.3.10.0","clientReportedAtUtc":"2026-08-31T18:00:00Z"}'
HEALTH_UNBOUND='{"type":"heartbeat","deviceId":"dddddddd-0000-0000-0000-000000000004","connectorVersion":"0.3.10.0","simHubVersion":"1.0.9735.26972","gameConnected":false,"telemetryAvailable":false,"rawDataAvailable":false,"rawTelemetryAvailable":false,"sessionTimeReadOk":false,"sessionTimeSeconds":0,"sessionTimeReader":"RawDataReflection","sequence":1,"diagnosticCode":"DEVICE_UNBOUND","updaterState":"IDLE","updaterCurrentVersion":"0.3.10.0","clientReportedAtUtc":"2026-08-31T18:00:00Z"}'

run_test "T01: Valid heartbeat (device A)" \
    "simhub_upsert_health" "200" "accepted" \
    "{\"p_token_hash\":\"$TOKEN_A\",\"p_health\":$HEALTH_A}"

run_test "T01b: Valid heartbeat (device B)" \
    "simhub_upsert_health" "200" "accepted" \
    "{\"p_token_hash\":\"$TOKEN_B\",\"p_health\":$HEALTH_B}"

# === 2. AUTH ===
echo "--- 2. Auth ---"
run_test "T03: Bad token → invalid_device" \
    "simhub_upsert_health" "200" "invalid_device" \
    "{\"p_token_hash\":\"$TOKEN_BAD\",\"p_health\":$HEALTH_A}"

run_test "T04: Revoked device → invalid_device" \
    "simhub_upsert_health" "200" "invalid_device" \
    "{\"p_token_hash\":\"$TOKEN_REVOKED\",\"p_health\":{\"type\":\"heartbeat\",\"deviceId\":\"cccccccc-0000-0000-0000-000000000003\",\"connectorVersion\":\"0.3.10.0\",\"simHubVersion\":\"1.0.9735.26972\",\"gameConnected\":true,\"telemetryAvailable\":true,\"rawDataAvailable\":true,\"rawTelemetryAvailable\":false,\"sessionTimeReadOk\":true,\"sessionTimeSeconds\":0,\"sessionTimeReader\":\"RawDataReflection\",\"sequence\":1,\"diagnosticCode\":\"OK\",\"updaterState\":\"IDLE\",\"updaterCurrentVersion\":\"0.3.10.0\",\"clientReportedAtUtc\":\"2026-08-31T18:00:00Z\"}}"

run_test "T05: Unbound device → diagnostics allowed" \
    "simhub_upsert_health" "200" "accepted" \
    "{\"p_token_hash\":\"$TOKEN_UNBOUND\",\"p_health\":$HEALTH_UNBOUND}"

# === 3. EVENTS ===
echo "--- 3. Events ---"
EVENT_A='{"type":"diagnostic","deviceId":"aaaaaaaa-0000-0000-0000-000000000001","code":"SESSION_TIME_READ_FAILED","exceptionType":"NullReferenceException","detail":"SessionTime not available","atUtc":"2026-08-31T18:05:00Z"}'
EVENT_A2='{"type":"diagnostic","deviceId":"aaaaaaaa-0000-0000-0000-000000000001","code":"RAW_DATA_UNAVAILABLE","atUtc":"2026-08-31T18:06:00Z"}'
EVENT_A3='{"type":"diagnostic","deviceId":"aaaaaaaa-0000-0000-0000-000000000001","code":"TELEMETRY_STALE","atUtc":"2026-08-31T18:07:00Z"}'

run_test "T06: Valid event → accepted" \
    "simhub_insert_diagnostic_event" "200" "accepted" \
    "{\"p_token_hash\":\"$TOKEN_A\",\"p_event\":$EVENT_A}"

run_test "T07: Revoked device event → invalid_device" \
    "simhub_insert_diagnostic_event" "200" "invalid_device" \
    "{\"p_token_hash\":\"$TOKEN_REVOKED\",\"p_event\":$EVENT_A}"

# === 4. RATE LIMITS ===
echo "--- 4. Rate limits ---"
run_test "T08: Heartbeat rate-limit (2e binnen 55s)" \
    "simhub_upsert_health" "200" "diagnostic_rate_limited" \
    "{\"p_token_hash\":\"$TOKEN_A\",\"p_health\":$HEALTH_A}"

sleep 12  # wacht tot event rate limit (10s) gereset is voor device A

run_test "T09: Event accepted (after 12s wait)" \
    "simhub_insert_diagnostic_event" "200" "accepted" \
    "{\"p_token_hash\":\"$TOKEN_A\",\"p_event\":$EVENT_A2}"

run_test "T09b: Event rate-limited (2e <10s)" \
    "simhub_insert_diagnostic_event" "200" "diagnostic_event_rate_limited" \
    "{\"p_token_hash\":\"$TOKEN_A\",\"p_event\":$EVENT_A3}"

# === 5. SCHEMA (RPC-side: type casting) ===
echo "--- 5. Schema validation ---"
run_test "T10: Invalid diagnostic code → 400 type error" \
    "simhub_upsert_health" "400" "simhub_diagnostic_code" \
    "{\"p_token_hash\":\"$TOKEN_SCHEMA\",\"p_health\":{\"type\":\"heartbeat\",\"deviceId\":\"eeeeeeee-0000-0000-0000-000000000005\",\"connectorVersion\":\"0.3.10.0\",\"simHubVersion\":\"1.0.9735.26972\",\"gameConnected\":true,\"telemetryAvailable\":true,\"rawDataAvailable\":true,\"rawTelemetryAvailable\":false,\"sessionTimeReadOk\":true,\"sessionTimeSeconds\":0,\"sessionTimeReader\":\"RawDataReflection\",\"sequence\":1,\"diagnosticCode\":\"INVALID_CODE\",\"updaterState\":\"IDLE\",\"updaterCurrentVersion\":\"0.3.10.0\",\"clientReportedAtUtc\":\"2026-08-31T18:00:00Z\"}}"

# === SUMMARY ===
echo ""
echo "=========================================="
echo "  RESULTS: $PASS passed, $FAIL failed"
echo "  $(date -u)"
echo "=========================================="
# Note: T02 (deviceId mismatch) requires Edge function flow — niet via direct RPC
echo ""
echo "NOTE: T02 deviceId mismatch is Edge-side alleen testbaar."
echo "NOTE: Non-interference requires live telemetry ingest test."
echo "NOTE: Privacy logging is code-review verified (geen raw error.message)."
exit $FAIL