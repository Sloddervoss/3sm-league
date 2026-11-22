# Pitwall-leesbaarheid — implementatie en publicatie

Datum: 22 november 2026  
Basis: `48b24fafdaef37589e4c9c829c38e3afa72bae45` (`origin/main`)  
Branch: `fix/pitwall-readability-20261122`  
Bereik: frontend van de premium Pitwall (`PitwallPremiumView`) op
`/admin/pitwall-test`, `/pitwall` en `/pitwall/shared`.

## Aanleiding

Op een 2560×1440-monitor stonden labels, metadata, tabelcellen en paneeltekst op
6,5–10 px. De focusweergave compenseerde ruimtegebrek door nog kleiner te typen
(6,5 px voor "LIVE TELEMETRIE · 1s polling"), en de gedempte kleur `#64717f`
haalde 4,0:1 op de paginabodem en 3,77:1 op een paneel. Daarmee waren
coureursnamen, positie, laatste/beste ronde, S1/S2, gap, PIT en de
offline-aanduiding op monitordistance niet betrouwbaar leesbaar.

## Wijziging

- `pitwallReadability.css` als presentatielaag na `testPremium.css` en
  `premiumFocus.css`.
- Leesbaarheidsondergrens: 11–11,5 px labels, 12–13 px secundaire tekst, 14 px
  tabelcellen, 15–24 px wedstrijdwaarden.
- Contrast ≥4,5:1 voor normale tekst; `—` en offline-status krijgen een eigen,
  leesbare kleur.
- Focus schaalt niet meer terug; vaste minimumrijen en scrollen. Op 1280–1400 px
  wikkelen de panelen naar drie kolommen; op 1280×720 scrolt de focuscontainer.
- Desktop paneelrij 236 → 272 px zodat de Pace-waarden volledig passen; in focus 210–230 px met een compacte Pace-grafiek.
- Gedeelde meekijkstand: vier panelen vullen de breedte; de vijfde
  (pitbevestiging) blijft owner-only en dus afwezig.
- Mijn Pitwall: deelstrook blijft ook in focus bereikbaar, maar is daar één compacte regel (kop, status, knop); de lange uitleg vervalt. Statusregel en knop zijn ook buiten focus leesbaar.
- `data-ptp-panel-count` op de panelenrij voor het 4/5-contract.
- Geen paneel, kolom of wedstrijdwaarde verwijderd. Geen backend-, DB-, RPC-,
  connector- of telemetriewijziging.

## Gates

- PASS: 1.089 gerichte pitwall-tests in 51 bestanden.
- PASS: browsercontrole 36 toestanden (3 varianten × 2 focus × 2 live/offline ×
  3 viewports): 0 tekst <11 px, 0 contrast <4,5:1, 0 afkapping, 0 horizontale
  overflow, 0 onbereikbare panelen. Bewijs:
  `docs/pitwall-look/evidence/pitwall-readable-20261122/`.
- PASS: `npx vite build`; de leesbaarheidsregels zitten in de gecompileerde CSS.
- PASS met kanttekening: `npm run typecheck` geeft 68 fouten, exact hetzelfde
  aantal en dezelfde bestanden als op de ongerepte basis. Geen fout in de
  gewijzigde bestanden. Dit is een bestaande, niet-gereguleerde schuld.
- PASS: `git diff --check`.
- PASS: fixture is login-vrij; geen productiesessie, share of write gebruikt.

## Publicatie

Uitrollen volgens `references/release-worktree-publishing.md`: verse worktree op
de host, `.env` uit de actieve release, `npm ci`, `npm run build`, preflight,
publiceren en SEO pinnen. Vóór de build een checksum-back-up van zowel
`/var/www/3sm` als de actieve `dist`. Na publicatie: HEAD, HTML-entrypoints en de
gehashte CSS/JS readbacken, inclusief de marker `--ptp-read-label:11.5px` in de
geserveerde CSS.

## Status

PRODUCTIEWIJZIGING: JA (alleen frontend; expliciete opdracht tot apply en
deploy). Backend/DB/connector: NEE.
