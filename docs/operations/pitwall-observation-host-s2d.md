# S2D lokale observation-producerbedrading (default-off)

Status: bron en gedeelde host lokaal aangesloten; geen activatie, publicatie of SDK-runtimebewijs.
Onafhankelijke SPEC, daarna QUALITY, blijven vereist vóór parentintegratie.

## Werkelijke bronroute

`EnduranceConnectorPlugin.InitMeasurementLayer` maakt één `ObservationProducerHost`.
Die bezit dezelfde `MeasurementPipeline`, één `ObservationSendCoordinator` en één
`ObservationBindingFence`. De echte ledgerprovider construeert uitsluitend op verzoek
`ObservationLedgerStore` met datzelfde fenceobject; capture en SEND gebruiken diezelfde
store-instantie. De bestaande eager store/ledger/ACK/core/samplerbronnen zijn niet gewijzigd.

De expliciete coordinatorfactory `CreateLazy` opent geen bestanden. Constructor,
`CurrentBinding`, Pair/Unpair, disabled SEND, en Dispose roepen de provider niet aan.
Eerste capture en eerste eligible SEND initialiseren onder de bestaande coordinatorlease.
Een null/verkeerde store, ander fenceobject of providerexception faalt gesloten en wordt
niet opnieuw geïnitialiseerd. De oude eager constructor en zijn nullargumentvalidatie
blijven bestaan.

`ObserveMeasurements` laat de host het verse UTC-sample bouwen/binden/aanbieden binnen
één korte synchrone grens. Context komt uit dezelfde tick: car/track en numerieke
SessionUniqueID/SessionNum. Account komt alleen uit pairing/settings, nooit currentDriverId.
De bestaande sampler bevriest StartLap-context en controleert pairing ook op skipped ticks.
Q2 (mutable Local/non-UTC/samplehergebruik) blijft deferred; deze caller introduceert dat niet.

`MeasurementPipeline.EnqueueSummary` roept de optionele hostsink aan na pitattributie.
Observe, session_end en plugin_stop delen die sink. Opt-out behoudt de oude ToSummary/
EnqueueLap-route. Opt-in gebruikt ToObservationSummary → Candidate.TryCreate → echte
Store.Capture. Captured/AlreadyCaptured komt nooit tevens in de v1-outbox.

Een pre-candidate refusal of definitieve quota-/bindingsweigering kan een verse legacyrij
uit het bronaggregaat maken, met de bestaande MeasurementIdFactory. Dat volgt contract
`docs/contracts/pitwall-learning-observation-producer-integration-v1.md` §2 A3–A5 en
§5.4/§5.5: de voorlopige, bewezen ongepubliceerde OBS-identiteit wordt niet hergebruikt;
geen stripping, herserialisatie of laneconversie van een bevroren OBS-rij.
NotCommitted behoudt één exacte candidate/reservering voor retry. Uncertain/conflict/
failed-closed sluit nieuwe OBS-capture, zonder onbeperkte geheugenqueue of catch-all legacy
fallback. De pending candidate blijft behouden; onafhankelijke legacy blijft werken.
Capturediagnostiek gebruikt vaste categorieën en wordt alleen bij statuswisseling gelogd.

## Settings, autoriteit en lifecycle

`ConnectorSettings.ObservationEnabled` is standaard false. De nieuwe settingsvelden zijn
OptionalField zodat ook de strikte bestaande serializer oude settings blijft lezen.
Nullable `ObservationPairingGeneration` plus `ObservationPairingGenerationKnown`
onderscheiden ontbrekende metadata van echte bekende nul. Ontbrekend, negatief,
onveilig bereik of overflow levert geen nieuwe bekende epoch op. Een gevalideerde
Pair-commit kan alleen een bewezen bekende high-watermark verhogen en bewaart epoch,
device, owner en DPAPI-token samen. Historische settings worden niet geadopteerd of gemigreerd.

De productie-readinessprovider retourneert expliciet false: er bestaat nog geen bewezen
receiverhandshake voor deze feature. Tests injecteren readiness op dezelfde hostseam.
Opt-in én readiness én complete bekende binding zijn vereist vóór storage/capture/SEND.
Er is geen nieuwe capability, handshake, UI-toggle of gebruikersgerichte copy gepubliceerd.

Pair/Unpair voeren HTTP/DPAPI/save/clear onder coordinator.TransitionAsync uit, dus na de
lease. Unpair is awaited async in SettingsControl. De host publiceert token+binding als één
memory-only identitysnapshot na bewezen commit. Onzekere callback/save/remote-uitkomsten
herstellen oude autorisatie niet op grond van lokale rollback. De pluginadapter wist
onbewezen autorisatie conservatief; ook die save kan falen, waarvoor slechts een vaste
foutcategorie wordt gelogd. Dit is geen crash-atomic serverrollbackgarantie.

Een bounded public timeout is niet de terminale callback. De host houdt echte callback-
en transporttasks vast. De coordinator exposeert terminale Settlement van zijn bestaande
operation-accounting; publicatie/leasevrijgave blijft in de geaccepteerde volgorde. End stopt
intake, sluit de pipeline via dezelfde sink en cancelt. De synchrone SDK-End-hook wacht niet
op de UI-thread: HTTP/CTS/settings blijven leven tot daadwerkelijke owned settlement.
Een nooit-settelende callback behoudt resources; er wordt geen vroeg Dispose geforceerd.

## SEND en rollback

`EnduranceConnectorPlugin.SendV3Async` is de enige centrale productiecaller.
De feature-off body staat byte-identiek in `SendLegacyV3Async`: coretrim → legacymetingen
→ pace binnen restant → één POST → oorspronkelijke ACK/parser/drop/backoff/diagnostics.
De andere lokale bridge `SendAsync` en MeasurementSender.SendAsync (testroute) zijn niet gewijzigd.
De statische wiringcheck fixeert beide oude productie-methodbodies met SHA-256.

Eligible mixed SEND gebruikt de coordinator als enige ACK/attempt-owner. De finale pace-
appender loopt na legacy-first planning maar vóór de immutable SendEnvelope-freeze.
Het complete ordered offered-lapindex blijft bij de resolver. Geen tweede plugin-ACK.
NothingDue/core-only/pace-only en een bewezen pre-transport refusal mogen één onafhankelijk
legacy/corepad gebruiken. `SafeToBypass` is een expliciete lokale pre-transportmarkering;
Posted=false is geen retryautorisatie. Na transportstart/timeout volgt geen tweede POST.

Legacy-invocation valideert de oorspronkelijke memory identitysnapshot en start de
bestaande async HTTP-adapter synchroon vóór diens eerste await, atomair tegenover de
korte hostgrens vóór pairing-sideeffects. Een oud queued frame krijgt geen nieuw token.
Die adaptervoorwaarde wordt statisch tegen de bestaande productiebody gecontroleerd;
het is geen contract voor een willekeurige callback die vóór HTTP zelf async wacht.
Tokenmissing na centrale Unpair blijft NO SEND; incomplete OBS-generation/readiness met
legacyauthorisatie mag nog het oude pad gebruiken. Een volle/defecte sidecar converteert
nooit zijn historische OBS-rijen naar de legacyqueue.

Kill=false over restart opent of wist geen OBS-ledger, backup, temp, pending of quarantine.
Rollback blijft de oude v1-reader; geen conversie of opruimactie uitvoeren.

## Bewijsgrens en impact

`--only-observation-host` is onderdeel van measurement/full harness en linkt exact de
productiehostbron. Proeven gebruiken synthetische ticks, tokens en expliciete lokale
HttpMessageHandlers, echte pipeline/store/coordinator/planner/resolver en OWN-bestanden.
Bronpakket/command-exits/golden/mutanten staan onder
`/home/hermes/artifacts/3sm/pitwall-learning-p2-observation-host/attempt-2/`.
Het oorspronkelijke blockerbewijs en REPORT.txt blijven onaangeroerd.

De wiring-/SCP-inventorytest is statisch. release.sh kreeg alleen het vereiste nieuwe
bronnamentoken en is niet uitgevoerd. Gedeelde net8/net48-subsetcompilatie bewijst NIET de
volledige plugin, vendorbindings, echte WPF/DPAPI/GUI of updater. Geautoriseerde
GameReaderCommon/SimHub.Plugins/SimHub.Logging/log4net en volledige Windows/SDK-build/runtime
blijven een aparte OPEN gate. Handshake en activatie zijn eveneens apart deferred.

Website/frontend: geen impact verwacht; production frontend changes NONE.
Backend/API en database/RLS/migrations: geen impact verwacht, geen contractwijziging.
Bot: geen impact verwacht. Auth/rollen: alleen lokale connectorpairing/lifecyclebron geraakt;
geen website-/serverrollen gewijzigd. Deployment: alleen statische sourceinventory toegevoegd;
geen release/build-scriptuitvoering, versie/updater/public DLL/push/merge/deploy.
PRODUCTIEWIJZIGING: NEE.
