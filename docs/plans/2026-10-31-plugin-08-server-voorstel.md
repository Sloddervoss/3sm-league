# Plugin 0.7.2.0 — serverkant als voorstel (na review 6.1 sol)

**Status: VOORSTEL. Niets toegepast op productie, niets gepusht naar main.**
Branch: `feat/plugin-08-server`. Datum: 2026-10-31.
Grondslag: `3sm-plugin-08-gpt61.md`, paragraaf 2 (contractstructuur), 3
(onderhandeling en validator) en 6 (serverkant), plus de harde eis van Vincent
over de automatische update van 0.7.1.x naar 0.7.2.0.

---

## 1. Wat er ligt

| Soort | Bestand |
|---|---|
| DDL | `supabase/migrations/20261031180000_plugin08_measurement_events.sql` |
| DDL | `supabase/migrations/20261031180100_plugin08_lap_summaries.sql` |
| DDL + RPC | `supabase/migrations/20261031180200_plugin08_connector_control.sql` |
| DDL + RPC | `supabase/migrations/20261031180300_plugin08_persist_v3_aggregates.sql` |
| Rollbacks | `supabase/rollback/…180000/180100/180200/180300….rollback.sql` |
| Edge | `supabase/functions/_shared/simhubExtensions.ts` (nieuw) |
| Edge | `supabase/functions/_shared/simhubControl.ts` (nieuw) |
| Edge | `supabase/functions/_shared/simhubAggregates.ts` (nieuw) |
| Edge | `supabase/functions/_shared/simhub.ts` (gewijzigd) |
| Edge | `supabase/functions/simhub-ingest-v3/index.ts` (gewijzigd) |
| Edge | `supabase/functions/simhub-control/index.ts` (nieuw) |
| Tests | `supabase/tests/plugin08_server_proposal.sql` |
| Tests | `supabase/tests/plugin08_rollback_phase.sql` |
| Tests | `supabase/tests/plugin08_persist_body_diff.mjs` |
| Tests | `supabase/tests/fixtures/plugin08_stub_schema.sql` |
| Tests | `supabase/functions/_shared/plugin08_extensions_test.ts` |
| Tests | `supabase/functions/_shared/plugin08_isolation_test.ts` |
| Runner | `supabase/tests/run_plugin08_proposal.sh` |

## 2. Contractafspraken die dit voorstel vastlegt

- `protocolVersion` blijft **3**. Er verandert geen eenheid en geen
  veldbetekenis van een bestaand veld.
- `schemaRevision` is een losse teller (nu 1). Een frame zonder het veld is
  geldig; een hogere waarde dan de server kent is géén fout.
- `capabilities.supported` zegt wat de connector **kan**, niet wat nu
  beschikbaar is. Ontbrekende sleutel = kan het niet. Of een kanaal er nu is,
  hoort in de kwaliteitsmetadata (`channel_missing`, `disabled`, `stale`).
- `environment` staat los van `tyres`, met dezelfde namen en eenheden als
  `tyres.environment` (`trackTempC`, `airTempC`, `rubberState`) plus
  `airPressureHpa` en `trackWetnessPct` uit het `weather`-vocabulaire.
- `measurementEvents[]` en `lapSummaries[]` hebben een stabiel client-ID en
  worden idempotent opgeslagen. `deviceId` en `transportSessionId` horen **niet**
  in de payload: de server bepaalt bij welk apparaat en welke sessie iets hoort.
  Een connector die ze toch meestuurt, krijgt een afkeuring van dat blok.

## 3. Databaseontwerp

### `simhub_measurement_events`
Eigen tabel, niet `endurance_telemetry_events`: een meetgebeurtenis hoort bij een
apparaat en een sessiesegment, niet bij team of race run, en komt met een
client-ID die herhaald aangeboden kan worden. Idempotent op
`(device_id, event_id)`. `kind` is bewust **geen** enum: een nieuwe soort mag geen
migratie kosten. `confidence` is 0..1 en `null` betekent "geen uitspraak" — dat is
iets anders dan 0 (zeker geen anker) en dat verschil blijft bewaard.

### `simhub_lap_summaries`
Eén rij per ronde met temperatuur, brandstofniveau-integraal, belasting,
koppelingen en **dekking** (`valid_duration_seconds`, `sample_count`,
`max_gap_seconds`). Zonder die drie is geen enkele integraal in deze tabel te
verantwoorden; daarom staan ze naast elke metriek en niet in een aparte tabel.
Idempotent op `(device_id, summary_id)`; een replay overschrijft nooit een eerdere,
mogelijk betere berekening.

### `simhub_connector_config`
Singleton (`check (id = 1)`). Geen kolom voor SDK-kanaalnamen, formules of
downloadpaden: wat er niet is, kan niet misbruikt worden. `features` is een
object met alleen booleans; onbekende sleutels worden bij het schrijven
weggefilterd en dus nooit geactiveerd. Grenzen staan in de DDL (CHECK), niet
alleen in de schrijver.

Lezen kan alleen via `simhub_connector_config_public()`, die precies tien
beleidskolommen teruggeeft (geen `select *`), plus de view
`simhub_connector_config_readonly` voor de runbook en de tests. Schrijven kan
alleen via `simhub_connector_config_apply()`, service-role-only, met
optimistische concurrency (`p_expected_revision`) en een `config_revision` die
alleen bij een geslaagde wijziging omhoog gaat.

## 4. De RPC-uitbreiding en waarom de signatuur niet breekt

`simhub_persist_v3` krijgt twee parameters erbij, **achteraan** en met
`DEFAULT NULL`:

```
p_simhub_version text DEFAULT NULL,
p_events jsonb DEFAULT NULL,
p_laps jsonb DEFAULT NULL
```

In Postgres is een extra parameter met default een **nieuwe overload**. De
bestaande zes-argumentdefinitie wordt daarom eerst expliciet gedropt; anders
bestaan beide naast elkaar en wordt een aanroep met vijf benoemde argumenten
ambigu (42725). Een `do`-blok onderaan telt de overloads en faalt als het er niet
precies één is, en controleert dat het aantal parameters 8 is.

Gevolg: een aanroep met 5 argumenten (de 0.7.1.x-Edge) en met 6 argumenten (de
huidige main) resolveert naar dezelfde functie en gedraagt zich identiek; met 8
argumenten komen de meetreeksen erbij. De body is verder regel voor regel
ongewijzigd — dat bewijst `plugin08_persist_body_diff.mjs` (511 oude regels, 36
nieuwe in 2 blokken, niets gewijzigd of verwijderd).

De meetreeksen worden geschreven door `simhub_persist_measurement_batch()`, in
een eigen `BEGIN … EXCEPTION`-blok binnen de RPC. Een kapotte of te grote reeks
kost dus nooit het frame: de snapshot, de ronde en de brandstof zijn dan al
geschreven en de fout staat als `RAISE WARNING` in de logboeken.

## 5. Edge-gedrag

- **Onbekende rootkeys** zijn geen framefout meer, maar ze zijn begrensd
  (maximaal 32 sleutels, naam `^[A-Za-z][A-Za-z0-9_.-]{0,63}$`, waarde ≤ 4096
  tekens, diepte ≤ 3, totaal ≤ 16384 tekens) en worden **niet** doorgegeven aan
  het DTO of de database. Buiten de grens is het wel een framefout.
- **Onbekende velden binnen een bekend blok** blijven een fout. Dat is getest
  voor `track`, `session` en voor `measurementEvents`/`lapSummaries`.
- **Nieuwe blokken zijn nooit fataal**: een ongeldige `measurementEvents` of
  `lapSummaries` kost alleen dat blok, met een logregel en zonder de kerntelemetrie
  te raken.
- **Geen afhankelijkheid van control.** De ingest bepaalt zelf of de database de
  0.7.2.0-signatuur heeft: krijgt de RPC 42883/PGRST202, dan gaat hetzelfde frame
  opnieuw weg met vijf argumenten en blijven de meetreeksen in de logboeken. Dat
  werkt ook als het control-endpoint nooit is uitgerold of later wordt
  teruggedraaid.

## 6. Harde eis: de automatische update van 0.7.1.x naar 0.7.2.0

**Deze endpoints zijn niet aangeraakt** — geen codewijziging, geen andere vorm,
geen andere statuscodes:

| Endpoint | Status in dit voorstel |
|---|---|
| `supabase/functions/simhub-version/index.ts` | **ongewijzigd** (byte voor byte) |
| `supabase/functions/simhub-ingest/index.ts` (v1/v2) | ongewijzigd |
| `supabase/functions/simhub-ingest-v3/context.ts` | ongewijzigd |
| `supabase/functions/simhub-ingest-v3/persist.ts` | ongewijzigd |
| `supabase/functions/simhub-pair/index.ts` | ongewijzigd |
| `supabase/functions/simhub-overlay/index.ts` | ongewijzigd |
| `supabase/functions/simhub-practice/index.ts` | ongewijzigd |
| `supabase/functions/simhub-ingest-v3/index.ts` | gewijzigd, maar de RPC-aanroep is **identiek** zolang een frame geen meetreeksen bevat |

Waarom 0.7.2.0 als nieuwste wordt aangeboden zonder iets te breken:
`simhub-version` leest `SIMHUB_PLUGIN_VERSION`, `SIMHUB_PLUGIN_DLL_URL`,
`SIMHUB_PLUGIN_SHA256`, `SIMHUB_PLUGIN_BYTE_LENGTH`, `SIMHUB_PLUGIN_FILE_NAME` en
`SIMHUB_PLUGIN_SIGNATURE` uit de omgeving en geeft altijd dezelfde acht sleutels
terug. De release naar 0.7.2.0 is dus een deploy-instelling, geen codewijziging,
en een 0.7.1.x-client leest exact wat hij altijd las. De test
`P08-I1` zet die omgeving op 0.7.2.0 en controleert de vorm en de waarde; `P08-I2`
controleert dat `simhub-version` en `simhub-control` geen code delen.

`simhub-control` staat daar volledig los van: het leest geen versie, schrijft
geen versie en verwijst niet naar `SIMHUB_PLUGIN_VERSION`. Bij elke fout geeft
het een stabiel `503`-antwoord met `{"ok":false,"error":"control_unavailable",
"compatibility":"v3-base-profile"}`, zodat een 0.7.2.0-client terugvalt op het vaste
V3-basisprofiel en een 0.7.1.x-client (die het endpoint niet kent) niets merkt.
De tests `P08-I3` t/m `P08-I7` dekken dat pad, inclusief de situatie "control
geeft 500, update- en verzendroute lopen door".

## 7. Uitrol- en terugdraaivolgorde

Uitrollen (in deze volgorde, met `psql -1` per bestand):

1. `20261031180000` → `20261031180100` → `20261031180200` → `20261031180300`
   → `20261031190000` → `…190100` → `…190200` → `…190300` → `…190400`
   → `…190500` → `…190600` → `…190700` → `…190800`.
2. Edge deployen (`_shared/*`, `simhub-ingest-v3`, `simhub-control`).
3. Pas daarna in de configuratie `features.measurementEvents` /
   `features.lapSummaries` aanzetten. Zonder die vlag stuurt de client de blokken
   niet en blijft alles bij het oude.

Terugdraaien (in deze volgorde, van nieuw naar oud):

1. **Eerst** de features uitzetten
   (`simhub_connector_config_apply('{"features":{"measurementEvents":false,"lapSummaries":false}}')`).
2. `…190800.rollback.sql` → `…190700` → `…190600` → `…190500` → `…190400`
   → `…190300` → `…190200` → `…190100` → `…190000` → `20261031180300`
   → `…180200` → `…180100` → `…180000`.

De hele keten is **gegevensbehoudend**: de oude schrijver komt terug, de tabellen
en hun inhoud blijven staan. Destructief opruimen staat in
`supabase/rollback/plugin08_destructive_cleanup.sql` (aparte, gedocumenteerde
handeling na een export).

Waarom die eerste stap: de rollback van `20261031180300` haalt de
acht-argumentversie weg. Een Edge die daarna nog `p_events`/`p_laps` meestuurt,
krijgt 42883 en verliest het hele frame. Met de features uit gaat de Edge terug
naar de vijf-argumentaanroep. De Edge valt daarnaast zelf terug zodra hij 42883
ziet, dus de volgorde is een tweede vangnet, geen enige voorwaarde.

## 8. Aannames die de reviewer moet controleren

1. **`device_id` is `text`, niet `uuid`.** Dat staat zo in de opdracht. Gevolg:
   geen foreign key naar `simhub_devices.id` en geen join zonder cast. De
   schrijver vult altijd `d.id::text`. Advies: naar `uuid` + FK trekken als er
   niets tegen die keuze is; dat is één `alter table` vóór er data in staat.
2. **`simhub_lap_summaries` heeft een surrogaat-`id uuid` primary key** die niet
   in de opdracht stond. Zonder primary key is de tabel niet fatsoenlijk te
   joinen of te verwijderen; de zakelijke sleutel blijft
   `(device_id, summary_id)`.
3. **Geen `begin`/`commit` in de migratiebestanden**, zoals gevraagd. Ze zijn
   bedoeld voor `psql -1`. De repo heeft migraties die wél `begin;`/`commit;`
   bevatten; deze vier volgen de opdracht en niet die gewoonte.
4. **De fixture `plugin08_stub_schema.sql` is geen productieschema.** De
   SQL-tests bewijzen de signatuur, de argumentafhandeling, de meetbatch, de
   idempotentie en de configuratie-RPC — niet de volledige productiesemantiek
   van strategie, ankers en practice. De stub bevat alleen de kolommen die
   `simhub_persist_v3` aanraakt; kolomtypen van niet-gebruikte kolommen zijn
   niet gekopieerd uit productie.
5. **`measurementEvents` max 50 en `lapSummaries` max 5 per frame** in de Edge,
   tegen 200/20 in de database. De Edge-grens is strenger vanwege het
   payloadbudget van 24 kB per frame; de rest hoort in de outbox van de plugin.
   Als blijkt dat één frame meer moet kunnen, is dat een Edge-constante.
6. **Verlopen configuratie**: de SQL-functie geeft de rij terug, het endpoint
   zet `expired: true` en stuurt dan defaults met `configRevision: 0`. De
   handhaving zit dus in het endpoint, niet in de database. Bewust: één plek
   waar "verlopen betekent niet toepassen" staat.
7. **`schemaRevision` met een verkeerd type kost het frame** (het is een kale
   teller, geen blok). De vijf blokken eromheen zijn nooit fataal. Als de
   reviewer dat te streng vindt, is het één regel in `simhub.ts`.
8. **`kind` heeft geen CHECK-lijst.** Een nieuwe gebeurtenissoort mag geen
   migratie kosten. De keerzijde: een typefout in `kind` wordt niet door de
   database tegengehouden, alleen door de tekenset `^[a-z0-9._-]{1,64}$`.
9. **De `SET search_path` van de nieuwe functies** is `pg_catalog, public, auth,
   pg_temp`, gelijk aan `simhub_persist_v3`. De ACL wordt expliciet gezet
   (`revoke … from public, anon, authenticated` + `grant … to service_role`),
   omdat een verse functie de ACL van de oude niet erft.
10. **`received_at` is `not null default now()`** op beide meettabellen, maar
    maakt geen deel uit van de unieke sleutel: een replay verandert hem niet.

## 9. Tests draaien

```bash
# alles, in een wegwerpdatabase (psql 15+)
./supabase/tests/run_plugin08_proposal.sh

# of los
psql -X -v ON_ERROR_STOP=1 -d plugin08_test \
  -f supabase/tests/fixtures/plugin08_stub_schema.sql \
  -f supabase/migrations/20261031180000_plugin08_measurement_events.sql \
  -f supabase/migrations/20261031180100_plugin08_lap_summaries.sql \
  -f supabase/migrations/20261031180200_plugin08_connector_control.sql \
  -f supabase/migrations/20261031180300_plugin08_persist_v3_aggregates.sql \
  -f supabase/tests/plugin08_server_proposal.sql

node supabase/tests/plugin08_persist_body_diff.mjs
deno test --allow-env --allow-read supabase/functions/_shared/
```

## 10. Reparaties na de review van 6.1 sol

De review (NO-GO) is per punt verwerkt. Elk punt heeft een eigen migratie, en
waar de DDL wijzigt ook een rollback; het contract staat in
`docs/contracts/measurement-ids-v1.md`.

| # | Reviewpunt | Reparatie | Bewijs |
|---|---|---|---|
| 1 | identiteit | duurzame `event_uid`/`summary_uid`, `observed_session_id` (client) naast `delivered_session_id` (server), uniciteit alleen op de UUID | `190000`, SQL R1 |
| 2 | revisies | `record_revision`, upsert alleen bij hogere revisie, `revision_conflict`/`stale_revision` in het ACK, `supersedes_*` | `190100`, SQL R2 |
| 3 | ACK | `simhub_persist_measurement_batch` geeft een rapport per rij; `simhub_persist_v3.measurement_ack`; Edge antwoordt met `measurements` | `190200`, SQL R3, Deno P08-P2/P3 |
| 4 | wear | `wear_v1` (vier hoeken, 0..100, `scale: remaining_percent`), `evidence_v1`, `setGeneration`; onbekende sleutels en niet-numeriek geweigerd | `190300`, SQL R4, Deno P08-8 |
| 5 | dekking | `coverage` per groep (temperature/fuel/load), `complete` eist alle drie, integraal zonder dekking geweigerd, `sample_count` bigint | `190400`, SQL R5, Deno P08-9 |
| 6 | casts | `simhub_jnumeric` als enige getalbron, eindigheid en bereik vóór elke cast, integer via numeric (`1.0` werkt), rij-isolatie | `190500`, SQL R6 |
| 7 | snapshot | Edge stuurt `snapshotDto` (kernframe) + trigger op `simhub_telemetry_latest` | `190600`, SQL R7, Deno P08-P1 |
| 8 | grenzen | control 400 ms / 24576 bytes, `out_of_range` met detail, alleen boolean-features, één budgetmaat (jsonb-bytes), expliciete afwijzing bij te groot bewijs | `190700`, SQL R8 |
| 9 | herstel | capability met TTL en herprobe, degradatie zichtbaar in `aggregates` | Edge, Deno P08-P4 |
| 10 | rollback | gegevensbehoudende keten + apart destructief script | `rollback/`, SQL rollbackcontrole |
| 11 | versie | overal 0.7.2.0, `protocolVersion` blijft 3 | Deno P08-P6 |
| 12 | retentie | 90/400 dagen + `simhub_prune_measurements` (standaard proef, service-role) | `190800`, SQL R12 |

### Reparaties uit de tweede review (6.1 sol, 2026-10-31)

| # | Punt | Reparatie | Bewijs |
|---|---|---|---|
| 1 | rijdersemantiek | ronde draagt `currentDriverName`; `current_driver_id` server-side geresolveerd; client-UUID en `driverChanged`+rijder geweigerd | `200000`, SQL P1, Deno P08-11 |
| 2 | ACK en revisies | bevestigingen `{id, record_revision}`; `ok:false` wordt `stored:false` met reden; één indexruimte via `acceptedIndexes`; `received` is de aangeboden reeks | `200100`, SQL P2, Deno R2-1..R2-3 |
| 3 | rollback | geen labeluniciteit meer, UUID-uniciteit blijft, oude schrijver dedupliceert in de query, idempotent; destructief script verwijdert tabellen vóór de validatiefuncties | `rollback/190000`, SQL rollback-seed/check |
| 4 | complete | ≥10 samples per groep, gat ≤2 s, ≥80% van het venster; anders `complete=false` met reden | `200200`, SQL P4, Deno R2-4 |
| 5 | wear | `version` verplicht in SQL (geen coalesce); `evidence:null` al in de Edge geweigerd | `200300`, SQL P5, Deno R2-5 |
| 6 | control | `out_of_range` → HTTP 400 met `reason`, `invalid_payload` → 422 met reden | Edge `controlWriteOutcome`, Deno R2-6 |
| 7 | payload | 20/3 als gemeten Edge-maximum (15.903 bytes) + batchbudget 16.384 bytes met `payload_too_large` | `plugin08_payload_measure.ts`, Deno R2-7 |
| 8 | prestatie | set-based snelpad (één INSERT, één UPDATE) met rij-lus-terugval; gemeten p50/p95 en WAL | `200400`, SQL P8, `plugin08_load_test.sql` |

### Meting op het ingestpad (wegwerpdatabase, PostgreSQL 18.6)

`supabase/tests/plugin08_load_test.sql`, 20 frames per variant (10 voor de
databasedrempel), drie runs op dezelfde machine. De getallen zijn de mediaan van
de runs; de spreiding tussen runs is enkele ms tot tientallen ms.

| Variant | p50 | p95 | WAL per frame |
|---|---|---|---|
| frame zonder meetreeks (0.7.1.x-pad) | 1–3 ms | 2–6 ms | — |
| **wire-max 20/3 (gekozen Edge-maximum)** | **18–19 ms** | **22–26 ms** | **30–35 kB** |
| 50/5 (oude edge-max, boven de bytegrens) | 41–47 ms | 43–73 ms | 71–75 kB |
| database-max 200/20 | 207–227 ms | 223–294 ms | — |
| 20/3 met twee dezelfde UUID's (rij-lus-terugval) | 33–35 ms | 34–43 ms | 56–57 kB |
| 20/3 alles duplicaat (classificatie, geen schrijfactie) | 1 ms | 1–2 ms | — |

Het set-based snelpad is dus ongeveer twee keer sneller dan de rij-lus op
dezelfde batch (19 ms tegen 34 ms) en schrijft bijna de helft minder WAL
(31 kB tegen 57 kB). Het gekozen maximum van 20/3 past met ~19 ms ruim in het
verzendinterval van 400 ms; 50/5 past daar met ~42 ms ook in, maar die batch
past niet in de HTTP-body van 24.576 bytes (gemeten 35.971 bytes; de review
mat 34.221) en is dus geen ondersteund wireprofiel meer.

Caveat: dit is een wegwerpdatabase op één machine, met de SQL-laag direct
aangeroepen. De HTTP-bodylimiet, de Edge-parser, gelijktijdige devices en
outboxafvoer zijn hier niet inbegrepen. Productie draait PostgreSQL 15.19; de
gebruikte functies (`jsonb_populate_recordset`, `pg_current_wal_insert_lsn`)
bestaan daar ook, maar de getallen zijn niet één-op-één overdraagbaar.

### Restrisico's

1. **Latentie op de databasedrempel** (zie boven): 200/20 haalt het
   verzendinterval niet. Mitigatie: de Edge stuurt maximaal 20/3 en de outbox
   spreidt de rest.
2. **Geen native Deno-runtime in deze omgeving**: de Deno-tests draaien met de
   echte Deno-binary (45 tests), maar niet tegen een live Supabase-project. De
   Edge-handlers zijn getest met de echte code en een nagebootste client.
3. **`device_id` is nog `text`** zonder FK; een verweesd meetgegeven blijft
   mogelijk staan. Bewust uitgesteld (review noemt dit "kan later").
4. **`kind` heeft geen CHECK-lijst**; alleen de tekenset wordt afgedwongen.
5. **De productieomgeving is niet aangeraakt**: geen migratie is uitgevoerd, er
   is niets gedeployed en de productie-DB is alleen binnen `BEGIN READ ONLY`
   bevraagd (in de review, niet in dit werk).
