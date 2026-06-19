# HERMES.md

Centrale projectinstructie voor Hermes in de 3SM codebase.

## Projectcontext

3SM bestaat uit meerdere samenhangende delen. Beoordeel wijzigingen altijd in die context:

- **Website/frontend**: React/Vite app met publieke pagina's, admin/editor/steward schermen, route-specifieke SEO HTML, sitemap en statische assets.
- **Backend/API**: Supabase clientgebruik vanuit frontend en bot, RPC's, Edge/API-achtige integraties en scripts die data ophalen of publiceren.
- **Discord-bot**: Node.js bot onder `bot/` met commands, events, runtime state en Supabase service-key toegang.
- **Supabase/data**: database schema, RLS policies, RPC functies, generated types, migrations en data-import/SEO-generatie op basis van echte databasegegevens.
- **Deployment**: productie draait op `3sm-web` onder `/opt/3sm`, met build/deploy naar webroot via `deploy.sh`; runtime/serverstaat kan afwijken van wat in de repo staat.

## Harde workflowregel

- Geen push naar `main` zonder expliciete toestemming van Vincent.
- Geen live deploy zonder expliciete toestemming van Vincent.
- Standaard werken op een aparte branch.
- Na codewijziging eerst diff, tests en risico's tonen.
- Pas na akkoord mag er gepusht of gedeployed worden.

## Werkmodi

### ANALYSE-MODUS

Doel: begrijpen, controleren en rapporteren.

Regels:

- Geen functionele code wijzigen.
- Alleen lezen, zoeken, vergelijken en eventueel documentatie corrigeren als de gebruiker dat expliciet toestaat.
- Controleer claims tegen echte bestanden, tests, scripts, migrations en configuratie.
- Markeer onzekerheden expliciet en vermeld wat nodig is om ze zeker te maken.

### PLAN-MODUS

Doel: een veilige uitvoerbare aanpak maken voordat er code verandert.

Regels:

- Geen functionele code wijzigen.
- Beschrijf exacte bestanden, risico's, tests en rollback/verification stappen.
- Splits werk op in kleine stappen.
- Benoem impact op website/frontend, backend/API, bot, data/database, auth/rollen en deployment.
- Wacht op akkoord voordat je naar uitvoer gaat.

### UITVOER-MODUS

Doel: de afgesproken wijziging uitvoeren en verifiëren.

Regels:

- Werk standaard op een aparte branch.
- Lees vóór codewijzigingen altijd `docs/AI_START_HERE.md` en daarna de relevante documenten in `docs/`.
- Houd wijzigingen zo klein en scoped mogelijk.
- Wijzig geen functionele code buiten de gevraagde scope.
- Toon na codewijziging eerst diff, tests en risico's.
- Geen commit, push, deploy, database-migratie of productieactie zonder expliciet akkoord van Vincent.

## Veiligheidsregels

### Database en data

- Geen productie-data wijzigen zonder expliciete toestemming.
- Geen destructive SQL, backfills, deletes, truncates of bulk updates zonder apart akkoord en rollback/backup-plan.
- Controleer bij datawijzigingen altijd welke tabellen, policies, RPC's, generated types en UI/bot queries geraakt worden.
- Gebruik echte data-structuren uit migrations/types/queries; verzin geen kolommen of tabellen.

### Auth en rollen

- Behandel auth, rollen en permissies als hoog-risico.
- Houd UI guards, Supabase RLS en RPC checks consistent.
- Verzwak geen admin/super_admin/steward/editor controles zonder expliciete opdracht.
- Test zowel toegestane als niet-toegestane rollen waar mogelijk.

### Secrets

- Geen secrets, tokens, service keys of credentials in code, docs, logs of commits opnemen.
- Noem alleen env var namen wanneer nodig.
- Print geen gevoelige waarden naar terminaloutput of chat.
- Bot/service-key wijzigingen zijn hoog-risico en vereisen extra controle.

### Migrations

- Maak voor schemawijzigingen een nieuwe migration; herschrijf oude migrations niet tenzij expliciet gevraagd.
- Controleer RLS policies, grants, RPC security definer/invoker gedrag en generated Supabase types.
- Geen productie-migratie draaien zonder expliciete toestemming van Vincent.

### Live deploy

- Geen live deploy zonder expliciete toestemming van Vincent.
- Voor deploy eerst tonen: branch/commit, diff-samenvatting, tests/build/audit resultaat en bekende risico's.
- Na deploy altijd live verifiëren wat relevant is voor de wijziging.
- Productie-runtime bestanden niet blind opruimen; inspecteer eerst of ze runtime state zijn.

## Verplichte impact-check bij elke wijziging

Beantwoord vóór afronding minimaal of de wijziging impact heeft op:

1. **Website/frontend**: routes, UI, SEO, assets, browsergedrag, responsive layout.
2. **Backend/API**: Supabase client calls, RPC's, scripts, API contracten, externe services.
3. **Bot**: commands, events, permissions, runtime state, channel/config gedrag.
4. **Data/database**: tabellen, kolommen, migrations, RLS, generated types, imports/exports.
5. **Auth/rollen**: login, profielkoppeling, admin/editor/steward/super_admin checks.
6. **Deployment**: build output, env vars, server scripts, nginx/systemd/CDN/webroot gedrag.

Als een gebied niet geraakt wordt, meld kort: `geen impact verwacht`.

## Verplichte output na elke codewijziging

Na elke codewijziging moet de output bevatten:

- **Aangepaste bestanden**: exacte paden.
- **Diff**: relevante diff of samenvatting met verwijzing naar `git diff`.
- **Tests/checks**: uitgevoerde commando's met resultaat; als niet uitgevoerd, waarom niet.
- **Risico's**: resterende risico's en onzekerheden.
- **Vervolgstap**: aanbevolen volgende stap en of akkoord nodig is.

## Documentatieplicht

- Lees `docs/AI_START_HERE.md` altijd vóór codewijzigingen.
- Lees daarnaast de relevante docs voor het geraakte domein.
- Als architectuur, workflow, deployment, auth/rollen, data-model, botgedrag of SEO-routegeneratie verandert, werk de relevante docs in `docs/` bij.
- Documentatie moet feitelijk blijven: alleen echte bestanden, echte flows en expliciete onzekerheden opnemen.
