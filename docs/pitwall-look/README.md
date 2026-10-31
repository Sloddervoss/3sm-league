# Pitwall-look — Vincents ontwerp in de bestaande pitwall

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
