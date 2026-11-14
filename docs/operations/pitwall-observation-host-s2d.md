# S2D lokale observation-producerbedrading (default-off)

Status van de oorspronkelijke S2D-bronbedrading: lokaal geaccepteerd en geïntegreerd
als `cd5b46cf`; de latere Pair/recovery-integratie is `b2e28071` (zie hieronder).
Geen activatie, publicatie of SDK-runtimebewijs. Bron `5389fcc3` heeft onafhankelijke
SPEC PASS; strikt test-only `8dd96fc0` sluit de drie Important quality-testgaten
onafhankelijk APPROVED (QSTOP/QMIX/QDYNAMIC, M10/M11/M12).
Parent-integratie: normale offline Release-build, 65 host, 997 volledige C#-harnas-
asserties inclusief soak, 16 wiring en 50 serializer→Deno-interoproeven PASS;
52 eigen serializer-exportbestanden, alle zes stages exit 0. De selecties overlappen.
Bewijs onder `/home/hermes/artifacts/3sm/pitwall-learning-p2-observation-host-`
met suffixen `spec-cli/`, `quality-native/`, `coverage-quality/` en `integration/`.
Dit draagt ongewijzigd runtimebewijs over, geen nieuwe volledige SDK-buildclaim.

**Updater-vrijgavepoort:** ondersteunde oude geïnstalleerde releases moeten via
hun bestaande automatische updatepad naar de toekomstige nieuwe bevroren DLL.
Geen nieuwe verplichte bootstrap of handmatige vervanging. Updaterbron, signing
trust, manifestcontract en bestaande updateblokken zijn behouden; de echte
oude→nieuwe Windows-installatie/herstart/geladen-versie/verse-telemetrieproef
blijft vóór vrijgave verplicht en is nog niet uitgevoerd.

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
onderscheiden ontbrekende metadata van echte bekende nul. De bounded lokale repair
voegt uitsluitend in de nieuwe Pair-commit afwezig→1 toe: na bestaande responsevalidatie
moeten device én raw token verschillen van de vorige identiteit waar beschikbaar,
en moet metadata werkelijk NULL+known=false zonder poisonmarker zijn. Owner mag gelijk
blijven of wijzigen. De generieke successor adopteert niets. Een bewezen bekende
high-watermark verhoogt strikt binnen 0..9007199254740991; negatief, maximum, boven
bereik of verloren provenance weigert OBS en bewaart de ruwe waarde, ook na herhaalde
Pair/failure. Eén OptionalField `ObservationPairingGenerationPoisoned` bewaart
NULL+known-invalid bij invalidatie; anders zou known=false de fout als afwezig maskeren.
Historische settings blijven onbekend op load/restart/decrypt/control/ingest.

`ConnectorSettings.CommitNewPair` is de kleine gedeelde productie-protect/savegrens,
werkelijk aangeroepen door `PairCoreAsync` binnen de bestaande `_settingsGate` en
hostlease. Hij bewaart generatie/device/owner/DPAPI-token samen vóór terugkeer van
het raw token voor memory-publicatie; rollback-save herstelt nooit OBS-knownness.
Lokale tests voeren exact deze commitbron uit met geïnjecteerde protect/save en echte
host/pipeline/store; dit is geen uitvoering van SimHub/DPAPI/HTTP-exchange zelf.
De historische PASS-records hierboven blijven ongewijzigd. De latere Pair-adapter en
het herstel hieronder zijn samen opnieuw volledig Windows/vendor-SDK-gecompileerd
vanaf `b2e28071`; het oude bewijs `2f70eb72` wordt niet naar deze bron doorgetrokken.

**Herstel na een mislukte Pair lokaal geaccepteerd en geïntegreerd als `b2e28071`.**
SPEC PASS op runtime `5a5237e9`; strikt test-only `8caef5ba` QUALITY APPROVED.
De integratieboom is exact gelijk aan de geaccepteerde kandidaat. Een nieuwe volledige
Windows/net48/SimHub-compile vanaf deze integratie is PASS, geen SDK-runtimebewijs;
zie [bevroren buildbewijs en open updatepoort](pitwall-observation-recovery-windows-build.md).
Een gewone mislukte Pair (`ForgetUnprovenAuthorization`) wist autorisatie en knownness
en bewaart de ruwe teller; zonder herstel kon een latere geldige Pair die nooit meer
initialiseren. Invalidatie van een bewezen geldige, niet-gepoisonede teller zet nu één
extra additief OptionalField `ObservationPairingGenerationRecoverable` (ook voor een
werkelijk geprobeerde allocatie die na een mislukte save bewaard blijft). Die markering
overleeft herhaalde invalidatie/restart uitsluitend zolang de ruwe waarde veilig en
niet-gepoisoned blijft; ontbrekende historische markering blijft false, dus een gewone
`present+known=false` zonder markering blijft dicht. Een persistente markering zonder
ruwe waarde (ontbrekend of expliciet NULL) is verloren high-watermark-bewijs, geen
afwezigheid: de afwezig→1-initializer eist daarom óók dat er geen markering is, en
invalidatie bewaart dat feit als de bestaande `ObservationPairingGenerationPoisoned`-
tombstone vóór de markering vervalt. Zo wordt zo'n corrupte combinatie nooit een verse 1
en blijft ze over herhaalde invalidatie/restart heen zichtbaar; de strikte
DataContract-lezer weigert dat partiële document (aparte loader-modelbeperking, niet de
guard). Alleen dezelfde nieuwe-Pair-
commitseam, na bestaande responsevalidatie én freshness (nieuw device én raw token waar
vorige waarden beschikbaar zijn), verbruikt de **strikt hogere opvolger** en slaat die
samen met device/owner/token duurzaam op vóór publicatie. Geen reset naar 1, geen
generatie uit load/restart/control/ingest/decrypt/Unpair; op 9007199254740991 blijft
het dicht zonder wrap/clamp/erase. De oude hostautorisatie blijft ongeldig en een lokale
fence machtigt geen inzameling zonder de aparte identity-scoped policy-/receiverstatus.
Definitief parentbewijs op `b2e28071`: `--only-observation-host` **224** asserties,
volledig harnas **1167 PASS inclusief soak**, **17 wiring**, **50 interop**, **52
exports**; zes stages exit 0. Historisch tegen d977-productie waren exact de nieuwe
SPEC-1-verwachtingen RED: 14 `PAIR-lost-raw-*`-hostasserties plus `SL29-absent` en
`SL29-explicit-null`; de twee nieuwe guards zijn elk build-0/RED bewezen. QUALITY
vond geen runtimefout, maar één overlevende poison-guardmutant; de exact uitgevoerde
+16-regelige test is ongewijzigd gecommit als `8caef5ba`. Gerichte onafhankelijke
hercontrole: echte bron host224/0, dezelfde semantische mutant build0/host223/1,
geldige pristine/recoverycontroles groen; QUALITY APPROVED, Q-1 gesloten.
Tussen de bevroren test-only kandidaat `8caef5ba` en runtime/SPEC-bron `5a5237e9`
zijn alle 2260 andere tracked entries gelijk; de latere integratiedocumentatie niet.
Nieuwe volledige Windows/net48/vendor-SDK-build op `b2e28071` PASS:48 Compile-items,
0 errors/1 bestaande warning. Geen SDK-runtime-, activatie- of releaseclaim.

De S2E1-client gebruikt nu een binding-/lifetimegebonden geheugenlezer in plaats van
alleen de constante false-provider. De bestaande drieveldige receiverstatus zonder
accountpolicyfeit blijft altijd false; er is nog geen bewezen consentpublisher.
Tests injecteren de expliciete toekomstige policyvorm op dezelfde echte hostseam.
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
bronnamentoken en is niet uitgevoerd. De volledige Windows/SimHub-SDK **compile-only**
checkpoint is daarna op Beest geslaagd vanaf docs-only bron `2f70eb72`: echte MSBuild
2022/net48, alle 48 Compile-items aantoonbaar in de plugincompilerregel, 0 errors en
1 CS0169-warning voor `_pitLimiterSinceMs`. Geen groene-waarschuwingvrije buildclaim.
Alle 119 gearchiveerde bronbestanden zijn vóór compilatie op SHA-256 gecontroleerd.
De werkelijke embedded updater is gelijk aan de afzonderlijk gebouwde updaterbytes;
productie-public-key is in de echte oude geïnstalleerde DLL en de nieuwe DLL gelijk,
de testsleutel ontbreekt. Geen vervangende SDK-stubs of gewijzigde projectbestanden.

Dit is **geen releaseartefact**: assemblyversie blijft `0.7.6.2`, byteLength 835072,
SHA-256 `5e24dbdf96276ef0c71ef14fb014d3c14d4c6a8a474fb2de9f36f84012ca0753`.
De compile-only DLL staat uitsluitend in de aparte bouw-/bewijsmap. Bestaande
geïnstalleerde en Desktop-DLL's zijn vóór/na bytegelijk; geen SimHub-GUIactie,
installatie, versie-/manifest-/kanaalwijziging of publicatie uitgevoerd.
Bewijs: `/home/hermes/artifacts/3sm/pitwall-learning-p2-observation-host-windows/`.
Een eerste parent-loginspectie las de UTF-16LE-buildlog ten onrechte als UTF-8 en
vond daardoor geen compilerregel; de BOM-bewuste controle corrigeert alleen deze
inspectie. De geslaagde Windows-build is niet herhaald of als mislukt hernoemd.

Echte WPF/DPAPI/GUI/SDK-runtime, Windows-afsluitvolgorde en de bestaande automatische
oude→nieuwe installatieketen blijven OPEN. De huidige gelijke versie wordt niet als
nieuwe update aangeboden; een toekomstige vrijgave vereist een goedgekeurde hogere
versie en de echte upgradeproef. Receiverhandshake en activatie blijven apart open.

Website/frontend: geen impact verwacht; production frontend changes NONE.
Backend/API en database/RLS/migrations: geen impact verwacht, geen contractwijziging.
Bot: geen impact verwacht. Auth/rollen: alleen lokale connectorpairing/lifecyclebron geraakt;
geen website-/serverrollen gewijzigd. Deployment: afzonderlijke compile-only bouwmap,
geen geïnstalleerde DLL-/Desktop-wijziging, versie-/manifest-/kanaalwijziging, publiek
artefact, push/main-merge of deploy. `release.sh` is niet uitgevoerd.
PRODUCTIEWIJZIGING: NEE.
