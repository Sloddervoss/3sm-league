# T13-S2C1 — duurzame observation-ledger (losstaand, niet bedraad)

Status: **LOKAAL GEÏMPLEMENTEERD EN GETEST; NIET GEACTIVEERD.** Nieuwe
bibliotheek `ObservationLedger.cs` + `ObservationLedgerStore.cs`, echte
filesystemtests en dit ops-document. Geen plugin/settings/sampler/pipeline/
sender/ACK-bedrading, geen echte `%APPDATA%`-file, geen release of SDK-build.

## Doel en grens

De ledger is de opslag die nodig is vóórdat een observation gepubliceerd kan
worden: één begrensde snapshot `observation-ledger-v1.json`, los van
`measurement-outbox.json` (die blijft `Version=1` en bytegelijk). Een rij is
pas captured na een duurzame atomaire commit. Er is geen delivery-API: HTTP,
ACK-parsing, sendlease, mixed batch-index en pluginwiring blijven voor S2C2+.
`deliveredTotal` blijft daarom nul; quarantaine of een lege queue is nooit
leveringsbewijs.

## Bestand en schema

Pad (later door de plugin te kiezen):
`%APPDATA%\3SM Endurance Connector\observation-ledger-v1.json`.

```json
{
  "version": 1,
  "savedAtUtc": "2026-11-12T12:00:00.000Z",
  "counters": { "captureRefused": 0, "quarantineTotal": 0, "deliveredTotal": 0 },
  "entries": [{
    "uid": "…", "recordRevision": 7, "state": "pending",
    "rowJson": "{…exacte laprow met observation…}", "reason": null,
    "captureDeviceId": "…", "captureOwnerUserId": "…",
    "pairingGeneration": 3, "pairingGenerationKnown": true,
    "enqueuedAtUtc": "…", "attempts": 0, "nextAttemptUtc": null
  }]
}
```

- `state`: `pending` | `deferred` | `quarantine`.
- `rowJson` is de enige payloadkopie, één keer geproduceerd door
  `MeasurementLapSummaryRecord.ToJson()` en daarna nooit gestript,
  geherserialiseerd of van een nieuwe UID voorzien.
- `reason` is uitsluitend een vaste lokale code uit
  `ObservationLedgerReasons`; onbekende serverafwijzingen worden
  `server_rejected_unknown`. Geen HTTP-body, exceptiontekst of credential.
- `deferred` bewaart `attempts`/`nextAttemptUtc` en bij herstart wordt de
  state weer `pending` met behoud van die twee waarden. `quarantine` is
  terminaal en houdt zijn reden.
- Er is geen tweede bestand, geen history/tombstone en geen
  delivered-archief. Delivery verwijdert later de entry in dezelfde snapshot;
  die code bestaat in S2C1 bewust nog niet.

## API

- `ObservationLedgerCandidate.TryCreate(record, binding, enqueuedAtUtc, out diagnostic)`
  is de enige candidate-factory. Hij eist een echte `MeasurementLapSummaryRecord`
  met observation, een complete `PairingBinding` met bekende generatie, een
  geldige UID/revisie en een observation-device dat gelijk is aan de binding.
  Hij serialiseert exact één keer en houdt daarna geen verwijzing naar de
  muteerbare record vast.
- `ObservationLedgerStore(path[, fence])` laadt bij constructie; `Load()` is
  opnieuw uitvoerbaar. `Capture(candidate)` reserveert en commit. Zonder
  expliciete fence is de actuele binding onbekend en weigert capture veilig;
  de plugin moet later zijn echte lokale bindingview meegeven.
- `Defer(uid, revision, reason, nowUtc, nextAttemptUtc)` en
  `Quarantine(uid, revision, reason)` zijn de enige state-overgangen.
  `Entries`, `Find`, `EntryCount`, `CaptureRefused`, `QuarantineTotal`,
  `DeliveredTotal`, `ActualBytes`, `ReservedBytes`, `IsFailedClosed` zijn
  read-only diagnostiek.
- `ObservationBindingFence` is de gesynchroniseerde lokale bindingview.
  `Rebind` blokkeert tijdens de laatste check en de atomaire switch; een
  rebind kan daar niet tussen schuiven. De fence bewijst alleen
  host-metadata-coördinatie, geen externe serverownership.

## Reservering en quotum

- Eén ledgerlock meet de werkelijke UTF-8-snapshot alsof de candidate is
  toegevoegd: root, `rowJson` inclusief JSON-escaping, binding, state/reason,
  tellers, `attempts` en vaste UTC-datums.
- Per entry wordt één worst-state-budget berekend door de entry in
  `quarantine` te serialiseren met de langste toegestane reden,
  `int.MaxValue`-attempts, maximale generatie en vaste datumvelden. Dat budget
  dekt `pending`/`deferred`/`quarantine` en is daarom onafhankelijk van de
  actuele state.
- Voor iedere commit geldt `actualBytes <= reservedBudget <= 1 MiB` en
  `uniqueEntries <= 64`. Pending, deferred, quarantine én nog niet
  gecommitte reserveringen tellen mee; een alias met dezelfde
  `(uid, recordRevision)` telt één keer. Er is geen evictie, truncatie of
  stille drop.
- Dezelfde identiteit met dezelfde `rowJson` en binding is idempotent; met een
  andere payload of binding is het een conflict en wordt niets overschreven.

## Atomair schrijven en fouten

- Schrijf `<target>.tmp` in dezelfde map, `FileStream.Flush(true)`, sluit de
  stream, en vervang met `File.Replace(tmp, target, bak)`. Ontbreekt de target,
  dan volgt `File.Move(tmp, target)`. Geen `File.Copy`-overschrijving.
- Vóór de switch wordt de actuele binding en het quotum opnieuw gecontroleerd,
  binnen dezelfde fence als de switch.
- Een aantoonbare fout vóór de switch (`WriteTemporary`, `BeforeSwitch`) is
  `NotCommitted`; de candidate en reservering blijven voor een retry met
  dezelfde UID/revisie/`rowJson`. Het is geen captured succes.
- Een fout tijdens/na de switch is onzeker. De store leest de target terug:
  een volledig geldige entry met dezelfde identiteit wordt geadopteerd; een
  geldige target zonder die entry houdt de reservering en geeft
  `NotCommitted`; een onleesbare target maakt de store fail closed. Er komt
  nooit een tweede entry of een verse legacy-UID uit deze stap.

## Herstart en herstel

- Alleen een volledig gevalideerde target is gezaghebbend. Validatie omvat
  `version=1`, exacte root-/entrysleutels, typen, state/reason-enums, vaste
  UTC-datumvorm, UID/revisie/binding/`rowJson`-consistentie, unieke
  identiteiten, canonieke bytes, entryaantal en actual/worst-budget.
- `*.tmp` is nooit gezaghebbend. Bestaat alleen een orphan tmp zonder target
  of bak, dan faalt de store gesloten in plaats van een lege ledger te
  veinzen. Een tmp naast een geldige target wordt opgeruimd.
- Een ongeldige target wordt één keer als geheel bewaard in
  `observation-ledger-v1.preserved`; een bestaande preserve wordt nooit
  overschreven en er ontstaan geen `.corrupt-*`-kopieën. Daarna wordt alleen
  een volledig geldige `*.bak` via hetzelfde atomaire protocol hersteld.
  Zonder geldige bak blijft de store fail closed; nieuwe capture wordt
  geweigerd, de gewone queue loopt ongewijzigd door.
- Groottelimiet en UTF-8-decoding vinden plaats vóór deserialisatie; een te
  groot bestand wordt stroommatig naar de preserve-slot gekopieerd.

## Reparatie-erratum (B1-B4)

- Een reservering bewaart het exacte oorspronkelijke budget, de binding en de
  `rowJson`; de candidate-enqueuetijd is geen B1-identiteit en wordt niet in de
  reservering opgeslagen. Dezelfde UID/revisie met andere
  bytes is conflict, ook bij gelijk budget; het origineel blijft retrybaar.
- Een definitieve pre-switch pairing-/quotumweigering geeft de ongebruikte
  reservering vrij, maar pas nadat de target is teruggelezen. Staat de
  identiteit daar al met exact dezelfde bytes, dan wordt de volledige
  snapshot geadopteerd; is de target onleesbaar, dan blijft de store fail
  closed in plaats van mogelijk bewijs vrij te geven.
- Elke state-transitie gebruikt dezelfde zekerheid als capture: een
  after-switch fout leest de volledige snapshot met tellers terug en adopteert
  die bij overeenkomst. Zo blijft een duurzaam gecommitte quarantaine
  terminaal en kan een stale `Defer`/`Capture` die niet overschrijven.
- De preserve wordt eerst stroommatig naar `*.preserved.tmp` geschreven,
  duurzaam geflusht en daarna met eenzelfde-volume rename gepubliceerd. Een
  achtergebleven staging is nooit gezaghebbend; bij herstart wordt de intacte
  target opnieuw als geheel gekopieerd en de eerste complete preserve blijft
  onaangeroerd.

## Bewijs (echte exits)

Uitgevoerd in `/home/hermes/wt/pitwall-learning-p2-observation-ledger`, met
alleen offline/cached referenties. Bewijsroot:
`/home/hermes/artifacts/3sm/pitwall-learning-p2-observation-ledger/`.

| Commando | Exit | Resultaat |
|---|---|---|
| `--only-observation-ledger` | 0 | 35 PASS / 0 FAIL |
| `--only-observation-pipeline` | 0 | 37 PASS / 0 FAIL (oud) |
| `--only-observation` | 0 | 55 PASS / 0 FAIL (oud) |
| `--only-measurement` | 0 | 426 PASS / 0 FAIL (391 oud + 35) |
| volledige harness incl. 60 s soak | 0 | 782 PASS / 0 FAIL (747 oud + 35) |
| fixture-export + Deno-interop | 0 | 52 fixtures; 50 PASS / 0 FAIL |
| net48 C# 7.3-subsetcompile | 0 | `ObservationLedger-net48-subset.dll` |

De net48-compilatie is een **subset** van de gedeelde bron met Reference
Assemblies; dit is geen SimHubSDK-, Windows- of pluginbuild. Er zijn geen
benchmark- of productieclaims.

## OQ-matrix: uitgevoerd vs. gedelegeerd

| OQ | S2C1 |
|---|---|
| OQ01, OQ13, OQ14, OQ16, OQ19, OQ23, OQ24, OQ25, OQ26, OQ27, OQ30, OQ31, OQ33, OQ35, OQ36, OQ37 | **uitgevoerd** als store-/crash-/budget-/filesystemtest (zie `MeasurementObservationLedgerTests`, OL01–OL33) |
| OQ17 | **deels**: bindingwissel vóór de commit wordt geweigerd; de sendlease/`Due`-kant volgt in S2C2 |
| OQ22 | **deels**: andere payload/binding op dezelfde identiteit wordt geweigerd; er is nog geen sendpad dat zou kunnen strippen |
| OQ02–OQ07, OQ08–OQ12, OQ18, OQ20, OQ21, OQ28, OQ29, OQ32, OQ34 | **gedelegeerd** naar S2C2+: ACK-parser, per-rij-union, mixed offered-batch-index, sendlease, productiecaller en legacy-apply blijven ongewijzigd |
| OQ15 | **bewust afwezig**: geen retentie/evictie/export/clear-API; de grenzen zijn hard |

## Niet in S2C1

- Geen plugin-/settings-/sampler-/pipeline-wiring, geen echte
  `%APPDATA%`-file, geen gebruikersvlag of activatie.
- Geen HTTP, ACK-parser, `MarkAttempt`-succes, sendlease, delivery of
  `Stored`-claim; `deliveredTotal` blijft nul.
- Geen export/clear/evictie, geen tweede payloadkopie en geen mix met
  `measurement-outbox.json`.
- Geen SDK-/Windows-/net48-pluginruntime-bewijs, geen release/updater/versie/
  DB/Edge/UI/model/training-wijziging. `release.sh` is niet uitgevoerd.
- Open: S2B Q2 (hergebruik van een niet-UTC mutable sample) blijft open; hier
  is geen caller voor gewired.
