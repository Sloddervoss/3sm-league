import { describe, expect, it } from "vitest";
import {
  isTelemetryLive,
  devicePosition,
  devicePace,
  deviceRaceClock,
  deviceStrategyRow,
  deviceTrackLabel,
  LIVE_WINDOW_MS,
} from "@/features/endurance/pitwall/devicePitwallAdapters";
import type { V3Normalized } from "@/features/endurance/pitwall/pitwallHelpers";

const v3: V3Normalized = {
  identity: { trackName: "Circuit de Spa-Francorchamps", trackConfig: "Grand Prix Pits", carName: "Porsche 911 GT3 R", currentDriverName: "Vincent" },
  session: { isInCar: true, sessionTimeRemainingSeconds: 9692, sessionLapsRemaining: 57 },
  timing: { lastLapTimeSeconds: 92.4, bestLapTimeSeconds: 91.8, completedLaps: 103 },
  position: { position: 6, classPosition: 2, gapToLeaderSeconds: 42.8 },
  fuel: { fuelLitres: 21.7 },
  opponents: [],
};

describe("isTelemetryLive", () => {
  it("true for fresh telemetry", () => {
    expect(isTelemetryLive(new Date().toISOString())).toBe(true);
  });
  it("false for exactly outside the live window", () => {
    const old = new Date(Date.now() - LIVE_WINDOW_MS - 1).toISOString();
    expect(isTelemetryLive(old)).toBe(false);
  });
  it("false for null/empty/garbage", () => {
    expect(isTelemetryLive(null)).toBe(false);
    expect(isTelemetryLive("")).toBe(false);
    expect(isTelemetryLive("not-a-date")).toBe(false);
  });
});

describe("devicePosition", () => {
  it("extracts position from V3", () => {
    expect(devicePosition(v3)).toEqual({ overallPosition: 6, classPosition: 2, gapToLeaderSeconds: 42.8 });
  });
  it("null when no usable position", () => {
    expect(devicePosition({ identity: {} })).toBeNull();
    expect(devicePosition(null)).toBeNull();
  });
});

describe("devicePace", () => {
  it("extracts last/best lap, keeps stint/target honest-null", () => {
    expect(devicePace(v3)).toEqual({ lastLapSeconds: 92.4, bestLapSeconds: 91.8, stintAvgSeconds: null, targetSeconds: null });
  });
  it("null when no timing", () => {
    expect(devicePace({ identity: {} })).toBeNull();
  });
});

describe("deviceRaceClock", () => {
  it("extracts remaining time + laps", () => {
    expect(deviceRaceClock(v3)).toEqual({ remainingSeconds: 9692, remainingLaps: 57 });
  });
  it("null when no session values", () => {
    expect(deviceRaceClock({ identity: {} })).toBeNull();
  });
});

describe("deviceStrategyRow — honest device-scope strategy", () => {
  const row = deviceStrategyRow(v3);
  it("carries live basics (fuel, laps, position-input)", () => {
    expect(row.current_fuel_litres).toBe(21.7);
    expect(row.last_completed_laps).toBe(103);
    expect(row.session_laps_remaining).toBe(57);
  });
  it("NEVER fabricates consumption/strategy values at device scope", () => {
    expect(row.fuel_per_lap_litres).toBeNull();
    expect(row.fuel_laps_remaining).toBeNull();
    expect(row.fuel_to_add_litres).toBeNull();
    expect(row.fuel_to_finish_litres).toBeNull();
    expect(row.fuel_sufficient_to_finish).toBeNull();
  });
  it("flags insufficient data (no raceRun) so panels show — instead of fake recs", () => {
    expect(row.strategy_status).toBe("insufficient_data");
    expect(row.valid_fuel_sample_count).toBe(0);
  });
  it("handles empty telemetry", () => {
    const empty = deviceStrategyRow(null);
    expect(empty.current_fuel_litres).toBeNull();
    expect(empty.last_completed_laps).toBeNull();
    expect(empty.strategy_status).toBe("insufficient_data");
  });
});

describe("deviceTrackLabel — automatic track detection", () => {
  it("prefers V3 identity trackName + config", () => {
    expect(deviceTrackLabel(v3, "old/legacy")).toBe("Circuit de Spa-Francorchamps - Grand Prix Pits");
  });
  it("falls back to legacy track_name when no V3 identity", () => {
    expect(deviceTrackLabel({}, "Zandvoort")).toBe("Zandvoort");
  });
  it("empty when nothing present", () => {
    expect(deviceTrackLabel(null, null)).toBe("");
  });
});