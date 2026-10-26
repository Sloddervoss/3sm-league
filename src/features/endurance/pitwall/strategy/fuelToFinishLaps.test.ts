import { describe, expect, it } from "vitest";
import { estimateFuelToFinish } from "./fuelToFinish";

describe("brandstof tot de finish bij een race op afstand", () => {
  it("rekent met de resterende rondes, niet met de klok", () => {
    // Race van 120 rondes, 90 gereden: nog 30 te gaan bij 2,94 L per ronde.
    const uitkomst = estimateFuelToFinish({
      lapsRemaining: 30,
      remainingSeconds: 3600, // de klok zegt nog een uur; de afstand is bepalend
      averageLapSeconds: 95.67,
      fuelPerLap: 2.94,
      fuelLitres: 42.6,
      tankCapacityLitres: 104,
    });

    expect(uitkomst.lapsRemaining).toBe(30);
    expect(uitkomst.litres).toBe(88.2);
    expect(uitkomst.sufficient).toBe(false);
    expect(uitkomst.reason).toContain("30 rondes tot de finish");
  });

  it("valt terug op de klok als de afstand onbekend is", () => {
    const uitkomst = estimateFuelToFinish({
      lapsRemaining: null,
      remainingSeconds: 956.7, // tien rondes van 95,67 s
      averageLapSeconds: 95.67,
      fuelPerLap: 2.94,
      fuelLitres: 42.6,
      tankCapacityLitres: 104,
    });

    expect(uitkomst.lapsRemaining).toBe(10);
    expect(uitkomst.litres).toBe(29.4);
  });

  it("stopt bij het einde van de race, niet bij je eigen ronde-aantal", () => {
    // Achterliggende auto: nog 80 eigen rondes, maar de leider finisht over
    // 600 s. Die 600 s is de echte grens — de rest rijdt hij nooit meer.
    const uitkomst = estimateFuelToFinish({
      lapsRemaining: 80,
      remainingSeconds: 600,
      averageLapSeconds: 95.67,
      fuelPerLap: 2.94,
      fuelLitres: 42.6,
      tankCapacityLitres: 104,
    });

    expect(uitkomst.lapsRemaining).toBe(7);
    expect(uitkomst.litres).toBeLessThan(25);
  });

  it("noemt de finish gehaald als de tank vol genoeg is", () => {
    const uitkomst = estimateFuelToFinish({
      lapsRemaining: 10,
      remainingSeconds: 3600,
      averageLapSeconds: 95.67,
      fuelPerLap: 2.94,
      fuelLitres: 42.6,
      tankCapacityLitres: 104,
    });

    expect(uitkomst.sufficient).toBe(true);
    expect(uitkomst.litres).toBe(29.4);
  });
});
