# Pitwall learning P1 — bewijslaag, bronrevisies en jobleases

**Status: lokale P1-bouw op de afgeschermde PG15.19-kloon. GEEN productie-DDL,
geen push/main, geen live ingest, geen modeladvies. PRODUCTIEWIJZIGING: NEE.**

Dit document legt vast wat T06–T08 in deze worktree bouwen, hoe de rehearsal
is uitgevoerd en welke grenzen nog open zijn. De kloon
`pitwall_learning_p1_rehearsal` bevat de exacte public/auth/extensions
schema-only baseline (99 public-relations, 165 public-policies, 0 bronrijen)
en is alleen via `ssh 3sm-docker` + container `pitwall-learning-p1-20261111`
bereikbaar.

## 1. Wat er is gebouwd

| Onderdeel | Bestand |
|---|---|
| Forward T06/T07/T08 | `supabase/migrations/20261111163052_pitwall_learning_evidence.sql` |
| Paired rollback | `supabase/rollbacks/20261111163052_pitwall_learning_evidence.sql` |
| Schema/rol/constrainttest | `supabase/tests/pitwall-learning-schema.sql` |
| Capturetest | `supabase/tests/pitwall-learning-capture.sql` |
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

## 2. Schema

Nieuw privé schema `pitwall_learning`, owner `supabase_admin`, RLS aan op alle
tabellen en **nul policies**. De nieuwe tabellen zijn alleen bereikbaar via de
owner of via drie `SECURITY DEFINER`-workerfuncties.

| Tabel | P1-inhoud | Doel |
|---|---|---|
| `runtime_settings` | één singleton, alles `false` | capture/worker/shadow/advice kill switches |
| `account_policy` | leeg (fixture maakt één rij) | persoonlijk accountbeleid; retentie 7/180/90 max |
| `source_revisions` | gevuld door capture | immutable bronrevisies |
| `jobs` | gevuld door capture | `source_validate`-jobs met lease/token/backoff/dead-letter |
| `models`, `examples`, `predictions`, `evaluations`, `deployments` | leeg | P2+-containers met gesloten rechten |

`source_revisions` heeft de vijfdelige identiteit

```text
(source_kind, device_id, source_uid, record_revision, content_hash)
```

en bewaart `observed_at`, `source_received_at`, `server_receipt_at`,
`owner_user_id` (owner at receipt), `account_policy_version`,
`canonical_context` (NULL in P1), `context_status`, `training_eligible`,
`extractor_version`, een allowlisted `payload` (≤ 16 KiB) en
`quality_reasons`.

De immutability-trigger weigert iedere UPDATE/DELETE, met één smalle
uitzondering: wanneer een auth-user wordt verwijderd en de FK
`owner_user_id` op NULL wordt gezet, mag alleen `owner_user_id`/`owner_basis`
veranderen. Payload, tijd, hash en alle andere bewijsvelden moeten dan
byte-identiek blijven. Zo blijft bewijs behouden bij accountverwijdering
zonder dat een gebruiker een willekeurige bewijsrij kan wijzigen.

## 3. Capture (T07)

Vier **statement-level** triggers, twee per brontabel:

```text
AFTER INSERT ON public.simhub_measurement_events
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
AFTER UPDATE ON public.simhub_measurement_events
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT
AFTER INSERT ON public.simhub_lap_summaries
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
AFTER UPDATE ON public.simhub_lap_summaries
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT
```

Geen trigger op frames, `simhub_telemetry_latest`, `simhub_devices` of andere
tabellen. Een UPDATE telt alleen wanneer `record_revision` of `content_hash`
werkelijk verschilt; een latere `received_at`-write maakt geen schijnrevisie.

Per statement bouwt de trigger dezelfde allowlist als voorheen:

- events: `kind`, observed/delivered session, segment, `observed_at`,
  `session_time_seconds`, `sdk_tick`, wear before/after, set generation,
  confidence, evidence zonder `note`;
- laps: session/segment, lapnummer, start/eind, aggregation version, complete,
  invalid reasons, pit/driver-changed booleans, temperaturen, fuel-integralen,
  load-integralen, coverage.

Niet in de payload: `current_driver_name`, `current_driver_id`, `note`,
tokens, volledige frames, `paceHistory`, `car_id`, `track_name`,
`track_config`, `compound`.

De trigger geeft de hele set in één jsonb-array aan
`capture_source_revisions(kind, rows)`. Die private helper doet:

1. de globale `runtime_settings.capture_enabled`-poort (één indexprobe; bij
   `false` bouwt de trigger niet eens payloads);
2. de owner-at-receipt-resolutie en de per-account policy in dezelfde
   set-based join; een ontbrekende policy, een uitgeschakelde policy of een
   onbekend device levert voor die rij niets op, zonder de rest te blokkeren;
3. de bestaande-revisiehistorie (stale/conflict-redenen) als één aggregaat;
4. de revisions en `source_validate`-jobs in twee set-based statements
   (`INSERT ... RETURNING` → jobs).

De helper is begrensd op 200 rijen (dezelfde bovengrens als de ingest) en
heeft `lock_timeout = '50ms'` als functie-lokale `SET`, zodat de waarde bij
succes én bij een fout automatisch wordt hersteld. Er is geen handmatige
`set_config`/restore meer.

Capture gebeurt alleen als **beide** waar zijn:

1. `runtime_settings.capture_enabled = true` (globaal);
2. een bestaande `account_policy`-rij voor de owner-at-receipt met
   `capture_enabled = true`.

De owner komt uit `simhub_devices.owner_user_id` op het moment van receipt.
Dat is **geen** bewijs van historisch eigenaarschap. Ontbreekt de policy, het
device of de owner, dan wordt niets vastgelegd; de ingest-ACK verandert niet.

### Context en tijd

Alle P1-rijen krijgen expliciet:

```text
car_unknown, track_unknown, compound_unknown,
historical_owner_unverified, owner_at_receipt_only,
driver_identity_unverified, context_incomplete,
non_training_eligible, as_of_unverifiable,
server_receipt_precommit
```

en `context_status = 'blocked_missing_identity'`,
`training_eligible = false`, `canonical_context = NULL`. Er worden geen
`false`-, `0`- of 100%-defaults verzonnen en er wordt niet naar een latere
`simhub_telemetry_latest`-snapshot gejoind.

`server_receipt_at` is de triggertijd vóór COMMIT. Dat is **geen** bewijs van
eerste zichtbaarheid; daarom staat `receipt_commit_visible = false` en
`as_of_quality = 'as_of_unverifiable'`. Een latere claim of export mag deze
tijd niet als `knownAt` presenteren.

`observed_at` blijft de clientwaarneming. `source_received_at` is de
`received_at` van de bronrij. De helper voegt `late_delivery` toe bij meer dan
5 minuten verschil en `clock_skew` wanneer de client meer dan 5 seconden
voorloopt. Een nieuwe revisie wordt naast de oude bewaard; eenzelfde
revisie+hash is idempotent; eenzelfde revisie met andere hash wordt als
`source_hash_revision_conflict` bewaard; een oudere revisie die later
binnenkomt krijgt `stale_revision_delivered_late`.

### Lock- en foutgedrag

De capturefuncties zetten `lock_timeout = '50ms'` als functie-lokale `SET`
(auto-herstel bij succes en bij een fout). De volledige capture, inclusief
poort, owner/policy-join en de set-based inserts, zit in een `EXCEPTION`-guard
in de trigger. Een fout levert alleen een vaste `WARNING` met SQLSTATE
`PWL01`, zonder payload, secrets of logtabelwrite. De ingest-ACK en replay
blijven ongewijzigd.

Belangrijke grens: als capture door een lock of fout wordt overgeslagen, is
die revisie in P1 **niet** later opnieuw te capturen door dezelfde replay
(de bronrij wordt bij een duplicaat niet opnieuw geschreven). Er is bewust
geen failed-logtabel en geen onbegrensde rescanscan. Herstel/backfill hoort
bij T25 of een aparte, begrensde reconciliatie.

## 4. Jobs en workerrol (T08)

`jobs` heeft één rij per `(source_revision_id, kind)`, `kind` is
`source_validate` of `example_build`. Capture maakt één `source_validate`-job
per nieuwe bronrevisie.

- `claim_jobs(limit, lease_seconds)`: doet eerst een **begrensde**
  dead-letter-sweep (`LIMIT 50`, `FOR UPDATE SKIP LOCKED`) en claimt daarna
  met `FOR UPDATE OF j SKIP LOCKED`, alleen `pending` of verlopen `leased`.
  Een gelockte uitputtelijke rij blokkeert een claim van een andere, gezonde
  job dus niet. De claim joint `source_revisions`, `auth.users` en
  `account_policy`: een ingetrokken policy, een gewijzigde policyversie of een
  verwijderde owner maakt de job niet claimbaar. `worker_enabled = false`
  geeft `[]`.
- `finish_job(job_id, lease_token, outcome, error_code)`:
  `done` of `retry`; `NULL` en iedere andere waarde worden expliciet
  geweigerd (geen stille retry). `retry` plant 5 s, 10 s, daarna dead-letter;
  na drie pogingen is de job `dead` en nooit meer claimbaar. Verkeerd/verlopen
  token wordt geweigerd. De rij wordt met `FOR UPDATE NOWAIT` geladen: houdt
  een andere afwerker dezelfde jobrij vast, dan volgt direct
  `{ok:false,error:'job_busy'}` zonder wachten; lease en token blijven geldig.
- `worker_get_revision(id)`: fail-closed. Geeft `NULL` wanneer
  `worker_enabled` uit staat, de owner niet meer bestaat, de capturepolicy is
  ingetrokken of `policy_version` niet meer gelijk is aan de versie op de
  revisie. Alleen bij een geldige, actuele policy komt de allowlisted revisie
  terug; nooit een tabel.

Rol `pitwall_learning_worker`:

```text
LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION
NOBYPASSRLS NOINHERIT CONNECTION LIMIT 2
```

Geen wachtwoord in SQL. De rol krijgt alleen `USAGE` op het schema en
`EXECUTE` op `claim_jobs`, `finish_job` en `worker_get_revision`. Geen
directe tabelgrants, geen `enqueue_job`, geen capture-helper, geen
kill-switch- of accountpolicy-write.

Alle acht private functies zijn `SECURITY DEFINER`, owner `supabase_admin`,
met `search_path = pg_catalog, pitwall_learning, pg_temp`; publieke objecten
worden fully qualified aangesproken.

## 5. Rechten en RLS

- `REVOKE ALL` op schema, tabellen, sequences en functies van
  `PUBLIC`, `anon`, `authenticated`, `service_role` en de workerrol.
- Daarna alleen de drie worker-EXECUTEs en schema-USAGE voor de worker.
- RLS aan op alle nieuwe tabellen, nul policies.
- Geen nieuwe grant of policy op een gedeelde public-tabel. De enige
  public-wijziging is het plaatsen van de vier capturetriggers.
- `ALTER DEFAULT PRIVILEGES ... REVOKE` in dit schema is **geen** sluitende
  garantie voor toekomstige objecten. PostgreSQL's ingebouwde globale default
  (met name `PUBLIC EXECUTE` op functies) wordt er niet door ingetrokken; een
  REVOKE op een default-ACL die nooit is gezet is een no-op. De bestaande
  objecten zijn dicht door de expliciete `REVOKE ALL` hierboven. Elke latere
  toevoeging aan dit schema moet vóór COMMIT expliciet
  `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role` krijgen.
  De probe in `pitwall-learning-schema.sql` maakt een nieuwe functie aan en
  bewijst dat die zonder per-object-revoke nog steeds door `anon` uitvoerbaar
  is.

## 6. Retentie en accountbeleid

`account_policy` bevat `retention_jobs_days` (1–7),
`retention_source_days` (1–180) en `retention_forecast_days` (1–90), plus
`pooling_enabled` met een harde P1-check op `false`. Zonder rij is een account
niet ingeschreven. Er is geen retentieworker, geen nieuwe pooling, geen
training, geen scoring en geen promotie in P1; die komen later via T25 en
aparte poorten. De P2+-tabellen zijn leeg.

## 7. Rollback

`supabase/rollbacks/20261111163052_pitwall_learning_evidence.sql`:

- verwijdert de vier capturetriggers (en, op een reeds opgebouwde testkloon,
  de twee historische row-triggers);
- zet alle vier kill switches op `false`;
- trekt schema/tabel/functie/sequence-rechten van de worker in;
- zet de workerrol op `NOLOGIN` en `CONNECTION LIMIT 0`;
- **verwijdert geen schema, tabel, rij of bronobject** en gebruikt geen
  `DROP ... CASCADE`.

De rollback is in de harness in één transactie uitgevoerd en daarna
teruggedraaid. Binnen die transactie: 0 triggers, alle bewijs- en jobrijen
behouden, worker-USAGE/LOGIN uit, switches uit, public-baseline exact gelijk
(99 relations, 165 policies, dezelfde policy-fingerprint en ingest-hash).
Na de rollback-transactie was de clone weer volledig forward.

Omdat de forward-migratie een bestaand schema/rol weigert te adopteren, is
opnieuw forwarden na een echte rollback een aparte beheeractie (archiveren of
verwijderen van het private schema na goedkeuring). De rollback doet dat nooit
stilzwijgend.

## 8. Uitgevoerde rehearsal

Commando:

```bash
python3 scripts/pitwall-learning/rehearse-p1.py --samples 30
```

Logs: `/home/hermes/artifacts/3sm/pitwall-learning-p1-20261111/bounded-review/`
(`green-*.log`, `concurrency.log`, `deadletter-lock.log`, `worker-login.log`,
`finish-busy.log`, `lock-ack.log`, `perf-wire.log`, `perf-warmup.log`,
`perf-cpu-attribution.log`, `perf-db-only-stress.log`, `rollback.log`,
`forward-clean-probe.log`, `forward-conflict.log`, `summary.json`,
`baseline-*.json`). De oudere P1-logs in de bovenliggende map zijn niet
overschreven.

De kloon was al forward met de eerste reviewronde. De harness heeft die
schema-versie **niet blind opnieuw** geforward: de oude schema's/rol zijn
herschreven naar `pitwall_learning_v1_archive` /
`pitwall_learning_worker_v1_archive`, het echte forward-bestand is op een
afwezige namespace toegepast en alle bewijs-, job- en policyrijen zijn met
expliciete kolommen gekopieerd. Een row-image-checksum (`md5(to_jsonb(r))`)
binnen dezelfde transactie bewijst dat de kopie byte-identiek is; bij verschil
gaat de hele transactie terug. De oude schema's blijven als archief staan (er
is niets gedropt).

Resultaten:

| Bewijs | Uitkomst |
|---|---|
| Schema/rol/constraints/RLS/grants/default-probe | 108/108 PASS |
| Capture/dedupe/revisie/late/context/immutability/owner-delete/200-set | 58/58 PASS |
| Jobs/lease/backoff/dead-letter/NULL/policy/owner | 45/45 PASS |
| Echte rolprobes anon/auth/service/worker/TRUNCATE | 33/33 PASS |
| Twee connecties: A claimt, B krijgt `[]` in 582 ms | PASS |
| Gelockte dead-letter-rij: B claimt de gezonde job in 505 ms; rij blijft `pending` tot A loslaat | PASS |
| Echte worker-LOGIN over trust-Unixsocket: `session_user=current_user=pitwall_learning_worker`; claim/export/finish ok; capture en tabel-SELECT geweigerd | PASS |
| `finish_job` op een door een andere sessie gelockte rij: `job_busy` in 441 ms, lease/token intact, daarna `done` | PASS |
| Crashreclaim na lease-expiry: dezelfde job, poging 2, nieuw token; oude token `lease_mismatch` | PASS |
| Lock op `source_revisions`: ACK accepted in 448 ms, `PWL01`, `lock_timeout` terug op 0, 0 capture, replay duplicate | PASS |
| Rollback-dry-run: bewijs behouden, public exact, worker/LOGIN uit, 4 triggers weg | PASS |
| Forward from absent namespace (rolled-back probe): 9 tabellen, 4 triggers, rolflags, 0 rijen, definities byte-identiek aan live | PASS |
| Forward op bestaand schema: geweigerd | PASS |

De RED-evidence tegen de oude implementatie staat in
`red-01-row-triggers.log` (twee row-triggers), `red-02-deadletter-lock.log`
(claim van een gezonde job liep in een statement-timeout terwijl een andere
sessie een uitgeputte job vasthield), `red-03-finish-null.log`
(`NULL`-outcome werd als retry geaccepteerd) en `red-04-worker-export.log`
(export bleef payload geven bij workerflag uit, ingetrokken policy,
policyversiewijziging en verwijderde owner). De schema-afwezigheids-RED staat
in `red-schema-absence.log`.

### Performance — poort niet gehaald

Productiegrens blijft **p95 ≤ 10% én ≤ 20 ms** (strengste van de twee); er is
niets versoepeld.

Meetopzet op de vastgepinde 0,5 CPU-kloon (PG15.19):

- **primair frame (wire-representatief)**: 20 events met wear + evidence en
  3 volledige rondeaggregaten. Gemeten payload: events 12.691 B + laps
  3.231 B = 15.922 B (limiet 16.384) en body 16.022 B (limiet 24.576);
  alle 20 events + 3 laps geaccepteerd. Geen `perf_probe`-kind.
- drie fasen per paired ronde: triggers afwezig (echte voormigratie),
  installed capture uit, installed capture aan;
- 30 paired rondes na één weggegooide warm-up, fasevolgorde wisselt per ronde;
- nearest-rank p95 (`ceil(p*n)-1`), geen interpolatie of extrapolatie;
- 200-event meting staat **apart** als DB-only stress en is geen wire-frame.

| Fase | p50 | p95 | min | max |
|---|---:|---:|---:|---:|
| triggers afwezig | 409,0 ms | 712,7 ms | 231,6 ms | 796,7 ms |
| installed, capture uit | 329,7 ms | 578,0 ms | 295,1 ms | 672,3 ms |
| installed, capture aan | 481,8 ms | 988,3 ms | 312,8 ms | 1035,9 ms |

Paired p95-toename: **+633,4 ms (+88,9%)** versus afwezig en **+666,0 ms
(+115,2%)** versus installed-off. Dat is **FAIL** voor de poort.

Omdat de host aantoonbaar overbelast is (load average 13,7 op 4 cores, kloon
hard op 0,5 CPU) is ter attributie ook backend-CPU-tijd gemeten
(`/proc/self/stat` utime+stime, ABBA per ronde, 20 rondes × 4 frames). Ook die
secundaire meting haalt de grens niet: p50 **+22,5 ms**, p95 **+53,8 ms**,
max **+83,8 ms** per frame. De wall-clock p95 is dus deels steal, maar de
CPU-attributie wijst op een reële toename boven 20 ms.

DB-only stress (200 events, 10 rondes, expliciet géén wire-frame en niet
gebruikt voor de poort): p50 2133,5 → 3316,4 ms, p95 3101,5 → 4824,8 ms.

**Conclusie: de performancepoort is niet gehaald op de vastgepinde kloon.**
De functionele en concurrency-bewijzen zijn groen, maar dit blijft een open
productieblocker. De meting is geen live-loadtest en de host is zwaar
begrensd; dat verklaart een deel van de wall-clock-ruis, maar de CPU-p95 ligt
ook boven de grens. Er is daarom geen PASS uitgesproken en geen grens
verruimd.

## 9. Overige open grenzen

- Geen productie-DDL, geen push/main, geen deploy, geen Edge/connector/UI.
- `pitwall_learning_worker` heeft geen wachtwoord. De harness bewijst een
  echte LOGIN-sessie over de private trust-Unixsocket (`/work`) met
  `session_user = current_user = pitwall_learning_worker`, een positieve
  claim/export/finish en de weigering van capture/tabellen. Voor productie
  blijft auth-/wachtwoordprovisioning buiten SQL een aparte beheeractie.
- Geen retentieworker, geen modeltraining/scoring/promotie, geen adviespad.
- Capture-fout/backfill is niet in P1 opgelost (zie §3).
- `server_receipt_at` is geen first-visible/knownAt-bewijs (zie §3).
- De rollback bewaart het private schema; opnieuw forwarden vereist een
  expliciete beheeractie.
- De performancepoort is niet gehaald (zie §8): open productieblocker.
- `ALTER DEFAULT PRIVILEGES` is geen garantie voor toekomstige objecten;
  per-object-revoke vóór COMMIT blijft verplicht (zie §5).
