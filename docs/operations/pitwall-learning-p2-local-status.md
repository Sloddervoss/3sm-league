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
  Op die pure-core-integratie waren parser en meetrij-scopebeslissing nog niet aan de receiver gekoppeld;
  geen complete T13-gegevensketen, bruikbare brandstofpopulatie of leeractivatie bewezen.
  Bewijs: `pitwall-learning-p2-observation-numeric-spec-recheck/`,
  `pitwall-learning-p2-observation-core-quality-review/` en parent-log/resultaat
  `observation-fc74bc24.log` / `learning-fc74bc24.json`.
- **T13-S1 geaccepteerd en lokaal geïntegreerd:** gereviewde bron
  `ce5d62c34d78c2d9e32de9bf0835f53db2a90a4e`, onafhankelijke SPEC PASS en
  afzonderlijke QUALITY APPROVED. Integratiecommit:
  `58820eed28b6e80c420fe952c20b27f348a39a6b`.
  Alle gereviewde server-, SQL-, rollback-, test- en contractbestanden zijn bytegelijk
  aan de kandidaat. De eerder afgewezen `724c841f` blijft ongewijzigd bewaard.
  De echte Edge-parser classificeert de ruwe meetrij met de device-ID uit de
  tokenopzoeking; ontbrekende identiteit, vreemde devices en onjuiste rondevensters
  worden per rij afgewezen. De service-role fallback werkt met minimale helperrechten;
  verplichte SQL-velden en expliciete nulls worden fail-closed gevalideerd.
  Parent op de integratie: **239/239 Deno-runtime-tests** (`--no-check --deny-net`),
  **458/458 learningtests**; volledige Vitest-suite **2284 PASS / 1 bestaande FAIL**.
  De volledige foutidentiteit en genormaliseerde foutmelding zijn exact gelijk aan
  de gepinde T12-baseline; geen nieuwe falende test. De volledige Deno-typegraph blijft
  baseline-rood; runtime PASS is geen typecheck- of build-PASS.
  SPEC en quality draaiden elk de **298 SQL-harnasasserties**; onafhankelijke
  aanvullende rol-/NULL- en mutatieproeven staan in hun afzonderlijke rapporten.
  SQL-verificatie uitsluitend met synthetische fixtures in de geïsoleerde container
  `pitwall-learning-p2-observation-s1` (geen netwerk/poorten/productiemounts).
  Parent-readback: 15 laprows, 7 observations, 6 capturebatches, 2 sourcerevisies;
  `observation_enabled=false` en `capture_enabled=false`.
  Nieuwe lokale migratie en gepaarde data-preserving rollback:
  `20261112134500_pitwall_learning_observation_capture.sql`; **niet op productie toegepast**.
  Feature blijft standaard uit. Het harnas gebruikt expliciet een `older_wrapper_fixture`;
  actuele batchschrijver is uitgevoerd, nieuwste outer-wrapperdispatch alleen brongecontroleerd.
  Heractiveren na rollback vereist ook herstel van de forward-P1-projectie; alleen een
  flag omschakelen is geen ondersteunde heractivatie. Directe trusted-role table-DML heeft
  alleen size/device-CHECKs, niet de volledige writer-shapevalidatie; dit is geen clientpad.
  Bewijs: `pitwall-learning-p2-observation-server-spec-recheck/`,
  `pitwall-learning-p2-observation-server-quality-review/` en parent-resultaten
  `pitwall-learning-p2-observation-server-evidence/integrated-58820eed-*`.
  Producer/outbox/quarantaine, echte SDK-verificatie, connectorpublicatie en DLL-wissel
  zijn niet inbegrepen; geen complete T13- of leeractivatieclaim. De volgende lokale
  stap is het bron- en inpassingsonderzoek voor de producer/outbox, zonder publicatie
  of wijziging van updater, versienummers of geïnstalleerde DLL's.
  P3/fitting, UI-publicatie en modelactivatie blijven gesloten; de Vite-buildpoort blijft open.

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
