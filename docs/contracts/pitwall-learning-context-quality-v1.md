# Pitwall learning — canonieke context en recordkwaliteit v1 (P2/T09–T10)

**Status:** lokale, pure bouw op `fix/pitwall-learning-p2-quality-binding`; niet
gepusht, niet gemerged, niet gedeployed en niet op productie geactiveerd.
**PRODUCTIEWIJZIGING: NEE.** Geen SQL, Edge Function, UI, connector, package of
bestaand contract gewijzigd.

Deze revisie herstelt twee bewezen fail-open paden uit de eerste P2-bouw:
een aangeleverde `observedContext` werd niet aan de invoerbron gebonden, en
`invalid_reasons`/root-gatmetadata werden wel gelezen maar niet in de
targetkwalificatie gebruikt.

Bron:
- `src/features/endurance/pitwall/learning/context.ts` + `context.test.ts` (T09)
- `src/features/endurance/pitwall/learning/quality.ts` + `quality.test.ts` (T10)

De oorspronkelijke P2-commits (`b02771bb`, `d71b0ac6`) staan op de oude
contextworktree; deze branch bouwt daarop voort en wijzigt alleen de vijf
P2-bestanden (inclusief dit document).

Beide modules zijn deterministisch en hebben geen React, I/O, netwerk, database,
`Date.now`, modelselectie, training of promotie. De bestaande P1-contracten en de
klassieke/endurance/poller/baselinepaden zijn niet aangepast.

## T09 — API

```ts
parseSourceRecordEnvelope(input: unknown): SourceRecordEnvelope | null

buildCanonicalContext(input: unknown): CanonicalContext | null

bindObservedContextToObservation(
  observed: CanonicalContext | null,
  observation: {
    source: SourceRecordEnvelope;
    observedSessionId: string | null;
    segmentId: string | null;
  },
): { context: CanonicalContext | null; bound: boolean; reasons: string[] }

compareCanonicalContexts(
  observed: CanonicalContext | null,
  reference: CanonicalContext | null,
  target: LearningTarget,
): ContextComparison
```

### Invoer van `buildCanonicalContext`

```ts
{
  source: {
    sourceKind: "measurement_event" | "lap_summary";
    deviceId: string;                 // 1..120, geen controls
    sourceUid: string;                // UUID
    recordRevision: number;           // 1..100000
    contentHash: string;              // 32 lowercase hex
    observedAt: string | null;        // gezoneerde ISO-instant of null
    sourceReceivedAt: string;         // gezoneerde ISO-instant
  };
  payload: unknown;                   // compacte source-payload; moet een object zijn
  claims?: {
    provenance: "inline_observed" | "verified_historical_anchor";
    binding?: {                       // verplicht bij verified_historical_anchor
      deviceId: string;
      observedSessionId: string;
      sourceUid: string;
      recordRevision: number;
      contentHash: string;
      observedAt: string;             // null bewijst geen anker
    };
    ownerUserId?: string | null;
    driverId?: string | null;
    carId?: string | null;
    trackId?: string | null;
    layoutId?: string | null;
    compoundId?: number | null;       // integer 0..255
    regime?: "dry" | "wet" | null;
  } | null;
  ownerAtReceiptUserId?: string | null;
  currentSnapshot?: unknown;          // expliciet genegeerd
}
```

`sourceUid` is de duurzame source-UID (`event_uid`/`summary_uid`), niet het
leesbare `eventId`/`summaryId`. `contentHash` is de bronhash, geen rij-identiteit.
Een ongeldige envelope of niet-object payload levert `null`. Ontbrekende context is
géén `null`: die wordt een expliciet `unknown`-dimensie.

### Uitvoer

`CanonicalContext` bevat:

- `source`: de bron-envelope plus `observedSessionId`, `deliveredSessionId` en
  `segmentId` uit de payload;
- `identity.owner`, `identity.driver`, `identity.device` als afzonderlijke
  dimensies;
- `car`, `track`, `layout`, `compound`, `regime`;
- `ownerAtReceipt: { userId, basis: "at_receipt_only" | "none" }`;
- `contextStatus: "complete" | "partial" | "unknown"`;
- stabiele, gesorteerde `reasons`.

Iedere dimensie is `{ status: "known" | "unknown", value, provenance, reasons }`.
Een onbekende waarde heeft `value: null`; een echte `0` blijft `0`.

## T09 — semantiek en grenzen

### Drie identiteitsdomeinen

`owner_user_id` (account), `driver` (simrijder) en `device_id` (afleveraar) zijn
nooit uitwisselbaar. `ownerAtReceiptUserId` is uitsluitend administratie op
ontvangstmoment en wordt nooit observatie-eigendom. Zonder aantoonbare
observatieclaim blijft owner `unknown` met `owner_at_receipt_only` of
`owner_history_unknown`.

### Sessies, tijd en transport

- `observed_session_id` (SDK/client) en `delivered_session_id` (transport) zijn
  verschillende domeinen. Ongelijkheid is geen late-delivery- of
  contextfout-bewijs.
- Een verified anchor moet exact binden op `deviceId`, `observedSessionId`,
  `sourceUid`, `recordRevision`, `contentHash` en `observedAt`. Elke afwijking
  levert een aparte stabiele reden (`anchor_device_mismatch`,
  `anchor_session_mismatch`, `anchor_source_uid_mismatch`,
  `anchor_revision_mismatch`, `anchor_hash_mismatch`,
  `anchor_observed_at_mismatch`) en maakt de claim volledig ongeldig.
  `observedAt: null` is geen bewijs van het waarnemingsmoment en geeft
  `anchor_observed_at_missing`.
- `observed_at` moet een volledige ISO-instant met `Z` of expliciete offset zijn.
  Datum-zonder-tijd en tijd-zonder-zone worden geweigerd; er wordt nooit
  middernacht of een impliciete zone ingevuld.
- 1–7 fractiecijfers worden geaccepteerd en **ruw** bewaard (PostgreSQL kan 6,
  .NET-round-trip 7 leveren). Dit is een invoerafspraak, geen claim dat bestaande
  lezers al uitwisselbaar zijn. Het P1-bijdragecontract blijft maximaal 3 cijfers.
- `currentSnapshot` wordt nooit gelezen. Als het veld aanwezig is, verschijnt
  `current_snapshot_ignored`; car/track/layout/compound/owner worden dan niet
  gevuld. Een latere `simhub_telemetry_latest` mag dus nooit oude context worden.

### Binding van een aangeleverde observatiecontext

Een `CanonicalContext` is een waarde, geen bewijs. Daarom moet een context die
als `options.observedContext` wordt aangeleverd exact bij de invoerobservatie
horen:

- `sourceKind`, `deviceId`, `sourceUid`, `recordRevision`, `contentHash`,
  `observedAt` en `sourceReceivedAt` moeten exact gelijk zijn; elke afwijking
  geeft een eigen `observed_context_*_mismatch`;
- `observed_session_id` en `segment_id` mogen niet tegenspreken wanneer beide
  kanten een waarde hebben (`observed_context_session_mismatch`,
  `observed_context_segment_mismatch`);
- `delivered_session_id` wordt nooit vergeleken; dat is transport, geen
  observatie-identiteit;
- een verkeerde schema-/policyversie of niet-objectcontext geeft
  `observed_context_version_mismatch` respectievelijk `observed_context_invalid`.

`null` blijft een geldige onbekende context en wordt nooit stilletjes
vervangen. Een mislukte binding levert `context: null`, `bound: false` en
redenen; `assessRecordQuality` voegt `observed_context_binding_failed` plus de
specifieke reden aan **elk** target toe. De module bouwt de identiteit dan niet
opnieuw uit een andere optie. Alleen wanneer `observedContext` helemaal
ontbreekt, bouwt T10 een expliciet onbekende context uit precies de invoer.

De `referenceContext` is een historisch record en hoeft **niet** dezelfde
`sourceUid`/revisie te hebben. Alleen de contextdimensies worden vergeleken;
de bronbinding geldt uitsluitend voor de observatie.

### Driverhandoff

`driver_changed: true` maakt de driver van die ronde onbekend
(`driver_handoff_unproven`); de parser kiest niet zelf een van beide rijders.
Een ongeldige (niet-boolean) vlag maakt de driver eveneens onbekend
(`driver_changed_invalid`). Alleen een expliciete bronclaim bij een niet-positieve
vlag kan een driver bekend maken.

### Match, mismatch en unknown

`compareCanonicalContexts` vergelijkt per dimensie:

- beide kanten bekend en exact gelijk → `match`;
- beide kanten bekend en verschillend → `mismatch`;
- één of beide kanten onbekend → `unknown`.

`null == null` is dus **geen** match. Er is geen naam- of stringcoercie, geen
`String(object)` en geen impliciete `0`/`false`-fallback.

De targetgerichte eisen staan expliciet in `CONTEXT_TARGET_REQUIREMENTS`:

| Dimensie | fuel | pit_loss | tyre_wear | tyre_pace |
|---|---|---|---|---|
| owner | blocking | blocking | blocking | blocking |
| driver | blocking | blocking | blocking | blocking |
| device | blocking | blocking | blocking | blocking |
| car | blocking | blocking | blocking | blocking |
| track | blocking | blocking | blocking | blocking |
| layout | blocking | blocking | blocking | blocking |
| compound | warning | warning | blocking | blocking |
| regime | warning | warning | blocking | blocking |

Fuel wordt dus niet geblokkeerd door een onbekende compound of nat/droog; wear
wel. Dit is een kwalificatie-eis, geen pooling-, fit- of promotiebeleid.
`contextMatch: true` bewijst alleen dat de blokkerende dimensies gelijk zijn. Het
bewijst geen privacytoestemming, geen driverhistorie, geen onafhankelijkheid en
geen holdout.

## T10 — API

```ts
assessRecordQuality(
  input: unknown,
  options?: {
    observedContext?: CanonicalContext | null;
    referenceContext?: CanonicalContext | null;
  },
): RecordQualityAssessment | null
```

Invoer:

```ts
{
  source: SourceRecordEnvelope;       // zelfde envelope als T09
  payload: unknown;                   // compacte source-payload
  annotations?: { resetOrTow?: boolean | null };
}
```

Als `observedContext` ontbreekt, bouwt de module een context zonder claims; die
is dan expliciet onbekend. `referenceContext: null` of weglaten betekent onbekend,
nooit match. De caller kan een al gebouwde T09-context aanleveren; die wordt
eerst via `bindObservedContextToObservation` aan de invoerbron gebonden en pas
daarna per target vergeleken. Een context van een ander record kwalificeert dus
nooit, ook niet als hij toevallig gelijk is aan de referentie.

### Uitvoer

`RecordQualityAssessment` bevat:

- `reported.complete`, `pitLap`, `driverChanged`, `resetOrTow` als
  `{ status: "observed" | "absent" | "invalid", value, reason }`;
- `reported.kind` voor de eventvorm en `reported.invalidReasons` plus
  `invalidReasonsStatus: "absent" | "observed" | "invalid"`;
- `reported.gap` met `exceedsPolicy: boolean | null`;
- `coverage.status: "certified" | "rejected" | "incomplete" | "unknown"` plus
  per groep `fuel`, `temperature`, `load` de samples, duur, gap,
  coveredFraction en `meetsPolicy`;
- `fuel.startLitres`, `endLitres`, `usedLitres`, `addedLitres`;
- `wear.before`/`wear.after` met de vier echte hoeken, plus
  `wear.beforePercent`/`afterPercent` als scalaire samenvatting;
- `targets.fuel`, `targets.pit_loss`, `targets.tyre_wear`, `targets.tyre_pace`,
  elk met `eligible`, `blockingReasons`, `warningReasons` en een `label`
  (`available`/`missing`/`invalid`, waarde, eenheid, sourceClass).

`usedLitres` is een begrensde structurele delta (`start - end`), niet het
canonieke trainingslabel uit `endurance_strategy_lap_samples`. `eligible` betekent
alleen "dit record voldoet structureel aan de target-eisen"; het is geen training,
score, fit of promotie.

## T10 — kwaliteitsbeleid

Versie: `pitwall-learning-quality-policy-v1`.
Drempels zijn expliciet overgenomen uit het bestaande broncontract
(`simhubExtensions.ts`, `MinSamplesPerGroup`, `MaxCoverageGapSeconds`,
`MinCoveredFraction`) en hier geversioneerd; er is geen mutable servervalidator
geïmporteerd:

- minimaal 10 samples per coveragegroep;
- `maxGapSeconds` hoogstens 2 s;
- per groep minimaal 80% van het rondevenster;
- groepen worden **afzonderlijk** getoetst en nooit bij elkaar opgeteld.

`complete: true` is niet voldoende: de fuelgroep moet dat ook aantonen. Anders
wordt de coverage `rejected` en blijft fuel geblokkeerd. `complete: false` of
ontbrekend wordt nooit uit de coverage afgeleid. Fuel toetst alleen de
fuelgroep; de overall `coverage.status` wordt `rejected` als een andere groep
faalt, maar dat blokkeert fuel niet. `complete` is een bronassertie over de
gehele ronde en blijft voor fuel een expliciete voorwaarde.

### `invalid_reasons` is targetinformatie, geen decoratie

De echte connector schrijft een begrensde set redenen. Herkomst:

- `CoverageRules.Evaluate` (`MeasurementEvent.cs`):
  `coverage_window_missing`, `coverage_missing:<groep>`,
  `coverage_samples:<groep>`, `coverage_gap:<groep>`,
  `coverage_duration:<groep>`, `coverage_duration:window`;
- `TelemetrySampler.CloseCurrent`: `session_changed`, `session_time_reset`,
  `lap_boundary_gap`;
- `MeasurementPipeline.End` / `EnduranceConnectorPlugin`: `session_end`,
  `plugin_stop` (en `lap_closed` als sluitcode).

`reset_detected` is **geen** bestaande SDK-reden; een echte reset heet
`session_time_reset`. Een onbekende code wordt niet als reset of als
onschuldig hernoemd: die faalt gesloten met `invalid_reason_unrecognized`.

Beleid:

- `scripts/pitwall-learning/audit-sources.sql` eist voor een structurele
  fuelkandidaat `array_length(invalid_reasons,1)=0`. Daarom sluit **elke
  niet-lege lijst** de lap-targets met `source_invalid_reasons`, ook een
  onbekende token. De specifieke codes hieronder blijven als detailreden
  zichtbaar;
- `session_changed`, `session_time_reset`, `lap_boundary_gap`, `session_end`,
  `plugin_stop`, `lap_closed`, `coverage_window_missing` en
  `coverage_duration:window` zijn globaal: ze blokkeren elk target met
  `invalid_reason_global` plus `invalid_reason:<code>`;
- `coverage_*:<groep>` wordt per groep geduid. Een fuelreden blokkeert fuel
  (`invalid_reason_group` of `invalid_reason_contradicts_coverage`); een
  temperatuur- of loadreden wordt niet als fuelreden hernoemd, maar de
  niet-lege lijst sluit via de auditregel alsnog de lap-targets;
- een reden die de eigen coveragecijfers tegenspreekt (bijvoorbeeld
  `coverage_gap:fuel` terwijl de fuelgroep een gat van 1 s haalt) maakt
  `coverage.status` `unknown` en blokkeert het betrokken target;
- een malformed/niet-array `invalid_reasons` wordt nooit stil `[]`: het record
  faalt gesloten met `invalid_reasons_malformed` en `source_invalid_reasons`.

### Root-`max_gap_seconds`

Het rootveld is in P1 een afgeleide: `CoverageRules.MaxGap` neemt het maximum
van de drie groepsgaten. Daarom:

- een rootgat dat groter is dan elk groepspunt is tegenstrijdig; beide bronnen
  worden dan niet vertrouwd (`max_gap_seconds_contradicts_coverage_gap`),
  `coverage.status` wordt `unknown` en de lap-targets falen gesloten. Het
  rootgetal zelf wordt daarbij niet als targetautoriteit gebruikt;
- een consistent rootgat wijst naar de groep met dat maximum. Alleen die groep
  wordt op zijn eigen drempel beoordeeld; een temperatuurgat van 3 s bij een
  fuelgat van 1 s blokkeert fuel dus niet, ook al meldt `reported.gap` een
  waarde boven 2 s;
- een ongeldige/negatieve rootwaarde blokkeert met `reported_gap_invalid` plus
  de veldreden; een ontbrekend rootgat blijft onbekend en laat de
  groepsscores intact.

### Conservatieve P1-auditvelden

`scripts/pitwall-learning/audit-sources.sql` is de canonieke, conservatieve
fitgate voor een structurele fuelkandidaat. T10 spiegelt die eisen in plaats van
NULL naar false of 0 te vertalen. Fuel is daarom alleen eligible als:

- `driver_changed` **bewezen false** is; NULL/afwezig blokkeert met
  `driver_changed_unknown`, want onbekend bewijst niet dat dezelfde rijder de
  hele ronde reed;
- `lap_number` een positief geheel getal is; ontbrekend geeft
  `lap_number_missing`, ongeldig `lap_number_invalid`;
- `observed_session_id` en `segment_id` aanwezig zijn; anders
  `observed_session_missing` respectievelijk `segment_id_missing`;
- `fuel_added_litres_observed` expliciet numeriek `0` is; ontbrekend geeft
  `refuel_unknown`, malformed (bijvoorbeeld `"0"`) geeft
  `fuel_added_litres_observed_invalid`. Een echte 0 blijft een echte 0; er
  wordt geen legacy-0 verzonnen.

De labelwaarde mag apart beschikbaar blijven (bijvoorbeeld `start - end`), maar
`eligible` is false zolang een van deze bronvoorwaarden niet bewezen is. De
waarden worden nergens als `false`/`0` teruggeschreven.

### Toekomstig rondevenster

`started_at`/`ended_at` worden tegen `sourceReceivedAt` getoetst met een
expliciete, versiegebonden marge van
`QUALITY_MAX_WINDOW_FUTURE_SKEW_SECONDS = 300`. Er wordt geen `Date.now`
gebruikt. Een venster dat verder in de toekomst ligt dan die marge levert
`coverage_window_future`, `windowSeconds: null` en een niet-gecertificeerde
coverage; de lap-targets falen gesloten. Ontbrekende of onparseerbare tijden
blijven `coverage_window_missing`/`coverage_window_order`.

### Afwezig, nul en onbekend

- Ontbrekende nullable velden blijven `absent`; ze worden geen `false` of `0`.
- Een bron-`0` blijft `observed` met waarde `0` (fuel 0 L, wear 0%). Een echte nul
  wordt niet als "geen data" behandeld.
- `pit_lap` en `driver_changed` zijn alleen `true` of `NULL` in de bron
  (`LapAccumulator.cs`). `NULL` wordt hier `absent`/onbekend en nooit `false`.
  Een strikte `pit_lap = false`-query bewijst daarom geen normale rondes.
- `resetOrTow` staat niet in de P1-payload. Alleen een expliciete annotatie kan
  `true`/`false` leveren; afwezig blijft onbekend.
- Een bekend te groot gat (`maxGapSeconds > 2`) is een andere reden dan een
  onbekend gat (`maxGapSeconds` ontbreekt).
- Niet-eindige, negatieve of onmogelijke waarden worden `invalid` met een stabiele
  reden; NaN/Infinity zijn geen data. Er wordt niet gegooid op gewone malformed
  JSON: een ongeldige envelope/payload levert `null`.
- Redenlijsten zijn gesorteerd en gededupliceerd.

### Targetgerichte labels

| Target | Bronclass | Label in deze module | Belangrijkste blokkades |
|---|---|---|---|
| fuel | lap | structurele `start - end` L/lap | coverage fuel, `complete`, `pit_lap` niet bewezen false, reset/tow, driverwissel, ontbrekende/ongeldige fuelwaarden, context |
| tyre_wear | event | `wear_after` percent_remaining | ontbrekende/ongeldige wear, context (incl. compound/regime), reset/tow, driverwissel |
| pit_loss | lap | **geen** | `pit_stop_duration_missing`; de payload bevat geen stopduur |
| tyre_pace | lap | **geen** | `lap_time_seconds_missing`; de lap summary bevat geen expliciete rondetijd |

Pitverlies en economic pace worden dus niet uit entry→exit of uit
`started_at`/`ended_at` gefabriceerd. Echte brandstof-0 en wear-0 blijven
aanwezig; fuel-0 blijft als waarde `0` staan maar krijgt de aparte blokkade
`fuel_zero_rate` (geen bruikbare rate), terwijl wear-0 een geldige waarde kan
blijven.

### Wear is per hoek, geen scalar

De echte P1-kolommen `simhub_measurement_events.wear_before`/`wear_after` zijn
`jsonb` en de connector schrijft `{ version: 1, scale: "remaining_percent",
fl, fr, rl, rr }`. Een scalar `wear_after: 42` is dus geen geldige bronvorm.
T10 leest die vorm niet langer als wear:

- een scalar/ander object faalt met `wear_shape_unsupported`;
- een verkeerde versie of scale faalt met `wear_version_unsupported` /
  `wear_scale_unsupported`;
- ontbrekende of buiten 0–100 vallende hoeken falen met `wear_corner_invalid`;
- alleen wanneer alle vier hoeken gelijk zijn, is de scalaire
  `wear.afterPercent` bruikbaar. Anders blijven de hoeken bewaard maar is het
  targetlabel ambigu (`wear_corner_ambiguous`), omdat een scalar zonder hoek
  vier echte waarden zou verzinnen. Per-hoekkwalificatie is T11.

Een `measurement_event` telt alleen als wearbron bij een werkelijk ankertype:
`session_start`, `wear_value_changed`, `pit_service_completed` of
`wear_refresh_confirmed` (`TyreAnchorTracker.cs`). Een willekeurig `kind` geeft
`wear_source_kind_unknown`. Dit maakt nog geen refresh- of setbewijs; dat blijft
T11.

## Bronrealiteit en eerlijke gaten

Deze laag is een **domeincontract voor een latere adapter**, geen bewijs dat P1
al is aangesloten:

- De echte P1 `source_revisions.payload` van `lap_summary` bevat geen
  car/track/layout/compound/regime; `measurement_event` bevat die evenmin.
  Positieve fixtures zijn daarom synthetisch en bewijzen geen historische
  dekking. Zonder een geverifieerd historisch anker blijven die dimensies
  onbekend. Joinen naar `simhub_telemetry_latest`/`simhub_devices` is verboden.
- P1 schrijft `pit_lap`/`driver_changed` als `true` of `NULL`. Omdat `NULL` hier
  onbekend is, is in de bestaande P1-populatie **geen enkel record fuel-eligible**
  op dit criterium. Dat is een bronbeperking, geen qualitybug; niet coalescen naar
  `false`. Dit vraagt een latere T13-bronbeoordeling.
- `resetOrTow` bestaat niet in de P1-payload. Ontbreken blokkeert fuel; ook dit is
  een T13-bronvraag, geen reden om "geen reset" te verzinnen.
- Pitverlies heeft nog geen stopduur-label en pace heeft nog geen expliciete
  rondetijd in deze payload. Die blijven `missing`; T11/T12 worden hier niet
  vooruitgebouwd.
- `received_at` is geen first-known/`knownAt`; `as_of_unverifiable` wordt niet
  geüpgraded door deze modules. Een contextmatch is geen as-of-bewijs.
- De parser authenticeert geen claims. De aanroeper moet een vertrouwde
  adaptergrens zijn die alleen inline waarnemingen of aantoonbaar gebonden
  historische ankers aanlevert. Een type-parser maakt een leugen niet waar.

## Verificatie (lokaal, echte runs)

- RED vóór de reparatie: **8 van 26** gerichte qualitytests faalden op echt
  gedrag (contextbinding, SDK-redenen, malformed redenlijst, root-gat, wear).
  Log: `/home/hermes/artifacts/3sm/pitwall-learning-p2-quality-binding/0700/red-quality-binding.log`.
- Gerichte Vitest na reparatie: **44/44 geslaagd** in 2 testbestanden.
  Log: `/home/hermes/artifacts/3sm/pitwall-learning-p2-quality-binding/0700/green-targeted-5.log`.
- Onafhankelijke SPEC-probes (13) tegen de nieuwe modules: **13/13 geslaagd**.
  Log: `/home/hermes/artifacts/3sm/pitwall-learning-p2-quality-binding/0700/review-probes-run-2.log`.
- Ouderlijke probe (aangepast aan contentHash-binding): positive fuel **true**;
  andere device/UID/sessie/segment, onbekende reden, echte resetreden en
  root-gat 30/1 **false**.
  Log: `/home/hermes/artifacts/3sm/pitwall-learning-p2-quality-binding/0700/probe-output-final.json`.
- ESLint op de vier nieuwe TS-bestanden: **schoon**.
- Projecttypecheck: **exact 16 bestaande baselinefouten**, nul learningfouten.
  Log: `/home/hermes/artifacts/3sm/pitwall-learning-p2-quality-binding/0700/typecheck-final.log`.
- Volledige suite: **1991 geslaagd, 1 bestaande fout** in
  `tyreTelemetryContract.test.ts` (dezelfde baselinefout; niet aangeraakt).
  Log: `/home/hermes/artifacts/3sm/pitwall-learning-p2-quality-binding/0700/full-suite-final.log`.
- Geen remote databasequery, mutatie, push, merge of deploy uitgevoerd.

## Resterende onzekerheden

- Of en wanneer een adapter echte, gebonden historische ankers kan leveren is
  buiten deze scope; P1 levert die niet.
- De bronbetekenis van `wear_before`/`wear_after` als fysieke set/anker blijft
  T11; deze module classificeert geen tyre-service of "confirmed refresh".
- De echte leesroute voor pitverlies (stopduur) en economic pace (rondetijd)
  moet later apart worden bewezen.
- Fractionele secondeformaten van bron tot browser zijn niet end-to-end getest;
  alleen de stringvorm en behoud van de ruwe instant zijn hier afgedwongen.
