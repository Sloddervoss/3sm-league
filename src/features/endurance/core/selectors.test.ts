import { describe, expect, it } from "vitest";
import { createEnduranceSeed } from "./seed";
import { canAccessWorkspace, canSeeEventCard, paceConfidence, planningWarnings } from "./selectors";

const state = createEnduranceSeed();
const event = state.events[0];

const persona = (id: string) => state.personas.find((candidate) => candidate.id === id)!;

describe("endurance access rules", () => {
  it("keeps the private workspace hidden from a non-registered member", () => {
    expect(canSeeEventCard(state, event, persona("user-guest"))).toBe(true);
    expect(canAccessWorkspace(state, event, persona("user-guest"))).toBe(false);
  });

  it("allows registered drivers, reserves and managers into the workspace", () => {
    expect(canAccessWorkspace(state, event, persona("user-jaimy"))).toBe(true);
    expect(canAccessWorkspace(state, event, persona("user-milan"))).toBe(true);
    expect(canAccessWorkspace(state, event, persona("user-ricky"))).toBe(true);
    expect(canAccessWorkspace(state, event, persona("user-vincent"))).toBe(true);
  });

  it("does not expose invite-only cards to ordinary members", () => {
    const privateEvent = { ...event, visibility: "invite_only" as const };
    expect(canSeeEventCard(state, privateEvent, persona("user-guest"))).toBe(false);
    expect(canSeeEventCard(state, privateEvent, persona("user-milan"))).toBe(true);
  });
});

describe("planning rules", () => {
  it("marks mature pace data as reliable", () => {
    expect(paceConfidence(state.paceEntries[0])).toBe("Hoog");
  });

  it("detects availability conflicts", () => {
    const conflicted = {
      ...state,
      availability: state.availability.map((block) => block.userId === "user-sven" ? { ...block, type: "unavailable" as const } : block),
    };
    const warnings = planningWarnings(conflicted, event.id, "team-orange-31");
    expect(warnings.some((warning) => warning.level === "hard" && warning.stintId === "stint-3")).toBe(true);
  });
});
