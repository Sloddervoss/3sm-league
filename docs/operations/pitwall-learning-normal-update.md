# Pitwall learning — normal update 0.7.6.3

Authority: Vincent's complete normal-update GO, Discord `1571219534478708778`
(14 November 2026). Personal first; no new cross-account training pool, separate
plugin, canary programme or re-pairing requirement. Existing credentials,
updater/signing trust, ACK/outboxes and three plugin panels are preserved.

## Implemented chain

- Existing update → automatic observation mode for missing legacy settings;
  explicit local disable and existing server-policy refusals remain respected.
- Sampled SDK tow/reset/clock continuity supplies v2 fuel-quality evidence.
  Unknown v2 facts never become false; safe tails cannot repair unknown intervals.
- Authenticated ingestion accepts optional v2 observations and captures immutable
  P1 revisions. P1 history stays non-training/as-of-unverifiable.
- Restricted worker records its first visibility, forecasts a not-yet-started
  full lap, and labels only a later exact owner/device/context/session/lap match.
- Actual executable consumes the bounded queue, fits the deterministic personal
  fuel candidate, stores an immutable manifest and activates its deployment.
- The authenticated device reader and additive team reader verify current
  policy, source/context, model hash/version, freshness and model expiration.
  Team lookup delegates to the same ownership/admin gate: it does not share
  another member's personal model merely because they belong to the same team.
- Normal endurance route: `PitwallTab` → `usePitwallData` / repository → separate
  optional learning query → `usePitwallStrategy` → snapshot → `advise`.
  The device sandbox is also connected, but is not the acceptance surface.
  Missing, denied, malformed, stale or nonresponding learning stays baseline.

The required quality facts are the explicit sampled v2 `fuelQuality` fields.
Legacy optional lap bookkeeping may be omitted by the actual serializer/P1 null
projection. Its absence is not evidence; supplied contradictory values reject.
The canonical C# serializer → real Edge parser → real service-role batch writer
→ private projection → strict qualification replay verifies this boundary.

## Candidate/serving contract

`personal-fuel-v1`, `previous-complete-lap-v1`: at least 100 qualified examples,
20 independent chronological session groups, 10 train / 5 calibration / 5 test
sessions. MAE improves at least 10%, mean underprediction does not worsen;
held-out interval coverage at least 90%, full width at most 20% of median
prediction, ratio drift at most 10%. Models expire after seven days.
These are eligibility checks, not claims of driving accuracy. Existing reserve
and finish policies remain; a learned upper bound never lowers measured fuel.

## Frozen executable artifacts

- Plugin source: `843c8a0097d537ce1b2eaa6f70c82cccd09749c7`; later backend/frontend
  commits leave the plugin subtree byte-identical. Actual full Windows vendor
  Release build: 49 compile inputs, embedded updater verified, production key
  preserved, test define absent. Installed/Desktop DLLs unchanged by compilation.
- DLL: `3SM.EnduranceConnector-0.7.6.3.dll`, 880128 bytes,
  SHA-256 `9e3d9cfcdd2a779c73315a9ca1385d624ae6eea7496a7d34d964ac76b6ede220`.
- Worker immutable image:
  `sha256:e93a4b051ed33abe074bcc964f26b0d2d3ebdc64a27eb232e62df2bc5f8f05ca`.
  Source inventory SHA-256:
  `b77f2c555782a0f62d43c6f69ef4aada11a685b3576395ea028d59c213571633`.
  Run non-root/read-only, 256 MiB, 0.25 CPU, 64 PIDs, no bind mounts or ports.
  Deployment template: `deploy/pitwall-learning.compose.yml`; protected connection
  env remains outside Git and uses only the dedicated worker role.

## Executed evidence (not live driving)

Private root: `/home/hermes/artifacts/3sm/pitwall-learning-normal-update-20261114/`.
The guarded PG15 fixture uses captured real table/function dependencies, not
production records; it is not asserted to be a complete production-schema clone.

- Real elapsed-time prospective forecast → later label, plus refusal/idempotency.
- Final image with a filled synthetic queue, real fitting and active model,
  real forecast and later label, normal team reader → strategy (2.5 to 3 L/lap).
  Its initial 100 examples/20 sessions are synthetic test vectors, not real laps.
- C# serializer replay uses explicit equal timestamp translation and isolated
  UUID substitutions; other serializer fields go through the actual Edge parser.
- Actual normal React component/hook/strategy tests cover permitted contribution,
  absence, denial, context mismatch, never-answering query and stale telemetry.
- Automatic enrollment preserves refusal rows and does not enroll old clients.
- Bounded retention contract exercised, with original source guard retained.
- Package typecheck has the exact same 16 diagnostics as the pinned base, no new
  diagnostics. Targeted lint/tests and frontend build are separately recorded.

## Deployment and rollback

Production publication remains OPEN until the actual supported old→new device
update is verified. Build-only is not installed/runtime evidence. Do not start
SimHub through SSH without permission; simulator control is outside this scope.

Before writes, refresh live object/ACL conflicts and drift, record exact forward
and paired rollback hashes, and verify a restricted backup. The ten named
`pitwall_learning` migrations belong to this package, not a general backlog sweep.
Apply schema/contracts first with switches closed, then compatible Edge bytes,
worker role/immutable service, consumer frontend and approved runtime flags.
Publish the verified versioned DLL/ZIP and signed normal manifest coherently.
No new optional endpoint may become an updater or core-telemetry prerequisite.

Stop the dedicated worker and disable capture/worker/shadow/advice/enrollment
before reverse-order paired rollbacks. These are data-preserving safe-disable
amendments, NOT zero-diff schema restoration. Retain immutable source/model
provenance and additive structures; never delete evidence to make rollback pass.
Transport/job retention is seven days, compact evidence/examples 180 days,
forecast/evaluation records 90 days, and retired model metadata 90 days.

The preceding sections record pre-publication local proofs, not the current live
state. Deployment and the actual normal 0.7.6.2 → 0.7.6.3 device upgrade are recorded
in `2026-11-15-simhub-0.7.6.3-publication.md`. That execution record distinguishes
successful installation/heartbeat and separately rendered installed-DLL panels
from the still-open in-app UI and fresh-driving-telemetry gates. Driving accuracy
must never be inferred from synthetic fixtures.
