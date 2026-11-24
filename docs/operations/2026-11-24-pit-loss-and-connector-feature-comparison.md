# Pit loss en connectorfuncties — vergelijking met Lovely (24 november 2026)

Besluit Vincent: pitverlies-leren overnemen als grote upgrade, en de overige
functies van dezelfde plugin vergelijken met wat wij al hebben. Dit document
legt vast **hoe zij het doen**, **wat wij al doen**, en **wat wij overnemen**.

## Bron en grens

- Bestudeerd artefact: `LovelySimRacing.Plugin.dll`, plugin v4.2.0.0, publiek
  artefact bij release v5.2.0 op GitHub.
  SHA-256 `e8a7e28be79ee3fd72211ac7501c520f8b811e66026b315d3fcda54dd9da0b05`,
  .NET Framework 4.8, niet geobfusceerd.
- De repository bevat alleen documentatie; de plugin is een gesloten binary en
  er is **geen licentiebestand**. Er is dus niets overgenomen: alleen de
  methode is gelezen en hier beschreven. Geen code, geen constanten-tabellen en
  geen assets uit hun distributie.
- Hun client is een SimHub-plugin met dashboards. Onze pitwall is server-side
  (Supabase + web). Een functie "overzetten" betekent bij ons altijd: eigen
  implementatie op onze eigen datastroom.

## Hoe hun pitverlies werkt (`PitLossLearner`)

1. **Bezoekdetectie** per auto uit `IsInPitLane` plus baanpositie (0–1) per
   tick. Buiten → binnen is de entry (tijd + positie). Is de overgang ouder dan
   2 s sinds de vorige tick, of verspringt de positie meer dan 0,02, dan is het
   bezoek "jumped" (tow/teleport) en wordt het verworpen.
2. **Stilstaantijd** = tijd met snelheid < 2 km/h tijdens het bezoek (pitbox).
3. **Pitpunten per circuit leren**: entry- en exitpositie van de laatste 50
   bezoeken, circulair mediaan (wraparound), pas vanaf 3 metingen bruikbaar.
   Tolerantie 0,01 rond de geleerde punten.
4. **Stretch**: tijdens groene ronden wordt elke 1/200 van de ronde een
   tijdstempel gezet. Bij het passeren van de geleerde exit wordt teruggekeken
   naar de entry-passage; dat verschil is de rijtijd over het pitsegment op
   racetempo. Mediaan van ≥ 3 metingen.
5. **Formule**
   - stop met stilstaan: verlies = mediaan(lane time) − stretch;
   - drive-through: verlies = mediaan(lane time) − stretch;
   - zonder drive-through-metingen: mediaan(lane − still) − 3,0 s − stretch
     (3,0 s = vaste box-overhead).
6. **Poorten per bezoek**: lane time 3–300 s; stilstaan ≤ 180 s; niet
   gesprongen; entry/exit binnen 0,01 van de geleerde punten; beweegtijd door
   de pitstraat ≤ 1,3× de gebruikelijke beweegtijd. Vrije training wordt bewaard
   maar niet in de race-mediaan gebruikt.
7. **Aggregatie**: per circuit en autoklasse, rolling window van 50, mediaan,
   afgerond op 3 decimalen, minimaal 3 samples; opgeslagen in een lokale store.
8. **Delen**: betalende leden uploaden batches van maximaal 100 samples
   (minstens 65 s ertussen) en halen per sim+circuit+klasse elk uur een
   geaggregeerde waarde op;die waarde dient als extra bron naast eigen metingen.

## Wat wij daarmee doen

De formule is de kern: **pitverlies = pitstraattijd + stilstaan − stretch**.
De stretch is wat wij nog misten; "lane time minus gemiddelde rondetijd" is
structureel te grof omdat het stuk pitstraat-afstand per circuit verschilt.

Wat wij al binnenkrijgen (productie, 18–24 november): `pit_in` 69×,
`pit_out` 50×, `pit_service_completed` 46× met tijdstempels, plus snelheid en
rondetijden. Ons leerschema heeft `pit_loss` al als modelsoort.

Wat ontbreekt: **baanpositie per tick**. Het V3-frame bevat geen
`LapDistPct`, dus stretch is nu niet te berekenen.

### Connectorblok voor 0.7.6.6 (additief, per pitbezoek)

- `entryLapDistPct`, `exitLapDistPct` (0–1, 5 decimalen)
- `laneSeconds` (entry → exit)
- `standingSeconds` (snelheid < 2 km/h binnen de pitstraat)
- `stretchSeconds` (tijd entry → exit op de laatste groene ronde, op het
  toestel berekend; leeg als er geen groene ronde over dat segment is)
- `jumped` (tow/teleport gedetecteerd, zie detectieregel hierboven)
- `sessionType` (race / practice / qualifying)

Zonder stretch mag het blok toch mee: lane time en stilstaan zijn dan al
bruikbaar, het verlies blijft dan leeg in plaats van geraden.

### Serverkant

- Observatie per stop uit het blok; verwerp met dezelfde poorten als hierboven.
- Leer per rijder/auto/circuit (persoonlijk, geen pooling) met mediaan en
  minimum 3 samples; circuitbrede mediaan alleen als eigen waarde ontbreekt.
- Pitverlies en pitwindow in de pitwall; nooit een getal tonen zonder bron
  (persoonlijk / circuit / onbekend).

## Overige functies — wie doet wat

- **Brandstof per ronde.** Zij: rolling gemiddelde van de laatste 5 schone,
  opeenvolgende ronden, sleutel `game|track|car|sessionType`, refuel-detectie
  via brandstoftoename > 0,01, publicatie pas bij precies 5 ronden. Wij: echte
  regressie plus voorspelling-vóór-uitkomst en modelfit. Wij staan verder in het
  model; hun **hygiëne** is strakker: sessiesoort zit in de sleutel,
  opeenvolgende ronden zijn vereist en een refuel maakt de ronde ongeldig.
  Overnemen: sessiesoort in de context van het brandstofmodel.
- **Pitverlies.** Zij hebben het volledig; wij alleen tijdstempels. Overnemen.
- **Bandenslijtage.** Zij modelleren niets (dashboards tonen SimHub-waarden).
  Wij hebben wear-observaties, intervals en een gereserveerde modelsoort. Wij
  staan voor.
- **Natheidstrend.** Zij houden een trend met 5 minuten hysteresis op
  baannatheid. Wij loggen weer maar tonen geen trend. Overnemen als
  server-side indicator (geen connectorwijziging).
- **Sectorvoortgang.** Zij leren de sectorgrenzen per circuit als baanpositie
  en interpoleren de voortgang binnen de sector voor de weergave. Wij hebben
  sectortijden en tegenstanderretentie, maar geen geleerde grenzen. Kleine
  overname voor de pitwallweergave.
- **Teamtelemetrie (TeamLINQ).** Zij delen realtime telemetrie tussen leden met
  playback en 10 s reconnect. Wij doen dat server-side met team-pitwall en
  kijklinken. Vergelijkbaar; geen actie.
- **Circuitdata.** Zij halen per circuit een databestand op (segmenten,
  bochten, naam) met retries en cachen dat. Wij hebben track-intelligence.
  Geen actie.
- **iRating/SOF.** Zij schatten met de standaard Elo-formule (1600/ln2). Wij
  slaan resultaten op; geen estimator. Lage prioriteit.

## Prioriteit

1. **P1 — pitverlies**: connectorblok in 0.7.6.6, serverleren, pitwallweergave.
2. **P2 — brandstofhygiëne**: sessiesoort in de context, opeenvolgende ronden
   als eis, refuel blijft verwerpen.
3. **P3 — natheidstrend** in de pitwall (server-side).
4. **P4 — geleerde sectorgrenzen** voor de voortgangsweergave.

Bewust **niet** overgenomen: hun upload/crowd-sourcing van pitdata (wij houden
het persoonlijk; `pooling_enabled` blijft false) en hun 5-rondengemiddelde
(ons model is beter).
