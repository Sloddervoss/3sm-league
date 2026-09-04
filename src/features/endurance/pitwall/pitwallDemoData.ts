/* DEV-ONLY demo fixtures for visual review of Pitwall V1 components.
 * Activated by ?pitwallDemo=<scenario> in DEV build only.
 * NEVER included in production build — guarded by import.meta.env.DEV.
 * No DB writes. No fake connector data. Same component tree as real Pitwall. */

import type { PitwallStrategyRow, PitwallTimelineEvent, PitwallPlannedStint, TeamOption } from "./pitwallHelpers";

export type DemoScenario = "normal" | "pit" | "low-data" | "offline";

const ts = (agoS: number) => new Date(Date.now() - agoS * 1000).toISOString();

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
  updated_at: ts(60),
  ...overrides,
});

const NORMAL_STRATEGY = baseRow();
const PIT_STRATEGY = baseRow({
  fuel_laps_remaining: 0.8, current_fuel_litres: 3.0,
  last_completed_laps: 107, fuel_to_finish_litres: 278,
  fuel_sufficient_to_finish: false, valid_fuel_sample_count: 51,
  current_stint_valid_sample_count: 15,
});
const LOW_DATA_STRATEGY = baseRow({
  fuel_per_lap_litres: 3.25, fuel_laps_remaining: 25.8,
  valid_fuel_sample_count: 2, current_stint_valid_sample_count: 2,
  current_fuel_stint: 1, last_completed_laps: 4, current_fuel_litres: 35.2,
  session_laps_remaining: null, fuel_to_finish_litres: null,
  fuel_sufficient_to_finish: null, strategy_status: "low_sample",
  strategy_reason: "slechts 2 geldige samples",
});
const OFFLINE_STRATEGY = baseRow({
  strategy_status: "insufficient_data", strategy_reason: "telemetrie verloren",
  current_fuel_litres: null, fuel_laps_remaining: null, fuel_per_lap_litres: null,
  fuel_to_finish_litres: null, fuel_sufficient_to_finish: null,
  valid_fuel_sample_count: 0, current_stint_valid_sample_count: 0,
  last_completed_laps: null,
});

/* ============ TEAMS ============ */
const TEAMS: TeamOption[] = [
  { id: "demo-team", name: "3SM Demo Team" },
  { id: "demo-team-2", name: "Naober Racing" },
  { id: "demo-team-3", name: "Paardekracht Motorsport" },
];

/* ============ PLANNED STINTS ============ */
const STINTS: PitwallPlannedStint[] = [
  { id: "s1", driver_id: "Vincent", original_start_at: ts(7200), original_end_at: ts(5400), actual_start_at: ts(7200), actual_end_at: null, expected_laps: 35, fuel_litres: 90, tyre_change: false, double_stint: false, status: "in_car", notes: null },
  { id: "s2", driver_id: "Jason", original_start_at: ts(5400), original_end_at: ts(3600), actual_start_at: null, actual_end_at: null, expected_laps: 32, fuel_litres: 85, tyre_change: true, double_stint: false, status: "draft", notes: null },
  { id: "s3", driver_id: "Ricky", original_start_at: ts(3600), original_end_at: ts(1800), actual_start_at: null, actual_end_at: null, expected_laps: 34, fuel_litres: 88, tyre_change: false, double_stint: false, status: "draft", notes: null },
  { id: "s4", driver_id: "Vincent", original_start_at: ts(1800), original_end_at: ts(0), actual_start_at: null, actual_end_at: null, expected_laps: 30, fuel_litres: 82, tyre_change: true, double_stint: false, status: "draft", notes: null },
];

/* ============ TIMELINE EVENTS ============ */
const ev = (type: string, key: string, overrides?: Partial<PitwallTimelineEvent>): PitwallTimelineEvent => ({
  event_type: type, event_key: key,
  lap: null, completed_laps: null, fuel_litres: null, fuel_per_lap_litres: null,
  fuel_added_est_litres: null, laps_remaining_est: null, driver_id: null,
  in_pit_lane: null, incidents: null, flag: null, stint_elapsed_s: null,
  session_time_s: null, lap_time_from_deltas_s: null, captured_at: ts(9999),
  payload: null, ...overrides,
});

const earlyEvents: PitwallTimelineEvent[] = [
  ev("lap_completed", "lap:1", { completed_laps: 1, captured_at: ts(10000), payload: { lastLapTimeSeconds: "107.6" } }),
  ev("lap_completed", "lap:2", { completed_laps: 2, captured_at: ts(9900), payload: { lastLapTimeSeconds: "105.2" } }),
  ev("lap_completed", "lap:3", { completed_laps: 3, captured_at: ts(9800), payload: { lastLapTimeSeconds: "107.3" } }),
];

const midEvents: PitwallTimelineEvent[] = [
  ev("pit_entry", "pit:in:1", { completed_laps: 30, fuel_litres: 18.0, captured_at: ts(7000) }),
  ev("pit_exit", "pit:out:1", { completed_laps: 30, fuel_added_est_litres: 82, captured_at: ts(6980) }),
  ev("lap_completed", "lap:65", { completed_laps: 65, lap_time_from_deltas_s: 91.8, fuel_litres: 50.2, captured_at: ts(3200) }),
  ev("pit_entry", "pit:in:2", { completed_laps: 65, fuel_litres: 7.3, driver_id: "Vincent", captured_at: ts(3190) }),
  ev("pit_exit", "pit:out:2", { completed_laps: 65, fuel_added_est_litres: 78, driver_id: "Jason", captured_at: ts(3170) }),
  ev("lap_completed", "lap:66", { completed_laps: 66, lap_time_from_deltas_s: 91.2, fuel_litres: 77.5, driver_id: "Jason", captured_at: ts(3160) }),
  ev("lap_completed", "lap:103", { completed_laps: 103, lap_time_from_deltas_s: 92.4, fuel_litres: 21.7, captured_at: ts(60) }),
];

const NORMAL_EVENTS = [...earlyEvents, ...midEvents];
const PIT_EVENTS = [...NORMAL_EVENTS,
  ev("lap_completed", "lap:106", { completed_laps: 106, lap_time_from_deltas_s: 93.1, fuel_litres: 5.8, captured_at: ts(5) }),
  ev("lap_completed", "lap:107", { completed_laps: 107, lap_time_from_deltas_s: 0.0, fuel_litres: 3.0, captured_at: ts(1) }),
];
const LOW_DATA_EVENTS = [...earlyEvents,
  ev("lap_completed", "lap:4", { completed_laps: 4, lap_time_from_deltas_s: 106.1, fuel_litres: 30.5, captured_at: ts(5) }),
];
const OFFLINE_EVENTS = [...NORMAL_EVENTS.slice(0, -1),
  ev("lap_completed", "lap:105", { completed_laps: 105, lap_time_from_deltas_s: 92.8, fuel_litres: 21.0, captured_at: ts(180) }),
];

/* ============ ALERTS ============ */
type Alert = { severity: "high" | "medium" | "info"; message: string };
const NO_ALERTS: Alert[] = [];
const HIGH_ALERTS: Alert[] = [{ severity: "high", message: "PIT DEZE RONDE — brandstof kritiek" }];
const INFO_ALERTS: Alert[] = [{ severity: "info", message: "Strategie: weinig data — slechts 2 samples" }];
const OFFLINE_ALERTS: Alert[] = [{ severity: "high", message: "TELEMETRIE VERLOREN — data is oud" }];

/* ============ EXPORT ============ */
export interface DemoData {
  scenario: DemoScenario;
  strategy: PitwallStrategyRow | null;
  events: PitwallTimelineEvent[];
  teams: TeamOption[];
  plannedStints: PitwallPlannedStint[];
  alerts: Alert[];
  loading: boolean;
}

const scenarios: Record<DemoScenario, DemoData> = {
  normal: {
    scenario: "normal", strategy: NORMAL_STRATEGY, events: NORMAL_EVENTS,
    teams: TEAMS, plannedStints: STINTS, alerts: NO_ALERTS, loading: false,
  },
  pit: {
    scenario: "pit", strategy: PIT_STRATEGY, events: PIT_EVENTS,
    teams: TEAMS, plannedStints: STINTS, alerts: HIGH_ALERTS, loading: false,
  },
  "low-data": {
    scenario: "low-data", strategy: LOW_DATA_STRATEGY, events: LOW_DATA_EVENTS,
    teams: TEAMS, plannedStints: STINTS, alerts: INFO_ALERTS, loading: false,
  },
  offline: {
    scenario: "offline", strategy: OFFLINE_STRATEGY, events: OFFLINE_EVENTS,
    teams: TEAMS, plannedStints: STINTS, alerts: OFFLINE_ALERTS, loading: false,
  },
};

export const getDemoData = (scenario: DemoScenario): DemoData => scenarios[scenario];

export const DEMO_SCENARIO_LIST: Array<{ id: DemoScenario; label: string }> = [
  { id: "normal", label: "Normale race" },
  { id: "pit", label: "Pit deze ronde" },
  { id: "low-data", label: "Weinig data" },
  { id: "offline", label: "Telemetrie verloren" },
];

/** Returns the demo scenario from URL if DEV mode, else null. */
export function getDemoScenarioFromUrl(): DemoScenario | null {
  if (!import.meta.env.DEV) return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const value = params.get("pitwallDemo");
    if (value && ["normal", "pit", "low-data", "offline"].includes(value)) {
      return value as DemoScenario;
    }
  } catch { /* ignore */ }
  return null;
}