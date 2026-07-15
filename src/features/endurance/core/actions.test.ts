import { describe, expect, it } from "vitest";
import { reduceEnduranceState } from "./actions";
import { createEnduranceSeed } from "./seed";

describe("endurance reducer", () => {
  it("preserves original times while shifting live times", () => {
    const state = createEnduranceSeed();
    const next = reduceEnduranceState(state, {
      type: "adjust_future_stints",
      eventId: state.events[0].id,
      fromAt: state.events[0].startAt,
      deltaMinutes: 10,
    });
    expect(next.stints[0].originalStartAt).toBe(state.stints[0].originalStartAt);
    expect(next.stints[0].actualStartAt).toBe("2026-07-25T11:10:00.000Z");
    expect(next.auditLog[0].action).toBe("adjust_future_stints");
  });

  it("removes private access membership when a registration is removed", () => {
    const state = createEnduranceSeed();
    const next = reduceEnduranceState(state, { type: "remove_registration", eventId: state.events[0].id, userId: "user-jaimy" });
    expect(next.registrations.some((registration) => registration.userId === "user-jaimy")).toBe(false);
    expect(next.teamMembers.some((member) => member.userId === "user-jaimy")).toBe(false);
  });

  it("restores an immutable planning snapshot", () => {
    const state = createEnduranceSeed();
    const version = { id: "version-1", eventId: state.events[0].id, label: "Definitief", createdAt: new Date().toISOString(), createdBy: state.activePersonaId, published: true, stints: state.stints.map((stint) => ({ ...stint })) };
    const published = reduceEnduranceState(state, { type: "publish_plan", version, confirmations: [], notifications: [] });
    const shifted = reduceEnduranceState(published, { type: "adjust_future_stints", eventId: state.events[0].id, fromAt: state.events[0].startAt, deltaMinutes: 15 });
    const restored = reduceEnduranceState(shifted, { type: "restore_plan", versionId: version.id });
    expect(restored.stints[0].actualStartAt).toBe(state.stints[0].actualStartAt);
  });
});
