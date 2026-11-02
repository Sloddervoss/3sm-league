# PACE en sectoren — definitieve lokale oplevering

Datum: 2026-11-01. Werkmap `/home/hermes/wt/pitwall-look`.
Branch `feat/pitwall-look-3sm`, basis `952768459c296d41d4abbee9041bc9fd10ba20f5`.
De brief `/home/hermes/3sm-pace-definitief-brief-2026-11-01.md` is uitgevoerd bovenop
`d284283`, `2f54c3a`, `50b1486`, `883e993` en `9527684`; geen nieuwe tussenrelease
of losse diagnostische plugin. Bestaand live bewijs is niet opnieuw onderzocht.

## Gebouwd

- `RawChannelReader` leest de echte grenzen uit SplitTimeInfo via het bestaande
  sessiepad. Geen vaste drie; technische limiet 1–16, daarbuiten fail-closed.
  TrackID/TrackName/TrackConfigName en sessie bepalen de cache; herlezing maximaal
  1 Hz, nieuwe configuratie wist oude capture. Dictionary- en propertyobjecten
  worden ondersteund. Onbekende indeling blijft onbekend.
- Tot 20 Hz: SDK SessionTime vóór de frequentiepoort, niet de mogelijk tragere
  SimHub-klok. Waar beschikbaar komen positie, lopende ronde, afgeronde ronde en
  laatste/beste rondetijd uit één SDK-image. CarIdx-arrayindex komt uit DriverInfo
  op exact autonummer; geen naamjoin of veronderstelde lijstvolgorde.
- Lineaire interpolatie tussen twee echte bronticks voor iedere sectorgrens en
  de finish. Een eerste deelronde telt niet als volledige sectorronde. Gaten,
  teleport/achteruit, pit, offline, invalid lapflag, sessiewissel en teruglopende
  tijd/tick/lapcounter mogen geen doorgaande meting opleveren.
- Zelfcontrole: ALLE sectorduren positief/eindig, werkelijk aantal klopt, en
  abs(som − gemelde rondetijd) ≤ 0,1 s. Anders de HELE sectorreeks null. Een
  vertraagde rondetijd krijgt maximaal 2 s om dezelfde finish alsnog te bevestigen.
  Beschikbare CarIdxLapCompleted moet bij die ronde horen, ook bij gelijke tijden.
- Tweede bron: LastLapSectorTimes/BestLapSectorTimes.GetSectorSplit(n); oude
  LastLapSector1..3/BestLapSector1..3 alleen bij een werkelijke drievoudige layout.
  Precies dezelfde aantal-/somcontrole. Voorrang: geldig gemeten, geldig SimHub,
  anders null. Beste sectoren horen bij één gecontroleerde beste ronde; geen
  fictieve ronde uit losse sectorminima.
- Nullable/additieve herkomst per auto: sectorCount, sectorLap, sectorSource,
  sectorErrorSeconds en beste-ronde-equivalenten. Afwijking = som minus rondetijd.
  Edge en frontend toetsen opnieuw; een bronclaim alleen is nooit genoeg.
- Compacte diagnostiek: eerste finish, eerste volledig gemeten ronde en daarna
  iedere twintigste ronde, iedere opname één verzendpoging. Na de 2s-verversingsmarge:
  bron, aantal, som, rondetijd, verschil en redencode. Geen apparaatnamen/-ids,
  geen extra request, geen outbox/ACK, maximaal één bewaarde opname per auto.
  Budgetvolgorde: core/meetbatch → pace → diagnostiek. Diagnostiek valt als eerste af.
- Rondetijdenhistorie is losgemaakt van volledige afstandssporen. Een gemist
  afstandspunt blokkeert de betrouwbare leiderlijn niet. Alleen waargenomen
  opeenvolgende rondewissels; 0,25–2 s verversingsvenster, gekoppeld SDK-rondenummer
  waar beschikbaar. Maximaal 20 ronden per auto, geen voorgeschiedenis verzinnen.
- Frontend: één sectorkolom per werkelijk aantal. Onbekend wordt geen S1/S2/S3.
  De laatste rondetijd naast goedgekeurde sectoren komt uit dezelfde metric;
  sectorLap koppelt die aan de juiste rij, ook als SimHub en SDK iets verschillen.
- PACE behoudt maximaal twee echte reeksen: rondetijdenhistorie, bevestigde km/h
  tegen afstand en tijdverschil op dezelfde afstandsbins met een vaste opgenomen
  referentie. Ontbrekende data geeft een concrete reden, geen vervangende curve.
  Een expliciete referentiekeuze, inclusief ‘geen referentie’, blijft gerespecteerd.

## Drie versus zes sectoren: leesbaarheid

Bij drie sectoren normale timingtypografie; bij zes zes afzonderlijke kolommen
S1–S6 met compacter cijferwerk en kleinere horizontale padding. P/K/#, coureur,
klasse, laatste/beste ronde, ronde, gap en pit blijven behouden. Klassekop-colspan
is 10 + aantal sectoren. De eigen KPI-strip past dezelfde echte indeling toe,
met kleinere cijfers vanaf vier sectoren. Onbekende indeling krijgt één expliciete
lege status in plaats van drie verzonnen waarden. Brede indelingen en kleinere
schermen kunnen binnen de timingtabel horizontaal scrollen; niet de hele pagina.

De browserproef heeft beide bestaande schermmodi met drie én zes sectoren getest:
alle sectorkolommen passen naast de bestaande kolommen; geen horizontale
pagina-overloop; vier onderste panelen binnen 1920×1080; geen afgeknipte
paneelteksten, geen browserfouten en geen externe requests. Kaartcomponenten,
kaartgeometrie en het vier-panelenraster zijn door deze pacewijziging niet gewijzigd.

## Tweede lijn bij binnenkomst en uitval

Een laat binnengekomen tegenstander heeft geen gefabriceerde oudere ronden.
Vanaf twee echte opgeslagen rondetijden verschijnt een lijn. Gaten worden niet
opgevuld; afstandslijnen verbinden geen ontbrekende bins. Eén punt is geen curve.

Als een bewust gekozen tegenstander wegvalt, wordt niet automatisch de nieuwe
leider gekozen. Eerder opgenomen historie mag zichtbaar blijven zolang die nog
binnen de bestaande sessie-/TTL-grenzen beschikbaar is; verdwenen snapshot en
ontbrekende reeks krijgen een melding. Een opnieuw verschijnende auto kan met
nieuwe opgenomen ronden verdergaan, zonder fictieve naad. Een gewijzigde
sessie/segment/transportidentiteit verbreekt de referentie. De delta-referentie
blijft vast voor de eigen lopende trace; niet halverwege stilzwijgend vervangen.

## Uitgevoerde gates

PASS — volledige `npx vitest run`: 196 bestanden, 1670 tests.
PASS — `npm run build`, inclusief route-/sitemapgenerator, releaseboundary-check
       en extensie-ZIP. Build is lokaal, geen deployment.
PASS — volledig C#-harnas: 519 PASS, 0 FAIL.
PASS — volledige net48-plugin plus ingebedde updater bouwen met lokale
       referentieassemblies; 0 fouten. Bestaande CS0169-waarschuwing voor
       _pitLimiterSinceMs blijft ongewijzigd.
PASS — gerichte ESLint op de aangepaste applicatie-/contract-/testbestanden.
PASS — `git diff --check`.
PASS — browsermatrix: endurance/test × 3/6 sectoren × rondetijd/snelheid/delta.
       Per geldige fixture twee lijnen, vier panelen, 1920×1080.
PASS — bestaande acht persistargumenten blijven exact (Vitest-contracttest);
       geen SQL-bestand of persistimplementatie in deze opdracht gewijzigd.

C# bewijst onder andere interpolatie op niet-tickuitgelijnde grenzen/finish bij
10 en 20 Hz, drie en zes sectoren, wisselende snelheid, te grote somafwijking,
ontbrekende data, gaps, herstart met doorlopende klok, teruglopende klok,
vertraagde LastLapTime, stale CarIdxLapCompleted, juiste SDK-arrayindex en grenzen,
SimHub-fallback, count mismatch, éénmalig gesamplede diagnostiek en budgetafval.
De wisselende-snelheidproef vergelijkt met een onafhankelijk geïnverteerde
synthetische afstandswet: maximale sectorfout <1 ms. Dit is geen live precisieclaim.

De nieuwe zes-sectorenfixture is werkelijk door het C#-harnas gemeten en met de
productieserializer geschreven, daarna door de echte TypeScript-parser getest.
Het is een synthetische proef, geen opgenomen iRacing-rit.

Extra check NIET GROEN: `npm run typecheck` meldt 13 bestaande fouten. Een
ongewijzigde git-archive van exact de basis-HEAD is apart met dezelfde compiler
gecontroleerd: exact dezelfde 13 foutregels, geen nieuwe fout. Betreft TeamModal,
Community Support, bestaand PitWindow-type en main.tsx; niet buiten deze scope
of tegen het verbod op advieswijzigingen in gerepareerd. Dit wordt niet als PASS
of als nieuwe pacefout voorgesteld.

## Bewijsbestanden en reproduceerbaarheid

- Contract: `docs/contracts/pace-capture-v1.md`.
- Browseruitkomsten en schermafbeeldingen:
  `docs/pitwall-look/pace-definitief-browser/verification.json` en de PNG's ernaast.
- Synthetische cross-language-fixture:
  `supabase/tests/fixtures/pace-six-sectors-frame.json`.
- SHA-256 van eigen gewijzigde bronnen/bewijsbestanden en lokale DLL:
  `docs/pitwall-look/pace-definitief-sha256.txt`.
- Korte machinecontrole: `docs/pitwall-look/pace-definitief-verificatie.json`.

C#:
`/home/hermes/.dotnet/dotnet run --project tools/simhub-plugin/3SM.EnduranceConnector.DiagnosticsTests`

Lokale pluginbuild:
`/home/hermes/.dotnet/dotnet build tools/simhub-plugin/3SM.EnduranceConnector/3SM.EnduranceConnector.csproj -p:SIMHUB_INSTALL_PATH=/home/hermes/.hermes/cache/scratch/pace-simhub-references/ -p:FrameworkPathOverride=/home/hermes/.nuget/packages/microsoft.netframework.referenceassemblies.net48/1.0.3/build/.NETFramework/v4.8/`
De referentiemap is een lokale scratchmap met links naar de reeds beschikbare
SimHub-referentie-DLL's en Newtonsoft.Json, geen wijziging op een race-pc.

Browser: lokale Vite-preview op 127.0.0.1:5198 met `vite.pitwall-look.config.ts`,
dan `bash scripts/ensure-playwright-runtime.sh node docs/pitwall-look/preview/pace-shot.mjs`.

## Niet live bewezen / bewuste grenzen

- Geen echte eerste rit, race-pc, Windows-runtime of live iRacing-brontiming getest.
  De plugin bevat de controle daarvoor; runtimevulling blijft pas bij een later
  goedgekeurde rit aantoonbaar. De somcontrole bewijst rondecoherentie, niet dat
  iedere individuele sector live tot op een milliseconde nauwkeurig is.
- Geen productie-DB, RPC, scheduler, RLS, ingest of opslagbelastingsproef uitgevoerd.
  De bestaande lokale pace-opslagmigratie/rollback uit de eerdere commits blijft
  onaangeroerd en is NIET toegepast, ook niet als nieuw lokaal rehearsal.
- Geen garantie dat alle afstandssporen van 40 auto's compleet aankomen bij het
  bestaande bytebudget/pakketverlies; dan blijven snelheids-/deltareeksen leeg.
  Werkelijke CPU-/latencykosten op de SimHub-pc zijn niet live gemeten. Pure,
  begrensde buffers, geen I/O in de sampler, budgetafval en het bestaande
  transport-/timeout-harnas zijn wel lokaal getest.
- Geen distributierelease, signing, updatermanifest of versiepublicatie gemaakt.
  De DLL is een lokale build; feature blijft achter de bestaande negotiationpoort.
- Na de schone start zijn er parallel wijzigingen verschenen in kaartgeometrie,
  previewserver en losse geometry-previewbestanden. Niet door deze opdracht
  geschreven, verwijderd, teruggezet of meegenomen in de pace-SHA-lijst. De
  browserproef geldt voor de feitelijke werkboom; geen claim dat andermans
  kaartwijziging deel is van deze paceoplevering.

## Eerstvolgende logische stap

Eerst na aparte GO: eerste rit met deze geïntegreerde controle; bron/aantal/fout
uit normale metrics en gesamplede diagnostiek beoordelen, zonder eerst een aparte
leesplugin te distribueren. Met de reeds begrensde tijd-afstandspunten kan daarna
sectordelta tegen een vastgezette ronde of een echte actuele delta over de baan
worden uitgebreid, uitsluitend bij voldoende dekking. Bochtnummers vereisen
betrouwbare bochtmetadata; die niet afleiden uit een toevallige snelheidsdip.
Geen nieuwe advieslogica nodig om die presentatie te onderzoeken.

## Impact en lokale status

Website/frontend: sectorindeling en pacepresentatie gewijzigd; geen route/SEO-ontwerpwijziging.
Backend/API: uitsluitend additieve nullable PACE-parservelden; acht persistargumenten ongewijzigd.
Plugin: grensmeting, bronkeuze, zelfcontrole, diagnostiek en SDK-arraylezing gewijzigd.
Bot, auth/rollen: geen impact verwacht.
Data/database/schema/migraties: niet gewijzigd of toegepast in deze opdracht.
Advies, banden, brandstof, pitstoplogica: niet gewijzigd.
Deployment: niets uitgerold. Productie frontend changes: NONE.
Geen commit, push, merge of PR aangemaakt. Werk staat lokaal op de gevraagde branch.
Eventuele productie-/uitrolstappen vereisen een afzonderlijk GO.

PRODUCTIEWIJZIGING: NEE
