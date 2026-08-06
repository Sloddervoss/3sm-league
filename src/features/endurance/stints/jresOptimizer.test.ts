import { describe, expect, it } from "vitest";
import { createEnduranceSeed } from "../core/seed";
import { marshalJresInput, buildJresStints, parseJresOutput, keyFor, runOptimize, type OptimizerFetcher } from "./jresOptimizer";

describe("jresOptimizer marshalling", () => {
  it("builds fixed stint segments covering the full race without gaps", () => {
    const state = createEnduranceSeed();
    const event = state.events[0];
    const segs = buildJresStints(event, 90);
    expect(segs[0].startTime).toBe(event.startAt);
    expect(segs.at(-1)?.endTime).toBe(event.endAt);
    // geen gaten
    for (let i = 1; i < segs.length; i++) expect(segs[i].startTime).toBe(segs[i - 1].endTime);
  });

  it("rounds segments to whole-hour boundaries to avoid the JRES half-hour heap crash", () => {
    const state = createEnduranceSeed();
    // Race die NIET op een heel uur start (JRES crasht anders op halve uren).
    const event = { ...state.events[0], startAt: "2026-09-12T14:37:00.000Z", endAt: "2026-09-12T20:23:00.000Z" };
    const segs = buildJresStints(event, 90);
    expect(segs.length).toBeGreaterThan(0);
    for (const s of segs) {
      expect(s.startTime.endsWith(":00:00.000Z")).toBe(true); // heel uur
      expect(s.endTime.endsWith(":00:00.000Z")).toBe(true); // heel uur
    }
    // dekt het (afgeronde) volledige venster zonder gaten
    for (let i = 1; i < segs.length; i++) expect(segs[i].startTime).toBe(segs[i - 1].endTime);
  });

  it("maps team members to driver/spotter roles", () => {
    const state = createEnduranceSeed();
    const inObj = marshalJresInput(state, state.events[0], ["user-jaimy", "user-sven"], {
      tankMinutes: 90,
      driverOpts: { "user-jaimy": { isDriver: true }, "user-sven": { isSpotter: true } },
    });
    const jaimy = inObj.teamMembers.find((m) => m.name === "user-jaimy");
    expect(jaimy?.isDriver).toBe(true);
    const sven = inObj.teamMembers.find((m) => m.name === "user-sven");
    expect(sven?.isSpotter).toBe(true);
  });

  it("sets consecutiveStints/minRest from driver options", () => {
    const state = createEnduranceSeed();
    const inObj = marshalJresInput(state, state.events[0], ["user-jaimy", "user-sven"], {
      tankMinutes: 90,
      driverOpts: { "user-jaimy": { maxConsecutiveStints: 2, minRestMinutes: 120 }, "user-sven": { maxConsecutiveStints: 3, minRestMinutes: 60 } },
    });
    expect(inObj.consecutiveStints).toBe(2); // min over coureurs
    expect(inObj.minimumRestHours).toBe(1); // 60/60
  });

  it("selects firstStintDriver from willingToStart", () => {
    const state = createEnduranceSeed();
    const inObj = marshalJresInput(state, state.events[0], ["user-jaimy", "user-sven"], {
      tankMinutes: 90,
      driverOpts: { "user-jaimy": { willingToStart: true }, "user-sven": {} },
    });
    expect(inObj.firstStintDriver).toBe("user-jaimy");
  });

  it("produces availability keys rounded to the hour (JRES spec)", () => {
    const state = createEnduranceSeed();
    const inObj = marshalJresInput(state, state.events[0], ["user-jaimy"], { tankMinutes: 90 });
    const keys = Object.keys(inObj.availability["user-jaimy"]).sort();
    for (const k of keys) expect(k).toMatch(/T\d{2}:00:00\.000Z$/);
  });

  it("parses JRES output back into EnduranceStint drafts", () => {
    const state = createEnduranceSeed();
    const event = state.events[0];
    const stints = parseJresOutput(
      {
        schedule: [
          { id: 1, driver: "user-jaimy", spotter: "N/A", startTime: "2026-01-01T12:00:00Z", endTime: "2026-01-01T13:30:00Z" },
          { id: 2, driver: "user-sven", spotter: "N/A", startTime: "2026-01-01T13:30:00Z", endTime: "2026-01-01T15:00:00Z" },
        ],
      },
      event,
      "team-orange-31"
    );
    expect(stints).toHaveLength(2);
    expect(stints[0].driverId).toBe("user-jaimy");
    expect(stints[0].teamId).toBe("team-orange-31");
    expect(stints[0].status).toBe("draft");
    expect(stints[0].notes).toContain("JRES");
  });
});

describe("runOptimize orchestration", () => {
  const seed = () => {
    const state = createEnduranceSeed();
    return { state, event: state.events[0], teamId: "team-orange-31", members: ["user-jaimy", "user-sven"] };
  };
  const okFetcher: OptimizerFetcher = async () => ({
    status: "ok",
    output: {
      schedule: [
        { id: 1, driver: "user-jaimy", spotter: "N/A", startTime: "2026-01-01T12:00:00Z", endTime: "2026-01-01T13:30:00Z" },
        { id: 2, driver: "user-sven", spotter: "N/A", startTime: "2026-01-01T13:30:00Z", endTime: "2026-01-01T15:00:00Z" },
      ],
    },
  });

  it("returns stints on ok from the fetcher", async () => {
    const { state, event, teamId, members } = seed();
    const r = await runOptimize(state, event, members, teamId, { tankMinutes: 90 }, okFetcher);
    expect(r.ok).toBe(true);
    expect(r.stints).toHaveLength(2);
    expect(r.stints[0].driverId).toBe("user-jaimy");
    expect(r.message).toContain("2 stints");
  });

  it("surfaces infeasible from the fetcher", async () => {
    const { state, event, teamId, members } = seed();
    const bad: OptimizerFetcher = async () => ({ status: "infeasible", output: { schedule: [], diagnosis: ["conflict"] } });
    const r = await runOptimize(state, event, members, teamId, { tankMinutes: 90 }, bad);
    expect(r.ok).toBe(false);
    expect(r.stints).toHaveLength(0);
    expect(r.message).toContain("Geen geldige planning");
  });

  it("surfaces error from the fetcher", async () => {
    const { state, event, teamId, members } = seed();
    const bad: OptimizerFetcher = async () => ({ status: "error", error: "boom" });
    const r = await runOptimize(state, event, members, teamId, { tankMinutes: 90 }, bad);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("boom");
  });

  it("guards against no members or too-short tank", async () => {
    const { state, event, teamId } = seed();
    const r = await runOptimize(state, event, [], teamId, { tankMinutes: 3 }, okFetcher);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("Voeg eerst coureurs toe");
  });

  it("propagates scheduler/network exceptions", async () => {
    const { state, event, teamId, members } = seed();
    const bad: OptimizerFetcher = async () => { throw new Error("net down"); };
    await expect(runOptimize(state, event, members, teamId, { tankMinutes: 90 }, bad)).rejects.toThrow("net down");
  });
});
