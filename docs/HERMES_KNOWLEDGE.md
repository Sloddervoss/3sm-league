# Hermes — repositorykennis

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
Windows-build en runtime blijven open; subset/harnastests zijn daar geen bewijs voor.
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
