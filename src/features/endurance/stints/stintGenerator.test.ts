import { describe, expect, it } from "vitest";
import { createEnduranceSeed } from "../core/seed";
import { generateStints } from "./stintGenerator";

describe("stint generator", () => {
  it("covers the complete race without gaps", () => {
    const state = createEnduranceSeed(); const event = state.events[0];
    const stints = generateStints(state, event, "team-orange-31", 90);
    expect(stints[0].actualStartAt).toBe(event.startAt);
    expect(stints.at(-1)?.actualEndAt).toBe(event.endAt);
    expect(stints).toHaveLength(4);
  });
  it("returns no plan for a team without drivers", () => {
    const state = createEnduranceSeed();
    expect(generateStints(state, state.events[0], "team-graphite-73", 90)).toEqual([]);
  });
});
