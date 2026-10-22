# 3SM Endurance Overlay — dashboardbouw

De plugin levert de stintplanning als SimHub-properties. Het dashboard zelf wordt
in SimHub → Dash Studio gebouwd; SimHub bezit het transparante, klik-doorlaatbare
venster.

## 0. Kant-en-klaar template

In `tools/simhub-plugin/overlay/` staat een voorbeelddashboard met de 3SM-look:

- `3SM Endurance Overlay.djson`
- `3SM Endurance Overlay.djson.metadata`
- `3SM Endurance Overlay.djson.ressources` (de achtergrondafbeelding)
- `3SMOverlayBackground.png` (bron van de achtergrond)
- `3SM Endurance Overlay.preview.png` (visuele preview met voorbeeldnamen)

De plugin installeert dit template automatisch bij de eerste start als de map
`DashTemplates\3SM Endurance Overlay` nog niet bestaat. Bestaande templates
worden niet overschreven, zodat eigen aanpassingen blijven staan. Verwijder de
map en herstart SimHub om opnieuw te laten installeren.

Handmatig importeren kan ook via **Dash Studio → Import dashboard** (of door de
bestanden naar een map onder `DashTemplates` te kopiëren). Het template is
800×286, heeft een transparante achtergrond en is al als
overlay/klik-doorlaatbaar gemarkeerd. Pas daarna eventueel kleuren, fonts en
posities aan.

## 1. Dashboard aanmaken

1. Open SimHub → **Dash Studio** → **New dashboard**.
2. Kies een leeg canvas met transparante achtergrond.
3. Houd het dashboard onder **800×600** (harde SimHub-limiet). Het template
   gebruikt **800×286**.
4. Zet in de dashboardinstellingen:
   - **Is overlay** aan
   - **Enable click-through overlay** aan
   - **Show in taskbar** uit
5. iRacing moet op **borderless windowed** staan. In exclusive fullscreen werkt
   geen enkele overlay.

## 2. Properties

Alles hieronder staat in SimHub onder de prefix `THREESM.Overlay.`.

| Property | Type | Betekenis |
|---|---|---|
| `Current.DriverName` | string | Coureur die nu in de auto zit |
| `Current.DriverNameUpper` | string | Zelfde naam in hoofdletters (voor de grote weergave) |
| `Current.StintIndex` | int | Stintnummer (1-based) |
| `Current.IsOverdue` | bool | De stint had volgens plan al klaar moeten zijn |
| `Current.TyreChange` | bool | Deze stint eindigt met bandenwissel |
| `Current.ExpectedLaps` | int | Verwachte rondes |
| `Current.StartAt` / `EndAt` | string | ISO-tijd van de stint |
| `Current.AverageLap` | string | Gemiddelde rondetijd van deze coureur (`m:ss.fff`) |
| `Current.BestLap` | string | Beste rondetijd van deze coureur |
| `Current.AverageSeconds` / `BestSeconds` | double | Zelfde waarden als getal |
| `Current.AverageDelta` | string | Gemiddelde min beste, bijvoorbeeld `+0.381` |
| `Next.DriverName` | string | Volgende coureur |
| `Next.DriverNameUpper` | string | Zelfde naam in hoofdletters |
| `Next.StintIndex` | int | Volgend stintnummer |
| `Next.MinutesUntilStart` | int | Minuten tot de wissel; `-1` als onbekend |
| `Next.TyreChange` | bool | De volgende stint begint met nieuwe banden |
| `Next.ExpectedLaps` | int | Verwachte rondes van de volgende stint |
| `Next.StartAt` / `EndAt` | string | ISO-tijd van de volgende stint |
| `Race.PlannedMinutes` | int | Geplande raceduur in minuten |
| `Race.PlannedStartAt` / `PlannedEndAt` | string | Geplande start/einde |
| `Plan.AgeSeconds` | int | Leeftijd van de planning; `-1` als er nog niets is |
| `Plan.Revision` | string | Serverrevisie; verandert bij een planwijziging |
| `Plan.HasData` | bool | Er is een snapshot (ook uit cache) |
| `Plan.Error` | string | Laatste foutcode, leeg bij succes |
| `Team.Name` | string | Teamnaam |
| `Team.CarNumber` | string | Startnummer |
| `Event.Name` | string | Eventnaam |
| `Order.Summary` | string | Rijdersvolgorde, bijvoorbeeld `Vincent > Jaimy > Marnix` |
| `Order.Count` | int | Aantal stints in de volgorde |
| `Order.Driver1` … `Order.Driver8` | string | Naam per positie in de volgorde |
| `Pace.Summary` | string | Gemiddelde rondetijd per coureur |
| `Warnings` | string | Kommagescheiden waarschuwingen; leeg = alles goed |

`Plan.Error` kan onder meer `not_bound`, `invalid_device`, `network_error`,
`rate_limited`, `db_unavailable` of `http_<status>` zijn. De property `Warnings`
toont daarvan een korte Nederlandse tekst (bijvoorbeeld `geen actief event`).
Bij een netwerkfout blijft de laatste goede planning staan en loopt
`Plan.AgeSeconds` op.

De plugin pollt elke **5 seconden** terwijl je in de auto zit (zodat een
rijderswissel snel zichtbaar is), elke **15 seconden** tijdens een iRacing-sessie
en elke **60 seconden** daarbuiten.

## 3. Velden binden

Voeg in Dash Studio een **Text**-item toe en gebruik in de binding-editor
`$prop('…')` (of `[THREESM.Overlay.…]` in een formule).

| Veld | Binding |
|---|---|
| Huidige rijder | `$prop('THREESM.Overlay.Current.DriverName')` |
| Stint | `$prop('THREESM.Overlay.Current.StintIndex')` |
| Volgende rijder | `$prop('THREESM.Overlay.Next.DriverName')` |
| Minuten tot wissel | `$prop('THREESM.Overlay.Next.MinutesUntilStart')` |
| Racetijd | `$prop('DataCorePlugin.GameData.NewData.SessionTime')` |
| Laatste ronde | `$prop('DataCorePlugin.GameData.NewData.LastLapTime')` |
| Beste ronde | `$prop('DataCorePlugin.GameData.NewData.BestLapTime')` |
| Gemiddelde ronde (planning) | `$prop('THREESM.Overlay.Current.AverageLap')` |
| Beste ronde (planning) | `$prop('THREESM.Overlay.Current.BestLap')` |
| Rijdersvolgorde | `$prop('THREESM.Overlay.Order.Summary')` |
| Plan-leeftijd | `$prop('THREESM.Overlay.Plan.AgeSeconds')` |
| Waarschuwingen | `$prop('THREESM.Overlay.Warnings')` |

Voor `SessionTime`, `LastLapTime` en `BestLapTime` zet je in Dash Studio een
tijdnotatie zoals `hh\:mm\:ss` of `m\:ss\.fff`. Laat een ontbrekende waarde nooit
als `NaN` of leeg vlak zien: gebruik een `NoDataText` of een formule met `—`.

## 4. Afwijkingsmarkering

Maak een apart Text-item voor de waarschuwingen:

- **Text**: `$prop('THREESM.Overlay.Warnings')`
- **Visible**: `!isnull($prop('THREESM.Overlay.Warnings')) && $prop('THREESM.Overlay.Warnings') != ''`
- **Kleur**: amber/rood

Zo verschijnt de regel alleen als er iets aan de hand is. Gebruik daarnaast
`$prop('THREESM.Overlay.Current.IsOverdue')` om de huidige rijder of stint
amber te kleuren als de planning achterloopt.

## 5. Automatisch starten

De plugin kan zelf geen overlayvenster openen: SimHub Dash Studio is de renderer.
Dat is bewust zo gekozen; een eigen WPF-venster vanuit de plugin is ongedocumenteerd
en kan SimHub laten crashen of breken na een update.

Je hoeft de layout dus niet elke keer handmatig te openen. Zet hem eenmalig op
automatisch starten:

1. Open SimHub → **Dash Studio** → **Dashboards**.
2. Zoek **3SM Endurance Overlay**.
3. Zet **Auto start** aan (het vinkje/sterretje bij de dashboard).
4. Optioneel: maak een **overlay layout** met deze dashboard en zet die layout
   op automatisch starten.

Daarna start SimHub de overlay automatisch wanneer iRacing verbinding maakt.
De eigenschappen `IsOverlay`, `EnableClickThroughOverlay` en de transparante
achtergrond zitten al in het template.

## 6. Testen

1. Start SimHub met de nieuwe plugin-DLL en activeer **3SM Endurance Connector**.
2. Controleer in SimHub → **Available properties** dat de
   `THREESM.Overlay.*`-properties bestaan.
3. Zorg dat het device gekoppeld is en dat je lid bent van precies één team in
   een lopend event (de lidmaatschap-fallback; een handmatige device-binding is
   niet nodig).
4. Start een iRacing-sessie op **borderless windowed**.
5. Controleer:
   - de huidige en volgende rijder kloppen;
   - de wissel binnen ongeveer 15 seconden de nieuwe rijder toont;
   - `Plan.AgeSeconds` oploopt als je het netwerk loskoppelt en de waarden
     blijven staan;
   - `Warnings` leeg is bij een gezonde planning;
   - alle velden een waarde of `—` tonen, nooit `NaN`.
