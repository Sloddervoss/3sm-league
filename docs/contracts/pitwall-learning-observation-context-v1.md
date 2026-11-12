# T13 — capture-only observatiecontract v1 (uitvoerbare pure kern, UNWIRED)

Status: **EXECUTABLE PURE CORE / NIET AANGESLOTEN**. Deze versie vervangt de 267-regelvoorsteltekst op
`a374af6ed4ddeb0e41756c510bbf89c0e50c5b26`. De parser en de meetrij-scopebeslissing staan in:

- `supabase/functions/_shared/observationV1.ts` — pure module, geen imports, I/O, logs, klok of SDK.
- `supabase/functions/_shared/observationV1.test.ts` — Deno-tests, uitsluitend synthetische fixtures.

`simhub-ingest-v3`, `persist.ts`, de outbox, de C#-producer, SQL, P1, de UI en de Edge-deploy zijn **niet**
gewijzigd. De bestaande receiver wijst een rij met `observation` nog steeds af (`contains unknown fields`); dat is
bewust UNWIRED en geen integratieclaim. Er is geen build-GO voor de hele keten.

## 0. Grens en niet-claims

Deze slice bewijst alleen: een optioneel `observation`-blok kan exact worden geparsed, en één meetrij kan
row-level `legacy`/`accept`/`quarantine`/`reject` krijgen zonder de rest van het V3-frame te beïnvloeden. Er is
**geen** owner-identiteit, geen naam-naar-rijder-mapping, geen `false`/`0`-kwalificatie, geen T10-fuel, geen
volledigheidsclaim en geen productieopslag. `unknownSeconds` is een gedefinieerde gap-indicator, niet de werkelijke
totale onwaargenomen tijd en niet de volledige SDK-waarheid.

## 1. API (exact)

```ts
export function parseLapObservation(value: unknown): ParseLapObservationResult;
export function classifyLapObservation(
  input: ClassifyLapObservationInput,
): ClassifyLapObservationResult;

export type ParseLapObservationResult =
  | { ok: true; observation: ObservationV1 }
  | { ok: false; code: ObservationErrorCode; path: string };

export type ClassifyLapObservationInput = {
  row: { observation?: unknown; startedAt?: unknown; endedAt?: unknown };
  authenticatedDeviceId: unknown;
};

export type ClassifyLapObservationResult =
  | { disposition: "accept"; code: "observation_accepted"; path: "observation"; observation: ObservationV1 }
  | { disposition: "legacy"; code: "observation_absent"; path: "observation"; observation: null }
  | { disposition: "quarantine"; code: "observation_device_mismatch";
      path: "observation.capture.deviceId"; observation: null }
  | { disposition: "reject"; code: ObservationErrorCode | ClassifierErrorCode;
      path: string; observation: null };
```

`parseLapObservation` throwt niet voor gewone JSON (ook niet voor arrays, `null`, foute getallen, `Date`,
prototype-keys of circulaire objecten) en muteert de input niet. Elke fout heeft een stabiele `code` en `path`.
`classifyLapObservation` is row-scoped: er bestaat **geen** `coreAccepted`- of frame-boolean. De caller kan na
`quarantine`/`reject` andere rijen en het kernframe verwerken. ACK-afhandeling en quarantaineopslag zijn nog niet
geïmplementeerd.

## 2. Wire-vorm (exact)

Pad `payload.lapSummaries[i].observation`. Optioneel; afwezig = onbekend. `null`, `{}`, een onbekende subsleutel,
een `null` binnen een known veld of een niet-toegestane waarde is een **rijafwijzing**, geen hele-frame-afwijzing.

```json
{"observation":{
  "version":1,
  "capture":{"deviceId":"a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"},
  "interval":{"firstSampleAt":"2026-11-12T10:00:00.050Z",
    "lastSampleAt":"2026-11-12T10:00:19.950Z","samples":41,"maxGapSeconds":0.5,
    "unknownSeconds":0.1,"edgeBeforeSeconds":0.05,"edgeAfterSeconds":0.05},
  "pitRoad":{"value":true,"firstAt":"2026-11-12T10:00:05.000Z"},
  "refuel":{"observedAddedLitres":2.4,"firstAt":"2026-11-12T10:00:10.000Z",
    "positiveSteps":2,"resolutionLitres":0.01},
  "driverNameContinuity":{"value":"unchanged"},
  "context":{"carId":"1321","trackId":42,"trackName":"Circuit de Spa-Francorchamps",
    "trackConfig":"Endurance","sessionUniqueId":987654,"sessionNumber":0}
}}
```

Toegestane rootkeys zijn **alleen** `version`, `capture`, `interval`, `pitRoad?`, `refuel?`,
`driverNameContinuity?`, `context?`. `version` is exact `1`; `capture` bevat alleen `deviceId`; `interval` is de
enige coverage-descriptor. `pitRoad` is `{value:true,firstAt}`; `refuel` is
`{observedAddedLitres,firstAt,positiveSteps,resolutionLitres,maxUndetectedLitres?}`;
`driverNameContinuity` is alleen `{value}`; `context` is
`{carId,trackId,trackName,trackConfig,sessionUniqueId?,sessionNumber?}`. Er zijn **geen** per-feit `samples`,
`maxGapSeconds` of `unknownSeconds`; zulke duplicaten zijn unknown keys.

`version`, `capture` en `interval` zijn verplicht. Minstens één van `pitRoad`, `refuel`, `driverNameContinuity` of
`context` moet aanwezig zijn; een capture-only marker bestaat niet. `ownerUserId`, `ownerBasis`, `driverId`,
`currentDriverName`, `driverChanged`, `resetOrTow`, `compound`, `regime` en `complete` zijn geen wirevelden.
`context` is descriptief over het gedeelde interval en kwalificeert niets: bij een gat of ontbrekende sample wordt
de groep weggelaten, niet als constante aangenomen. Alleen car/track-descriptoren; geen rijdersnaam of andere PII.

## 3. Caps, eenheden en invarianten

| Veld | Regel |
|---|---|
| `samples` | strict integer 1..1.000.000; `"1"` wordt niet gerond of geconverteerd |
| `maxGapSeconds`, `unknownSeconds`, edges | finite getal 0..86.400; 0 is een geldige teller/offset |
| `observedAddedLitres` | finite > 0 en <= 300; 0/negatief is een verboden negatieve fuelstap |
| `positiveSteps` | strict integer 1..10.000 |
| `resolutionLitres` | getal 0,001..1 |
| `maxUndetectedLitres?` | optioneel; >= `resolutionLitres` en <= 300; `null` is ongeldig |
| `pitRoad.value` | alleen `true`; `false`/`0` is verboden |
| `context.carId` | 1..64 UTF-8-bytes, geen controls, niet getrimd |
| `trackName`, `trackConfig` | 1..128 UTF-8-bytes, geen controls, niet getrimd |
| `trackId` | strict integer 1..2.147.483.647 |
| `sessionUniqueId?`, `sessionNumber?` | strict integer 0..2.147.483.647 respectievelijk 0..1000; 0 mag |

Deze caps komen uit het eerdere voorstel. De raw SDK-bron van `sessionUniqueId`/`sessionNumber` is UNVERIFIED;
de getallen zijn een wire-grens, geen bewezen SDK-eigenschap.

`maxGapSeconds` is de maximale gap **tussen opeenvolgende geaccepteerde samples binnen**
`[firstSampleAt,lastSampleAt]`; edges vallen daarbuiten. Daarom geldt bij `samples>1`:
`maxGap >= (last-first)/(samples-1)` en `maxGap <= last-first`; bij `samples==1` is `maxGap == 0` en
`first == last`. `samples` is geen bewijs van cadans of volledigheid.

`unknownSeconds` is een **conservatieve, descriptieve ondergrens** van de niet-gedekte tijd:
`unknown >= edgeBefore + edgeAfter`, en als `maxGap > 1,0` ook `unknown >= edgeBefore + edgeAfter + maxGap`.
Verder `unknown <= (last-first) + edgeBefore + edgeAfter` (het lapvenster). Omdat de max-gap intern is, worden
edges en de volle gap niet dubbel geteld. De eerdere voorbeeldwaarden `edges 0,2 + maxGap 1,2 -> unknown 0,8`
waren fout; geldig is minimaal `1,4`. `maxGap 0,6` met `unknown 0,2` en edges `0,1+0,1` is geldig. `unknown == 0`
betekent alleen "geen getelde gap boven de drempel/geen edge", **niet** "complete lap".
Deze invarianten zijn scalaire consistentiechecks; ze zijn geen cryptografisch volledigheidsbewijs.

Numerieke vergelijking van edges en stats gebeurt **exact** op de canonieke decimale round-trip-representatie van
de gevalideerde double (`Number.prototype.toString()`), intern als BigInt-breuk vergeleken met
integer-nanoseconden. Er is geen binaire epsilon, geen `Math.round(num*1e9)` en geen clamping of afronding van
publieke DTO-waarden. De oorspronkelijke wire-lexeem is na de JSON-parse niet meer beschikbaar; dit is dus
canonical-value-semantiek en geen claim op tokenidentiteit. `samples>1` vereist een strikt positieve
`last-first`; `first==last` met `samples>1` wordt als `observation_bounds_inconsistent` geweigerd (bewuste,
strengere availability-keuze dan de ongelijkheden alleen).

Tijden: de echte C#-producer schrijft `MeasurementTime.WireFormat = "yyyy-MM-dd'T'HH:mm:ss.fff'Z'"` (exact 3
decimalen, UTC; `MeasurementIds.cs:194-205`). De parser accepteert bounded ISO-UTC met 0..7 fractiecijfers, houdt
het ruwe token ongewijzigd en vergelijkt exact in nanoseconden. `Date.parse` wordt niet gebruikt: 100 ns-verschil
blijft zichtbaar en 6/7 cijfers worden niet stil afgekapt. Jaar 1970..9999, alleen `Z`, geen offset, geen
leap-second. `first <= last`; `pitRoad.firstAt` en `refuel.firstAt` liggen inclusief binnen het sample-interval.

UUIDs: canonical 36-tekensvorm, versie 1..5 en variant 8/9/a/b, formaat **eerst** valideren. Daarna mag
hoofd-/kleine letter als UUID-equivalent worden vergeleken. Het ruwe token blijft behouden (geen lowercasing, geen
`urn:`/accolade-reparatie). Een ongeldig auth-device levert nooit `accept` op voor een observed row.

Bytegrens: compacte `JSON.stringify` + `TextEncoder` van de hele `observation`-waarde is <= **2048 bytes**;
2049 wordt vóór de key-walk geweigerd. Multibyte-tekens tellen vol. De **DB**-grens (`pg_column_size <= 4096`) is
een aparte jsonb-maat en blijft onuitgevoerd/PENDING; dat is geen wirebewijs.

## 4. Meetrij-scope (B3)

`classifyLapObservation` past deze precedentie toe:

1. `observation`-property afwezig -> `legacy` (`observation_absent`). Geen upgrade, geen historie, geen ownerclaim.
2. `observation:null` of een ongeldig blok -> `reject`; nooit terugvallen op legacy.
3. Observed row met ontbrekend/ongeldig geauthentiseerd device -> `reject` (`auth_device_invalid`).
4. Geldig blok maar `capture.deviceId` != auth-device (UUID-equivalent na formatcontrole) -> `quarantine`:
   `observation_device_mismatch`. Voor die rij: geen insert/update van `simhub_lap_summaries`, geen P1-capture.
5. Match plus geldige ruwe `row.startedAt`/`row.endedAt`, interval binnen de row en edges binnen **1 ms**
   (`OBSERVATION_EDGE_TOLERANCE_SECONDS`, inclusief; meer dan 1 ms sluit, exact zonder epsilon) -> `accept`.

De row-scope is de enige beslissing. Het V3-kernframe en andere meetrijen blijven buiten dit resultaat en kunnen
door een toekomstige caller doorlopen. De stateless batchtest bewijst: B-rij gequarantaineerd, A-rij accepted,
legacy-rij accepted; een kapotte rij stopt de volgende niet. Er is geen ACK- of quarantaineopslag geïmplementeerd.
De toekomstige servergate hoort in `simhub_persist_v3` -> `simhub_persist_measurement_batch` /
`simhub_apply_lap_row`, niet in `simhub-ingest-v3/persist.ts` (dat laatste doet alleen telemetrie-events/latest).

Owner staat niet op de wire en niet in P1-item-JSON. Een toekomstige lokale verzendcheck vergelijkt
`CaptureDeviceId` **en** `CaptureOwnerUserId` **en** `PairingGeneration`; ontbreekt een van de drie bij lapstart,
dan wordt `observation` weggelaten. Server-owner komt alleen uit `simhub_devices` bij ontvangst
(`device_owner_at_receipt`/`none`). Geen accountpooling, geen registry, geen historische-owner-gelijkstelling en
geen promotie van ownerhistorie.

## 5. B1/B2/B4/B5/B6 — wat de kern wel en niet doet

- **B1 naam:** `driverNameContinuity` is descriptief. Alleen als alle niet-lege namen gelijk zijn -> `unchanged`;
  alleen als alle niet-leeg zijn en minstens één verschilt -> `changed`; ontbreekt/leeg bij één sample -> groep
  weglaten. Dit is nooit `driverChanged` of rijderidentiteit. De producer blijft PENDING.
- **B2 negatief:** de parser kan geen `pitRoad:false`, `refuel:0` of andere negatieve kwalificatie produceren.
  `unknownSeconds`/edges zijn tellers, geen volledigheidsclaim. De 80 %-regel wordt hier niet gebruikt of hersteld.
- **B4 hash/revisie:** **niet geïmplementeerd.** Normatief voor later: hash v2 over de canonieke **gevalideerde
  ruwe** observation, vóór `observation_status` en vóór P1-filtering. `observation_status` is server-afgeleid en
  staat niet op de wire of in de hash. v1 blijft ongewijzigd bij afwezigheid; v2 alleen bij non-null. Zelfde
  `device_id`+`summaryUid`+`recordRevision` met een andere ruwe observation is `revision_conflict`, nooit
  `duplicate`. De bestaande SQL ordent alleen op `recordRevision`; `supersedesSummaryUid` wordt ge-COALESCEd en
  zit in de hash, maar is **geen** ordeningsgate. P1 neemt de opgeslagen serverhash over; geen in-place
  serialisatie. Alleen accepted blokken bereiken de hash.
- **B5 rollback:** **niet geïmplementeerd.** Alleen compatible-reader: flag off, reader en kolom behouden, geen
  destructieve drop en geen drainclaim. Een flag-off maakt oude offline wachtrijen niet veilig; aparte deploy-GO.
- **B6 aggregate/schema:** de pure shape/caps en UUID/context-regels zijn uitvoerbaar. `ObservedSessionId`/
  `SegmentId` bij `StartLap` blijven een producer-PENDING fix; de parser leest ze niet uit de actuele pipeline.
- **Bounded quarantaine (toekomst):** nooit een stale entry verzenden. Elke entry is **append-only en immutable**:
  hij bewaart de **exacte gevalideerde `RowJson`** (de ruwe meetrij) en de ruwe `observation` plus de
  quarantainereden, ongewijzigd. Er is **geen reserialisatie, geen UID/hash-herschrijving en geen stille drop**.
  De lijst is begrensd op 64 entries/1 MiB met een **zichtbare, getelde** retentie/evictie (met reden, export
  indien nodig) en een expliciet retentiebeleid vóór activatie; retentie/evictie is nooit stil. Bij 64 entries of
  1 MiB **weigert de producer nieuwe observation-capture zichtbaar** (overflow-teller plus reden), terwijl **gewone
  laprows blijven doorlopen** en de normale B-capaciteit behouden blijft. Rollback blijft compatible-reader-only
  zoals bij B5.
  "Nooit evicten" én "onbegrensd" is geen geldige combinatie.

Refuel is alleen een **waargenomen positieve stap** (`observedAddedLitres`), niet de werkelijke totaal getankte
hoeveelheid. `maxUndetectedLitres` mag ontbreken wanneer onbekend; afwezigheid blokkeert de positieve capture niet
en zegt niets over onzichtbare fuel. Zonder fysieke/SDK-proof wordt geen totaal of negatieve claim gedaan.

## 6. Wat bewezen is en wat PENDING blijft

Bewezen in deze slice (Deno 2.9.7, echte exits): **216 tests, 0 failures**, `deno test --deny-net`, plus
`deno check` en `deno fmt --check` op de twee TS-bestanden. De tests dekken onder andere afwezig/`null`/versie/
unknown keys op elk niveau, UUID-case en ongeldige tokens, row-vs-frame-scope, 80 %-onwaarheid, naamcontinuïteit,
geen owners, multibyte-caps 2048/2049, 100 ns-tijdprecisie, exacte 1 ms/ULP/subnormale/scientific-getalgrenzen,
refuel zonder bound, input-immutabiliteit en de echte legacy/mixed `parseLapSummariesReport`-afwijzing.

**PENDING / geen claim:** C#-producer en `ObservationV1Enabled` (default off), outbox freeze/quarantaine,
`simhub_persist_v3`/`simhub_persist_measurement_batch`/`simhub_apply_lap_row`, SQL-migratie en hash-vectoren,
`pg_column_size`, P1-projectie, ACK-afhandeling, DB/Edge/SDK/live-tests, UI, deploy en Vite-build (guard niet
omzeild). De SDK-bronnen (`SessionUniqueID`, `SubSessionID`, `UserID`, `PlayerCarTowTime`) blijven bekend maar
UNVERIFIED/ongesloten; hun bestaan of afwezigheid wordt hier niet als runtimebewijs gebruikt. Dit is **geen**
GO voor de complete keten.

## 7. Acceptatie voor deze pure core

- [x] Afwezig = legacy; `observation:null`/onbekend/version = row-reject; geen fallback.
- [x] Match = accept; device-mismatch = row-quarantine; frame/andere rijen blijven mogelijk.
- [x] Exacte shared interval-shape, optionele refuel-bound, 2048-byte cap, raw UUID/tijd behouden.
- [x] Geen `false`/`0`-feit, geen owner/PII op de wire, geen completeness-claim.
- [x] Echte Deno-tests (216) en echte receiver-afwijzing als bewijs; geen DB/netwerk/SSH/GUI.
- [ ] Producer, outbox, SQL/hash, P1, ACK, Edge-wiring en deploy — aparte GO.

**PRODUCTIEWIJZIGING: NEE.**
