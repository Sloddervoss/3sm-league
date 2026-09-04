# 3SM SimHub Telemetry — TEST Channel Workflow (canonical runbook)

Canonical operating policy for the rolling TEST fleet (0.4.0+). Stable 0.3.16.0 remains the
untouched safety baseline; all active development flows through a TEST channel consumed by
designated testers via the normal updater.

## Channel model

- **STABLE** = `SIMHUB_PLUGIN_*` (version 0.3.16.0). Served on a version check with **no**
  `?channel=`. Never changed by a TEST release.
- **TEST/canary** = `SIMHUB_PLUGIN_CANARY_*`. Served on a version check that requests
  `?channel=canary`. All six fields (version, dllUrl, sha256, byteLength, fileName, signature)
  must be non-empty or the endpoint falls back to stable (fail-closed).

Edge function: `supabase/functions/simhub-version/index.ts` (canonical, canary-capable).

| Request | Result |
|---|---|
| no channel / `?channel=stable` | stable manifest (`SIMHUB_PLUGIN_*`) |
| `?channel=canary` + complete canary config | canary manifest (`SIMHUB_PLUGIN_CANARY_*`) |
| `?channel=canary` + incomplete config | fallback to stable |

## What TEST means

**TEST = rolling tester channel, not a CAT-PC-only canary gate.** All designated 3SM testers
belong to the TEST fleet. Every tester who has been bootstrapped receives future TEST releases
automatically through the updater; every tester who naturally drives may contribute telemetry.
Vincent/CAT-PC is NOT the recurring manual validation bottleneck.

## Stable vs TEST policy

- Stable 0.3.16.0 is the proven baseline and rollback target. Do NOT promote a TEST release to
  stable without explicit Vincent approval.
- TEST releases are small, independently rollbackable increments (0.4.1 opponents, 0.4.2 Pitwall
  standings, 0.4.3 closing rate, …). Published to TEST channel only.
- Backend/storage stays compatible with stable V3 (0.3.16.0) and TEST V4 simultaneously;
  `v3_normalized` is null-tolerant jsonb.

## Legacy enrollment — temporary STABLE bootstrap bridge (zero-manual, STANDARD)

Legacy 0.3.16.0 testers send a **plain GET** version check (no device identity, no `?channel=`)
so server-side TEST enrollment of those installs is impossible. Enrollment is done via a
**temporary STABLE bridge** with NO manual DLL replacement:

1. **Safety gate:** audit all `simhub_devices` + owner roles; confirm no non-test/public user
   would receive the bridge. If any genuine public user exists → do NOT activate.
2. **Snapshot + rollback copy:** record stable + canary manifest; copy `docker-compose.override.yml`
   to `.pre-<bridge>`.
3. **Activate bridge:** set `SIMHUB_PLUGIN_*` (stable/default) to the exact verified TEST artifact
   (same as canary). All three channels temporarily reference the same package.
4. **Recreate `functions` service** + verify default/stable/canary match.
5. **Normal update flow:** each legacy tester opens SimHub; the updater delivers the TEST build
   through the default path. Tester becomes TEST-aware.
6. **Track completion via fresh last_seen** (heartbeat, not binding). Once all intended testers are
   on latest TEST, restore stable to 0.3.16.0; verify canary stays at latest TEST.
7. **Legacy chain:** `0.3.16 -> bridge 0.4.0 -> TEST-aware -> ?channel=canary -> latest TEST`.
8. **Keep bridge open** while legacy testers remain pending; restore only when all intended testers
   updated OR Vincent closes it.

**Late tester:** a legacy tester who missed the bridge returns → temporarily reopen the same
stable bridge, let them update normally, then restore stable again. Standard zero-manual method.

## No-manual-DLL-replacement policy

Never require manual DLL replacement as the standard flow. Testers receive TEST releases through
the normal updater lifecycle when they run. No per-release manual install. (Only individual
one-off manual replacement exists as archived fallback for a single machine where no bridge is safe.)

## Natural telemetry observation policy

- Do NOT require Vincent to drive for every release; do NOT restart SimHub/iRacing remotely.
- Observe centrally via Diagnostics/DB/RPC: per device version, protocol, last seen, updater
  success/failure, field coverage, ingest errors, stale/reset.
- Natural testers may not have produced telemetry yet → mark **NOT YET OBSERVED**. Never fabricate
  production data.
- Opponents / closing-rate / standings validation starts when any TEST user naturally enters a
  session. Until then: NOT YET OBSERVED (does not block the technical release).

## Rollback (TEST-only)

If a TEST release is bad: stop advancing TEST, then either publish a hotfix or restore previous
`SIMHUB_PLUGIN_CANARY_*` config + recreate `functions`. Installed TEST connectors are NOT
auto-downgraded; use the proven manual recovery path per affected tester. Stable rollback not
needed (stable never changes during TEST).

## Stable baseline preservation

Stable 0.3.16.0 manifest/config/artifact backup preserved at all times; it is only ever pointed
at a TEST artifact temporarily during a bridge and restored afterwards.