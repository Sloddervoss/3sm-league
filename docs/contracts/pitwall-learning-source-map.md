# Pitwall-learning — broncontract (P0)

Status: **P0-broncontract, geen functionele wijziging**.
Baseline: `c0cf8f194a86898621b26dd4ffa41956f1e8ecf3`, branch `docs/pitwall-learning-source-map`.
Doel: exact vastleggen welke bestaande bronnen de zelflerende pitwallketen vullen, welke
tijd/eenheid/identiteit/revisie/hash/label daarbij horen, en welke gaten beslissend zijn
voor training. Dit document is geen GO voor P1 en doet geen uitspraak over modelnauwkeurigheid.

## 0. Bewijsstatus en afbakening

- Alleen repository-bewijs en de door parent aangeleverde read-only live-catalogus zijn gebruikt.
  Geen SSH, geen remote SQL, geen productieactie, geen commit/push.
- Parent heeft op **2026-11-11 15:35:56Z** read-only op PG15.19 vastgesteld dat de live
  storefunctie `simhub_persist_measurement_batch(p_device_id uuid, p_session_id text,
  p_events jsonb, p_laps jsonb)` bestaat, met `pg_get_functiondef`-SHA256
  `ace4d500960d4853624b039fdf25f3293f9054b79b086aa26ff600baae8dde35`.
  De parent heeft daarna ook de live achtargumentensignatuur van `simhub_persist_v3`,
  de body en de ACK-doorgifte bevestigd; de afgesloten livecontroles staan in §14.
- Parent heeft live bevestigd dat `simhub_measurement_events` en `simhub_lap_summaries`
  **geen** owner-, car-, track- of compoundkolommen hebben. Die afwezigheid is hier dus
  een live-feit, geen repo-afleiding.
- Parent heeft op dezelfde read-only wijze geteld: `simhub_lap_summaries` heeft
  `pit_lap=true` 107, `pit_lap=false` **0**, `pit_lap IS NULL` 317;
  `driver_changed=true` 2, `driver_changed=false` **0**, `IS NULL` 422;
  `complete=true` 339, waarvan 299 met `pit_lap IS NULL`. Dit is een **live-telling**,
  geen bewijs dat er geen normale rondes bestaan (zie §3.3).
- Clock-diagnostiek (live): 208 van 424 lap summaries hebben `ended_at > received_at`
  (max **2,678363 s**); 116 van 201 meetevents hebben `observed_at > received_at`
  (max **2,622697 s**); geen enkele overschrijding in deze richting boven 60 s.
  Deze tellers zien op clienttijd ná serverontvangst en passen bij kleine klok-/ordenings-
  verschillen. In de tegengestelde richting hebben 5 lap summaries juist meer dan één
  dag tussen `ended_at` en de opgeslagen `received_at`; late levering of revisie is
  daarmee niet uitgesloten. `received_at` is niet immutable (zie §3.2).
- Waar hieronder “repo” staat, is het bewijs uit deze worktree. Waar “live” staat, is het
  door parent read-only bevestigd. Repo-migraties met de kop “voorstel” zijn historische
  tekst en bewijzen op zichzelf geen live-status.
- De live-hash hierboven is bewijs van de gelezen functiedefinitie, niet van datalabels,
  modelkwaliteit of volledigheid van de historie.

### Positieve zoekcheck voor ontbrekende provenance

De volgende zoekacties zijn breed uitgevoerd over de repo (exclusief `node_modules`,
locks en `public/`):

| Term | Uitkomst |
|---|---|
| `regulations` / `regulation` | **0 hits** in de hele repo. |
| `wet` / `dry` | Alleen handmatige `conditions` in practice/pace-modellen en UI; geen telemetrie-, tyre- of regulationpad. |
| `compound` | Alleen `PlayerTireCompound` → `V3Tyres.compoundId`, en `compound_id` in `simhub_tyre_lap_samples`; niet in meetevents, lapSummaries, anchors of pitstops. |
| `carId` / `trackId` / `trackConfig` | Wel in frame-identity en telemetrie-latest; niet in `simhub_measurement_events` of `simhub_lap_summaries`. |
| live-catalogus | `simhub_measurement_events` en `simhub_lap_summaries` hebben geen owner/car/track/compoundkolommen (parent). |

Daarmee is “afwezig” hier een **positief gezochte afwezigheid** in repo en, voor de twee
meetrijen, een live-geverifieerde afwezigheid. Voor het volledige live schema buiten die
twee rijen is de afwezigheid niet door mij bewezen; parent moet dat bij de live-audit sluiten.

## 1. Kort oordeel

| Target | Wat bewezen is | Wat ontbreekt | Blokkerend? |
|---|---|---|---|
| Fuel next-lap | Brandstof per ronde uit run-scoped `endurance_strategy_lap_samples`; panel toont `fuel_samples`; rekenkern heeft mediaan/MAD. | Geen opgeslagen “next-lap”-voorspelling; geen duurzame eventidentiteit/revisie op de fuelmeting; driver/car/track/compound ontbreken op de fuelrij. | Niet voor een run-scoped verbruiksschatting; **wel** voor driver-/auto-/baanbrede training. |
| Pit net loss | Gemeten pit-entry/pit-exit en `pit_lane_seconds` (bruto), plus `computePitLoss` met servicecomponent. | Geen netto verlies t.o.v. een referentieronde; `pit_lane_seconds` is bruto entry→exit (service inbegrepen); service-seconden worden nergens gevuld; advance krijgt de waarde niet. | **Ja** voor netto verlies. Bruto pitlanetijd is wel bruikbaar. |
| Tyre per-wheel wear at next anchor | Per-hoek wear vóór/ná in meetevents; per-hoek wear in `simhub_tyre_observations`, `simhub_tyre_lap_samples`, `endurance_tyre_anchors`; per-hoek hellingen in `tyre_stint_deltas`; priorpool per hoek. | Geen expliciete voorspelling “wear per hoek bij het volgende anker”; model kiest één zwakste hoek; `setGeneration` en `confirmed` worden niet door het model gebruikt; geen bewezen per-hoek service-uitkomst. | Niet voor gemeten per-hoek wear; **wel** voor per-hoek voorspelling en voor partial-wheel/daadwerkelijke service. |
| Later economic pace | Pure `evaluateTyreWear` (brandstofgecorrigeerde Theil-Sen) en `decideTyreChange` bestaan; data voor een run-scoped fit is aanwezig. | Geen productie-aanroep, geen opgeslagen economic-pace-uitkomst, geen gezamenlijke driver/car/track/compoundcontext per lap. | **Ja** voor een target-output; niet voor een offline run-scoped fallback. |

## 2. Keten in één beeld

```
Connector (C#)
  frame: identity + telemetry + fuel + tyres + pitService
         + measurementEvents[] + lapSummaries[]
        │
        ▼
Edge simhub-ingest-v3
  parse (simhub.ts / simhubExtensions.ts)
  snapshotDto: meetreeksen eruit
  p_events / p_laps als aparte RPC-parameters
        │
        ├── simhub_persist_v3 (8 args)
        │      ├── snapshot → simhub_telemetry_latest
        │      ├── fuel per ronde → endurance_strategy_lap_samples
        │      ├── pit_entry/pit_exit → endurance_telemetry_events
        │      ├── tyre-exit-anker → endurance_tyre_anchors
        │      └── p_events/p_laps → simhub_persist_measurement_batch
        │                               ├── simhub_measurement_events
        │                               └── simhub_lap_summaries
        ├── simhub_record_lap_times → simhub_lap_times
        └── simhub_record_tyre_observations → simhub_tyre_observations

Parallelle tyre-leerlus:
  simhub_telemetry_latest trigger
    → simhub_tyre_lap_samples
    → tyre_stint_deltas
    → tyre_prior_stats / tyre_prior
    → pitwall_tyre_estimate_v2 (device)  [testpagina]
  endurance_tyre_anchors
    → pitwall_tyre_estimate_v1 (event/team/run) [gewone pitwall]

Leeslus:
  get_pitwall_data → usePitwallData → usePitwallStrategy / panelen
  get_simhub_device_details + pitwall_tyre_estimate_v2 → PitwallDeviceTestPage
```

Belangrijk: er zijn **drie parallelle tyre-waarheden** (meetevents, lap-samples/stint-deltas,
pit-exit-ankers). Ze zijn niet door één gedeelde UID verbonden. Dat is de kern van de
provenance-gaten in dit document.

## 3. Tijd, identiteit, revisie, hash en label

### 3.1 Duurzame identiteit

| Veld | Bron | Betekenis | Verandert? |
|---|---|---|---|
| `eventUid` | connector, `MeasurementIds.NewEventUid()` (`MeasurementIds.cs:149-153`) | duurzame UUID per meetgebeurtenis; dedupe `(device_id,event_uid)` | nooit |
| `summaryUid` | connector, `MeasurementIds.NewSummaryUid()` (`MeasurementIds.cs:155-159`) | duurzame UUID per rondeaggregaat; dedupe `(device_id,summary_uid)` | nooit |
| `eventId` | connector, `evt-N` (`MeasurementIds.cs:165-169`) | leesbaar label, **geen** dedupe | mag hergebruikt worden na herstart |
| `summaryId` | connector, `lap-N-M` (`MeasurementIds.cs:178-183`) | leesbaar label, **geen** dedupe | mag hergebruikt worden |
| `observedSessionId` | connector (`MeasurementEvent.cs:368`) | sessie waarin de waarneming is gedaan; blijft bij herverzending | nooit |
| `deliveredSessionId` | server | sessie waarin de rij werd afgeleverd | per aflevering |
| `segmentId` | connector, lokaal segment | context, geen identiteit; reset per segment | per segment |
| `pitVisitId` | connector, lokaal bezoek | context, geen identiteit | per bezoek |
| `sdkTick` | connector | SDK-tick; pas bruikbaar samen met sessie | per tick |

De DB legt de uniciteit vast op `(device_id,event_uid)` en `(device_id,summary_uid)`
(`20261031190000_plugin08_measurement_identity.sql:89,111`). `transport_session_id`,
`delivered_session_id` en `segment_id` maken daar geen deel van uit. `eventUid`/`summaryUid`
zijn dus de enige veilige join- en dedupe-sleutels.

### 3.2 Tijd: observedAt, received_at en het ontbrekende knownAt

| Tijd | Waar | Betekenis |
|---|---|---|
| `observedAt` / `observed_at` | event, lap summary, tyre observation | tijd van de waarneming volgens de connector; nooit vervangen door ontvangsttijd |
| `capturedAt` | frame-envelope | verzendmoment van het frame; **niet** opgeslagen op event/lap |
| `sessionTimeSeconds` / `session_time_seconds` | event, frame, tyre observation | iRacing-sessietijd; alleen grenzen/volgorde, niet de wandklok |
| `startedAt` / `endedAt` | lap summary | eerste geaccepteerde tick respectievelijk ronde-grens; **geen** expliciete `lapTimeSeconds` |
| `received_at` | event, lap summary, snapshot | wanneer de server de rij (laatst) aannam; **geen** eerste-known-time |
| `EnqueuedAtUtc` | outbox | lokale wachttijd; wordt niet meegestuurd en verdwijnt na ACK |

**Er bestaat geen `knownAt`/`first_known_at`.** `received_at` is bovendien niet immutable:
bij een hogere `recordRevision` zet de schrijver `received_at = now()`
(`20261031200500_plugin08_supersedes_hash.sql:170,278`). Na een late correctie is dus niet
meer te zien wanneer de oorspronkelijke waarneming voor het eerst bekend was. De outbox
bewaart `EnqueuedAtUtc` lokaal (`MeasurementOutbox.cs:20-27, 629-646`), maar dat is geen
serverbewijs en is na bevestiging weg.

`MeasurementLapSummaryDto` bevat **geen** `lapTimeSeconds` en **geen** `wear_fl/fr/rl/rr`.
De ronde draagt alleen `startedAt`/`endedAt`, brandstofintegralen, `coverage`,
`sampleCount`/`maxGapSeconds`/`validDurationSeconds`, en de ID-verwijzingen
`pitVisitIds`/`wearObservationIds` (`MeasurementEvent.cs:112-147`). Een echte rondetijd
komt uit het frame (`timing.lastLapTimeSeconds`) of uit `simhub_lap_times`; een wearwaarde
komt uit de meetevents of de tyre-tabellen. `complete` vereist daarbij een geldig venster
en dekking per groep (minimaal 10 samples, gat ≤ 2 s, ≥ 80% van het venster)
(`simhubExtensions.ts:541-597`). Zonder `startedAt`/`endedAt` is er geen bewijs en is de
ronde niet compleet, ook al staan er integraalwaarden in.

Voor tyre-ankers is `observedAt` de wear-meettijd (eerste keer dat de wearwaarde werd gezien),
niet het verzendmoment (`TelemetryContractsV3.cs:131-136`). De “voor”-tijd van een anker staat
**niet op de draad**: alleen `wear_before_age=<seconden>` in de evidence-note
(`TyreAnchorTracker.cs:226-243`). Er is dus geen tweede tijdveld voor `wearBefore`.

#### Clockdiagnostiek en sessiedomeinen

De live-tellingen `ended_at > received_at` (208/424, max 2,678363 s) en
`observed_at > received_at` (116/201, max 2,622697 s) zijn **kleine klok-/ordenings-
verschillen**. Ze zijn geen bewijs van late levering: `received_at` is de servertijd
waarop de rij werd weggeschreven, en de clienttijd kan enkele seconden voorlopen. Er is
geen enkele overschrijding boven 60 s. Omdat `received_at` bij een revisie opnieuw op
`now()` wordt gezet (`20261031200500:170,278`), is het bovendien geen first-known- of
leeftijdsmaat.

`observed_session_id` (SDK/sessie aan de clientkant) en `delivered_session_id`
(transport-/afleversessie aan de serverkant) zijn **verschillende ID-domeinen**. Dat alle
424 lap summaries en 201 events een verschillend paar hebben, is daarom **geen**
late-delivery-signaal. Gebruik voor lateness uitsluitend `observed_at`/`captured_at`
tegenover `received_at`, niet de sessie-ID's.

### 3.3 NULL versus false in `simhub_lap_summaries`

De live-telling `pit_lap=false` 0 en `driver_changed=false` 0 is **geen** bewijs dat
zulke rondes niet bestaan. De bron maakt `false` zelf onbereikbaar:

- `LapAccumulator.Close` schrijft `PitLap = _pitLap ? true : (bool?)null` en
  `DriverChanged = _driverChanged ? true : (bool?)null`
  (`LapAccumulator.cs:333-386`, specifiek `:362-364`). De accumulator heeft alleen een
  `bool`-vlag; bij “geen pitronde” of “geen wissel” gaat **null** de DTO in, niet `false`.
- `MeasurementLapSummaryRecord.ToDto` kopieert die null zonder `coalesce`
  (`MeasurementEvent.cs:478-525`), en `MeasurementLapSummaryDto.PitLap` /
  `DriverChanged` zijn `bool?` met `EmitDefaultValue=false`
  (`MeasurementEvent.cs:127-128`). De serializer laat een null weg; hij maakt er geen
  false van. Omdat `false` de serializer nooit bereikt, is de vraag “zou de serializer
  false hebben weggelaten?” hier niet beslissend: het verlies zit al **vóór** de serializer.
- De Edge-parser `optBoolean` laat `undefined`/`null` null en geeft een aanwezige
  `false` ongewijzigd door (`simhubExtensions.ts:85-90`). Er is geen `?? false`.
- De database gebruikt `public.simhub_jbool`, een `STRICT` SQL-functie: ontbrekende sleutel
  → SQL NULL; expliciete `false` → `false` (`20261031180300:209-214`). De schrijver doet
  `v_pitlap := public.simhub_jbool(...)` zonder `coalesce` en slaat die null op
  (`20261031200500:948-949,1064-1065`). Ook daar is geen stille NULL→false-conversie.

**Conclusie:** de 317 `pit_lap IS NULL` en 422 `driver_changed IS NULL` zijn een
**bron-side samensmelting van “false” en “onbekend”**, geen serializer-omissie en geen
database-default. Een strikte query `pit_lap = false` levert daarom structureel 0
fuelkandidaten; zij bewijst niet dat er geen normale rondes zijn. Een query
`pit_lap IS NOT TRUE` levert 317 kandidaten, maar dat is “niet als pit gemarkeerd”,
niet “bewezen normale ronde”. Voor een fuelkandidaat moet je daarnaast `complete`,
`coverage`, `invalid_reasons` en de aanwezigheid van een pit_entry-event controleren.
Dezelfde logica geldt voor `driver_changed`: alleen `true` is een bewezen wissel; null is
“geen wissel of onbekend”.

### 3.4 Revisie en hash

- `recordRevision` is een geheel getal 1..100000 (`MeasurementEvent.cs:426`,
  `20261031190100_plugin08_measurement_revisions.sql:29-31,48-50`).
- Zelfde UUID + hogere revisie = **update van dezelfde rij**. De update vervangt alle
  meetvelden, `delivered_session_id`, `segment_id`, `pit_visit_id`, `event_id`,
  `observed_at`, `received_at`, `content_hash`, enz. (`20261031200500:150-173` voor events;
  `:240-281` voor laps).
- Zelfde revisie + zelfde hash = duplicaat; zelfde revisie + andere hash =
  `revision_conflict`; lagere revisie = `stale_revision` (`20261031200500:180-193` en
  `:288-295`).
- Een **nieuwe** gebeurtenis met `supersedesEventUid` / `supersedesSummaryUid` laat de oude
  rij staan. Dat is de enige manier waarop de oude inhoud bewaard blijft.
- De hash is `md5` over de opgeslagen meetvelden. Eventhash: `segment_id`,
  `observed_session_id`, `pit_visit_id`, `kind`, `observed_at`, `session_time_seconds`,
  `sdk_tick`, `wear_before`, `wear_after`, `set_generation`, `evidence`, `confidence`,
  `supersedes_event_uid` (`20261031200500:60-73`). Laphash: de lap- en coveragevelden plus
  `supersedes_summary_uid` (`:75-100`). **Niet** in de hash: `event_uid`/`summary_uid`,
  `event_id`/`summary_id`, `record_revision`, `device_id`, `delivered_session_id`,
  `received_at`. De hash is dus een inhoudsvingerafdruk, geen rij-identiteit.
- De hash wordt bij elke revisie opnieuw berekend; oude hashwaarden worden niet bewaard.

### 3.5 Wat historisch wordt overschreven

| Bron | Overschrijving | Gevolg voor training |
|---|---|---|
| `simhub_measurement_events` | Hogere revisie update dezelfde rij, inclusief `received_at`; oude waarden weg. | Alleen de laatste revisie is leesbaar; eerdere wear/evidence/tijd niet. Gebruik `supersedes` als je historie wilt. |
| `simhub_lap_summaries` | Idem; ook `current_driver_id`, `current_driver_name`, `coverage`, `complete`, `invalid_reasons`. | Een latere driver-resolutie of coverage-correctie overschrijft de oude; geen driverhistorie. |
| `simhub_telemetry_latest` | Eén rij per device, upsert met laatste frame/identity (`20261110231000:838-866`). | Geen historische snapshot; een latere auto/baan/rijder mag nooit als oude context worden gelezen. |
| `endurance_strategy_latest` | Eén rij per race-run, steeds nieuwe gemiddelden/status. | Geen historie van eerdere schattingen. |
| `endurance_strategy_lap_samples` | `ON CONFLICT (race_run_id,completed_laps) DO NOTHING` (`20261024200000:169-182`). | Eerste ronde wint; latere correctie van fuel/lap_time overschrijft niet. Wear wordt alleen gevuld als alle vier leeg zijn (`20261110231000:883-891`). |
| `simhub_tyre_lap_samples` | Upsert per `(device_id,session_key,lap_number)`; `wear = coalesce(excluded.wear,a.wear)`, `captured_at` wordt vervangen (`20261027180000:103-117,212-228`). | Laatste frame binnen de ronde wint; eerdere wearmomenten binnen dezelfde ronde gaan verloren. |
| `endurance_tyre_anchors` | `ON CONFLICT (race_run_id,stint_no) DO NOTHING` (`20261110231000:1025`). | Het eerste pit-exit-anker per stint wint. Is dat anker `frozen`/`anchor_usable=false`, dan kan een later, beter frame dat niet meer corrigeren. |
| `endurance_pit_stops` | `refresh_endurance_pit_stops` doet `delete` + insert per event (`20261025122000:177-199`). | Het is een afgeleide momentopname, geen historie; eerdere stops/waarden blijven niet bewaard. |
| `simhub_lap_times` | `ON CONFLICT ... DO NOTHING` (`20261103190000:90-96`). | Eerste bewezen rondetijd wint; een latere correctie wordt niet opgeslagen. |
| `simhub_tyre_observations` | `ON CONFLICT (device_id,session_key,frame_sequence) DO NOTHING` (`20261104120000:162`). | Append-only ruwe waarneming; geen revisie, maar ook geen correctie. |

## 4. Waar identiteit en context werkelijk vandaan komen

### 4.1 Rij-niveau

| Rij | device | owner | driver | event/team | session | segment | car/track/compound |
|---|---|---|---|---|---|---|---|
| `simhub_measurement_events` | `device_id` (afleveraar) | **nee** | **nee** | **nee** | `observed_session_id`, `delivered_session_id` | `segment_id` | **nee** |
| `simhub_lap_summaries` | `device_id` | **nee** | `current_driver_id` (server-resolved) + `current_driver_name` | **nee** | `observed_session_id`, `delivered_session_id` | `segment_id` | **nee** |
| `simhub_tyre_observations` | `device_id` | via device | `driver_name` (tekst) | event/team snapshot | `session_key` (transport) | **nee** | **nee** (raw bevat alleen het tyres-blok) |
| `endurance_tyre_anchors` | `device_id` | via device | **nee** | event/team/run snapshot | `session_id` | **nee** | **nee** |
| `endurance_strategy_lap_samples` | `source_device_id` | via device | **nee** | event/team/run | `source_session_id` | **nee** | **nee** |
| `simhub_lap_times` | `device_id` | via device | **nee** | **nee** | `session_key` | **nee** | `car_id` |
| `endurance_pit_stops` | `device_id` | via device | **nee** | event/team/run | `session_id` | **nee** | **nee** |
| `simhub_telemetry_latest` | `device_id` | `owner_user_id` | `current_driver_id`/`name` | event/team/run | `session_id` | **nee** | `car_id`, `car_name`, `track_name`, `track_config` |

Bronnen: `20261031180000:30-110`, `20261031180100:35-100`, `20261104120000:11-58`,
`20261110231000:840-866,940-1025`, `20261025122000:30-55`, `20261103190000:14-29`,
`20260716170000:24-66`. Live: events en laps hebben geen owner/car/track/compound
(parent, 2026-11-11).

### 4.2 Harde regel voor latere snapshots

Een meetrij mag **nooit** zijn context krijgen door naar `simhub_telemetry_latest` of
`simhub_devices` te joinen. Die rijen bevatten de **huidige** owner/binding/auto/baan/rijder.
Een oude meting zou daarmee de context van een latere sessie of een ander device krijgen.
Alleen wat bij de waarneming of aflevering is vastgelegd, is geldig:

- events/laps: alleen `device_id`, observed/delivered session, segment, (lap) drivernaam;
  geen event/team/car/track/compound → joinen naar latest is **verboden** voor historie.
- tyre observations/anchors: event/team/run-snapshot is wel aanwezig; car/track/compound
  niet → die mogen niet uit latest worden aangevuld.
- `get_pitwall_data.latest_v3` kiest de laatste `simhub_telemetry_latest` op team/event
  (`20261110231000:1203-1221`). Dat is een live-paneelkeuze, geen historische identiteit.
  Bij meerdere devices in hetzelfde team/event kan de getoonde identity dus van een ander
  device komen dan de strategierij; de strategie zelf is wel op `race_run_id` gefilterd
  (`:1223-1229`).

### 4.3 Session en segment

- `observed_session_id` komt van de client en blijft bij herverzending gelijk.
- `delivered_session_id` is de sessie waarin de server de rij aannam; `transport_session_id`
  is in de praktijk dezelfde afleversessie (`20261031200500:629-630`).
- `segment_id` is een lokaal segment (`seg-<12 hex>`), reset per segment/pluginstart; het is
  context, geen identiteit. `pitVisitId` is lokaal per segment.
- `lap_number` reset per sessie. Een join op alleen `lap_number` is dus ongeldig; gebruik
  minimaal `device_id` + `observed_session_id` + `lap_number` (of de UID).

## 5. Target 1 — Fuel next-lap

### 5.1 Bewezen bronpad

1. **Frame**: `fuel.fuelLitres`, `fuel.fuelPerLapLitres`, `fuel.fuelCapacityLitres`
   (`supabase/functions/_shared/simhub.ts:602-608`). Eenheid: liter, liter/ronde, liter.
2. **Per-rondemeting**: `simhub_persist_v3` roept `simhub_update_strategy_v3` aan met
   `nl`, `v_fuel`, `np`, `v_last_laptime` (`20261110231000:876-878`). Die functie:
   - opent een nieuwe fuel-stint bij pit-exit (`20261024200000:53-65`);
   - keurt een sample alleen goed bij exact `+1` ronde, geen pitlane, brandstof gedaald en
     een bestaande vorige grens (`:78-122`);
   - schrijft altijd één rij per `completed_laps`, met `fuel_start_litres`,
     `fuel_end_litres`, `fuel_used_litres`, `lap_time_seconds`, `valid_fuel_sample`,
     `exclusion_reason`, `fuel_stint_id` (`:169-182`);
   - berekent `fuel_per_lap_litres` (stintgemiddelde) en `race_fuel_per_lap_litres`
     (rungemiddelde) (`:186-205`);
   - berekent `fuel_laps_remaining = fuel / fuel_per_lap` (`:217-221`) en
     `fuel_to_finish_litres` alleen bij bekende `session_laps_remaining` (`:223-240`).
3. **Leespad**: `get_pitwall_data.fuel_samples` geeft de laatste 20 geldige
   `(lap, used, lap_time, captured_at)` van de actieve run, nieuwste eerst
   (`20261110231000:1312-1332`).
4. **Rekenkern**: `estimateFuelPerLap` doet mediaan + MAD-uitbijterfilter + pessimistische
   uplift (`src/features/endurance/pitwall/strategy/fuelModel.ts:45-100`);
   `lapsOnFuel` en `fuelToAddForFinish` gebruiken die per-lapwaarde
   (`:103-136`). `buildStrategySnapshot` kiest als prior
   `race_fuel_per_lap_litres` → `fuel_per_lap_litres` → `v3.fuel.fuelPerLapLitres`
   (`snapshot.ts:63-67`).
5. **Panelen**: `FuelPanel` toont `strategy.fuel_per_lap_litres`,
   `race_fuel_per_lap_litres`, `fuel_to_finish_litres` en de `fuel_samples`-varianten
   (`FuelPanel.tsx:41-62`). `fuelVariants` maakt EST/avg5/max/min
   (`fuelVariants.ts:73-115`).

### 5.2 Eenheid, tijd, identiteit, revisie/hash/label

| Aspect | Waarde |
|---|---|
| Eenheid | liter; liter/ronde; rondes; seconden |
| Tijd | `captured_at` per ronde; `completed_laps` als volgorde; `lap_time_seconds` uit `lastLapTimeSeconds` |
| Identiteit | `(race_run_id, completed_laps)` in `endurance_strategy_lap_samples`; geen `eventUid` |
| Revisie | **geen**; eerste insert wint (`ON CONFLICT DO NOTHING`), geen `record_revision` |
| Hash | **geen** |
| Label | geen duurzaam label; `completed_laps` is het enige volgnummer |
| Owner/driver/car/track/compound | **niet op de fuelrij**; alleen event/team/run/device/session |

### 5.3 Wat ontbreekt en wat blokkeert

- Er is **geen opgeslagen next-lap-voorspelling**. De keten levert een per-lapverbruik en
  daaruit `laps_remaining`/`fuel_to_finish`; de letterlijke “volgende ronde”-waarde wordt
  nergens als veld bewaard.
- De fuelrij heeft geen duurzame eventidentiteit, geen revisie en geen hash. Een latere
  correctie van een fuelmeting is niet mogelijk; `ON CONFLICT DO NOTHING` houdt de eerste
  meting, ook als die ongeldig was.
- De fuelrij heeft geen driver/car/track/compound. Een model dat over rijders, auto's of
  banen generaliseert, kan niet uit deze rij leren zonder een aparte, historische context
  die nu niet bestaat.
- `fuel_samples` is run-scoped en bevat alleen geldige samples; het is geen complete
  brandstofhistorie (ongeldige/afgekeurde rondes ontbreken).
- **Wiring-verschil**: `PitwallTab` geeft aan `usePitwallStrategy` **geen**
  `fuelPerLapSamples` en **geen** `pitLaneSeconds` (`PitwallTab.tsx:179-187`). De
  mediaan/MAD-route in `advise` krijgt dus een lege reeks en valt terug op de prior; het
  `FuelPanel` toont tegelijk de `real.fuelSamples`-varianten. Paneelext en advies kunnen
  daardoor een ander per-lapgetal tonen.
- De testpagina maakt een synthetische `deviceStrategyRow` met
  `fuel_per_lap_litres=null`, `race_fuel_per_lap_litres=null` en status
  `insufficient_data` (`devicePitwallAdapters.ts:64-84`); de prior komt daar uit
  `v3.fuel.fuelPerLapLitres`. Dat is een device-scope-preview, geen racebewijs.

**Blokkerend voor:** een driver-/auto-/baanbrede next-lap-training. **Niet blokkerend**
voor een run-scoped verbruiksschatting op `endurance_strategy_lap_samples`.

**Fallback:** gebruik `endurance_strategy_lap_samples` (valid rows) als bestaande bron;
bereken per-lap met `estimateFuelPerLap` (mediaan/MAD) in plaats van alleen het
stintgemiddelde; toon `valid_fuel_sample_count` en `exclusion_reason`. Geen nieuwe
connectorvelden nodig: de bestaande fuelvelden zijn voldoende. Geen tweede fuelmodel naast
`fuelModel.ts` bouwen.

## 6. Target 2 — Pit net loss

### 6.1 Bewezen bronpad

1. **Connector**: `PitServiceTracker` opent/sluit een bezoek op de ruwe `OnPitRoad`-flank
   (`PitServiceTracker.cs:166-192`), bewaart `EnterLap`/`ExitLap`, `EnteredAtUtc`/
   `ExitedAtUtc`, `EnterSessionTimeSeconds`/`ExitSessionTimeSeconds`, `EnterSdkTick`/
   `ExitSdkTick` (`:101-131, 227-278`), en berekent de waargenomen brandstofdelta
   (`:293-316`).
2. **Frame → DB**: `simhub_persist_v3` schrijft op de pitvlag-overgang `pit_entry` en
   `pit_exit` in `endurance_telemetry_events`, met `completed_laps`, `in_pit_lane`,
   `captured_at`, `race_run_id` (`20261110231000:919-938`).
3. **Afgeleide stops**: `derive_pit_stops` leest `in_pit_lane`-overgangen per
   team/device/session en berekent `entry_at`, `exit_at`,
   `pit_lane_seconds = exit_at - entry_at` en `laps_in_pit`
   (`20261025122000:80-157`). `refresh_endurance_pit_stops` bouwt de tabel opnieuw
   (`:168-203`).
4. **Leespad**: `pitwall_pit_loss_v1` (run-scoped, 3 args) neemt de mediaan van bruikbare
   `pit_lane_seconds` tussen 5 en 900 s (`20261108220000:222-290`). `get_pitwall_data`
   geeft `pit_loss` en `pit_lane_seconds` (`20261110231000:1198, 1368-1373`).
5. **Rekenkern**: `computePitLoss` telt `pitLaneSeconds` + de langzaamste van
   fuel/tyre/repair (`pitLoss.ts:14-47`). `PitServiceInput.pitLaneSeconds` is daar
   gedocumenteerd als “zonder service” (`types.ts:29-40`).

### 6.2 Eenheid, tijd, identiteit, revisie/hash/label

| Aspect | Waarde |
|---|---|
| Eenheid | seconden; `laps_in_pit` in rondes |
| Tijd | `pit_entry_at`, `pit_exit_at` (UTC); `captured_at` van de overgang |
| Identiteit | `(event_id, team_id, device_id, session_id, stop)`; geen duurzame stop-UID in de payload |
| Revisie | **geen**; tabel wordt per event opnieuw opgebouwd |
| Hash | **geen** |
| Label | `event_key` `pit_entry:<sequence>` / `pit_exit:<sequence>` (`20261110231000:925-938`) |
| Owner/driver | owner alleen via device; **geen** driver op de stop |

### 6.3 Wat ontbreekt en wat blokkeert

- **Bruto vs netto**: `pit_lane_seconds` is de volledige entry→exit-tijd, inclusief service.
  `computePitLoss` verwacht een servicevrije pitlanetijd en telt daar de service bij op.
  Dat zijn verschillende grootheden. De gewone pitwall geeft de serverwaarde **niet** aan
  `usePitwallStrategy` (`PitwallTab.tsx:179-187`), dus de dubbeltelling treedt vandaag niet
  op in het advies; `PitStrategyBlock` toont de bruto waarde wel als “Pitstraat”
  (`PitStrategyBlock.tsx:99-112`).
- **Geen netto verlies**: nergens wordt de pitlanetijd verminderd met een referentieronde
  of een normaal pitstraat-segment. `rg` op `net_loss|netLoss` levert geen implementation
  op. `pit_lane_seconds` is dus geen “net loss”.
- **Service-seconden ontbreken**: `secondsPerLitre` en `tyreSeconds` worden in de
  productie-UI niet gevuld; alleen tests zetten ze (`binding.test.ts:25-27`,
  `strategy.test.ts:31-33`). `PitServiceInput` heeft geen waarde uit de server.
- **Geen stoptype**: `endurance_pit_stops` heeft geen fuel/tyre/servicevelden. De
  connector bewaart `PitIntent`/`PitResult` alleen in geheugen; die worden niet in een
  meetrij of stoprij weggeschreven (`PitServiceTracker.cs:60-94`).
- **Entry/exit-sessietijd niet op de draad**: `PitVisit.EnterSessionTimeSeconds` en
  `ExitSessionTimeSeconds` bestaan lokaal (`PitServiceTracker.cs:109-110`), maar er is
  geen DTO-veld en de pit-events bevatten alleen `captured_at`/`completed_laps`.

**Blokkerend voor:** netto pitverlies en servicekosten per stop. **Niet blokkerend** voor
bruto pitlanetijd en stopdetectie.

**Fallback:** gebruik `pit_lane_seconds` als **bruto** pitstraattijd en label die expliciet
zo; combineer met `lap_times`/`lap_time_from_deltas_s` voor een benadering, maar noem dat
geen netto verlies. Een exacte netto-berekening vereist een referentiegrootheid per baan/
segment die nu niet is opgeslagen. Een connectoruitbreiding is **bewezen mogelijk** op
bestaande velden (de visit bewaart entry/exit-sessietijd al), maar niet bewezen dat de
werkelijke service per hoek beschikbaar is; verzin daarvoor geen SDK-veld.

## 7. Target 3 — Tyre per-wheel wear at next anchor

### 7.1 Bewezen bronpad

**Connector en meetevents**

- `TelemetrySample.Wear` is een `WearReading` met vier hoeken; `null` betekent “geen kanaal”,
  nooit 0 (`LapAccumulator.cs:16-58`).
- `TyreAnchorTracker` maakt van de eerste wearwaarde een `session_start`-anker en daarna:
  - `wear_refresh_confirmed` alleen als `TireSetsUsed` steeg **en** minstens één hoek omhoog
    ging; confidence 0.95, bron `tire_sets_used` (`TyreAnchorTracker.cs:141-157`);
  - `wear_value_changed` bij een wearwijziging zonder dat bewijs; confidence 0.4
    (`:158-167`);
  - `pit_service_completed` bij onveranderde wear na een afgeronde pitservice; confidence
    0.25 (`:175-188`).
- `setGeneration` is een `SetGenerationReading` per hoek, 0..1000; hij wordt alleen
  opgehoogd voor hoeken die op een **confirmed** refresh omhoog gingen
  (`TyreAnchorTracker.cs:148-156`, `MeasurementEvent.cs:249-285`). `Confirmed` is een
  lokale property en staat **niet** op de draad (`TyreAnchorTracker.cs:20-45`); op de draad
  resteert `kind` + `confidence`.
- `MeasurementEventDto` bevat `wearBefore`, `wearAfter`, `setGeneration`, `evidence`,
  `confidence`, `recordRevision` (`MeasurementEvent.cs:24-42`); `wear_v1` is
  `remaining_percent` 0..100 met verplichte `scale` (`MeasurementEvent.cs:50-58`,
  `simhubExtensions.ts:277-321`).

**Opslag**

- `simhub_measurement_events` bewaart `observed_at`, `session_time_seconds`, `sdk_tick`,
  `wear_before`, `wear_after`, `set_generation`, `evidence`, `confidence`,
  `record_revision`, `content_hash` (`20261031180000:30-110`,
  `20261031190100:29-31`). De UID is `(device_id,event_uid)`.
- `simhub_tyre_observations` bewaart **elk frame** met per-hoek wear, sets, `observed_at`,
  `session_time_seconds`, `lap`, `frame_sequence`, `raw`, en een event/team-snapshot
  (`20261104120000:11-58, 90-171`). Dit is de ruwe audittabel.
- `simhub_tyre_lap_samples` bewaart per ronde een wear-snapshot per hoek, `lap_seconds`,
  `tyre_set`, `compound_id`, `car_key`, `track_key`, `samples`, `captured_at`
  (`20261027180000:22-40`). De trigger neemt per hoek de **min** over de drie zones en de
  `vehicle`-waarde, en schrijft bij de rondeovergang (`:151-160, 187-210`).
- `endurance_tyre_anchors` wordt op de **pit-exit** geschreven en bewaart per hoek
  `wear_fl/fr/rl/rr`, alle 12 zonewaarden, `stint_no`, `tyre_set_no`, `tyre_changed`,
  `wear_frozen`, `anchor_usable`, `captured_at`, met event/team/run/device/session
  (`20261110231000:940-1025`). Entry wordt bewust niet gebruikt: op entry staan de
  wear-kanalen nog op de vorige service (`:902-905`).
- `tyre_stint_deltas` berekent per set de begin/eind-wear per hoek, `wear_per_lap_*` over
  de eigen span, de steilste hoek en `car_key`/`track_key`
  (`20261031120000:48-234`).
- `tyre_prior_stats` bewaart per auto/baan de sommen per hoek en rondes;
  `tyre_prior()` kiest per trap de steilste hoek met minstens drie rondes
  (`20261029090000:543-663`). `pitwall_tyre_estimate_v2` geeft rate + range in rondes
  (`:691-1065`); `pitwall_tyre_estimate_v1` geeft anker/graad/bandbreedte voor de gewone
  pitwall (`20261025130200:133+`; run-scoped versie in
  `20261108220000:22`).

### 7.2 Eenheid, tijd, identiteit, revisie/hash/label

| Aspect | Meetevent | `simhub_tyre_lap_samples` | `endurance_tyre_anchors` |
|---|---|---|---|
| Eenheid | procent rest (0..100), `remaining_percent` | procent rest per hoek; `lap_seconds` seconden | procent rest per hoek; zones procent rest |
| Tijd | `observed_at` (wear-meettijd), `session_time_seconds`, `sdk_tick` | `captured_at`, `lap_number` | `captured_at`, `anchor_lap` |
| Identiteit | `(device_id,event_uid)` | `(device_id,session_key,lap_number)` | `(race_run_id,stint_no)` |
| Revisie | `record_revision` 1..100000 + `content_hash` | **geen**; upsert per ronde | **geen**; eerste per stint |
| Hash | md5 over meetvelden incl. `set_generation`/`supersedes` | **geen** | **geen** |
| Label | `eventId` (`evt-N`), `kind` | `lap_number` | `stint_no`, `tyre_set_no` |
| Context | device/session/segment/pitVisit; **geen** car/track/compound | device/session; car/track/compound | event/team/run/device/session; **geen** car/track/compound/driver |

### 7.3 Wat ontbreekt en wat blokkeert

- **Geen expliciete voorspelling per hoek bij het volgende anker.** De data bevat gemeten
  wear per hoek bij elk anker en een helling per hoek in `tyre_stint_deltas`; het model
  (`pitwall_tyre_estimate_v2`) levert één `rate` voor de **zwakste** hoek en een bereik in
  rondes, geen vierhoekige wear-voorspelling. `tyreGrade`/`tyreEstimateV2` werken met
  `weakest` en `restPct` van die ene hoek (`tyreGrade.ts:63-80`).
- **`setGeneration` wordt niet gebruikt.** Het staat in `simhub_measurement_events` en
  wordt door `simhubExtensions.ts:332-350` gevalideerd, maar geen databasefunctie of
  frontendmodel leest het voor de tyre-leerlus. De leerlus gebruikt
  `simhub_tyre_lap_samples.tyre_set` en `tyre_stint_deltas`, niet het meetevent.
- **Meerdere, niet-verenigde definities van “nieuwe set/nieuwe hoek”:**
  1. lokaal `TyreAnchor.Confirmed` = setcounter + any wear increase;
  2. `setGeneration` per hoek = alleen de hoeken die op dat event omhoog gingen;
  3. `endurance_strategy_lap_samples.tyre_change_detected` = alle vier hoeken ≥ 3 pp
     omhoog na een pitstop (`20261025123000:203-316`);
  4. `endurance_tyre_anchors.tyre_changed` = setcounter +1 t.o.v. vorig anker
     (`20261110231000:1004-1025`);
  5. `tyre_stint_deltas`-grens = `tyre_set` verandert of `wear_max` > +0,5 pp
     (`20261031120000:101-119`).
  Deze vijf zijn niet hetzelfde bewijs. Een partial wheel kan bijvoorbeeld in (2) één
  hoek raken, terwijl (3) hem per definitie niet als `tyre_change_detected` ziet en (4)
  alleen de setcounter kent.
- **Geen bewezen per-hoek service-uitkomst.** `PitServiceFlagsRaw` is een **verzoek**
  (`PitServiceTracker.cs:5-9, 60-79`), geen uitslag. De werkelijke gemonteerde band per
  hoek is niet opgeslagen. `tyre_changed` in het anker is een setcountervergelijking, geen
  per-hoekbewijs.
- **Anker en meetevent zijn niet gekoppeld.** `endurance_tyre_anchors` heeft geen
  `event_uid`; `lap_summaries.wearObservationIds` verwijst naar meetevents, niet naar
  ankers. Dezelfde stop bestaat dus in twee sporen zonder gedeelde sleutel; koppelen kan
  alleen via device/session/lap/tijd en is dan een benadering.
- **Eerste anker wint.** Als het eerste pit-exit-anker `frozen` is (alle vier wearwaarden
  identiek aan het vorige anker), wordt `anchor_usable=false` opgeslagen en een later
  frame kan dat niet corrigeren (`20261110231000:1010-1025`). Voor training is dat een
  expliciet gat, geen ruis.
- **`tyre_observations` is niet de leesbron van het model.** Het model leest
  `simhub_tyre_lap_samples`/`tyre_stint_deltas`; de ruwe observaties zijn er voor audit en
  herinterpretatie, niet voor de live schatting.
- **Geen compound/wet/dry-context** (zie §9). De prior kan daardoor niet conditioneren op
  compound of nat/droog.

**Blokkerend voor:** een per-hoekVoorspelling bij het volgende anker, partial-wheel-service
en een betrouwbare “confirmed new corner”. **Niet blokkerend** voor gemeten per-hoek wear
en per-hoek hellingen uit de bestaande stintdeltas.

**Fallback:** gebruik `simhub_tyre_observations` voor de ruwe per-hoekreeks,
`endurance_tyre_anchors` voor gemeten wear bij pit-exit, en `tyre_stint_deltas` voor
`wear_per_lap_*` per hoek. Markeer `set_bron`/`provenance` en `anchor_usable`; behandel
`frozen` als ontbrekend. Geen connectoruitbreiding nodig voor de wearwaarden: `V3Tyres`
bevat al `wearPercent`, `sets`, `compoundId` en `environment`
(`TelemetryContractsV3.cs:131-147`). Voor echte per-hoek-service is geen bewezen veld
aanwezig; dat mag niet worden verzonnen.

## 8. Target 4 — Later economic pace

Hier bedoeld als: **brandstofgecorrigeerde rondetijd/slijtage en de tijdswaarde van een
stop**, niet als een nieuw waarheidslabel.

### 8.1 Bewezen bronpad

- `evaluateTyreWear` bestaat als pure functie: Theil-Sen op
  `lapSeconds - secondsPerKg * fuelLitres * kgPerLitre` tegen `tyreLap`, met
  standard error en betrouwbaarheid (`tyreModel.ts:91-151`).
- `decideTyreChange` bestaat: break-even helling uit extra stopkosten en resterende
  rondes (`tyreModel.ts:162-207`).
- Data voor een run-scoped fit is aanwezig: `endurance_strategy_lap_samples` heeft
  `lap_time_seconds`, `fuel_used_litres`, `wear_fl/fr/rl/rr`, `completed_laps`,
  `race_run_id`; `simhub_tyre_lap_samples` heeft `lap_seconds`, wear, `tyre_set`,
  `compound_id`, `car_key`, `track_key`; `simhub_lap_times` heeft bewezen `lap_seconds`
  per `(device,session,car,lap)` (`20261103190000:14-29`).

### 8.2 Eenheid, tijd, identiteit, revisie/hash/label

| Aspect | Waarde |
|---|---|
| Eenheid | seconden per ronde; liter per ronde; procentpunt per ronde |
| Tijd | `lap_time_seconds`/`lap_seconds`; `captured_at`; `completed_laps` |
| Identiteit | `(race_run_id,completed_laps)` voor fuel; `(device_id,session_key,car_id,lap_number)` voor lap times; geen gedeelde UID over de drie bronnen |
| Revisie | **geen** op fuel/lap-time; lap times eerste write wins |
| Hash | **geen** |
| Label | `lap_number`/`completed_laps`; geen targetlabel |
| Context | run/device/session; driver/car/track/compound niet gezamenlijk |

### 8.3 Wat ontbreekt en wat blokkeert

- **Geen productie-aanroep.** `evaluateTyreWear` en `decideTyreChange` worden alleen in
  tests/export gebruikt; `rg` over `src` vindt geen aanroep in de live UI of server.
  `strategy/index.ts:8` exporteert ze alleen.
- **Geen opgeslagen target.** Er is geen tabel/kolom met fuel-corrected lap time,
  tyre tijdverlies of stop-break-even. De server `pitwall_tyre_estimate_v2` geeft
  procentpunten per ronde en een bereik in rondes, geen seconden per ronde.
- **Geen gezamenlijke context per lap.** `endurance_strategy_lap_samples` heeft geen
  driver/car/track/compound; `simhub_lap_times` heeft geen fuel/wear/event/team;
  `simhub_tyre_lap_samples` heeft geen fuel of stabiele driver-ID, maar wel een tekstuele
  `driver_name` en `compound_id`. Een join op device/session/lap is technisch mogelijk;
  de sessiedomeinen, naam en compound moeten eerst historisch gekwalificeerd worden.
- **Geen nat/droog/regulations** om de pace te conditioneren (zie §9).

**Blokkerend voor:** een target-output “economic pace” met driver-/auto-/baan-/compound-
generalisatie. **Niet blokkerend** voor een offline, run-scoped fuel-corrected tyre slope
op bestaande samples; die moet als experimenteel worden gelabeld en mag geen advies sturen.

**Fallback:** fit per run op `endurance_strategy_lap_samples` (lap time + fuel used +
wear) en/of join met `tyre_stint_deltas` voor tyre age; gebruik `simhub_lap_times` alleen
als bewezen tijd en niet als fuelbron. Geen nieuwe connectorvelden nodig voor deze
fallback. Geen accuracy-claim zonder echte validatie.

## 9. CarId, trackId, trackConfig, compound, wet/dry en regulations

| Veld | Werkelijke bron | Waar opgeslagen | Waar gebruikt | Status |
|---|---|---|---|---|
| `carId` | `snapshot.CarId` → fallback `Settings.CarIdProperty`; frame-identity (`EnduranceConnectorPlugin.cs:1354-1359, 1568-1578`) | `simhub_telemetry_latest.car_id`; `simhub_tyre_lap_samples.car_key` via `tyre_car_key` | frame/identity, tyre prior, UI | **aanwezig in frame/latest/tyre-lap-sample; niet in meetevents/laps** |
| `trackId` | `TrackIdentityReader.Read(snapshot)` (`EnduranceConnectorPlugin.cs:1571`) | `simhub_telemetry_latest.v3_normalized.identity.trackId` (JSON, géén aparte track_id-kolom); `tyre_track_key` gebruikt trackId of naam | practice-matching, tyre prior | **optioneel frameveld; niet in meetevents/laps** |
| `trackConfig` | `snapshot.TrackConfig` → fallback `Settings.TrackConfigProperty` (`:1359`) | `simhub_telemetry_latest.track_config`; `tyre_track_key`-config | baancontext, tyre prior | **aanwezig in frame/latest; niet in meetevents/laps** |
| `compoundId` | `PlayerTireCompound`, 0..255 (`EnduranceConnectorPlugin.cs:1847`; `TelemetryContractsV3.cs:140`; `tyreTelemetry.ts:264`) | alleen `simhub_tyre_lap_samples.compound_id` | UI toont `Compound-ID`; niet in tyre-model/prior | **ruwe ID, geen naam; geen wet/dry-mapping** |
| `wet`/`dry` | Alleen handmatige `conditions` in `endurance_practice_sessions`/`endurance_pace_entries` (`20260908190000:519`; `practiceRepository.ts:19,43`); weathercontract heeft optionele `trackWetnessPct`/`isRaining` (`weatherTelemetry.ts:24-30`) maar geen bewezen plugincapture | `endurance_pace_entries.conditions`, `endurance_practice_sessions.conditions` | practice/pace-vergelijking | **geen telemetrie-/tyre-koppeling; niet als gemeten tyreconditie gebruiken** |
| `regulations` | **geen bron** | **geen** | **geen** | **0 repo-hits; live-subset geen kolom/relatie; ontbreekt** |
| `setGeneration` | `SetGenerationReading` per hoek, alleen op confirmed refresh (`TyreAnchorTracker.cs:148-156`) | `simhub_measurement_events.set_generation` (jsonb) | **geen consumer gevonden** | **opgeslagen, niet gebruikt** |
| `confirmed new corner` | lokaal `TyreAnchor.Confirmed` + `kind=wear_refresh_confirmed` + confidence 0.95 (`TyreAnchorTracker.cs:20-45, 148-157`) | geen apart veld; alleen `kind`/`confidence`/`set_generation` op het event | niet in tyre-model | **inferred, geen per-hoek servicebewijs** |

Toelichting:

- `carId`, `trackId` en `trackConfig` zijn **frame-identiteit**, geen meetrij-identiteit.
  De live bevestiging dat meetevents/laps die kolommen niet hebben, betekent dat een
  historische meetrij niet zonder externe join aan een auto/baan te koppelen is. Die join
  naar `simhub_telemetry_latest` is voor historie verboden (§4.2).
- `compoundId` is een iRacing-getal, geen M/S/H-naam en geen nat/droogvlag. `docs/pitwall-look/datagaten.md`
  zegt terecht dat een compoundnaam niet is geverifieerd. `tyre_stint_deltas` en de prior
  gebruiken `compound_id` niet in de groeps-/trapkeuze; het staat alleen in de lap-sample.
- `wet`/`dry` is een **handmatige practice/pace-label**, geen meting. `rubberState` is vrije
  tekst en wordt niet naar droog/nat vertaald (`docs/pitwall-look/datagaten.md`, rij
  “Rubber op baan”). De weathercontractvelden zijn optioneel en de plugin capture ervan is
  niet bewezen; ze mogen niet als beschikbaar worden verkocht.
- `regulations` heeft in de hele repo **nul** hits. In de aangeleverde live-subset zijn geen
  `regulation`-kolommen of -relaties. Dat is een positief gezochte afwezigheid; de volledige
  live-schema-audit moet dit nog bevestigen.

## 10. Stopclassificatie: fuel-only, partial wheel, driver swap

| Geval | Wat de connector lokaal heeft | Wat de store bewijst | Oordeel |
|---|---|---|---|
| Fuel-only stop | `PitIntent.FuelRequested`, `RequestedFuelLitres`; `PitResult.FuelAddedLitresObserved` (`PitServiceTracker.cs:60-94, 245-316`) | `lap_summaries.fuel_added_litres_observed` op de completion-lap; `endurance_pit_stops` alleen entry/exit/duur | **afleidbaar, niet expliciet opgeslagen**; geen stoptype-flag; `pit_lap=false` bestaat niet (null = niet-gemarkeerd/onbekend) |
| Partial wheel | `PitIntent.RequestedTyres` per hoek; `setGeneration` per hoek; wearBefore/After per hoek | meetevent `set_generation` + per-hoek wear; `tyre_change_detected` vereist alle vier +3; `tyre_changed` is setcounter | **niet betrouwbaar bewijsbaar**; verzoek ≠ uitvoering; geen per-hoek service-uitkomst |
| Driver swap | `TelemetrySample.CurrentDriverName`; `LapAccumulator` zet `DriverChanged` bij naamwissel binnen de ronde (`LapAccumulator.cs:298-303`) | `lap_summaries.driver_changed` + naam (of null); geen driver op pitstop/measurement event | **niet stop-gekoppeld**; wissel tussen rondes wordt niet gemarkeerd; geen `driver_change`-writer gevonden |

Aanvullend:

- `PitServiceFlagsRaw` is een **verzoek**bitset (FL/FR/RL/RR, fuel, tearoff, fast repair)
  (`PitServiceTracker.cs:11-52`); de klasse zegt expliciet dat een aangevinkte wissel geen
  uitgevoerde wissel is (`:55-59`).
- `lap_summaries.pit_visit_ids` en `wear_observation_ids` koppelen context, maar niet de
  service-uitkomst. `endurance_tyre_anchors` heeft geen `event_uid` en geen driver.
- `endurance_telemetry_events` kent het eventtype `driver_change`, maar er is geen writer
  die het in deze keten aanmaakt; de check staat in `20261025123000:53-59`, niet een
  productepad.
- **Query-valkuil:** een strikte `pit_lap = false` levert structureel 0 (live: 107 true,
  0 false, 317 null). Dat is geen bewijs dat er geen normale rondes zijn; de bron maakt
  false zelf null (§3.3). Gebruik voor een fuelkandidaat `pit_lap IS NOT TRUE` plus
  `complete`/coverage/pit_entry-controle, en behandel de uitkomst als kandidaat, niet als
  bewezen normale ronde.

## 11. Budgetten en batchgedrag

| Grens | Waarde | Bron |
|---|---|---|
| Meetgebeurtenissen per frame (Edge) | **20** | `simhubExtensions.ts:41`; `MeasurementFrame.cs:69` |
| Rondeaggregaten per frame (Edge) | **3** | `simhubExtensions.ts:43`; `MeasurementFrame.cs:70` |
| Bytebudget meetreeksen samen | **16384** | `simhubExtensions.ts:49`; `MeasurementFrame.cs:71` |
| HTTP-body | **24576** | `simhub.ts:843`; `MeasurementFrame.cs:72`; `simhubExtensions.ts:51` |
| DB-batch maximum | 200 events / 20 laps | `20261031200500:329-330` |
| Outbox-capaciteit | 64 events / 32 laps | `MeasurementOutbox.cs:37-47` |

De Edge is strenger dan de database: 20/3 en 16.384 bytes zijn de werkelijke clientgrens;
de DB accepteert meer, maar krijgt dat via de Edge niet te zien. De planner zet rondes
eerst en dan events (`MeasurementFrame.cs:106-107`); wat niet past blijft in de outbox en
wordt `deferred_by_budget`, niet weggegooid (`:119-121`). Bij overschrijding van het
bytebudget laat de ingest de meetserie weg en houdt het kernframe
(`simhub-ingest-v3/index.ts:143-148`). `snapshotDto` verwijdert de meetsleutels uit de
browserleesbare snapshot (`simhubAggregates.ts:55-60`), zodat de reeksen alleen in de
afgeschermde tabellen staan.

## 12. Consumers: advies, paneel en testpagina

| Consumer | Bron | Wat het werkelijk gebruikt | Belangrijk verschil |
|---|---|---|---|
| `get_pitwall_data` | event/team + live run | `latest_v3`, `strategy`, `timeline`, `fuel_samples`, `tyre_estimate` v1, `pit_loss` | kiest laatste team/event-snapshot; strategie op run; tyre v1 (ankers) |
| `usePitwallData` | RPC | `strategy`, `v3`, `fuelSamples`, `pitStopMeasurement`, `tyreEstimate` | `pitLaneSeconds` wordt teruggegeven maar niet aan advies doorgegeven |
| `usePitwallStrategy` / `advise` | snapshot | `strategy`-prior, `v3`, `tyreEstimate`, optioneel `fuelPerLapSamples`/`pitLaneSeconds`/`tyreSeconds` | `PitwallTab` vult die optionele velden **niet**; `FuelPanel` doet dat apart |
| `FuelPanel` | RPC | `strategy.fuel_per_lap_litres`, `race_fuel_per_lap_litres`, `fuel_samples`, `advice.window` | paneel toont servergemiddelde + varianten; advies gebruikt prior/lege reeks |
| `PitStrategyBlock` | RPC | `strategy.fuel_to_add_litres`, `pitStopMeasurement.pitLaneSeconds` | toont bruto pitstraattijd, niet `advice.pitLoss` |
| `VehicleTelemetryPanel` | RPC + tyremodel | `tyreEstimate` v1, `tyreModel` v2 (testpagina) | paneel en model kunnen verschillende graad/bereik tonen |
| `PitwallDeviceTestPage` | device-RPC + v3 | `deviceStrategyRow`, `usePitwallStrategy`, `useTyreModel` v2 | geen race-run, geen fuel_samples/pit_loss; synthetische strategy met status `insufficient_data` |

Details:

- `PitwallTab` geeft aan `usePitwallStrategy` alleen `strategy`, `v3`, `tyreEstimate` en
  `plannedLaps` (`PitwallTab.tsx:179-187`). `fuelPerLapSamples`, `pitLaneSeconds`,
  `secondsPerLitre` en `tyreSeconds` blijven oningevuld. Daardoor:
  - `estimateFuelPerLap` krijgt `[]` en gebruikt de prior;
  - `computePitLoss` krijgt `pitLaneSeconds=null` en geeft `total=null`;
  - de live tyre-reeks in `usePitwallStrategy` komt uit `v3.vehicle.*.wearPercent`
    (`usePitwallStrategy.ts:100-114`), terwijl de server/DB-tyreleer Lus
    `tyres.wearPercent`-zones (min) gebruikt (`20261027180000:187-203`). Dat zijn niet
    dezelfde bron; de server `tyreEstimate` heeft voorrang, maar de fallback verschilt.
- `PitwallDeviceTestPage` bouwt `deviceStrategyRow` met `fuel_per_lap_litres=null`,
  `race_fuel_per_lap_litres=null`, `fuel_laps_remaining=null`, `strategy_status=
  "insufficient_data"` en `updated_at=now` (`devicePitwallAdapters.ts:64-84`). De
  `usePitwallStrategy`-snapshot gebruikt `strategy.updated_at` vóór `v3.capturedAt`
  (`snapshot.ts:46-52`), waardoor de leeftijd op de testpagina niet de V3-leeftijd is.
  Deze pagina is een device-scope-preview, geen bron voor racedata of training.
- `get_pitwall_data.latest_v3` kiest de laatste snapshot op team/event
  (`20261110231000:1203-1221`), terwijl `strategy` op `race_run_id` is gefilterd
  (`:1223-1229`). Bij meerdere devices in hetzelfde team/event is de getoonde identity
  dus niet gegarandeerd de identity van de strategieproducent. Voor een historische
  training mag dit niet als context worden gebruikt.

## 13. Per-target verdict en benodigde fallback

### 13.1 Fuel next-lap

- **Verified:** frame fuelvelden; per-rondemeting met `fuel_start/end/used`, `lap_time`,
  `valid_fuel_sample`, `exclusion_reason`; `fuel_samples` (20, run-scoped); mediaan/MAD-
  model.
- **Missing:** expliciete next-lap-output; duurzame identiteit/revisie/hash; driver/car/
  track/compound op de fuelrij; panel→advies wiring van `fuelPerLapSamples`.
- **Blocking:** alleen voor een generiek driver/auto/baanmodel. Voor een run-scoped
  verbruiksschatting is de bestaande bron voldoende.
- **Fallback:** `endurance_strategy_lap_samples` + `estimateFuelPerLap`; `valid_fuel_sample_count`
  en `exclusion_reason` tonen; geen nieuwe connectorvelden. Voor een fuelkandidaat uit
  lap summaries: `pit_lap IS NOT TRUE` (niet `= false`) plus `complete`, coverage en een
  pit_entry-controle; de 317 nulls zijn “niet gemarkeerd/onbekend”, niet automatisch
  normale rondes.
- **Connectoruitbreiding:** niet bewezen nodig.

### 13.2 Pit net loss

- **Verified:** pit-entry/exit, bruto `pit_lane_seconds`, mediaan, stopdetectie,
  brandstofdelta.
- **Missing:** netto verlies t.o.v. referentie; servicevrije pitlanetijd; service-
  seconden; stoptype; driver/tyre-service-uitkomst.
- **Blocking:** ja, voor netto verlies. Bruto pitlanetijd is bruikbaar.
- **Fallback:** bruto `pit_lane_seconds` + `lap_times` als benadering, expliciet als
  bruto/benadering labelen; geen “net loss” noemen.
- **Connectoruitbreiding:** entry/exit-sessietijd is al lokaal aanwezig
  (`PitServiceTracker.cs:109-110`) maar niet op de draad; een uitbreiding op bestaande
  velden is mogelijk. Een per-hoek/service-uitkomst is niet bewezen; niet verzinnen.

### 13.3 Tyre per-wheel wear at next anchor

- **Verified:** per-hoek wear vóór/ná in events; per-hoek wear in observations,
  lap-samples en anchors; per-hoek hellingen in stintdeltas; priorpool per hoek.
- **Missing:** expliciete per-hoekvoorspelling bij volgende anker; model gebruikt één
  zwakste hoek; `setGeneration`/`confirmed` niet geconsumeerd; partial-wheel/service
  niet bewezen; anker en meetevent niet gedeeld gekoppeld; eerste anker wint.
- **Blocking:** niet voor gemeten per-hoek wear; **wel** voor per-hoekvoorspelling,
  partial wheel en “confirmed new corner”.
- **Fallback:** `endurance_tyre_anchors` + `tyre_stint_deltas` per hoek; `anchor_usable`
  en `frozen` als kwaliteitsflag; `simhub_tyre_observations` voor ruwe audit. Hergebruik
  de bestaande `tyre_prior_stats`/`tyre_prior`-pool; geen tweede priorpool. Geen
  connectoruitbreiding nodig voor de wearwaarden.
- **Connectoruitbreiding:** niet nodig voor `wearPercent`/`sets`/`compoundId`; niet
  bewijsbaar voor per-hoek-service.

### 13.4 Later economic pace

- **Verified:** pure fuel-corrected Theil-Sen en break-evenfunctie; data voor een
  run-scoped fit.
- **Missing:** productie-aanroep; opgeslagen target; gezamenlijke driver/car/track/
  compoundcontext; nat/droog/regulations.
- **Blocking:** ja, voor een target-output met generalisatie. Niet voor een offline
  run-scoped experiment.
- **Fallback:** `endurance_strategy_lap_samples` (lap time + fuel + wear) en
  `tyre_stint_deltas` voor tyre age; `simhub_lap_times` als bewezen tijd. Experimenteel
  label, geen advies, geen accuracy-claim.
- **Connectoruitbreiding:** niet nodig voor de raw tijd/fuel/wear; ontbrekende context is
  een server-/identiteitsprobleem.

## 14. Afgesloten parent-livecontroles en resterende grenzen

De parent heeft de volgende punten zelf read-only nagelopen. Dit is catalogus-/bronbewijs,
geen muterende ingestgedragstest of modelvalidatie:

1. De live batchstore-body is **byte-exact gelijk** aan de body uit
   `20261031200500_plugin08_supersedes_hash.sql`, bepaald met de PostgreSQL-parser op
   beide CREATE FUNCTION-statements. Body-SHA256:
   `7151e6961e933c6a5f47f1eec201431d842839715818ed537a6877b4ce5a6284`.
   Deze batchfunctie gebruikt bulk-insert/update met UID/revisieselectie; niet beweren
   dat iedere actuele insert letterlijk een `ON CONFLICT`-clausule bevat. De unieke
   device/UID-index en revisie-/hash-/ACK-semantiek blijven de relevante contracten.
   De zichtbare live UPDATEs vereisen hogere revision en vervangen `received_at` met `now()`.
2. Events/laps missen de genoemde contextkolommen. De batchstore resolveert
   `current_driver_name` via `simhub_resolve_driver_user` naar een **3SM-user-UUID voor
   die simrijder**, niet naar een raw iRacing-ID. Dit is niet automatisch de device-eigenaar.
   De huidige team/global naamresolutie op afleveringstijd bewijst niet retrospectief de
   oorspronkelijke owner/binding bij een eerder geobserveerde sessie.
3. Live `simhub_persist_v3` heeft `ON CONFLICT (race_run_id, stint_no) DO NOTHING` voor
   het tyre-anker. Eerste anker blijft dus in deze writer leidend. Dit bewijst niet dat
   geen enkele andere beheers-/correctieroute ooit zulke data kan veranderen.
4. Live `derive_pit_stops` rekent `exit_at - entry_at`; de 2- en 3-argumentenoverloads
   van `pitwall_pit_loss_v1` gebruiken de mediaan daarvan. Geen netto referentiesegment
   of servicevrije component is daarbij afgetrokken.
5. De live fuelkolomlijst bevat `lap_time_seconds`, alle vier wear-/wear_delta-kolommen,
   `tyre_change_detected`, `wear_frozen` en `wear_frozen_laps`. Op de tyre-laps staat wel
   `driver_name`; niet verwarren met een stabiele driver-ID of onbekende historische owner.
6. De live achtargumentenbody van `simhub_persist_v3` is byte-exact gelijk aan die uit
   `20261110231000_pitwall_pace_storage.sql`, body-SHA256
   `c3ee128514e314ff598c94ef97d796d2372ca2c913f78819496dc5d69637f5fe`.
   Hij neemt `p_events`/`p_laps` los aan, roept de batchstore aan en retourneert
   `measurement_ack`. De volledige functiedefinitiehash staat in het baseline-dossier.

De eerdere claim dat `trackId` een aparte latest-kolom is, is met de echte livekolommen
weerlegd: hij zit in `v3_normalized.identity.trackId`; de latest-tabel heeft wel
`track_name` en `track_config`. Alle 13 lokale V3-Edge-entry/importbestanden zijn bovendien
SHA256-gelijk aan deze fasebasis. Bestaande legacy-Edge-drift staat apart in het dossier.

Resterend: private gedrags-/lock-/ACK-rehearsal vóór capture-DDL, geen historische
as-of-claim op verloren revisies en geen connectoruitbreiding zonder bewezen veldgat.

## 15. Conclusie

De keten is **wel** bruikbaar voor een run-scoped, voorzichtige leerlus op bestaande
fuel-, tyre- en pitdata. De keten is **niet** klaar voor een generiek zelflerend model
over rijders, auto's, banen, compounds of nat/droog, en ook niet voor “netto pitverlies”
of een per-hoekvoorspelling bij het volgende anker. De beslissende gaten zijn:

1. meetevents/laps missen owner/car/track/compound en hebben geen driver op events;
   `pit_lap=false`/`driver_changed=false` worden in de connector zelf null, waardoor
   “false” en “onbekend” in de store niet te scheiden zijn;
2. fuel en pit zijn mutable afgeleiden zonder duurzame eventidentiteit/revisie/hash;
3. `pit_lane_seconds` is bruto, geen netto, en service-seconden worden niet gevuld;
4. tyre kent vijf niet-verenigde “nieuwe set/hoek”-definities en gebruikt
   `setGeneration`/`confirmed` niet in het model;
5. economic pace bestaat als pure functie maar is niet aangesloten en heeft geen
   gezamenlijke context per lap;
6. nat/droog en regulations bestaan niet in het telemetrie-/tyrepad.

**P0 is hiermee een broncontract, geen GO voor P1.** Geen uitspraak over
modelnauwkeurigheid; daarvoor zijn echte, geïdentificeerde en gevalideerde samples nodig.
De genoemde gaten blokkeren alleen de aangeduide targetvarianten (generieke
driver/auto/baan/compound-training, netto pitverlies, per-hoekvoorspelling en een
economic-pace-target). Zij blokkeren niet de bestaande pitwall of een run-scoped,
experimentele leerlus op de bestaande fuel-, tyre- en pitbronnen.
