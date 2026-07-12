#!/usr/bin/env bash
set -euo pipefail

: "${API_URL:?Set API_URL}"
: "${ACTOR_JWT:?Set ordinary-user staging JWT}"
: "${TARGET_USER_ID:?Set existing user_roles user ID}"
: "${TARGET_ROLE:?Set existing user_roles role}"

workdir=$(mktemp -d)
trap 'rm -rf "$workdir"' EXIT
payload=$(printf '{"role":"%s"}' "$TARGET_ROLE")

status=$(curl --silent --show-error --max-time 15 --request PATCH \
  --url "$API_URL/user_roles?user_id=eq.$TARGET_USER_ID&role=eq.$TARGET_ROLE" \
  --header "Authorization: Bearer $ACTOR_JWT" \
  --header 'Content-Type: application/json' \
  --header 'Prefer: return=representation' \
  --data "$payload" \
  --dump-header "$workdir/headers" \
  --output "$workdir/body" \
  --write-out '%{http_code}')

redact() {
  sed -E -e 's/[0-9a-f]{8}-[0-9a-f-]{27,}/[REDACTED-UUID]/gi' -e 's/(Bearer )[A-Za-z0-9._-]+/\1[REDACTED]/g'
}

echo "role_write_probe_http=$status"
echo "role_write_probe_headers:"
redact < "$workdir/headers" | tr -d '\r' | grep -Ei '^(HTTP/|content-type:|content-range:|www-authenticate:)' || true
echo "role_write_probe_body:"
redact < "$workdir/body" | head -c 512; echo

if [[ "$status" != 403 ]]; then
  echo "role_write_probe_result=FAIL expected_http=403 actual_http=$status" >&2
  exit 1
fi
echo "role_write_probe_result=PASS expected_http=403"
