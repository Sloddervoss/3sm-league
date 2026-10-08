# Endurance-catalogus: waarom die jaarlijks onderhoud nodig heeft

_8 oktober 2026 · geldt voor de edge function `iracing-special-events-sync`_

## Het probleem dat dit oplost

De sync haalt iRacings officiële special-events-pagina op en zet de endurance-events
in de 3SM-catalogus. Hij importeert daarbij **nooit** een event dat hij niet kent:
een event moet ofwel in de seizoenslijst (`ENDURANCE_IRACING_SEASON_MAP_JSON`) staan,
ofwel al in de catalogus bestaan.

Die regel voorkomt gokwerk, maar had één gevolg dat niemand zag aankomen: **de
eventsleutel bevat het jaartal** (`iracing:2027:daytona-24`). Zodra iRacing het
nieuwe seizoen publiceert, is élk event dus "onbekend" en wordt het overgeslagen.
De endurance-kalender loopt dan stil leeg — geen foutmelding, geen signaal, alleen
een tab die steeds leger wordt.

Gemeten op 8 oktober 2026: van de 18 endurance-special-events die iRacing dat jaar
uitzond, stonden er 6 aan, 2 uit (bewust: éénklasse, geen GT3) en waren er **10
nooit opgenomen** — waaronder Daytona 24, Sebring 12HR, Nürburgring 24h, Spa 24HR
en Watkins Glen 6 Hour.

## De oplossing

1. **`allowlist.ts`** — een expliciete, in code vastgelegde lijst met de endurance-
   events die 3SM volgt. Alleen een event waarvan de naam (of slug) daar staat mag
   als nieuw event worden opgenomen. Geen afleiding uit de kalender: de lijst is
   een besluit.
2. **Eerste import zonder tijden** — zolang iRacing de tijdsloten niet heeft
   gepubliceerd, worden alleen de kalendergegevens vastgelegd (naam, datums,
   klassen, poster) als `date_only`, via dezelfde functies die de 8 Hours of
   Indianapolis al gebruikten. Zodra het seizoen verschijnt vult de bestaande
   seizoensopzoeking de exacte tijden aan op dezelfde rij.
3. **Twee signalen in de runuitkomst** (het antwoord staat in het journaal van de
   timer):
   - `season_mapping: geen koppeling voor <jaar>` → **fout**, de run wordt
     `partial`. Dit betekent dat de series niet meer aanvullen.
   - `upcoming_events` plus de waarschuwing `geen aankomend endurance-event in de
     catalogus` → zichtbaar, niet fataal.

## Wat er jaarlijks moet gebeuren

De seizoenslijst is **jaargebonden**: elke entry bevat een iRacing-`seasonId` van
dat jaar. Zodra iRacing de nieuwe seizoenen publiceert:

1. Zoek de nieuwe `seasonId` op voor de acht endurance-series en werk
   `ENDURANCE_IRACING_SEASON_MAP_JSON` bij (de omgeving van de edge functions op
   3sm-docker). Zonder dit stopt de serie-import; het signaal hierboven meldt het.
2. Controleer of de veertien events uit `allowlist.ts` in het nieuwe seizoen op
   de pagina staan. Nieuwe namen toevoegen doe je alleen op besluit van de
   eigenaar, met de spelling van de officiële pagina.
3. Laat de sync één keer lopen en controleer `events_inserted` en
   `upcoming_events` in het antwoord.
4. Zet per nieuw endurance-event de **lokale klassen en auto's** in de catalogus.
   Zonder die koppeling verschijnt het event wel, maar kunnen teams er geen auto
   kiezen bij het activeren van een tijdslot.

## Wat er niet is veranderd

- Events die al in de catalogus staan worden exact hetzelfde behandeld als voorheen.
- Niet-goedgekeurde events worden nog steeds overgeslagen — ook als iRacing ze
  nieuw publiceert.
- De serie-import, de slot-deactivatie (`missing_successful_syncs`) en de
  veiligheidsklep dat partial failures nooit goede slots verwijderen, zijn
  onaangeroerd.

## Uitrollen en terugdraaien

De edge functions draaien op 3sm-docker vanuit een **bind-mount**; de repo is daar
niet de bron. Rollen uit betekent dus: bestanden kopiëren naar de mount van de
functies, de container herstarten, en de draaiende versie vergelijken (sha256) met
wat in de repo staat. `allowlist.ts` is een **nieuw bestand** en moet meegekopieerd
worden — een vergeten bestand laat de functie stukgaan op een ontbrekende import.

Terugdraaien: zet de vorige `index.ts` terug (er is geen `allowlist.ts` nodig in de
oude versie), herstart de container, en controleer met een handmatige run dat de
runstatus weer `success` is en `events_seen` gelijk blijft.
