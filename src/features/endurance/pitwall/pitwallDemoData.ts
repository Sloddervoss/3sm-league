/* DEV-ONLY demo fixtures for visual review of Pitwall V1 components.
 * Activated by ?pitwallDemo=<scenario> in DEV build only.
 * NEVER included in production build — guarded by import.meta.env.DEV.
 * No DB writes. No fake connector data. Same component tree as real Pitwall. */

import type {
  PitwallStrategyRow, PitwallTimelineEvent, PitwallPlannedStint,
  TeamOption, PitwallPositionData, PitwallPaceData, PitwallRaceClock,
} from "./pitwallHelpers";

export type DemoScenario = "normal" | "pit" | "low-data" | "offline";

/* ============ TYPES ============ */

export interface Alert {
  severity: "high" | "medium" | "info";
  message: string;
}

export interface DemoData {
  scenario: DemoScenario;
  strategy: PitwallStrategyRow | null;
  events: PitwallTimelineEvent[];
  teams: TeamOption[];
  plannedStints: PitwallPlannedStint[];
  alerts: Alert[];
  loading: boolean;
  position: PitwallPositionData;
  pace: PitwallPaceData;
  raceClock: PitwallRaceClock;
}

/* ============ STRATEGY FIXTURES ============ */

const baseRow = (overrides?: Partial<PitwallStrategyRow>): PitwallStrategyRow => ({
  race_run_id: "demo-rr-001",
  event_id: "demo-event",
  team_id: "demo-team",
  fuel_per_lap_litres: 3.12,
  race_fuel_per_lap_litres: 3.08,
  fuel_laps_remaining: 6.1,
  valid_fuel_sample_count: 47,
  current_stint_valid_sample_count: 12,
  current_fuel_stint: 3,
  last_completed_laps: 103,
  current_fuel_litres: 21.7,
  session_laps_remaining: 57,
  fuel_to_finish_litres: 280,
  fuel_sufficient_to_finish: true,
  strategy_status: "ready",
  strategy_reason: null,
  updated_at: new Date(Date.now() - 60000).toISOString(),
  fuel_to_add_litres: null,
  ...overrides,
});

const NORMAL_STRATEGY = baseRow({ fuel_to_add_litres: 72 });

const PIT_STRATEGY = baseRow({
  fuel_laps_remaining: 0.8, current_fuel_litres: 3.0,
  last_completed_laps: 107, fuel_to_finish_litres: 278,
  fuel_sufficient_to_finish: false, valid_fuel_sample_count: 51,
  current_stint_valid_sample_count: 15, fuel_to_add_litres: 72,
});

const LOW_DATA_STRATEGY = baseRow({
  fuel_per_lap_litres: 3.25, fuel_laps_remaining: 25.8,
  valid_fuel_sample_count: 2, current_stint_valid_sample_count: 2,
  current_fuel_stint: 1, last_completed_laps: 4, current_fuel_litres: 35.2,
  session_laps_remaining: null, fuel_to_finish_litres: null,
  fuel_sufficient_to_finish: null, strategy_status: "low_sample",
  strategy_reason: "slechts 2 geldige samples",
  fuel_to_add_litres: null, /* low data: no trustworthy recommendation */
});

const OFFLINE_STRATEGY = baseRow({
  strategy_status: "insufficient_data", strategy_reason: "telemetrie verloren",
  current_fuel_litres: null, fuel_laps_remaining: null, fuel_per_lap_litres: null,
  fuel_to_finish_litres: null, fuel_sufficient_to_finish: null,
  valid_fuel_sample_count: 0, current_stint_valid_sample_count: 0,
  last_completed_laps: null, fuel_to_add_litres: null,
});

/* ============ TEAMS ============ */
const TEAMS: TeamOption[] = [
  { id: "demo-team", name: "3SM Demo Team" },
  { id: "demo-team-2", name: "Naober Racing" },
  { id: "demo-team-3", name: "Paardekracht Motorsport" },
];

/* ============ PLANNED STINTS ============ */

const ts = (agoH: number) => new Date(Date.now() - agoH * 3600 * 1000).toISOString();
const futureTs = (aheadH: number) => new Date(Date.now() + aheadH * 3600 * 1000).toISOString();

const STINTS: PitwallPlannedStint[] = [
  { id: "s1", driver_id: "Vincent", original_start_at: ts(6), original_end_at: ts(0.78), actual_start_at: ts(6), actual_end_at: null, expected_laps: 35, fuel_litres: 90, tyre_change: false, double_stint: false, status: "in_car", notes: null },
  { id: "s2", driver_id: "Jason", original_start_at: ts(0.78), original_end_at: ts(-2.2), actual_start_at: null, actual_end_at: null, expected_laps: 32, fuel_litres: 85, tyre_change: true, double_stint: false, status: "draft", notes: null },
  { id: "s3", driver_id: "Ricky", original_start_at: ts(-2.2), original_end_at: ts(-4.1), actual_start_at: null, actual_end_at: null, expected_laps: 34, fuel_litres: 88, tyre_change: false, double_stint: false, status: "draft", notes: null },
  { id: "s4", driver_id: "Vincent", original_start_at: ts(-4.1), original_end_at: ts(-6), actual_start_at: null, actual_end_at: null, expected_laps: 30, fuel_litres: 82, tyre_change: true, double_stint: false, status: "draft", notes: null },
];

/* ============ STINT EXTRA INFO ============ */
const CURRENT_STINT_INFO = { driver: "Vincent", durationMin: 47, laps: 31 };

/* ============ TIMELINE EVENTS ============ */
const ev = (type: string, key: string, overrides?: Partial<PitwallTimelineEvent>): PitwallTimelineEvent => ({
  event_type: type, event_key: key,
  lap: null, completed_laps: null, fuel_litres: null, fuel_per_lap_litres: null,
  fuel_added_est_litres: null, laps_remaining_est: null, driver_id: null,
  in_pit_lane: null, incidents: null, flag: null, stint_elapsed_s: null,
  session_time_s: null, lap_time_from_deltas_s: null, captured_at: ts(9999).replace("9999", "2030"),
  payload: null, ...overrides,
});

const earlyEvents: PitwallTimelineEvent[] = [
  ev("lap_completed", "lap:1", { completed_laps: 1, captured_at: "2026-09-04T10:00:00Z", payload: { lastLapTimeSeconds: "107.6" } }),
  ev("lap_completed", "lap:2", { completed_laps: 2, captured_at: "2026-09-04T10:01:08Z", payload: { lastLapTimeSeconds: "105.2" } }),
  ev("lap_completed", "lap:3", { completed_laps: 3, captured_at: "2026-09-04T10:02:15Z", payload: { lastLapTimeSeconds: "107.3" } }),
];

const midEvents: PitwallTimelineEvent[] = [
  ev("pit_entry", "pit:in:1", { completed_laps: 30, fuel_litres: 18.0, captured_at: "2026-09-04T11:58:00Z" }),
  ev("pit_exit", "pit:out:1", { completed_laps: 30, fuel_added_est_litres: 82, captured_at: "2026-09-04T11:59:15Z" }),
  ev("lap_completed", "lap:65", { completed_laps: 65, lap_time_from_deltas_s: 91.8, fuel_litres: 50.2, captured_at: "2026-09-04T12:52:00Z" }),
  ev("pit_entry", "pit:in:2", { completed_laps: 65, fuel_litres: 7.3, driver_id: "Vincent", captured_at: "2026-09-04T12:53:00Z" }),
  ev("pit_exit", "pit:out:2", { completed_laps: 65, fuel_added_est_litres: 78, driver_id: "Jason", captured_at: "2026-09-04T12:54:15Z" }),
  ev("lap_completed", "lap:66", { completed_laps: 66, lap_time_from_deltas_s: 91.2, fuel_litres: 77.5, driver_id: "Jason", captured_at: "2026-09-04T12:55:40Z" }),
  ev("lap_completed", "lap:103", { completed_laps: 103, lap_time_from_deltas_s: 92.4, fuel_litres: 21.7, captured_at: "2026-09-04T14:38:00Z" }),
];

const NORMAL_EVENTS = [...earlyEvents, ...midEvents];

const PIT_EVENTS = [...earlyEvents, ...midEvents.slice(0, -1),
  ev("lap_completed", "lap:105", { completed_laps: 105, lap_time_from_deltas_s: 93.1, fuel_litres: 6.2, captured_at: "2026-09-04T14:40:00Z" }),
  ev("lap_completed", "lap:106", { completed_laps: 106, lap_time_from_deltas_s: 93.5, fuel_litres: 3.8, captured_at: "2026-09-04T14:41:15Z" }),
  ev("lap_completed", "lap:107", { completed_laps: 107, lap_time_from_deltas_s: 0.0, fuel_litres: 3.0, captured_at: "2026-09-04T14:42:30Z" }),
];

const LOW_DATA_EVENTS = [
  ev("lap_completed", "lap:1", { completed_laps: 1, captured_at: "2026-09-04T10:00:00Z", payload: { lastLapTimeSeconds: "106.1" } }),
  ev("lap_completed", "lap:2", { completed_laps: 2, captured_at: "2026-09-04T10:01:05Z", payload: { lastLapTimeSeconds: "104.8" } }),
  ev("lap_completed", "lap:3", { completed_laps: 3, captured_at: "2026-09-04T10:02:10Z", payload: { lastLapTimeSeconds: "105.7" } }),
  ev("lap_completed", "lap:4", { completed_laps: 4, captured_at: "2026-09-04T10:03:15Z", payload: { lastLapTimeSeconds: "106.1" } }),
];

const OFFLINE_EVENTS = [...earlyEvents, ...midEvents.slice(0, -2),
  ev("lap_completed", "lap:105", { completed_laps: 105, lap_time_from_deltas_s: 92.8, fuel_litres: 21.0, captured_at: new Date(Date.now() - 180000).toISOString() }),
];

/* ============ ALERTS ============ */
const NO_ALERTS: Alert[] = [];
const PIT_HIGH_ALERTS: Alert[] = [{ severity: "high", message: "PIT DEZE RONDE – brandstof kritiek" }];
const LOW_DATA_INFO_ALERTS: Alert[] = [{ severity: "info", message: "Waarschuwing: strategie nog niet betrouwbaar — slechts 2 samples" }];
const OFFLINE_HIGH_ALERTS: Alert[] = [{ severity: "high", message: "TELEMETRIE VERLOREN — data is verouderd. Planner/blanco data blijft beschikbaar" }];

/* ============ EXPORT ============ */

const scenarios: Record<DemoScenario, DemoData> = {
  normal: {
    scenario: "normal", strategy: NORMAL_STRATEGY, events: NORMAL_EVENTS,
    teams: TEAMS, plannedStints: STINTS, alerts: NO_ALERTS, loading: false,
    position: { overallPosition: 6, classPosition: 2, gapToLeaderSeconds: 42.8 },
    pace: { lastLapSeconds: 92.4, bestLapSeconds: 91.8, stintAvgSeconds: 93.1, targetSeconds: 92.0 },
    raceClock: { remainingSeconds: 9692, remainingLaps: 57 },
  },
  pit: {
    scenario: "pit", strategy: PIT_STRATEGY, events: PIT_EVENTS,
    teams: TEAMS, plannedStints: STINTS, alerts: PIT_HIGH_ALERTS, loading: false,
    position: { overallPosition: 6, classPosition: 2, gapToLeaderSeconds: 18.3 },
    pace: { lastLapSeconds: 0.0, bestLapSeconds: 91.8, stintAvgSeconds: 93.5, targetSeconds: 92.0 },
    raceClock: { remainingSeconds: 8300, remainingLaps: 49 },
  },
  "low-data": {
    scenario: "low-data", strategy: LOW_DATA_STRATEGY, events: LOW_DATA_EVENTS,
    teams: TEAMS, plannedStints: STINTS, alerts: LOW_DATA_INFO_ALERTS, loading: false,
    position: { overallPosition: 14, classPosition: 5, gapToLeaderSeconds: 15.2 },
    pace: { lastLapSeconds: 106.1, bestLapSeconds: 104.8, stintAvgSeconds: 105.7, targetSeconds: null },
    raceClock: { remainingSeconds: 20500, remainingLaps: null },
  },
  offline: {
    scenario: "offline", strategy: OFFLINE_STRATEGY, events: OFFLINE_EVENTS,
    teams: TEAMS, plannedStints: STINTS, alerts: OFFLINE_HIGH_ALERTS, loading: false,
    position: { overallPosition: null, classPosition: null, gapToLeaderSeconds: null },
    pace: { lastLapSeconds: null, bestLapSeconds: 91.8, stintAvgSeconds: null, targetSeconds: 92.0 },
    raceClock: { remainingSeconds: null, remainingLaps: null },
  },
};

export const getDemoData = (scenario: DemoScenario): DemoData => scenarios[scenario];

export const DEMO_SCENARIO_LIST: Array<{ id: DemoScenario; label: string }> = [
  { id: "normal", label: "Normale race" },
  { id: "pit", label: "Pit deze ronde" },
  { id: "low-data", label: "Weinig data" },
  { id: "offline", label: "Telemetrie verloren" },
];