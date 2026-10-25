# Delta-frames aansluiten (fase 5) — activeringsplan

**Datum:** 2026-10-25
**Status:** plan. Dit document verandert niets aan de plugin, de ingest of de database.
**Protocol ligt er sinds:** `c2c91ea` (feat(protocol): delta-frames voor telemetrie (fase 5)), main `b263c38`.
**Hoort bij:** punt 12 van `~/3sm-na-de-race-lijst.md` ("Delta-frames aansluiten", wacht op plugin 0.7.0).
**Raakt ook:** punt 14 (de regel "Relayfrequentie: geen high-frequency rijanalyse" in het racedisplay kan pas weg als dit aan staat).

Het protocol is gebouwd en gemeten (91–93% minder bytes), maar bewust niet aangesloten vóór de race van 24-10. Dit plan beschrijft wat er ligt, wat er nog ontbreekt, in welke volgorde het aangezet wordt en hoe het teruggaat als het misgaat.

---

## 1. Samenvatting

| Bouwsteen | Status | Waar |
|---|---|---|
| Delta-encoding/decoding (`diffFrames`, `applyDeltaFrame`, `nextFrame`, `frameSize`) | **klaar**, getest | `supabase/functions/_shared/delta.ts` |
| Unit-tests op het protocol | **klaar** (9 tests) | `src/test/deltaProtocol.test.ts` |
| Meting op een echt pakket | **klaar** (91/92/93%) | commit `c2c91ea` |
| Plugin zendt keyframe/delta + houdt een basis bij | **ontbreekt** | `EnduranceConnectorPlugin.cs` |
| Edge accepteert een delta-frame | **ontbreekt** | `supabase/functions/simhub-ingest-v3/index.ts` |
| Validator kent het frame | **ontbreekt** | `_shared/simhub.ts`, `_shared/opponents.ts` |
| Basisopslag aan de serverkant | **ligt er al**, ongebruikt | `public.simhub_telemetry_latest.v3_normalized` |
| Foutpad zichtbaar in diagnostics | **ontbreekt** (413 heet nu "OK") | `DiagnosticsClient.cs:341` |

Kort: het rekenwerk is af, de bedrading niet. Er is geen code in de plugin of de ingest die het protocol gebruikt — `delta.ts` wordt alleen door de test geïmporteerd. Activeren is dus geen vlag omzetten, maar een handvol kleine wijzigingen aan beide kanten plus een plugin-release.

---

## 2. Het protocol zoals het er ligt

Twee framevormen, in `supabase/functions/_shared/delta.ts`:

```jsonc
// keyframe: alles, één keer
{ "kind": "keyframe", "seq": 41, "data": { /* volledige V3-payload */ } }

// delta: alleen de paden die veranderd zijn
{ "kind": "delta", "seq": 42, "ops": [
  ["timing.completedLaps", 85],
  ["opponents.3.gapToPlayerSeconds", -12.7],
  ["opponents.7.lapDistancePct", 0.431]
] }
```

Regels die het protocol dragen (uit de kop van `delta.ts`, en ze zijn bindend):

1. **Een keyframe is heilig.** Een delta op een basis die de server niet heeft is onbruikbaar. Na een herverbinding, een nieuwe sessie of een verloren frame moet er een keyframe komen.
2. **Paden zijn dom.** Puntnotatie (`timing.completedLaps`, `opponents.12.gapToPlayerSeconds`), geen schema en geen versienummer per veld. Een onbekend pad is een fout in de zender; `applyDeltaFrame` gooit dan (`delta: pad ... bestaat niet`) in plaats van te gokken.
3. **Arrays per index.** Twee arrays van gelijke lengte worden per index vergeleken; een lengteverschil stuurt het veld in zijn geheel (`opponents`, `flags`). Zonder die regel was de eerste meting 11% in plaats van 91% — precies bij tegenstanders is "de hele array" funest.
4. **Verwijderen is `null`**, één op per veld. Diepterem is 6 (`MAX_DEPTH`, `delta.ts:44`).
5. **De basis wordt nooit gemuteerd.** `applyDeltaFrame` werkt op een `structuredClone`, zodat een halve toepassing de bewaarde basis niet beschadigt.

Beschikbare functies: `diffFrames` (`delta.ts:51`), `applyDeltaFrame` (`:119`), `nextFrame` (`:152`, keyframe of delta), `frameSize` (`:188`, bytes zoals ze over de lijn gaan).

Twee nuances die in de commit-tekst niet staan:

- Het protocol heeft **geen ack**. `nextFrame` weet niet of de server het frame heeft aangenomen; de zender moet dat zelf regelen (zie §7.2).
- De kop van `delta.ts` noemt "tien keer per seconde", maar de connector staat standaard op **1 Hz** (`ConnectorSettings.SendIntervalMilliseconds = 1000`, vloer 500 ms in de zendtick). De winst is er nog steeds (18,9 kB/s → 1,65 kB/s bij 40 tegenstanders), maar de 413 komt van de **framegrootte**, niet van de frequentie.

---

## 3. Waar het in de code zit (en wat er omheen hangt)

Huidige keten, elke stap:

| Stap | Bestand | Regel |
|---|---|---|
| Envelope bouwen | `tools/simhub-plugin/3SM.EnduranceConnector/EnduranceConnectorPlugin.cs` → `CaptureV3` | 1208 |
| Tegenstanders begrenzen op 40 | idem, `MaxOpponentsPerSnapshot` | 36, 1412–1450 |
| `vehicle` alleen bij uitgebreide telemetrie | idem | 1342 |
| Serialiseren (`DataContractJsonSerializer`) | idem, `Serialize` | 1732 |
| Verzenden | idem, `SendV3Async` | 1498 |
| Sessie/sequence reset (3 plekken) | idem | 171, 653, 980 |
| Wire-contract | `TelemetryContractsV3.cs` (`TelemetryEnvelopeV3`, `V3Opponent`) | 11, 60 |
| Bodylimiet 24.576 B | `supabase/functions/_shared/simhub.ts` → `readBoundedJson` | 540 |
| Versie-dispatch | `supabase/functions/simhub-ingest-v3/index.ts` | 46–49 (v1/v2), 81 (v3), 143 (rest → 422) |
| Context + autorisatie | `supabase/functions/simhub-ingest-v3/context.ts` | 80–94 (versie-dispatch), 96–101 (binding/authority) |
| V3-validator | `supabase/functions/_shared/simhub.ts` → `parseTelemetryV3Envelope` | 296 |
| Tegenstander-validator | `supabase/functions/_shared/opponents.ts` → `parseOpponents` | 70 |
| Persist + sequence-poort | `public.simhub_persist_v3` | `20261025020000_…sql:2` |
| Basisopslag per device | `public.simhub_telemetry_latest` (`v3_normalized`, `session_id`, `sequence`) | idem, 281–300 |
| Lees-kant (pitwall) | `get_pitwall_data` leest `v3_normalized` | `20260904110000_…sql:57` |

Twee dingen vallen op als je dit leest:

- **`simhub-ingest` (v1/v2) en `simhub-practice` blijven buiten scope.** Practice parseert alleen v1/v2-envelopes; de race loopt via `simhub-ingest-v3`.
- **De basis voor reconstructie bestaat al.** `simhub_persist_v3` schrijft bij elk geaccepteerd frame de volledige genormaliseerde payload weg in `simhub_telemetry_latest.v3_normalized`, samen met `session_id` en `sequence`. Er hoeft dus geen nieuwe tabel en geen nieuwe cache te komen; de delta kan tegen die rij worden opgeteld.

---

## 4. De vijf gaten

1. **De plugin zendt alleen volledige envelopes.** `SendV3Async` serialiseert `TelemetryEnvelopeV3` en post die; er is geen basis, geen `seq`-gedreven delta en geen keyframe-beleid.
2. **De Edge kent geen vierde protocolversie.** Alles buiten 1/2/3 valt in `index.ts:143` en wordt `422 invalid_payload`.
3. **De validator is streng en V3 is bevroren.** `parseTelemetryV3Envelope` doet `exactKeysAllowExtra` op de root (`simhub.ts:298`): elk nieuw rootveld (`kind`, `ops`, `baseSeq`) is "payload contains unknown fields" → 422. Het V3-contract mag niet veranderen (vastgelegd in `docs/operations/2026-09-04-endurance-pitwall-next-phase-data-expansion.md`: "V3 is frozen — do NOT change its shape").
4. **Er is geen plek waar de delta wordt toegepast.** De RPC krijgt één volledige `p_v3_normalized`; niemand telt `ops` ergens bij op.
5. **Er is geen ack-binding en geen foutpad.** Zonder ack schuift de plugin zijn basis na een mislukte POST door en loopt hij uit de pas met de server. En een 413 is in de diagnostics nu onzichtbaar: `ResolveCode` kent alleen 401/403/429/5xx (`DiagnosticsClient.cs:341–353`); een 413 valt door naar de algemene codes en heet in de praktijk `OK`. Alleen "telemetry ingest is stale" verraadt het, minuten later.

---

## 5. Envelope- en validatorvelden

### 5.1 Voorstel: `protocolVersion: 4` met een frame-envelope

Aparte versie, geen extra velden in V3. Dat houdt de oude plugin (0.6.1.1) werkend, houdt het V3-contract bevroren en maakt de terugrol trivaal (§9).

```jsonc
// keyframe
{
  "protocolVersion": 4,
  "kind": "keyframe",
  "seq": 41,
  "capturedAt": "2026-10-25T20:14:02.113Z",
  "transportSessionId": "simhub-8f2c…",
  "data": { "protocolVersion": 3, "sequence": 41, /* … volledige V3-payload … */ }
}

// delta
{
  "protocolVersion": 4,
  "kind": "delta",
  "seq": 42,
  "baseSeq": 41,
  "capturedAt": "2026-10-25T20:14:03.114Z",
  "transportSessionId": "simhub-8f2c…",
  "ops": [["timing.completedLaps", 85], ["opponents.3.gapToPlayerSeconds", -12.7]]
}
```

| Veld | Verplicht | Regel in de validator | Herkomst/gebruik |
|---|---|---|---|
| `protocolVersion` | ja | exact `4` | dispatch in `index.ts` + `context.ts` |
| `kind` | ja | `keyframe` \| `delta` | bepaalt het pad |
| `seq` | ja | integer ≥ 0, monotone per `(device, transportSessionId)` | wordt `p_sequence`; de DB weigert `<= last_sequence` (`20261025020000…sql:72`, `:210`) |
| `baseSeq` | ja bij `delta` | integer ≥ 0; **moet gelijk zijn aan de laatst opgeslagen `sequence`** van dit device+sessie, anders `409 keyframe_required` | sluit de races tussen twee frames |
| `capturedAt` | ja | ISO-8601, parsebaar, ≤ 40 tekens | wordt `p_captured_at` |
| `transportSessionId` | ja | 1–120 tekens | wordt `p_session_id` |
| `data` | ja bij `keyframe` | object; daarna **volledig** door `parseTelemetryV3Envelope` | basis + `p_v3_normalized` |
| `ops` | ja bij `delta` | array van `[pad, waarde]`, pad niet leeg, diepte ≤ 6, onbekend pad → 422 met het pad in de foutmelding | toegepast op de basis |

Aanvullend in de validator (geen extra velden, wel gedrag):

- **`ops` mag leeg zijn.** Een leeg frame betekent "niets veranderd"; het houdt `last_seen_at` en de nieuwste-sample vers. Niet weigeren.
- **Na toepassing opnieuw valideren met `parseTelemetryV3Envelope`.** Dat is de hele winst van deze opzet: sentinels (`-1`, `0`), bereiken (`fuelLitres ≤ 250`, `lapDistancePct ≤ 1`), enum-waarden en de tegenstander-cap van 40 blijven op één plek bewaakt. Een delta die een ongeldige waarde zet, wordt daardoor alsnog geweigerd — met dezelfde foutcodes als vandaag.
- **De bestaande responscodes blijven.** `accepted` → 202, `replayed` → 409, `rate_limited` → 429, `session_limit` → 409, `invalid_payload` → 422. Nieuw: **`keyframe_required` → 409** (basis kwijt of `baseSeq` klopt niet). De plugin moet daar direct met een keyframe op antwoorden, niet met een retry van dezelfde delta.
- **Geen `frame_bytes` in de envelope.** De server meet de framegrootte zelf (`Content-Length`) en bewaart die; een zelfgerapporteerd getal is niet te vertrouwen en voegt alleen bytes toe.

### 5.2 Waar de toepassing hoort te gebeuren

Twee opties, met een duidelijke voorkeur:

**A (aanbevolen, fase 1).** Edge past de delta toe met de bestaande, geteste `applyDeltaFrame`, valideert het resultaat met `parseTelemetryV3Envelope` en roept daarna de bestaande `simhub_persist_v3` aan met de volledige payload.

- Geen nieuwe SQL, geen nieuwe tabel, geen tweede implementatie van dezelfde regels.
- Eén extra `SELECT` per frame (basis ophalen uit `simhub_telemetry_latest`) en één extra klein RPC-argument `p_base_seq` als race-slot; de RPC controleert dat `p_base_seq = laatst opgeslagen sequence` en geeft anders `keyframe_required`. Zonder dat argument kan een trage frame 42 na frame 43 alsnog een verkeerde basis gebruiken.
- De Edge→DB-payload blijft even groot als nu (de gereconstrueerde payload). Dat is geen probleem: de winst zit op de pluginuplink, en daar zit de 24.576-grens.

**B (later, als het DB-verkeer knelt).** De ops in plpgsql toepassen (`jsonb_set` met `create_missing = false`) zodat de Edge alleen ~0,5 kB stuurt. Dat is zuiniger op de Edge→DB-hop en transactioneel vanzelf goed, maar het betekent een tweede implementatie van `applyDeltaFrame` in SQL, met eigen tests. Niet doen in de eerste ronde.

### 5.3 Minimale bedrading (zo klein mogelijk houden)

De goedkoopste aansluiting die niets aan de bestaande code verandert:

```
index.ts: protocolVersion === 4
  → parseDeltaFrame           (nieuw, _shared/simhub-v4.ts)
  → basis ophalen             (simhub_telemetry_latest, device uit token + session_id uit frame)
  → baseSeq controleren       → 409 keyframe_required
  → applyDeltaFrame           (bestaand, _shared/delta.ts)
  → reconstrueer body als protocolVersion 3 en laat de bestaande v3-tak het werk doen
```

Zo blijven `resolveTelemetryContext`, `parseTelemetryV3Envelope`, `record_opponent_gap_samples` en `simhub_persist_v3` exact zoals ze zijn, en is er één pad dat telemetrie wegschrijft. Alleen `p_base_seq` komt er als extra (default `null`) argument bij, zodat de race tussen twee frames in de transactie wordt afgevangen en v3-calls onveranderd blijven.

Twee praktische notities:

- In `contracts/` staan `simhub-telemetry.v1`, `.v2` en `simhub-vehicle.v1` — **geen v3-schema**, ondanks de verwijzing in de kop van `TelemetryContractsV3.cs`. Validatie zit in `_shared/simhub.ts`; een v4-schema toevoegen is optioneel en verandert daar niets aan. Reken er niet op dat een JSON-schema-test bestaande afspraken afdwingt.
- De lokale bridge (`tools/simhub-bridge/server.mjs`, loopback) blijft buiten dit plan; die ziet alleen volledige frames.

---

## 6. Meetresultaten die er al zijn

Gemeten op een **echt pakket** van 24-10 (commit `c2c91ea`), keyframe → eerstvolgende delta:

| Tegenstanders | Volledig frame | Delta | Minder |
|---|---|---|---|
| 1 | 2.402 B | 176 B | 93% |
| 10 | 6.203 B | 504 B | 92% |
| 40 | 18.929 B | 1.650 B | 91% |

De eerste meting gaf 11%: arrays gingen in hun geheel mee. Na per-index vergelijken werd het 91–93%. De 1.650 B bij 40 tegenstanders komt neer op ongeveer 41 B per tegenstander die per tick van gat verandert — dat is de natuurlijke ondergrens van dit protocol bij een vol veld.

Ter controle nagerekend op een synthetisch V3-pakket (zelfde vorm, `node --experimental-strip-types` op een kopie van `delta.ts`, 25-10):

| Tegenstanders | Keyframe | Delta (enkele velden) | Delta (alle gaten + posities) |
|---|---|---|---|
| 1 | 2.010 B | 287 B | 314 B |
| 10 | 5.211 B | 287 B | 1.260 B |
| 40 | 16.041 B | 287 B | 4.470 B |

Die 287 B is een vloer (weinig veranderende velden); de 4.470 B is het andere uiterste (élk tegenstandergat en elke positie verandert elke tick). Het echte pakket zit met 1.650 B tussen beide in. De keyframes zijn iets kleiner dan gemeten omdat het synthetische pakket kortere namen en geen `vehicle` had — reken dus op de gemeten 18.929 B als je het budget bepaalt, niet op 16 kB.

Wat deze cijfers *niet* zijn: een meting over een hele race, en geen meting van de 413-gevoeligheid. Dat is testwerk (§10).

---

## 7. Risico's

### 7.1 413 bij 40 tegenstanders — het echte risico zit in het keyframe

De grens is **24.576 B** (`readBoundedJson`, `simhub.ts:540`), per verzoek, ongeacht protocolversie. Bij 40 tegenstanders:

| | Bytes | Van de limiet |
|---|---|---|
| Volledig frame (gemeten) | 18.929 | **77%** |
| Keyframe (synthetisch) | 16.041 | 65% |
| Delta (gemeten) | 1.650 | 7% |

Het keyframe is dus het probleem, niet de delta. En keyframes komen precies op de momenten dat het veld vol staat: **de eerste frame van een sessie** (formatieronde, volledig startveld), na een herverbinding en na elke recovery. Groei per tegenstander is ongeveer **424 B** ((18.929 − 2.402) / 39), dus de limiet zit op **ongeveer 53 tegenstanders** — daar zit geen marge voor langere team- en coureurnamen, een extra veld in het V3-contract of de `vehicle`-uitbreiding (die vier banden met drie waarden toevoegt).

Wat we doen, in deze volgorde:

1. **Budgetcheck in de plugin vóór verzenden.** `frameSize` bestaat al. Keyframe boven 20 kB → kleiner keyframe sturen: tegenstanders terug naar 30, `vehicle` weglaten. Twee regels die daarbij horen, anders maakt de oplossing het erger:
   - De basis aan de plugin-kant moet **exact** het verkleinde pakket zijn dat de server krijgt. Verwijst de eerstvolgende delta naar een pad dat de server niet heeft (`opponents.35.…`, `vehicle.speedKph`), dan is dat 422 en blijft de plugin hangen.
   - Daarom hoort bij een verkleind keyframe ook een verkleinde capture (30 tegenstanders, geen `vehicle`) tot de volgende normale keyframe. Anders ziet `nextFrame` een lengteverschil in `opponents` en stuurt hij de hele array alsnog — 15 kB delta in plaats van 1,6 kB.
2. **Geen basis vooruit bij een mislukte POST** (§7.2). Anders blijft een 413 zichzelf herhalen met delta's die de server nooit kan toepassen.
3. **Optie B: de limiet verhogen** naar bijvoorbeeld 32.768 B (`readBoundedJson(request, 32768)` in `simhub-ingest-v3`). Technisch triviaal — 24.576 is onze eigen grens, niet die van Cloudflare of Supabase — maar het kost geheugen/CPU in de Edge en het verbergt het onderliggende probleem (een payload die per tegenstander groeit). Alleen doen als de budgetcheck in de praktijk te vaak hoeft in te grijpen.
4. **413 zichtbaar maken.** `INGEST_413` als diagnostics-code toevoegen (`DiagnosticsClient.cs:341`) plus het label in de admin-UI. Nu verschijnt een 413 als `OK` en zie je alleen een stale pitwall.

### 7.2 Basis-drift (het gevaarlijkste faalpad, en het is stil)

Als de plugin zijn basis laat schuiven terwijl de server die van hem niet heeft, gaan delta's over een andere basis dan de server heeft. De server merkt dat **niet** aan de waarden — die zien er plausibel uit. Het resultaat is een pitwall die stil bevriest of onzin toont, midden in een race.

| Oorzaak | Wat er moet gebeuren |
|---|---|
| 413, 429, 500, timeout | basis **niet** bijwerken; volgende frame opnieuw proberen met dezelfde `seq` en dezelfde basis |
| `baseSeq` klopt niet (409 `keyframe_required`) | direct een keyframe, basis vervangen, `seq` door laten lopen |
| SimHub herstart / plugin herlaadt | basis leegmaken én nieuwe `transportSessionId` (gebeurt al: `EnduranceConnectorPlugin.cs:171, 653, 980`) |
| Nieuwe sessie (spelstart, koppeling) | idem: basis leeg, keyframe eerst |
| Twee pc's met dezelfde coureur | twee devices, twee tokens, twee bases — geen interactie; wel opletten bij de run-detectie (punt 5/6 van de lijst) |
| Sequentie-rollback | de DB geeft `replayed`; de plugin moet dan een keyframe met een hogere `seq` sturen, niet blijven hangen |

Harde eis voor de release: **de plugin moet zichzelf kunnen herstellen**. Na N opeenvolgende mislukte frames (voorstel: 3) gaat hij terug naar volledige V3-frames tot er weer een 2xx is. Zonder dat is een terugrol van de serverkant een storing in plaats van een terugrol.

### 7.3 Contract- en validatierisico

- V3 is bevroren; de vierde versie moet **additief** zijn. Oude plugin (0.6.1.1) blijft v3 sturen en moet ongewijzigd 202 krijgen. Dat is de belangrijkste eigenschap van deze opzet: de server kan v4 aannemen vóór er één plugin is die het stuurt, en de terugrol is "v4-branch uitzetten".
- Een delta die een pad raakt dat niet bestaat, moet **422** geven en niets wegschrijven. `applyDeltaFrame` gooit al; de Edge moet dat als `invalid_payload` vertalen en niet als 500.
- De reconstructie moet door de bestaande V3-validator. Anders ontstaat er een tweede, lossere waarheid over wat een geldige payload is.

### 7.4 Lees-kant

`get_pitwall_data` exposeert `v3_normalized` rechtstreeks (`20260904110000_pitwall_v1_read_rpc.sql:57,155`). Een half toegepaste delta is daardoor geen theoretisch probleem: de pitwall laat het zien. Dat maakt het ook de beste bewaking — vergelijk tijdens de test een delta-run met een v3-run op de opgeslagen `v3_normalized` (§10.3).

### 7.5 Replay, snelheidslimiet en run-detectie

- `p_sequence <= last_sequence` → `replayed` (409), en de 400 ms rate-limit per device (`20261025020000…sql:67`) blijft gelden. Delta's veranderen daar niets aan: elk frame houdt zijn eigen `seq` en `capturedAt`.
- Ronde-detectie vergelijkt `previous_completed_laps` met `timing.completedLaps` uit de **gereconstrueerde** payload. Zolang de reconstructie byte-gelijk is aan wat v3 zou hebben gestuurd, verandert er niets aan `lap_completed`-events of run-splits. Is hij dat niet, dan verdwijnen er stil rondes — vandaar §10.3 als harde acceptatie.
- Lege delta's (niets veranderd) schrijven net als nu een nieuwe `telemetry_latest`-rij. Geen gedragsverschil.

### 7.6 Racedag

Niet aanzetten in de laatste uren voor een race, en niet als eerste test een endurance-race gebruiken. Eerste echte meting hoort een training of practice-sessie met een vol veld te zijn, op één device, met de canary-channel van de plugin.

---

## 8. Activeren — exacte stappen

Volgorde is niet vrijblijvend: **eerst de server, dan de plugin**. De serverkant is additief en doet niets zolang er geen v4-frame binnenkomt; de plugin kan pas veilig uit als de server het frame kent. Elke stap heeft een eigen terugdraaipunt (§9).

### Stap 0 — Voorbereiding (geen wijziging)

```bash
# branch vanaf main
git checkout main && git pull
git checkout -b feat/delta-frames-activation

# back-up van de edge-functie die je gaat aanpassen
ssh 3sm-web "ssh 3sm-docker 'cp -a /opt/supabase/docker/volumes/functions/simhub-ingest-v3 /var/backups/3sm/simhub-ingest-v3-\$(date +%Y%m%d-%H%M)'"

# back-up van de DB-functie en het schema
ssh 3sm-docker "docker exec -i supabase-db pg_dump -U supabase_admin -d postgres --schema-only --no-owner -f /tmp/pre-delta-schema-\$(date +%Y%m%d).sql"
ssh 3sm-docker "docker exec -i supabase-db psql -U supabase_admin -d postgres -Atc \"SELECT pg_get_functiondef(p.oid) FROM pg_proc p WHERE p.proname='simhub_persist_v3';\"" > /tmp/simhub_persist_v3-voor.sql
```

### Stap 1 — Validator en reconstructie (server, additief)

- `supabase/functions/_shared/simhub-v4.ts` (nieuw): `parseDeltaFrame` volgens §5.1, met dezelfde helpers als `simhub.ts` (`exactKeysAllowExtra`, `text`, `numberValue`).
- `supabase/functions/simhub-ingest-v3/index.ts`: branch op `protocolVersion === 4` → frame parsen, basis ophalen uit `simhub_telemetry_latest` (device uit het token, `session_id` uit het frame), `baseSeq` controleren, `applyDeltaFrame`, daarna `parseTelemetryV3Envelope` en de bestaande `simhub_persist_v3`-aanroep. `keyframe_required` → 409.
- Meting meteen meenemen, zonder extra schrijflast: `Content-Length` en `kind` doorgeven aan de RPC en in de bestaande `telemetry_latest`-upsert bijwerken als **tellers** per device (`frames_total`, `keyframes_total`, `bytes_total`, `max_frame_bytes`, `last_frame_kind`, `last_frame_bytes`). Eén `UPDATE`, geen extra rij per frame — `simhub_telemetry_latest` heeft één rij per device, dus tellers zijn de enige manier om er een gemiddelde uit te halen.
- `p_base_seq` als extra (default `null`) argument op `simhub_persist_v3`; `null` betekent "geen controle", zodat v3-calls exact hetzelfde blijven werken.

```bash
npm test                                             # moet groen blijven
```

Deploy: de gewijzigde bestanden naar `3sm-docker:/opt/supabase/docker/volumes/functions/simhub-ingest-v3/` en `…/functions/_shared/`, daarna de functies herstarten:

```bash
ssh 3sm-web "ssh 3sm-docker 'cd /opt/supabase/docker && docker compose up -d --force-recreate functions'"
```

Verificatie (moet beide keren het verwachte antwoord geven):

```bash
TOKEN=...   # device-token van een testdevice
# 1. oude plugin-pad: ongewijzigd
#    (reguliere v3-POST) → 202 accepted
# 2. keyframe v4 → 202, delta met goede baseSeq → 202,
#    delta met foute baseSeq → 409 keyframe_required,
#    delta met onbekend pad → 422 invalid_payload
```

### Stap 2 — Plugin 0.7.0

- `TelemetryContractsV3.cs` uitbreiden met `TelemetryFrameV4` (of een los `DeltaContracts.cs`), zodat de serializer het frame kan wegschrijven.
- `EnduranceConnectorPlugin.cs`: `_deltaCache` (laatste payload + `seq`), gevuld in `SendV3Async`; keyframe bij lege cache of na `forceKeyframe`; basis pas bijwerken **na** een 2xx; bij 409 `keyframe_required` direct een keyframe; na 3 fouten terug naar volledige v3-frames; cache leegmaken op de drie sessie-reset-plekken (171, 653, 980).
- `ConnectorSettings.cs`: `DeltaFramesEnabled = false` (default uit, ook in 0.7.0) + `SchemaVersion`-migratie zoals bij eerdere instellingen.
- `SettingsControl.cs`: toggle naast "Uitgebreide Pitwall-telemetrie" (regel 141 is het patroon).
- `DiagnosticsClient.cs`: `INGEST_413` toevoegen aan `ResolveCode` en aan de labels.

```bash
# release volgens de bestaande workflow, eerst canary
tools/simhub-plugin/release.sh            # bump + build op Beest + sign + upload + edge-env
```

Uitrollen via de TEST/canary-channel (`docs/operations/telemetry-test-channel-workflow.md`), niet meteen stabiel.

### Stap 3 — Aanzetten, in deze volgorde

1. **Eén device, training.** `DeltaFramesEnabled` aan op de pc van één tester; 30 minuten practice met een vol veld. Bewaking: §10.5.
2. **Eén device, race-achtige stint.** Zelfde device, een uur met pitstops en een coureurswissel.
3. **Canary-fleet** (de TEST-testers): vlag aan via de instellingen, niet via een nieuwe build.
4. **Stabiel.** Pas na een volledige race zonder 413 en met gelijke rondes/events (§10.5).

Terug naar volledige frames is op elk moment één vinkje; de server hoeft daarvoor niet mee.

### Stap 4 — Meten en afronden

```sql
-- framegrootte per device (na stap 1; tellers, want één rij per device)
SELECT device_id, session_id, sequence,
       frames_total, keyframes_total,
       round(bytes_total::numeric / greatest(frames_total, 1)) AS gemiddeld_bytes,
       max_frame_bytes, last_frame_kind, last_frame_bytes
FROM public.simhub_telemetry_latest
WHERE frames_total > 0
ORDER BY device_id;
```

Een 413 haalt deze tabel nooit (het verzoek wordt vóór de RPC geweigerd), dus die tel je in de diagnostics (`INGEST_413`) of in de plugin-statusregel — niet in SQL.

Daarna: punt 12 afvinken in `~/3sm-na-de-race-lijst.md`, en punt 14 (de regel over de relayfrequentie) uit het racedisplay halen — die mededeling verwijst naar iets dat dan aangesloten is.

---

## 9. Terugdraaien

Drie niveaus, onafhankelijk van elkaar. Het ontwerp is erop gemaakt dat **niveau 1 altijd genoeg is**.

| Niveau | Actie | Effect | Tijd |
|---|---|---|---|
| 1. Plugin | `DeltaFramesEnabled` uit (instellingen), of terug naar 0.6.1.1 via de update-channel | Plugin stuurt weer volledige v3-frames; server doet niets anders dan voorheen | seconden |
| 2. Server | backup terugzetten + `docker compose up -d --force-recreate functions` | v4-frames krijgen 422; **een 0.7.0-plugin moet dan automatisch terugvallen op v3** (harde eis, §7.2) | minuten |
| 3. Database | `simhub_persist_v3` terugzetten uit `/tmp/simhub_persist_v3-voor.sql`; extra kolommen laten staan | v3-pad weer exact zoals het was | minuten |

```bash
# niveau 2
ssh 3sm-web "ssh 3sm-docker 'cp -a /var/backups/3sm/simhub-ingest-v3-<datum>/. /opt/supabase/docker/volumes/functions/simhub-ingest-v3/ && cd /opt/supabase/docker && docker compose up -d --force-recreate functions'"

# niveau 3
cat /tmp/simhub_persist_v3-voor.sql | ssh 3sm-docker "docker exec -i supabase-db psql -U supabase_admin -d postgres"
```

Wat je **niet** terugdraait: de tellerkolommen (`frames_total`, `bytes_total`, …) en de events die al geschreven zijn. Die zijn additief en historisch; ze weggooien kost alleen informatie. `simhub_telemetry_latest` blijft hoe dan ook de volledige payload bevatten, dus de pitwall merkt niets van een terugrol.

---

## 10. Testplan

### 10.1 Unit (vitest, `npm test`)

Bestaand: `src/test/deltaProtocol.test.ts` (9 tests). Aanvullen met de gaten die er nu niet in zitten:

| Test | Waarom |
|---|---|
| 40 tegenstanders: keyframe < 24.576 B en delta < 2.048 B | het budget is nu nergens vastgelegd; dit is de test die 413 voorkomt |
| delta op onbekend pad → gooit | bestaat, maar alleen met een scalair pad; ook `opponents.99.gapToPlayerSeconds` toevoegen |
| array korter → veld in zijn geheel, waarde gelijk | bestaat; ook array **langer** toevoegen |
| `null` na `null` → geen op | voorkomt ruis in elk frame |
| diepte > 6 → één op voor het hele veld | `MAX_DEPTH` is ongetest |
| lege `ops` → frame < 40 B | bestaat impliciet; expliciet maken |
| keyframe na `forceKeyframe` met gevulde cache | recovery-pad |

### 10.2 Validator en contract (Edge)

- v3-envelope ongewijzigd geaccepteerd (regressie op `parseTelemetryV3Envelope`).
- v4-keyframe geaccepteerd; v4-delta geaccepteerd.
- Onbekend rootveld in v4 → 422; `kind` ontbreekt → 422; `baseSeq` ontbreekt bij delta → 422.
- `baseSeq` ≠ opgeslagen sequence → 409 `keyframe_required`.
- Delta met een pad dat niet bestaat → 422, **en niets weggeschreven** (controleer `simhub_telemetry_latest.received_at`).
- Delta die een ongeldige waarde zet (`fuelLitres: 400`, `lapDistancePct: 2`) → 422 via de V3-validator, niet via een crash.
- `seq` terug → 409 `replayed`; `seq` gelijk → 409 `replayed`.

### 10.3 Reconstructie-gelijkheid (de belangrijkste test)

Een opgenomen reeks echte v3-pakketten (minimaal 500 frames, inclusief sessiewissel, een coureurswissel en een tegenstander die wegvalt) door beide paden halen:

```
reeks → v3-pad  → v3_normalized_A
reeks → v4-pad  → (keyframe, delta's) → v3_normalized_B
```

Acceptatie: `A = B` voor **elk** frame, vergeleken als jsonb (dus inclusief `null`-velden en array-volgorde). Niet 99%: één afwijkend frame betekent een gemiste of dubbel getelde ronde. Dit is de test die bepaalt of het aan mag.

### 10.4 Foutpaden

| Scenario | Verwachting |
|---|---|
| Keyframe > limiet (kunstmatig opgeblazen) | 413 → plugin verkleint (30 tegenstanders, geen `vehicle`) → 202 |
| 429 (te snel) | basis blijft, retry met dezelfde `seq`, geen gat in de data |
| 500 / timeout | idem; na 3 fouten volledige v3-frames |
| Plugin herstart midden in een sessie | nieuwe `transportSessionId`, keyframe, server begint een nieuw segment — geen `replayed`-lus |
| Delta terwijl de server de basis kwijt is (rij verwijderd) | 409 `keyframe_required` → keyframe → 202 |
| Twee devices, dezelfde coureur | twee onafhankelijke bases, geen kruisbesmetting |

### 10.5 Live acceptatie (per stap van §8, Stap 3)

| Criterium | Drempel |
|---|---|
| 413's | 0 in dertig minuten |
| Grootste keyframe | ≤ 20 kB (gemeten pakket was 18,9 kB) |
| Gemiddelde framegrootte bij 40 tegenstanders | ≤ 2 kB |
| Datavermindering op de uplink | ≥ 85% (gemeten 91%) |
| Rondes, `lap_completed`-events en pitstops | identiek aan een v3-run over dezelfde sessie |
| Pitwall | geen gat, geen "geen rondetijd data" (punt 15 van de lijst mag hier niet door getriggerd worden) |
| Ingest-latency (received_at − captured_at) | binnen 10% van de v3-run |

Bewaking tijdens de test: `/admin` → Connectors (fleet + per-device status), de statusregel in SimHub ("V3 … seq"), en de SQL uit §8, Stap 4.

---

## 11. Beslissingen die nog genomen moeten worden

1. **Versie 4 als aparte `protocolVersion`, of `kind`/`ops` als extra velden in 3?** Dit plan kiest 4: V3 blijft bevroren en de terugrol is schoon. Alternatief is goedkoper aan de plugin-kant maar raakt het bevroren contract.
2. **Limiet verhogen van 24.576 naar 32.768 B?** Nu niet; eerst de budgetcheck. Alleen als de check in de praktijk te vaak ingrijpt.
3. **Wie draait de reconstructie-gelijkheidstest (§10.3) en wanneer?** Die vraagt een opgenomen reeks echte pakketten; dat kan uit een training, niet uit een race van 24-10 (die data is er niet als reeks).
4. **Wanneer aanzetten?** Niet vóór een race. Eerste echte meting: een training met een vol veld, één device.
5. **Punt 14 van de lijst** (relayfrequentie-regel in het racedisplay) kan pas weg als dit aan staat en bewezen is.

---

## 12. Bijlage — wat dit plan expliciet niet doet

- Geen wijziging aan `delta.ts`: het protocol is af en getest.
- Geen wijziging aan de V3-validator of het V3-contract.
- Geen nieuwe tabel: `simhub_telemetry_latest` heeft de basis al.
- Geen compressie, geen chunking, geen tweede ingest-pad: dit gaat over stilte, niet over inpakken.
- Geen aanpassing aan `simhub-ingest` (v1/v2), `simhub-practice` of de lokale bridge; die blijven volledige frames.
