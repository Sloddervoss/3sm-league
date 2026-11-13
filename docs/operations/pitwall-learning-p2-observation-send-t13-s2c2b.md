# T13-S2C2b — begrensde asynchrone observation-verzendketen

Status: **LOKAAL GEÏMPLEMENTEERD EN GETEST; NIET GEACTIVEERD EN NIET AAN
PRODUCTIECALLERS GEBONDEN.** Productiewijziging: **NEE**.

Nieuwe bibliotheek `ObservationSend.cs`, twee minimale bulkhelpers in
`ObservationLedgerStore` (`QuarantineMany`, `DeferMany`) en een geregistreerde
testgroep `MeasurementObservationSendTests`. Geen plugin-, settings-,
Pair/Unpair-GUI-, DPAPI-, pipeline- of samplerwijziging. `release.sh` is alleen
als bronlijst aangevuld en **niet uitgevoerd**. Er is geen echt HTTP-request,
geen echte token, geen `%APPDATA%`, SDK, DB, Edge, SSH, Windows- of GUI-actie
geweest.

## Bronnen die vóór de API-keuze zijn gelezen

- `docs/contracts/pitwall-learning-observation-producer-integration-v1.md`
  §§4.1–4.4, 5.4 en 5.5 (inclusief de full-offer-indexregel).
- `EnduranceConnectorPlugin.SendV3Async` (rond 2290–2329) en
  `AcknowledgeMeasurements` (rond 2351–2368): `Bearer`-header, UTF-8
  `application/json`, één POST, ACK alleen na een gelezen 2xx-body.
- `EnduranceConnectorPlugin.PairCoreAsync`/`Unpair` (rond 1175–1310):
  token/settingscommit bestaat, maar er is geen `PairingGeneration` en geen
  observation-fence. Deze code is alleen gelezen; niets gewired.
- `MeasurementFramePlanner.Plan` (74–122): legacy kiest eerst maximaal 3 laps
  en 20 events binnen 16.384 metingbytes/24.576 bodybytes.
- `MeasurementOutbox.Due` (295–314): blijft legacy-only.
- `ObservationOfferedRow/Batch`, `ObservationAckResolver` en
  `ObservationLedgerStore.ApplyAck`: volledige aangeboden lapvolgorde,
  `record_revision` én `recordRevision`, per-rij-union en de enige
  delivery-API.
- `MeasurementSender.SendAsync` (253–359) is de bestaande testroute, niet de
  productiecaller. De nieuwe coordinator gebruikt dezelfde wire- en
  ACK-conventies zonder die caller te wijzigen.

## Wat is gebouwd

### `ObservationSendCoordinator`

- Eén `SemaphoreSlim(1,1)` voor zowel één OBS-poging
  (plan → envelope → POST → ACK-commit) als een lokale
  pairingtransitie (callback → bindingpublicatie).
- `WaitAsync` met begrensde wachttijd; `finally` geeft de lease vrij op elke
  uitkomst. Geen `Monitor`, `Task.Wait`/`Result` of UI-lock over een await.
- `PairAsync`/`UnpairAsync`/`TransitionAsync`: de lease wordt **vóór** de
  eerste callback-side-effect genomen en pas na een `Committed`-resultaat en
  publicatie van de binding vrijgegeven. Een mislukte, geannuleerde of
  verlopen callback publiceert geen nieuwe epoch.
- `SendOnceAsync`: default-off (`ObservationSendOptions.Enabled=false`) doet
  geen POST en muteert niets. Een lease-timeout is `LeaseTimeout`/Deferred,
  geen quarantaine en geen send.

### `SendEnvelope`

Onveranderlijk, met een defensieve kopie van de aangeboden rijen, de volledige
`ObservationPairingBinding`, de exacte body en de token **alleen in geheugen**.
`Token` is internal; `ToString()` bevat geen token, body of rijinhoud. De
envelope wordt één keer gebouwd en daarna niet meer uit globale settings
herlezen.

### Planner

`ObservationSendPlanner.Plan` gebruikt de geaccepteerde
`MeasurementFramePlanner` voor de legacy-selectie (eerst 3 laps/20 events) en
past daarna OBS-rijen in de resterende lapslots en het exacte UTF-8-budget.
Harde grenzen kunnen niet via opties worden verhoogd. De volledige
aangeboden lapvolgorde (legacy eerst, daarna OBS) wordt één keer vastgelegd en
is dezelfde lijst die in de HTTP-body staat en waartegen de ACK-index wordt
geresolveerd. De nieuwe planner bouwt zonder OBS een byte-identieke body als
de bestaande `MeasurementSender` (test OS29).

### Transport en ACK

`HttpObservationSendTransport` maakt de echte `HttpRequestMessage` met
`Bearer`-header en `application/json`, leest de response begrensd en geeft
nooit een token of ruwe fouttekst terug. Direct vóór het maken van de request
wordt de bindingsguard opnieuw uitgevoerd. Een gewijzigde epoch levert daar
`BindingChanged` en geen request.

Na een 2xx wordt alleen `ObservationAckResolver.Resolve` +
`ObservationLedgerStore.ApplyAck` als OBS-levering geaccepteerd. HTTP-succes,
202, een lege body, `stored:false`, een malformed body of een numerieke
`block_error` levert geen `Stored`/`Delivered`. Tijdelijke, permanente en
onbekende codes volgen de geaccepteerde union. Een late response van een
getimede poging bereikt geen tweede ACK-commit.

### Legacy

`ObservationLegacyBypass` is de gedocumenteerde legacy-only plan/body-route
zonder ledger of lease. De tests bewijzen met de echte `MeasurementSender` dat
een volle 64-rij-sidecar en een vastgehouden OBS-lease de gewone legacy-drain
niet blokkeren. De coordinator past voor zijn eigen mixed frame de legacy
ACCEPT/duplicate/superseded/rejected-uitkomst per rij toe via de bestaande
`MeasurementOutbox.ApplyAck`; de volledige offer-resolutie wordt daarvoor
gebruikt, niet een legacy-only indexlijst. De echte productiecallers blijven
ongewired; er wordt dus geen productie-legacy-cleanup geclaimd.

### Bulkhelpers

`ObservationLedgerStore.QuarantineMany` en `DeferMany` muteren meerdere exacte
bestaande rijen in één snapshot. Ze vergelijken UID/revisie/`RowJson` (en bij
deferren ook de binding) en weigeren de hele batch bij een identiteitsconflict.
Quarantaine is terminaal; deferren gebruikt de bestaande bounded backoff en
verandert UID/revisie/`RowJson` nooit. Reserveringen en de bestaande
64/1 MiB-tellers blijven via de bestaande `EffectiveWorst`-boekhouding lopen.

## Bewijs

Nieuwe selector: `--only-observation-send` (30 checks). Hij zit ook in
`--only-measurement` en de volledige harness. Alle tests zijn synthetisch en
in-process: echte `ObservationCapture`/ledger/planner, een echte
`HttpRequestMessage` via een lokale `HttpMessageHandler`, echte ACK-resolutie
en echte schijf/restart. Geen netwerk, geen server, geen SDK.

Belangrijkste dekking:

- default-off en geen POST;
- geldige mixed levering met exacte bytes, header, volgorde en legacy-cleanup;
- legacy-first 3 laps/20 events; OBS verdringt niets;
- exacte UTF-8-maten en niet-verhoogbare harde grenzen;
- plan-, pre-POST- en in-flight-epochwijziging;
- token/rows als één bevroren snapshot, geen token in ledger/log/`ToString`;
- leases die pairingcallbacks en senders wederzijds tegenhouden;
- lease-timeout, transporttimeout, cancel, late response;
- 202/leeg/`stored:false`/malformed/numerieke block_error/duplicate-besluiten;
- tijdelijke/permanente/onbekende afwijzingen;
- mixed `[OBS, legacy, OBS]` id/indexconflict;
- timeout-na-accept + duplicate-retry met dezelfde identiteit;
- restart, before/after-switch IO en onafhankelijke rijen;
- volle sidecar blokkeert legacy niet;
- event-only frame met lege `lapSummaries`;
- een afgekeurde OBS-rij draait een geaccepteerde legacy-buur niet terug.

Gebruikte uitkomsten (zie de artifactroot):

| Meting | Uitkomst |
|---|---|
| `--only-observation-send` | 30 PASS / 0 FAIL |
| `--only-observation-ack` | 87 PASS / 0 FAIL |
| `--only-observation-ledger` | 57 PASS / 0 FAIL |
| `--only-observation-pipeline` | 37 PASS / 0 FAIL |
| `--only-observation` | 55 PASS / 0 FAIL |
| `--only-measurement` | 565 PASS / 0 FAIL (535 oud + 30 nieuw) |
| volledige harness inclusief 60 s-soak | 921 PASS / 0 FAIL (891 oud + 30 nieuw) |
| fixture-export | 52 bestanden, diff met geaccepteerde baseline leeg |
| Deno interop (`--deny-net`) | 50 PASS / 0 FAIL |
| net48 C# 7.3 shared subset | compile 0 |

De fixture-export is bytegelijk aan de geaccepteerde S2C2a-fixtures; de
Deno-parser ziet dezelfde 50 gevallen. De net48-compilatie gebruikt alleen de
cached reference assemblies en dezelfde bronnen als de plugin; er is geen
SimHub-SDK-, Windows- of pluginbuild uitgevoerd.

## Mutanten (artifact-only)

Drie bronmutanten worden uit de gecommitte bron gekopieerd, met `compile=0` en
de bedoelde assertie RED:

1. `guard-removed` — de guard vlak vóór `HttpRequestMessage` wordt verwijderd:
   OS06 moet falen.
2. `lease-before-callback-removed` — de pairingtransitie wacht niet meer op de
   lease: OS10/OS21 moeten falen.
3. `legacy-only-offer` — de aangeboden batch laat OBS-rijen weg terwijl de
   body ze nog bevat: OS02/OS29 moeten falen.

De geldige positieve run blijft GROEN. Een redundante fence die semantisch
equivalent is, wordt als equivalent vastgelegd en niet als testgat geteld.

## Implemented vs deferred (OQ-matrix)

| OQ | Onderwerp | Status |
|---|---|---|
| OQ1 | losse async coordinator + lease + envelope + planner + transport + ACK | **implemented** |
| OQ2 | echte `SendV3Async`/`AcknowledgeMeasurements`-wiring | **deferred** — latere integratiepoort |
| OQ3 | echte `MeasurementSender`-wiring als productiecaller | **deferred** — blijft testroute |
| OQ4 | Pair/Unpair-GUI, DPAPI, settingscommit en `PairingGeneration` | **deferred** — callbackseam aanwezig, echte commit niet gewired |
| OQ5 | plugin/settings/sampler/pipeline-wijziging | **deferred/NONE** |
| OQ6 | echte HTTP/Edge/DB/serverinterop | **deferred** — geen netwerk in deze stap |
| OQ7 | productie-activatie, release, deploy, performance/model/training | **deferred/NONE** |
| OQ8 | Q2 mutable non-UTC sample-hergebruik | **ongewijzigd gedelegeerd**; geen caller geïntroduceerd |
| OQ9 | legacy-cleanup-eigendom in het mixed frame | **implemented binnen de meegegeven outbox**; productiecaller nog niet gewired |
| OQ10 | volledige offer-index bij mixed ACK | **implemented** en getest |

## Niet-claims

- Geen productieveiligheid op basis van deze testcoördinator alleen.
- Geen garantie dat een al vertrokken HTTP-request door een latere
  Pair/Unpair kan worden teruggehaald.
- Geen server-side owner-isolatie die de client niet kan meten.
- Geen echte SDK-, Windows-, GUI-, DB-, APPDATA- of release-uitvoering.
