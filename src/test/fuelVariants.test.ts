import { describe, expect, it } from "vitest";
import { fitsInOneStop, fuelVariants, usableFuelSamples } from "@/features/endurance/pitwall/strategy/fuelVariants";

/**
 * De vier varianten mogen elkaar niet tegenspreken over de invoer: EST is de
 * schatting van de rekenkern, de andere drie komen uit dezelfde gefilterde reeks.
 */
describe("fuelVariants", () => {
  const samples = [
    { lap: 12, used: 2.4 },
    { lap: 11, used: 2.32 },
    { lap: 10, used: 2.3 },
    { lap: 9, used: 2.9 },
    { lap: 8, used: 2.28 },
    { lap: 7, used: 2.5 },
  ];
  const basis = { samples, estPerLap: 2.42, fuelLitres: 32.6, lapsToFinish: 26, tankCapacityLitres: 60 };

  it("neemt EST over van de rekenkern in plaats van opnieuw te rekenen", () => {
    const est = fuelVariants(basis).find((v) => v.key === "est")!;
    expect(est.perLap).toBe(2.42);
    expect(est.samples).toBe(0);
  });

  it("rekent Laatste 5 over de nieuwste vijf metingen", () => {
    const avg5 = fuelVariants(basis).find((v) => v.key === "avg5")!;
    // (2.4 + 2.32 + 2.3 + 2.9 + 2.28) / 5 = 2.44
    expect(avg5.perLap).toBe(2.44);
    expect(avg5.samples).toBe(5);
  });

  it("neemt max en min over alle bruikbare metingen", () => {
    const varianten = fuelVariants(basis);
    expect(varianten.find((v) => v.key === "max")!.perLap).toBe(2.9);
    expect(varianten.find((v) => v.key === "min")!.perLap).toBe(2.28);
  });

  it("laat onbruikbare metingen weg", () => {
    const schoon = usableFuelSamples([
      { lap: 3, used: 2.3 },
      { lap: 2, used: 0 },
      { lap: 1, used: -2 },
      { lap: 4, used: 40 },
      { lap: 5, used: null },
    ]);
    expect(schoon).toEqual([{ lap: 3, used: 2.3 }]);
  });

  it("rekent bereik en tankbehoefte op dezelfde invoer", () => {
    const varianten = fuelVariants(basis);
    const est = varianten.find((v) => v.key === "est")!;
    // 32,6 / 2,42 = 13,4 -> 13 hele rondes
    expect(est.lapsLeft).toBe(13);
    // 26 * 2,42 - 32,6 = 30,32
    expect(est.toAddLitres).toBe(30.4);
  });

  it("rondt de tankbehoefte naar boven af en geeft nul als het past", () => {
    const krap = fuelVariants({ ...basis, fuelLitres: 2.42 * 26 + 0.01 }).find((v) => v.key === "est")!;
    expect(krap.toAddLitres).toBe(0);
    const netNiet = fuelVariants({ ...basis, fuelLitres: 2.42 * 26 - 0.01 }).find((v) => v.key === "est")!;
    expect(netNiet.toAddLitres).toBe(0.1);
  });

  it("laat EST leeg als de rekenkern geen schatting heeft", () => {
    const varianten = fuelVariants({ ...basis, estPerLap: null });
    expect(varianten.find((v) => v.key === "est")!.perLap).toBeNull();
    expect(varianten.find((v) => v.key === "avg5")!.perLap).not.toBeNull();
  });

  it("geeft null als er niets te rekenen valt", () => {
    const leeg = fuelVariants({ samples: [], estPerLap: null, fuelLitres: null, lapsToFinish: null });
    expect(leeg.every((v) => v.perLap === null && v.lapsLeft === null && v.toAddLitres === null)).toBe(true);
  });
});

describe("fitsInOneStop", () => {
  const variant = { key: "est" as const, label: "EST", perLap: 2.4, lapsLeft: 10, toAddLitres: 30.4, samples: 0 };

  it("past als het tekort binnen de tank valt", () => {
    expect(fitsInOneStop(variant, 60)).toBe(true);
    expect(fitsInOneStop(variant, 24)).toBe(false);
  });

  it("niets bijvullen past altijd", () => {
    expect(fitsInOneStop({ ...variant, toAddLitres: 0 }, null)).toBe(true);
  });

  it("zonder tank of tekort geen uitspraak", () => {
    expect(fitsInOneStop(variant, null)).toBeNull();
    expect(fitsInOneStop({ ...variant, toAddLitres: null }, 60)).toBeNull();
  });
});
