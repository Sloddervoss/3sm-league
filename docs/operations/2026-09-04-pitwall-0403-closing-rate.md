# 3SM Pitwall — 0.4.3A Server-Side Closing Rate (DEV Validation)

Date: 2026-09-04 | Status: DEV-ONLY, NOT deployed to production

## Purpose

Server-side sampled opponent gap history + closing-rate trends, independent of whether a
Pitwall browser is open (Vincent's rolling TEST fleet requirement). No connector change.
This phase validated the entire implementation against a **non-production** database.

## Non-prod validation DB

- Disposable `postgres:17-alpine` container on 3sm-docker (`pitwall-0403-devdb`, port 55432).
  Production is PostgreSQL 15.8; the SQL uses standard constructs (window/regr_slope) valid on
  both. The Supabase roles (`anon`, `authenticated`, `service_role`) were created in the dev DB
  so grant/revoke statements compile-check. **Production DB untouched.**
- Validation: migration **apply PASS**, **rollback PASS** (drop all objects), **re-apply PASS**
  (clean, 2 functions present). Functional: closing/opening/flat trends correct, >40 capped,
  duplicate 10s-bucket prevented, pit/disconnected/missing-gap suppressed, 300s prune verified
  (rows inserted in the past were correctly pruned; clock-relative re-test produced valid trends).

## Schema (additive)

`public.endurance_opponent_gap_samples`
- PK `(race_run_id, opponent_id, sample_bucket)`; `sample_bucket = opp_sample_bucket(observed_at)` (10s).
- fields: event_id, team_id, device_id, session_id, observed_at, seq, gap_to_player_seconds,
  lap_distance_pct, in_pit, connected.
- Index: `(race_run_id, observed_at)` for trend lookup + bounded cleanup.
- Retention: prune rows older than **300s** (120s trend window + 180s headroom). Bounded.

Functions:
- `opp_sample_bucket(timestamptz) → bigint` (10s bucket)
- `prune_opponent_gap_samples()`
- `record_opponent_gap_samples(...)` SECURITY DEFINER, **service_role only**; caps 40/opp, suppresses
  missing-gap, disconnected, in-pit, duplicate bucket.
- `pitwall_opponent_trends_v1(uuid) → jsonb` SECURITY DEFINER, **service_role only**.

## Sampling

- Interval: **10 seconds per opponent** (bucketed, no 1Hz history).
- Runs **server-side** in the V3 ingest edge after persist (opponents present + active race run).
- Failure = **non-fatal (option B)**: core telemetry ingest always succeeds; sampling error is logged
  and ignored. Documented choice.

## Write volume (10s interval, 300s retention)

| cars | rows/min written | rows/hour | steady-state table size |
|---|---|---|---|
| 20 | 120 | 7,200 | ~600 |
| 40 | 240 | 14,400 | ~1,200 |
| 60 | 360 | 21,600 | ~1,800 |

Table is bounded at ~300s worth regardless of session length.

## Closing-rate formula (server)

`pitwall_opponent_trends_v1`:
```
closing_rate_s_per_min = round((-60 * regr_slope(gap_to_player_seconds, epoch_seconds))::numeric, 2)
```
- **Unit:** seconds of gap change per **minute** (s/min). NOT s/lap (no lap-rate denominator used).
- **Sign convention:** `gap > 0` = opponent behind; `gap < 0` = ahead.
  - `closing_rate_s_per_min > 0` → opponent **CLOSING/catching** the player.
  - `closing_rate_s_per_min < 0` → opponent **OPENING / pulling away**.
  - `~0` → flat.
- Requires ≥ **3 valid samples** in the eligible (latest 120s) window. Below that → opponent absent
  from the map (trend null/—).
- Pit-transition, disconnected and missing-gap samples suppressed at write time; stale pruned at 300s;
  resets naturally by `race_run_id` + `opponent_id`.

## Edge ingest hook (non-fatal)

`supabase/functions/simhub-ingest-v3/index.ts` V3 dispatch: after a successful `simhub_persist_v3`,
if opponents exist and an active race run is present, it best-effort calls
`record_opponent_gap_samples(...)`. Any sampling error is caught and logged (option B); the response
to the connector is unaffected. This makes sampling UI-independent.

## RPC / read model

`get_pitwall_data` gains an optional bounded `opponent_trends` map:
```
opponent_trends: { "<id>": { closing_rate_s_per_min, sample_count, window_seconds } }
```
Same SECURITY DEFINER gate: staff / own-team only; cross-team + anon denied. No raw history or
device tokens returned. (Frontend types already consume this; server RPC injection is part of the
production phase plan.)

## Frontend

- `usePitwallData` reads `get_pitwall_data.opponent_trends` as the **production source of truth**.
- Client-side `OpponentHistory` is **DEV-only** (`import.meta.env.DEV`) diagnostics; it is never the
  production authority. Two competing live trend sources are avoided.
- `StandingsWidget` AHEAD/BEHIND shows trend in **s/min** (`+0.30 s/min` closing / `−0.20 s/min`
  opening) when reliable; `—`/no trend otherwise. Dense Focus Mode preserved.

## Tests / gates

- 66 tests / 11 files PASS (pitwall, closing rate, simHub connector/central-relay/plugin-ui/updater,
  opponent parsing).
- `tsc --noEmit` PASS; `npm run build` PASS; eslint clean (one pre-existing `(supabase as any)` line
  on main untouched).
- Connector source reconciliation: `simHubConnectorContract` 5/5, `simHubCentralRelay` 12/12
  (root cause: `V3IngestFunction` constant, test expected literal), `simHubPluginUpdater` 4/4
  (root cause: stale `release-signing-public.pem`; 0.3.0.1 artifact actually verifies with the
  canonical `3sm-simhub-release-public.pem` fixture), `simHubPluginUi` PASS (V3 strings).

## Source commit

- Branch: `feature/pitwall-0.4.3-server-closing`
- Commit: `4eaad6b` (17 files, +1102/-16)
- **Not merged to main / not deployed to production.**

## Production changes: NONE

- Production Pitwall remains 0.4.2. bridge/default = 0.4.0.0; canary/test = 0.4.1.0; stable
  baseline backup = 0.3.16.0. No SimHub/iRacing restart, no synthetic production telemetry.

## Production rollout plan (PHASE B — NOT executed here, next GO)

1. Production DB backup
2. Apply validated migration
3. Verify table/functions/policies
4. Deploy edge ingest hook (record_opponent_gap_samples hook)
5. Verify existing V3/0.4.1 ingest unaffected
6. Verify no history until real opponent data arrives
7. Deploy get_pitwall_data extension (opponent_trends)
8. Deploy frontend
9. Smoke Pitwall
10. Leave bridge/canary manifests unchanged
11. Observe naturally

## Rollback

Drop the table + 4 functions (as validated on the disposable DB); re-apply is safe.