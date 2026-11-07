import { afterEach, describe, expect, it, vi } from "vitest";
import { isRaceableCatalogEvent } from "@/features/endurance/calendar/iracingCatalogPresentation";

/**
 * Een catalogusrij mag pas als aankomende race in de lijst staan als er echt iets
 * te rijden valt. Serie-regels (`availability_status` = `tbd`) beschrijven een
 * heel seizoen en hebben geen tijdsloten; die mogen nooit als race verschijnen.
 */
const base = {
  active: true,
  availability_status: "exact_slots" as const,
  event_end_date: "2026-11-08",
  selectedEventId: null as string | null,
};

const slot = (id: string, sessionStartAt: string) => ({
  id, catalog_event_id: "event-1", source_slot_key: id, session_start_at: sessionStartAt,
  practice_start_at: null, practice_duration_minutes: null, qualifying_start_at: null,
  qualifying_duration_minutes: null, transition_duration_minutes: null, estimated_race_start_at: null,
  race_duration_minutes: null, race_lap_limit: null, session_duration_minutes: null,
  session_timing_status: "exact" as const, label: id, active: true,
});

describe("isRaceableCatalogEvent", () => {
  afterEach(() => vi.useRealTimers());
  it("wisselt de einddatum op Amsterdamse middernacht, niet UTC", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-07T23:00:00Z"));
    expect(isRaceableCatalogEvent({ ...base, event_end_date: "2026-11-07", selectedEventId: "linked" })).toBe(false);
    expect(isRaceableCatalogEvent({ ...base, event_end_date: "2026-11-08" })).toBe(true);
  });
  it("toont een toekomstige race met tijdsloten", () => {
    expect(isRaceableCatalogEvent({ ...base, event_end_date: "2026-11-08" }, "2026-10-18")).toBe(true);
  });

  it("verbergt een serie-regel zonder tijdsloten, ook al ligt de einddatum in de toekomst", () => {
    expect(
      isRaceableCatalogEvent({ ...base, availability_status: "tbd", event_end_date: "2026-11-08" }, "2026-10-18"),
    ).toBe(false);
  });

  it("verbergt een race die al voorbij is", () => {
    expect(isRaceableCatalogEvent({ ...base, event_end_date: "2026-09-12" }, "2026-10-18")).toBe(false);
  });

  it("verbergt een voorbije race ook als er al een slot aan gekoppeld is", () => {
    expect(
      isRaceableCatalogEvent({ ...base, event_end_date: "2026-09-12", selectedEventId: "slot-123" }, "2026-10-18"),
    ).toBe(false);
  });

  it("verbergt een inactieve rij", () => {
    expect(isRaceableCatalogEvent({ ...base, active: false }, "2026-10-18")).toBe(false);
  });

  it("toont een rij zonder einddatum", () => {
    expect(isRaceableCatalogEvent({ ...base, event_end_date: null }, "2026-10-18")).toBe(true);
  });

  it("toont een kalenderrij met alleen een datum (date_only) die nog moet komen", () => {
    expect(
      isRaceableCatalogEvent({ ...base, availability_status: "date_only", event_end_date: "2027-01-16" }, "2026-10-18"),
    ).toBe(true);
  });

  it("verbergt een event waarvan alle gepubliceerde slots verstreken zijn, ook met einddatum vandaag", () => {
    const event = {
      ...base,
      event_end_date: "2026-10-25",
      slots: [slot("s1", "2026-10-24T18:00:00Z"), slot("s2", "2026-10-25T08:00:00Z")],
    };
    expect(isRaceableCatalogEvent(event, "2026-10-25", new Date("2026-10-25T12:00:00Z"))).toBe(false);
  });

  it("verbergt een event zonder einddatum waarvan alle slots verstreken zijn", () => {
    const event = { ...base, event_end_date: null, slots: [slot("s1", "2026-10-20T18:00:00Z")] };
    expect(isRaceableCatalogEvent(event, "2026-10-25", new Date("2026-10-25T12:00:00Z"))).toBe(false);
  });

  it("houdt een event met nog een toekomstig slot zichtbaar, ook als er verstreken slots naast staan", () => {
    const event = {
      ...base,
      event_end_date: "2026-11-08",
      slots: [slot("s1", "2026-10-24T18:00:00Z"), slot("s2", "2026-11-08T08:00:00Z")],
    };
    expect(isRaceableCatalogEvent(event, "2026-10-25", new Date("2026-10-25T12:00:00Z"))).toBe(true);
  });
});
