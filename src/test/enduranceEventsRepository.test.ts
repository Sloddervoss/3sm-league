import { describe, expect, it, vi } from "vitest";
import { assertEnduranceTable } from "../features/endurance/repository/dataAccess";
import { listEnduranceEvents, createEnduranceEvent } from "../features/endurance/repository/eventsRepository";

// hoisted spies — beschikbaar vóór de vi.mock-factory (die wordt gehoist).
const spies = vi.hoisted(() => ({
  fromSpy: vi.fn(),
  selectSpy: vi.fn(),
  orderSpy: vi.fn(),
  insertSpy: vi.fn(),
  insertSelectSpy: vi.fn(),
  insertSingleSpy: vi.fn(),
}));

// De repository gebruikt enduranceClient() -> supabase uit de echte client-module.
// We mocken de supabase-client zodat we de tabel-selectie kunnen verifiëren zonder
// een live databank. De mock vangt de `.from(<tabelnaam>)` op en controleert dat
// uitsluitend "endurance_events" wordt geselecteerd.
vi.mock("@/integrations/supabase/client", () => {
  return {
    supabase: {
      from: spies.fromSpy,
    },
  };
});

describe("endurance events repository (Fase 3 data-access contract)", () => {
  it("selecteert uitsluitend endurance_events en geen andere tabellen", async () => {
    spies.orderSpy.mockResolvedValue({ data: [], error: null });
    spies.selectSpy.mockReturnValue({ order: spies.orderSpy });
    spies.fromSpy.mockReturnValue({ select: spies.selectSpy });

    await listEnduranceEvents();

    expect(spies.fromSpy).toHaveBeenCalledTimes(1);
    expect(spies.fromSpy).toHaveBeenCalledWith("endurance_events");
  });

  it("insert — schrijft uitsluitend naar endurance_events (super-admin-sessie)", async () => {
    spies.insertSelectSpy.mockReturnValue({ single: spies.insertSingleSpy });
    spies.insertSingleSpy.mockResolvedValue({ data: { id: "evt-1" }, error: null });
    spies.insertSpy.mockReturnValue({ select: spies.insertSelectSpy });
    spies.fromSpy.mockReturnValue({ insert: spies.insertSpy });

    await createEnduranceEvent({
      name: "Testrace",
      circuit: "Zandvoort",
      configuration: "GP",
      start_at: "2026-09-01T12:00:00Z",
      end_at: "2026-09-01T18:00:00Z",
      class_ids: ["GT3"],
      visibility: "hidden",
      status: "draft",
    });

    expect(spies.fromSpy).toHaveBeenCalledWith("endurance_events");
    expect(spies.insertSpy).toHaveBeenCalledTimes(1);
    const payload = spies.insertSpy.mock.calls[0][0];
    expect(payload.name).toBe("Testrace");
    expect(payload.class_ids).toEqual(["GT3"]);
  });

  it("weigert een niet-endurance-tabelnaam via assertEnduranceTable", () => {
    expect(() => assertEnduranceTable("races")).toThrow(/alleen endurance_\*-tabellen/);
    expect(() => assertEnduranceTable("simhub_devices")).toThrow(/alleen endurance_\*-tabellen/);
    expect(() => assertEnduranceTable("profiles")).toThrow(/alleen endurance_\*-tabellen/);
    expect(() => assertEnduranceTable("endurance_events")).not.toThrow();
    expect(() => assertEnduranceTable("endurance_stints")).not.toThrow();
  });
});
