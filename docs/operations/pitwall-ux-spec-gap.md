# Pitwall UX-spec v2 — gap-rapport

Vergelijking van `HERMES_3SM_Pitwall_TimingTower_UX_Spec_v2.pdf` (hierna: *de spec*)
met de pitwall zoals die op `main` staat. Peildatum 25 oktober 2026, branch
`docs/w10b-spec-gap`, basiscommit `b263c38`.

**Geen code gewijzigd.** Dit document is de enige toevoeging.

## Methode

Elke eis is in drie lagen nagelopen voordat er een oordeel staat:

1. **Contract** — `tools/simhub-plugin/3SM.EnduranceConnector/TelemetryContractsV3.cs`:
   bestaat het veld, en op welk object (ons voertuig of de tegenstanderlijst)?
2. **Connector** — `EnduranceConnectorPlugin.cs`: wordt het gevuld, en met welke filter?
3. **UI** — `src/features/endurance/pitwall/` (+ `src/lib/pitwallTrackGeometry.ts`):
   wordt het gelezen en getoond?

Een veld dat de connector niet levert is **geen ontbrekende feature** maar een
bewuste beperking. Zo'n rij krijgt status **B** met het ontbrekende veld en de
bron erbij, zodat niemand het later als "nog te bouwen" leest en gaat verzinnen.

## Legenda

| Status | Betekenis |
| --- | --- |
| **A** | Aanwezig en werkt zoals de spec het bedoelt. |
| **B** | Bewust niet mogelijk: de bron levert het veld niet. Bewijs staat in de rij (contractregel + welk object). |
| **C** | Ontbreekt en moet gebouwd worden. Bij elke C staat waar de data vandaan zou moeten komen; is die er niet, dan was het een B. |

Elke rij heeft een id (`E01`…) zodat er in een plan of issue naar verwezen kan worden.

## Samenvatting

| Status | Aantal |
| --- | --- |
| A — aanwezig | 51 |
| B — bron levert het niet | 3 |
| C — ontbreekt, bouwen | 70 |
| **Totaal** | **124** |

De drie B-rijen zijn E20 (incident/out per tegenstander), E52 (checklist) en E56
(team-pitwindow). §3 zet daar de volledige lijst contractgrenzen naast: acht
concepten, waarvan een deel ook als rij in de tabel staat.

De C-rijen zijn niet allemaal even zwaar: een aantal is een label, een class of
een tekst (zie §5), de rest is echt werk. De drie zwaarste staan in §4.

---

## 1. Waar de pitwall nu uit bestaat

| Bestand | Rol in de spec | Regels |
| --- | --- | --- |
| `PitwallTab.tsx` | pagina-opbouw, databron, compositie | 344 |
| `TopRaceBar.tsx` | bovenbalk: positie, ronde, resttijd, gap, brandstof, PIT IN | 144 |
| `RaceTelemetryStrip.tsx` | KPI-strip (P, K, S1–S3, laatste, beste, ronde, resttijd) | 27 |
| `StandingsWidget.tsx` | timing tower + ahead/you/behind | 161 |
| `standings.ts` | afleiding, klasse-sortering, gap-rendering | 115 |
| `LiveTrackPanel.tsx` + `TrackProjection.tsx` + `MovingTrackCar.tsx` | track map | 15 + 35 + 33 |
| `PaceGraph.tsx` | pace-grafiek | 95 |
| `PacePanel.tsx` | pace-cijfers (laatste/beste/stint/doel) | 65 |
| `StintDriverPanel.tsx` | rijderswissel-strook (NU/VOLGENDE/DAARNA) | 72 |
| `FuelPanel.tsx`, `PitStrategyBlock.tsx`, `StrategyForecast.tsx` | brandstof en strategie | 63 + 115 + 98 |
| `VehicleTelemetryPanel.tsx` | banden, snelheid, rpm | 77 |
| `RaceTimeline.tsx`, `AlertZone.tsx` | events en meldingen | 105 + 35 |
| `usePitwallData.ts` | RPC-poll, `isLive`, afleidingen | 212 |
| `strategy/` (advise, pitWindow, pitLoss, fuelModel, tyreWear) | rekenkern | 14 bestanden |
| `DecisionBand.tsx` + `usePitwallStrategy.ts` | beslissingsband + wire naar de rekenkern | 108 + 65 |
| `src/pages/PitwallDeviceTestPage.tsx` | admin/testpagina `/admin/pitwall-test` | — |

Twee dingen vallen op vóór de eisen:

- **De rekenkern is niet aangesloten op de pitwall.** `DecisionBand`,
  `usePitwallStrategy`, `computePitWindow`, `computePitLoss` en `advise()` worden
  alleen door `src/pages/PitwallDeviceTestPage.tsx` gebruikt
  (`PitwallDeviceTestPage.tsx:19-20, 120, 256`). `PitwallTab.tsx` importeert geen
  van deze modules. De pitwall rekent dus met de oudere, eenvoudiger
  `PitwallStrategyRow`-getallen, terwijl de betere motor (met stale-detectie,
  pitwindow, pitverlies, confidence) in de repo staat maar ongebruikt is.
- **`pace_targets` komt mee in de RPC maar wordt nergens gelezen**
  (`pitwallHelpers.ts:190`, `usePitwallData.ts:54`; geen enkele consumer). Daardoor
  staat `PaceData.targetSeconds` permanent op `null` (`usePitwallData.ts:86`) en is
  er geen enkele deltawaarde in de pitwall.

---

## 2. Gap-tabel per spec-onderdeel

### §02 — UX-principes

| Id | Eis | Status | Bewijs / wat nodig |
| --- | --- | --- | --- |
| E01 | Scanbaarheid: in 1–3 s positie, delta, laatste ronde en volgende wissel vinden | **C** | Positie en laatste ronde staan in de KPI-strip (`RaceTelemetryStrip.tsx:16-22`); **delta bestaat niet** (geen kolom, `targetSeconds` altijd null, `usePitwallData.ts:86`) en de volgende wissel staat niet in de bovenste strook maar in `StintDriverPanel` onderaan (`PitwallTab.tsx:328`). Twee van de vier eisen zijn dus niet in één oogopslag te halen. |
| E02 | Density with hierarchy: veel rijen/kolommen mogen, mits consistente labels, uitlijning en groepering | **A** | Tower heeft 10 kolommen in vaste volgorde met `tabular-nums` en vaste breedtes (`StandingsWidget.tsx:115-151`). |
| E03 | Eigen teamrij direct herkenbaar, maar niet fel | **A** | `bg-orange-500/[0.06]` + 2px inset-linkerrand in `#FF7417` (`StandingsWidget.tsx:141`). |
| E04 | Truthful telemetry: live, stale, disconnected, estimated en planned zijn aparte toestanden | **C** | Alleen live/offline bestaat (`usePitwallData.ts:119`). Zie §11 — de tower claimt zelfs "Live" als de feed weg is. |
| E05 | Role-specific density: Pitwall vol, Driver rustiger, Management vergelijking/historie | **C** | Eén `PitwallTab` voor iedereen met toegang (`RaceWorkspace.tsx:114`). Geen rolcheck in de pitwall; `access: "staff" \| "team_member"` uit de RPC wordt nergens gelezen. |
| E06 | Productidentiteit: bestaand oranje, donker palet, typografie, navigatie | **A** | Sitefont/heading-font en bestaande tokens (`src/index.css:21-22`, `1206-1237`); tabnavigatie intact (`RaceWorkspace.tsx:104-114`). |

### §03 — Hoofdscherm: compositie

| Id | Eis | Status | Bewijs / wat nodig |
| --- | --- | --- | --- |
| E07 | Top KPI-strip: delta, sectoren, last/best, positie, race time, laps | **C** | `RaceTelemetryStrip.tsx:15-25` heeft P, K, S1–S3, laatste, beste, ronde, resttijd. **Delta ontbreekt**; "laps" is alleen de verreden ronde, niet resterende rondes (`sessionLapsRemaining` is getypeerd in `pitwallHelpers.ts:60` maar wordt niet getoond). |
| E08 | Linkerkolom: track map bovenaan, pace/telemetrie eronder | **C** | Map en pace staan **rechts** van de tower (`PitwallTab.tsx:289-301`: `xl:grid-cols-[1.35fr,1fr]` met `StandingsWidget` eerst). De volgorde klopt inhoudelijk (tower dominant) maar niet met de opgegeven compositie. |
| E09 | Hoofdvlak: timing tower met class headers, posities, coureur/team, sectoren, last/best, pit, gap, delta | **C** | Alles aanwezig behalve **sectoren** (B, zie E20) en **delta** (C). Tabel `StandingsWidget.tsx:114-156`. |
| E10 | Onderste strip: huidige/volgende rijder, stinttimer, swap timing, fuel/strategy | **C** | Huidige/volgende rijder en brandstof staan er (`StintDriverPanel.tsx:23-49`, `FuelPanel.tsx:28-46`), maar het is geen strip: vier losse kaarten plus twee blokken (`PitwallTab.tsx:305-330`). **Stinttimer en swap timing ontbreken** (E44, E46). |
| E11 | Global header: racecontext en connection state blijven zichtbaar | **C** | Racecontext staat in de event-header (`RaceWorkspace.tsx:108`) en in focus-mode (`PitwallTab.tsx:186-224`); connection state staat **alleen in focus-mode** als LIVE/OFFLINE-stip (`PitwallTab.tsx:200-206`) en anders alleen als de boel stuk is (`TopRaceBar.tsx:12-20`). |

### §04 — Timing tower: kolomvolgorde

| Id | Eis | Status | Bewijs / wat nodig |
| --- | --- | --- | --- |
| E12 | Pos / car # als vaste smalle kolommen, numeriek uitgelijnd | **A** | `P` en `K` en `#` in `StandingsWidget.tsx:118-120, 142-144`; `tabular-nums` op de tabel (regel 115). |
| E13 | Driver / team als breedste kolom | **A** | `max-w-[7rem]` met truncate, enige kolom met breedtebeperking (regel 145). |
| E14 | S1/S2/S3 met consistente tijdnotatie | **C** | De kolommen bestaan niet in de tower. Voor de **eigen** auto staan ze in de KPI-strip (`RaceTelemetryStrip.tsx:18-20`, `.toFixed(3)`); voor tegenstanders is het een **B** (zie §3). Kolom toevoegen kan alleen voor de eigen rij, wat een halflege kolom oplevert — eerst beslissen of dat gewenst is. |
| E15 | Last / Best expliciet gescheiden | **A** | Twee kolommen, eigen kleur, `preciseLapTime` (`StandingsWidget.tsx:147-148`, `telemetryFormat.ts:2`). |
| E16 | Pit: statusbadge alleen als de bron het ondersteunt; OUT niet uit tijd afleiden | **A** | `r.inPit ? "PIT" : "—"` (`StandingsWidget.tsx:151`), gevuld uit `opponent.IsCarInPitLane \|\| opponent.IsCarInPit` (`EnduranceConnectorPlugin.cs:1433`). Er wordt nergens een OUT- of lapped-status uit tijd afgeleid. |
| E17 | Lap / Gap / Δ met expliciete eenheden en referentie; negatieve delta groen alleen na bevestigde projectdefinitie | **C** | Lap en Gap bestaan (`StandingsWidget.tsx:149-150`, `renderGap` → `+12.3s`, `standings.ts:106-111`). **Δ-kolom ontbreekt.** Er is ook geen vastgelegde projectdefinitie van delta (geen documentatie, geen veld); `PacePanel.tsx:50-54` kleurt een Δ nu groen bij negatief zonder die definitie te noemen. |

### §05 — Class-groepering en rijen

| Id | Eis | Status | Bewijs / wat nodig |
| --- | --- | --- | --- |
| E18 | Klasseheader met klassenaam en aantal actieve deelnemers als die telling bestaat | **A** | Header per klasse met `{n} auto's` (`StandingsWidget.tsx:133-140`), geteld uit de rijen die er echt zijn. |
| E19 | Rijhoogte 24–30 px, tabular numerals | **A** | `h-7` = 28 px (`StandingsWidget.tsx:141`), `tabular-nums` (regel 115). |
| E20 | Pitstatus, incident en out/lapped als verschillende signalen | **B** | Pitstatus is een eigen kolom (A), maar **incident en out/lapped per tegenstander bestaan niet in het contract**: `V3Opponent` (`TelemetryContractsV3.cs:60-80`) heeft geen incident-, flag- of retired-veld. Incidenten zijn er alleen voor de eigen auto (`V3Normalized.raceState.incidents`, `pitwallHelpers.ts:88-90`) en worden in de pitwall niet getoond. Niet bouwen zonder contractuitbreiding; "lapped" zou wél uit `lap` vs `timing.completedLaps` mogen (zie E21). |
| E21 | Lapped-status onderscheiden van pit en incident | **C** | Afleidbaar uit `opponent.lap` (`TelemetryContractsV3.cs:70`) tegen `timing.completedLaps` (`:126`) — beide velden bestaan, de UI toont alleen de losse ronde (`StandingsWidget.tsx:149`). Geen tijdgebaseerde gok nodig. |
| E22 | Tower scrollt intern; KPI-strip en connection status blijven vast | **C** | Alleen `overflow-x-auto` op de tabel (`StandingsWidget.tsx:114`); geen `max-height`, dus de pagina scrollt en de strip verdwijnt mee. De comment in `PitwallTab.tsx:265` zegt "sticky in focus mode" maar `TopRaceBar` zet geen `sticky`-class. |
| E23 | Sortering volgt de officiële timingfeed; geen client-side sortering op rondetijd | **A** | `standings.ts:64-74`: klasse → klassepositie → algemene positie; geen sortering op rondetijd. |
| E24 | Em dash voor onbekende waarden; geen 0.000, geen lege cellen, geen nep-placeholder | **A** | `preciseLapTime` → `'—'` (`telemetryFormat.ts:2`), `renderGap` → `'—'` (`standings.ts:109`), `renderPosition` → `'—'` (`standings.ts:114`), `formatFuel`/`formatLaps` → `'—'` (`pitwallHelpers.ts:258-266`). |

### §06 — Track map en geselecteerde auto

| Id | Eis | Status | Bewijs / wat nodig |
| --- | --- | --- | --- |
| E25 | Alleen markers bij een betrouwbare position feed; geen schijnprecisie | **A** | Markers alleen bij `lapDistancePct` die numeriek en 0..1 is (`LiveTrackPanel.tsx:7`, `TrackProjection.tsx:30-31`). Eigen auto valt terug op `v3.track.lapDistancePct` (`TrackProjection.tsx:24`). De kaart zegt zelf dat het een projectie is: "Schematische projectie … geen GPS- of pitboxpositie" (`TrackProjection.tsx:34`). |
| E26 | Circuit-outline in 3SM oranje, dun en rustig | **C** | De kaart toont de officiële SVG als `<image>` (`TrackProjection.tsx:28`), niet een eigen oranje lijn. Niet fout, maar wijkt af van de spec; aanpassen betekent de bron-SVG hertekenen of een filter/oranje overlay toevoegen. |
| E27 | Eigen teamauto duidelijke marker, overige beperkt/neutraal | **A** | Eigen auto oranje `#fb923c` r=32, pit amber, rest blauw (`MovingTrackCar.tsx:31`). |
| E28 | Klik/selecteer op marker markeert de tower-rij (als technisch ondersteund) | **C** | Geen `onClick`, geen selectiestate in de tower (`StandingsWidget.tsx` heeft geen props voor selectie). Technisch triviaal: beide lijsten komen uit dezelfde `v3.opponents` (`PitwallTab.tsx:119-127`, `LiveTrackPanel.tsx:7`). Spec noemt dit optioneel. |
| E29 | Track title: circuitnaam en layout | **A** | `trackName` + `trackConfig`, met dedupe als de config al in de naam zit (`LiveTrackPanel.tsx:5,9`, `TrackProjection.tsx:13`). |
| E30 | Selected driver onder/naast de kaart, alleen na selectie | **C** | Bestaat niet; volgt automatisch uit E28. |
| E31 | Markers met timestamp; stale markers vervagen of markeren | **C** | `capturedAt` komt binnen (`TrackProjection.tsx:32` → `MovingTrackCar.tsx:14`) maar wordt alleen voor de animatieduur gebruikt, niet voor een stale-indicatie. Bij een dode feed blijven de markers staan zonder waarschuwing — dezelfde fout als E52. |
| E32 | Track direction alleen tonen als de richting in de circuitdata bekend is | **C** | De richting **is** bekend: `TrackProjectionGeometry.hasOfficialDirection` (`pitwallTrackGeometry.ts:14`) en de vector wordt gebruikt om de projectie te draaien (`:119, 131`). Er wordt niets mee getoond. |
| E33 | Zonder position data: alleen outline + "positiefeed niet beschikbaar" | **C** | De fallback zegt "Wacht op autoposities." (`LiveTrackPanel.tsx:13`) en toont de voortgangsbalk met nul markers. Dat leest als "het komt zo", niet als "deze feed bestaat niet". Tekst en toestand aanpassen. |

### §07 — Pace-grafiek en telemetrie

| Id | Eis | Status | Bewijs / wat nodig |
| --- | --- | --- | --- |
| E34 | Alleen metrics die echt bestaan: rondetijd, stintgemiddelde, delta, sectortrend | **C** | `PaceGraph.tsx` toont alleen rondetijden uit de timeline (`PitwallTab.tsx:98-106`). Geen stintgemiddelde-lijn, geen delta (target is null), geen sectortrend (sectorhistorie wordt niet opgeslagen; alleen de laatste sector per auto, `TelemetryContractsV3.cs:47-49`). |
| E35 | Legenda, eenheden en gekozen rijder/periode altijd zichtbaar | **C** | Eenheden en mediaan staan er (`PaceGraph.tsx:72-74, 92`), maar er is **geen rijder- of periodekeuze**: de grafiek is altijd de eigen auto over de laatste 60 events (`PitwallTab.tsx:105`). |
| E36 | Pit-in, pit-out, driver swap en incidenten markeren als de events bestaan | **C** | Alleen `pit` wordt gezet, uit `pit_entry` (`PitwallTab.tsx:95-97, 106`). `PacePoint.marker` kent `"swap"` (`PaceGraph.tsx:7`) maar niets produceert die waarde. `pit_exit`, `flag_change` en `incident_change` zitten wél in de timeline (`RaceTimeline.tsx:27`) en zijn dus beschikbaar. Een wisselmoment is af te leiden uit `planned_stints.actual_start_at` (`pitwallHelpers.ts:146`). |
| E37 | Geen bandentemperatuur- of throttle-curves alsof die gemeten zijn | **A** | De grafiek tekent uitsluitend rondetijden; niets anders. (`PedalTrace.tsx` bestaat maar wordt nergens geïmporteerd.) |
| E38 | Bij stale feed: laatste punten bevriezen + amber stale-banner | **C** | Geen enkele stale-behandeling in `PaceGraph.tsx`; het component krijgt niet eens een `live`-prop (`PitwallTab.tsx:299`). De oude punten blijven staan zonder label. |

### §08 — KPI-strip

| Id | Eis | Status | Bewijs / wat nodig |
| --- | --- | --- | --- |
| E39 | Delta (P0), kleur volgens bestaande definitie, label en teken zichtbaar | **C** | Bestaat niet. Geen veld, geen kolom, geen definitie. `targetSeconds` staat permanent `null` (`usePitwallData.ts:86`) terwijl `pace_targets` wél in de RPC zit. Eerst vastleggen wat delta betekent (t.o.v. eigen beste? t.o.v. doel? t.o.v. leider?) en dan bouwen. |
| E40 | Sector 1/2/3 (P0), compact, huidige/laatste geldige sector duidelijk | **A** | `RaceTelemetryStrip.tsx:18-20` uit `vehicle.sector1/2/3Seconds`; alleen de eigen auto, wat correct is (voor tegenstanders B, zie §3). Label zegt niet of het "laatste" of "huidige" sector is — kleine C, zie §5. |
| E41 | Last lap (P0) prominent, consistent formaat | **A** | `RaceTelemetryStrip.tsx:21` met `preciseLapTime` (m:ss.mmm), plus in de tower. |
| E42 | Best lap (P1), niet verwarren met last lap, sessiecontext bekend | **A** | Eigen cel, eigen kleur (`RaceTelemetryStrip.tsx:22`); bron is `timing.bestLapTimeSeconds` (sessiebreed). |
| E43 | Overall / class pos (P0), apart gelabeld | **A** | `P` en `K` als losse cellen (`RaceTelemetryStrip.tsx:16-17`) en in de bovenbalk `P6 / K2` (`TopRaceBar.tsx:116-129`). |
| E44 | Race time / laps (P1), vaste breedte tegen layout shift | **A** | Resttijd uit `session.sessionTimeRemainingSeconds` in een vaste gridcel (`RaceTelemetryStrip.tsx:24,26`). Alleen: `extractRaceClock` geeft `null` bij 0 (`pitwallHelpers.ts:291`), dus de laatste seconde voor de finish toont "—". |
| E45 | Connection / update age (P0) in de header, niet in een debugpaneel | **C** | `received_at` is beschikbaar (`usePitwallData.ts:118`) en wordt alleen gebruikt voor een boolean met 10 s grens (regel 119). De leeftijd wordt nergens getoond. |
| E46 | Bij smalle desktop mogen sectoren compacter, maar positie, last lap en verbinding blijven | **C** | De strip heeft responsive trappen (`RaceTelemetryStrip.tsx:26`: 3/5/9 kolommen), maar er is geen verbindingsindicator in de strip om te behouden. |

### §09 — Rijderswissel en stintplanning

| Id | Eis | Status | Bewijs / wat nodig |
| --- | --- | --- | --- |
| E47 | Current driver: naam + car number + status | **C** | Naam komt uit `identity.currentDriverName` of de stintplanning (`PitwallTab.tsx:132`). **Car number is hardcoded `null`**: `ownCarNumber={null}` (`PitwallTab.tsx:294`), terwijl de RPC `team.car_number` meelevert (`usePitwallData.ts:28`) en `extractTeams` dat veld weggooit (regel 91-97). Status: alleen impliciet via de stint. |
| E48 | Stint timer: duur sinds echte starttijd; geen client-timer zonder startbron | **C** | Geen timer. Startbronnen bestaan wél: `session.sessionTimeSeconds` (echte iRacing-klok, `TelemetryContractsV3.cs:99`), `timeline.stint_elapsed_s` (`pitwallHelpers.ts:135`) en `planned_stints.actual_start_at`. Let op: `actual_start_at` wordt bij het aanmaken van een concept gelijkgezet aan de **geplande** start (`StintPlanner.tsx:268`), dus een timer daarop is een plan-timer en moet zo gelabeld worden. Neem de sessieklok als het "echte" getal. |
| E49 | Next driver: naam + geplande volgorde; onbekend als rotatie niet is ingesteld | **C** | Volgorde staat er (`PitwallTab.tsx:130-133`, `StintDriverPanel.tsx:33-49`). Bij een lege planning zegt het paneel "Geen data" (`StintDriverPanel.tsx:16-18`) in plaats van "geen rotatie ingesteld" — dat is een verkeerde toestand, geen ontbrekende feature. |
| E50 | Swap ETA: countdown of gepland venster, altijd als planning/estimate gemarkeerd | **C** | Bestaat niet. `nextStint.original_start_at`/`original_end_at` zijn beschikbaar (`pitwallHelpers.ts:145-146`), dus een gepland venster is te tonen — met het label "planning". |
| E51 | Swap status: planned / confirmed / complete, niet uit verstreken tijd afgeleid | **C** | De statussen bestaan in de data (`"draft"`, `"in_car"`, `"completed"`, `"replaced"`, `"expired"`; zie `pitwallHelpers.ts:153` en de filters in `PitwallTab.tsx:129-130`) maar worden niet als status getoond. Er wordt niets uit tijd afgeleid — dat deel is goed. |
| E52 | Checklist alleen als workflow en opslag al bestaan | **B** | Er is geen tabel, geen UI en geen workflow voor teamstappen in de repo. Spec noemt dit zelf optioneel, dus niet bouwen. |
| E53 | Kleurgebruik oranje/groen/amber/rood met statuslabels ernaast | **C** | Kleuren worden gebruikt (`AlertZone.tsx:22-28`, `PitStrategyBlock.tsx:33-38`), maar niet volgens deze semantiek: oranje betekent nu "let op" én "eigen team" én "gap", en er is geen amber-stale toestand (E04). |

### §10 — Fuel, banden en pitstrategie

| Id | Eis | Status | Bewijs / wat nodig |
| --- | --- | --- | --- |
| E54 | Onderscheid gemeten / berekend / gepland met labels | **C** | `FuelPanel.tsx:28-46` toont "Over", "Ronden", "Per ronde", "Race", "Finish", "Samples" zonder herkomst. `fuel_laps_remaining` en `fuel_to_finish_litres` zijn **berekend** (server), `current_fuel_litres` is gemeten. Geen enkel label maakt dat verschil. `VehicleTelemetryPanel.tsx:74` doet het wél goed ("Stand van SimHub; verspringt alleen bij een stop") — dat patroon ontbreekt bij brandstof. |
| E55 | Niet beschikbaar: — plus korte uitleg, niet stilzwijgend weglaten | **A** | `FuelPanel.tsx:23-25` ("Geen live telemetrie"), `FuelPanel.tsx:31-33` (`—` per veld), `PitStrategyBlock.tsx:82` (`—` als `fuel_to_add_litres` null is). |
| E56 | Pit-window zoals door het team ingesteld, als gepland gemarkeerd | **B** | Er is geen veld voor een team-pitwindow: `planned_stints` heeft `original_start_at`, `original_end_at`, `expected_laps`, `fuel_litres` (`pitwallHelpers.ts:142-155`) — geen window. Wat de UI "PIT IN n" noemt is een **berekening** uit de tank (`PitStrategyBlock.tsx:25-27`, `calcPitLap` in `pitwallHelpers.ts:214-221`), niet een teamplan. `computePitWindow` bestaat (`strategy/pitWindow.ts:31`) maar is niet aangesloten. |
| E57 | Banden: gemeten waarde met bron/timestamp | **A** | Vier hoeken met `wearPercent`, temperatuur en druk, met de expliciete mededeling dat het de laatste SimHub-stand is (`VehicleTelemetryPanel.tsx:19-40, 74`). |

### §11 — Data freshness en foutstatus

| Id | Eis | Status | Bewijs / wat nodig |
| --- | --- | --- | --- |
| E58 | Live: groen punt + LIVE-label + recente update | **C** | Groen punt en LIVE-bestaan alleen in focus-mode (`PitwallTab.tsx:200-206`); de "recente update" (leeftijd) ontbreekt overal. Buiten focus-mode is er geen live-indicator. |
| E59 | Stale: amber label, update age zichtbaar, waarden als verouderd | **C** | Er is geen stale-toestand. `isLive` is binair met 10 s (`usePitwallData.ts:119`); alles daarboven heet "offline", en de amber-stap bestaat niet. De rekenkern kent hem wél (`strategy/advise.ts:20, 69-74`) maar is niet aangesloten. |
| E60 | Disconnected: label + laatste succesvolle update, geen realtime claim | **C** | `TopRaceBar.tsx:12-20` toont "TELEMETRIE VERLOREN" maar zonder tijdstip. **Erger: de tower claimt altijd "Live"** — `StandingsWidget.tsx:57-59` rendert een groene stip met "Live" zonder enige conditie, ook als de feed weg is. Dat is precies wat de spec verbiedt. |
| E61 | Partial: beschikbare velden bruikbaar, ontbrekende `—`, pagina niet leegmaken | **A** | Overal `—` (E24); panelen blijven staan; `StandingsWidget.tsx:36-42` heeft een eigen lege toestand. |
| E62 | Session ended: Ended-label, live-mutaties uit, timing blijft leesbaar | **C** | `session.sessionState` is getypeerd (`pitwallHelpers.ts:62`) en zit in het contract (`TelemetryContractsV3.cs:103`), maar wordt nergens gelezen. Race Control blijft schrijfbaar op rol alleen (`RaceControlPanel.tsx:54`), niet op sessiestatus. |
| E63 | Loading: skeletons of loading-label, geen fake cijfers | **A** | "Pitwall laden…" (`PitwallTab.tsx:275-277`); geen placeholderwaarden. |
| E64 | Error: korte melding, details in diagnostics, geen stacktrace | **A** | `role="alert"` met één zin (`PitwallTab.tsx:279`). |
| E65 | Stale threshold pas kiezen na onderzoek van de echte cadans | **C** | Onderzocht: de UI pollt elke 1 s (`usePitwallData.ts:113`) en de connector zendt ongeveer 1 pakket/s. De grens staat nu op 10 s (`usePitwallData.ts:119`) = ~10 gemiste pakketten; de rekenkern hanteert 5 s (`strategy/advise.ts:20`). Twee verschillende grenzen voor hetzelfde begrip — één bron van waarheid kiezen en de gekozen waarde in de UI documenteren. |

### §12 — Views per rol

| Id | Eis | Status | Bewijs / wat nodig |
| --- | --- | --- | --- |
| E66 | Pitwall / Driver / Management als aparte views met eigen informatiedichtheid | **C** | Alleen de Pitwall-view bestaat (`RaceWorkspace.tsx:114`). Er is geen Driver- of Management-view, ook niet als variant van dezelfde data. De enige differentiatie is de bestaande toegangscontrole (`RaceWorkspace.tsx:79`). |
| E67 | Admin / diagnostics alleen voor bevoegde gebruikers | **A** | `/admin/pitwall-test` met super-admin guard (`App.tsx:110`, `PitwallDeviceTestPage.tsx:129-130`). Toont bronstatus, timestamps en de beslissingsband. Geen drawer zoals in §15, wel de functie. |
| E68 | Bestaande permissions, routes en navigatie intact | **A** | Niets in de keten omzeilt RLS/RPC: `get_pitwall_data` is SECURITY DEFINER met eigen-lidmaatschapcheck (`usePitwallData.ts:14-21`), de UI toont alleen wat de RPC teruggeeft. |

### §13 — Responsive

| Id | Eis | Status | Bewijs / wat nodig |
| --- | --- | --- | --- |
| E69 | 3440 ultrawide: tower breed, map+graph links, strategie onderaan | **C** | Tower is breed (1.35fr, `PitwallTab.tsx:289`) maar map/graph staan rechts en er is geen ultrawide-specifieke trap boven `xl`. |
| E70 | 1920: referentielayout met linkerkolom en dominante tower | **C** | Tower dominant, linkerkolom ontbreekt (E08). |
| E71 | 1280: geen horizontale scroll voor kernkolommen | **C** | De tower heeft `min-w-[620px]` binnen `overflow-x-auto` (`StandingsWidget.tsx:114-115`). In de 1.35fr-kolom van een 1280-viewport is dat krap; de kernkolommen (P, team, laatste, gap) kunnen dan horizontaal wegvallen — precies wat de spec verbiedt. Meten op 1280 en zo nodig kolommen schrappen in plaats van scrollen. |
| E72 | Tablet: minder kolommen, overflow alleen in de tabel | **A** | Overflow zit in de tabelcontainer (`StandingsWidget.tsx:114`); KPI-strip trapt terug naar 5 en 3 kolommen (`RaceTelemetryStrip.tsx:26`). |
| E73 | Mobiel: geen primaire pitwall, compacte Driver view | **C** | Er is geen mobiele variant; dezelfde pagina rendert door (met E66 als oorzaak). |

### §14 — 3SM visual system

| Id | Eis | Status | Bewijs / wat nodig |
| --- | --- | --- | --- |
| E74 | Tokens background/panel/raised/border/text/accent/success/warning/danger | **C** | De site heeft equivalente tokens (`src/index.css:1206-1237`: background `220 20% 7%` ≈ `#0E1116`, card ≈ `#15191E`, border ≈ `#272B35`, racing-orange ≈ `#FA7C0C`) maar de pitwall gebruikt **ruwe klassen**: `bg-black/40`, `bg-white/[0.02]`, `border-white/10`, `text-gray-500` (o.a. `StandingsWidget.tsx:54`, `LiveTrackPanel.tsx:8`, `FuelPanel.tsx:10`). Daardoor wijken panelen af van de rest van de site en van de spec. Omzetten naar `bg-card` / `border-border`. |
| E75 | Bestaande sitefont en CSS-tokens waar mogelijk | **A** | `font-heading`/`font-body` en de bestaande kleurtokens zijn beschikbaar en worden deels gebruikt. |
| E76 | Tabular numbers waar ondersteund | **A** | `tabular-nums` op tower en KPI-strip (`StandingsWidget.tsx:115`, `RaceTelemetryStrip.tsx:26`). |
| E77 | Labels minimaal 10–11 px, cijfers groter dan labels | **C** | Veel labels staan op 9 px (`StandingsWidget.tsx:116`, `TopRaceBar.tsx:139`, `PaceGraph.tsx:92`). Onder de ondergrens van de spec. |
| E78 | Oranje spaarzaam, randen subtiel, hiërarchie uit uitlijning/gewicht | **A** | Oranje alleen voor eigen rij, actieve tab en actie (`StandingsWidget.tsx:141`, `TopRaceBar.tsx:96`); randen op 8–10 % opacity. |

### §15 — Componenten en implementatiegrenzen

| Id | Eis | Status | Bewijs / wat nodig |
| --- | --- | --- | --- |
| E79 | `RaceKpiStrip` — vaste hiërarchie, geen fake fallback | **A** | `RaceTelemetryStrip.tsx`; nullt de data als `live` false is (regel 12) en toont dan `—`. |
| E80 | `TimingTower` — gegroepeerde klasse-rijen, officiële volgorde, alleen virtualiseren als nodig | **A** | `StandingsWidget.tsx` + `standings.ts`; begrensd op 40 rijen (`deriveStandings(..., 40, ...)` in `PitwallTab.tsx:124-126`), geen virtualisatie nodig. |
| E81 | `TimingRow` — één rijcomponent met selectie en toegankelijke status | **C** | Rijen zijn inline JSX in een `.map` (`StandingsWidget.tsx:131-154`): geen eigen component, geen selectie, geen `aria`-status per rij. |
| E82 | `TrackMap` — alleen echte positiefeed | **A** | `LiveTrackPanel` + `TrackProjection` (zie E25). |
| E83 | `PaceGraph` — alleen ondersteunde metrics | **A** | Alleen rondetijden (E37). |
| E84 | `DriverRotationStrip` — huidige/volgende coureur + stint, op het bestaande rotatiemodel | **C** | `StintDriverPanel` bestaat op de bestaande planning, maar mist stintduur en swap-ETA (E48, E50) en is geen strip (E10). |
| E85 | `StrategyPanel` — gemeten vs geschat vs gepland | **C** | Drie losse panelen (`FuelPanel`, `PitStrategyBlock`, `StrategyForecast`) zonder herkomsten (E54). |
| E86 | `ConnectionState` — één bron van waarheid | **C** | Er is geen component: `isLive` wordt op vier plekken apart geïnterpreteerd (`PitwallTab.tsx:134`, `RaceTelemetryStrip.tsx:12`, `LiveTrackPanel.tsx:7`, `VehicleTelemetryPanel.tsx:16`) en op één plek genegeerd (`StandingsWidget.tsx:57`). |
| E87 | `DiagnosticsDrawer` — technische diagnostiek voor bevoegde rollen | **C** | Geen drawer. Wel een aparte pagina (`/admin/pitwall-test`) en het SimHub-paneel in Race Control (`SimHubTelemetryPanel.tsx:94-104` met leeftijd in seconden). Binnen de pitwall zelf is er geen enkele technische laag. |
| E88 | Geen nieuwe stack of dependencies zonder reden | **A** | Geen grafiekbibliotheek: `PaceGraph` tekent met de hand een SVG-pad (`PaceGraph.tsx:47-49`). Geen nieuwe dependency toegevoegd. |

### §16 — Data-contract inspectie

| Id | Concept | Status | Bewijs |
| --- | --- | --- | --- |
| E89 | `sessionStatus` (race lifecycle / completed) | **C** | Contract heeft `session.sessionState` (`TelemetryContractsV3.cs:103`) en `flags`; frontend type ook (`pitwallHelpers.ts:62`) maar ongebruikt. Fallback "unknown/ended" bestaat niet. |
| E90 | `connectionStatus` (heartbeat, laatste event) | **C** | `telemetry.received_at` beschikbaar (`usePitwallData.ts:118`); alleen als 10 s-boolean gebruikt, niet als toestand. |
| E91 | `lastUpdatedAt` | **C** | Zelfde veld, zelfde probleem: nooit getoond. |
| E92 | `position` / `classPosition` | **A** | `v3.position` + `opponent.position`/`classPosition` (`pitwallHelpers.ts:70-74`, `:108-109`). |
| E93 | `sectorTimes` / `lastLap` / `bestLap` | **A** | Eigen auto: `vehicle.sector1/2/3Seconds`, `timing.last/bestLapTimeSeconds`. Tegenstanders: `lastLapSeconds`/`bestLapSeconds` wél, sectoren **niet** (B, zie §3). |
| E94 | `gapAhead` / `gapBehind` / `delta` | **A** | Gap via `gapToPlayerSeconds` (teken behouden in de connector: `EnduranceConnectorPlugin.cs:1432`) en `gapToLeaderSeconds`; `renderGap` zet het teken (`standings.ts:106-111`). Delta: **C** (E39). |
| E95 | `currentDriver` / `nextDriver` | **A** | `identity.currentDriverName` + `planned_stints` (`PitwallTab.tsx:132-133`). |
| E96 | `stintDuration` / `swapEta` | **C** | `stintDuration`: `session.sessionTimeSeconds` en `timeline.stint_elapsed_s` bestaan. `swapEta`: alleen `original_start_at`/`original_end_at` (planning). Beide ongebruikt. |
| E97 | `fuel` / `tyre` metrics | **A** | `fuel.fuelLitres`/`fuelLapsRemaining` via `PitwallStrategyRow`, banden via `vehicle.frontLeft…rearRight` (`VehicleTelemetryPanel.tsx:19-40`). |

### §17 — Gefaseerde implementatie

| Id | Fase | Status | Bewijs |
| --- | --- | --- | --- |
| E98 | Fase 0 Inspect: bestandslijst + veldmapping + risico's | **C** | Dit document vult die fase in; er lag nog geen veldmapping in `docs/operations`. |
| E99 | Fase 1 Layout: timing-tower-first grid met 3SM tokens, screenshot voor/na | **C** | Grid is tower-first (`PitwallTab.tsx:289`) maar met ruwe kleuren in plaats van tokens (E74); geen voor/na-screenshots in de repo. |
| E100 | Fase 2 Tower: klasseheaders, kolommen, teamhighlight, sortering, row states | **C** | Klasseheaders, sortering en highlight zijn klaar; **row states** (selectie, stale, status) ontbreken (E81). |
| E101 | Fase 3 Map + graph met graceful empty/stale | **C** | Empty is er, stale niet (E31, E33, E38). |
| E102 | Fase 4 Rotation + strategy aan bestaande modellen | **C** | Rotatie deels (E48, E50); strategie hangt aan de oude getallen, de rekenkern staat los (zie §1). |
| E103 | Fase 5 Role/responsive | **C** | E66, E69-E73. |
| E104 | Fase 6 QA: loading, empty, partial, stale, disconnected, ended, permissie | **C** | Er zijn 15 testbestanden `src/test/pitwall*`, vijf in `pitwall/strategy/` en `DecisionBand.test.tsx`. Ze dekken standings, projectie, format, navigatie, loading en de rekenkern. **Geen test voor stale, ended of permissiegedrag**; `pitwallLoading.test.tsx` is de enige test die een toestand van de pagina zelf afdekt. |

### §18 — Acceptatiechecklist

| Id | Eis | Status | Bewijs |
| --- | --- | --- | --- |
| E105 | Tower is visueel hoofdonderdeel en toont klassegroepen | **A** | Breedste gridkolom + klasseheaders (`PitwallTab.tsx:289`, `StandingsWidget.tsx:133-140`). |
| E106 | KPI-strip relevant zonder overvol | **A** | 9 cellen, responsive trap (`RaceTelemetryStrip.tsx:15-26`). |
| E107 | Eigen teamrij direct herkenbaar maar leesbaar | **A** | E03. |
| E108 | Track map toont alleen markers uit echte positiebron | **A** | E25. |
| E109 | Pace-grafiek gebruikt echte geldige rondetijden | **A** | Alleen `lap_completed`-events met plausibele tijd (`PitwallTab.tsx:98-106`, `PaceGraph.tsx:30`). |
| E110 | Current driver, next driver, stint timer en swap estimate onderscheiden | **C** | Timer en ETA bestaan niet (E48, E50). |
| E111 | Fuel/tyres/pit window labelen gemeten, berekend, gepland apart | **C** | E54, E56. |
| E112 | Stale/disconnected/partial niet als live getoond | **C** | E59, E60 — de tower toont altijd "Live". |
| E113 | Ontbrekende waarden niet vervangen door nullen of verzonnen data | **A** | E24, E55. |
| E114 | Driver view en Management view hergebruiken dezelfde brondata | **C** | Die views bestaan niet (E66). |
| E115 | 1920 en ultrawide getest; tablet bruikbare prioriteitsvolgorde | **C** | Geen testbewijs; 1280/ultrawide-treden ontbreken (E69-E71). |
| E116 | Bestaande permissions, routes, navigatie intact | **A** | E68. |
| E117 | Tests en voor/na-screenshots aangeleverd | **C** | Tests deels (E104), screenshots niet. |
| E118 | Geen main push of live deploy zonder toestemming | **A** | Dit rapport is documentatie op een eigen branch; niets gepusht of gedeployed. |

### Minimale scenario's (§18)

| Id | Scenario | Status | Bewijs |
| --- | --- | --- | --- |
| E119 | Feed stopt tijdens race → stale, update age, bevroren waarden | **C** | Alleen "TELEMETRIE VERLOREN" (`TopRaceBar.tsx:12-20`); geen leeftijd, geen amber, tower blijft "Live" claimen. |
| E120 | Geen positiefeed → outline zonder markers | **C** | Outline verschijnt (zij het als bronafbeelding) maar de tekst zegt "Wacht op autoposities" (E33). |
| E121 | Rotatie niet geconfigureerd → next driver = not configured | **C** | "Geen data" (`StintDriverPanel.tsx:16-18`), niet "niet ingesteld" (E49). |
| E122 | Geen fuel-data → `—` + unavailable, geen fuel prediction | **A** | `FuelPanel.tsx:23-25, 31-33`; `PitStrategyBlock.tsx:82`. |
| E123 | Sessie afgelopen → live acties uit, timing blijft | **C** | E62. |
| E124 | Read-only user → geen edit-controls | **A** | `RaceControlPanel.tsx:54` (`editable` op team/rol) en de knop verschijnt alleen buiten demo (`PitwallTab.tsx:159`). |

---

## 3. Velden die de connector niet levert (bewijs voor elke B)

Alles hieronder is geen bouwwerk maar een contractgrens. De verwijzing is naar
`TelemetryContractsV3.cs`.

| Concept | Waar het zou moeten staan | Wat er wél staat |
| --- | --- | --- |
| Sectortijden per tegenstander | `V3Opponent` (r. 60-80): geen `sector1/2/3Seconds` | Sectoren alleen op `V3Vehicle` (r. 47-49) = de eigen auto. Eén `vehicle`-object per pakket. |
| Bandentemperatuur/-druk/-slijtage per tegenstander | `V3Opponent`: geen `tyre*` | `V3Vehicle.frontLeft…rearRight` (r. 53-56), eigen auto. |
| Incidenten per tegenstander | `V3Opponent`: geen `incidents` | `V3Normalized.raceState.incidents` = eigen auto (`pitwallHelpers.ts:88-90`). |
| Vlaggen per tegenstander | `V3Opponent`: geen `flag` | `session.flags` / `primaryFlag` / `flagColour` (r. 101, 105-107) = sessiebreed, niet per auto. |
| OUT / retired per tegenstander | `V3Opponent`: geen `retired`/`out` | Alleen `lap`, `lapDistancePct`, `gapToLeaderSeconds` (r. 70-73). Uit tijd afleiden mag niet (spec §05). |
| Team-pitwindow | `planned_stints`: geen window-veld | `original_start_at`, `original_end_at`, `expected_laps`, `fuel_litres` (`pitwallHelpers.ts:142-155`). |
| Driver-swap-event uit de auto | Geen `event_type` voor een wissel in de eventlijst | `endurance_telemetry_events` levert in een normaal racevenster `lap_completed`; wisselmomenten komen uit de **planning** (`actual_start_at`). |
| Checklist voor teamstappen | Geen tabel, geen workflow | Niets. Spec noemt dit optioneel. |

Wat **wel** in het contract zit maar nog niet in de frontendtype of UI staat —
dus bouwbaar zonder backendwerk: `session.sessionState`, `session.primaryFlag`,
`flagColour`, `flagSeverity`, `pitLaneOpen`, `isStartSequence`
(`TelemetryContractsV3.cs:96-111`). Alleen `pitLaneOpen` en de flagnetelheid
ontbreken volledig in `V3Normalized` (`pitwallHelpers.ts:56-63`); die moeten eerst
aan het type worden toegevoegd voordat de UI ze kan lezen.

---

## 4. De grootste gaten, in volgorde

### 1. De pitwall liegt over actualiteit (E04, E58-E60, E119)

De spec noemt dit de kern van het ontwerp: *"de interface doet nooit alsof
ontbrekende of verouderde data live is"*. Nu:

- `StandingsWidget.tsx:57-59` rendert **altijd** een groene stip met "Live", ook
  bij een dode feed. Dat is een onwaarheid in het hoofdonderdeel van de pagina.
- Er is geen update-leeftijd, geen amber-stale toestand en geen "ended"-toestand,
  terwijl `received_at`, `sessionState` en de stale-drempel van de rekenkern
  (`strategy/advise.ts:20`) allemaal beschikbaar zijn.
- Panelen die oude waarden tonen (`PaceGraph`, `FuelPanel`, `VehicleTelemetryPanel`)
  krijgen geen `live`-prop of negeren hem.

Dit is één samenhangende verbouwing: één `ConnectionState`-bron, een leeftijd in
de header, en elk paneel dat zijn eigen toestand kent.

### 2. De rijderswissel-strook is half (E47-E51, E110)

De spec vraagt vier onderscheiden dingen: huidige coureur, volgende coureur,
stinttimer en swap-ETA. Er zijn er twee. De stinttimer ontbreekt volledig, de
swap-ETA ook, en de coureur heeft niet eens een rugnummer omdat
`PitwallTab.tsx:294` `ownCarNumber={null}` meegeeft terwijl `team.car_number` in
de RPC zit. Alle benodigde bronnen bestaan (sessieklok, `stint_elapsed_s`,
`original_start_at`), dus dit is werk zonder backend.

### 3. Er is geen delta, en de enige die er is, is niet onderbouwd (E01, E17, E39, E94)

De spec zet delta op P0 in de KPI-strip en in de tower. Er is geen delta-kolom,
geen delta-cel en geen vastgelegde projectdefinitie. De enige Δ in de code
(`PacePanel.tsx:50-54`) vergelijkt met een doel dat permanent `null` is, en kleurt
groen bij negatief zonder dat ergens vastligt dat negatief "sneller" betekent.
Bovendien wordt `pace_targets` uit de RPC nooit gelezen, dus de data die een
doel-delta mogelijk maakt, ligt al klaar en wordt weggegooid.

Daarna, in deze volgorde: rolviews (E66 — één pagina voor iedereen, terwijl de
spec drie density's vraagt), de compositie links/rechts met vaste KPI-strip
(E08, E22, E69-E71), en de visuele tokens (E74, E77).

---

## 5. Kleinere afwijkingen (geen eigen plan nodig, wel afvinken)

- `PitwallTab.tsx:265` zegt "sticky in focus mode" maar `TopRaceBar` zet geen
  `sticky`-class; de comment beschrijft gedrag dat niet bestaat.
- `extractRaceClock` geeft `null` zodra de resttijd 0 is (`pitwallHelpers.ts:291`),
  dus in de laatste seconde voor de finish verdwijnt de klok.
- `PacePanel.tsx:21` noemt het gemiddelde over **alle** timeline-rondes "Stint";
  dat is een sessiegemiddelde, niet het stintgemiddelde.
- `StintDriverPanel.tsx:20` toont `current_stint_valid_sample_count` als
  "N ronden"; dat is het aantal geldige brandstofsamples, niet het aantal rondes.
- `StandingsWidget.tsx:145` toont óf teamnaam óf coureurnaam (`rowLabel`,
  regel 16-18), terwijl de spec "driver / team" vraagt.
- De klasseheader noemt "auto's" ook als er één auto in de klasse zit (regel 137).
- `RaceTelemetryStrip.tsx:18-20` labelt "S1/S2/S3" zonder te zeggen of het de
  laatste of de lopende sector is; de spec eist dat onderscheid expliciet.
- `AlertZone.tsx:12` verdwijnt volledig bij een lege lijst; de offline-melding
  hangt aan `usePitwallData.ts:168` en dus aan `isLive`, niet aan een echte
  foutstatus.

## 6. Wat dit rapport niet doet

- Geen visuele beoordeling: er zijn geen screenshots gemaakt of vergeleken, dus
  uitspraken over dichtheid en hiërarchie gaan over de DOM-klassen, niet over het
  beeld op een echt scherm.
- Geen productiedata: alle uitspraken over wat de feed levert komen uit het
  contract en de connector, niet uit een live `get_pitwall_data`-aanroep.
- Geen oordeel over de rekenkern zelf (`strategy/*`): die is getest
  (`strategy.test.ts`, `snapshot.test.ts`, `tyreWear.test.ts`, `rotation*.test.ts`)
  en valt buiten deze vergelijking, behalve waar hij niet is aangesloten.
