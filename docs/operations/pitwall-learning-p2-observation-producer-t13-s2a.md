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
  rijvenster. De builder emit de werkelijke, niet-negatieve
  `edgeBeforeSeconds = firstSampleAt - startedAt` en
  `edgeAfterSeconds = endedAt - lastSampleAt`; een 50 ms- of 89,95 s-edge is
  geldig. De 1 ms in het servercontract is een tolerantie op de **fout** tussen
  de opgegeven edge en de uit de rij berekende edge, geen maximum op de edge
  zelf. De 86 400 s-grenzen per edge en voor de onbekende som blijven inclusief;
  er wordt niet geclampt.
- `pitRoad` uitsluitend uit `OnPitRoad == true`; nooit uit `_pitLap` of fuel.
- `refuel` is de som van positieve stappen met 0,001 L-korrel, niet het netto
  totaal. Null/NaN/Infinity/negatief breekt de keten; contextwissel breekt de
  keten maar bewaart eerdere stappen. `maxUndetectedLitres` wordt weggelaten.
  De 0,001 L is de bestaande wire-korrel (§3.4): `Math.Round(..., 3,
  AwayFromZero)` laat een ruwe +0,0005 L als één stap van 0,001 L tellen;
  +0,0004 L telt niet. Dit is geen sensormeting of nieuw negatief feit en er is
  geen binaire EPS-correctie.
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
  lokale source: restore exit 0, build exit 0 (0 warnings).
- `--only-observation`: 55 PASS / 0 FAIL, exit 0.
- `--only-measurement`: 299 oude + 55 nieuwe = 354 PASS / 0 FAIL, exit 0.
- Volledige DiagnosticsTests: 710 PASS / 0 FAIL, exit 0 (inclusief 60 s soak).
- `net48` C# 7.3-subsetbuild van `MeasurementIds.cs` + `MeasurementEvent.cs` +
  `ObservationCapture.cs` met de echte reference assemblies: exit 0, 0 warnings.
  Dit is **geen** plugin-/SimHub-build.
- Echte C#-fixtures naar de bewijsroot (39 bestanden), daarna ongewijzigde
  Deno-parser/-classifier en `parseLapSummariesReport` in opt-in modus:
  37 PASS / 0 FAIL, exit 0. `deno check` op `observationV1.ts` en het
  interopscript: exit 0; `deno fmt --check`: exit 0.
  - accept: full context (UUID-case + Unicode), single sample, 1,2 s gap,
    context-only, refuel; en de echte builderoutputs `edge-after-50`
    (`edgeAfter=0.05`), `edge-before-50` (`edgeBefore=0.05`), `edge-both-50`
    (beide 0,05), `edge-after-90s` (`edgeAfter=89.95`) en `edge-20hz`
    (`edgeAfter=0.05`, next-tick rowEnd);
  - quarantine: device-mismatch;
  - reject: `edge-error-2ms` (synthetische rowmetadata rond echte
    builderbytes: 2 ms fout > 1 ms tolerantie; de edge van 0,05 zelf is
    geldig), `edge-mismatch`, row-window, same-ms (`samples=2`, first==last);
  - legacy: omission bytegelijk aan de oude serializer;
  - envelope: legacy + observed samen in `on`, de drie edge-rows samen in
    `on` (`0/0.05`, `0.05/0`, `0/89.95`), en `off` weigert alleen de
    observed/edge-rows (default legacy).

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
