/* Pitwall V1 — types & helpers */
export interface PitwallPositionData {
  overallPosition: number | null;
  classPosition: number | null;
  gapToLeaderSeconds: number | null;
}

export interface PitwallPaceData {
  lastLapSeconds: number | null;
  bestLapSeconds: number | null;
  stintAvgSeconds: number | null;
  targetSeconds: number | null;
}

export interface PitwallRaceClock {
  remainingSeconds: number | null;
  remainingLaps: number | null;
}

export interface PitwallStrategyRow {
  race_run_id: string;
  event_id: string;
  team_id: string;
  fuel_per_lap_litres: number | null;
  race_fuel_per_lap_litres: number | null;
  fuel_laps_remaining: number | null;
  valid_fuel_sample_count: number;
  current_stint_valid_sample_count: number;
  current_fuel_stint: number;
  last_completed_laps: number | null;
  current_fuel_litres: number | null;
  session_laps_remaining: number | null;
  fuel_to_finish_litres: number | null;
  fuel_sufficient_to_finish: boolean | null;
  strategy_status: string;
  strategy_reason: string | null;
  updated_at: string;
  /** Strategy's predetermined fuel-to-add recommendation. null = not available / not trustworthy. */
  fuel_to_add_litres: number | null;
}

export interface V3Normalized {
  identity?: {
    currentDriverId?: string;
    currentDriverName?: string;
    carId?: string;
    carName?: string;
    trackName?: string;
    trackConfig?: string;
  };
  session?: {
    isInCar?: boolean;
    sessionTimeSeconds?: number;
    sessionTimeRemainingSeconds?: number;
    sessionLapsRemaining?: number;
    flags?: string[];
    sessionState?: string;
  };
  timing?: {
    currentLapElapsedSeconds?: number;
    lastLapTimeSeconds?: number;
    bestLapTimeSeconds?: number;
    completedLaps?: number;
  };
  position?: {
    position?: number;
    classPosition?: number;
    gapToLeaderSeconds?: number;
  };
  track?: {
    lapDistancePct?: number;
    trackSurface?: string;
    onPitRoad?: boolean;
  };
  fuel?: {
    fuelLitres?: number;
    fuelPct?: number;
  };
  raceState?: {
    incidents?: number;
  };
  pitService?: {
    pitServiceFlagsRaw?: number;
    requiredRepairSeconds?: number;
    optionalRepairSeconds?: number;
  };
  /** 0.4.1+ bounded, null-tolerant opponent snapshot (from SimHub Opponents). */
  opponents?: V3Opponent[];
}

/** A single opponent from the 0.4.1 connector snapshot. */
export interface V3Opponent {
  id: string;
  carNumber?: string | null;
  driverName?: string | null;
  teamName?: string | null;
  carClass?: string | null;
  carClassId?: string | null;
  position?: number | null;
  classPosition?: number | null;
  lap?: number | null;
  lapDistancePct?: number | null;
  gapToPlayerSeconds?: number | null;
  gapToLeaderSeconds?: number | null;
  lastLapSeconds?: number | null;
  bestLapSeconds?: number | null;
  inPit?: boolean | null;
  speedKph?: number | null;
  connected?: boolean;
  isPlayer?: boolean;
}

export interface PitwallTimelineEvent {
  event_type: string;
  event_key: string | null;
  lap: number | null;
  completed_laps: number | null;
  fuel_litres: number | null;
  fuel_per_lap_litres: number | null;
  fuel_added_est_litres: number | null;
  laps_remaining_est: number | null;
  driver_id: string | null;
  in_pit_lane: boolean | null;
  incidents: number | null;
  flag: string | null;
  stint_elapsed_s: number | null;
  session_time_s: number | null;
  lap_time_from_deltas_s: number | null;
  captured_at: string;
  payload?: Record<string, unknown>;
}

export interface PitwallPlannedStint {
  id: string;
  driver_id: string;
  original_start_at: string;
  original_end_at: string;
  actual_start_at: string | null;
  actual_end_at: string | null;
  expected_laps: number;
  fuel_litres: number;
  tyre_change: boolean;
  double_stint: boolean;
  status: string;
  notes: string | null;
}

export interface PitwallTeamInfo {
  id: string;
  name: string | null;
  car_id: string | null;
  car_number: string | null;
}

export interface PitwallPaceTarget {
  user_id: string;
  average_lap_seconds: number;
  best_lap_seconds: number;
  valid_laps: number;
  source: string;
}

export interface PitwallData {
  team: PitwallTeamInfo;
  telemetry: {
    telemetry?: Record<string, unknown>;
    v3_normalized?: V3Normalized;
    current_driver_id?: string;
    current_driver_name?: string;
    car_id?: string;
    car_name?: string;
    track_name?: string;
    track_config?: string;
    driver_id?: string;
    received_at?: string;
    race_run_id?: string;
  } | null;
  strategy: PitwallStrategyRow | null;
  timeline: PitwallTimelineEvent[];
  planned_stints: PitwallPlannedStint[];
  pace_targets: PitwallPaceTarget[];
  access: "staff" | "team_member";
}

export interface StrategyStatusInfo {
  status: PitwallStrategyRow["strategy_status"];
  reason: string | null;
  label: string;
  tone: "green" | "yellow" | "red" | "gray";
}

export const strategyStatusInfo = (status: string, reason?: string | null): StrategyStatusInfo => {
  switch (status) {
    case "ready":
      return { status, reason, label: "Strategie gereed", tone: "green" };
    case "low_sample":
      return { status, reason, label: "Weinig data", tone: "yellow" };
    case "insufficient_data":
      return { status, reason, label: "Onvoldoende data", tone: "red" };
    default:
      return { status, reason, label: "Geen strategie", tone: "gray" };
  }
};

export const calcPitLap = (
  completedLaps: number | null | undefined,
  fuelLapsRemaining: number | null | undefined,
  reserveLaps = 1,
): number | null => {
  if (completedLaps == null || fuelLapsRemaining == null) return null;
  return Math.floor(completedLaps + fuelLapsRemaining - reserveLaps);
};

export const calcFuelToAdd = (
  currentFuelLitres: number | null,
  fuelPerLap: number | null,
  /** Laps remaining of the NEXT stint (not current fuel range) */
  nextStintLaps: number | null,
  /** Explicit car-specific tank capacity. No default — caller must provide. */
  tankCapacity: number,
): number | null => {
  if (currentFuelLitres == null || fuelPerLap == null || nextStintLaps == null) return null;
  if (tankCapacity <= 0) return null;
  // Fuel needed for next stint
  const fuelNeeded = nextStintLaps * fuelPerLap;
  // Fuel to add = max(0, min(tankCapacity, fuelNeeded - fuelAtPitEntry))
  // Note: currentFuel is approximate fuel at pit entry (not exact)
  const toAdd = fuelNeeded - currentFuelLitres;
  if (toAdd <= 0) return 0;
  return Math.min(tankCapacity, toAdd);
};

export const estimateRemainingLaps = (
  remainingTimeSeconds: number | null | undefined,
  avgLapSeconds: number | null | undefined,
): number | null => {
  if (remainingTimeSeconds == null || avgLapSeconds == null || avgLapSeconds <= 0) return null;
  return Math.ceil(remainingTimeSeconds / avgLapSeconds);
};

export const formatSeconds = (seconds: number | null | undefined): string => {
  if (seconds == null) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h > 0 ? `${h}:` : ""}${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

export const formatFuel = (litres: number | null | undefined): string => {
  if (litres == null) return "—";
  return litres.toFixed(1) + "L";
};

export const formatLaps = (laps: number | null | undefined): string => {
  if (laps == null) return "—";
  return `${laps} ${laps === 1 ? "ronde" : "ronden"}`;
};

export interface TeamOption {
  id: string;
  name: string;
}

export const formatLapTime = (seconds: number | null | undefined): string => {
  if (seconds == null || seconds <= 0 || isNaN(seconds)) return "—";
  const min = Math.floor(seconds / 60);
  const sec = (seconds % 60).toFixed(1);
  return `${min}:${sec.padStart(4, "0")}`;
};

export const formatDelta = (delta: number | null | undefined): { text: string; faster: boolean } | null => {
  if (delta == null) return null;
  return { text: `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}s`, faster: delta < 0 };
};

/**
 * Extract PitwallRaceClock from V3 normalized telemetry.
 * Priority: V3 session clock → event schedule fallback (caller provides).
 * Returns null when no authoritative clock is available.
 */
export function extractRaceClock(v3?: V3Normalized | null): PitwallRaceClock | null {
  if (!v3?.session?.sessionTimeRemainingSeconds) return null;
  const remainingSeconds = v3.session.sessionTimeRemainingSeconds;
  if (remainingSeconds <= 0) return null;
  return {
    remainingSeconds,
    remainingLaps: v3.session.sessionLapsRemaining ?? null,
  };
}