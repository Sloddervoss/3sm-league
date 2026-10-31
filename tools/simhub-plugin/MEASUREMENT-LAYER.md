# Meetlaag 0.7.2.0 — wat er is gebouwd en waar de plugin hem aanroept

Deze map bevat de meetlaag uit de brief (sectie 2) en het contract in
`docs/contracts/measurement-ids-v1.md`. Alles hier is **SimHub-vrij** en wordt door
`3SM.EnduranceConnector.DiagnosticsTests` gecompileerd en getest zonder sim, zonder
netwerk en zonder Supabase.

## Bestanden

| Bestand | Rol |
|---|---|
| `MeasurementIds.cs` | `eventUid`/`summaryUid` (UUID, één keer), leesbare labels (géén dedupe-sleutel), lokale ID-regels, wire-tijdnotatie |
| `MeasurementEvent.cs` | De wire-DTO's van `measurementEvents` en `lapSummaries`, de dekkinsregels en de compacte JSON-lezer/schrijver |
| `TelemetrySampler.cs` | Welke SDK-ticks meetellen: dubbele tick = één meting, 20 Hz-grens, echte intervallen |
| `LapAccumulator.cs` | Per ronde: temperatuur (mean/min/max), brandstof (start/eind/niveau-integraal), belasting (`|a_y|`, `a_y²`, `|a_x|`, max) en dekking per groep |
| `PitServiceTracker.cs` | Pitbezoeken op de ruwe `OnPitRoad`: intentie (flags, liters, banden per hoek) en resultaat (waargenomen brandstofdelta) apart |
| `TyreAnchorTracker.cs` | Wear-ankers met bewijs en confidence; geen bevestiging zonder refreshsignaal |
| `MeasurementOutbox.cs` | Begrensde persistente wachtrij met ACK per rij, backoff, expliciet verlies; bevat ook de ACK-lezer |
| `MeasurementFrame.cs` | Batchkeuze (20 events / 3 rondes / 16.384 B / 24.576 B), injectie in het frame, verzending |
| `ConnectorControlContracts.cs` | Capabilities en het begrensde beleid van `GET /simhub-control` |
| `ConnectorControlClient.cs` | Handshake, veilige defaults, cache, nooit blokkeren |
| `MeasurementPipeline.cs` | Bedrading: per tick sampler → pit → anker → outbox, plus de toewijzing van een pitbezoek aan de ronde |

## Aanroepen vanuit `EnduranceConnectorPlugin.cs`

De Windows-plugin bouwt alleen op een machine met SimHub, dus de integratie is hier
niet te compileren. Ze staat er wel in; dit is wat er staat en waarom het op deze
plek staat. Elke aanroep is apart te controleren met
`python3 check-measurement-wiring.py` (statische controle: bestanden in de csproj,
leden die echt bestaan, en of het monster vóór de pairing-poort wordt aangeboden).

### 1. Eenmalig, in `Init`

```csharp
var dataDirectory = Path.Combine(
    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "3SM Endurance Connector");
_measurementOutbox = new MeasurementOutbox(Path.Combine(dataDirectory, "measurement-outbox.json"));
_measurementOutbox.Load();                       // herstel na een herstart
_measurementPipeline = new MeasurementPipeline(_measurementOutbox, new MeasurementIdFactory());
_measurementSender = new MeasurementSender(_measurementOutbox, _http,
    () => ConnectorCapabilities.Implemented().ToJson(), MeasurementLimits.Default());
_controlClient = new ConnectorControlClient(new Uri(ProductionRelayBaseUrl), _http, string.Empty, () => DateTime.UtcNow);
_controlClient.LoadCache(Path.Combine(dataDirectory, "connector-control.json"));
```

### 2. Elke tick, in `DataUpdate` vóór de pairing/interval-poort

Samplen mag niet afhangen van `IsPaired` of `_sendBusy`; dat was nu juist de fout
(`TyreSnapshotTracker` werd pas na de poorten bijgewerkt).

```csharp
if (running && isInCar && data.NewData != null)
{
    var sample = BuildMeasurementSample(pluginManager, data);   // hieronder
    if (sample != null) _measurementPipeline.Observe(sample);
}
```

`BuildMeasurementSample` vult `TelemetrySample` uit `data.NewData` en de bestaande
lezers (`IrSdkMemoryReader` voor `SdkTick`, `LatAccel`, `LongAccel`, `PitSvFlags`,
`PitSvFuel`, `TireSetsUsed`; `RawChannelReader` voor `OnPitRoad`, temperaturen; de
bestaande wear-lezing voor `Wear`). Ontbreekt een kanaal, laat het veld dan `null`:
`0` is een meting, `null` is "de sim zei niets".

### 3. Bij verzenden, in `SendV3Async`

```csharp
var body = SerializeWithinBudget(envelope);
MeasurementBatchPlan plan = null;
var withMeasurements = _measurementPipeline == null
    ? null
    : _measurementSender.BuildBody(body, Encoding.UTF8.GetByteCount(body), DateTime.UtcNow, out plan);
if (withMeasurements != null) body = withMeasurements;
// ... bestaande POST met `body` ...
// na een 2xx, met de response-body gelezen:
if (plan != null && plan.HasMeasurements)
{
    var ack = MeasurementAckParser.Parse(responseBody, plan.Batch);
    _measurementOutbox.ApplyAck(ack, DateTime.UtcNow);
}
```

`MeasurementSender.SendAsync` doet planning, POST en ACK in één keer; gebruik die
als de plugin het frame niet zelf hoeft te posten. Belangrijk blijft: **geen
`ApplyAck` zonder de response-body**, en nooit opruimen op alleen de statuscode.

De plugin doet de POST zelf (het frame is al gebouwd) en doet daarna hetzelfde:
`MeasurementAckParser.Parse` + `MeasurementOutbox.ApplyAck` alleen na een geslaagde
response mét gelezen body. Een mislukte POST laat de rijen staan én markeert de
poging, zodat de backoff ingaat in plaats van elk interval opnieuw te zenden.

## Het frame draagt de meetserie zelf

`TelemetryEnvelopeV3` heeft er twee additieve leden bij: `schemaRevision` (uit
`MeasurementContract.SchemaRevision`) en `capabilities` (uit
`ConnectorCapabilities.Implemented()`, als object met één lid per feature).
`protocolVersion` blijft 3, en beide leden vallen weg als ze niet gevuld zijn
(`EmitDefaultValue=false`), zodat een frame zonder meetserie byte-identiek blijft
aan 0.7.x — de gouden fixture bewaakt dat.

Omdat de envelope de twee vaste leden nu zelf draagt, schuift
`MeasurementSender.BuildBody` ze er niet nog eens in: staat `schemaRevision` al in
de kern, dan gaan alleen `measurementEvents` en `lapSummaries` erbij. Twee keer
dezelfde sleutel in één object is geen geldige JSON.

## Wat de server ziet

Zie de commit-reeksen: `measurementEvents`, `lapSummaries`, `schemaRevision` en
`capabilities` staan als additieve leden in het bestaande V3-frame
(`protocolVersion: 3`). De veldnamen komen één-op-één uit
`supabase/functions/_shared/simhubExtensions.ts`; de grenzen uit sectie 8 van het
contract.
