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

## T12-acceptatie en resterende P2-poorten

- **T12 geaccepteerd en lokaal geïntegreerd:** gereviewde bron
  `9ce954ea13cad9390e9ef2364a794b7274f98b14`, SPEC PASS en quality APPROVED.
  Integratiecommit: `d8127e657e94fdb829d3c07175d4f591738debcc`.
  De drie T12-bestanden zijn bytegelijk aan de geaccepteerde bron.
  Parent-integratie: **458/458 learningtests** geslaagd.
  Volledige suite: **2284 geslaagd / 1 bestaande fout**; de volledige testidentiteit
  en foutmelding zijn, na expliciete worktreepadnormalisatie, gelijk aan de P1-baseline.
  Geen nieuwe falende test. Eerste volledige run timeout na 180 s zonder JSON-rapport;
  geen overgebleven testproces gevonden. Herhaling met 600 s: echte exit 1 en JSON-resultaat.
  **Vite-integratiebuild ONBEVESTIGD:** foreground-aanroepen werden als serverstart
  geweigerd; de vervolgens gevraagde tracked background-build werd vóór uitvoering
  door de gateway-lifecycleguard geblokkeerd: Vite-chunk `node.js` overschrijdt diens
  script-scangrens van 1 MiB. Geen build-PASS claim, geen guardomzeiling/configwijziging.
  Dit blijft een open P2-integratiepoort, geen aangetoonde broncode-buildfout.
  Bewijs: `pitwall-learning-p2-pit-reason-spec-recheck/`,
  `pitwall-learning-p2-pit-reason-quality-recheck/` en parent-rapporten
  `integrated-d8127e65.json` / `full-d8127e65-retry600.json`.
  Eerdere afgewezen bronversies, foutproeven en errata blijven afzonderlijk bewaard.
- **T13 pure core geaccepteerd en lokaal geïntegreerd:** bron
  `5025896bdbdd17cfe7526dcd055ac2d029deb9b9`, SPEC PASS en quality APPROVED.
  Integratie: `fc74bc2437f363f2c452ddc4c45d2f86757ed99e`.
  Parent op die integratie: **216/216 Deno-tests** en **458/458 learningtests**,
  beide exit 0; de drie T13-bestanden zijn bytegelijk aan de gereviewde bron.
  De parser en meetrij-scopebeslissing zijn nog niet aan de receiver gekoppeld;
  geen complete T13-gegevensketen, bruikbare brandstofpopulatie of leeractivatie bewezen.
  Bewijs: `pitwall-learning-p2-observation-numeric-spec-recheck/`,
  `pitwall-learning-p2-observation-core-quality-review/` en parent-log/resultaat
  `observation-fc74bc24.log` / `learning-fc74bc24.json`.
- **T13-S1 server-capturebouw gestart:** verse branch
  `feat/pitwall-learning-p2-observation-server` vanaf `fc74bc24`.
  Begrensde lokale bouw van parseraansluiting, devicegrens per meetrij,
  conditionele observation-hash en P1-captureprojectie; feature standaard uit.
  SQL-verificatie uitsluitend met synthetische fixtures in één geïsoleerde
  testcontainer, zonder netwerk/poorten/productiemounts; geen productie-DDL/data.
  Producer/outbox/SDK-verificatie, connectorpublicatie en DLL-wissel zijn niet
  inbegrepen. P3/fitting, UI-publicatie en modelactivatie blijven gesloten.

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
