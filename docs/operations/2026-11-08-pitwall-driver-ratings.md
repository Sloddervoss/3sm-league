# Live timing: iRating en Safety Rating

Branch: `codex/pitwall-driver-ratings`, bijgewerkt naar server-main `ab3db2f`
via `3sm-sync.ps1 -Mode pull -Werkplek <deze werkmap>`.
Status: gebouwd en lokaal geïnstalleerd in SimHub; opstartkoppeling in het echte
SimHub-log bevestigd. Geen website-deploy, DB-wijziging of publieke connectorrelease.

## Gedrag en gegevensbron

De live-timingtabel toont `P · # · Coureur · iR · SR · Klasse · Laatste · Beste · [sectoren] · Ronde · Gap tot jou · Pit`.
De losse K-kolom en K-labels in Voor/Jij/Achter zijn verwijderd. Klassepositie
blijft in het contract en de bestaande klassesortering beschikbaar.

`RawChannelReader.ReadDriverRatings()` leest de bestaande bron
`NewData.RawData.SessionData.DriverInfo.Drivers` per uitgaand frame.
`DriverInfo` staat naast `SessionInfo`; de oude geneste vorm
`SessionData.SessionInfo.DriverInfo.Drivers` is alleen een compatibiliteitsterugval.
Dezelfde bronkeuze geldt voor `ReadCarIndices()`.
`IRating` wordt `irating`, `LicSubLevel / 100` wordt `safetyRating` en
`LicLevel` wordt de licentieklasse (1–4 R, 5–8 D, 9–12 C, 13–16 B,
17–20 A, 21–24 Pro, 25–28 WC). De sessiewaarden zijn geen voorspelling van
ratingwinst of -verlies tijdens de race.

De connector koppelt op exact autonummer én overeenkomende volledige coureursnaam
(hoofdletterongevoelig, witruimte aan de randen verwijderd). Geen koppeling op
volgorde, teamgemiddelde of vorige rijder. Dubbele autonummers leveren geen rating
op. Elke snapshot leest opnieuw; een rijderswissel of verdwenen sessiebron kan
geen ratings uit een vorige snapshot meenemen. Een afwijkende naamweergave in een
SimHub-versie kan daardoor bewust onbekende ratings opleveren.

De drie velden zijn optioneel en worden bij ontbreken niet geserialiseerd.
De ontvanger accepteert oude connectors en leegt ongeldige ratings per veld.
De website toont `—` zonder geldige gegevens; Safety Rating vereist ook een
herkende licentieklasse. SR 0.00 blijft geldig; iRating 0 is onbekend.

## Gewijzigde bestanden

- `src/features/endurance/pitwall/StandingsWidget.tsx`: kolommen, badges, onbekende waarden en legenda.
- `src/features/endurance/pitwall/pitwallHelpers.ts`: optionele opponentvelden.
- `src/features/endurance/pitwall/pitwallLook.css`: kleurregels volgen de betreffende gegevensvelden in plaats van kolomnummers.
- `supabase/functions/_shared/opponents.ts`: additieve validatie van ratings.
- `tools/simhub-plugin/3SM.EnduranceConnector/RawChannelReader.cs`: sessielezer en identiteitscontrole.
- `tools/simhub-plugin/3SM.EnduranceConnector/EnduranceConnectorPlugin.cs`: koppeling aan de opponent-snapshot.
- `tools/simhub-plugin/3SM.EnduranceConnector/TelemetryContractsV3.cs`: drie optionele wirevelden.
- `tools/simhub-plugin/3SM.EnduranceConnector/AssemblyInfo.cs`: lokale kandidaatversie 0.7.6.1.
- `src/test/pitwallDriverRatings.test.tsx`: parser → stand → rendering, oudere connector, foutwaarden en rijderswissel.
- `src/test/pitwallLook.test.tsx`: bestaande verwachting bijgewerkt voor het verwijderen van K.
- `tools/simhub-plugin/3SM.EnduranceConnector.DiagnosticsTests/DriverRatingTests.cs`: lezer, identiteit, licentiegrenzen, ontbrekende bron en echte DTO-serialisatie.
- `tools/simhub-plugin/3SM.EnduranceConnector.DiagnosticsTests/FaseDTests.cs`: registratie in de bestaande harness en gerichte testmodus.
- `tools/simhub-plugin/3SM.EnduranceConnector.DiagnosticsTests/DriverRatingRunner.cs` en `run-driver-rating-tests.ps1`: dezelfde tests tegen de gebouwde .NET Framework-plugin zonder .NET 8 SDK.
- Dit verslag.

## Impact en ingebruikname

- Website: alleen live timing; bestaande horizontale scroll blijft beschikbaar.
- Backend/API: drie additieve velden in bestaande V3-opponentdata. Protocol blijft 3.
- Database: geen tabellen, migraties of RPC-wijzigingen. Het bestaande JSON-readmodel geeft de genormaliseerde snapshot door.
- Bot, auth/rollen en SEO: geen functionele impact verwacht.
- Deployment: ontvanger, website en een nieuwe connectorrelease nodig; geen nieuwe secrets of env-variabelen.

Voor publieke ingebruikname eerst de aangepaste opponentparser bij de V3-ingest
uitrollen, daarna de website en de connector via de bestaande releaseprocedure.
De lokale DLL is op uitdrukkelijk verzoek als test op deze pc geïnstalleerd; dit
is geen publieke release. Een backup van de vorige 0.7.6.0-DLL staat lokaal onder
`.hermes/3SM.EnduranceConnector-before-ratings-0.7.6.0.dll`.
Na expliciet akkoord op productie: echte sessie controleren, A/B/C/R-badges en
rijderswissel controleren, plus ontbrekende ratings. De gebruiker heeft bevestigd
dat nu geen sessie beschikbaar is; de beschikbaarheid van de drie getters in een
actieve iRacing/SimHub-sessie is dus nog niet tijdens een echte rit geverifieerd.

Rollback: vorige websitebundle, ingestversie en connectorrelease terugplaatsen.
Geen datamigratie nodig. Oude snapshots blijven leesbaar.

## Verificatie

- `npm test -- --run src/test/pitwallDriverRatings.test.tsx src/test/pitwallStandings.test.ts src/test/pitwallLook.test.tsx src/test/pitwallElements.test.tsx src/test/simhubIngestSignedGap.test.ts src/test/simHubConnectorContract.test.ts src/test/simhubAdditiveChannels.test.ts`: **119/119 geslaagd**, zeven bestanden.
- `powershell -ExecutionPolicy Bypass -File tools/simhub-plugin/build-plugin.ps1 -WorkspaceRoot <deze werkmap>/tools/simhub-plugin`: **geslaagd**, nul fouten. Eén bestaande waarschuwing over `_pitLimiterSinceMs` (ongebruikt veld, buiten deze diff).
- `tools/simhub-plugin/3SM.EnduranceConnector.DiagnosticsTests/run-driver-rating-tests.ps1 -SkipBuild`: **42/42 geslaagd** tegen de werkelijk gebouwde plugin, inclusief sibling-pad, oude terugval, voorrang van het echte SDK-pad en geen terugval op oude rijders bij een lege actuele lijst. De eerdere testfixture had dezelfde onjuiste nesting als de lezer; de primaire fixture volgt nu de SDK-structuur.
- `npx tsc -p .hermes/ratings-tsconfig.json --noEmit`: **geslaagd**. Lokale, genegeerde checkconfig die `tsconfig.app.json` uitbreidt en de gewijzigde TS-gegevensstroom, de nieuwe test en `src/test/setup.ts` opneemt.
- `npx vite build --logLevel warn`: **geslaagd**; alleen compilatiecontrole, geen productieartefact met geldige runtimeconfiguratie.
- `npm run typecheck`: **niet groen** door fouten in ongewijzigde bestanden: TeamModal-profieltype, merchandise/PayPal-exporten en testtypes, `finalStintLaps` in de strategie, eventcast in `src/main.tsx` en catalogustiming in een bestaande test. Geen diagnostiek in de ratingbestanden nadat de ontbrekende test-peer lokaal beschikbaar was.
- `npm run build` met inert lokale Supabase-configuratie: Vite-bundle slaagt; de daaropvolgende sitemapgenerator stopt op ontbrekende dynamische routes omdat er bewust geen werkende databaseconfiguratie wordt gebruikt. Geen productie-DB geraadpleegd.
- `git diff --check`: geslaagd.

Om de websitechecks uit te voeren zijn de dependencies lokaal met
`npm ci --legacy-peer-deps --ignore-scripts` geïnstalleerd. De bestaande lockfile
mist bij die installatie de Testing Library-peer; daarom is uitsluitend lokaal
`npm install --no-save --package-lock=false --ignore-scripts --legacy-peer-deps @testing-library/dom@10`
gebruikt. Geen package- of lockfilewijzigingen in deze patch.

## Lokale DLL en werkelijk SimHub-log

- Versie: **0.7.6.1**, 677376 bytes.
- Gebouwd: `C:\Users\vdevo\.codex\worktrees\pitwall-driver-ratings\3-stripe-league-hub-main\tools\simhub-plugin\3SM.EnduranceConnector\bin\Release\3SM.EnduranceConnector.dll`.
- Ook gekopieerd door het buildscript naar `C:\Users\vdevo\Desktop\3-stripe-league-hub-main\builds\3sm-enduranceconnector\3SM.EnduranceConnector.dll`.
- Geïnstalleerd: `C:\Program Files (x86)\SimHub\3SM.EnduranceConnector.dll`; SHA256 gelijk aan de build.
- SHA256: `cb19ed418c4d32e0d7a9fa059d33d76526b8563602aa765a78f1eacbe54e9550`.

Na installatie is SimHub gestart. In het echte bestand
`C:\Program Files (x86)\SimHub\Logs\SimHub.txt`, regel 49 van deze run:

```text
[2026-11-08 23:24:24,234] INFO - 3SM ratings: V3-opponentkoppeling aangesloten; bron=SessionData.DriverInfo.Drivers; versie=0.7.6.1; wacht op sessiesnapshot
```

Dit bewijst dat de gebouwde plugin is geladen en de V3-opponentkoppeling actief is.
Het bewijst geen uitgelezen ratings. Zodra een echte sessiesnapshot wordt verwerkt,
logt de capture afzonderlijk `3SM ratings: V3-snapshot uitgevoerd; opponents=…;
irating=…; safetyRating=…`. Alleen aantallen worden gelogd, geen namen, IDs,
tokens of ratingwaarden; gewijzigde aantallen maximaal eenmaal per 30 seconden.
Een snapshotregel met positieve ratingaantallen is nog niet waargenomen, omdat
er geen iRacing-sessie beschikbaar is.

Geen browsercontrole of echte iRacing-rit uitgevoerd. De eerder getoonde afbeelding
is een ontwerp met fictieve ratings, geen screenshot van deze implementatie.

Uitwisseling gebeurt na committen uitsluitend via
`powershell -ExecutionPolicy Bypass -File C:\Users\vdevo\3sm\3sm-sync.ps1 -Mode push -Werkplek C:\Users\vdevo\.codex\worktrees\pitwall-driver-ratings\3-stripe-league-hub-main`.
De brug verstuurt naar de serverinbox en verwerkt branches periodiek; een
succesvolle verzending is niet hetzelfde als een merge of deploy.
