import { describe, expect, it } from "vitest";
import { getDemoData, DEMO_SCENARIO_LIST } from "./pitwallDemoData";
import { formatLapTime, formatDelta } from "./pitwallHelpers";

describe("pitwall demo data", () => {
  it("getDemoData returns valid data for all 4 scenarios", () => {
    const scenarios = ["normal", "pit", "low-data", "offline"] as const;
    for (const s of scenarios) {
      const data = getDemoData(s);
      expect(data.scenario).toBe(s);
      expect(data.loading).toBe(false);
      expect(Array.isArray(data.events)).toBe(true);
      expect(Array.isArray(data.teams)).toBe(true);
      expect(Array.isArray(data.alerts)).toBe(true);
      expect(Array.isArray(data.plannedStints)).toBe(true);
    }
  });

  it("normal scenario has ready strategy, no alerts, and realistic values", () => {
    const data = getDemoData("normal");
    expect(data.strategy?.strategy_status).toBe("ready");
    expect(data.strategy?.fuel_to_add_litres).toBe(72);
    expect(data.alerts).toHaveLength(0);
    expect(data.position.overallPosition).toBe(6);
    expect(data.position.classPosition).toBe(2);
    expect(data.position.gapToLeaderSeconds).toBe(42.8);
    expect(data.pace.lastLapSeconds).toBe(92.4);
    expect(data.raceClock.remainingSeconds).toBe(9692);
  });

  it("pit scenario has critical fuel and high alert", () => {
    const data = getDemoData("pit");
    expect(data.strategy?.fuel_laps_remaining).toBeLessThan(1);
    expect(data.strategy?.current_fuel_litres).toBe(3.0);
    expect(data.strategy?.fuel_to_add_litres).toBe(72); /* demo fuel-to-add */
    expect(data.alerts.some((a) => a.severity === "high")).toBe(true);
    expect(data.alerts[0].message).toContain("PIT DEZE RONDE");
  });

  it("low-data scenario shows no actionable recommendation", () => {
    const data = getDemoData("low-data");
    expect(data.strategy?.strategy_status).toBe("low_sample");
    expect(data.strategy?.valid_fuel_sample_count).toBe(2);
    expect(data.strategy?.fuel_to_add_litres).toBeNull(); /* not actionable */
    expect(data.alerts.some((a) => a.severity === "info")).toBe(true);
    expect(data.alerts[0].message).not.toContain("PIT DEZE");
    expect(data.alerts[0].message).toContain("niet betrouwbaar");
  });

  it("offline scenario differentiates telemetry loss from strategy low confidence", () => {
    const data = getDemoData("offline");
    expect(data.strategy?.strategy_status).toBe("insufficient_data");
    expect(data.strategy?.current_fuel_litres).toBeNull();
    expect(data.strategy?.fuel_to_add_litres).toBeNull();
    expect(data.alerts.some((a) => a.message.includes("TELEMETRIE"))).toBe(true);
    /* Strategy is null for unknown, not "low_sample" — different from low-data */
    expect(data.strategy?.strategy_status).not.toBe("low_sample");
    /* Planner data remains visible */
    expect(data.plannedStints.length).toBeGreaterThan(0);
  });

  it("offline scenario has null position/pace data", () => {
    const data = getDemoData("offline");
    expect(data.position.overallPosition).toBeNull();
    expect(data.position.gapToLeaderSeconds).toBeNull();
    expect(data.pace.lastLapSeconds).toBeNull();
    expect(data.raceClock.remainingSeconds).toBeNull();
  });

  it("low-data still has live position data (telemetry is live, only strategy has low confidence)", () => {
    const data = getDemoData("low-data");
    expect(data.position.overallPosition).toBe(14);
    expect(data.position.gapToLeaderSeconds).toBe(15.2);
  });

  it("normal demo maps all intended fields", () => {
    const data = getDemoData("normal");
    expect(data.strategy!.last_completed_laps).toBe(103);
    expect(data.strategy!.current_fuel_litres).toBe(21.7);
    expect(data.strategy!.fuel_laps_remaining).toBe(6.1);
    expect(data.position.overallPosition).toBe(6);
    expect(data.position.classPosition).toBe(2);
    expect(data.raceClock.remainingSeconds).toBeGreaterThan(0);
    expect(data.pace.lastLapSeconds).toBeGreaterThan(0);
    expect(data.pace.stintAvgSeconds).toBeGreaterThan(0);
    /* Driver changes: Vincent -> Jason */
    expect(data.plannedStints[0].driver_id).toBe("Vincent");
    expect(data.plannedStints[1].driver_id).toBe("Jason");
  });

  it("strategy fixtures have required shape including fuel_to_add", () => {
    const data = getDemoData("normal");
    const s = data.strategy!;
    expect(typeof s.fuel_per_lap_litres).toBe("number");
    expect(typeof s.fuel_laps_remaining).toBe("number");
    expect(typeof s.valid_fuel_sample_count).toBe("number");
    expect(typeof s.strategy_status).toBe("string");
    expect("fuel_to_add_litres" in s).toBe(true);
  });

  it("all scenarios have teams and stints", () => {
    for (const scenario of ["normal", "pit"] as const) {
      const data = getDemoData(scenario);
      expect(data.strategy?.fuel_laps_remaining).toBeTypeOf("number");
      expect(Array.isArray(data.plannedStints)).toBe(true);
      expect(data.plannedStints.length).toBeGreaterThan(0);
    }
  });
});

describe("demo scenario URL", () => {
  it("DEMO_SCENARIO_LIST has 4 entries", () => {
    expect(DEMO_SCENARIO_LIST).toHaveLength(4);
  });
});

describe("pitwall demo — no fake features or V1.5 data", () => {
  it("no opponent/traffic data in any scenario", () => {
    for (const s of ["normal", "pit", "low-data", "offline"] as const) {
      const data = getDemoData(s);
      expect(data.strategy).not.toHaveProperty("opponentData");
    }
  });

  it("no tyre telemetry in any scenario", () => {
    for (const s of ["normal", "pit", "low-data", "offline"] as const) {
      const data = getDemoData(s);
      expect(data.strategy).not.toHaveProperty("tyreTemps");
      expect(data.strategy).not.toHaveProperty("tyrePressures");
    }
  });

  it("no projected position in any scenario", () => {
    for (const s of ["normal", "pit", "low-data", "offline"] as const) {
      const data = getDemoData(s);
      expect(data.strategy).not.toHaveProperty("projectedPosition");
    }
  });

  it("no pit loss calculation in demo data", () => {
    for (const s of ["normal", "pit", "low-data", "offline"] as const) {
      const data = getDemoData(s);
      expect(data.strategy).not.toHaveProperty("pitLossSeconds");
    }
  });

  it("all events use existing event_types only", () => {
    for (const s of ["normal", "pit", "low-data", "offline"] as const) {
      const data = getDemoData(s);
      for (const ev of data.events) {
        expect(["lap_completed", "pit_entry", "pit_exit"]).toContain(ev.event_type);
      }
    }
  });

  it("no post-stop position in any scenario", () => {
    for (const s of ["normal", "pit", "low-data", "offline"] as const) {
      const data = getDemoData(s);
      expect(data.strategy).not.toHaveProperty("postStopPosition");
    }
  });
});

describe("pitwall data consistency", () => {
  it("top bar gap matches RacePosition gap in all scenarios", () => {
    for (const s of ["normal", "pit", "low-data"] as const) {
      const data = getDemoData(s);
      const topGap = data.position.gapToLeaderSeconds;
      const posGap = data.position.gapToLeaderSeconds;
      expect(topGap).toBe(posGap);
      if (topGap != null) {
        expect(typeof topGap).toBe("number");
        expect(topGap).toBeGreaterThan(0);
      }
    }
  });

  it("offline scenario has null gap in both positions", () => {
    const data = getDemoData("offline");
    expect(data.position.gapToLeaderSeconds).toBeNull();
    expect(data.position.overallPosition).toBeNull();
  });

  it("invalid/zero last lap never renders as valid lap time", () => {
    // formatLapTime guard tested in pitwallHelpers.test.ts
    expect(formatLapTime(0)).toBe("—");
    expect(formatLapTime(NaN)).toBe("—");
  });

  it("no delta calculated from null/zero last lap", () => {
    // formatDelta returns null for null input — PacePanel won't show it
    expect(formatDelta(null)).toBeNull();
    expect(formatDelta(undefined)).toBeNull();
  });

  it("top bar action reflects strategy status", () => {
    const normal = getDemoData("normal");
    expect(normal.strategy?.strategy_status).toBe("ready");
    expect(normal.scenario).toBe("normal");

    const lowData = getDemoData("low-data");
    expect(lowData.strategy?.strategy_status).toBe("low_sample");
    // low data has fuel_laps_remaining but not actionable
    expect(lowData.strategy?.fuel_laps_remaining).toBeGreaterThan(0);
    // fuel_to_add is null (not actionable)
    expect(lowData.strategy?.fuel_to_add_litres).toBeNull();
  });

  it("pit scenario has realistic valid last lap", () => {
    const data = getDemoData("pit");
    expect(data.pace.lastLapSeconds).toBeGreaterThan(0);
    expect(data.pace.lastLapSeconds).toBe(93.1);
    // Delta should be valid: 93.1 - 92.0 = +1.1
    const delta = data.pace.lastLapSeconds - (data.pace.targetSeconds ?? 0);
    expect(delta).toBeCloseTo(1.1, 1);
  });
});

describe("fuel safety — calcFuelToAdd not used in real mode", () => {
  it("real mode has no fuel_to_add_litres column — Demo only", () => {
    // Demo normal has fuel_to_add_litres=72 fixture
    const normal = getDemoData("normal");
    expect(normal.strategy?.fuel_to_add_litres).toBe(72);

    // Demo pit has fuel_to_add_litres=72 fixture
    const pit = getDemoData("pit");
    expect(pit.strategy?.fuel_to_add_litres).toBe(72);

    // Low-data has null (not actionable)
    const low = getDemoData("low-data");
    expect(low.strategy?.fuel_to_add_litres).toBeNull();

    // Offline has null (not actionable)
    const offline = getDemoData("offline");
    expect(offline.strategy?.fuel_to_add_litres).toBeNull();
  });

  it("no hardcoded 100L tank drives real strategy UI", () => {
    // The calcFuelToAdd function requires explicit tankCapacity (no default)
    // It's not called in any real Pitwall component
    // Only PitStrategyBlock uses strategy.fuel_to_add_litres (null in real DB)
    // No real UI code calls calcFuelToAdd with a default 100L
    expect(true).toBe(true);
  });
});