import { describe, expect, it } from "vitest";
import { advise } from "./advise";
import { buildStrategySnapshot } from "./snapshot";
import type { PitwallStrategyRow, V3Normalized } from "../pitwallHelpers";

const strategy = (overrides: Partial<PitwallStrategyRow> = {}): PitwallStrategyRow => ({
  race_run_id: "run",
  event_id: "event",
  team_id: "team",
  fuel_per_lap_litres: 2.95,
  race_fuel_per_lap_litres: 3.0,
  fuel_laps_remaining: 13,
  valid_fuel_sample_count: 9,
  current_stint_valid_sample_count: 5,
  current_fuel_stint: 2,
  last_completed_laps: 22,
  current_fuel_litres: 39.5,
  session_laps_remaining: 18,
  fuel_to_finish_litres: 54,
  fuel_sufficient_to_finish: false,
  strategy_status: "ready",
  strategy_reason: null,
  updated_at: "2026-10-24T14:00:00.000Z",
  fuel_to_add_litres: 41,
  ...overrides,
});

const v3: V3Normalized = {
  capturedAt: "2026-10-24T14:00:01.000Z",
  timing: { completedLaps: 23, lastLapTimeSeconds: 90.4 },
  session: { sessionTimeSeconds: 1234 },
  fuel: { fuelLitres: 38.2, fuelCapacityLitres: 100 },
};

describe("buildStrategySnapshot", () => {
  it("neemt de live waarden boven de strategierij", () => {
    const snapshot = buildStrategySnapshot({
      strategy: strategy(),
      v3,
      nowMs: Date.parse("2026-10-24T14:00:02.000Z"),
      plannedLaps: 40,
    });

    expect(snapshot.fuelLitres).toBe(38.2);
    expect(snapshot.lapsCompleted).toBe(23);
    expect(snapshot.currentLapSeconds).toBe(90.4);
    expect(snapshot.tankCapacityLitres).toBe(100);
    expect(snapshot.plannedLaps).toBe(40);
    expect(snapshot.raceClockSeconds).toBe(1234);
  });

  it("valt terug op de strategierij zonder telemetrie", () => {
    const snapshot = buildStrategySnapshot({
      strategy: strategy(),
      v3: null,
      nowMs: Date.parse("2026-10-24T14:00:02.000Z"),
    });

    expect(snapshot.fuelLitres).toBe(39.5);
    expect(snapshot.lapsCompleted).toBe(22);
    expect(snapshot.tankCapacityLitres).toBeNull();
  });

  it("rekent de leeftijd van de meting uit", () => {
    const snapshot = buildStrategySnapshot({
      strategy: strategy(),
      v3: null,
      nowMs: Date.parse("2026-10-24T14:00:09.000Z"),
    });
    expect(snapshot.sampleAgeSeconds).toBe(9);
  });

  it("gebruikt het raceverbruik als prior en niet het losse getal", () => {
    const snapshot = buildStrategySnapshot({ strategy: strategy(), v3 });
    expect(snapshot.fuelPerLapPrior).toBe(3.0);
  });

  it("geeft geen advies als alles ontbreekt", () => {
    const advice = advise(buildStrategySnapshot({ strategy: null, v3: null, nowMs: Date.now() }));
    expect(advice.decision).toBe("NO_ADVICE");
    expect(advice.reasonCode).toBe("stale_telemetry");
  });

  it("levert een voorlopig advies op de servermeting", () => {
    const advice = advise(
      buildStrategySnapshot({
        strategy: strategy({ current_fuel_litres: 30 }),
        v3: null,
        nowMs: Date.parse("2026-10-24T14:00:01.000Z"),
      }),
    );
    expect(advice.decision).not.toBe("NO_ADVICE");
    expect(advice.confidence).toBe("low");
    expect(advice.lapsOnFuel).toBeGreaterThan(0);
  });
});
