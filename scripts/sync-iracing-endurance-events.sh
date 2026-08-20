#!/usr/bin/env bash
set -euo pipefail

: "${ENDURANCE_IRACING_SYNC_URL:?ENDURANCE_IRACING_SYNC_URL ontbreekt}"
: "${ENDURANCE_IRACING_SYNC_TOKEN:?ENDURANCE_IRACING_SYNC_TOKEN ontbreekt}"

curl --fail-with-body --silent --show-error \
  --connect-timeout 10 --max-time 180 \
  --request POST \
  --header "Authorization: Bearer ${ENDURANCE_IRACING_SYNC_TOKEN}" \
  --header "Content-Type: application/json" \
  --data '{}' \
  "${ENDURANCE_IRACING_SYNC_URL}"
