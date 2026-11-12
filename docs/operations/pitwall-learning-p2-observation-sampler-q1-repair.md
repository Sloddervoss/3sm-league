# T13-S2B Q1-reparatie — SDK-sessievelden breken de fuelketen

Status: **LOKAAL GEREPAREERD, NIET GEACTIVEERD, NIET GEÏNTEGREERD.**
Deze erratum vervangt alleen de Q1-bevinding uit de independent QUALITY-review;
de oude S2B-review, rapporten en artifactwortel blijven ongewijzigd. Er is geen
plugin-, settings-, outbox-, frame-, server-, contract-, SDK-, updater-,
versie-, Windows-, netwerk-, DB- of productiewijziging.

## Bewezen Q1-defect

`ObservationContextKey.Build` nam de actuele `ObservationLapContext.CarId`,
`TrackId` en `TrackConfig` mee, maar niet de sterke numerieke SDK-velden
`SessionUniqueId` en `SessionNumber`. Een stabiele zwakke `observedSessionId`
(zoals `sim-s0`), hetzelfde segment, dezelfde auto/baan/layout en dezelfde
binding leverden daardoor dezelfde ketensleutel, ook wanneer alleen
`sessionUniqueId` of alleen `sessionNumber` wijzigde. De brandstofstijging over
die sessiegrens werd zo één positieve refuelstap.

## Minimale reparatie

In de bestaande canonieke, lengte-geprefixeerde sleutel zijn direct na het
bevroren segment twee `AppendOptional`-velden toegevoegd:

- `sessionUniqueId` uit `current.SessionUniqueId`, invariant geformatteerd;
- `sessionNumber` uit `current.SessionNumber`, invariant geformatteerd.

Onbekend blijft `null` en ketent niet. De velden zijn continuïteitsvelden voor
de fuelstapketen, geen `PairingBinding` en geen quarantainefence. De bevroren
StartLap-context, het observationresultaat, de binding, `ToSummary`,
`ToObservationSummary` en de gewone outbox zijn niet gewijzigd. Een observation
blijft dus `observation_accepted`; alleen de stap over de sessiegrens vervalt.

## Regressietests (echte pipeline)

Toegevoegd in `MeasurementObservationPipelineTests`:

- `OP25`: alleen `SessionUniqueId` 42→43 op de eerste van vier stijgende
  ticks. Verwacht 2,0 L over 4 stappen (0,5 L eerder + 1,5 L na de grens),
  `samples=14`, context 42/3, dezelfde binding, pit/naam behouden en geen
  observation in `ToSummary` of de gewone outbox.
- `OP26`: dezelfde reeks met alleen `SessionNumber` 3→4; dezelfde uitkomst.
- `OP27`: controle met dezelfde SDK-sessie. De identieke grensstijging telt dan
  wél: 2,5 L over 5 stappen. Zo is de test onderscheidend en niet alleen een
  totaalvergelijking.

Op de exacte oude runtime (`2ccd73e7`) faalden OP25 en OP26 met 2,5 L/5 terwijl
OP27 en de bestaande 34 checks groen bleven; na de sleutelfix zijn alle 37
checks groen.

## Fixtures en interop

De fixture-export schrijft nu ook de echte
sampler→accumulator→composer→`DataContractJsonSerializer`-bytes van de
`sessionUniqueId`- en `sessionNumber`-grens. De 46 bestaande interopfixtures
zijn byte-identiek gebleven; zes nieuwe bestanden (twee cases) zijn toegevoegd.
De ongewijzigde Deno-classifier/parser leest ze met `--deny-net` en een
scoped read-pad.

## Q2 — expliciet uitgesteld

De QUALITY-Q2-bevinding over hergebruik van een gemuteerd non-UTC
`TelemetrySample` is **niet** gerepareerd en **geen** blocker voor de huidige
plugin, die per tick een verse UTC-sample maakt. Het is verplicht om Q2 op te
lossen vóór enige sample-hergebruikende of non-UTC caller wordt aangesloten.
Deze reparatie wijzigt geen timestamp- of sample-eigenaarschap.

## Grenzen

Alleen offline net8-harness, een net48/C# 7.3-subsetbuild van de gedeelde
meetlaag (geen SimHub-/SDK-/pluginbuild) en lokale Deno-interop. Geen live
iRacing/SDK, Windows-runtime, installatie, release, push, merge of activatie.
Independent SPEC-recheck en QUALITY op de nieuwe SHA blijven vereist.

**PRODUCTIEWIJZIGING: NEE**
