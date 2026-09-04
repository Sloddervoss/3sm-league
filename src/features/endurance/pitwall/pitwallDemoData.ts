/* DEV-ONLY demo fixtures for visual review of Pitwall V1 components.
 * Activated by ?pitwallDemo=<scenario> in DEV build only.
 * NEVER included in production build — guarded by import.meta.env.DEV.
 * No DB writes. No fake connector data. Same component tree as real Pitwall. */

import type {
  PitwallStrategyRow, PitwallTimelineEvent, PitwallPlannedStint,
  TeamOption, PitwallPositionData, PitwallPaceData, PitwallRaceClock,
  V3Normalized, V3Opponent,
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
  /** 0.4.2: DEV-only opponent snapshot (as the 0.4.1 connector would send). */
  opponents: V3Opponent[];
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

/* ============ 0.4.2 DEMO OPPONENT GRID ============ */
const opp = (o: Partial<V3Opponent> & { id: string }): V3Opponent => ({
  carNumber: null, driverName: null, teamName: null, carClass: "GT3", carClassId: "gt3",
  position: null, classPosition: null, lap: null, lapDistancePct: null,
  gapToPlayerSeconds: null, gapToLeaderSeconds: null, lastLapSeconds: null, bestLapSeconds: null,
  inPit: false, speedKph: null, connected: true, isPlayer: false, ...o,
});

/** ~16-car grid, player at P6/K2. Includes lapped, pit, disconnected, missing-gap rows. */
const DEMO_OPPONENTS: V3Opponent[] = [
  opp({ id: "p1", carNumber: "11", teamName: "Apex Racing", driverName: "M. vd Berg", position: 1, classPosition: 1, lap: 103, gapToPlayerSeconds: -42.8, gapToLeaderSeconds: 0.0, lastLapSeconds: 91.2, bestLapSeconds: 90.9 }),
  opp({ id: "p2", carNumber: "77", teamName: "Naober Racing", driverName: "R. Godefrooij", position: 2, classPosition: 1, lap: 103, gapToPlayerSeconds: -30.1, gapToLeaderSeconds: 1.8, lastLapSeconds: 91.8, bestLapSeconds: 91.4 }),
  opp({ id: "p3", carNumber: "23", teamName: "Paardekracht", driverName: "J. Wever", position: 3, classPosition: 2, lap: 102, gapToPlayerSeconds: -21.5, gapToLeaderSeconds: 3.2, lastLapSeconds: 92.1, bestLapSeconds: 91.6 }),
  opp({ id: "p4", carNumber: "45", teamName: "3SM Rookie", driverName: "D. Bakker", position: 4, classPosition: 1, lap: 102, gapToPlayerSeconds: -14.0, gapToLeaderSeconds: 6.4, lastLapSeconds: 92.4, bestLapSeconds: 92.0 }),
  opp({ id: "p5", carNumber: "28", teamName: "SimRanks", driverName: "L. Post", position: 5, classPosition: 2, lap: 101, gapToPlayerSeconds: -3.4, gapToLeaderSeconds: 9.1, lastLapSeconds: 91.9, bestLapSeconds: 91.7 }),
  opp({ id: "player", carNumber: "45", teamName: "3SM Endurance", driverName: "Vincent", position: 6, classPosition: 2, lap: 101, gapToPlayerSeconds: 0, gapToLeaderSeconds: 12.3, lastLapSeconds: 92.4, bestLapSeconds: 91.8, isPlayer: true }),
  opp({ id: "p7", carNumber: "88", teamName: "Turn1 Tactics", driverName: "E. Smit", position: 7, classPosition: 3, lap: 101, gapToPlayerSeconds: 2.1, gapToLeaderSeconds: 15.0, lastLapSeconds: 92.8, bestLapSeconds: 92.2 }),
  opp({ id: "p8", carNumber: "12", teamName: "KartX", driverName: "T. de Wit", position: 8, classPosition: 3, lap: 100, gapToPlayerSeconds: 8.6, gapToLeaderSeconds: 18.4, lastLapSeconds: 93.0, bestLapSeconds: 92.5 }),
  opp({ id: "p9", carNumber: "99", teamName: "Paddock 7", driverName: "S. Visser", position: 9, classPosition: 4, lap: 100, inPit: true, gapToPlayerSeconds: null, gapToLeaderSeconds: null, lastLapSeconds: 92.9, bestLapSeconds: 92.3 }),
  opp({ id: "p10", carNumber: "33", teamName: "Pitwall Crew", driverName: "F. Jansen", position: 10, classPosition: 1, lap: 99, gapToPlayerSeconds: 22.0, gapToLeaderSeconds: 25.9, lastLapSeconds: 93.4, bestLapSeconds: 93.0 }),
  opp({ id: "p11", carNumber: "56", teamName: "Lotus Boys", driverName: "H. Mulder", position: 11, classPosition: 5, lap: 99, gapToPlayerSeconds: 31.2, gapToLeaderSeconds: 33.6, lastLapSeconds: 93.6, bestLapSeconds: 93.2 }),
  opp({ id: "p12", carNumber: "18", teamName: "Brake Later", driverName: "K. Evers", position: 12, classPosition: 4, lap: 98, gapToPlayerSeconds: 45.5, gapToLeaderSeconds: 47.9, lastLapSeconds: 94.0, bestLapSeconds: 93.5 }),
  opp({ id: "p13", carNumber: "64", teamName: "Fast Lane", driverName: "G. de Boer", position: 13, classPosition: 6, lap: 97, connected: false, gapToPlayerSeconds: null, gapToLeaderSeconds: null, lastLapSeconds: null, bestLapSeconds: 93.8 }),
  opp({ id: "p14", carNumber: "21", teamName: "Racing Depot", driverName: "P. Klein", position: 14, classPosition: 2, lap: 97, gapToPlayerSeconds: 88.3, gapToLeaderSeconds: 91.0, lastLapSeconds: 94.5, bestLapSeconds: 94.1 }),
  opp({ id: "p15", carNumber: "7", teamName: "Turn Point", driverName: "A. Bloem", position: 15, classPosition: 7, lap: 95, gapToPlayerSeconds: 135.7, gapToLeaderSeconds: 138.2, lastLapSeconds: 95.1, bestLapSeconds: 94.6 }),
  opp({ id: "p16", carNumber: "52", teamName: "Rietveld", driverName: "R. Bos", position: 16, classPosition: 3, lap: 93, gapToPlayerSeconds: null, gapToLeaderSeconds: null, lastLapSeconds: 95.4, bestLapSeconds: 95.0 }),
];

/* ============ EXPORT ============ */

const scenarios: Record<DemoScenario, DemoData> = {
  normal: {
    scenario: "normal", strategy: NORMAL_STRATEGY, events: NORMAL_EVENTS,
    teams: TEAMS, plannedStints: STINTS, alerts: NO_ALERTS, loading: false,
    position: { overallPosition: 6, classPosition: 2, gapToLeaderSeconds: 42.8 },
    pace: { lastLapSeconds: 92.4, bestLapSeconds: 91.8, stintAvgSeconds: 93.1, targetSeconds: 92.0 },
    raceClock: { remainingSeconds: 9692, remainingLaps: 57 },
    opponents: DEMO_OPPONENTS,
  },
  pit: {
    scenario: "pit", strategy: PIT_STRATEGY, events: PIT_EVENTS,
    teams: TEAMS, plannedStints: STINTS, alerts: PIT_HIGH_ALERTS, loading: false,
    position: { overallPosition: 6, classPosition: 2, gapToLeaderSeconds: 18.3 },
    pace: { lastLapSeconds: 93.1, bestLapSeconds: 91.8, stintAvgSeconds: 93.5, targetSeconds: 92.0 },
    raceClock: { remainingSeconds: 8300, remainingLaps: 49 },
    opponents: DEMO_OPPONENTS,
  },
  "low-data": {
    scenario: "low-data", strategy: LOW_DATA_STRATEGY, events: LOW_DATA_EVENTS,
    teams: TEAMS, plannedStints: STINTS, alerts: LOW_DATA_INFO_ALERTS, loading: false,
    position: { overallPosition: 14, classPosition: 5, gapToLeaderSeconds: 15.2 },
    pace: { lastLapSeconds: 106.1, bestLapSeconds: 104.8, stintAvgSeconds: 105.7, targetSeconds: null },
    raceClock: { remainingSeconds: 20500, remainingLaps: null },
    opponents: [],
  },
  offline: {
    scenario: "offline", strategy: OFFLINE_STRATEGY, events: OFFLINE_EVENTS,
    teams: TEAMS, plannedStints: STINTS, alerts: OFFLINE_HIGH_ALERTS, loading: false,
    position: { overallPosition: null, classPosition: null, gapToLeaderSeconds: null },
    pace: { lastLapSeconds: null, bestLapSeconds: 91.8, stintAvgSeconds: null, targetSeconds: 92.0 },
    raceClock: { remainingSeconds: null, remainingLaps: null },
    opponents: [],
  },
};

export const getDemoData = (scenario: DemoScenario): DemoData => scenarios[scenario];

export const DEMO_SCENARIO_LIST: Array<{ id: DemoScenario; label: string }> = [
  { id: "normal", label: "Normale race" },
  { id: "pit", label: "Pit deze ronde" },
  { id: "low-data", label: "Weinig data" },
  { id: "offline", label: "Telemetrie verloren" },
];