# Meetcontract v1 — identiteit, revisies, ACK en dekking

Versie: **0.7.2.0** (plugin/server). `protocolVersion` blijft **3**.
Status: voorstel, niet uitgerold. Dit document is de afspraak tussen connector,
Edge en database; de DDL en de tests verwijzen hiernaar.

Waarom dit bestaat: de review van 6.1 sol stelde vast dat de dedupe-sleutel
`(device_id, event_id)` alleen werkt zolang een client-ID toevallig uniek blijft.
Een nieuwe transportsessie met een opnieuw begonnen teller (`evt-1`, `lap-17`)
verloor daardoor stil gegevens, en dezelfde waarneming met een nieuw ID werd
dubbel opgeslagen. Hieronder staat wat een ID is, wanneer het verandert en wat
elke laag ermee doet.

---

## 1. Identiteit

| Veld | Wie maakt het | Verandert het? | Betekenis |
|---|---|---|---|
| `eventUid` | connector, één keer per waarneming | **nooit** | duurzame identiteit van een meetgebeurtenis |
| `summaryUid` | connector, één keer per ronde | **nooit** | duurzame identiteit van een rondeaggregaat |
| `observedSessionId` | connector | nooit (hoort bij de waarneming) | sessie waarin de waarneming is gedaan |
| `deliveredSessionId` | server | per aflevering | sessie waarin de server de rij aannam |
| `eventId`, `summaryId` | connector | mag | leesbaar label, **geen** dedupe-sleutel |

Regels:

1. `eventUid` en `summaryUid` zijn UUID's, door de connector gemaakt met een
   cryptografische generator, en worden **in de outbox bewaard**. Een
   herverzending gebruikt exact hetzelfde UUID.
2. De uniciteit is `(device_id, event_uid)` en `(device_id, summary_uid)`.
   `transport_session_id`, `delivered_session_id` en `segment_id` maken daar
   **geen** deel van. Een reconnect levert dus een duplicaat, geen tweede rij —
   en een nieuwe sessie met dezelfde tellerstand levert geen verlies.
3. `observedSessionId` komt van de client en wordt nooit gevuld met de sessie
   waarin de rij toevallig aankwam. Een oude outbox-waarneming die pas na een
   reconnect wordt afgeleverd, houdt dus haar oorspronkelijke sessie.
4. De server is de baas over `device_id` en `delivered_session_id`. Wat de
   client daarover meestuurt, wordt geweigerd (onbekend veld) — niet stil
   overgenomen.
5. `segment_id` en `pit_visit_id` zijn context, geen identiteit. Twee
   waarnemingen in hetzelfde segment zijn twee rijen.

### Getest gedrag (reviewpunt 1)

| Situatie | Verwacht |
|---|---|
| reconnect, zelfde UUID, andere afleversessie | `duplicates`, één rij, `observed_session_id` ongewijzigd |
| procesherstart, oude outbox | idem |
| nieuwe simsessie, nieuwe UUID, oud label `evt-1` | nieuwe rij (geen verlies) |
| oude outbox-waarneming, eerste levering ná reconnect | geaccepteerd, `observed_session_id` = oude sessie, `delivered_session_id` = nieuwe |
| hetzelfde UUID twee keer in één batch | tweede keer `duplicates` of `revision_conflict` |

Bewijs: `supabase/tests/plugin08_review_repairs.sql`, sectie R1.

---

## 2. Revisies

Een waarneming kan later bevestigd of gecorrigeerd worden. Twee toegestane
vormen:

* **Revisie van dezelfde rij**: `recordRevision` omhoog (2, 3, ...). De rij wordt
  bijgewerkt; het oude `record_revision` blijft nergens bewaard.
* **Nieuwe gebeurtenis**: een eigen `eventUid` met `supersedesEventUid` naar de
  vorige. De oorspronkelijke rij blijft staan; de correctie is een eigen spoor.

Regels:

1. `recordRevision` is een geheel getal ≥ 1 (standaard 1) en gaat alleen omhoog.
2. Zelfde revisie + **zelfde inhoud** = duplicaat (herverzending).
3. Zelfde revisie + **andere inhoud** = `revision_conflict`: de rij wordt niet
   gewijzigd en de afwijzing staat in het ACK-antwoord. Stil negeren mag niet.
4. Lagere revisie = `stale_revision`, eveneens expliciet.
5. De inhoudelijke vingerafdruk (`content_hash`, md5 over de meetvelden) bepaalt
   of twee versies hetzelfde zeggen. `aggregationVersion` is de versie van het
   algoritme, niet van de waarneming; die twee worden niet vermengd.

Bewijs: sectie R2.

---

## 3. ACK per rij

Een frame-ACK is geen leveringsbewijs. Daarom geeft `simhub_persist_v3` sinds
0.7.2.0 een derde kolom terug: `measurement_ack`. De Edge voegt daar de
parserafkeuringen aan toe en antwoordt met:

```json
{
  "accepted": true,
  "receivedAt": "2026-10-31T12:00:00Z",
  "measurements": {
    "events": {
      "received": 3,
      "accepted": [{"id": "<uuid>", "record_revision": 1}],
      "duplicates": [{"id": "<uuid>", "record_revision": 1}],
      "superseded": [{"id": "<uuid>", "record_revision": 2}],
      "rejected": [
        {"id": "<uuid>", "index": 1, "reason": "wear_after_contract", "stage": "parser"},
        {"id": "<uuid>", "index": 2, "reason": "revision_conflict", "stage": "database"}
      ],
      "block_error": null,
      "stored": true
    },
    "laps": {"received": 1, "accepted": [{"id": "<uuid>", "record_revision": 1}], "duplicates": [], "superseded": [], "rejected": [], "block_error": null, "stored": true}
  },
  "aggregates": {"supported": true, "degraded": false, "reason": null, "retryInMs": null}
}
```

Regels:

1. Elke rij die niet is opgeslagen, staat met een `reason` in `rejected` — ook
   als de reeks als geheel werd afgekeurd (`block_error`: `not_an_array`,
   `too_many`).
2. `stage` zegt waar de afkeuring vandaan kwam: `parser` (Edge) of `database`.
   Beide `index`-waarden verwijzen naar de **oorspronkelijke** payload: de Edge
   vertaalt de databasepositie met de goedgekeurde rijen terug.
3. `accepted`, `duplicates` en `superseded` zijn objecten met de **bevestigde**
   `record_revision`. Bij meerdere revisies van dezelfde UUID weet de outbox
   daardoor welke versie de server heeft aangenomen.
4. `stored: false` betekent: deze reeks is **niet** duurzaam opgeslagen. Een
   outbox mag hem dan niet opruimen.
5. Bij een afgekeurd frame (`replayed`, `rate_limited`, ...) is `stored` false en
   noemt het antwoord de frame-uitkomst in `measurements`/`error`.
6. Een databaseantwoord met `ok:false` wordt nooit een leeg succes: de reeks
   krijgt `stored:false` en `block_error` noemt de reden
   (`measurement_batch_failed` of de specifieke fout). Redencodes zijn stabiel en Engels; ze zijn geen vrije tekst.

---

## 4. wear_v1

```json
{"version": 1, "scale": "remaining_percent", "fl": 12.5, "fr": 12.5, "rl": 12.5, "rr": 12.5}
```

* `version` = 1 (verplicht), `scale` = `"remaining_percent"` (verplicht).
  Zonder die schaal is "12" niet te onderscheiden van "12 procent versleten".
* `fl`, `fr`, `rl`, `rr` zijn verplicht, numeriek en eindig, 0..100.
* Onbekende sleutels zijn een fout. `"fl": "banana"` is een fout.
* Een waarneming met `wearBefore`/`wearAfter` **eist** `evidence` en
  `confidence` (0..1); anders is het geen waarneming en wordt de rij geweigerd.
  `evidence: null` of een ontbrekende `version` is geen bewijs respectievelijk
  geen geldig wear-object: beide worden al in de Edge afgewezen, met dezelfde
  regel als de database-CHECK.

## 5. evidence_v1

```json
{"version": 1, "source": "tire_sets_used", "channels": ["tire_sets_used"], "note": "optioneel"}
```

* `source` verplicht: `^[a-z0-9._:-]{1,64}$`.
* `channels` verplicht: 1..8 namen met dezelfde tekenset — wélke kanalen zijn
  gebruikt, niet alleen "er was bewijs".
* `note` optioneel, ≤ 200 tekens. Onbekende sleutels zijn een fout.
* Bewijs wordt in **jsonb-bytes** gemeten (de maat die de database opslaat), niet
  in tekens. Te groot bewijs is een expliciete afwijzing (`evidence_too_large`),
  nooit een stille null.

## 6. setGeneration

```json
{"version": 1, "fl": 3, "fr": 3, "rl": 3, "rr": 3}
```

Vier verplichte integers 0..1000; geen halve set, geen vrije vorm.

## 7. Dekking (coverage)

Dekking staat per metriekgroep, want temperatuur, brandstof en belasting kunnen
onafhankelijk ontbreken:

```json
{
  "temperature": {"validDurationSeconds": 120.0, "sampleCount": 2400, "maxGapSeconds": 0.1},
  "fuel":        {"validDurationSeconds": 120.0, "sampleCount": 2400, "maxGapSeconds": 0.1},
  "load":        {"validDurationSeconds": 120.0, "sampleCount": 2400, "maxGapSeconds": 0.1}
}
```

Regels:

1. Groepen: `temperature`, `fuel`, `load`. Onbekende groepen zijn een fout.
2. Elke groep heeft alle drie de velden; `sampleCount` is een geheel getal ≥ 0,
   `validDurationSeconds` en `maxGapSeconds` zijn ≥ 0 en ≤ 86400.
3. Een groep is **gedekt** als `sampleCount > 0` én `validDurationSeconds > 0`.
4. `complete: true` vereist **echte rondedekking**: alle drie de groepen, per
   groep ≥ 10 samples en een gat ≤ 2 s, en de som van de meetduren ≥ 80% van
   (`endedAt` − `startedAt`). Zonder venster is er geen bewijs en dus geen
   `complete`. Voldoet een ronde niet, dan blijft de rij geldig maar wordt
   `complete` op **false** gezet en noemt `invalidReasons` de reden
   (`coverage_missing:<groep>`, `coverage_samples:<groep>`,
   `coverage_gap:<groep>`, `coverage_duration:window`,
   `coverage_window_missing`). De Edge en de database gebruiken dezelfde regel.
5. Een waarde zonder dekking van haar eigen groep wordt geweigerd
   (`coverage_missing:<groep>`), niet als "meting" opgeslagen. Een integraal
   zonder dekking bestaat dus niet in de tabel.
6. `sample_count` (kolom) is `bigint` en de som van de groepen; de vlakke
   `valid_duration_seconds` en `max_gap_seconds` zijn afgeleiden (max over de
   groepen) en worden nooit uit de payload overgenomen.

---

## 7b. Rijder van een ronde

Een rondeaggregaat draagt de **SimHub-naam** van de rijder:

```json
{"currentDriverName": "Vincent de Vos", "driverChanged": false}
```

1. `currentDriverName` is tekst (1..64 tekens) en optioneel; `null` betekent
   "niet bekend". De connector kent geen user-UUID en stuurt er dus geen.
2. `currentDriverId` in een ronde is een fout
   (`client_driver_id_forbidden`). De **server** resolveert de naam naar
   `current_driver_id` met `simhub_resolve_driver_user`, binnen het team en
   event van het apparaat. Geen match of twijfel: leeg.
3. `driverChanged: true` samen met een ingevulde `currentDriverName` is
   tegenstrijdig en wordt geweigerd (`driver_changed_with_driver`) — in de Edge
   én in de database. Een wissel betekent: geen enkele rijder is de rijder van
   de hele ronde.

## 8. Grenzen

| Wat | Waarde | Waar |
|---|---|---|
| minimale tijd tussen frames | 400 ms | `simhub_persist_v3` (rate-limit) én `simhub_connector_config.send_interval_ms` |
| maximale HTTP-body | 24576 bytes | `readBoundedJson` én `payload_budget_bytes` |
| meetgebeurtenissen per frame | 200 (DB) / 20 (Edge) | batchgrens |
| rondeaggregaten per frame | 20 (DB) / 3 (Edge) | batchgrens |
| meetreeksen per frame (bytes) | 16384 (Edge) | `MaxMeasurementBatchBytes`, compacte JSON |
| bewijs per object | 4096 jsonb-bytes | databasedrempel |

De Edge-aantallen zijn **gemeten**, niet geschat. De oude 50/5-fixtures kostten
35.971 bytes compacte JSON (de reviewprobe mat 34.221 bytes met een net andere
fixture); dat past niet in de HTTP-body van 24.576 bytes en werd dus pas op de
bodylimiet geweigerd. Met 20 events en 3 rondes is een maximale batch 15.903
bytes, inclusief de kern van 821 bytes
(`supabase/tests/plugin08_payload_measure.ts`). Het batchbudget van 16.384 bytes wordt daarnaast apart
afgedwongen: een batch erboven wordt `payload_too_large` (stored:false met die
`block_error`); de core-telemetrie wordt dan wel opgeslagen.

Control publiceert alleen waarden die de ingest aanvaardt; een waarde buiten de
band wordt bij het schrijven geweigerd met `out_of_range` en een
`rejection_detail`. De beheerclient krijgt dat als **HTTP 400** met `reason`
(bijv. `sendIntervalMs:400..10000`), niet als 503 `write_failed`: het is een
invoerfout, geen storing.

## 9. Bewaartermijn

| Tabel | Termijn | Opruimen |
|---|---|---|
| `simhub_measurement_events` | 90 dagen na `received_at` | `simhub_prune_measurements()` — standaard een proef |
| `simhub_lap_summaries` | 400 dagen na `received_at` | idem |

Een termijn korter dan 30 dagen wordt geweigerd; de functie is service-role-only.

## 10. Terugdraaien

De rollbackketen is gegevensbehoudend en **per migratie**: de oude schrijver
komt terug, de tabellen en hun inhoud blijven staan. Er is bewust **geen
"volledige rollback"-recept**: de keten draait van nieuw naar oud en de
tussenstand is geen ondersteunde toestand om op te blijven staan.

De rollback legt geen oude tekstuniciteit (`device_id, event_id` /
`device_id, summary_id`) opnieuw op. Het nieuwe model staat twee UUID's met
hetzelfde tekstlabel toe; zo'n constraint zou op geldige meetdata klappen. De
oude schrijver dedupliceert daarom in de query (`where not exists`) en de
UUID-uniciteit blijft staan. De rollback is idempotent en getest met echte
rijen, hergebruikte labels, een leeg label, hogere revisies en
correctieverwijzingen (`supabase/tests/plugin08_review2_rollback_check.sql`).

Destructief opruimen staat in `supabase/rollback/plugin08_destructive_cleanup.sql`
en is een aparte, gedocumenteerde handeling na een export. Dat script verwijdert
eerst de tabellen en pas daarna de validatiefuncties: de CHECK-constraints hangen
aan die functies, dus de omgekeerde volgorde zou de opruiming laten stranden.
