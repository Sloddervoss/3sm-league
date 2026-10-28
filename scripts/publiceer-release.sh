#!/bin/sh
# Publiceert een release-map naar /var/www/3sm.
# Gebruik: sh publiceer-release.sh <release-map>
#
# Vaste stappen: assets zonder --delete (open tabbladen blijven werken), de rest
# met --delete-after terwijl downloads/ en assets/ worden uitgezonderd, daarna de
# SEO-timer aan deze map vastzetten. Alles onder dezelfde lock als deploy.sh en de
# seo-refresh-timer, zodat er nooit een build naast een publicatie loopt.
set -eu

REL="${1:?gebruik: sh publiceer-release.sh <release-map>}"
[ -d "$REL/dist" ] || { echo "  FOUT: $REL/dist bestaat niet"; exit 1; }

cd "$REL"
echo "  release: $(pwd) op $(git rev-parse --short HEAD 2>/dev/null || echo '?')"

exec 9>/var/lock/3sm-site.lock
flock 9

echo "  --- assets (zonder --delete) ---"
rsync -a dist/assets/ /var/www/3sm/assets/

echo "  --- de rest, met --delete-after ---"
rsync -a --delete-after --exclude='assets/' --exclude='downloads/' dist/ /var/www/3sm/

echo "  --- de SEO-timer aan deze release vastzetten ---"
bash scripts/pin-seo-release.sh

echo "  --- wat staat er nu live? ---"
echo "    entry:  $(grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' /var/www/3sm/index.html | head -1)"
echo "    routes: $(find /var/www/3sm -name index.html | wc -l) index.html-bestanden"
if diff -q dist/index.html /var/www/3sm/index.html >/dev/null 2>&1; then
  echo "    index.html: identiek aan de build"
else
  echo "    index.html: WIJKT AF"
fi
echo "    actieve release: $(grep WorkingDirectory /etc/systemd/system/3sm-seo-refresh.service.d/active-release.conf | cut -d= -f2)"
