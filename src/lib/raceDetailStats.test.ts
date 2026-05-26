import { describe, expect, it } from "vitest";
import { getRaceDetailStats, type RaceDetailStatsResult } from "./raceDetailStats";

const result = (overrides: Partial<RaceDetailStatsResult>): RaceDetailStatsResult => ({
  user_id: crypto.randomUUID(),
  position: null,
  laps: null,
  best_lap: null,
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
});
