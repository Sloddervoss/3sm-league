import { describe, expect, it } from "vitest";
import { fitFuelCandidate, FUEL_CANDIDATE_POLICY, type FuelExample } from "./fuelCandidate";

// Synthetic measurements with a known causal ratio, not production accuracy evidence.
function fixture(ratio = 1.04): FuelExample[] {
  return Array.from({ length: 20 }, (_, session) => Array.from({ length: 5 }, (_, lap) => {
    const previous = 2 + lap / 100;
    const start = session * 100_000 + 1;
    return {
      id: `${session}:${lap}`, owner: "owner-a", context: "car-track-layout-a", session: `session-${session}`,
      sessionStartedAt: start, featureKnownAt: start + lap * 1000 + 10,
      targetStartedAt: start + lap * 1000 + 20, labelKnownAt: start + lap * 1000 + 100,
      previousLitres: previous, usedLitres: previous * ratio,
      baselineSamples: [previous, previous, previous], qualified: true,
    };
  })).flat();
}
const asOf = 2_000_000;

describe("personal fuel candidate (synthetic)", () => {
  it("fits a nonconstant causal model and independently verifies analytical holdout errors", () => {
    const candidate = fitFuelCandidate(fixture(), asOf)!;
    expect(candidate.eligible).toBe(true);
    expect(candidate.ratio).toBeCloseTo(1.04, 12);
    expect(candidate.metrics.mae).toBeCloseTo(0, 12);
    // Baseline is exactly previousLitres; analytical mean error is .04 * 2.02.
    expect(candidate.metrics.baselineMae).toBeCloseTo(0.0808, 12);
    expect(candidate.metrics.coverage).toBe(1);
    expect(candidate.split.train).toHaveLength(10);
    expect(candidate.split.calibration).toHaveLength(5);
    expect(candidate.split.test).toHaveLength(5);
    expect(new Set(Object.values(candidate.split).flat()).size).toBe(20);
  });
  it("changed measurements change fitted parameters and predictions", () => {
    const first = fitFuelCandidate(fixture(1.02), asOf)!;
    const second = fitFuelCandidate(fixture(1.07), asOf)!;
    expect(second.ratio).toBeGreaterThan(first.ratio);
    expect(2 * second.ratio).toBeCloseTo(2.14, 12);
  });
  it("never fits on test labels", () => {
    const input = fixture();
    for (const row of input.slice(-25)) row.usedLitres *= 1.2;
    const candidate = fitFuelCandidate(input, asOf)!;
    expect(candidate.ratio).toBeCloseTo(1.04, 12);
    expect(candidate.eligible).toBe(false);
    expect(candidate.metrics.coverage).toBe(0);
    expect(candidate.metrics.relativeDrift).toBeCloseTo(0.2, 12);
  });
  it("rejects insufficient evidence rather than promoting a small exact fit", () => {
    expect(fitFuelCandidate(fixture().slice(1), asOf)).toBeNull();
    const input = fixture();
    for (const row of input.slice(-5)) row.session = "session-18";
    expect(fitFuelCandidate(input, asOf)).toBeNull();
  });
  it.each(["owner", "context", "sessionStartedAt", "qualified", "previousLitres", "labelKnownAt", "featureKnownAt"] as const)("fails closed on invalid %s", (field) => {
    const input = fixture();
    const row = input[0];
    switch (field) {
      case "owner": row.owner = "other-owner"; break;
      case "context": row.context = "other-layout"; break;
      case "sessionStartedAt": row.sessionStartedAt = NaN; break;
      case "qualified": row.qualified = false; break;
      case "previousLitres": row.previousLitres = Infinity; break;
      case "labelKnownAt": row.labelKnownAt = asOf + 1; break;
      case "featureKnownAt": row.featureKnownAt = row.targetStartedAt; break;
    }
    expect(fitFuelCandidate(input, asOf)).toBeNull();
  });
  it("rejects duplicate identities and overlapping session groups", () => {
    const duplicate = fixture(); duplicate[1].id = duplicate[0].id;
    expect(fitFuelCandidate(duplicate, asOf)).toBeNull();
    const overlap = fixture(); overlap[4].labelKnownAt = overlap[5].sessionStartedAt;
    expect(fitFuelCandidate(overlap, asOf)).toBeNull();
  });
  it("keeps the unchanged exact baseline when there is no measurable improvement", () => {
    expect(fitFuelCandidate(fixture(1), asOf)!.eligible).toBe(false);
  });
  it("pins thresholds before scoring", () => {
    expect(Object.isFrozen(FUEL_CANDIDATE_POLICY)).toBe(true);
    expect(FUEL_CANDIDATE_POLICY.minimumImprovement).toBe(0.1);
    expect(FUEL_CANDIDATE_POLICY.maximumRelativeWidth).toBe(0.2);
    expect(FUEL_CANDIDATE_POLICY.maximumRelativeDrift).toBe(0.1);
  });
});
