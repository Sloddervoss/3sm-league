# S2E4 focused local latency/typecheck repair

Scope: local source/test/harness only. No migration, deployment, release, SDK
upgrade, frontend, bot, producer, updater or configuration change to production.
The prior S2E3 performance FAIL is retained, not reclassified.

## Runtime change and invariants

The actual V3 caller starts its existing bounded, read-only policy composer only
AFTER `simhub_persist_v3` returns accepted, then joins it before the 202. That read
can overlap the existing best-effort lap/tyre/opponent writes. It is not moved
before core authentication or persistence. Existing SQL capture authorization at
write time is unchanged. The composer still uses the validated token hash, never
payload device/owner/hash; no authorization cache or new TTL/protocol was added.
Default off makes zero policy/probe calls; errors, missing RPC, malformed results,
timeout and late rejection remain fail-closed. The lookup deadline remains 750ms.
History writes and their ordering relative to core ingest are unchanged.

The fixed cached SDK uses thenables, not full Promises. `TelemetryContextClient`
expresses that contract and the actual entry adapts the SDK through a small typed
boundary to avoid excessive structural generic instantiation. PACE extension
entries receive an explicit `[string, unknown][]` tuple type, preserving all live
nullable/unknown-key behavior without a cast to `any` or compiler suppression.
The clean repository PACE helper was byte-identical to OLD's captured candidate
before repair; only the exact changed helper is overlaid.

## Diagnosis and evidence boundaries

Private evidence root:
`/home/hermes/artifacts/3sm/pitwall-learning-p2-latency-repair-20261114`

`DIAGNOSTIC-before*`, `ORDERING-*`, `DIAGNOSIS.json` are explicitly non-acceptance.
They measure real internal HTTP hops and SQL statement deltas with sandbox-only
fetch tracing. The first probe found one additional policy RPC/frame, median
4.7ms, not a demonstrated 50ms SQL regression. Both Edge arms were CPU-throttled.
A fixed one-hypothesis serial-versus-overlap diagnostic holds typed source,
workload and budgets constant except the scheduling change. Its small tails are
descriptive and sequential-stage noise remains a confound. It establishes the
avoidable dependency and actual overlap, not exclusive causality for the old
aggregate p95 failure. No SQL amendment is justified by this evidence.
Instrumentation is absent from shipped source and restored lab source; actual
in-container TS hashes are checked separately in `RUNTIME-BYTE-PROOF.json`.

`ENTRY-TYPECHECK.json`, `REGRESSIONS.json`, `SERIAL-CONTROL.json`,
`functional-smoke.json`, `functional-feature-on.json`,
`FUNCTIONAL-CHANGED-PERMISSIONS.json`, `FUNCTIONAL-AUTHORITY.json`,
`WRITE-TIME-RACES.json`, and `PATH-ACL.json` hold command/results or raw request
and response evidence. The actual-entry runtime test uses the cached SDK with
fetch replaced and no network permission; it is not a substitute for HTTP tests.
The type-fixed old serial-order control must fail the new ordering assertion.

## One fixed acceptance run

Use `scripts/pitwall-learning/s2e4/experiment.py register` only after the logical
source/test/harness commits and a clean working tree. It creates a fresh isolated
benchmark device and freezes actual source SHA, captured live baseline, schema,
config, runtime budgets, runner/control hashes, dataset and roles before timing.
`NEWREGISTERED-BENCHMARK.json` and its SHA are authoritative. `execute` runs once;
`validate` recomputes without sending requests. No unchanged favorable retry.
The workload/statistic/gate remains S2E3's: 40 warmups and 200 measured pairs,
ABBA, serial fetch-to-full-body, 196 ordinary hot + two fresh legacy + two fresh
observed laps per measured arm. Completion spacing 700ms / global 600ms respects
the 400ms device floor. Both strict gates remain <=10% AND <=20ms, unrounded.
The final measured verdict is recorded in the private `REPORT.md` and
`BENCHMARK-RESULT.json`; do not infer it from a script's exit status.

`audit.py disable` applies the approved paired safe-disable rollbacks, verifies
retained data digests/closed switches/ACLs, exercises legacy V1/V2/V3 HTTP, turns
the candidate lab Edge flag off and records exact retained own handles. This is
not byte restoration. No WAN/CDN/TLS or production-load claim; clone component,
role and publication qualifications from S2E3 remain. No all-nonroot claim.

## Review risk matrix

| Material change/risk | Required evidence |
| --- | --- |
| Lookup overlaps history after core success | actual-entry regression, negative serial control, real hop trace |
| Forged device/owner/hash | runtime adversarial case, authority HTTP readback, observed-row device mismatch |
| Permissions/revocation change during write | locked-device real HTTP races, private capture counts |
| Error, timeout, late result/rejection | runtime regressions + actual missing/error RPC matrix |
| Default off, V1/V2/V3, replay | actual HTTP smoke/matrix and zero-call deltas |
| Compiler contract + inherited PACE bytes | full cached candidate entry check; provenance + runtime cases |
| Latency claim | preregistration, all raw inputs/responses, mechanical recomputation and write counts |
| Resource isolation/provenance | exact current handles, namespace/image/mount/network checks; any historical ledger gap stays qualified |

Source is frozen for ONE independent SPEC-first/QUALITY-second review after the
report. This document does not claim that review occurred or grant release GO.
Backend/API is affected as above; no DB DDL changes. Frontend/bot/deployment:
geen impact verwacht. Auth/roles: contracts preserved, exercised locally.
