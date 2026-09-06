/* Device-scope Pitwall adapters — DEV/staff "Pitwall Test" page.
 *
 * Maps a SimHub device's scoped telemetry (simhub_telemetry_latest.v3_normalized,
 * read via get_simhub_device_details) into the fields the shared Pitwall panels
 * accept. Unlike the team Pitwall read path (get_pitwall_data), there is NO
 * strategy / raceRun context here, so anything consumption/strategy-derived is
 * deliberately null (no fabricated pit-in, fuel-per-lap or fuel-to-add).
 */
import type {
  V3Normalized,
  PitwallPositionData,
  PitwallPaceData,
  PitwallRaceClock,
  PitwallStrategyRow,
} from "./pitwallHelpers";

/** Telemetry newer than this (ms) counts as LIVE. */
export const LIVE_WINDOW_MS = 10_000;

export function isTelemetryLive(telemetryReceivedAt?: string | null): boolean {
  if (!telemetryReceivedAt) return false;
  const t = Date.parse(telemetryReceivedAt);
  if (Number.isNaN(t)) return false;
  return Date.now() - t <= LIVE_WINDOW_MS;
}

export function devicePosition(v3?: V3Normalized | null): PitwallPositionData | null {
  const p = v3?.position;
  if (!p) return null;
  if (p.position == null && p.classPosition == null && p.gapToLeaderSeconds == null) return null;
  return {
    overallPosition: p.position ?? null,
    classPosition: p.classPosition ?? null,
    gapToLeaderSeconds: p.gapToLeaderSeconds ?? null,
  };
}

export function devicePace(v3?: V3Normalized | null): PitwallPaceData | null {
  const t = v3?.timing;
  if (!t) return null;
  if (t.lastLapTimeSeconds == null && t.bestLapTimeSeconds == null) return null;
  return {
    lastLapSeconds: t.lastLapTimeSeconds ?? null,
    bestLapSeconds: t.bestLapTimeSeconds ?? null,
    stintAvgSeconds: null, // requires per-stint calc; not present at device scope
    targetSeconds: null,   // requires pace targets from the planner
  };
}

export function deviceRaceClock(v3?: V3Normalized | null): PitwallRaceClock | null {
  const s = v3?.session;
  if (!s) return null;
  if (s.sessionTimeRemainingSeconds == null && s.sessionLapsRemaining == null) return null;
  return {
    remainingSeconds: s.sessionTimeRemainingSeconds ?? null,
    remainingLaps: s.sessionLapsRemaining ?? null,
  };
}

/** Honest strategy-shaped row for the shared panels. All consumption-based
 *  fields stay null: device-scope telemetry has no fuel-per-lap/raceRun to
 *  compute pit-in or fuel-to-add from. Panels render those as "—".
 */
export function deviceStrategyRow(v3?: V3Normalized | null): PitwallStrategyRow {
  return {
    race_run_id: "",
    event_id: "",
    team_id: "",
    fuel_per_lap_litres: null,
    race_fuel_per_lap_litres: null,
    fuel_laps_remaining: null,
    valid_fuel_sample_count: 0,
    current_stint_valid_sample_count: 0,
    current_fuel_stint: 0,
    last_completed_laps: v3?.timing?.completedLaps ?? null,
    current_fuel_litres: v3?.fuel?.fuelLitres ?? null,
    session_laps_remaining: v3?.session?.sessionLapsRemaining ?? null,
    fuel_to_finish_litres: null,
    fuel_sufficient_to_finish: null,
    strategy_status: "insufficient_data",
    strategy_reason: "Device-scope: geen gebonden raceRun voor strategieberekening",
    updated_at: new Date().toISOString(),
    fuel_to_add_litres: null,
  };
}

/** Auto track detection: prefer V3 identity (iRacing sends track+config);
 *  falls back to the latest telemetry's legacy track_name.
 */
export function deviceTrackLabel(
  v3?: V3Normalized | null,
  legacyTrackName?: string | null,
): string {
  const name = v3?.identity?.trackName || legacyTrackName || "";
  const config = v3?.identity?.trackConfig ?? "";
  return [name, config].filter(Boolean).join(" - ") || "";
}
