# Pitwall learning — canonieke context en recordkwaliteit v1 (P2/T09–T10)

**Status:** lokale, pure bouw op `feat/pitwall-learning-p2-context-quality`; niet
gepusht, niet gemerged, niet gedeployed en niet op productie geactiveerd.
**PRODUCTIEWIJZIGING: NEE.** Geen SQL, Edge Function, UI, connector, package of
bestaand contract gewijzigd.

Bron:
- `src/features/endurance/pitwall/learning/context.ts` + `context.test.ts` (T09)
- `src/features/endurance/pitwall/learning/quality.ts` + `quality.test.ts` (T10)

Codecommits:
- `b02771bbdd3d1ef3678fed30991c0fc9887414ea` — canonieke context
- `d71b0ac6d78e60a8a5c22f80a05189bec2f392b2` — targetgerichte recordkwaliteit

Beide modules zijn deterministisch en hebben geen React, I/O, netwerk, database,
`Date.now`, modelselectie, training of promotie. De bestaande P1-contracten en de
klassieke/endurance/poller/baselinepaden zijn niet aangepast.

## T09 — API

```ts
parseSourceRecordEnvelope(input: unknown): SourceRecordEnvelope | null

buildCanonicalContext(input: unknown): CanonicalContext | null

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
      observedAt: string | null;
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
  `sourceUid`, `recordRevision` en `observedAt`. Elke afwijking levert een aparte
  stabiele reden (`anchor_device_mismatch`, `anchor_session_mismatch`,
  `anchor_source_uid_mismatch`, `anchor_revision_mismatch`,
  `anchor_observed_at_mismatch`) en maakt de claim volledig ongeldig.
- `observed_at` moet een volledige ISO-instant met `Z` of expliciete offset zijn.
  Datum-zonder-tijd en tijd-zonder-zone worden geweigerd; er wordt nooit
  middernacht of een impliciete zone ingevuld.
- 1–7 fractiecijfers worden geaccepteerd en **ruw** bewaard (PostgreSQL kan 6,
  .NET-round-trip 7 leveren). Dit is een invoerafspraak, geen claim dat bestaande
  lezers al uitwisselbaar zijn. Het P1-bijdragecontract blijft maximaal 3 cijfers.
- `currentSnapshot` wordt nooit gelezen. Als het veld aanwezig is, verschijnt
  `current_snapshot_ignored`; car/track/layout/compound/owner worden dan niet
  gevuld. Een latere `simhub_telemetry_latest` mag dus nooit oude context worden.

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
nooit match. De caller kan een al gebouwde T09-context aanleveren; de module
vergelijkt per target.

### Uitvoer

`RecordQualityAssessment` bevat:

- `reported.complete`, `pitLap`, `driverChanged`, `resetOrTow` als
  `{ status: "observed" | "absent" | "invalid", value, reason }`;
- `reported.gap` met `exceedsPolicy: boolean | null`;
- `reported.invalidReasons` als aparte metadata, niet als modelkenmerk;
- `coverage.status: "certified" | "rejected" | "incomplete" | "unknown"` plus
  per groep `fuel`, `temperature`, `load` de samples, duur, gap,
  coveredFraction en `meetsPolicy`;
- `fuel.startLitres`, `endLitres`, `usedLitres`, `addedLitres`;
- `wear.beforePercent`, `afterPercent`;
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
aanwezig; een target kan daarnaast om een eigen reden ongeschikt zijn.

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

- Eerste RED-run tegen stubs: **26 van 28** tests faalden op echt gedrag;
  2 passeerden omdat zij alleen `null`/drempelconstanten controleerden.
  Log: `/home/hermes/artifacts/3sm/pitwall-learning-p2-context-quality/red-targeted.log`.
- Definitieve gerichte Vitest: **33/33 geslaagd** in 2 testbestanden.
  Log: `/home/hermes/artifacts/3sm/pitwall-learning-p2-context-quality/green-targeted-final-preflight.log`.
- ESLint op de vier nieuwe bestanden: **schoon**.
- Projecttypecheck: **exact 16 bestaande baselinefouten**, nul learningfouten.
  Log: `/home/hermes/artifacts/3sm/pitwall-learning-p2-context-quality/typecheck-after.log`.
- Volledige suite: **1980 geslaagd, 1 bestaande fout** in
  `tyreTelemetryContract.test.ts` (dezelfde baselinefout; niet aangeraakt).
  Log: `/home/hermes/artifacts/3sm/pitwall-learning-p2-context-quality/full-suite-final.log`.
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
