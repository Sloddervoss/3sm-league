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

**Tijd van `wear_before`.** De P1-materialisatiepayload bevat alleen de
gebeurtenis-`observed_at`; `WearBeforeObservedAtUtc` bestaat wel in de connector
maar staat niet op de draad. De oude bandtijd in een refresh-grens is daarom de
tijd van de refreshwaarneming, niet de meettijd van `wear_before`. Gebruik die
endpointtijd niet voor een rate, tijdblootstelling of “ouderdom” van de oude
waarde en verzin geen eerder tijdstip. Dit blijft een T13-bronbeperking.

**De setgeneratie is geen zelfstandige teller.** `set_generation` wordt door
`TyreAnchorTracker` alleen opgehoogd voor hoeken die op dezelfde bevestigde
refresh omhoog gingen. De per-hoek-generatie is dus afgeleid uit dezelfde
wearstijging plus `TireSetsUsed` en is geen onafhankelijk tweede bewijs.
Daarom heet de basis in de API `refresh_with_set_generation_increment`, niet
“connector bevestigde setgeneratie”.

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

Ongeldige top-level invoer, een ongeldige `sourceReceivedBefore` of een
`referenceContext` die niet de volledige `CanonicalContext`-vorm heeft levert
`null`. Een individueel record sluit met een `TyreIntervalRejection` en blokkeert
de rest van de batch niet. De batch is begrensd op 4096 records
(`batch_too_large`), redenlijsten op 32 codes en provenance op 64 refs.

### 2.1 Context

- `observedContext` moet aan precies dezelfde bronrevisie gebonden zijn:
  source kind, device, UID, revisie, contenthash, observedAt, observed session
  en segment. De bestaande T09-binding wordt gebruikt; een device dat
  `source.deviceId` tegenspreekt wordt geweigerd.
- Vóór die binding controleert T11 de volledige vorm van elke contextwaarde die
  het leest: `identity` met `owner`/`driver`/`device`, `car`, `track`, `layout`,
  `compound`, `regime`, `ownerAtReceipt`, `source` en `contextStatus`. Een
  ontbrekende tak, scalar, array, leeg object of status/waarde-tegenspraak wordt
  per record afgewezen met `observed_context_invalid`; dit throwt nooit voor
  gewone JSON. Een onbekende dimensie met een niet-null waarde is ongeldig en
  claimt dus nooit een match.
- Na de T09-binding moet `identity.device` (indien bekend) gelijk zijn aan
  `source.deviceId`. Alleen `context.source.deviceId` vergelijken is
  onvoldoende; een tegenstrijdige identiteit wordt geweigerd met
  `observed_context_device_mismatch`.
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
- De fysieke stream wordt gegroepeerd per persoonlijke account plus bekende auto
  (of expliciet “auto onbekend”); zonder geobserveerde owner per device, met de
  receipt-owner alleen als privacy-partitie. De SDK-sessie maakt **geen** deel
  uit van de streamsleutel: een sessiewissel moet als continuïteitsbreuk
  zichtbaar blijven. Een accountgrens is een expliciete caller-/adaptergrens,
  geen bewijs van fysieke gelijkheid; onbekende owners op hetzelfde device
  worden nooit tot één trainingsreeks gepoold.

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
- Een `wear_refresh_confirmed` is alleen een echte ankergrens wanneer
  `evidence.source = "tire_sets_used"` hem daadwerkelijk bevestigt. `kind` alleen
  is onvoldoende: zonder geldig bronbewijs is er geen boundary, geen
  `endRealRefreshConfirmed=true`, geen `confirmed_refresh` en geen `usable`
  fysieke grens. Eenzelfde-waarde-herhaling zonder bewijs splitst het open
  interval dus niet; een onbevestigde wearstijging breekt alleen de geraakte hoek
  als `wear_increase_unconfirmed` en levert geen nieuwe band of verse set op.
- Een **bevestigde** `wear_refresh_confirmed` is een echte ankergrens: de oude
  hoek sluit op `wear_before`, de nieuwe op `wear_after`. Dat werkt ook zonder
  twee stops en ook wanneer de wearwaarde gelijk blijft. Een gelijke refresh is
  een echt anker, maar **geen** nieuwe fysieke set. De refresh is voor elke hoek
  een meetgrens; alleen een hoek met per-hoekbewijs krijgt een nieuwe generatie.
- Een `pit_service_completed` zonder uitgevoerd servicebewijs is een observatie,
  geen grens en geen vervanging.
- Een wearstijging op een niet-refreshgebeurtenis breekt alleen de geraakte hoek
  (`wear_increase_unconfirmed`); de andere drie lopen door. Eén sprong reset
  nooit alle vier. Een `session_start` na zo'n onbevestigde stijging breekt de
  oude band onbekend, maar bewaart de **gemeten** startwaarde als nieuwe
  continuïteitsband (`reanchored_after_break`). Dat is een nieuwe meetband, geen
  bevestigde nieuwe fysieke set: de generatie wordt niet opgehoogd. Een latere
  echte refresh kan die band sluiten; een latere waarde-only observatie wordt
  alleen in de band vastgelegd en promoveert de refresh niet.
- Een refresh met een wearstijging zonder per-hoekbewijs start een nieuwe
  continuïteitsband met `refresh_after_unconfirmed_increase`. Die band is
  bruikbaar als waarneming, maar een later gesloten interval met die start is
  `unknown`/niet-`usable`; er is geen nieuwe set geclaimd.
- Een reset/tow breekt alle hoeken onbekend. Een sessie- of segmentbreuk sluit
  het open interval als `unknown` met respectievelijk `session_boundary` of
  `segment_boundary`; een nieuwe `session_start` op een echte waarde start een
  nieuwe band zonder nieuwe set te verzinnen. Een segmentbreuk is dus nooit
  automatisch een nieuwe fysieke band. Een sessiebreuk is evenmin een
  “einde van de batch”: alleen een werkelijk invoer-einde levert `censored` met
  `interval_open_at_input_end`.
- Delayed records worden op `observed_at` geordend. Een oude sessierij die later
  ontvangen is, veroorzaakt alleen een grens op zijn werkelijke chronologische
  positie; de ontvangsttijd of een receipt-cutoff herschrijft de fysieke
  chronologie niet.
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

De eerste route rapporteert `refresh_with_set_generation_increment`: een
composiet van `kind`, `evidence.source=tire_sets_used`, de per-hoek
wearstijging en de per-hoek generatietoename. De generatie is **geen**
onafhankelijke teller; zij is uit dezelfde wearstijging afgeleid. Een refresh
zonder per-hoekbewijs, een vastgelopen teller, een tellerreset of een
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

`usable` is **uitsluitend fysieke intervalbruikbaarheid** (`closed` met een
observeerbaar verlies). Het is geen training-eligibility, geen contextmatch, geen
accounttoestemming en geen bewijs dat het interval in een globaal model mag
worden gepoold. Een fysiek interval kan `usable=true` zijn terwijl T10
`targetEligibleAll=false` wegens onbekende of strijdige context; die onbekendheid
promoveert nooit stil tot leermateriaal.

`physical.endPerformedNewTyreConfirmed` betekent: op deze eindgrens is voor deze
hoek een nieuwe band aantoonbaar (composiet refreshbewijs of uitgevoerd
servicebewijs). Het is niet hetzelfde als `selectedServiceObserved` (een
pit_service-gebeurtenis of verzoek) en niet hetzelfde als
`endRealRefreshConfirmed` (het producent-refreshbewijs). De oude naam
`endConfirmedService` suggereerde een uitgevoerde service en is daarom
vervangen.

`observedLossPercent` is `start - end` in procentpunten restwaarde, per hoek.
Het is geen rate en er wordt niet over hoeken gemiddeld. Een ongelijk beeld
levert dus vier losse intervallen; T10's `wear_corner_ambiguous` blijft als
diagnose zichtbaar en wordt niet als fysieke fout behandeld.

`t10.targetEligibleAll` is de **AND over alle observaties** in het interval. Eén
ineligible observatie maakt het interval niet-eligible, ook wanneer een latere
observatie eligible is; de geaccumuleerde `blockingReasons` blijven daarmee in
overeenstemming. Er is geen “laatste wint”-veld meer.

Provenance is begrensd op 64 refs. De start- en eindgrens (inclusief hun
revisie/hash) worden altijd behouden; tussenliggende refs zijn auditcontext voor
waarschuwingen en kwaliteit en zijn niet nodig om de fysieke closed/censored-
beslissing te reproduceren. Weggevallen tussenrefs worden met
`observationRefsTruncated=true` gemarkeerd, niet stilzwijgend weggelaten.

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
  `as_of_unverifiable` nooit tot een geverifieerde as-of; `Date.now` wordt nooit
  als grens gebruikt.
- De receipt-cutoff wordt **vóór** conflict- en revisieselectie toegepast. Een
  rij die na de cutoff ontvangen is, hoort niet in deze momentopname: zij maakt
  een pre-cutoff revisie niet tot conflict en een ongeldige toekomstige hoogste
  revisie verdringt de geldige pre-cutoff revisie niet. Binnen de cutoff blijft
  eenzelfde revisie met een andere hash gewoon `source_revision_conflict`, ook
  wanneer beide rijen vóór de cutoff liggen. `futureRevisionsExcluded=true`
  betekent dat minstens één rij buiten de cutoff is weggelaten.
- Een ongeldige hoogste revisie **binnen** de snapshot wordt niet door een
  oudere geldige revisie vervangen; het record wordt afgewezen.
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
  Een fysiek interval kan bestaan terwijl een T10-target niet eligible is. Het
  intervalveld `t10.targetEligibleAll` is de AND over alle observaties, zodat een
  latere eligible observatie een eerdere blokkade niet stil opheft.
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
- een payloadkoppeling voor `supersedes` met een nieuwe UID;
- `source_revisions.quality_reasons` zoals `clock_skew`, `late_delivery` of
  `stale_revision_delivered_late`: die staan niet in de T11-API-input. T11 leest
  ze niet en claimt niet dat ze zijn toegepast. Het is een T13-bronbeperking,
  geen stille kwaliteitspoort.

De P0-context noemt 201 historische meetevents met slechts één bevestigde
refresh in de onderzochte set. Dat is een signaal over dekking, niet over
modelnauwkeurigheid; T11 doet geen live query en gebruikt geen verzonnen
historische voorbeelden.

Zonder geobserveerde owner blijft de receipt-owner slechts een
privacy-partitie; hetzelfde device kan dan fysiek door verschillende personen
zijn gebruikt. Zo'n reeks mag nooit als één persoonlijke trainingsreeks worden
gepool. De caller/adapterscope (account) is expliciet en is geen bewijs van
fysieke of persoonlijke gelijkheid.

## 6. Redencodes (versiegebonden)

| Groep | Codes |
|---|---|
| Bron | `source_envelope_invalid`, `payload_invalid`, `record_quality_invalid`, `interval_source_class_unsupported`, `unsupported_measurement_kind`, `observed_at_missing`, `source_quality_blocked`, `source_revision_conflict`, `observation_after_cutoff`, `batch_too_large` |
| Context | `observed_context_invalid`, `observed_context_binding_failed`, `observed_context_version_mismatch`, `observed_context_device_mismatch`, `observed_context_*_mismatch`, `context_source_mismatch` |
| Wear | `wear_values_unusable`, `wear_shape_unsupported`, `wear_version_unsupported`, `wear_scale_unsupported`, `wear_corner_missing:<hoek>`, `wear_corner_invalid:<hoek>`, `set_generation_*`, `wear_after_missing` |
| Refresh | `refresh_evidence_missing`, `refresh_evidence_source_mismatch`, `refresh_evidence_invalid` |
| Continuïteit | `wear_increase_unconfirmed`, `wear_increase_within_interval`, `start_continuity_unproven`, `end_wear_missing`, `reset_or_tow_observed`, `segment_boundary`, `session_boundary`, `device_handoff_unproven`, `driver_handoff_unproven`, `observed_session_link_missing`, `context_*_mismatch`, `interval_open_at_input_end` |
| Service | `service_evidence_invalid`, `service_evidence_basis_invalid`, `service_evidence_binding_failed`, `service_evidence_*_mismatch`, `service_evidence_corners_invalid`, `wear_value_changed_cannot_prove_service` |
| Afstand | `distance_source_unavailable`, `distance_endpoint_missing`, `distance_value_invalid`, `distance_basis_changed`, `distance_wrap`, `distance_zero`, `distance_gap`, `distance_interval_open` |
| Provenance | `future_source_revision_excluded`, `payload_observed_at_mismatch`, `observed_session_missing`, `observed_session_link_unknown`, `repeated_session_start`, `device_handoff_strong_link`, `driver_handoff_strong_link` |

## 7. Verificatie (lokaal, echte runs)

Deze afgeschermde reparatieronde is uitgevoerd op basis van
`c516b1d13b870f9c053088fc55c14c4d62877d49`. Alle nieuwe logs staan onder
`/home/hermes/artifacts/3sm/pitwall-learning-p2-tyre-qualification/`
(map `0700`); de oude reviewbewijzen zijn niet gewijzigd.

- Baseline vóór de reparatie: **39/39** T11-tests groen. Log
  `00-baseline-t11.log`.
- Onafhankelijke SPEC-probes vóór de reparatie: **7/7 RED** op de zeven
  blokkercases B1, B2, B2b, B3, B4, B5, B6, inclusief de twee TypeError-
  reproducties. Log `01-blockers-red-before.log`.
- Dezelfde probes na de reparatie: **7/7 groen**. Daarbij is in de
  privékopie van de probe één fout in de probe-helper gecorrigeerd: B6 deed
  `fl(result)` (filtert alleen de FL-hoek) en verwachtte daar vier intervallen.
  De kopie telt nu `result.intervals` (vier hoeken), wat de bedoelde assertie is;
  de assertion is niet verzwakt. Log `10-probes-green-postfix.log`.
- Gerichte T11 Vitest na reparatie: **58/58** geslaagd (39 bestaande + 19
  regressies). Log `08-t11-58.log`.
- Alle learningtests plus T11: **223/223** geslaagd in 4 testbestanden met
  `--maxWorkers=1`. Log `09-learning-all-final.log`.
- ESLint op `tyreIntervals.ts` en `tyreIntervals.test.ts`: exit 0, leeg. Log
  `07-eslint.log`.
- Projecttypecheck: **exact dezelfde 16 bestaande baselinefouten** als vóór de
  reparatie (identiteiten vergeleken, niet alleen het aantal), nul fouten in de
  learningmap. Log `06-typecheck.log`.
- Geen volledige suite, Vite-build of deploy opnieuw gedraaid; de module is niet
  in de UI-/productie-importgraph opgenomen. Geen netwerk-, database-, SDK- of
  productieactie.

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
7. Een echte `wear_before`-tijd op de draad (`WearBeforeObservedAtUtc` bestaat
   lokaal maar niet in de P1-payload). Zonder dat veld is de oude bandtijd bij
   een refresh de refreshwaarneming, niet de meettijd; geen rate of
   tijdblootstelling daaruit afleiden.
8. `quality_reasons` (`clock_skew`, `late_delivery`,
   `stale_revision_delivered_late`) als gebonden trustbewijs in de API, of een
   expliciete T13-beperking zolang de adapter ze niet meelevert.
9. Een onafhankelijk per-hoekbewijs voor een nieuwe band naast het
   connector-composiet `kind + tire_sets_used + wearstijging +
   set_generation-increment`; de generatie is geen tweede teller.
