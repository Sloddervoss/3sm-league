import { describe, it, expect } from "vitest";
import { findPublishedSpecialSeason } from "../../supabase/functions/iracing-special-events-sync/discovery.ts";
import { normalizeSpecialEvent } from "../../supabase/functions/iracing-special-events-sync/normalize.ts";
const seed = { sourceKey: "iracing:2026:suzuka-1000km", name: "Suzuka 1000km", year: 2026 };
const season = { season_id: 6618, series_id: 597, season_year: 2026, season_name: "2026 Suzuka 1000km Presented by PIMAX" };
describe("daily approved special-event discovery", () => {
  it("discovers the newly published official season without an env change", () => {
    expect(findPublishedSpecialSeason(seed, [season])?.season_id).toBe(6618);
  });
  it("does not invent an unpublished season", () => expect(findPublishedSpecialSeason(seed, [])).toBeNull());
  it.each([
    { ...season, season_year: 2025 },
    { ...season, season_name: "2026 Suzuka 1000km Practice" },
    { ...season, season_name: "2026 Suzuka 1000km Fixed" },
    { ...season, season_name: "2026 Suzuka 12 Hours" },
  ])("rejects other years and similarly named sessions", (other) => expect(findPublishedSpecialSeason(seed, [other])).toBeNull());
  it("fails closed on ambiguous matches", () => expect(() => findPublishedSpecialSeason(seed, [season, {...season, season_id: 9999}])).toThrow(/meerdere/));
  it("preserves official descriptor session duration for lap-limited events", async () => {
    const result = await normalizeSpecialEvent(seed, { practice_length: 30, qualify_length: 8, race_lap_limit: 173,
      track: { track_id: 168, track_name: "Suzuka International Racing Course", config_name: "Grand Prix" },
      race_time_descriptors: [{ repeating: false, session_minutes: 427, session_times: ["2026-09-11T22:00:00Z", "2026-09-12T07:00:00Z", "2026-09-12T12:00:00Z", "2026-09-12T16:00:00Z", "2026-09-13T00:00:00Z"] }] });
    expect(result.slots).toHaveLength(5);
    expect(result.slots.every(slot => slot.sessionDurationMinutes === 427 && slot.raceLapLimit === 173)).toBe(true);
    expect(result.trackId).toBe(168);
    expect(result.slots[0].estimatedRaceStartAt).toBe("2026-09-11T22:38:00.000Z");
  });
});
