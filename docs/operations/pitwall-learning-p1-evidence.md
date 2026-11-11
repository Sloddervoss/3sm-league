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

Triggers:

```text
AFTER INSERT OR UPDATE OF record_revision, content_hash
  ON public.simhub_measurement_events
  ON public.simhub_lap_summaries
```

Geen trigger op frames, `simhub_telemetry_latest`, `simhub_devices` of andere
tabellen. De trigger bouwt een kleine allowlist:

- events: `kind`, observed/delivered session, segment, `observed_at`,
  `session_time_seconds`, `sdk_tick`, wear before/after, set generation,
  confidence, evidence zonder `note`;
- laps: session/segment, lapnummer, start/eind, aggregation version, complete,
  invalid reasons, pit/driver-changed booleans, temperaturen, fuel-integralen,
  load-integralen, coverage.

Niet in de payload: `current_driver_name`, `current_driver_id`, `note`,
tokens, volledige frames, `paceHistory`, `car_id`, `track_name`,
`track_config`, `compound`.

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

De trigger zet in zijn eigen (sub)transactie `lock_timeout = '50ms'` en
herstelt de oude waarde vóór terugkeer. De volledige capture, inclusief de
runtime/policy/device-SELECTs, zit in een `EXCEPTION`-guard. Een fout levert
alleen een vaste `WARNING` met SQLSTATE `PWL01` (of `PWL03` voor de buitenste
guard), zonder payload, secrets of logtabelwrite. De ingest-ACK en replay
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

- `claim_jobs(limit, lease_seconds)`: `FOR UPDATE SKIP LOCKED`, alleen
  `pending` of verlopen `leased`, verhoogt `attempts`, zet een nieuw
  `lease_token` en `lease_expires_at`. `worker_enabled = false` geeft `[]`.
- `finish_job(job_id, lease_token, outcome, error_code)`:
  `done` of `retry`. `retry` plant 5 s, 10 s, daarna dead-letter; na drie
  pogingen is de job `dead` en nooit meer claimbaar. Verkeerd/verlopen token
  wordt geweigerd.
- `worker_get_revision(id)`: geeft alleen de allowlisted revision terug, geen
  tabel.

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
- Default privileges voor `supabase_admin` in het nieuwe schema zijn expliciet
  geneutraliseerd; `pg_default_acl` bevat geen app-grants.
- Geen nieuwe grant of policy op een gedeelde public-tabel. De enige
  public-wijziging is het plaatsen van de twee capturetriggers.

## 6. Retentie en accountbeleid

`account_policy` bevat `retention_jobs_days` (1–7),
`retention_source_days` (1–180) en `retention_forecast_days` (1–90), plus
`pooling_enabled` met een harde P1-check op `false`. Zonder rij is een account
niet ingeschreven. Er is geen retentieworker, geen nieuwe pooling, geen
training, geen scoring en geen promotie in P1; die komen later via T25 en
aparte poorten. De P2+-tabellen zijn leeg.

## 7. Rollback

`supabase/rollbacks/20261111163052_pitwall_learning_evidence.sql`:

- verwijdert de twee capturetriggers;
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
python3 scripts/pitwall-learning/rehearse-p1.py
```

Logs: `/home/hermes/artifacts/3sm/pitwall-learning-p1-20261111/`
(`red.log`, `green-*.log`, `concurrency.log`, `lock-ack.log`, `perf.log`,
`rollback.log`, `forward-clean-probe.log`, `forward-conflict.log`,
`baseline-before.json`, `baseline-after.json`, `summary.json`).

Resultaten:

| Bewijs | Uitkomst |
|---|---|
| Schema/rol/constraints/RLS/grants | 102/102 PASS |
| Capture/dedupe/revisie/late/context/immutability/owner-delete | 54/54 PASS |
| Jobs/lease/backoff/dead-letter | 35/35 PASS |
| Echte rolprobes anon/auth/service/worker/TRUNCATE | 28/28 PASS |
| Twee connecties: A claimt, B krijgt `[]` in 431 ms | PASS |
| Crashreclaim na lease-expiry: dezelfde job, poging 2, nieuw token; oude token `lease_mismatch` | PASS |
| Lock op `source_revisions`: ACK accepted in 646 ms, `PWL01`, `lock_timeout` terug op 0, 0 capture, replay duplicate | PASS |
| Rollback-dry-run: bewijs behouden, public exact, worker/LOGIN uit | PASS |
| Forward from absent namespace (rolled-back probe): 9 tabellen, 2 triggers, rolflags, 0 rijen | PASS |
| Forward op bestaand schema: geweigerd | PASS |

De RED-log is opgenomen door de tests tegen een tijdelijk weggerenderde
schema in een teruggedraaide transactie te draaien; de tests falen zonder
schema en zijn daarna groen. De worktree was op het moment van de harness al
forward, dus de oorspronkelijke pre-implementatie-run is niet als aparte
committed state bewaard.

### Performance — open productiepoort

Gemeten op de 0,5 CPU-kloon, 200-event batches, elke batch in een eigen
teruggedraaide transactie, vijf metingen per fase:

| Fase | p50 | p95 |
|---|---:|---:|
| capture uit | 2206,8 ms | 2407,0 ms |
| capture aan | 2510,8 ms | 2941,2 ms |
| toename | +304,0 ms (+13,8%) | +534,3 ms (+22,2%) |

Dat is **geen PASS** voor de vastgepinde productiepoort (p95 ≤ 10% én ≤ 20 ms,
strengste grens). De functionele bewijslaag is groen, maar de performancepoort
is op deze kloon niet gehaald; dit is een open productieblocker. De meting is
geen live-loadtest en de host is zwaar begrensd, maar dat mag niet als PASS
worden gelezen.

## 9. Overige open grenzen

- Geen productie-DDL, geen push/main, geen deploy, geen Edge/connector/UI.
- Geen wachtwoordprovisioning voor `pitwall_learning_worker`; de operator moet
  dat buiten SQL doen. De tests gebruiken `SET ROLE`, niet een echte login.
- Geen retentieworker, geen modeltraining/scoring/promotie, geen adviespad.
- Capture-fout/backfill is niet in P1 opgelost (zie §3).
- `server_receipt_at` is geen first-visible/knownAt-bewijs (zie §3).
- De rollback bewaart het private schema; opnieuw forwarden vereist een
  expliciete beheeractie.
- De performancepoort is niet gehaald (zie §8).
