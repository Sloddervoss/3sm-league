# Endurance open beta — releasebeschrijving

Uitgevoerd: 10 september 2026. Status: **live**. Uitgevoerd op basis van het
overdrachtsdocument `Endurance-beta-releaserapport.md` en expliciete opdracht om
de beta open te stellen.

## Wat er nu geldt

Endurance is zichtbaar en bruikbaar voor elk ingelogd account. De Tester-rol is
niet langer functioneel: de rol bestaat nog als enumwaarde (zodat bestaande
rijen niet onbruikbaar worden), maar er zijn **nul toekenningen** en hij is niet
meer toe te kennen via het rolbeheer.

Beheerrechten blijven bij `endurance_manager` en `super_admin`, plus de
bestaande event- en teammanagers binnen hun eigen scope.

## Uitgevoerd, in deze volgorde

De volgorde is niet vrijblijvend: de frontend mag niet vóór de migratie live,
omdat de nieuwe frontend de Tester-vlag niet meer kent en zou leunen op een
RPC die dan nog niet bestaat.

1. **Migratie** `supabase/migrations/20260910210000_endurance_member_beta.sql`
   toegepast. Inhaalmigratie: productie liep achter op acht migraties uit
   9 t/m 20 augustus 2026. Bevat ook een correctie (zie hieronder).
   Resultaat: 68 → 71 tabellen, 152 → 159 policies, 107 → 123 SECDEF-functies.
   De realtime-publicatie ging van 8 naar 2 leden (`endurance_realtime_stream`
   en `simhub_telemetry_latest`).
2. **Edge Function** `simhub-pair` uitgerold. De productieversie was 249 regels
   en kende de capabilities-RPC niet; de repo-versie is 297 regels. `_shared/`
   is **niet** aangeraakt: daar hangen zes functies aan.
3. **Frontend** gebouwd in `/opt/3sm-endurance-beta-20260910` en uitgerold.
4. **Ledenrechten opengezet** via `endurance_set_runtime_settings(true, true,
   true, true, true)` als super-admin.
5. **Lidflow end-to-end getest** met een tijdelijk testaccount (zie Bewijs).
6. **Tester-toekenningen ingetrokken** (5 rijen).

## Schakelaars

`endurance_runtime_settings` is de enige plek die ledentoegang bepaalt:

| schakelaar | waarde | effect |
|---|---|---|
| `member_access_enabled` | true | leden zien en gebruiken Endurance |
| `member_pairing_enabled` | true | leden koppelen hun eigen SimHub |
| `member_ingest_enabled` | true | leden sturen hun eigen telemetry in |
| `multi_user_realtime_enabled` | true | leden krijgen realtime in de workspace |
| `simhub_ingest_enabled` | true | ingest in het algemeen |

Terugdraaien van de ledentoegang is één aanroep als super-admin:
`endurance_set_runtime_settings(false, false, false, false, null)`.

## Twee bugs die onderweg zijn gevonden en gerepareerd

**1. Concept-races lekten naar gewone leden.** `endurance_can_discover_event`
toetste alleen zichtbaarheid, uitnodigingen, `manager_ids` en inschrijvingen —
nooit de status. Een event met status `draft` en zichtbaarheid `open` was
daardoor voor elk ingelogd lid zichtbaar, terwijl de ontwerpregel is dat
concepten manager-only zijn. Gevonden door de negatieve autorisatietest, niet
door code te lezen. De functie sluit concepten nu expliciet uit.

**2. De rollback zou een functie hebben gewist.** De bestaande rollback voor
`20260809152000` deed `DROP FUNCTION endurance_replace_draft_stints`, maar die
functie bestond al vóór de migratie (de migratie doet `CREATE OR REPLACE`).
Een rollback zou hem definitief verwijderen in plaats van herstellen. De
samengevoegde rollback herstelt nu de oorspronkelijke definitie.

## Bewijs

**Round-trip op een schema-kloon van productie.** 68/152/107 → migratie
71/159/123 → rollback weer exact 68/152/107. Migratie en rollback beide nul
fouten; verschil na rollback op tabellen, policies, functies en
publicatielidmaatschap alle vier nul.

**Autorisatiematrix, 26 controles.** Positief én negatief, per rol, in beide
standen van de schakelaars. Uitvoerbaar via
`supabase/tests/20260910210000_endurance_beta_authorization.sql` en
`..._authorization_open.sql`. Alles groen.

**Lidflow over HTTP met een echt account.** De frontend-API's zijn aangeroepen
met een geldige JWT van een account zonder enige rol:

- `capabilities`: `can_access`, `can_pair_own_device`, `can_ingest_own_device`
  en `multi_user_realtime_enabled` waar; `can_manage_events` en
  `can_manage_devices` onwaar.
- Ziet twee events, **geen** concept-race, geen teamleden, geen stints, geen
  meldingen en geen beschikbaarheid van anderen.
- De instellingentabel is niet leesbaar.
- **Kan wél** zijn eigen inschrijving en eigen beschikbaarheid aanmaken.
- **Kan niet** een event aanmaken; een poging om een bestaand event te wijzigen
  raakt nul rijen.
- SimHub: `create` geeft een paar-code, `list-own` geeft de eigen apparaten,
  `assign` wordt geweigerd.

Het testaccount en alle rijen die het aanmaakte zijn daarna verwijderd.

**Codekwaliteit.** 143 testbestanden, 878 tests groen; `tsc --noEmit` schoon.

## Wat expres NIET is gedaan

- `simhub-ingest` en `simhub-version` zijn **niet** uitgerold. Productie loopt
  daar vóór op de repo (103 tegen 80 en 70 tegen 36 regels); de repo-versie
  uitrollen zou ze regresseren. Verzoenen is een aparte taak.
- `_shared/simhub.ts` is niet aangeraakt.
- De Tester-rol is niet uit het `app_role`-enum verwijderd.
- De uitgerolde functies `hello`, `main` en `simhub-diagnostic` staan niet in de
  repo en zijn met rust gelaten.

## Beheer van deze release

Actieve release: `/opt/3sm-endurance-beta-20260910` (vastgelegd in
`/etc/systemd/system/3sm-seo-refresh.service.d/active-release.conf`). De
SEO-timer bouwt de route-HTML elke ~5 minuten opnieuw uit die map.

Let op bij een volgende release: een verse worktree heeft **geen `.env`**. Zonder
`VITE_SUPABASE_URL` bouwt de site alleen statische routes (19 in plaats van 63)
en zou `rsync --delete-after` 44 live pagina's verwijderen. Neem `.env` over uit
de actieve release.

Rollback van de database: `supabase/rollback/20260910210000_endurance_member_beta.rollback.sql`,
bewezen exact. Rollback van de site: de vorige release
`/opt/3sm-beta-label-20260910` op `b7f6dd3` staat er nog.

## Aandachtspunten

- 3sm-web zit op 90% schijf (ongeveer 800 MB vrij). Er staat 1,2 GB aan oude
  backups en ruim 570 MB npm-cache. Opruimen vereist overleg; een oude worktree
  kan de rollback van een eerdere release zijn.
- De backups van deze release staan op de Hermes-host in
  `~/endurance-beta/backup/`: schema, data (`user_roles`, `endurance_*`,
  `simhub_*`), de vóór- en nastaat, en de uitgerolde Edge Function.
