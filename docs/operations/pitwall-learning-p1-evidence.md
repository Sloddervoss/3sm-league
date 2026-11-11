# Pitwall learning P1 — dunne capture-outbox en uitgestelde materialisatie

**Status: lokale P1-bouw op de afgeschermde PG15.19-kloon. GEEN productie-DDL,
geen push/main, geen live ingest, geen modeladvies. PRODUCTIEWIJZIGING: NEE.**

Dit document vervangt de eerdere beschrijving van de synchrone
statement-capture. De oude reviewlogs blijven staan onder
`/home/hermes/artifacts/3sm/pitwall-learning-p1-20261111/bounded-review/`; de
nieuwe ronde schrijft uitsluitend naar
`/home/hermes/artifacts/3sm/pitwall-learning-p1-20261111/thin-outbox-review/`.

De kloon `pitwall_learning_p1_rehearsal` bevat de exacte public/auth/extensions
schema-only baseline (99 public-relations inclusief 8 sequences, 165
public-policies, 0 bronrijen) en is alleen via `ssh 3sm-docker` + container
`pitwall-learning-p1-20261111` bereikbaar.

## 1. Wat er is gebouwd

| Onderdeel | Bestand |
|---|---|
| Forward T06/T07/T08 | `supabase/migrations/20261111163052_pitwall_learning_evidence.sql` |
| Paired rollback | `supabase/rollbacks/20261111163052_pitwall_learning_evidence.sql` |
| Schema/rol/constrainttest | `supabase/tests/pitwall-learning-schema.sql` |
| Dunne-outboxtest | `supabase/tests/pitwall-learning-thin-outbox.sql` |
| Capture/materialisatietest | `supabase/tests/pitwall-learning-capture.sql` |
| Jobtest | `supabase/tests/pitwall-learning-jobs.sql` |
| Echte rolprobes | `supabase/tests/pitwall-learning-access.sql` |
| Synthetische fixture (NO-PROD) | `supabase/tests/fixtures/pitwall-learning-p1-fixtures.sql` |
| Rehearsal-harness | `scripts/pitwall-learning/rehearse-p1.py` |

De migratie is één transactie (geen eigen `BEGIN/COMMIT`). De harness en alle
muterende streams beginnen met:

```sql
current_database() = 'pitwall_learning_p1_rehearsal'
AND current_setting('data_directory') = '/work/data'
```

De harness gebruikt uitsluitend:

```bash
ssh -o BatchMode=yes 3sm-docker \
  'docker exec -i pitwall-learning-p1-20261111 \
     psql -X -qAt -v ON_ERROR_STOP=1 -h /work -U postgres \
          -d pitwall_learning_p1_rehearsal'
```

## 2. Dunne capture vóór COMMIT

De vier statement-triggers op `simhub_measurement_events` en
`simhub_lap_summaries` bouwen nog uitsluitend de bestaande allowlist. Zij
roepen één private helper aan die per owner één **compacte, immutable
`capture_batches`-rij** en één `materialize_capture_batch`-job schrijft.

- Geen `source_revisions` in de ingest-transactie.
- Geen qualityclassificatie in de ingest-transactie.
- Geen per-revisie-job in de ingest-transactie.
- Wel de bestaande globale captureflag en de per-account policy/owner-join.
- Één batch per owner per source-statement; 20 wire-events + 3 laps geven
  daarom precies **2 batchrecords en 2 jobs**, niet 23 revisies + 23 jobs.

Budgetten zijn expliciet:

```text
max 200 items per batch
max 16.384 bytes per item
max 262.144 bytes voor het hele batchpayload
```

Een batch die buiten het budget valt, wordt niet in stukken geknipt: de hele
capturepoging faalt en de trigger vertaalt dat naar de vaste `WARNING` met
SQLSTATE `PWL01`. De ingest-ACK en replay blijven ongewijzigd. De
functie-lokale `lock_timeout = '50ms'` wordt bij succes en bij een fout
automatisch hersteld.

De batch bewaart:

- `source_kind`, `owner_user_id` (getypeerd, owner at receipt),
  `owner_basis`, `account_policy_version`;
- `item_count`, de compacte `payload`-array, `received_at`;
- `receipt_commit_visible = false`, `as_of_quality = 'as_of_unverifiable'`,
  `extractor_version`;
- een eenmalige, voorwaartse `materialized_at`/`materialized_items`-markering.

De item-JSON bevat **geen** owner-ID, policyversie, note, drivernaam, frame,
token of raw JSON. De owner staat alleen in de getypeerde batchkolom.

`capture_batches` is immutable: iedere UPDATE/DELETE wordt geweigerd, met twee
smalle uitzonderingen:

1. een auth-user-deletion mag alleen `owner_user_id`/`owner_basis` leegmaken;
2. de materiaalmarkering mag één keer van NULL naar een bewezen waarde.

Payload, tijden, hash en alle overige bewijsvelden blijven dan byte-identiek.

## 3. Uitgestelde materialisatie

`materialize_capture_batch(job_id, lease_token)` is de enige weg waarlangs
bronrevisies ontstaan. De RPC:

1. controleert `session_user`, de workerflag en de joblease met
   `FOR UPDATE NOWAIT`;
2. gebruikt uitsluitend de **bevroren receipt-owner** uit de batch, nooit een
   latere `simhub_devices.owner_user_id`;
3. controleert opnieuw of de owner bestaat, de policy bestaat,
   `capture_enabled` waar is en `policy_version` gelijk is aan de batchversie;
4. valideert alle items vóór er iets geschreven wordt;
5. schrijft de vijfdelige `(source_kind, device_id, source_uid,
   record_revision, content_hash)`-revisies idempotent (`ON CONFLICT DO
   NOTHING`) en maakt per identiteit precies één `source_validate`-job;
6. bewijst dat ieder item als revisie bestaat en iedere revisie een
   `source_validate`-job heeft;
7. zet in dezelfde transactie de batchmaterialmarkering en de job op `done`.

Een mislukking of crash laat geen halve projectie achter: de transactie rolt
terug, de lease en batch blijven intact, en dezelfde token kan na het vrijgeven
van een lock opnieuw materialiseren. Replay met dezelfde identiteiten levert
geen duplicate revisies of jobs.

Een worker kan een materialisatiejob **niet** zelf op `done` zetten:

- `finish_job(..., 'done')` geeft `materialization_required`;
- een directe `UPDATE jobs SET status = 'done'` wordt door de
  `jobs_materialization_proof`-trigger geweigerd zolang de batch geen
  volledig materiaalbewijs heeft.

`source_revisions` blijft de bestaande vijfdelige identiteit houden en is
append-only. Iedere P1-rij blijft:

```text
context_status = 'blocked_missing_identity'
canonical_context = NULL
training_eligible = false
as_of_quality = 'as_of_unverifiable'
receipt_commit_visible = false
```

met dezelfde expliciete qualityredenen (`car_unknown`, `track_unknown`,
`compound_unknown`, `historical_owner_unverified`, `owner_at_receipt_only`,
`driver_identity_unverified`, `context_incomplete`,
`non_training_eligible`, `as_of_unverifiable`, `server_receipt_precommit`).
Ontbrekende historische identity/knownAt wordt dus niet als false/0/100%
ingevuld.

## 4. Jobs, locks en isolatie

`jobs` heeft:

- één job per `(source_revision_id, kind)` voor source-jobs;
- één job per `(capture_batch_id, kind)` voor materiaaljobs;
- `source_revision_id` en `capture_batch_id` zijn exact exclusief;
- lease/token/expiry, maximaal drie pogingen, backoff en dead-letter.

De oude brede FK `jobs.source_revision_id → source_revisions` is bewust
vervangen door een smalle trigger. Een batchjob heeft die kolom NULL, maar een
gewone FK zou bij iedere jobinsert alsnog een lock op `source_revisions` nemen.
Daardoor kon een materialisatielock de ingest-outbox blokkeren. De nieuwe
trigger controleert alleen échte source-jobs; een batchjob raakt
`source_revisions` nooit aan. De harness bewijst dit met een echte
`ACCESS EXCLUSIVE`-lock op `source_revisions`: de ingest blijft geaccepteerd en
de batch wordt geschreven.

`claim_jobs` doet een begrensde dead-letter-sweep (`LIMIT 50`,
`FOR UPDATE SKIP LOCKED`) en claimt daarna met `FOR UPDATE OF j SKIP LOCKED`.
De claim joint voor source-jobs de revisie en voor batchjobs de batch, en
eist steeds een bestaande owner, actieve policy en gelijke policyversie.
`finish_job` gebruikt `FOR UPDATE NOWAIT`, weigert NULL en iedere andere
uitkomst dan `done`/`retry`, en controleert workerflag/owner/policy opnieuw.
`worker_get_revision` blijft fail-closed voor flag, owner, policy en
policyversie.

## 5. Rechten en RLS

- RLS aan op alle tien private tabellen, nul policies.
- `REVOKE ALL` op schema, tabellen, sequences en functies van
  `PUBLIC`, `anon`, `authenticated`, `service_role` en de workerrol.
- Daarna alleen schema-USAGE en EXECUTE op vier functies voor
  `pitwall_learning_worker`: `claim_jobs`, `finish_job`,
  `worker_get_revision`, `materialize_capture_batch`.
- Geen directe tabelgrants, geen `enqueue_job`, geen capture-helper, geen
  kill-switch- of accountpolicy-write.
- De tien overige private functies (capture, triggers, immutability,
  jobvalidatie) zijn niet uitvoerbaar voor de worker of app-rollen.
- `ALTER DEFAULT PRIVILEGES ... REVOKE` in dit schema is **geen** sluitende
  garantie voor toekomstige objecten. PostgreSQL's ingebouwde globale default
  (met name `PUBLIC EXECUTE` op functies) wordt er niet door ingetrokken. De
  bestaande objecten zijn dicht door de expliciete `REVOKE ALL`; elke latere
  toevoeging moet vóór COMMIT expliciet per object worden gerevoked. De probe
  in `pitwall-learning-schema.sql` bewijst dat onderscheid.

Rol `pitwall_learning_worker`:

```text
LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION
NOBYPASSRLS NOINHERIT CONNECTION LIMIT 2
```

Geen wachtwoord in SQL. De echte LOGIN-sessie over de private trust-Unixsocket
(`/work`) is positief bewezen: batchjob claimen, een fake `done` weigeren,
materialiseren, de resulterende revisie exporteren en de source-job afronden.
Capture en directe tabel-SELECT blijven geweigerd.

## 6. Uitgevoerde rehearsal

Commando:

```bash
python3 scripts/pitwall-learning/rehearse-p1.py --samples 40
```

Logs: `/home/hermes/artifacts/3sm/pitwall-learning-p1-20261111/thin-outbox-review/`
(`green-*.log`, `concurrency.log`, `deadletter-lock.log`, `worker-login.log`,
`finish-busy.log`, `lock-ack.log`, `materialize-failure.log`, `perf-wire.log`,
`perf-warmup.log`, `perf-cpu-attribution.log`, `perf-db-only-stress.log`,
`rollback.log`, `forward-clean-probe.log`, `forward-conflict.log`,
`retained-upgrade.log`, `summary.json`, `baseline-*.json`). De oudere
`bounded-review`-logs zijn niet overschreven.

De kloon was al forward met de bounded-v2-schema-versie. De harness heeft die
niet blind opnieuw geforward: de oude schema's/rol zijn naar
`pitwall_learning_v2_archive` / `pitwall_learning_worker_v2_archive`
herschreven, het echte forward-bestand is op een afwezige namespace toegepast
en alle 40 bewijsrijen, 40 jobs en de policy zijn met expliciete kolommen
gekopieerd. Een legacy-row-checksum (`md5(jsonb_build_object(...))` over de
oorspronkelijke kolomset) bewees dat de kopie byte-identiek is; bij verschil
gaat de hele transactie terug. De oude schema's blijven als archief staan (er
is niets gedropt). De tweede harness-run zag de nieuwe versie en sloeg de
migratie over (`already thin-outbox v5`).

Resultaten:

| Bewijs | Uitkomst |
|---|---|
| Schema/rol/constraints/RLS/grants/default-probe | **124/124 PASS** |
| Dunne outbox/budget/materialisatie/idempotentie/privacy | **77/77 PASS** |
| Capture/dedupe/revisie/late/context/immutability/owner-delete/200-set | **58/58 PASS** |
| Jobs/lease/backoff/dead-letter/NULL/policy/owner | **45/45 PASS** |
| Echte rolprobes anon/auth/service/worker/TRUNCATE | **36/36 PASS** |
| Twee connecties: A claimt, B krijgt `[]` | PASS |
| Gelockte dead-letter-rij: B claimt de gezonde job; rij blijft `pending` | PASS |
| Echte worker-LOGIN: batchjob claimen, fake done weigeren, materialiseren, exporteren, finishen | PASS |
| `finish_job` op een door een andere sessie gelockte rij: `job_busy`, lease/token intact | PASS |
| Lock op `capture_batches`: ACK accepted, vaste `PWL01`, `lock_timeout` terug op 0, 0 batches, replay duplicate | PASS |
| Lock op `source_revisions`: ingest accepted en batch geschreven; materialisatie faalt zonder halve projectie en dezelfde lease retryt daarna succesvol | PASS |
| Rollback-dry-run: 40 revisies + batches + jobs + materiaalbewijs behouden, public exact (99/8/165), worker/LOGIN uit, 4 triggers weg | PASS |
| Forward from absent namespace: 10 tabellen, 4 triggers, rolflags, 0 rijen, definities byte-identiek aan live | PASS |
| Forward op bestaand schema: geweigerd | PASS |

TDD-RED staat in `red-05-thin-outbox.log` (de nieuwe test faalt op de
afwezige `capture_batches`) en `red-06-synchronous-detail.log` (de oude
implementatie voegde 20 detailrevisies en 20 source-jobs toe in de
ingest-transactie; `capture_batches` en de materialisatie-RPC bestonden niet).

## 7. Performance — INCONCLUSIVE door A/A-ruis

Productiegrens blijft **p95 ≤ 10% én ≤ 20 ms** (strengste van de twee); er is
niets versoepeld. De primaire gate is het verschil tussen de fase-p95's
(`on` minus `absent`) en het percentage van de baseline-p95. De per-ronde
paired delta wordt alleen als diagnostiek gerapporteerd.

Meetopzet op de vastgepinde **1 CPU**-kloon (PG15.19, 512 MiB, network none):

- **primair frame (wire-representatief)**: 20 events met wear + evidence en
  3 volledige rondeaggregaten. Gemeten part: events 12.691 B + laps 3.231 B =
  **15.922 B** (limiet 16.384) en body **16.022 B** (limiet 24.576); alle 20
  events + 3 laps geaccepteerd. Geen `perf_probe`-kind.
- vijf fasen per paired ronde: triggers afwezig, afwezig A/A-herhaling,
  installed capture uit, installed capture uit A/A-herhaling, installed
  capture aan;
- 40 paired rondes na één weggegooide warm-up, fasevolgorde wisselt per ronde;
- nearest-rank p95 (`ceil(p*n)-1`), geen interpolatie of extrapolatie;
- 200-event meting staat **apart** als DB-only stress en is geen wire-frame.

| Fase | p50 | p95 |
|---|---:|---:|
| triggers afwezig | 164,6 ms | 265,4 ms |
| afwezig A/A | 107,9 ms | 184,4 ms |
| installed, capture uit | 124,4 ms | 211,5 ms |
| installed uit A/A | 137,9 ms | 237,1 ms |
| installed, capture aan | 162,6 ms | 288,6 ms |

Primaire fase-p95:

```text
on - absent   = +23,163 ms  (+8,7% van 265,440 ms)
on - off      = +77,079 ms  (+36,4% van 211,524 ms)
```

Diagnostische paired p95:

```text
on - absent   = +199,225 ms  (+75,1%)
on - off      = +170,124 ms  (+80,4%)
```

De A/A-controle is **niet binnen budget**:

```text
afwezig A/A - afwezig = -81,084 ms  (-30,5%)
uit A/A - uit         = +25,534 ms  (+12,1%)
```

Daarom is de uitkomst **INCONCLUSIVE**, niet PASS en niet FAIL. De primaire
fase-p95 tegen `absent` zit met +23,2 ms boven de absolute 20 ms-grens (het
percentage blijft met 8,7% onder de 10%-grens); de secundaire vergelijking
tegen `installed-off` valt ruim buiten de grens. Omdat dezelfde baselinefasen
in een echte A/A-herhaling meer dan het budget afwijken, is er geen geldige
PASS/FAIL-uitspraak over de primaire meting. Dat is precies de tijdruis die de
negatieve controle moest blootleggen.

De oude 0,5 CPU-meting blijft ongewijzigd staan als **FAIL**:
712,714 → 988,294 ms = **+275,580 ms / +38,666%**, met paired p95 +633,432 ms.
Die oude FAIL is niet weggepoetst en de drempel is niet verruimd.

CPU-attributie (secundair, geen ingest-latencyclaim): p50 **-7,5 ms**,
p95 **+33,75 ms** per frame (20 rondes × 4 frames, ABBA). DB-only stress
(200 events, 10 rondes, expliciet geen wire-frame): p95 833,9 → 918,9 ms.

Het batchbewijs voor de wire-vorm: **2 batchrecords**, **23 items**,
**2.811 bytes** batchpayload, **0 nieuwe revisies** en **+2 jobs** in de
ingest-transactie. Dat is de bedoelde dunne brug; de rest gebeurt in de
begrensde materialisatiestap.

## 8. Rollback

`supabase/rollbacks/20261111163052_pitwall_learning_evidence.sql`:

- verwijdert de vier capturetriggers (en, op een reeds opgebouwde testkloon,
  de twee historische row-triggers);
- zet alle vier kill switches op `false`;
- trekt schema/tabel/functie/sequence-rechten van de worker in;
- zet de workerrol op `NOLOGIN` en `CONNECTION LIMIT 0`;
- **verwijdert geen schema, tabel, rij, batch of bronobject** en gebruikt geen
  `DROP ... CASCADE`.

De rollback is in de harness in één transactie uitgevoerd en daarna
teruggedraaid. Binnen die transactie: 0 triggers, 40 revisies + 40 jobs +
batches + materiaalbewijs behouden, worker-USAGE/LOGIN uit, switches uit,
public-baseline exact gelijk (99 relations inclusief 8 sequences, 165 policies,
dezelfde policy-fingerprint en ingest-hash). Na de rollback-transactie was de
kloon weer volledig forward.

Omdat de forward-migratie een bestaand schema/rol weigert te adopteren, is
opnieuw forwarden na een echte rollback een aparte beheersactie (archiveren of
verwijderen van het private schema na goedkeuring). De rollback doet dat nooit
stilzwijgend.

## 9. Overige open grenzen

- Geen productie-DDL, geen push/main, geen deploy, geen Edge/connector/UI.
- `pitwall_learning_worker` heeft geen wachtwoord. De harness bewijst een
  echte LOGIN-sessie over de private trust-Unixsocket (`/work`); voor
  productie blijft auth-/wachtwoordprovisioning buiten SQL een aparte
  beheersactie.
- Geen retentieworker, geen modeltraining/scoring/promotie, geen adviespad.
- Capture-fout/backfill is niet in P1 opgelost; een mislukte capture wordt niet
  later opnieuw aangeboden. Herstel/backfill hoort bij T25 of een aparte,
  begrensde reconciliatie.
- `server_receipt_at` is de batchontvangsttijd vóór COMMIT en geen
  first-visible/knownAt-bewijs.
- De performancepoort is **INCONCLUSIVE** door A/A-ruis op de gedeelde
  1 CPU-host; de oude 0,5 CPU-FAIL blijft staan. Dit is een open
  productieblocker, geen PASS.
- `ALTER DEFAULT PRIVILEGES` is geen garantie voor toekomstige objecten;
  per-object-revoke vóór COMMIT blijft verplicht.
