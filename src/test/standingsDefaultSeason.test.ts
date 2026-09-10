import { describe, expect, it } from "vitest";
import { selectDefaultStandingsLeagueId, type StandingsSeasonRace } from "@/lib/standingsSeason";

const leagues = [{ id: "new-season" }, { id: "current-season" }];
const race = (league_id: string, race_date: string, status: string): StandingsSeasonRace => ({ league_id, race_date, status });

/** Race met een embedded uitslagtelling, zoals PostgREST die teruggeeft. */
const raceWithResults = (
  league_id: string,
  race_date: string,
  status: string,
  count: number,
): StandingsSeasonRace => ({ league_id, race_date, status, race_results: [{ count }] });

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

  describe("seizoen met uitslagen gaat voor op een leeg nieuw seizoen", () => {
    it("kiest het seizoen met de nieuwste uitslag, niet het seizoen dat als volgende racet", () => {
      expect(selectDefaultStandingsLeagueId(leagues, [
        // nieuw seizoen: kalender klaar, nog geen race gereden
        raceWithResults("new-season", "2026-09-17T18:30:00Z", "upcoming", 0),
        // lopend seizoen: gisteren gereden
        raceWithResults("current-season", "2026-09-09T18:30:00Z", "completed", 7),
      ])).toBe("current-season");
    });

    it("negeert een afgerond seizoen zodra een recenter seizoen uitslagen heeft", () => {
      expect(selectDefaultStandingsLeagueId(leagues, [
        raceWithResults("new-season", "2026-09-09T18:30:00Z", "completed", 7),
        raceWithResults("current-season", "2026-09-02T18:30:00Z", "completed", 104),
      ])).toBe("new-season");
    });

    it("schakelt over zodra het nieuwe seizoen zijn eerste uitslag heeft", () => {
      expect(selectDefaultStandingsLeagueId(leagues, [
        raceWithResults("new-season", "2026-09-17T18:30:00Z", "completed", 5),
        raceWithResults("current-season", "2026-09-09T18:30:00Z", "completed", 7),
      ])).toBe("new-season");
    });

    it("valt terug op de eerstvolgende race als nog geen enkel seizoen uitslagen heeft", () => {
      expect(selectDefaultStandingsLeagueId(leagues, [
        raceWithResults("current-season", "2026-09-02T18:30:00Z", "upcoming", 0),
        raceWithResults("new-season", "2026-09-09T18:30:00Z", "upcoming", 0),
      ])).toBe("current-season");
    });
  });
});
