import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  catalogDateWindow,
  upcomingCatalogInterestCount,
  expectedCatalogRaceStart,
  formatCatalogInstant,
  phaseRange,
  selectedCatalogSlot,
  sortCatalogByNextStart,
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
    session_duration_minutes: null,
    session_timing_status: "partial" as const,
    label: null,
    active: true,
  })),
};

const read = (path: string) => readFileSync(path, "utf8");

describe("iRacing Endurance event-card flow", () => {
  it("levert RPC-tijdguards met exacte rollback, zonder bestaande autorisatie te wijzigen", () => {
    const migration = read("supabase/migrations/20261107110000_endurance_past_catalog_slots.sql");
    const rollback = read("supabase/rollback/20261107110000_endurance_past_catalog_slots.rollback.sql");
    const extract = (sql: string, name: string) => sql.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$\\$;`))?.[0];
    for (const [name, file] of [
      ["endurance_activate_iracing_slot", "20261023130000_endurance_valkyrie_car_mapping.sql"],
      ["endurance_set_iracing_slot_interest", "20260813163000_endurance_iracing_slot_interest.sql"],
    ]) {
      const old = extract(read(`supabase/migrations/${file}`), name);
      expect(old).toBeDefined();
      expect(extract(rollback, name)).toBe(old);
      expect(extract(migration, name)).toContain("SECURITY DEFINER");
      expect(extract(migration, name)).toContain("clock_timestamp()");
    }
    expect(migration.indexOf("v_slot.session_start_at <= clock_timestamp()")).toBeGreaterThan(migration.indexOf("PERFORM pg_advisory_xact_lock"));
    expect(migration.indexOf("v_slot.session_start_at <= clock_timestamp()")).toBeLessThan(migration.indexOf("RETURN v_existing.id"));
    expect(migration).toContain("AND slot.session_start_at > clock_timestamp()");
  });

  it("houdt vijf officiële slots onder exact één event", () => {
    expect(event.id).toBe("event-portimao");
    expect(event.slots).toHaveLength(5);
    expect(new Set(event.slots.map((slot) => slot.catalog_event_id))).toEqual(new Set([event.id]));
    expect(selectedCatalogSlot(event)).toBeNull();
    expect(selectedCatalogSlot({ ...event, selectedSlotId: "slot-2" }, new Date("2026-08-01T00:00:00Z"))?.id).toBe("slot-2");
    expect(event.local_car_ids).toHaveLength(2);
    expect(event.cars.map((car) => car.name)).toContain("HRC ARX01c");
  });

  it("toont alleen toekomstige slots, zonder uitzondering voor een selectie", () => {
    // Alle slot-datums liggen in aug 2026; met vandaag = begin september zijn ze allemaal verlopen.
    const pastOnly = upcomingCatalogSlots(event.slots, new Date("2026-09-01T00:00:00Z"));
    expect(pastOnly).toHaveLength(0);
    // Met vandaag = vóór het event blijven alle upcoming slots zichtbaar.
    const allUpcoming = upcomingCatalogSlots(event.slots, new Date("2026-08-01T00:00:00Z"));
    expect(allUpcoming).toHaveLength(5);
    // Ook bij een selectie blijven verlopen slots verborgen.
    const selectedKept = upcomingCatalogSlots(event.slots, new Date("2026-09-01T00:00:00Z"));
    expect(selectedKept.map((slot) => slot.id)).toEqual([]);
    // Alleen toekomstige slots.
    const mixed = upcomingCatalogSlots(event.slots, new Date("2026-08-15T00:00:00Z"));
    expect(mixed.some((slot) => slot.id === "slot-2")).toBe(true);
  });

  it("sorteert de catalogus op het eerstvolgende startmoment", () => {
    const portimao: IRacingCatalogEvent = {
      ...event,
      id: "event-portimao", event_start_date: "2026-08-14",
      slots: ["2026-08-15T09:00:00Z", "2026-08-15T14:00:00Z", "2026-08-15T18:00:00Z"].map((iso, index) => ({
        ...event.slots[0], id: `p-slot-${index}`, session_start_at: iso,
      })),
    };
    // Geen slot, maar eventdatum 16-08 => valt terug op de dag na Portimão's eerste slot.
    const barcelona: IRacingCatalogEvent = { ...event, id: "event-barcelona", event_start_date: "2026-08-16", slots: [] };
    // Eventdatum 20-08 => later dan Barcelona.
    const suzuka: IRacingCatalogEvent = { ...event, id: "event-suzuka", event_start_date: "2026-08-20", slots: [] };
    const ordered = sortCatalogByNextStart([suzuka, portimao, barcelona], new Date("2026-08-15T08:00:00Z"));
    expect(ordered.map((e) => e.id)).toEqual(["event-portimao", "event-barcelona", "event-suzuka"]);
    // Een verlopen event zonder toekomstige sloten zakt helemaal naar de onderkant.
    const expired: IRacingCatalogEvent = { ...event, id: "event-expired", event_start_date: "2026-07-01",
      slots: [{ ...event.slots[0], id: "x-slot", session_start_at: "2026-07-01T12:00:00Z" }] };
    const withExpired = sortCatalogByNextStart([expired, portimao, barcelona], new Date("2026-08-15T08:00:00Z"));
    expect(withExpired.map((e) => e.id)).toEqual(["event-portimao", "event-barcelona", "event-expired"]);
  });

  it("verbergt tijdsgevoelig slots die vandaag al zijn begonnen, maar houdt latere slots van dezelfde dag (Date-filter)", () => {
    // slot-0: 2026-08-14T22:00Z (vorige dag), slot-4: 2026-08-15T00:00Z,
    // slot-1: 07:00Z, slot-2: 12:00Z, slot-3: 16:00Z (alle 15 aug).
    // Rond 12:30Z op 15 aug zijn slot-4, slot-1 en slot-2 al begonnen/verstreken;
    // slot-3 (16:00Z) is later op dezelfde dag en moet nog zichtbaar zijn.
    const now = new Date("2026-08-15T12:30:00Z");
    const visible = upcomingCatalogSlots(event.slots, now);
    const ids = visible.map((slot) => slot.id);
    expect(ids).toContain("slot-3");
    // slot-0 heeft sessiestart 2026-08-14T22:00Z < 12:30Z => niet zichtbaar.
    expect(ids).not.toContain("slot-0");
    expect(ids).not.toContain("slot-4");
    expect(ids).not.toContain("slot-1");
    expect(ids).not.toContain("slot-2");
    // Een verlopen selectie komt niet terug in de lijst.
    const selectedKept = upcomingCatalogSlots(event.slots, new Date("2026-08-15T12:30:00Z"));
    expect(selectedKept.map((slot) => slot.id)).toEqual(["slot-3"]);
  });

  it("verbergt de selectie op en na sessiestart, maar behoudt een toekomstige selectie", () => {
    const selected = { ...event, selectedSlotId: "slot-2" };
    expect(selectedCatalogSlot(selected, new Date("2026-08-15T11:59:59Z"))?.id).toBe("slot-2");
    expect(selectedCatalogSlot(selected, new Date("2026-08-15T12:00:00Z"))).toBeNull();
    expect(selectedCatalogSlot(selected, new Date("2026-09-01T00:00:00Z"))).toBeNull();
  });

  it("telt unieke coureurs uitsluitend op toekomstige actieve slots", () => {
    const members = [["slot-1", "old"], ["slot-2", "both"], ["slot-3", "both"], ["slot-3", "future"]]
      .map(([catalog_slot_id, user_id]) => ({ catalog_slot_id, user_id, iracing_name: null, display_name: null }));
    expect(upcomingCatalogInterestCount(event.slots, members, new Date("2026-08-15T12:00:00Z"))).toBe(2);
    expect(upcomingCatalogInterestCount(event.slots, members, new Date("2026-08-15T16:00:00Z"))).toBe(0);
    expect(upcomingCatalogInterestCount(event.slots.map((slot) => ({ ...slot, active: false })), members, new Date("2026-08-01T00:00:00Z"))).toBe(0);
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
    // Let op: dit was een stale test. De navigatie schakelt al langer op
    // 1800px (min-[1800px]) in plaats van de oude 2xl-trap (1536px), maar de
    // assertie was nooit meegewijzigd. Hij faalde daardoor al vóór de open beta.
    expect(navbar).toContain('const showDesktop = "min-[1800px]:flex"');
    expect(navbar).toContain('const hideDesktop = "min-[1800px]:hidden"');
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

  it("toont datum-only events als tijden-volgen, houdt alle afgelopen events en serie-regels zonder tijdsloten uit de lijst", () => {
    const component = read("src/features/endurance/calendar/IRacingEventCatalog.tsx");
    expect(component).toContain('"Tijden volgen"');
    expect(component).toContain("catalogTodayAmsterdam(now)");
    expect(component).toContain("isRaceableCatalogEvent(event, today)");
    expect(component).toContain("Exacte starttijden nog niet gepubliceerd door iRacing");
    const presentation = read("src/features/endurance/calendar/iracingCatalogPresentation.ts");
    expect(presentation).toContain('event.availability_status === "tbd"');
    expect(presentation).toContain("return event.event_end_date >= today;");
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
