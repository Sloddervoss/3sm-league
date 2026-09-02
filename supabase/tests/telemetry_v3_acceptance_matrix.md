# Telemetry V3 Phase E — Acceptance Coverage Matrix (A01–A104)

Owner: 3SM SimHub Telemetry V3 (Phase E: endurance V3 persistence).
Harness: `supabase/tests/run_telemetry_v3_persistence_test.sh` (disposable DB
`test_pre_phase_e_baseline` only — never production).
Acceptance SQL: `supabase/tests/telemetry_v3_acceptance_test.sql`.
This document exists so the runner can fail fast if coverage is regressed
(`A100`). Every functional assertion logs into `pg_temp.ac_ledger` and the SQL
closing block proves all A01–A97 executed; A98–A104 are proven by the runner.

| ID   | Category | Assertion |
|------|----------|-----------|
| A01  | run resolution | active `race` run resolves; latest + events carry `race_run_id` |
| A02  | run resolution | practice/qualifying runs never resolve (NULL) |
| A03  | run resolution | resolver structurally scoped to `run_kind='race' AND status='active'` |
| A04  | run resolution | `ended` race run excluded |
| A05  | run resolution | `cancelled` race run excluded; snapshot still accepted |
| A06  | run resolution | no active run → events still persisted, `race_run_id` NULL allowed |
| A07  | run resolution | run activating mid-stream is picked up on resume |
| A08  | authority | revoked device → `revoked` (no write) |
| A09  | authority | unbound device → `not_bound` |
| A10  | authority | registration rejected/withdrawn → `not_registered` |
| A11  | authority | unknown token → `invalid_device` |
| A12  | authority | non-`service_role` caller → `unauthorized` |
| A13  | authority | valid primary → `accepted` |
| A14  | authority | strict validation: bad token/session/sequence/captured/jsonb → `invalid_payload`, zero writes |
| A15  | handoff | former primary demoted → `not_authority` AND prior source segment retained (no cleanup) |
| A16  | session baseline | fresh session emits exactly 1 sample, 0 transitions |
| A17  | handoff baseline | new session must not fabricate a cross-source transition |
| A18  | authority | standby/revoked/unbound devices never create a source segment |
| A20  | lap edge | exact +1 lap advance → `lap_completed` `lap:11` |
| A21  | lap edge | lap jump → no synthetic lap event |
| A22  | lap edge | lap decrease → no lap event |
| A23  | lap edge | lap repeat → no lap event |
| A25  | incident edge | monotone increase → `incident_count_changed` `incident:5` |
| A26  | incident edge | decrease → no incident event |
| A27  | pit edge | onPitRoad false→true → `pit_entry` |
| A28  | pit edge | true→false `pit_exit`, then re-entry → recurring pit (2 entries) |
| A29  | flag edge | flag-set change → `flag_change` carrying csv |
| A30  | flag edge | flag reorder is order-insensitive → no change |
| A31  | flag edge | identical set repeated → no new `flag_change` |
| A32  | pit edge | same onPitRoad persisted again → no new pit event |
| A33  | keys | deterministic event keys `lap:N`, `incident:N`, `v3:pit_entry:seq:N`, `v3:pit_exit:seq:N`, `v3:flag_change:seq:N` |
| A40  | idempotency | retry same (session,sequence) → `replayed` |
| A41  | idempotency | lower sequence → `replayed` |
| A42  | idempotency | higher sequence accepted |
| A43  | idempotency | same event_key upsert → no-op (single lap row) |
| A44  | idempotency | latest is single-row per device |
| A45  | idempotency | partial unique index `(race_run_id,completed_laps)` dedupes a repeated committed lap |
| A50  | domain dedupe | cross-source lap dedupe (two devices/sessions, one lap:51) |
| A51  | domain dedupe | cross-source incident dedupe (one `incidents=5`) |
| A52  | domain dedupe | NULL-run historical duplicates preserved (outside partial index) |
| A53  | domain dedupe | dedupe is global (not scoped to a single source device) |
| A60  | required fields | missing `event_type` → not_null |
| A61  | required fields | missing `device_id` → not_null |
| A62  | required fields | missing `event_key` → not_null |
| A63  | latest boundary | scalar `v3_normalized` → check violation |
| A64  | latest boundary | array `v3_normalized` → check violation |
| A65  | latest boundary | `context_shape` — race_id/team_id both-set or both-NULL |
| A66  | latest boundary | `sequence >= 0` enforced |
| A67  | required fields | exhaustive all-NOT-NULL sample row inserts |
| A70  | atomicity | mid-RPC FK failure rolls back source_segment write |
| A71  | atomicity | mid-RPC FK failure rolls back event writes |
| A72  | atomicity | mid-RPC FK failure rolls back latest write |
| A73  | atomicity | strict payload rejection has zero side-effects |
| A74  | atomicity | multi-row event insert with a bad row → no partial insert |
| A75  | atomicity | bad latest row → no partial insert |
| A80  | non-emission | baseline session emits zero transitions |
| A81  | non-emission | jump produced no extra `lap_completed` (only exact laps) |
| A82  | non-emission | pit events only on edges (3 total: in/out/in) |
| A83  | non-emission | identical flag set → no new flag event |
| A84  | non-emission | incident non-increase → no new incident event |
| A90  | history | legacy `event_type` still accepted by evolved check |
| A91  | history | legacy row payload preserved byte-for-byte |
| A92  | history | NULL-run duplicates preserved |
| A93  | history | existing latest rows survive |
| A94  | history | base tables retained (never dropped) |
| A95  | history | `race_run_id` column present forward; rollback block rejects incident rows |
| A96  | history | `race_run_id` stays NULL-able for historical inserts |
| A97  | history | valid object `v3_normalized` retained on latest |
| A98  | concurrency | runner: two parallel connections race same lap → exactly one row |
| A99  | concurrency | same, on the shared partial unique index (no double-count) |
| A100 | coverage | matrix document present (runner guard) |
| A101 | coverage | SQL ledger confirms every declared A01–A97 executed |
| A102 | rollback | retained base objects (`endurance_telemetry_events`, `simhub_telemetry_latest`, `endurance_race_runs`) |
| A103 | rollback | original event_type check restored; `incident_count_changed` rejected post-rollback |
| A104 | safety | no production/deploy operations (suite touches only the disposable DB) |

## How to run

```
bash supabase/tests/run_telemetry_v3_persistence_test.sh
```

The suite rebuilds the disposable DB, applies the authoritative pre-Phase-E
fixture + Phase E forward migration, runs P01–P20, runs A01–A97 (self-rolling
transaction, service_role), runs A98/A99 parallel-concurrency workers, applies
rollback, and re-verifies A102–A104. It never connects anywhere but the
disposable database.