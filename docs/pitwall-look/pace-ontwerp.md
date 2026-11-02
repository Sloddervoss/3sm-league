# PACE — herzien ontwerp op basis van SimHub Opponent

Datum: 2026-11-01. Werkmap: `/home/hermes/wt/pitwall-look`.
Branch: `feat/pitwall-look-3sm`; onderzochte HEAD: `23552bdf2832211a1ae56ad8f06feb78de0b9e36`.
Lokale main: `b1d458a965315921567690c451fb1cf4f6c0fa21`.
Bij aanvang was dit ontwerp al een untracked bestand; de werkboom was dus NIET schoon.
Dit document vervangt het vorige ontwerp, niet `datagaten.md` of andere besluiten.
Opdracht: `/home/hermes/3sm-pace-ontwerp-correctie-2026-11-01.md:1–50` (brief).

Status: ONTWERP ALLEEN. Geen implementatie, migratie, databaseactie, commit, push,
merge of deploy. Ontwerpkeuzes zijn voorstellen, geen bestaande functionaliteit.
Bewijs uit de repo geldt voor bovenstaande HEAD, niet automatisch voor productie.
Gebruikersgerichte teksten blijven concept tot goedkeuring.

## 0. Leeswijzer en bewijsgrenzen

Bronafkortingen (elk regelnumer hieronder hoort bij dit exacte bestand):
- P = `tools/simhub-plugin/3SM.EnduranceConnector/EnduranceConnectorPlugin.cs`.
- C = `tools/simhub-plugin/3SM.EnduranceConnector/TelemetryContractsV3.cs`.
- O = `supabase/functions/_shared/opponents.ts`.
- E = `supabase/functions/_shared/simhubExtensions.ts`.
- N = `supabase/functions/_shared/simhub.ts`.
- A = `supabase/functions/_shared/simhubAggregates.ts`.
- SQL = `supabase/migrations/20261031190200_plugin08_measurement_ack.sql`.
- G = gedecompileerde lokale assembly, met bewaarde bronregels in bijlage A.

De brief bewijst de door Vincent gerapporteerde reflection-velden op de race-pc
(brief:6–19), niet hun eenheden, schrijfpad of runtime-vulling. Er is daarnaast
EEN lokale referentieassembly onderzocht, geen remote race-pc of productie:
`/home/hermes/research/iracing-endurance/Simulator-Controller/Sources/Special/SimHub Plugin/SimHub Plugin/References/SimHub/GameReaderCommon.dll`.
SHA-256: `027b6d7ca32581cee58b24bec3398d53c3ae726fa12f6646a4f5ce7ad5d298c1`.
G:72,80 meldt file-/assemblyversion `1.0.0.0`; dit identificeert geen SimHub-release.
G is de uitvoer van ILSpy, geen originele SimHub-broncode; reconstructiefouten
zijn mogelijk. Reproductiecommando en relevante regels staan volledig in bijlage A.
Dezelfde regels staan tijdens onderzoek in
`/home/hermes/.hermes/cache/scratch/pace-GameReaderCommon.decompiled.cs`.
Die scratchkopie is tijdelijk; de bijlage bewaart de relevante bewijsfragmenten.

Belangrijk versieverschil: de brief noemt `CurrentLap` Nullable<double>
(brief:16); de lokale DLL declareert `int?` (G:7614; bijlage A).
Dus: bestaan van de bronvelden accepteren, semantiek alleen bewezen voor deze
DLL waar het schrijf-/leespad zichtbaar is. Gelijkheid met de race-pc blijft
ONBEWEZEN tot versie/hash en dezelfde relevante code daar gecontroleerd zijn.

## 1. Speed: bestaand veld, eenheid en bronbereik onbewezen

BEWEZEN: P:1993 kopieert `Opponent.Speed` zonder conversie naar `SpeedKph`;
C:257 serialiseert `opponents[*].speedKph`; O:140 leest het bestaande veld.
P:2012 accepteert alleen positieve eindige waarden: echte stilstand wordt nu null.
O:117,140 accepteert numeriek 0..86400; dit is een parsergrens, geen fysiek bereik.
G:7621 declareert alleen `double? Speed { get; set; }`; het onderzochte generieke
DLL-pad bewijst geen opponent-snelheidseenheid of iRacing-toekenning.
Eigen snelheid gebruikt expliciet `SpeedKmh` (P:1689), niet hetzelfde bronbewijs.

Conclusie: EENHEID ONBEWEZEN (km/h of m/s), bronbereik en verversing ONBEWEZEN.
De naam speedKph is geen bewijs. Geen conversie of nieuwe interpretatie van het
bestaande veld doorvoeren op basis van een vermoeden; het blijft intact.

Ontwerpgate voor de eerste rit: leg assemblyhash/versie, game, unit-instelling,
SDK-tick en sessietijd vast; vergelijk dezelfde tick voor `Opponent.IsPlayer.Speed`
met eigen `SpeedKmh` (playerselectie bestaat in P:932–934). Neem stilstand, meerdere
constante snelheden, accelereren en km/h-/mph-displayinstellingen mee. Onderzoek
ratio 1 en 3,6; eis een vooraf vastgelegde tolerantie en sluit stale samples uit.
Dat valideert eerst de playerbron; een rijdende tegenstander vereist aanvullend
schrijfpadbewijs of een gesynchroniseerde gecontroleerde tegenmeting. Zonder dat
geen groene km/h-lijn. Bewaar bewijs, geen automatische conversie tijdens de rit.
Voorgestelde pace-grens NA bevestiging/conversie: 0..600 km/h; buiten bereik null,
nooit clampen. Dit is een veiligheidskeuze (eigen capture heeft grens 600,
P:1689), geen aangetoond maximum van SimHub. Nieuwe spoorcapture accepteert 0;
het legacy `speedKph`-veld verandert in dit ontwerp niet van semantiek.

## 2. Sectoren: drie verschillende verzamelingen, in seconden

BEWEZEN VOOR DE LOKALE DLL (bijlage A, G:7507–7541):
- `LastLapSector1..3` = `LastLapSectorTimes.GetSectorSplit(1..3).TotalSeconds`.
- `BestLapSector1..3` = `BestLapSectorTimes.GetSectorSplit(1..3).TotalSeconds`.
- `BestSector1..3` = `BestSectorSplits.GetSectorSplit(1..3).TotalSeconds`.
G:7906–7916 toont dat split 1 de eerste tijd is, split n het verschil tussen de
cumulatieve tijd n en n-1. Deze getters zijn dus afzonderlijke sectorDUUR in
seconden, niet cumulatieve tijden of sectorgrensposities. De wrappers zijn in
deze DLL obsolete; de vervangende objectpaden staan in hun attributen.

`BestSectorSplits` bewaart de minima per sector uit LastLapSectorTimes én
BestLapSectorTimes, over opeenvolgende updates via LastData (G:5198–5222).
Die minima hoeven dus niet in dezelfde ronde gereden te zijn. Hun som is hooguit
een theoretische samengestelde ronde, niet noodzakelijk `BestLapTime`.
De twee andere groepen verwijzen structureel naar respectievelijk last-lap- en
best-lap-objecten. Dat de iRacing-reader die objecten altijd correct, atomair en
voor iedere tegenstander vult, is ONBEWEZEN: de onderzochte code bevat niet dat
spelspecifieke schrijfpad. Het label “sectoren van de laatste/beste ronde” is de
bedoelde objectbetekenis, niet een runtime-garantie. Ook rondegeldigheid en
resetbeleid van de invoer blijven ONBEWEZEN.

Ontwerp: lees deze aanwezige Opponent-bronnen rechtstreeks; geen eigen SDK-array,
sectorgrenzen of positie-gebaseerde sectortijdreconstructie als voorwaarde.
Voeg drie afzonderlijke nullable arrays met ieder exact drie nullable seconden toe:
`lastLapSectorSeconds`, `bestLapSectorSeconds`, `bestSectorSeconds`. Ontbrekend,
NaN, niet-positief of buiten voorgestelde grens 86400 → null; geen 0 invullen.
Plaats ze in het nieuwe pace-blok (paragraaf 4), niet onvoorwaardelijk in elke
legacy opponentrij. Gelijkheid van hun update met LastLapTime moet een finishrit
bewijzen; bij twijfel geen historisch rondennummer toevoegen. Ontbrekende derde
sector niet uit de andere twee verzinnen. Een sector-getterfout is veld-lokaal.

## 3. DeltaToBest en DeltaToPlayer: beste-rondetijdverschillen, geen live spoor

BEWEZEN VOOR DE LOKALE DLL: G:4862–4867 bepaalt `timeSpan` als de kleinste
positieve BestLapTime in de opponentlijst; `timeSpan2` is de BestLapTime van de
player (playerselectie G:4851–4854). G:4936–4950 berekent:
- `DeltaToBest = max(0, opponent.BestLapTime − beste BestLapTime van de lijst)`,
  in seconden; 0 = gelijk snelste, positief = langzamer. Zonder positieve bron null.
- `DeltaToPlayer = opponent.BestLapTime − player.BestLapTime`, in seconden;
  positief = opponent heeft langzamere beste ronde, negatief = snellere beste ronde.
  Zonder positieve bron null.

Dit zijn GEEN actuele gap, geen laatste-rondeverschil en geen delta op dezelfde
baanpositie. De snelste auto uit de lijst is ook niet per definitie de leider in
racepositie. Het bestaande `GaptoPlayer` (P:1982–1984) is een ander veld; diens
tekencommentaar bewijst niets over `DeltaToPlayer`.

Ontwerp: nieuwe nullable `bestLapDeltaToFieldBestSeconds` en
`bestLapDeltaToPlayerSeconds` uitsluitend na dezelfde-code-gate voor de race-pc,
voorgestelde grenzen respectievelijk 0..86400 en -86400..86400. Geen -1-sentinel
voor signed delta. Bron/herkomst expliciet tonen en niet “live DELTA” noemen.
Voor een DELTA-curve blijft een vergelijkbaar tijd-afstandspoor noodzakelijk.

## 4. Contract: bestaand hergebruiken, toevoegingen geïsoleerd en nullable

BEWEZEN: C:240–259 en O:3–24 bevatten al id/lap/lapDistancePct,
lastLapSeconds/bestLapSeconds, speedKph, pit/connected/player en gaps/posities.
P:1980–1995 leest de bijbehorende Opponent-bronnen. De plugin maakt nu nog geen
sectorsporen of tijd-afstandspoor in deze snapshot; die DTO bevat die niet.

Ontwerp, ALLES hieronder nieuw tenzij hierboven als bestaand benoemd:
- Hergebruik de bestaande opponent-id, lap, lapDistancePct, lastLapSeconds,
  bestLapSeconds, speedKph en selectievelden; geen dubbel currentSpeed-veld.
- Voeg optioneel/nullable rootblok `paceCapture` toe, met schemaRevision,
  observedSessionId, segmentId en begrensde lijsten `opponentMetrics`,
  `opponentLaps`, `traceChunks`. Ontbrekend/null = geen nieuwe waarneming.
  De inhoud is alleen verplicht ALS het betreffende nieuwe record aanwezig is.
- `opponentMetrics`: id, observedSessionTimeSeconds; de drie sectorarrays uit §2,
  de twee best-lap-delta's uit §3, nullable `lapValid`, `lapHighPrecision` en
  `trackPositionPercentRaw`. Geen nieuwe bronkanalen: die komen uit de brief
  (:8–19) en G:7521–7541,7559,7610–7616. Unit-/versiegates blijven gelden.
  Raw/highPrecision zijn discontinuïteitsdiagnostiek, geen eigen rondetijdklok.
- `lapValid`: nullable transport van de bool, NIET “officieel geldige vorige
  ronde”. G:7559 initialiseert LapValid op true: alleen bestaan/true bewijst geen
  door iRacing gevalideerde ronde. Geen ontbrekende waarde naar true omzetten;
  een louter standaard-true bron blijft als onbewezen kwaliteit gemarkeerd.
- `opponentLaps`: id, afgerond lapnummer, seconds, waarnemingstijd, quality,
  observationId. Rondetellerovergang plus bewezen LastLapTime-koppeling vereist;
  eerste waarneming is baseline. Ook twee exact gelijke rondetijden opslaan.
- `traceChunks`: id, traceId, lap, chunkIndex, finalChunk, nullable points met
  tupels `[bin, sessionTimeMs, speedDeciKph]`. Bin verplicht 0..127; tijd en
  snelheid nullable; een ontbrekend punt niet als nul verzenden. Snelheid uit
  dezelfde bestaande Speed-bron, maar pas normaliseren na §1-gate; bij eigen auto
  eigen SpeedKmh. Geen onbewezen ruwe waarde als km/h versturen.
- Traceheader: provenance, eenheden, finishinterval, dekking en onderbrekingen;
  server bepaalt completeness/actualiteit, client kan geen PASS afdwingen.
  Alle nieuwe JSON-namen zijn VOORGESTELD, geen bestaande SDK-kanalen.

Compatibiliteit: N:450–486 accepteert begrensd onbekende rootkeys maar negeert ze;
onbekende keys BINNEN bekende blokken blijven een fout (ook O:26–32).
Daarom geen nieuwe nested keys in legacy opponents. Eerst expliciete pace-parser,
dan producer. Een oud frame blijft zonder nieuwe velden werken. Bij malformed
pace alleen dat blok afwijzen (te bouwen gedrag), niet kerntelemetrie verliezen.
Een oudere Edge mag pace niet nodig hebben om het oude kernframe te verwerken;
voor daadwerkelijk uitleveren blijft server-capability verplicht. Het nieuwe
blok kan dieper zijn dan de oude unknown-root-depth 3 (E:25–30): feature standaard
uit tot server gereed, NIET veronderstellen dat iedere oude server het veilig negeert.

## 5. Sporen per auto: begrensde acquisitie, geen momentopname als curve

Ontwerpkeuzes (nog niet geïmplementeerd): maximaal 40 auto-identiteiten TOTAAL
per segment, eigen auto inbegrepen als die in Opponents staat. Niet 40 plus
nog eens de speler aannemen. P:36,1965–1998 kapt de snapshot op 40 vóór sorteren;
O:24,99 heeft dezelfde cap. Volledige fysieke griddekking is daarom ONBEWEZEN.
Geen 50/64-auto-uitbreiding in dit ontwerp. Selectie bij latere implementatie
vóór afkappen: player en gekozen leider prioriteren, rest deterministisch;
ontbrekende auto's blijven zichtbaar ontbrekend, geen valse volledige-gridclaim.

Per auto: lopend spoor, laatste volledig opgenomen spoor en snelste volledig
opgenomen spoor; elk maximaal 128 vaste baanposities `x = bin / 127`. Geen
laatste-128-ticks-buffer. “Snelste opgenomen” is niet “officieel geldig beste”.
Per auto daarnaast maximaal 20 bevestigde rondetijden. Verdwijnen/reconnect mag
het totaal niet laten groeien: oudste inactieve identiteit verwijderen binnen
40, of nieuwe identiteit niet toelaten zolang alleen actieve slots bezet zijn.

Acquisitie in DataUpdate vóór pairing/send-poorten, zoals de bestaande meetlaag
(P:667–694). Maximaal 10 Hz op echte sessietijd, dubbele SDK-tick onderdrukken
(P:942–945). Gebruik `SessionTelemetryReader.cs:22–45` (RawData.Telemetry.SessionTime);
geen Stopwatch, wallclock of GuessedElapsedGameTime voor een rijspoor. Geen tijd
beschikbaar → geen tijdpunt, geen kunstmatige klok. Opponent.CurrentLapTime is
in deze DLL desnoods een DateTime-schatting (G:4839–4845); niet daarvoor gebruiken.

Per eigen auto bestaan afstand en verstreken rondetijd al (P:1474–1478); per
opponent zijn positie en rondeteller beschikbaar (P:1980–1981). Koppel alle
waarnemingen aan dezelfde update, bron-id, observedSessionId en lokaal segment.
Het bestaande sessie-id combineert SessionUniqueID en SessionNum, maar kan partieel
zijn (P:974–982); combineer met device/transport/segment, geen wereldwijde join.

Plaats een bin alleen als twee geldige omliggende waarnemingen dezelfde ronde
beslaan; voorgestelde interpolatiegrens 0,25 s én maximaal twee binintervallen.
Interpoleer kort tijd/snelheid en markeer het spoor als gesampled/geschat, niet
als exacte SDK-curve. Grotere gaten: ontbrekende bins, geen extrapolatie.
Finish is een apart interval tussen de laatste oude en eerste nieuwe positie;
alleen na bewezen rondetellerovergang kort schatten, inclusief onzekerheidsduur.
Geen verzonnen eindpunt of onopgemerkte seam. Delta gebruikt sessietijd minus
dit finishanker; het verschil tussen twee auto's bevat beide ankeronzekerheden.
Zonder betrouwbaar finishanker wel snelheidsdeelcurve, geen absolute ronde-delta.

Pit, teleport, tijd-terug, afgebroken sessie, replay, late join, auto-idwissel of
onverklaarde rondesprong breken dekking/segment. LapValid=false sluit referentie
uit; true alleen geeft nog geen officiële geldigheid (§4). Referentie blijft
vast gedurende één getoonde ronde. Geen gap naar leider integreren tot delta.
Bij stop/reset aansluiten op P:675–688; geen blokkerende End-netwerkflush.
Pending/retry maximaal 256 chunks, elk maximaal 4096 bytes, TTL 30 s; bij overloop
oudste niet-geselecteerde chunk laten vallen en verlies zichtbaar maken. Alle
getallen in deze alinea zijn ontwerpgrenzen, geen gemeten runtime-eigenschappen.

## 6. Budget bij 40 auto's — lokale buffer is NIET het HTTP-frame

Bestaande grenzen: plugin MaxPayloadBytes=24000 (P:37–40); Edge/body 24576,
meetbatch 16384 en aantallen 20 events/3 laps (E:41–51).
P:2064–2072 bouwt eerst core, daarna bestaande meetbatch; bestaande planner rekent
restruimte uit (`MeasurementFrame.cs:69–111`). Die meet-ACK/outbox behouden.
De getallen hieronder zijn uitgevoerde ontwerpberekeningen met synthetische
maximumwaarden, GEEN gecapturede rit of gemeten maximale echte kernsnapshot.
Reproduceerbare Python-rekenproef en resultaat staan in bijlage B.

Ontwerpvoorstel voor de puntrepresentatie:
- Tijd integer milliseconden 0..86400000 binnen een segment van maximaal 24 uur;
  bij langere sessie nieuw segment, geen overflow. Speed integer 0..6000 in
  0,1 km/h na unitgate. Bin 0..127. Null voor ontbrekende tijd/snelheid.
- Worst-case compact JSON-tupel `[127,86400000,6000]`: 19 bytes;
  array van 128 zulke bovengrenspunten: 2561 bytes inclusief komma's/haken.
- 40 × 3 × 128 = 15360 punten; 120 arrays samen maximaal 307320 bytes.
- Headers/wrappers maximaal 256 bytes per trace = 30720; 40 × 20 compacte
  rondetijdrecords à maximaal 64 bytes = 51200; root/index/metrics 32768.
  Dit vereist interne compacte records zonder telkens lange namen/UUID's;
  caps zijn inclusief delimiters en worden werkelijk afgedwongen, niet geschat.
- Bovengrens compacte nieuwe opgeslagen JSON: 422008 bytes. Nieuwe opslagcap
  512 KiB = 524288 bytes in plaats van de oude 192 KiB: oude cap past niet bij
  drie sporen voor 40 auto's. SQL controleert daarnaast echte UTF-8-bytes van
  jsonb::text (met whitespace); fysieke jsonb-/TOAST-/WAL-omvang is ONBEWEZEN.
  Bij capoverschrijding eerst oude niet-referentiesporen/rondetijden verwijderen,
  zo nodig een nieuw spoor afwijzen, nooit core snoeien voor pace.
- Voorstel expliciete 16-byte layout: bin uint16, quality uint16, sessietijd
  uint32, gereserveerde/anker-offset uint32, snelheid int32; qualitybits
  onderscheiden ontbrekend van echte 0. Deze layout is nog niet geïmplementeerd.
  Expliciet gepakte lokale puntdata à 16 bytes: 245760 bytes voor alle drie
  sporen van 40 auto's. Dit is géén gemeten managed heap. Metadata, arrays en
  pendingqueue extra; ontwerp hard byte-/aantalbudget ook daarvoor en meet heap
  vóór GO. Queue bevat niet 256 volledige gridbuffers maar begrensde chunks.

Wire-ontwerp: paceCapture maximaal 4096 bytes inclusief metadata; maximaal 64
punten per chunk, meerdere chunks alleen binnen dezelfde 4096-bytecap.
Een uitvoerbaar rekenvoorbeeld met lange begrensde ids en één 64-puntschunk is
1693 bytes (bijlage B); dit is geen bewijs dat iedere mogelijke chunk zo groot is.
Meet altijd werkelijke UTF-8-serialisatie, inclusief unicode/escaping.

Verzendvolgorde later: bouw bestaand kernframe en bestaande meetbatch EERST,
voeg daarna pace toe alléén als `B + 1 + paceBytes <= 24000` én paceBytes <=4096.
De extra byte is de komma voor het toegevoegde lid; paceBytes telt key/colon en
value mee in de echte controle. Pas de budgetcheck vóór POST op het EINDresultaat
toe. Is B bijvoorbeeld 23900, dan rest slechts 99 bytes: geen normaal pace-blok
versturen. Bij reeds te grote B pace weglaten en bestaand oversize-pad behandelen;
het huidige trimcommentaar op P:37–40 is geen bewijs dat iedere core altijd past.
Meetreeksen niet wegduwen om een pace-cap te halen. Nooit 40 volledige sporen in
één frame; nooit de 24576-limiet verhogen. Maximaal één pace-dragend frame per
seconde binnen de bestaande cadence, geen extra request naast de rate-limit
(SQL:656–662). Daarmee maakt pace een passend frame door constructie niet te groot;
een maximale echte core plus alle metingen is nog een runtime-/fixturegate.

Doorvoergrens: alleen de 40 huidige puntarrays kosten al 102440 bytes per ronde;
bij theoretisch altijd 4096 bytes/s minstens 26 s, metadata/retry/restruimte
maken dit slechter. Dus GEEN garantie dat alle 40 live sporen elke ronde de
server bereiken. Lokaal alle 40 begrensd opnemen; wire prioriteit eigen auto en
gekozen leider, rest round-robin voor zover budget toelaat. Geen geselecteerde
leider bekend → overall position=1 uit dezelfde snapshot, indien aanwezig.
Bij wissel alleen beschikbaar spoor tonen, ontbrekende bins eerlijk leeg.
Beperkte herhaling/idempotentie, geen duurzame pace-ACK of racearchiefbelofte;
onvolledig ontvangen spoor is geen referentie. De eis “40 auto's” is hier een
capaciteitsbudget, geen onbewezen leverings-SLA op iedere baan/verbinding.

## 7. Opslag en acht argumenten blijven het bestaande pad

BEWEZEN: A:8–10,58–62 maakt de snapshot zonder meetreeksen; SQL:875–905 schrijft
`simhub_telemetry_latest.v3_normalized` en VERVANGT die nu volledig bij een update.
De JSON-kolom is dus bruikbaar, maar huidige persist voegt nog geen pacebuffer
samen. Een ongewijzigde persist kan dit ontwerp NIET leveren.

Voorstel: gevalideerd paceCapture mee in bestaande p_v3_normalized, niet p_events
of p_laps. Binnen dezelfde geautoriseerde en replay-gecontroleerde transactie
(SQL:606–614,629–631,656–662) atomair de begrensde vorige paceHistory lezen/mergen
met nieuwe chunks; transportblok daarna strippen en server paceHistory toevoegen.
Deterministische sleutel: device + observed/transport-session + segment + auto-id
+ ronde + chunk/bin; duplicaat idempotent, conflicterende revisie afwijzen.
Geen verloren update tussen gelijktijdige frames; bestaande device-lock behouden.
Oud frame zonder pace behoudt alleen dezelfde segmentbuffer tot TTL/reset.
Identiteit onzeker/segment veranderd → wissen, niet over sessies heen plakken.

EXACT dezelfde signatuur uit SQL:542–557 behouden, ook defaults en retourtype:
`p_token_hash, p_session_id, p_sequence, p_captured_at, p_v3_normalized,
p_simhub_version DEFAULT NULL, p_events DEFAULT NULL, p_laps DEFAULT NULL`.
Geen negende argument, geen overload, geen wijziging aan measurement_ack of
rate-limit/replay. A:89–95 toont bestaande optionele meetargumenten/fallback;
5/6/8-args callers moeten blijven werken. Live DB-definitie ONBEWEZEN; repo-SQL
is geen migratie-ledger. Vóór toekomstige GO exact pg_get_functiondef vastleggen.

Zelfde opslagstrategie als het vorige ontwerp: live-venster, geen nieuwe tabel
of kolom; maximaal 24 uur sinds laatste waarneming, segmentreset altijd wissen.
Service-only opruimfunctie met row-lock/hercontrole per uur voorstellen; echte
scheduler en fysieke cleanup ONBEWEZEN. Read-RPC onderdrukt verlopen historie
ook vóór cleanup; zonder bewezen cleanup geen retentie-PASS.
`endurance_opponent_gap_samples` niet hergebruiken als spoorarchief: gap/pitfilters,
40-cap en 300 s retentie staan in
`supabase/migrations/20260904_pitwall_0403_server_closing_rate.sql:13–76`.
Ook eigen meetaggregaten niet met rivalen/pseudo-device-id's vervuilen (A:8–14).

Readprojectie via bestaand `get_pitwall_data(uuid,uuid)`
(`supabase/migrations/20261027210000_endurance_pitwall_team_scope.sql:404–425,472,622`):
behoud team/event/autorisatie; maximaal eigen en gekozen leider doorgeven, niet
40 volledige sporen. Devicepad `get_simhub_device_details` controleren met dezelfde
projectie (`src/pages/PitwallDeviceTestPage.tsx:106–125`). Geen nieuwe browsergrants.
De huidige realtime-route ontvangt tabelwijzigingen
(`src/pages/PitwallDeviceTestPage.tsx:67`); een smalle RPC alleen voorkomt daar
GEEN grote WAL/realtime-payload. Dit is een verplichte loadgate: meet DB/WAL en
browser bij volle 512-KiB-buffer; zo nodig vervang die route vóór uitrol door
beperkte RPC-refetch met een bestaand geautoriseerd signaal. Niet stil RLS wijzigen.

## 8. Volgorde, wijzigingsplaatsen en rollback — ontwerp, geen uitvoering

Toekomstige bestandslocaties zijn ontwerpkeuzes, met bestaand padbewijs hierboven:
1. Plugin P/C: nullable capture/accumulator en DTO's; `.csproj` aanvullen als nieuwe
   bestanden komen. Geen nieuwe SDK-verbinding nodig voor de Opponent-velden.
2. N/O/E/A: expliciete parser/caps, foutisolatie, projectie en snapshotdoorgifte;
   geen verhoging van MaxOpponentsPerSnapshot. `simhub-ingest-v3/index.ts` flow en
   capability/fallback nalopen, geen nieuwe p_events/p_laps-semantiek.
3. DB-functies: merge/cleanup met ongewijzigde 8-args, daarna readprojecties.
   Eventuele latere migratieprefixen op actuele main reserveren, nu GEEN bestanden.
   Elke stap krijgt rollback uit exact vooraf uitgelezen functiedefinities.
4. Frontend: gedeelde PacePanel/PaceGraph en team/device-adapters; niets in
   strategie/brandstof/banden/stintadvies veranderen. De huidige PacePanel is een
   momentwaarde en laatste-minus-beste getal, geen spoor
   (`src/features/endurance/pitwall/PacePanel.tsx:27–28`).

Uitrol na AFZONDERLIJKE GO: bron-/unitgates en rollbackdefinities → DB-buffer/
cleanup → readprojecties → Edge/parser/budget/capability → plugin canary via bestaand
updaterpad → site. Oude plugins blijven werken zonder pace. “Server eerst” geldt
ook voor de byte-/depth-gates, niet alleen het toevoegen van één optional key.

Rollback: site → nieuwe producerfeature uit → oudere Edge → eerdere DB-functies.
Een teruggezette DB/Edge met doorsturende nieuwe producer is niet veilig bewezen.
Geen destructieve cleanup nodig om core terug te krijgen; oude JSON mag inert
blijven, bestaande retentie-/autorisatieregels blijven gelden. Geen willekeurige
plugin-downgrade veronderstellen: uitzetten of ondertekend herstelpad eerst testen.

Frontendontwerp: maximaal twee lijnen, eigen oranje en geselecteerde leider groen;
leiderswissel nooit verschillende auto's aan elkaar verbinden. Rondetijdas echte
afgeronde ronden; één punt is geen curve. SNELHEID tegen baanpositie uit korte
bewezen/interpolatiegedekte stukken; km/h pas na unitgate. DELTA positief = eigen
verstreken tijd langzamer dan vast gekozen referentie bij dezelfde baanpositie;
eigen referentie of voldoende gedekt lokaal opgenomen leiderspoor, met anker-
onzekerheid. Niet de beste-rondetijd-delta's uit §3 als live lijn verkopen.
Sectoren mogen uit §2 rechtstreeks worden getoond zodra bron-/versie-/ritgate
slaagt; geen standaard “—” omdat de velden zogenaamd ontbreken. Bij null wel leeg.
Geen sectorgrenzen op de kaart afleiden uit sectorduren. Stale/offline expliciet.
Maximaal twee keer 128 punten, 20 rondetijden per gekozen auto, opbouw maximaal 1 Hz;
geen volledige serverbuffer in de browser grafiekflow.

## 9. PASS/FAIL-gates en resterend onbewezen

Onderzoeksresultaat: veldbestaan uit brief aanvaard; lokale getter-/deltaformules
onderbouwd met DLL en bronregels. Eenheden Speed en gelijkheid met race-pc:
ONBEWEZEN. De rekenproef is uitgevoerd (bijlage B); dit is GEEN runtime-PASS.

Nog uit te voeren vóór implementatie/uitrol-GO, nu NIET PASS:
- Hash-/versie-/typeverschil CurrentLap oplossen op race-pc, spelspecifiek schrijfpad
  en iRacing-vulling/refresh van speed/sectoren/delta's verifiëren.
- Eerste-rit-unitproef uit §1; 0, null, NaN, sentinel, unitinstellingen en stale
  values. Sectortijden optellen/LastLapTime vergelijken en beide best-groepen
  over meerdere ronden observeren; invalid/reset apart vastleggen.
- Finishcapture met gelijke rondetijden, vertraagde updates, gemiste ronden,
  late join, reconnect/driverwissel, pit/teleport en sessiewissel. Geen verkeerde
  laplabeling; referentie zonder betrouwbare finishanker/dekking weigeren.
- Oude/null/malformed pace-fixtures; onbekende rootdepth, te grote ids/unicode,
  maximale echte 40-auto-core met alle bestaande blokken en volle meet-outbox.
  Elke POST exact UTF-8 <=24576, ontwerpdoel <=24000; pace nooit core/ACK verdringen.
- 5/6/8-args persist, defaults/retourtype, replay, duplicate/conflicting/out-of-order
  chunks, transactionele merge, resets en scheduler/TTL echt testen.
- 40-auto-soak: capped pluginheap/queue/server-JSON, pakketverlies en korte ronde
  met te weinig doorvoer; geen valse volledigheid. DB-locks/WAL/realtime meten.
  Frontend maximaal twee lijnen, doel p95 grafiekwerk <16 ms op genoemde hardware;
  dit is een toekomstig prestatiedoel, geen gemeten resultaat.
- Team/device-RPC toegestaan versus ander team/onbevoegd; geen extra tabelgrants.

Niet nodig als voorwaarde voor de lokale leiderlijn: eigen plugin op de rivalen
of een cross-device-identiteitsjoin. Lokale Opponent-bronnen bestaan (§1–4);
volledigheid/units blijven de echte gates. Cross-device-sharing is apart scope en
niet bewezen. Productie-DB, scheduler, maximale echte framegrootte, opslagkosten
en browsertijden zijn met dit document NIET vastgesteld.

## 10. Wat verandert tegenover het vorige ontwerp?

- Rivalensectoren niet langer bronloos/NO-GO wegens afwezige SDK-sectorgrenzen:
  de Opponent-getters zijn aanwezig; hun drie betekenissen en seconden zijn
  lokaal onderbouwd. Runtime-/versiegate vervangt de onjuiste afwezigheidsclaim.
- Leidersnelheid kan uit dezelfde lokale Opponent-bron worden opgenomen; geen
  eigen rivalenplugin als principiële eis. Eenheid blijft expliciet onbewezen.
- DeltaToBest/DeltaToPlayer zijn beste-rondetijdverschillen, geen live curve.
- Naast eigen spoor nu begrensde sporen per auto; 128 punten en 40 slots, geen
  50 auto's/64-cap-uitbreiding. Nieuwe velden alleen in nullable paceCapture;
  bestaande speedKph en 8-args ongewijzigd.
- Opslag blijft de bestaande JSON-kolom met atomair mergeontwerp, TTL en beperkte
  readprojecties. Door 40 × drie sporen groeit de voorgestelde cap van 192 naar
  512 KiB; werkelijk jsonb/WAL/realtime blijft een expliciete uitrolgate.
- Wire blijft maximaal 4096 extra bytes waar ruimte bestaat; throughputbeperking
  expliciet, geen garantie van alle 40 complete servercurves iedere ronde.
- Volgorde, autorisatie, advies-isolatie, aparte GO en omgekeerde rollback blijven.

Impact van DEZE wijziging: alleen dit ontwerpbestand. Website/frontend,
backend/API, bot, data/database, auth/rollen en deployment: geen functionele impact.
Productie frontend changes: NONE. Database/schema/migraties: NIET gewijzigd.
Branch niet gecommit/gepusht; geen PR, merge of deploy in deze ontwerpopdracht.

## Bijlage A. Reproduceerbaar assemblybewijs, inclusief oorspronkelijke regelnummers

Reproductie (alleen lokaal lezen/decompileren; niet op race-pc uitgevoerd):

```sh
DOTNET_ROOT=/home/hermes/.dotnet DOTNET_ROLL_FORWARD=Major \
  /home/hermes/.dotnet/tools/ilspycmd \
  '/home/hermes/research/iracing-endurance/Simulator-Controller/Sources/Special/SimHub Plugin/SimHub Plugin/References/SimHub/GameReaderCommon.dll' \
  > /home/hermes/.hermes/cache/scratch/pace-GameReaderCommon.decompiled.cs
```

Onderstaande G-regelnummers zijn van de HELE-assembly-decompilatie, niet van de
aparte Opponent-type-dump. Weggelaten bereiken zijn expliciet gescheiden.

G:72–72:

```cs
72: [assembly: AssemblyFileVersion("1.0.0.0")]
```

G:80–80:

```cs
80: [assembly: AssemblyVersion("1.0.0.0")]
```

G:7505–7541:

```cs
7505: 	public class Opponent
7506: 	{
7507: 		[Obsolete("Please use BestLapSectorTimes?.GetSectorSplit(1)")]
7508: 		[JsonIgnore]
7509: 		public double? BestLapSector1 => BestLapSectorTimes?.GetSectorSplit(1)?.TotalSeconds;
7510:
7511: 		[Obsolete("Please use BestLapSectorTimes?.GetSectorSplit(2)")]
7512: 		[JsonIgnore]
7513: 		public double? BestLapSector2 => BestLapSectorTimes?.GetSectorSplit(2)?.TotalSeconds;
7514:
7515: 		[Obsolete("Please use BestLapSectorTimes?.GetSectorSplit(3)")]
7516: 		[JsonIgnore]
7517: 		public double? BestLapSector3 => BestLapSectorTimes?.GetSectorSplit(3)?.TotalSeconds;
7518:
7519: 		[Obsolete("Please use LastLapSectorTimes?.GetSectorSplit(1)")]
7520: 		[JsonIgnore]
7521: 		public double? LastLapSector1 => LastLapSectorTimes?.GetSectorSplit(1)?.TotalSeconds;
7522:
7523: 		[Obsolete("Please use LastLapSectorTimes?.GetSectorSplit(2)")]
7524: 		[JsonIgnore]
7525: 		public double? LastLapSector2 => LastLapSectorTimes?.GetSectorSplit(2)?.TotalSeconds;
7526:
7527: 		[Obsolete("Please use LastLapSectorTimes?.GetSectorSplit(3)")]
7528: 		[JsonIgnore]
7529: 		public double? LastLapSector3 => LastLapSectorTimes?.GetSectorSplit(3)?.TotalSeconds;
7530:
7531: 		[Obsolete("Please use BestSectorSplits?.GetSectorSplit(1)")]
7532: 		[JsonIgnore]
7533: 		public double? BestSector1 => BestSectorSplits.GetSectorSplit(1)?.TotalSeconds;
7534:
7535: 		[Obsolete("Please use BestSectorSplits?.GetSectorSplit(2)")]
7536: 		[JsonIgnore]
7537: 		public double? BestSector2 => BestSectorSplits.GetSectorSplit(2)?.TotalSeconds;
7538:
7539: 		[Obsolete("Please use BestSectorSplits?.GetSectorSplit(3)")]
7540: 		[JsonIgnore]
7541: 		public double? BestSector3 => BestSectorSplits.GetSectorSplit(3)?.TotalSeconds;
```

G:7559–7559:

```cs
7559: 		public bool LapValid { get; set; } = true;
```

G:7596–7621:

```cs
7596: 		public bool IsPlayer { get; set; }
7597:
7598: 		public TimeSpan BestLapTime { get; set; }
7599:
7600: 		public TimeSpan LastLapTime { get; set; }
7601:
7602: 		[Computed]
7603: 		public double? DeltaToBest { get; set; }
7604:
7605: 		[Computed]
7606: 		public double? DeltaToPlayer { get; set; }
7607:
7608: 		public double? IRacing_IRating { get; set; }
7609:
7610: 		public double? TrackPositionPercent { get; set; }
7611:
7612: 		public double? TrackPositionPercentRaw { get; set; }
7613:
7614: 		public int? CurrentLap { get; set; }
7615:
7616: 		public double? CurrentLapHighPrecision { get; set; }
7617:
7618: 		public string CarNumber { get; set; } = "";
7619:
7620:
7621: 		public double? Speed { get; set; }
```

G:4795–4810:

```cs
4795: 				if (opponent.CurrentLap.HasValue && opponent.TrackPositionPercent.HasValue)
4796: 				{
4797: 					opponent.TrackPositionPercentRaw = opponent.TrackPositionPercent;
4798: 					if (opponent.TrackPositionPercent < 0.0)
4799: 					{
4800: 						opponent.TrackPositionPercent = 0.0 - (0.0 - opponent.TrackPositionPercent) % 1.0;
4801: 					}
4802: 					while (opponent.TrackPositionPercent < 0.0)
4803: 					{
4804: 						opponent.TrackPositionPercent += 1.0;
4805: 					}
4806: 					while (opponent.TrackPositionPercent > 1.0)
4807: 					{
4808: 						opponent.TrackPositionPercent %= 1.0;
4809: 					}
4810: 					opponent.CurrentLapHighPrecision = opponent.CurrentLapHighPrecision ?? ((double)(opponent.CurrentLap.Value - 1) + opponent.TrackPositionPercent.Value);
```

G:4839–4845:

```cs
4839: 					Opponent lastData2 = opponent.LastData;
4840: 					if (lastData2 != null && lastData2.TrackPositionPercent.HasValue && opponent.TrackPositionPercent.HasValue && opponent.LastData.TrackPositionPercent.Value > 0.9 && opponent.TrackPositionPercent.Value < 0.1)
4841: 					{
4842: 						opponent.GuessedLapStartTime = now;
4843: 					}
4844: 					opponent.GuessedLapStartTime = opponent.GuessedLapStartTime.GetValueOrDefault(opponent.LastData?.GuessedLapStartTime ?? DateTime.Now);
4845: 					opponent.CurrentLapTime = opponent.CurrentLapTime ?? (now - opponent.GuessedLapStartTime.Value);
```

G:4851–4854:

```cs
4851: 				if (opponent.IsPlayer)
4852: 				{
4853: 					NewData.CarClass = opponent.CarClass;
4854: 					opponent4 = opponent;
```

G:4862–4867:

```cs
4862: 			Opponent opponent6 = Opponents.First();
4863: 			List<Opponent> list = Opponents.Where((Opponent i) => i.BestLapTime > TimeSpan.Zero).ToList();
4864: 			if (list.Count > 0)
4865: 			{
4866: 				timeSpan = list.Min((Opponent i) => i.BestLapTime);
4867: 				timeSpan2 = (opponent4?.BestLapTime).GetValueOrDefault(TimeSpan.Zero);
```

G:4936–4950:

```cs
4936: 				if (timeSpan > TimeSpan.Zero && Opponent.BestLapTime > TimeSpan.Zero)
4937: 				{
4938: 					Opponent.DeltaToBest = Math.Max(0.0, 0.0 - (timeSpan - Opponent.BestLapTime).TotalSeconds);
4939: 				}
4940: 				else
4941: 				{
4942: 					Opponent.DeltaToBest = null;
4943: 				}
4944: 				if (timeSpan2 > TimeSpan.Zero && Opponent.BestLapTime > TimeSpan.Zero)
4945: 				{
4946: 					Opponent.DeltaToPlayer = (Opponent.BestLapTime - timeSpan2).TotalSeconds;
4947: 				}
4948: 				else
4949: 				{
4950: 					Opponent.DeltaToPlayer = null;
```

G:5198–5222:

```cs
5198: 		private void UpdateSectorsData(Opponent i)
5199: 		{
5200: 			i.BestSectorSplits = i.LastData?.BestSectorSplits ?? new SectorSplits();
5201: 			UpdateBestSectortimes(i, i.LastLapSectorTimes);
5202: 			UpdateBestSectortimes(i, i.BestLapSectorTimes);
5203: 		}
5204:
5205: 		private static void UpdateBestSectortimes(Opponent i, SectorTimes times)
5206: 		{
5207: 			if (times == null)
5208: 			{
5209: 				return;
5210: 			}
5211: 			foreach (KeyValuePair<int, SectorHistoryEntry> datum in times.Data)
5212: 			{
5213: 				TimeSpan? sectorSplit = times.GetSectorSplit(datum.Key);
5214: 				if (sectorSplit.HasValue)
5215: 				{
5216: 					TimeSpan? sectorSplit2 = i.BestSectorSplits.GetSectorSplit(datum.Key);
5217: 					if (!sectorSplit2.HasValue || sectorSplit2.Value > sectorSplit.Value)
5218: 					{
5219: 						i.BestSectorSplits.SetSplit(datum.Key, sectorSplit.Value);
5220: 					}
5221: 				}
5222: 			}
```

G:7906–7916:

```cs
7906: 		public TimeSpan? GetSectorSplit(int sectorIndex)
7907: 		{
7908: 			if (sectorIndex == 1 && Data.ContainsKey(1))
7909: 			{
7910: 				return Data[1].SectorTime;
7911: 			}
7912: 			if (sectorIndex > 1 && Data.ContainsKey(sectorIndex) && Data.ContainsKey(sectorIndex - 1))
7913: 			{
7914: 				return Data[sectorIndex].SectorTime - Data[sectorIndex - 1].SectorTime;
7915: 			}
7916: 			return null;
```

## Bijlage B. Uitgevoerde byteberekening, geen runtime-fixture

Onderstaande standaard-Pythonberekening is werkelijk uitgevoerd. De herhaalde
maximale binwaarde is bewust een bytebovengrens, niet een valide ritcapture.
Headers/rondetijden/root zijn hier afzonderlijke AFGEDWONGEN ontwerpbudgetten;
dit programma bewijst niet dat een later onbegrensd DTO daarin vanzelf past.
De chunkmeting is de blokwaarde; de werkelijke wire-guard telt ook de rootkey.

```python
import json, math
B = lambda x: len(json.dumps(x, separators=(',', ':'), ensure_ascii=False).encode())
point = [127, 86400000, 6000]
chunk = {
    'schemaRevision': 1, 'observedSessionId': 's'*64, 'segmentId': 'g'*64,
    'traceChunks': [{
        'id': 'i'*64, 'traceId': 't'*64, 'lap': 100000,
        'chunkIndex': 127, 'finalChunk': False, 'points': [point]*64,
    }],
}
r = {
    'maxTupleBytes': B(point),
    'one128PointArrayBytes': B([point]*128),
    '40carsThree128PointArraysBytes': 40*3*B([point]*128),
    'traceMetadataBudgetBytes': 40*3*256,
    'lapHistoryBudgetBytes': 40*20*64,
    'rootAndMetricsBudgetBytes': 32768,
    'storedUpperBoundBytes': 40*3*B([point]*128)+40*3*256+40*20*64+32768,
    'storedCapBytes': 512*1024,
    'packedPointMemoryBytes': 40*3*128*16,
    'chunk64PointsBytes': B(chunk),
    'wirePaceCapBytes': 4096,
    'wireBodyDesignCapBytes': 24000,
    'wireEdgeCapBytes': 24576,
    'remainingBodyForPaceAfter23900Bytes': max(0, min(4096, 24000-23900-1)),
    'all40OneLapPointArraysBytes': 40*B([point]*128),
    'minimumSecondsOneLapAt4096Bps': math.ceil(40*B([point]*128)/4096),
}
assert r['storedUpperBoundBytes'] < r['storedCapBytes']
assert r['chunk64PointsBytes'] < r['wirePaceCapBytes']
print(json.dumps(r, indent=2))
```

Werkelijke uitvoer:

```json
{
  "maxTupleBytes": 19,
  "one128PointArrayBytes": 2561,
  "40carsThree128PointArraysBytes": 307320,
  "traceMetadataBudgetBytes": 30720,
  "lapHistoryBudgetBytes": 51200,
  "rootAndMetricsBudgetBytes": 32768,
  "storedUpperBoundBytes": 422008,
  "storedCapBytes": 524288,
  "packedPointMemoryBytes": 245760,
  "chunk64PointsBytes": 1693,
  "wirePaceCapBytes": 4096,
  "wireBodyDesignCapBytes": 24000,
  "wireEdgeCapBytes": 24576,
  "remainingBodyForPaceAfter23900Bytes": 99,
  "all40OneLapPointArraysBytes": 102440,
  "minimumSecondsOneLapAt4096Bps": 26
}
```

PRODUCTIEWIJZIGING: NEE
