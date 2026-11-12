# Pitwall learning — P2 lokale tussenstand

P2 is nog niet afgerond. Geen toestemming voor productie, P3, fitting, UI-publicatie
of modelactivatie. Fasebasis: `79ca3381ee880bb145c91c9804da7584fc2b683a`.

## T09 / T10 geaccepteerd en lokaal geïntegreerd

- Gereviewde bron: `3422b47e87c2473c7ccfcfb1f6e331233bd91f6d`.
- Onafhankelijke SPEC-herkeuring: PASS; zes eerdere blokkades gesloten.
- Afzonderlijke kwaliteitsreview: APPROVED, geen blokkerende bevindingen.
- Lokale integratiecommit: `0da53e0e30dceb36604860bb1d7ea4b485dcb1d5`.
- Parent-run op die integratie: **165/165 learningtests geslaagd**, inclusief
  bestaande P1-contracttests; Vite-build exit 0. Geen volledige P2-eindverificatie.
- Nieuwe modules zijn nog niet verbonden met productie-ingest, worker of UI.
  De DB-adapter volgt in T25; er is nog geen bewijs van betere modelvoorspellingen.

Bewijs buiten Git onder `/home/hermes/artifacts/3sm/`:
- `pitwall-learning-p2-context-quality-spec-recheck/`
- `pitwall-learning-p2-context-quality-quality-review/`
- `pitwall-learning-p2-context-quality-parent/integrated-0da53e0e.json`
- `pitwall-learning-p2-context-quality-parent/build-0da53e0e.log`

## T11 geaccepteerd en lokaal geïntegreerd

- Gereviewde bron: `efb289bd0573e8ef25673504a6289e4983722cf5`.
- Onafhankelijke SPEC: PASS; afzonderlijke quality: APPROVED.
- Lokale integratie: `84de1e893bbf7c052313adf11e54610f1d929f90`.
- Parent-run: **257/257 learningtests**, Vite-build exit 0.
- Volledige tijdprecisie en getagde streamidentiteit gerepareerd; oude verworpen
  bronversies en harnas-errata afzonderlijk bewaard. Geen modelkwaliteitsclaim.
- Bewijs: `pitwall-learning-p2-tyre-time-precision-spec-review-isolated/` en
  `pitwall-learning-p2-tyre-time-precision-quality-recheck/` onder de artifactroot.
- Fysieke bruikbaarheid blijft afzonderlijk van trainingsgeschiktheid en advies.

## Nog uit te voeren binnen P2

- **T12 SPEC geaccepteerd, quality gestart:** actuele herstelbron
  `157389c02b5c4a8340eb550d307fab5529cacccc`.
  Parent-run **419/419 learningtests**; onafhankelijke SPEC-herkeuring PASS.
  De vier resterende foutproeven falen op de bevroren voorganger `8787ea56`
  en slagen op deze bron; ook onafhankelijke permutatie- en servicebindingproeven
  zijn groen. De eerdere bron `0559d220` en de bijbehorende afwijzingen blijven
  afzonderlijk bewaard. Nog geen qualityacceptatie of lokale integratie.
  Bewijs: `pitwall-learning-p2-pit-canonical-spec-recheck/` en parent-resultaat
  `pitwall-learning-p2-context-quality-parent/pit-fixed-157389c0.json`.
  Afzonderlijke kwaliteitsreview: `deleg_c278a78f`, op exact dezelfde bron.
- **T13 bronhiaten bewezen, herstelcontract nog open:** producerflags en nul-bijtanken,
  context bij waarneming, archief/capture, bestaande pairingbinding en gedeeltelijke
  SDK-sessietokens zijn onderzocht op `docs/pitwall-learning-p2-source-gaps`.
  Geen nieuwe ownerregistratie aannemen als het bestaande pairingpad bruikbaar is;
  actuele pairingdata bewijst geen historische recordbinding. Geen contract- of
  connectorimplementatie afgerond. Connectorpublicatie en DLL-wissel behouden hun
  afzonderlijke GO-poort.

## Beperkingen en vervolgnotities

- Historische P1-records missen meerdere context-/resetvelden; onbekend blijft
  onbekend. Positieve fixtures zijn synthetisch, geen historische dekkingsclaim.
- T10 bevat een enkel wear-label; ongelijke hoeken blijven daar ambigu. T11 moet
  echte per-hoekdata verwerken en niet normale ongelijke banden afwijzen omdat
  het aggregaat geen enkel label kan leveren.
- Een handmatig inconsistente CanonicalContext kan buiten de builder vallen;
  adapters moeten de constructor/trustgrens respecteren, geen losse typecasts.
- De kwaliteitsreview noemt ontbrekende extra fuel-/vensterbovengrenzen en enkele
  strengere fail-closed gates als niet-blokkerende vervolgpunten. Deze zijn geen
  goedkeuring om later onbetrouwbare input te gebruiken.
- Lokale CLI: Vitest accepteert `--maxWorkers=1`, niet `--minWorkers`.
  De geweigerde parent-aanroep bleef als apart log bewaard; geen testresultaat.

Productiefrontendwijzigingen: **NONE**. Productie-DDL/data/API/connector: **NONE**.
PRODUCTIEWIJZIGING: NEE.
