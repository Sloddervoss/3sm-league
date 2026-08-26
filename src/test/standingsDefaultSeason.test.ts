import { describe, expect, it } from "vitest";
import { selectDefaultStandingsLeagueId, type StandingsSeasonRace } from "@/lib/standingsSeason";

const leagues = [{ id: "new-season" }, { id: "current-season" }];
const race = (league_id: string, race_date: string, status: string): StandingsSeasonRace => ({ league_id, race_date, status });

describe("default standings season", () => {
  it("keeps the current season selected while its final race is not finished", () => {
    expect(selectDefaultStandingsLeagueId(leagues, [
      race("current-season", "2026-09-02T18:30:00Z", "upcoming"),
      race("new-season", "2026-09-09T18:30:00Z", "upcoming"),
    ])).toBe("current-season");
  });

  it("moves to the next season only after the current season has ended", () => {
    expect(selectDefaultStandingsLeagueId(leagues, [
      race("current-season", "2026-09-02T18:30:00Z", "completed"),
      race("new-season", "2026-09-09T18:30:00Z", "upcoming"),
    ])).toBe("new-season");
  });

  it("ignores cancelled races when deciding which season is still active", () => {
    expect(selectDefaultStandingsLeagueId(leagues, [
      race("current-season", "2026-09-02T18:30:00Z", "cancelled"),
      race("new-season", "2026-09-09T18:30:00Z", "upcoming"),
    ])).toBe("new-season");
  });

  it("falls back to the league with the most recently finished race", () => {
    expect(selectDefaultStandingsLeagueId(leagues, [
      race("new-season", "2026-07-01T18:30:00Z", "completed"),
      race("current-season", "2026-08-19T18:30:00Z", "completed"),
    ])).toBe("current-season");
  });
});
