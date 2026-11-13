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
  zijn niet inbegrepen; geen complete T13- of leeractivatieclaim.
- **Producer-bouwcontract lokaal geaccepteerd:** `acd6ea3931c241824f03d3c123ec0393dd903a23`,
  onafhankelijke gerichte preflight PASS; docs-integratie `743c447cdfcdd502c7046141336599a3a4b9bc8e`.
  PairingBinding en historische LapContext zijn gescheiden; het afzonderlijke
  observation-ledger laat de normale v1-wachtrij en oude DLL-lezer ongemoeid.
  Dit is contractacceptatie, geen runtime- of net48/SDK-bewijs.
  **T13-S2A geaccepteerd en lokaal geïntegreerd:** bron
  `1dfa5eedf169c7bfacadcf78c768a9801db32f82`, integratie
  `7876f49469d8534d25474b245a810f1aea046bd5`. SPEC PASS op de bytegelijke
  runtime van `9bd252bf`; kwaliteitsherkeuring APPROVED op `1dfa5eed` na twee
  strikt test-only correcties die de null-fuel- en null-name-mutanten afvangen.
  Gereviewde bron-, test-, project- en interopbestanden zijn bytegelijk aan de integratie.
  Parent op de integratie: offline projectbuild exit 0; **55/55 observation**,
  **354/354 measurement**, **710/710 volledige C#-harnastests** en **37/37 echte
  C#-serializer→Deno-interoproeven**, alle exits 0. Dit is geen volledige
  Windows/SimHub-net48-pluginbuild of live SDK-bewijs; net48-bewijs is alleen subsetcompilatie.
  De eerste volledige Vitest-poging op `7876f494` eindigde in een tooltransport-timeout
  na 420 s, zonder JSON-resultaat en zonder resterend Vitest-proces; oorzaak niet bewezen.
  De afzonderlijke tracked herhaling is afgerond met **exit 1: 2284 PASS / 1 bestaande FAIL**,
  geen overgeslagen tests. De volledige failure-identiteit én foutmelding zijn na
  expliciete worktreepadnormalisatie exact gelijk aan de gepinde T12-baseline;
  ook de suite-tellingen en falende bestandsidentiteit zijn gelijk. Geen nieuwe
  regressie aangetroffen; dit is geen volledig groene suite. Bewijs:
  `full-vitest-7876f494-retry.json` en `full-vitest-7876f494-retry.log`.
  S2A zelf omvat geen plugin-/sampler-/ledger-/verzendintegratie; geen updater-,
  versie-, instellingen- of geïnstalleerde-DLL-wijziging.
  **T13-S2B geaccepteerd en lokaal geïntegreerd:** gereviewde bron
  `f72eb54802d108342011b33128919031b395618d`, onafhankelijke SPEC PASS en
  QUALITY APPROVED; integratie `1d7d2b628ee3e4babfd23568a72f17f2bdff96ec`.
  De volledige gereviewde runtime-, project-, test- en interopbron is bytegelijk.
  De oorspronkelijke `2ccd73e7` blijft frozen: de quality-blokker Q1 telde een
  brandstofstap over een SDK-sessiewissel. De minimale contextkey-reparatie en
  afzonderlijke OP25/OP26-mutantkills sluiten dit; OP27 bewijst de positieve controle.
  Parent op de integratie: offline restore/build exit 0, 0 warnings/errors;
  **37/37 pipeline**, **55/55 observation**, **391/391 measurement**,
  **747/747 volledige C#-harnastests inclusief soak**, **50/50 C#→Deno-interop**,
  alle exits 0; eigen export 52 bestanden. Geen volledige SDK-/Windows-pluginbuild.
  Deze componenttests vervangen niet de open P2-Vite-buildpoort of andere baseline-schuld.
  StartLap bevriest context/binding; pairing-fences gelden ook op overgeslagen ticks.
  De gewone v1-outbox bevat ook bij lokale opt-in geen observations; capture blijft
  standaard uit, zonder plugin-/instellingenbedrading of productieactivatie.
  **Q2 expliciet open:** hergebruik van een door legacy genormaliseerd non-UTC
  sample kan provenance verliezen. Huidige plugin maakt verse UTC-samples;
  oplossen en testen vóór bedrading van enige sample-reusing/non-UTC caller.
  De afzonderlijke duurzame opslag volgt hieronder als S2C1;
  sendlease, ACK en complete eindketen blijven apart te bouwen/toetsen vóór activatie.
  Bewijs: `pitwall-learning-p2-observation-sampler-session-spec-recheck/`,
  `pitwall-learning-p2-observation-sampler-session-quality-recheck/` en
  `pitwall-learning-p2-observation-sampler-integration/` onder de artifactroot.
  Bewijs: `pitwall-learning-p2-observation-producer-bounds-spec-recheck/`,
  `pitwall-learning-p2-observation-producer-quality-review/`,
  `pitwall-learning-p2-observation-producer-test-quality-recheck/` en
  `pitwall-learning-p2-observation-producer-integration/` onder de artifactroot.
  P3/fitting, UI-publicatie en modelactivatie blijven gesloten; de Vite-buildpoort blijft open.

## T13-S2C1 — duurzaam ledger lokaal geaccepteerd

- Gereviewde bron `c5cb018e6d84201ca062130c5b784267ecbbef4d`: onafhankelijke
  SPEC PASS en QUALITY APPROVED; lokale integratie
  `7106b7fa2a71421c3ba77102b3a1422f77ceafdf`. Alle gereviewde bestanden bytegelijk.
- Vier oorspronkelijke crash-/retryfouten en drie aanvullende runtimefouten zijn
  met onderscheidende old/new-proeven gesloten. De drie testgaten zijn met
  afzonderlijke mutantkills OL41/OL42/OL43 gesloten; geen productiebeleid gewijzigd.
- Parent op de exacte integratie: offline restore/build exit 0, 0 warnings/errors;
  **57/57 ledgertests**, **448/448 meetlaagtests**, **804/804 volledige C#-harnastests
  inclusief soak** en **50/50 C#→Deno-interop**, alle exits 0. Eigen export: 52 bestanden.
- Eén los ledgerbestand, onveranderlijke RowJson, 64 entries/1 MiB worst-state
  UTF-8-reservering, duurzame deferred/quarantine-overgangen en atomische preserve.
  Onzekere readback geeft geen definitieve legacy-terugvalstatus; geen delivery-API.
- Bewijs: `pitwall-learning-p2-observation-ledger-certainty-spec-recheck/`,
  `pitwall-learning-p2-observation-ledger-certainty-quality-recheck/` en
  `pitwall-learning-p2-observation-ledger-integration/` onder de artifactroot.
  Afgewezen bronnen/rapporten en mislukte pogingen blijven apart beschreven.
- ACK-classificatie en duurzame per-rij-afhandeling volgen hieronder als S2C2a;
  async sendlease, echte beide verzendcallers en plugin-/settingsbedrading volgen
  afzonderlijk. Geen activering, SDK-/Windows-runtime, productie of volledige
  P2-buildclaim. Sampler-Q2 (hergebruik non-UTC sample) blijft expliciet open.

## T13-S2C2a — ACK-classificatie en duurzame afhandeling lokaal geaccepteerd

- Gereviewde runtime `71a209a8d0beaa9f0eabd850bb2fe05e25b3ac95`: SPEC PASS.
  Definitieve bron `f000c49cd388bc8424f1fc9409da1e13be8ec053`: QUALITY APPROVED;
  alleen 17 testregels toegevoegd, alle andere tracked bytes gelijk. Runtime-SPEC
  is expliciet overgedragen, niet opnieuw uitgevoerd. Lokale integratie
  `8e2d4daef01c6b9c4fb66fbd71067ba8ef3b88d7`; gereviewde bestanden bytegelijk.
- Parent op de integratie: offline restore/Release build exit 0, 0 warnings/errors;
  **87/87 ACK**, **57/57 ledger**, **535/535 measurement**, **891/891 volledige
  C#-harnastests inclusief soak**, **50/50 C#→Deno-interop**, alle exits 0.
  Eigen DLL-export 52 bestanden. Geen volledige Windows-/SimHub-SDK-build.
- Per-rij ACK-union, revisie-/payload-/epochfences, volledige gemengde offerindexen,
  tegenstrijdige metadata fail-closed en atomaire cleanup+tellers zijn getest.
  Quarantaine blijft terminaal bij zowel accepted als tijdelijk ACK; M8 wordt nu
  door OA40c/OA40b gedood. M7 bewijst OA26's directe in-memory readback.
- Bronpack compleet gecontroleerd zonder release-uitvoering. Echte Edge-ACKs
  bevatten `recordRevision`, DB-ACKs `record_revision`; de nieuwe resolver verwerkt
  beide veilig. De bestaande legacy-parser is niet gerepareerd. `stored:false`
  kan parser-rejections bevatten; de geaccepteerde policy blijft NotDelivered,
  geen cleanup/quarantaine. De eerdere onjuiste bronclaim heeft een apart erratum.
- Bewijs: `pitwall-learning-p2-observation-ack-block-type-spec-recheck/`,
  `pitwall-learning-p2-observation-ack-quality-review/`,
  `pitwall-learning-p2-observation-ack-terminal-quality-recheck/` en
  `pitwall-learning-p2-observation-ack-integration/` onder de artifactroot.
- Die afzonderlijke S2C2b-module is inmiddels lokaal geaccepteerd; zie hieronder.
  Bedrading van beide bestaande verzendcallers en lokale Pair/Unpair/settings is
  nog niet bewezen. Geen activation/release; sampler-Q2 en P2-Vite-buildpoort open.

## T13-S2C2b zelfstandige verzendketen lokaal geaccepteerd

- Runtime-SPEC PASS en volledige runtime-QUALITY APPROVED op `447878bd`.
  Finale bron `3562e413f88577956d32afe7b0bdf5a4fc8c6b63` versterkt uitsluitend
  één testbestand (+122 regels); alle 2257 overige tracked blobs bytegelijk.
  Runtime-SPEC expliciet overgedragen, geen nieuwe SPEC-uitvoering geclaimd.
  Gerichte onafhankelijke QUALITY APPROVED: OS34 doodt alle zes eerder
  overlevende UTF-8-/bulkidentiteits-/atomiciteits-/terminaliteitsmutanten.
- Lokale integratie `7616cd5faf9dd21e288181787b767f74fb7eb5f9`; gereviewde
  bronbestanden bytegelijk. Parent offline restore/Release-build exit 0;
  **34 send / 87 ACK / 57 ledger / 37 pipeline / 55 pure / 569 measurement /
  925 volledige C#-harnasasserties inclusief soak / 50 C#→Deno-interop**, alle
  geslaagd, alle stage-exits 0; eigen serializer-export 52 bestanden.
- Eén async lease bewaakt plan/envelope/transport/ACK en lokale pairingcallbacks.
  Een callback die de timeout overleeft behoudt de lease tot terminale afhandeling;
  een bevestigde late binding wordt vóór leasehergebruik gepubliceerd.
  Opties zijn defensief bevroren; bulkquarantaine controleert de exacte rijbinding.
- OS34 bewijst de exacte **2088-byte** UTF-8-fixturegrens en weigering bij 2087;
  niet een tot 24576 bytes opgevulde body. De eerdere comment/reportformulering
  over een exacte 24576-byte body was onjuist; harde bovengrens apart gecontroleerd.
- Shutdown-/rapportageverharding is geaccepteerd op finale bron
  `44a5c81717b7f42c4f4100ff1ac1a87f360155b6`; lokale integratie
  `8d1bf8b0b8689f022c61c4f61c440f40fb45f715`. H1 Dispose en H3 POST-diagnostiek
  onafhankelijk SPEC/QUALITY goedgekeurd op `19466a65` en bytegelijk overgedragen;
  H2-F1 apart SPEC PASS / QUALITY APPROVED op `44a5c817`. OS41 faalt uitsluitend
  op de oude initializer; nieuwe code rapporteert eerdere duurzame quarantaine
  ook als de tweede planwrite faalt. First-write-failure, all-success, partial-retry
  en nul nieuwe commits bij een niet-nul historische teller zijn gecontroleerd.
- Parent op die integratie: offline restore/Release-build 0 warnings/errors;
  **41 send / 87 ACK / 57 ledger / 37 pipeline / 55 pure / 576 measurement /
  932 volledige C#-harnasasserties inclusief soak / 50 C#→Deno-interop** geslaagd,
  alle stage-exits 0; eigen serializer-export 52 bestanden. R1/R2/POST-flag nu
  gerepareerd, geen nieuwe Windows-/SDK-build geclaimd.
- W1 blijft open: na unpair met incomplete binding weigert de gemengde route;
  onafhankelijke legacy-bypass blijft beschikbaar, daadwerkelijke callerbedrading
  moet dit regelen. Sampler-Q2 blijft een afzonderlijke caller-voorwaarde.
- Nieuwe bewijzen: `pitwall-learning-p2-observation-send-plan-count-spec-cli/`,
  `pitwall-learning-p2-observation-send-plan-count-quality-cli/` en
  `pitwall-learning-p2-observation-send-shutdown-integration/`. De eerder
  onderbroken SPEC-workers leverden geen oordeel en gelden niet als software-FAIL.
- Default-off, uitsluitend lokale onderschepte HTTP-proeven. Beide echte callers,
  plugin/settings/DPAPI/PairingGeneration en capture→ledger blijven onbedraad.
  Geen Windows-/SimHub-SDK-pluginbuild, live HTTP, model-/performance- of activatieclaim.
- Bewijs: `pitwall-learning-p2-observation-send-{lease-spec-recheck,quality-review,
  coverage-quality-recheck,integration}/` onder `/home/hermes/artifacts/3sm/`.

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
