#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Voer deze installer als root uit." >&2
  exit 1
fi

ENV_FILE=/etc/3sm/iracing-endurance-sync.env
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)
if [[ ! -f "$ENV_FILE" ]]; then
  echo "$ENV_FILE ontbreekt; maak het 0600 envbestand eerst aan." >&2
  exit 1
fi
if [[ $(stat -c '%a' "$ENV_FILE") != 600 ]]; then
  echo "$ENV_FILE moet mode 0600 hebben." >&2
  exit 1
fi
if ! grep -q '^ENDURANCE_IRACING_SYNC_URL=' "$ENV_FILE" || ! grep -q '^ENDURANCE_IRACING_SYNC_TOKEN=' "$ENV_FILE"; then
  echo "$ENV_FILE mist URL of dedicated scheduler-token." >&2
  exit 1
fi

install -m 0755 "$REPO_ROOT/scripts/sync-iracing-endurance-events.sh" /usr/local/libexec/3sm-iracing-endurance-sync
install -m 0644 "$REPO_ROOT/ops/systemd/3sm-iracing-endurance-sync.service" /etc/systemd/system/3sm-iracing-endurance-sync.service
install -m 0644 "$REPO_ROOT/ops/systemd/3sm-iracing-endurance-sync.timer" /etc/systemd/system/3sm-iracing-endurance-sync.timer
systemctl daemon-reload
systemctl start 3sm-iracing-endurance-sync.service
systemctl enable --now 3sm-iracing-endurance-sync.timer
systemctl is-active 3sm-iracing-endurance-sync.timer
systemctl list-timers 3sm-iracing-endurance-sync.timer --all --no-pager
