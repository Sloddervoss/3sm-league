# PACE capture v1 — lokaal gebouwd, NIET uitgerold

Normatieve uitvoerbare contracten: `PaceCapture.cs` en `supabase/functions/_shared/paceCapture.ts`.
Protocol blijft 3. `paceCapture` is optioneel/nullable aan de root; legacy opponents blijven exact hetzelfde.
Malforme PACE wordt null zonder kerntelemetrie of measurement_ack te verliezen.

## Root en eenheden

- `schemaRevision`: 1; `observedSessionId`, `segmentId`: 1–64 tekens.
- `opponentMetrics`: maximaal 4 records op de draad; huidige producer stuurt er 1.
- `opponentLaps`: maximaal 20 in parser, producer herhaalt maximaal 4 per frame.
- `traceChunks`: maximaal 4 in parser, producer maximaal 1 met 32 punten.
- Maximaal 4096 UTF-8-bytes inclusief rootlidnaam; volledige POST maximaal 24000.

Metric: `id`, `observedSessionTimeSeconds`, nullable `lastLapSeconds`, `bestLapSeconds`,
`lastLapSectorSeconds`, `bestLapSectorSeconds`, `bestSectorSeconds`,
`bestLapDeltaToFieldBestSeconds`, `bestLapDeltaToPlayerSeconds`, `lapValid`,
`lapHighPrecision`, `trackPositionPercentRaw`, plus `sectorMismatchCount`. Additief/nullable: `sectorCount` (1–16),
`sectorLap` (afgeronde ronde), `sectorSource`, `sectorErrorSeconds`,
`bestSectorSource`, `bestSectorErrorSeconds`, `sectorDiagnostic`.
Bron is `measured`, `simhub` of null; afwijking is som minus gemelde rondetijd in seconden.

Last/best-sectorreeksen zijn alleen geldig als alle waarden positief/eindig zijn, het aantal
bij `sectorCount` past en hun som
maximaal 0,1 s van de bijbehorende rondetijd afwijkt. Anders de HELE reeks null.
Controle vindt onafhankelijk plaats in plugin, Edge en UI. De bronafwijkingsteller neemt toe
bij een nieuwe ongeldige broncombinatie/episode, niet bij iedere identieke tick.
BestSector-minima zijn aparte theoretische minima, geen opgetelde echte ronde.
Beste-rondedelta's zijn secondenverschillen van BESTE rondes en NOOIT de live DELTA-curve.
`lapValid=true` is geen bewijs van officiële rondegeldigheid (SimHub kan dit standaard invullen).

Een rondetijdrecord bevat `id`, `lap`, `seconds`, `observedSessionTimeSeconds`,
`quality=sampled`, `observationId`. Eerste waarneming is baseline. Bevestiging vereist
een waargenomen opeenvolgende rondewissel en een positieve gemelde laatste rondetijd.
De capture wacht 0,25 s op bronverversing, maximaal 2 s; waar de SDK `CarIdxLapCompleted`
levert moet die exact bij de afgeronde ronde horen. Rondetijdenhistorie vereist geen
volledige afstandscurve: een gemist intern afstandspunt mag de leiderlijn niet blokkeren.
Identieke rondetijden van twee verschillende ronden blijven aparte records. Geen backfill
voor ronden van vóór binnenkomst; geen afgeleide rondetijd uit huidige snelheid.

Chunk: `id`, `traceId`, `lap`, `chunkIndex`, `finalChunk`, `anchorSessionTimeMs`,
`anchorUncertaintyMs`, `lapSeconds`, `provenance=simhub-opponent-sampled`,
`speedUnit=km/h|null`, `points`.
Punten zijn `[bin, sessionTimeMs|null, speedDeciKph|null]`; bin 0–127, tijd 0–86400000,
snelheid 0–6000. Binvolgorde strikt stijgend; tijden monotoon. Ontbrekend is null, nul blijft nul.
`finalChunk=true` betekent alleen dat de producer de ronde heeft afgesloten, NIET dat de
server alle punten heeft ontvangen. Alleen de server schrijft `complete` en `conflict`.

## Acquisitie, geheugen en budget

Maximaal 40 identiteiten, 3 sporen × 128 afstandsbins en 20 rondetijden per auto.
Actuele, laatste en snelste volledig opgenomen ronde; geen groeiende ticklijsten.
Capture loopt vóór pairing/send-poorten, maximaal 20 Hz op de hoogste beschikbare bron-sessietijd, gelijke SDK-tick genegeerd.
Twee omliggende waarnemingen: maximaal 0,25 s én twee binintervallen; anders geen verbinding.
Pit, ontbrekende klok, tijd-terug, replay/offline, teleport en sessiewissel breken de capture.
Iedere nieuwe trace krijgt een eigen ID, ook bij een onderbreking binnen hetzelfde rondenummer.

Player-snelheid komt uit SpeedKmh. Rivalensnelheid alleen als de player in dezelfde update
Speed versus SpeedKmh bevestigt (>30 km/h, verschil <=max(5 km/h, 5%)); geen eenheidsconversiegok.
Dit bewijst NIET elke spel-/displayinstelling. Bron-onzekerheid wordt ontbrekende snelheid.

Core en meetbatch worden EERST opgebouwd, PACE alleen in de gemeten restruimte.
De concrete plugin-meetplanner krijgt ook 24000 als grens (zijn generieke default is 24576).
Niet-passende meetrijen blijven in de bestaande outbox; PACE verandert geen ACK of batchinhoud.
PACE zelf gebruikt geen duurzame outbox of ACK: begrensde stukken worden herhaald uit de lokale
buffers, prioriteit eigen/leider en daarnaast round-robin. Geen garantie op iedere ronde van alle
40 auto's. Geen garantie op compleetheid bij pakketverlies. Geen extra HTTP-requests.

Afwijking van het voorstel: puntarrays zijn managed nullable arrays, niet de voorgestelde
expliciete 16-byte-packed layout; het harde aantal is getest, geen claim over exact managed heap.
Er is geen extra wachtrij van 256 chunks nodig: nul bewaarde pending-chunks, alleen de begrensde
sporen en het huidige frame. Beide keuzes zijn bewust eenvoudiger en begrensd.

## Opslag, reads en autorisatie

Geen nieuwe tabel/kolom. `paceCapture` wordt binnen de bestaande device-rowlock en NA replaycontrole
samengevoegd tot `v3_normalized.paceHistory`; transportblok wordt gestript.
Persistsignatuur, defaults en retourtype blijven EXACT de bestaande acht argumenten:
`p_token_hash, p_session_id, p_sequence, p_captured_at, p_v3_normalized,
p_simhub_version DEFAULT NULL, p_events DEFAULT NULL, p_laps DEFAULT NULL`.

Opgeslagen historie: sessie/transport/segment, maximaal 40 auto's, 3 sporen en 20 rondetijden.
Echte SQL-tekstbytecap 524288. Bij overschrijding of ongeldige optionele merge verdwijnt PACE,
NOOIT core. Dubbele bins zijn idempotent, conflict maakt het spoor ongeschikt als referentie.
Server-completeness vereist alle 128 bins, monotone tijd, gecontroleerd finishanker en eindduur.
De historie wordt bij transport/segmentwissel of 24 uur zonder capture gewist; persist wist ook
bij teruglopende sessietijd of andere carId/trackId. Readprojectie onderdrukt verlopen data.
`simhub_pace_cleanup_v1()` verwijdert verlopen JSON fysiek in begrensde, gelockte batches;
alleen service_role mag deze functie direct uitvoeren. Uurlijkse scheduling is een expliciete
uitrolgate, niet in deze opdracht op productie geïnstalleerd of als werkend geclaimd.

Bestaande reads projecteren alle begrensde metrics, maar volledige reeksen alleen voor eigen auto
plus leider. `get_pitwall_pace(uuid,text,uuid,uuid)` kan een andere referentie kiezen en hergebruikt
DEZELFDE bestaande guards via `get_simhub_device_details` of `get_pitwall_data`; geen tabelgrants.
De device-testpagina pollt nu de begrensde RPC per seconde in plaats van volledige JSON-rijen
via postgres_changes te ontvangen. Geen RLS-/publication-wijziging.

## Frontend

Maximaal twee lijnen. RONDETIJD: gemeten afgeronde ronden. SNELHEID: km/h tegen afstandsbins.
DELTA: eigen verstreken tijd minus vaste opgenomen referentie op DEZELFDE bin, referentie wordt
voor de eigen trace vastgezet; positief is langzamer. Beide finishankeronzekerheden blijven relevant.
Gaten krijgen nieuwe SVG-subpaden. Eén punt is geen curve; lege referentie is geen tweede lijn.
Geen huidige snelheid of laatste-minus-beste als vervanging van een ontbrekende grafiek.

Live-timingsectoren en de eigen KPI-strip gebruiken uitsluitend actuele, gecontroleerde
PACE-sectorreeksen; de oude ongecontroleerde vehicle.sector*-waarden blijven onzichtbaar.
Metric-freshness is maximaal 5 s sessietijd. Met `sectorLap` moet de afgeronde ronde exact
bij de actuele rij horen; de getoonde laatste rondetijd komt dan uit diezelfde gecontroleerde
metric (CarIdxLastLapTime en SimHub kunnen iets verschillen). Oudere metrics zonder
ronde-identiteit vereisen exacte LastLapTime-gelijkheid met de rij.
Offline, verkeerde transportidentiteit en verlopen historie worden onderdrukt. Bij lege data
staat er een korte reden. Alle tabs blijven bereikbaar. Kaart en vier-panelenraster ongewijzigd.

## Uitrolgrens

Feature standaard uit: nieuwe producer stuurt alleen na negotiated `paceCapture=true`.
Eerst aparte GO, schema/rollback-pins opnieuw vergelijken, scheduler/loadgates bewijzen,
DB → Edge/control → plugin-canary → frontend. Deze lokale DLL is GEEN distributierelease:
geen nieuwe versie, ZIP, signing, manifest of updater-uitrol gemaakt.

## Definitieve sectoracquisitie (2026-11-01, lokaal)

`RawChannelReader` leest `SplitTimeInfo.Sectors[].SectorStartPct` via
`RawData.SessionData.SessionInfo`, met nullable fallback als SplitTimeInfo direct onder
SessionData hangt. Start moet 0 zijn, grenzen strikt oplopend en <1; maximaal 16.
Geen fallback naar een verondersteld drievoud. TrackID/TrackName/TrackConfigName en
observedSession bepalen de cache-identiteit; metadata wordt maximaal eenmaal per seconde
herlezen, wisseling wist de capture. SDK-carindex komt uit DriverInfo op exact autonummer,
nooit op coureurnaam of lijstvolgorde.

De voorkeursbron is één SDK-image met SessionTime, CarIdxLapDistPct, CarIdxLap,
CarIdxLapCompleted, CarIdxLastLapTime en CarIdxBestLapTime; anders bestaande nullable
Opponent-/sessiebronnen. SDK-klok wordt vóór de 20Hz-poort gelezen: een tragere SimHub-klok
mag geen snellere SDK-sampler tegenhouden. Een nieuwe SDK-tick kan dus tot 20 Hz meetellen.

`SectorMeasurement` interpoleert elke werkelijk gepasseerde grens tussen de omliggende
ticks, ook de finish. Een eerste deelronde mist het startanker en publiceert niets.
Gaten >0,25 s, sprongen >2/127 baanlengte, achteruit/teleport, pit, offline, ongeldig lapflag,
lap-/tick-/klokreset en sessiewissels mogen geen doorgaande sectorronde opleveren.
Een voltooide reeks moet binnen 0,1 s van de gemelde laatste rondetijd liggen.
Vertraagde rondetijd mag maximaal 2 s alsnog diezelfde ronde valideren; een ander
CarIdxLapCompleted mag dat niet. Beste gemeten sectoren worden alleen bij de bijbehorende
beste-rondetijd bewaard, nooit samengesteld uit losse minima.

SimHub LastLapSectorTimes/BestLapSectorTimes.GetSectorSplit(n) kan een willekeurig aantal
sectoren leveren; de oude LastLapSector1..3/BestLapSector1..3-getters zijn alleen bruikbaar
bij een werkelijke drievoudige layout. Dezelfde som-/aantalcontrole geldt. Voorrang:
goedgekeurd gemeten → goedgekeurd SimHub → null. Ook de Edge-parser en UI toetsen opnieuw.

Diagnostiek: eerste finish, eerste volledig opgenomen ronde en daarna elke twintigste
ronde. Eén kleine opname per geselecteerde ronde; pas na de 2s-bronverversingsmarge, zonder
extra request, outbox of ACK. Velden: source/count/sumSeconds/reportedSeconds/errorSeconds/
reason (`valid`, `incomplete`, `sum_mismatch`, `missing_lap`). Deze diagnostiek beschrijft de
eigen meetproef; de normale sectorSource/sectorErrorSeconds vermelden de werkelijk gekozen
bron, inclusief SimHub-fallback. Geen apparaatnaam of apparaat-id in diagnostiek. Bij krap
budget wordt eerst diagnostiek uit de serialisatie gehaald, daarna zo nodig heel PACE.
Core en bestaande meetbatch gaan altijd voor. Maximaal één bewaarde diagnostiek per auto.

Frontend kiest 0/onbekend of het werkelijke aantal kolommen uit actuele metadata. Zes
sectoren blijven zes. Compacte cijfers vanaf vier; horizontaal scrollen blijft beschikbaar
voor bredere layouts, zonder het kaart-/vier-panelenraster te veranderen. Een expliciet
gekozen verdwenen auto wordt nooit stilzwijgend door de nieuwe leider vervangen. Bestaande
opgenomen rondes mogen zichtbaar blijven, maar ontbrekende ronden/bins worden niet opgevuld.
