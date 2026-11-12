# T13-S1 — observation capture op de server (bouw + geïsoleerde test)

Status: **GEBOUWD EN LOKAAL GETEST / NIET UITGEROLD**. Dit document is vóór de
code geschreven als acceptatiebrief; de uitslagen zijn er later aan toegevoegd.
Er is **geen** productie-DDL, geen Edge-deploy, geen producer-release en geen
productiecontainer geraakt.

## 1. Wat deze slice toevoegt

Eén samenhangend serverpad voor het optionele `observation`-blok uit
`docs/contracts/pitwall-learning-observation-context-v1.md`:

```
payload.lapSummaries[i].observation
  -> simhubExtensions.parseLapSummariesReport (approved parseLapObservation)
  -> simhub_persist_v3 -> simhub_persist_measurement_batch
  -> row-level device fence (p_device_id, niet de client)
  -> conditionele hash v2 / bestaande hash v1
  -> public.simhub_lap_summaries.observation (jsonb, NULL = legacy)
  -> P1 statement-trigger -> pitwall_learning.capture_batches (dun, immutable)
```

De C#-producer, de outbox, T09/T10/T11/T12, de UI en de Edge-deploy blijven
buiten scope. De producer blijft **OFF**.

## 2. Schakelaars (beide default OFF, geen clientflag)

| Laag | Schakelaar | Default | Effect als OFF |
|---|---|---|---|
| Edge-parser | `SIMHUB_OBSERVATION_V1_ENABLED` (env) | `false` | `observation` is een onbekend veld; die rij wordt afgekeurd zoals vandaag. Geen gedragswijziging. |
| Edge -> DB | `simhub_observation_v1_available()` (probe, TTL 60 s) | n.v.t. | Probe false of fout: parser accepteert het blok niet; de rij krijgt `observation_unavailable`. Er wordt niets stil gestript. |
| DB-schrijver | `pitwall_learning.runtime_settings.observation_enabled` | `false` | Een rij met `observation` wordt rij-level geweigerd (`observation_unavailable`); legacy rijen lopen ongewijzigd door. |

Activering vereist dus **env=on EN probe=waar EN DB-flag=aan**. De probe bestaat
alleen als de hele DB-package aanwezig is (kolom + guard + hash v2 + flag).

## 3. Rijscope en foutgedrag

- Afwezig `observation` = legacy: geen kolomwaarde, **geen** extra JSON-sleutel,
  hash blijft exact de bestaande v1-formule.
- `observation: null`, een ongeldig blok of `pitRoad:false`/`refuel:0` = rijafwijzing
  (`observation_null` / `observation_invalid`), nooit stil legacy.
- `capture.deviceId` wordt eerst als UUID-geformatteerd gevalideerd en daarna
  hoofdletterongevoelig vergeleken met `p_device_id` (servercontext). Een mismatch
  weigert **de hele meetrij** met `observation_device_mismatch`: geen
  `simhub_lap_summaries`-insert/update en dus ook geen P1-capture voor die rij.
  Andere rijen en het kernframe lopen door.
- De weigering is een rij-ACK-diagnose (`measurements.laps.rejected[]`,
  `stage: "database"`). Er is **geen** quarantainetabel en geen retry- of
  data-lifecyclebewijs; lokale quarantaine in de producer is C#-werk voor later.
- `simhub_apply_lap_row` (de rij-voor-rij terugval) heeft dezelfde poort, zodat
  ook een directe service-role-aanroep geen vreemde observation-rij schrijft.

## 4. Hash en P1

- `simhub_lap_row_hash` (v1) blijft **byte-identiek**; alleen bij non-null
  observation wordt `simhub_lap_row_hash_v2` gebruikt: dezelfde velden plus de
  gevalideerde ruwe `observation`. Geen backfill, geen herschrijving van
  historische hashes.
- Zelfde `device_id` + `summary_uid` + `record_revision` met een andere
  observation = `revision_conflict`; exacte herverzending = `duplicate`; hogere
  revisie = `superseded`. Ordering blijft uitsluitend `record_revision`.
- `observation` is revisie-inhoud, geen pointer: een hogere revisie zonder blok
  schrijft NULL (de oudere P1-revisie blijft immutable bewaard). Er is geen
  COALESCE-retentie zoals bij `supersedes_summary_uid`; dat is bewust, zodat hash
  en opgeslagen rij altijd hetzelfde beschrijven.
- P1 neemt alleen `n.observation` op in de bestaande allowlist-payload. Geen
  owner-ID, geen namen, geen frames. `jsonb_strip_nulls` laat legacy-payloads
  bytegelijk. De serverhash van de rij is de P1-`content_hash`.
- Ruwe observation-strings (UUID-case, 0..7 fractiecijfers) blijven in jsonb
  staan. De hash gaat over die opgeslagen waarde; er is geen `Date.parse` en geen
  ms-afronding. De PG-timestampkolommen van de meetrij zijn niet de bron van de
  observation-tijden.

## 5. Rollback

`supabase/rollbacks/<ts>_pitwall_learning_observation_capture.sql` is een
**data-preserving disable-amendment**, geen schema-down:

- kolom, constraints, hash-v2-functie en probe blijven bestaan (geen DROP);
- `observation_enabled` gaat op `false`;
- de P1-capturefuncties gaan terug naar hun exacte P1-projectie zonder
  `observation`;
- de schrijver blijft de nieuwe versie: een observation-rij wordt na rollback
  expliciet `observation_unavailable` geweigerd. De oude schrijver terugzetten
  zou zo'n rij juist stil accepteren en strippen (en de v2-hash als conflict
  herclassificeren); dat is hier expliciet géén "veilige" rollback.
- bestaande observation-rijen en hun P1-revisies blijven staan.

## 6. Acceptatiematrix (bewijs, geen plan)

| # | Eis | Bewijs |
|---|---|---|
| A1 | legacy parser/ACK ongewijzigd | bestaande 216 Deno-tests + nieuwe mixed-test |
| A2 | geaccepteerd blok, ruwe waarden behouden, geen owner | Deno-integratietest |
| A3 | `null`/`false`/`0` = rijafwijzing, geen framefout | Deno + SQL |
| A4 | device-mismatch = hele rij geen insert/P1, andere rijen door | SQL |
| A5 | directe RPC-bypass schrijft geen vreemde rij | SQL |
| A6 | v1-hash bekend vector onveranderd; v2 alleen bij non-null | SQL (pre/post) |
| A7 | retry/conflict/revisie/supersede | SQL |
| A8 | P1-projectie zonder owner, hash = rijhash | SQL |
| A9 | 2048 wire / 4096 jsonb apart, multibyte | Deno + SQL |
| A10 | rollback: legacy write, historie behouden, probe false | SQL |
| A11 | ACL: anon/authenticated geen rechten | SQL catalog |
| A12 | learning-regressie | bestaande suite |
| A13 | geen hele-frame-abort bij één kapotte rij | Deno + SQL |

## 7. Niet-claims

Geen productieapply, geen deploy, geen producer, geen quarantaineopslag, geen
retentie/evictie, geen offline-SDK-bewijs, geen performance-GO, geen
volledigheidsclaim en geen "waarheid" van `sessionUniqueId`/`sessionNumber`.
De SQL-guard is een **structurele** subset (allowlist, types, caps, UUID,
tijdorde, feit-aanwezigheid); de exacte decimale budgetinvarianten blijven
eigendom van de goedgekeurde TS-parser, die als enige de wire-rijen aanlevert.

**PRODUCTIEWIJZIGING: NEE.**
