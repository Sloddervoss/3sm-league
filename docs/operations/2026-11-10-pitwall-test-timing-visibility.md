# Pitwall-test: timingruimte, vaste eigen rij en zichtbare sectorplek

Datum: 10 november 2026
Basisrelease: `0a76dc4b`
Branch: `fix/pitwall-test-timing-visibility`
Codepoort: `4e3f0c74` (Astra GO, uitsluitend deze drie presentatie-fixes).

## Aanleiding en grens

Vincent zag zeven van 29 timingrijen, de eigen auto op P16 pas na scrollen en geen sectorplek. Alleen de premium pitwall-test aanpassen; geen versleepbare werkplek bouwen. Klassiek, endurance, circuitprojectie/popups, brondata, sorting, polling, backend, database en plugin blijven ongewijzigd.

## Uitwerking

- Timinghoogte van vaste 430px naar `clamp(700px, calc(100dvh - 280px), 1200px)`; op smallere schermen 600px. De onderste analysepanelen staan hierdoor lager op de pagina.
- Onder de kolomkop staat een afzonderlijke vaste eigen samenvattingsrij (`JIJ · VAST`) met de echte positie, startnummer, naam, tijden, sectoren, ronde en pitstatus uit dezelfde gevalideerde renderer. Geen gefingeerde P1 en geen selectie op apparaatnaam/accountnaam.
- De reguliere ranglijst blijft intact. De samenvatting heeft geen `data-timing-row-id`, geen positie-/rondeflits en geen dubbele FLIP-identiteit. Ook bij klassefiltering blijft dit duidelijk de eigen samenvatting, niet een extra deelnemer in die klasse.
- Sticky header 28px; eigen cellen sluiten daaronder aan met ondoorzichtige achtergrond. De knop Eigen rij trekt zowel de gemeten kophoogte als de eigen-samenvattingshoogte van zijn scrolltarget af.
- De bestaande sector-KPI wordt bij onbekende indeling niet meer via test-CSS verborgen. De tabel heeft dan een herkenbare kolom `Sectoren` met `—`. Bij bekende indeling blijven de werkelijke dynamische S1..Sn-kolommen gelden; geen aangenomen drie sectoren en geen verzonnen tijden.
- De oorspronkelijke waardegates blijven intact: geen verse sectorwaarden bij offline/stale, geen omzeiling van `lastLapInvalid`, dezelfde `rowSectors`/`trackSectorCount`-validatie.

## Geobserveerde verificatie

- Echte geauthenticeerde lokale pagina: 15 browserchecks PASS, met echt PCBART-verkeer. Tijdens de proef was dit een andere sessie dan de aangeleverde screenshot: Zandvoort/Bart Tonkes, op dat meetmoment P19, 22 auto's. Dit is geen correctie van de screenshot en geen afleiding uit de apparaatnaam.
- Afzonderlijke gecontroleerde browserfixture met 29 auto's en eigen P16, exact dezelfde invoer op oude en nieuwe lokale build:
  - 1920×1080: volledig zichtbare gewone rijen binnen de timing-scrollregio 7→16; zonder pagina-scroll daadwerkelijk op het scherm 7→12.
  - 2560×1440: binnen de timing-scrollregio 7→27; daadwerkelijk op het scherm 7→22.
  - De vaste eigen P16 is daarnaast direct bij de tabelkop zichtbaar en blijft staan na 300px interne scroll; geen overlap met sticky kop.
  - Eigen rij brengt de normale P16-rij niet achter de vaste samenvatting.
  - Sector-KPI was verborgen, is nu zichtbaar. Op 390px geen documentoverflow.
  - Dit is lokale browserinterceptie, niet fictieve productie-telemetrie.
- Gerichte regressies: 87/87 PASS. Nieuwe tests bewijzen vaste P16, ongewijzigde 29 unieke lijst-id's, ontbreken van een eigen rij bij ontbreken van een bronmarkering, sector-placeholder en zes door de bestaande helper opgegeven kolommen. De zes-kolommencomponenttest gebruikt een helpermock; de bestaande sectorvalidatietests dekken de werkelijke bronregels.
- Tegenproef: nieuwe eigen-P16-/onbekende-sector-tests falen op `0a76dc4b` (2 failures) en slagen na de fix.
- Volledige suite: 1805 geslaagd / 1 bestaande failure (`tyreTelemetryContract`), 210 bestanden. Typecheck: exact dezelfde 16 bestaande diagnostics, geen nieuwe. ESLint en productiebuild slagen.
- Astra heeft de exacte diff gelezen en GO gegeven. Sticky/mobiel/browsermetrics zijn door de parent gemeten, niet als door Astra herhaalde tests voorgesteld.

## Rollback en acceptatie

- Onmiddellijk: Klassiek, of `/admin/pitwall-test?pitwallView=classic`.
- Vorige premiumrelease blijft beschikbaar in `/opt/3sm-release-0a76dc4b`; terugpubliceren via het bestaande release-script zet ook de SEO-timer terug. Geen DB/pluginrollback nodig.
- Bronrollback op aparte branch: revert de release-merge met `git revert -m 1 <merge-sha>`; geen force-push of harde reset van gedeelde main.
- Visuele goedkeuring voor endurance blijft afzonderlijk vereist. Dit verandert daar geen look of gedrag.
