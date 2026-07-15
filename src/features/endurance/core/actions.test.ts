import { describe, expect, it } from "vitest";
import { reduceEnduranceState } from "./actions";
import { createEnduranceSeed } from "./seed";

describe("endurance reducer", () => {
  it("preserves original times while shifting live times", () => {
    const state = createEnduranceSeed();
    const next = reduceEnduranceState(state, {
      type: "adjust_future_stints",
      eventId: state.events[0].id,
      teamId: "team-orange-31",
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
    const graphiteStint = { ...state.stints[0], id: "stint-graphite", teamId: "team-graphite-73", status: "draft" as const };
    const graphiteVersion = { id: "version-graphite", eventId: state.events[0].id, teamId: "team-graphite-73", label: "Graphite 1", createdAt: new Date().toISOString(), createdBy: state.activePersonaId, published: true, stints: [graphiteStint] };
    const graphiteConfirmation = { id: "confirm-graphite", eventId: state.events[0].id, versionId: graphiteVersion.id, userId: "user-sven", status: "unseen" as const, note: "", updatedAt: new Date().toISOString() };
    const withSecondTeam = { ...state, stints: [...state.stints, graphiteStint], planningVersions: [graphiteVersion], confirmations: [graphiteConfirmation] };
    const version = { id: "version-1", eventId: state.events[0].id, teamId: "team-orange-31", label: "Definitief", createdAt: new Date().toISOString(), createdBy: state.activePersonaId, published: true, stints: state.stints.filter((stint) => stint.teamId === "team-orange-31").map((stint) => ({ ...stint })) };
    const published = reduceEnduranceState(withSecondTeam, { type: "publish_plan", version, confirmations: [], notifications: [] });
    expect(published.stints.find((stint) => stint.id === "stint-graphite")?.status).toBe("draft");
    expect(published.confirmations).toContainEqual(graphiteConfirmation);
    const shifted = reduceEnduranceState(published, { type: "adjust_future_stints", eventId: state.events[0].id, teamId: "team-orange-31", fromAt: state.events[0].startAt, deltaMinutes: 15 });
    const restored = reduceEnduranceState(shifted, { type: "restore_plan", versionId: version.id });
    expect(restored.stints.find((stint) => stint.id === "stint-1")?.actualStartAt).toBe(state.stints[0].actualStartAt);
    expect(restored.stints.find((stint) => stint.id === "stint-graphite")).toEqual(graphiteStint);
  });

  it("rejects driver and cross-team manager writes in the command layer", () => {
    const state = createEnduranceSeed();
    const driverState = reduceEnduranceState(state, { type: "set_active_persona", personaId: "user-jaimy" });
    const deniedDriverWrite = reduceEnduranceState(driverState, { type: "adjust_future_stints", eventId: state.events[0].id, teamId: "team-orange-31", fromAt: state.events[0].startAt, deltaMinutes: 10 });
    expect(deniedDriverWrite).toBe(driverState);

    const managerState = reduceEnduranceState(state, { type: "set_active_persona", personaId: "user-ricky" });
    const deniedCrossTeamWrite = reduceEnduranceState(managerState, { type: "adjust_future_stints", eventId: state.events[0].id, teamId: "team-graphite-73", fromAt: state.events[0].startAt, deltaMinutes: 10 });
    expect(deniedCrossTeamWrite).toBe(managerState);
    const allowedOwnTeamWrite = reduceEnduranceState(managerState, { type: "adjust_future_stints", eventId: state.events[0].id, teamId: "team-orange-31", fromAt: state.events[0].startAt, deltaMinutes: 10 });
    expect(allowedOwnTeamWrite).not.toBe(managerState);
  });
});
