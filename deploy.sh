#!/bin/bash
# Run this script inside the LXC container to update the site
# Usage: bash deploy.sh

set -e

cd /opt/3sm

echo "→ Pulling latest code..."
git pull

echo "→ Installing dependencies..."
npm ci --legacy-peer-deps

echo "→ Building..."
npm run build

echo "→ Deploying to webroot..."
rm -rf /var/www/3sm/*
cp -r dist/* /var/www/3sm/

echo "✓ Deploy done!"
