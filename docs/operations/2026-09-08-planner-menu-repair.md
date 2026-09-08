# Planner and recurring menu regression repair

The live menu reverted because `3sm-seo-refresh.service` still used `/opt/3sm`, whose dist belonged to an older release. GitHub main remained at 10ecb92 while the scheduled refresh restored `index-Chvg0dDJ.js` into the live HTML.

Website deployment must publish hashed assets before HTML, preserve downloads, and run `bash scripts/pin-seo-release.sh` from the built release afterwards. The SEO service then uses that exact checkout. Both the deployment and the pinned service use `/var/lock/3sm-site.lock`. The refresh script rejects a mismatch between its built entry bundle and the current live entry bundle before generating or publishing HTML.

Verification after deployment: run the SEO service once and compare the public entry bundle before/after. It must remain the deployed bundle. The installed systemd override is `/etc/systemd/system/3sm-seo-refresh.service.d/active-release.conf`. Restore this override together with the webroot when rolling back.

Planner changes preserve full stint metadata and status, combine cross-driver dragging into one write, await publications and edits, block invalid publications, synchronize the first team after loading, and recognize global Endurance managers. Active/non-draft stints are changed through Race Control. Generation validates complete availability windows, rest, consecutive and total driving limits. Unsupported hourly optimizer inputs use an exact-time local proposal; optimizer results are independently validated. No database migrations are required.

Mobile and narrow-browser navigation use a labeled race-menu selector; desktop keeps the eight consolidated sections. Small screens show chronological stint cards, while desktop retains driver lanes. Start edits include the date and use Europe/Amsterdam throughout.
