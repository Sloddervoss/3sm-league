#!/bin/bash
# Run this script inside the LXC container to update the site
# Usage: bash deploy.sh

set -e

cd "$(dirname "${BASH_SOURCE[0]}")"
exec 9>/var/lock/3sm-site.lock
flock 9

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

echo "✓ Deploy done!"
