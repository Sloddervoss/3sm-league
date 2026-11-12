# T13-S2A — pure observation-builder (local, inactive)

Status: **CORE-ONLY, LOCAL, ALLES NOG UIT.** Geen plugin-, sampler-, outbox-,
settings-, updater-, Windows-, SDK-, DB-, netwerk- of productiewijziging. Geen
release of activatie. De builder wordt nog nergens in de draaiende plugin
aangeroepen.

## Wat er nu lokaal is

- `ObservationCapture.cs`: pure accumulator met constante staat en één resultaat-DTO per ronde. API:
  `ObservationCapture.Build(binding, frozenContext, samples, rowStart, rowEnd)` en streaming `AddSample`/`Build`.
- `ObservationPairingBinding`: device/owner/generation/known, de enige
  capture-fence. Owner en generatie gaan niet over de draad.
- `ObservationLapContext`: bevroren StartLap-context, los van de fence.
- `ObservationSample`: geaccepteerd punt met UTC-tijd, optionele pit/fuel/naam
  en een ondoorzichtige contextKey voor de fuelketen.
- `MeasurementLapSummaryDto`/`MeasurementLapSummaryRecord` hebben een
  optioneel `observation`-lid. `ToDto`/`ToJson` dragen het alleen als het
  expliciet is gezet; null laat de sleutel weg. Geen productiepad vult het.
- Geen SDK-, klok-, bestands-, settings-, auth- of netwerkafhankelijkheid in de
  kern. Alleen bestaande `MeasurementTime`/`MeasurementJson` voor de wirevorm.

## Bewezen regels (lokaal)

- Tijden: UTC-only, exact `.fff`, integer milliseconden als rekenbasis; geen
  EPS/clamp. `samples>1` met gelijke gequantiseerde first/last wordt geweigerd.
- `maxGapSeconds` is de maximale interne gap; duplicaten blijven in `samples`.
  `unknownSeconds` = edges + (maxGap > 1,0 s ? maxGap : 0), nooit meer dan het
  rijvenster. Edges > 1 ms worden lokaal geweigerd omdat de bestaande
  serverclassifier die rij toch afkeurt.
- `pitRoad` uitsluitend uit `OnPitRoad == true`; nooit uit `_pitLap` of fuel.
- `refuel` is de som van positieve stappen met 0,001 L-korrel, niet het netto
  totaal. Null/NaN/Infinity/negatief breekt de keten; contextwissel breekt de
  keten maar bewaart eerdere stappen. `maxUndetectedLitres` wordt weggelaten.
- Namen: trim + ordinal op alle geaccepteerde punten; één lege/onbekende naam
  laat de groep vervallen. Alleen `unchanged`/`changed`, geen identiteit.
- Context: vier verplichte velden of de hele groep vervalt; optionele waarden
  alleen als bekend (0 is geldig). UTF-8-caps 64/128 bytes, controls geweigerd.
- Geen owner, driver-ID, reset/tow, `complete`, `pitRoad:false` of `refuel:0`
  op de draad. Minstens één feitgroep, anders geen observation.
- Wiregrens 2048 UTF-8-bytes wordt op de echte serializerbytes gemeten. Onder
  de v1-caps is die grens niet bereikbaar; de check blijft defensief.
## Bewijs (echte exits)

- Offline restore/build van `3SM.EnduranceConnector.DiagnosticsTests` met lege
  lokale source: restore exit 0, build exit 0.
- `--only-observation`: 42 PASS / 0 FAIL, exit 0.
- `--only-measurement`: 299 oude + 42 nieuwe = 341 PASS / 0 FAIL, exit 0.
- Volledige DiagnosticsTests: 697 PASS / 0 FAIL, exit 0 (inclusief 60 s soak).
- `net48` C# 7.3-subsetbuild van `MeasurementIds.cs` + `MeasurementEvent.cs` +
  `ObservationCapture.cs` met de echte reference assemblies: exit 0, 0 warnings.
  Dit is **geen** plugin-/SimHub-build.
- Echte C#-fixtures naar de bewijsroot, daarna ongewijzigde Deno-parser/
  classifier en `parseLapSummariesReport` in opt-in modus: 19 PASS / 0 FAIL,
  exit 0. `deno check` op `observationV1.ts` en het interopscript: exit 0.
  - accept: full context (UUID-case + Unicode), single sample, 1,2 s gap, context-only, refuel; quarantine: device-mismatch;
  - reject: edge-mismatch, row-window, same-ms (`samples=2`, first==last); legacy: omission bytegelijk aan de oude serializer;
  - envelope: legacy + observed samen in `on`, en `off` weigert alleen de observed rij.

## Bewust niet in S2A

- Geen `LapAccumulator`/`TelemetrySampler`/`MeasurementPipeline`-bedrading,
  geen freeze bij `StartLap`, geen auto-populatie van `observation`.
- Geen sidecar-ledger, reservering, sendlease, ACK-classificatie of retentie.
- Geen `ObservationV1Enabled`, pairing-generatie, UI, versie, updater, DLL of
  publicatie. Alle bestaande vlaggen blijven default UIT.
- Geen live SDK/iRacing-bewijs en geen volledige net48-pluginbuild. Windows/SSH
  en installed-DLL-verificatie blijven een latere expliciete gate.

## S2B/S2C-afhankelijkheden

- **S2B:** `LapAccumulator` moet all-sample intervalstate (aantal, maxGap,
  eerste pitroad-tijd, positieve fuelstappen, lege-naamflag) bijhouden;
  `TelemetrySampler.StartLap` bevriest `PairingBinding` + `LapContext`;
  `MeasurementPipeline.EnqueueSummary` gebruikt die freeze en vult niets uit de
  actuele globale sessie. Daarna PL-tests en de echte productie-aanroep.
- **S2C:** sidecar-ledger (`64 entries/1 MiB`, atomic snapshot, crashherstel),
  sendlease op dezelfde `PairingBinding`, per-rij-ACK en de lokale
  `ObservationV1Enabled=false`-vlag. Pas daarna is er sprake van een
  pluginrelease; die heeft een aparte GO.
