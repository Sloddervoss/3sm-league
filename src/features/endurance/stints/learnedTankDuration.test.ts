import { describe, expect, it } from "vitest";
import { resolveTankMinutes } from "./learnedTankDuration";
import { tankMinutesFromSpec, type CarSpec } from "./tankDuration";

// IJkpunt uit de race van 24 oktober: 104 liter tank, 2,94 liter per ronde en
// 95,67 seconden per ronde → 35,4 rondes → 56,4 minuten.
const huracan: CarSpec = {
  car_id: "lamborghinievogt3",
  display_name: "Lamborghini Huracán GT3 EVO",
  tank_capacity_litres: 104,
  fuel_per_lap_prior_litres: 2.94,
};

describe("tankduur uit het archief, met de specificatie als terugval", () => {
  it("gebruikt de gemeten tankduur als het archief die levert", () => {
    expect(resolveTankMinutes({ tank_minutes: 56.4, avg_lap_seconds: 95.67 }, huracan, null)).toEqual({
      minutes: 56,
      source: "archive",
    });
  });

  it("valt terug op de bestaande berekening als het archief niets weet", () => {
    expect(resolveTankMinutes(null, huracan, 95.67)).toEqual({ minutes: 56, source: "spec" });
    // De terugval is precies de bestaande berekening, niet een nieuwe formule.
    expect(resolveTankMinutes(null, huracan, 95.67).minutes).toBe(tankMinutesFromSpec(huracan, 95.67));
  });

  it("gebruikt de gemeten rondetijd uit het archief als de tankduur zelf ontbreekt", () => {
    // 104 / 2,94 = 35,37 rondes x 90 s = 3183 s = 53,1 minuten.
    expect(resolveTankMinutes({ tank_minutes: null, avg_lap_seconds: 90 }, huracan, 95.67)).toEqual({
      minutes: 53,
      source: "spec",
    });
  });

  it("negeert onbruikbare waarden in plaats van ze te gebruiken", () => {
    for (const tank of [0, -12, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolveTankMinutes({ tank_minutes: tank, avg_lap_seconds: 95.67 }, huracan, null).source).toBe("spec");
    }
    // Een onbruikbare rondetijd in het archief mag de pace van de aanroeper niet overschrijven.
    expect(resolveTankMinutes({ tank_minutes: null, avg_lap_seconds: 0 }, huracan, 95.67)).toEqual({
      minutes: 56,
      source: "spec",
    });
  });

  it("geeft niets terug als er geen archiefwaarde en geen specificatie is", () => {
    expect(resolveTankMinutes(null, null, 95.67)).toEqual({ minutes: null, source: "none" });
    expect(resolveTankMinutes(null, { ...huracan, tank_capacity_litres: null }, 95.67)).toEqual({
      minutes: null,
      source: "none",
    });
  });

  it("telt op een andere baan met een andere gemeten rondetijd", () => {
    // Zelfde auto en verbruik, maar 120 s per ronde: 35,37 rondes = 70,7 minuten.
    expect(resolveTankMinutes({ tank_minutes: 70.7, avg_lap_seconds: 120 }, huracan, 95.67)).toEqual({
      minutes: 71,
      source: "archive",
    });
  });
});
