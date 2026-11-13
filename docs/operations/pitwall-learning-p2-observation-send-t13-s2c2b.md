# T13-S2C2b — begrensde asynchrone observation-verzendketen

Status: **LOKAAL GEREPAREERD EN GETEST (INCLUSIEF S2C2b-H
SHUTDOWNHARDENING); SPEC/Q-GATE OPEN, NIET GEACTIVEERD EN NIET AAN
PRODUCTIECALLERS GEBONDEN.** Productiewijziging: **NEE**.

Nieuwe bibliotheek `ObservationSend.cs`, twee minimale bulkhelpers in
`ObservationLedgerStore` (`QuarantineMany`, `DeferMany`) en een geregistreerde
testgroep `MeasurementObservationSendTests`. Geen plugin-code-, settings-,
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
- `WaitAsync` met begrensde wachttijd. De lease wordt in `finally` exact één
  keer vrijgegeven, behalve wanneer een pairingcallback de begrensde
  callerswachtijd overleeft: dan gaat het eigendom over naar een terminale
  continuatie die pas na callback-settlement publiceert en vrijgeeft. Geen
  `Monitor`, `Task.Wait`/`Result` of UI-lock over een await.
- `PairAsync`/`UnpairAsync`/`TransitionAsync`: de lease wordt **vóór** de
  eerste callback-side-effect genomen en pas na een `Committed`-resultaat en
  publicatie van de binding vrijgegeven. Een mislukte of geannuleerde callback
  publiceert geen nieuwe epoch. Een callback die de pair-timeout overleeft
  houdt de lease; een laat committed resultaat wordt onder dezelfde lease
  gepubliceerd vóór een volgende OBS-poging. Een niet-settelende callback laat
  volgende pogingen begrensd op `LeaseTimeout`, nooit op een POST onder de
  oude epoch.
- `ObservationSendOptions` is een onveranderlijke genormaliseerde snapshot:
  de coordinator leest alleen private readonly waarden en `Options` geeft een
  defensieve kopie. `-1`/`int.MaxValue`/`Enabled`-mutatie kan de effectieve
  lease-, request- of pair-grens niet veranderen.
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
bestaande rijen in één snapshot. Beide vergelijken UID/revisie/`RowJson` én de
volledige `PairingBinding` (device, owner, generatie, known) en weigeren de hele
batch atomisch bij een identiteitsconflict. De actieve fence is niet
autoritatief voor een bestaande rij: een oudere capture-binding met zijn eigen
exacte rij blijft plan-time quarantineerbaar. Quarantaine is terminaal;
deferren gebruikt de bestaande bounded backoff en verandert
UID/revisie/`RowJson` nooit. Reserveringen en de bestaande 64/1 MiB-tellers
blijven via de bestaande `EffectiveWorst`-boekhouding lopen.

## Bewijs

Nieuwe selector: `--only-observation-send` (40 checks). Hij zit ook in
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
- een afgekeurde OBS-rij draait een geaccepteerde legacy-buur niet terug;
- een late pairingcommit die de pair-timeout overleeft houdt de lease, publiceert
  generatie 8 vóór een volgende send en levert nooit onder generatie 7;
- `Options`-mutatie (`-1`, `int.MaxValue`, `Enabled`) verandert requesttimeout,
  leasewacht, pairtimeout of default-off niet;
- `QuarantineMany` weigert generatie-/owner-/device-/unknown-bindingconflicten
  atomisch (rij, schijf en tellers ongewijzigd) en quarantineert alleen de
  exacte eigen rij-binding, ook als die ouder is dan de actieve fence.

Gebruikte uitkomsten (zie de artifactroot):

| Meting | Uitkomst |
|---|---|
| `--only-observation-send` | 40 PASS / 0 FAIL |
| `--only-observation-ack` | 87 PASS / 0 FAIL |
| `--only-observation-ledger` | 57 PASS / 0 FAIL |
| `--only-observation-pipeline` | 37 PASS / 0 FAIL |
| `--only-observation` | 55 PASS / 0 FAIL |
| `--only-measurement` | 575 PASS / 0 FAIL (569 oud + 6 nieuw) |
| volledige harness inclusief 60 s-soak | 931 PASS / 0 FAIL (925 oud + 6 nieuw) |
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

## Erratum na onafhankelijke SPEC-review (S2C2b)

De review op `8b76526e` vond drie publieke contractfouten. Deze zijn in één
begrensde revisie gerepareerd; de oude runtime is ongewijzigd en dezelfde
eindtests zijn tegen zowel oud als nieuw gebouwd.

| Blocker | Reparatie | Oud | Nieuw |
|---|---|---|---|
| B1 late pairingcallback | lease-eigendom gaan pas na callback-settlement over; laat committed resultaat publiceert onder dezelfde lease vóór een volgende send; niet-settelende callback laat volgende pogingen op `LeaseTimeout` | OS31 FAIL | OS31 PASS |
| B2 muteerbare `Options` | private readonly genormaliseerde waarden plus defensieve `Options`-kopie | OS32 FAIL | OS32 PASS |
| B3 `QuarantineMany` zonder binding | `SameBinding`-guard vóór elke bulkrijmutatie, hele batch atomisch geweigerd | OS33 FAIL | OS33 PASS |

De ongewijzigde 34 oude sendchecks, 87 ACK-checks en 57 ledgerchecks blijven
groen. De openbare reviewer-probe (retarget, asserties onveranderd) geeft op de
oude runtime exact `FAIL=3` voor `PAIR_TIMEOUT_LIVE_CALLBACK`,
`MUTABLE_OPTIONS_UNBOUND` en `QUARANTINE_BINDING_UNCHECKED`, en op de nieuwe
runtime `FAIL=0`.

## S2C2b-H — shutdown/result-hardening (OS35–OS40)

Drie kleine runtime-/rapportagepunten zijn vóór enige pluginbedrading
gerepareerd. De publieke transportinterface is niet herontworpen en er is geen
nieuwe productiecaller bijgekomen.

| Punt | Reparatie | Bewijs |
|---|---|---|
| H1/R1 Dispose tijdens actieve send/pair of late callback | De semaphore wordt pas definitief disposed als alle geregistreerde operaties (inclusief een overgedragen late pairingcallback) gesetteld zijn. Een nieuwe send/pair na `Dispose` blijft `ObjectDisposedException`; een al wachtende bounded waiter krijgt `Refused/disposed` zonder POST. `Release` is defensief begrensd tot `ObjectDisposedException`; operationele/IO/ACK-fouten worden niet generiek geslikt. B1 blijft: de late callback houdt dezelfde lease, publiceert zijn gecommitte binding en geeft pas daarna vrij. | OS35/OS36; Q1/Q1c/Q2 |
| H2/R2 plan-time quarantaine verdween uit het resultaat | De werkelijke `ChangedCount` van de plan-time quarantaine wordt bij het eindresultaat opgeteld bij de ACK-quarantaine. Alle faal-/cancel-/malformed-paden behouden die teller; een herhaalpoging telt oude quarantaine niet opnieuw en er wordt geen globale tellerdelta gebruikt. | OS37/OS38/OS39; Q17 |
| H3 `TRANSPORT_THROW_POSTED_FLAG` | Een synchrone transportthrow (of `null`-task) vóór er een sendtask bestaat rapporteert `Posted=false`; een taak die al is teruggegeven en daarna async fault/timeout blijft `Posted=true`. Dit is uitsluitend een lokale diagnostische marker, geen bewijs dat de server niets ontving en geen toestemming voor retry/identiteitsherschrijving/ACK-cleanup. Rij en duurzame counters blijven gelijk. | OS40; Q12 |

De bestaande OS01–OS34-asserties zijn byte-ongewijzigd gebleven; alleen de
OS34-comment is gecorrigeerd naar de werkelijke 2088-byte fixturegrens onder de
24576-byte bovengrens (geen nieuwe 24576-byte bodytest). De zes vastgestelde
mutatieguards (M06/M07/M10/M12/M16/M18) falen nog steeds uitsluitend op OS34.

TDD-bewijs: dezelfde eindtestfile bouwt op de oude basis met 0 fouten en geeft
daar `PASS=34 FAIL=6` (exact OS35–OS40); op de nieuwe runtime
`PASS=40 FAIL=0`. De publieke probe geeft oud `PASS=13 FAIL=4`
(Q1/Q2/Q12/Q17) en nieuw `PASS=17 FAIL=0`, inclusief `Q14 unobserved=0`.

Niet opgelost en apart gedelegeerd: W1 (unpair met onvolledige binding blokkeert
het mixed coordinatorframe; de toekomstige caller moet de expliciete
legacy-bypass gebruiken) en het Q2 mutable/non-UTC sample-hergebruik blijven
DEFERRED. `Posted=false` is geen serverbewijs; `Posted=true` is geen
leveringsclaim. De feature blijft default-off; echte Pair/Unpair-GUI, settings,
DPAPI, plugin-sender en productieactivatie zijn niet gewired.

## Niet-claims

- Geen productieveiligheid op basis van deze testcoördinator alleen.
- Geen garantie dat een al vertrokken HTTP-request door een latere
  Pair/Unpair kan worden teruggehaald.
- Geen server-side owner-isolatie die de client niet kan meten.
- Geen echte SDK-, Windows-, GUI-, DB-, APPDATA- of release-uitvoering.
