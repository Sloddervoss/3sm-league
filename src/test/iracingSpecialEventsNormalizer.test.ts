import { describe, expect, it } from "vitest";
import fixture from "../../supabase/functions/iracing-special-events-sync/fixtures/portimao-2026.json";
import { enrichSeedFromOfficialCalendar, normalizeSpecialEvent } from "../../supabase/functions/iracing-special-events-sync/normalize";

describe("iRacing Special Events normalizer", () => {
  it("normaliseert vijf officiële Portimão-sessiestarts zonder groene vlag te gokken", async () => {
    const normalized = await normalizeSpecialEvent(fixture.seed, fixture.schedule);
    expect(normalized.availabilityStatus).toBe("exact_slots");
    expect(normalized.slots).toHaveLength(5);
    expect(normalized.slots[2]).toMatchObject({
      sessionStartAt: "2026-08-15T12:00:00.000Z",
      practiceStartAt: "2026-08-15T12:00:00.000Z",
      practiceDurationMinutes: 30,
      qualifyingStartAt: "2026-08-15T12:30:00.000Z",
      qualifyingDurationMinutes: 8,
      estimatedRaceStartAt: null,
      raceDurationMinutes: null,
      raceLapLimit: 215,
      sessionTimingStatus: "partial",
    });
  });

  it("leidt overgang alleen af als een time-limited schedule exact sluit", async () => {
    const normalized = await normalizeSpecialEvent(
      { sourceKey: "iracing:2026:nurburgring", year: 2026, name: "Nürburgring Endurance", dateStart: "2026-05-01" },
      {
        practice_length: 10,
        qualify_length: 30,
        warmup_length: 0,
        race_time_limit: 240,
        session_minutes: 283,
        race_time_descriptors: [{ session_times: ["2026-05-01T12:00:00Z"] }],
      },
    );
    expect(normalized.slots[0]).toMatchObject({
      transitionDurationMinutes: 3,
      estimatedRaceStartAt: "2026-05-01T12:43:00.000Z",
      sessionTimingStatus: "full",
    });
  });

  it("weigert een seasonmapping waarvan timeslots buiten het officiële eventvenster vallen", async () => {
    await expect(normalizeSpecialEvent(
      { sourceKey: "iracing:2026:nurburgring-24h", year: 2026, name: "Nürburgring 24h", dateStart: "2026-05-01", dateEnd: "2026-05-03" },
      { race_time_descriptors: [{ session_times: ["2026-03-21T07:00:00Z", "2026-05-02T12:00:00Z"] }] },
    )).rejects.toThrow("timeslots buiten het officiële eventvenster");
  });

  it("weigert timezone-loze timestamps en valt terug op datum-only", async () => {
    const normalized = await normalizeSpecialEvent(
      { sourceKey: "event", year: 2026, name: "Event", dateStart: "2026-10-25" },
      { race_time_descriptors: [{ session_times: ["2026-10-25T01:30:00"] }] },
    );
    expect(normalized.slots).toEqual([]);
    expect(normalized.availabilityStatus).toBe("date_only");
  });

  it("dedupliceert slots en maakt een stabiele hash ongeacht objectveldvolgorde", async () => {
    const seed = { sourceKey: "event", year: 2026, name: "Event", classIds: ["GT3", "GTP", "GT3"] };
    const schedule = { race_time_descriptors: [{ session_times: ["2026-01-01T12:00:00Z", "2026-01-01T12:00:00+00:00"] }] };
    const first = await normalizeSpecialEvent(seed, schedule);
    const second = await normalizeSpecialEvent({ name: "Event", year: 2026, sourceKey: "event", classIds: ["GTP", "GT3"] }, schedule);
    expect(first.slots).toHaveLength(1);
    expect(first.sourceHash).toBe(second.sourceHash);
  });

  it("ververst naam, datums, poster en klassen uit de gemapte officiële kalendersectie", () => {
    const html = `<section id="portimao-1000"><figure class="wp-block-image size-full"><img src="https://www.iracing.com/poster.png"></figure><p>TEAM EVENT</p><h2>Portimao 1000</h2><p><em>August 14-15, 2026</em></p><h3>Cars Competing</h3><details><summary>HPD // GT1 // GT2</summary></details></section>`;
    const enriched = enrichSeedFromOfficialCalendar(fixture.seed, html);
    expect(enriched).toMatchObject({
      name: "Portimao 1000",
      dateStart: "2026-08-14",
      dateEnd: "2026-08-15",
      posterUrl: "https://www.iracing.com/poster.png",
      classIds: ["HPD", "GT1", "GT2"],
      teamEvent: true,
    });
  });
});
