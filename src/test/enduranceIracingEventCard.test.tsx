import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  catalogDateWindow,
  formatCatalogInstant,
  phaseRange,
  selectedCatalogSlot,
  type IRacingCatalogEvent,
} from "@/features/endurance/calendar/iracingCatalogPresentation";

const event: IRacingCatalogEvent = {
  id: "event-portimao",
  source_key: "iracing:6578",
  name: "Portimão 1000",
  year: 2026,
  circuit: "Algarve International Circuit",
  configuration: "Grand Prix",
  event_start_date: "2026-08-14",
  event_end_date: "2026-08-15",
  duration_minutes: null,
  class_ids: ["HPD", "GT1", "GT2"],
  local_class_ids: ["GTP", "LMP2", "GT3"],
  team_event: true,
  official_url: "https://www.iracing.com/special-events/",
  poster_url: null,
  availability_status: "exact_slots",
  source_updated_at: null,
  last_seen_at: "2026-08-13T08:00:00Z",
  active: true,
  selectedEventId: null,
  selectedSlotId: null,
  slots: Array.from({ length: 5 }, (_, index) => ({
    id: `slot-${index}`,
    catalog_event_id: "event-portimao",
    source_slot_key: `slot-${index}`,
    session_start_at: `2026-08-${index < 1 ? "14" : "15"}T${[22, 7, 12, 16, 0][index].toString().padStart(2, "0")}:00:00Z`,
    practice_start_at: null,
    practice_duration_minutes: 30,
    qualifying_start_at: null,
    qualifying_duration_minutes: 8,
    transition_duration_minutes: 3,
    estimated_race_start_at: null,
    race_duration_minutes: null,
    race_lap_limit: 215,
    session_timing_status: "partial" as const,
    label: null,
    active: true,
  })),
};

const read = (path: string) => readFileSync(path, "utf8");

describe("iRacing Endurance event-card flow", () => {
  it("houdt vijf officiële slots onder exact één event", () => {
    expect(event.id).toBe("event-portimao");
    expect(event.slots).toHaveLength(5);
    expect(new Set(event.slots.map((slot) => slot.catalog_event_id))).toEqual(new Set([event.id]));
    expect(selectedCatalogSlot(event)).toBeNull();
    expect(selectedCatalogSlot({ ...event, selectedSlotId: "slot-2" })?.id).toBe("slot-2");
  });

  it("formatteert UTC en Amsterdam expliciet en toont het datumvenster", () => {
    const iso = "2026-08-15T12:00:00Z";
    expect(formatCatalogInstant(iso, "utc")).toMatch(/12:00/);
    expect(formatCatalogInstant(iso, "amsterdam")).toMatch(/14:00/);
    expect(catalogDateWindow(event)).toContain("14 augustus 2026");
    expect(phaseRange(iso, 30)).toBe("14:00–14:30");
  });

  it("rendert activatie alleen voor managers en registratie alleen bij het gekozen slot", () => {
    const component = read("src/features/endurance/calendar/IRacingEventCatalog.tsx");
    expect(component).toContain("isSuperAdmin || isEnduranceManager");
    expect(component).toContain("Deze gaan we rijden");
    expect(component).toContain("!event.selectedEventId");
    expect(component).toContain("slot.id === event.selectedSlotId");
    expect(component).toContain("Open race / inschrijven");
    expect(component).toContain("Exacte starttijden nog niet gepubliceerd door iRacing");
  });

  it("laat deelnemers geen ander officieel slot kiezen", () => {
    const form = read("src/features/endurance/registration/RegistrationForm.tsx");
    expect(form).not.toContain("Startslotvoorkeur");
    expect(form).toContain("Dit slot is door de Endurance Manager gekozen");
    expect(form).toContain("slot_id: selectedSlot?.id ?? null");
  });

  it("gebruikt de originele 3SM-kaartasset en geen officiële poster in de UI", () => {
    const component = read("src/features/endurance/calendar/IRacingEventCatalog.tsx");
    expect(component).toContain('/endurance-assets/endurance-card-landscape.webp');
    expect(component).toContain('aspect-video');
    expect(component).toContain('opacity-100');
    expect(component).toContain('3SM Endurance-visual voor');
    expect(component).not.toContain('opacity-25');
    expect(component).not.toContain('src="/endurance/');
    expect(component).not.toContain("images-static.iracing.com");
  });
});
