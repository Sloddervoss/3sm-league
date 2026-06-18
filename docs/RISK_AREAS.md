# RISK_AREAS

## Highest-risk areas

### Supabase RLS/RPC/auth

Files:

- `supabase/migrations/*.sql`
- `src/contexts/AuthContext.tsx`
- `src/pages/admin/DriversList.tsx`
- `src/pages/StewardPage.tsx`
- `src/pages/NewsEditorPage.tsx`

Risks:

- UI guards are not security boundaries; RLS/RPC policies must enforce permissions.
- `super_admin` has special protections. Do not weaken grant/revoke/delete behavior.
- `moderator` in DB equals steward in UI. Naming changes can break access.
- `has_role` is security-sensitive and has been hardened; avoid casual changes.
- `admin_get_all_profiles` is used but defining migration was not found. Verify live DB before replacing or depending on it.

### Discord bot service key and side effects

Files:

- `bot/index.js`
- `bot/logging.js`
- `bot/network.js`
- `bot/config.json`
- `bot/sent_notifications.json`
- `bot/streamers.json`

Risks:

- Bot uses `SUPABASE_SERVICE_KEY`, bypassing RLS.
- Bot writes Discord roles/channels/categories and DB rows.
- `/setup-server` has broad Discord side effects.
- JSON state files may be runtime-critical; do not delete or overwrite blindly.
- Logging must keep redacting env secrets.

### Result import and standings

Files:

- `src/pages/admin/ResultsImportAdmin.tsx`
- `src/pages/ResultsPage.tsx`
- `src/pages/RaceDetailPage.tsx`
- `src/pages/StandingsPage.tsx`
- `src/lib/importHelpers.ts`
- `src/lib/raceDetailStats.ts`
- `supabase/migrations/*race*`, `*3sr*`

Risks:

- Race results feed standings, detail pages, 3SR, Discord result posts and SEO route generation.
- Steward penalties can modify/augment race result interpretation.
- iRacing import enrichment has multiple tables (`race_results`, `race_session_results`).
- Hardcoding race facts in frontend or SEO scripts can diverge from DB.

### Build/deploy artifact coupling

Files:

- `deploy.sh`
- `package.json`
- `scripts/generate-route-html.mjs`
- `scripts/zip-extension.mjs`
- `public/iracing-content-extension.zip`
- `nginx.conf`

Risks:

- `index.html`, route HTML and hashed `assets/` must be deployed together.
- `npm run build` mutates generated artifacts.
- `deploy.sh` clears `/var/www/3sm/*` before copying.
- Nginx config is not automatically deployed by `deploy.sh`.
- Production checkout may become dirty after build because ZIP is regenerated.

### SEO/static route generation

Files:

- `scripts/generate-route-html.mjs`
- `scripts/refresh-dynamic-seo.mjs`
- `scripts/submit-indexnow.mjs`
- `src/pages/ResultsPage.tsx`
- `src/pages/RaceDetailPage.tsx`
- `src/pages/NewsPage.tsx`
- `src/pages/NewsDetailPage.tsx`

Risks:

- Raw HTML is what crawlers initially see; client-side metadata is not enough.
- Do not stamp every URL with current build date; lastmod should reflect real content changes.
- Dynamic route generation depends on Supabase env availability at build time.
- `scripts/refresh-dynamic-seo.mjs` can mutate live sitemap/route HTML without full Vite asset rebuild.
- IndexNow submissions should be deliberate, not routine noise.

### News/editor CMS

Files:

- `src/pages/NewsEditorPage.tsx`
- `src/pages/NewsPage.tsx`
- `src/pages/NewsDetailPage.tsx`
- `src/lib/newsTaxonomy.ts`
- `supabase/migrations/20260601090000_editor_role_and_news_access.sql`
- `supabase/migrations/20260601103000_news_editor_professional_fields.sql`
- `supabase/migrations/20260601140000_news_platform_metadata.sql`
- `supabase/migrations/20260611120000_news_race_link.sql`

Risks:

- Draft/published status must align with RLS and public route generation.
- Image uploads use `news-images` storage policies.
- Generated route HTML/sitemap must remove unpublished/stale routes.
- Editor role should not accidentally become full admin.

### Track intelligence and extension upload

Files:

- `src/pages/TrackIntelligenceTestPage.tsx`
- `src/lib/trackIntelligence.ts`
- `supabase/functions/track-intelligence-sync/index.ts`
- `supabase/functions/track-intelligence-upload/index.ts`
- `tools/iracing-content-extension/*`
- `supabase/migrations/20260614130000_track_intelligence_test.sql`
- `supabase/migrations/20260614150500_allow_extension_scan_source.sql`

Risks:

- Generated TS types do not include latest track intelligence tables.
- Extension upload endpoint uses service role internally.
- Extension has client-side upload/API behavior; treat embedded keys as sensitive-ish.
- Matching uploads to profiles by name/candidate can be ambiguous.

## Medium-risk areas

### i18n DOM translation

Files:

- `src/i18n/LanguageContext.tsx`
- `src/i18n/translations.ts`
- `src/components/Navbar.tsx`
- `src/pages/JoinPage.tsx`
- `src/pages/RaceDetailPage.tsx`

Risks:

- MutationObserver translation can affect unexpected DOM text.
- Use `data-no-translate` where content must not be translated.
- Metadata/JSON-LD language needs deliberate handling.

### Admin UI tabs

Files:

- `src/pages/AdminPage.tsx`
- `src/pages/admin/*.tsx`

Risks:

- Admin page is broad; changes may affect roles, seasons, teams, announcements, results import and points.
- Some actions are destructive or write-heavy.

### Browser extension ZIP

Files:

- `tools/iracing-content-extension/`
- `scripts/zip-extension.mjs`
- `public/iracing-content-extension.zip`

Risks:

- ZIP is tracked and generated.
- Static/CDN cache may serve old ZIP.
- Extension host permissions include 3SM and iRacing domains.

## General change risks

- Do not edit generated `dist/` as source.
- Do not rely on local `dist/` to represent production unless freshly built/deployed.
- Do not assume live DB schema exactly matches migrations; there are known uncertainties.
- Do not run production deploy/restart/migrations without explicit user approval.
- Do not expose service-role keys or bot tokens in logs/docs.
