# Premium Pitwall — clean hierarchy (lokaal, 23 november 2026)

Basis: `9ac05c24` (`feat(pitwall): raise secondary type to 14-15px on 2560 and below`)
Worktree: `/home/hermes/wt/pitwall-readable-20261122`
Bereik: uitsluitend presentatie van de premium Pitwall (`PitwallPremiumView`) op
de Test Pitwall, Mijn Pitwall en de gedeelde meekijkstand. Geen push, merge of
deploy. Klassieke/non-premium pitwall, routes, queries, sortering, RPC's,
autorisatie en berekeningen zijn niet gewijzigd.

## Onderzoek — wat een pitwall leesbaar maakt

Korte bronnenstudie vóór de restyle:

| Bron | Bevinding | Link |
|---|---|---|
| iRacing, *Black Box Screen Information and Controls* | F2 **Standings** is de running order met overall gap; F3 **Relative** is een aparte, kleine set auto's dichtbij met afstand in seconden; F4 **Fuel** toont `Remaining` én `Est. Laps`; F1 **Lap Timing** toont current/last/best en ahead/behind. Dus: klassement en dichtstbijzijnde auto's zijn twee verschillende blikken. | https://support.iracing.com/support/solutions/articles/31000167257-black-box-screen-information-and-controls |
| Racelab Garage, *The Lumina Theme & Column Reordering* | Lumina is bewust "clean, readable" voor Standings/Relative; kolommen zijn vrij te herordenen (bijv. iRating naast naam, gap vóór rondetijden). | https://garage.racelab.app/news/2025/12/13/2025/lumina-theme |
| Racelab Garage, release 8.6.0 | `Target per lap` in de fuel calculator (doel per ronde, met rood/groen t.o.v. laatste ronde); TOW-badge met resterende tijd; instelbare decimalen voor gap/interval. | https://garage.racelab.app/release-notes/2026/10/25/2026/v8.6.0 |
| FIA WEC / 24H Le Mans, *Live timing — a handy guide* | Eerste kolom is overall positie; daarna klassepositie (PiC), nummer/klasse, team/rijder, best lap en gap met de leider, sectoren, laatste ronde, rondes en pits. Klassefilter is expliciet onderdeel van de Leeswijzer. | https://www.24h-lemans.com/en/news/live-timing-at-the-24-hours-of-le-mans-a-handy-guide-59698 |
| FIA WEC live timing | Officiële live-omgeving met dezelfde scheiding van overall/klasse, gaps en pits. | https://www.fiawec.com/en/page/live-fiawec |

Ontwerpconclusies die in deze ronde zijn toegepast:

1. **Wedstrijd eerst, verbinding tweede.** Circuit + coureur/auto/team is de
   titel; apparaatnaam en connector zijn context.
2. **Klassement en dichtstbij zijnde auto's apart.** De timingtabel is de
   running order; de strook erboven blijft Voor/Jij/Achter met een expliciete
   "tot voor"-duiding voor de eigen gap.
3. **Gap vroeg in de leesrichting.** `P · # · Coureur · Gap · Laatste · Beste ·
   S1–S3 · Ronde · Pit · Auto`, met vaste, rechts uitgelijnde cijfers.
4. **Eén titel per paneel.** Geen "Timing tower" boven "Live timing" boven een
   tab "Live timing"; de tab heet zichtbaar "Alles" (toegankelijke naam blijft
   "Live timing").
5. **Hulpregels inkorten, niet de waarschuwing.** De volledige snapshot- en
   R-uitleg blijft als `title`/toegankelijke tekst; zichtbaar wordt één regel.
6. **Bronversheid blijft gescheiden.** "Apparaat gezien", "Telemetrie" en de
   lokale paneelstatus (bijv. "Telemetrie offline", "Laatst beschikbare
   bandenmeting") zijn niet samengevoegd of verborgen.

## Wat is gewijzigd

- `PremiumMasthead.tsx`: race-eerst kop. Circuit is de zichtbare titel,
  coureur/#/auto/team staan eronder, apparaatnaam is een kleine contextregel.
  De zes bestaande meta-slots en het refresh-contract blijven bestaan; Circuit,
  Team en Sectoren worden niet nog eens getoond. De pollregel blijft als
  schermlezerdetail.
- `PremiumTimingPanel.tsx`: één timingkop met telling, "Alles/Klasse" als
  mode-switch, lokale live/offline-indicator en "Eigen rij". Gap staat vóór
  laatste/beste; auto staat achteraan. De klasseband blijft bestaan (bestaand
  contract), ook bij één klasse. De eigen gap krijgt "tot voor" en een
  `title`/`aria-label`; de snapshotregel is ingekort maar houdt
  "geen volledig klassement" en "geen inhaalclaim".
- `premiumClean.css`: nieuwe presentatielaag ná `pitwallReadability.css`.
  Regelt de masthead-grid, timingkop, tabelmaten, compacte eigen-auto-strook en
  compacte laatste-stop, plus responsive gedrag. Geen fontmaat onder 14 px.
- `PitwallPremiumView.tsx`: geeft het eigen racenummer door aan de masthead en
  laadt de nieuwe laag als laatste.
- `src/test/pitwallPremiumClean.test.tsx`: vier gerichte regressietests voor
  hiërarchie, één timingtitel, kolomorde en de ingekorte snapshottekst.

Bewust **niet** gewijzigd: `LiveTrackPanel`/`TrackProjection` (plaatsing,
geometrie, markers), `PitwallDashboard`-raster, aantal panelen (5/4),
`DecisionBand`-logica, alle RPC's/queries, rechten en offline-drempels.

## Bewijs —zelfde fixture,zelfde data

Fixture: `docs/pitwall-look/preview/premium-readability.html` (test/personal/
shared; live/offline; normaal/focus). Synthetische data, exact dezelfde
componenten en CSS als de drie premiumroutes. Geen productiesessie, sharelink,
database of connector gebruikt.

### Geometrie op 2560×1440 (gemeten in de browser, scroll 0)

| Meting | Voor | Na | Verschil |
|---|---:|---:|---:|
| Documenthoogte normaal live | 1882 px | 1757 px | **−125 px** |
| Masthead hoogte | 132 px | 84 px | **−48 px** |
| Laatste-stop hoogte | 135 px | 61 px | **−74 px** |
| Timing begint (normaal live) | y=624 | y=499 | **−125 px** |
| Panelenrij begint (normaal live) | y=1492 | y=1367 | **−125 px** |
| Documenthoogte normaal offline | 1747 px | 1696 px | **−51 px** |
| Focus: timinghoogte live | 627 px | 640 px | **+13 px** |
| Focus: panelenrij | y=1071 | y=1071 | gelijk |
| Panelen (test/personal/shared) | 5/5/4 | 5/5/4 | gelijk |

De focuscompositie blijft binnen 1440 px; de timingtabel scrolt daar zoals
voorheen. De gewonnen hoogte in normaal gaat naar de timing en de panelenrij,
niet naar kleinere letters.

### Zichtbare copy

Greep uit de verwijderde/verplaatste herhaling (40 zichtbare woordtokens):

| Voor | Na |
|---|---|
| `Timing tower · 10 auto's` + `Live timing` + tab `Live timing` + tab `Klasse` (één klasse) | `Live timing` + `10 auto's` + `Alles` |
| `Circuit`- en `Team`-meta plus `Sectoren · 3 beschikbaar` | circuit/team staan in de titel/identiteitsregel; sectoren in de KPI |
| `LIVE TELEMETRIE · 1s polling` zichtbaar naast `LIVE` | alleen `LIVE`; pollregel naar schermlezerdetail |
| `R… bij een sectortijd = laatst geverifieerde volledige ronde; live sectoren tonen hun eigen ronde.` | `R = laatst geverifieerde ronde` + volledige uitleg in `title` |
| `Snapshot van tegenstanders, geen volledig klassement. +/− is … Scroll voor alle rijen.` (27 tokens) | `Snapshot, geen volledig klassement · gap t.o.v. jou · +/− = positie sinds vorige meting, geen inhaalclaim.` (18) |
| `Gap tot jou`-kop | `Gap` (toegankelijke naam `Gap tot jou`) |
| `eigen auto`, `testmodus`, `Rijder` in paneelkoppen | weggelaten; paneeltitel + waarde dragen de betekenis |

### Contrast, afkapping en panelen

De volledige browsermatrix (36 runs: 3 varianten × 3 viewports × normaal/focus ×
live/offline):

| Meting | Voor | Na |
|---|---:|---:|
| Tekst onder 11 px | 0 | **0** |
| Contrast onder 4,5:1 | 0 | **0** |
| Afkapping zonder eigen scroll | 0 | **0** |
| Horizontale pagina-overflow | 0 | **0** |
| Panelen kwijt/verkeerd aantal | 0 | **0** |
| Console-/page-/requestfouten | 0 | **0** |
| Focus-scroll onbereikbaar | 0 | **0** |

Extra steekproef 1024×768, 768×1024 en 390×844 (normaal + focus): geen
horizontale pagina-overflow, alle vijf panelen aanwezig, KPI's stapelen op
390 px in 3 kolommen (positie) en 3 kolommen met extra delta-ruimte
(rondetijd). Bewijs: `after/responsive-matrix.json` en de
`responsive-*.png`-beelden.

### Beelden

- `before/native-test-normal-live-2560x1440.png` / `after/...`: dezelfde crop,
  normale weergave live.
- `before|after/native-test-normal-offline-2560x1440.png`: idem offline.
- `before|after/native-test-focus-live-2560x1440.png` en `-offline`: focus.
- `compare-normal-live-2560x1440.png`, `compare-normal-offline-...`,
  `compare-focus-live-...`, `compare-focus-offline-...`: voor/na onder elkaar.
- `compare-header-crop-2560.png`: dezelfde kop/KPI/timingkop-crop.
- `after/test-normal-live-2560x1440.png` (volledige pagina) en de overige
  runnerbeelden: complete capture per toestand.
- `geometry.json`: gemeten rechthoeken uit de browser.
- `after/report.json`: ruwe 36-runmatrix.

## Tests en checks

- `npx vitest run` — **2492 geslaagd, 3 bestaand falend** in
  `simHubConnectorContract.test.ts` (2) en `tyreTelemetryContract.test.ts` (1).
  Dezelfde 3 falen op de onaangeraakte basis `9ac05c24`; niet veroorzaakt door
  deze ronde.
- Gerichte set (PremiumTimingPanel, sectorLayout, pitwallUxDefects,
  pitwallPremiumRoute, pitwallReadability, nieuwe clean-test): **74/74 groen**.
- `npx eslint` op de vier gewijzigde TSX/TS-bestanden: **schoon**.
- `npm run typecheck`: **68 diagnostics, exact gelijk aan de basis** (51 in
  `observationV1.ts`, overige bestaand in checkout/community-support/main).
- `npm run build`: Vite-bundel **PASS** (8,17 s). De volledige build stopt
  daarna in `generate-route-html.mjs` omdat de lokale omgeving geen Supabase/
  API kan bereiken (`fetch failed`, sitemap < 25 URL's). Dat is een
  omgevingsbeperking, geen bundelfout.

## Grenzen

- Dit bewijst presentatie, niet de juistheid van live data/RPC's.
- De fixture laadt de bestaande circuitprojectie; in een vroege opname was die
  nog in de laadstand zichtbaar. `LiveTrackPanel`/`TrackProjection`, positie en
  markers zijn niet gewijzigd.
- De fixture bevat bestaande, onderling afwijkende waarden (KPI R48 vs
  timingrij R46; verschillende last/best-tijden). Die zijn bewust zelfde data
  gelaten en niet "opgelost"; dit is geen databronwijziging.
- Op sommige focusviewports moet de timingtabel of focus-shell scrollen; dat is
  bestaand gedrag ("scroll, niet krimpen") en de scrollbaarheid is getest.
- De screenshots zijn de login-vrije fixture, niet de ingelogde productieroute.
  Geen productie-uitrol, push of merge.
