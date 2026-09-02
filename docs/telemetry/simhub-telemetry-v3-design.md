# SimHub Telemetry V3 Design — FROZEN

> **Status:** TELEMETRY V3 DESIGN FROZEN — READY FOR IMPLEMENTATION PHASE A
>
> This is an architecture freeze, not an implementation, migration, connector build, or deployment authorization.

## Scope and confidence

`PROVEN` means runtime-observed on CAT-PC. `SOURCE-PROVEN` means an SDK/property source exists with known intended semantics, but relevant dynamic runtime behavior is not fully proven. `EXPERIMENTAL` is insufficiently proven and excluded from the frozen core.

The frozen core is intentionally compact. It excludes tyres, `fastRepairAvailable`, `gameSessionKey`, raw SessionInfo/DriverInfo, generic XYZ/GPS, live hot tyre pressure, and generic damage percentage.

## V3 strict wire contract

Every V3 payload has an exact per-version allowlist. No unknown keys, non-finite numbers, invalid timestamps, impossible numeric ranges, raw object trees, or client-selected authority fields are accepted.

```json
{
  "protocolVersion": 3,
  "sequence": 12345,
  "capturedAt": "2026-09-02T14:35:00.000Z",
  "transportSessionId": "connector-session-guid",
  "identity": {
    "currentDriverId": "string-or-null",
    "currentDriverName": "string-or-null",
    "carId": "string-or-null",
    "carName": "string-or-null",
    "trackName": "string-or-null",
    "trackConfig": "string-or-null"
  },
  "session": {
    "isInCar": true,
    "sessionTimeSeconds": 1234.56,
    "sessionTimeRemainingSeconds": null,
    "sessionLapsRemaining": null,
    "flags": ["green"],
    "sessionState": "unknown"
  },
  "timing": {
    "currentLapElapsedSeconds": null,
    "lastLapTimeSeconds": null,
    "bestLapTimeSeconds": null
  },
  "position": {
    "position": null,
    "classPosition": null,
    "gapToLeaderSeconds": null
  },
  "track": {
    "lapDistancePct": null,
    "trackSurface": "unknown",
    "onPitRoad": false
  },
  "fuel": {
    "fuelLitres": 52.67,
    "fuelPct": 0.48
  },
  "raceState": {
    "incidents": 0
  },
  "pitService": {
    "pitServiceFlagsRaw": null,
    "requiredRepairSeconds": null,
    "optionalRepairSeconds": null
  }
}
```

### Fields, types and confidence

| Field group | Type / unit | Confidence |
|---|---|---|
| `transportSessionId` | non-empty string | PROVEN |
| current driver/car/track identity | `string \| null` | PROVEN |
| `isInCar` | boolean | PROVEN |
| `sessionTimeSeconds` | finite seconds or null | PROVEN |
| `sessionTimeRemainingSeconds` | finite seconds or null | SOURCE-PROVEN |
| `sessionLapsRemaining` | integer or null | SOURCE-PROVEN |
| timing values | positive finite seconds or null | SOURCE-PROVEN |
| positions | positive integer or null | SOURCE-PROVEN; class source PROVEN |
| `gapToLeaderSeconds` | finite seconds or null | SOURCE-PROVEN |
| `lapDistancePct` | finite number in `[0,1]` or null | SOURCE-PROVEN |
| `trackSurface` / `sessionState` | strict normalized enum | SOURCE-PROVEN |
| `onPitRoad` | boolean or null | PROVEN |
| `fuelLitres` | non-negative litres or null | PROVEN |
| `fuelPct` | fraction `[0,1]` or null | PROVEN |
| incidents | non-negative integer or null | SOURCE-PROVEN |
| `pitServiceFlagsRaw` | integer or null; raw SDK bitfield | PROVEN |
| repair timers | non-negative seconds or null | PROVEN |

`0`, `-1`, SDK sentinels, non-finite values, and session-state-invalid values normalize to `null` where the field is nullable. `SessionLapsRemainEx = 32767` normalizes to `null`. `SessionTimeRemain` is only emitted after a validated limited-session interpretation; `604800` must not be presented as an exact seven-day race countdown merely because it is finite.

### Strict enums

```ts
type RaceFlag = "green" | "yellow" | "red" | "white" | "checkered" | "blue" | "black" | "meatball" | "disqualify";
type SessionState = "not_in_world" | "warmup" | "parade_laps" | "racing" | "checkered" | "cool_down" | "unknown";
type TrackSurface = "on_track" | "off_track" | "in_pit_stall" | "approaching_pits" | "not_in_world" | "unknown";
```

`flags` is `RaceFlag[] | null`: `[]` means a source was read but no allowlisted flag is active; `null` means normalization is not trustworthy. Raw SessionFlags and raw track-surface integers never cross the wire. Only proven mappings may emit existing enum values. New enum values require contract review and backward-compatible handling; unknown mappings are `unknown` or `null`.

## Authoritative identity, transport and race continuity

The authenticated device identity is derived only from the bearer token and server-side device lookup. The client body never decides device owner, device authority, event, team, or `raceRunId`.

`transportSessionId` scopes sequence and replay protection for one connector/device transport session. It may change on connector or game restart.

`raceRunId` scopes logical endurance continuity. It is a server-authoritative, immutable ID in dedicated lifecycle storage such as `endurance_race_runs`, with at least `event_id`, `team_id`, `run_kind` (`practice | qualifying | race`), lifecycle status, `started_at`, `ended_at`, and server-controlled creation/closure.

- Only an explicit, authorized server-side start creates a run.
- Only an explicit server-side lifecycle action closes a run.
- Connector restart, driver swap, authority handoff, or a telemetry timeout never starts or closes a run.
- Only an active `run_kind = race` participates in endurance strategy.
- If telemetry arrives later for the same binding and no active run exists, latest/liveness may update but no race-run event/history/strategy is derived.
- A valid authority handoff for the same binding resolves to and continues the active race run.
- `gameSessionKey` remains EXPERIMENTAL and is not in the wire; no heuristic automatic game-session detection is allowed until a stable source is proven.

Current driver is independent from account owner and device authority. A driver swap never changes authority.

## Handoff reconciliation and continuity

For `A primary → atomic server-side handoff → B primary`:

1. A immediately loses accepted ingest authority after commit.
2. B's first accepted snapshot is stored as a new source segment and reconciliation baseline.
3. Differences from A-last to B-first create no synthetic lap, pit, fuel, driver, flag, tyre, or repair transition event.
4. Normal transition detection begins only from B-first to B-next.
5. Prior race history is retained, but strategy is `degraded` until continuity validation succeeds.

Minimum continuity inputs are same active `raceRunId`, same authoritative event/team binding, compatible identity when both present, compatible session/race state when present, and plausible completed-laps, session-time, and fuel continuity. Exact thresholds are not frozen without source proof. Insufficient evidence fails closed: retain history, do not synthesize events, and keep derived strategy degraded.

## Event model and idempotency

Events remain in the existing `endurance_telemetry_events` layer; no replacement telemetry-events base table is introduced.

Transition-driven events include `lap_completed`, `pit_entry`, `pit_exit`, `pit_service_started`, `pit_service_completed`, `fuel_added`, `tyres_changed`, `driver_changed`, `incident_count_changed`, `flag_changed`, and `repair_state_changed`.

Transport dedupe identity for an event detected from an accepted source snapshot is conceptually:

```text
raceRunId + sourceDeviceId + transportSessionId + sequence + eventType
```

It prevents a retry of the same accepted source snapshot from writing the same event twice.

Domain uniqueness is additional and only used for monotone domain keys:

```text
lap_completed:         raceRunId + completedLaps
incident_count_changed: raceRunId + incidentCounterValue
```

Do not use permanent state uniqueness such as `raceRunId + yellow`, `raceRunId + pit_entry`, or `raceRunId + driver_changed`; these states and transitions may recur legitimately. The first snapshot of a new authority source is baseline only and has no cross-source transition comparison.

## Raw versus derived data

Raw core: fuel level/fraction, nullable timing, position/class position, track/pit state, flags/session state, incidents, and repair timers.

The server derives, per `raceRunId + eventId + teamId`: fuel per valid lap, rolling fuel average, fuel laps remaining, fuel to finish, pit window, stint averages, lap history, and supported gap presentation. Never treat `fuelPerLapLitres` or estimated fuel laps as authoritative raw values.

## Tyres and slow-data policy

Tyres are not frozen core. A future additive tyre block must carry its own `sampledAt`; absent means no new slow sample and must never clear last-known tyre data. `tyres: null` is not used for this purpose.

Future tyre zone names remain `left`, `middle`, `right`, not `inner/middle/outer`, until a wheel-aware orientation normalization is proven. Temperature, cold-pressure, odometer units, tyre compound, and all tyre wire fields remain deferred. Any cold-pressure extension must label data `garage_cold_only`; no live hot-pressure claim is permitted.

`fastRepairAvailable` is excluded from core until its integer source has proven boolean semantics.

## Cadence and compatibility

Baseline ingest remains approximately 1 Hz. The core stays compact; a later tyre extension is lower cadence and explicit about `sampledAt`. Latest storage is latest-only; events are transitions plus bounded samples, never raw frame history.

V2 and V3 use separate strict allowlists and normalize into one internal DTO. V2 remains accepted during an additive migration. V3 consumers show unsupported data as null/unknown, never invented defaults. No forced connector update or authority change is implied by compatibility.

## Privacy and security

No raw SessionInfo/DriverInfo trees, secrets, token hashes, raw exception messages, or full property dumps are uploaded. Device authority and event/team/race-run binding are server-side. Reads remain exact-context scoped. Fuel, tyres, pit and strategy remain non-public unless a future narrow authorized DTO deliberately permits them.

## Frozen invariants

### MUST

- Authenticated device identity comes from token/server lookup.
- `transportSessionId` scopes sequence/replay.
- `raceRunId` scopes logical endurance continuity.
- Race-run lifecycle and authority are server-authoritative.
- Current driver is independent from owner/device authority.
- First snapshot after handoff is reconciliation baseline.
- V2 and V3 use separate strict allowlists and normalize to one DTO.
- Derived strategy operates on `raceRunId + eventId + teamId`.
- Events remain in `endurance_telemetry_events`.

### NEVER

- Client chooses `raceRunId` or event/team authority.
- Driver swap automatically changes authority.
- Connector restart or authority handoff starts a race run.
- Cross-source first-snapshot differences create synthetic events.
- Raw SessionInfo/DriverInfo tree is uploaded.
- Unknown SDK values are guessed.
- Fuel-per-lap or estimated-fuel-laps are authoritative raw data.
- Live hot tyre pressure, generic XYZ/GPS, or generic damage percentage is promised.

## Deferred runtime gates

| Gate | Status | Blocks implementation | Blocks field promotion |
|---|---|---:|---:|
| lapDistancePct movement/range/wrap | SOURCE-PROVEN only | no | yes |
| exact trackSurface mapping | unknown fallback frozen | no | yes |
| exact sessionState mapping | unknown fallback frozen | no | yes |
| SessionTimeRemain limited/unlimited semantics | fail-closed null | no | yes |
| tyre temperature unit | unproven | no | yes |
| cold-pressure unit | unproven | no | yes |
| tyre odometer unit | unproven | no | yes |
| tyre-zone orientation semantics | unproven | no | yes |
| tyre compound | unproven | no | yes |
| fastRepairAvailable boolean semantics | unproven | no | yes |
| stable gameSessionKey | experimental | no | yes |

## Known V2 issues for planned remediation

1. Event mapping reads `lapsRemainingEst` while connector/Edge use `estimatedLapsRemaining`.
2. `lap_time_from_deltas_s` is currently written as literal `NULL`.
3. V2 incidents mapping must be revised to a reliable typed iRacing source.

These are not changed by this freeze.
