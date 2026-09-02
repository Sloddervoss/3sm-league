# Recovered pre-Phase-E telemetry production baseline

> **RECOVERED PRODUCTION BASELINE**<br>
> **HISTORICAL MIGRATION OWNER UNKNOWN**

Observed read-only in production on **2026-09-02**. This is evidence of the PRE-PHASE-E production contract; it is **not** an original migration, does not rewrite history, and does not assign Phase E ownership of either table.

Phase E MUST treat `public.endurance_telemetry_events` and `public.simhub_telemetry_latest` as **pre-existing base objects**. Phase E may evolve them only additively and must never create, replace, own, or drop either table.

## Evidence and provenance

- Read-only target: PostgreSQL 15.8, database `postgres`, role `supabase_admin`.
- Production changes during audit: **NONE**.
- `endurance_telemetry_events.production.schema.sql` SHA-256: `2c4fd4694284a594b167dc25b783d17810b1f84cfb201e70350b1fa7de281c9b`
- `simhub_telemetry_latest.production.schema.sql` SHA-256: `6bf88e1c0a73a2b6171fe54c83a4a7bc1a327fd3c3ad9a00f212c2835fae5677`
- Canonical historical creating migration: **NOT FOUND**.
- Application migration-history table: **NOT FOUND** (`supabase_migrations.schema_migrations` and `public.schema_migrations` absent).
- Reachable Git history found only a disposable fixture commit `bde2144694c84f1ffbda534379d42dc3dbb6a809` and later frozen design documentation. Neither is a canonical owner.
- `supabase/tests/diagnostics_v1_edge_e2e_setup.sql` is explicitly a disposable test fixture and is **NOT CANONICAL**.

The machine-readable ownership boundary is [2026-09-02-pre-phase-e-telemetry-production-baseline.json](./2026-09-02-pre-phase-e-telemetry-production-baseline.json). A fresh-install historical migration chain is a separate repository-hygiene/disaster-recovery issue and is out of scope here.

## A. `public.endurance_telemetry_events`

- Owner: `supabase_admin`
- RLS: enabled; forced: no
- Replica identity: default
- Non-internal triggers: none
- Audit metadata: 4,500 rows; `received_at` 2026-08-30 17:27:46.377449+00 → 2026-09-02 14:59:07.338523+00; `captured_at` 2026-08-30 17:27:47.27069+00 → 2026-09-02 14:59:17.143163+00.

### Exact columns

| Pos | Column | Type | Nullable | Default |
|---:|---|---|---|---|
| 1 | id | uuid | no | `gen_random_uuid()` |
| 2 | device_id | uuid | no | |
| 3 | event_id | uuid | no | |
| 4 | team_id | uuid | no | |
| 5 | session_id | text | no | |
| 6 | event_type | text | no | |
| 7 | event_key | text | no | |
| 8 | sequence | bigint | no | |
| 9 | captured_at | timestamp with time zone | no | |
| 10 | received_at | timestamp with time zone | no | `clock_timestamp()` |
| 11 | lap | integer | yes | |
| 12 | completed_laps | integer | yes | |
| 13 | driver_id | text | yes | |
| 14 | stint_elapsed_s | numeric | yes | |
| 15 | session_time_s | numeric | yes | |
| 16 | fuel_litres | numeric | yes | |
| 17 | fuel_per_lap_litres | numeric | yes | |
| 18 | fuel_added_est_litres | numeric | yes | |
| 19 | laps_remaining_est | numeric | yes | |
| 20 | lap_time_from_deltas_s | numeric | yes | |
| 21 | in_pit_lane | boolean | yes | |
| 22 | incidents | integer | yes | |
| 23 | flag | text | yes | |
| 24 | is_in_car | boolean | yes | |
| 25 | event_detection_source | text | no | |
| 26 | payload | jsonb | yes | |

### Constraints and indexes

- PK: `endurance_telemetry_events_pkey PRIMARY KEY (id)`.
- FKs, all `ON DELETE CASCADE`:
  - `device_id → public.simhub_devices(id)`
  - `event_id → public.endurance_events(id)`
  - `team_id → public.endurance_teams(id)`
- Check `endurance_telemetry_events_event_type_check`:
  `event_type = ANY (ARRAY['sample', 'lap_completed', 'pit_entry', 'pit_exit', 'fuel_added', 'driver_change', 'stint_start', 'stint_end', 'flag_change', 'car_state_change']::text[])`.
- Existing indexes:
  - unique `(id)` PK index;
  - `endurance_telemetry_events_context_idx (event_id, team_id, captured_at DESC)`;
  - unique `endurance_telemetry_events_key_uniq (device_id, session_id, event_key)`;
  - `endurance_telemetry_events_type_idx (event_id, event_type, captured_at DESC)`.
  - No partial indexes.

### RLS, ACLs, and dependencies

- Permissive `SELECT` policy for `authenticated`: `staff read full endurance telemetry events`, `USING (can_manage_simhub())`.
- Grants: `postgres`, `authenticated`, and `service_role` have `ALL`; `PUBLIC` and `anon` have no grant.
- Direct function references:
  - `simhub_ingest_snapshot` (both observed overloads)
  - `simhub_write_telemetry_event`
  - `simhub_revoke_device`
- No dependent views/materialized views or non-internal triggers were found.

## B. `public.simhub_telemetry_latest`

- Owner: `supabase_admin`
- RLS: enabled; forced: no
- Replica identity: `FULL`
- Non-internal triggers: none
- Audit metadata: 3 rows; `received_at` 2026-08-15 21:03:14.128483+00 → 2026-09-02 14:59:07.338523+00; `captured_at` 2026-08-15 21:03:14.044897+00 → 2026-09-02 14:59:17.143163+00.

### Exact columns

| Pos | Column | Type | Nullable | Default |
|---:|---|---|---|---|
| 1 | device_id | uuid | no | |
| 2 | owner_user_id | uuid | no | |
| 3 | race_id | uuid | yes | |
| 4 | team_id | uuid | yes | |
| 5 | session_id | text | no | |
| 6 | sequence | bigint | no | |
| 7 | captured_at | timestamp with time zone | no | |
| 8 | received_at | timestamp with time zone | no | `now()` |
| 9 | connector_id | text | no | |
| 10 | simhub_version | text | no | |
| 11 | game | text | no | |
| 12 | telemetry | jsonb | no | |
| 13 | endurance_event_id | uuid | yes | |
| 14 | endurance_team_id | uuid | yes | |
| 15 | driver_id | text | yes | |
| 16 | current_driver_id | text | yes | |
| 17 | current_driver_name | text | yes | |
| 18 | car_id | text | yes | |
| 19 | car_name | text | yes | |
| 20 | track_name | text | yes | |
| 21 | track_config | text | yes | |

### Constraints and indexes

- PK: `simhub_telemetry_latest_pkey PRIMARY KEY (device_id)`.
- FKs, all `ON DELETE CASCADE`: `device_id → simhub_devices`, `owner_user_id → auth.users`, `race_id → races`, `team_id → teams`.
- Checks: connector ID length 1–120; session ID length 1–120; SimHub version length 1–60; `game = 'IRacing'`; `sequence >= 0`; `telemetry` is a JSON object; race/team are both NULL or both non-NULL.
- Existing indexes: unique `(device_id)` PK index; `simhub_telemetry_latest_race_team_idx (race_id, team_id, received_at DESC)`. No partial indexes.

### RLS, ACLs, and dependencies

- Permissive `SELECT` policy for `authenticated`: `Staff can read active latest SimHub telemetry`, `USING (can_manage_simhub() AND is_active_simhub_device(device_id))`.
- Grants: `postgres` and `service_role` have `ALL`; `authenticated` has `SELECT`; `PUBLIC` and `anon` have no grant.
- Direct references: `simhub_ingest_snapshot` (both observed overloads) and `simhub_revoke_device`.

### Important Phase E upgrade preconditions

- `race_run_id`: **ABSENT**.
- `v3_normalized`: **ABSENT**.
- `simhub_persist_v3`: **ABSENT**.
- `endurance_source_segments`: **ABSENT**.

## Test-only reconstruction

`supabase/tests/fixtures/pre_phase_e_telemetry_production_baseline.sql` is a disposable-DB-only reconstruction of this observed contract. It is not a migration and is forbidden in production. It intentionally uses minimal dependency and role stubs only to make the recovered tables, FKs, policies, RLS and index shapes testable.
