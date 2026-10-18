import { describe, expect, it } from "vitest";
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

describe("isRaceableCatalogEvent", () => {
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

  it("houdt een voorbije race zichtbaar als er al een slot aan gekoppeld is", () => {
    expect(
      isRaceableCatalogEvent({ ...base, event_end_date: "2026-09-12", selectedEventId: "slot-123" }, "2026-10-18"),
    ).toBe(true);
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
});
