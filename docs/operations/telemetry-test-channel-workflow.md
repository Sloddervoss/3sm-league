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

## One-time bootstrap method (not executed in-channel)

For an eligible tester currently on 0.3.16.0:

> **Close SimHub on that tester PC.** Then perform the one-time TEST bootstrap:
> download `3SM.EnduranceConnector-0.4.0.0.dll` from
> `https://3stripemotorsport.cc/downloads/3SM.EnduranceConnector-0.4.0.0.dll`,
> verify SHA-256 `e620dc83a8d7adc483d5ba8f79ce419896971730e974097921d805a638ef5f38`
> (334848 bytes), replace `C:\Program Files (x86)\SimHub\3SM.EnduranceConnector.dll`,
> then start SimHub. The updater uses only the versioned DLL under the canonical name.

After that one install, the connector version is 0.4.0.0, it requests
`?channel=canary`, and all subsequent TEST updates flow through the updater.

## Update / observe behavior

- Do NOT restart SimHub or iRacing remotely.
- Testers receive TEST releases through the normal updater lifecycle when they run.
- Observe centrally via Diagnostics/DB/RPC: per device version, protocol, last seen,
  updater success/failure, telemetry field coverage (session clock, lapDistancePct,
  best/current lap), ingest errors, stale/reset.
- Natural testers may not have produced telemetry yet — mark **NOT YET OBSERVED**.
  Never fabricate validation.

## Rollback (TEST-only)

If a TEST release is bad: stop advancing TEST, then either publish a hotfix, or restore
the previous `SIMHUB_PLUGIN_CANARY_*` config and recreate the `functions` service.
Already-installed TEST connectors are NOT auto-downgraded; use the proven manual
recovery path per affected tester. Stable rollback is not needed (stable never changed).