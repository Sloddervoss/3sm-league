# T13 — producer/outbox bronkaart en afgebakend inpassingscontract v1.1

Status: **DOCS-ONLY CONTRACTCORRECTIE. GEEN PRODUCER, GEEN OUTBOXWIJZIGING, GEEN
RELEASE.** Deze v1.1 vervangt de 745-regel v1-tekst op
`db7ca10ca34781db0e7d1b7c2eceaa02308b5a72` uitsluitend voor de hieronder
gearceerde contractgaten. Basis blijft
`1d3a7ef8c39daa1c00f6e6cc974d88b11c590f39` op
`docs/pitwall-learning-p2-producer-source`. De geaccepteerde T13-S1-serverkant
(`58820eed28b6e80c420fe952c20b27f348a39a6b`) en het observationcontract
(`docs/contracts/pitwall-learning-observation-context-v1.md`, 239 regels) zijn
ongewijzigd. Dit document is de bronkaart voor de **volgende lokale bouw**, niet
die bouw en niet een publicatie- of versiebesluit. **Deze tekst is nog niet
geaccepteerd als bouwbasis**: een onafhankelijke delta-SPEC moet de hier
gekozen sidecar-architectuur eerst bevestigen.

Bewijsroot van deze F1/F2-correctie (0700):
`/home/hermes/artifacts/3sm/pitwall-learning-p2-producer-binding-budget/`. De
eerdere bewijsroot
`/home/hermes/artifacts/3sm/pitwall-learning-p2-producer-contract-fix/` blijft
ongewijzigd; de oude bron- en probebestanden onder
`/home/hermes/artifacts/3sm/pitwall-learning-p2-producer-source/` blijven
ongewijzigd en worden hier alleen geciteerd.

## 0. Grens, bewijsstatus en niet-claims

- Alleen repository-leeswerk, docs-patches en artifact-only probes. Geen
  functionele code, project-, package-, updater-, versie-, vlag- of
  broncontractwijziging; geen DB/network/SSH/GUI/Windows-write, DDL,
  build-DLL-install of `release.sh`. **Deze correctie autoriseert geen bouw of
  release; de ouder beslist over de delta-SPEC en de latere lokale stap.**
- **Huidige productie verliest vandaag geen observaties**: de bestaande
  producer emit nog geen `observation`-blok. De gaten hieronder zijn
  blokkades voor de latere bouw, geen claim dat de huidige productie
  observation-data kwijtraakt.
- **Gekozen architectuur is één aparte, begrensde observation-sidecar-ledger,**
  niet een gedeeld `measurement-outbox.json`-v2. Het bestaande
  `measurement-outbox.json` blijft `Version=1`, byte-stabiel en de enige
  wachtrij voor gewone laprows. Observation-rijen leven uitsluitend in
  `observation-ledger-v1.json`. Een oude DLL leest die nieuwe bestandsnaam
  nooit. Zie §1.1 voor de invariants en §5 voor de levenscyclus.
- De C#-proeven hieronder compileren **de echte bestaande bron** met de lokale
  Roslyn-compiler en draaien de bestaande `DiagnosticsTests`. Ze zijn geen
  SimHub- of iRacing-runtimebewijs en geen net48-/SDK-bewijs. Fixtures zijn
  synthetisch en als zodanig gelabeld. De reviewprobes P14–P20 zijn
  artifact-only herhalingen tegen dezelfde bron (§9.5).
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
4. `OutboxEntry` heeft geen lokale `PairingBinding` (device/owner/generatie) en
   geen observation-markering; een na een accountwissel verzonden oude rij kan
   niet lokaal geïsoleerd worden.
5. `ApplySeries` verwijdert een afgekeurde rij, ongeacht de reden. Een
   `observation_unavailable`- of rollback-afwijzing wordt daardoor een
   getelde maar niet-bewaarde drop (bewezen: probe P08).
6. Er is geen aparte observation-sidecar-ledger met 64 entries/1 MiB,
   immutable `RowJson`/ruwe observation/reden en zichtbare
   retentie/overflow; de bestaande 32-lapqueue is voor gewone laprows en mag
   nooit als observationbewaarplaats worden hergebruikt.

Voor de **kern** van het blok is geen onbewezen SDK-veld nodig: device/owner
komen uit de pairingresponse, car/track uit de bestaande frame-identiteit,
pit/fuel/naam uit de bestaande meetmonsters. `SubSessionID`, `UserID` en
`PlayerCarTowTime` zijn lokale research alleen; ze worden niet gebruikt en niet
als bewezen bron verkocht.

### 1.1 Gekozen architectuur: één observation-sidecar-ledger

De correctie kiest bewust **één** samenhangend ontwerp. Alle onderstaande
regels zijn invariants; een latere bouw die hiervan afwijkt, is een nieuwe
delta-SPEC en geen implementatiedetail.

| # | Invariant | Gevolg |
|---|---|---|
| A1 | `measurement-outbox.json` blijft `Version=1` met de bestaande 32-lap-/512 KiB-legacylane en bestaande lezer. Er wordt **geen** `FileVersion=2` en geen extra observationveld in dit bestand geschreven. | Oude DLL's en rollback lezen de gewone wachtrij byte-stabiel; de 512 KiB-char-bug en `EnqueueLap`-savefout blijven bestaande legacy-eigenschappen (§5.2, §9.3). |
| A2 | Observation-rijen leven **uitsluitend** in `observation-ledger-v1.json` (nieuwe, versiegebonden bestandsnaam) met een eigen `version` en eigen schema. | De 32-lapqueue kan een observation-rij nooit evicten; de sidecar kan de gewone queue nooit corrumperen. |
| A3 | De keuze **observation of legacy** valt vóór elke duurzame publicatie. Een observation-candidate mag in geheugen een voorlopige UID en geserialiseerde bytes hebben, maar is dan niet captured, niet gereserveerd, niet gepersisteerd en niet verzonden. | Nooit dezelfde `(UID, recordRevision)` in beide lanes, en nooit twee verschillende hashes voor dezelfde UID/revisie; alleen de duurzaam gecommitte lane publiceert de UID. |
| A4 | Een eenmaal bevroren observation-rij wordt **nooit** gestript, herserialiseerd, van een nieuwe UID voorzien of alsnog als legacy aangeboden. | Een serverafwijzing leidt tot sidecar-quarantaine, niet tot een tweede legacy-kopie. |
| A5 | Alleen een duurzaam gecommitte observation met een complete `PairingBinding` wordt observation; quota-vol, disabled, onvolledige `PairingBinding` of bouwfout betekent een **gewone legacy-laprow vanaf het begin**. Een ontbrekende `LapContext` alleen is geen weigeringsgrond. | `observation`-afwezigheid is een capturebeslissing, geen mislukte serialisatie. |
| A6 | De sidecar is één atomic snapshot-bestand met `pending`/`deferred`/`quarantine`; delivery verwijdert de entry in dezelfde commit. Er is geen tweede bestand en geen "twee bestanden atomair"-claim. | Een sidecar-commit kan de gewone queue niet impliciet wijzigen of weggooien. |
| A7 | De oude DLL opent alleen het vaste pad `measurement-outbox.json`; hij enumereert de map niet en raakt `observation-ledger-v1.json` niet aan. | Rollback bewaart de sidecar bytegelijk; de oude DLL start met de gewone queue en zonder observationverzending. |
| A8 | De sidecar is **niet** de productiewaarheid en wordt niet geüpload, gedeployed of geëxporteerd zonder expliciete, getelde operatoractie. | Retentie/overflow zijn lokaal en zichtbaar; geen stille drop. |

De sidecar is dus geen "Outbox v2" en geen uitbreiding van het bestaande
bestand. Alle verwijzingen naar "Outbox v2" in de oorspronkelijke tekst zijn
hieronder vervangen door deze architectuur. De twee voor de hand liggende
alternatieven zijn expliciet verworpen: "additieve velden die de oude lezer
negeert" laat de oude lezer een bevroren OBS alsnog droppen, en een
"v1-projectie" zou de `RowJson`/UID/hash moeten wijzigen. Beide schenden A3/A4
en zijn geen veilige rollback.

## 2. Echte bronkaart

### 2.1 Identiteit en apparaat

| Noodzaak | Bestaande lokale bron | Herkomst | Status vandaag | Kleinste inpassing |
|---|---|---|---|---|
| `capture.deviceId` | `ConnectorSettings.DeviceId` (`ConnectorSettings.cs:16`), gezet uit `PairingResponse.DeviceId` (`TelemetryContracts.cs:71-77`, plugin `EnduranceConnectorPlugin.cs:1233`) | Server-issued device-UUID uit de pairingresponse | **aanwezig**; geen lokale freeze, geen outboxmetadata | Bij `StartLap` `PairingBinding` (device/owner/generatie) vastleggen; alleen bij een complete `PairingBinding` observation maken |
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
server is de enige autoriteit; de producer moet de `PairingBinding` alleen
**lokaal bevriezen** en nooit een token/device-relatie verzinnen.

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
| `pitRoad.value=true` | Alleen `TelemetrySample.OnPitRoad` (`LapAccumulator.cs:44`) uit een geaccepteerde tick; `BuildMeasurementSample` leest uitsluitend `channels.ReadBool("OnPitRoad")` (`EnduranceConnectorPlugin.cs:995`). `_pitLap` (`LapAccumulator.cs:297`) en `NotePitVisit`-fuel zijn **legacy-rijaggregaten** en nooit observationbron. | Ruw kanaal; de SimHub-propertyfallback zit alleen in `CaptureV3` (`:1548`), niet in het meetmonster | **positieve waarde aanwezig**; `false` wordt al null (`LapAccumulator.cs:364`) | `firstAt` van de eerste geaccepteerde `OnPitRoad==true` bijhouden; `_pitLap` niet gebruiken; nooit `false` emitteren |
| `refuel` | `TelemetrySample.FuelLitres` (`:31`), uit `CaptureValueRules.FuelLitres` (`CaptureValueRules.cs:28-35`) en `:999`; netto pitdelta in `PitResult.FuelAddedLitresObserved` (`PitServiceTracker.cs:91`, berekend `:293-316`) | Ruw brandstofniveau / netto bezoekdelta | **niveau aanwezig; netto delta niet geschikt** (mist partiële stappen, kan verbruik aftrekken) | Positieve stappen tussen opeenvolgende bekende samples in dezelfde sessie/segment bijhouden; som alleen positieve stappen |
| `driverNameContinuity` | `LapAccumulator.FirstDriverName` (`:200`, `:232`) en `_driverChanged` (`:298-303`); `DriverChanged` (`:363`) | SimHub-naam | **deels aanwezig**; lege namen worden genegeerd en de groep kan niet "onbekend" worden | Flag bijhouden of enig geaccepteerd sample een lege naam had; dan groep weglaten |
| rondevenster | `LapAccumulator.Close` (`:333-387`), `CoverageRules.Evaluate` (`MeasurementEvent.cs:688-722`) | Lokaal | **aanwezig** | Geen wijziging; observation gebruikt hetzelfde venster |

De bestaande `coverage`- en `sampleCount`-velden zijn **geen** vervanging voor
het observation-interval. Ze zijn per metriekgroep, tellen alleen die groep en
kunnen onderling verschillen. Het observation-interval gaat over alle
geaccepteerde samples van de ronde.

### 2.4 Outbox, sidecar en ACK

| Noodzaak | Bestaande lokale bron | Status vandaag | Kleinste inpassing |
|---|---|---|---|
| gewone laprij + UID + revisie | `OutboxEntry` (`MeasurementOutbox.cs:20-34`), `Enqueue` (`:211-231`), `EnqueueLap` (`:241-260`) | **aanwezig**; `RowJson` wordt één keer bij enqueue geserialiseerd; alleen voor legacy-rijen | Ongewijzigd laten; observation krijgt zijn eigen entry in de sidecar, met dezelfde UID-factory maar nooit in deze lijst |
| normale persistente wachtrij | `OutboxFileDto` (`:144-155`), `Load` (`:503-539`), `Restore` (`:541-571`), `SaveLocked` (`:579-627`) | **aanwezig**; `Version=1`, 32 laps/512 KiB, `File.Replace` met **niet-atomaire `File.Copy`-fallback** en zonder `Flush(true)`; `SaveLocked` vergelijkt `json.Length` (UTF-16) | **Niet wijzigen**: geen `FileVersion=2`, geen observationveld. Legacy-durability/char-bug blijft een aparte, bestaande eigenschap (§5.2, §9.3) |
| observation-sidecar | Geen | **ontbreekt** | Nieuw `observation-ledger-v1.json`: één snapshot met eigen `version`, pending/deferred/quarantine, immutable `rowJson`, `PairingBinding` en lokale reden |
| restart | `InitMeasurementLayer` (`EnduranceConnectorPlugin.cs:876-899`), `Load` (`:883`) | **aanwezig** voor de gewone queue; zelfde UID/RowJson komen terug | Sidecar apart laden; oude DLL laadt hem nooit. Geen normalisatie of herserialisatie van `rowJson` |
| drain/plan | `Due` (`MeasurementOutbox.cs:295-314`), `MeasurementFramePlanner.Plan` (`MeasurementFrame.cs:74-122`), `SendAsync` (`:253-359`) | **aanwezig**; 3 laps/20 events/16.384 B metingen en 24.576 B body; alleen de gewone queue | Sidecar-pending toevoegen aan dezelfde planstap, maar nooit uit de 32-lapqueue; `Due` blijft legacy-only |
| ACK per rij | `MeasurementAckParser.Parse` (`MeasurementOutbox.cs:681-722`), `ApplyAck` (`:323-362`), `ApplySeries` (`:364-413`) | **aanwezig**; accepted/duplicate/superseded verwijderen, `stored:false` houdt alles; `rejected` verwijdert altijd | Per-rij terminale union (`Delivered`/`Deferred`/`Quarantined`/`NotDelivered`); sidecar-rijen via sidecar-commit, legacy via bestaand pad |
| afgekeurde rij | `ApplySeries` (`:401-412`) | **verwijdert de rij**, telt `RejectedLaps` en bewaart alleen `LastRejectionReason` in het ACK-object | Voor observation: nooit `Rejected*`-drop; classify naar Deferred of Quarantine. Legacy-rijen ongewijzigd |
| backoff | `MarkAttempt` (`:460-487`) | **aanwezig**; 2–60 s, max pogingen optioneel | Legacy ongewijzigd; sidecar heeft eigen `attempts`/`nextAttemptUtc` in dezelfde snapshot; nooit success-mark bij quarantaine |
| corrupt bestand | `Quarantine()` (`:649-660`) | **alleen hele-bestand-kopie** van `measurement-outbox.json` | Niet hergebruiken voor de sidecar; sidecar heeft één begrensde preserve-slot en fail-closed policy (§5.2) |
| quota | `OutboxLimits.MaxLaps=32`, `MaxStoredBytes=512 KiB` (`:37-47`) | **aanwezig**; `Add` evict `target[0]` bij vol | Sidecar: 64 unieke observation-entries/1 MiB UTF-8, onafhankelijk; nooit 64+32=96 |
| send-fence | Geen | **ontbreekt**; token wordt bij capture gesnapshot en later zonder hercontrole gebruikt (`EnduranceConnectorPlugin.cs:773-816`, `:2290-2329`) | `SendEnvelope` + observation-sendlease/coordinator; zie §4.4 |
| atomaire sidecar-commit | Geen | **ontbreekt** | Eén snapshot: temp + `Flush(true)` + close + `File.Replace`/atomic rename, geen copy-overwrite; zie §5.2 |

## 3. Veldkaart voor `payload.lapSummaries[i].observation`

De vorm is die van `ObservationV1` (`supabase/functions/_shared/observationV1.ts:103-132`).
Toegestane rootkeys: `version`, `capture`, `interval`, `pitRoad?`, `refuel?`,
`driverNameContinuity?`, `context?`. `version`, `capture` en `interval` zijn
verplicht; minstens één feitgroep moet aanwezig zijn.

### 3.1 `capture`

| Wireveld | Bestaande bron | Inpassing | Runtimebewijs |
|---|---|---|---|
| `capture.deviceId` | `Settings.DeviceId`, server-UUID uit pairing | UUID-formaat eerst; bij `StartLap` in de `PairingBinding` bevriezen; alleen emitteren bij een complete `PairingBinding` | Pairingcontract, geen live meting nodig |

### 3.2 `interval` (7 stats)

| Wireveld | Regel | Bestaande bron | Status |
|---|---|---|---|
| `firstSampleAt` | ISO-UTC, 3 decimalen; **eerst gequantiseerd** uit `StartedAtUtc` met `WireFormat`; binnen rijvenster | `StartedAtUtc` | **beschikbaar** |
| `lastSampleAt` | idem, `>= first` **na quantisatie** | `LastSampleUtc` | **beschikbaar** |
| `samples` | integer 1..1.000.000; `samples==1` ⇒ `first==last` en `maxGap==0`; `samples>1` ⇒ gequantiseerde `last>first`; anders wordt de observation niet gebouwd | nog geen totaal | **lokale plumbing** |
| `maxGapSeconds` | max gap tussen opeenvolgende geaccepteerde **gequantiseerde** samples binnen `[first,last]`; exacte milliseconden | alleen per groep | **lokale plumbing** |
| `unknownSeconds` | conservatieve ondergrens: `>= edgeBefore+edgeAfter`; bij `maxGap>1,0` ook `+maxGap`; `<= venster`; exact decimaal, geen EPS/clamp | geen | **lokale plumbing** |
| `edgeBeforeSeconds` | `firstSampleAt - startedAt`; bij deze producer is de eerste tick de start, dus **0** | `StartedAtUtc` | **afgeleid, 0** |
| `edgeAfterSeconds` | `endedAt - lastSampleAt`, exact en niet negatief; geen clamping om een ongeldige waarde te verbergen | `EndedAtUtc`, `LastSampleUtc` | **lokale plumbing** |

`unknownSeconds` is een ondergrens, geen volledigheidsclaim. De producer mag
geen "0" als "complete ronde" presenteren; 0 betekent alleen "geen getelde
gap boven de drempel/geen edge".

**Quantisatie is de rekenbasis, niet de ruwe `DateTime`.** Alle tijden die in
de intervalberekening ingaan — `firstSampleAt`, `lastSampleAt`, de edge-facts
en de row-`startedAt`/`endedAt` — worden eerst met
`MeasurementTime.WireFormat` naar exact drie decimalen UTC geformatteerd en
daarna als exacte UTC-milliseconden teruggelezen. `maxGapSeconds`,
`unknownSeconds` en de edges worden uitsluitend uit die gequantiseerde
waarden berekend. Er is geen binaire epsilon, geen `Math.Round(num*1e9)`, geen
clamping en geen afronding die een ongeldige waarde geldig maakt.

Als `samples>1` maar de gequantiseerde `firstSampleAt` en `lastSampleAt` gelijk
zijn, wordt **geen observation gebouwd**: de builder weigert
(`observation_bounds_inconsistent`) en de laprow gaat als gewone legacy-rij
door. `samples` blijft het werkelijke aantal geaccepteerde punten; er worden
geen punten samengevoegd, verzonnen of uit de telling verwijderd om een tijd
te repareren. De server gebruikt dezelfde `.fff`-instantie en verwerpt
`first==last` met `samples>1`; de lokale builder mag die afwijzing niet
uitstellen tot de POST.

Alle observation-tijden worden met `MeasurementTime.WireFormat`
(`MeasurementIds.cs:198-205`) als UTC met exact drie decimalen geschreven:
`yyyy-MM-dd'T'HH:mm:ss.fff'Z'`. Er is geen lokale tijd, geen offset en geen
`Date.parse` in het productiepad. Ontbrekende tijd = groep weglaten; geen
`DateTime.MinValue` of `0` als tijd.

### 3.3 `pitRoad`

| Wireveld | Regel | Bestaande bron | Status |
|---|---|---|---|
| `value` | **alleen `true`**; `false`/`0` is een rijafwijzing | uitsluitend een geaccepteerd `TelemetrySample.OnPitRoad == true` | **positief beschikbaar** |
| `firstAt` | eerste geaccepteerde sample met `OnPitRoad==true`, gequantiseerd en binnen interval | nog niet bewaard | **lokale plumbing** |

`_pitLap` is **geen** observationbron. `LapAccumulator.Add` zet die flag op een
`OnPitRoad`-sample, maar `NotePitVisit` zet hem ook bij een positieve
`fuelAddedLitresObserved` zonder `OnPitRoad`-sample in de ronde
(`LapAccumulator.cs:310-318`). Een ronde die begint bij het uitrijden van de
pit kan daardoor `PitLap=true` krijgen zonder één geldige
`OnPitRoad==true`-sample; dat is een legacy-rijaggregaat en mag nooit
`pitRoad.value=true` met een verzonnen `firstAt` opleveren.

De meting gebruikt raw `channels.ReadBool("OnPitRoad")` in
`BuildMeasurementSample` (`EnduranceConnectorPlugin.cs:995`); de SimHub-
propertyfallback bestaat alleen in `CaptureV3` (`:1548`) en wordt hier niet als
observationwaarheid gebruikt. Geen enkel pad mag `pitRoad:false` produceren.
Ontbreekt een `OnPitRoad`-waarde, dan is dat "onbekend", niet "niet op de
pitstraat"; de groep wordt dan weggelaten. `NotePitVisit`-fuel alleen levert
dus **geen** `pitRoad`-groep (test OB25/PL14).

### 3.4 `refuel`

| Wireveld | Regel | Bestaande bron | Status |
|---|---|---|---|
| `observedAddedLitres` | **>0 en <=300**; som van waargenomen positieve stappen, geen netto totaal | ruw `FuelLitres` | **lokale plumbing** |
| `firstAt` | tijd van de eerste positieve stap, binnen interval | geen | **lokale plumbing** |
| `positiveSteps` | integer 1..10.000 | geen | **lokale plumbing** |
| `resolutionLitres` | 0,001..1; **gedeclareerde wire-korrel**, niet een bewezen sensorresolutie | bestaande 3-decimalenafronding (`PitServiceTracker.cs:313-315`) | **declareren als 0,001** |
| `maxUndetectedLitres?` | optioneel; alleen als bewezen; `null` ongeldig | geen | **weglaten (UNKNOWN)** |

Een positieve stap mag **niet** over een onbekend sample, een segmentwissel,
een sessiewissel of een auto-/contextwissel heen worden berekend. Een
car/context-wissel binnen dezelfde ronde breekt de refuel-keten net zo hard als
een segmentwissel; de keten start pas opnieuw bij de eerste bekende
`FuelLitres` na de wissel (test OB26/PL15). `null` in
`FuelLitres` breekt de keten; de volgende bekende waarde start een nieuwe
keten. Een daling is geen negatieve brandstofficht en wordt niet van de som
afgetrokken. De netto `PitResult.FuelAddedLitresObserved` is **niet** de bron
voor dit veld. Een stap telt alleen als de delta na de gedeclareerde
3-decimalenkorrel ten minste 0,001 L is; kleinere ruis wordt niet als stap
geteld. Een car/context-wissel verwijdert **geen** reeds getelde positieve
stappen en geen bevroren `LapContext`; alleen de refuel-keten vanaf de wissel
begint opnieuw.

`refuel` wordt niet van `pitRoad` afgeleid: het is een waargenomen positieve
brandstofstap, niet "de auto stond in de pit". De twee groepen zijn
onafhankelijk. Een `FuelLitres`-nul is een geldige niveauwaarde maar geen
refuel-stap; een ontbrekende `OnPitRoad`-waarde wordt geen `false`.

### 3.5 `driverNameContinuity`

| Wireveld | Regel | Bestaande bron | Status |
|---|---|---|---|
| `value` | alleen `"unchanged"` of `"changed"`; descriptief, **geen** rijderidentiteit | `FirstDriverName` + `_driverChanged` | **deels; lege-naamflag toevoegen** |

- alle niet-lege namen zijn **na dezelfde trim/ordinal-normalisatie als
  `LapAccumulator.Add`** gelijk ⇒ `unchanged`;
- alle namen zijn bekend/niet-leeg en minstens één verschilt ⇒ `changed`;
- ontbreekt/leeg bij één geaccepteerd sample, of de normalisatie is niet
  eenduidig ⇒ **groep weglaten** (`driverNameContinuity` is alleen geldig als
  alle geaccepteerde samples een bekende, niet-lege naam hebben).

De vergelijking gebruikt `StringComparison.Ordinal` op de getrimde namen, net
als de bestaande accumulatie (`LapAccumulator.cs:298-303`). Zonder die regel
kan `"A"` versus `"A "` ten onrechte `changed` worden terwijl de legacy-rij
`unchanged` zegt. De naam blijft descriptief en is nooit een rijderidentiteit.

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
Een ontbrekende of onvolledige `LapContext` maakt de `PairingBinding` **niet**
onvolledig en is op zichzelf nooit een reden om de hele observation te
weigeren; alleen de contextgroep vervalt (OB16/PL07/PL22). Ontbreekt daardoor
elke feitgroep, dan geldt de bestaande OBS-weigeringsregel voor een lege
observation onveranderd.

### 3.7 Velden die expliciet **niet** bestaan

`ownerUserId`, `ownerBasis`, `driverId`, `currentDriverName`, `driverChanged`,
`resetOrTow`, `compound`, `regime` en `complete` zijn geen wirevelden van
`observation`. `PlayerCarTowTime`, `SubSessionID` en `DriverInfo.Drivers[].UserID`
worden niet gebruikt; zie §7.

## 4. Identiteit, freeze en isolatie

### 4.1 Wat bij `StartLap` bevroren moet worden

Bij de eerste geaccepteerde tick van een ronde legt de producer twee
gescheiden records vast:

```
PairingBinding (identiteitsfence; alleen dit record bepaalt Close/Due/Send/ACK)
captureDeviceId        = Settings.DeviceId           (UUID, verplicht)
captureOwnerUserId     = Settings.BoundOwnerUserId   (UUID, lokaal verplicht)
pairingGeneration      = lokale teller               (verplicht, lokaal)
pairingGenerationKnown = true alleen bij een bewezen teller

LapContext (beschrijvende rondecontext; geen identiteitsfence)
observedSessionId      = de op dat moment bekende sessiestring
segmentId              = het op dat moment geldende segment
carId/trackId/trackName/trackConfig
sessionUniqueId?/sessionNumber?
```

`PairingBinding` is de **enige** capture-time fence. Een ontbrekende of
gewijzigde `LapContext` maakt de `PairingBinding` niet ongeldig, kan geen
gezonde oude OBS-queue na een sessiewissel quarantainen en is nooit een reden
om een observation te weigeren. `LapContext` wordt bij `StartLap` bevroren en
in de rij gebruikt; is hij onvolledig, dan vervalt alleen de contextgroep
(§3.6), niet de hele observation. Ontbreekt daardoor elke feitgroep, dan
geldt de bestaande OBS-weigeringsregel onveranderd.

De accumulator krijgt beide records bij constructie (`TelemetrySampler.StartLap`,
`:260-267`) en geeft ze bij `Close` mee aan `LapAggregate`.
`MeasurementPipeline` mag bij `EnqueueSummary` (`:235-242`) **niet** opnieuw
de actuele globale `_observedSessionId` invullen; `LapAggregate.ToSummary`
gebruikt de bevroren `LapContext`. `SegmentId` is al op de accumulator
bevroren; dat blijft zo. Een car/contextwissel midden in de ronde breekt de
refuel-keten (§3.4) maar verwijdert geen eerdere positieve feiten en geen
bevroren `LapContext`.

De `PairingBinding` is een **capture-time fence**. De observation-vs-legacy-
beslissing valt bij `Close`/`EnqueueSummary`, na het bouwen van een
voorlopige in-memory candidate maar vóór enige duurzame UID-publicatie,
reservering, persistentie of verzending (A3/A5, §5.1). Verandert de actuele
`PairingBinding` tussen `StartLap` en die beslissing, dan wordt geen
observation gebouwd en gaat de ronde als gewone legacy-rij door. Is er al een
observation duurzaam gecommit, dan geldt §4.3: nooit strippen, nooit een
nieuwe UID. Een wijziging van alleen `LapContext` valt hier niet onder.

### 4.2 `PairingGeneration`

`ConnectorSettings` bewaart een **lokale** nullable `long`-high-watermark plus
`ObservationPairingGenerationKnown`; de pairingresponse krijgt geen nieuw veld.
De fence is samengesteld uit device, owner, generatie en knownness, niet een
globale/servervolgorde. Een bewezen geldige teller wordt bij een geslaagde Pair
verhoogd; invalidatie bewaart de ruwe high-watermark maar wist autorisatie.
Dit is geen servercontract en gaat niet over de draad.

- **Bestaande paired install zonder teller:** de teller is afwezig. De plugin
  leest dat als `pairingGeneration=0` én `pairingGenerationKnown=false`; dat is
  een veilige onbekende, geen verzonnen generatie. G01 vereist een bekende
  generatie >0, dus zo'n installatie maakt **geen observation** tot een
  daadwerkelijk nieuwe re-pair de teller op 1 zet. Alleen de gevalideerde nieuwe
  exchange mag dit doen: device én raw token verschillen van de vorige identiteit
  waar beschikbaar, en de metadata is werkelijk afwezig (NULL, known=false,
  geen poisonmarker). De eigenaar mag gelijk blijven of veranderen. Load/restart,
  decrypt, control en ingest initialiseren niets; generieke
  `NextObservationGeneration()` adopteert nooit onbekende metadata. De legacy-rijen
  en automatische updates blijven normaal werken; re-pair is optioneel.
- **Volgorde:** Pair-validatie, protect en gecombineerde settings-save gebeuren
  **binnen de observation-sendlease** (§4.4) en de bestaande settingsgate.
  Device/owner/protected token/generatie/knownness worden samen opgeslagen vóór
  publicatie van memory token en hostidentiteit. Unpair/onzekerheid maakt oude
  autorisatie niet opnieuw geldig; oud queued werk blijft aan zijn identityobject
  gebonden. Alleen toekomstige StartLap mag de nieuwe fence gebruiken.
- **Persistfout:** als de nieuwe generatie niet duurzaam kan worden bewaard,
  wordt `pairingGenerationKnown=false` en gaat observation **dicht**; de
  bestaande legacy-queue en onafhankelijke legacy-send blijven ongewijzigd.
  De mislukte Pair zelf krijgt geen herstelde oude autorisatie. Protect/save,
  rollback-save, cancellation of onbekende uitkomst bewijzen geen serverundo of
  crash-atomiciteit. De lease blijft tot daadwerkelijke callbacksettlement;
  uitsluitend een bewezen late commit mag publiceren.
- **Bereik en bewijsbehoud:** bewezen tellers liggen in 0..9007199254740991;
  alleen een strikt hogere representeerbare opvolger is toegestaan. Een nieuwe
  afwezige teller start op 1, nooit verzonnen bekende 0. Negatief, boven bereik,
  maximum, NULL+known=true of present+known=false **zonder** gemarkeerde
  provenance wordt niet gereset/geadopteerd, ook niet door herhaalde Pair. De ruwe
  waarde blijft behouden bij weigering of failure. Eén additief OptionalField
  `ObservationPairingGenerationPoisoned` bewaart NULL+known-invalid nadat
  knownness wordt gewist; anders zou die corrupte toestand niet meer van
  werkelijke afwezigheid te onderscheiden zijn. Deze marker geeft geen autoriteit
  en heeft geen automatische reset. Een later werkelijk nieuwe identiteit is
  uitsluitend prospectief, nooit backfill van eerdere rondes, rijen of mislukte
  bindings.
- **Herstel na een mislukte Pair:** een gewone mislukte Pair wist autorisatie en
  knownness maar bewaart de ruwe teller. Invalidatie van een bewezen geldige,
  niet-gepoisonede teller (of van een werkelijk geprobeerde allocatie die na een
  mislukte save bewaard blijft) zet één additief OptionalField
  `ObservationPairingGenerationRecoverable`. Die prospectieve lokale markering
  overleeft herhaalde invalidatie en restart **uitsluitend** zolang de ruwe waarde
  veilig en niet-gepoisoned blijft; een ontbrekende historische markering blijft
  false, zodat een gewone `present+known=false` zonder markering gesloten blijft.
  Alleen dezelfde nieuwe-Pair-commitseam — na de bestaande responsevalidatie,
  freshness (nieuw device én raw token waar vorige waarden beschikbaar zijn), de
  bestaande settingsgate en hostlease — mag de **strikt hogere opvolger** van de
  gemarkeerde high-watermark verbruiken en samen met device/owner/token duurzaam
  opslaan vóór publicatie. Geen reset naar 1, geen herstel van de oude
  generatie/binding en geen generatie uit load/restart/control/ingest/decrypt/
  Unpair. Op 9007199254740991 bestaat geen opvolger: gesloten zonder
  wrap/clamp/erase. De markering is prospectief lokaal bewijs, geen
  serverautoriteit of enrollment, en machtigt op zichzelf geen capture: een
  lokale fence vervangt de aparte identity-scoped policy-/receiverstatus niet.

### 4.3 Isolatie bij token-/device-/accountwissel

- Bij `StartLap`: als één van de vier `PairingBinding`-velden (`DeviceId`,
  `BoundOwnerUserId`, generatie, `pairingGenerationKnown`) onvolledig is,
  wordt **geen observation** gemaakt; de laprow blijft legacy. Een ontbrekend
  of onvolledig `LapContext` is **geen** bindingsfout: alleen de contextgroep
  vervalt (§3.6).
- Bij `Close`: als de actuele **`PairingBinding`** niet gelijk is aan de bij
  `StartLap` bevroren `PairingBinding`, wordt **geen observation gebouwd**. De
  laprow zelf blijft geldig en gaat als gewone legacy-rij door; er wordt niets
  achteraf in een al geserialiseerde rij geschreven. Een gewijzigde
  `LapContext` (sessie, segment, car/track) valt hier **niet** onder: de
  bevroren context blijft in de rij en de observation blijft geldig.
- **Vóór duurzame publicatie:** de keuze observation of legacy is definitief
  vóór enige duurzame UID-publicatie, ledger-reservering, persistentie of
  verzending. Een observation-candidate mag in geheugen al een voorlopige UID
  en geserialiseerde bytes hebben; die zijn niet gepubliceerd en niet
  gereserveerd (§5.1). Na een geslaagde commit krijgt observation zijn
  sidecar-entry; legacy krijgt een gewone `OutboxEntry`. Dezelfde
  `(UID, recordRevision)` komt nooit in beide lanes.
- **Na bevriezing:** een duurzaam gecommitte observation-entry wordt nooit
  gestript, nooit herserialiseerd, nooit van een nieuwe UID voorzien en nooit
  alsnog als legacy aangeboden. Een **`PairingBinding`**-wissel of
  serverafwijzing leidt tot sidecar-quarantaine met de exacte `rowJson`. Een
  wijziging van alleen `LapContext` quarantineert geen gezonde rij.
- **Bij `EnqueueLap` met observation:** de sidecar-commit is de enige
  persistentie. De gewone `MeasurementOutbox` krijgt deze rij niet te zien.
- **Bij `Due`/planning:** een observation-entry waarvan de **`PairingBinding`**
  niet gelijk is aan de actuele `PairingBinding` wordt **niet verzonden**. De
  exacte `rowJson` gaat in dezelfde sidecar-snapshot naar `quarantine` met
  reden `capture_binding_changed`; de teller is zichtbaar. Een nieuwe sessie,
  een nieuw segment of een andere car/track is **geen** dergelijke wissel.
  Legacy-laprijen lopen gewoon door.
- **Na een herstart:** dezelfde regel blijft gelden; een oude rij wordt nooit
  met het nieuwe token/device gecombineerd. Een nieuwe actieve sessie is geen
  `PairingBinding`-wissel: bestaande oude OBS-rijen worden met hun bevroren
  `LapContext` gedraind (§5.3, PL16/PL23).
- **Rollback:** een oude DLL kent de sidecar niet en laat hem bytegelijk staan
  (§4.5). Observation-rijen worden dan niet verzonden; ze zijn niet stil
  gedropt.

Deze splitsing verslapt de serverautoriteit **niet**. De server blijft de
authenticatieautoriteit: de tokenopzoeking in `context.ts` levert de
geauthenticeerde device-UUID, en `capture.deviceId` moet daarmee
overeenkomen. De lokale `PairingBinding` voorkomt dat de producer zelf een
verkeerde combinatie aanbiedt; ze vervangt de servercontrole niet. Een zuiver
server-side owner-rebind zonder lokale pairingupdate is voor de producer niet
zichtbaar; de server resolveert owner bij ontvangst en blijft daarvoor de
autoriteit. De producer claimt dus geen accountisolatie die hij niet kan
meten. Een al vertrokken HTTP-request kan niet meer worden teruggehaald; de
lease voorkomt alleen dat de **lokale** pairingtransitie en de OBS-send
tegelijk lopen.

### 4.4 `SendEnvelope` en observation-sendlease

De bestaande productieroute `EnduranceConnectorPlugin.SendV3Async`
(`:2290-2329`) snapshot het token bij capture (`:773-816`) en post later zonder
nieuwe `PairingBinding`-controle; `AcknowledgeMeasurements` (`:2351-2368`)
past de ACK zonder generatiecheck toe. `MeasurementSender.SendAsync`
(`MeasurementFrame.cs:253-359`) is de **testroute**, niet de productiecaller.
Beide moeten dezelfde regel gebruiken. De volgende concrete grens vervangt de
losse "check vlak vóór POST"-formule:

1. **Eén coordinator/lease.** Er is één `ObservationSendCoordinator` met een
   async `SemaphoreSlim(1,1)` (geen `Monitor` over een await, geen GUI-thread-
   block). De lease wordt vastgehouden over:
   - de lokale `Pair`-HTTP + settingscommit,
   - `Unpair` en DPAPI-token-clear,
   - één observeerbare OBS-poging: plan → envelope → bounded POST → ACK-commit.
   `Pair`/`Unpair` nemen de lease **vóór** hun eerste token-/settingswijziging
   en houden hem tot de pairingresponse en de commit klaar zijn. Zo racet een
   lokale pair-HTTP/server-rebind niet met een oude OBS-send. De GUI blijft
   responsief omdat alles async en bounded is; de leasewachttijd is begrensd en
   een time-out betekent `Deferred`, geen quarantine en geen send.
2. **Immutable `SendEnvelope`.** Onder de lease wordt één onveranderlijke
   envelope gebouwd met:
   - `token` (alleen in geheugen; nooit in sidecar, log, `RowJson` of schijf),
   - de volledige **`PairingBinding`** (`deviceId`, `ownerUserId`,
     `pairingGeneration`/`epoch`, `pairingGenerationKnown`),
   - de batch-`(uid, recordRevision, rowJson)`-lijst.
   De envelope is de enige bron voor de POST en de ACK-commit; er wordt niet
   opnieuw uit globale settings gelezen tijdens de request. De historische
   `LapContext` zit alleen in `rowJson`; de envelope vergelijkt hem **niet**
   met de actuele sessie/segment/car/track.
3. **Drie fences, uitsluitend op `PairingBinding`.** Capture-time: §4.1.
   Plan-time: entries met een andere `PairingBinding` gaan naar quarantaine.
   Send-time: direct vóór de `HttpRequestMessage` wordt de envelope
   `PairingBinding` nogmaals met de actuele settings/generatie vergeleken; bij
   verschil wordt **niet gepost** en gaan de exacte rijen in dezelfde
   sidecar-commit naar `capture_binding_changed`. Een verschil in
   `LapContext` (nieuwe sessie, segment of car/track) is geen fence en leidt
   nooit tot quarantaine of weigering.
4. **ACK-epochcheck.** De ACK wordt alleen onder dezelfde lease en tegen
   dezelfde epoch gecommit. Is de epoch/generatie gewijzigd, of is de ACK
   stale/onparseerbaar, dan volgt **geen** delivery-cleanup en worden geen
   OBS-records weggegooid: de entry blijft `pending`/`deferred` met een
   zichtbare `ack_stale_epoch`-diagnose. Alleen een bekende lokale
   **`PairingBinding`**-wijziging quarantineert de exacte rij; een
   `LapContext`-wijziging doet dat nooit.
5. **Time-out is geen mislukte serverwrite.** Na een requesttime-out,
   cancel of verbroken response blijft de entry met dezelfde UID, revisie en
   `rowJson` staan en wordt hij opnieuw aangeboden. De server dedupliceert op
   UID/revisie; er wordt nooit een nieuwe UID of hash verzonnen. Een
   geaccepteerde serverwrite die lokaal niet is bevestigd, blijft dus
   idempotent.
6. **Geen ontsnappingsclaim.** Als het request al extern is vertrokken, kan
   een latere `Pair`/`Unpair` het niet "onsend" maken. De servertokenautoriteit
   en de owner-at-receipt blijven de enige waarheid; de client belooft niet
   dat een onbekende server-side ownerwissel onmogelijk is.
7. **Legacy niet geblokkeerd.** De lease en het OBS-quotum gelden alleen voor
   observation. Gewone laprows/events gebruiken hun bestaande pad en worden
   niet door een volle sidecar, een OBS-timeout of een wachtende OBS-lease
   geblokkeerd. De lease wordt in een `finally` vrijgegeven; een mislukte
   send, een quarantaine-commit of een annulering laat hem niet achter. Ook
   bij een volle schijf geldt: de bestaande gecommitte sidecar-entries
   blijven, nieuwe observation-capture wordt geweigerd en de gewone
   legacy-lane houdt zijn bestaande gedrag.

### 4.5 Oude lezer, rollback en sidecar-preservatie

De oude DLL opent alleen het vaste pad
`%APPDATA%\3SM Endurance Connector\measurement-outbox.json`
(`EnduranceConnectorPlugin.cs:880-883`). `MeasurementOutbox.Load` leest
uitsluitend `_path` (`MeasurementOutbox.cs:503-539`), en `Quarantine()` kopieert
uitsluitend `_path` (`:649-660`). Er is **geen** directory-enumeratie en geen
tweede bestandsnaam in de oude code. Daarom kan de oude lezer
`observation-ledger-v1.json` niet openen, wijzigen, als `.corrupt` kopiëren of
als gewone wachtrij laden. Dat is geen aanname maar volgt uit de vaste paden.

| Scenario | `measurement-outbox.json` | `observation-ledger-v1.json` | Oude DLL | Nieuwe DLL |
|---|---|---|---|---|
| alleen gewone v1-queue | v1, bytegelijk | afwezig | leest normaal | leest normaal |
| gewone v1 + OBS-sidecar | v1, bytegelijk | pending/quarantine | leest alleen gewone queue; sidecar bytegelijk | leest beide |
| rollback na OBS | v1, bytegelijk | blijft staan | draait door zonder OBS; geen send, geen delete | hervat sidecar |
| sidecar met onbekende versie | v1, bytegelijk | **niet nullen**; hele bestand bewaren | negeert | fail closed: geen nieuwe OBS-capture; legacy loopt door; bounded preserve |
| sidecar corrupt | v1, bytegelijk | één begrensde preserve-slot; geen unbounded `.corrupt-*`-copies | negeert | fail closed; legacy loopt door |
| normale queue ooit v2 | **niet toegestaan** | n.v.t. | zou `load_version` + `.corrupt` doen (P18) | niet van toepassing |

- De normale `FileVersion` blijft **1**. Er komt geen observationveld in
  `OutboxFileDto`; `LastRejectionReason` bestaat daar niet en wordt daar niet
  geclaimd (P15). De sidecar heeft zijn eigen per-entry `reason`.
- Na rollback is heractivatie niet "flag weer aan": vereist zijn een
  compatibele Edge-schrijver, de voorwaartse P1-projectie en een sidecar die
  de nieuwe lezer begrijpt. Een SDK-geïnstalleerde release en DLL-installatie
  zijn aparte GO's. Deze docs-correctie wijzigt niets aan wire, core of S1.
- De sidecar wordt bij rollback **bewaard**, niet hernoemd en niet als corrupt
  gemarkeerd. Een oude DLL publiceren zonder dit coherente plan is expliciet
  verboden.

## 5. Observation-sidecar-trace: capture → reserve → persist → restart → drain → ACK → cleanup

### 5.1 Capturebeslissing, voorlopige candidate, reservering en enqueue

De volgorde is bindend en voorkomt zowel dubbele UID's als een mislukte
"observation" die alsnog legacy wordt. De **commitgrens** is de atomaire
sidecar-snapshot: alles daarvóór is een niet-gepubliceerde in-memory
candidate.

1. **Eligibility (preflight).** Settings `ObservationV1Enabled`, een complete
   `PairingBinding` met bekende generatie, een geldige bouwbaarheid (nog geen
   serialisatie) en een adviserende sidecar-telling (nog geen reservering).
   Een ontbrekende of gewijzigde `LapContext` is **geen** weigeringsgrond;
   hij bepaalt alleen welke contextgroep in de rij komt. Is de
   `PairingBinding` onvolledig of ontbreekt elke feitgroep, dan is de uitkomst
   **legacy vanaf het begin**; er wordt geen observation-UID gereserveerd en
   geen observation gebouwd.
2. **Bouw één voorlopige candidate.** De pure builder maakt het
   `observation`-blok en de laprow. De candidate krijgt een **voorlopige**
   UID en `recordRevision` en wordt één keer geserialiseerd
   (`RowJson = record.ToJson()`). Die bytes zijn nog **niet** captured, niet
   gereserveerd, niet gepersisteerd, niet verzonden en geen ledger-entry of
   identiteitsreservering. Na serialisatie wordt de candidate niet meer
   gemuteerd; een latere weigering strippt hem niet en hergebruikt zijn UID
   niet. De ruwe observation blijft het exacte, ongewijzigde deel van die
   `rowJson`.
3. **Reserveer op de werkelijke bytes, onder de ledgerlock.** De ledger meet
   de exacte UTF-8-snapshot alsof deze candidate is toegevoegd, inclusief
   `rowJson`, `PairingBinding`, state/reason-envelope, tellers en
   JSON-escaping. Elke entry krijgt een conservatief worst-state-budget dat
   alle toegestane states (`pending`/`deferred`/`quarantine`), de maximale
   lokale reason-code, de tellerbreedte en de vaste datumvelden dekt; dat
   budget volgt uit het schema en de getypeerde grenzen, niet uit een nieuwe
   willekeurige drempel. De som van de entry-budgetten plus de begrensde
   root-tellers en overhead moet binnen **64 unieke entries** en **1 MiB
   UTF-8** passen. Nog niet gecommitte reserveringen, ook bij een IO-retry,
   tellen in diezelfde begroting mee totdat hun uitkomst definitief is;
   een in-flight alias is dezelfde entry en telt niet extra.
   Past de candidate niet, dan wordt hij **zichtbaar verworpen**
   (`observation_capture_refused` plus teller), uit het geheugen verwijderd en
   vervangen door een **nieuwe gewone legacy-laprow vanaf de bron** met een
   eigen legacy-UID. De verworpen candidate-UID wordt nooit gepubliceerd of
   hergebruikt.
4. **Hercontroleer en commit atomair.** Vlak vóór de atomaire commit worden
   de actuele `PairingBinding` en het quotum opnieuw tegen dezelfde candidate
   gecontroleerd. Bij een `PairingBinding`-wissel of quotumoverschrijding
   wordt niet gecommit; de candidate wordt verworpen en de ronde gaat als
   **nieuwe** legacy-rij vanaf de bron door. Anders commit de ledger de
   volledige snapshot (temp + `Flush(true)` + `File.Replace`/atomic rename).
   Pas na die duurzame commit is de observation captured en staat hij als
   `pending` in de ledger. Er is geen `captured=true`-claim daarvóór.
5. **Legacy blijft gescheiden.** Een gewone laprow gaat via het bestaande
   `EnqueueLap`/`Add`-pad naar `measurement-outbox.json`. Een observation-rij
   komt daar nooit in; dezelfde `(UID, recordRevision)` bestaat dus maar in
   één lane.

Faalt de pure build vóór de reservering, dan gaat de ronde als gewone
legacy-rij door (`observation_build_refused`). Wordt de candidate door het
quotum geweigerd, dan geldt dezelfde zichtbare terugval: candidate weg,
nieuwe legacy-rij vanaf de bron, geen gepubliceerde OBS-UID. Faalt de
sidecar-commit door IO, dan rapporteert de ledger `NotCommitted`; zonder
duurzaam bewijs wordt geen captured succes of delivery geclaimd. Bij een
**definitief vóór de commit geweigerde** epoch-/quotumhercontrole geldt stap 4:
candidate en reservering vervallen zichtbaar en er mag een nieuwe legacy-rij
vanaf de bron ontstaan. Dit is geen IO-retry.
Bij een **onzekere** commit (crash of IO-fout) blijven dezelfde
UID/revisie/`RowJson` en hun reservering behouden; er wordt nog geen legacy-rij
gemaakt. Zoek eerst na herstel naar die UID/revisie. Een aanwezige duurzame
entry wordt geadopteerd; bij inmiddels gewijzigde `PairingBinding` volgt de
bestaande quarantaineprocedure, niet opnieuw verzenden. Alleen na definitief
bewijs dat niets gecommit is, kan de candidate bij een gewijzigde binding
worden geweigerd volgens stap 4. Bij ongewijzigde binding wordt dezelfde
candidate opnieuw geprobeerd. Zo kan één onzekere commit nooit zowel een
gecapturde OBS-rij als een vervangende legacy-rij publiceren.

De bestaande legacy-`EnqueueLap` houdt zijn huidige gedrag, inclusief de
bestaande eigenschap dat een mislukte `SaveLocked` niet als `false` wordt
teruggegeven (P19). Deze docs-correctie wijzigt dat normale pad niet en laat
de observation-sidecar daar ook niet van afhangen; een latere legacy-
durabilityfix is een aparte wijziging met eigen tests.

### 5.2 Sidecar: één atomic durable snapshot

De sidecar is één bestand:
`%APPDATA%\3SM Endurance Connector\observation-ledger-v1.json`. Hij heeft een
eigen `version` (nu `1`) en staat volledig los van
`measurement-outbox.json`. Een toekomstige schema-versie krijgt een nieuwe
versiegebonden bestandsnaam; een oudere lezer opent die nooit. Een volledige
snapshot ziet er conceptueel zo uit:

```json
{
  "version": 1,
  "savedAtUtc": "2026-11-12T12:00:00.000Z",
  "counters": { "captureRefused": 0, "quarantineTotal": 0, "deliveredTotal": 0 },
  "entries": [
    {
      "uid": "…",
      "recordRevision": 7,
      "state": "pending",
      "rowJson": "{…exacte laprow met observation…}",
      "reason": null,
      "captureDeviceId": "…",
      "captureOwnerUserId": "…",
      "pairingGeneration": 3,
      "pairingGenerationKnown": true,
      "enqueuedAtUtc": "2026-11-12T11:59:00.000Z",
      "attempts": 0,
      "nextAttemptUtc": null
    }
  ]
}
```

- `state` is `pending`, `deferred` of `quarantine`. `quarantine` heeft een
  duurzame per-entry `reason`; `deferred` heeft `attempts`/`nextAttemptUtc`.
  `rowJson` is de exacte, onveranderlijke payload; de ruwe observation is
  daarin bytegelijk aanwezig. Er is geen tweede payloadkopie die kan
  divergeren. De vier `capture*`/`pairing*`-velden zijn samen de
  **`PairingBinding`**; de `LapContext` staat uitsluitend in `rowJson` en
  wordt bij `Due`/send nooit als fence met de actuele context vergeleken.
  `reason` is een begrensde lokale code (§5.5), nooit een ruwe HTTP-body,
  exceptiontekst of onbegrensde serverstring.
- **Delivery verwijdert de entry in dezelfde snapshot-commit.** Er is geen
  aparte, onbegrensde delivered-tombstone. Een replay-ACK voor een afwezige
  UID is een `ack_unknown_uid`-diagnose en maakt de rij niet opnieuw aan;
  een server die na een crash vóór de commit opnieuw ziet, dedupliceert op
  dezelfde UID/revisie. Zo blijft de commit idempotent zonder een tweede
  levenscyclusbestand.
- **Commitprotocol:** serialiseer de complete snapshot naar UTF-8, schrijf
  `<file>.tmp` in dezelfde map, `Flush(true)` (duurzame flush), sluit de
  stream, en vervang het doel met `File.Replace(tmp, target, bak)`. Bestaat
  het doel nog niet, dan volgt een atomaire `File.Move(tmp, target)` op
  dezelfde volume. Er is **geen** niet-atomaire `File.Copy`-overwrite en geen
  "twee bestanden atomair"-claim.
- **Faalsemantiek:** faalt serialisatie of een IO-stap aantoonbaar vóór de
  atomaire switch, dan blijft de vorige gecommitte snapshot onaangeroerd.
  Bij een onzekere switch wordt de gecommitte staat eerst hersteld/uitgelezen
  volgens §5.1; de fout alleen bewijst niet welke snapshot duurzaam staat.
  Zonder die vaststelling wordt `NotCommitted` / `NotDelivered`
  gerapporteerd en geen captured succes geclaimd. De
  candidate blijft in memory als niet-gecommitte `NotCommitted`-staat en
  wordt niet als `pending`/captured gepubliceerd; de volgende commitpoging
  hergebruikt dezelfde UID/revisie/`RowJson`. Is de commit onzeker
  (crash/IO), dan wordt eerst in de ledger naar die UID/revisie gezocht en
  een al duurzaam aanwezige entry geadopteerd in plaats van een tweede entry
  of nieuwe UID te maken. Een verse file waarbij geen atomaire rename
  mogelijk is, gaat **fail closed**: observationcapture stopt zichtbaar;
  legacy loopt door.
- **Herstel:** bij startup is alleen een volledig gevalideerde `target`
  gezaghebbend. Een achtergebleven `*.tmp` is nooit gezaghebbend en wordt
  deterministisch genegeerd/opgeruimd. Ontbreekt of faalt `target`, dan wordt
  `*.bak` alleen gebruikt als die volledig valideert; daarna wordt de
  gebruikelijke commit uitgevoerd. Zo is herstel na elke crash eenduidig.
- **Onbekende versie of corrupt bestand:** niet nullen, niet stil vervangen.
  Het hele bestand wordt één keer bewaard in een begrensde preserve-slot
  (`observation-ledger-v1.preserved`) en observation gaat fail closed; de
  gewone queue blijft laden en doorlopen. Een tweede preserve overschrijft de
  eerste niet; er ontstaan geen onbegrensde `.corrupt-*`-kopieën.
- **Budget en reservering.** Het budget wordt gemeten op de exacte
  UTF-8-serialisatie van de snapshot (dus inclusief `rowJson`, ruwe
  observation, `PairingBinding`, lokale `reason`, counters en JSON-escaping),
  niet op `string.Length` en niet op een schatting. 64 unieke
  `(uid, recordRevision)`-entries en 1 MiB zijn de harde bovengrens voor
  **alle** states samen; een in-flight alias is dezelfde entry. Per entry
  reserveert de ledger bij de eerste commit één conservatief
  worst-state-budget: de exacte `rowJson`-bytes plus de maximale
  entry-metadata (`uid`, `recordRevision`, de volledige `PairingBinding`,
  `enqueuedAtUtc`, `attempts`, `nextAttemptUtc`), de duurste
  state/reason-envelope over `pending`/`deferred`/`quarantine`, de
  tellerbreedte en de vaste datumvelden. De root heeft alleen `version`,
  `savedAtUtc`, de drie begrensde tellers en de entries-array; er is geen
  vrije metadata of append-history. Het budget volgt uit het schema en de
  getypeerde/enumerated waarden, niet uit een nieuwe numerieke drempel.
  Vóór **elke** state-commit serialiseert de ledger de werkelijke
  candidate-snapshot en verifieert `actualBytes <= reservedBudget <= 1 MiB`
  en `uniqueEntries <= 64`. Metadata en ruwe observation worden nooit
  geclamped; een `pending`-payload wordt nooit geëvict om ruimte voor een
  reden te maken. Past een overgang niet, dan wordt hij zichtbaar geweigerd
  en blijft de entry in zijn vorige state.
- **Legacy-durability blijft baseline.** `measurement-outbox.json` houdt zijn
  `Version=1`, 32-lapqueue, 512 KiB-charvergelijking en de bestaande
  `File.Replace`/`File.Copy`-fallback zonder `Flush(true)`. Deze correctie
  claimt niet dat die char-bug is gefixt; ze voorkomt alleen dat de
  observation-sidecar er een tweede, onduidelijke transactie bovenop legt.
  Een latere normal-file-correctie moet zijn eigen multibyte-512KiB-regressie
  en save-fouttest meenemen; die is hier expliciet **buiten scope**.
- **`LastRejectionReason`:** dat lid bestaat niet in `OutboxFileDto` en wordt
  door `Load` niet hersteld (P15). De normale file bewaart alleen
  `LastDropReason`; de sidecar bewaart de reden per entry. De oude
  "overleeft een herstart"-claim over `LastRejectionReason` is hiermee
  gecorrigeerd, niet als toekomstige belofte.

### 5.3 Restart en state recovery

- `InitMeasurementLayer` (`EnduranceConnectorPlugin.cs:876-899`) laadt eerst de
  gewone queue (`Load`, `:883`) en daarna de sidecar. Een fout in de sidecar
  mag de gewone queue niet leegmaken of blokkeren.
- `Load` op de gewone queue blijft `Version == 1` eisen en `rowJson` bytegelijk
  herstellen. De sidecar wordt nooit in `measurement-outbox.json` geschreven.
- Een entry die tijdens de crash `pending`/`deferred` was, komt terug als
  `pending` met dezelfde UID, revisie en `rowJson`; `attempts`/`nextAttemptUtc`
  blijven behouden. Er wordt geen tweede entry voor dezelfde UID/revisie
  gemaakt en de reservering wordt niet dubbel geteld.
- Een entry die tijdens de crash in flight was, wordt na herstart opnieuw
  aangeboden. Dat is veilig: de server dedupliceert op UID/revisie en de
  `rowJson`/hash is niet gewijzigd. Een time-out of crash is geen bewijs dat
  de serverwrite faalde.
- Een onbekende sidecar-versie of corrupte snapshot wordt volgens §5.2
  bewaard en fail-closed behandeld; de gewone queue en legacy-send blijven
  werken. De plugin start niet met een lege sidecar alsof er niets was.
- Na de herstart is de actieve sessie nieuw; bestaande UID's en rijen worden
  bij de volgende frames gedraind. De bevroren `ObservedSessionId` in de rij
  blijft de oude waarde (test O10/PL16/PL23). Dit is **geen**
  `PairingBinding`-wissel en geen quarantainegrond: oude sessie-/segmentrijen
  worden met hun bevroren `LapContext` verzonden.

### 5.4 Drain en plan

- `Due(now, maxEvents, maxLaps)` (`MeasurementOutbox.cs:295-314`) blijft
  **legacy-only**. De sidecar levert zijn eigen `pending`/`deferred`-entries
  op `nextAttemptUtc`.
- De observation-sendlease (§4.4) wordt genomen vóór het bouwen van de
  `SendEnvelope`. Daarna worden de actuele `PairingBinding` en generatie
  nogmaals gecontroleerd; een mismatch gaat in dezelfde sidecar-commit naar
  quarantaine en wordt niet gepost. Een gewijzigde `LapContext` is geen
  mismatch.
- `MeasurementFramePlanner.Plan` (`MeasurementFrame.cs:74-122`) kiest eerst
  de gewone legacy-laps/events binnen de bestaande maxima (3 laps, 20 events,
  16.384 B metingen, 24.576 B body, UTF-8); sidecar-`pending`/`deferred` vult
  daarna de resterende slots. Een OBS-entry verdringt nooit een due
  legacy-rij; past hij niet, dan blijft hij in de sidecar `deferred`. Zo
  kunnen observation-rijen en legacy-rijen in hetzelfde frame zitten, maar
  komen ze uit hun eigen lane en hebben ze nooit dezelfde UID/revisie.
- De productiecaller is `EnduranceConnectorPlugin.SendV3Async` +
  `AcknowledgeMeasurements` (`:2290-2368`). `MeasurementSender.SendAsync`
  (`MeasurementFrame.cs:253-359`) is de testroute. Beide gebruiken dezelfde
  per-rij-terminalregel en dezelfde sidecar-commit; de productiecaller wordt
  expliciet in §6 en §8.3 getest. `MeasurementSender.SendAsync` wordt **niet**
  als productiecaller gelabeld.
- Een volle sidecar blokkeert geen gewone laprows en een gewone 32/33-evictie
  kan geen observation-entry raken: die staat niet in die lijst.

De ACK-`index` van een afgewezen rij verwijst naar de **oorspronkelijke,
volledige aangeboden batchvolgorde** vóór de splitsing in OBS- en
legacy-rijen. De caller bouwt daarom één geordende offer-lijst van alle
aangeboden rijen (OBS en legacy samen), resolveert `id`/`index` daartegen en
routeert pas daarna per rij naar de sidecar-ledger of de bestaande legacy
`ApplySeries`. Een index mag nooit tegen een legacy-only lijst worden
geresolveerd; een afwijzing van de ene UID verwijdert nooit een andere UID
(test OQ34, mixed `[OBS, legacy, OBS]`).

### 5.5 ACK: per-rij terminale uitkomst

`MeasurementAckParser.Parse` (`MeasurementOutbox.cs:681-722`) leest
`measurements.events`/`measurements.laps`. Ontbreekt `measurements`, dan is
het frame geen leveringsbewijs (`ack_without_measurements`) en wordt niets
opgeruimd. `ApplyAck`/`ApplySeries` blijven voor **legacy**-rijen het bestaande
dropgedrag houden. Voor sidecar-rijen geldt de volgende union, per rij:

| Serveruitkomst | Terminaal | Sidecar-actie | `Stored`/`MarkAttempt` |
|---|---|---|---|
| `accepted` | `Delivered` | entry in dezelfde snapshot verwijderen | succes alleen voor deze rij |
| `duplicate` | `Delivered` | idem; geen tweede entry | succes alleen voor deze rij |
| `superseded` met `record_revision >= lokaal` | `Delivered` | idem | succes alleen voor deze rij |
| `accepted`/`duplicate`/`superseded` met lagere revisie | `NotDelivered` | entry blijft; `KeptForNewerRevision` | geen succes |
| `stored:false` of geen `measurements` | `NotDelivered` | niets verwijderen; blockError bewaren | geen succes |
| tijdelijke afwijzing (tabel hieronder) | `Deferred` | entry blijft; `attempts++`, bounded backoff, dezelfde UID/revisie/`rowJson` | geen succes |
| permanente afwijzing (tabel hieronder) | `Quarantined` | `state=quarantine` + duurzame reden in dezelfde commit | geen succes, geen retry |
| onbekende afwijzing | `Quarantined` (fail closed) | als permanent; nooit legacy-drop | geen succes |
| legacy-afwijzing | bestaand `Rejected*` | gewone queue, bestaand dropgedrag | legacy telt apart |

**Alleen** `accepted`/`duplicate`/`superseded` met
`record_revision >= lokaal` zijn `Delivered`. De per-rij-union is
`Accepted | Duplicate | Superseded | Deferred | Quarantined | NotDelivered`;
alleen de eerste drie (met de revisie-eis) worden `Delivered`. `Stored=true`
alleen als elke aangeboden observation-rij `Delivered` is; een geaccepteerde
legacy-rij wordt intussen gewoon per rij opgeruimd. De frame-`Stored`-waarde
wordt dus uit de per-rij-union opgebouwd, **niet** uit
`remaining.Count == 0`. Een slechte observation-rij maakt `Stored` frame-breed
false, maar draait een al geldig geleverde legacy-rij niet terug.
`MarkAttempt` wordt nooit met succes aangeroepen voor een `Deferred`-,
`Quarantined`- of `NotDelivered`-rij, ook niet als de UID uit de
pending-lijst is verdwenen.

Na prefixnormalisatie (strip `payload.lapSummaries[i].`/`lapSummaries[i].`,
trim, stabiele code) zijn dit de observed-row non-ACKs:

| Klasse | Codes/fragmenten | Actie |
|---|---|---|
| tijdelijk, automatisch herstel | `observation is unavailable`, `observation_unavailable`, `contains unknown fields` (Edge `off`) | `Deferred`, exponentiële/bounded backoff, dezelfde frozen identiteit; geen gebruikersvraag |
| permanent | `observation_device_mismatch`, `observation_device_invalid`, `auth_device_invalid`, `observation_null`, `observation_invalid`, `row_invalid`, `revision_conflict`, `stale_revision`, en `observation is invalid: CODE` na prefixnormalisatie | `Quarantined`, reden bewaren, geen retry |
| onbekend | elk ander fragment | `Quarantined` (fail closed), nooit naar de legacy-drop |

De Edge-vorm `${path}.observation is invalid: <code>` wordt dus eerst van zijn
padprefix ontdaan en daarna op de stabiele suffix geclassificeerd;
`contains unknown fields` is de generieke `off`-vorm. Een nieuwe, nog niet
genoemde code valt per definitie in `Quarantined` en kan niet als
`Rejected*`-legacy verdwijnen. Een ruwe, bouwtechnisch ongeldige observation
wordt al vóór serialisatie geweigerd en is dan een gewone legacy-rij vanaf het
begin; een eenmaal bevroren observation wordt nooit alsnog legacy.

De actuele parser-/SQL-codes `observation_invalid_version`,
`observation_invalid_type`, `observation_invalid_integer`,
`observation_invalid_number`, `observation_invalid_timestamp`,
`observation_invalid_uuid`, `observation_invalid_text`,
`observation_invalid_control`, `observation_invalid_enum` en
`observation_absent` zijn expliciet **permanent** (`Quarantined`). De lijst is
illustratief, niet uitputtend: een niet-genoemde code blijft
unknown → `Quarantined`.

De sidecar bewaart als `reason`/diagnose uitsluitend een deterministische,
begrensde lokale code, nooit de ruwe HTTP-body, exceptiontekst of een
onbegrensde serverstring. De vaste codes zijn: `capture_binding_changed`,
`observation_capture_refused`, `observation_build_refused`,
`observation_unavailable`, `contains_unknown_fields`,
`observation_device_mismatch`, `observation_device_invalid`,
`auth_device_invalid`, `observation_null`, `observation_invalid`,
`row_invalid`, `revision_conflict`, `stale_revision`, `observation_absent`,
de negen vaste `observation_invalid_*`-categorieën hierboven, en
`server_rejected_unknown` voor elk overig fragment. Een onbekende
serverafwijzing mapt dus op één vaste lokale code en blijft `Quarantined`;
de classificatie blijft ook voor non-ACK-fouten veilig en er wordt geen ruwe
fouttekst onbegrensd gelogd, geen token/credential bewaard en geen serverbody
als bewijs bewaard.
De behouden bewijswaarde is de exacte `rowJson` + ruwe observation + lokale
code. Een optionele, begrensde diagnostic is toegestaan maar geen contracteis.

**Quarantaine is een sidecar-statecommit, geen delivery.** De exacte
`rowJson` en reden worden in dezelfde snapshot gecommit; er volgt geen
`MarkAttempt`-succes en geen `Delivered`-teller. Een stale/epoch-mismatch-ACK
of een requesttime-out leidt niet tot cleanup of discard: de entry blijft
`pending`/`deferred` en wordt met dezelfde identiteit opnieuw aangeboden.

### 5.6 Cleanup en retentie

- Delivery/quarantaine/deferred zijn allemaal state-overgangen in dezelfde
  sidecar-snapshot. Er is geen tweede bevestigingsarchief en geen
  onbegrensde tombstone; een afwezige UID na delivery is definitief en een
  replay-ACK wordt alleen gediagnosticeerd.
- `deliveredTotal`, `captureRefused`, `quarantineTotal` en per-entry redenen
  zijn duurzaam. De gewone queue bewaart alleen zijn eigen
  `Dropped*`/`Rejected*`/`LastDropReason`; `LastRejectionReason` wordt daar
  niet geclaimd.
- Een observation-afwijzing blijft lokaal in quarantaine en bereikt de server
  **niet** als laprow. Een tweede "legacy"-kopie met een nieuwe UID wordt
  nooit gemaakt; dat zou dezelfde ronde dubbel identificeren en de
  immutable-UID-regel schenden. Alleen een nieuwe ronde die bij capture al
  zonder observation wordt gebouwd, is een gewone laprow.
- Quarantaine kent **geen automatische evictie**. Exporteren of wissen is een
  expliciete, getelde en goedgekeurde operatoractie; tot die tijd blijven de
  entries binnen 64/1 MiB staan en weigert de producer nieuwe
  observation-capture. Een mislukte sidecar-write gooit de gewone queue niet
  weg en een mislukte gewone save verandert de sidecar niet.

## 6. Kleinste inpassingsmatrix (voor de latere lokale bouw)

Geen van deze wijzigingen is nu uitgevoerd. De matrix is de kleinste set
bestanden/methoden die de volgende lokale bouw nodig heeft; ze is geen
P0–P8-plan.

### A. Pure observation-builder en DTO

| Bestand | Methode/plek | Kleinste wijziging | Waarom |
|---|---|---|---|
| `3SM.EnduranceConnector/MeasurementEvent.cs` | `MeasurementLapSummaryDto` (na `:146`) | Optioneel `Observation`-lid met `[DataMember(Name="observation", EmitDefaultValue=false)]` | Serializer moet het blok exact onder `lapSummaries[i]` zetten; afwezig blijft bytegelijk |
| `3SM.EnduranceConnector/MeasurementEvent.cs` | `MeasurementLapSummaryRecord` (`:436-470`), `ToDto` (`:478-525`) | `Observation`-recordveld + kopiëren in `ToDto` | De sidecar serialiseert de record; het blok moet vóór `ToJson()` vaststaan |
| nieuw `3SM.EnduranceConnector/ObservationCapture.cs` | pure types + `TryBuild(...)` | Observation-DTO's, caps, UTC/3-decimalen, UUID, interval-invarianten, geen onbekende sleutels | Eén pure, testbare plek; geen SimHub-referentie |
| `3SM.EnduranceConnector.DiagnosticsTests/MeasurementObservationCaptureTests.cs` (nieuw) | `Run(check)` | Positive/negative fixtures voor §8 OB-tests | Bewijst de pure builder zonder SDK |

### B. Ronde-accumulatie en freeze

| Bestand | Methode/plek | Kleinste wijziging | Waarom |
|---|---|---|---|
| `LapAccumulator.cs` | `LapAccumulator`-velden (`:194-234`) | `_acceptedSamples`, `_maxGapSeconds`, `_prevSampleAtUtc`, `_firstPitRoadAtUtc`, `_refuel...`, `_driverNameMissing`, `_observedSessionId`, contextvelden | Alle interval-/pit-/refuel-/contextfeiten komen uit dezelfde geaccepteerde tickstroom |
| `LapAccumulator.cs` | `Add` (`:249-307`) | Teller/gap/pitroad/refuel/naamflag/context bijwerken; geen waarde verzinnen bij `null` | `null` breekt de keten; `false`/`0` worden geen feit |
| `LapAccumulator.cs` | `Close` (`:333-387`) | `LapAggregate` vullen met de observation-bronstate en bevroren `LapContext`/`PairingBinding` | De builder draait op de afgesloten ronde, niet op globale flushstate |
| `LapAccumulator.cs` | `LapAggregate` (`:395-423`), `ToSummary` (`:457-492`) | `ObservedSessionId` (uit `LapContext`) en observation-source/`Observation` meenemen; `ToSummary` gebruikt de bevroren sessie | Geen flush-globale sessie meer |
| `TelemetrySampler.cs` | `StartLap` (`:260-267`) | `LapContext` + `PairingBinding` aan de accumulator meegeven | Freeze op de eerste geaccepteerde tick |
| `TelemetrySampler.cs` | `CloseCurrent` (`:269-275`) | Bevroren sessie meegeven aan `LapAccumulator.Close` | Ook bij sessie-/lapwissel de oude sessie houden |
| `MeasurementPipeline.cs` | `EnqueueSummary` (`:235-242`) | Geen actuele `_observedSessionId` meer doorgeven; laat de record de bevroren waarde gebruiken | Sluit het flush-gat |
| `TelemetrySample` (`LapAccumulator.cs:16-67`) | nieuwe contextvelden | `CarId`, `TrackId`, `TrackName`, `TrackConfig`, `SessionUniqueId?`, `SessionNumber?`, `PairingBinding`, `LapContext` | De plugin vult ze per tick; de sampler bevriest beide bij `StartLap` |

De accumulator bewaart de ruwe ticktijden voor de bestaande coverage, maar de
observation-builder quantiseert **altijd** eerst naar de `.fff`-wire-instanten
(§3.2). De quantisatie is geen accumulator-state en wordt niet uit de ruwe
`DateTime`-ticks hergebruikt.

### C. Sidecar, sendlease en ACK-classificatie

| Bestand | Methode/plek | Kleinste wijziging | Waarom |
|---|---|---|---|
| `MeasurementOutbox.cs` | bestaande `OutboxEntry`/`OutboxFileDto`/`Load`/`SaveLocked` | **Ongewijzigd** laten: `Version=1`, 32 laps/512 KiB, bestaande legacy-drop | Oude lezer en rollback blijven byte-stabiel; geen observationveld in dit bestand |
| nieuw `3SM.EnduranceConnector/ObservationLedger.cs` | snapshot-DTO + `TryReserve(candidateBytes)`, `Commit`, `Load`, `Recover`, `MoveToQuarantine`, `RemoveDelivered` | Eigen `version`; 64 unieke entries/1 MiB UTF-8; reservering op de geserialiseerde candidate vóór duurzame commit; één temp+`Flush(true)`+`File.Replace`/atomic rename; per-entry `rowJson`, `PairingBinding`, state, lokale reason, attempts; fail-closed preserve | Alle observation-lifecycle in één atomic snapshot, los van de gewone queue |
| nieuw `3SM.EnduranceConnector/ObservationSendCoordinator.cs` | async lease + `SendEnvelope` | Eén `SemaphoreSlim(1,1)` over `Pair`-HTTP/settingscommit, `Unpair`, DPAPI-clear en de bounded OBS-send/ACK; capture-/plan-/send-fence; stale-epochcheck | Geen check-then-POST-TOCTOU en geen GUI-block |
| `MeasurementFrame.cs` | `MeasurementFramePlanner.Plan` (`:74-122`) | Sidecar-`pending`/`deferred` toevoegen naast de gewone `Due`; nooit dezelfde UID in beide lanes; UTF-8-budgetten | Observation-rijen mengen met het frame zonder de 32-lapqueue te gebruiken |
| `MeasurementFrame.cs` | `MeasurementSender.SendAsync` (`:253-359`) | Zelfde per-rij-terminalregel en sidecar-commit als de productiecaller; nadrukkelijk **testroute** | Regressie/transporttests gebruiken dezelfde regel |
| `EnduranceConnectorPlugin.cs` | `SendV3Async` (`:2290-2329`), `AcknowledgeMeasurements` (`:2351-2368`) | `SendEnvelope` + lease; `accepted`/`duplicate`/`superseded` met revisie >= lokaal alleen `Delivered`; nooit succes-`MarkAttempt` bij Deferred/Quarantine | Dit is de echte productiecaller; de oude `remaining.Count==0`-regel is onveilig |
| nieuw `3SM.EnduranceConnector/ObservationAckClassifier.cs` | stabiele prefixnormalisatie + allowlist | Tijdelijke codes → `Deferred`; permanente/onbekende → `Quarantine`; legacy nooit classificeren | `auth_device_invalid`, `row_invalid`, `revision_conflict`, `stale_revision` mogen niet als legacy-drop eindigen |
| `MeasurementOutbox.cs` | `ApplySeries` (`:364-413`), `MarkAttempt` (`:460-487`) | **Alleen legacy**: bestaand drop-/backoffgedrag | Geen observation-rij komt hier nog; geen impliciete legacy-wijziging |

### D. Plugin-bedrading en instellingen

| Bestand | Methode/plek | Kleinste wijziging | Waarom |
|---|---|---|---|
| `ConnectorSettings.cs` | velden (`:7-111`) | `ObservationV1Enabled = false` (lokaal, default uit) + `PairingGeneration` (`long`) + `PairingGenerationKnown` (lokaal) | Veilige default; onbekende bestaande install maakt geen observation; geen server-/wirecontractwijziging |
| `EnduranceConnectorPlugin.cs` | `InitMeasurementLayer` (`:876-899`) | Na de gewone `Load` de sidecar laden; sidecarfout geïsoleerd van de gewone queue | Legacy blijft werken bij sidecar- of versiefout |
| `EnduranceConnectorPlugin.cs` | `BuildMeasurementSample` (`:961-1002`) | `LapContext` en `PairingBinding` vullen uit dezelfde bronnen als `CaptureV3` (`:1490-1495`, `TrackIdentityReader`); `OnPitRoad` raw-only | Context/sessie horen bij de tick, niet bij flush; geen `_pitLap` als observationfeit |
| `EnduranceConnectorPlugin.cs` | `PairCoreAsync` (`:1185-1265`), `Unpair` (`:1282-1322`), DPAPI-clear | Lease nemen **vóór** de eerste token-/settingswijziging en vasthouden over de pairing-HTTP + commit; generatie ophogen; persistfout/overflow ⇒ observation dicht | Lokale pair/server-rebind racet niet met een oude OBS-send; legacy blijft ongewijzigd |
| `EnduranceConnectorPlugin.cs` | `SendV3Async`/`AcknowledgeMeasurements` | Onder dezelfde lease: envelope, plan-/send-fence, ACK-epochcheck, per-rij-union | Productiecaller krijgt dezelfde veilige regel als de testroute |
| `ConnectorControlContracts.cs` | `KnownFeatures` (`:101-106`) | **niet nu** uitbreiden; een `observation`-feature is een apart servercontract | Geen clientflag verzinnen; server-first deploy blijft voorwaarde |

### E. Test- en projectbedrading (latere build)

| Bestand | Wijziging |
|---|---|
| `3SM.EnduranceConnector.DiagnosticsTests/MeasurementObservationCaptureTests.cs` (nieuw) | OB-tests uit §8.1, inclusief quantisatie, `_pitLap`-negatief, UTF-8-multibyte en same-millisecond |
| `3SM.EnduranceConnector.DiagnosticsTests/ObservationLedgerTests.cs` (nieuw) | OQ-tests uit §8.3: atomic snapshot, crash/restart, quota, preserve, oude-lezermatrix |
| `3SM.EnduranceConnector.DiagnosticsTests/MeasurementOutboxTests.cs` | Bestaande legacy O-tests plus regressie dat `measurement-outbox.json` `Version=1` en bytegelijk blijft |
| `3SM.EnduranceConnector.DiagnosticsTests/MeasurementPipelineTests.cs` | PL-tests voor freeze, context, lease/fence en `Pair` tijdens in-flight |
| `3SM.EnduranceConnector.DiagnosticsTests/MeasurementTransportTests.cs` | Fake-relay-antwoorden voor tijdelijke/permanente/onbekende codes; zowel `SendAsync` als `AcknowledgeMeasurements` |
| `3SM.EnduranceConnector.DiagnosticsTests/SettingsCompatibilityTests.cs` | Nieuwe lokale velden default uit/0/onbekend; generatie-persistfout en overflow |
| `3SM.EnduranceConnector.DiagnosticsTests/V3PayloadFixtureTests.cs` | Legacy frame bytegelijk zonder observation; sidecar verandert het frame niet |
| `3SM.EnduranceConnector.DiagnosticsTests/FaseDTests.cs` | Nieuwe testgroepen registreren |
| `3SM.EnduranceConnector/3SM.EnduranceConnector.csproj` | Nieuwe `.cs`-bestanden toevoegen (pas bij de latere build) |
| `3SM.EnduranceConnector.DiagnosticsTests/3SM.EnduranceConnector.DiagnosticsTests.csproj` | Nieuwe pure/testbestanden toevoegen (pas bij de latere build) |
| `tools/simhub-plugin/release.sh` | Nieuwe bestanden in de brace-lijst (pas bij een latere release; nu niet) |

## 7. Contractpoorten (P/F)

Deze poorten zijn de acceptatie voor de latere lokale bouw. Een FAIL blokkeert
de build; een "onbekend" wordt nooit als PASS of als `false`/`0` behandeld.

| # | Poort | PASS | FAIL |
|---|---|---|---|
| G01 | `PairingBinding` bij `StartLap` | `DeviceId` UUID (v1–v5, variant 8/9/a/b, case behouden) + `BoundOwnerUserId` UUID + **bekende** generatie >0; anders geen observation, laprow legacy. Een ontbrekende `LapContext` blokkeert niet; alleen de contextgroep vervalt | Observation met ontbrekende/partiële/onbekende `PairingBinding`, of een `LapContext`-wijziging die als bindingsfout wordt behandeld |
| G02 | `LapContext`-freeze | `ObservedSessionId` en `SegmentId` op `StartLap` bevroren; flush gebruikt die waarden; een latere sessie-/segmentwissel maakt de rij niet ongeldig | Flush gebruikt actuele globale sessie/segment, of een sessiewissel diskwalificeert/quarantaineert de oude rij |
| G03 | `sim-s0` | Niet als `sessionUniqueId` geparseerd; veld weggelaten | `sim-s0` → `0` of een verzonnen numerieke sessie |
| G04 | Interval/quantisatie | `samples>=1`; `samples==1` ⇒ `first==last`/`maxGap==0`; `samples>1` ⇒ gequantiseerde `last>first`; zelfde gequantiseerde first/last ⇒ geen observation; `maxGap`/`unknown` exact uit `.fff`-instanten | Ongeldige combinatie, ruwe-`DateTime`-rekenwerk of een volledigheidsclaim |
| G05 | `pitRoad` | Alleen een geaccepteerde `OnPitRoad==true` + `firstAt` binnen interval; `_pitLap`/`NotePitVisit`-fuel zijn geen bron | `false`, `0`, `firstAt` buiten interval, of een fuel-afgeleide `pitRoad` |
| G06 | `refuel` | Alleen positieve stappen; som >0; `positiveSteps>=1`; geen stap over `null`/segment-/sessie-/car-contextwissel; `maxUndetectedLitres` weggelaten | Netto totaal, negatieve stap, 0, of een verzonnen ondetectiegrens |
| G07 | Naamcontinuïteit | Alleen `unchanged`/`changed`; trim/ordinal zoals `LapAccumulator.Add`; lege/onbekende naam ⇒ groep weg | Driver-ID, owner, of een claim bij onbekende naam |
| G08 | Context | Alle vier verplichte velden aanwezig en geldig, of hele groep weg; optionele sessievelden alleen numeriek en sterk | Lege string/0/"unknown" als context, of `sim-s0` als uniek ID |
| G09 | Geen verboden feiten | Geen owner/PII, geen `resetOrTow`, geen `tow`, geen `driverChanged`, geen `complete` | Elk verboden veld op de draad |
| G10 | Bytebudget | Compacte observation <= **2048 UTF-8-bytes** (`MeasurementJson.Bytes`/`Encoding.UTF8.GetByteCount`); meting 16.384 B en frame 24.576 B; sidecar 1 MiB; groter ⇒ geen observation, geen strip | `string.Length`, 2049+ toch verzonden, of een ongemeten multibytewaarde |
| G11 | Legacy | Afwezig `observation` ⇒ exact de bestaande laprow/hash/ACK; `measurement-outbox.json` blijft `Version=1` | Een lege observation, een "no fact"-marker of een v2-legacybestand |
| G12 | `RowJson`-immutabiliteit | Na capture/sidecar-save/load/quarantaine bytegelijk; UID/revisie/ruwe waarden en de ruwe observation-string (UUID-case, tijdprecisie) ongewijzigd | Hervormen, strippen, opnieuw serialiseren of UID/revisie wijzigen |
| G13 | ACK-classificatie | `accepted`/`duplicate`/`superseded` (revisie >= lokaal) = `Delivered`; tijdelijke codes (`observation is unavailable`, `observation_unavailable`, `contains unknown fields`) = `Deferred` met auto-retry; permanente codes (`observation_device_mismatch`, `observation_device_invalid`, `auth_device_invalid`, `observation_null`, `observation_invalid`, `row_invalid`, `revision_conflict`, `stale_revision`, `observation_absent`, de vaste `observation_invalid_*`-categorieën, `observation is invalid: CODE`) = `Quarantined`; **elke onbekende code = `Quarantined` met vaste lokale code**; `index` resolveert tegen de volledige aangeboden batch, niet legacy-only | Afgekeurde observation als `Rejected*` verwijderen, als delivery tellen, een onbekende code laten vallen, of een mixed-index tegen de legacy-lijst verwijderen |
| G14 | Sidecar-begroting | 64 unieke observation-entries/1 MiB UTF-8 over pending+deferred+quarantine+inflight samen; per-entry worst-state-reservering en duurzame lokale reason-code; geen automatische evictie | Stille evictie, onbegrensde groei, dubbele telling, onbegrensde reason-tekst of verlies zonder teller/reden |
| G15 | Overflow/reservering | Candidate één keer serialiseren; reserveren op de **werkelijke** UTF-8-bytes plus worst-state-metadata; `PairingBinding` en quotum vóór atomic commit hercontroleren; bij vol zichtbaar weigeren (teller+reden) en een **nieuwe** legacy-rij vanaf de bron maken; nooit 64 quarantine + 32 outstanding = 96 | Reserveren op niet-bestaande future bytes, candidate strippen/hergebruiken als legacy, een gecommitte OBS-UID hergebruiken, metadata clampen of een pending payload evicten |
| G16 | `PairingBinding`-wissel/verzending | `SendEnvelope` + lease; capture-/plan-/send-fence uitsluitend op `PairingBinding`; oude observation-rijen nooit met nieuw token verzonden; stale ACK geen cleanup; `capture_binding_changed` naar sidecar-quarantaine; `LapContext`-wissel nooit quarantaine; legacy loopt door | Check-then-POST-TOCTOU, oude rij met nieuw device/account, een sessie-/carwissel als bindingsfout, of een stale ACK die een rij opruimt |
| G17 | Server-first/lokale proof | Productieactivering is een aparte GO (Edge `on` + DB-probe/flag, pas daarna producer); unit-/SI-proof draait alleen tegen een lokale synthetische Deno-parser + geïsoleerde DB-fixture; producer default uit | Productie-Edge/DB/env of een echte netwerkwrite gebruiken als unitproof, of producer aan terwijl server `off` is |
| G18 | Geen SDK-verzinsel | Alleen bronnen uit §2; `SubSessionID`/`UserID`/`PlayerCarTowTime` niet gebruiken zonder lokaal bewijs | Een onbewezen SDK-veld als feit op de draad |
| G19 | Exacte vorm | `version:1`; alleen de zeven toegestane rootkeys; `capture` alleen `deviceId`; `interval` alleen de zeven stats; geen onbekende subsleutel; `null` in een known veld = rijafwijzing | Extra key, verkeerde versie of `null` dat als "onbekend" wordt geaccepteerd |
| G20 | Sidecar-isolatie/rollback | `measurement-outbox.json` blijft v1 en bytegelijk; oude DLL opent alleen dat pad; `observation-ledger-v1.json` blijft bij rollback staan; onbekende sidecarversie ⇒ fail closed + bounded preserve; geen `FileVersion=2` | Normale queue naar v2, sidecar hernoemen/als corrupt wissen, of oude DLL publiceren zonder coherent plan |
| G21 | Atomic sidecar-commit | Eén snapshot; temp + `Flush(true)` + close + `File.Replace`/atomic rename; geen copy-overwrite; faal ⇒ `NotCommitted`/vorige snapshot; crash/restart idempotent, geen dubbele entry/budget/delivery | Niet-atomaire overwrite, "twee bestanden atomair"-claim, of een entry verliezen bij write-fout |
| G22 | Sendlease | Eén async coordinator serialiseert `Pair`-HTTP/settingscommit, `Unpair`, DPAPI-clear en de bounded OBS-send/ACK; GUI niet geblokkeerd; time-out ⇒ Deferred; legacy nooit geblokkeerd | Losse check vlak vóór POST, `Monitor` over await, of een pair die een oude OBS-send inhaalt |
| G23 | Generatie-start/persist/overflow | Bestaande install zonder teller ⇒ `known=false`, geen observation; re-pair zet 1; persistfout/overflow ⇒ observation dicht, legacy ongewijzigd | Verzonnen generatie 1, wraparound of observation aan met onbewezen teller |

De 1 MiB-sidecargrens wordt gemeten als de **volledige UTF-8-serialisatie van
de snapshot**, inclusief alle `rowJson`-payloads, de ruwe observation daarin,
`PairingBinding`, per-entry lokale reason, tellers en JSON-escaping; niet als
een gecomprimeerde of geschatte waarde en niet als `string.Length`. De
64-entry- en 1 MiB-grens gelden voor **alle** states samen (pending, deferred,
quarantine en in-flight alias). Per entry geldt daarnaast het van het schema
afgeleide worst-state-budget uit §5.2; er is geen extra numerieke drempel.
Retentie is binnen die grens onbeperkt: er is **geen automatische evictie**.
Exporteren of wissen is een expliciete, getelde operatoractie. Bij 64 entries
of 1 MiB weigert de producer een nieuwe observation-capture zichtbaar
(overflowteller plus reden), verwijdert de niet-gecommitte candidate en maakt
een nieuwe gewone legacy-rij vanaf de bron; gewone laprows blijven doorlopen.
De gewone 32-lapqueue is een aparte, onafhankelijke grens; 64 quarantine + 32
outstanding is nooit een geldige gecombineerde bovengrens.

## 8. P/F-testmatrix voor de latere lokale bouw

Alle fixtures zijn synthetisch en lokaal; geen SimHub/iRacing-runtime. De
builder-tests zijn pure C#; de server-interop-tests zijn Deno/SQL en draaien
alleen tegen een **lokale synthetische parser + geïsoleerde DB-fixture**, nooit
tegen een actieve productie-Edge, productie-env of productie-DB.

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
| OB19 | observation 2048 UTF-8-bytes, met multibyte-tekens | Accept; 2049 bytes → geen observation, geen strip |
| OB20 | tijden met sub-ms/100 ns-ruis | Exacte `.fff`-quantisatie; geen 7-cijferige productie, geen ruwe-tick-rekenwerk |
| OB21 | `unknown > venster` | Builder weigert; geen ongeldige emissie |
| OB22 | `samples=0`/`first>last` | Builder weigert |
| OB23 | fuel +0,0004 L | Geen stap (onder 0,001 L-korrel) |
| OB24 | eerste naam leeg, daarna A,B | Groep weglaten (geen `changed`/`unchanged`-claim) |
| OB25 | `NotePitVisit`-fuel >0 en `OnPitRoad=null` | Geen `pitRoad`-groep; `_pitLap` mag de observation niet dragen |
| OB26 | fuelstap over car/context-wissel | Geen stap; keten start pas na de wissel opnieuw |
| OB27 | `samples>1`, gequantiseerde first==last | Builder weigert (`observation_bounds_inconsistent`); laprow legacy |
| OB28 | 100 ns vóór/na een `.fff`-grens, positief en negatief | Quantisatie en edges exact; geen EPS/clamp; ongeldige edge ⇒ weigeren |
| OB29 | namen `"A"` en `"A "` | `unchanged` na trim/ordinal, gelijk aan de legacy-normalisatie |
| OB30 | sidecar-serialisatie met multibyte `rowJson` | 1 MiB-grens op UTF-8-bytes; 1 MiB+1 ⇒ geen capture, geen truncatie |

### 8.2 Pipeline/freeze (PL)

| # | Scenario | Verwacht |
|---|---|---|
| PL01 | sessie A bij start, B vóór flush | Rij gebruikt A; geen B |
| PL02 | sessie onbekend bij start, later bekend | Rij heeft geen `observedSessionId`; geen late B |
| PL03 | segmentwissel tijdens ronde | Oude ronde houdt oud segment; nieuwe ronde nieuw segment |
| PL04 | car/track wijzigt midden in ronde | Context blijft de bij start bevroren waarden |
| PL05 | device/owner wijzigt midden in ronde | Observation-groep weg; laprow legacy blijft |
| PL06 | accountwissel tussen enqueue en send | Sidecar-entry naar quarantaine `capture_binding_changed`; niet verzonden |
| PL07 | trackId ontbreekt bij start | Geen context; andere feiten blijven; laprow geldig |
| PL08 | lege driverName bij één sample | Geen `driverNameContinuity` |
| PL09 | `OnPitRoad` null bij deel samples | Alleen echte `true` telt; geen `false` |
| PL10 | fuelstap over rondegrens | Geen stap; state reset per ronde |
| PL11 | `Pair`/`Unpair` tussen plan en POST | Lease: of de send wint (pair wacht) of de pair wint (send ziet mismatch → quarantaine); nooit een oude rij met het nieuwe token |
| PL12 | `Pair` tijdens een in-flight HTTP-request | Pair wacht op de bounded send/ACK; geen settingsmutatie tijdens de request; ACK-epoch blijft geldig of wordt stale zonder cleanup |
| PL13 | DPAPI-clear tussen `StartLap` en `Close` | Geen observation; gewone legacy-laprow |
| PL14 | `NotePitVisit`-fuel zonder `OnPitRoad=true` | Geen `pitRoad`; `_pitLap` beïnvloedt de observation niet |
| PL15 | car/context-wissel midden in ronde met fuelstap | Geen refuel-stap over de wissel; keten start opnieuw |
| PL16 | crash/restart met pending en in-flight sidecar-entry | Eén entry per UID/revisie; opnieuw aanbieden met dezelfde `rowJson`; geen dubbel budget |
| PL17 | quota vol bij capture | `observation_capture_refused`; niet-gecommitte candidate verworpen; **nieuwe** gewone legacy-laprow vanaf de bron; geen observation-UID gepubliceerd |
| PL18 | sidecar-commit mislukt na reservering | `NotCommitted`/niet verzonden; geen legacy-herschrijving; vorige snapshot blijft; legacy-queue loopt door |
| PL19 | oude DLL start met normale v1-queue + sidecar | Oude lezer laadt alleen de gewone queue; sidecar bytegelijk; geen OBS-send |
| PL20 | bestaande paired install zonder generatie | `known=false`; geen observation; re-pair zet 1; legacy blijft werken |
| PL21 | generatie-persistfout of overflow | Observation dicht; legacy ongewijzigd; geen wraparound/oude generatie |
| PL22 | `LapContext` ontbreekt of wijzigt, `PairingBinding` gelijk | Observation blijft geldig en verzendbaar; alleen contextgroep/refuel-keten beïnvloed; geen quarantaine en geen identiteitsverlies |
| PL23 | normale nieuwe sessie na restart met oude pending OBS | Oude OBS-rijen worden met bevroren `LapContext` gedraind; geen `capture_binding_changed`, geen quarantaine |
| PL24 | quota weigert een voorlopige candidate | Candidate-UID nooit gepubliceerd/gereserveerd; verse legacy-rij vanaf de bron met eigen UID; teller zichtbaar |
| PL25 | `LapContext`-wissel tijdens bouw, `PairingBinding` gelijk | Candidate blijft geldig; geen tweede UID; context blijft de `StartLap`-waarde |

### 8.3 Sidecar/quarantaine/ACK (OQ)

| # | Scenario | Verwacht |
|---|---|---|
| OQ01 | normale v1-queue enqueue → save → load | `RowJson` bytegelijk; UID/revisie gelijk (bestaand P07); sidecar onaangeroerd |
| OQ02 | accepted ACK | Sidecar-entry weg; `Delivered`; confirmed++ |
| OQ03 | duplicate ACK | Entry weg; duplicate++; geen tweede entry |
| OQ04 | superseded met gelijke/hogere revisie | Entry weg; superseded++ |
| OQ05 | ACK met lagere revisie | Entry blijft; `KeptForNewerRevision`; geen succes |
| OQ06 | `stored:false` | Niets verwijderen; blockError bewaard |
| OQ07 | 202 zonder `measurements` | Niets verwijderen; `ack_without_measurements` |
| OQ08 | `observation_unavailable` | `Deferred` met backoff; entry blijft; geen quarantine, geen `Rejected*` |
| OQ09 | `contains unknown fields` (Edge `off`) | `Deferred` met backoff; automatisch herstel zonder gebruikersvraag |
| OQ10 | `observation_device_mismatch` | `Quarantined`; exacte `rowJson` + reden; geen confirmed |
| OQ11 | `observation_invalid_version`/`observation_invalid_timestamp`/`observation_null` | `Quarantined`; producentbug zichtbaar; onbekende `observation_invalid_*`-suffix → vaste lokale `server_rejected_unknown` |
| OQ12 | legacy-rij afgekeurd (`wear_after_contract`) | Bestaand dropgedrag met teller (regressie) |
| OQ13 | 64 entries over pending+deferred+quarantine | Accept; 65e → `observation_capture_refused` vóór duurzame commit; gewone laprow gaat door; nooit 96 |
| OQ14 | 1 MiB UTF-8-snapshot | Exacte grens accept; +1 byte (multibyte) → overflow zichtbaar; candidate verworpen; geen truncatie |
| OQ15 | retentie/evictie | Geen stille evictie; alleen expliciete, getelde export/clear |
| OQ16 | restart na quarantaine | Quarantaine, state en tellers blijven; `rowJson` bytegelijk |
| OQ17 | `PairingBinding`-wissel vóór send | `capture_binding_changed`; niet verzonden; sidecar-commit; een `LapContext`-wissel geeft dit niet |
| OQ18 | legacy-rij na `PairingBinding`-wissel | Wordt gewoon verzonden |
| OQ19 | quarantaine-entry | `rowJson` en ruwe observation bytegelijk; geen reserialisatie |
| OQ20 | herstart na `PairingBinding`-wissel | Oude observation wordt niet met nieuw token/device verzonden; een nieuwe sessie alleen is geen wissel |
| OQ21 | onbekende afwijzingscode | `Quarantined` (fail closed); vaste lokale code; nooit legacy-drop |
| OQ22 | poging tot strippen/nieuwe UID na freeze | Geweigerd; dezelfde UID/revisie/`rowJson` blijft |
| OQ23 | sidecar-write mislukt | `NotCommitted`/`NotDelivered`; vorige snapshot blijft; geen captured succes; candidate blijft niet-gecommit in memory |
| OQ24 | sidecar met onbekende versie/corrupt | Hele bestand bounded bewaard; observation fail closed; gewone queue laadt en loopt door |
| OQ25 | oude DLL opent alleen `measurement-outbox.json` | Sidecar bytegelijk; geen directory-enumeratie, geen `.corrupt` van de sidecar |
| OQ26 | crash na commit vóór ACK; dubbele pending | Eén entry per UID/revisie; geen dubbel budget/delivery; retry idempotent |
| OQ27 | quota vol bij capture | Candidate verworpen; verse legacy-laprow vanaf de bron; geen observation-UID gepubliceerd; teller zichtbaar |
| OQ28 | stale/epoch-mismatch ACK | Geen delivery-cleanup, geen discard; entry blijft `pending`/`deferred`; `ack_stale_epoch` |
| OQ29 | requesttime-out terwijl server al schreef | Retry met dezelfde UID/revisie/`rowJson`; server duplicate; geen nieuwe hash |
| OQ30 | quarantaine-statecommit | Alleen sidecar-state; geen `Delivered`, geen succes-`MarkAttempt` |
| OQ31 | crash met `.tmp`/`.bak` | Alleen volledig gevalideerde target/bak; `.tmp` nooit gezaghebbend; deterministisch herstel |
| OQ32 | productiecaller `SendV3Async`/`AcknowledgeMeasurements` | Zelfde per-rij-union als `SendAsync`; `remaining.Count==0` alleen is geen succes |
| OQ33 | nieuwe lezer met normale v1-queue + eigen sidecar | Gewone queue bytegelijk geladen; sidecar-schema geladen; geen normalisatie of vermenging |
| OQ34 | mixed ACK-index `[OBS, legacy, OBS]` | `index` resolveert tegen de volledige aangeboden batch vóór splitsing; alleen de bedoelde UID wordt geraakt; geen legacy-only index |
| OQ35 | multibyte-entry en langste reason bij `deferred -> quarantine` | Werkelijke UTF-8-snapshot blijft <= gereserveerd worst-state-budget <= 1 MiB; geen truncatie/clamp |
| OQ36 | gelijktijdige reserve/commit van twee candidates | Onder de ledgerlock wordt tegen de laatste gecommitte snapshot gemeten; één wint, de ander ziet het nieuwe quotum; geen overshoot of dubbel budget |
| OQ37 | in-flight entry en telling | In-flight alias is dezelfde `(uid, recordRevision)` en telt één keer voor 64/1 MiB; geen tweede entry |

### 8.4 Server-interop (SI; lokaal, synthetische Deno-parser + geïsoleerde DB)

Deze tests draaien in een latere **lokale** stap tegen de echte parsercode en
een wegwerp-DB-fixture. Ze zetten geen productie-Edge, productie-env,
productie-DB, credential of featureflag aan. Productieactivering blijft een
aparte GO.

| # | Scenario | Verwacht |
|---|---|---|
| SI01 | producer-JSON in lokale Edge-parser `on` | `parseLapObservation` accept; `classify` accept |
| SI02 | producer-JSON in lokale parser `off`/`unavailable` | Rijafwijzing; geen frameabort |
| SI03 | `capture.deviceId` ≠ token-device | `observation_device_mismatch`; geen insert/P1 |
| SI04 | lokale DB-flag uit | `observation_unavailable`; geen ACK |
| SI05 | legacy zonder observation | v1-hash bytegelijk; geen kolomwijziging |
| SI06 | 2048 wire / 4096 jsonb, UTF-8 | Exacte grens accept; +1 geweigerd |
| SI07 | tijdelijke vs permanente codes uit de echte parser | `observation_unavailable`/`contains unknown fields` → Deferred; `auth_device_invalid`/`row_invalid`/`revision_conflict`/`stale_revision` → Quarantine |
| SI08 | 100 ns/sub-ms positief en negatief rond `.fff` | Parser en builder consistent; geen EPS/clamp; ongeldige grens wordt geweigerd |
| SI09 | `${path}.observation is invalid: CODE` | Prefixnormalisatie naar de stabiele code; onbekende suffix → Quarantine |

## 9. Feitelijk uitgevoerde proeven (nu)

Bronbewijsroot: `/home/hermes/artifacts/3sm/pitwall-learning-p2-producer-source/`.
Reviewprobes: `/home/hermes/artifacts/3sm/pitwall-learning-p2-producer-contract-review/`.
Alle onderstaande resultaten zijn echte exits; geen samengevatte aannames.
**Deze docs-correctie heeft geen nieuwe runtime-, net48-, SDK- of projectbuild
uitgevoerd.** De 299-meetlaagsubset is niet opnieuw gedraaid; dat is voor een
docs-only delta niet nodig en zou geen functionele GREEN-claim toevoegen.

### 9.1 Projectsbuild

```
dotnet build --no-restore
→ exit 1
→ NETSDK1004: obj/project.assets.json not found
→ 0 warnings, 1 error
```

Vastgelegd in `logs/dotnet-build-no-restore.out`. **NIET UITGEVOERD** als
projectsbuild; geen restore/install gedaan. Daarom is er **geen**
projectgroen-claim en geen net48-/SDK-bewijs; de `NETSDK1004` blijft een
blocker voor een latere build, niet iets dat deze docs-correctie oplost.

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
`logs/artifact-sha256.txt`. Dit is **source-level Roslyn** met net8-
refassemblies; het is geen net48-pluginbuild, geen SDK-installatie en geen
SimHub-runtimebewijs.

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
`logs/diagnostics-full-with-fixtures.out`. Dit is de bestaande, reeds
uitgevoerde run; deze docs-correctie herhaalt hem niet en claimt daarmee geen
groen voor de nieuwe sidecar- of leasecode.

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

`P05` en `P09` kijken alleen naar **publieke properties/reflection**; ze
bewijzen niet dat er geen private methode of veld bestaat. De conclusies dat
de observation-quarantaine/refusal-API en de all-sample/first-pitRoad/
first-refuel-state ontbreken, zijn pas na het lezen van de private bron
(`MeasurementOutbox.cs`, `LapAccumulator.cs`) houdbaar. De probes zijn dus
ondersteunend bewijs, geen volledig API-bewijs. `P13` bevestigt alleen de
bestaande 64-event/32-lap/512 KiB-legacygrenzen; de nieuwe sidecar
(64 observation-entries/1 MiB) is daar geen onderdeel van.

Vastgelegd in `logs/producer-source-probe.out`, `logs/probe-csc.out` en
`bin/ProducerSourceProbe.dll` (SHA256
`da5281ef27fabe4ce244cb4eb6dc283cf97a216ee770982cea84bd9fba5a117f`).

### 9.5 Reviewprobes P14–P20 (artifact-only, tegen dezelfde bron)

De review heeft met `bin/ContractProbe.dll` zeven extra contractpaden tegen de
al gecompileerde bron getest. `dotnet exec bin/ContractProbe.dll` gaf
**exit 0; SUMMARY PASS=7 FAIL=0**. De exacte output:

```
PASS P14 MaxStoredBytes is compared as UTF-16 chars: rowChars=944 rowBytes=1544
         fileChars=1243 fileBytes=1843 cap=1842 writtenBytes=1843 (actual SaveLocked uses json.Length)
PASS P15 OutboxFileDto members=Version,DroppedEvents,DroppedLaps,RejectedEvents,RejectedLaps,
         LastDropReason,Events,Laps (no LastRejectionReason; Load only restores LastDropReason)
PASS P16 shared MaxLaps=32 evicts oldest lap (DroppedLaps=1, LapCount=32, firstStillPresent=False)
PASS P17 stored:true observation_unavailable => Stored=True RejectedLaps=1 Removed=1 LapCount=0
         (SendAsync would see no remaining UID)
PASS P18 v2 file => LastPersistenceError=load_version LapCount=0 corruptCopy=1
PASS P19 EnqueueLap returned=True LastPersistenceError=save_failed:IOException
PASS P20 LapAccumulator.PitLap=true from NotePitVisit fuel despite OnPitRoad=null;
         observation pitRoad must not use _pitLap alone
```

Deze probes zijn **synthetische artifact-only contractproeven**, geen
SimHub/iRacing-runtime, geen net48-pluginbuild en geen serverbewijs. Ze
bevestigen de bestaande baseline die de sidecar-architectuur vermijdt:
`SaveLocked` meet UTF-16, `OutboxFileDto` heeft geen `LastRejectionReason`,
de 32-lapqueue evict, een `observation_unavailable`-afwijzing kan `Stored=true`
achterlaten, een v2-bestand wordt als `load_version` gekopieerd, `EnqueueLap`
meldt succes bij een save-fout, en `_pitLap` kan uit fuel ontstaan zonder
`OnPitRoad`. Bewijsroot:
`/home/hermes/artifacts/3sm/pitwall-learning-p2-producer-contract-review/`.

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

Deze lijst is de **contractscope voor een latere lokale P2/T13-bronbuild**. Ze
is geen nieuwe GO, geen fasepermissie en geen releasebeslissing; de ouder
beslist of die build start. De releasegates staan apart in §11.1.

1. **Pure builder eerst**: `ObservationCapture.cs` + DTO-lid + builder-tests
   (OB01–OB30), inclusief C1 (`OnPitRoad` only) en C3 (`.fff`-quantisatie).
   Geen SimHub-referentie.
2. **Ronde-accumulatie**: `LapAccumulator` uitbreiden met all-sample
   intervalstate, eerste pitroad-tijd, positieve brandstofstappen,
   lege-naamflag en bevroren `LapContext`/`PairingBinding`;
   `TelemetrySampler.StartLap` vult de freeze; `MeasurementPipeline.EnqueueSummary`
   gebruikt die freeze.
3. **Sidecar-ledger**: `ObservationLedger.cs` met één atomic snapshot,
   64 unieke entries/1 MiB UTF-8, reservering op de geserialiseerde candidate
   vóór duurzame commit, per-entry lokale reason, crashherstel en bounded
   preserve. `measurement-outbox.json` blijft `Version=1` en wordt niet
   uitgebreid.
4. **Sendlease en ACK**: `ObservationSendCoordinator` + `SendEnvelope` +
   `ObservationAckClassifier`; capture-/plan-/send-fence uitsluitend op
   `PairingBinding`, stale-epochcheck, per-rij-union en dezelfde regel in
   `SendV3Async`/`AcknowledgeMeasurements` en de `SendAsync`-testroute.
5. **Plugin-bedrading**: `ConnectorSettings` lokaal `ObservationV1Enabled=false`,
   `PairingGeneration`/`PairingGenerationKnown`; `BuildMeasurementSample` vult
   `LapContext`/`PairingBinding`; `Pair`/`Unpair`/DPAPI-clear nemen de lease en
   hogen de generatie op; persistfout/overflow sluit observation zonder legacy
   te raken.
6. **Testbedrading**: nieuwe pure testgroepen registreren in `FaseDTests`, de
   `.csproj`-lijsten bijwerken (pas bij de latere build), de bestaande
   299-meetlaagsubset plus de nieuwe OB/PL/OQ-tests draaien. De SI-tests draaien
   alleen tegen een **lokale synthetische Deno-parser + geïsoleerde DB-fixture**;
   geen productie-Edge, -env of -DB. Een echte netwerkwrite is geen unitproof.
7. **Pas daarna** een aparte build-/releasebeslissing. Dit document doet geen
   versie-, DLL-, updater- of publicatievoorstel.

### 11.1 Aparte releasegates (geen impliciete GO)

De volgende stappen zijn **niet** onderdeel van de lokale bronbuild en hebben
elk een eigen expliciete GO/ownerbeslissing:

- SDK-geïnstalleerde Windows/net48-build en pluginverificatie;
- een Edge-schrijver die de gekozen sidecar-/observationsemantiek kent;
- de voorwaartse P1-projectie na een rollback;
- productie-DDL en de Edge-featureflag;
- connectorpublicatie en DLL-installatie;
- een eventuele versie-/updaterbeslissing.

Deze correctie wijzigt geen wire, core of S1 en autoriseert geen van deze
gates. Ze zegt ook niet dat de lokale build al is goedgekeurd.

## 12. Closurematrix B1–B7 / C1–C3

Deze matrix is **DOC-dekking**, geen functionele GREEN-claim. De rechterkolom
noemt de tests die een latere build moet draaien; ze zijn hier niet uitgevoerd.

| Item | Contractdeel | Dekking | Latere test |
|---|---|---|---|
| B1 terminale delivery/`Stored` | §4.4, §5.4, §5.5, §6.C | Per-rij `Delivered`/`Deferred`/`Quarantined`/`NotDelivered`; alleen accepted/duplicate/superseded met revisie >= lokaal; geen succes-`MarkAttempt`; beide callers; mixed ACK-index tegen de volledige offer-batch | OQ02–OQ11, OQ21, OQ28, OQ30, OQ32, OQ34 |
| B2 sendfence/lease | §4.3, §4.4, §5.4, §6.C | `SendEnvelope`, één async lease over pair-HTTP/settings/DPAPI en bounded send/ACK; capture-/plan-/send-fence uitsluitend op `PairingBinding`; stale-epoch; timeout=geen mislukte write; `LapContext` nooit fence | PL06, PL11–PL12, PL22–PL23, OQ17, OQ20, OQ28, OQ29 |
| B3 atomic durable sidecar | §5.1–§5.3, §5.6, §6.C | Eén snapshot, temp+`Flush(true)`+replace/rename, fail-closed, vorige snapshot, crash-idempotent, per-entry lokale reason; geen `LastRejectionReason`-claim in de gewone file | OQ16, OQ19, OQ23–OQ26, OQ29, OQ31, OQ35 |
| B4 quota/reservering | §5.1, §5.2, §7 G14/G15 | 64 unieke entries/1 MiB UTF-8 over alle states; candidate één keer serialiseren; reserveren op werkelijke bytes + worst-state-budget; `PairingBinding`/quotum vóór atomic commit hercontroleren; quota-refusal → verse legacy vanaf bron; gewone 32-lapqueue onafhankelijk; nooit 96 | OQ13–OQ15, OQ27, OQ35–OQ37, PL17, PL24 |
| B5 oude lezer/rollback | §4.5, §5.2, §5.3, §7 G20 | Normale queue blijft v1; oude DLL opent alleen vast pad; sidecar blijft bij rollback; onbekende versie fail closed + bounded preserve | PL19, OQ24, OQ25, OQ33 |
| B6 UTF-8-caps | §3.2, §5.2, §7 G10 | 2048 observation, 16.384 meting, 24.576 frame, 1 MiB sidecar met `MeasurementJson.Bytes`; 512 KiB-legacybug blijft baseline | OB19, OB30, OQ14, SI06 |
| B7 lokale proof/scope | §8.4, §11, §11.1, §7 G17 | Alleen lokale synthetische Deno-parser + geïsoleerde DB; productieactivering/DLL/Edge aparte GO | SI01–SI09 |
| C1 `pitRoad` | §2.3, §3.3, §7 G05 | Alleen geaccepteerde `OnPitRoad==true`; `_pitLap`/`NotePitVisit`-fuel nooit observationbron | OB25, PL14 |
| C2 fail-closed codes | §5.5, §7 G13, §6.C | Tijdelijke codes → Deferred auto-retry; permanente/onbekende → Quarantine; actuele `observation_invalid_*`/`observation_absent` permanent; vaste lokale reason-code; prefixnormalisatie; geen legacy-drop | OQ08–OQ11, OQ21, SI07, SI09 |
| C3 quantisatie | §3.2, §7 G04, §8.1 | Alle stats/edges uit dezelfde `.fff`-instant; same-ms `samples>1` ⇒ geen observation; geen EPS/clamp | OB20, OB27, OB28, SI08 |
| Minor initial epoch | §4.2, §7 G23 | Bestaande install `known=false`; re-pair=1; mislukte Pair → strikte opvolger van gemarkeerde high-watermark; persistfout/overflow/max dicht; legacy ongewijzigd | PL20, PL21, PAIR-recover-* |
| Minor naam/refuel | §3.4, §3.5, §7 G06/G07 | Trim/ordinal; alle namen bekend; car/context-wissel breekt refuel | OB26, OB29, PL15 |
| Evidence-kwaliteit | §9.4, §9.5 | P05/P09 alleen publieke probes; P14–P20 exact; geen net48/SDK/projectgroen | n.v.t. (docs) |

**PRODUCTIEWIJZIGING: NEE.**
