# Opponent-sectorretentie — sparse PACE-veld

> Vervolg 2026-11-21: dezelfde klacht bleef optreden. De volledige keten
> (identiteitsreset, gedeeltelijke live-rij en SQL-`IS DISTINCT FROM`) staat in
> `docs/operations/2026-11-21-sector-continuity-and-personal-pit-duration.md`.
> Dit document blijft de eerste, presentatielaag-only fix.

## Symptoom (veldmelding)

Live Pitwall, connector 0.7.6.4, 16 tegenstanders, één doorlopende stream:

- seq 718 → 720 → 722 had achtereenvolgens 4 → 5 → 4 volledige
  sectorreeksen in het PACE-blok.
- In het 14-auto-frame (seq 720) toonde Leroy #103 `R4 35.503 / 52.350 /
  33.853` terwijl zijn rij al R5 liep; Bart #128 toonde R1 bij rij R2 en Albert
  #151 R2 bij rij R3.
- In het volgende, 13-auto-frame (seq 722) verdwenen die reeksen weer, ook voor
  auto's die gewoon in het veld bleven. Auto `f0820` verscheen met R3 op 720 en
  was op 722 weer weg.
- Het eerste frame had 4 PACE-auto's, 1 volledige set en 0 per-sector arrays.

Dit is géén ongeldigverklaring en geen sessiewissel: het PACE-blok is sparse.
De connector stuurt per frame maximaal vier metingen in rotatie
(`PaceCapture.NextFrame`), dus een auto wordt met 16 tegenstanders maar eens
per paar seconden bijgewerkt. Een volledige reeks staat bovendien alleen in het
metingslot direct na het afronden van die ronde; daarna vervangt de volgende
meting van dezelfde auto hem door een mid-lap-meting zonder reeks.

## Oorzaak (presentatielaag, niet plugin/DB)

De bewezen ronde werd als *live* veld behandeld:

1. `freshMetrics` legde een 5-seconden hartslag op de opgeslagen meting. Een
   reeks die 6 seconden oud was, werd niet meer getoond of bewaard, ook al was
   de ronde gewoon afgerond en ongewijzigd.
2. `rowSectors` eiste `rijLap === sectorLap + 1`. Zodra de ronde teller van de
   rij één stap vooruit was (normaal gedrag tussen twee metingrotaties), viel
   een geldige reeks weg.
3. `trackSectorCount` gebruikte dezelfde 5s-poort, waardoor de sectorkolommen
   bij een volledig sparse frame konden verdwijnen ("sectorindeling onbekend").
4. `useRetainedLapSectors` bewaarde alleen wat op dat moment via de
   legacy-metriek binnenkwam. Auto's met een live per-sectorrij werden
   overgeslagen (`live.has(id) → continue`), dus zodra die rij ontbrak was er
   geen fallback.
5. Bewaarde reeksen verliepen na 120 s sessietijd, ook midden in een stint
   zonder nieuwe meting.
6. Ongeldigheid was te breed: één `invalidated` sector met `lap >=
   rijLap - 1` wiste de hele bewaarde reeks van die auto, ook als die over een
   ándere (oudere, bewezen) ronde ging. Een reset/tow van de lopende ronde
   maakte zo de vorige bewezen ronde onzichtbaar.

Deze zes samen produceren precies het gemelde beeld: per auto verschijnt een
reeks alleen binnen een smal venster en verdwijnt daarna, onafhankelijk van de
andere auto's.

## Wijziging

Alleen frontend (`src/features/endurance/pitwall/`), geen route, geen
DB-migratie, geen pluginwijziging.

- `paceSeries.ts`
  - `persistedMetrics`: namespace-gevalideerde meting **zonder** 5s-poort.
  - `completedLap`: afgeronde ronde met `lapValid`, somcontrole, "sneller dan
    beste"-grens en een toekomstgrens t.o.v. de sessieklok; de rij mag verder
    zijn dan de reeks, niet achterlopen.
  - `trackSectorCount` telt de opgeslagen sectorindeling van de auto's in de
    leesweergave, zonder hartslag.
  - `rowSectors` blijft de 5s-variant voor live velden (laatste rondetijd,
    delta's).
- `useRetainedLapSectors.ts`
  - Bewaart per auto de laatst bewezen volledige ronde met ronde-identiteit.
  - Seedt ook uit een complete, geverifieerde live sectorstand, zodat het
    verdwijnen van die stand de rij niet leegmaakt.
  - Wist alleen bij: expliciete ongeldigheid van **die** ronde, `lapValid=false`
    voor die ronde, een kortere reset-ronde van diezelfde ronde, een lagere
    ronde teller, of een bevestigde sessie-/transport-/track-/layoutwissel.
  - Geen tijdsverval meer; een ontbrekend of sparse frame is geen ongeldigheid.
  - Ontbrekende track- of segmentmetadata in één frame is "onbekend" en wist
    niets.
- `StandingsWidget`, `PremiumTimingPanel`, `RaceTelemetryStrip`
  - Live sectorstand heeft voorrang; anders de bewezen reeks, met R-label.
  - Dimmen betekent "oudere ronde" of "feed ligt stil", niet "meting is 5 s
    oud"; de tooltip blijft "Laatst geverifieerd · ronde N".
  - Delta's blijven aan een verse meting hangen (geen delta over een andere
    ronde).

## Bewijs

Unit/component (Vitest, echte componenten):

- `src/features/endurance/pitwall/opponentSectorIntermittency.test.tsx` — 9
  tests: 4→5→4-reeks, late meting (>5 s), rij vóór op de reeks, 14→13 auto's +
  herschikking + leeg frame, invalidation-scope, echte wissels (sessie, context,
  track), live-rij die verdwijnt, ronde-rollover per auto, gedeelde projectie
  (`sharedViewerV3`).
- Bestaande suites aangepast aan het nieuwe contract waar zij "oude reeks
  verdwijnt" vastlegden: `pitwallUxDefects` (geen 120s-verval),
  `paceCapture` (onbewezen vervolgmeting wist de bewezen reeks niet),
  `sectorLayout` (contextgrens zonder eigen PACE).

Browser (echte componenten en styles, `docs/pitwall-look/preview/sector-retention.html`):

```
npx vite --config vite.pitwall-look.config.ts
bash scripts/ensure-playwright-runtime.sh node docs/pitwall-look/preview/sector-retention-shot.mjs
```

Voor/na op dezelfde vier frames: op HEAD (cfdedda0) tonen seq 720 en 722
alleen de eigen auto; na de fix blijven #103 R4, #128 R1, #151 R2 en #77 R3
staan, ook in het 13-auto-frame met herschikt veld en drie sectorkolommen.

## Restrisico's

- Een auto die lang in de pits staat houdt zijn laatste bewezen ronde zichtbaar
  (gedimd, met R-label). Dat is bewust: de rij is nog in het veld en de reeks
  is niet ongeldig. Er is geen tijdsgebaseerd verval meer.
- De 5s-poort blijft bewust staan voor live velden (laatste rondetijd, delta's);
  een delta na een lange metingpauze blijft leeg in plaats van te gokken.
- Server/projectie en plugin zijn niet gewijzigd; dit is uitsluitend een
  presentatiefix op de bestaande contracten.
