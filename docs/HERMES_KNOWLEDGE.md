# Hermes — repositorykennis

## Actueel — Pitwall-test en Mijn Pitwall delen de laatste stop

`/admin/pitwall-test` (premium) en Mijn Pitwall tonen de laatste gemeten stop
met hetzelfde `PitDurationPanel`, dezelfde `.ptp-pit-benchmark`-slot direct
onder `DecisionBand`, dezelfde copy/format en dezelfde lege/fouttoestand. Alleen
de lezer verschilt: owner (`readPersonalPitVisits`) versus beheerder
(`readAdminPitVisits`) op een niet-eigen device. De server-RPC
`pitwall_personal_pit_visits_v1` blijft de grens (`owner OR can_manage_simhub()`);
de testroute blijft super-admin. Geen nieuwe rol, grant, anonieme/share-route of
tweede meetwaarheid. De kaart is live-gegate en wist bij device-/sessiewissel
direct de oude stop; late query-antwoorden worden genegeerd via `contextKey` +
generatieteller. Blijvende regressie: `npm run test:pitwall-parity`,
`npx vitest run src/features/personal-pitwall/PitDurationPanel.test.tsx` en
`npm run test:db:pitwall-pit-visits` (owner/admin/outsider + rollback).
Browserbewijs: `docs/pitwall-look/evidence/pitwall-last-stop-parity-20261121/`.
Details: `docs/operations/2026-11-21-pitwall-test-last-stop-parity.md`.

## Actueel — S2E5 zero-hop inname lokaal geaccepteerd

Bron/gemeten SHA `a2ab46f584926162090cf0408e54573d6721b4d6` heeft onafhankelijke
**SPEC PASS + QUALITY PASS + numerieke performance PASS**. S1 UIT/onbeschikbaar
nul private scans, S2 optionele policy-lock behoudt core/GUCs terwijl globale
cancellation atomair afbreekt, S3 eerste/herhaal/afwezig rollback correct. Dit zijn
echte herhaalde SQL-proeven, geen beoordeling uitsluitend uit testtotalen.
P95 208.62770000001183 → 184.2744600000151 ms; 480/480 samples, nul aparte
policy-HTTP-hops, capture positief. Parent rekende zelfstandig na, full entrycheck
exit 0, 22 gerichte regressies groen. Lokale integratie `af0db216` op
`feat/pitwall-learning-p2` is volledig boomgelijk aan de review-SHA, niet gepusht.
Lab na live-readback volledig verwijderd/afwezig gecontroleerd; bewijzen behouden.
Geen productie-/frontend-/pluginactie; geen fitting, advies of UI-activering.
P2 als geheel niet afgerond. Details/status:
`docs/operations/pitwall-learning-s2e5-policy-in-persist.md`.

## Historie — eerste S2E5 numerieke PASS, toen nog zonder bronacceptatie

Optie 2 lokaal gebouwd op `a787c8ae`: policy in de bestaande acht-argumenten-persist
als vierde resultaatveld; paired rollback herstelt de oude definitie. Edge gebruikt
alleen bij AFWEZIG veld de oude fallback; null/ongeldig is fail-closed zonder extra
hop. Gemeten bron `5bb2be5521ebf6cdb1cefa19d57cbaf25a5e17bd`, reviewdoel
`4b39b8df64960789fbb89bd8ce6d638a203834ec`. Eén vaste proef numeriek PASS:
p95 253.65473300000303 → 219.09025599999586 ms; 480/480 samples, nul extra
policy-HTTP-calls, private capture positief; parent herberekende dit zelfstandig.
Geen historische FAIL herclassificeerd. Post-run wijzigde alleen `audit.py`, met
expliciete geregistreerde-control-hashuitzondering en behouden oude bytes; geen
runtime-/SQL-/runnerwijziging of tijdmetingretry. Safe-disable na fixturecorrecties
PASS; onafhankelijke SPEC/QUALITY nog OPEN. Zie
`docs/operations/pitwall-learning-s2e5-policy-in-persist.md`. Geen productieactie,
plugininstallatie, fitting/advies of UI-activatie. PRODUCTIEWIJZIGING: NEE.

## Historie — S2E4 latency (na S2E3)

S2E4 lokale reparatie op basis `85c73b3e`, branch `fix/pitwall-learning-s2e4-latency`,
bevroren bron/harnas `0f33ee19c9459475a2d7a8121bc2453bbf5e2754`; latere commits docs-only,
runtimebytes bytegelijk. Drie bestaande Edge-compilerfouten verholpen (PACE-tupels,
`PromiseLike`-contextport, smalle SDK-adapter): kandidaat-entry `deno check` exit 0,
live baseline exit 1 met dezelfde drie fouten; geen `any`/suppressie/configverruiming.
De policy-read start nu pas na geaccepteerde core-persist, overlapt best-effort
history-writes en joint vóór de 202; geen cache/TTL/permissie-/identiteits-/750ms-
wijziging en geen SQL-wijziging. Onafhankelijke review op de bevroren SHA:
**SPEC PASS, QUALITY APPROVED**, met **performance FAIL** als enige blokkade:
p95 242,118125 → 266,899499 ms (+24,781374 ms / +10,235241%); beide grenzen
(+10% én +20 ms) overschreden, 480/480 samples, geen herhaling. Parent en reviewer
herberekenden dit onafhankelijk. Baseline is de gevangen live bron, dus dit is
pakket-versus-live, niet "de reparatie kostte 24,78 ms"; historische-tailoorzaak
buiten de seriële afhankelijkheid blijft open. Release geblokkeerd; geen merge/push/
deploy/activatie. Labomgeving na readback volledig opgeruimd. Details:
`docs/operations/pitwall-learning-s2e4-latency-repair.md`. PRODUCTIEWIJZIGING: NEE.

## Historie — S2E3 echte clone-/HTTP-proef

De read-only productie-inventarisatie/schema-export en geïsoleerde proef van
14 november 2026 zijn uitgevoerd; dit was geen productie-DDL/deploy/activatie-GO.
Harnas/resultaatbron `9375419860163a3788bc880275e69524d0545c65`, applicatie/migraties/plugin
ongewijzigd. Echte HTTP-inname en uitgevoerde autorisatie/capturematrix PASS, maar
**latency FAIL**: 200 paren, p95 201.185835 → 251.657812 ms (+50.471977 ms / +25.08724%),
maximaal toegestane toename 20 ms. Parent herberekende alle 480 ruwe responses;
geen gunstige herhaling. Volledige Edge-entrytypecheck FAIL met dezelfde drie
foutklassen in live bronbaseline en kandidaat. Safe-disable rollback PASS met
databehoud/legacy-inname; volledige byte-restauratie niet bewezen. Geen whole-DB
clone-identiteitsclaim: component-/rol-/publicatieverschillen zijn gekwalificeerd.
Eigen 7 containers/6 volumes/intern netwerk na parent-readback verwijderd en
afwezig teruggelezen; privé exports/bewijs behouden. Actuele status/details:
`docs/operations/pitwall-learning-s2e3-clone-result.md` en bovenste S2E3-sectie van
`docs/operations/pitwall-learning-p2-local-status.md`. Niet opnieuw de livebasis
ophalen of minimale SQL-fixture testen als vervanging van gericht herstel.
Oude→nieuwe automatische updaterproef, fitting en UI-/modelactivering blijven open.
Production frontend changes: NONE. PRODUCTIEWIJZIGING: NEE.

## Zelflerende pitwall — P2 lokale bouw gestart

Vervolg-GO na P1: afgeschermde context-/recordkwalificatie, fysieke setintervallen
en stopsegmenten; fasebasis `79ca3381ee880bb145c91c9804da7584fc2b683a`.
Scopebesluit: `docs/contracts/pitwall-learning-policy-v1.md`.
T09/T10 worden eerst als pure modules gebouwd; geen DB-/UI-/connectoruitrol,
nieuwe pooling, modeladvies of P3. Bestaande bronhiaten blijven expliciet onbekend.
T13 alleen bij een bewezen broncontractgat; publicatie blijft een afzonderlijke GO.
T09–T12 en de T13-pure core zijn lokaal geaccepteerd. T13-S1 servercapture is na
SPEC PASS en QUALITY APPROVED op `ce5d62c3` lokaal geïntegreerd als `58820eed`;
status en bewijs: `docs/operations/pitwall-learning-p2-local-status.md`.
S2A pure C#-observatiekern is lokaal geïntegreerd als `7876f494` uit `1dfa5eed`
(SPEC op bytegelijke runtime `9bd252bf`, quality APPROVED inclusief twee mutant-kills).
Parent C#-harnas 710/710 en serializer→Deno-interop 37/37; geen volledige plugin-/SDK-build.
S2B-adapter is na SPEC PASS en QUALITY APPROVED op `f72eb548` lokaal geïntegreerd
als `1d7d2b62`; parent 37 pipeline/747 volledige C#-harnastests/50 interop PASS.
SDK-sessievelden onderbreken de fuelketen; gewone v1-outbox blijft observation-vrij.
Q2 non-UTC sample-hergebruik blijft open: oplossen vóór bedrading van zo'n caller.
S2C1 duurzaam ledger na SPEC PASS en QUALITY APPROVED op `c5cb018e` lokaal
geïntegreerd als `7106b7fa`; parent 57 ledger/448 measurement/804 volledige
C#-harnastests en 50 interop PASS. Exacte RowJson, 64/1MiB-reservering,
crashvaste preserve en niet-definitieve onzekerheid zijn getest; geen delivery-API.
ACK-classificatie en duurzame per-rij-afhandeling zijn na runtime-SPEC PASS op
`71a209a8` en kwaliteitsacceptatie van de bytegelijke runtime op `f000c49c`
lokaal geïntegreerd als `8e2d4dae`; parent 87 ACK/535 measurement/891 volledige
C#-harnastests/50 interop PASS. T1/T2 zijn strikt test-only gesloten met M8/M7.
Async sendlease/planner/envelope/onderschept transport na runtime-SPEC en QUALITY
op `447878bd` plus strikt test-only OS34-acceptatie op `3562e413` lokaal geïntegreerd
als `7616cd5f`; parent 34 send/569 measurement/925 full C#/50 interop PASS,
52 exportbestanden. Zes overlevende mutanten gedood; alle 2257 niet-testblobs gelijk
voor SPEC-overdracht. OS34 exacte fixturegrens 2088 bytes, niet 24576-byte padding.
Shutdown/reporting bron `44a5c817` is na onafhankelijke gerichte SPEC/QUALITY
geïntegreerd als `8d1bf8b0`; parent 41 send/576 measurement/932 full C#/50 interop
PASS, 52 exports. R1 Dispose na commit, R2 alle plan-quarantaine-uitkomsten en
sync-throw Posted-flag gesloten; OS41 onderscheidt partiële commit en retry.
S2D-bronbedrading `5389fcc3` heeft SPEC PASS en ongewijzigde runtime-QUALITY;
drie Important testgaten zijn met strikt test-only bron `8dd96fc0` onafhankelijk
APPROVED gesloten. Integratie `cd5b46cf`: parent 65 host/997 volledige C#-harnas-
asserties/16 wiring/50 interop PASS, 52 eigen exports; alle zes stages exit 0.
Dezelfde productiehost verzorgt capture→lazy ledger en centrale SendV3/Pair/Unpair/
End; één centrale productie-SEND-caller, MeasurementSender.SendAsync is testroute.
W1 caller-bypass/tokenmissing-grens is op de gedeelde host getoetst; Q2 blijft
beperkt tot de bestaande verse-UTC-once caller, geen samplehergebruik introduceren.
Default-off en receiver-readiness=false blijven behouden. Geen productieapply,
Edge-deploy, geïnstalleerde DLL-wissel of producerrelease. Volledige vendor-SDK/
Windows-compile-only build vanaf `2f70eb72` op Beest PASS: 48 Compile-items,
0 errors / 1 CS0169-warning, echte embedded updater en productie-public-key
vergeleken. Installed/Desktop-DLL's ongewijzigd; compile-only versie blijft0.7.6.2,
geen releaseartefact. Echte WPF/DPAPI/SDK-runtime en Windows-afsluiting blijven open.
Verse-Pair-lokale-fence `d5d0c3c0` (SPEC PASS; test-only `2c8ffd74` APPROVED) is
geïntegreerd als `d9bf8d75`: parent 171 host/1105 volledige C#-harnasasserties/
17 wiring/50 interop PASS, 52 exports. Geen servernumerieke epoch of SQL nodig;
updater/versie/manifest bytegelijk, versie 0.7.6.2. Het daaropvolgende herstel na
mislukte Pair is na SPEC PASS op runtime `5a5237e9` en strikt test-only QUALITY
APPROVED op `8caef5ba` geïntegreerd als `b2e28071` (boom exact gelijk aan8ca).
Parent opnieuw: offline build /224 host /1167 full inclusief soak /17 wiring /
50 interop,52 exports; zes stages exit0 in eigen artifactkopie. Eén optioneel
recoverable-kenmerk bewaart uitsluitend bewezen veilige tellerhistorie; alleen
nieuwe geldige duurzame Pair neemt de strikt hogere opvolger. Historisch onbekend,
poison/max/ongeldig blijven dicht. Marker-zonder-raw blijft poison-tombstone, geen
reset naar1; oude autorisatie/meetrij-identiteit wordt niet hersteld. Volledige echte
Windows/net48/SimHub-compile vanaf `b2e28071` PASS:119 bronhashes/48 Compile-items,
0 errors/1 bestaande CS0169-warning; DLL836096bytes SHA256
`3ccc0ad37288f8f2a542eee7f42131a4f5c6ded632f0aeaff1a10c3d46f4bec2`.
Embedded updater gelijk aan dezelfde build, productiepublickey oud/nieuw gelijk,
testsleutel afwezig; installed/Desktop vóór/na ongewijzigd. Compile-only0.7.6.2,
geen release/installatie/activatie. Echte SDK/DPAPI/runtime/Windows-shutdown en
ontvangerreadiness blijven open. Bewijs: `docs/operations/pitwall-observation-recovery-windows-build.md`.
S2E1 client-readiness is na één gecombineerde onafhankelijke SPEC PASS/QUALITY
APPROVED op `b32e7bdf` geïntegreerd als `431d6c99`. Parent32 readiness/224 host/
1199 full inclsoak/19 wiring/50 interop,52 exports; zeven stages exit0. Beide echte
antwoordroutes voeden één identity-/lifetime-/requestvolgordegebonden geheugencache;
alleenability is geen accounttoestemming. Zonder toekomstige scopedpolicy blijftfalse,
settingsopt-infalse; geen SQL/Edge/account/UIwijziging. Volledige echte Windows/net48/
SimHub-compile431d PASS:121bronhashes49Compile-items,0errors/1bestaandewarning;
DLL869376bytes SHA256 `801e0958bb76c961c883c2f029e0517791614ca0e87d54d327ed02e796e7b15f`.
Installed/Desktopunchanged, updaterembedding/keygecontroleerd, compile-only0.7.6.2.
S2E2 backend-policyprojectie heeft in één onafhankelijke run SPEC PASS en QUALITY
APPROVED op88f0b7e; integratiee939c32a is boomgelijk. Eén readonlyservice-roleRPC
pluspairedrollback, optioneelpolicyfeit in bestaande acceptedV3response. Geen
private-schema-grant, nieuweownerclaim, pooling/enrollment ofclientwijziging.
ParentDeno12/preflight6PASS; reviewer18SQL/wirestages en7PG→Edge→C#gevallen
uitgevoerd. Exactrollbackinventaris/data gelijk; parentlasbeideisolateIDs/DBstaat
zelfterug en ruimde uitsluitend die tweecontainers op, afwezigheidgeverifieerd.
Windows431d/clientbytebewijs overgedragen, geenherbouw. Full-ingestproductieclone,
actuelecatalogus, remoteEdge-entrytypecheck en p95(+10%EN20ms) blijvenOPEN.
750mslookupboundis geenvolledigerequestdeadlinegarantie. Geen productieapply,
deploy, enrollment, optin ofmodelgebruik. Geenservernumeriekeepoch nodig.
Volgende afhankelijkheid is read-only live-schema/cataloogvoorbereiding en echte
geïsoleerdeclone-/latencyrehearsal, nietnogeenclientreview. User-approvedproportionelewerkwijze:
ééncoherentpakket/éénonafhankelijkereview, alleblockerssamen, bytecarryvoorongewijzigd
bewijs; geenextra modelronde voor exactaluitgevoerdetestpatch. Productie/installatie/
activering en echte automatischeupgrade blijven afzonderlijkeGO/acceptatiepoorten.
De bestaande automatische oude→nieuwe updateketen is een harde vrijgavepoort:
geen nieuwe verplichte bootstrap, sleutel-/manifest-/kanaalwijziging of handmatige
DLL-wissel als vervangend bewijs. Bewezen bronbehoud is geen echte installatieproef.
Rollback houdt historie en nieuwe writer intact; flag-only heractivatie mist de
forward-P1-projectie en is niet ondersteund. Receiverhandshake/activatie en de
Vite-integratiebuild blijven open; de gateway-scangrens is geen build-PASS.

## Zelflerende pitwall — P1 fasegrens

Handoff en open poorten: `docs/operations/pitwall-learning-p1-local-handoff.md`.
Contract: `docs/contracts/pitwall-learning-contribution-v1.md`; bron-/privacybeleid:
`docs/contracts/pitwall-learning-policy-v1.md` en `docs/contracts/pitwall-learning-source-map.md`.
P1 heeft lokale bouwacceptatie: functionele reviews en codekwaliteit APPROVED;
de onafhankelijk nagerekende 200-ronde proef voldoet aan de afgesproken p95-puntregel.
De marge is zeer klein; dit is geen robuuste productiegarantie. De P1-uitkomst alleen
geeft geen toestemming voor productieactivatie, daemon, pooling of vervolgfases.
De afzonderlijke lokale P2-GO staat hierboven. Gecontroleerde meet-/reviewdocumentatie:
`docs/operations/pitwall-learning-p1-controlled-perf.md`. De oorspronkelijke meetdata
blijven bevroren; gecorrigeerde volgordemetadata staat als apart erratum bij het bewijs.
De bridge bewaart een immutable per-owner batch in de ingesttransactie; een begrensde
lease-API materialiseert daarna revisies/jobs. Owner-at-receipt is geen historisch bewijs;
actuele policychecks blijven nodig. Geen nieuwe browserquery of modeladvies aangesloten.
Rollback bewaart bewijs; de private testcontainer is na backup verwijderd.

## PACE (lokale implementatie op feat/pitwall-look-3sm)

Contract/architectuur en uitrolgrenzen: `docs/contracts/pace-capture-v1.md`.
Live read-only bewijs: `docs/pitwall-look/pace-bewijs.md`.
Lokale verificatie en bekende releasegates: `docs/pitwall-look/pace-oplevering.md`.
Geen productie-GO impliceren uit deze implementatie. Acht persistargumenten en adviesisolatie behouden.
