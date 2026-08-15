import { describe, expect, it } from "vitest";
import fixture from "../../supabase/functions/iracing-special-events-sync/fixtures/portimao-2026.json";
import seriesFixture from "../../supabase/functions/iracing-special-events-sync/fixtures/imsa-endurance-s3.json";
import combinedFixture from "../../supabase/functions/iracing-special-events-sync/fixtures/nurburgring-ec-combined.json";
import { catalogTodayAmsterdam } from "../features/endurance/calendar/iracingCatalogPresentation";
import {
  discoverCombinedSeriesEvent,
  discoverSeriesRaces,
  discoverUpcomingSpecialEvents,
  enrichSeedFromOfficialCalendar,
  normalizeSpecialEvent,
  resolveSeriesRoster,
} from "../../supabase/functions/iracing-special-events-sync/normalize";

describe("iRacing Special Events normalizer", () => {
  it("zet elke gewone endurance-serie-race om naar één event met eigen child-slots", async () => {
    const races = await discoverSeriesRaces(
      { sourceKey: seriesFixture.seed.sourceKey, year: 2026, name: seriesFixture.seed.name, seasonId: seriesFixture.seasonId, seriesId: seriesFixture.seriesId, seriesName: seriesFixture.seed.name },
      seriesFixture.schedule,
    );
    expect(races).toHaveLength(2);
    expect(races[0]).toMatchObject({
      sourceKey: "iracing:2026:imsa-endurance-series:week4:virginia-international-raceway",
      name: "IMSA Endurance Series — Virginia International Raceway",
      circuit: "Virginia International Raceway",
      configuration: "Full Course",
      trackId: 465,
      availabilityStatus: "exact_slots",
      dateEnd: "2026-08-15",
    });
    expect(races[0].slots).toHaveLength(3);
    expect(races[0].slots[0].sessionStartAt).toBe("2026-08-15T02:00:00.000Z");
    expect(races[0].slots[0].sessionTimingStatus).toBe("full");
    expect(races[0].slots[0].estimatedRaceStartAt).toBe("2026-08-15T02:38:00.000Z");
    expect(races[1]).toMatchObject({
      sourceKey: "iracing:2026:imsa-endurance-series:week5:road-atlanta",
      name: "IMSA Endurance Series — Road Atlanta",
      dateEnd: "2026-08-29",
    });
    expect(races[1].slots).toHaveLength(3);
  });

  it("leidt de event-einddatum af uit de sessietijden zodat verlopen races verborgen worden", async () => {
    const races = await discoverSeriesRaces(
      { sourceKey: "iracing:2026:vln", year: 2026, name: "Nürburgring Endurance Championship", seasonId: 6236, seriesName: "Nürburgring Endurance Championship" },
      {
        schedules: [
          {
            race_week_num: 0,
            start_date: "2026-03-21",
            track: { track_name: "Nürburgring Combined", track_id: 1 },
            race_time_descriptors: [{ session_times: ["2026-03-21T07:00:00Z", "2026-03-21T17:00:00Z"] }],
          },
          {
            race_week_num: 1,
            start_date: "2026-11-07",
            track: { track_name: "Nürburgring Combined", track_id: 1 },
            race_time_descriptors: [{ session_times: ["2026-11-07T07:00:00Z"] }],
          },
        ],
      },
    );
    expect(races[0]).toMatchObject({ name: "Nürburgring Endurance Championship — Nürburgring Combined", dateStart: "2026-03-21", dateEnd: "2026-03-21" });
    expect(races[1]).toMatchObject({ dateStart: "2026-11-07", dateEnd: "2026-11-07" });
    // Geen schedule_name-vervuiling: elke race heet Serie — Circuit.
    expect(races.every((r) => r.name === "Nürburgring Endurance Championship — Nürburgring Combined")).toBe(true);
  });

  it("weigert een serieseason zonder geldig seasonId", async () => {
    await expect(discoverSeriesRaces(
      { sourceKey: "x", year: 2026, name: "X", seasonId: NaN as unknown as number, seriesName: "X" },
      seriesFixture.schedule,
    )).rejects.toThrow("Ongeldige serieseason-id");
  });

  it("combineert alle race-weken van een serie tot één event met per-week slots, per datum gesorteerd", async () => {
    const combined = await discoverCombinedSeriesEvent(
      { sourceKey: combinedFixture.seed.sourceKey, year: 2026, name: combinedFixture.seed.name, seasonId: combinedFixture.seasonId, seriesId: combinedFixture.seriesId, seriesName: combinedFixture.seed.name, combined: true },
      combinedFixture.schedule,
    );
    expect(combined).not.toBeNull();
    expect(combined?.sourceKey).toBe("iracing:2026:nurburgring-endurance-championship");
    expect(combined?.name).toBe("Nürburgring Endurance Championship");
    // 2 weken x 4 racemomenten = 8 slots, gesorteerd op datum/tijd (maart vóór november).
    expect(combined?.slots).toHaveLength(8);
    expect(combined?.slots[0]).toMatchObject({
      sessionStartAt: "2026-03-21T07:00:00.000Z",
      label: expect.stringContaining("2026"),
    });
    // Het tweede racemoment van dezelfde week (17:00 UTC = 19:00 Amsterdam) moet ook bestaan.
    expect(combined?.slots.map((slot) => slot.sessionStartAt)).toContain("2026-03-21T17:00:00.000Z");
    // Elke slot heeft een unieke sourceSlotKey (week + tijd).
    const keys = combined?.slots.map((slot) => slot.sourceSlotKey);
    expect(new Set(keys).size).toBe(keys?.length);
    expect(combined?.slots[0]?.sourceSlotKey).toMatch(/^iracing:2026:nurburgring-endurance-championship:week0:/);
    expect(combined?.slots[1]?.sessionStartAt).toBe("2026-03-21T17:00:00.000Z");
    expect(combined?.dateStart).toBe("2026-03-21");
    expect(combined?.dateEnd).toBe("2026-11-08");
    // Elke week-slot heeft een leesbaar datumlabel.
    expect(combined?.slots[0]?.label).toBeTruthy();
  });

  it("resolveert officiële klassen + auto's uit de iRacing carclass/car-data", () => {
    // Nürburgring EC season 6236: car_class_ids 4098 (NEC GT3), 4099 (PCup), 4100 (GT4).
    const carClassData = {
      "4098": { car_class_id: 4098, name: "NEC GT3 2026", cars_in_class: [{ car_id: 156 }, { car_id: 174 }] },
      "4099": { car_class_id: 4099, name: "NEC PCup 2026", cars_in_class: [{ car_id: 158 }] },
      "4100": { car_class_id: 4100, name: "NEC GT4 2026", cars_in_class: [{ car_id: 160 }] },
      "9999": { car_class_id: 9999, name: "Onbekend", cars_in_class: [{ car_id: 999 }] },
    };
    const carData = {
      "156": { car_id: 156, car_name: "Mercedes-AMG GT3 2020" },
      "174": { car_id: 174, car_name: "Porsche 963 GTP" },
      "158": { car_id: 158, car_name: "Porsche 992 Porsche Cup" },
      "160": { car_id: 160, car_name: "Mercedes-AMG GT4" },
    };
    const roster = resolveSeriesRoster([4098, 4099, 4100], carClassData, carData);
    expect(roster.classIds).toEqual(["NEC GT3 2026", "NEC GT4 2026", "NEC PCup 2026"]);
    // 4 bekende auto's, gesorteerd op source_key.
    expect(roster.cars.map((car) => car.name)).toEqual([
      "Mercedes-AMG GT3 2020",
      "Mercedes-AMG GT4",
      "Porsche 963 GTP",
      "Porsche 992 Porsche Cup",
    ]);
    expect(roster.cars.every((car) => car.officialClassId)).toBe(true);
    // Onbekende auto (car 999) wordt overgeslagen maar de class met naam blijft.
    const unknown = resolveSeriesRoster([9999], carClassData, carData);
    expect(unknown.classIds).toEqual(["Onbekend"]);
    expect(unknown.cars).toEqual([]);
    // Lege input geeft lege lijst.
    expect(resolveSeriesRoster(undefined, null, null)).toEqual({ classIds: [], cars: [] });
  });

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
      estimatedRaceStartAt: "2026-08-15T12:38:00.000Z",
      raceDurationMinutes: null,
      raceLapLimit: 215,
      sessionTimingStatus: "full",
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

  it("weigert een seasonmapping waarvan tijdsloten buiten het officiële eventvenster vallen", async () => {
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

  it("ontdekt alle Upcoming Events als datum-only/TBD zonder Completed Events of gegokte slots", async () => {
    const eventSection = (name: string, date: string, poster: string, classes: string, car: string, track = "") => `<section><div><figure class="wp-block-image size-full"><img src="${poster}"></figure></div><div><h2>${name}</h2><p><strong><em>${date}</em></strong></p>${track ? `<p><a href="/tracks/test/">${track}</a></p>` : ""}<h3>Cars Competing</h3><details><summary>${classes}</summary><figure data-wp-context="{&quot;uploadedSrc&quot;:&quot;https://www.iracing.com/${car}.jpg&quot;}"><img src="https://www.iracing.com/${car}-350x197.jpg"></figure></details></div></section>`;
    const html = `<h2>Upcoming Events</h2>${eventSection("Portimao 1000", "August 14-15, 2026", "https://www.iracing.com/iRSE-2026-Portimao-1000.png", "HPD // GT1 // GT2", "HRC-ARX01c-feature", "Algarve International Circuit")}${eventSection("Britcar 24HR", "September 18-20, 2026", "https://www.iracing.com/iRSE-2026-Britcar.png", "GT3 Class \\\\ GT4 Class", "GT3-Car")}${eventSection("Future TBD", "Date : TBD", "https://www.iracing.com/iRSE-2026-Future-TBD.png", "Car: TBD", "", "")}<h2>Completed Events</h2>${eventSection("Old Race", "January 1, 2026", "https://www.iracing.com/iRSE-2026-Old.png", "GT3", "Old-Car")}`;
    const discovered = discoverUpcomingSpecialEvents(html);
    expect(discovered).toHaveLength(3);
    expect(discovered[0]).toMatchObject({
      sourceKey: "iracing:2026:portimao-1000",
      name: "Portimao 1000",
      dateStart: "2026-08-14",
      dateEnd: "2026-08-15",
      circuit: "Algarve International Circuit",
      classIds: ["HPD", "GT1", "GT2"],
      cars: [{ sourceKey: "hrc-arx01c-feature" }],
    });
    expect(discovered[0].sourceKey).toBe(fixture.seed.sourceKey);
    expect(discovered[1]).toMatchObject({ sourceKey: "iracing:2026:britcar-24hr", classIds: ["GT3 Class", "GT4 Class"] });
    expect(discovered[2]).toMatchObject({ sourceKey: "iracing:2026:future-tbd", dateStart: null, dateEnd: null, classIds: [], cars: [], officialUrl: "https://www.iracing.com/special-events/" });
    expect(discovered.some((event) => event.name === "Old Race")).toBe(false);
    const normalized = await normalizeSpecialEvent(discovered[0], null);
    expect(normalized.availabilityStatus).toBe("date_only");
    expect(normalized.slots).toEqual([]);
  });

  it("bepaalt de zichtbare catalogusdag in Amsterdam in plaats van UTC", () => {
    expect(catalogTodayAmsterdam(new Date("2026-08-13T21:59:59Z"))).toBe("2026-08-13");
    expect(catalogTodayAmsterdam(new Date("2026-08-13T22:00:00Z"))).toBe("2026-08-14");
  });

  it("faalt dicht wanneer de officiële Upcoming/Completed-grenzen ontbreken", () => {
    expect(() => discoverUpcomingSpecialEvents("<h2>Portimao 1000</h2>")).toThrow("Upcoming/Completed-eventgrenzen ontbreken");
  });

  it("ververst naam, datums, poster en klassen uit de gemapte officiële kalendersectie", () => {
    const html = `<section id="portimao-1000"><figure class="wp-block-image size-full"><img src="https://www.iracing.com/poster.png"></figure><p>TEAM EVENT</p><h2>Portimao 1000</h2><p><em>August 14-15, 2026</em></p><h3>Cars Competing</h3><details><summary>HPD // GT1 // GT2</summary><figure data-wp-context="{&quot;uploadedSrc&quot;:&quot;https://www.iracing.com/wp-content/uploads/2012/11/HRC-ARX01c-feature.jpg&quot;}"><img src="https://s100.iracing.com/HRC-ARX01c-feature-350x197.jpg"></figure><figure><img src="https://s100.iracing.com/Corvette-C6R.jpg"></figure></details></section>`;
    const enriched = enrichSeedFromOfficialCalendar(fixture.seed, html);
    expect(enriched).toMatchObject({
      name: "Portimao 1000",
      dateStart: "2026-08-14",
      dateEnd: "2026-08-15",
      posterUrl: "https://www.iracing.com/poster.png",
      classIds: ["HPD", "GT1", "GT2"],
      cars: [
        { sourceKey: "hrc-arx01c-feature", name: "HRC ARX01c", imageUrl: "https://www.iracing.com/wp-content/uploads/2012/11/HRC-ARX01c-feature.jpg", officialClassId: null },
        { sourceKey: "corvette-c6r", name: "Corvette C6R", imageUrl: "https://s100.iracing.com/Corvette-C6R.jpg", officialClassId: null },
      ],
      teamEvent: true,
    });
  });
});
