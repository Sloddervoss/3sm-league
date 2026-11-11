# Pitwall learning P1 — gecontroleerde 200-ronde prestatieproef

Status: **vooraf vastgelegd protocol; meting volgt na setup van de private kloon.**
Deze proef vervangt de open 40-ronde meting niet met een nieuw oordeel op dezelfde
data. Het is één nieuwe, vooraf gepinde meting op een nieuwe private kloon. De
oude uitkomst blijft historisch `INCONCLUSIVE`; er wordt niets herschreven.

## Scope en non-goals

- Alleen lokaal, in een nieuwe private clone op `3sm-docker`.
- Geen productiecontainer, productie-DB, productieflag, Kong/Edge/connector-,
  model-, UI- of P2-wijziging.
- Geen push, main-merge, deploy, training, scoring of advies.
- Geen wijziging aan de core-migratie, broncontracten of de bestaande
  ingest-RPC. De clone wordt uit de reeds bevroren bestanden opgebouwd.
- De oude 40-ronde- en 0,5-CPU-resultaten worden niet tot PASS herschreven.

## Vooraf vastgelegd protocol

Bestand:

```text
docs/operations/pitwall-learning-p1-controlled-perf-protocol.json
docs/operations/pitwall-learning-p1-controlled-perf-protocol.sha256
```

Het protocol is vóór de eerste DB-meting gecommit. De driver weigert een
protocol zonder kloppende sha256-sidecar, een andere dan 200 rondes, minder dan
drie warmups, een ruimere drempel, een andere image of een niet-lege proofroot.
De sidecar is de bytehash van het JSON-bestand; de driver schrijft dezelfde hash
vóór de meting naar de proofroot.

Kern van het ontwerp:

| Onderdeel | Vastgelegd |
|---|---|
| Rondes | **200** |
| Cycles | **20** × 10 vaste phase-orders |
| Fasen | `absent`, `absent_aa`, `off`, `off_aa`, `on` |
| Posities | iedere fase **40×** op positie 1, 2, 3, 4 en 5 |
| Metingen | **1000** getimede samples |
| RPC's | **4000** inclusief 3 volledige warmups per fase per ronde |
| Warmups | 3× 20 events + 3 laps, distinct UUID/eventId/summaryId en lap-refs |
| Backend | iedere fase een eigen psql-backend, `BEGIN … ROLLBACK` |
| DDL/flag | vóór de warmups; geen DDL vlak vóór een koude meting |
| Quantiel | nearest-rank p95, `sorted[ceil(0.95*n)-1]` |
| Primaire gate | `p95(on) - p95(absent) <= 20 ms` **EN** `<= 10%` van `p95(absent)` |
| A/A | absolute delta voor beide paren `<= 20 ms` **EN** `<= 10%`; anders INCONCLUSIVE |
| Contract | ieder record 20+3 ACK, exacte identiteiten; `on` 2 batches/23 items, 0 revisies, +2 jobs; `off`/`absent` 0 capture; part 16384 B, body 24576 B, raw batch 262144 B |

De tien orders zijn de ongewijzigde `calibrated_phase_orders()` (vijf Latijnse
rotaties plus vijf rotaties van de omgekeerde volgorde). Per 10-ronde-cyclus
start een andere order, zodat de vaste onderhoudsgrens niet altijd door dezelfde
fase op positie 1 wordt gevolgd. Iedere cyclus bevat nog steeds alle tien orders
exact één keer; de positiebalans blijft 40 per fase per positie.

## Private clone

- Naam: `pitwall-learning-p1-controlled-20261111`
- Label: `3sm.test=pitwall-learning-p1-controlled`
- Image: `supabase/postgres:15.19.0.004`,
  id `sha256:1aabcd9cfb8a58ecde50a6092b207bcbb5f6bdc45546fde35cfda5d3ab39c065`
  (de reeds gecachte image; geen nieuwe versie).
- `--network none`, geen gepubliceerde poorten, read-only rootfs.
- `--user 100:101`, tmpfs `/work` 384 MiB, uid 100/gid 101.
- 512 MiB memory, 1 CPU, pids 64, `shared_buffers=32MB`, `work_mem=4MB`,
  `max_connections=20`, `max_worker_processes=2`, `shared_preload_libraries=''`.
- Database `pitwall_learning_p1_rehearsal`, data_directory `/work/data`,
  Unix-socket `/work`, alleen trust over die private socket.
- Geen wachtwoorden, geen netwerkroute, geen image-entrypoint/productieservice:
  een eigen `initdb`-cluster met `postgres` als CMD.

De clone wordt opgebouwd uit de bevroren inputs:

1. `production-schema-only.sql` (schema-only, geen productierijen);
2. de rolvlaggen uit `production-role-flags.json` (zonder wachtwoorden);
3. de exacte migratie `20261111163052_pitwall_learning_evidence.sql`;
4. de bestaande fixture `supabase/tests/fixtures/pitwall-learning-p1-fixtures.sql`.

De oude dump is niet nodig en wordt niet gebruikt: die was `--no-owner
--no-privileges`, dus een restore zou de private ACL niet bewijzen. De nieuwe
clone wordt juist uit schema-only plus de exacte migratie opgebouwd. De
`simhub_persist_measurement_batch`-definitie en de migratie-/fixturehashes worden
in `env.json` en `run-start.json` vastgelegd.

## Harde grendels

De driver accepteert alleen een expliciet opgegeven 64-tekens container-id en
een expliciet protocolpad. Er is geen standaardcontainer of productie-doel.

Vóór de meting en na de meting controleert hij:

- exact container-id, naam, label, image-id, `NetworkMode=none`, geen poorten,
  read-only rootfs, user `100:101`, memory/CPU/pids en tmpfs 384 MiB/100:101;
- via `docker exec`: uid 100, gid 101;
- via SQL: `current_database()`, `data_directory`, `unix_socket_directories`,
  `current_user=postgres`, geen TCP-listener;
- 0 capturebatches, 0 source-revisies, 0 jobs, 0 bronrijen, 4 capturetriggers,
  0 legacy-triggers, workerrol aanwezig.

Iedere transactie begint met dezelfde SQL-guard. De enige psql-route is:

```text
ssh -o BatchMode=yes 3sm-docker
  docker exec -i <exact-id> psql -X -qAt -v ON_ERROR_STOP=1
    -h /work -U postgres -d pitwall_learning_p1_rehearsal
```

## Onderhoud en ruimte

Op vaste 10-ronde-grenzen (na ronde 10, 20, …, 200), buiten ieder getimede
RPC-venster:

```sql
VACUUM (ANALYZE) public.simhub_measurement_events;
VACUUM (ANALYZE) public.simhub_lap_summaries;
VACUUM (ANALYZE) pitwall_learning.capture_batches;
VACUUM (ANALYZE) pitwall_learning.source_revisions;
VACUUM (ANALYZE) pitwall_learning.jobs;
CHECKPOINT;
```

Geen TRUNCATE, geen delete van gecommitte bewijsrijen, geen wijziging aan
autovacuum/fsync/synchronous_commit. De brontransacties rollen altijd terug,
dus alleen fysieke metadata/dead tuples veranderen. Logische rowcounts en
fingerprints worden vóór en na vergeleken.

## Bewijs

De proofroot is nieuw en `0700`:

```text
/home/hermes/artifacts/3sm/pitwall-learning-p1-controlled-20261111/
```

Bestanden:

- `protocol.json`, `protocol.sha256`, `run-start.json`;
- `env.json` (container/image-inspect, runtime-GUC's, functiehashes, startstate);
- `preflight.json` en `postflight.json` (identiteit, rowcounts, fingerprints);
- `samples.jsonl` — **elk** sample met alle ruwe `P1PERF`-velden, run, cycle,
  positie, order, client-round-trip en contractresultaat;
- `rounds.jsonl` — order, fase-tijden, cgroup-delta's per ronde;
- `resources.jsonl` — cgroup CPU-throttling, memory, pids, I/O, OOM-events,
  `/proc`-diagnostiek en Postgres-statistieken, buiten de klok;
- `maintenance.jsonl` — commando's, duur, voor/na-statistieken;
- `raw-notices.log`, `result.json`, `result-summary.md`, `FINAL-SHA256SUMS`.

De 95%-bootstrapintervallen (10.000 resamples, vaste seed) staan alleen als
diagnostiek in `result.json`. Ze vervangen de p95-gate niet en veranderen geen
drempel.

## Uitvoering

```sh
# alleen protocol/hash controleren, geen DB
/usr/bin/python3 scripts/pitwall-learning/controlled_perf.py check \
  --protocol docs/operations/pitwall-learning-p1-controlled-perf-protocol.json

# één meting; explicit id en protocol zijn verplicht
/usr/bin/python3 scripts/pitwall-learning/controlled_perf.py run \
  --protocol docs/operations/pitwall-learning-p1-controlled-perf-protocol.json \
  --container-id <64-tekens-id> \
  --proof-root /home/hermes/artifacts/3sm/pitwall-learning-p1-controlled-20261111
```

De driver meet alleen vanaf een schone worktree. Na de ene run wordt niet
opnieuw gestart. Bij een contractfout, SQL-fout, identiteitsfout,
ruimte-/geheugendruk of OOM stopt de run en blijven de partial evidence en
`abort.json` staan. Een INCONCLUSIVE- of FAIL-uitslag wordt ongewijzigd
teruggegeven.

## Offline tests

```sh
PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -m unittest discover \
  -s scripts/pitwall-learning -p 'test_controlled_perf.py' -v
PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -m unittest \
  scripts/pitwall-learning/tests/test_rehearse_p1.py -v
```

De nieuwe tests dekken: 200-ronde/1000-sample/4000-RPC-protocol, 40×5
positiebalans, 20 tien-ordercycles, roterende onderhoudsgrens, p95-in-plaats-van-
p50, absolute A/A-ruis, contractfouten in willekeurig welk laat sample,
bytebudgetten per record, weigering van niet-200-protocollen en
container/DB-grendels vóór iedere psql-aanroep. De 20 bestaande harness tests
blijven ongewijzigd.

## Productie-impact

- Website/frontend: geen impact.
- Backend/API, bot, Edge, Kong, connector: geen impact.
- Data/database: alleen de nieuwe, private, netwerkloze clone; productie
  ongemoeid.
- Auth/rollen: alleen private rollen in de clone.
- Deployment: geen impact.

**PRODUCTIEWIJZIGING: NEE**
