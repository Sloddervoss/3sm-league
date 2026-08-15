import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  catalogDateWindow,
  expectedCatalogRaceStart,
  formatCatalogInstant,
  phaseRange,
  selectedCatalogSlot,
  upcomingCatalogSlots,
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
  local_car_ids: ["car-gtp", "car-lmp2"],
  cars: [
    { id: "car-1", name: "HRC ARX01c", imageUrl: "https://example.com/hrc.jpg", officialClassId: "HPD" },
    { id: "car-2", name: "Corvette C6R", imageUrl: "https://example.com/vette.jpg", officialClassId: "GT1" },
  ],
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
    expect(event.local_car_ids).toHaveLength(2);
    expect(event.cars.map((car) => car.name)).toContain("HRC ARX01c");
  });

  it("toont alleen upcoming slots en houdt het geselecteerde slot altijd zichtbaar", () => {
    // Alle slot-datums liggen in aug 2026; met vandaag = begin september zijn ze allemaal verlopen.
    const pastOnly = upcomingCatalogSlots(event.slots, null, "2026-09-01");
    expect(pastOnly).toHaveLength(0);
    // Met vandaag = vóór het event blijven alle upcoming slots zichtbaar.
    const allUpcoming = upcomingCatalogSlots(event.slots, null, "2026-08-01");
    expect(allUpcoming).toHaveLength(5);
    // Een geselecteerd slot blijft tonen, ook als de datum verlopen is.
    const selectedKept = upcomingCatalogSlots(event.slots, "slot-2", "2026-09-01");
    expect(selectedKept.map((slot) => slot.id)).toEqual(["slot-2"]);
    // Enkel de upcoming slots (>= vandaag) naast het geselecteerde slot.
    const mixed = upcomingCatalogSlots(event.slots, "slot-2", "2026-08-15");
    expect(mixed.some((slot) => slot.id === "slot-2")).toBe(true);
  });

  it("formatteert UTC en Amsterdam expliciet en toont het datumvenster", () => {
    const iso = "2026-08-15T12:00:00Z";
    expect(formatCatalogInstant(iso, "utc")).toMatch(/12:00/);
    expect(formatCatalogInstant(iso, "amsterdam")).toMatch(/14:00/);
    expect(catalogDateWindow(event)).toContain("14 augustus 2026");
    expect(phaseRange(iso, 30)).toBe("14:00–14:30");
  });

  it("leidt de verwachte racestart af uit het einde van de kwalificatie", () => {
    const expected = expectedCatalogRaceStart({
      estimated_race_start_at: null,
      qualifying_start_at: "2026-08-14T22:30:00Z",
      qualifying_duration_minutes: 8,
    });
    expect(expected).toBe("2026-08-14T22:38:00.000Z");
    expect(formatCatalogInstant(expected!, "amsterdam")).toMatch(/00:38/);
  });

  it("gebruikt een responsive kaartengrid met 1 kolom mobiel en 2+ op desktop", () => {
    const component = read("src/features/endurance/calendar/IRacingEventCatalog.tsx");
    expect(component).toContain("md:grid-cols-2");
    expect(component).toContain("2xl:grid-cols-3");
    expect(component).toContain("grid gap-5");
  });

  it("houdt de taalbediening bereikbaar bij de brede ingelogde navigatie", () => {
    const navbar = read("src/components/Navbar.tsx");
    expect(navbar).toContain('const showDesktop = "2xl:flex"');
    expect(navbar).toContain('const hideDesktop = "2xl:hidden"');
  });

  it("inlined slots niet meer in de kaarten maar verplaatst ze naar de modal-popup", () => {
    const component = read("src/features/endurance/calendar/IRacingEventCatalog.tsx");
    expect(component).toContain("CompactEventCard");
    expect(component).toContain("onOpen={() => setOpenEventId(event.id)}");
    expect(component).toContain("EventDetailModal");
    expect(component).toContain("aria-haspopup=\"dialog\"");
    expect(component).toContain("Alle tijdsloten");
  });

  it("gebruikt het detail-panel met klassen/auto's, slotanimo en een toegankelijk venster", () => {
    const component = read("src/features/endurance/calendar/IRacingEventCatalog.tsx");
    expect(component).toContain("Officiële klassen & auto's");
    expect(component).toContain("coureurs kunnen");
    expect(component).toContain("Ik kan dit tijdslot");
    expect(component).toContain("Beschikbaar:");
    const repo = read("src/features/endurance/repository/iracingEventsRepository.ts");
    expect(repo).toContain("endurance_iracing_slot_interest_summary");
    expect(repo).toContain("endurance_set_iracing_slot_interest");
    expect(repo).toContain("endurance_iracing_slot_interest_members");
    expect(repo).toContain("endurance_iracing_manager_interest_overview");
    expect(repo).toContain("local_car_ids");
  });

  it("toont datum-only events als tijden-volgen en houdt afgelopen ongekozen events uit de lijst", () => {
    const component = read("src/features/endurance/calendar/IRacingEventCatalog.tsx");
    expect(component).toContain('"Tijden volgen"');
    expect(component).toContain("catalogTodayAmsterdam()");
    expect(component).toContain("!event.event_end_date || event.event_end_date >= today || Boolean(event.selectedEventId)");
    expect(component).toContain("Exacte starttijden nog niet gepubliceerd door iRacing");
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

  it("blokkeert manager-activatie ruim zonder gemapte lokale klassen én officiële auto's", () => {
    const component = read("src/features/endurance/calendar/IRacingEventCatalog.tsx");
    expect(component).toContain("local_class_ids.length === 0");
    expect(component).toContain("event.local_car_ids.length === 0");
    expect(component).toContain("Activatie geblokkeerd");
    expect(component).toContain("koppel eerst expliciet ondersteunde lokale 3SM-klassen én de officiële auto's");
  });

  it("laat deelnemers geen ander officieel slot kiezen", () => {
    const form = read("src/features/endurance/registration/RegistrationForm.tsx");
    expect(form).not.toContain("Startslotvoorkeur");
    expect(form).toContain("Dit slot is door de Endurance Manager gekozen");
    expect(form).toContain("slot_id: selectedSlot?.id ?? null");
  });

  it("gebruikt de originele iRacing-poster met officiële en 3SM-fallbacks", () => {
    const component = read("src/features/endurance/calendar/IRacingEventCatalog.tsx");
    expect(component).toContain("event.poster_url");
    expect(component).toContain("Originele iRacing-eventvisual voor");
    expect(component).toContain("onError={() => setSourceIndex");
    expect(component).toContain('/endurance-assets/official/iracing-2026-portimao-1000.png');
    expect(component).toContain('Originele eventvisual © iRacing');
    expect(component).toContain('object-contain');
    expect(component).toContain('/endurance-assets/endurance-card-landscape.webp');
    expect(component).toContain('aspect-video');
    expect(component).toContain('opacity-100');
    expect(component).toContain('3SM Endurance-visual voor');
    expect(component).not.toContain('opacity-25');
    expect(component).not.toContain('src="/endurance/');
    expect(component).not.toContain("images-static.iracing.com");
  });
});
