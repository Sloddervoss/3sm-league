#!/bin/bash
# Run this script inside the LXC container to update the site
# Usage: bash deploy.sh

set -e

cd "$(dirname "${BASH_SOURCE[0]}")"
exec 9>/var/lock/3sm-site.lock
flock 9

# Een verse release-worktree heeft geen .env (untracked). Zonder .env worden de
# dynamische nieuws- en uitslagroutes niet gegenereerd en ruimt de rsync hieronder
# de al gepubliceerde pagina's op (sitemap 57 -> 10). Neem de .env over uit de
# release die nu actief is, of breek af.
if [ ! -f .env ]; then
  active_conf=/etc/systemd/system/3sm-seo-refresh.service.d/active-release.conf
  previous=$(sed -n 's/^WorkingDirectory=//p' "$active_conf" 2>/dev/null | head -1)
  if [ -n "${previous:-}" ] && [ -f "$previous/.env" ] && [ "$previous" != "$(pwd)" ]; then
    echo "→ Geen .env in deze worktree; overgenomen uit $previous"
    cp "$previous/.env" .env
  else
    echo "✗ Geen .env in deze worktree en geen bruikbare vorige release. Afgebroken voordat er iets gepubliceerd wordt." >&2
    exit 1
  fi
fi

echo "→ Pulling latest code..."
git pull --ff-only

echo "→ Installing dependencies..."
npm ci --legacy-peer-deps

echo "→ Building..."
rm -rf dist
npm run build

echo "→ Deploying to webroot without an empty-site window..."
mkdir -p /var/www/3sm/assets
# Publish content-hashed JS/CSS first. Existing assets remain available for tabs
# that loaded the previous HTML just before this deployment.
rsync -a dist/assets/ /var/www/3sm/assets/
# Publish HTML and all non-asset files only after their new assets exist.
# Delete stale site routes/files after transfer. Downloads are release-managed:
# never overwrite signed releases or the stable ZIP alias from the site build.
rsync -a --delete-after --exclude='assets/' --exclude='downloads/' dist/ /var/www/3sm/

bash scripts/pin-seo-release.sh

# Nieuwe en gewijzigde pagina's aanmelden bij Bing via IndexNow (de sleutel staat
# in de webroot). Mislukt dit, dan staat de site gewoon live: de melding is een
# versnelling, geen voorwaarde. De SEO-refresh meldt later nieuwe losse pagina's aan.
if ! node scripts/submit-indexnow.mjs; then
  echo "⚠ IndexNow-overdracht mislukt; de site is wel uitgerold." >&2
fi

echo "✓ Deploy done!"
