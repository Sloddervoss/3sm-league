# T13-S2B — lokale sampler/accumulator-aansluiting (inactief)

Status: **LOKAAL GEÏMPLEMENTEERD, NIET GEACTIVEERD.** De productie-plugin roept
de opt-in route niet aan; `SamplerOptions.ObservationCaptureEnabled` is default
`false`. Geen sidecar, send, ACK, settings-, updater-, SDK-, Windows-, DB- of
netwerkwijziging. Alle release-/activatiepoorten blijven apart.

## Wat lokaal is aangesloten

- `TelemetrySample` heeft optionele `ObservationPairingBinding` en
  `ObservationLapContext`; zonder deze metadata verandert er niets.
- `TelemetrySampler.Offer` bewaart de oorspronkelijke UTC-provenance vóór de
  bestaande legacy-normalisatie en biedt de pairing-fence op **elke** tick aan,
  dus ook op duplicate/rate-limited ticks.
- `LapAccumulator` maakt bij `StartLap` één onveranderlijke snapshot van
  binding, context, sessie en segment. Alleen geaccepteerde ticks voeden de
  pure `ObservationCapture`; `Add` blijft verantwoordelijk voor de bestaande
  coverage-/pit-/fuel-/naamstate.
- `LapAggregate` draagt het core-resultaat, de snapshots en de bevroren sessie.
  `ToSummary` gebruikt die sessie (ook null) voor echte sampler-aggregaaten;
  handmatige legacy-fixtures houden hun oude `ToSummary`-gedrag.
- `LapAggregate.ToObservationSummary(...)` is de kleine expliciete
  test/toekomst-compositie. De gewone `ToSummary`, `EnqueueSummary` en outbox
  publiceren nooit automatisch een observation.

## Bewezen regels

- Opt-out-rijen zijn bytegelijk aan de vóór S2B vastgelegde echte
  pipeline-golden. Ook met opt-in aan blijft de gewone outbox bytegelijk en
  observation-vrij.
- Een normale 20 Hz-reeks sluit op de volgende tick met `edgeAfterSeconds=0.05`;
  `samples`, `maxGap`, pit-tijd, refuelstappen, namen en context komen uit de core.
- Duplicate/throttled ticks verhogen `AcceptedCount`, `samples`, pit of fuel
  niet. Een device-/owner-/generatie-/null-bindingwissel op zo'n tick weigert de
  observation met `observation_capture_binding_changed`.
- UUID-vergelijking is case-insensitive na strikte validatie; het StartLap-token
  blijft ongewijzigd op de draad.
- Onvolledige binding bij `StartLap` is definitief
  (`observation_pairing_incomplete`); een latere complete binding redt de ronde niet.
- Sessie-/segmentwissel bewaart de oude rij en zijn StartLap-sessie/segment; onbekende sessie/context bij start wordt niet later aangevuld.
- Car/layout-wissel midden in de ronde bewaart de StartLap-context, breekt de
  fuelketen en behoudt eerdere positieve stappen. Ontbrekende `trackId` laat
  alleen de contextgroep vervallen; pit/refuel/naam blijven.
- `NotePitVisit`-fuel alleen levert geen observation-`pitRoad`; `OnPitRoad=null`
  wordt nooit `false`. Null fuel breekt de keten binnen 1 s.
- Lege of null rijdersnaam laat `driverNameContinuity` vervallen; trim/ordinal
  en `changed` blijven gelijk aan de legacy-normalisatie.
- Local/Unspecified-tijden worden door de legacy-sampler genormaliseerd, maar
  een observation wordt geweigerd met `observation_capture_timestamp_not_utc`;
  de legacy-rij blijft.
- Echte sampler->accumulator->composer->`DataContractJsonSerializer`-bytes gaan
  door de ongewijzigde Deno-classifier en de opt-in
  `parseLapSummariesReport`; mixed legacy+observed wordt geaccepteerd, default
  off weigert alleen de observed rij, en device-/vensternegatieven worden
  afgewezen.

## Bewijs (echte exits)

- Offline restore/build van `3SM.EnduranceConnector.DiagnosticsTests` met lege
  lokale source: restore exit 0, build exit 0 (0 warnings).
- `--only-observation-pipeline`: 34 PASS / 0 FAIL, exit 0.
- `--only-measurement`: 354 oude + 34 nieuwe = 388 PASS / 0 FAIL, exit 0.
- Volledige DiagnosticsTests: 710 oude + 34 nieuwe = 744 PASS / 0 FAIL, exit 0
  (inclusief 60 s soak).
- `net48` C# 7.3-subsetbuild van de gedeelde meetlaag incl.
  `ObservationSampling.cs`: exit 0, 0 warnings. Dit is **geen** plugin-/SimHub-
  of SDK-build.
- Fixture-export van de echte adapterbytes en Deno-interop: 46 PASS / 0 FAIL,
  exit 0. `deno check` en `deno fmt --check`: exit 0.

## Bewust niet in S2B

- Geen `EnduranceConnectorPlugin`/`ConnectorSettings`-bedrading, geen
  gebruikersvlag, geen pluginactivatie.
- Geen `observation-ledger-v1.json`, reservering, 64/1 MiB-retentie, sendlease,
  quarantaine, per-rij-ACK, UI, versie, updater of DLL-installatie.
- Geen observatie in `measurement-outbox.json`, ook niet tijdelijk; de observation-lane
  bestaat in S2B alleen als expliciet gecomponeerde, niet-verzonden test/toekomstrij.
- Geen live SDK/iRacing-bewijs, geen Windows/net48-pluginruntime en geen
  productie-DB/Edge-activatie.
