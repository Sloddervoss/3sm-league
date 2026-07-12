#!/usr/bin/env bash
# Proves direct browser-role writes to public.user_roles are rejected by PostgREST.
# Inputs are deliberately supplied by the caller; do not print JWTs or API keys.
set -euo pipefail

: "${API_URL:?Set API_URL, e.g. http://127.0.0.1:3011}"
: "${ACTOR_JWT:?Set the ordinary authenticated test JWT}"
: "${TARGET_USER_ID:?Set an existing user_roles.user_id}"
: "${TARGET_ROLE:?Set that row's existing role value}"

workdir=$(mktemp -d)
trap 'rm -rf "$workdir"' EXIT

status=$(curl --silent --show-error --max-time 15 \
  --request PATCH \
  --url "$API_URL/user_roles?user_id=eq.$TARGET_USER_ID&role=eq.$TARGET_ROLE" \
  --header "Authorization: Bearer $ACTOR_JWT" \
  --header 'Content-Type: application/json' \
  --header 'Prefer: return=representation' \
  --data "{\"role\":\"$TARGET_ROLE\"}" \
  --dump-header "$workdir/headers" \
  --output "$workdir/body" \
  --write-out '%{http_code}')

# Preserve evidence without retaining secrets or stable identifiers.
redact() {
  sed -E \
    -e 's/[0-9a-f]{8}-[0-9a-f-]{27,}/[REDACTED-UUID]/gi' \
    -e 's/(Bearer )[A-Za-z0-9._-]+/\1[REDACTED]/g'
}

echo "role_write_probe_http=$status"
echo "role_write_probe_headers:"
redact < "$workdir/headers" | tr -d '\r' | grep -Ei '^(HTTP/|content-type:|content-range:|www-authenticate:)' || true
echo "role_write_probe_body:"
redact < "$workdir/body" | head -c 512; echo

if [[ "$status" != "403" ]]; then
  echo "role_write_probe_result=FAIL expected_http=403 actual_http=$status" >&2
  exit 1
fi

echo "role_write_probe_result=PASS expected_http=403"
