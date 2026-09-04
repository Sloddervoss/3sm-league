# 3SM Telemetry V4 — 0.4.0 TEST Release

Date: 2026-09-04

## Version / artifact

- Version: **0.4.0.0** (TEST/rollingen kanaal)
- Branch: `release/simhub-0.4.0.0-test`
- Commits: `932b462`, `1583f5b`, `d912731` (head `d912731`)
- Package: `3SM.EnduranceConnector-0.4.0.0.dll`
- Size: **334848 bytes**
- SHA-256: **`e620dc83a8d7adc483d5ba8f79ce419896971730e974097921d805a638ef5f38`**
- Signed with canonical key `~/.hermes/keys/3sm-simhub-release-private.pem`; public-key
  signature verification: **PASS** (`Verified OK`)
- Build: 0 errors / 0 warnings; no test key; embedded production key `623ziGD` present;
  embedded updater present.

## Scope (small, additive)

- **V4/version foundation:** connector appends `?channel=canary` on the version check
  (build-time `ReleaseChannelQuery` constant) so TEST builds select the TEST manifest.
- **Own-car field population** in `CaptureV3` (existing nullable V3 fields, null-tolerant):
  - `session.timeRemainingSeconds`
  - `session.lapsRemaining`
  - `timing.currentLapElapsedSeconds`
  - `timing.bestLapTimeSeconds`
  - `track.lapDistancePct`
- Sentinel normalization (604800s / 32767 laps / timing [0,-1] → null) so the output
  always satisfies the V3 schema.
- **NOT included:** opponents, tyres, standings, closing rate, track-map opponents.

## Channel endpoints (verified after publish)

| Endpoint | Version | SHA-256 |
|---|---|---|
| default / `?channel=stable` | **0.3.16.0** | `92ef0919…f80f1d01e` (333824 B) |
| `?channel=canary` | **0.4.0.0** | `e620dc83…638ef5f38` (334848 B) |

Stable manifest/config untouched; canary manifest updated to 0.4.0.0 only. Compose
validation PASS; only the `functions` (edge) service was recreated.

## Bootstrap requirement

Legacy 0.3.16.0 testers send a plain version check (no identity, no channel) → **server-side
enrollment impossible**. Each eligible tester needs a **one-time bootstrap** to 0.4.0.0 TEST
(see `telemetry-test-channel-workflow.md`), after which future TEST updates flow automatically.

## Fleet state (publish time)

| Device | Status | Eligible TEST | Bootstrap |
|---|---|---|---|
| CAT-PC | active_binding / primary | YES | PENDING (first available) |
| DESKTOP-E2SEMRP | inactive | pending decision | PENDING |
| RICKY | inactive | pending decision | PENDING |
| BEEST | inactive | pending decision | PENDING |

Revoked devices are NOT re-enabled automatically.

## Stability

- Stable 0.3.16.0 unchanged.
- No SimHub/iRacing restart performed.
- No device installed in this release (manual bootstrap deferred to next GO).
- No DB migration required (additive nullable fields; V3 remains accepted).