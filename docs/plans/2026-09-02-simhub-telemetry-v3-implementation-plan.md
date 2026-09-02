# SimHub Telemetry V3 Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add the frozen V3 telemetry contract, server-authoritative race-run continuity, bounded events, and server-derived endurance strategy without weakening V2, authority, privacy, or replay protections.

**Architecture:** V2 and V3 are independently strict-parsed and normalized into one internal DTO. Device identity and event/team/race-run routing remain server-authoritative. `transportSessionId` remains a source/replay boundary; a dedicated server-side race-run lifecycle owns logical endurance continuity across manual device handoff.

**Tech stack:** .NET Framework SimHub connector, Deno Supabase Edge Functions, PostgreSQL/Supabase migrations and RPCs, TypeScript/Vitest.

**Freeze source:** `docs/telemetry/simhub-telemetry-v3-design.md`.

---

## Global execution rules

- Work on a clean dedicated branch; do not mix existing worktree changes.
- Run every database test only against a disposable test database and verify its database identity first.
- V2 stays accepted throughout V3 rollout; strict V2 validation must not be weakened.
- No push, production migration, connector install, authority change, or deployment without an explicit future GO.
- Every schema migration has a matched rollback and an audit of unique increasing migration prefixes.

## Phase V3-A — Contracts, schemas and disposable parser tests

**Scope**

- Define V3 C# wire models beside existing `TelemetryContracts.cs` V2 models.
- Add exact V3 parser/schema and normalized internal DTO to `supabase/functions/_shared/simhub.ts`.
- Add equivalent frontend/read-model parsing only where V3 payloads can be read.
- Keep V2 exact-key validation separate and unchanged.

**Likely files**

- Modify: `tools/simhub-plugin/3SM.EnduranceConnector/TelemetryContracts.cs`
- Modify: `supabase/functions/_shared/simhub.ts`
- Modify: `src/lib/localSimHubBridge.ts`
- Modify: `src/test/simHubEnvelopeV2.test.ts`
- Create: `src/test/simHubEnvelopeV3.test.ts`
- Create/modify: shared parser tests under `supabase/functions/_shared/`

**Tests**

- V3 accepts only the frozen key set and types.
- V3 rejects unknown keys, NaN/Infinity, invalid timestamps, invalid ranges, raw integers for normalized enums, and client `raceRunId` fields.
- V2 accepts the current exact V2 contract unchanged.
- V1/V2/V3 normalize to one DTO with explicit null/unknown values.
- Sentinel tests: `SessionLapsRemainEx=32767 → null`; no fabricated remaining-time value.

**Rollback**

Revert only additive V3 parser/model files; V2 remains operational.

**GO gate**

Local parser parity and strict-rejection suite passes, reviewed against the frozen spec.

**Production impact**

None until a later Edge/connector release GO.

**Dependencies**

Frozen V3 spec only.

## Phase V3-B — Server-side race-run lifecycle and tests

**Scope**

- Add dedicated lifecycle storage equivalent to `endurance_race_runs`.
- Implement service/authorized server-side lifecycle operations: start, close, resolve active run.
- Enforce one active run per event/team/run-kind according to the frozen lifecycle rules.
- Ensure only active `run_kind=race` is eligible for endurance strategy.
- Do not use telemetry heuristics, connector values, restarts, swaps, or handoffs to create/close runs.

**Likely files**

- Create: forward migration and paired rollback under `supabase/migrations/` and `supabase/rollback/`
- Modify: generated types after validated schema change
- Create: SQL test matrix and disposable test runner under `supabase/tests/`
- Modify: narrow service-side ingest/routing helpers only after their contract is tested

**Tests**

- Authorized start/close and unauthorized denial.
- Immutable `raceRunId`.
- Practice, qualifying and race never auto-merge.
- No active run: latest/liveness can remain accepted but no race-run events/strategy writes occur.
- Connector restart and authority handoff do not create/close a run.
- A valid same-binding handoff resolves the active race run.

**Rollback**

Drop only lifecycle objects introduced by this phase; no deletion of existing telemetry/events.

**GO gate**

Disposable database matrix passes, including RLS/role denial and rollback/reapply.

**Production impact**

Additive schema only after a separate production migration GO.

**Dependencies**

V3-A normalized DTO contract.

## Phase V3-C — Connector V3 capture and serializer

**Scope**

- Capture only frozen V3 core fields.
- Rename local V3 meaning to `transportSessionId`; do not emit `raceRunId` or `gameSessionKey`.
- Preserve fail-closed nulling for invalid timing/position/session values.
- Exclude tyres and `fastRepairAvailable` from the V3 core.
- Ensure capture remains immutable and non-blocking.

**Likely files**

- Modify: `tools/simhub-plugin/3SM.EnduranceConnector/EnduranceConnectorPlugin.cs`
- Modify: `tools/simhub-plugin/3SM.EnduranceConnector/ConnectorSettings.cs`
- Modify: `tools/simhub-plugin/3SM.EnduranceConnector/TelemetryContracts.cs`
- Modify/create: `tools/simhub-plugin/3SM.EnduranceConnector.Tests/`

**Tests**

- Serialize exact V3 allowlist.
- Null/sentinel/range tests for timing, position, fuel and session remaining.
- Assert no owner/event/team/race-run authority is sourced from payload.
- Verify V2 serialization remains byte-contract-compatible.
- Windows SDK build and connector harness test.

**Rollback**

Connector stays on V2 transport; V3 serializer remains inactive/unreleased.

**GO gate**

Windows build, harness and source-contract suite all pass on the real SDK host.

**Production impact**

No install until the later controlled canary GO.

**Dependencies**

V3-A.

## Phase V3-D — Edge V3 parser and normalized DTO routing

**Scope**

- Dispatch strictly by protocol version.
- Normalize V2/V3 into the internal DTO.
- Resolve authenticated device, authoritative binding and active race run server-side.
- Reject client event/team/race-run claims.
- Keep existing replay/rate/session/authority ordering intact.

**Likely files**

- Modify: `supabase/functions/_shared/simhub.ts`
- Modify: `supabase/functions/simhub-ingest/index.ts`
- Modify: Edge-function tests and `src/test/simHubEnduranceIngest.test.ts`

**Tests**

- Exact HTTP/result mapping for V2 and V3.
- Device/body mismatch denial.
- V3 raceRun client claim rejection.
- V2 behavior regression suite.
- Isolated Edge runtime against guarded disposable DB.

**Rollback**

Deployable Edge rollback preserves V2-only parser behaviour; no authority mutation.

**GO gate**

Isolated Edge E2E, parser parity, authority/replay/rate-limit regressions pass.

**Production impact**

Future Edge release only; no DB/connector restart required.

**Dependencies**

V3-A and V3-B.

## Phase V3-E — Latest/event database path and V2 remediation

**Scope**

- Add V3-aware latest/event persistence without replacing `endurance_telemetry_events`.
- Add transport dedupe identity and monotone domain dedupe for completed laps/incidents.
- Implement handoff baseline/source-segment semantics.
- Classify V2 bug fixes deliberately:
  - `estimatedLapsRemaining` / `lapsRemainingEst`: **V3 normalization**, not standalone V2 hotfix, because V3 removes it as authoritative raw strategy input.
  - `lap_time_from_deltas_s` literal NULL: **V3 derived-engine phase**, not a V2 hotfix; do not fabricate a value before valid-lap rules exist.
  - incidents source: **V3 connector/normalization work**, not standalone V2 hotfix, to avoid divergent semantics.

**Likely files**

- Create: additive forward migrations and paired rollback
- Modify: `supabase/functions/simhub-ingest/index.ts`
- Modify: `supabase/functions/_shared/simhub.ts`
- Modify: `src/integrations/supabase/types.ts`
- Create: SQL event/handoff matrix under `supabase/tests/`

**Tests**

- Same source snapshot cannot duplicate an event.
- Recurrent yellow/pit/driver/repair states can write distinct valid transitions.
- `lap_completed` dedupes by `raceRunId + completedLaps`.
- incidents dedupe by `raceRunId + incident counter`.
- B-first handoff snapshot creates no cross-source synthetic event.
- V2 mapping regression tests prove no silent camelCase/snake_case null storage.

**Rollback**

Rollback drops only V3 additions and leaves existing V2 event data untouched.

**GO gate**

Disposable DB concurrency, rollback/reapply, authority-handoff and contract-key matrix passes.

**Production impact**

Future additive migration only after package audit, backup and separate production GO.

**Dependencies**

V3-B and V3-D.

## Phase V3-F — Derived strategy engine

**Scope**

- Derive strategy only from `raceRunId + eventId + teamId` and valid event history.
- Implement valid-lap detection, fuel delta, rolling fuel average, fuel laps remaining, fuel-to-finish, pit window and stint metrics.
- Preserve history through valid handoff, but mark output degraded until continuity validation succeeds.

**Likely files**

- Create/modify: server-side derived strategy helpers/RPCs
- Modify: narrow Race Control data-access DTOs
- Create: deterministic unit and disposable DB tests

**Tests**

- Valid versus invalid/pit/replay/session-boundary lap cases.
- Fuel added excluded from consumption calculations.
- Handoff preserves history but suppresses cross-source synthetic transitions.
- Inadequate continuity yields degraded/null strategy, never invented values.
- Wrong event/team/device read denial.

**Rollback**

Disable or remove derived read path; raw latest/events remain intact.

**GO gate**

Deterministic fixture matrix, privacy/RLS checks and manual strategy review pass.

**Production impact**

New server computation/read DTOs; no client-side authority change.

**Dependencies**

V3-E.

## Phase V3-G — Controlled CAT-PC canary

**Scope**

- Install only a frozen, audited V3 connector artifact after separate GO.
- Keep current manual authority model unchanged.
- Observe V2/V3 parity, accepted cadence, latest/event writes, diagnostics and source-segment handling.

**Tests**

- Pre/during/post ingest status and diagnostics.
- Sequence/replay/authority checks.
- No task scheduler, no probe scripts, no start/stop action by Hermes.
- Rollback to prior connector artifact only under an explicit operational rollback decision.

**Rollback**

Restore the pre-audited connector artifact manually under the established canary procedure; no loose DB updates.

**GO gate**

Local package audit, artifact hash/version, documented rollback handle and explicit canary GO.

**Production impact**

Single-device controlled canary only.

**Dependencies**

V3-A through V3-F.

## Phase V3-H — 10/20-device representative load test

**Scope**

- Use synthetic/disposable sources, not production device credentials.
- Measure 10 and 20 concurrent 1 Hz streams, parser/Edge latency, database writes, event dedupe, latest reads and worker capacity.

**Tests**

- 10 and 20 device sustained runs.
- Out-of-order/replay/rate-limit cases.
- Event transition burst and handoff baseline cases.
- Read DTO/RLS concurrency.

**Rollback**

Stop disposable load infrastructure; no production state is created.

**GO gate**

Measured capacity and error budget meet pre-agreed targets.

**Production impact**

None.

**Dependencies**

V3-D through V3-F.

## Phase V3-I — Deferred field-promotion tests

**Scope**

- Test one deferred field family at a time; no broad runtime discovery.
- Promote only after evidence, schema review and backward-compatible handling.

**Tests / gates**

- `lapDistancePct`: manual interactive desktop proof of movement, range and wrap.
- track surface and session state: exact raw-to-enum mapping proof.
- session remaining: limited/unlimited semantics proof.
- tyres: units, zone orientation, compound and stale-data semantics.
- fast repair: typed boolean semantics.
- `gameSessionKey`: stable source and false merge/split tests.

**Rollback**

Do not publish an unproven field. Remove only the isolated additive field implementation if later evidence invalidates it.

**GO gate**

Each field has its own evidence review and explicit promotion GO.

**Production impact**

Only the specific promoted field.

**Dependencies**

V3 core can ship without these promotions.
