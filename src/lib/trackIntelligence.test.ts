import { describe, expect, it } from "vitest";
import {
  analyzeTrackHistory,
  buildMemberTrackRowsFromSiteResults,
  dedupeTrackHistoryRows,
  getTrackReliability,
  isUsableTrackName,
  normalizeRecentRace,
  type MemberTrackHistoryRow,
} from "./trackIntelligence";

const row = (overrides: Partial<MemberTrackHistoryRow>): MemberTrackHistoryRow => ({
  member_id: "member-1",
  iracing_customer_id: "1001",
  iracing_name: "Driver One",
  track_id: null,
  track_name: "Spa-Francorchamps",
  race_date: "2026-06-01T19:00:00.000Z",
  subsession_id: null,
  series_name: null,
  source: "site_result_json",
  first_seen_at: "2026-06-01T20:00:00.000Z",
  last_seen_at: "2026-06-01T20:00:00.000Z",
  ...overrides,
});

describe("track intelligence analysis", () => {
  it("starts empty when no real history rows are present", () => {
    const result = analyzeTrackHistory([], 4);

    expect(result).toEqual([]);
  });

  it("counts unique members per real track and calculates percentage of linked members", () => {
    const result = analyzeTrackHistory([
      row({ member_id: "member-1", iracing_customer_id: "1001", track_name: "Spa-Francorchamps", last_seen_at: "2026-06-01T20:00:00.000Z" }),
      row({ member_id: "member-1", iracing_customer_id: "1001", track_name: "Spa-Francorchamps", subsession_id: "sub-duplicate", last_seen_at: "2026-06-02T20:00:00.000Z" }),
      row({ member_id: "member-2", iracing_customer_id: "1002", track_name: "Spa-Francorchamps", source: "iracing_recent_races", last_seen_at: "2026-06-03T20:00:00.000Z" }),
      row({ member_id: "member-3", iracing_customer_id: "1003", track_name: "Road Atlanta", last_seen_at: "2026-05-30T20:00:00.000Z" }),
    ], 4, new Date("2026-06-14T00:00:00.000Z"));

    expect(result[0]).toMatchObject({
      trackName: "Spa-Francorchamps",
      uniqueMemberCount: 2,
      percentage: 50,
      sources: ["iracing_recent_races", "site_result_json"],
      reliability: "Hoog",
      lastSeenAt: "2026-06-03T20:00:00.000Z",
    });
    expect(result[1]).toMatchObject({
      trackName: "Road Atlanta",
      uniqueMemberCount: 1,
      percentage: 25,
      reliability: "Middel",
    });
  });

  it("filters generic layout names while keeping real track names with circuit words", () => {
    expect(isUsableTrackName("Circuit")).toBe(false);
    expect(isUsableTrackName("Circuit - Medium")).toBe(false);
    expect(isUsableTrackName("International")).toBe(false);
    expect(isUsableTrackName("Roval")).toBe(false);
    expect(isUsableTrackName("Oval - Left turning")).toBe(false);
    expect(isUsableTrackName("Oval - Right turning")).toBe(false);
    expect(isUsableTrackName("Oval - 2008")).toBe(false);
    expect(isUsableTrackName("Roval 2019")).toBe(false);
    expect(isUsableTrackName("Roval 2025")).toBe(false);
    expect(isUsableTrackName("Rallycross")).toBe(false);
    expect(isUsableTrackName("Daytona Rallycross and Dirt Road")).toBe(true);
    expect(isUsableTrackName("Watkins Glen International")).toBe(true);
    expect(isUsableTrackName("Oulton Park Circuit - International")).toBe(true);
    expect(isUsableTrackName("Charlotte Motor Speedway - Roval")).toBe(true);

    const result = analyzeTrackHistory([
      row({ member_id: "member-1", track_name: "Circuit", source: "extension_scan" }),
      row({ member_id: "member-2", track_name: "International", source: "extension_scan" }),
      row({ member_id: "member-3", track_name: "Circuit - Medium", source: "extension_scan" }),
      row({ member_id: "member-4", track_name: "Watkins Glen International", source: "extension_scan" }),
    ], 4);

    expect(result.map((track) => track.trackName)).toEqual(["Watkins Glen International"]);
  });

  it("marks reliability high when many linked members have demonstrably driven the track", () => {
    expect(getTrackReliability({ percentage: 76, uniqueMemberCount: 8, lastSeenAt: "2026-01-01T00:00:00.000Z" }, new Date("2026-06-01T00:00:00.000Z"))).toBe("Hoog");
  });
});

describe("track intelligence import helpers", () => {
  it("deduplicates the same race by subsession id or customer-track-date combination", () => {
    const deduped = dedupeTrackHistoryRows([
      row({ subsession_id: "abc", track_name: "Autodromo Nazionale Monza" }),
      row({ subsession_id: "abc", track_name: "Autodromo Nazionale Monza", last_seen_at: "2026-06-02T20:00:00.000Z" }),
      row({ subsession_id: null, iracing_customer_id: "1001", track_id: "42", race_date: "2026-06-01T19:00:00.000Z" }),
      row({ subsession_id: null, iracing_customer_id: "1001", track_id: "42", race_date: "2026-06-01T19:00:00.000Z" }),
    ]);

    expect(deduped).toHaveLength(2);
    expect(deduped[0].last_seen_at).toBe("2026-06-02T20:00:00.000Z");
  });

  it("builds site_result_json history rows from existing real race results and race tracks", () => {
    const rows = buildMemberTrackRowsFromSiteResults([
      {
        id: "race-1",
        track: "Watkins Glen International",
        race_date: "2026-05-12T19:30:00.000Z",
        iracing_session_id: "987654",
        league_name: "GT3 Cup",
        results: [
          { user_id: "member-1", iracing_cust_id: "1001", profiles: { display_name: "Driver One", iracing_name: "D. One", iracing_id: "1001" } },
          { user_id: "member-2", iracing_cust_id: null, profiles: { display_name: "Driver Two", iracing_name: null, iracing_id: "1002" } },
        ],
      },
      {
        id: "race-empty-track",
        track: "",
        race_date: "2026-05-19T19:30:00.000Z",
        iracing_session_id: null,
        league_name: null,
        results: [{ user_id: "member-3", iracing_cust_id: "1003", profiles: { display_name: "Driver Three", iracing_name: null, iracing_id: "1003" } }],
      },
    ], "2026-06-14T12:00:00.000Z");

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      member_id: "member-1",
      iracing_customer_id: "1001",
      iracing_name: "D. One",
      track_name: "Watkins Glen International",
      subsession_id: "987654",
      series_name: "GT3 Cup",
      source: "site_result_json",
    });
  });

  it("normalizes iRacing recent race API shapes without inventing track data", () => {
    expect(normalizeRecentRace({ subsession_id: 123, track: { track_id: 45, track_name: "Sebring International Raceway" }, start_time: "2026-06-10T20:00:00Z", series_name: "GT Sprint" })).toEqual({
      trackId: "45",
      trackName: "Sebring International Raceway",
      raceDate: "2026-06-10T20:00:00Z",
      subsessionId: "123",
      seriesName: "GT Sprint",
    });
    expect(normalizeRecentRace({ subsession_id: 124, start_time: "2026-06-10T20:00:00Z" })).toBeNull();
    expect(normalizeRecentRace({ subsession_id: 125, track_name: "Circuit", start_time: "2026-06-10T20:00:00Z" })).toBeNull();
  });
});
