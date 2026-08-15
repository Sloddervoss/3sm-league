import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { assertEnduranceTable } from "../features/endurance/repository/dataAccess";
import { deleteEnduranceEvent, listEnduranceEvents, createEnduranceEvent, updateEnduranceEvent } from "../features/endurance/repository/eventsRepository";

// hoisted spies — beschikbaar vóór de vi.mock-factory (die wordt gehoist).
const spies = vi.hoisted(() => ({
  fromSpy: vi.fn(),
  selectSpy: vi.fn(),
  orderSpy: vi.fn(),
  insertSpy: vi.fn(),
  insertSelectSpy: vi.fn(),
  insertSingleSpy: vi.fn(),
  updateSpy: vi.fn(),
  updateEqSpy: vi.fn(),
  updateSelectSpy: vi.fn(),
  updateSingleSpy: vi.fn(),
  deleteSpy: vi.fn(),
  deleteEqSpy: vi.fn(),
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
    expect(payload.allowed_car_ids).toBeNull();
  });

  it("insert — schrijft invited_user_ids uit de input mee (en default [] indien afwezig)", async () => {
    spies.insertSpy.mockClear();
    spies.insertSelectSpy.mockReturnValue({ single: spies.insertSingleSpy });
    spies.insertSingleSpy.mockResolvedValue({ data: { id: "evt-1" }, error: null });
    spies.insertSpy.mockReturnValue({ select: spies.insertSelectSpy });
    spies.fromSpy.mockReturnValue({ insert: spies.insertSpy });

    await createEnduranceEvent({
      name: "Invite race",
      circuit: "Road America",
      configuration: "Full Course",
      start_at: "2026-09-01T12:00:00Z",
      end_at: "2026-09-01T18:00:00Z",
      class_ids: ["GT3"],
      visibility: "invite_only",
      status: "registration_open",
      invited_user_ids: ["u-1", "u-2"],
    });
    expect(spies.insertSpy.mock.calls[0][0].invited_user_ids).toEqual(["u-1", "u-2"]);

    await createEnduranceEvent({
      name: "Open race",
      circuit: "Zandvoort",
      configuration: "GP",
      start_at: "2026-09-01T12:00:00Z",
      end_at: "2026-09-01T18:00:00Z",
      class_ids: ["GT3"],
      visibility: "open",
      status: "registration_open",
    });
    expect(spies.insertSpy.mock.calls[1][0].invited_user_ids).toEqual([]);
  });

  it("update — schrijft invited_user_ids bij een bestaand event", async () => {
    spies.updateSpy.mockClear();
    spies.updateSingleSpy.mockResolvedValue({ data: { id: "evt-1" }, error: null });
    spies.updateSelectSpy.mockReturnValue({ single: spies.updateSingleSpy });
    spies.updateEqSpy.mockReturnValue({ select: spies.updateSelectSpy });
    spies.updateSpy.mockReturnValue({ eq: spies.updateEqSpy });
    spies.fromSpy.mockReturnValue({ update: spies.updateSpy });

    await updateEnduranceEvent("evt-1", {
      invited_user_ids: ["u-3", "u-1"],
    });
    expect(spies.fromSpy).toHaveBeenCalledWith("endurance_events");
    expect(spies.updateSpy.mock.calls[0][0].invited_user_ids).toEqual(["u-3", "u-1"]);
  });

  it("weigert een niet-endurance-tabelnaam via assertEnduranceTable", () => {
    expect(() => assertEnduranceTable("races")).toThrow(/alleen endurance_\*-tabellen/);
    expect(() => assertEnduranceTable("simhub_devices")).toThrow(/alleen endurance_\*-tabellen/);
    expect(() => assertEnduranceTable("profiles")).toThrow(/alleen endurance_\*-tabellen/);
    expect(() => assertEnduranceTable("endurance_events")).not.toThrow();
    expect(() => assertEnduranceTable("endurance_stints")).not.toThrow();
  });

  it("delete — verwijdert alleen uit endurance_events op het gevraagde id", async () => {
    spies.deleteEqSpy.mockResolvedValue({ error: null });
    spies.deleteSpy.mockReturnValue({ eq: spies.deleteEqSpy });
    spies.fromSpy.mockReturnValue({ delete: spies.deleteSpy });

    await deleteEnduranceEvent("evt-1");

    expect(spies.fromSpy).toHaveBeenCalledWith("endurance_events");
    expect(spies.deleteSpy).toHaveBeenCalledTimes(1);
    expect(spies.deleteEqSpy).toHaveBeenCalledWith("id", "evt-1");
  });

  it("verwijdert een geactiveerd iRacing-catalogusevent onder de iRacing-querykeys", () => {
    const source = readFileSync("src/features/endurance/repository/eventsRepository.ts", "utf8");
    const deleteHookStart = source.indexOf("export function useDeleteEnduranceEvent");
    const deleteHook = source.slice(deleteHookStart);
    expect(deleteHook).toContain('queryClient.invalidateQueries({ queryKey: ["endurance", "events"] })');
    expect(deleteHook).toContain("iracingCatalogQueryKey");
    expect(deleteHook).toContain("iracingSlotInterestSummaryQueryKey");
    expect(deleteHook).toContain("iracingEventInterestSummaryQueryKey");
    expect(deleteHook).toContain("iracingManagerInterestOverviewQueryKey");
  });
});
