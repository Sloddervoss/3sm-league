import { describe, expect, it } from "vitest";
import { aggregatePracticeLaps } from "./practiceToPace";
import type { PracticeLapRow } from "../repository/practiceRepository";

const lap = (seconds: number, fuel = null, incidents = 0): PracticeLapRow =>
  ({ id: "x", session_id: "s", event_id: "e", user_id: "u", car_id: "car", circuit: "c", lap_seconds: seconds, fuel_used_litres: null, fuel_per_lap_litres: fuel, incident_count: incidents, recorded_at: "2026-01-01T00:00:00Z" }) as PracticeLapRow;

describe("aggregatePracticeLaps", () => {
  it("returns null stats when there are no laps", () => {
    const result = aggregatePracticeLaps([]);
    expect(result.validLaps).toBe(0);
    expect(result.bestLapSeconds).toBeNull();
  });

  it("computes average/median/best/best5 from laps", () => {
    const result = aggregatePracticeLaps([lap(100), lap(96), lap(104), lap(98)]);
    expect(result.validLaps).toBe(4);
    expect(result.averageLapSeconds).toBeCloseTo(99.5, 6);
    expect(result.medianLapSeconds).toBeCloseTo(99, 6);
    expect(result.bestLapSeconds).toBe(96);
    expect(result.bestFiveAverageSeconds).toBeCloseTo(99.5, 6);
  });

  it("ignores invalid (non-positive) lap times", () => {
    const result = aggregatePracticeLaps([lap(100), lap(-5), lap(0)]);
    expect(result.validLaps).toBe(1);
    expect(result.averageLapSeconds).toBe(100);
  });

  it("computes fuel per lap from fuel_per_lap measurements", () => {
    const result = aggregatePracticeLaps([lap(100, 2.4), lap(102, 2.2), lap(101, 2.0)]);
    expect(result.fuelPerLapLitres).toBeCloseTo(2.2, 6);
  });

  it("sums incidents across laps", () => {
    const result = aggregatePracticeLaps([lap(100, null, 1), lap(102, null, 0), lap(101, null, 2)]);
    expect(result.incidents).toBe(3);
  });

  it("returns perfect consistency for identical laps", () => {
    const result = aggregatePracticeLaps([lap(100), lap(100), lap(100)]);
    expect(result.consistencySeconds).toBe(1);
  });
});
