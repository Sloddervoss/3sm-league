# Pitwall-look — Vincents ontwerp in de bestaande pitwall

## Actuele elementronde (vervangt oudere uitspraken hieronder)

Volledige inventaris en actuele bronbesluiten: `elementen.md` (86 regels).
Oplevering en checks: `elementen-verificatie.txt`; machineleesbare browserchecks:
`verification.json`. Categorie 1/2 gebouwd of behouden; ontbrekende bronnen
blijven expliciet hiaten. Historische opmerkingen hieronder zoals “geen delta”,
“geen tabs”, “geen planningstimer” zijn door deze ronde deels achterhaald.
Planning wordt nooit als gemeten stint- of sessielimiet verkocht.

Nieuw: echte timingweergaven met broninhoud, pacekeuze, verstreken sessietijd,
expliciete rondedelta, optionele vochtdata, sectorlegenda, planningklok/-lijst,
pitwindowbalk, restbalken en bestaand modelbereik. Twee bestaande nullable
eventplanningkolommen worden via de bestaande eventleesroute meegenomen;
geen schema-/RPC-/plugin-/advieswijziging.

Actueel bewijs: volledige Vitest 195 bestanden / 1638 tests PASS; Vite-bundel PASS;
beide 1080p-beelden visueel PASS. Typecheck en drie ESLint-errors in de bestaande
testpagina zijn aantoonbaar onveranderd vanaf bfcc387.


Dit is de look-update van de pitwall: de opbouw van het referentiebeeld
(contextregel, KPI-strip, beslissingsband, circuit links / timing rechts, vier
panelen, aanvullende blokken) voor **beide** modi — de endurance-pitwall en de
pitwall-test.

Er is niets veranderd aan databronnen, RPC's, berekeningen, adviespoorten,
polling, cache of toegangsrechten.

## Raster

| Plek | Endurance | Pitwall-test |
| --- | --- | --- |
| Contextregel | race · team · rijder · auto · status | apparaat · circuit · connector · laatst gezien · status |
| KPI-strip | sectoren / laatste+beste / P+K+ronde+resttijd | idem |
| Beslissingsband | `DecisionBand` (ongewijzigd) | idem |
| Links (≈1/3) | `LiveTrackPanel` + `OwnCarPanel` | `LiveTrackPanel` |
| Rechts (≈2/3) | `StandingsWidget` | idem |
| Paneel 1 | `PacePanel` (oranje lijn) | idem, op `lap_samples` |
| Paneel 2 | `StintDriverPanel` (Coureur & wissel) | `MySessionPanel` (Mijn sessie) |
| Paneel 3 | `FuelPanel` | idem, tankinhoud als enige meting |
| Paneel 4 | `VehicleTelemetryPanel` (Banden) | idem |

Het raster staat in `PitwallDashboard`. Onder 1280 px stapelen de twee
hoofdkolommen; de vier panelen gaan naar twee kolommen (≥768 px) en daarna naar
één kolom. Er wordt niets verkleind om het te laten passen.

## Wat er bewust niet is overgenomen uit het referentiebeeld

- Geen `P12 / 28` of `K5 / 14`: de tegenstandersnapshot is begrensd.
- Geen delta-tegel laatste-vs-beste: dat is een nieuwe berekening.
- Geen pitstop-aantallen, geen compound- of setnummers, geen bandenleven.
- Geen tweede lijn in de pace-grafiek en geen fictieve tabs (Stints/Pit Stops).
- Geen stinttimer of voortgangspercentage: vraagt nieuwe tijdslogica.
- Geen checkmarks bij de coureurswissel: een planning is geen bevestiging.

## Componenten

Nieuw: `PitwallPanel.tsx` (paneelvlak + waarde), `PitwallDashboard.tsx` (raster),
`PitwallContextBar.tsx`, `OwnCarPanel.tsx`, `MySessionPanel.tsx`.

Herstyled, zelfde data en logica: `RaceTelemetryStrip` (KPI-groepen),
`StandingsWidget` (live timing), `PacePanel` + `PaceGraph`, `FuelPanel`,
`StintDriverPanel`, `VehicleTelemetryPanel`, `LiveTrackPanel`.

Verwijderd omdat hun inhoud nu elders staat en dubbel zou zijn: `TopRaceBar`
(P/K/ronde/resttijd → KPI-strip, brandstof/range → `FuelPanel`, leider-gap →
`OwnCarPanel`, pitactie → `DecisionBand`, offline → contextregel) en
`RacePositionPanel` (positie/klasse/ronde → KPI-strip, leider-gap →
`OwnCarPanel`).

## Screenshots

| Bestand | Wat |
| --- | --- |
| `pitwall-endurance-1920x1080.png` | endurance, viewport 1920×1080 |
| `pitwall-test-1920x1080.png` | pitwall-test, viewport 1920×1080 |
| `pitwall-endurance-full.png` | endurance, volledige pagina (1910×1529) |
| `pitwall-test-full.png` | pitwall-test, volledige pagina (1910×1275) |

De viewport-beelden tonen nu de vier hoofdpanelen volledig zonder paginascroll.
De `-full`-beelden tonen alle aanvullende blokken na het openen van ‘Meer analyse’. De browser toont echte
scrollbars; daardoor is de volledige-paginacapture 1910 px breed, terwijl de
viewportcapture 1920×1080 blijft.

### Hoe ze gemaakt zijn

Deze omgeving heeft geen Supabase-env en geen inloggegevens, dus de echte
pagina's (`/endurance/...` en `/admin/pitwall-test`) kunnen hier niet in een
browser geopend worden. Daarom staat er een preview-harnas onder
`preview/`: dezelfde componenten, dezelfde Tailwind-laag, fixture-data in de
vorm van `v3_normalized` en `get_pitwall_data`. Het harnas staat buiten `src/`,
wordt door geen route geïmporteerd en zit niet in de build.

```bash
npx vite --config vite.pitwall-look.config.ts   # serveert /docs/pitwall-look/preview/*.html
bash scripts/ensure-playwright-runtime.sh node docs/pitwall-look/preview/shot.mjs
```

`shot.mjs` gebruikt `--executablePath` naar de browser in
`~/.cache/ms-playwright`, omdat de Playwright-versie in deze werkboom een
nieuwere browser wil dan hier geïnstalleerd is. `ensure-playwright-runtime.sh` levert de bestaande user-local NSS/NSPR-libraries.
De screenshot-run faalt bij browserfouten, externe requests of een mislukte
layout-/scrollassertie en schrijft ook `verification.json`.

## Tests

- `src/test/pitwallLook.test.tsx` — KPI-groepen, live timing (eigen rij,
  coureur/team, gap-label, klassekoppen), pace, brandstof (endurance vs
  testmeting), banden (vier hoeken, eenheden), mijn sessie, coureur & wissel,
  het raster en de endurance-pagina zelf.
- `src/test/pitwallLookTestMode.test.tsx` — de pitwall-test-pagina met
  gemockte RPC's: "Mijn sessie" in plaats van "Coureur & wissel", hetzelfde
  raster, tankinhoud zonder strategie.

## Compacte 1080p-afwerking

Startpunt: `4fc057e`, bestaande branch `feat/pitwall-look-3sm`.

- `src/features/endurance/pitwall/pitwallLook.css`: lokaal gescopeerde
  paneelheaders, 12 px secundaire labels met hoger contrast, compacte
  circuitruimte/eigen-autostrook en een horizontaal ingedeelde beslissingsband.
  Hoofdwaarden worden niet verkleind. Onder 1280 px vervalt de compacte
  desktopindeling; de bestaande twee-/éénkolomsvolgorde blijft behouden.
- `src/features/endurance/pitwall/PitwallDashboard.tsx`: importeert die styling.
- `src/features/endurance/pitwall/DecisionBand.tsx`: alleen CSS-ankers;
  alle voorwaarden, adviesinhoud en live-region-eigenschappen zijn gelijk.
- `src/features/endurance/pitwall/StandingsWidget.tsx`: 400 px desktopvlak,
  intern scrollbare tabel met sticky kolomkoppen, benoemde focusbare regio
  en zichtbare scrollhint. Alle tegenstanders blijven in de tabel aanwezig.
  Buiten de brede indeling is de tabel maximaal 360 px hoog.
- `src/test/pitwallLook.test.tsx`: extra regressietest voor toegankelijk
  scrollvlak, eigen rij en behoud van tegenstanders.
- `docs/pitwall-look/preview/shot.mjs`: viewport- én volledige captures,
  browserasserties en een machineleesbaar verificatierapport.

### PASS/FAIL

- PASS — volledige `npm test`: 193 bestanden / 1589 tests.
- PASS — ESLint op de vier gewijzigde TSX-/testbestanden; `git diff --check`.
- PASS — beide modi op 1920×1080: onderrand vier panelen op respectievelijk
  1047 px (endurance) en 1040,5 px (test). Meetresultaten: `verification.json`.
- PASS — muiswiel én toetsenbord bereiken het einde van live timing;
  paginascroll en paneelpositie blijven gelijk.
- PASS — 64 extra DOM-rijen vergroten de documenthoogte niet. Dit is uitsluitend
  een browser-layoutstresstest, geen nieuwe fixture of gewijzigde databron.
- PASS — 1440, 1024 en 390 px zonder horizontale paginaoverflow;
  twee panelen per rij bij 1024 px en één per rij bij 390 px.
- PASS — raw-telemetrie-uitklapper opent in het testharnas;
  geen browserfouten en geen externe netwerkrequests.
- FAIL, bestaand — `npm run typecheck`: 13 diagnostics in TeamModal,
  community-support, pitWindow/strategy.test en main.tsx. Een losse `git archive`
  van startcommit `4fc057e` produceert exact dezelfde diagnostics na het
  normaliseren van het tijdelijke pad. Niet opgelost binnen deze look-opdracht.

### Bewust behouden en verificatiegrens

De aanvullende strategie, meldingen, tijdlijn en diagnostiek blijven onder het
hoofdscherm staan: een volledige pagina is dus bewust hoger dan 1080 px. Geen
inhoud verborgen of verwijderd om de vier panelen te laten passen.

De screenshots tonen fixturecomponenten, geen ingelogde productieroutes. De
omliggende sitenavigatie, apparatenlijst en geopende Race Control zijn niet in
dit harnas opgenomen; er wordt geen volledige live-routeverificatie geclaimd.
Een extra lang advies, een open bedieningspaneel of grotere browsertekst mag
meer paginaruimte innemen; daarvoor wordt niet geclipt.

De fixture toont bestaande niet-consistente cijfers en een bestaande melding
voor ontbrekende officiële projectiegeometrie met kaartfallback. Beide zijn
bewust niet gerepareerd. Trackassets, herkenning, projectie, markers en
pitmarkering zijn niet gewijzigd; alleen de beschikbare schermruimte is anders.

Impact: uitsluitend frontendpresentatie in de worktree. Backend/API, bot,
database/migraties, auth/rollen en deployment: geen wijzigingen.
Productiefrontendwijzigingen: NEE. Niet gepusht, niet gemerged, niet gedeployed.

## Visuele vergelijking met origineel

Zie `ontwerpvergelijking.txt` voor de vergelijking per verschil, de expliciete
grenzen en de nieuwe verificatie. De eerdere claim dat de volledige opbouw
van het referentiebeeld is gevolgd was te ruim: contextregel, beslissingsband
en aanvullende blokken komen uit de bestaande pitwallbrief, niet uit het
originele beeld. De nieuwe ronde herstelt onder meer losse KPI-containers,
compacte timingrijen, oranje selectieaccenten en de bredere pacekaart met
raster en meetpunten. Screenshots en `verification.json` zijn vernieuwd.


## Afwerking: aanvullende analyse standaard ingeklapt

De gedeelde `PitwallDashboard` plaatst uitsluitend de bestaande `extra`-inhoud
achter een native `details`/`summary` met één regel ‘Meer analyse’. De inhoud,
componentprops en databronnen zijn niet gewijzigd. De inhoud blijft gemount;
openen kan met één klik of met het toetsenbord. Zonder extra inhoud verschijnt
geen lege uitklapper. De bestaande raw-telemetrie-uitklapper blijft binnen deze
sectie zelfstandig werken.

Om ook deze regel geheel binnen 1080p te houden, is het desktop-timingvlak
368 px hoog en de eerdere 20 px ondermarge bij de circuitvoortgang verwijderd.
Geen hoofdwaarden of paneelinhoud zijn verkleind of verwijderd.

Actuele verificatie (vervangt de eerdere viewportmetingen hierboven):
- PASS — volledige `npm test`: 193 testbestanden, 1591 tests.
- PASS — ESLint voor dashboard en looktests; `git diff --check`.
- PASS — browserharnas voor beide modi: ingeklapt document exact 1080 px hoog,
  vier panelen volledig zichtbaar, ‘Meer analyse’ volledig binnen de viewport,
  extra blokken niet zichtbaar; muisklik en Enter openen/sluiten de sectie.
- PASS — paneelonderrand endurance 1027 px, test 1008,5 px.
- PASS — bestaande timing-scroll-, groei-, raw-telemetrie- en responsivechecks.
- PASS — beide nieuwe 1920×1080 screenshots afzonderlijk met `vision_analyze`
  gecontroleerd: geen FORECAST-/BANDENMODEL-strook of andere aanvullende
  blokrand zichtbaar. Alleen ‘Meer analyse’ en donkere marge onder de panelen.

Screenshots zijn lokale fixtures met echte componenten, geen verificatie van
ingelogde productieroutes. Backend/API, bot, DB/migraties, auth/rollen en
deployment: geen impact. Productiefrontendwijzigingen: NEE.
Niet gepusht, niet gemerged, niet gedeployed. PRODUCTIEWIJZIGING: NEE.


## Datagaten: brongecontroleerde uitbreiding

Actuele analyse: `datagaten.md`. De eerdere opmerkingen hierboven over ontbrekende
compound-/setgegevens zijn hiermee achterhaald: de bestaande plugin en ingest
leveren deze optioneel al. Nieuw in beide modi:

- `VehicleTelemetryPanel.tsx`: compound-ID (geen onbewezen compoundnaam), gebruikte
  en beschikbare sets; sentinel 255 voor beschikbaar wordt “onbeperkt”.
- `LiveTrackPanel.tsx`: baan-/luchttemperatuur in °C en rubberconditie, boven de
  voortgangsmarkers zodat ze niet overlappen. Rubberconditie is géén nat/droogstatus.
- `pitwallHelpers.ts`: optioneel `tyres` via het bestaande servertype, zonder
  runtime-import of nieuwe contractvorm.
- Ontbrekende/ongeldige waarden worden niet aangevuld. Eigen bandenwaarden
  verdwijnen buiten de auto en offline; sessieomgeving verdwijnt offline.
- Eigen sectortijden waren al zichtbaar. Geen stinttimer uit planningsdatums.

De nieuwe screenshotwaarden voor deze uitbreiding komen expliciet uit de
bestaande plugin-testfixture `v3-frame-baseline.json`, via de echte bandenparser.
Dit zijn testwaarden, geen productieobservaties; de overige voorbeelddata blijft
ongewijzigd. Er is niets gepubliceerd.

Verificatie van deze ronde: `datagaten-verificatie.txt`. Vier screenshots vernieuwd;
beide 1080p-beelden opnieuw visueel gecontroleerd. Bij 1920×1080 blijft de
onderrand endurance 1027 px en is de onderrand test 1012,5 px; Meer analyse
blijft volledig binnen beeld. Geen overlap tussen de weerregel en automarkers.
De browser controleert dit ook bij 1440, 1024 en 390 px.

Voor een bezette standaardpoort ondersteunt `preview/shot.mjs` nu
`PITWALL_PREVIEW_BASE`; deze ronde draaide de eigen tijdelijke server op 5198.
De al draaiende server op 5199 is niet gestopt of aangepast.

Frontendpresentatie gewijzigd; backend/API, plugin, bot, database/migraties,
auth/rollen, adviespad en deployment ongewijzigd. Productiefrontendwijzigingen: NEE.


## Visuele gelijkenis — opdracht 2026-11-01

Actueel verslag: `visuele-gelijkenis-2026-11-01.txt` (vervangt eerdere
maatvoeringen en visuele conclusies hierboven). Twee iteraties met doelbeeld
en eigen screenshot naast elkaar in vision_analyze, plus eindcontrole van beide
modi. Grootste afwijkingen in compositie en daarna typografie weggewerkt.
Volledige Vitest opnieuw groen: 195 bestanden / 1638 tests.
Vier screenshots vernieuwd; `verification.json` bevat nu ook computed-style-
en afknipcontroles. Vier panelen volledig binnen 1080p in beide fixtures.
Geen data-, RPC-, reken-, advies-, polling- of toegangsverandering.
Niet gepusht, gemerged of gedeployed. PRODUCTIEWIJZIGING: NEE.


## Circuitkaart — nieuwste ronde 2026-11-01

Deze ronde vervangt eerdere uitspraken hierboven dat de kaart ongewijzigd is
of dat de screenshots uitsluitend de kaartfallback tonen. Zie
`kaart-verificatie.txt` voor scope, bronbestanden, tests, visuele iteraties en
verificatiegrenzen. De nieuwe lokale fixture gebruikt de exacte bestaande
Spa-layout 163. Assets, herkenning, projectiegeometrie en motionberekeningen
zijn ongewijzigd. De sectorlegenda staat niet meer bij de kaart; oranje betekent
alleen het gereden deel. Rondebalk en alle bestaande fallbacks blijven bestaan.
Actueel: volledige Vitest 196 bestanden / 1643 tests PASS; browserharnas beide
modi PASS; Vite-bundel PASS. Typecheck: dezelfde 13 diagnostics als startcommit.
