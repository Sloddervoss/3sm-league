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
ssh -oBatchMode=yes 3sm-docker \
  'docker exec -i pitwall-learning-p1-20261111 \
     psql -X -qAt -v ON_ERROR_STOP=1 -h /work -U postgres \
          -d pitwall_learning_p1_rehearsal'
```

De echte worker-LOGIN-sessie kan `current_setting('data_directory')` niet
lezen. Voor die ene probe maakt de harness daarom na de echte postgres-GUARD
een tijdelijke, fixture-only `SECURITY DEFINER`
`pitwall_learning.assert_rehearsal_environment()` aan: owner `postgres`,
gepinde `search_path`, geen parameters, alleen `current_database()` en
`data_directory`. De functie wordt vóór `COMMIT` expliciet van `PUBLIC`,
`anon`, `authenticated`, `service_role` en de worker gerevoked en daarna
alleen aan de worker gegeven. De worker roept hem vóór iedere DML in zijn
`BEGIN`-transactie aan. In een `finally` wordt de helper gedropt en de harness
verifieert dat hij absoluut afwezig is vóór de forward/parity-probe. Dit is
testfixture-only; er is geen productiemigratie of auth-API voor gewijzigd.

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
max 16.384 bytes per item (pg_column_size van het opgeslagen JSONB)
max 262.144 bytes voor het hele batchpayload (pg_column_size)
```

Deze grenzen zijn opslagmaten, geen UTF-8/ruwe-JSON-matentelling. Voor het
wire-bewijs worden beide eenheden apart gerapporteerd (zie §7.4).

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
uitkomst dan `done`/`retry`, en controleert workerflag/owner/policy/versie
opnieuw voor **beide** uitkomsten. Een retry na owner-delete, policy-revoke of
policyversiewijziging wordt dus geweigerd; de lease/token/state-checks blijven
eerst lopen en de job blijft leased. `worker_get_revision` blijft fail-closed
voor flag, owner, policy en policyversie.

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

Logs: `/home/hermes/artifacts/3sm/pitwall-learning-p1-20261111/calibrated-perf-review/`
(`green-*.log`, `concurrency.log`, `deadletter-lock.log`, `worker-login.log`,
`finish-busy.log`, `lock-ack.log`, `materialize-failure.log`, `perf-wire.log`,
`perf-cpu-attribution.log`, `perf-db-only-stress.log`, `rollback.log`,
`forward-clean-probe.log`, `forward-conflict.log`, `summary.json`,
`baseline-*.json`). De oudere `bounded-review`-, `spec-thin-outbox-review`- en
`thin-outbox-review`-mappen zijn niet de uitvoermap van deze ronde.

De kloon was al forward met de bounded-v2-schema-versie. De harness heeft die
niet blind opnieuw geforward: de oude schema's/rol zijn naar
`pitwall_learning_v2_archive` / `pitwall_learning_worker_v2_archive`
herschreven, het echte forward-bestand is op een afwezige namespace toegepast
en alle bewijsrijen, jobs en de policy zijn met expliciete kolommen
gekopieerd. Een legacy-row-checksum (`md5(jsonb_build_object(...))` over de
oorspronkelijke kolomset) bewees dat de kopie byte-identiek is; bij verschil
gaat de hele transactie terug. De oude schema's blijven als archief staan (er
is niets gedropt). Een tweede harness-run zag de nieuwe versie en sloeg de
migratie over (`already thin-outbox v5`).

Resultaten:

| Bewijs | Uitkomst |
|---|---|
| Schema/rol/constraints/RLS/grants/default-probe | **124/124 PASS** |
| Dunne outbox/budget/materialisatie/idempotentie/privacy | **77/77 PASS** |
| Capture/dedupe/revisie/late/context/immutability/owner-delete/200-set | **58/58 PASS** |
| Jobs/lease/backoff/dead-letter/NULL/policy/owner/retry-gate | **55/55 PASS** |
| Echte rolprobes anon/auth/service/worker/TRUNCATE | **36/36 PASS** |
| **Totaal SQL-asserties** | **350/350 PASS** |
| Twee connecties: A claimt, B krijgt `[]` | PASS |
| Gelockte dead-letter-rij: B claimt de gezonde job; rij blijft `pending` | PASS |
| Echte worker-LOGIN: batchjob claimen, fake done weigeren, materialiseren, exporteren, finishen | PASS |
| `finish_job` op een door een andere sessie gelockte rij: `job_busy`, lease/token intact | PASS |
| Lock op `capture_batches`: ACK accepted, vaste `PWL01`, `lock_timeout` terug op 0, 0 batches, replay duplicate | PASS |
| Lock op `source_revisions`: ingest accepted en batch geschreven; materialisatie faalt zonder halve projectie en dezelfde lease retryt daarna succesvol | PASS |
| Rollback-dry-run: 104 revisies + 160 jobs + 56 batches (46 gematerialiseerd) behouden, public exact (99/8/165), worker/LOGIN uit, 4 triggers weg | PASS |
| Forward from absent namespace: 10 tabellen, 4 triggers, rolflags, 0 rijen, definities byte-identiek aan live | PASS |
| Forward op bestaand schema: geweigerd | PASS |

De harness-uitgang is **1** en de enige failure is
`perf_gate_INCONCLUSIVE`; alle vijf SQL-suites en alle functionele probes zijn
groen. Dat is geen verborgen functionele fout.

TDD-RED staat in `red-05-thin-outbox.log` (de nieuwe test faalt op de
afwezige `capture_batches`) en `red-06-synchronous-detail.log` (de oude
implementatie voegde 20 detailrevisies en 20 source-jobs toe in de
ingest-transactie; `capture_batches` en de materialisatie-RPC bestonden niet).
De F2-retryregressie is eerst Rood bewezen in
`calibrated-perf-review/red-finish-retry.log` (47/55, acht retry/done-
asserties falen op de oude done-only gate) en daarna groen in
`green-jobs-retry.log` (55/55).

## 7. Performance — gekalibreerde 40-ronde meting: INCONCLUSIVE, geen PASS

> **Nieuwe, apart vooraf vastgelegde meting:** de gecontroleerde 200-ronde run in
> `docs/operations/pitwall-learning-p1-controlled-perf.md` gaf p95 absent
> 145,319 ms → on 159,842 ms (+14,523 ms / +9,994%), A/A binnen budget en 0
> contractfouten: volgens de ongewijzigde gate **PASS**, met brede
> bootstrapdiagnostiek. De 40-ronde-uitkomst hieronder blijft historisch
> `INCONCLUSIVE` en is niet herschreven.

Productiegrens blijft **p95 ≤ 10% én ≤ 20 ms** (strengste van de twee); er is
niets versoepeld. De primaire gate is het verschil tussen de fase-p95's
(`on` minus `absent`) en het percentage van de baseline-p95. De per-ronde
paired delta wordt alleen als diagnostiek gerapporteerd. Een meting met een
onvolledige ingest (0 ACK, capture uit, lege batch, verkeerde source-kind) is
geen PASS, maar een ongeldige meting.

### 7.1 Historische koude meting (diagnostisch, niet geldig)

De eerdere 40-ronde meting in
`/home/hermes/artifacts/3sm/pitwall-learning-p1-20261111/thin-outbox-review/`
is bewaard als **historische koudstartdiagnostiek**, niet als bewijs:

| Fase | p50 | p95 |
|---|---:|---:|
| triggers afwezig | 164,6 ms | 265,4 ms |
| afwezig A/A | 107,9 ms | 184,4 ms |
| installed, capture uit | 124,4 ms | 211,5 ms |
| installed uit A/A | 137,9 ms | 237,1 ms |
| installed, capture aan | 162,6 ms | 288,6 ms |

Die run deed alle vijf fasen in **één** psql-backend per ronde, met één
weggegooide warm-up in een **andere** backend. De eerste fase in een backend
was daardoor koud voor PL/pgSQL-plannen/relcache; de absent-fasen deden
bovendien `DROP TRIGGER`-DDL vlak vóór de getimede call. De primaire
`+23,163 ms / +8,7%` en de A/A `-81,084 ms / -30,5%` en
`+25,534 ms / +12,1%` zijn daarom positie- en koudstartvertekend. Dat oude
resultaat is geen bewijs dat de ruis door de host komt en blijft **geen PASS**.

### 7.2 Vooraf vastgelegd protocol

Vóór de run is dit protocol vastgelegd; de harness weigert iedere andere
steekproefomvang dan 40:

- **40 paired rondes**, vijf fasen: triggers afwezig, afwezig A/A-herhaling,
  installed capture uit, uit A/A-herhaling, installed capture aan.
- **Balanced phase orders**: vijf Latijnse rotaties plus vijf rotaties van de
  omgekeerde volgorde. Elke fase staat in 40 rondes **8 keer op elk van de
  vijf posities**; de A/A-baselines hebben dus dezelfde positieverdeling als
  elkaar en als `on`.
- **Per fase een eigen backend**, met `BEGIN … ROLLBACK`. Vóór de getimede
  call staan alle relevante DDL (`DROP TRIGGER` in de absent-fasen) en de
  captureflag aan; daarna volgen **3 ongetimede volledige 20+3-warmups**.
- Iedere warmup is een echte volledige ingest met **distinct**
  `eventUid`/`eventId`/`summaryUid`/`summaryId`; de lap-`wearObservationIds`
  verwijzen naar de warmup-`eventId`'s. De gemeten frame is nieuwe 20+3-data.
  Warmupbatches blijven tot `ROLLBACK` staan, maar de gemeten delta's nemen
  alleen de nieuwe batch/jobs/revisies van de getimede call.
- De warmups doorlopen dezelfde RPC-, trigger/helper- en flagbranch als de
  meting, zodat ook de capture-helper, flagcompilatie en eventuele
  drain/planopbouw warm zijn vóór de getimede call.
- **nearest-rank p95** (`ceil(p*n)-1`), geen interpolatie of extrapolatie.
- Primaire gate: `p95(on) - p95(absent) <= 20 ms` **EN** `<= 10%` van
  `p95(absent)`.
- A/A: **absolute** delta per identieke baseline `<= 20 ms` **EN** `<= 10%`;
  een negatieve delta is eveneens ruis en mag geen positieve primaire delta
  compenseren.
- De paired-delta-p95 blijft aparte diagnostiek; er is geen metricwissel en
  geen extra budget bovenop de 20 ms.
- Alle 200 gemeten samples moeten 20 events + 3 laps accepteren met exact de
  gemeten ACK-identiteiten. `on` moet 2 batches/23 items (20 event + 3 lap),
  0 nieuwe revisies en +2 jobs tonen; `off`/`absent` moeten 0 private capture
  tonen. Een contractschending maakt de uitslag FAIL, nooit PASS.

### 7.3 Uitkomst van de gekalibreerde run

Uit `calibrated-perf-review/perf-wire.log` (40 samples per fase):

| Fase | p50 | p95 | >120 ms | >150 ms |
|---|---:|---:|---:|---:|
| triggers afwezig | 80,087 ms | 168,808 ms | 6 | 5 |
| afwezig A/A | 81,167 ms | 176,772 ms | 7 | 4 |
| installed, capture uit | 79,591 ms | 145,226 ms | 6 | 2 |
| installed uit A/A | 84,189 ms | 170,242 ms | 8 | 5 |
| installed, capture aan | 86,694 ms | 189,939 ms | 10 | 6 |

```text
primair:  on - absent = +21,131 ms  (+12,518% van 168,808 ms)   FAIL-timing
secundair: on - off    = +44,713 ms  (+30,789% van 145,226 ms)
A/A absent: +7,964 ms  (+4,718%)   binnen budget
A/A off:   +25,016 ms  (+17,226%)  buiten budget
```

De A/A-controle voor `off` valt met **+25,016 ms / +17,226%** buiten de
absolute en procentuele grens. Daarom is de uitkomst **INCONCLUSIVE**, niet
PASS en niet FAIL. De primaire meting zit met **+21,131 ms / +12,518%**
bovendien boven beide grenzen; als de A/A-controle geldig was geweest, zou dit
een FAIL zijn. Er is dus geen enkele lezing waarin dit een PASS is.

De p50's liggen met 79,6–86,7 ms dicht bij elkaar (p50 `on - absent`
+6,607 ms); de p95-verschillen worden gedomineerd door een klein aantal
>120 ms-uitschieters op de gedeelde 1 CPU-host. De calibrated opzet heeft de
systematische koude-backend/positievertekening van §7.1 aantoonbaar verwijderd
(geen vaste fase meer op positie 1/5, geen DDL meer vóór een koude meting),
maar de resterende host-tail is nog steeds groter dan het 10%-budget. Dat is
een **omgevings/methodologische blocker**, geen bewijs dat de capture-code
binnen budget zit.

CPU-attributie (secundair, geen latencybewijs): p50 **+2,5 ms**, p95
**+37,5 ms** per frame (20 rondes × 4 frames, ABBA). DB-only stress (200
events, 10 rondes, expliciet geen wire-frame): p95 877,352 → 702,980 ms; die
uitkomst is door dezelfde hostruis niet bruikbaar als overheadclaim.

### 7.4 Contract- en groottebewijs

Alle 200 gemeten samples (40 rondes × 5 fasen) hadden **0
contractschendingen**: 20 events + 3 laps geaccepteerd, exact de gemeten
ACK-identiteiten; `on` gaf 2 batches/23 items (20 event + 3 lap), 0 nieuwe
revisies en +2 jobs; `off`/`absent` gaven 0 private capture. De hard-coded
`kind_valid`-claim is verwijderd; de source-kinds worden uit de gemeten
`capture_batches`-delta geteld.

De wire-vorm blijft binnen de budgetten: events **12.691 B** + laps **3.231 B**
= **15.922 B** (limiet 16.384), body **16.022 B** (limiet 24.576). Het
batchpayload is **2.811 B opgeslagen/gecomprimeerd JSONB**
(`sum(pg_column_size(payload))`) en **20.881 B ruwe JSON-tekst/UTF-8**
(`sum(octet_length(payload::text))`); dat zijn twee verschillende eenheden en
de 262.144 B-grens wordt op de opgeslagen waarde afgedwongen.

### 7.5 Full-wire parse-referentie (geen HTTP/productieclaim)

Het originele bewijs van de parent staat buiten deze worktree:

```text
/home/hermes/artifacts/3sm/pitwall-learning-p1-20261111/parent-full-wire-probe.mjs
  sha256 6f9a97deb67294735661fa229f97fe34f95fb3927f9545d0ad5f9a3dd34a6dd6
/home/hermes/artifacts/3sm/pitwall-learning-p1-20261111/parent-full-wire-probe.txt
  sha256 e98e4b07b32bded3252f611ccf0c2d2ac6852913c6df1b2aedeb1bd5fce82241
```

De ongewijzigde `parseTelemetryV3Envelope` parseerde daar 20 events + 3 laps,
0 rejects, part **14.492 B** en body **15.430 B**. Dat is een parse-bewijs,
geen HTTP E2E- of productieframebevestiging. Een optionele CI-check kan de
twee sha256's en de laatste `{"verdict":"PASS",...}`-regel verifiëren; de
harness genereert dit bestand niet en er is geen synthetische fixture voor in
de plaats gezet.

### 7.6 Stopregel

Omdat de gekalibreerde run nog steeds **INCONCLUSIVE** is, zijn er na deze
enige vooraf vastgelegde run geen extra rondes of herhaalruns uitgevoerd om
een PASS te zoeken. De drempel is niet verruimd en de metric is niet gewisseld.
De open blocker is de p95-tailruis op de gedeelde 1 CPU-kloon; een rustiger
host of een vooraf goedgekeurde, onafhankelijke herhalingsmeting is nodig voor
een geldige PASS/FAIL-uitspraak.

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
teruggedraaid. Binnen die transactie: 0 triggers, 104 revisies + 160 jobs +
56 batches (waarvan 46 gematerialiseerd) + het volledige materiaalbewijs
behouden, worker-USAGE/LOGIN uit, switches uit, public-baseline exact gelijk
(99 relations inclusief 8 sequences, 165 policies, dezelfde
policy-fingerprint en ingest-hash). Na de rollback-transactie was de kloon
weer volledig forward.

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
- **F6 (privileged-only TRUNCATE)**: de smalle jobtrigger vervangt de oude FK
  voor insert/update, maar rijtriggers vuren niet op `TRUNCATE`. Een
  superuser/table-owner kan dus met direct SQL `source_revisions` leegmaken en
  jobs laten wees-worden. Alle applicatierollen (anon/authenticated/
  service_role/worker) hebben geen TRUNCATE; operationeel geldt: **geen
  private TRUNCATE** buiten een expliciet goedgekeurde, afgeschermde
  herstelactie. Dit is een residual privileged-only verschil, geen
  productieblokker en vraagt geen extra rollen/structuur.
- **F7 (per-item >16 KiB)**: een directe helper-call met één item boven
  16.384 B wordt door de `admitted`-filter stil overgeslagen; alleen een
  batch boven 262.144 B geeft de vaste `PWL01`. De echte source-constraints
  begrenzen normale events/laps ruim onder 16 KiB. Dit is een minor
  direct-SQL-observatie; er is geen architectuurwijziging en **geen
  modelcoverageclaim** voor geprivilegieerde oversized direct SQL.
- De performancepoort is **INCONCLUSIVE** door p95-tailruis op de gedeelde
  1 CPU-host; de primaire +21,131 ms/+12,518% en de A/A-off
  +25,016 ms/+17,226% zijn beide buiten budget. Dit is een open
  productieblocker, geen PASS. De oude 0,5 CPU-FAIL blijft staan.
- `ALTER DEFAULT PRIVILEGES` is geen garantie voor toekomstige objecten;
  per-object-revoke vóór COMMIT blijft verplicht.
