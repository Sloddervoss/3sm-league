#!/bin/bash
# Run after publishing this checkout's dist. Keep scheduled HTML on that release.
set -euo pipefail
release_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
cd "$release_dir"
node --input-type=module -e 'import {readFileSync} from "node:fs"; import {assertSameSiteBuild} from "./scripts/seo-release-guard.mjs"; assertSameSiteBuild(readFileSync("dist/index.html","utf8"), readFileSync("/var/www/3sm/index.html","utf8"));'
if systemctl cat 3sm-seo-refresh.service >/dev/null 2>&1; then
  mkdir -p /etc/systemd/system/3sm-seo-refresh.service.d
  printf '[Service]\nWorkingDirectory=%s\nExecStart=\nExecStart=/usr/bin/flock /var/lock/3sm-site.lock /usr/bin/npm run seo:refresh\n' "$release_dir" > /etc/systemd/system/3sm-seo-refresh.service.d/active-release.conf
  systemctl daemon-reload
fi
