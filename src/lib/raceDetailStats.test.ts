import { describe, expect, it } from "vitest";
import { getRaceDetailStats, type RaceDetailStatsResult } from "./raceDetailStats";

const result = (overrides: Partial<RaceDetailStatsResult>): RaceDetailStatsResult => ({
  user_id: crypto.randomUUID(),
  position: null,
  start_position: null,
  laps: null,
  laps_led: null,
  best_lap: null,
  best_lap_num: null,
  avg_lap: null,
  fastest_lap: false,
  incidents: null,
  dnf: false,
  points: null,
  profiles: null,
  ...overrides,
});

describe("getRaceDetailStats", () => {
  it("derives public race detail highlights from imported race results", () => {
    const stats = getRaceDetailStats([
      result({ user_id: "winner", position: 1, laps: 19, best_lap: "1:36.580", fastest_lap: false, incidents: 3, points: 40, profiles: { display_name: "Vincent Weijts", iracing_name: null } }),
      result({ user_id: "p2", position: 2, laps: 19, best_lap: "1:36.878", fastest_lap: false, incidents: 13, points: 35, profiles: { display_name: "Kevin Vanzoest", iracing_name: null } }),
      result({ user_id: "fastest", position: 9, laps: 19, best_lap: "1:35.851", fastest_lap: true, incidents: 4, points: 12, profiles: { display_name: "Vincent deVos", iracing_name: null } }),
      result({ user_id: "clean", position: 10, laps: 19, best_lap: "1:38.431", fastest_lap: false, incidents: 0, points: 1, profiles: { display_name: "Bram Duitscher", iracing_name: null } }),
      result({ user_id: "dnf", position: 11, laps: 7, best_lap: null, fastest_lap: false, incidents: 2, dnf: true, points: 0, profiles: { display_name: "Disconnected Driver", iracing_name: null } }),
    ]);

    expect(stats.winner?.name).toBe("Vincent Weijts");
    expect(stats.podium.map((driver) => driver.name)).toEqual(["Vincent Weijts", "Kevin Vanzoest", "Vincent deVos"]);
    expect(stats.fastest?.name).toBe("Vincent deVos");
    expect(stats.cleanest?.name).toBe("Bram Duitscher");
    expect(stats.finishers).toBe(4);
    expect(stats.dnfCount).toBe(1);
    expect(stats.totalIncidents).toBe(22);
    expect(stats.totalLaps).toBe(83);
  });

  it("derives pole sitter, biggest mover and laps led leader from enriched iRacing fields", () => {
    const stats = getRaceDetailStats([
      result({ user_id: "winner", position: 1, start_position: 3, laps_led: 4, profiles: { display_name: "Winner", iracing_name: null } }),
      result({ user_id: "pole", position: 4, start_position: 1, laps_led: 0, profiles: { display_name: "Pole Sitter", iracing_name: null } }),
      result({ user_id: "mover", position: 2, start_position: 9, laps_led: 2, profiles: { display_name: "Big Mover", iracing_name: null } }),
      result({ user_id: "leader", position: 3, start_position: 2, laps_led: 14, profiles: { display_name: "Lap Leader", iracing_name: null } }),
    ]);

    expect(stats.pole?.name).toBe("Pole Sitter");
    expect(stats.biggestMover?.name).toBe("Big Mover");
    expect(stats.biggestMover?.positionGain).toBe(7);
    expect(stats.mostLapsLed?.name).toBe("Lap Leader");
  });
});
