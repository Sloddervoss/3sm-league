# Volledige elementeninventaris — origineel en uitvoer

Start: bfcc387a4e65e563778b360f4f8d99384f96b28b, schone werkboom op feat/pitwall-look-3sm. Lokale main b1d458a965315921567690c451fb1cf4f6c0fa21. Opdracht is voortbouwen op deze branch; niet pushen/mergen/deployen.

Origineel opnieuw volledig bekeken met vision_analyze vóór implementatie: /home/hermes/.hermes/cache/documents/native-inputs/6d0780991ab3ed1b8bd157bc983bf5be05c89ecf24c80110d095ea9624d66c2f/img_26a32595ab73.png. Voorbeeldgetallen zijn géén bronnen. Elke herhaalde timingrij/hoek valt onder dezelfde veldregel; alle kolommen en decoraties zijn hieronder opgenomen. Onleesbare mini-iconen expliciet apart.

Hebben wij = toestand vóór deze ronde. Categorie 1 = bouwen/behouden, 2 = bestaande bron aansluiten, 3 = bewezen nieuw pluginkanaal nodig, 4 = geen bron/niet geverifieerd. Categorie 4 betekent niet principieel onmogelijk. Geen categorie 3: er is geen exact aanvullend kanaal aangetoond.

## Bronregister

- A: `src/features/endurance/pitwall/RaceTelemetryStrip.tsx; pitwallHelpers.ts — V3Normalized.timing/position/session/vehicle`
- B: `tools/simhub-plugin/3SM.EnduranceConnector/EnduranceConnectorPlugin.cs — CaptureVehicle/CaptureTyres/ReadRubberState; supabase/functions/_shared/tyreTelemetry.ts`
- C: `src/features/endurance/pitwall/LiveTrackPanel.tsx; TrackProjection.tsx; src/lib/pitwallTrackGeometry.ts; public/tracks/projections/*.json`
- D: `src/features/endurance/pitwall/StandingsWidget.tsx; standings.ts; pitwallHelpers.ts — V3Opponent`
- E: `src/features/endurance/pitwall/PacePanel.tsx; PaceGraph.tsx; pitwallHelpers.ts — PitwallPaceData; V3Normalized.vehicle.speedKph`
- F: `src/features/endurance/pitwall/StintDriverPanel.tsx; pitwallHelpers.ts — PitwallPlannedStint; supabase/migrations/20260910210000_endurance_member_beta.sql — actual_start_at/actual_end_at zijn ook planning`
- G: `src/features/endurance/pitwall/FuelPanel.tsx; strategy/types.ts — Advice.window (earliestLap/latestLap), PitwallStrategyRow; PitwallPlannedStint`
- H: `src/features/endurance/pitwall/VehicleTelemetryPanel.tsx; TyreAdviceLine.tsx; TyreModelPanel.tsx; strategy/tyreEstimateV2.ts — rangeLaps, usable, basis.band, bandExperimenteel`
- I: `supabase/functions/_shared/weatherTelemetry.ts — WeatherTelemetry; simhubExtensions.ts — SimHubEnvironment; simhub.ts — root.weather/root.environment normalisatie`
- J: `src/features/endurance/pitwall/pitwallHelpers.ts — PitwallTimelineEvent; usePitwallData.ts — timeline; strategy/pitStops.ts — begrensde eigen metingen`
- K: `src/lib/iracingTracks.ts; src/features/endurance/core/enduranceTracks.ts; src/integrations/supabase/types.ts — geen bewezen lengte/bochten in deze bronnen`

## Inventaris vóór bouwen

| Plek | Element | Hebben wij | Categorie | Bron/veld en besluit |
|---|---|---|---|---|
| Bovenbalk | S1/S2/S3, seconden | Ja | 1 | A: vehicle.sector1Seconds/sector2Seconds/sector3Seconds; behouden |
| Bovenbalk | Laatste ronde, m:ss.mmm | Ja | 1 | A: timing.lastLapTimeSeconds; behouden |
| Bovenbalk | Beste ronde, groene waarde | Ja | 1 | A: timing.bestLapTimeSeconds; behouden |
| Bovenbalk | POS/P en CLASS POS/K | Ja | 1 | A: position.position/classPosition; behouden |
| Bovenbalk | LAP, teller voltooide ronden | Ja | 1 | A: timing.completedLaps; behouden |
| Bovenbalk | Resterende tijd, klok | Ja | 1 | A: session.sessionTimeRemainingSeconds; behouden |
| Bovenbalk | DELTA, teken, rood/groen en richtingicoon | Nee | 1 | A: laatste minus beste, expliciet referentielabel; geen live rondedelta |
| Bovenbalk | Kleine verschillen onder S1/S2/S3 | Nee | 4 | A: geen historische sectorreferentie; exact kanaal niet geverifieerd |
| Bovenbalk | Klein verschil onder LAST LAP | Nee | 1 | A: zelfde laatste-minus-beste, één keer tonen om duplicatie te vermijden |
| Bovenbalk | RACE TIME verstreken klok | Nee | 2 | A: session.sessionTimeSeconds, sessietijd sinds start; geen wall-clock of geplande duur |
| Bovenbalk | Noemer /28 algemeen | Nee | 4 | A,D: begrensde snapshot/resttijd bewijst geen totaal; SDK-kanaal niet geverifieerd |
| Bovenbalk | Noemer /14 klasse | Nee | 4 | A,D: begrensde snapshot/resttijd bewijst geen totaal; SDK-kanaal niet geverifieerd |
| Bovenbalk | Raceduur /6h | Nee | 4 | A,D: begrensde snapshot/resttijd bewijst geen totaal; SDK-kanaal niet geverifieerd |
| Bovenbalk | Totale ronden /360 | Nee | 4 | A,D: begrensde snapshot/resttijd bewijst geen totaal; SDK-kanaal niet geverifieerd |
| Circuit | Circuitnaam en configuratie | Ja | 1 | C: identity.trackName/trackConfig en fallbackTrack |
| Circuit | Luchttemperatuur °C met weericoon | Deels | 1 | B: tyres.environment.airTempC; icoon als temperatuur, geen onbewolktheid suggereren |
| Circuit | Dry/nat label en druppelicoon | Nee | 2 | I: weather.trackWetnessPct of environment.trackWetnessPct; alleen 0 expliciet droog, >0 vochtpercentage; isRaining is niet hetzelfde |
| Circuit | Windicoon, 2.1 m/s | Nee | 4 | I: geen windveld/capture; exact SDK-kanaal niet geverifieerd |
| Circuit | Weer wolk/zon toestand | Nee | 4 | I: geen bewezen bewolkingsstatus; icoon mag geen toestand verzinnen |
| Circuit | Baanlijn, achtergrond en richtingpijlen | Deels | 1 | C: bestaande kaart/projectie behouden; decoratieve achtergrond is geen telemetrie |
| Circuit | Automarkers, nummers, eigen oranje selectie | Ja | 1 | C,D: opponents[].lapDistancePct/carNumber/isPlayer/inPit |
| Circuit | Noordkompas N/pijl | Nee | 4 | C: kaartoriëntatie is geen bewezen geografisch noorden; niet faken |
| Circuit | LENGTH, km | Nee | 4 | K: geen bewezen configuratiegebonden lengte; niet uit pixelgeometrie afleiden |
| Circuit | TURNS, bochtenteller | Nee | 4 | K: geen bewezen metadata; niet uit bestandsnaam of bochtige polyline raden |
| Circuit | SECTORS: gekleurde streepjes S1/S2/S3 | Nee | 1 | A,C: legenda van eigen tijdvelden; sectorgrenzen op de kaart niet bekend, dus geen segmentkleuring claimen |
| Circuit | Gekleurde sectorsegmenten op baan | Deels | 4 | C: geen bewezen sectorgrenzen; originele segmentkleuren zelf inconsistent |
| Geselecteerde auto | SELECTED DRIVER, coureur en team | Ja | 1 | A: OwnCarPanel driverName/teamName |
| Geselecteerde auto | Oranje rand/selectiestrook | Ja | 1 | A: OwnCarPanel presentatie |
| Geselecteerde auto | Autotype/-icoon | Ja | 1 | A: OwnCarPanel carName |
| Geselecteerde auto | LAST LAP/BEST LAP | Ja | 1 | A: OwnCarPanel lastLapSeconds/bestLapSeconds |
| Geselecteerde auto | CAR nummerbadge en LAP | Deels | 2 | D,A: eigen opponent isPlayer.carNumber; timing.completedLaps; ook testmodus geselecteerde autostrook tonen |
| Geselecteerde auto | Mini donkerblauw teken | Nee | 4 | C: functie niet leesbaar in origineel; niet geverifieerd |
| Timing | LIVE TIMING actieve tab + icoon | Deels | 1 | D,F,J: bestaande timing als echte startweergave |
| Timing | CLASS tab | Nee | 1 | D,F,J: filter per aanwezige carClass; aantallen uitsluitend in beeld |
| Timing | STINTS tab | Nee | 2 | D,F,J: planned_stints; expliciet planning, geen rivalenstints |
| Timing | PIT STOPS tab | Nee | 2 | D,F,J: timeline pit_entry/pit_exit: opgeslagen eigen gebeurtenissen, geen compleet wedstrijdtotaal |
| Timing | EVENTS tab | Nee | 2 | D,F,J: timeline event_type/captured_at/completed_laps; alleen als inhoud bestaat |
| Timing | P/#, klassepositie en carnummer | Ja | 1 | D: position/classPosition/carNumber |
| Timing | CLASS badge en groepsbalken | Ja | 1 | D: carClass + aantal in beeld |
| Timing | DRIVER en team/subregel | Ja | 1 | D: driverName/teamName |
| Timing | LAST LAP/BEST LAP | Ja | 1 | D: lastLapSeconds/bestLapSeconds |
| Timing | Eigen oranje rij, nummeraccent/selectiepijl | Ja | 1 | D: isPlayer |
| Timing | GAP met eerlijke referentie | Ja | 1 | D: gapToPlayerSeconds; niet origineel leiderlabel |
| Timing | PIT status | Ja | 1 | D: inPit, niet stopaantal |
| Timing | S1/S2/S3 alle auto’s | Nee | 4 | D: V3Opponent bevat geen sectoren; exact SDK-kanaal niet geverifieerd |
| Timing | PIT stopaantal alle auto’s | Nee | 4 | D: inPit is status, geen teller; geen volledige historie |
| Timing | DELTA alle auto’s | Nee | 4 | D: referentie in origineel niet benoemd; geen vergelijkingsbasis verzinnen |
| Timing | Sorteerdriehoekjes bij GAP | Nee | 4 | D: geen bestaande sorteerfunctie; onleesbare status niet als bediening kopiëren |
| Timing | Subtiele boog eerste rij | Nee | 4 | D: functie niet leesbaar, niet geverifieerd |
| Pace | Titel en telemetrie/auto-icoon | Deels | 1 | E,A: presentatie zonder nieuwe data |
| Pace | LAP TIME tab | Deels | 1 | E,A: points[].lap/seconds, eigen gemeten rondes |
| Pace | SPEED tab en km/h | Nee | 2 | E,A: vehicle.speedKph: actuele snelheid, geen historische lijn |
| Pace | DELTA tab | Nee | 1 | E,A: timing laatste/beste bewezen referentie, geen leiderdelta |
| Pace | Oranje eigen lijn en legenda | Deels | 1 | E,A: PaceGraph points[].seconds |
| Pace | Groene leiderlijn en legenda | Nee | 4 | E,A: geen historische leiderreeks |
| Pace | X-as rondegetallen en Y-as seconden | Deels | 1 | E,A: PaceGraph points[].lap/seconds; huidige schaal behouden |
| Pace | Raster en meetpuntcirkels | Ja | 1 | E,A: bestaande PaceGraph SVG |
| Pace | Verticale pit/wissel-stippellijn | Ja | 1 | E,A: points[].marker pit/swap; niet fictieve r140-referentie |
| Rotatie | Titel/rotatie-icoon | Deels | 1 | F: bestaande driverpanelpresentatie |
| Rotatie | CURRENT DRIVER naam/badge | Deels | 1 | F: driverName, eigen carNumber niet identificeren als drivernummer |
| Rotatie | GT3 en gereden stintlaps | Nee | 4 | F: current_stint_valid_sample_count zijn samples, geen ronden |
| Rotatie | STINT TIME werkelijke duur | Nee | 4 | F: geen bewezen werkelijk stintanker; actual_start_at ook planning |
| Rotatie | Oranje voortgangsbalk en % | Nee | 2 | F: uitsluitend geplande tijdvoortgang op start/eind, expliciet planning |
| Rotatie | NEXT DRIVER naam | Ja | 1 | F: planned_stints driver_id via displayName |
| Rotatie | Next stint / geplande rondes | Ja | 1 | F: expected_laps |
| Rotatie | NEXT SWAP aftellen | Nee | 2 | F: geplande wissel op planningseinde, geen gegarandeerde wissel |
| Rotatie | SWAP CHECKLIST titel en drie vinkvakjes | Nee | 4 | F: geen confirmationvelden; tyre_change is planning, geen bevestiging |
| Brandstof | Titel en brandstofpompicoon | Deels | 1 | G,F: presentatie |
| Brandstof | FUEL REMAINING L | Ja | 1 | G,F: current_fuel_litres |
| Brandstof | ~ ronden bereik | Ja | 1 | G,F: fuel_laps_remaining |
| Brandstof | AVG CONSUMPTION L/lap | Ja | 1 | G,F: fuel_per_lap_litres/race_fuel_per_lap_litres |
| Brandstof | Groen verbruikverschil -0.2 | Nee | 1 | G,F: stintverbruik minus racegemiddelde, expliciete basis L/ronde |
| Brandstof | PIT WINDOW rondebereik | Deels | 2 | G,F: bestaand advice.window; alleen doorgeven, geen herberekening |
| Brandstof | Pitwindowbalk en percentage | Nee | 2 | G,F: balk met huidige ronde en earliest/latest, geen fictief 68% |
| Brandstof | STINT PLAN huidige en volgende regels | Deels | 2 | G,F: planned_stints expected_laps/status; volledige lijst intern scrollbaar |
| Brandstof | Huidige stint 68% gereden afstand | Nee | 4 | G,F: geen bewezen start-rondeteller; gepland tijdpercentage staat bij rotatie |
| Banden | Titel/bandicoon | Deels | 1 | H,B: presentatie |
| Banden | Vier hoeken FRONT LEFT/RIGHT REAR LEFT/RIGHT | Ja | 1 | H,B: vehicle.frontLeft/frontRight/rearLeft/rearRight, LV/RV/LA/RA |
| Banden | Temperatuur en °C/°F, Temp label | Ja | 1 | H,B: temperature/temperatureUnit |
| Banden | Wear percentage | Ja | 1 | H,B: wearPercent is resterend, geen versleten percentage |
| Banden | Groene restbalk per hoek | Nee | 1 | H,B: zelfde wearPercent, 0–100; geen extra model |
| Banden | M compoundbadge/naam | Deels | 4 | H,B: compoundId aanwezig maar geen bewezen M/S/H mapping |
| Banden | Compound-ID en settellers | Ja | 1 | H,B: tyres.compoundId/sets.used/sets.available |
| Banden | Tyre set 3/8 als gemonteerde set | Deels | 4 | H,B: used/available geen identificatie huidige set |
| Banden | Estimated life rondes | Deels | 2 | H,B: bestaand modelbereik + bestaande experimenteel/no-advice markering; geen nieuwe schatting |
| Banden | Donkere mini-iconen naast balken | Nee | 4 | H,B: niet leesbaar/niet geverifieerd |

## Kanaalverificatie (geen namen uit geheugen)

- Eigen sectoren: CaptureVehicle gebruikt letterlijk DataCorePlugin.GameData.NewData.Sector1LastLapTime, Sector2LastLapTime, Sector3LastLapTime (prefix op regel 1678, velden 1693–1695). SimHub-properties, niet als SDK-kanalen verkopen; alleen speler.
- Snelheid: DataCorePlugin.GameData.NewData.SpeedKmh, via VehicleNumber en CaptureVehicle; alleen speler.
- Temperatuur: CaptureTyres leest TrackTempCrew, fallback TrackTemp, en AirTemp (1800–1807); sessieomgeving.
- Rubber: ReadRubberState leest SessionTrackRubberState uit sessie-YAML met SessionNum, geen telemetriekanaal; niet gelijk aan droog/nat.
- Compound/sets: PlayerTireCompound, TireSetsUsed, TireSetsAvailable (1776,1791,1809); alleen speler. Geen M-mapping.
- Verstreken sessietijd: SessionTelemetryReader.cs leest RawData.Telemetry.SessionTime; plugin zet V3 session.sessionTimeSeconds. Resttijd: ConnectorSettings.SessionTimeRemainingProperty = DataCorePlugin.GameData.NewData.SessionTimeRemain.
- Regen/vocht: normalisatiecontract bewezen (I), huidige CaptureTyres vult géén weather en géén vocht. UI kan bestaande optionele payloads lezen, maar er is geen bewijs van actuele levering door deze plugin. Geen pluginkanaalnaam geclaimd.
- Wind, rivalensectoren, sectorreferentie, deelnemersaantallen, circuitlengte/bochten: exact SDK-kanaal niet geverifieerd. Lokale bronnen gericht doorzocht; aanvullend pyirsdk irsdk.py opgehaald (https://raw.githubusercontent.com/kutu/pyirsdk/master/irsdk.py), daarin alleen TrackWetness-enum, geen bewijs voor de gevraagde kanaallijst. Blijft categorie 4.

## Bouwgrenzen

Alle categorie 1/2 worden behouden of aangesloten; tabs uitsluitend met inhoud en met de echte scope in de tekst. Geen wijziging aan adviesmotor, poorten, netwerk, opslag, rechten, plugin of database. Planning krijgt het woord gepland; geen werkelijke stinttimer claimen. Geen snapshotnoemers. Bandenmodel blijft experimenteel waar de bestaande bron dat zegt, en stuurt geen nieuw advies.
