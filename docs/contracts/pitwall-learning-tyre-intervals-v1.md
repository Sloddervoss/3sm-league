# Pitwall learning — fysieke bandintervallen per wiel v1 (P2/T11)

**Status:** lokale, pure bouw op `feat/pitwall-learning-p2-tyre-intervals`;
niet gepusht, niet gemerged, niet gedeployed en niet op productie geactiveerd.
**PRODUCTIEWIJZIGING: NEE.** Geen SQL, Edge Function, UI, connector, package of
bestaand contract gewijzigd.

Deze module kwalificeert **fysieke bandintervallen per hoek** uit onbewerkte P1-
bronrevisies. Zij doet geen voorspelling, fit, rate-schatting, bandenkeuze,
pitverliesberekening of UI-werk. Een ontbrekende start wordt nooit 100%, en er
is geen verplichte stopbevestiging of handmatige vraag.

Bron:
- `src/features/endurance/pitwall/learning/tyreIntervals.ts`
- `src/features/endurance/pitwall/learning/tyreIntervals.test.ts`
- context- en kwaliteitslaag: `context.ts` (T09), `quality.ts` (T10), ongewijzigd.

De module is deterministisch en heeft geen React, I/O, netwerk, database,
`Date.now`, modelselectie, training of promotie. De invoer wordt niet gemuteerd.

## 1. Wat de bron werkelijk levert

### 1.1 P1-envelope

`pitwall_learning.source_revisions` bewaart per bronrevisie:

| Veld | Betekenis |
|---|---|
| `source_kind` | `measurement_event` of `lap_summary`; T11 accepteert alleen `measurement_event`. |
| `device_id` | afleverend device, geen owner. |
| `source_uid` | `event_uid`; duurzame UUID. |
| `record_revision` | 1..100000. |
| `content_hash` | 32 lowercase hex; inhoudshash, geen rij-identiteit. |
| `observed_at` | waarnemingstijd van de connector. |
| `source_received_at` | servertijd waarop de rij werd aangenomen; **geen** `knownAt`. |
| `payload` | compacte bronpayload, hieronder. |

De P1-tabel is append-only en bewaart ook oudere revisies. T11 kiest per
`(source_kind, device_id, source_uid)` de hoogste revisie; een ongeldige hoogste
revisie wordt niet stil door een oudere vervangen. Eenzelfde revisie met een
andere hash is `source_revision_conflict`. Een exact duplicaat met dezelfde UID
en hash levert geen extra fysiek voorbeeld.

### 1.2 Measurement-event payload

De payload van een `measurement_event` bevat (na `jsonb_strip_nulls`):

| Sleutel | Vorm / eenheid |
|---|---|
| `kind` | `session_start`, `wear_value_changed`, `pit_service_completed` of `wear_refresh_confirmed`. |
| `observed_session_id` | SDK-/clientsessie; nooit de transport-/delivered-sessie. |
| `delivered_session_id` | transportdomein; T11 leest dit niet. |
| `segment_id` | lokaal segment; context, geen fysieke identiteit. |
| `observed_at` | waarnemingstijd; de envelope is leidend. |
| `session_time_seconds` | simulatiesessietijd, alleen ordeningshulp. |
| `sdk_tick` | SDK-tick; geen zelfstandige identiteit. |
| `wear_before`, `wear_after` | `wear_v1`-object of afwezig. |
| `set_generation` | `set_generation_v1`-object of afwezig. |
| `confidence` | producentgetal; **geen** bewijs van refresh of vervanging. |
| `evidence` | bron/channels; de `note` is in P1 bewust stripped. |

`wear_v1` is geen scalar en geen 0..1-fractie:

```json
{ "version": 1, "scale": "remaining_percent", "fl": 64.2, "fr": 63.9, "rl": 71.1, "rr": 70.8 }
```

- `0` is een geldige restwaarde; ontbrekend/`null` is onbekend en wordt nooit 0.
- `NaN`, `Infinity`, waarden buiten 0..100, een onbekende `version` of een
  andere `scale` maken die hoek onbruikbaar. De module verzint geen scalar.
- Vier ongelijke hoeken zijn normaal. T10's scalaire `wear_after` is dan
  `wear_corner_ambiguous`; dat is **geen fysieke invaliditeit**. T11 leest de
  originele vier hoeken en kwalificeert per hoek.

`set_generation` is `{ "version": 1, "fl": 0, "fr": 0, "rl": 0, "rr": 0 }`
met vier integers 0..1000. De connector verhoogt alleen de hoek(en) die bij een
bevestigde refresh omhoog gingen (`TyreAnchorTracker.cs`,
`SetGenerationReading.Increment`). `changedCorners` staat **niet** op de draad;
T11 leidt per-hoekwijzigingen uit `wear_before`/`wear_after` af en gebruikt
`set_generation` alleen als aanvullend per-hoekbewijs.

### 1.3 Wat de producent werkelijk bevestigt

`TyreAnchorTracker.cs` schrijft:

- `session_start` bij de eerste wearwaarneming in een segment; dat is een
  **startwaarde**, geen bewijs van een nieuwe band en geen 100%;
- `wear_refresh_confirmed` alleen wanneer `TireSetsUsed` steeg én minstens één
  hoek omhoog ging; `evidence.source = "tire_sets_used"`; confidence 0.95;
- `wear_value_changed` bij een wearwijziging zonder dat refreshbewijs;
  confidence 0.4;
- `pit_service_completed` bij onveranderde wear na een afgeronde pitservice;
  confidence 0.25; de servicelijst is een **verzoek**, geen uitgevoerde uitslag.

Daarom gelden in T11 vier losse feiten, nooit één samengevoegde “nieuwe set”:

| Feit | Bron | Betekenis |
|---|---|---|
| `valueReceived` | `wear_after` per hoek | er is een geldige waarde gezien |
| `valueChanged` | `wear_before`/`wear_after` per hoek | de waarde verschoof meer dan 0,05 pp |
| `realRefreshConfirmed` | `kind=wear_refresh_confirmed` + `evidence.source="tire_sets_used"` | de producent bevestigde een echte refresh |
| `performedNewTyreConfirmed` | per-hoek `set_generation`-increment + wearstijging, of een geldig gebonden uitgevoerd servicebewijs | deze hoek kreeg aantoonbaar een nieuwe band |

`confidence` en `wear_value_changed` promoveren nooit tot refresh of vervanging.
Een `pit_service_completed`-gebeurtenis of een gevraagde service is nooit een
uitgevoerde service.

## 2. API

```ts
buildTyreIntervals(
  input: unknown,
  options?: TyreIntervalOptions,
): TyreIntervalResult | null
```

`input` is een array van `TyreIntervalObservationInput`:

```ts
{
  source: unknown;                 // P1 source-envelope (T09)
  payload: unknown;                // P1 measurement-event payload
  observedContext?: CanonicalContext | null;
  annotations?: { resetOrTow?: boolean | null } | null;
  serviceEvidence?: TyreServiceEvidenceInput | null;
  distanceEvidence?: TyreDistanceEvidenceInput | null;
}
```

`options`:

```ts
{
  referenceContext?: CanonicalContext | null;
  sourceReceivedBefore?: string | null;   // expliciete ontvangstgrens
}
```

Ongeldige top-level invoer of een ongeldige `sourceReceivedBefore` levert
`null`. Een individueel record sluit met een `TyreIntervalRejection` en blokkeert
de rest van de batch niet. De batch is begrensd op 4096 records
(`batch_too_large`), redenlijsten op 32 codes en provenance op 64 refs.

### 2.1 Context

- `observedContext` moet aan precies dezelfde bronrevisie gebonden zijn:
  source kind, device, UID, revisie, contenthash, observedAt, observed session
  en segment. De bestaande T09-binding wordt gebruikt; een device dat
  `source.deviceId` tegenspreekt wordt geweigerd.
- Zonder `observedContext` bouwt T11 een expliciet onbekende context uit precies
  deze bron en payload. `currentSnapshot` bestaat niet in deze API en is geen
  fallback.
- `referenceContext` mag een historische context met een **andere** bron-UID
  zijn. Onbekend matcht nooit; compound/regime worden niet uit nulls gegokt.
- `ownerAtReceipt` is geen observatie-eigendom. T11 gebruikt een receipt-owner
  uitsluitend als privacyscheiding voor reeksen zonder geobserveerde owner, nooit
  als observatie-identiteit, contextmatch of feature.
- Owner/account, device en SDK-sessie blijven gescheiden. Een andere owner wordt
  altijd een aparte persoonlijke reeks. `delivered_session_id` wordt nooit met
  `observed_session_id` vergeleken.

### 2.2 Optioneel trustbewijs

Twee soorten aanvullend bewijs zijn toegestaan, maar alleen wanneer zij exact
aan de bronrevisie gebonden zijn. De binding bevat `sourceKind`, `deviceId`,
`sourceUid`, `recordRevision`, `contentHash`, `observedSessionId`, `observedAt`
en optioneel `sessionTimeSeconds`.

```ts
type TyreServiceEvidenceInput = {
  binding: TyreEvidenceSourceBinding;
  basis: "executed_service_confirmation"; // nooit "selected"/"requested"
  performedCorners: ("fl" | "fr" | "rl" | "rr")[];
};

type TyreDistanceEvidenceInput = {
  binding: TyreEvidenceSourceBinding;
  basis: string;                          // bron-eigen, stabiele basis
  odometerMetres: number;
};
```

- Servicebewijs op een `wear_value_changed` wordt expliciet genegeerd
  (`wear_value_changed_cannot_prove_service`). Een waargenomen verschil wordt
  nooit een uitgevoerde service.
- Een fout gebonden service- of afstandsbewijs wordt genegeerd met een stabiele
  reden; het maakt het fysieke interval niet stil “waar”.
- P1 levert geen uitgevoerd per-hoekservicebewijs en geen odometer. Deze inputs
  zijn een expliciete adaptergrens voor later (T13), geen default en geen
  bewijs dat de historische P1-populatie ze heeft.

## 3. Kwalificatieregels

### 3.1 Start en einde

- Een eerste `session_start` start een interval op de **gemeten** waarde. Zonder
  waarde is er geen start en geen interval; er wordt nooit 100% ingevuld.
- Een `wear_refresh_confirmed` is een echte ankergrens: de oude hoek sluit op
  `wear_before`, de nieuwe op `wear_after`. Dat werkt ook zonder twee stops en
  ook wanneer de wearwaarde gelijk blijft. Een gelijke refresh is een echt
  anker, maar **geen** nieuwe fysieke set. De refresh is voor elke hoek een
  meetgrens; alleen een hoek met per-hoekbewijs krijgt een nieuwe generatie.
- Een `pit_service_completed` zonder uitgevoerd servicebewijs is een observatie,
  geen grens en geen vervanging.
- Een wearstijging op een niet-refreshgebeurtenis breekt alleen de geraakte hoek
  (`wear_increase_unconfirmed`); de andere drie lopen door. Eén sprong reset
  nooit alle vier.
- Een refresh met een wearstijging zonder per-hoekbewijs start een nieuwe
  continuïteitsband met `refresh_after_unconfirmed_increase`. Die band is
  bruikbaar als waarneming, maar een later gesloten interval met die start is
  `unknown`/niet-`usable`; er is geen nieuwe set geclaimd.
- Een reset/tow breekt alle hoeken onbekend. Een sessie- of segmentbreuk sluit
  het open interval als `unknown`; een nieuwe `session_start` op een echte waarde
  start een nieuwe band zonder nieuwe set te verzinnen. Een segmentbreuk is dus
  nooit automatisch een nieuwe fysieke band.
- Een device- of driverwissel continueert alleen met een sterke, expliciete
  car/session-link (dezelfde bekende auto én dezelfde SDK-sessie). Anders breekt
  de reeks `unknown`; er wordt geen nieuwe set bedacht.
- Een andere owner is altijd een aparte reeks. Zonder geobserveerde owner worden
  devices nooit samengevoegd.

### 3.2 Bewezen nieuwe band per hoek

Een hoek geldt als aantoonbaar vervangen wanneer:

1. `kind = wear_refresh_confirmed` en `evidence.source = tire_sets_used`, én
2. `wear_before` en `wear_after` geldig zijn en `wear_after > wear_before`
   (meer dan 0,05 pp), én
3. `set_generation` voor die hoek strikt is toegenomen ten opzichte van de
   vorige waargenomen generatie (0..1000, geen reset),

of wanneer een geldig gebonden `executed_service_confirmation` die hoek noemt.
Alleen die hoek krijgt een nieuwe generatie; de andere hoeken behouden hun
generatie ook over fuel-only en partiële service.

Een refresh zonder per-hoekbewijs, een vastgelopen teller, een tellerreset of een
waarde-only sprong levert geen vervanging. `selectedServiceObserved` blijft een
aparte, niet-bewijzende observatie.

### 3.3 Intervallen

Per hoek ontstaat één interval per continue band. Statussen:

- `closed`: een echte fysieke grens (bevestigde refresh of uitgevoerde service)
  sluit het interval, de start is niet onbewezen en de waarden zijn consistent.
  Alleen dan is `usable=true`.
- `censored`: het invoerbereik eindigt zonder fysieke grens. De laatste
  waarneming blijft zichtbaar, maar `observedLossPercent` is `null` en het
  interval is niet bruikbaar als gesloten meting.
- `unknown`: een continuïteitsbreuk, ontbrekende eindwaarde, een start na een
  onbevestigde sprong of een waarde-inconsistentie. Reden en laatste waarneming
  blijven bewaard.

`observedLossPercent` is `start - end` in procentpunten restwaarde, per hoek.
Het is geen rate en er wordt niet over hoeken gemiddeld. Een ongelijk beeld
levert dus vier losse intervallen; T10's `wear_corner_ambiguous` blijft als
diagnose zichtbaar en wordt niet als fysieke fout behandeld.

### 3.4 Afstand

P1-measurement-events bevatten geen odometer, afstand of rondes. Zonder
expliciet afstandsbewijs is `distance` daarom `unknown` met
`startMetres/endMetres/metresDelta = null` en `lapSpan = null`. Een numerieke
`metresDelta` verschijnt alleen wanneer beide eindpunten dezelfde doorlopende
basis hebben en de waarden geldig, positief en monotoon zijn. Negatief, nul, een
basiswissel of een daling is nooit een plausibele afstand.

### 3.5 Correcties, duplicaten en as-of

- De fysieke generatie is een interne tuple van stream, hoek en origin-UID; de
  output bevat geen owner- of device-identifier in die generatiereferentie.
- Een replay met dezelfde UID en hash is idempotent. Een hogere revisie van
  dezelfde UID vervangt de waarde zonder een tweede onafhankelijke set te maken.
  De interval-provenance verwijst naar de werkelijk gebruikte revisie en hash,
  zodat een latere snapshotcorrectie zichtbaar blijft.
- Een nieuwe gebeurtenis met een nieuwe UID en `supersedes` is in de P1-payload
  niet als correctie gekoppeld; T11 kan die relatie niet leggen. Dat blijft een
  T13-bronvraag.
- `sourceReceivedBefore` is een expliciete **ontvangst**grens. De bron heeft geen
  `knownAt`/first-known; `knownAtStatus` blijft `"unavailable"` en
  `asOfVerified` blijft `false`. Een tijdformaat of receiptmetadata promoveert
  `as_of_unverifiable` nooit tot een geverifieerde as-of.
- Observaties worden op `observed_at` gesorteerd, met `session_time_seconds` als
  tweede sleutel. Bij een exacte gelijke stand is de restorde UID-deterministisch;
  dat is een stabiele uitvoer, geen fysiek ordeningsbewijs.

## 4. T10-integratie

T11 roept per geaccepteerd record `assessRecordQuality` aan met dezelfde
T09-envelope, payload, observed context en referentiecontext. Daarmee blijven
de bestaande bronpoorten voor contextbinding, ongeldige bronredenen,
onbekende redencodes en gatmetaal leidend.

De T10-uitkomst wordt **niet** stil weggefilterd:

- `wear_corner_ambiguous` en `wear_after_invalid` blijven in
  `observations[].quality` en `intervals[].t10` staan. Alleen de scalaire
  projectie is ambigu; de vier hoeken zijn dat niet.
- Contextonbekendheid en contextmismatch blijven als T10-redenen zichtbaar.
  Een fysiek interval kan bestaan terwijl een T10-target niet eligible is.
- Echte bronblokkades (contextbinding, `source_invalid_reasons`, onbekende
  `invalid_reasons`, bronconflict) sluiten het record.
- `pit_lap`/`driver_changed` NULL blijft onbekend; er wordt geen false van
  gemaakt. Een bewezen driverwissel blokkeert T10's fueltarget, maar T11 gebruikt
  hem alleen voor de fysieke continuïteitsregel.

## 5. Broncapaciteit en beperkingen

**P1 kan wel leveren:** per-hoek wear vóór/ná, `kind`, `observed_at`,
`session_time_seconds`, `sdk_tick`, `set_generation`, `evidence.source`,
observed/delivered session, segment, bronrevisie/hash en owner-at-receipt
(privé).

**P1 kan niet leveren:**

- een uitgevoerd per-hoekservice-resultaat (de connector heeft alleen een
  serviceverzoek; `tyre_changed`/setcounter is geen per-hoekbewijs);
- odometer, afstand of lapspan op het meetevent;
- `knownAt`/first-visible tijd; `received_at` is niet immutable en
  `server_receipt_at` is pre-commit;
- car/track/layout/compound/regime of driver-ID op het meetevent; P1's
  `source_revisions.canonical_context` is NULL, dus zonder een vertrouwde
  adaptercontext werkt T11 met expliciet onbekende context;
- een reset/tow-veld (alleen een expliciete annotatie);
- een payloadkoppeling voor `supersedes` met een nieuwe UID.

De P0-context noemt 201 historische meetevents met slechts één bevestigde
refresh in de onderzochte set. Dat is een signaal over dekking, niet over
modelnauwkeurigheid; T11 doet geen live query en gebruikt geen verzonnen
historische voorbeelden.

## 6. Redencodes (versiegebonden)

| Groep | Codes |
|---|---|
| Bron | `source_envelope_invalid`, `payload_invalid`, `record_quality_invalid`, `interval_source_class_unsupported`, `unsupported_measurement_kind`, `observed_at_missing`, `source_quality_blocked`, `source_revision_conflict`, `observation_after_cutoff`, `batch_too_large` |
| Wear | `wear_values_unusable`, `wear_shape_unsupported`, `wear_version_unsupported`, `wear_scale_unsupported`, `wear_corner_missing:<hoek>`, `wear_corner_invalid:<hoek>`, `set_generation_*`, `wear_after_missing` |
| Refresh | `refresh_evidence_missing`, `refresh_evidence_source_mismatch`, `refresh_evidence_invalid` |
| Continuïteit | `wear_increase_unconfirmed`, `wear_increase_within_interval`, `start_continuity_unproven`, `end_wear_missing`, `reset_or_tow_observed`, `segment_boundary`, `session_boundary`, `device_handoff_unproven`, `driver_handoff_unproven`, `observed_session_link_missing`, `context_*_mismatch`, `interval_open_at_input_end` |
| Service | `service_evidence_invalid`, `service_evidence_basis_invalid`, `service_evidence_binding_failed`, `service_evidence_*_mismatch`, `service_evidence_corners_invalid`, `wear_value_changed_cannot_prove_service` |
| Afstand | `distance_source_unavailable`, `distance_endpoint_missing`, `distance_value_invalid`, `distance_basis_changed`, `distance_wrap`, `distance_zero`, `distance_gap`, `distance_interval_open` |
| Provenance | `future_source_revision_excluded`, `payload_observed_at_mismatch`, `observed_session_missing`, `observed_session_link_unknown`, `repeated_session_start`, `device_handoff_strong_link`, `driver_handoff_strong_link` |

## 7. Verificatie (lokaal, echte runs)

- RED vóór de implementatie: **36 van 38** gerichte tests faalden op gedrag
  (lege intervallen, verkeerde start/einde, geen context/handoff, geen
  afstands- of correctiegedrag). Log:
  `/home/hermes/artifacts/3sm/pitwall-learning-p2-tyre-intervals/red-t11.log`.
- Gerichte Vitest na de implementatie: **39/39** geslaagd. Log:
  `/home/hermes/artifacts/3sm/pitwall-learning-p2-tyre-intervals/green-final.log`.
- Alle bestaande learningtests plus T11: **204/204** geslaagd in 4
  testbestanden. Log:
  `/home/hermes/artifacts/3sm/pitwall-learning-p2-tyre-intervals/learning-all.log`.
- ESLint op de twee nieuwe TS-bestanden: schoon. Log:
  `/home/hermes/artifacts/3sm/pitwall-learning-p2-tyre-intervals/eslint-t11.log`.
- Projecttypecheck: **exact 16 bestaande baselinefouten**, nul nieuwe fouten in
  de learningmap. Log:
  `/home/hermes/artifacts/3sm/pitwall-learning-p2-tyre-intervals/typecheck-t11.log`.
- Geen volledige 1991-suite opnieuw gedraaid (OOM-risico buiten deze fase); geen
  netwerk-, database-, SDK- of productieactie.
- Geen Vite-build/deploy uitgevoerd; de module is niet in de UI-/productie-
  importgraph opgenomen. De bestaande P2-basis had al een groene Vite-build.

## 8. Resterende T13-vragen

1. Een echte, per-hoek uitgevoerde service-uitkomst (geen verzoek) met
   bronbinding, of een bevestigd alternatief voor `set_generation`.
2. Odometer/afstand en lapspan op het meetevent, inclusief een expliciete
   doorlopende basis en wrap/gap-semantiek.
3. `knownAt`/first-visible tijd of een aantoonbaar vooraf geselecteerde
   as-of-bron; `received_at` en `server_receipt_at` zijn dat niet.
4. Een bronveld voor reset/tow en een koppeling voor `supersedes`/nieuwe-UID-
   correcties.
5. Historische car/track/layout/compound/regime- en drivercontext per
   meetevent, zonder `simhub_telemetry_latest` als terugval.
6. T12 pitsegmenten; die worden hier bewust niet vooruitgebouwd.
