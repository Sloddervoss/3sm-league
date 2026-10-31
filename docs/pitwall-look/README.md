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
| `pitwall-endurance-full.png` | endurance, volledige pagina (1920×2078) |
| `pitwall-test-full.png` | pitwall-test, volledige pagina (1920×1785) |

De viewport-beelden laten zien wat er zonder scrollen in beeld staat; de
`-full`-beelden tonen de vier panelen en de aanvullende blokken.

### Hoe ze gemaakt zijn

Deze omgeving heeft geen Supabase-env en geen inloggegevens, dus de echte
pagina's (`/endurance/...` en `/admin/pitwall-test`) kunnen hier niet in een
browser geopend worden. Daarom staat er een preview-harnas onder
`preview/`: dezelfde componenten, dezelfde Tailwind-laag, fixture-data in de
vorm van `v3_normalized` en `get_pitwall_data`. Het harnas staat buiten `src/`,
wordt door geen route geïmporteerd en zit niet in de build.

```bash
npx vite --config vite.pitwall-look.config.ts   # serveert /docs/pitwall-look/preview/*.html
node docs/pitwall-look/preview/shot.mjs         # schrijft de PNG's (Playwright)
```

`shot.mjs` gebruikt `--executablePath` naar de browser in
`~/.cache/ms-playwright`, omdat de Playwright-versie in deze werkboom een
nieuwere browser wil dan hier geïnstalleerd is. Op een machine met
`npx playwright install` is de standaardlaunch genoeg.

## Tests

- `src/test/pitwallLook.test.tsx` — KPI-groepen, live timing (eigen rij,
  coureur/team, gap-label, klassekoppen), pace, brandstof (endurance vs
  testmeting), banden (vier hoeken, eenheden), mijn sessie, coureur & wissel,
  het raster en de endurance-pagina zelf.
- `src/test/pitwallLookTestMode.test.tsx` — de pitwall-test-pagina met
  gemockte RPC's: "Mijn sessie" in plaats van "Coureur & wissel", hetzelfde
  raster, tankinhoud zonder strategie.
