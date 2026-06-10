#!/bin/bash
set -euo pipefail

cat >/etc/systemd/system/3sm-seo-refresh.service <<'UNIT'
[Unit]
Description=Refresh 3SM dynamic SEO route HTML and sitemap
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
WorkingDirectory=/opt/3sm
Environment=WEBROOT=/var/www/3sm
ExecStart=/usr/bin/npm run seo:refresh
Nice=10
IOSchedulingClass=best-effort
IOSchedulingPriority=7
UNIT

cat >/etc/systemd/system/3sm-seo-refresh.timer <<'UNIT'
[Unit]
Description=Refresh 3SM dynamic SEO route HTML and sitemap every 5 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
AccuracySec=30s
Persistent=true
Unit=3sm-seo-refresh.service

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now 3sm-seo-refresh.timer
systemctl list-timers 3sm-seo-refresh.timer --no-pager
