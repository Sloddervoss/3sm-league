import { describe, expect, it } from "vitest";
import { qualifyServerFacts, type ServerFuelFacts } from "./serverEvidence";

const base: ServerFuelFacts = {
  id: "0c1f0a4e-5b0e-4d6e-9f0e-2b1c3d4e5f60",
  owner: "11111111-2222-4333-8444-555555555555",
  device: "8ea3fe36-c973-43ca-abcb-971420f5b81d",
  policyVersion: 1,
  knownAt: 1_800_000_125_000,
  collectionStartedAt: 1_790_000_000_000,
  allowed: true,
  superseded: false,
  driver: "Bart Tonkes",
  car: "porsche992rgt3",
  track: 95,
  layout: "International",
  sessionType: "Race",
  sessionKey: "simhub-c37ea97ec9ae4938b8f2267effd715db",
  lap: 4,
  startedAt: 1_800_000_000_000,
  endedAt: 1_800_000_120_000,
  samples: 1203,
  maxGapSeconds: 0.115,
  validDurationSeconds: 120.201,
  lapDurationSeconds: 120,
  fuelStartLitres: 35.8635,
  fuelEndLitres: 32.2479,
};

const withFacts = (patch: Partial<ServerFuelFacts>): ServerFuelFacts => ({ ...base, ...patch });

describe("qualifyServerFacts", () => {
  it("maps a complete server fact set onto the shared observation contract", () => {
    const observation = qualifyServerFacts(base);
    expect(observation).not.toBeNull();
    expect(observation?.revision).toBe(base.id);
    expect(observation?.usedLitres).toBeCloseTo(3.6156, 4);
    expect(observation?.lap).toBe(4);
    expect(observation?.session).toBe(JSON.stringify([base.sessionKey]));
    // Same context shape as the client qualifier: owner, device, driver, car, track, layout.
    expect(observation?.context).toBe(JSON.stringify([
      base.owner, base.device, base.driver, base.car, base.track, base.layout,
    ]));
    expect(observation?.scope).toEqual({ driver: base.driver, car: base.car, track: base.track, layout: base.layout });
  });

  it("refuses a refused or superseded answer", () => {
    expect(qualifyServerFacts(null)).toBeNull();
    expect(qualifyServerFacts(withFacts({ allowed: false }))).toBeNull();
    expect(qualifyServerFacts(withFacts({ superseded: true }))).toBeNull();
  });

  it("stores litres without float noise so a replay produces the same observation", () => {
    // 35.8635 - 32.2479 is 3.6156000000000013 in IEEE-754; the sink compares
    // litres as numbers, so the stored value must be the four-decimal fuel.
    const observation = qualifyServerFacts(base);
    expect(observation?.usedLitres).toBe(3.6156);
    expect(qualifyServerFacts(withFacts({}))?.usedLitres).toBe(observation?.usedLitres);
  });

  it("refuses a lap that cannot be attributed to a session type", () => {
    // Testritten zijn precies de vervuiling: geen soort, of Test, betekent niet leren.
    expect(qualifyServerFacts(withFacts({ sessionType: null }))).toBeNull();
    expect(qualifyServerFacts(withFacts({ sessionType: "" }))).toBeNull();
    expect(qualifyServerFacts(withFacts({ sessionType: "Test" }))).toBeNull();
    expect(qualifyServerFacts(withFacts({ sessionType: "Offline Testing" }))).toBeNull();
    expect(qualifyServerFacts(withFacts({ sessionType: "Practice" }))?.sessionType).toBe("Practice");
    expect(qualifyServerFacts(withFacts({ sessionType: "Race" }))?.sessionType).toBe("Race");
  });

  it("refuses an incomplete sample train", () => {
    expect(qualifyServerFacts(withFacts({ samples: 1 }))).toBeNull();
    expect(qualifyServerFacts(withFacts({ maxGapSeconds: 1.2 }))).toBeNull();
    expect(qualifyServerFacts(withFacts({ validDurationSeconds: 100 }))).toBeNull();
  });

  it("refuses impossible or unverifiable fuel deltas", () => {
    expect(qualifyServerFacts(withFacts({ fuelEndLitres: 35.9 }))).toBeNull();
    expect(qualifyServerFacts(withFacts({ fuelEndLitres: 10 }))).toBeNull();
    expect(qualifyServerFacts(withFacts({ fuelStartLitres: 5, fuelEndLitres: 4.9 }))).toBeNull();
  });

  it("refuses a label that arrived before the lap or too late", () => {
    expect(qualifyServerFacts(withFacts({ knownAt: 1_800_000_100_000 }))).toBeNull();
    expect(qualifyServerFacts(withFacts({ knownAt: 1_800_000_600_001 }))).toBeNull();
  });

  it("refuses a lap that started before collection was switched on", () => {
    expect(qualifyServerFacts(withFacts({ collectionStartedAt: 1_800_000_000_000 }))).toBeNull();
  });

  it("refuses missing identity instead of inventing one", () => {
    expect(qualifyServerFacts(withFacts({ car: "" }))).toBeNull();
    expect(qualifyServerFacts(withFacts({ driver: " Bart" }))).toBeNull();
    expect(qualifyServerFacts(withFacts({ track: -1 }))).toBeNull();
    expect(qualifyServerFacts(withFacts({ sessionKey: "" }))).toBeNull();
  });

  it("refuses a lap duration that does not match the timestamps", () => {
    expect(qualifyServerFacts(withFacts({ lapDurationSeconds: 300 }))).toBeNull();
    expect(qualifyServerFacts(withFacts({ endedAt: base.startedAt }))).toBeNull();
  });
});
