#!/bin/sh
# Preflight vóór het publiceren van een 3SM site-release.
#
# Gebruik (OP de site-host, niet in de webroot):
#     sh preflight-release-check.sh <nieuwe-release-map> [live-url]
#
# Elke regel moet PASS zijn voordat je publiceert. Exit 1 zodra iets FAIL is.
# Dit script publiceert niets: het leest, vergelijkt en proefdraait alleen.
#
# De routeverzameling wordt vergeleken met de LIVE sitemap, niet met een
# hardcoded aantal: gelijke aantallen kunnen een andere verzameling zijn en
# --delete-after werkt juist op dat verschil.

set -u
NIEUW="${1:-}"
LIVE="${2:-https://3stripemotorsport.cc}"
WEBROOT=/var/www/3sm

[ -n "$NIEUW" ] || { echo "gebruik: $0 <nieuwe-release-map> [live-url]"; exit 2; }
[ -d "$NIEUW/dist" ] || { echo "FAIL: $NIEUW/dist bestaat niet"; exit 2; }

fout=0
ok()  { printf '  PASS  %s\n' "$1"; }
mis() { printf '  FAIL  %s\n' "$1"; fout=1; }

echo "=== 1. is de omgeving meegebouwd? ==="
keys=$(grep -cE '^VITE_' "$NIEUW/.env" 2>/dev/null)
[ -n "$keys" ] || keys=0
if [ "$keys" -ge 2 ]; then
  ok ".env heeft $keys VITE_-sleutels"
else
  mis ".env mist de Supabase-sleutels: de bouw verliest dan alle dynamische routes en de app start niet"
fi

echo "=== 2. routeverzameling tegenover de live site ==="
grep -o '<loc>[^<]*' "$NIEUW/dist/sitemap.xml" | sed 's/<loc>//' | sort > /tmp/routes-nieuw.txt
nieuw_n=$(wc -l < /tmp/routes-nieuw.txt)
curl -s --max-time 30 "$LIVE/sitemap.xml" | grep -o '<loc>[^<]*' | sed 's/<loc>//' | sort > /tmp/routes-live.txt
live_n=$(wc -l < /tmp/routes-live.txt)
printf '  nieuw: %s   live: %s\n' "$nieuw_n" "$live_n"
if [ "$nieuw_n" -lt 25 ]; then mis "minder dan 25 routes in de nieuwe sitemap"; fi
if [ "$live_n" -lt 25 ]; then
  mis "kon de live sitemap niet ophalen — vergelijking niet mogelijk, dus geen groen licht"
else
  verschil=$(comm -3 /tmp/routes-live.txt /tmp/routes-nieuw.txt | wc -l)
  if [ "$verschil" -eq 0 ]; then
    ok "routeverzameling identiek aan de live site"
  else
    mis "routeverzameling wijkt af ($verschil regels)"
    comm -3 /tmp/routes-live.txt /tmp/routes-nieuw.txt | head -20 | sed 's/^/        /'
  fi
fi

echo "=== 3. proefdraai van de publicatie ==="
rsync -a --delete-after --exclude='assets/' --exclude='downloads/' \
  --dry-run --itemize-changes "$NIEUW/dist/" "$WEBROOT/" > /tmp/preflight-droog.txt 2>&1
verwijderd=$(grep -c '^\*deleting' /tmp/preflight-droog.txt)
[ -n "$verwijderd" ] || verwijderd=0
if [ "$verwijderd" -eq 0 ]; then
  ok "0 verwijderingen in de proefdraai"
else
  mis "$verwijderd verwijderingen in de proefdraai"
  grep '^\*deleting' /tmp/preflight-droog.txt | head -20 | sed 's/^/        /'
fi

echo "=== 4. de bundel (noteer beide; na publicatie moet de live de nieuwe zijn) ==="
printf '  nieuw: %s\n' "$(grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' "$NIEUW/dist/index.html" | head -1)"
printf '  live:  %s\n' "$(grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' "$WEBROOT/index.html" | head -1)"

echo "=== 5. de extensie-zip die gebruikers downloaden ==="
a=$(sha256sum "$NIEUW/dist/iracing-content-extension.zip" 2>/dev/null | cut -d' ' -f1)
b=$(sha256sum "$WEBROOT/iracing-content-extension.zip" 2>/dev/null | cut -d' ' -f1)
if [ -z "$a" ]; then
  mis "geen iracing-content-extension.zip in de nieuwe bouw"
elif [ "$a" = "$b" ]; then
  ok "byte-gelijk: er verandert niets voor wie hem downloadt"
else
  printf '  LET OP  de zip verandert: %s -> %s (meld dit na de publicatie)\n' "$(printf %s "$a" | cut -c1-16)" "$(printf %s "$b" | cut -c1-16)"
fi

echo
echo "=== na de publicatie nog te doen (niet in dit script) ==="
echo "  1. de live bundel ophalen en byte-vergelijken met de bouw"
echo "  2. de app in een ECHTE browser laden: window.__errs leeg en"
echo "     document.getElementById('root').children.length > 0"
echo "  3. pin-seo-release.sh draaien zodat de SEO-timer de nieuwe map gebruikt"
echo
echo "=== uitkomst ==="
if [ "$fout" -eq 0 ]; then echo "ALLES PASS — publiceren mag"; else echo "ER IS IETS FAIL — niet publiceren"; fi
exit "$fout"
