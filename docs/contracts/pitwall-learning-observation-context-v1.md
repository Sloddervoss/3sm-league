# T13 — minimale observatiecontext v1 (voorstel, niet geïmplementeerd)

Status: **PROPOSAL**. Geen productiecode, migratie, SDK-verificatie of release.
Baseline `d8127e657e94fdb829d3c07175d4f591738debcc` op
`docs/pitwall-learning-p2-observation-contract`. Input voor contractreview; niets
hier is een gebouwde of geaccepteerde implementatie. `aggregationVersion: 2` en
`observation.version: 1` zijn voorstellen, geen bestaande feiten. SDK-paden zijn
**UNVERIFIED** tenzij code is geciteerd.

## 1. Doel en grens

Lever per afgeronde ronde één optioneel, onveranderlijk `observation`-blok met
alleen bewezen bronfeiten voor brandstofkwalificatie. Geen model, fitting, worker,
DB-schrijfactie, Edge-deploy, UI, pit- of bandenmodel. Pitverlies,
service-uitvoering, compound/regime en wear blijven aparte bronhiaten (§9).
Het blok is **additief** op `lapSummaries[]`, vervangt geen bestaand veld,
wijzigt geen `summaryUid`/`recordRevision`/`contentHash` en wordt nooit bij
verzending uit de actuele frame- of settingsstaat aangevuld.

## 2. Bewezen bronbasis

| Feit | Werkelijke bron | Bewezen gedrag |
|---|---|---|
| Rondevenster/reden | `TelemetrySampler.cs:143-169,251-275` | sluit op sessiewissel, achteruitlopende sessietijd, lapwissel of gat; `startedAt` = eerste sample |
| `pitLap` | `LapAccumulator.cs:297,363-364` | alleen `true` bij `OnPitRoad == true`, anders `null`; nooit `false` |
| Ruw pitkanaal | `EnduranceConnectorPlugin.cs:995` | `OnPitRoad` uit `RawChannelReader.ReadBool`; ontbrekend = `null` |
| `fuelAdded` per ronde | `LapAccumulator.cs:310-317,440-444` | alleen positieve delta wordt opgeteld; waargenomen 0 verdwijnt naar `null` |
| Pitdelta/0 | `PitServiceTracker.cs:293-315` | `before`+`after` vereist; delta ≤ 0,01 L wordt echte `0`, anders `null` |
| Driverwissel | `LapAccumulator.cs:298-303,362` | alleen naamverschil → `true`; gelijke/ontbrekende namen bewijzen geen identiteit |
| Context/sample | `TelemetryContractsV3.cs:280-289`; `LapAccumulator.cs:16-58`; plugin `:961-1001` | frame heeft carId/trackName/trackConfig/trackId; `TelemetrySample` mist car/track/layout/compound/regime |
| Sessietoken | plugin `:1009-1017` | `sim-<uniqueId>-s<num>`; zonder uniqueId is `sim-s0` mogelijk |
| Ownerbinding | `ConnectorSettings.cs:20`; plugin `:1219-1247,1295-1300` | pairing bewaart `DeviceId`+`BoundOwnerUserId`+token onder `_settingsGate`; unpair wist beide |
| P1-archief | migratie `20261111163052…:905-960` | expliciete kolomprojectie; `current_driver_name/id` en `note` niet gecaptured |
| Rijhash | migratie `20261031200500…:75-100` | md5 over vaste velden; nieuwe velden vallen buiten de hash, dus eenzelfde-revisiecollisie is mogelijk |
| Oude receiver | `simhubExtensions.ts:66-68,646-680` | onbekende sleutel **binnen** een laprow is een rijafwijzing |
| Rijafwijzing | `MeasurementOutbox.cs:401-411` | afgekeurde rij wordt definitief uit de outbox verwijderd, met reden/teller |
| T10-poort | `quality.ts:778-818` | fuel vereist `pit_lap`, `driver_changed`, `reset_or_tow` bewezen false en `fuel_added` expliciet 0 |
| T09-eisen | `context.ts:120-129` | fuel blokkeert op owner, driver, device, car, track, layout |

## 3. Wat de bestaande bron werkelijk kan vullen

| Dimensie | Bewijsbaar bij waarneming | Niet bewijsbaar |
|---|---|---|
| `pitRoad` | rauw kanaal aanwezig op elke tick, geen `true` | kanaal ontbreekt of gat > drempel |
| `refuel` | volledige fuelbedekking + geen positieve stap + bezoekdelta 0 | fuelkanaal ontbreekt, bezoekdelta onbekend |
| `driverContinuity` | niet-lege naam op elke tick, exact gelijk | duurzame driver-ID; gelijke namen |
| `resetOrTow` | **nee** in huidige code | elke `false` zonder bewezen kanaal |
| `car/track/layout` | per tick constant uit frame | wijziging/missing tijdens ronde |
| `owner/device` | declaratie uit pairing-snapshot | servergeverifieerde historie; oude outbox |
| `compound/regime` | nee in `TelemetrySample` | apart bronhiaat |
| `observedSession` | onderdeel-id's uit SDK | sterke globale sessie-identiteit |

`driverContinuity` is continuïteit van de waargenomen naam, geen driveridentiteit.
`player.Id`/`currentDriverId`-semantiek is UNVERIFIED en wordt niet als
iRacing-user-ID gebruikt. Numerieke strings worden niet gerepareerd.

## 4. Wire-voorstel (exact)

Pad `payload.lapSummaries[i].observation`. Optioneel; afwezig = alle feiten
onbekend (oude producer). Geen `null` binnen het blok: een feit is aanwezig en
bewezen, of afwezig en onbekend. Onbekende subsleutel = rijafwijzing, net als
elders. `version` verplicht `1`; andere waarde = `observation_version_unsupported`.
Blokcap 2048 bytes.

```json
{"observation":{
  "version":1,
  "window":{"firstSampleAt":"2026-11-12T10:00:00.000Z","lastSampleAt":"2026-11-12T10:01:59.000Z","samples":120,"maxGapSeconds":1.2},
  "pitRoad":{"value":false,"samples":120,"maxGapSeconds":1.2,"coveredSeconds":118.8},
  "refuel":{"value":0,"samples":120,"maxGapSeconds":1.2,"basis":"no_positive_step"},
  "driverContinuity":{"value":"unchanged","samples":120},
  "context":{"carId":"1321","trackId":42,"trackName":"Circuit de Spa-Francorchamps","trackConfig":"Endurance",
    "deviceId":"11111111-1111-4111-8111-111111111111","ownerUserId":"22222222-2222-4222-8222-222222222222",
    "ownerBasis":"pairing_binding_snapshot","sessionUniqueId":987654,"sessionNumber":0,"samples":120,"maxGapSeconds":1.2}
}}
```

Typen/caps: tijden gezoneerde ISO-instant, `first >= startedAt`, `last <= endedAt`;
`samples` 1..1.000.000; `maxGapSeconds`/`coveredSeconds` 0..86.400;
`refuel.value` 0..300; `driverContinuity.value` ∈ {`unchanged`,`changed`};
`trackId` 1..2147483647; `sessionUniqueId`
0..2147483647; `sessionNumber` 0..1000; strings 1..128 zonder controls; `carId`
raw SimHub-string. `resetOrTow` is gereserveerd maar nog niet uitzendbaar: de
basis-allowlist is leeg tot een echte trace. Een blok zonder minstens één feit
(`pitRoad`, `refuel`, `driverContinuity` of `context`) wordt niet uitgezonden.
Legacy-mapping (één bron van waarheid): `pitRoad.value:false` → `pitLap:false`;
`refuel.value:0` → `fuelAddedLitresObserved:0`;
`driverContinuity:"unchanged"` → `driverChanged:false`; `"changed"` →
`driverChanged:true` zonder `currentDriverName`. Ontbrekend feit → veld
weglaten (blijft `null`). `aggregationVersion` = 2 zodra `observation` aanwezig
is, anders 1; oude rijen blijven byte-identiek. `complete`/`coverage` blijven de
bestaande dekkinsregels.

## 5. Wie bevriest wat, wanneer

- **Lapstart** (`TelemetrySampler.StartLap`): eerste sample zet `window.firstSampleAt`,
  `context`-startwaarden en de pairing-snapshot (`DeviceId`, `BoundOwnerUserId`,
  lokale bindingsgeneratie) onder `_settingsGate`; de generatie gaat **niet** over de draad.
- **Elke tick**: `lastSampleAt`, `samples`, `maxGapSeconds`; ontbrekende of
  tegenstrijdige waarneming maakt dat feit definitief onbekend.
- **Rondeclose**: `LapAccumulator.Close` schrijft het blok één keer; daarna alleen
  serialisatie. Outbox bewaart `RowJson` letterlijk (`MeasurementOutbox.cs:20-34`).
- **Sessie/segment**: `LapAggregate` krijgt zijn eigen `observedSessionId` bij
  `StartLap`; `EnqueueSummary` (`:235-241`) gebruikt niet de actuele sessie van later.
- **Pairingwissel**: pair/unpair verhoogt de lokale generatie; wijkt die of
  `DeviceId`/`ownerUserId` bij close af, dan vervalt dat contextfeit. Oude
  outboxrijen worden nooit herschreven en dragen hun eigen bevroren waarden; na
  pair A→B blijft een A-rij dus A-waarden houden en de mismatch is zichtbaar,
  maar er is geen sessie- of ownerbackfill.
- **Laatste frame**: nooit. Geen `currentSnapshot`, latest identity,
  observed-session-backfill of herberekening van oude hashes.

## 6. False/0-regels (geen "afwezigheid van tegenspraak")

Algemeen: `false`/`0` alleen als het feit aanwezig is én de dekking aantoonbaar
volledig. Ontbrekende dekking, gat, ontbrekend kanaal of onbekende bezoekdelta →
feit weglaten. `window.samples >= 10`, `maxGapSeconds <= 2`,
`coveredSeconds >= 0,8 × (last-first)` gelden voor elk feit dat `false`/`0` claimt.
Een observerregel is pas geldig na een **positieve** controle op een echte of
frozen trace: dezelfde regel moet op een bekende pitronde `true` en op een
normale ronde `false` geven. Alleen "geen `true` gezien" is geen validatie; die
controle is hier nog niet uitgevoerd, dus de capability blijft default off.

- **pitRoad=false**: kanaal op *elke* tick (`feit.samples == window.samples`), nul
  `true`; één ontbrekende tick → onbekend. `true` vereist ≥1 `true`-waarneming.
- **refuel=0**: `coverage.fuel` voldoet aan de bestaande P1-regels,
  `refuel.samples == coverage.fuel.sampleCount`, elke opeenvolgende fuelwaarde
  aanwezig, geen stap > 0,01 L, en elk rakend pitbezoek heeft delta `0` of er is
  geen bezoek. `fuel_delta_unobserved` → onbekend.
- **driverContinuity=unchanged**: niet-lege naam op elke tick, exact ordinal
  gelijk (na `Trim`), `samples == window.samples`; dit zegt niets over een
  duurzame driver-ID.
- **resetOrTow**: geen bestaande bron. `session_time_reset` is een close-reden,
  geen tow-bewijs; `false` hieruit afleiden is verboden. Kandidaatkanalen
  (`PlayerCarTowTime`, `IsOnTrack`, `SessionState`) zijn **UNVERIFIED** en mogen
  pas na een frozen trace + capability een basis krijgen.
- **context**: dimensie alleen aanwezig als elke tick dezelfde niet-lege waarde
  had; `context.samples == window.samples`. Owner/device vereisen dezelfde
  bindingsgeneratie bij start en laatste tick. `trackName`/`trackConfig` ruw
  bewaren (geen trim/casefold); canonieke mapping expliciet in de adapter:
  `iracing-track:<trackId>`, `iracing-trackconfig:<trackId>:<exacte trackConfig>`,
  `simhub-car:<raw carId>`. `driverCarIdx` wordt nooit als user-ID gemapt.

## 7. Compatibiliteit (werkelijk parsergedrag)

Bewezen met `probe-old-receiver.ts` tegen de echte `parseLapSummariesReport`:
oude rij = 1 accepted/0 rejected; dezelfde rij met `observation` = 0/1 met
`contains unknown fields`; een onbekende **root**key wordt geaccepteerd en
genegeerd (556 chars). De parser keurt dus de laprow af, niet het frame; de
outbox verwijdert die rij definitief (`MeasurementOutbox.cs:401-411`).

| Producer | Receiver | Uitkomst | Status |
|---|---|---|---|
| oud | oud | huidig gedrag; `observation` afwezig | huidig |
| oud | nieuw | accepted; alle feiten onbekend; geen backfill | verwacht |
| nieuw, feature off | oud | rij identiek aan oud (geen `observation`, aggVersion 1) | ontwerp |
| nieuw, feature on | oud | laprow rejected (`contains unknown fields`), core-frame + andere rijen accepted, rij uit outbox verwijderd | **bewezen (probe)** |
| nieuw, feature on | nieuw | accepted, opgeslagen, gecaptured | ontwerp |
| nieuw, feature off | nieuw | als oude producer; onbekend | ontwerp |
| rollback nieuw→oud | nieuw feature on | laprows gaan verloren; eerst flag off, outbox drainen, dán serverrollback | ontwerp |

Server-first is verplicht: kolom nullable, parser additief, feature-flag default
`false`, geen verplichte rootkey, geen whole-frame-reject. Er wordt **geen**
arbitraire oude-servercompatibiliteit geclaimd. Autoupdater/ACK-contract blijft:
20 events/3 laps/16.384 meetbytes/24.576 body; de planner stelt niet-passende
rijen uit (`MeasurementFrame.cs:69-137`). Synthetische meting
(`probe-payload-budget.ts`): 3 rijen 2.756 → 4.490 bytes (+1.734), headroom
11.894; 20 events kunnen alsnog tot deferral leiden.

## 8. Minimale samenhangende bouwslice

| Laag | Wijziging |
|---|---|
| Producer | `TelemetrySample` krijgt car/track/layout/sessiecomponenten + onveranderlijke bindingssnapshot; `LapAccumulator` houdt per feit dekking bij en bouwt `observation`; `MeasurementEvent.cs` krijgt `MeasurementLapObservationV1Dto` + `Validate()`; plugin vult sample/snapshot; `MeasurementPipeline` bevriest sessie/segment per aggregate; `ConnectorSettings.ObservationV1Enabled=false`; capability `observationV1:1` alleen bij aan. |
| Validator | `simhubExtensions.ts`: `lapKeys` + `parseLapObservation` met exacte keys/typen/caps; onbekende subsleutel/versie → rijafwijzing; afwezig → null. |
| DB | Nieuwe migratie: `simhub_lap_summaries.observation jsonb` nullable + CHECK (object, `pg_column_size <= 2048`); `simhub_persist_measurement_batch` neemt het veld over; `simhub_lap_row_hash` én alle bestaande hash-callsites voegen `observation` **alleen toe als niet-null** (legacy-hash identiek, geen backfill); nieuwe capturetriggers projecteren `n.observation`; P1-migratie blijft bevroren. |
| Adapter | `src/features/endurance/pitwall/learning/observationV1.ts` (T12-gebied, apart reviewen): mapt `observation` naar T10-annotaties en T09-claims; weigert context als `deviceId` niet aan de source-envelope hangt; claimt nooit een driver-ID uit een naam. Zonder blok: exact de huidige blokkades (probe: 10 redenen). |
| Tests | C#-unit: false/0-regels, ontbrekend kanaal, gat, driverwissel, pairingwissel, session/segment-freeze, caps; Deno: parser + bytebudget; Vitest: adapter + T10 met/zonder blok; SQL: legacy-hash vóór/na gelijk, capture bevat `observation`, oude rijen ongewijzigd. |

Rollback: feature-flag off (oude rijen), daarna migratie-down pas nadat alle
writers uit zijn; kolom drop is destructief en vereist expliciete GO. Geen
bestaande hash of archive-payload herschrijven.

## 9. Wat dit niet oplost

- **Driveridentiteit**: geen bewezen duurzame SDK-ID; `player.Id`/`CarIdx` is
  UNVERIFIED en naamresolutie is geen observatie. T09 `driver` blijft onbekend en
  T10 fuel **niet eligible**, ook met een perfect observation-blok.
- **Reset/tow**: geen kanaal; `false` is niet produceerbaar, dus T10 blijft
  `reset_or_tow_unknown`.
- **Owner**: pairing is een producerdeclaratie, geen servergeverifieerde historie;
  accountoverschrijdend leren vereist een aparte beleidsbeslissing.
- **Pit/tyres**: service-uitvoering en netto pitverlies vereisen surveyankers;
  compound/regime/wear vereisen eigen bronnen. Niet hier opgelost.
- **Sessie**: `sim-s0` blijft zwak; dit contract bindt op UID/hash/device/segment.

## 10. Acceptatiechecklist (voor de bouw, niet nu)

- [ ] 3 probes exit 0: oude rij accepted, geneste observatie rejected, rootkey
      bounded; T10-blokkades exact; 3 rondes < 16.384 bytes.
- [ ] Geen `false`/`0` zonder feit + dekking + basis; tests voor ontbrekend
      kanaal, gat, onbekende bezoekdelta en reset/tow; **positieve** pit/normale-
      ronde-controle op een echte of frozen trace vóór activatie.
- [ ] Legacy-hash en oude archive-payload byte-identiek; geen backfill.
- [ ] Oude receiver: alleen laprow rejected, frame/andere rijen + ACK intact;
      feature-flag default off en server-first bewezen.
- [ ] Capture bevat `observation`; oude rijen en `current_driver_name`-gedrag
      ongewijzigd; geen extra triggerquery/timingexperiment.
- [ ] Adapter: observation afwezig → huidige blokkades; aanwezig → alleen
      bewezen velden; nooit driver-ID uit naam; context mismatch → onbekend.
- [ ] Rollback: flag off → drain → migratie-down; geen data-rewrite.
- [ ] Contractreview GO vóór enige producer/DB-code; net48/build/updater blijven
      een aparte poort.

**PRODUCTIEWIJZIGING: NEE.**
