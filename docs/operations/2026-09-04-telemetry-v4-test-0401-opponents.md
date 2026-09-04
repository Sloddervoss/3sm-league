# 3SM Telemetry — 0.4.1 TEST Opponent Snapshot Release

Date: 2026-09-04

## Version / artifact (TEST/canary)

- Version: **0.4.1.0** (TEST/rolling channel)
- Feature branch: `feature/simhub-0.4.1-opponents`
- Source-of-truth commit: **`9b3124f`** (pushed)
- Package: `3SM.EnduranceConnector-0.4.1.0.dll`
- Size: **340480 bytes**
- SHA-256: **`e372a83fe25a76239207e4a346d41a8a8abf639b63a58070d2e78d99d80081f2`**
- Signature: canonical key (`~/.hermes/keys/3sm-simhub-release-private.pem`), openSSL verify **PASS**

## Endpoint split (verified after publish)

| Endpoint | version | SHA-256 | bytes |
|---|---|---|---|
| default (bridge) | 0.4.0.0 | `e620…f38` | 334848 |
| `?channel=stable` (bridge) | 0.4.0.0 | `e620…f38` | 334848 |
| `?channel=canary` (TEST) | **0.4.1.0** | `e372…81f2` | 340480 |

Intentional: legacy 0.3.16.0 testers enter via `0.4.0` bridge, become TEST-aware, then their next
check reaches `0.4.1` via canary. Bridge NOT closed; stable baseline 0.3.16.0 backup preserved.

## Opponent schema (additive under V3 envelope `opponents`)

Per opponent (bounded, null-tolerant):
`id*` (identity key) · `carNumber` · `driverName` · `teamName` · `carClass` · `carClassId` ·
`position` · `classPosition` · `lap` · `lapDistancePct[0,1]` · `gapToPlayerSeconds` ·
`gapToLeaderSeconds` · `lastLapSeconds` · `bestLapSeconds` · `inPit` · `speedKph` ·
`connected` · `isPlayer`
(*) `id` required; from `Opponent.Id` (stable per car in session), not driver display name.

## Bounds

- **Cap = 40** (connector `MaxOpponentsPerSnapshot`, backend `MaxOpponentsPerSnapshot=40` both).
- Payload estimates (compact): ~6–8 KB / 20 cars · ~12–16 KB / 40 cars · ~19–24 KB / 60 cars
  (if cap raised). Hard bounded; array > cap rejected.
- NaN/Infinity/out-of-range → reject; iRacing sentinels (-1/0/604800/32767) → null.

## Backend

- Connector emits optional `opponents`; backend normalizer (`_shared/simhub.ts`) accepts it via
  `exactKeysAllowExtra`; parser in `_shared/opponents.ts` (framework-free, unit-tested).
- **No DB migration** — opponents persist in `simhub_telemetry_latest.v3_normalized` jsonb
  (`buildV3LatestRow` writes the whole envelope). V3/0.4.0 payloads without opponents remain valid.
- `get_pitwall_data` returns `v3_normalized` under existing staff/team isolation; no cross-team
  leak, no secrets.
- Deployed files byte-identical to committed sources (verified).

## Tests (committed with `9b3124f`)

- `src/test/simHubV3Opponents.test.ts` — 7: compat (opponents null), parse, cap-40 reject,
  id-reject, NaN/Inf/out-of-range, sentinels→null, exactKeysAllowExtra unknown-key reject.
- All simhub/endurance suites green (29 PASS in the 0.4.1-relevant set); `tsc --noEmit` PASS.

## Fleet / natural observation

- BEEST: TEST-aware on 0.4.0.0 (installed). Natural 0.4.1 discovery via canary: **NOT YET OBSERVED**.
- CAT-PC (~23h last seen), DESKTOP-E2SEMRP (~46h), RICKY (~477h): legacy/pending, still entry via
  0.4.0 bridge → canary 0.4.1.
- Natural opponent data: **NOT YET OBSERVED** (no TEST user has entered a session with opponents).
  Not a release failure.
- No synthetic telemetry created. No SimHub/iRacing remote restart.