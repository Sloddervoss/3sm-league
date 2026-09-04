# 3SM SimHub Telemetry — TEST Channel Workflow

Canonical operating policy for the rolling TEST fleet (0.4.0+). Stable 0.3.16.0
remains the untouched safety baseline; all active development flows through a TEST
channel consumed by designated testers via the normal updater.

## Channel model

- **STABLE** = `SIMHUB_PLUGIN_*` (version 0.3.16.0). Served on a version check with
  **no** `?channel=` param. Never changed by a TEST release.
- **TEST/canary** = `SIMHUB_PLUGIN_CANARY_*` (currently 0.4.0.0). Served on a version
  check that requests `?channel=canary`. All six fields (version, dllUrl, sha256,
  byteLength, fileName, signature) must be non-empty or the endpoint falls back to
  stable (fail-closed).

Edge function: `supabase/functions/simhub-version/index.ts` (canonical source, aligned
with the deployed copy at commit `2e7b5c2`). Selection logic:

| Request | Result |
|---|---|
| no channel / `?channel=stable` | stable manifest (`SIMHUB_PLUGIN_*`) |
| `?channel=canary` + complete canary config | canary manifest (`SIMHUB_PLUGIN_CANARY_*`) |
| `?channel=canary` + incomplete config | fallback to stable |

## STABLE vs TEST policy

- Stable 0.3.16.0 is the proven baseline and rollback target. Do NOT promote a TEST
  release to stable without explicit Vincent approval.
- TEST releases are small, independently rollbackable increments (0.4.1 = opponents,
  0.4.2 = standings, …). Each is published to the TEST channel only.
- Backend/storage must stay compatible with both the stable V3 (0.3.16.0) payload and
  the TEST V4 line simultaneously. `simhub_persist_v3` writes the full nullable
  `v3_normalized` jsonb; no DB migration is required for additive own-car fields.

## Version check request identity (bootstrap rationale)

The 0.3.16.0 connector sends a **plain GET** version check: no device ID, no auth
header, no `?channel=` param. Therefore **server-side TEST enrollment of those legacy
installs is impossible** — each eligible tester needs a **one-time bootstrap** to a
TEST-aware build (0.4.0.0+), after which the connector appends `?channel=canary` and
future TEST updates arrive automatically through the updater.

## TEST fleet enrollment

Designated testers (currently: CAT-PC online/eligible; DESKTOP-E2SEMRP, RICKY, BEEST
inactive → pending Vincent's decision; revoked devices NOT eligible). No silent
enrollment of unrelated users.

Once a tester is bootstrapped to 0.4.0.0 TEST:
1. their connector requests the TEST/canary manifest
2. the updater delivers later TEST releases automatically
3. no per-release manual install is needed

## Zero-manual enrollment — temporary STABLE bootstrap bridge (STANDARD method)

Preference: **no manual DLL replacement** on tester machines. To move legacy 0.3.16.0
testers onto 0.4.0+ TEST via the normal updater, use a temporary STABLE bridge:

1. **Safety gate first:** audit all registered `simhub_devices` + owner roles. Confirm
   NO non-test/public user would receive the bridge. If any genuine public/non-test
   user exists, do NOT activate — report BLOCKED.
2. **Snapshot + rollback copy:** record the current stable (0.3.16.0) and canary
   (0.4.0.0) manifest blocks; copy `docker-compose.override.yml` to a
   `.pre-<bridge>-bridge` backup.
3. **Activate bridge:** set the `SIMHUB_PLUGIN_*` (default/stable) block to the exact
   verified TEST artifact (same 0.4.0.0 package as canary). All three channels
   (default / `?channel=stable` / `?channel=canary`) must reference the identical
   hash/size/signature.
4. **Recreate only the `functions` service**, then verify default/stable/canary all
   return 0.4.0.0 and the download verifies.
5. **Normal update flow:** each legacy tester simply opens SimHub; the ordinary updater
   check delivers 0.4.0.0 through the default path. No manual copy, no iRacing drive.
6. **Track completion via fresh last_seen/version** (heartbeat, NOT binding/primary).
   Once all intended eligible testers are on 0.4.0+, restore stable to 0.3.16.0 and
   verify canary stays 0.4.0.0.
7. **Do NOT restore stable prematurely** while offline testers remain pending — keep the
   bridge open until all intended testers update OR Vincent closes it.

**Late tester rule:** a legacy tester who misses the bridge returns later → temporarily
reopen the same stable bridge, let them update normally, then restore stable again.

**BEEST proof (2026-09-04):** one-time manual bootstrap proved the TEST-aware updater
(the connector loaded 0.4.0.0, DLL locked by running SimHubWPF, subsequent checks
request `?channel=canary`). That machine is COMPLETE and must not be manually re-touched.

> Archive (only used if a bridge cannot be used): one-time manual DLL replacement —
> download `3SM.EnduranceConnector-0.4.0.0.dll`, verify SHA-256
> `e620dc83a8d7adc483d5ba8f79ce419896971730e974097921d805a638ef5f38` (334848 bytes),
> replace `C:\Program Files (x86)\SimHub\3SM.EnduranceConnector.dll` with SimHub closed,
> restart SimHub. Only for an individual machine where no bridge is safe.

## Update / observe behavior

- Do NOT restart SimHub or iRacing remotely.
- Testers receive TEST releases through the normal updater lifecycle when they run.
- Observe centrally via Diagnostics/DB/RPC: per device version, protocol, last seen,
  updater success/failure, telemetry field coverage (session clock, lapDistancePct,
  best/current lap), ingest errors, stale/reset.
- Natural testers may not have produced telemetry yet — mark **NOT YET OBSERVED**.
  Never fabricate validation.
- **0.4.1 opponents:** each TEST device emits a bounded (≤40) opponent snapshot per tick.
  Validation starts only when a TEST user naturally enters a session with opponents; report
  per session opponent count, identity stability, position/class/lap-dist/gap/lap-timing
  coverage, pit status, stale cleanup, ingest errors. Until then: NOT YET OBSERVED.

## Rollback (TEST-only)

If a TEST release is bad: stop advancing TEST, then either publish a hotfix, or restore
the previous `SIMHUB_PLUGIN_CANARY_*` config and recreate the `functions` service.
Already-installed TEST connectors are NOT auto-downgraded; use the proven manual
recovery path per affected tester. Stable rollback is not needed (stable never changed).