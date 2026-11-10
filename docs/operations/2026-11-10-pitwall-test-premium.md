# Pitwall-test premiumweergave — implementatie en rollback

Datum: 10 november 2026
Branch: `feat/pitwall-test-premium`
Basis: `52662644` (`release(simhub): 0.7.6.1 …`)

## Wat er is gebouwd

De route `/admin/pitwall-test` heeft naast de bestaande klassieke weergave een
nieuwe, standaard actieve premiumweergave. De nieuwe weergave is uitsluitend
presentatie: zij gebruikt dezelfde super-admin-guard, dezelfde read-only
RPC-projectie (`get_simhub_fleet`, `get_simhub_device_details`,
`pitwall_sandbox_v1`, bandenmodel- en pitstop-RPC's) en dezelfde polling als de
klassieke pagina. Er is geen nieuwe query, geen nieuwe poller, geen sortering-
of strategiewijziging.

De premiumweergave leest dezelfde bron als de klassieke pagina. `rpc` wordt
expliciet aan de Supabase-client gebonden: de methode losknippen verliest
`this` en faalt al vóór de netwerkcall. De routetest gebruikt daarvoor een
`this`-gevoelige mock die een gedetacheerde aanroep hard laat falen.

De premiumweergave bestaat uit:

- een compacte horizontale SimHub-apparaatdock in plaats van de brede zijbalk;
- een compacte contextkop met live-status, circuit, team, connector, leeftijd en
  een eerlijke `Sectoren: niet beschikbaar`-melding als de bron geen
  sectorindeling levert;
- de bestaande KPI-strip, beslissingsband, circuitkaart, eigen-auto-strook en
  vier panelen (Pace, Mijn sessie, Brandstof & stint, Banden), plus de bestaande
  pitbevestiging als vijfde compacte bedieningskaart;
- een nieuwe semantische timingtabel met klassekoppen, sticky kolomkoppen en een
  begrensd scrollgebied;
- een `Beweging`-schakelaar en een `Klassiek`/`Nieuw`-schakelaar.

De klassieke weergave is niet herschreven. De bestaande JSX staat nog onder
dezelfde `!premium`-branch en de bestaande componenten (`PitwallDashboard`,
`StandingsWidget`, `PitwallContextBar`, enz.) zijn ongewijzigd. De endurance-
pitwall (`PitwallTab`, `StandingsWidget`, `PitwallDashboard`, `TrackProjection`,
kaartgeometrie/autoposities) is niet aangeraakt.

## Weergavekeuze en beweging

- Standaard: **Nieuw**. Alleen op `/admin/pitwall-test`; er is geen route- of
  env-gate en de nieuwe weergave is dus ook in een productiebuild beschikbaar.
- Blijvende keuze: `localStorage`-sleutel `3sm.pitwall-test.view.v1` met
  `classic` of `premium`. Bij ontbrekende/geweigerde opslag valt de pagina bij
  openen terug op `premium`, maar een bewuste klik blijft in het geheugen staan.
  Het opruimen van de eigen URL-parameter overschrijft die keuze niet; externe
  navigatie (waaronder browser back) past een URL-override wel toe.
- Noodrem: `?pitwallView=classic` op de URL wint bij openen van de pagina. Een
  bewuste klik op `Klassiek` of `Nieuw` schrijft de lokale keuze en haalt de
  URL-parameter weer weg, zodat de knop niet schijnbaar dood is.
- Beweging: `localStorage`-sleutel `3sm.pitwall-test.motion.v1` (`on`/`off`).
  Zonder opgeslagen keuze staat beweging aan, behalve bij
  `prefers-reduced-motion: reduce`; die systeemvoorkeur wint altijd en zet de
  knop op uit/disabled. `data-motion="off"` zet naast de WAAPI-FLIP ook alle
  CSS-animaties, rondeflitsen, rijtransities en smooth scrolling in de
  premiumschil uit. De CSS respecteert daarnaast dezelfde media-query.
- De schakelaars zijn bereikbaar met toetsenbord, hebben `aria-pressed` en de
  `Beweging`-knop heeft een expliciete `title` bij systeemlock.
- De contextkop zegt `LIVE TELEMETRIE · 1s polling`, niet `READ-ONLY`: de
  pitbevestiging schrijft echte antwoorden. De voetnoot meldt alleen dat
  telemetrie automatisch ververst en claimt niet dat er niets wordt opgeslagen.

## Rij-animatie en eerlijke signalen

- FLIP via de Web Animations API, 320 ms, alleen op echte tabelrijen. De DOM
  toont altijd direct de nieuwste snapshot; er is geen freeze of wachtrij.
- Stabiele identiteit is `r.id`. De reducer vergelijkt uitsluitend positie en
  ronde per id, nooit rij-index, klassefilter of arrayvolgorde.
- `+1`/`-1` (of `+N`/`-N`) verschijnt alleen na een echte positiewijziging per
  auto. De tekst zegt expliciet "plaatsen gewonnen/verloren sinds de vorige
  meting" en claimt geen inhaalactie. Het signaal vervalt na 2,6 s per auto-id;
  een identiek frame herstart de flits niet en een reset/contextwissel ruimt de
  timers op.
- Een nieuwe ronde krijgt een korte flits met dezelfde id-gebonden levensduur;
  `PIT` komt uitsluitend uit `inPit` van de bron.
- Een ongeldige laatste ronde (reset/tow: sneller dan de beste ronde) blijft
  `—`, ook als de verse PACE-meting een tijd heeft. De tooltip is identiek aan
  de klassieke `StandingsWidget`.
- De eigen focuscel `Jij` toont dezelfde gap tot de auto voor je als de
  klassieke Voor/Jij/Achter-strook. Een ontbrekende/ongeldige Safety Rating
  toont expliciet `—`. Sectorcellen houden de bron-/afwijkingstooltip en de
  laatste/beste ronde en het startnummer houden dezelfde
  `data-timing`-attributen als de klassieke tabel.
- Eerste snapshot, apparaat-/sessie-/contextwissel, offline, datagat, een
  onmogelijke ronde-sprong en een verborgen tab zetten de vergelijking uit. Bij
  terugkomst wordt eerst opnieuw geijkt; oude races lekken niet door.
- Verdwijnt de tabel door een datagat, dan wist de FLIP-hook zijn oude basis.
  Komt de tabel terug, dan is dat een nieuw ijkpunt en geen animatie van
  posities die nooit in beeld zijn geweest.
- Klassefiltering en `Klassiek`/`Nieuw` wisselen resetten de FLIP-basis, zodat
  een filter geen schijnbare rijbeweging veroorzaakt.
- Zonder WAAPI-ondersteuning blijft de tabel correct en direct; alleen de
  animatie vervalt.

## Deployment-grens

- **Frontend-only** wijziging op één bestaande adminroute.
- **Geen** DB-schema, migratie, RLS, RPC, plugin, connector, Bot, Edge Function
  of productiedata gewijzigd.
- **Geen** wijziging aan de live endurance-pitwall, `App.tsx`, circuitgeometrie,
  `TrackProjection`, autoposities of sorteermath.
- **Geen** nieuwe env-variabele. Productiebuild gebruikt de bestaande
  Supabase-env; in een verse worktree zonder `.env` is de compile getest met
  `ALLOW_MISSING_SUPABASE_ENV=1`.
- Publicatie gebeurt door Hermes via een aparte release-worktree na de gates,
  op de expliciete opdracht van Vincent om uitsluitend de pitwall-test uit te
  rollen. De live endurance-look heeft daarmee geen publicatiegoedkeuring.

## Rollback

1. **Gebruiker/UI (snelst):** kies `Klassiek`. De keuze blijft lokaal bewaard;
   ook na reload blijft de klassieke weergave staan.
2. **URL-noodrem:** open `/admin/pitwall-test?pitwallView=classic`. Dit wint
   van de lokale keuze. Een klik op `Nieuw` heft de override op.
3. **Git:** maak vanaf de actuele `main` een aparte rollbackbranch en revert
   uitsluitend de featurecommits, nieuwste eerst. De featurebranch mag na de
   release geen ander werk bevatten:

   ```bash
   git switch -c fix/pitwall-test-premium-rollback origin/main
   git revert --no-commit $(git rev-list 52662644..feat/pitwall-test-premium)
   git commit -m "revert(pitwall): premium testweergave terugdraaien"
   ```

   Of revert de geïdentificeerde release-merge met `git revert -m 1 <merge-sha>`
   op die rollbackbranch. Inspecteer de diff vóór een nieuwe publicatie. Geen
   `reset --hard`, force-push of herschrijving van gedeelde geschiedenis.
4. **Deploy:** publiceer de vorige release `/opt/3sm-release-52662644` met diens
   `scripts/publiceer-release.sh`; deze zet ook de SEO-timer terug. De exacte
   voorafgaande webroot en dist zijn bovendien bewaard onder
   `/var/backups/3sm/pre-pitwall-test-premium-20261110/` op `3sm-web` met een
   SHA256-manifest. Geen database- of pluginrollback nodig.

## Bestanden

Nieuw onder `src/features/endurance/pitwall/test-premium/`:

- `viewSettings.ts` + `viewSettings.test.ts`
- `timingTransitions.ts` + `timingTransitions.test.ts`
- `usePitwallTestSettings.ts` + `usePitwallTestSettings.test.tsx`
- `useRowFlip.ts`
- `PremiumTimingPanel.tsx` + `PremiumTimingPanel.test.tsx`
- `testPremiumMotionCss.test.ts`
- `PremiumDeviceDock.tsx`
- `PremiumMasthead.tsx`
- `PitwallPremiumView.tsx`
- `testPremium.css`

Gewijzigd:

- `src/pages/PitwallDeviceTestPage.tsx`
- `src/test/pitwallPremiumRoute.test.tsx` (nieuw)
- `src/test/pitwallLookTestMode.test.tsx` (bewaakt expliciet de klassieke weergave)
- `docs/operations/2026-11-10-pitwall-test-premium.md` (dit document)

Niet gewijzigd: `src/features/endurance/pitwall/StandingsWidget.tsx`,
`PitwallDashboard.tsx`, `PitwallPanel.tsx`, `PitwallTab.tsx`,
`TrackProjection.tsx`, `src/lib/pitwallTrackGeometry.ts`, `src/App.tsx`,
`supabase/**`, `bot/**`, plugin/connectorcode.

## Verificatie

Uitgevoerd in de worktree op de eindstand:

- `npx vitest run src/features/endurance/pitwall/test-premium src/test/pitwallPremiumRoute.test.tsx src/test/pitwallLookTestMode.test.tsx src/test/pitwallLook.test.tsx`
  → **8 files, 82 tests passed**, exit 0. Inclusief een `this`-gevoelige
  Supabase-mock (een gedetacheerde `rpc` faalt hard), fake-timer-expiratie van
  +/− en rondeflits, de geblokkeerde-opslag/browser-back-harness, de
  noData-FLIP-reset, de ongeldige-tow-ronde en de CSS-motioncheck.
- `npx vitest run src/test/pitwallTyreModelUi.test.tsx src/test/pitwallVehicleTelemetry.test.tsx src/test/pitwallTrackProjection.test.tsx src/test/pitwallStandings.test.ts src/test/pitwallDeviceTestPage.test.ts`
  → **5 files, 109 tests passed**, exit 0.
- `npx vitest run` (hele suite) → **209 files passed + 1 bekende failure;
  1800 tests passed, 1 failed** (`tyreTelemetryContract`, dezelfde bestaande
  failure als de baseline).
- `npx eslint src/pages/PitwallDeviceTestPage.tsx src/features/endurance/pitwall/test-premium src/test/pitwallPremiumRoute.test.tsx src/test/pitwallLookTestMode.test.tsx`
  → exit 0, geen warnings.
- `npx tsc -p tsconfig.app.json --noEmit` → exit 2 met **exact dezelfde 16
  bestaande fouten** als de baseline (`TeamModal`, PayPal merchandise,
  `pitWindow.finalStintLaps`, `main.tsx`, catalogustyping); geen nieuwe
  diagnostics in gewijzigde bestanden.
- `npm run build` → exit 0, Vite-build plus route-HTML/sitemap/community-
  validatie/extension-ZIP.
- Tijdelijke lokale browserharness (niet gecommit) op 1920×1080: sticky
  tabelkop (`position: sticky`), begrensd scrollgebied (clientHeight 296,
  scrollHeight 897, 25 rijen), WAAPI-FLIP alleen op de twee verwisselde auto's
  (translate ±34 px), en geen animatie op de eerste snapshot of naburige rijen.
  Op 390 px wraps de dock/controls en is er geen horizontale documentoverflow.

## Definitieve parent-verificatie en vrijgavepoort

- Exacte codepoort: `34dd8089`. Astra vond op `617a41bd` één reconnect-FLIP-
  blokkade: bij behouden gecachete rijen kon de eerste herstelde snapshot nog
  bewegen. `useRowFlip` wist nu bij iedere uitgeschakelde toestand de basis vóór
  de resetKey-/meetlogica. Offline- en datagat-tests wisselen juist bij herstel
  de rijvolgorde; beide falen op de vorige commit en slagen na de fix.
- Astra-herkeuring: **GO voor test-only deployment**, geen nieuwe blokkade in de
  twee laatste fixes. Eigen in-memory probes: offline, gecachet gat, beweging
  uit/aan en resetKey tijdens uit leveren nul herstelanimaties; de volgende
  echte wissel animeert telkens wel. Geen algemene garantie over andere scopes.
- Echte ingelogde browserpass: **15 checks PASS**, fleet/detail/sandbox via echte
  HTTP-verzoeken, Klassiek/Nieuw beide richtingen, herlaadpersistentie,
  URL-noodoverride, geblokkeerde voorkeur-opslag, reduced-motion, meer analyse,
  geen documentoverflow op 1366/768/390 px, geen JS-fouten of pitstopmutaties.
  De vaste 64px-navbar bedekte aanvankelijk de nieuwe dock en klassieke
  terugschakelaar: uitsluitend de testshell en toegevoegde bediening hebben
  daarvoor bovenruimte gekregen (`072e2abc`). Normale pointerklikken slagen nu.
- Losse lokale, expliciet synthetische browserfixture: **10 checks PASS**, 41
  auto's / twee klassen, begrensde timing-scroll met sticky kolomkoppen,
  klassenfilter en Eigen rij, echte FLIP van alleen de twee gewisselde rijen,
  verdwijnende positie-indicators bij identieke frames, noData-/sessiereset,
  beweging uit en het bestaande pitstopvoorbeeld. Deze interceptie bestaat
  alleen in de lokale testbrowser; nooit in productiecode of datastroom.
- Parent-suite op definitieve code: **1801 geslaagd / 1 bestaande failure** in
  210 bestanden (209 geslaagd); de failure is exact dezelfde
  `tyreTelemetryContract` als op de basiscommit. Gericht: **83/83**. ESLint:
  exit 0. Typecheck: exact dezelfde **16** basisdiagnostics, geen nieuwe.
  Productiebuild met de bestaande publieke Supabase-config: exit 0.
- Bronallowlist: alleen de testpagina, nieuwe `test-premium/`-map, bijbehorende
  tests en dit document. Geen gedeelde endurance-, circuit-, backend-, DB- of
  pluginwijzigingen. Gebouwde premium-markers staan uitsluitend in de
  `PitwallDeviceTestPage-*` JS/CSS-chunks, niet in de endurance-/entry-chunks.

## Restrisico's en bewust behouden gedrag

- Tijdens de definitieve echte browserpass waren alle zeven apparaten offline;
  de gekozen echte snapshot bevatte twee tegenstanders. Een nieuwe echte
  inhaalactie is dus niet live geobserveerd. Beweging is gecontroleerd met de
  afzonderlijke lokale 41-auto-fixture, niet als echte racedata gepresenteerd.
- Vervolgfix: de onbekende sector-KPI blijft inmiddels zichtbaar, met een
  expliciete placeholder in de timingtabel. Zie
  `2026-11-10-pitwall-test-timing-visibility.md` voor de grotere timing en vaste
  eigen rij; de hieronder genoemde eerste-releasekeuzes zijn daar ingehaald.
- Geen automatisch scrollen naar de eigen rij; de Voor/Jij/Achter-strook en
  Eigen rij houden de eigen auto bereikbaar.
- De pitbevestiging is volledig behouden. Voorbeeldantwoorden worden niet
  opgeslagen; echte antwoorden volgen onveranderd de bestaande schrijfroutine.
- Bestaande bandencontracttest- en typecheckfouten zijn niet gerepareerd of
  stilzwijgend buiten de verificatie gehouden.
- Visuele goedkeuring van Vincent blijft vereist voordat endurance dezelfde
  look mag krijgen. Deze release autoriseert dat niet.
