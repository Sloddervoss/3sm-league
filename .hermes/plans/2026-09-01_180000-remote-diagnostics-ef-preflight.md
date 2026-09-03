# Remote Diagnostics v1 — E/F Production Preflight

> **For Hermes:** This is a read-only gap analysis. Do not deploy, migrate, publish, push, alter manifests, or enable Diagnostics on Beest without a separate explicit GO.

**Goal:** Bring only the already proven Remote Diagnostics backend/Edge implementation to production safely, then perform a guarded integrated E2E acceptance with the frozen 0.3.10.0 connector candidate.

**Frozen connector:** `release/simhub-0.3.10.0` at `a9c17e703d55117376fc205c0978b9e40016139c`; version `0.3.10.0`; DLL `323072` bytes; SHA-256 `379dc5d62728d0dd7b7cafcab4b42f8808b27fc8f4e97baac7f0f952761e8342`. Pre-UI safety tag: `fase-d-pass-527f067` → `527f0676cc1f370accedb48c69e319748a4ad6ee`.

**Architecture:** The connector is frozen and inert until it has a valid paired device token plus `UseCentralRelay=true` and `DiagnosticsEnabled=true`. The planned backend is on `fix/endurance-alpha-hardening`, not in the release candidate: diagnostics schema/RPCs, scheduled retention, and `simhub-diagnostic` Edge endpoint. Promote these as a deliberately scoped backend set; do not merge unrelated branch changes.

---

## Evidence and status

### Original plan phases E/F

| Original item | Status | Evidence |
|---|---|---|
| E: `ConnectorSettings.DiagnosticsEnabled` (default true) | DONE | Candidate has `DiagnosticsEnabled`; actual Beest setting ended `false`; current UI toggle `false → true → false` passed. |
| E: local UI exposure | DONE | Current 3-pane UI has checkbox in Koppeling; manual acceptance passed. |
| F: diagnostics unit tests | DONE | Current Windows/.NET Framework test run: 27/27 PASS (D01–D25, `DISABLE_TIMEOUT`, `UNPAIR_TIMEOUT`, `CONCURRENT60`). |
| F: client failure isolation | DONE | Timeout/401/403/429/500/connection tests passed; non-interference max gap about 1015 ms and max one diagnostics request in flight. |
| F: actual backend/Edge E2E | OPEN for production | Isolated Edge/DB E2E was proven on `fix/endurance-alpha-hardening` at `bde2144`; production is intentionally clean and has not been touched. |

### Production components

| Component | Repository state | Production state | Required before activation |
|---|---|---|---|
| Base diagnostics migration | `fix/endurance-alpha-hardening`: `supabase/migrations/20260831100000_remote_diagnostics_v1.sql` from `5344f46` | Not in frozen candidate / not to be presumed applied | Apply only this reviewed migration after live-schema preflight. |
| RPC matrix | `supabase/tests/diagnostics_v1_rpc_matrix.sql` | Not production-tested | Run against a disposable/transaction-rolled-back target first; after deployment prove narrow expected results. |
| Cron setup | `20260831110000_remote_diagnostics_v1_cron_setup.sql`, corrected at `6368f01` | Not applied | Apply only after base schema; verify exactly one schedule and function. |
| Cron cleanup function | `20260831110000_remote_diagnostics_v1_cron_cleanup.sql` | Not applied | Apply after base schema; verify function and job read-back. |
| Edge function | `supabase/functions/simhub-diagnostic/index.ts` | Not deployed | Deploy only after schema/RPC verification. |
| Connector | Frozen local candidate `a9c17e7` | Beest only; diagnostics disabled | Do not publish/roll out. Enable only for a guarded single-device E2E. |

## Required source invariants to preserve

- `simhub-diagnostic` is POST-only, bounded to 4 KiB, exact-key validates heartbeats/events, token-hashes the bearer token, checks token/device match, and rejects revoked devices.
- RPC return parsing uses the scalar JSONB shape `data?.result` for both `simhub_upsert_health` and `simhub_insert_diagnostic_event`.
- Error responses are allow-listed fixed codes; unknown exceptions log only error name and return `internal_error`, never a raw error message/body/token.
- Health is one latest row per device. Events have per-device retention and a DB-authoritative 10-second event cooldown; health has a DB-authoritative 55-second limit. Edge has an additional address limiter.
- Unbound valid devices are accepted by the migration/RPC; revoked devices are rejected.
- Connector telemetry remains independent from diagnostics; it must remain usable if Edge is offline, rejects data, or times out.

---

## Safe production order — requires explicit GO before step 1

### Task 1: Freeze and production preflight

**Objective:** Prove the exact backend source set and live baseline without changing it.

**Files to inspect:**
- `supabase/migrations/20260831100000_remote_diagnostics_v1.sql`
- `supabase/migrations/20260831110000_remote_diagnostics_v1_cron_setup.sql`
- `supabase/migrations/20260831110000_remote_diagnostics_v1_cron_cleanup.sql`
- `supabase/functions/simhub-diagnostic/index.ts`
- matching rollback files

**Checks:**
1. Confirm the production migration ledger contains none of the three diagnostics migration identifiers.
2. Dump/inspect only relevant existing `simhub_devices` shape, existing functions, and pg_cron availability/permissions.
3. Confirm no existing `simhub-diagnostic` function is deployed and no diagnostics cron job exists.
4. Re-run source integrity/checksum and isolated test evidence from the exact approved backend commits.

**Stop condition:** Any live schema collision, existing partial diagnostics object, or branch/source ambiguity blocks deployment until reconciled.

### Task 2: Apply base diagnostics schema migration

**Objective:** Create health/events tables, type, RLS, policies, RPCs, and indexes.

**Production impact:** First persistent production diagnostics objects; no connector traffic yet because no Edge route is deployed and Beest remains disabled.

**Checks after applying:**
1. Migration ledger has exactly the base migration identifier.
2. Tables, indexes, RLS, policies, grants, `simhub_upsert_health`, and `simhub_insert_diagnostic_event` exist exactly once.
3. RPC definitions use fixed search paths/expected service-role boundary where defined.
4. Run only safe verification requests/transactional tests; do not use real client tokens in terminal/logs.

### Task 3: Apply retention function and cron schedule

**Objective:** Ensure stopped devices’ old diagnostic events can be cleaned without new client activity.

**Order:** Cleanup function migration first, cron schedule migration second.

**Checks after applying:**
1. Cleanup function exists and deletes only records older than seven days.
2. Exactly one intended pg_cron schedule exists; no duplicate job.
3. Job SQL invokes only `public.simhub_cleanup_old_diagnostic_events()`.
4. No job is manually forced against live data during the first deployment.

### Task 4: Deploy `simhub-diagnostic` Edge function

**Objective:** Publish the isolated endpoint only after its data targets exist.

**Checks after deployment:**
1. Function version/source matches reviewed commit.
2. `OPTIONS` and non-POST behavior are correct.
3. Invalid/missing/revoked/mismatched device paths return privacy-safe fixed errors.
4. Oversized, malformed and unknown-key payload paths return expected 413/400/422 without raw details.
5. Verify scalar RPC parsing in production with a controlled valid canary request: `data.result` must produce accepted behavior.

### Task 5: Guarded integrated canary from Beest

**Objective:** Prove connector + deployed Edge + DB together without general rollout.

**Preconditions:** A disposable/revocable canary device pairing and an approved maintenance window. No live manifest, no public release, no other sim PC.

**Checks:**
1. Pair only the canary device, retain recovery/backup route, and start with diagnostics disabled.
2. Enable `DiagnosticsEnabled` only after all Edge/DB checks are green.
3. Observe one accepted heartbeat and one intentional state-transition event in the health/event targets.
4. Prove server health row fields (connector version, SimHub version, session-time status/value, sequence, diagnostic code, updater state) are allow-listed and current.
5. Verify server-side heartbeat/event rate limits, unbound semantics, revoked-device rejection and one recovery `OK` event.
6. Simulate/observe an Edge rejection or controlled timeout; telemetry sequence must continue and no diagnostics retry storm/deadlock appears.
7. Disable diagnostics again; verify client detaches safely, no further diagnostic traffic occurs, and Beest ends with `DiagnosticsEnabled=false`.

---

## Rollback order

1. **Immediate containment:** Disable diagnostics on the canary/Beest. This stops new connector-side diagnostics work without affecting telemetry/updater.
2. **Edge rollback:** Deploy the prior Edge state/remove the `simhub-diagnostic` endpoint. Verify the endpoint is no longer reachable before touching data objects.
3. **Cron rollback:** Remove the diagnostics cron schedule using `20260831110000_remote_diagnostics_v1_cron_setup.rollback.sql`.
4. **Cleanup-function rollback:** Drop only the diagnostics cleanup function using `20260831110000_remote_diagnostics_v1_cron_cleanup.rollback.sql`.
5. **Schema rollback:** Use `20260831100000_remote_diagnostics_v1.rollback.sql` only after Edge is removed and cron is disabled; it drops the two diagnostics tables, policies, RPCs, and diagnostic enum type.
6. **Read back:** Confirm no diagnostics function, cron job, table, type, or Edge deployment remains. Preserve the frozen connector candidate; do not roll it back unless its own telemetry/SimHub behavior is affected.

---

## Production acceptance matrix

| Area | Acceptance evidence |
|---|---|
| Schema/RLS | Tables/indexes/policies/RPCs present once; anon/authenticated writes denied; scoped privileged read behavior matches design. |
| Auth | Missing/bad/revoked token → 401; body device mismatch → 401; unbound valid device behavior matches approved semantics. |
| Input/privacy | POST-only; bounded body; exact keys; unknown fields → 422; no raw message, stack, payload or token in response/logs. |
| Health | Valid heartbeat → scalar `data.result=accepted`; latest health row updated once/device with correct allow-listed fields. |
| Events | Valid state-change event stored; 10-second DB cooldown; recovery `OK` exactly once after recovery. |
| Rate limits | Heartbeat server rate limit around 55 seconds; event rate limit 10 seconds; Edge address limiter; client backs off without direct retry. |
| Retention | Insertion cleanup + scheduled seven-day cleanup exist; schedule is singular and bounded. |
| Connector compatibility | Frozen candidate reports `0.3.10.0`; diagnostics disabled/no pairing sends no request; guarded enabled canary sends only expected calls. |
| Non-interference | During real endpoint timeout/reject/rate-limit, telemetry sequence remains continuous, no plugin/UI freeze, at most one diagnostics request in flight, no retry storm. |
| Rollback | Disable client → remove Edge → remove cron/function → schema rollback is documented and read-back verified. |

## Release blockers

- No explicit GO for production DB migration, cron installation, Edge deployment, or canary pairing.
- Diagnostics backend source is on `fix/endurance-alpha-hardening`, while the frozen connector is on `release/simhub-0.3.10.0`; promotion must be a scoped, reviewed source selection, never a broad branch merge.
- Production migration ledger/schema/Edge/cron state has not yet been read live in this preflight.
- Public 0.3.10.0 artifact/manifest/HUMAN ZIP rollout remains a separate later release decision after the integrated canary is accepted.
