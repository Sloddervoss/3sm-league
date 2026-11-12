# T13 — capture-only observatiecontract v1 (voorstel, niet geïmplementeerd)

Status: **PROPOSAL / capture-only**. Geen productiecode, migratie, SDK-read, build, deploy of leeractivatie. Baseline
`e36f33b0a835c76fd7a80348fb1f6bb2890dc931`. Dit document vervangt de 215-regelversie op `e36f33b0`; de oude
probe-uitkomsten blijven geldig en worden hier niet herschreven. `observation.version: 1` is een voorstel, geen bestaand
feit. SDK-paden zijn **UNVERIFIED** tenzij geciteerd.

## 0. Besluit en grens
Deze slice levert alleen **bewijsopslag**: een optioneel, onveranderlijk `observation`-blok per afgeronde ronde,
server-first en achter een default-off flag. Het blok bevat positieve waarnemingen en descriptoren, **geen enkele
`false`/`0`-kwalificatie**. Daarom kan deze slice geen `pitLap:false`, `fuelAdded:0`, `driverChanged:false` of
`resetOrTow:false` produceren en ook T10-fuel niet eligible maken. brandstofleren, T10-activatie, fit/publish, P3, UI,
DB-deploy en Edge-deploy blijven buiten scope.

T09/T10 worden niet gewijzigd. De enige ownerbasis in deze slice is de bestaande serverwaarde `device_owner_at_receipt`
(of `none`) in het P1-`owner_basis`-veld; een historische owner mag volgens het reeds geaccepteerde T09-model van de
ontvangstowner afwijken wanneer daarvoor geldig historisch bewijs bestaat. Deze slice levert dat bewijs niet en voegt dus
**geen** regel toe die `owner_observation` gelijkstelt aan `owner_receipt`.

## 1. Onveranderlijke regels
1. Afwezigheid is onbekend. Een ontbrekend feit wordt weggelaten, nooit als `false`, `0`, lege string of `null`
   geschreven.
2. Een aanwezig feit is positief of descriptief: `pitRoad.value` alleen `true`, `refuel` alleen bij een waargenomen
   positieve stap. Een sample bewijst alleen de waargenomen samples, niet "alles tussen twee samples"; "infinite
   continuous sampling" en "aantoonbaar volledig" worden hier niet gebruikt.
3. Geen enkele waarde wordt bij verzending uit de actuele frame-, settings- of pairingstaat aangevuld. Het blok wordt
   één keer bij rondeclose geserialiseerd.
4. `summaryUid`, `recordRevision`, `currentDriverName`, `driverChanged`, `pitLap`, `pitVisitIds`,
   `fuelAddedLitresObserved` en bestaande coverage worden nooit door `observation` overschreven of genormaliseerd.
5. Geen token, owner-ID of pairinggeneratie over de draad. Geen accountoverschrijdende pooling; personal training
   blijft geblokkeerd.

## 2. Wire-vorm (exact)
Pad `payload.lapSummaries[i].observation`. Optioneel; afwezig = onbekend. `"observation": null`, `{}`, een onbekende
subsleutel of een `null` binnen het blok is een **rijafwijzing** (`contains unknown fields` / `observation_null`), geen
hele-frame-afwijzing. Exacte allowlist:
```json
{"observation":{
  "version":1,
  "capture":{"deviceId":"11111111-1111-4111-8111-111111111111"},
  "interval":{"firstSampleAt":"2026-11-12T10:00:00.100Z","lastSampleAt":"2026-11-12T10:01:59.900Z",
    "samples":239,"maxGapSeconds":1.2,"unknownSeconds":0.8,
    "edgeBeforeSeconds":0.1,"edgeAfterSeconds":0.1},
  "pitRoad":{"value":true,"firstAt":"2026-11-12T10:00:41.200Z","samples":239,
    "maxGapSeconds":1.2,"unknownSeconds":0.8},
  "refuel":{"observedAddedLitres":2.4,"firstAt":"2026-11-12T10:00:58.400Z","positiveSteps":2,
    "resolutionLitres":0.01,"maxUndetectedLitres":0.01},
  "driverNameContinuity":{"value":"unchanged","samples":239,"maxGapSeconds":1.2},
  "context":{"carId":"1321","trackId":42,"trackName":"Circuit de Spa-Francorchamps",
    "trackConfig":"Endurance","sessionUniqueId":987654,"sessionNumber":0,"samples":239}
}}
```

`interval` is de enige verplichte descriptorgroep na `version` en `capture`. `capture.deviceId` is de bevroren
entrywaarde, niet de settings op verzendmoment. `pitRoad` ontbreekt zonder positieve `OnPitRoad`-sample. `refuel`
ontbreekt zonder positieve fuelstap. `driverNameContinuity` en `context` ontbreken als één sample in de ronde een lege,
ontbrekende of afwijkende waarde had; ze zijn dan onbekend, niet `false`.

Typen en caps (JSON, geen impliciete coercie):

| Veld | Regel |
|---|---|
| `version` | exact `1`; anders `observation_version_unsupported` |
| `capture.deviceId` | RFC4122-tekst, 36 tekens, vergeleken met geauthenticeerd device |
| tijden | ISO-8601 UTC, `YYYY-MM-DDTHH:mm:ss.sssZ`, binnen `[startedAt, endedAt]`, `first <= last` |
| `samples` | integer 1..1.000.000; `samples == interval.samples` voor elk aanwezig feit |
| `maxGapSeconds`, `unknownSeconds`, edge-velden | getal 0..86.400; `unknownSeconds` = som van edge-offsets + alle volledige gaten > 1,0 s (bovengrens, geen continuïteitsclaim) |
| `pitRoad.value` | alleen `true`; `firstAt` verplicht en binnen het interval |
| `refuel` | `observedAddedLitres` > 0 en <= 300; `firstAt` verplicht en binnen het interval; `positiveSteps` 1..10.000 |
| `resolutionLitres` | getal 0,001..1; `maxUndetectedLitres` >= `resolutionLitres` en <= 300. Laatstgenoemde is de bewezen bovengrens van een tankstap die volledig tussen twee geaccepteerde fuelsamples kan vallen; zonder bewezen bound wordt `refuel` weggelaten |
| `driverNameContinuity.value` | `unchanged` of `changed`; beschrijvend, nooit driveridentiteit |
| `context.carId` | ruwe SimHub-string, 1..64 UTF-8-bytes, geen controls |
| `trackName`, `trackConfig` | 1..128 UTF-8-bytes, ruw (geen trim/casefold), geen controls |
| `trackId` | integer 1..2147483647; `sessionUniqueId` 0..2147483647 en `sessionNumber` 0..1000 zijn optioneel; afwezig = onbekend |

`context` bevat **geen** `ownerUserId`, `ownerBasis`, `driverId`, `currentDriverName`, `driverChanged`, `resetOrTow`,
`compound` of `regime`. `driverCarIdx` is geen user-ID en wordt niet gemapt.

Bytecaps zijn twee verschillende maten, met aparte namen en aparte tests:

- **wire**: compacte UTF-8 van de `observation`-waarde, gemeten met `TextEncoder`/`JSON.stringify`, **<= 2048 bytes**.
  De producer weigert een feit dat niet meer past; hij knipt nooit midden in een feit en vervangt het blok dan door
  "afwezig" met een zichtbare teller. UTF-8-bytes, dus multibyte-tekens tellen vol mee.
- **DB**: `pg_column_size(observation) <= 4096` als aparte `observation_jsonb_size`-constraint. jsonb-binairformaat is
  geen wire-bytemaat; deze grens is **niet uitgevoerd** en wordt hier niet als PG-bewijs geclaimd.

## 3. Producer: bevriezen en capturen
- **Lapstart** (`TelemetrySampler.StartLap`): `LapAggregate` krijgt eigen `ObservedSessionId` en `SegmentId`;
  `LapAccumulator` opent `interval` en snapshot `DeviceId`, `BoundOwnerUserId` en `PairingGeneration` onder
  `_settingsGate`. `ObservedSessionId`/`SegmentId` komen daarna nooit uit de actuele pipeline- of settingsstaat.
- **Per tick**: alleen `interval`, positieve `pitRoad`, positieve fuelstap, naamcontinuïteit en constante context
  bijwerken. Ontbrekend kanaal, gat of tegenstrijdige waarneming maakt dat feit definitief onbekend; het wordt niet
  later "gerepareerd".
- **Rondeclose**: `LapAccumulator.Close` schrijft het blok één keer. `MeasurementLapSummaryRecord.ToJson()`
  serialiseert het; daarna wijzigt niets meer. `EnqueueLap` bewaart `RowJson` letterlijk.
- **Pit/fuel**: `PitServiceTracker` mag een netto delta <= 0,01 L als *waargenomen netto nul* blijven registreren,
  maar dat wordt **niet** als `refuel:0` of "geen refuel" geëxporteerd. `NotePitVisit` blijft `pitLap:true` zetten;
  observatie overschrijft dat nooit.
- **Naam**: `DriverNameContinuity` is alleen "de niet-lege namen verschilden niet" (of "verschilden"). Het is geen
  bewijs van dezelfde persoon en wordt niet naar `driverChanged` gemapt. `LapAccumulator.cs:298-303` zet alleen
  `driverChanged:true` bij naamverschil; de afwezigheid van `true` is geen `false`-bewijs.
- **Capability**: `ObservationV1Enabled` default `false`; alleen bij aan zendt de plugin `observation` en adverteert
  hij `observationV1:1`. De flag verandert geen bestaande velden of `aggregationVersion`.

## 4. Outbox, device en owner (B3)
`OutboxEntry` krijgt naast `Uid/Series/RecordRevision/RowJson/EnqueuedAt` drie **lokale** velden: `CaptureDeviceId`,
`CaptureOwnerUserId` en `PairingGeneration`. Ze worden bij enqueue bevroren, niet in `RowJson` geschreven, niet gelogd
met token en niet naar de server gestuurd. De bestaande `RowJson` blijft byte-identiek.

- **Pair/unpair**: verhoogt `PairingGeneration` (persisted in `ConnectorSettings`). `simhub_exchange_pairing_code`
  maakt een nieuwe `simhub_devices`-rij met een nieuwe `owner_user_id`; er is geen bestaande owner-mutatie-RPC. De
  oude rij blijft bestaan. De plugin bewaart geen oude token in de outbox.
- **Verzenden**: een entry waarvan `CaptureDeviceId` of `PairingGeneration` niet meer bij de huidige
  `Settings` past, wordt **niet** met het huidige token verzonden. Hij gaat naar een aparte, append-only
  quarantainelijst met zijn exacte `RowJson` en reden (`stale_pairing_generation` / `device_changed`), telt niet mee
  voor `MaxLaps` en blokkeert nieuwe B-records niet. Geen stille drop, geen UID/hash-herschrijving. De lijst is
  begrensd (64 entries/1 MiB); bij vol weigert de producer nieuwe observation-capture zichtbaar, maar gewone laprows
  blijven doorlopen.
- **Pre-upgrade entries** zonder bevroren identiteit worden niet onder een ander token geraden. Als het outboxbestand
  geen file-level deviceidentiteit heeft, worden ze bij de eerste load gequarantaineerd (`identity_unknown`) in plaats
  van verzonden. Dit is de prijs van niet-accountoverschrijdend verzenden; het is expliciet en zichtbaar.
- **Server**: de geauthenticeerde `p_device_id` is leidend. Bij een `observation.capture.deviceId` die daarvan
  afwijkt, blijft de **kernrij** geaccepteerd en krijgt het blok de serverstatus
  `quarantined_device_mismatch`; het wordt niet in P1 capture geprojecteerd en niet als feit gebruikt. Geen
  whole-frame-fail, geen stille drop. `owner_user_id` komt alleen uit `simhub_devices` op ontvangstmoment; de payload
  bevat er geen. `observation_status` is `text`: null als `observation` null is, anders `accepted` of
  `quarantined_device_mismatch`.
- **P1**: `capture_source_batch` blijft `owner_basis = 'device_owner_at_receipt'` of `'none'` gebruiken.
  `pairing_binding_snapshot` bestaat niet en wordt niet toegevoegd. De item-JSON bevat geen owner-ID; `observation`
  wordt alleen geprojecteerd bij `observation_status='accepted'`. `capture_batches`/`source_revisions` blijven
  immutable.
- **T09**: `owner_at_receipt_only` blijft de enige ownerwaarde in deze slice. Een inline `ownerUserId`-claim wordt
  niet als `known` doorgegeven. Het bestaande T09-model mag een historische owner later wel van de ontvangstowner
  laten afwijken; dat vereist apart, geverifieerd bewijs en wordt hier niet ingevuld. Ownerhistorie blijft dus open;
  deze slice claimt geen complete persoonsleer.

## 5. Geen false/0: per-feitdekking (B2)
De huidige `complete`-regels zijn **geen** volledig bewijs:

- C# `MeasurementEvent.cs:698-716` telt de drie groepen op en toetst 80 % op de som; server
  `simhubExtensions.ts:581-598` toetst elke groep apart tegen het venster. Een producer-`complete` kan dus bij ~26,7 %
  per groep passeren.
- De echte validator laat 96,05 s van 120 s toe (`pass:true`), met 23,95 s onwaargenomen. Dat is gereproduceerd in de
  reviewprobe.
- `PitServiceTracker.cs:293-315` maakt van delta <= 0,01 L een waargenomen `0`; dat is netto nul, geen bewijs dat er
  niet getankt is.

Daarom in deze slice: **geen enkele negatieve kwalificatie**. Wat wel wordt opgeslagen is per feit het interval
(`firstSampleAt`, `lastSampleAt`, `samples`, `maxGapSeconds`, `unknownSeconds`, edge-offsets) en de positieve
gebeurtenis. `unknownSeconds` en de edges maken later een negatieve toets mogelijk, maar leveren die nu niet.

Een toekomstige `false`/`0`-regel (aparte poort, niet in v1) moet minstens vereisen:
`firstSampleAt` <= `startedAt` + `sampleTolerance`, `lastSampleAt` >= `endedAt` - `sampleTolerance`,
`unknownSeconds == 0`, `maxGapSeconds` <= `gapTolerance`,
een expliciete `basis` (`observed_no_true` / `observed_no_positive_step`), `resolutionLitres`, `maxUndetectedLitres > 0`
en een **positieve** controle op een bekende pitronde én een normale ronde. `maxUndetectedLitres > 0` betekent voor T10
altijd "onbekend", nooit `0`. Tot die poort blijft T10 `reset_or_tow_unknown` + `driver_changed_unknown` houden.

## 6. Hashes, revisies en aggregatieversie (B4)
- De bestaande `simhub_lap_row_hash(p)` blijft **exact** de huidige formule (`20261031200500:75-100`). Bestaande rijen
  worden niet herschreven en blijven byte-identiek.
- `simhub_lap_row_hash_v2(p)` is dezelfde formule plus `'hashVersion', 2` en `'observation', p.observation`. Selectie
  is **conditioneel**: `observation IS NULL` -> bestaande v1; anders v2. Er komt geen hashversie in het wire-protocol
  en geen nieuwe rootkey; de hash wordt server-side berekend.
- Alle hash-callsites worden expliciet bijgewerkt: fallback-insert (`:233`), fallback-update (`:238`) en fast path
  (`:1057-1077`). De fast path bouwt zijn record uit losse velden en moet `observation` daarom apart opnemen;
  `jsonb_populate_record` alleen is niet genoeg. De P1-capture berekent geen eigen hash maar neemt het serverberekende
  `content_hash` over.
- Zelfde `device_id` + `summaryUid` + `recordRevision` + verschillende `observation` geeft verschillende hash ->
  **`revision_conflict`**, nooit `duplicate`. Zelfde hash -> `duplicate`. Hogere `recordRevision` -> `superseded`
  (bestaande `supersedesSummaryUid`); lagere -> `stale_revision`. De outbox herserialiseert `RowJson` nooit; een
  nieuwe revisie is een nieuwe enqueue, geen in-place wijziging.
- `aggregationVersion` is **geen** featureflag. Hij blijft 1 in deze slice; alleen een werkelijke aggregatiewijziging
  mag hem verhogen. `observation.version` is de eigen schema-/capabilityversie.
- Geen `historicalKnownAt`/`firstVisibleAt`: alleen `observed_at` (sample) en `source_received_at` (transport) blijven
  bestaande, niet-bewezen-tijden.

## 7. Aggregaten en sessie/segment (B6)
`LapAggregate` heeft nu `SegmentId` maar geen `ObservedSessionId`; `MeasurementPipeline.EnqueueSummary` (`:235-241`)
leest `_observedSessionId` uit de pipeline. Een late close kan daardoor de sessie van later gebruiken. Fix:
`LapAggregate` krijgt `ObservedSessionId` bij `StartLap`; `ToSummary` gebruikt dat veld en krijgt geen sessieparameter
meer. `SegmentId` blijft zoals het is. De bestaande sessiewissel sluit de ronde vóór vervanging (`:83-90`), maar dat is
orderafhankelijk; de structurele freeze is leidend. `LapAccumulator`/`PitLap` kan `true` zijn door
`NotePitVisit` zonder positieve `OnPitRoad`-sample. Dat blijft zo; `pitRoad:false` bestaat in deze slice niet en
kan dus niets overschrijven. Netto-nul fuel wordt niet genormaliseerd naar "geen refuel".

## 8. Compatibiliteit en rollback (B5)
Bestaand, reproduceerbaar parsergedrag: een oude rij wordt geaccepteerd; `aggregationVersion:2` zonder `observation`
wordt geaccepteerd; een rij met `observation` wordt rij-level afgewezen (`contains unknown fields`); de ACK merge toont
de afwijzing en `ApplySeries` verwijdert die rij definitief (`MeasurementOutbox.cs:401-411`).

| Producer | Receiver | Uitkomst | Status |
|---|---|---|---|
| oud | oud | huidig; geen `observation` | bestaand |
| oud | nieuw | accepted; onbekend; geen backfill | ontwerp |
| nieuw, flag off | oud | rij identiek aan oud (geen blok, aggVersion 1) | ontwerp |
| nieuw, flag on | oud | laprow rejected; core-frame/andere rijen accepted; rij uit outbox verwijderd | **bewezen (oude probe)** |
| nieuw, flag on | nieuw | accepted; devicecheck; capture | ontwerp |
| rollback nieuw -> oud | nieuw, flag on | **verboden** zolang een observation-rij in outbox/capture kan zitten | ontwerp |

Rollback is alleen **compatible-reader**: nieuwe reader blijft draaien, flag off, kolom blijft staan, geen destructieve
drop. "Flag off" stopt alleen nieuwe blokken; het leegt geen offline wachtrijen. Naar een pre-observation-reader terug
mag alleen na bewezen lege observation-wachtrijen (quarantaine plus export) of met een reader die het blok
accepteert/negeert. Kolom droppen is geen normale rollback en vereist expliciete GO. Ook een plugin-DLL-rollback is
geen normale rollback zolang observation-rijen in de outbox staan: de oude plugin kent de frozen identiteit niet en kan
een A-rij onder B verzenden. Eerst quarantaine/exporteren of een plugin die het bestand kent.

## 9. Wat de SDK wel/niet levert (geen live probe)
- `GeneratedSessionData.cs:245` bevat `DriverInfo.Drivers[].UserID` (`long`) en `CarIdx`; `:63` heeft
  `WeekendInfo.SubSessionID`. `vars.txt:201` heeft `PlayerCarTowTime` ("being towed if time > 0, s"); `:273`
  heeft `SessionUniqueID`-telemetrie.
- De plugin leest nu `WeekendInfo.SessionUniqueID` (`EnduranceConnectorPlugin.cs:1011`), niet `SubSessionID`; dat is
  een bestaande, niet-veranderde bron en niet dezelfde waarde als de telemetrie-`SessionUniqueID`. `PlayerCarTowTime`
  is een plausibel raw-channel maar **niet aangesloten** en **runtime-unverified**. `UserID` is sessie-YAML, geen
  telemetrienummer; `CarIdx` alleen is geen user-ID; een afgeronde `ReadInt` is geen strikte ID-parse.
- De directe reader kan ruwe telemetrie lezen (`:1755-1786`), maar dat bewijst geen runtimewaarde. Een
  sessie-YAML-lezer voor `UserID` moet die aan de actieve `CarIdx` binden en de freshness bij een driverwissel
  bewijzen; dat is niet gedaan. Geen SSH/netwerk/GUI/SDK-read/build in deze slice en geen nieuw SDK-veld nodig voor
  deze capture-only slice totdat een runtimeprobe het tegendeel bewijst.
- Daarom: geen `resetOrTow` in v1, geen driver-ID uit naam, T10 fuel blijft niet-eligible. `PlayerCarTowTime > 0` zou
  later alleen een positieve tow kunnen bewijzen; `false` vereist nog steeds dekking en een echte trace.

## 10. Minimale bouwslice en tests (PENDING)

| Laag | Bestand | Wijziging |
|---|---|---|
| Validator | `supabase/functions/_shared/simhubExtensions.ts` | `lapKeys` + exacte `parseLapObservation`; afwezig = null; onbekend/versie = rijafwijzing |
| Persist | `supabase/functions/simhub-ingest-v3/persist.ts` | devicecheck, `observation_status`, geen owner uit payload |
| DB | nieuwe migratie | nullable `observation`, `observation_status`, hash-v2, captureprojectie zonder owner, aparte jsonb-cap |
| Producer | `MeasurementEvent.cs` | DTO/`Validate()`; geen driver/reset-afleiding |
| Producer | `LapAccumulator.cs` | per-feitdekking, positieven, geen `false`/`0` |
| Producer | `MeasurementPipeline.cs` | `ObservedSessionId`/`SegmentId` in `LapAggregate` |
| Producer | `MeasurementOutbox.cs` | frozen device/owner/generation, quarantainelijst |
| Producer | `EnduranceConnectorPlugin.cs`, `ConnectorSettings.cs` | snapshot, flag default off, capability |
| Adapter | `src/features/endurance/pitwall/learning/observationV1.ts` | neutrale module (niet T12); geen ownerclaim, geen naam->driver |

Tests, allemaal **PENDING** tot de bouw: C#-unit (geen `false`/`0`, gat, ontbrekend kanaal, pairingwissel, sessiefreeze,
caps); Deno-parser (afwezig, `null`, onbekende subkey, multibyte, 2048-byte grens); Vitest-adapter (afwezig = huidige
blokkades, geen driver-ID uit naam, owner niet inline); SQL (v1-hash identiek, v2 alleen bij blok; zelfde revisie
verschillend blok = `revision_conflict`, capture zonder owner).

## 11. B1-B6-closure

| Punt | Oplossing in dit contract | Restrisico |
|---|---|---|
| B1 naam->driver | `driverNameContinuity` alleen descriptief; geen `driverChanged`-mapping; T10 blijft geblokkeerd | duurzame SDK-identiteit nog niet bewezen |
| B2 80 %/false/0 | geen `false`/`0` in v1; per-feitinterval, edges, `unknownSeconds`, resolution; toekomstige negatieve poort expliciet | negatieve kwalificatie nog niet produceerbaar |
| B3 owner/device | geen owner op wire/P1-item; outbox freeze; server devicecheck + quarantaine; owner alleen `device_owner_at_receipt`/`none` | historische owner blijft onbekend; apart bewijs nodig |
| B4 hash/revisie | v1 ongewijzigd, v2 conditioneel incl. blok;zelfde revisie+ander blok = conflict; geen featureflag | DB-cap en SQL-tests niet uitgevoerd |
| B5 rollback | alleen compatible-reader; flag off leegt geen wachtrij; geen kolomdrop | oude offline clients blijven onbewezen |
| B6 aggregate/schema | sessie/segment freeze in `LapAggregate`; neutrale module; exacte shape/caps | SDK-bron en runtime blijven UNVERIFIED |
## 12. Acceptatie voor deze capture-only slice
- [ ] Server-first: parser accepteert een geldig blok; afwezig/`null`/onbekende subkey/versie gedrag is exact; geen
      whole-frame-fail.
- [ ] Device mismatch: kernrij blijft accepted, blok krijgt `quarantined_device_mismatch`, capture bevat het niet.
- [ ] Geen owner-ID in wire, P1-item of adapterclaim; `owner_basis` blijft `device_owner_at_receipt`/`none`.
- [ ] Geen `false`/`0` in enige producer- of adapterroute; bestaande `pitLap:true`/`fuelAdded>0`/`driverChanged:true`
      blijven staan.
- [ ] Hash v1 byte-identiek voor oude rijen; v2 alleen met blok;zelfde revisie met ander blok is `revision_conflict`.
- [ ] Outbox: A-rij nooit onder B-token; quarantaine zonder stille drop of capaciteitsverlies voor nieuwe B-rijen.
- [ ] Rollback: flag off + reader retained; geen drainclaim, geen kolomdrop.
- [ ] `ObservationV1Enabled=false` default; T10 fuel niet eligible; geen
      productie/DB/Edge/C#-build/UI/publicatie/P3/fitting.
- [ ] Open: SDK-identiteit, reset/tow-bron, negatieve dekking, DB-tests, Vite-build (guard blokkeerde 1 MiB; niet
      omzeild).

**PRODUCTIEWIJZIGING: NEE.**
