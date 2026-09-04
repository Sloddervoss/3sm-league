# AI_START_HERE

Dit document is het startpunt voor AI-assistenten die aan de 3SM-codebase werken.

## Veiligheidsgrenzen

- Analyse-modus voor deze documentatieset: functionele code niet wijzigen.
- Voor normale 3SM delivery geldt: eerst lokaal build/test, daarna pas push/deploy na expliciete opdracht.
- Productie deploy is niet impliciet door een preview- of linkvraag.
- Bewaar geen secrets in docs, memory of commits.
- `bot/streamers.json` is runtime/state-data en moet op productie behouden blijven.

## Repo en stack

- Repo pad lokaal: `/home/hermes/projects/3sm-league`
- Branch: `main`
- Remote: `git@github.com:Sloddervoss/3sm-league.git`
- Frontend: React 18 + Vite + TypeScript + Tailwind/shadcn-achtige UI.
- Data/backend: Supabase/PostgREST/Auth/Storage/Edge Functions.
- Discord bot: Node.js ESM + `discord.js`, aparte `bot/` package.
- Productie webroot volgens repo scripts: `/var/www/3sm`.
- Productie app checkout volgens repo scripts: `/opt/3sm`.

## Belangrijkste ingangen

- Project-instructiebestand: `HERMES.md` is in deze repo niet gevonden. Als dat bestand later wordt toegevoegd, lees het vóór deze docs.
- Frontend entry: `src/main.tsx`
- Route-definitie: `src/App.tsx`
- Supabase client: `src/integrations/supabase/client.ts`
- Supabase types: `src/integrations/supabase/types.ts`
- Auth/rollen: `src/contexts/AuthContext.tsx`
- Discord bot entry: `bot/index.js`
- Bot env voorbeeld: `bot/.env.example`
- Bot setup: `bot/setup.sh`
- Deploy script: `deploy.sh`
- Nginx config: `nginx.conf`
- Route-HTML/sitemap generator: `scripts/generate-route-html.mjs`
- Dynamic SEO refresh: `scripts/refresh-dynamic-seo.mjs`
- IndexNow submitter: `scripts/submit-indexnow.mjs`
- iRacing browser extension source: `tools/iracing-content-extension/`

## Leesvolgorde voor nieuwe taken

1. `docs/SYSTEM_OVERVIEW.md`
2. Relevante map:
   - Website: `docs/WEBSITE_MAP.md`
   - Bot: `docs/BOT_MAP.md`
   - API/backend: `docs/API_ROUTES.md`
   - Data/schema: `docs/DATA_MODEL.md`
   - Auth/rollen: `docs/AUTH_AND_ROLES.md`
3. Voor productie of build: `docs/DEPLOYMENT.md`
4. Voor DB-migraties/inspectie: `docs/operations/production-access-runbook.md` — productie-Supabase is self-hosted Docker op 3sm-docker, **niet** Supabase Cloud.
5. Voor risicovolle wijzigingen: `docs/RISK_AREAS.md`
6. Voor aanpak per wijzigingstype: `docs/FUTURE_CHANGE_GUIDE.md`

## Lokale commands

Root package (`package.json`):

```bash
npm run test
npm run lint
npx tsc --noEmit
npm run build
npm audit --audit-level=moderate
```

Bot package (`bot/package.json`):

```bash
cd bot
npm test
npm start
```

Let op: `npm run build` voert naast Vite ook `scripts/generate-route-html.mjs` en `scripts/zip-extension.mjs` uit. Daardoor kan `public/iracing-content-extension.zip` wijzigen.

## Bekende onzekerheden

- `admin_get_all_profiles` staat in `src/integrations/supabase/types.ts` en wordt gebruikt in `src/pages/admin/DriversList.tsx`, maar de migratie die de functie definieert is in deze repo niet gevonden. Onzeker of deze functie remote handmatig of via ontbrekende migratie is aangemaakt. Zeker maken: productie DB functie-definitie uitlezen met Supabase/Postgres read-only query (`pg_proc`/`pg_get_functiondef`) en daarna een migration toevoegen als die ontbreekt.
- `confirmed_profiles` staat als view in `src/integrations/supabase/types.ts` en wordt gebruikt door shared queries, maar een `CREATE VIEW confirmed_profiles` migration is in deze repo niet gevonden. Zeker maken: productie DB view-definitie uitlezen (`pg_views`) en migration/backfill controleren.
- `track_intelligence_runs` en `member_track_history` staan in migraties, maar niet in `src/integrations/supabase/types.ts`. Types lijken dus deels achter te lopen. Zeker maken: Supabase types opnieuw genereren tegen de live DB of live schema vergelijken met migrations.
- Exacte productie systemd/nginx/CDN staat deels in repo (`bot/setup.sh`, `nginx.conf`, `scripts/install-seo-refresh-timer.sh`) en deels buiten repo. Waar niet uit repo afleidbaar: onzeker. Zeker maken: read-only serverinspectie van systemd units, nginx enabled site, timers, process list en Cloudflare/CDN config.
