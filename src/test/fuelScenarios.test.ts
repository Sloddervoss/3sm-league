import { describe, expect, it } from "vitest";
import { fuelScenarios } from "@/features/endurance/pitwall/strategy/fuelScenarios";

/**
 * De scenario's moeten dezelfde reserve gebruiken als de rest van de strategie
 * (een halve ronde) en nooit een getal verzinnen bij ontbrekende invoer.
 */
describe("fuelScenarios", () => {
  const basis = { fuelLitres: 31.5, perLap: 3, lapsRemaining: 10 };

  it("precies genoeg is op schema, niet tekort", () => {
    const s = fuelScenarios(basis);
    expect(s.verdict).toBe("op_schema");
    expect(s.surplusLitres).toBe(0);
    expect(s.extraLaps).toBe(0);
    expect(s.targetPerLap).toBe(3);
  });

  it("één hele ronde over is een extra ronde", () => {
    const s = fuelScenarios({ ...basis, fuelLitres: 34.5 });
    expect(s.verdict).toBe("extra_ronde");
    expect(s.extraLaps).toBe(1);
    expect(s.surplusLitres).toBe(3);
  });

  it("een halve ronde over is nog geen extra ronde", () => {
    const s = fuelScenarios({ ...basis, fuelLitres: 33 });
    expect(s.verdict).toBe("op_schema");
    expect(s.extraLaps).toBe(0);
  });

  it("tekort is negatief en noemt de liters", () => {
    const s = fuelScenarios({ ...basis, fuelLitres: 30 });
    expect(s.verdict).toBe("tekort");
    expect(s.surplusLitres).toBe(-1.5);
    expect(s.reason).toContain("1.5 L tekort");
  });

  it("een tekort dat in één tank past is één stop; anders niet", () => {
    expect(fuelScenarios({ ...basis, fuelLitres: 20, tankCapacityLitres: 60 }).fitsInOneStop).toBe(true);
    expect(fuelScenarios({ ...basis, fuelLitres: 20, tankCapacityLitres: 5 }).fitsInOneStop).toBe(false);
    expect(fuelScenarios({ ...basis, fuelLitres: 20 }).fitsInOneStop).toBeNull();
  });

  it("zonder reserve verandert het doel en de extra ronde", () => {
    const met = fuelScenarios({ ...basis, fuelLitres: 32, reserveLaps: 0.5 });
    const zonder = fuelScenarios({ ...basis, fuelLitres: 32, reserveLaps: 0 });
    expect(met.verdict).toBe("op_schema");
    expect(zonder.verdict).toBe("op_schema");
    expect(zonder.targetPerLap).toBeGreaterThan(met.targetPerLap!);
    // 32 L / 3 = 10,67 rondes; met reserve 10,5 nodig -> geen hele ronde extra.
    expect(met.extraLaps).toBe(0);
    expect(zonder.extraLaps).toBe(0);
  });

  it("lege tank is een meting, geen ontbrekende invoer", () => {
    const s = fuelScenarios({ ...basis, fuelLitres: 0 });
    expect(s.verdict).toBe("tekort");
    expect(s.targetPerLap).toBe(0);
  });

  it("ontbrekende invoer geeft onbekend met een reden", () => {
    expect(fuelScenarios({ ...basis, lapsRemaining: null }).verdict).toBe("onbekend");
    expect(fuelScenarios({ ...basis, perLap: null }).verdict).toBe("onbekend");
    expect(fuelScenarios({ ...basis, fuelLitres: null }).verdict).toBe("onbekend");
    expect(fuelScenarios({ ...basis, lapsRemaining: 0 }).reason).toContain("resterende afstand");
    expect(fuelScenarios({ ...basis, perLap: 0 }).reason).toContain("verbruik per ronde");
  });

  it("rondt een bovengrens naar beneden af, nooit omhoog", () => {
    const s = fuelScenarios({ fuelLitres: 10, perLap: 2.123456, lapsRemaining: 4 });
    expect(s.targetPerLap).toBe(2.222);
    expect(s.fuelPerExtraLap).toBe(2.123);
    // 31,56 L bij 10 rondes plus halve reserve: 3,0057... mag geen 3,010 worden.
    const krap = fuelScenarios({ fuelLitres: 31.56, perLap: 3, lapsRemaining: 10 });
    expect(krap.targetPerLap).toBe(3.005);
    expect(krap.targetPerLap! * 10.5).toBeLessThanOrEqual(31.56);
  });

  it("een onbruikbare reserve valt terug op de standaard", () => {
    const s = fuelScenarios({ ...basis, reserveLaps: Number.POSITIVE_INFINITY });
    expect(s.reserveLaps).toBe(0.5);
    expect(s.verdict).not.toBe("onbekend");
    expect(s.reason).not.toContain("Infinity");
  });
});
