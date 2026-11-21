# Sectordoorstroom en persoonlijke pitduur — structurele fix

Datum: 2026-11-21
Branch: `fix/sector-continuity-pit-visits`
Basis: `b0e92979` (origin/main)
Status: lokaal geïmplementeerd en getest; **geen push, deploy, migratie, installatie of productieactie**.
De productiebase is alleen-lezen gecontroleerd; de gevonden drift maakt de
volledige `simhub_persist_v3`-vervanging nog niet toepasbaar. Zie §8.

Dit document hoort bij de eerdere presentatiefix in
`docs/operations/2026-11-19-opponent-sector-retention.md`. Die fix verklaarde
het sparse PACE-veld en hield bewezen reeksen in de UI vast. Dezelfde
screenshots bleven daarna echter optreden. Deze ronde zoekt de oorzaak in de
hele keten: producer → serializer → Edge → SQL-merge/projectie → pollende
API → de echte premium-, klassieke en gedeelde lezers, plus de persoonlijke
pitduur en de strategie-UI.

## 1. Wat de keten werkelijk doet

```
C#-connector (bron gewijzigd; nog niet gebouwd/uitgebracht)
  frame: identity + opponents + paceCapture.opponentMetrics (max 4 in rotatie)
          + paceCapture.sectorUpdates (per sector, max 8)
          + measurementEvents: expliciete pit_in/pit_out-flanken
        │  serializer laat null/afwezige velden weg; geen synthetische waarden
        ▼
Edge simhub-ingest-v3
  normaliseert; snapshotDto haalt meetreeksen uit het browserbeeld
  roept simhub_persist_v3(p_token_hash, p_session_id, p_sequence, p_captured_at,
                          p_v3_normalized, ..., p_events, p_laps)
        │
        ▼
PostgreSQL
  simhub_pace_previous_v1 / simhub_pace_merge_v1
    → car.sectors per sectorIndex, car.sectorBests, car.metrics
  simhub_pace_project_v1(snapshot) op de leesroute
  simhub_telemetry_latest.v3_normalized = snapshot + paceHistory
  simhub_measurement_events (pit_in/pit_out) → pitwall_personal_pit_visits
        │
        ▼
API get_pitwall_data / pitwall_sandbox_v1 / pitwall_shared_snapshot_v2
     + pitwall_personal_pit_visits_v1 (owner-only)
        │  1s polling (owner/team), 5s learning
        ▼
usePitwallData → useRetainedLapSectors → composeSectorCells
        │
        ├── PremiumTimingPanel (Mijn Pitwall / test / gedeeld)
        ├── StandingsWidget (klassieke route)
        ├── PitDurationPanel (laatste stop, bruto benchmark)
        └── PitStrategyBlock / DecisionBand (strategie)
```

De connector stuurt per frame maximaal vier opponent-metingen in rotatie. Een
volledige sectorreeks staat alleen in het metingslot direct na het afronden van
die ronde. Met een vol veld is elke auto dus geregeld secondenlang "leeg" in
het PACE-blok. Dat is normaal en mag geen bestaande, bewezen reeks wissen.

## 2. Sectoroorzaken en fix

### 2.1 UI-identiteit: een ontbrekend trackblok werd als baanwissel gelezen

`useRetainedLapSectors` bouwde één string van
`[transportSessionId, trackId ?? trackName, trackConfig]`. Een tussenframe met
wel het transport-id maar zonder `identity.trackId`/`trackName` leverde
`["transport","",""]` op en werd als **bevestigde identiteitswissel** behandeld.
De cache werd geleegd en meerdere auto's verdwenen tegelijk.

Fix: identiteit is nu een object met losse delen (transport, trackId,
trackName, config). Alleen twee **bekende** en verschillende waarden bewijzen
een wissel. Ontbrekend blijft onbekend en laat de vorige waarde staan. Een
echte sessie-, baan-, segment- of share/device-contextwissel reset nog steeds.

### 2.2 Een gedeeltelijke live-rij werd niet meer per cel samengesteld

De vorige fix eiste een complete live-rij voordat hij de bewezen ronde verving.
Daardoor werd een **geverifieerde nieuwe S1** uitgesteld tot S2/S3 ook binnen
waren. Dat is niet nodig en verbergt echte data.

Fix: `composeSectorCells()` stelt per `sectorIndex` de nieuwste bruikbare cel
samen. Een nieuwe S1 staat direct; S2/S3 blijven uit de vorige bewezen ronde
met hun eigen `R`-label en dimming. De rij krijgt
`data-sector-mixed-laps="true"` en wordt nooit als één complete ronde
gepresenteerd. Een live slot dat ouder is dan de bewaarde ronde verliest, zodat
een late/omgekeerde poll niets terugzet. Dezelfde functie wordt door de
premium- en klassieke tabel gebruikt.

### 2.3 Bevestigde ongeldigheid kon terugkomen

`useRetainedLapSectors` keek alleen naar de invalidated-sectoren in het
huidige frame. Verdween die sector uit een volgend frame, dan kon een oudere
meting dezelfde ronde weer als geldig aanbieden.

Fix: `invalidated` wordt per auto en per `(ronde, sectorIndex)` in de sessie
onthouden. `composeSectorCells()` suppressiet die cel ook als een latere
"geldige" kopie binnenkomt. De cache wordt alleen gewist als de ongeldigheid
die ronde raakt; een geldige S2/S3 blijft dus staan. Een nieuwe sessie/context
wist de onthouden ongeldigheden.

### 2.4 SQL-merge: NULL vs waarde wiste de hele `paceHistory`

`simhub_persist_v3` vergeleek de vorige en nieuwe identity met
`IS DISTINCT FROM`. In PostgreSQL is `NULL` distinct van `596`; een frame
zonder `trackId` of `carId` gooide daardoor de complete bewezen historie weg,
ook midden in dezelfde sessie en op dezelfde baan.

Fix in twee lagen:

1. `simhub_pace_previous_v1()` is de eigenlijke mergebeslissing: alleen twee
   bekende, verschillende waarden resetten. Een ontbrekende identity, een
   ontbrekende `paceHistory`, minder auto's of een oudere `updatedAt` erven de
   vorige historie. Een teruglopende sessieklok, een nieuwe observed sessie of
   een nieuw segment resetten wel.
2. `simhub_pace_identity_fill_v1()` draagt de laatst bekende `trackId`/`carId`
   over wanneer dit frame ze niet meestuurt, zodat een volgend frame een echte
   wissel nog kan bewijzen.
3. `20261121120000_pace_history_identity_guard.sql` blijft als tweede slot:
   een `BEFORE UPDATE OF v3_normalized`-guard herstelt een niet-bevestigde
   terugval en weigert een oud sessieframe (`RETURN NULL`).

De tests voeren de **echte helper-body** uit met gaps/identity/sparse payloads,
niet een stub, en controleren dat de persist-body de helper aanroept. Zie §7.

### 2.5 Pollantwoorden in omgekeerde volgorde

`snapshotOrder.ts` vergelijkt sessie, `sequence` en `captured_at`
conservatief. `usePitwallData` bewaart het laatst geaccepteerde antwoord per
event/team en negeert alleen een aantoonbaar ouder antwoord. Een contextwissel
start een nieuwe reeks. Onbekende orde blokkeert niets. De browserreplay in §6
voegt daar een deterministische oude PACE-rij aan toe.

### 2.6 Wat niet de oorzaak was

- `received_at` is opslagtijd, geen pit- of sectortijd.
- Geen CSS, debounce, langere polling of het verbergen van het knipperen.
- Geen wijziging aan `measurement_events`, `endurance_pit_stops`,
  `pitwall_pit_loss_v1`, `computePitLoss`, legacy V3 of de PACE-opt-out.

## 3. Persoonlijke pitduur — bron vervangen

### 3.1 Waarom de tyre-tabel is verworpen

De vorige lokale variant gebruikte `simhub_tyre_observations`. De live
investigatie zag **5992 tyre-records maar slechts 26 verschillende
`observed_at`-waarden over 5 uur**, met gemengde vlaggen en een
event-getriggerde/bemonsterde reeks. Dat is geen continue bron: de exacte
pitgrenzen zijn daar niet uit te bewijzen. De 19 synthetische tests bewezen
alleen de triggerlogica, niet de echte grenzen. Die trigger is daarom volledig
verwijderd.

### 3.2 Nieuwe bron: expliciete connectorflanken in de duurzame outbox

De C#-connector maakt op de ruwe SDK `OnPitRoad`-flank twee echte
meetgebeurtenissen:

- `pit_in` bij de eerste expliciete `false → true`;
- `pit_out` bij de expliciete `true → false`.

Elk event draagt `observedAt`, `sessionTimeSeconds`, `sdkTick`,
`observedSessionId`, `segmentId` en `pitVisitId`, plus `confidence` en een
korte evidence-noot. De events gaan direct via `MeasurementOutbox` naar de
bestaande meetbatch; de outbox is de duurzame grens en hergebruikt dezelfde
`eventUid` bij een retry. Er is geen nieuwe transportroute en geen tweede
waarheid.

De tracker faalt gesloten:

- een bezoek dat al in de pit begint heeft geen entryflank en levert geen duur;
- een sessiewissel/shutdown sluit zonder verzonnen `pit_out` (orphan);
- onbekende `OnPitRoad` midden in het bezoek, een gat > 5 s, een teruglopende
  klok, een niet-monotone SDK-tick, reset/tow of onbekende tow-reset, een
  duur buiten 5–900 s of een onbruikbare confidence wordt expliciet afgekeurd;
- de uitgaande flank krijgt dan `confidence: 0` met de reden in
  `evidence.note`; de database paart hem niet.

### 3.3 Database

Migratie `20261121121000_personal_pit_visits.sql`:

- `pitwall_personal_pit_visit_edges`: elke ontvangen flank met bron-tijdstempel,
  confidence, `pair_status` (`pending`/`paired`/`orphan`/`rejected`) en
  `reject_reason`;
- `pitwall_personal_pit_visits`: alleen een echt paar, uniek per
  `(device_id, observed_session_id, pit_visit_id)`;
- trigger na insert op `simhub_measurement_events` voor `pit_in`/`pit_out`.
  De trigger paart in **beide** volgorden (entry vóór exit of exit vóór entry),
  eist dezelfde device/observed-sessie/pitVisitId, monotone sessietijd,
  monotone bronklok, monotone SDK-tick en een sessie-/wandklokverschil ≤ 30 s;
- `device_id` is `text`, precies zoals de bronkolom; geen cast die een rij kan
  laten vallen;
- **geen backfill**: de trigger loopt alleen op nieuw binnengekomen events;
- idempotent op `eventUid`; een fout in de trigger laat de ruwe meetgebeurtenis
  nooit vallen;
- de transport-sessie (`delivered_session_id`) doet niet mee. De lezer volgt de
  nieuwste **observed** sessie van dat device.

`pitwall_personal_pit_visits_v1(p_device_id, p_limit)` is
`SECURITY DEFINER`, eist eigenaar of `can_manage_simhub()`, leest alleen de
nieuwste observed sessie en geeft naast de bezoeken ook
`diagnostics.pendingEdges`, `diagnostics.rejectedEdges` en
`lastRejectReason`. Zo is "geen getal" een expliciete diagnose.

### 3.4 Strategie-UI: bruto benchmark, geen dubbeltelling

De persoonlijke kaart heeft `data-pit-benchmark="gross"` en de copy
"Laatste gemeten stop · bruto benchmark · niet in het strategiemodel".
Zij staat direct onder de beslissingsband (strategie-UI), niet in de
transport-/tabelkolom.

`advise()` voedt `computePitLoss` **niet** meer met de bruto servermediaan.
Alleen een expliciet bewezen `serviceFreePitLaneSeconds` mag daar binnen. Zonder
die basis blijft het modelverlies `null`; de bruto mediaan en de laatste stop
staan apart in `PitStrategyBlock` met "service inbegrepen". Er is dus:

- geen service dubbel geteld (bruto + service);
- geen verzonnen netto raceverlies;
- geen vervanging van modeltransit door bruto.

## 4. Tests en bewijs

### C# (echte serializer/outbox, geen SimHub)

```bash
export PATH="$HOME/.dotnet:$PATH"
cd tools/simhub-plugin/3SM.EnduranceConnector.DiagnosticsTests
dotnet build -v q && dotnet run --no-build
# SUMMARY PASS=... FAIL=0
```

Nieuw: `MeasurementPitEdgeTests` (PE01–PE12) dekt de twee expliciete flanken,
bron-tijden, dezelfde `pitVisitId`/observed-sessie, onbekende vlag, gat,
reset/tow, onbekende tow, entry-in-pit, sessiewissel zonder verzonnen exit,
duurgrens en de echte wirevorm in de outbox. De volledige bestaande C#-suite
blijft groen.

Echte serializeroutput staat in
`supabase/tests/fixtures/pit-edges-connector.json` (gegenereerd met
`dotnet run -- --export-pit-edges`) en wordt door de SQL-test geconsumeerd.

### Edge-parser (Deno)

```bash
~/.deno/bin/deno test --allow-env supabase/functions/_shared/plugin08_extensions_test.ts
# 13 passed, 0 failed
```

Bewijst dat de echte parser de `pit_in`/`pit_out`-wirevorm leest en een
legacy `pit_service_completed`-rij bytegedrag houdt.

### SQL (geïsoleerde PGlite, geen remote DB)

```bash
node supabase/tests/personal-pit-visits.test.mjs
# 25/25: geen backfill, echte serializeroutput, paar, out-of-order, retry, ontbrekende
#        entry/exit, cross-device/cross-session, tick/klok/gat, confidence,
#        5–900, current-observed-session, diagnostics, grants, rollback
node supabase/tests/persist-pace-identity-guard.test.mjs
# 14/14: echte helper-body met sparse/identity/gap-payloads, reset vs carry,
#        drift/vorige preimage-string, 24h-cleanup
node supabase/tests/pace-history-identity-guard.test.mjs
# 9/9: echte trigger-body, transient identity, echte resets, stale frame,
#      cleanup, rollback
```

### Browser (echte componenten en CSS)

```bash
npx vite --config vite.pitwall-look.config.ts
SECTOR_RETENTION_OUT=/tmp/sector-retention \
  bash scripts/ensure-playwright-runtime.sh \
  node docs/pitwall-look/preview/sector-retention-shot.mjs
PIT_DURATION_OUT=/tmp/pit-duration \
  bash scripts/ensure-playwright-runtime.sh \
  node docs/pitwall-look/preview/pit-duration-shot.mjs
```

Bewijs: `docs/pitwall-look/evidence/sector-continuity-20261121/evidence.json`
en `poll-1…poll-11`-screenshots. De replay is deterministisch en bevat:

- een geverifieerde nieuwe S1 terwijl S2/S3 R3 blijven;
- een out-of-order oude PACE-rij die de nieuwere R4 niet terugzet;
- een bevestigde ongeldigheid waarbij de cellen verdwijnen;
- een latere oude kopie die de ongeldigheid niet terugbrengt;
- de tijdelijke trace `retained_lap_dropped` met `reason: invalidated`,
  `lap: 4` en alleen gehashte 8-tekens auto-referenties.

De persoonlijke pitduurkaart toont 38.125 s uit
`measurement_event_pit_edges`, met `data-pit-benchmark="gross"` en de
benchmarkcopy. Bewijs: `personal-pit-duration.png` en
`personal-pit-duration.json`.

### Frontend

```bash
npx vitest run src/features/endurance/pitwall src/features/personal-pitwall
# 46 files, 997 tests passed
npx eslint <gewijzigde bestanden>   # geen fouten
npx tsc -p tsconfig.app.json --noEmit
# baseline-fouten buiten de gewijzigde bestanden; geen fout in een gewijzigd bestand
```

De volledige suite is breder gedraaid: **2465 geslaagd, 3 bestaande
falingen** (`simHubConnectorContract` 2×, `tyreTelemetryContract` 1×). Dezelfde
drie falen op de ongewijzigde basis `b0e92979` in een aparte worktree; ze raken
deze wijziging niet en zijn niet als bewijs gebruikt.

## 5. Tijdelijke diagnostiek

Inschakelen: `?pitwallTrace=1` of
`localStorage.setItem("pitwall.sectorTrace","1")`.

```js
window.__pitwallSectorTrace.dump()   // max. 200 gebeurtenissen
window.__pitwallSectorTrace.clear()
```

Gebeurtenissen: `snapshot_accepted`, `stale_poll_ignored`, `retained_reset`,
`retained_lap_dropped` (met `reason`), `live_partial_composed`. Auto's alleen
als niet-omkeerbare 8-tekens `carRef`; de context is ook een hash. Geen namen,
tokens, auth-id's of ruwe telemetrie. Zonder de vlag doet `sectorTrace.ts`
niets. Verwijderen: `sectorTrace.ts` plus de `traceSector(...)`-aanroepen.

## 6. Wat de browserreplay laat zien

| Stap | Frame | Verwacht |
|---|---|---|
| 1 | seq 718, 4 PACE-auto's | Leroy leeg; eigen auto gevuld |
| 2 | seq 720, 5 volledige sets | Leroy R4 en f0820 R3 |
| 3 | seq 722, f0820 mid-lap | R3 blijft |
| 4 | 13 auto's, herschikt | waarden blijven |
| 5 | tussenframe zonder identity | geen reset, waarden blijven |
| 6 | herstel | waarden blijven |
| 7 | alleen S1 van R4 | S1 = 36.200 direct; S2/S3 = 37.500/38.500 met R3 |
| 8 | S1–S3 van R4 | hele rij R4 |
| 9 | out-of-order oude PACE-rij | R4 blijft, geen terugval |
| 10 | R4 ongeldig | cellen weg; trace `retained_lap_dropped` |
| 11 | late oude R4 | blijft weg; ongeldigheid niet herrezen |

De klassieke tabel wordt in dezelfde stappen gelezen en blijft gelijk aan de
premiumtabel.

## 7. Productie-read-only controle en open gates

Uitgevoerd via de bestaande SSH/runbookroute op `3sm-docker`, uitsluitend
`SELECT`/catalogusmetadata. Geen productie-DDL/DML, geen write, geen deploy.

| Feit | Uitkomst |
|---|---|
| `simhub_persist_v3` op productie | md5 `e15ef4a7bde6e876e835c406696283c6`; repo-preimage `4e53b4305bb36cb8ad6bad4ecd804eff` → **drift** |
| `simhub_pace_merge_v1` op productie | md5 `0f984dd59a233a499caa35e16a68515c`; repo-preimage `5a8ead0f2c8e29633b7f647697c86e2a` → **drift** |
| `pitwall_personal_pit_visits` | bestaat niet |
| `simhub_pace_history_guard_v1` | bestaat niet |
| `simhub_measurement_events.device_id` | `text` (geen uuid/FK), zoals de repo-baseline |
| `simhub_measurement_events` rechten | alleen `postgres`/`service_role`; `authenticated`/`anon` geen SELECT |
| `pit_in`/`pit_out`-events op productie | 0 |

Gevolg: de nieuwe `20261121122000_persist_pace_identity_guard.sql` bevat een
harde `DO $drift$`-guard en **weigert** te draaien als de productiefunctie niet
gelijk is aan de repo-preimage. Dat is bewust fail-closed: de productieversie
bevat extra wijzigingen (o.a. `record_revision`/`content_hash`) die niet stil
verloren mogen gaan. De trigger-guard uit `20261121120000` is zelfstandig
toepasbaar, maar is in deze ronde **niet** op productie toegepast.

Open/onverificable gates:

- Geen productieapply, dus de echte productie-`simhub_persist_v3` is niet
  vervangen en de productie-Edge is niet getest met de nieuwe events.
- De connector is niet gebouwd/uitgebracht/geïnstalleerd. De draaiende
  connector 0.7.6.4 stuurt nog geen `pit_in`/`pit_out`; tot een nieuwe build
  blijft de persoonlijke pitduur leeg (geen tyre-fallback).
- De productie-drift moet eerst met de beheerder worden verzoend; daarna kan
  de persist-helper en de trigger in een aparte, gecontroleerde migratie.
- De volledige typecheck heeft bestaande fouten buiten de gewijzigde
  bestanden (o.a. `src/main.tsx`, `pitWindow.ts`, community-support); die zijn
  niet door deze wijziging veroorzaakt en niet “opgelost” door ze te negeren.

## 8. Risico's en grenzen

- De SQL-guard herstelt bij een niet-bevestigde identiteitsdaling de vorige
  `paceHistory`; de PACE-update van dat ene tussenframe gaat verloren. Het
  volgende complete frame werkt hem bij.
- Een auto die lang in de pits staat houdt zijn laatste bewezen ronde (gedimd,
  R-label). Dat is gewenst; er is geen tijdsgebaseerd verval.
- De pitduur is **bruto** pitstraattijd. Service en stilstand zitten erin; het
  is geen netto raceverlies en wordt niet als servicekosten gebruikt.
- De pitduur verschijnt pas bij een expliciete pit-uit. Een bezoek dat al in de
  pit begint, zonder exit of met een discontinuity blijft zonder getal; de
  afgekeurde flank blijft zichtbaar in de diagnostiek.
- Geen productie-DB, geen migratie uitgevoerd, geen share-link aangemaakt,
  geen connector geïnstalleerd of herstart, geen push/release.
