# Source-capabilitymapping — pitsegmenten v1 (T12)

| Werkelijke bron | Daadwerkelijk beschikbaar | Niet geleverd; geen historische dekkingsclaim |
|---|---|---|
| `endurance_telemetry_events` | `event_id`, `team_id`, `race_run_id`, `device_id`, `session_id`, `event_type=pit_entry/pit_exit`, `event_key`, `sequence`, `captured_at`, `completed_laps`, `in_pit_lane`. De writer schrijft `payload.completedLaps/inPitLane`. | Geen P1-bronrevisie/hash, bewezen SDK-sessie/observatie-owner, fysieke car/sessionlink, layout, A→B-afstandsankers, continuïteitscertificaat, gemeten componentintervallen of knownAt. `session_id` is hier transport, niet automatisch observed SDK-session. |
| `endurance_pit_stops` | `id`, event/team/run/device/session, `source=in_pit_lane_edges`, `pit_entry_at`, nullable `pit_exit_at`, `pit_lane_seconds`, `laps_in_pit`, `measured_at`, `created_at`. `pit_lane_seconds` is BRUTO entry→exit inclusief service. De afleiding rondt op drie decimalen af. | Geen netto referentie, servicevrije basis, service-uitkomst of duurzame revisie/hash. Refresh doet delete/insert: `id` bewijst geen duurzame fysieke stopidentiteit door refresh heen. |
| P1 `pitwall_learning.source_revisions` | Alleen `measurement_event`/`lap_summary`; private vijfdelige bronidentiteit `(source_kind,device_id,source_uid,record_revision,content_hash)`, oorspronkelijke observed/received-tijden, compacte payload. Eventpayload heeft o.a. kind, SDK-/delivered-session, segment, session-time, tick, wear, generation en evidence zonder note. | Capture omvat NIET de bovenstaande telemetry-/stoptabellen. Geen historische fysieke pitankers, uitgevoerd-serviceklok, damage/tow/reset/gap-certificaat, owner/car/track/layout of first-known-time. Een legacy stop wordt nooit een gefabriceerd P1-event. |
| Connector `PitServiceTracker` / `TyreAnchorTracker` | Bezoek op ruwe OnPitRoad-flank; lokaal entry/exit session-time/ticks; fuel-leveldelta; serviceverzoeken. `pit_service_completed` bij ongewijzigde wear heeft lage confidence en bewijst geen uitgevoerde bandenwissel. | Verzoeken/flags zijn geen uitvoering. Lokale visitklokken worden niet als stopklokken in de P1-payload gecaptured. Geen bewezen per-component uitgevoerde serviceseconden. |
| Bestaand `strategy/computePitLoss` | Pure bestaande berekening op een expliciet servicevrije pitlanebasis, plus langzaamste servicecomponent. | Ontvangt geen bewezen servicevrije basis uit `pit_lane_seconds`. T12 roept deze functie bewust NIET met bruto data aan en wijzigt dit readonly pad niet. |
| Optionele trusted adaptergrens in deze module | Kan apart geverifieerde, brongebonden context, gemeten A→B-tijden/locaties, normale baantraversal, fysieke identiteit, continuïteit, beschikbaarheid van exacte referentiefacts en uitgevoerde componentintervallen aanleveren. Service-intervallen dragen een expliciete binding aan de vijfdelige uitkomstbron, SDK-sessie, fysieke car/sessie, layout en owner. | Dit zijn LOKALE domeinfacts, GEEN bestaande DB-kolommen, wire-/SDK-velden, connectorrelease of nieuwe capture. Zonder die facts blijft netto onbekend en is er geen stop-specifieke performed-service; positieve tests zijn uitsluitend synthetisch. |

Repository-trace (alleen gelezen; geen productiequery):

- `docs/contracts/pitwall-learning-source-map.md` §3–4, §6 en §10;
  policy-v1 en context-quality-v1 blijven leidend.
- `supabase/migrations/20261110231000_pitwall_pace_storage.sql:919-938`:
  daadwerkelijke pit-edge inserts, veldnamen en transport `p_session_id`.
- `supabase/migrations/20261025122000_endurance_pit_loss.sql:30-56,96-156,177-199`:
  stoptabel, entry/exit-afleiding, afronding, ontbrekende exit en refresh.
- `supabase/migrations/20261111163052_pitwall_learning_evidence.sql:258-324,812-837,900-1009`:
  private P1-revisies, uitsluitend twee bronsoorten en compacte payloads.
- `tools/simhub-plugin/3SM.EnduranceConnector/PitServiceTracker.cs:55-114` en
  `TyreAnchorTracker.cs:175-216`: intent versus observatie; completion-event.
- `src/features/endurance/pitwall/strategy/pitLoss.ts:14-47` en `types.ts`:
  bestaande servicevrije rekenbasis, niet herinterpreteren als bruto.

## Bereik en API

Lokaal, puur, deterministisch; versie `pitwall-learning-pit-segments-v1`.
Geen I/O, Date.now, DB, UI, fitting, advies, pooling, capturewijziging of livewiring.
T09, T10 en T11 blijven ongewijzigd. Geen gedeelde API-uitbreiding nodig.

Exports uit `src/features/endurance/pitwall/learning/pitSegments.ts`:

- `assessPitSegment(input: unknown): PitSegmentAssessment | null`
- `derivePitSegments(input: unknown): PitSegmentAssessment[] | null`
- `describeLegacyPitStop(input: unknown): LegacyPitStopDiagnostic | null`
- `pairPitTelemetryEvents(input: unknown): PairedPitEdges[] | null`
- `PIT_SEGMENT_VERSION`, `PIT_SEGMENT_BATCH_LIMIT=100`;
  types `PitSegmentAnchors`, `PitSpanFacts`, `PitSegmentInput` en bovenstaande outputs.

Invalid top-level analyseklokken/batchvormen leveren null; gewone malformed geneste
JSON levert onbekende facts/redenen in plaats van een throw. De grens is gewone
JSON, geen proxies, cyclische JS-objecten of willekeurige runtime-instanties.

### Gekwalificeerde lokale analyse-invoer

`PitSegmentInput` heeft expliciete `asOf`, `predictorCutoff`,
`maxReferenceAgeSeconds` (geheel 0..31536000), nullable `pitEntryAt/pitExitAt`,
nullable `outcome/reference` en optionele `services`.

Iedere span bevat:

- `startAt/endAt`: werkelijk gemeten A→B-tijden, niet een geëxtrapoleerde rondetijd;
- `anchors`: `basis=distance_metres|sector_boundary`, `originId` (geverifieerde
  fysieke survey/sectorindeling, NIET een displaylabel), `layoutId`,
  `orientation=forward`, `lapWrap=0|1`, numerieke absolute `start/end`-locaties;
- `physicalCarId/physicalSessionId`: sterke fysieke identiteit, niet automodel,
  team, account, device of transport-ID;
- `flags.damage/tow/reset/gap`: ieder expliciet boolean of onbekend/null.
  False attesteert de gehele span, inclusief afwezigheid van lapcounter-/afstandreset;
- `evidence={source,payload,contextEvidence}`: ECHTE T09 `SourceRecordEnvelope`
  plus bijbehorende compacte bronpayload. `contextEvidence` is invoer voor
  `buildCanonicalContext`, inclusief eigen source/payload en optionele claims.
  Die context wordt daarna via T09 aan de geanalyseerde evidence.source en
  payload-SDKsessie/segment gebonden. Andere UID/revisie/hash/tijd/device wordt
  dus niet goedgekeurd omdat de context zichzelf matcht;
- referentie bovendien `normalTrack:true`: bewezen normale on-tracktraversal.
  Geen pitflag is niet voldoende; een expliciete `pit_lap:true` spreekt dit tegen.
  `knownAt` attesteert beschikbaarheid van DEZE exacte referentie, context,
  timingfacts en revisie. Dit is geen afleiding uit receipt en bestaat niet in P1.

De adapter moet deze facts bewijzen en binden; de parser authenticeert niets.
Gebruik een legacy stop nooit als `sourceKind=measurement_event` met een nieuw
verzonnen UID/hash. Daarvoor bestaat de aparte descriptieve legacy-API.

## Duursemantiek en context

De output houdt apart:

1. `grossPitLaneSeconds`: pitlane entry→exit, inclusief service;
2. `segmentSeconds`: volledige A→B-uitkomst via pit en rejoin;
3. `normalSeconds`: gemeten normale baantraversal van exact dezelfde A→B;
4. `netDeltaSeconds`: signed uitkomst minus normale traversal;
5. `serviceUnionSeconds`: uitsluitend daadwerkelijk gemeten interval-unie.

Deze waarden worden nooit bij elkaar opgeteld tot een advies. Bruto is NIET netto
en NIET een servicevrije basis. Er wordt geen gehele rondetijd van een gedeeltelijk
segment afgetrokken. `timing` bewaart valide originele strings, `anchors` de gebruikte
locaties en `provenance` hoogstens twee exacte bron-envelopes. Numerieke duren zijn
JSON-seconden; interne cutoffs, sortering, unie en nettoaftrekking gebruiken 100ns-ticks.
Geen BigInt in publieke DTO's. Grote numerieke JSON-duren hebben de normale
IEEE-754-presentatiegrens; besluitvorming gebeurt vóór die conversie.

Netto vereist alle T09 pit_loss-contextdimensies (owner/driver/device/car/track/layout),
gebonden aan beide bronnen; andere referentie-UID is toegestaan. Zelfde fysieke
car/session én observed SDK-session moeten bekend en gelijk zijn. Dit contract kiest
conservatief geen cross-device-/cross-SDK-/driverhandoff-nettolabel. Zelfs een fysieke
link versoepelt T09 niet; onbewijsbare handoffs blijven uitgesloten. Accountgrenzen
blijven persoonlijk, zonder nieuwe pooling. Transportverschil binnen een gekwalificeerde
referentie is op zichzelf geen SDK-sessiefout. Latest-snapshots vullen niets aan.

Beide anchors moeten EXACT gelijk zijn op basis, survey-origin, layout, richting,
lapWrap en beide locaties. Gelijke lengte of gelijke labels voldoen niet. Zonder wrap
moet end > start; met expliciet één wrap end <= start. Sectorlocaties zijn integers.
Tegengestelde oriëntatie, terugloop zonder bewezen wrap, meerdere wraps en span0 zijn
ongeschikt, met aparte redenen. Adapterfacts mogen geen ambiguïteit wegpoetsen.

T10 wordt hergebruikt voor bronvorm, invalid_reasons, gap, driverhandoff en bij laps
gecertificeerde coverage. De bestaande T10 pit_loss-target heeft bewust géén stoplabel;
dat ontbrekende label wordt niet tot een afwijzing van echte nieuwe adaptertiming
verheven, en evenmin stil aangepast. T12 voegt eigen timing-/continuïteitsgates toe,
inclusief exacte fractieprecisie op de bestaande 300s coverage-futuregrens.

Schade/tow/reset/gap/unknown flags, ontbrekende endpoints/ankers of context blokkeren
standaard netto-/servicetrainlabels; aantoonbaar bruto en losse duren blijven descriptief.
Echte 0 blijft 0; een pitlane/span0 krijgt expliciete uitsluitreden. Negatieve netto-
delta blijft signed beschikbaar met `negative_delta_not_pit_loss_label`, nooit clampen
naar een positief label. Gemeten repair/tow-unie sluit standaard pit_loss-labels eveneens
uit, zonder een goed gemeten retrospectieve delta te wissen. `eligible` is structurele
bronkwalificatie, geen toestemming tot fitting, productieserving of promotie.

## Retrospectief versus predictor

`pitLossLabelEligible` kwalificeert het gemeten retrospectieve label.
`predictorReferenceEligible` staat daar los van: cutoff <= uitkomststart;
referentie-einde en exact sourceReceivedAt <= cutoff; expliciet knownAt tussen
referentie-einde/bronwaarneming en cutoff; leeftijd <= expliciet maximumbudget.
Stale, reference-after-outcome, ontbrekende knownAt en latere revisies krijgen
`predictorReasons` en zijn geen vooraf bekende predictor. Een retrospectief
gekwalificeerde delta mag daarbij wel gemeten blijven. Contextmismatch verhindert
ook die delta. Receipt alleen bewijst NOOIT knownAt.

Alle gezoneerde instants worden met bestaande `isInstant` gevalideerd, inclusief
PG-microseconden en .NET-zeven fractiecijfers. Alleen de gehele ISO-seconde wordt
via Date.parse gelezen; de fractie wordt apart exact toegevoegd. Dit voorkomt
dubbele fractie/timezone, pre-1970-truncatie en Date.UTC's jaar-0..99-special-case.
Geen private T11-helper geïmporteerd en geen tweede datumframework.

Een expliciet `observedAt:null` is onbekend, niet toekomstig:
`source_observation_unknown` (reference: `reference_source_observation_unknown`).
Alleen een geldige waarde met ticks > `asOf` krijgt
`source_observation_after_as_of`. Onbekend blijft conservatief netto blokkeren en
wordt nooit false of 0.

## Services

Optionele `services` heeft `intervals` (maximaal 32) van
`{component,startAt,endAt,performed:true}` en expliciete `complete`-dekking.
Fuel/tyres/repair/tow/stationary worden als werkelijk gemeten intervallen behandeld,
begrensd door pit-entry/exit. Overlap, gedeeltelijke overlap en nesting worden via
interval-unie verwerkt. Unknown component kan een descriptieve gemeten unie leveren,
maar nooit complete standaardcomponentdekking; ongeldige/onuitgevoerde intervallen
zijn geen 0. Een gedeeltelijk bekende unie is `partial`, geen volledige servicetijd.
`stationary` betreft een gemeten stilstandsinterval, niet automatisch brandstof/banden.

`services` is lokale trusted-adapterevidence, GEEN DB-/wireveld. Iedere
performed-claim vereist een expliciet `binding`:
`{sourceKind,deviceId,sourceUid,recordRevision,contentHash,observedSessionId,
physicalCarId,physicalSessionId,layoutId,ownerUserId}` — de vijfdelige
T09-bronidentiteit plus de gebonden SDK-sessie, fysieke car/sessie, layout en
owner van DEZELFDE uitkomst. Ontbrekende, malformed of niet-verifieerbare
binding levert `service_binding_missing`; een aantoonbaar andere waarde levert
`service_binding_mismatch`. In beide gevallen is er geen stop-specifieke
performed-unie en geen complete dekking (`union=null`, `coverage=unknown`),
ook al bevat de input intervallen. Losse identiteitsclaims op blokniveau of per
interval (`binding`, of direct `sourceKind/deviceId/sourceUid/
recordRevision/contentHash/observedSessionId/sessionId/physicalCarId/
physicalSessionId/layoutId/ownerUserId`); die moeten exact bij de uitkomst
passen. Een afwijking op blokniveau is `service_binding_mismatch`; per interval
wordt alleen dat interval uitgesloten met `service_interval_binding_mismatch`.
`sessionId` is in deze lokale
service-evidence de observed SDK-sessie, niet de transportkolom. Zo worden
stale/cross-contextintervallen nooit stil als performed voor een andere stop
geteld. Dit is geen cryptografische authenticatie: de caller is trusted, maar
de binding voorkomt accidentele cross-ride-associatie.

Beschikbaarheid geldt ook voor services, met 100ns-vergelijking. Een interval
met `endAt > asOf` is nog niet uitgevoerd/waargenomen: het wordt niet
meegeteld en niet tot `asOf` geclipt; `service_after_as_of` maakt de dekking
onvolledig. Een volledig voor `asOf` afgerond interval in een nog open pitwindow
(`pitExitAt > asOf`) blijft als descriptieve gemeten unie bewaard, maar
`serviceCoverage` is dan `partial` met `service_pit_window_open`, nooit
`complete`, en `serviceLabelEligible` blijft false. `complete` vereist dus een
gesloten stop én alle intervallen volledig voor `asOf`. Een gesloten stop met
geldige volledig voorbije intervallen blijft positief `complete`.

Een expliciet `intervals: []` met `complete:true` is een echte, bevestigde
nulmeting en levert unie 0. Dat staat los van een niet-nulle
`predictedServiceSeconds` uit een geverifieerde compositie: meting 0 en
predictie 20 zijn verschillende feiten. `serviceLabelEligible` zegt dan dat de
meting compleet is en de compositie geldig is, niet dat een getraind model 20
seconde voorspelt of dat 0 en 20 moeten overeenkomen. Een onbekende of
ontbrekende intervallijst is geen bevestigde 0 en levert geen complete dekking.

Afzonderlijke optionele compositie:
`components=[{component:fuel|tyres,seconds}]` (maximaal 16, geen dubbele component),
`componentsComplete:true`, `ruleset={id,verified:true,mode:parallel|sequential,
physicalSessionId,layoutId}`. Alleen een aan de uitkomst gekoppelde bevestigde regel
mag respectievelijk max of som uitdrukken; geen universele aanname. Onbekend component
is niet 0. Niet-standaard repair/tow wordt niet tot normale servicekosten verheven.
`predictedServiceSeconds` is deze expliciete rekencompositie, geen model/fitting en
niet de gemeten unie. `serviceLabelEligible` vereist daarnaast een geldige
stopbinding, complete gemeten unie, gekwalificeerde bron/context en geen repair/tow.
Unknown rules blokkeren component- / economische aannames, niet onafhankelijk bruto
of goed geankerde netto delta.

## Automatische pairing, retries en revisies

`pairPitTelemetryEvents({asOf,events})` accepteert maximaal 100 items:
`{row,availableAt,continuity}`. `row` gebruikt uitsluitend echte bovengenoemde
telemetrykolommen; de andere twee velden zijn lokale trusted-adapterfacts, geen
DB-/wirevelden. `continuity={ownerUserId,observedSessionId,layoutId,physicalCarId,
physicalSessionId,continuityId,flags}` attesteert identiteit en een volledig geverifieerd
continu venster. Zonder dat bewijs blijven edges orphan/descriptief.

Eerst expliciete beschikbare records filteren (`availableAt <= asOf`, 100ns),
dan exact op captured_at sorteren (bij gelijke tijd native `sequence` als
tie-break wanneer beide edges die hebben; nooit een verzonnen 0), en retries
dedupliceren. `availableAt` is zichtbaarheid van het adapteritem, geen
eventinhoud en geen immutable knownAt: een latere retry van dezelfde rij en
dezelfde continuity is hetzelfde event, geen conflict en geen extra orphan.
Deduplicatie/conflict gebruikt de semantische rij plus continuity, exclusief
`availableAt`. Unbound rijen (ontbrekende native partitiekeys) worden
uitsluitend op exact gelijke semantische rij+continuity gededupliceerd tot één
orphan; zij worden nooit gepaird en verschillende ongerelateerde unbound rijen
worden niet samengevoegd. Partitionering is
event/team/run/device/transport-session; verandering van
owner/SDK-session/layout/physical identity/continuity, unknown flags,
zichtbare lapcounterreset, conflicten of ongeldige edgeflags verbreken open
pairing. Een beschikbaar event zonder ordentijd maakt de batch ongeldig, niet
onzichtbaar. Open entry en orphan exit blijven afzonderlijke diagnoses met null
duur. Nultijd blijft 0 met reden. Output bevat de oorspronkelijke entry/exit-rijen;
geen P1-provenanceclaim. `availableAt` bewijst zichtbaarheid van het adapteritem,
niet first-known-time voor voorspellingen. Caller moet relevante tussenliggende
breuken meeleveren of via het continuïteitscertificaat uitsluiten: deze module doet
geen verborgen historie-/DBscan.

`derivePitSegments({asOf,segments})` verwerkt maximaal 100 adapteranalyses. Eerst
receipt-cutoff (`<= asOf`, 100ns), dan per outcome
`(sourceKind,deviceId,sourceUid)` de hoogste beschikbare revisie. Binnen die
hoogste revisie bepaalt de vijfdelige P1-identiteit plus de inhoudelijke
adapterfacts of iets een retry/correctie of een conflict is. Deliverymetadata
(`sourceReceivedAt` op outcome/reference en hun contextEvidence-source) is geen
semantische identiteit: dezelfde vijfdelige identiteit met identieke facts is
één stop, ook bij een latere receipt of andere JSON-keyvolgorde. De
representative is deterministisch en order-onafhankelijk: eerst availability
filteren, dan de canonieke vroegste receipt binnen de gekozen facts. Daarbij
blijft de gekozen rij intact, zodat `contextEvidence.source` correct gebonden
blijft. Echte causale facts (knownAt, context, flags, timing, anchors,
servicebewijs) worden niet als deliveryruis verwijderd.

Een andere hoogste hash, of afwijkende adapterfacts bij dezelfde hoogste
revisie, blijft een conflict: netto en alle labels false,
`revision_or_adapter_conflict` in `reasons`, `predictorReasons` én
`serviceReasons`. Toekomstige (na `asOf` ontvangen) revisies/conflicten worden
vóór deze selectie gefilterd en vergiftigen geen beschikbare stop; er is geen
fallback naar een ongeldige hoogste revisie. Een referentierevisie wordt
eveneens pas na receipt-filter gekozen. Nieuwe aanroep herleidt de output
opnieuw zonder bronrijen te muteren. Verschillende reference-UID's voor één
outcome worden conservatief niet willekeurig gekozen. Redenen zijn vaste,
gesorteerde unieke codes; hoogstens twee bronrefs per analyse. Geen nieuwe
stop-UID/hash voor mutable legacydata.

`describeLegacyPitStop(row)` bewaart echte legacy-identifiers zonder string-sentinels,
berekent waar mogelijk entry→exit of bewaart een geldig opgeslagen bruto getal met
incomplete-/disagreediagnose. Netto blijft altijd null. Deze API heeft bewust geen
historische as-of- of revisiegarantie. De disagreement-tolerantie is versioned en
exact: een opgeslagen duur die ≤ 10000 ticks (1 ms, inclusief) van de
entry→exit-tickduur afwijkt, is geen disagreement; pas daarboven volgt
`legacy_duration_disagrees`. De bruto duur blijft de exacte entry→exit-seconden
(of een geldige opgeslagen waarde) en wordt niet in een andere eenheid
geherinterpreteerd.

## Bewijs en T13-grens

Tests in `pitSegments.test.ts` bevatten positieve synthetische niet-null controles,
een echte gedrags-RED vóór netto-implementatie, traced P1-/telemetry-/stopvormen,
T09-binding/T10-coverage-integratie, adverse/unknown flags, overlappende services,
correcties/conflicten, orphan edges, layout/ankermismatch, signed delta, stale/future
references en micro/100ns/calendar/offsetgrenzen. Daarnaast zijn retry-idempotentie
met latere receipt/`availableAt`, unbound deduplicatie, service-`asOf`, service-
contextbinding, NULL-`observedAt` en de legacy-tickgrens als regressies vastgelegd.
Geen historische nauwkeurigheidsclaim.

Eigen logs en final-REPORT.md van deze herstelronde staan uitsluitend onder
`/home/hermes/artifacts/3sm/pitwall-learning-p2-pit-evidence/` (0700). De
oorspronkelijke bouwlogs blijven onveranderd in
`/home/hermes/artifacts/3sm/pitwall-learning-p2-pit-segments/`.
Parent verricht afzonderlijke SPEC- en QUALITY-review en finalintegration/build.

T13 kan later de bewezen gaten beoordelen: duurzame pit-edge/stopcapture, fysieke
ankers/referenties, sterke historische owner/car/session/contextbinding,
continuïteitsflags, immutable knownAt en werkelijk uitgevoerde componentklokken.
Dit document implementeert GEEN optionele SDKvelden en geeft geen connector-/DB-GO.
PRODUCTIEWIJZIGING: NEE.
