# Pitwall: datagaten en veilige uitbreiding

## Afbakening en bewijs

Analyse uitgevoerd vóór functionele wijzigingen, op startcommit `24fd812`, branch
`feat/pitwall-look-3sm`. Werkboom was schoon. Lokale `main`: `b1d458a`.
Geen fetch, push, merge, deploy of productiequery. Dit is bronbewijs, geen bewijs
dat een aangesloten apparaat ieder optioneel kanaal daadwerkelijk levert.
Doelbeeld: de onderdelen beschreven in `ontwerpvergelijking.txt` (7–16).

Categorieën: 1 = al beschikbaar; 2 = zonder plugin-release; 3 = plugin-release;
4 = niet beschikbaar / niet geverifieerd. “Nee” betekent niet aangetoond in
het bestaande pad, niet dat iRacing het principieel onmogelijk maakt.

## Bronnen

- A: `tools/simhub-plugin/3SM.EnduranceConnector/EnduranceConnectorPlugin.cs:1773–1825`:
  `CaptureTyres`, bestaande capture van compound, settellers en temperatuur.
  Identiek aan lokale main: SHA-256
  `d74c9809d67cd8f1a7587e1943cc44f599838cd800f2237bce80a44793dd94b3`.
- B: `supabase/functions/_shared/tyreTelemetry.ts:37–69,169–180,237–250`:
  genormaliseerde typen, validatie en sentinel 255 = onbeperkt.
- C: `supabase/functions/_shared/simhub.ts:617–619`,
  `supabase/functions/_shared/simhubAggregates.ts` (`snapshotDto`),
  `supabase/functions/simhub-ingest-v3/index.ts:133`: optionele blokken worden
  genormaliseerd en blijven in de opgeslagen snapshot; alleen meetseries gaan eruit.
- D: `supabase/migrations/20261027210000_endurance_pitwall_team_scope.sql`
  (`get_pitwall_data`, `v3_normalized`, `timeline`, `planned_stints`),
  `src/features/endurance/pitwall/usePitwallData.ts` en
  `src/pages/PitwallDeviceTestPage.tsx:150–151`: beide frontendpaden lezen V3.
- E: `src/features/endurance/pitwall/RaceTelemetryStrip.tsx:44–59` en
  plugin `EnduranceConnectorPlugin.cs:1693–1695`: eigen sectoren komen uit
  SimHub-properties `Sector1LastLapTime`, `Sector2LastLapTime`,
  `Sector3LastLapTime` onder de daar gebruikte prefix; dit zijn GEEN
  rechtstreeks geverifieerde iRacing-SDK-kanaalnamen.
- F: `src/features/endurance/pitwall/pitwallHelpers.ts` (`V3Opponent`,
  `PitwallTimelineEvent`, `PitwallPlannedStint`, `PitwallStrategyRow`),
  `standings.ts`, `StandingsWidget.tsx`, `PacePanel.tsx`, `PaceGraph.tsx`.
- G: `supabase/migrations/20260910210000_endurance_member_beta.sql:292–335,1421–1453`:
  `actual_start_at`/`actual_end_at` worden óók vanuit planning/verschuiven geschreven.
  `current_stint_valid_sample_count` telt samples, geen werkelijk gereden ronden.
- H: `supabase/functions/_shared/weatherTelemetry.ts:22–28,50–62` en
  `simhubExtensions.ts` (`SimHubEnvironment`, `parseEnvironment`): weercontracten
  bestaan, maar de huidige plugin bevat geen capture voor regen/vocht/luchtdruk.
- I: `src/features/endurance/pitwall/strategy/pitStops.ts` en
  `supabase/migrations/20261025122000_endurance_pit_loss.sql`: gemeten eigen
  pitlanetijd/stopgeschiedenis; geen complete geschiedenis voor alle tegenstanders.

## Gap-analyse — vóór bouwen

| Doelbeeld / gegeven | Hebben we het? Bron | Kan het? | Risico / besluit |
| --- | --- | --- | --- |
| Eigen bandencompound-ID | Ja, `tyres.compoundId`; `PlayerTireCompound` (A:1809, B, C, D), alleen speler | 1 | Alleen frontend: toon ID, geen verzonnen M/S/H-naam |
| Compoundnaam M en compound van rivalen | Nee; ID is geen geverifieerde naam en `V3Opponent` heeft dit niet (F) | 4, niet geverifieerd | SDK-naam/mapping niet bewezen; niet bouwen |
| Gebruikte/beschikbare eigen bandensets | Ja, `tyres.sets.used/available`; `TireSetsUsed`, `TireSetsAvailable` (A:1776,1791; B–D), alleen speler | 1 | Alleen frontend; afzonderlijke tellers, 255 als onbeperkt, geen setnummer |
| Setnummer / resterende levensduur | Nee; gebruikte sets zijn geen identificatie van gemonteerde set; slijtage is restpercentage (B,F) | 4 | Geen levensduur of nummer verzinnen |
| Baan- en luchttemperatuur | Ja, `tyres.environment.trackTempC/airTempC`; `TrackTempCrew` met `TrackTemp` fallback en `AirTemp` (A:1800–1807, B–D), sessieomgeving | 1 | Alleen frontend; toon °C, offline verbergen |
| Rubber op baan | Ja, `tyres.environment.rubberState`; sessievariabele `SessionTrackRubberState` in plugin:1832–1838 | 1 | Alleen frontend, vrije brontekst niet vertalen naar droog/nat |
| Droog/nat, regen, luchtdruk | Deels: nullable `weather.trackWetnessPct/isRaining/rainPct/airPressureHpa` en environment-contract, geen plugincapture (H) | 4, exacte SDK-kanalen niet geverifieerd | Contract is geen meting; niet als beschikbaar verkopen |
| Windsnelheid en -richting | Nee, geen bewezen capture of contract | 4, niet geverifieerd | Geen kanaalnamen of windwaarden verzinnen |
| Eigen S1/S2/S3 | Ja, `vehicle.sector1Seconds/sector2Seconds/sector3Seconds`, reeds getoond (E) | 1, al gebouwd | Geen wijziging; laatste-ronde-properties, geen bewezen live-sectorvergelijking |
| S1/S2/S3 van alle tegenstanders | Nee, `V3Opponent` bevat slechts laatste/beste ronde (F) | 4, niet geverifieerd | Geen exact SDK-kanaal bewezen; niet bouwen |
| Sectorverbetering / bovenste delta | Deels: eigen laatste/beste ronde beschikbaar, geen vergelijkbare historische sectorbasis (E,F) | 2 voor rondeverschil, 4 voor sectorverbetering | Niet gebouwd: nieuwe afleiding met beperkte waarde, geen advieswijziging toegestaan |
| Pitstopaantallen | Deels: eigen gemeten stops (I); geen volledige rivalenhistorie (F) | 2 voor aantal opgeslagen eigen stops; 4 voor volledige wedstrijdteller | Niet gebouwd: opgeslagen/begrensde historie bewijst geen compleet wedstrijdtotaal |
| Historische pacelijn leider | Nee; snapshot laatste/beste is geen historische reeks (F) | 4 | Nieuwe opslag nodig; niet fabriceren |
| Positie-/klasse-noemers, totale raceronden/-duur | Deels: positie, eigen voltooide ronden en resttijd, geen volledige startlijst/racetotalen (E,F) | 4 voor volledige noemers | Snapshot is begrensd; resttijd blijft resttijd |
| Circuitlengte, bochten, sectorlegenda | Nee in aangesloten pitwallpad; kaart/projectie is geen bewezen bron voor deze metadata (`LiveTrackPanel.tsx`, `TrackProjection.tsx`) | 4, niet geverifieerd | Geen statische ontwerpwaarden als live data tonen |
| Werkelijke stinttijd / stintpercentage / wissel over minuten | Deels: planningsdatums en nullable `timeline.stint_elapsed_s` (D,F,G) | 4 voor bewezen actuele werkelijke stint; 2 voor expliciete planningstijd | Niet gebouwd: planning is geen waarneming; geen bewezen actuele stintankerbron |
| Bevestigde wisselchecklist | Nee; alleen `tyre_change`-planning (F, `StintDriverPanel.tsx`) | 4 | Geen checkmarks of bevestigingen verzinnen |
| Brandstof-pitwindow / meerdere stints | Deels: bestaande strategie, planning en brandstofvelden (F, `FuelPanel.tsx`) | 1 voor bestaande presentatie; extra afleiding buiten scope | Adviespad en bestaande poorten ongewijzigd |

## Veilige bouwselectie

Alleen categorie 1: compound-ID, bandensettellers, baan-/luchttemperatuur en
rubberconditie toevoegen aan de bestaande gedeelde componenten. Bestaande eigen
sectoren laten staan. Frontendtypes hergebruiken de bestaande servertypen; geen
contract-, ingest-, plugin-, RPC-, database- of advieswijziging.
Ontbrekende waarden blijven afwezig; 0 is geldig, NaN/Infinity ongeldig.
Eigen bandenvelden buiten de auto of offline niet als actueel tonen.
Geen categorie-2-afleiding heeft hier een voldoende bewezen actuele basis of
voldoende waarde om zonder betekenisrisico toe te voegen.

## Aparte lijst: plugin-release nodig (categorie 3)

Geen onvoorwaardelijk geverifieerde categorie-3-items in de onderzochte code.
Voor compound-ID, settellers, temperatuur en eigen sectoren is GEEN nieuwe
plugin-release nodig. Beschikbaarheid blijft afhankelijk van auto/sessie/feed.

Kandidaten voor later, nadrukkelijk categorie 4 en GEEN releasebelofte:

| Wens | Exact kanaal | Alle autos? | Werk |
| --- | --- | --- | --- |
| Regen, vocht, luchtdruk en wind | Niet geverifieerd | Niet geverifieerd; sessieomgeving gewenst | Eerst SDK-lijst en echte feed bewijzen; daarna capture, eenheden/nullsemantiek, contracttests, canary; omvang nog niet betrouwbaar |
| Rivalensectoren/compound | Niet geverifieerd | Niet geverifieerd | Eerst beschikbaarheid per auto bewijzen, daarna eventueel opponentcontract/ingest/UI; geen verantwoorde schatting vóór bewijs |

Er is bewust geen extern SDK-kanaal uit geheugen benoemd. Geen releasewerk
uitgevoerd. Verdere kanaalverificatie en elke pluginwijziging vragen een nieuwe go.
