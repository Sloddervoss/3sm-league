import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  listEnduranceAvailability,
  upsertEnduranceAvailability,
  deleteEnduranceAvailability,
} from "../features/endurance/repository/availabilityRepository";
import {
  listEndurancePlanningVersions,
  listEnduranceConfirmations,
  publishEndurancePlan,
  updateEnduranceConfirmation,
} from "../features/endurance/repository/planRepository";

// Hoisted spies — beschikbaar vóór de vi.mock-factory (wordt gehoist).
const spies = vi.hoisted(() => ({
  fromSpy: vi.fn(),
  selectSpy: vi.fn(),
  orderSpy: vi.fn(),
  eqSpy: vi.fn(),
  upsertSpy: vi.fn(),
  upsertSelectSpy: vi.fn(),
  upsertSingleSpy: vi.fn(),
  deleteSpy: vi.fn(),
  insertSpy: vi.fn(),
  insertSelectSpy: vi.fn(),
  insertSingleSpy: vi.fn(),
  updateSpy: vi.fn(),
}));

// Zowel availabilityRepository als planRepository gebruiken enduranceClient()
// die supabase teruggeeft. We mocken de client zodat we tabelselectie kunnen
// verifiëren zonder een live databank.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: spies.fromSpy },
}));

const resetChains = () => {
  spies.fromSpy.mockReset();
  spies.selectSpy.mockReset();
  spies.orderSpy.mockReset();
  spies.eqSpy.mockReset();
  spies.upsertSpy.mockReset();
  spies.upsertSelectSpy.mockReset();
  spies.upsertSingleSpy.mockReset();
  spies.deleteSpy.mockReset();
  spies.insertSpy.mockReset();
  spies.insertSelectSpy.mockReset();
  spies.insertSingleSpy.mockReset();
  spies.updateSpy.mockReset();
};

describe("endurance availability repository (Fase 3 data-access routing)", () => {
  beforeEach(resetChains);

  it("list — selecteert uitsluitend endurance_availability met de juiste kolommen", async () => {
    spies.orderSpy.mockResolvedValue({ data: [], error: null });
    spies.eqSpy.mockReturnValue({ order: spies.orderSpy });
    spies.selectSpy.mockReturnValue({ eq: spies.eqSpy });
    spies.fromSpy.mockReturnValue({ select: spies.selectSpy });

    await listEnduranceAvailability("evt-1");

    expect(spies.fromSpy).toHaveBeenCalledTimes(1);
    expect(spies.fromSpy).toHaveBeenCalledWith("endurance_availability");
    expect(spies.selectSpy).toHaveBeenCalledWith("id,event_id,user_id,start_at,end_at,type,note");
  });

  it("upsert — schrijft naar endurance_availability (super-admin-sessie)", async () => {
    spies.upsertSingleSpy.mockResolvedValue({ data: { id: "blk-1" }, error: null });
    spies.upsertSelectSpy.mockReturnValue({ single: spies.upsertSingleSpy });
    spies.upsertSpy.mockReturnValue({ select: spies.upsertSelectSpy });
    spies.fromSpy.mockReturnValue({ upsert: spies.upsertSpy });

    await upsertEnduranceAvailability({
      event_id: "evt-1",
      user_id: "usr-1",
      start_at: "2026-09-01T10:00:00Z",
      end_at: "2026-09-01T11:00:00Z",
      type: "available",
      note: null,
    });

    expect(spies.fromSpy).toHaveBeenCalledWith("endurance_availability");
    const payload = spies.upsertSpy.mock.calls[0][0];
    expect(payload.event_id).toBe("evt-1");
    expect(payload.type).toBe("available");
  });

  it("delete — verwijdert via endurance_availability", async () => {
    spies.deleteSpy.mockResolvedValue({ error: null });
    spies.fromSpy.mockReturnValue({ delete: () => ({ eq: spies.deleteSpy }) });

    await deleteEnduranceAvailability("blk-1");

    expect(spies.fromSpy).toHaveBeenCalledWith("endurance_availability");
    expect(spies.deleteSpy).toHaveBeenCalledWith("id", "blk-1");
  });
});

describe("endurance plan repository (Fase 3 data-access routing)", () => {
  beforeEach(resetChains);

  it("list versions — selecteert uitsluitend endurance_planning_versions", async () => {
    spies.orderSpy.mockResolvedValue({ data: [], error: null });
    // .select().eq().eq().order() — elke eq geeft een keten met eq én order terug.
    spies.eqSpy.mockReturnValue({ eq: spies.eqSpy, order: spies.orderSpy });
    spies.selectSpy.mockReturnValue({ eq: spies.eqSpy });
    spies.fromSpy.mockReturnValue({ select: spies.selectSpy });

    await listEndurancePlanningVersions("evt-1", "team-1");

    expect(spies.fromSpy).toHaveBeenCalledTimes(1);
    expect(spies.fromSpy).toHaveBeenCalledWith("endurance_planning_versions");
  });

  it("list confirmations — selecteert uitsluitend endurance_confirmations", async () => {
    spies.eqSpy.mockResolvedValue({ data: [], error: null });
    spies.selectSpy.mockReturnValue({ eq: spies.eqSpy });
    spies.fromSpy.mockReturnValue({ select: spies.selectSpy });

    await listEnduranceConfirmations("ver-1");

    expect(spies.fromSpy).toHaveBeenCalledWith("endurance_confirmations");
  });

  it("publish — schrijft versie naar endurance_planning_versions en bevestigingen naar endurance_confirmations", async () => {
    spies.insertSingleSpy.mockResolvedValue({ data: { id: "ver-9" }, error: null });
    spies.insertSelectSpy.mockReturnValue({ single: spies.insertSingleSpy });
    spies.insertSpy.mockReturnValue({ select: spies.insertSelectSpy });
    spies.fromSpy
      .mockReturnValueOnce({ insert: spies.insertSpy })
      .mockReturnValueOnce({ insert: spies.insertSpy });

    await publishEndurancePlan({
      event_id: "evt-1",
      team_id: "team-1",
      label: "Versie 1",
      created_by: "usr-admin",
      stints: [],
      confirmations: [{ user_id: "usr-1", status: "unseen" }],
    });

    expect(spies.fromSpy).toHaveBeenNthCalledWith(1, "endurance_planning_versions");
    expect(spies.fromSpy).toHaveBeenNthCalledWith(2, "endurance_confirmations");
    const versionPayload = spies.insertSpy.mock.calls[0][0];
    expect(versionPayload.published).toBe(true);
    const confirmPayloads = spies.insertSpy.mock.calls[1][0];
    expect(confirmPayloads[0].user_id).toBe("usr-1");
    expect(confirmPayloads[0].version_id).toBe("ver-9");
  });

  it("update confirmation — werkt endurance_confirmations bij", async () => {
    spies.updateSpy.mockResolvedValue({ error: null });
    let updatePayload: unknown;
    spies.fromSpy.mockReturnValue({
      update: (payload: unknown) => {
        updatePayload = payload;
        return { eq: () => ({ eq: spies.updateSpy }) };
      },
    });

    await updateEnduranceConfirmation("ver-1", "usr-1", "accepted");

    expect(spies.fromSpy).toHaveBeenCalledWith("endurance_confirmations");
    expect((updatePayload as { status: string }).status).toBe("accepted");
    expect(spies.updateSpy).toHaveBeenCalledWith("user_id", "usr-1");
  });
});
