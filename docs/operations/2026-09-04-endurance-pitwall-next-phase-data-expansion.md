# Endurance Pitwall Next Phase — Data Expansion Design Audit
## 2026-09-04 | READ-ONLY | Production changes: NONE

---

## 1. Current live V1 Pitwall data flow

**Live V1 RPC:** `public.get_pitwall_data(uuid, uuid)` (SECURITY DEFINER, deployed)
Returns combined jsonb: `team`, `telemetry`, `v3_normalized`, `strategy`, `timeline`, `planned_stints`, `pace_targets`, `access`.

**Source files:**
- `src/features/endurance/pitwall/usePitwallData.ts` — calls RPC, extracts position/pace/raceClock
- `src/features/endurance/pitwall/pitwallHelpers.ts` — types + formatters
- `src/features/endurance/pitwall/PitwallTab.tsx` — grid layout, focus mode
- Panels: TopRaceBar, PitStrategyBlock, StrategyForecast, FuelPanel, PacePanel, RacePositionPanel, StintDriverPanel, AlertZone, RaceTimeline
- `supabase/migrations/20260904110000_pitwall_v1_read_rpc.sql` — RPC

**V3 fields consumed now:**
- `v3_normalized.identity` — currentDriverId/Name, carId/Name, trackName/Config
- `v3_normalized.session` — sessionTimeSeconds, sessionTimeRemainingSeconds, sessionLapsRemaining, sessionState
- `v3_normalized.timing` — lastLapTimeSeconds, bestLapTimeSeconds, completedLaps, currentLapElapsedSeconds
- `v3_normalized.position` — position, classPosition, gapToLeaderSeconds
- `v3_normalized.track` — lapDistancePct, trackSurface, onPitRoad
- `v3_normalized.fuel` — fuelLitres, fuelPct
- `v3_normalized.raceState` — incidents
- `v3_normalized.pitService` — pitServiceFlagsRaw, requiredRepairSeconds, optionalRepairSeconds

**Planner fields consumed (via RPC `planned_stints`):** driver_id, original_start_at, original_end_at, expected_laps, fuel_litres, tyre_change, double_stint, status

**Strategy fields (via RPC `strategy`):** fuel_per_lap_litres, race_fuel_per_lap_litres, fuel_laps_remaining, valid_fuel_sample_count, last_completed_laps, current_fuel_litres, session_laps_remaining, fuel_to_finish_litres, fuel_sufficient_to_finish, strategy_status, fuel_to_add_litres

**Hidden future slots (PitwallTab.tsx):**
- `data-pitwall-slot="standings"` (line 241)
- `data-pitwall-slot="tyres"` (line 264)
- `data-pitwall-slot="trackmap"` (line 277)

**Live ground truth (v3_normalized from production DB, 2026-09-03 snapshot):**
```json
{
  "identity": { "carId":"mclaren720sgt3", "carName":"McLaren 720S GT3 EVO", "trackName":"watkinsglen 2021 fullcourse", "trackConfig":"Boot", "currentDriverId":"Vincent deVos", "currentDriverName":"Vincent deVos" },
  "session": { "isInCar": false, "sessionState":"unknown", "sessionTimeSeconds":730.38, "sessionTimeRemainingSeconds":null, "sessionLapsRemaining":null, "flags":null },
  "timing": { "lastLapTimeSeconds":129.11, "bestLapTimeSeconds":null, "currentLapElapsedSeconds":null, "completedLaps":4 },
  "position": { "position":1, "classPosition":1, "gapToLeaderSeconds":null },
  "track": { "lapDistancePct":null, "trackSurface":"unknown", "onPitRoad":true },
  "fuel": { "fuelLitres":54.99, "fuelPct":null },
  "pitService": { "pitServiceFlagsRaw":null, "requiredRepairSeconds":null, "optionalRepairSeconds":null },
  "raceState": { "incidents":null },
  "protocolVersion": 3
}
```

**Raw connector telemetry (same snapshot):**
```json
{ "lap":1, "flag":"unknown", "isInCar":true, "position":null, "speedKph":0, "connected":true, "inPitLane":false, "incidents":null, "fuelLitres":49.97, "pitLimiter":false, "classPosition":1, "completedLaps":0, "lapTimeSeconds":42.4, "fuelPerLapLitres":null, "sessionTimeSeconds":1711.4, "stintElapsedSeconds":199.8, "estimatedLapsRemaining":null }
```

**KEY FINDING:** The `v3_normalized` column exists in the schema but is **NOT built by any migration in the repo**. It is a runtime-transformed field. Its nested structure (identity/session/timing/position/track/fuel/pitService/raceState) exists and Pitwall consumes it, but all non-supplied fields (bestLapTimeSeconds, currentLapElapsedSeconds, gapToLeaderSeconds, lapDistancePct, sessionTimeRemainingSeconds, fuelPct, incidents, pitService) are `null` because the raw connector telegram (protocol v1) does not carry them.

---

## 2. Live-standings branch (origin/feat/endurance-live-standings @ 3fc4932)

**Reusable UI:**
- `LiveStandingsWidget.tsx` — clean presentational table (rank/team/driver/pos/class/laps/last/clock). Dark card, orange accents. **REUSE UI**
- `classification.ts` — `buildStandings()`, sorts on hasLiveData → completedLaps desc → position → team name. `publicTelemetry()` extracts safe fields. **REUSE LOGIC, REWRITE DATA LAYER**

**Reusable data assumptions:**
- Reads `endurance_teams` (id, name, car_number, car_id, livery) + `simhub_telemetry_latest` per event (latest per team). **V2-era direct table reads.**

**Dependencies:**
- `centralSimHubRelay.readLatestTelemetryForEvent` — reads all teams' latest rows (V2-era direct query, bypasses RLS for anon)

**Classify:**
- `LiveStandingsWidget.tsx` — **REUSE UI** (slim refactor to accept the Pitwall data + buildStandings output)
- `classification.ts` publicTelemetry helper — **REWRITE DATA LAYER** (must read v3_normalized / get_pitwall_data RPC instead of raw telemetry jsonb, to respect team-isolation RLS)
- `useLiveStandings.ts` / `standingsRepository.ts` — **DISCARD** direct table reads; replace with get_pitwall_data RPC call + server-side ahead/behind
- `StandingsStrip`/`NewStandingsTable` (separate public components) — **DISCARD for Pitwall** (not endurance per-team)

---

## 3. Raw SimHub opponent data availability

The C# connector (`tools/simhub-plugin/3SM.EnduranceConnector/EnduranceConnectorPlugin.cs:568`) has runtime access to **`snapshot.Opponents`** (full iRacing/SimHub opponents array with IsPlayer), but **currently only reads the player row** (PositionInClass, name).

**iRacing via SimHub provides per-opponent (available in plugin, NOT currently transmitted):**
- `Opponent.CarIdx` (lobby index)
- `Opponent.IsPlayer`
- `Opponent.Name` (driver name)
- `Opponent.CarNumber`/car number via property
- `Opponent.CarPath`, `CarId` (car model)
- `Opponent.Position`, `PositionInClass` (overall/class position)
- `Opponent.Lap`, `LapDistance` / `LapProgress` / `LapDistPct`
- `Opponent.CurrentLapTime` (last lap), `LastLap.Time`/`LastLapTime`
- `Opponent.BestLap.Time` (session best per opponent)
- `Opponent.GapToPlayer` (time gap to player car)
- `Opponent.GapToLeader`/`TimeDeltaFront`
- `Opponent.IsPacing`, `InPitLane`, speed
- `Opponent.TrackSurface`
- `Opponent.TeamName`/`TeamId` (team)

**Transmission status:** NONE of these are transmitted in the connector contract (protocol v1, `TelemetryValues`). **All opponent fields = MISSING from the contract.**

---

## 4. Raw SimHub tyre telemetry availability

iRacing TyphoonData / CarTire via SimHub provides per-wheel (FL/FR/RL/RR):
- `TireFML/I/ML` (−left/center/right) temperatures (°C)
- `TirePressure` (kPa)
- `TireWear` (0-1 or %)
- brake temp (iRacing 2022+)
- tyre type/compound

**Current status:**
- Connector does NOT read or transmit ANY tyre field (`TelemetryValues` has no tyre). **ALL tyre fields = MISSING from contract.**
- `v3_normalized` has NO tyre structure.
- Live value confirmed: no tyre data.

**Required for a Pitwall tyre card:** new V4 contract fields (per-wheel temp inner/mid/outer, pressure, wear) OR a separate minimal tyre payload.

---

## 5. Own LapDistancePct

**Field exists:** `v3_normalized.track.lapDistancePct` (nullable).
**Populated?** Live value = `null`. iRacing/SimHub provides it (`NewData.LapDistPct` / opponent `.LapDistance`) but the connector does not read/transmit it.

**Can be populated without changing V3 schema? YES.** Populate the existing nullable field by reading `DataCorePlugin.GameData.NewData.LapDistPct` in the connector. This is a server-only / field-population change (option B).

---

## 6. V3 existing fields currently unpopulated (populatable without connector shape change)

| Field | Path | Live value | Populatable? |
|---|---|---|---|
| lapDistancePct | track.lapDistancePct | null | **YES** (read LapDistPct) |
| sessionTimeRemainingSeconds | session | null | **YES** (iRacing SessionTimeRemain / SessionLaps) |
| sessionLapsRemaining | session | null | **YES** (read SessionLaps + CurrentLap) |
| bestLapTimeSeconds | timing | null | **YES** (iRacing LastLap+BestLap) |
| currentLapElapsedSeconds | timing | null | **YES** (read CurrentLapTime) |
| gapToLeaderSeconds | position | null | **YES** (iRacing TimeDeltaFront/Leader) |
| fuelPct | fuel | null | **YES** (read FuelPct) |
| incidents | raceState | null | **YES** (read Incidents — already in raw telemetry but mapped to v3 as null) |
| pitService fields | pitService | null | MAYBE (iRacing PitSv flags) |

**All of these are option-B (populate existing nullable V3 fields, no contract shape change).**

---

## 7-11. Standings / traffic / tyres / trackmap — connector-change requirement

**All opponent/tyre features require NEW connector contract fields (V4):**

| Feature | Without connector change? | Requires V4? |
|---|---|---|
| Own car LapDistancePct | **YES (option B)** | NO |
| Own car session-lap gap ahead/behind | **YES if derived server-side from per-team own-car fields** | Partial |
| Opponent standings/traffic (real opponents) | **NO** | **YES** (opponent array) |
| Tyre telemetry | **NO** | **YES** (per-wheel) |
| Track map own car marker | **YES (option B: lapDistancePct)** | NO |
| Track map opponent markers | **NO** | **YES** (per-opponent lap progress) |

**Track path source:** existing `src/components/track-map/TrackMap.tsx` + `src/lib/layeredTrackMaps.ts` (static track layouts used for result/demo maps). Reusable.

---

## 12. Best lap / sector pace expansion

**Without new connector fields:** session best, stint best (server-side from existing lastLapTimeSeconds/timeline), last lap already have. Sector times require V4 (sector-by-sector). Opponent lap pace requires V4 (opponent best/current lap per opponent).

---

## 13. Fuel tank-capacity source options

- **Raw SimHub/car metadata:** iRacing `FuelCapacity` (L) exists via car setup / `Telemetry.FuelCapacity`. **Connector could add it** (option C) but no current field.
- **Car config table (option B/cleanest):** add `fuel_tank_capacity_litres` to `endurance_teams` or a car-catalog table. No connector change. **RECOMMENDED for fuel — a config table**, since tank capacity is per-car-setup, stable, and not a live telemetry value.
- Event/team config or manual setup — alternative but duplicates data.

---

## 14. Contract decision — recommendation

**Recommendation: D — mixed phased approach.**

- **Phase 1 (now, no connector/v4):** populate the 9 existing nullable V3 fields (option B) + own LapDistancePct → immediate Pitwall value (race clock, gap leader, track marker, best lap). **No contract shape change, no V4.**
- **Phase 2 (V4 connector):** opponent + standings + traffic (requires new connector fields, server storage, read model).
- **Phase 3 (V4):** tyres (per-wheel).
- **Phase 4 (V4 or reuse):** track map opponents.

V3 is frozen — do NOT change its shape. Expand by (1) populating existing nullable fields, then (2) a controlled V4 additive contract when staff/team race-control value justifies connector upgrade.

---

## 15. Recommended implementation phases (ordered by value/risk)

1. **Phase 1 — Populate existing own-car nullable V3 fields** (option B): lapDistancePct, sessionTimeRemaining/RemainingLaps, bestLapTime, currentLapElapsed, gapToLeader, fuelPct, incidents, pitService. Server (or connector) fills the already-present schema keys. Pitwall gains: race clock, leader gap, track marker, best lap. No V4. No connector shape change.
2. **Phase 2 — Server-side derived ahead/behind** from per-team own-car gapToLeader (works once all racers transmit own-car fields + gapToLeader). Pure DB/read-model, no new opponent contract. Enables "car ahead/behind" without full opponent array.
3. **Phase 3 — V4 opponent contract**: connector transmits a bounded opponent snapshot array (car#, driver, position, classPos, lap, lapDistPct, gapToPlayer, gapToLeader, lastLap, bestLap, inPit, team, speed). Server stores latest-only + sampled. Pitwall standings/traffic UI.
4. **Phase 4 — V4 tyre contract**: per-wheel temp/pressure/wear, nullable. Pitwall tyre card.
5. **Phase 5 — Track map**: activate own-car marker (Phase 1 already gives lapDistancePct), then opponent markers (Phase 3 data). Reuse track-map components.

**Do NOT start Phase 3/4/5 until Phase 1 ships and a REAL multi-team race validates the derived ahead/behind.**

---

## 16. Storage / performance design

**Problem:** avoid exploding `endurance_telemetry_events` with huge opponent arrays.

**Recommendation:**
- **Latest-only snapshot table** — `simhub_opponent_snapshot` (per team+event+opponent carIdx, updated on each connector tick) OR store opponent array in `simhub_telemetry_latest` as a new bounded column (V4).
- **Do NOT write every tick to history.** Write the full opponent snapshot at a reduced cadence (e.g. 5–10s) or only on change; keep the `latest` row current at 1Hz.
- **Estimated size:** ~40 opponents × ~20 fields × ~300B ≈ 12KB per snapshot. At 1Hz per team that's ~43MB/hr/team if full history — **too much**. Latest-only + 5s sampled history is bounded.

**Preferred design:** a `simhub_opponent_latest` table (one row per opponent carIdx, updated in place via upsert, no unbounded growth) + server-side derivation of "car ahead/behind" from gapToLeader per team. Sampled history only for events that need audit (not all).

---

## 17. Security / team isolation

Extend `get_pitwall_data()` to return opponent/tyre data under the **same authorization gate**:
- staff → own-role permitted teams
- team member → own registered team only
- other auth → denied
- anon → denied

**Recommendation:** keep `get_pitwall_data()` as the single bounded read-model for ALL Pitwall data (opponents, tyres, standings). Add the new payload keys under the existing `auth.uid()` + `is_endurance_staff`/`endurance_team_members` gate. **Least privilege, bounded payload, one RPC.** Do NOT add separate anon-readable opponent endpoints (opponents are race-strategy-sensitive, not public).

---

## 18. UI slot plan

Using the approved Focus Mode grid:
- **First slot to activate: `standings`** (currently hidden at PitwallTab.tsx:241). Place in Row 1 area (left), above/near RacePositionPanel.
- Desktop size: ~1/3 column (fits the existing 3-col grid), dense table 8-10 rows.
- **Shrink:** RacePositionPanel becomes a compact summary (P#/K#/gap) since standings covers full positions. Or keep both: standings replaces the empty left-slot, Position stays compact.
- **Timeline:** keep full-width; make collapsible later if screen real estate tightens in focus mode.
- `tyres` and `trackmap` slots stay hidden until their data lands.

---

## 19. Production changes: NONE (this phase is read-only audit/design)

---

## 20. Recommended contract path

**D — mixed phased:**
- Now: **B** (populate existing nullable V3 fields — no shape change, low risk, immediate value).
- Then: **C-type** incremental V4 additive fields (opponent snapshot, tyres) when a real multi-team race is available to validate.

---

## Final answers

1. **Current live Pitwall data-flow:** RPC `get_pitwall_data` → v3_normalized (identity/session/timing/position/track/fuel/pitService/raceState) + strategy + timeline + planned_stints + pace_targets. Hidden future slots: standings, tyres, trackmap.
2. **Live-standings branch reusable:** `LiveStandingsWidget.tsx` UI (REUSE), `classification.ts` logic (REUSE/REWRITE), direct table reads (DISCARD → RPC).
3. **Exact raw opponent fields available:** Opponents array in plugin (carIdx, name, car#, position, classPos, lap, lapDistPct, gapToPlayer, gapToLeader, lastLap, bestLap, inPit, team, speed, trackSurface) — all present via SimHub Opponents object, NONE transmitted.
4. **Exact raw tyre fields available:** per-wheel temp (FL/FR/RL/RR, inner/mid/outer), pressure, wear — present via iRacing TyphoonData/SimHub, NONE transmitted.
5. **Own LapDistancePct available:** **YES** (field exists, populate via NewData.LapDistPct — option B).
6. **V3 unpopulated fields:** lapDistancePct, sessionTimeRemainingSeconds, sessionLapsRemaining, bestLapTimeSeconds, currentLapElapsedSeconds, gapToLeaderSeconds, fuelPct, incidents, pitService.*.
7. **Standings without connector change:** partial YES via server-side derivation from per-team gapToLeader (once racers transmit own-car gapToLeader); full opponent standings need V4.
8. **Opponent traffic requires V4:** **YES** (opponent array not transmitted).
9. **Tyres require V4:** **YES**.
10. **Track map own car without V4:** **YES** (lapDistancePct).
11. **Track map opponents require V4:** **YES**.
12. **Best/sector pace expansion:** session best + last lap already available (populate existing fields); sector + opponent lap pace require V4.
13. **Fuel tank-capacity source:** car config table (recommended, option B) — per-car-setup parameter, not live telemetry; iRacing FuelCapacity could be a V4 field but a config table is cleanest/stable.
14. **Recommended contract path:** **D — mixed** (Phase 1 = B populate existing; then incremental V4 additive).
15. **Implementation phases in order:** 1) populate own-car V3 fields; 2) server-derived ahead/behind; 3) V4 opponent contract + standings/traffic; 4) V4 tyres; 5) track map (own → opponents).
16. **Storage/performance:** latest-only opponent snapshot table upserted + server-derived ahead/behind + sampled (5-10s) history; avoid per-tick full-array history in endurance_telemetry_events.
17. **Security/read-model:** extend `get_pitwall_data()` under existing gate; no separate anon opponent endpoint; bounded payload.
18. **First UI slot to activate:** **standings** (PitwallTab.tsx:241), Row 1 left, ~1/3 col; RacePositionPanel compact.
19. **Production changes:** **NONE**.
20. **READY FOR NEXT PHASE IMPLEMENTATION GO:** **YES** — Phase 1 (option B populate existing fields) is safe, low-risk, high-value, and can be implemented next without V4/connector upgrade.

---

**ENDURANCE PITWALL NEXT PHASE DATA EXPANSION AUDIT PASS - READY FOR IMPLEMENTATION GO**