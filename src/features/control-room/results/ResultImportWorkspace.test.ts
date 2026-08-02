import { describe, expect, it } from "vitest";
import {
  buildResultImportHostingCostDraft,
  classifyImportParticipants,
  findLockedCarMismatches,
  type CarLockData,
  type ResultImportParticipant,
} from "./ResultImportWorkspace";

describe("result-import racehosting", () => {
  const sprintRace = {
    id: "race-a",
    name: "Race 1",
    track: "Spa",
    race_date: "2026-08-02T18:00:00.000Z",
    league_id: "league-a",
    race_type: "Sprint",
    leagues: { name: "Sprint Cup", season: "2026" },
  };

  it("builds the first-booking draft from the selected race, hours and discount", () => {
    expect(buildResultImportHostingCostDraft(sprintRace, 2, true, 0.92)).toEqual({
      raceId: "race-a",
      raceScope: "season",
      leagueId: "league-a",
      leagueName: "Sprint Cup",
      season: "2026",
      raceName: "Race 1",
      track: "Spa",
      date: "2026-08-02",
      raceFormat: "Sprint",
      hostedHours: 2,
      discountApplied: true,
      exchangeRateUsdEur: 0.92,
      isPublic: true,
      note: "Vastgelegd tijdens resultatenimport",
    });
  });

  it("rejects invalid hours and fail-closed race formats without blocking result imports", () => {
    expect(buildResultImportHostingCostDraft(sprintRace, 0, false, 0.92)).toBeNull();
    expect(buildResultImportHostingCostDraft(sprintRace, 1, false, 0)).toBeNull();
    expect(buildResultImportHostingCostDraft({ ...sprintRace, race_type: "FutureFormat" }, 1, false, 0.92)).toBeNull();
    expect(buildResultImportHostingCostDraft({ ...sprintRace, league_id: null, name: "Night Endurance", race_type: "Feature", leagues: null }, 3, false, 0.92)).toBeNull();
  });
});

const participant = (userId: string, position: number, bestLap: string, fastestLap = false, carName = "Ferrari 296 GT3"): ResultImportParticipant => ({
  row: {
    position,
    display_name: userId,
    laps: 20,
    best_lap: bestLap,
    incidents: 0,
    fastest_lap: fastestLap,
    car_name: carName,
  },
  profile: { user_id: userId, display_name: userId, iracing_name: userId, iracing_id: userId },
  matchStatus: "matched-id",
  points: 0,
});

describe("locked-car JSON import policy", () => {
  const locks: CarLockData = {
    seasonRegistrations: [{ user_id: "season-driver", car_choice: "Porsche 911 GT3 R", car_locked: true }],
    raceRegistrations: [{ user_id: "race-driver", car_choice: "BMW M4 GT3", car_locked: true }],
  };

  it("uses a full-season entrant's season lock before any race-registration lock", () => {
    expect(findLockedCarMismatches({
      mode: "json",
      leagueId: "league-a",
      participants: [participant("season-driver", 1, "1:20.000")],
      carLocks: locks,
    })).toEqual([{ userId: "season-driver", driver: "season-driver", lockedCar: "Porsche 911 GT3 R", importedCar: "Ferrari 296 GT3" }]);
  });

  it("uses only a race-by-race entrant's locked registration for the selected league", () => {
    expect(findLockedCarMismatches({
      mode: "json",
      leagueId: "league-a",
      participants: [participant("race-driver", 1, "1:20.000", false, "BMW M4 GT3")],
      carLocks: locks,
    })).toEqual([]);
  });

  it("never warns for manual imports or standalone races", () => {
    const participants = [participant("season-driver", 1, "1:20.000")];
    expect(findLockedCarMismatches({ mode: "manual", leagueId: "league-a", participants, carLocks: locks })).toEqual([]);
    expect(findLockedCarMismatches({ mode: "json", leagueId: null, participants, carLocks: locks })).toEqual([]);
  });
});

describe("classifyImportParticipants", () => {
  it("gives a selected locked-car DQ zero points/DNF, promotes classification, and reassigns fastest lap", () => {
    const classified = classifyImportParticipants([
      participant("dq-driver", 1, "1:20.000", true),
      participant("promoted-driver", 2, "1:21.000"),
      participant("third-driver", 3, "1:22.000"),
    ], ["dq-driver"], [25, 20, 16]);

    expect(classified.map(({ profile, position, points, fastestLap, isDq }) => ({ userId: profile?.user_id, position, points, fastestLap, isDq }))).toEqual([
      { userId: "dq-driver", position: 1, points: 0, fastestLap: false, isDq: true },
      { userId: "promoted-driver", position: 1, points: 26, fastestLap: true, isDq: false },
      { userId: "third-driver", position: 2, points: 20, fastestLap: false, isDq: false },
    ]);
  });

  it("does not invent a fastest-lap point when the disqualified fastest driver has no usable replacement lap", () => {
    const classified = classifyImportParticipants([
      participant("dq-driver", 1, "1:20.000", true),
      participant("promoted-driver", 2, "not-a-lap"),
    ], ["dq-driver"], [25, 20]);

    expect(classified.map(({ profile, points, fastestLap }) => ({ userId: profile?.user_id, points, fastestLap }))).toEqual([
      { userId: "dq-driver", points: 0, fastestLap: false },
      { userId: "promoted-driver", points: 25, fastestLap: false },
    ]);
  });

  it("preserves the JSON fastest-lap flag when no selected mismatch is disqualified", () => {
    const classified = classifyImportParticipants([
      participant("winner", 1, "1:21.000"),
      participant("fastest", 2, "1:20.000", true),
    ], [], [25, 20]);

    expect(classified.map(({ profile, points, fastestLap, isDq }) => ({ userId: profile?.user_id, points, fastestLap, isDq }))).toEqual([
      { userId: "winner", points: 25, fastestLap: false, isDq: false },
      { userId: "fastest", points: 21, fastestLap: true, isDq: false },
    ]);
  });
});
