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
  it("comfort mode caps each stint to the driver max stint duration", () => {
    const state = createEnduranceSeed();
    const stints = generateStints(state, state.events[0], "team-orange-31", 90, {
      mode: "comfort",
      driverLimits: { "user-jaimy": { maxStintMinutes: 60 } },
    });
    expect(stints.length).toBeGreaterThan(0);
    for (const stint of stints) {
      const durationMin = (Date.parse(stint.actualEndAt) - Date.parse(stint.actualStartAt)) / 60_000;
      if (stint.driverId === "user-jaimy") expect(durationMin).toBeLessThanOrEqual(60.001);
    }
  });
  it("race mode preserves explicit per-driver limits", () => {
    const state = createEnduranceSeed();
    const stints = generateStints(state, state.events[0], "team-orange-31", 90, {
      mode: "race",
      driverLimits: { "user-jaimy": { maxStintMinutes: 60 } },
    });
    for (const s of stints.filter(s => s.driverId === "user-jaimy")) expect((Date.parse(s.actualEndAt)-Date.parse(s.actualStartAt))/60000).toBeLessThanOrEqual(60);
  });
  it("hard limit: never exceeds max consecutive stints for a driver", () => {
    const state = createEnduranceSeed();
    const stints = generateStints(state, state.events[0], "team-orange-31", 90, {
      mode: "race",
      driverLimits: { "user-jaimy": { maxConsecutiveStints: 1 }, "user-sven": { maxConsecutiveStints: 1 } },
    });
    for (let i = 1; i < stints.length; i++) {
      expect(stints[i].driverId).not.toBe(stints[i - 1].driverId); // no driver twice in a row
    }
    // beide coureurs wisselen af
    expect(stints[0].driverId).not.toBe(stints[1].driverId);
  });
  it("hard limit: startcoureur mag alleen stint 0 rijden als die beschikbaar is", () => {
    const state = createEnduranceSeed();
    const stints = generateStints(state, state.events[0], "team-orange-31", 90, {
      mode: "race",
      firstStintDriver: "user-jaimy",
      driverLimits: { "user-jaimy": { willingToStart: true } },
    });
    expect(stints[0].driverId).toBe("user-jaimy");
  });
  it("hard limit: min rest time prevents a driver from back-to-back short gaps", () => {
    const state = createEnduranceSeed();
    // Geef een lange race (meerdere stints) zodat resttijd relevant is.
    const eventLong = { ...state.events[0], startAt: "1973-06-09T14:00:00.000Z", endAt: "1973-06-10T14:00:00.000Z" };
    // Two drivers cannot cover 24h in 90-minute stints with four hours rest.
    expect(() => generateStints({ ...state, availability: [], teamMembers: state.teamMembers.filter(m => m.role === "driver") }, eventLong, "team-orange-31", 90, {
      mode: "race", driverLimits: { "user-jaimy": { minRestMinutes: 240 }, "user-sven": { minRestMinutes: 240 } },
    })).toThrow(/Geen geldige coureur/);
  });
});
