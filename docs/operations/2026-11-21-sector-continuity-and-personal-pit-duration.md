# Sectordoorstroom en persoonlijke pitduur — structurele fix

Datum: 2026-11-21
Branch: `fix/sector-continuity-pit-visits`
Basis: `b0e92979` (origin/main)
Status: lokaal geïmplementeerd en getest; **geen push, deploy, migratie of productieactie**.

Dit document hoort bij de eerdere presentatiefix in
`docs/operations/2026-11-19-opponent-sector-retention.md`. Die fix verklaarde
het sparse PACE-veld en hield bewezen reeksen in de UI vast. Dezelfde
screenshots bleven daarna echter optreden. Deze ronde zoekt de oorzaak in de
hele keten: producer → serializer → Edge → SQL-merge/projectie → pollende
API → de echte premium-, klassieke en gedeelde lezers.

## 1. Wat de keten werkelijk doet

```
C#-connector 0.7.6.4
  frame: identity + opponents + paceCapture.opponentMetrics (max 4 in rotatie)
          + paceCapture.sectorUpdates (per sector, max 8)
        │  serializer laat null/afwezige velden weg; geen synthetische waarden
        ▼
Edge simhub-ingest-v3
  normaliseert; snapshotDto haalt meetreeksen uit het browserbeeld
  roept simhub_persist_v3(p_token_hash, p_session_id, p_sequence, p_captured_at,
                          p_v3_normalized, ...)
        │
        ▼
PostgreSQL
  simhub_pace_merge_v1(previous, capture, transport, at_time)
    → car.sectors per sectorIndex, car.sectorBests, car.metrics (legacy volledige reeks)
  simhub_pace_project_v1(snapshot) op de leesroute
  simhub_telemetry_latest.v3_normalized = snapshot + paceHistory
        │
        ▼
API get_pitwall_data / pitwall_sandbox_v1 / pitwall_shared_snapshot_v2
        │  1s polling (owner/team), 5s learning; geen WebSocket in deze route
        ▼
usePitwallData → useRetainedLapSectors → buildSectorTimingIndex
        │
        ├── PremiumTimingPanel (Mijn Pitwall / test / gedeeld)
        └── StandingsWidget (klassieke route)
```

De connector stuurt per frame maximaal vier opponent-metingen in rotatie. Een
volledige sectorreeks staat alleen in het metingslot direct na het afronden van
die ronde. Met een vol veld is elke auto dus geregeld secondenlang "leeg" in
het PACE-blok. Dat is normaal en mag geen bestaande, bewezen reeks wissen.

## 2. Gevonden oorzaken (niet CSS, geen debounce)

### 2.1 UI-identiteit: een ontbrekend trackblok werd als baanwissel gelezen

`useRetainedLapSectors` bouwde één string van
`[transportSessionId, trackId ?? trackName, trackConfig]`. Een tussenframe met
wel het transport-id maar zonder `identity.trackId`/`trackName` leverde
`["transport","",""]` op. Dat verschilde van de vorige `["transport","596","Full Course"]`
en werd als **bevestigde identiteitswissel** behandeld. De volledige cache werd
geleegd; pas een volgend frame vulde hem opnieuw. Meerdere auto's verdwenen
daardoor tegelijk en kwamen even later terug.

Fix: identiteit is nu een object met losse delen (transport, trackId,
trackName, config). Alleen twee **bekende** en verschillende waarden bewijzen
een wissel. Ontbrekend blijft onbekend en laat de vorige waarde staan. Een
echte sessie-, baan-, segment- of share/device-contextwissel reset nog steeds.
Bestand: `src/features/endurance/pitwall/useRetainedLapSectors.ts`.

### 2.2 Gedeeltelijke live-rij overschreef een complete bewezen ronde

`buildSectorTimingIndex` levert per auto de laatst bekende stand per
`sectorIndex`. Die stand kan één of twee sectoren van de nieuwe ronde bevatten
en de rest van de vorige. De consumenten gebruikten hem zodra
`timing.sectorCount === sectorCount`, zonder te eisen dat alle slots geldig en
van dezelfde ronde waren. Gevolg: S1 toonde de nieuwe ronde, S2/S3 werden `—`
(of bleven oud), en de bewezen volledige reeks was onzichtbaar.

Fix: `isCompleteLiveTiming()` in `sectorTiming.ts` eist alle kolommen, dezelfde
layout, geen gemengde ronden en geen ongeldige/lege sector. De premium- en
klassieke tabel gebruiken een live-rij alleen als hij compleet is **of** als er
geen complete bewezen ronde is. Zodra de live-rij compleet is, vervangt hij de
hele rij in één keer. Bestanden: `sectorTiming.ts`,
`test-premium/PremiumTimingPanel.tsx`, `StandingsWidget.tsx`.

### 2.3 SQL-merge: NULL vs waarde wiste de hele `paceHistory`

`simhub_persist_v3` vergeleek de vorige en nieuwe identity met
`IS DISTINCT FROM`. In PostgreSQL is `NULL` distinct van `596`; een frame
zonder `trackId` of `carId` gooide daardoor de complete bewezen historie weg,
ook midden in dezelfde sessie en op dezelfde baan. De Edge- en
projectielaag deden niets verkeerd; de historie was na de merge echt weg.

Fix: nieuwe migratie `20261121120000_pace_history_identity_guard.sql` zet een
`BEFORE UPDATE OF v3_normalized`-guard op `simhub_telemetry_latest`:

- een ontbrekende `trackId`/`carId` wordt aangevuld uit de laatst bekende
  waarde, zodat een volgend frame een echte wissel kan bewijzen;
- een niet-bevestigde daling van het aantal PACE-auto's of een oudere
  `paceHistory.updatedAt` herstelt de vorige historie;
- een bevestigde sessie-, baan-, auto- of segmentwissel blijft een reset;
- een frame uit een oude sessie dat later binnenkomt (`session_id` anders en
  `captured_at` ouder) wordt als geheel geweigerd (`RETURN NULL`), zodat een
  late retry het nieuwere beeld niet overschrijft.

De guard raakt geen rechten, geen leesroute en geen andere kolom. Rollback:
`supabase/rollbacks/20261121120000_pace_history_identity_guard.down.sql`.

### 2.4 Pollantwoorden konden in omgekeerde volgorde binnenkomen

De owner/team-route pollt elke seconde. Twee requests kunnen in omgekeerde
volgorde terugkomen; een ouder antwoord zou het nieuwere beeld tijdelijk
terugzetten. `snapshotOrder.ts` vergelijkt sessie, `sequence` en
`captured_at` conservatief. `usePitwallData` bewaart het laatst geaccepteerde
antwoord per event/team en negeert alleen een aantoonbaar ouder antwoord. Een
contextwissel (ander event/team) start een nieuwe reeks. Onbekende orde
blokkeert niets.

### 2.5 Wat niet de oorzaak was

- `received_at` is opslagtijd, geen pit- of sectortijd.
- `measurement_events` bevat in de praktijk alleen
  `pit_service_completed`, `session_start`, `wear_refresh_confirmed` en
  `wear_value_changed`; geen pit-in/pit-uit. Deze zijn niet als duur gebruikt.
- Geen CSS, debounce, langere polling of het verbergen van het knipperen.
- Geen wijziging aan `measurement_events`, `endurance_pit_stops`,
  `pitwall_pit_loss_v1`, `computePitLoss`, legacy V3 of de PACE-opt-out.

## 3. Voor/na — concrete reeks

De browserfixture `docs/pitwall-look/preview/sector-retention.html` speelt nu
acht frames van dezelfde sessie af. De waarden hieronder komen uit
`docs/pitwall-look/evidence/sector-continuity-20261121/evidence.json`
(screenshot per stap in dezelfde map).

| Stap | Frame | Voor de fix | Na de fix |
|---|---|---|---|
| 1 | seq 718, 4 PACE-auto's | Leroy `—`; eigen auto gevuld | idem (geen data) |
| 2 | seq 720, 5 volledige sets | Leroy R4 `35.503/52.350/33.853` | idem |
| 3 | seq 722, f0820 mid-lap | f0820 R3 blijft (eerdere fix) | idem |
| 4 | 13 auto's, herschikt | waarden blijven | idem |
| 5 | tussenframe: `identity` ontbreekt, alleen eigen PACE-auto | **Leroy en f0820 → `—`** (cache-reset) | **Leroy R4 en f0820 R3 blijven** |
| 6 | herstel, volledig frame | waarden komen terug | waarden blijven, geen flits |
| 7 | alleen S1 van f0820 R4 | **S1 = 36.200, S2/S3 = `—`** (gemengde rij) | **R3 36.500/37.500/38.500 blijft als geheel** |
| 8 | S1–S3 van f0820 R4 | pas na alle drie weer een rij | **R4 36.200/37.200/38.200 in één keer** |

De klassieke tabel wordt in dezelfde stappen gelezen en blijft gelijk aan de
premiumtabel. De gedeelde lezer gebruikt `sharedViewerV3` en dezelfde
componenten; de unit-test dekt de share-context en een echte sharewissel.

## 4. Tijdelijke diagnostiek (opt-in, begrensd, verwijderbaar)

Inschakelen: `?pitwallTrace=1` of `localStorage.setItem("pitwall.sectorTrace","1")`.
Uitlezen in de console:

```js
window.__pitwallSectorTrace.dump()   // max. 200 gebeurtenissen
window.__pitwallSectorTrace.clear()
```

Gebeurtenissen (geen namen, auth, tokens of ruwe telemetrie):

- `snapshot_accepted` — vorige/nieuwe `sequence`, aantal PACE-auto's;
- `stale_poll_ignored` — een ouder pollantwoord is niet toegepast;
- `retained_reset` — `reason` (`context`, `identity`, `segment`, `clock`,
  `layout`), aantal auto's vóór de reset, of track bekend was;
- `live_partial_ignored` — aantal gevulde slots, layout, `mixed_laps`, status;
- auto's alleen als niet-omkeerbare 8-teken `carRef`; de context (`scope`) is
  om dezelfde reden een 8-teken contextref, geen leesbare sessie- of
  coureursnaam.

Zonder de vlag doet `sectorTrace.ts` niets: geen console, geen buffer. De
buffer is begrensd op 200 en wordt na 24 uur niet bewaard (geen opslag).
Verwijderen: `sectorTrace.ts` plus de `traceSector(...)`-aanroepen in
`useRetainedLapSectors.ts`, `usePitwallData.ts`.

## 5. Persoonlijke pitduur — pit-in tot pit-uit

### 5.1 Bronkeuze

Onderzocht is `measurement_events` met een `pit_visit_id`. In de laatste zeven
dagen stonden daar alleen `pit_service_completed` (150), `session_start` (31),
`wear_refresh_confirmed` (2) en `wear_value_changed` (136). Er is geen gepaarde
pit-in/pit-uit en dus geen bruikbare tijd. Deze tabel is **niet** gebruikt.

De bewezen bron is `simhub_tyre_observations`: elk frame bewaart
`device_id`, `session_key`, `frame_sequence`, `session_time_seconds`,
`on_pit_road` en `driver_name`. Dat is dezelfde ruwe `OnPitRoad`-flank als de
bestaande pitdetectie, maar met een bron-tijdstempel per frame. De connector
0.7.6.4 levert deze velden al; **een connectorpatch is niet nodig** en is niet
gemaakt.

### 5.2 Vastlegging

Migratie `20261121121000_personal_pit_visits.sql`:

- tabel `pitwall_personal_pit_visits`, uniek per
  `(device_id, session_key, visit_key)`;
- trigger na insert op `simhub_tyre_observations`, alleen bij een expliciete
  `on_pit_road = false`;
- entry = **eerste** `true` na de laatste expliciete `false`; meerdere
  pitframes zijn één bezoek;
- alleen een afgeronde visit; geen rij zonder entry, zonder exit of als het
  bezoek al in de pit begon;
- duur = `exit_session_seconds - entry_session_seconds`, 5–900 s;
- faalt gesloten bij een teruglopende sessieklok, een team-/eventwissel, een
  framegat > 900 of een bron-tijdstempel die meer dan 30 s van de sessieklok
  afwijkt;
- **geen backfill**: de trigger loopt alleen op nieuw binnengekomen
  observaties; bestaande rijen worden niet opnieuw geïnterpreteerd;
- idempotent: `ON CONFLICT DO NOTHING`; een fout in de trigger laat de ruwe
  observatie nooit vallen.

### 5.3 Lezen en tonen

`pitwall_personal_pit_visits_v1(p_device_id, p_limit)` is
`SECURITY DEFINER`, eist eigenaar of `can_manage_simhub()`, en leest alleen de
**huidige** sessie van dat device. De tabel is service-role-only; de RPC is de
poort voor `authenticated`. De personal route toont de kaart "Pitduur" met
`data-pit-duration`; de copy zegt expliciet: **bruto pitstraattijd, service
inbegrepen, geen netto raceverlies**. De waarde gaat niet naar
`computePitLoss`, `usePitwallStrategy`, de teamroute of de gedeelde route.

## 6. Tests en bewijs

Unit/component (Vitest):

```bash
npx vitest run src/features/endurance/pitwall src/features/personal-pitwall
# 45 files, 991 tests passed
```

SQL (geïsoleerde PGlite, geen remote DB):

```bash
node supabase/tests/pace-history-identity-guard.test.mjs
# 9/9: transient identity, echte track/segment/sessie-resets, stale frame,
#      uren-cleanup, rollback
node supabase/tests/personal-pit-visits.test.mjs
# 19/19: duur, idempotentie, initial-in-pit, open bezoek, reset, 5–900,
#        NULL-gat, teamwissel, sessiescope, permissie, grants, rollback
```

Browser (echte componenten en CSS):

```bash
npx vite --config vite.pitwall-look.config.ts
SECTOR_RETENTION_OUT=/tmp/sector-retention-structural \
  bash scripts/ensure-playwright-runtime.sh \
  node docs/pitwall-look/preview/sector-retention-shot.mjs
```

Bewijs: `/tmp/sector-retention-structural/evidence.json` en acht screenshots
(`poll-1-seq718.png` … `poll-8-complete-live.png`). De run controleert ook dat
de opt-in trace geen `retained_reset` met `reason: identity` bevat en bij de
gedeeltelijke rij `live_partial_ignored` met één gevulde slot laat zien.

Overige checks:

```bash
npx eslint <gewijzigde bestanden>       # geen fouten
npx tsc -p tsconfig.app.json --noEmit   # bestaande fouten in
                                        # supabase/functions/_shared/observationV1.ts;
                                        # geen fouten in de gewijzigde bestanden
VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_ANON_KEY=build-placeholder \
  npx vite build                        # geslaagd (6,44 s)
```

De volledige Vitest-run geeft 2458 geslaagde tests en 3 bestaande
falingen (`simHubConnectorContract` 2×, `tyreTelemetryContract` 1×). Dezelfde
drie falen op de ongewijzigde basis `b0e92979`; ze raken deze wijziging niet.

## 7. Risico's en grenzen

- De SQL-guard herstelt bij een niet-bevestigde identiteitsdaling de vorige
  `paceHistory`; de PACE-update van dat ene tussenframe gaat verloren. Het
  volgende complete frame werkt hem bij. Dat is de bewuste prijs voor het niet
  wissen van bewezen waarden.
- Een auto die lang in de pits staat houdt zijn laatste bewezen ronde
  (gedimd, R-label). Dat is gewenst; er is geen tijdsgebaseerd verval.
- De pitduur is **bruto** pitstraattijd. Service en stilstand zitten erin; het
  is geen netto raceverlies en wordt niet als servicekosten gebruikt.
- De pitduur verschijnt pas bij een expliciete pit-uit. Een bezoek dat al in de
  pit begint of zonder exit blijft, levert geen getal. Dat is fail-closed.
- Geen productie-DB, geen migratie uitgevoerd, geen share-link aangemaakt,
  geen connector geïnstalleerd of herstart, geen push/release.
