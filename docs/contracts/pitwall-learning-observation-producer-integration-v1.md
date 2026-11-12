# T13 — producer/outbox bronkaart en afgebakend inpassingscontract v1

Status: **DOCS-ONLY BRONONDERZOEK. GEEN PRODUCER, GEEN OUTBOXWIJZIGING, GEEN
RELEASE.** Basis: `1d3a7ef8c39daa1c00f6e6cc974d88b11c590f39` op
`docs/pitwall-learning-p2-producer-source`. De geaccepteerde T13-S1-serverkant
(`58820eed28b6e80c420fe952c20b27f348a39a6b`) en het observationcontract
(`docs/contracts/pitwall-learning-observation-context-v1.md`, 239 regels) zijn
ongewijzigd. Dit document is de bronkaart voor de **volgende lokale bouw**, niet
die bouw en niet een publicatie- of versiebesluit.

Bewijsroot (0700): `/home/hermes/artifacts/3sm/pitwall-learning-p2-producer-source/`.

## 0. Grens, bewijsstatus en niet-claims

- Alleen repository-leeswerk en artifact-only probes. Geen functionele code,
  project-, package-, updater-, versie-, vlag- of broncontractwijziging; geen
  DB/network/SSH/GUI/Windows-write, DDL, build-DLL-install of `release.sh`.
- De C#-proeven hieronder compileren **de echte bestaande bron** met de lokale
  Roslyn-compiler en draaien de bestaande `DiagnosticsTests`. Ze zijn geen
  SimHub- of iRacing-runtimebewijs. Fixtures zijn synthetisch en als zodanig
  gelabeld.
- `dotnet build --no-restore` op het testproject is **NIET UITGEVOERD als
  projectsbuild**: er is geen `obj/project.assets.json` en zonder restore stopt
  MSBuild met `NETSDK1004`. Er is geen restore, geen install en geen
  toolchainfabricatie gedaan. De gebruikte directe `csc`-compilatie is een
  artifact-only harnas, geen vervanging voor de projectsbuild.
- De al bewezen bron-gaten (oude laprij heeft geen observation, geen
  historische context, `pit_lap=false`/`driver_changed=false` worden bron-side
  null) worden hier niet opnieuw onderzocht. Zie
  `docs/contracts/pitwall-learning-source-map.md` §3.3, §4.1, §4.2 en §9.
- **Geen** owner op de draad, geen driveridentiteit, geen reset-/tow-feit, geen
  negatieve `pitRoad:false` of `refuel:0`, geen volledigheidsclaim, geen
  productieapply, geen Edge-deploy en geen SDK-waarheid.
- Het geaccepteerde observationcontract noemt producer, outbox, Edge-deploy en
  productieapply als **aparte GO** (regel 237). Dit document blijft aan de
  bronkant en implementeert geen van die vier.

## 1. Kort oordeel

De bestaande meetlaag is een bruikbare basis, maar de producer kan **niet
ongewijzigd** een geldig observation-blok leveren. De kleinste bouw heeft zes
concrete gaten:

1. `MeasurementLapSummaryDto`/`MeasurementLapSummaryRecord` hebben geen
   `observation`-lid; de serializer kan het blok dus niet dragen.
2. `LapAccumulator` houdt geen totaal aantal samples, geen all-sample max-gap,
   geen eerste pitroad-tijd en geen positieve brandstofstappen bij. De bestaande
   coverage-tellers zijn per groep en niet het observation-interval.
3. `ObservedSessionId` wordt bij **flush** uit de pipeline-globale waarde gezet,
   niet bij `StartLap`; car/track-context zit helemaal niet in het meetmonster.
4. `OutboxEntry` heeft geen lokale capture-binding (device/owner/generatie) en
   geen observation-markering; een na een accountwissel verzonden oude rij kan
   niet lokaal geïsoleerd worden.
5. `ApplySeries` verwijdert een afgekeurde rij, ongeacht de reden. Een
   `observation_unavailable`- of rollback-afwijzing wordt daardoor een
   getelde maar niet-bewaarde drop (bewezen: probe P08).
6. Er is geen observation-quarantaine met 64 entries/1 MiB, immutable
   `RowJson`/raw observation/reden en zichtbare retentie/evictie/overflow.

Voor de **kern** van het blok is geen onbewezen SDK-veld nodig: device/owner
komen uit de pairingresponse, car/track uit de bestaande frame-identiteit,
pit/fuel/naam uit de bestaande meetmonsters. `SubSessionID`, `UserID` en
`PlayerCarTowTime` zijn lokale research alleen; ze worden niet gebruikt en niet
als bewezen bron verkocht.

## 2. Echte bronkaart

### 2.1 Identiteit en apparaat

| Noodzaak | Bestaande lokale bron | Herkomst | Status vandaag | Kleinste inpassing |
|---|---|---|---|---|
| `capture.deviceId` | `ConnectorSettings.DeviceId` (`ConnectorSettings.cs:16`), gezet uit `PairingResponse.DeviceId` (`TelemetryContracts.cs:71-77`, plugin `EnduranceConnectorPlugin.cs:1233`) | Server-issued device-UUID uit de pairingresponse | **aanwezig**; geen lokale freeze, geen outboxmetadata | Bij `StartLap` `DeviceId` + `BoundOwnerUserId` + lokale generatie vastleggen; alleen bij complete binding observation maken |
| owner (lokaal, nooit op de draad) | `ConnectorSettings.BoundOwnerUserId` (`:20`), gezet uit `PairingResponse.OwnerUserId` (`:1236`) | Server-issued owner-UUID uit de pairingresponse | **aanwezig**; alleen voor `IsPaired` | Lokale `CaptureOwnerUserId` op de outbox-entry; nooit serialiseren |
| apparaatnaam / connector | `ConnectorSettings.ConnectorId` (`:29`, default `Environment.MachineName`), verstuurd als `PairingRequest.ConnectorId`/`DeviceName` (`EnduranceConnectorPlugin.cs:1193-1199`) | MachineName, geen serveridentiteit | **aanwezig maar niet identiek** aan `DeviceId` | Niet als `capture.deviceId` gebruiken |
| servercontrole | `GET /simhub-control` (`ConnectorControlClient.cs:62-124`) | Alleen beleid: frequentie, budget, features | **geen apparaat-/owneridentiteit**; `KnownFeatures` (`ConnectorControlContracts.cs:101-106`) kent geen `observation` | Niet als identiteitsbron gebruiken; server-first deploy blijft nodig |
| huidige simrijder | `V3Identity.CurrentDriverId`/`CurrentDriverName` (`TelemetryContractsV3.cs:280-289`), uit `player.Id` en `snapshot.PlayerName` (`EnduranceConnectorPlugin.cs:1490-1491`) | SimHub/iRacing, geen 3SM-user | **aanwezig**, maar **geen owner** | Alleen naam voor continuïteit; nooit driver-ID of owner op de draad |

De drie identiteiten zijn dus strikt gescheiden:

```
server device-UUID  = Settings.DeviceId            (pairingresponse)
server owner-UUID   = Settings.BoundOwnerUserId    (pairingresponse)
connector/naam      = Settings.ConnectorId / MachineName
simrijder           = V3Identity.CurrentDriverId  (iRacing/SimHub)
```

`IsPaired` (`EnduranceConnectorPlugin.cs:129`) eist token + `DeviceId` +
`BoundOwnerUserId`, maar bewijst niet dat het token bij dat device hoort. De
server is de enige autoriteit; de producer moet de binding alleen **lokaal
bevriezen** en nooit een token/device-relatie verzinnen.

### 2.2 Sessie, segment en context

| Noodzaak | Bestaande lokale bron | Herkomst | Status vandaag | Kleinste inpassing |
|---|---|---|---|---|
| `observedSessionId` (bestaand rijveld) | `BuildObservedSessionId` (`EnduranceConnectorPlugin.cs:1009-1018`): `WeekendInfo.SessionUniqueID` via property-pad + `SessionNum`-kanaal | SimHub-property + ruw kanaal | **aanwezig**, maar de string wordt bij flush uit de pipeline-globale waarde gezet (`MeasurementPipeline.cs:235-242`); niet bij `StartLap` | `ObservedSessionId` in `LapAccumulator` bij `StartLap` (`TelemetrySampler.cs:260-267`) bevriezen en in `LapAggregate`/`ToSummary` gebruiken |
| `context.sessionUniqueId` | Zelfde `GetNullableInt("…WeekendInfo.SessionUniqueID")` (`:1011`), maar alleen in de string verwerkt | SimHub-property | **alleen als string/afgeleide**, niet als numerieke waarde bewaard; **runtime aanwezigheid niet vastgelegd** | Numerieke waarde apart lezen en bij `StartLap` bevriezen; `null` = weglaten. Nooit uit `sim-s0` parsen |
| `context.sessionNumber` | `RawChannelReader.ReadInt("SessionNum", 0, 1000)` (`:1012`) | Ruw iRacing-kanaal via SimHub | **aanwezig**, niet bewaard in het meetmonster | Bij `StartLap` bevriezen; `null` = weglaten |
| `context.carId` | `snapshot.CarId` → fallback `Settings.CarIdProperty` (`EnduranceConnectorPlugin.cs:1492`), `V3Identity.CarId` (`TelemetryContractsV3.cs:284`) | SimHub GameData / configuratie | **aanwezig in frame**, niet in `TelemetrySample`/laprow | Aan het meetmonster toevoegen en bij `StartLap` bevriezen |
| `context.trackId` | `TrackIdentityReader.Read` (`TrackIdentityReader.cs:10-22`), reflectie op `WeekendInfo.TrackID`; gebruikt op `:1571` | iRacing-sessieboom via SimHub-snapshot | **aanwezig in frame**; runtime aanwezigheid niet vastgelegd | Bij `StartLap` bevriezen; alleen `int > 0` |
| `context.trackName` / `trackConfig` | `snapshot.TrackName`/`TrackConfig` → fallback settings (`:1494-1495`) | SimHub GameData / configuratie | **aanwezig in frame**, niet in meetmonster | Bij `StartLap` bevriezen; leeg/ontbrekend = context weglaten |
| segment | `MeasurementIdFactory.NewSegmentId()` via `MeasurementPipeline.BeginSession` (`:83-91`); `LapAccumulator` krijgt het segment bij `StartLap` (`TelemetrySampler.cs:263-264`) | Lokaal segment | **al bij start bevroren** in de accumulator; `LapAggregate.SegmentId` (`LapAccumulator.cs:361`) | Geen wijziging nodig; wel testen dat flush het oude segment houdt |

`sim-s0` is een **zwakke** sessieaanduiding: alleen `SessionNum` zonder
`SessionUniqueID`. Die mag nooit als sterke `sessionUniqueId` worden
geparseerd of als bewijs van een unieke sessie gelden. `observedSessionId`
(bestaand rijveld) en `context.sessionUniqueId` (optioneel contextveld) zijn
verschillende dingen; het eerste is een string, het tweede een numerieke
SDK-waarde of afwezig.

### 2.3 Meten per ronde

| Noodzaak | Bestaande lokale bron | Herkomst | Status vandaag | Kleinste inpassing |
|---|---|---|---|---|
| eerste sampletijd | `LapAccumulator.StartedAtUtc` (`LapAccumulator.cs:237`), gezet uit de eerste geaccepteerde tick (`TelemetrySampler.cs:263`) | `DateTime.UtcNow` per tick | **aanwezig** | Direct bruikbaar als `firstSampleAt` |
| laatste sampletijd | `LapAccumulator.LastSampleUtc` (`:238`), bijgewerkt in `Add` (`:305-306`) | idem | **aanwezig** | Direct bruikbaar als `lastSampleAt` |
| `samples` | Alleen coverage-tellers per groep (`CoverageTracker`, `LapAccumulator.cs:93-131`; `SampleCount` per groep in `:380`) | Afgeleide per groep | **niet als totaal aanwezig**; groepen kunnen verschillen | Aparte `_acceptedSamples`-teller in `LapAccumulator.Add` |
| `maxGapSeconds` (alle samples) | `CoverageRules.MaxGap` (`MeasurementEvent.cs:660-669`) is het maximum over de drie **groeps**-gaps | Afgeleide per groep | **niet het observation-interval**; een groep zonder kanaal verbergt een gat | All-sample gap bijhouden in `LapAccumulator.Add` |
| `unknownSeconds` / edges | Geen bestaand veld | Afgeleide | **ontbreekt** | Uit `firstSampleAt`, `lastSampleAt`, `endedAt` en all-sample `maxGap` afleiden; alleen de contract-ondergrens |
| `pitRoad.value=true` | `TelemetrySample.OnPitRoad` (`LapAccumulator.cs:44`), gevuld uit ruw `OnPitRoad` (`EnduranceConnectorPlugin.cs:995`, `:1548`); `_pitLap` (`LapAccumulator.cs:297`) | Ruw kanaal, met SimHub-property als vangnet (`CaptureValueRules.OnPitRoad`, `CaptureValueRules.cs:88-92`) | **positieve waarde aanwezig**; `false` wordt al null (`LapAccumulator.cs:364`) | `firstAt` van de eerste `OnPitRoad==true` bijhouden; nooit `false` emitteren |
| `refuel` | `TelemetrySample.FuelLitres` (`:31`), uit `CaptureValueRules.FuelLitres` (`CaptureValueRules.cs:28-35`) en `:999`; netto pitdelta in `PitResult.FuelAddedLitresObserved` (`PitServiceTracker.cs:91`, berekend `:293-316`) | Ruw brandstofniveau / netto bezoekdelta | **niveau aanwezig; netto delta niet geschikt** (mist partiële stappen, kan verbruik aftrekken) | Positieve stappen tussen opeenvolgende bekende samples in dezelfde sessie/segment bijhouden; som alleen positieve stappen |
| `driverNameContinuity` | `LapAccumulator.FirstDriverName` (`:200`, `:232`) en `_driverChanged` (`:298-303`); `DriverChanged` (`:363`) | SimHub-naam | **deels aanwezig**; lege namen worden genegeerd en de groep kan niet "onbekend" worden | Flag bijhouden of enig geaccepteerd sample een lege naam had; dan groep weglaten |
| rondevenster | `LapAccumulator.Close` (`:333-387`), `CoverageRules.Evaluate` (`MeasurementEvent.cs:688-722`) | Lokaal | **aanwezig** | Geen wijziging; observation gebruikt hetzelfde venster |

De bestaande `coverage`- en `sampleCount`-velden zijn **geen** vervanging voor
het observation-interval. Ze zijn per metriekgroep, tellen alleen die groep en
kunnen onderling verschillen. Het observation-interval gaat over alle
geaccepteerde samples van de ronde.

### 2.4 Outbox en ACK

| Noodzaak | Bestaande lokale bron | Status vandaag | Kleinste inpassing |
|---|---|---|---|
| rij + UID + revisie | `OutboxEntry` (`MeasurementOutbox.cs:20-34`), `Enqueue` (`:211-231`), `EnqueueLap` (`:241-260`) | **aanwezig**; `RowJson` wordt één keer bij enqueue geserialiseerd | Uitbreiden met lokale observation-/bindingsmetadata; `RowJson` blijft ongewijzigd |
| persistente wachtrij | `OutboxFileDto` (`:144-155`), `Load` (`:503-539`), `Restore` (`:541-571`), `SaveLocked` (`:579-627`) | **aanwezig**; versie 1, atomaire replace, 512 KiB-grens | Versie 2 additief; v1-rijen zonder metadata als legacy laden |
| restart | `InitMeasurementLayer` (`EnduranceConnectorPlugin.cs:876-899`), `Load` (`:883`) | **aanwezig**; dezelfde UID/RowJson komen terug | Quarantaine ook laden; binding en observation-status mee herstellen |
| drain/plan | `Due` (`MeasurementOutbox.cs:295-314`), `MeasurementFramePlanner.Plan` (`MeasurementFrame.cs:74-122`), `SendAsync` (`:253-359`) | **aanwezig**; 3 laps/20 events/16.384 B en 24.576 B body | Observation-rijen met afwijkende binding uit de batch filteren; niet stil strippen |
| ACK per rij | `MeasurementAckParser.Parse` (`MeasurementOutbox.cs:681-722`), `ApplyAck` (`:323-362`), `ApplySeries` (`:364-413`) | **aanwezig**; accepted/duplicate/superseded verwijderen, `stored:false` houdt alles | Afwijzingsreden classificeren; observation-afwijzing niet als delivery/drop |
| afgekeurde rij | `ApplySeries` (`:401-412`) | **verwijdert de rij**, telt `RejectedLaps` en bewaart alleen `LastRejectionReason` | Voor observation-rijen: exacte `RowJson` naar quarantaine, niet verwijderen; legacy-rijen ongewijzigd |
| backoff | `MarkAttempt` (`:460-487`) | **aanwezig**; 2–60 s, max pogingen optioneel | Quarantaine/overflow eigen tellers geven; geen oneindige retry van een blijvend geweigerde observation |
| corrupt bestand | `Quarantine()` (`:649-660`) | **alleen hele-bestand-kopie** | Niet hergebruiken als observation-quarantaine |

## 3. Veldkaart voor `payload.lapSummaries[i].observation`

De vorm is die van `ObservationV1` (`supabase/functions/_shared/observationV1.ts:103-132`).
Toegestane rootkeys: `version`, `capture`, `interval`, `pitRoad?`, `refuel?`,
`driverNameContinuity?`, `context?`. `version`, `capture` en `interval` zijn
verplicht; minstens één feitgroep moet aanwezig zijn.

### 3.1 `capture`

| Wireveld | Bestaande bron | Inpassing | Runtimebewijs |
|---|---|---|---|
| `capture.deviceId` | `Settings.DeviceId`, server-UUID uit pairing | UUID-formaat eerst; bij `StartLap` bevriezen; alleen emitteren bij complete binding | Pairingcontract, geen live meting nodig |

### 3.2 `interval` (7 stats)

| Wireveld | Regel | Bestaande bron | Status |
|---|---|---|---|
| `firstSampleAt` | ISO-UTC, 3 decimalen, binnen rijvenster | `StartedAtUtc` | **beschikbaar** |
| `lastSampleAt` | idem, `>= first` | `LastSampleUtc` | **beschikbaar** |
| `samples` | integer 1..1.000.000; `samples==1` ⇒ `first==last` en `maxGap==0`; `samples>1` ⇒ `last>first` | nog geen totaal | **lokale plumbing** |
| `maxGapSeconds` | max gap tussen opeenvolgende geaccepteerde samples binnen `[first,last]` | alleen per groep | **lokale plumbing** |
| `unknownSeconds` | conservatieve ondergrens: `>= edgeBefore+edgeAfter`; bij `maxGap>1,0` ook `+maxGap`; `<= venster` | geen | **lokale plumbing** |
| `edgeBeforeSeconds` | `firstSampleAt - startedAt`; bij deze producer is de eerste tick de start, dus **0** | `StartedAtUtc` | **afgeleid, 0** |
| `edgeAfterSeconds` | `endedAt - lastSampleAt`, begrensd op 0 | `EndedAtUtc`, `LastSampleUtc` | **lokale plumbing** |

`unknownSeconds` is een ondergrens, geen volledigheidsclaim. De producer mag
geen "0" als "complete ronde" presenteren; 0 betekent alleen "geen getelde
gap boven de drempel/geen edge".

Alle observation-tijden worden met `MeasurementTime.WireFormat`
(`MeasurementIds.cs:198-205`) als UTC met exact drie decimalen geschreven:
`yyyy-MM-dd'T'HH:mm:ss.fff'Z'`. Er is geen lokale tijd, geen offset en geen
`Date.parse` in het productiepad. Ontbrekende tijd = groep weglaten; geen
`DateTime.MinValue` of `0` als tijd.

### 3.3 `pitRoad`

| Wireveld | Regel | Bestaande bron | Status |
|---|---|---|---|
| `value` | **alleen `true`**; `false`/`0` is een rijafwijzing | `_pitLap`/`OnPitRoad==true` | **positief beschikbaar** |
| `firstAt` | eerste sample met `OnPitRoad==true`, binnen interval | nog niet bewaard | **lokale plumbing** |

Geen enkel pad mag `pitRoad:false` produceren. Ontbreekt een `OnPitRoad`-waarde,
dan is dat "onbekend", niet "niet op de pitstraat"; de groep wordt dan
weggelaten.

### 3.4 `refuel`

| Wireveld | Regel | Bestaande bron | Status |
|---|---|---|---|
| `observedAddedLitres` | **>0 en <=300**; som van waargenomen positieve stappen, geen netto totaal | ruw `FuelLitres` | **lokale plumbing** |
| `firstAt` | tijd van de eerste positieve stap, binnen interval | geen | **lokale plumbing** |
| `positiveSteps` | integer 1..10.000 | geen | **lokale plumbing** |
| `resolutionLitres` | 0,001..1; **gedeclareerde wire-korrel**, niet een bewezen sensorresolutie | bestaande 3-decimalenafronding (`PitServiceTracker.cs:313-315`) | **declareren als 0,001** |
| `maxUndetectedLitres?` | optioneel; alleen als bewezen; `null` ongeldig | geen | **weglaten (UNKNOWN)** |

Een positieve stap mag **niet** over een onbekend sample, een segmentwissel,
een sessiewissel of een auto-/contextwissel heen worden berekend. `null` in
`FuelLitres` breekt de keten; de volgende bekende waarde start een nieuwe
keten. Een daling is geen negatieve brandstofficht en wordt niet van de som
afgetrokken. De netto `PitResult.FuelAddedLitresObserved` is **niet** de bron
voor dit veld. Een stap telt alleen als de delta na de gedeclareerde
3-decimalenkorrel ten minste 0,001 L is; kleinere ruis wordt niet als stap
geteld.

`refuel` wordt niet van `pitRoad` afgeleid: het is een waargenomen positieve
brandstofstap, niet "de auto stond in de pit". De twee groepen zijn
onafhankelijk. Een `FuelLitres`-nul is een geldige niveauwaarde maar geen
refuel-stap; een ontbrekende `OnPitRoad`-waarde wordt geen `false`.

### 3.5 `driverNameContinuity`

| Wireveld | Regel | Bestaande bron | Status |
|---|---|---|---|
| `value` | alleen `"unchanged"` of `"changed"`; descriptief, **geen** rijderidentiteit | `FirstDriverName` + `_driverChanged` | **deels; lege-naamflag toevoegen** |

- alle niet-lege namen gelijk ⇒ `unchanged`;
- alle niet-leeg en minstens één verschilt ⇒ `changed`;
- ontbreekt/leeg bij één geaccepteerd sample ⇒ **groep weglaten**.

Nooit `currentDriverId`, `UserID`, owner of een account-ID gebruiken. Een
displaynaam-fallback uit `snapshot.PlayerName` is nog steeds alleen een naam,
geen identiteit.

Bestaande fallbacks worden niet opgewaardeerd tot observed facts: een
displaynaam blijft een naam (geen rijderidentiteit), een ontbrekende
`OnPitRoad` blijft onbekend (geen `false`), en een gemeten brandstofniveau van
`0` is geen refuel-stap en geen "geen brandstof toegevoegd"-claim. Alleen de
positieve waarneming gaat de observation in; het ontbreken van een waarneming
wordt niet als negatieve waarheid op de draad gezet.

### 3.6 `context` (4 verplicht + 2 optioneel)

| Wireveld | Regel | Bestaande bron | Status |
|---|---|---|---|
| `carId` | 1..64 UTF-8-bytes, geen controls, niet getrimd | `snapshot.CarId`/settings | **aanwezig in frame; freeze nodig** |
| `trackId` | integer 1..2.147.483.647 | `TrackIdentityReader.Read` | **aanwezig; freeze nodig** |
| `trackName` | 1..128 bytes, geen controls | `snapshot.TrackName`/settings | **aanwezig in frame; freeze nodig** |
| `trackConfig` | 1..128 bytes, geen controls | `snapshot.TrackConfig`/settings | **aanwezig in frame; freeze nodig** |
| `sessionUniqueId?` | integer 0..2.147.483.647; alleen sterke numerieke bron | `GetNullableInt(SessionUniqueID)` | **read bestaat; numeriek bewaren; runtime onbekend** |
| `sessionNumber?` | integer 0..1000 | `SessionNum`-kanaal | **read bestaat; bewaren; runtime onbekend** |

`context` is descriptief over het gedeelde interval en kwalificeert niets. Als
één van de vier verplichte waarden ontbreekt of leeg is, wordt **de hele
contextgroep** weggelaten; er wordt geen lege string, `0` of `"unknown"`
ingevuld. `sessionUniqueId`/`sessionNumber` worden alleen meegestuurd als de
ruwe waarde bekend is. `sim-s0` wordt nooit als `sessionUniqueId` gebruikt.

### 3.7 Velden die expliciet **niet** bestaan

`ownerUserId`, `ownerBasis`, `driverId`, `currentDriverName`, `driverChanged`,
`resetOrTow`, `compound`, `regime` en `complete` zijn geen wirevelden van
`observation`. `PlayerCarTowTime`, `SubSessionID` en `DriverInfo.Drivers[].UserID`
worden niet gebruikt; zie §7.

## 4. Identiteit, freeze en isolatie

### 4.1 Wat bij `StartLap` bevroren moet worden

Bij de eerste geaccepteerde tick van een ronde legt de producer één
`CaptureBinding` vast:

```
captureDeviceId       = Settings.DeviceId           (UUID, verplicht)
captureOwnerUserId    = Settings.BoundOwnerUserId   (UUID, lokaal verplicht)
pairingGeneration     = lokale teller               (verplicht, lokaal)
observedSessionId     = de op dat moment bekende sessiestring
segmentId             = het op dat moment geldende segment
carId/trackId/trackName/trackConfig
sessionUniqueId?/sessionNumber?
```

De accumulator krijgt deze waarden bij constructie (`TelemetrySampler.StartLap`,
`:260-267`) en geeft ze bij `Close` mee aan `LapAggregate`. `MeasurementPipeline`
mag bij `EnqueueSummary` (`:235-242`) **niet** opnieuw de actuele globale
`_observedSessionId` invullen; `LapAggregate.ToSummary` gebruikt de bevroren
waarde. `SegmentId` is al op de accumulator bevroren; dat blijft zo.

### 4.2 `PairingGeneration`

Er bestaat vandaag geen `PairingGeneration` in `ConnectorSettings` of in de
pairingresponse. De kleinste veilige inpassing is een **lokale** teller die bij
elke geslaagde `Pair`, elke `Unpair` en elke DPAPI-token-clear omhooggaat en
additief in `ConnectorSettings` wordt bewaard. Dit is geen servercontract en
gaat niet over de draad. Zonder deze teller kan een oude observation-rij na een
accountwissel niet betrouwbaar van een nieuwe worden gescheiden.

### 4.3 Isolatie bij token-/device-/accountwissel

- Bij `StartLap`: als `DeviceId`, `BoundOwnerUserId` of `PairingGeneration`
  onvolledig is, wordt **geen observation** gemaakt; de laprow blijft legacy.
- Bij `Close`: als de actuele binding niet gelijk is aan de bij `StartLap`
  bevroren binding, wordt de observation-groep **weggelaten**. De laprow zelf
  blijft geldig; er wordt niets achteraf in een al geserialiseerde rij
  geschreven.
- Bij `EnqueueLap` met observation: de binding wordt als lokale metadata aan de
  `OutboxEntry` toegevoegd. `RowJson` blijft de enige inhoud; de metadata gaat
  niet de draad op.
- Bij `Due`/planning: een observation-entry waarvan de binding niet gelijk is
  aan de actuele binding wordt **niet verzonden**. De exacte `RowJson` gaat naar
  de quarantaine met reden `capture_binding_changed`; de teller is zichtbaar.
  Legacy-laprijen zonder observation lopen gewoon door.
- Na een herstart blijft dezelfde regel gelden: de oude rij wordt nooit met het
  nieuwe token/device gecombineerd.

De server blijft de authenticatieautoriteit: de tokenopzoeking in
`context.ts` levert de geauthenticeerde device-UUID, en `capture.deviceId` moet
daarmee overeenkomen. De lokale binding voorkomt dat de producer zelf een
verkeerde combinatie aanbiedt; ze vervangt de servercontrole niet. Een zuiver
server-side owner-rebind zonder lokale pairingupdate is voor de producer niet
zichtbaar; de server resolveert owner bij ontvangst en blijft daarvoor de
autoriteit. De producer claimt dus geen accountisolatie die hij niet kan
meten.

## 5. Outbox-trace: enqueue → persist → restart → drain → ACK → cleanup

### 5.1 Enqueue

- `MeasurementOutbox.Enqueue` (`MeasurementOutbox.cs:211-231`) valideert eerst
  `MeasurementEventRecord.Validate()`; `EnqueueLap` (`:241-260`) doet hetzelfde
  voor `MeasurementLapSummaryRecord.Validate()`.
- Een ongeldige rij komt de wachtrij niet in: `RefusedEvents`/`RefusedLaps` en
  `LastRefusalReason` worden gezet. Dat is bestaand, expliciet verlies.
- `RowJson = record.ToJson()` wordt **één keer** gemaakt. `UID` en
  `RecordRevision` worden in de entry gekopieerd; `EnqueuedAtUtc = UtcNow`.
- `Add` (`:262-287`) controleert UID, niet-lege rij, dubbele UID en capaciteit.
  Bij volle capaciteit vervalt de **oudste** rij en gaan `DroppedEvents`/
  `DroppedLaps` plus `LastDropReason` omhoog. Daarna volgt direct `SaveLocked()`.
- Observation bestaat in dit pad nog niet. De latere bouw moet de observation
  **vóór** `ToJson()` toevoegen, zodat de bevroren `RowJson` het enige
  waarheidsdragende object blijft.

### 5.2 Persist

- `OutboxFileDto` (`:144-155`) bewaart versie 1, verlies-/afwijzingstellers en
  per reeks de entries. `Row` is de letterlijke `RowJson`-string.
- `SaveLocked` (`:579-627`) schrijft eerst `*.tmp`, daarna `File.Replace` naar
  `*.bak` (of kopie-fallback) en wist `LastPersistenceError` bij succes.
- Boven `OutboxLimits.MaxStoredBytes` (512 KiB, `:37-47`) wordt **niet**
  geschreven; `LastPersistenceError = "outbox_too_large"`. Er is geen stille
  truncatie. De in-memory wachtrij gaat dan verder, maar de schijfkopie blijft
  de vorige; een crash kan daardoor recente rijen verliezen. Dat is bestaand
  gedrag en een apart durability-gat voor de latere bouw.
- De productiepad is `%APPDATA%\3SM Endurance Connector\measurement-outbox.json`
  (`EnduranceConnectorPlugin.cs:880-883`).

### 5.3 Restart

- `InitMeasurementLayer` (`:876-899`) maakt de outbox, roept `Load()` en maakt
  daarna een nieuwe `MeasurementPipeline`. Er is geen in-memory ronde van vóór
  de herstart; alleen de persistente wachtrij blijft.
- `Load` (`:503-539`) leest het bestand, controleert `Version == 1`, herstelt de
  tellers en roept `Restore` (`:541-571`) per reeks. `Restore` bewaart
  `Uid`, `RowJson`, `RecordRevision`, `Attempts`, `NextAttemptUtc` en
  `EnqueuedAtUtc`. Het bestand wordt **niet** opnieuw geserialiseerd; de
  opgeslagen `RowJson` blijft bytegelijk.
- Een onleesbaar of verkeerd-versiebestand wordt als geheel gekopieerd naar
  `*.corrupt-<tijd>` (`:649-660`); de wachtrij is daarna leeg en de fout staat
  in `LastPersistenceError`. Dit is geen observation-quarantaine.
- Na de herstart is de actieve sessie nieuw; bestaande UID's en rijen worden bij
  de volgende frames gedraind. De bevroren `ObservedSessionId` in de rij blijft
  de oude waarde (test O10).

### 5.4 Drain

- `Due(now, maxEvents, maxLaps)` (`:295-314`) levert per reeks de oudste rijen
  die `NextAttemptUtc` voorbij zijn.
- `MeasurementFramePlanner.Plan` (`MeasurementFrame.cs:74-122`) kiest **eerst
  laps** (max 3), daarna events (max 20), binnen 16.384 B metingen en 24.576 B
  body. Wat niet past blijft in de outbox en wordt `deferred_by_budget`; er
  wordt niets weggegooid.
- `MeasurementSender.SendAsync` (`MeasurementFrame.cs:253-359`) bouwt één POST
  met de kernel + de twee reeksen. De `RowJson`-strings worden letterlijk in de
  arrays geplaatst (`MeasurementFrame.cs:124-137`).

### 5.5 ACK

- `MeasurementAckParser.Parse` (`MeasurementOutbox.cs:681-722`) leest
  `measurements.events`/`measurements.laps`. Ontbreekt `measurements`, dan is
  het frame geen leveringsbewijs: `ack_without_measurements`, niets opruimen.
- `ApplyAck` (`:323-362`) past per reeks `ApplySeries` toe.
- `stored:false` ⇒ niets verwijderen; `LastBlockError` bewaren.
- `accepted`, `duplicates` en `superseded` verwijderen een rij alleen als de
  bevestigde `record_revision` niet lager is dan de lokale
  (`RemoveConfirmed`, `:419-431`); een lagere revisie laat de nieuwere inhoud
  staan (`KeptForNewerRevision`).
- `rejected` verwijdert de rij **altijd** (`:401-412`), telt
  `RejectedEvents`/`RejectedLaps` en bewaart alleen `LastRejectionReason`.
  Let op de twee servervormen: de Edge-parser in `unavailable`-modus levert een
  reden met `observation is unavailable`, de DB-poort levert
  `observation_unavailable`; een `off`-Edge levert de generieke
  `contains unknown fields`. Al deze vormen zijn voor een observation-dragende
  rij dezelfde niet-ACK-klasse en mogen niet als gewone `Rejected*`-drop
  eindigen. Classificeer op het stabiele fragment, niet op de volledige
  `payload.lapSummaries[i]`-prefix; de Edge zet de padprefix vóór de reden.
- Na het ACK bepaalt `SendAsync` of alle aangeboden UID's weg zijn. Alleen
  `outcome.Stored && remaining.Count == 0` is `Stored=true`. Een `stored:true`
  met een niet-bevestigde rij wordt `ack_without_row_confirmation` en gaat met
  backoff opnieuw.
- `MarkAttempt` (`:460-487`) zet bij falen de teller omhoog en de volgende
  poging 2–60 s vooruit; bij succes gaat de teller terug naar 0. Een optionele
  `MaxAttemptsPerEntry` kan een rij na N pogingen laten vervallen; dat is
  expliciet verlies met reden.

### 5.6 Cleanup

- Verwijderen gebeurt alleen in de in-memory lijst; daarna volgt `SaveLocked`.
  Er is geen apart bevestigingsarchief en geen tombstone per rij.
- `Dropped*`/`Rejected*`-tellers en `LastDropReason`/`LastRejectionReason`
  overleven een herstart (ze staan in het bestand).
- **Gat:** een `observation_unavailable`- of `observation_device_mismatch`-
  afwijzing wordt vandaag als `rejected` verwijderd. Dat botst met de eis
  "unavailable/rollback niet als ACK/drop". De latere bouw moet
  observation-afwijzingen op de reden classificeren en de exacte rij bewaren.
- Gevolg van die keuze: een observation-rij die de server niet accepteert,
  blijft lokaal in quarantaine maar bereikt de server **niet** als laprow. Een
  tweede "legacy"-kopie met een nieuwe UID wordt niet gemaakt; dat zou dezelfde
  ronde dubbel identificeren en de immutable-UID-regel schenden. Alleen een
  nieuwe ronde die bij capture al zonder observation wordt gebouwd, blijft een
  gewone laprow. De alternatieve S1-optie "in de wachtrij laten staan" is hier
  bewust niet gekozen: een langdurige rollback zou de 32-lapqueue vullen en
  gewone laprows verdringen. De quarantaine is de zichtbare, begrensde
  bewaarplek; heractivatie na herstel is een expliciete operatorstap.

## 6. Kleinste inpassingsmatrix (voor de latere lokale bouw)

Geen van deze wijzigingen is nu uitgevoerd. De matrix is de kleinste set
bestanden/methoden die de volgende lokale bouw nodig heeft; ze is geen
P0–P8-plan.

### A. Pure observation-builder en DTO

| Bestand | Methode/plek | Kleinste wijziging | Waarom |
|---|---|---|---|
| `3SM.EnduranceConnector/MeasurementEvent.cs` | `MeasurementLapSummaryDto` (na `:146`) | Optioneel `Observation`-lid met `[DataMember(Name="observation", EmitDefaultValue=false)]` | Serializer moet het blok exact onder `lapSummaries[i]` zetten; afwezig blijft bytegelijk |
| `3SM.EnduranceConnector/MeasurementEvent.cs` | `MeasurementLapSummaryRecord` (`:436-470`), `ToDto` (`:478-525`) | `Observation`-recordveld + kopiëren in `ToDto` | De outbox serialiseert de record; het blok moet vóór `ToJson()` vaststaan |
| nieuw `3SM.EnduranceConnector/ObservationCapture.cs` | pure types + `TryBuild(...)` | Observation-DTO's, caps, UTC/3-decimalen, UUID, interval-invarianten, geen onbekende sleutels | Eén pure, testbare plek; geen SimHub-referentie |
| `3SM.EnduranceConnector.DiagnosticsTests/MeasurementObservationCaptureTests.cs` (nieuw) | `Run(check)` | Positive/negative fixtures voor §8 OB-tests | Bewijst de pure builder zonder SDK |

### B. Ronde-accumulatie en freeze

| Bestand | Methode/plek | Kleinste wijziging | Waarom |
|---|---|---|---|
| `LapAccumulator.cs` | `LapAccumulator`-velden (`:194-234`) | `_acceptedSamples`, `_maxGapSeconds`, `_prevSampleAtUtc`, `_firstPitRoadAtUtc`, `_refuel...`, `_driverNameMissing`, `_observedSessionId`, contextvelden | Alle interval-/pit-/refuel-/contextfeiten komen uit dezelfde geaccepteerde tickstroom |
| `LapAccumulator.cs` | `Add` (`:249-307`) | Teller/gap/pitroad/refuel/naamflag/context bijwerken; geen waarde verzinnen bij `null` | `null` breekt de keten; `false`/`0` worden geen feit |
| `LapAccumulator.cs` | `Close` (`:333-387`) | `LapAggregate` vullen met de observation-bronstate en bevroren context/sessie | De builder draait op de afgesloten ronde, niet op globale flushstate |
| `LapAccumulator.cs` | `LapAggregate` (`:395-423`), `ToSummary` (`:457-492`) | `ObservedSessionId` en observation-source/`Observation` meenemen; `ToSummary` gebruikt de bevroren sessie | Geen flush-globale sessie meer |
| `TelemetrySampler.cs` | `StartLap` (`:260-267`) | `ObservedSessionId` en capture-context aan de accumulator meegeven | Freeze op de eerste geaccepteerde tick |
| `TelemetrySampler.cs` | `CloseCurrent` (`:269-275`) | Bevroren sessie meegeven aan `LapAccumulator.Close` | Ook bij sessie-/lapwissel de oude sessie houden |
| `MeasurementPipeline.cs` | `EnqueueSummary` (`:235-242`) | Geen actuele `_observedSessionId` meer doorgeven; laat de record de bevroren waarde gebruiken | Sluit het flush-gat |
| `TelemetrySample` (`LapAccumulator.cs:16-67`) | nieuwe contextvelden | `CarId`, `TrackId`, `TrackName`, `TrackConfig`, `SessionUniqueId?`, `SessionNumber?`, `CaptureBinding` | De plugin vult ze per tick; de sampler bevriest ze bij `StartLap` |

### C. Outbox: binding, quarantaine en ACK-classificatie

| Bestand | Methode/plek | Kleinste wijziging | Waarom |
|---|---|---|---|
| `MeasurementOutbox.cs` | `OutboxEntry` (`:20-34`) | `HasObservation`, `CaptureDeviceId`, `CaptureOwnerUserId`, `PairingGeneration` (lokaal, niet op de draad) | Binding per observation-rij isoleren |
| `MeasurementOutbox.cs` | `OutboxEntryDto` (`:132-142`), `OutboxFileDto` (`:144-155`) | Additieve velden + bestandsversie 2; v1 laden als legacy | Bestaande wachtrijen blijven leesbaar; `RowJson` blijft exact |
| `MeasurementOutbox.cs` | `EnqueueLap` (`:241-260`) | Bindingsargument; observation alleen accepteren bij complete binding | Geen observation zonder device/owner/generatie |
| `MeasurementOutbox.cs` | `Due`/`Collect` (`:295-314`) | Observation-entries met afwijkende binding uitsluiten en zichtbaar naar quarantaine verplaatsen | Nooit een oude rij met een nieuw token mengen |
| `MeasurementOutbox.cs` | `ApplySeries` (`:364-413`) | `rejected`-reden classificeren: observation-redenen → quarantaine, geen `Rejected*`-delivery; legacy → bestaand dropgedrag | `observation_unavailable`/rollback/device-mismatch zijn geen ACK |
| `MeasurementOutbox.cs` | nieuwe `ObservationQuarantine`-opslag | Apart bestand, 64 entries/1 MiB, append-only, immutable `RowJson` + ruwe observation + reden, tellers/retentie/overflow | Zichtbaar bewaren in plaats van stil verliezen |
| `MeasurementOutbox.cs` | `MarkAttempt` (`:460-487`) | Quarantaine- en overflowtellers meenemen; geen retry van een terminale observation-afwijzing | Backoff blijft voor gewone transportfouten |

### D. Plugin-bedrading en instellingen

| Bestand | Methode/plek | Kleinste wijziging | Waarom |
|---|---|---|---|
| `ConnectorSettings.cs` | velden (`:7-111`) | `ObservationV1Enabled = false` (lokaal, default uit) + `PairingGeneration` (lokaal) | Veilige default; geen server-/wirecontractwijziging |
| `EnduranceConnectorPlugin.cs` | `InitMeasurementLayer` (`:876-899`) | Outbox/pipeline van settings- en pairingtoegang voorzien | De pipeline moet de binding bij `StartLap` kunnen lezen |
| `EnduranceConnectorPlugin.cs` | `BuildMeasurementSample` (`:961-1002`) | Contextvelden en `CaptureBinding` vullen uit dezelfde bronnen als `CaptureV3` (`:1490-1495`, `TrackIdentityReader`) | Context/sessie horen bij de tick, niet bij flush |
| `EnduranceConnectorPlugin.cs` | `PairCoreAsync` (`:1185-1265`), `Unpair` (`:1282-1322`) | `PairingGeneration` ophogen en observation-wachtrij isoleren | Account-/devicewissel zichtbaar en veilig |
| `ConnectorControlContracts.cs` | `KnownFeatures` (`:101-106`) | **niet nu** uitbreiden; een `observation`-feature is een apart servercontract | Geen clientflag verzinnen; server-first deploy blijft voorwaarde |

### E. Test- en projectbedrading (latere build)

| Bestand | Wijziging |
|---|---|
| `3SM.EnduranceConnector.DiagnosticsTests/MeasurementOutboxTests.cs` | Nieuwe O22+-gevallen voor quarantaine/ACK-classificatie/binding |
| `3SM.EnduranceConnector.DiagnosticsTests/MeasurementPipelineTests.cs` | Nieuwe PL-gevallen voor freeze en context |
| `3SM.EnduranceConnector.DiagnosticsTests/MeasurementTransportTests.cs` | Fake-relay-antwoorden met `observation_unavailable`/`device_mismatch` |
| `3SM.EnduranceConnector.DiagnosticsTests/SettingsCompatibilityTests.cs` | Nieuwe lokale velden default uit/0 |
| `3SM.EnduranceConnector.DiagnosticsTests/V3PayloadFixtureTests.cs` | Legacy frame bytegelijk zonder observation |
| `3SM.EnduranceConnector.DiagnosticsTests/FaseDTests.cs` | Nieuwe testgroep registreren |
| `3SM.EnduranceConnector/3SM.EnduranceConnector.csproj` | Nieuw `.cs`-bestand toevoegen |
| `3SM.EnduranceConnector.DiagnosticsTests/3SM.EnduranceConnector.DiagnosticsTests.csproj` | Nieuw puur bestand toevoegen |
| `tools/simhub-plugin/release.sh` | Nieuw bestand in de brace-lijst (pas bij een latere release; nu niet) |

## 7. Contractpoorten (P/F)

Deze poorten zijn de acceptatie voor de latere lokale bouw. Een FAIL blokkeert
de build; een "onbekend" wordt nooit als PASS of als `false`/`0` behandeld.

| # | Poort | PASS | FAIL |
|---|---|---|---|
| G01 | Binding bij `StartLap` | `DeviceId` UUID (v1–v5, variant 8/9/a/b, case behouden) + `BoundOwnerUserId` UUID + generatie >0; anders geen observation, laprow legacy | Observation met ontbrekende/partiële binding |
| G02 | Sessie/segment freeze | `ObservedSessionId` en `SegmentId` op `StartLap` bevroren; flush gebruikt die waarden | Flush gebruikt actuele globale sessie/segment |
| G03 | `sim-s0` | Niet als `sessionUniqueId` geparseerd; veld weggelaten | `sim-s0` → `0` of een verzonnen numerieke sessie |
| G04 | Interval | `samples>=1`; `samples==1` ⇒ `first==last`/`maxGap==0`; `samples>1` ⇒ `last>first`; `maxGap` en `unknown` volgens de contractondergrens | Ongeldige combinatie of een volledigheidsclaim |
| G05 | `pitRoad` | Alleen `value:true` + `firstAt` binnen interval | `false`, `0`, `firstAt` buiten interval |
| G06 | `refuel` | Alleen positieve stappen; som >0; `positiveSteps>=1`; geen stap over `null`/segment-/sessiewissel; `maxUndetectedLitres` weggelaten | Netto totaal, negatieve stap, 0, of een verzonnen ondetectiegrens |
| G07 | Naamcontinuïteit | Alleen `unchanged`/`changed`; lege naam ⇒ groep weg | Driver-ID, owner, of "unchanged" bij onbekende naam |
| G08 | Context | Alle vier verplichte velden aanwezig en geldig, of hele groep weg; optionele sessievelden alleen numeriek en sterk | Lege string/0/"unknown" als context, of `sim-s0` als uniek ID |
| G09 | Geen verboden feiten | Geen owner/PII, geen `resetOrTow`, geen `tow`, geen `driverChanged`, geen `complete` | Elk verboden veld op de draad |
| G10 | Bytebudget | Compacte observation <=2048 bytes; groter ⇒ geen observation, geen strip | 2049+ toch verzonden |
| G11 | Legacy | Afwezig `observation` ⇒ exact de bestaande laprow/hash/ACK | Een lege observation of een "no fact"-marker |
| G12 | `RowJson`-immutabiliteit | Na enqueue/save/load/quarantaine bytegelijk; UID/revisie/ruwe waarden en de ruwe observation-string (UUID-case, tijdprecisie) ongewijzigd | Hervormen, strippen, opnieuw serialiseren of UID/revisie wijzigen |
| G13 | ACK-classificatie | `accepted`/`duplicate`/`superseded` (revisie >= lokaal) = bevestigd; elke afwijzing van een observation-dragende rij — `observation_unavailable`, rollback, device-mismatch, invalid/null én de generieke `contains unknown fields` van een `off`-Edge — is **niet** bevestigd en niet gedropt | Afgekeurde observation als `Rejected*` verwijderen of als delivery tellen |
| G14 | Quarantaine | 64 entries/1 MiB; append-only; immutable `RowJson` + ruwe observation + reden; zichtbare retentie/evictie/overflow | Stille evictie, onbegrensde groei, of verlies zonder teller/reden |
| G15 | Overflow | Bij vol: nieuwe observation-capture zichtbaar weigeren (teller+reden); gewone laprows blijven doorlopen | Nieuwe observation stil weigeren of laprows blokkeren |
| G16 | Bindingwissel | Oude observation-rijen worden geïsoleerd (`capture_binding_changed`) en nooit met nieuw token verzonden; legacy loopt door | Oude rij met nieuw device/account verzenden |
| G17 | Server-first | Edge `on` + DB-probe/flag aan vóór producer ooit observation stuurt; default lokaal uit | Producer aan terwijl server `off`/`unavailable` is |
| G18 | Geen SDK-verzinsel | Alleen bronnen uit §2; `SubSessionID`/`UserID`/`PlayerCarTowTime` niet gebruiken zonder lokaal bewijs | Een onbewezen SDK-veld als feit op de draad |
| G19 | Exacte vorm | `version:1`; alleen de zeven toegestane rootkeys; `capture` alleen `deviceId`; `interval` alleen de zeven stats; geen onbekende subsleutel; `null` in een known veld = rijafwijzing | Extra key, verkeerde versie of `null` dat als "onbekend" wordt geaccepteerd |

De 1 MiB-quarantainegrens wordt gemeten als de compacte JSON van de
quarantainelijst, inclusief de exacte `RowJson` en de reden; niet als een
gecomprimeerde of geschatte waarde. Retentie is binnen die grens onbeperkt:
er is **geen automatische evictie**. Exporteren of wissen is een expliciete,
getelde operatoractie. Een toekomstige policy die toch evict, moet dat met
reden en teller doen; deze v1 kiest geen automatische evictie. Bij 64 entries
of 1 MiB weigert de producer nieuwe observation-capture zichtbaar
(overflowteller plus reden), terwijl gewone laprows blijven doorlopen.

## 8. P/F-testmatrix voor de latere lokale bouw

Alle fixtures zijn synthetisch en lokaal; geen SimHub/iRacing-runtime. De
builder-tests zijn pure C#; de server-interop-tests zijn Deno/SQL en worden pas
in de latere serverstap gedraaid.

### 8.1 Observation-builder (OB)

| # | Fixture | Verwacht |
|---|---|---|
| OB01 | één sample, geen feiten | Geen observation (no-fact); laprow legacy |
| OB02 | één sample + pitRoad true | `samples=1`, `maxGap=0`, `first=last`, `pitRoad.firstAt=first` |
| OB03 | twee samples 50 ms, eind 90 s | `maxGap<=0.05`, `edgeAfter>0`, `unknown>=edges` |
| OB04 | gap 1,2 s | `maxGap>=1.2`, `unknown>=edges+1.2` |
| OB05 | gap exact 1,0 s | `maxGap=1.0`, `unknown=edges` (drempel is strikt `>1,0`) |
| OB06 | fuel 60 → null → 62 | Geen refuel-stap over de null; geen verzonnen 2 L |
| OB07 | fuel 60 → 59 | Geen negatieve refuel; geen stap |
| OB08 | fuel 60 → 62,4 in pit | `observedAdded=2.4`, `steps=1`, `firstAt`=tijd stap |
| OB09 | fuel 60 → 61 → 62,4 in pit | `observedAdded=2.4`, `steps=2`, geen netto-totaal |
| OB10 | fuel step over segmentwissel | Geen stap; observation zonder refuel |
| OB11 | `OnPitRoad=null` bij één sample | Geen `pitRoad`; geen `false` |
| OB12 | `OnPitRoad=true` bij twee samples | `value:true`, `firstAt`=eerste true |
| OB13 | namen A,A,A | `unchanged` |
| OB14 | namen A, "", A | Groep weglaten |
| OB15 | namen A,B,A | `changed` |
| OB16 | context zonder trackId | Context weglaten; andere feiten blijven |
| OB17 | context car/track/name/config + sessionUniqueId/sessionNumber | Geldige context; optionele velden aanwezig |
| OB18 | alleen `sim-s0` als sessie | `sessionUniqueId` weglaten; nooit 0 |
| OB19 | observation 2048 bytes | Accept; 2049 bytes → geen observation |
| OB20 | tijden 3 decimalen UTC | Exacte waarden; geen 7-cijferige productie |
| OB21 | `unknown > venster` | Builder weigert; geen ongeldige emissie |
| OB22 | `samples=0`/`first>last` | Builder weigert |
| OB23 | fuel +0,0004 L | Geen stap (onder 0,001 L-korrel) |
| OB24 | eerste naam leeg, daarna A,B | Groep weglaten (geen `changed`/`unchanged`-claim) |

### 8.2 Pipeline/freeze (PL)

| # | Scenario | Verwacht |
|---|---|---|
| PL01 | sessie A bij start, B vóór flush | Rij gebruikt A; geen B |
| PL02 | sessie onbekend bij start, later bekend | Rij heeft geen `observedSessionId`; geen late B |
| PL03 | segmentwissel tijdens ronde | Oude ronde houdt oud segment; nieuwe ronde nieuw segment |
| PL04 | car/track wijzigt midden in ronde | Context blijft de bij start bevroren waarden |
| PL05 | device/owner wijzigt midden in ronde | Observation-groep weg; laprow legacy blijft |
| PL06 | accountwissel tussen enqueue en send | Observation-rij naar quarantaine `capture_binding_changed`; niet verzonden |
| PL07 | trackId ontbreekt bij start | Geen context; andere feiten blijven; laprow geldig |
| PL08 | lege driverName bij één sample | Geen `driverNameContinuity` |
| PL09 | `OnPitRoad` null bij deel samples | Alleen echte `true` telt; geen `false` |
| PL10 | fuelstap over rondegrens | Geen stap; state reset per ronde |

### 8.3 Outbox/quarantaine/ACK (OQ)

| # | Scenario | Verwacht |
|---|---|---|
| OQ01 | enqueue → save → load | `RowJson` bytegelijk; UID/revisie gelijk (bestaand P07) |
| OQ02 | accepted ACK | Rij weg; confirmed++ |
| OQ03 | duplicate ACK | Rij weg; duplicate++ |
| OQ04 | superseded met gelijke/hogere revisie | Rij weg; superseded++ |
| OQ05 | ACK met lagere revisie | Rij blijft; `KeptForNewerRevision` |
| OQ06 | `stored:false` | Rij blijft; blockError bewaard |
| OQ07 | 202 zonder `measurements` | Rij blijft; `ack_without_measurements` |
| OQ08 | `observation_unavailable` | Rij **niet** weg; exacte `RowJson` in quarantaine; geen confirmed |
| OQ09 | rollback/flag-off (`observation_unavailable`) | Idem OQ08; geen retry als delivery |
| OQ10 | `observation_device_mismatch` | Idem OQ08; reden zichtbaar |
| OQ11 | `observation_invalid`/`null` | Idem OQ08; producentbug zichtbaar |
| OQ12 | legacy-rij afgekeurd (`wear_after_contract`) | Bestaand dropgedrag met teller (regressie) |
| OQ13 | 64e quarantaine-entry | Accept; 65e → overflow, nieuwe observation-capture geweigerd |
| OQ14 | 1 MiB-grens | Exacte grens accept; +1 byte → overflow zichtbaar |
| OQ15 | retentie/evictie | Geen stille evictie; alleen expliciete, getelde export/clear |
| OQ16 | restart na quarantaine | Quarantaine en tellers blijven; `RowJson` bytegelijk |
| OQ17 | bindingwissel vóór send | `capture_binding_changed`; niet verzonden |
| OQ18 | legacy-rij na bindingwissel | Wordt gewoon verzonden |
| OQ19 | quarantaine-entry | `RowJson` en ruwe observation bytegelijk; geen reserialisatie |
| OQ20 | herstart na bindingwissel | Oude observation wordt niet met nieuw token/device verzonden |

### 8.4 Server-interop (SI; latere serverstap, niet nu)

| # | Scenario | Verwacht |
|---|---|---|
| SI01 | producer-JSON in Edge `on` | `parseLapObservation` accept; `classify` accept |
| SI02 | producer-JSON in Edge `off`/`unavailable` | Rijafwijzing; geen frameabort |
| SI03 | `capture.deviceId` ≠ token-device | `observation_device_mismatch`; geen insert/P1 |
| SI04 | DB-flag uit | `observation_unavailable`; geen ACK |
| SI05 | legacy zonder observation | v1-hash bytegelijk; geen kolomwijziging |
| SI06 | 2048 wire / 4096 jsonb | Exacte grens accept; +1 geweigerd |

## 9. Feitelijk uitgevoerde proeven (nu)

Bewijsroot: `/home/hermes/artifacts/3sm/pitwall-learning-p2-producer-source/`.
Alle onderstaande resultaten zijn echte exits; geen samengevatte aannames.

### 9.1 Projectsbuild

```
dotnet build --no-restore
→ exit 1
→ NETSDK1004: obj/project.assets.json not found
→ 0 warnings, 1 error
```

Vastgelegd in `logs/dotnet-build-no-restore.out`. **NIET UITGEVOERD** als
projectsbuild; geen restore/install gedaan.

### 9.2 Directe Roslyn-compilatie van de bestaande tests

De exacte bronlijst uit
`3SM.EnduranceConnector.DiagnosticsTests.csproj` is met de lokale
`csc.dll` (SDK 8.0.427, `-langversion:latest`, net8-refassemblies) gecompileerd:

```
csc exit 0
DiagnosticsTests.dll  479.744 bytes
SHA256 458d065ad640a64dd6cc3f94ff18f07681a2d938704e4d9713c70270ae961cf3
```

Vastgelegd in `logs/csc.rsp`, `logs/csc.out`, `bin/DiagnosticsTests.dll` en
`logs/artifact-sha256.txt`.

### 9.3 Bestaande meetlaag-subset

```
dotnet exec DiagnosticsTests.dll --only-measurement
→ exit 0
→ SUMMARY PASS=299 FAIL=0
```

Dit is de bestaande, reproduceerbare subset (geen 60 s-soaktest). De volledige
harnasrun met de fixtures gaf `PASS=644 FAIL=3`; de drie fouten zijn
harnascontext, geen bronregressie:

- `CARNAME-wiring-files`: bronbestanden worden relatief aan de artifact-`bin`
  gezocht;
- `V24-3SM.EnduranceConnector` en `V24b-3SM.EnduranceConnector.Updater`: de
  plugin-/updaterassembly's zijn in deze artifact-only build niet aanwezig.

Vastgelegd in `logs/measurement-subset.out` en
`logs/diagnostics-full-with-fixtures.out`.

### 9.4 Artifact-only bronprobe (synthetisch)

`src/ProducerSourceProbe.cs` compileert de echte bron en controleert
reflectief/gedragsmatig de zes gaten:

```
PASS P01 MeasurementLapSummaryDto has no Observation member (33 public props)
PASS P02 TelemetrySample has no tow/SubSessionID/UserID member
PASS P03 OutboxEntry has no observation/capture binding metadata
PASS P04 ConnectorSettings has no observation flag and no PairingGeneration
PASS P05 MeasurementOutbox has no observation quarantine/refusal API
PASS P06 serialized lap summary contains no observation key
PASS P07 RowJson is byte-identical after Save+Load (631 chars)
PASS P08 CURRENT BEHAVIOR: observation_unavailable rejection removes the frozen lap row (RejectedLaps=1)
PASS P09 LapAccumulator exposes no all-sample count, first-pitRoad time or first-refuel time
PASS P10 PitResult has net fuel delta only, no positive-step count/first time
PASS P11 MeasurementLapSummaryRecord has no observation or capture-binding members
PASS P12 V3Identity has car/track descriptors but no owner member
PASS P13 existing outbox limits are 64 events / 32 laps / 512 KiB, not 64 quarantine entries / 1 MiB
SUMMARY PASS=13 FAIL=0
```

`P08` is de directe demonstratie dat de bestaande outbox een afwijzing met
reden `observation_unavailable` als verwijderde rij behandelt; `ApplySeries`
kijkt niet of de rij een observation droeg. `P01`/`P11` laten zien dat zo'n
rij vandaag niet eens geserialiseerd kan worden. Samen is dat het gat, niet een
bewijs dat de server al zulke rijen afwijst. Het is een
**gedragsobservatie op synthetische data**, geen server- of SDK-bewijs.

Vastgelegd in `logs/producer-source-probe.out`, `logs/probe-csc.out` en
`bin/ProducerSourceProbe.dll` (SHA256
`da5281ef27fabe4ce244cb4eb6dc283cf97a216ee770982cea84bd9fba5a117f`).

## 10. Resterende SDK-onzekerheden (expliciet)

Deze punten zijn **niet** bewezen en worden niet als bron gebruikt. De twee
researchbestanden (`GeneratedSessionData.cs`, `vars.txt`) zijn externe
SDK-modellen, geen geladen SimHub-/iRacing-assembly; hun bestaan is geen
runtimebewijs en de plugin leest ze niet.

| Onderwerp | Wat lokaal bestaat | Wat ontbreekt |
|---|---|---|
| `SubSessionID` | Alleen research: `irsdk_research/vipoo/iRacingSDK.Net-master/DataFeed/GeneratedSessionData.cs:63` (`WeekendInfo.SubSessionID`) | Geen lokale C#-caller, geen runtimewaarde, geen bewijs dat de huidige SimHub-snapshot dit veld levert |
| `DriverInfo.Drivers[].UserID` | Alleen research: `GeneratedSessionData.cs:241-245` | `OpponentCarName.DriverIdentity` (`OpponentCarName.cs:11-21`) leest alleen CarNumber/UserName/CarName; geen UserID, geen stabiele rijderidentiteit |
| `CarIdx` | Research `GeneratedSessionData.cs:241`; lokaal `RawChannelReader.ReadCarIndices` (`:263-276`) leest het voor opponents | Niet gebruikt voor driveridentiteit; geen bewijs dat het een 3SM-user of owner is |
| `PlayerCarTowTime` | Alleen research: `irsdk_research/kutu/pyirsdk-master/vars.txt:201` | Geen lokale C#-caller, geen reset-/towdetectie, geen negatieve claim |
| `SessionUniqueID` | Lokale property-read `EnduranceConnectorPlugin.cs:1011` (alleen string), `SessionNum` (`:1012`) | Numerieke waarde niet bewaard; runtime aanwezigheid niet vastgelegd |
| `trackId` | `TrackIdentityReader.Read` (`:10-22`) en `V3Identity.TrackId` | Runtime aanwezigheid in elke sessie niet vastgelegd |
| car/track-namen | `snapshot.CarId`/`TrackName`/`TrackConfig` (`:1492-1495`) | Kunnen per SimHub-profiel ontbreken; dan context weglaten |
| brandstofresolutie | `FuelLitres` ruw, netto delta op 3 decimalen (`PitServiceTracker.cs:313-315`) | Geen bewijs van fysieke sensorresolutie; `resolutionLitres=0,001` is een gedeclareerde wire-korrel |
| `maxUndetectedLitres` | Geen | Geen bewijsbare bovengrens; veld wordt weggelaten |
| reset/tow | Alleen indirecte redenen `session_time_reset`/`lap_boundary_gap` (`TelemetrySampler.cs:150-157`, `:251-257`) | Geen `resetOrTow`-feiten; die redenen zijn geen bewijs van een reset of tow |

`SessionUniqueID`, `SubSessionID`, `UserID` en `PlayerCarTowTime` blijven
**UNVERIFIED/ongesloten**. Bestaan in een researchbestand is geen runtimebewijs.

## 11. Wat de volgende lokale bouw nodig heeft

1. **Pure builder eerst**: `ObservationCapture.cs` + DTO-lid + builder-tests
   (OB01–OB24). Geen SimHub-referentie.
2. **Ronde-accumulatie**: `LapAccumulator` uitbreiden met all-sample
   intervalstate, eerste pitroad-tijd, positieve brandstofstappen,
   lege-naamflag en bevroren context/sessie; `TelemetrySampler.StartLap`
   vult de freeze; `MeasurementPipeline.EnqueueSummary` gebruikt die freeze.
3. **Outbox v2**: lokale bindingmetadata, observable `RowJson`-immutabiliteit,
   `observation_unavailable`/rollback/device-mismatch als niet-ACK naar een
   aparte quarantaine (64/1 MiB, append-only, zichtbare tellers), overflow
   weigert alleen nieuwe observation-capture en laat legacy laprows door.
4. **Plugin-bedrading**: `ConnectorSettings` lokaal `ObservationV1Enabled=false`
   en `PairingGeneration`; `BuildMeasurementSample` vult context/binding;
   `Pair`/`Unpair` hogen de generatie op en isoleren open observation-rijen.
5. **Testbedrading**: nieuwe pure testgroep registreren in `FaseDTests`, de
   drie `.csproj`/`release.sh`-lijsten bijwerken (pas bij de latere build), en
   de bestaande 299-meetlaagsubset plus de nieuwe tests draaien.
6. **Server-first bewijs**: Edge `SIMHUB_OBSERVATION_V1_ENABLED=on` +
   DB-probe/flag aan, daarna de SI-tests; de producer blijft default uit tot
   die twee kanten bewezen zijn.
7. **Pas daarna** een aparte build-/releasebeslissing. Dit document doet geen
   versie-, DLL-, updater- of publicatievoorstel.

**PRODUCTIEWIJZIGING: NEE.**
