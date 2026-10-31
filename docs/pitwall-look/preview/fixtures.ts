/*
 * Screenshot-fixtures voor de pitwall-look.
 *
 * Dit is GEEN applicatiecode: het bestand staat buiten `src/`, wordt door geen
 * enkele route geïmporteerd en komt niet in de build. Het bestaat alleen om de
 * echte componenten met representatieve invoer op 1920×1080 te fotograferen,
 * omdat deze omgeving geen Supabase-env of inloggegevens heeft.
 *
 * De vorm van de data is die van `v3_normalized` en `get_pitwall_data`; de
 * waarden zijn verzonnen voorbeeldwaarden, niet uit een race gelezen.
 */
import { parseTyreTelemetry } from "../../../supabase/functions/_shared/tyreTelemetry";
import baseline from "../../../tools/simhub-plugin/3SM.EnduranceConnector.DiagnosticsTests/Fixtures/v3-frame-baseline.json";

import type {
  PitwallPlannedStint,
  PitwallStrategyRow,
  PitwallTimelineEvent,
  V3Normalized,
  V3Opponent,
} from "../../../src/features/endurance/pitwall/pitwallHelpers";

const now = Date.now();
const iso = (offsetSeconds: number) => new Date(now + offsetSeconds * 1000).toISOString();

const opp = (o: Partial<V3Opponent> & { id: string }): V3Opponent => ({
  carNumber: null,
  driverName: null,
  teamName: null,
  carClass: "GT3",
  carClassId: "gt3",
  position: null,
  classPosition: null,
  lap: null,
  lapDistancePct: null,
  gapToPlayerSeconds: null,
  gapToLeaderSeconds: null,
  lastLapSeconds: null,
  bestLapSeconds: null,
  inPit: false,
  connected: true,
  isPlayer: false,
  ...o,
});

export const fixtureOpponents: V3Opponent[] = [
  opp({ id: "p1", carNumber: "11", driverName: "M. vd Berg", teamName: "Apex Racing", position: 1, classPosition: 1, lap: 104, lapDistancePct: 0.62, gapToPlayerSeconds: -42.8, gapToLeaderSeconds: 0, lastLapSeconds: 91.2, bestLapSeconds: 90.9 }),
  opp({ id: "p2", carNumber: "77", driverName: "R. Godefrooij", teamName: "Naober Racing", position: 2, classPosition: 2, lap: 104, lapDistancePct: 0.51, gapToPlayerSeconds: -30.1, gapToLeaderSeconds: 1.8, lastLapSeconds: 91.8, bestLapSeconds: 91.4 }),
  opp({ id: "p3", carNumber: "23", driverName: "J. Wever", teamName: "Paardekracht", position: 3, classPosition: 3, lap: 103, lapDistancePct: 0.44, gapToPlayerSeconds: -21.5, gapToLeaderSeconds: 3.2, lastLapSeconds: 92.1, bestLapSeconds: 91.6 }),
  opp({ id: "p4", carNumber: "45", driverName: "D. Bakker", teamName: "3SM Rookie", position: 4, classPosition: 4, lap: 103, lapDistancePct: 0.38, gapToPlayerSeconds: -14.0, gapToLeaderSeconds: 6.4, lastLapSeconds: 92.4, bestLapSeconds: 92.0 }),
  opp({ id: "p5", carNumber: "28", driverName: "L. Post", teamName: "SimRanks", position: 5, classPosition: 5, lap: 102, lapDistancePct: 0.31, gapToPlayerSeconds: -3.4, gapToLeaderSeconds: 9.1, lastLapSeconds: 91.9, bestLapSeconds: 91.7 }),
  opp({ id: "player", carNumber: "45", driverName: "V. de Vos", teamName: "3 Stumpe Motorsport", position: 6, classPosition: 6, lap: 101, lapDistancePct: 0.18, gapToPlayerSeconds: 0, gapToLeaderSeconds: 12.3, lastLapSeconds: 92.412, bestLapSeconds: 91.804, isPlayer: true }),
  opp({ id: "p7", carNumber: "88", driverName: "E. Smit", teamName: "Turn1 Tactics", position: 7, classPosition: 7, lap: 101, lapDistancePct: 0.12, gapToPlayerSeconds: 2.1, gapToLeaderSeconds: 15.0, lastLapSeconds: 92.8, bestLapSeconds: 92.2 }),
  opp({ id: "p8", carNumber: "12", driverName: "T. de Wit", teamName: "KartX", position: 8, classPosition: 8, lap: 100, lapDistancePct: 0.05, gapToPlayerSeconds: 8.6, gapToLeaderSeconds: 18.4, lastLapSeconds: 93.0, bestLapSeconds: 92.5 }),
  opp({ id: "p9", carNumber: "99", driverName: "S. Visser", teamName: "Paddock 7", position: 9, classPosition: 9, lap: 100, lapDistancePct: 0.93, inPit: true, lastLapSeconds: 92.9, bestLapSeconds: 92.3 }),
  opp({ id: "p10", carNumber: "33", driverName: "F. Jansen", teamName: "Pitwall Crew", carClass: "LMP2", carClassId: "lmp2", position: 10, classPosition: 1, lap: 99, lapDistancePct: 0.86, gapToPlayerSeconds: 22.0, gapToLeaderSeconds: 25.9, lastLapSeconds: 89.4, bestLapSeconds: 89.0 }),
  opp({ id: "p11", carNumber: "56", driverName: "H. Mulder", teamName: "Lotus Boys", carClass: "LMP2", carClassId: "lmp2", position: 11, classPosition: 2, lap: 99, lapDistancePct: 0.74, gapToPlayerSeconds: 31.2, gapToLeaderSeconds: 33.6, lastLapSeconds: 89.6, bestLapSeconds: 89.2 }),
  opp({ id: "p12", carNumber: "18", driverName: "K. Evers", teamName: "Brake Later", carClass: "LMP2", carClassId: "lmp2", position: 12, classPosition: 3, lap: 98, lapDistancePct: 0.66, gapToPlayerSeconds: 45.5, gapToLeaderSeconds: 47.9, lastLapSeconds: 90.0, bestLapSeconds: 89.5 }),
  opp({ id: "p13", carNumber: "64", driverName: "G. de Boer", teamName: "Fast Lane", position: 13, classPosition: 10, lap: 97, lapDistancePct: null, connected: false, lastLapSeconds: null, bestLapSeconds: 93.8 }),
  opp({ id: "p14", carNumber: "21", driverName: "P. Klein", teamName: "Racing Depot", position: 14, classPosition: 11, lap: 97, lapDistancePct: 0.27, gapToPlayerSeconds: 88.3, gapToLeaderSeconds: 91.0, lastLapSeconds: 94.5, bestLapSeconds: 94.1 }),
];

export const fixtureV3: V3Normalized = {
  capturedAt: new Date(now).toISOString(),
  transportSessionId: "preview-session",
  identity: {
    trackName: "Circuit de Spa-Francorchamps",
    // Exact bestaande manifestlayout, alleen voor deze lokale fixture.
    trackId: 163,
    trackConfig: "Grand Prix Pits - 2010",
    currentDriverName: "V. de Vos",
    carName: "Porsche 911 GT3 R",
  },
  session: { sessionTimeSeconds: baseline.session.sessionTimeSeconds, isInCar: true, sessionTimeRemainingSeconds: 12257, sessionLapsRemaining: 57, sessionState: "racing" },
  timing: { lastLapTimeSeconds: 103.162, bestLapTimeSeconds: 102.513, completedLaps: 142, currentLapElapsedSeconds: 38.2 },
  position: { position: 6, classPosition: 5, gapToLeaderSeconds: 12.3 },
  track: { lapDistancePct: 0.18, trackSurface: "on_track", onPitRoad: false },
  fuel: { fuelLitres: 68.4, fuelCapacityLitres: 100 },
  opponents: fixtureOpponents,
  // Expliciete plugin-testfixture, geen live meting. Zelfde normalisatie als ingest.
  tyres: parseTyreTelemetry(baseline.tyres),
  vehicle: {
    speedKph: 187,
    throttlePct: 100,
    brakePct: 0,
    rpm: 7120,
    gear: "6",
    sector1Seconds: 31.482,
    sector2Seconds: 42.763,
    sector3Seconds: 28.917,
    tyreDataMode: "last_available",
    temperatureUnit: "C",
    pressureUnit: "psi",
    frontLeft: { wearPercent: 62, temperature: 84.0, pressure: 26.4 },
    frontRight: { wearPercent: 58, temperature: 86.0, pressure: 26.8 },
    rearLeft: { wearPercent: 71, temperature: 79.0, pressure: 25.6 },
    rearRight: { wearPercent: 68, temperature: 80.0, pressure: 25.9 },
  } as V3Normalized["vehicle"],
};

export const fixtureStrategy: PitwallStrategyRow = {
  race_run_id: "preview-run",
  event_id: "preview-event",
  team_id: "preview-team",
  fuel_per_lap_litres: 3.12,
  race_fuel_per_lap_litres: 3.08,
  fuel_laps_remaining: 21.9,
  valid_fuel_sample_count: 47,
  current_stint_valid_sample_count: 22,
  current_fuel_stint: 4,
  last_completed_laps: 142,
  current_fuel_litres: 68.4,
  session_laps_remaining: 57,
  fuel_to_finish_litres: 177.8,
  fuel_sufficient_to_finish: true,
  strategy_status: "ready",
  strategy_reason: null,
  updated_at: new Date(now).toISOString(),
  fuel_to_add_litres: 31,
};

export const fixtureStints: PitwallPlannedStint[] = [
  { id: "s1", driver_id: "Vincent", original_start_at: iso(-7200), original_end_at: iso(1200), actual_start_at: iso(-5400), actual_end_at: null, expected_laps: 35, fuel_litres: 90, tyre_change: false, double_stint: false, status: "in_car", notes: null },
  { id: "s2", driver_id: "Jason", original_start_at: iso(1200), original_end_at: iso(5400), actual_start_at: null, actual_end_at: null, expected_laps: 32, fuel_litres: 85, tyre_change: true, double_stint: false, status: "draft", notes: null },
  { id: "s3", driver_id: "Ricky", original_start_at: iso(5400), original_end_at: iso(9600), actual_start_at: null, actual_end_at: null, expected_laps: 34, fuel_litres: 88, tyre_change: false, double_stint: false, status: "draft", notes: null },
];

const event = (type: string, lap: number, lapTime: number | null, overrides: Partial<PitwallTimelineEvent> = {}): PitwallTimelineEvent => ({
  event_type: type,
  event_key: `${type}:${lap}`,
  lap,
  completed_laps: lap,
  fuel_litres: null,
  fuel_per_lap_litres: null,
  fuel_added_est_litres: null,
  laps_remaining_est: null,
  driver_id: null,
  in_pit_lane: null,
  incidents: null,
  flag: null,
  stint_elapsed_s: null,
  session_time_s: null,
  lap_time_from_deltas_s: lapTime,
  captured_at: iso(-(150 - lap) * 105),
  payload: null,
  ...overrides,
});

/** 30 rondjes met een pitstop op ronde 132: de grafiek krijgt een echte onderbreking. */
export const fixtureEvents: PitwallTimelineEvent[] = [
  ...Array.from({ length: 30 }, (_, i) => {
    const lap = 113 + i;
    const base = 102.6 + Math.sin(i / 2.2) * 0.55 - i * 0.015;
    return event("lap_completed", lap, Number(base.toFixed(3)));
  }),
  event("pit_entry", 132, null, { in_pit_lane: true, fuel_litres: 8.4 }),
  event("pit_exit", 132, null, { fuel_added_est_litres: 88, driver_id: "Vincent" }),
];

export const fixtureAlerts = [{ severity: "info" as const, message: "Ronde 143: de pitwindow opent over 6 rondes." }];

/* ── Testmodus ─────────────────────────────────────────────────────────── */

export const fixtureSandboxLaps = Array.from({ length: 18 }, (_, i) => ({
  lap: i + 1,
  seconds: Number((102.9 + Math.sin(i / 1.7) * 0.8 - i * 0.03).toFixed(3)),
  driver: "Vincent",
}));

export const fixtureSandboxPace = {
  fastest: Math.min(...fixtureSandboxLaps.map((l) => l.seconds)),
  median: 102.6,
  count: fixtureSandboxLaps.length,
};
