# DEPLOYMENT

## Source files

- Root package/build: `package.json`
- Web deploy script: `deploy.sh`
- Nginx template/config: `nginx.conf`
- Bot package: `bot/package.json`
- Bot setup: `bot/setup.sh`
- SEO refresh timer installer: `scripts/install-seo-refresh-timer.sh`
- Dynamic SEO refresh: `scripts/refresh-dynamic-seo.mjs`
- IndexNow script: `scripts/submit-indexnow.mjs`

## Root build commands

From `package.json`:

```bash
npm run dev          # vite
npm run build        # vite build && node scripts/generate-route-html.mjs && node scripts/zip-extension.mjs
npm run build:dev    # vite build --mode development && node scripts/generate-route-html.mjs
npm run seo:refresh  # node scripts/refresh-dynamic-seo.mjs
npm run indexnow     # node scripts/submit-indexnow.mjs
npm run lint         # eslint .
npm run test         # vitest run
npm run preview      # vite preview
```

Recommended pre-deploy checks:

```bash
npm run test
npm run lint
npx tsc --noEmit
npm run build
npm audit --audit-level=moderate
git diff --check
```

## Web deploy script

File: `deploy.sh`

Behavior:

```bash
cd /opt/3sm
git pull
npm ci --legacy-peer-deps
npm run build
rsync -a dist/assets/ /var/www/3sm/assets/
rsync -a --delete-after --exclude='assets/' --exclude='downloads/' dist/ /var/www/3sm/
```

Implications:

- It publishes hashed assets before HTML and retains previous assets for open browser sessions.
- It removes stale site routes/files after transfer, without an empty-webroot window.
- `downloads/` is release-managed and excluded from copying and deletion. Publish SimHub DLLs, ZIPs and aliases through the signed release procedure, not the website build.
- It does not explicitly deploy nginx config.
- It does not manage the Discord bot service.
- It runs `npm run build`, which regenerates `public/iracing-content-extension.zip` in the app checkout.

## Nginx

File: `nginx.conf`

Observed settings:

- `listen 80`
- `root /var/www/3sm`
- `absolute_redirect off`
- gzip enabled for text/css/json/js/xml/svg
- `location = /index.html` has no-cache/no-store headers
- favicon/webmanifest assets cached for 30 days with must-revalidate
- hashed static assets cached for 1 year immutable
- SPA fallback:

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

Important: repo `nginx.conf` is source/template. Live nginx config must be verified on server before assuming it matches.

## Generated SEO/static files

`scripts/generate-route-html.mjs` runs after Vite build and writes into `dist/`:

- route-specific `index.html` files for public/static routes
- dynamic route HTML for:
  - completed race detail routes `/results/<race-id>/`
  - published news routes `/news/<category>/<slug>/`
- `dist/sitemap.xml`
- `dist/.route-html-manifest.json`
- noindex HTML for selected private/utility routes

It reads Supabase env from:

- `.env`
- `.env.local`
- `.env.production`
- `.env.production.local`
- process env

Required keys for dynamic route generation:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

If those are missing, dynamic sitemap/routes are skipped with a warning.

## Dynamic SEO refresh timer

File: `scripts/install-seo-refresh-timer.sh`

Installs:

- `/etc/systemd/system/3sm-seo-refresh.service`
- `/etc/systemd/system/3sm-seo-refresh.timer`

Service behavior:

- `WorkingDirectory=/opt/3sm`
- `Environment=WEBROOT=/var/www/3sm`
- `ExecStart=/usr/bin/npm run seo:refresh`

Timer behavior:

- Runs every 5 minutes after boot.

Important risk: this timer mutates route HTML and sitemap in production. Confirm whether it should be enabled before relying on it or changing it.

## Bot deploy/setup

File: `bot/setup.sh`

Assumptions:

- Bot path: `/opt/3sm/bot`
- Creates/uses `bot/.env` from `bot/.env.example` if missing.
- Installs dependencies with `npm install`.
- Writes systemd unit `/etc/systemd/system/3sm-bot.service`:

```ini
[Service]
WorkingDirectory=/opt/3sm/bot
ExecStart=/usr/bin/node index.js
Restart=always
User=root
```

Then enables/starts service if env is not placeholder.

Important: live systemd unit may have diverged; inspect server before changing.

## Extension ZIP

Source:

- `tools/iracing-content-extension/`

Build script:

- `scripts/zip-extension.mjs`

Output:

- `public/iracing-content-extension.zip`

`npm run build` runs this script. After production deploy/build, the repo checkout may show `public/iracing-content-extension.zip` modified even if size is unchanged. If not intended as source change, inspect and revert that generated artifact in the checkout.

## IndexNow

File: `scripts/submit-indexnow.mjs`

Behavior:

- Reads URLs from `dist/sitemap.xml` unless CLI args provide URLs.
- Supports `--dry-run`.
- Has hardcoded host/key/key location in script.

Use carefully; do not submit routinely unless that is desired after real content/crawler-facing changes.

## Production deploy workflow used historically

Known 3SM workflow from repo/memory:

```bash
git push origin main
ssh 3sm-web 'cd /opt/3sm && bash deploy.sh'
```

Then verify public pages with `curl` and route HTML checks.

## Verification after deploy

Recommended checks:

```bash
curl -I https://3stripemotorsport.cc/
curl -fsSL https://3stripemotorsport.cc/results/ | grep -E 'results-itemlist-jsonld|Race archief|Laatste race-uitslag'
curl -fsSL https://3stripemotorsport.cc/sitemap.xml
```

For exact JSON-LD checks, use a local temp file and parse with Node rather than piping untrusted remote HTML directly into an interpreter.

## Unzeker

- Live Cloudflare/CDN configuration is outside the repo. Zeker maken: Cloudflare/API dashboard read-only inspectie van DNS, cache rules, redirects, proxy status en purge behavior.
- Live systemd service/timer status is outside the repo unless inspected on server. Zeker maken: read-only `systemctl status/list-timers/cat` voor `3sm-bot.service`, `3sm-seo-refresh.*` en relevante web services.
- Live nginx config may differ from `nginx.conf` unless deployed manually. Zeker maken: read-only inspectie van `/etc/nginx/sites-enabled/*`, `nginx -T` output of server-side effective config.
