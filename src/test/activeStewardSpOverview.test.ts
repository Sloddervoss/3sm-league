import { describe, expect, it } from "vitest";
import { calculateActiveSpOverview } from "@/features/control-room/stewarding/activeSpOverview";
import type { SpPenalty, SpRaceHistory } from "@/features/control-room/stewarding/activeSpOverview";

const history = (raceIds: string[], leagueId: string | null = "league-a"): SpRaceHistory[] => raceIds.map((raceId, index) => ({
  user_id: "driver-1",
  race_id: raceId,
  races: { id: raceId, league_id: leagueId, race_date: `2026-01-${String(20 - index).padStart(2, "0")}T20:00:00Z` },
}));

const penalty = (raceId: string, sp: number, date = "2026-01-01T20:00:00Z"): SpPenalty => ({
  id: `penalty-${raceId}`,
  user_id: "driver-1",
  race_id: raceId,
  league_id: "league-a",
  penalty_sp: sp,
  penalty_type: "time_penalty",
  penalty_category: "B",
  reason: "Legacy test penalty",
  created_at: date,
  profile: { user_id: "driver-1", display_name: "Driver", iracing_name: "Driver One" },
  races: { id: raceId, name: raceId, race_date: date, league_id: "league-a", leagues: { name: "GT", season: 1 } },
});

describe("active steward SP overview", () => {
  it("keeps a penalty active through the driver's six most recent races and reports expiry", () => {
    const overview = calculateActiveSpOverview([penalty("race-3", 3, "2026-01-18T20:00:00Z")], history(["race-1", "race-2", "race-3", "race-4", "race-5", "race-6"]));

    expect(overview).toHaveLength(1);
    expect(overview[0]).toMatchObject({ totalSp: 3, leagueName: "GT S1", racesUntilExpiry: 3 });
  });

  it("expires a dated penalty outside a full six-race window, but retains it before six results exist", () => {
    const oldPenalty = penalty("old-race", 5, "2025-12-01T20:00:00Z");
    expect(calculateActiveSpOverview([oldPenalty], history(["race-1", "race-2", "race-3", "race-4", "race-5", "race-6"]))).toEqual([]);
    expect(calculateActiveSpOverview([oldPenalty], history(["race-1", "race-2", "race-3"]))).toHaveLength(1);
  });

  it("keeps unknown penalty history active and never mixes league contexts", () => {
    const standalone = penalty("missing-result", 10, "2025-12-01T20:00:00Z");
    const otherLeagueHistory = history(["race-1", "race-2", "race-3", "race-4", "race-5", "race-6"], "league-b");

    const overview = calculateActiveSpOverview([standalone], otherLeagueHistory);
    expect(overview).toHaveLength(1);
    expect(overview[0]).toMatchObject({ totalSp: 10, racesUntilExpiry: 1 });
  });
});
