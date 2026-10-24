import { describe, expect, it } from "vitest";
import { planRotation } from "./rotation";

const coureur = (id: string, lapSeconds: number | null, extra: Record<string, number> = {}) => ({
  id,
  name: id,
  lapSeconds,
  ...extra,
});

describe("planRotation", () => {
  it("verdeelt een zesuurrace eerlijk over drie coureurs", () => {
    const plan = planRotation({
      totalMinutes: 360,
      stintMinutes: 60,
      referenceLapSeconds: 97,
      drivers: [coureur("a", 96.8), coureur("b", 97.2), coureur("c", 97.5)],
    });

    expect(plan.reasonCode).toBe("ok");
    expect(plan.stints).toHaveLength(6);
    expect(plan.stints.at(-1)!.endMinute).toBeCloseTo(360, 1);
    for (const minuten of Object.values(plan.minutesPerDriver)) {
      expect(minuten).toBeCloseTo(120, 1);
    }
    expect(plan.fairShareSatisfied).toBe(true);
  });

  it("telt maxStintMinutes per stint, niet als plafond voor de hele race", () => {
    // Zonder de fix raakte 'a' na één stint uitgesloten en reden b en c de race vol.
    const plan = planRotation({
      totalMinutes: 240,
      stintMinutes: 80,
      referenceLapSeconds: 97,
      drivers: [coureur("a", 96.8, { maxStintMinutes: 80 }), coureur("b", 97.2)],
    });

    expect(plan.reasonCode).toBe("ok");
    // Drie stints van 80 over twee coureurs: 160 en 80. Met de oude lezing kreeg
    // 'a' er maar één en reed 'b' de rest, want a stond na 80 minuten "op zijn max".
    expect(plan.minutesPerDriver.a).toBeCloseTo(160, 1);
    expect(plan.minutesPerDriver.b).toBeCloseTo(80, 1);
    expect(plan.fairShareSatisfied).toBe(true);
  });

  it("laat een coureur pas instappen als hij beschikbaar is", () => {
    const plan = planRotation({
      totalMinutes: 360,
      stintMinutes: 60,
      referenceLapSeconds: 97,
      drivers: [coureur("a", 96.8), coureur("b", 97.2, { availableFromMinute: 120 })],
    });

    const eersteB = plan.stints.find((s) => s.driverId === "b");
    expect(eersteB!.startMinute).toBeGreaterThanOrEqual(120);
  });

  it("houdt de laatste stint kort in plaats van er iemand onder zijn minimum te duwen", () => {
    // 360 minuten met stints van 100: 3 volle plus een rest van 60.
    const plan = planRotation({
      totalMinutes: 360,
      stintMinutes: 100,
      referenceLapSeconds: 97,
      drivers: [coureur("a", 96.8), coureur("b", 97.2), coureur("c", 97.5)],
    });

    expect(plan.reasonCode).toBe("ok");
    expect(plan.stints.at(-1)!.endMinute).toBeCloseTo(360, 1);
    expect(plan.fairShareSatisfied).toBe(true);
    for (const minuten of Object.values(plan.minutesPerDriver)) {
      expect(minuten).toBeGreaterThanOrEqual(plan.minimumMinutes - 0.05);
    }
  });

  it("geeft geen plan als niemand kan rijden", () => {
    const plan = planRotation({
      totalMinutes: 360,
      stintMinutes: 60,
      referenceLapSeconds: 97,
      drivers: [],
    });
    expect(plan.reasonCode).toBe("no_drivers");
    expect(plan.stints).toHaveLength(0);
  });
});
