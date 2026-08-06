# Endurance Control Center — Super-admin-only livegang & echte datakoppeling

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Maak de Endurance-tab live op de 3SM-site **uitsluitend zichtbaar voor super-admin** (verborgen project), en vervang de gefabriceerde seed-data door echte Supabase-data. Bewust gefaseerd, met verifieerbare poorten per fase. Geen push/deploy zonder expliciete GO van Vincent.

**Architecture:** Het huidige prototype is een puur lokaal reducer + localStorage (seed-persona's). De live-site-baseline (`origin/main`) bevat géén endurance-tabellen en géén endurance-frontend. We bouwen de datalaag als nieuwe Supabase-tabellen + RLS (super-admin-only), vervangen de localRuntimeAllowed-crash-gate door een super-admin-gate, en koppelen de store aan Supabase. De simhub device-pairing (relay) staat al live (super-admin) en blijft onaangetast.

**Tech stack:** React, TypeScript, TanStack Query, Supabase (Postgres + RLS + Edge Functions), Vite, vitest. Deploy via `3sm-web:/opt/3sm/deploy.sh`.

---

## Fase 0 — Branch-/release-hygiëne

De endurance-branch is 20 voor / 47 achter op main en mist community-support/paypal. Kiezen en vastleggen vóór enig werk:
- 0.1 Beslis of we rebase-en op `origin/main` of een schone `release/endurance-superadmin-canary` vanaf `origin/main` maken en de endurance-feature daarin enten.
- 0.2 Vastleggen dat NIETS naar main/pushen gaat tot GO.

## Fase 1 — Super-admin gate + crash-fix (klein, tastbaar, laag risico)

**Doel:** de tab draait op prod zonder crash, alleen super-admin ziet/bereikt hem. Nog op seed (tijdelijk), maar veilig verborgen.

- 1.1 `environment.ts`: vervang `localRuntimeAllowed` (dev-gate die op prod crasht) door een expliciete `superAdminOnly`-vlag; `assertLocalEnduranceEnvironment` niet meer werpen op prod-hostname.
- 1.2 `App.tsx` route: maak `/endurance/*` super-admin-geschermd (route-guard via `useAuth().isSuperAdmin`), niet dev-afhankelijk.
- 1.3 `Navbar.tsx` + `Footer.tsx`: toon Endurance-link alleen bij super-admin (niet `VITE_ENDURANCE_LOCAL_MVP`).
- 1.4 Server-side: geen publieke data-escape — tijdens Fase 1 blijft de pagina op seed, dus geen DB-read. Lazy-load route blijft.
- 1.5 Verificatie: `tsc`, `lint`, `build`, vitest groen; lokale smoke als super-admin én als anoniem/regulier.

## Fase 2 — Echte datalaag (Supabase)

**Doel:** endurance-objecten in de echte DB, super-admin-only RLS.

- 2.1 Migratie: tabellen `endurance_events`, `endurance_registrations`, `endurance_availability`, `endurance_pace_entries`, `endurance_teams`, `endurance_team_members`, `endurance_stints`, `endurance_planning_versions`, `endurance_confirmations`, `endurance_notifications`, `endurance_audit_log`. Referenties naar `races`/`teams`/`profiles`-id's waar van toepassing (device→event/entry toewijzing later in Endurance-tab).
- 2.2 RLS: alle endurance-tabellen super-admin-only (SELECT/INSERT/UPDATE/DELETE); geen anon/authenticated escape.
- 2.3 Rollback-migratie.
- 2.4 types.ts regenereren; `_shared` helper indien RPC nodig.
- 2.5 Verificatie: SQL-parser green, RLS-smokes (anon geweigerd, super-admin toegestaan).

## Fase 3 — Store ombouwen naar Supabase

- 3.1 Store: seed/persona's vervangen door echte `profiles`-data + super-admin context; events/registrations/teams/stints uit Supabase lezen.
- 3.2 Mutaties (actions) via Supabase writes i.p.v. reducer-localStorage; auditlog bewaard.
- 3.3 Relatieve/absolute id's: vervang seed-ids door echte DB-ids.
- 3.4 Verificatie: tests (store→query-mock), tsc, lint, build.

## Fase 4 — Release & GO

- 4.1 Rebase/de-aligneer op `origin/main`, oplossen conflicten met community-support/paypal.
- 4.2 Volledige test-suite + build green; lokale visible smoke.
- 4.3 Pas na expliciete GO: migratie op prod (backup + rollbackpunt), deploy via `deploy.sh`, super-admin smoke op live, relay-device test (CAT-PC) in live Race Control.
- 4.4 No live/GO claim vóór final tests & rehearsals opnieuw groen.

---

## Gates
- Geen push/deploy naar main zonder expliciete GO.
- Stop bij elke afwijking; meld rollback-reason, root-cause, retry-conditie.
- Behoud functionele pariteit; het onderliggende concept (endurance events/entries/stints/race control) blijft tenzij expliciet anders.

---

## Veiligheidscontract (harde grens, niet onderhandelbaar)

**Rol:** Hermes is de veiligheidschecker; uitvoering kan via subagents plaatsvinden, maar Hermes keurt alles vóór livegang. Mensen gebruiken de site → veiligheid is de primaire eis.

**P0 — Isolatie van bestaande functies/data (hard):**
1. Endurance schrijft **nooit** naar bestaande tabellen (`races`, `teams`, `profiles`, `seasons`, `race_registrations`, `race_results`, `community_support_*`, `simhub_*`, `announcements`, etc.). Alleen nieuwe `endurance_*`-tabellen.
2. Alle `endurance_*`-tabellen krijgen RLS die **uitsluitend super-admin** toestaat (SELECT/INSERT/UPDATE/DELETE). Geen anon/authenticated-escape, geen rol-verlies-datarecht.
3. Tijdens **Fase 1** (verborgen mock) is er **geen** datakoppeling: geen DB-read, geen DB-write. Puur frontend-seed. Daardoor bestaat er fysiek geen pad waarlangs endurance bestaande data kan raken.
4. Bestaande RLS-policies op bestaande tabellen worden in geen enkele migratie aangepast of gedropt.

**P1 — Verificatie vóór elke livegang:**
- Volledige suite (vitest 207+), `tsc --noEmit`, `lint`, productiebuild.
- RLS-smokes: anon geweigerd, regulier lid geweigerd, moderator/admin geweigerd, uitsluitend super-admin toegestaan op `endurance_*`.
- Migraties door parser; rollback-migratie valide; backup + rollbackpunt vóór prod-apply.
- Deploy uitsluitend via `3sm-web:/opt/3sm/deploy.sh` (git pull + npm ci + build + copy) — nooit `npm run build` alleen.
- Geen live/GO-claim vóór final tests & rehearsals opnieuw groen.

**P2 — Bewuste grenzen:**
- Geen wijziging aan bestaande auth/roollogica; endurance voegt alleen een super-admin-gate toe.
- Bij Fase 2/3: nieuwe data schrijf ik uitsluitend naar `endurance_*`; poging tot schrijven elders = harde fout in test.
- Elke fase wordt lokaal geverifieerd én op een super-admin-only canary vóór brede livegang.

