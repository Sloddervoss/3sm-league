# FUTURE_CHANGE_GUIDE

## General workflow

### Harde workflowregel

- Geen push naar `main` zonder expliciete toestemming van Vincent.
- Geen live deploy zonder expliciete toestemming van Vincent.
- Standaard werken op een aparte branch.
- Na codewijziging eerst diff, tests en risico's tonen.
- Pas na akkoord mag er gepusht of gedeployed worden.

1. Read the relevant docs in `docs/`.
2. Inspect the exact files before editing; do not rely only on this guide.
3. Make the smallest scoped change.
4. Run targeted tests first, then full checks.
5. Show diff/status before push/deploy.
6. Push/deploy only when explicitly requested and after approval.

Recommended root checks:

```bash
npm run test
npm run lint
npx tsc --noEmit
npm run build
npm audit --audit-level=moderate
git diff --check
```

Recommended bot checks:

```bash
cd bot
npm test
```

## Website UI changes

Start with:

- `docs/WEBSITE_MAP.md`
- `src/App.tsx`
- target page in `src/pages/`
- related components in `src/components/`
- shared hooks/libs in `src/hooks/` and `src/lib/`

Rules:

- Preserve existing visual polish unless asked to redesign.
- For 3SM visual work, verify with browser/screenshot if possible.
- Avoid unrequested data/model changes.
- Do not edit generated `dist/` as source.

Tests/checks:

- Targeted Vitest if available.
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`

## Route/navigation changes

Files:

- `src/App.tsx`
- `src/components/Navbar.tsx`
- `src/components/Footer.tsx`
- `scripts/generate-route-html.mjs`
- `nginx.conf` if server behavior changes

Checklist:

- Add React route.
- Add/remove nav/footer links deliberately.
- Decide whether route is public, private/noindex, or dynamic.
- Update `scripts/generate-route-html.mjs` if crawlers need route-specific HTML.
- Update sitemap generation only for real public routes.

## SEO/static route changes

Files:

- `scripts/generate-route-html.mjs`
- `scripts/refresh-dynamic-seo.mjs`
- `scripts/submit-indexnow.mjs`
- route page component under `src/pages/`

Rules:

- Use real existing page/data content, not hidden keyword stuffing.
- Keep visible UI unchanged when user asks non-visual SEO.
- Do not add `FAQPage` unless FAQ content is actually visible on the page.
- Do not mass-update sitemap `<lastmod>` to build time.
- Do not hardcode race/news facts; generate from Supabase rows.

Checks:

- `npm run build`
- Inspect `dist/<route>/index.html`.
- Parse JSON-LD if changed.
- Verify sitemap XML.

## Supabase schema/RLS/RPC changes

Files:

- `supabase/migrations/*.sql`
- `src/integrations/supabase/types.ts`
- affected UI/bot files

Rules:

- Create a new migration; do not rewrite old migrations unless explicitly doing history surgery.
- Preserve RLS safety.
- Keep UI guards and RLS aligned.
- For roles, preserve super_admin protection.
- Regenerate or update generated Supabase types after schema changes.
- Mark uncertainty if production schema may differ.

Checks:

- Read affected policies before editing.
- Add/adjust tests under `src/test/` where existing patterns exist.
- Verify functions/RPC grants.
- Do not run production migrations without explicit approval.

## Auth/roles changes

Files:

- `src/contexts/AuthContext.tsx`
- `src/components/Navbar.tsx`
- guarded page files
- `src/pages/admin/DriversList.tsx`
- role/RLS migrations

Rules:

- DB role `moderator` maps to UI steward.
- `editor` is news/editorial access, not broad admin.
- `super_admin` must remain protected.
- UI checks are convenience only; RLS/RPCs must enforce security.

Checks:

- Test role-specific UI behavior.
- Test denied states.
- Inspect RLS/RPC changes.

## Discord bot changes

Files:

- `bot/index.js`
- `bot/logging.js`
- `bot/network.js`
- `bot/streamers.js`
- `bot/racePoster.js`
- `bot/resultPoster.js`
- `bot/*.test.js`

Rules:

- Avoid leaking secrets in logs.
- Preserve JSON state files.
- Do not run `/setup-server` unless intentionally changing Discord server structure.
- Keep notification dedupe behavior intact.
- Watch for rate limits and network failures.

Checks:

```bash
cd bot
npm test
```

Also run relevant root tests if frontend hardening tests cover the behavior.

## Results/import/standings changes

Files:

- `src/pages/admin/ResultsImportAdmin.tsx`
- `src/pages/ResultsPage.tsx`
- `src/pages/RaceDetailPage.tsx`
- `src/pages/StandingsPage.tsx`
- `src/lib/importHelpers.ts`
- `src/lib/raceDetailStats.ts`
- related migrations

Rules:

- Use existing DB data as source of truth.
- Avoid hardcoded results.
- Understand how penalties, DNF, points and 3SR interact before changing calculations.
- Check Discord result poster implications.
- Check SEO route generation implications.

Checks:

- Existing helper tests (`src/lib/*.test.ts`) where applicable.
- Build and inspect affected pages.

## News/editor changes

Files:

- `src/pages/NewsEditorPage.tsx`
- `src/pages/NewsPage.tsx`
- `src/pages/NewsDetailPage.tsx`
- `src/lib/newsTaxonomy.ts`
- `scripts/generate-route-html.mjs`
- news migrations

Rules:

- Published vs draft matters for public read and sitemap generation.
- Preserve editor/admin/super_admin access separation.
- Keep article HTML sanitization safe.
- Update static route generation if public URL shape changes.

Checks:

- `src/test/publicNewsWorkflow.test.ts`
- `src/test/newsEditorWorkflow.test.ts`
- build and route HTML inspection.

## Track intelligence/extension changes

Files:

- `src/pages/TrackIntelligenceTestPage.tsx`
- `src/lib/trackIntelligence.ts`
- `supabase/functions/track-intelligence-sync/index.ts`
- `supabase/functions/track-intelligence-upload/index.ts`
- `tools/iracing-content-extension/*`
- `scripts/zip-extension.mjs`

Rules:

- Treat upload/API key behavior carefully.
- Do not assume generated types include track intelligence tables.
- Verify extension ZIP contents after build if extension changed.
- Preserve privacy expectations in `tools/iracing-content-extension/README.md`.

Checks:

- `src/lib/trackIntelligence.test.ts`
- `src/test/trackScannerPopupCss.test.ts`
- `npm run build`
- Inspect `public/iracing-content-extension.zip` if changed.

## Deployment changes

Files:

- `deploy.sh`
- `nginx.conf`
- `bot/setup.sh`
- `scripts/install-seo-refresh-timer.sh`
- `scripts/refresh-dynamic-seo.mjs`

Rules:

- Do not deploy/restart/migrate without explicit approval.
- Verify live server config before assuming repo templates are installed.
- Keep Vite build artifacts coherent.
- Preserve `bot/streamers.json` runtime state.

Checks:

- Local build/test first.
- Server `git status --short` before deploy.
- Post-deploy HTTP checks for root and representative routes.
- For bot changes, check systemd status/logs after restart if restart is approved.

## Documentation changes

- Docs live in `docs/`.
- Use real file names.
- Mark unclear claims with “onzeker”.
- Do not include secrets.
- Keep docs aligned after architecture changes.
