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

De plugin installeert dit template automatisch in
`DashTemplates\3SM Endurance Overlay`. Naast het dashboard schrijft hij een
versiemarker (`3SM Endurance Overlay.djson.3smversion`) met de pluginversie.

- **Marker gelijk aan de pluginversie** → het dashboard blijft staan, ook als je
  het zelf hebt aangepast.
- **Marker ontbreekt of wijkt af** → het dashboard wordt vervangen en je oude
  bestand wordt als `3SM Endurance Overlay.djson.3smbak` bewaard (één generatie;
  een volgende upgrade overschrijft die back-up).
- **Metadata of ressources ontbreken** → die worden bijgeschreven zonder het
  dashboard aan te raken.

Een eigen aanpassing overleeft dus elke herstart, maar niet een pluginupdate.
Wil je zeker weten dat je versie blijft: bewaar je `.djson` buiten de pluginmap
en zet hem na een update terug.

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

De plugin meldt zijn eigenschappen aan onder de prefix `THREESM.Overlay`, maar
SimHub zet daar de **pluginnaam** voor. De volledige naam — de naam die je in
formules, bindingen en de property-verkenner ziet — is dus:

```
EnduranceConnectorPlugin.THREESM.Overlay.<naam>
```

Zonder `EnduranceConnectorPlugin.` erbij wijst een binding naar een
eigenschap die niet bestaat. SimHub meldt dat nergens: het veld blijft leeg.
De namen in de tabel hieronder zijn relatief; zet er in SimHub altijd
`EnduranceConnectorPlugin.THREESM.Overlay.` voor.

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

Het meegeleverde template gebruikt hiervan dertien: `Current.DriverNameUpper`,
`Current.StintIndex`, `Next.DriverNameUpper`, `Current.AverageLap`, `Current.BestLap`,
`Current.AverageDelta`, `Order.Driver1` … `Order.Driver4`, `Warnings`, `Self.IsDriving`
en `Next.IsSelf`. De overige eigenschappen zijn er voor eigen dashboards; ze worden wél
gepubliceerd, maar door het template niet gelezen.

`Plan.Error` kan onder meer `not_bound`, `invalid_device`, `network_error`,
`rate_limited`, `db_unavailable` of `http_<status>` zijn. De property `Warnings`
toont daarvan een korte Nederlandse tekst (bijvoorbeeld `geen actief event`).
Bij een netwerkfout blijft de laatste goede planning staan en loopt
`Plan.AgeSeconds` op.

De plugin pollt elke **5 seconden** terwijl je in de auto zit (zodat een
rijderswissel snel zichtbaar is), elke **15 seconden** tijdens een iRacing-sessie
en elke **60 seconden** daarbuiten.

## 3. Velden binden

Voeg in Dash Studio een **Text**-item toe en gebruik in de binding-editor een
van deze twee vormen — let op de pluginnaam en op de aanhalingstekens:

| Vorm | Voorbeeld |
|---|---|
| Property-binding (`$prop`) | `$prop('EnduranceConnectorPlugin.THREESM.Overlay.Current.DriverName')` |
| Formule (tussen rechte haken, **geen** quotes) | `[EnduranceConnectorPlugin.THREESM.Overlay.Current.DriverName]` |

Beide vormen verwijzen naar dezelfde eigenschap. `$prop('THREESM.Overlay.…')`
werkt **niet**: SimHub kent alleen de volledige naam met pluginnaam.

| Veld | Binding |
|---|---|
| Huidige rijder | `$prop('EnduranceConnectorPlugin.THREESM.Overlay.Current.DriverName')` |
| Stint | `$prop('EnduranceConnectorPlugin.THREESM.Overlay.Current.StintIndex')` |
| Volgende rijder | `$prop('EnduranceConnectorPlugin.THREESM.Overlay.Next.DriverName')` |
| Minuten tot wissel | `$prop('EnduranceConnectorPlugin.THREESM.Overlay.Next.MinutesUntilStart')` |
| Racetijd | `$prop('DataCorePlugin.GameData.NewData.SessionTime')` |
| Laatste ronde | `$prop('DataCorePlugin.GameData.NewData.LastLapTime')` |
| Beste ronde | `$prop('DataCorePlugin.GameData.NewData.BestLapTime')` |
| Gemiddelde ronde (planning) | `$prop('EnduranceConnectorPlugin.THREESM.Overlay.Current.AverageLap')` |
| Beste ronde (planning) | `$prop('EnduranceConnectorPlugin.THREESM.Overlay.Current.BestLap')` |
| Rijdersvolgorde | `$prop('EnduranceConnectorPlugin.THREESM.Overlay.Order.Summary')` |
| Plan-leeftijd | `$prop('EnduranceConnectorPlugin.THREESM.Overlay.Plan.AgeSeconds')` |
| Waarschuwingen | `$prop('EnduranceConnectorPlugin.THREESM.Overlay.Warnings')` |

Voor `SessionTime`, `LastLapTime` en `BestLapTime` zet je in Dash Studio een
tijdnotatie zoals `hh\:mm\:ss` of `m\:ss\.fff`. Laat een ontbrekende waarde nooit
als `NaN` of leeg vlak zien: gebruik een `NoDataText` of een formule met `—`.

Twee waarden hebben een sentinel in plaats van een lege waarde: `Next.MinutesUntilStart`
en `Current.MinutesRemaining` zijn `-1` als de wachttijd onbekend is, en
`Plan.AgeSeconds` is `-1` als er nog geen planning is. Vang dat af in de binding,
bijvoorbeeld `if([EnduranceConnectorPlugin.THREESM.Overlay.Next.MinutesUntilStart] < 0, '—', [EnduranceConnectorPlugin.THREESM.Overlay.Next.MinutesUntilStart])`.

## 4. Afwijkingsmarkering

Maak een apart Text-item voor de waarschuwingen:

- **Text**: `$prop('EnduranceConnectorPlugin.THREESM.Overlay.Warnings')`
- **Visible**: `[EnduranceConnectorPlugin.THREESM.Overlay.Warnings] != ''`
- **Kleur**: amber/rood

`Warnings` bestaat altijd (de plugin meldt hem aan met een lege string), dus een
vergelijking met `''` is genoeg; `isnull()` is niet nodig en werkt alleen als de
gebruikte formule-omgeving die functie kent.

Zo verschijnt de regel alleen als er iets aan de hand is. Gebruik daarnaast
`$prop('EnduranceConnectorPlugin.THREESM.Overlay.Current.IsOverdue')` om de huidige rijder of stint
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
2. Controleer in SimHub onder **Available properties** dat de
   `EnduranceConnectorPlugin.THREESM.Overlay.*`-properties bestaan. Zoek in de
   verkenner op `THREESM` — de pluginnaam staat ervoor, dus zoeken op
   `THREESM.Overlay` aan het begin van de naam vindt niets.
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

## 7. Als een veld leeg blijft

SimHub meldt een binding naar een niet-bestaande eigenschap niet. Je ziet alleen
een leeg veld. Loop dit na, in deze volgorde:

1. **Staat de pluginnaam ervoor?** `$prop('THREESM.Overlay.…')` bestaat niet.
   Gebruik `EnduranceConnectorPlugin.THREESM.Overlay.…`.
2. **Spelling van het achtervoegsel.** `Current.DriverNameUpper` is een andere
   eigenschap dan `Current.DriverName`; `Driver1` gaat tot en met `Driver8`.
3. **Is het dashboard het bestand dat de plugin installeerde?** Controleer of
   `DashTemplates\3SM Endurance Overlay\3SM Endurance Overlay.djson.3smversion`
   dezelfde versie bevat als de DLL. Wijkt hij af, herstart SimHub: dan wordt het
   dashboard bijgewerkt.
4. **Zijn de properties überhaupt aangemeld?** In het SimHub-log staat bij de
   eerste publicatie `3SM overlay: properties aangemeld=<n>, mislukt=<m>`.
   `mislukt` moet `0` zijn.

Vanaf de eerstvolgende pluginversie doet de plugin stap 1 en 2 zelf en meldt het
resultaat in het log als `3SM overlay: ONBEKENDE BINDING <item>.<target> -> [naam]`.
Zie `docs/plans/2026-10-22-endurance-overlay.md` voor de controle zelf.
