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
ACK-afhandeling, async sendlease en alle producer-/pluginbedrading blijven open.
Alle schakelaars blijven uit; geen productieapply/Edge-deploy/producerrelease.
Rollback houdt historie en nieuwe writer intact; flag-only heractivatie mist de
forward-P1-projectie en is niet ondersteund. Producer/outbox/quarantaine en echte
SDK-verificatie blijven open; de Vite-integratiebuild is niet uitgevoerd wegens
de gateway-scangrens en mag niet als PASS worden behandeld.

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
