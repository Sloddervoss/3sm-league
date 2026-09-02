# Phase E ownership manifest — Telemetry V3 latest/event persistence

> Companion to the recovered production baseline
> [`2026-09-02-pre-phase-e-telemetry-production-baseline.md`](./2026-09-02-pre-phase-e-telemetry-production-baseline.md)
> (machine-readable: [`2026-09-02-pre-phase-e-telemetry-production-baseline.json`](./2026-09-02-pre-phase-e-telemetry-production-baseline.json)).

This manifest documents, for the V3 Phase E work in this branch, **which schema
objects Phase E claims, which it treats as pre-existing production objects it
must not claim, and the exact additive boundary of the Phase E migration and
its rollback**. It is not a historical migration and does not assign ownership
of any pre-existing object.

## Ownership verdict

- Historical canonical migration owner of `public.endurance_telemetry_events`
  and `public.simhub_telemetry_latest`: **UNKNOWN** (recovered read-only from
  production on 2026-09-02; no creating migration found in reachable history).
- **Phase E does NOT assume ownership** of either table. Both are treated as
  **pre-existing base objects**. Phase E evolves them **only additively** and
  never creates, replaces, or drops the tables.
- The Phase E-owned objects are the source-segment table, additive columns,
  named indexes, one check-constraint member, and the service-only persistence
  RPC introduced by `supabase/migrations/20260902190000_endurance_v3_persistence.sql`.

## What Phase E adds (owned by Phase E)

| Object | Type | Notes |
|---|---|---|
| `endurance_telemetry_events.race_run_id` | `uuid`, NULL, FK → `endurance_race_runs(id) ON DELETE SET NULL` | server-authoritative race-run continuity on events |
| `endurance_telemetry_events` event_type check | constraint | adds exactly `'incident_count_changed'`; preserves all 10 prior types incl. `flag_change` |
| `endurance_telemetry_events_race_run_idx` | partial index `(race_run_id, received_at DESC) WHERE race_run_id IS NOT NULL` | |
| `simhub_telemetry_latest.race_run_id` | `uuid`, NULL, FK → `endurance_race_runs(id) ON DELETE SET NULL` | race-run continuity on latest |
| `simhub_telemetry_latest.v3_normalized` | `jsonb`, NULL | normalized V3 payload (single source of truth for V3 reads) |
| `simhub_telemetry_latest_race_run_idx` | partial index `(race_run_id, received_at DESC) WHERE race_run_id IS NOT NULL` | |
| `endurance_source_segments` | Phase-E-owned detector state table | baseline state only; not telemetry history |
| `simhub_persist_v3(text,text,bigint,timestamptz,jsonb)` | SECURITY DEFINER RPC | fixed `search_path`; service_role only; owns the atomic persistence path |

`endurance_race_runs` is owned by the **Phase B** lifecycle migration
(`20260902160000_endurance_race_runs_lifecycle.sql`) and is **NOT** created,
modified, or dropped by Phase E.

## Explicitly out of scope (must not be touched)

- **Base tables** `endurance_telemetry_events` and `simhub_telemetry_latest`:
  no `CREATE TABLE`, no `DROP TABLE`, no column type/null/default changes to
  any pre-existing column.
- **RLS policies and grants/ACLs**: Phase E adds no policy and no
  `GRANT`/`REVOKE` of any kind. V3 writes reuse the existing `service_role`
  `ALL` grant (and its `BYPASSRLS` in Supabase) on both tables.
- **`simhub_devices` device status/role fields**: Phase E does not add or
  alter `device_status`/`device_role`.
- **Pre-existing SECURITY DEFINER RPCs** referencing the base tables
  (`simhub_ingest_snapshot`, `simhub_write_telemetry_event`,
  `simhub_revoke_device`): not modified; their signatures are unchanged.
  `simhub_write_telemetry_event` has no `race_run_id`/`payload` and is not used
  for V3 events; the V3 Edge writes the V3 event rows directly via
  `service_role`.

## Edge behavior contract

- V3 event writes **reuse existing event columns** (see the database review
  skill: every transition maps into `event_type`, `event_key`, `lap`,
  `completed_laps`, `incidents`, `flag`, `in_pit_lane`, `is_in_car`,
  `event_detection_source`, `payload`, `session_id`, `sequence`,
  `captured_at`, `race_run_id`).
- V3 flag-set changes map to the **existing `flag_change`** event type.
- V3 incident increases map to the **new `incident_count_changed`** type (the
  only type added to the check).
- Dedupe reuses the existing unique index
  `endurance_telemetry_events_key_uniq (device_id, session_id, event_key)` with
  `ON CONFLICT ... DO NOTHING`.

## Rollback guarantee

`supabase/rollback/20260902190000_endurance_v3_persistence.rollback.sql`
removes only the Phase E additions above and restores the **exact
pre-Phase-E event_type check** (all 10 original types, without
`incident_count_changed`). It never drops either base table. Verified on a
disposable database by the harness `supabase/tests/run_telemetry_v3_persistence_test.sh`
(apply → readback → rollback → retained-base-object).

## Disposable fixture

`supabase/tests/fixtures/pre_phase_e_telemetry_production_baseline.sql`
(SHA-256 `63120661c37f0e268551a6fca099ee35f7f2113880957d79263469f9b54f0d20`)
is the authoritative **pre-Phase-E** reconstruction and is intentionally left
unchanged: its absence of `race_run_id`/`v3_normalized`/`incident_count_changed`
is the upgrade precondition the migration's disposable test must prove.