import { describe, expect, it } from "vitest";
import { averageLapSecondsFromLaps, estimateFuelToFinish } from "./fuelToFinish";

/**
 * Brandstof-tot-finish uit tijd.
 *
 * De formule is de hele reden van deze module: een tijdrace heeft geen
 * `planned_laps`, dus de finish is alleen te bereiken via resterende seconden
 * gedeeld door de gemiddelde rondetijd. Elke test hieronder is een regel uit
 * die afspraak, inclusief de gevallen waarin er géén getal mag staan.
 */

describe("estimateFuelToFinish", () => {
  it("rekent liters uit resterende tijd, rondetijd en verbruik", () => {
    // 3600 s / 90 s = 40 rondes x 3,0 L = 120 L.
    const uitkomst = estimateFuelToFinish({
      remainingSeconds: 3600,
      averageLapSeconds: 90,
      fuelPerLap: 3,
    });
    expect(uitkomst.reasonCode).toBe("ok");
    expect(uitkomst.lapsRemaining).toBe(40);
    expect(uitkomst.litres).toBe(120);
  });

  it("rondt de laatste halve ronde naar boven af", () => {
    // 3600 / 85 = 42,35 rondes: de laatste ronde telt mee.
    const uitkomst = estimateFuelToFinish({
      remainingSeconds: 3600,
      averageLapSeconds: 85,
      fuelPerLap: 3,
    });
    expect(uitkomst.lapsRemaining).toBe(43);
    expect(uitkomst.litres).toBe(127.06); // 42,35 x 3,0
  });

  it("houdt de tank als bovengrens voor één tankbeurt", () => {
    const uitkomst = estimateFuelToFinish({
      remainingSeconds: 3600,
      averageLapSeconds: 90,
      fuelPerLap: 3,
      tankCapacityLitres: 100,
    });
    expect(uitkomst.litres).toBe(120); // de afstand, niet de tank
    expect(uitkomst.litresWithinTank).toBe(100);
  });

  it("geeft geen tankgrens zonder tankinhoud", () => {
    const uitkomst = estimateFuelToFinish({
      remainingSeconds: 3600,
      averageLapSeconds: 90,
      fuelPerLap: 3,
    });
    expect(uitkomst.litresWithinTank).toBeNull();
  });

  it("zegt of de huidige inhoud voldoende is", () => {
    const ruim = estimateFuelToFinish({
      remainingSeconds: 3600,
      averageLapSeconds: 90,
      fuelPerLap: 3,
      fuelLitres: 150,
    });
    const krap = estimateFuelToFinish({
      remainingSeconds: 3600,
      averageLapSeconds: 90,
      fuelPerLap: 3,
      fuelLitres: 100,
    });
    expect(ruim.sufficient).toBe(true);
    expect(krap.sufficient).toBe(false);
  });

  it("ziet een lege tank als onvoldoende, niet als ontbrekende invoer", () => {
    const uitkomst = estimateFuelToFinish({
      remainingSeconds: 3600,
      averageLapSeconds: 90,
      fuelPerLap: 3,
      fuelLitres: 0,
    });
    expect(uitkomst.sufficient).toBe(false);
  });

  it("geen oordeel over voldoende zonder brandstofmeting", () => {
    const uitkomst = estimateFuelToFinish({
      remainingSeconds: 3600,
      averageLapSeconds: 90,
      fuelPerLap: 3,
      fuelLitres: null,
    });
    expect(uitkomst.sufficient).toBeNull();
  });

  it("geeft geen getal zonder resterende sessietijd", () => {
    const uitkomst = estimateFuelToFinish({
      remainingSeconds: null,
      averageLapSeconds: 90,
      fuelPerLap: 3,
    });
    expect(uitkomst.reasonCode).toBe("no_time_remaining");
    expect(uitkomst.litres).toBeNull();
    expect(uitkomst.lapsRemaining).toBeNull();
    expect(uitkomst.reason).toMatch(/resterende sessietijd/i);
  });

  it("geeft geen getal zonder gemiddelde rondetijd", () => {
    for (const rondetijd of [null, 0, -90, Number.NaN]) {
      const uitkomst = estimateFuelToFinish({
        remainingSeconds: 3600,
        averageLapSeconds: rondetijd,
        fuelPerLap: 3,
      });
      expect(uitkomst.reasonCode).toBe("no_average_lap");
      expect(uitkomst.litres).toBeNull();
    }
  });

  it("geeft geen getal zonder verbruik per ronde", () => {
    for (const verbruik of [null, 0, Number.NaN]) {
      const uitkomst = estimateFuelToFinish({
        remainingSeconds: 3600,
        averageLapSeconds: 90,
        fuelPerLap: verbruik,
      });
      expect(uitkomst.reasonCode).toBe("no_consumption");
      expect(uitkomst.litres).toBeNull();
    }
  });

  it("verwerpt een negatieve of onbruikbare klok", () => {
    const uitkomst = estimateFuelToFinish({
      remainingSeconds: -12,
      averageLapSeconds: 90,
      fuelPerLap: 3,
    });
    expect(uitkomst.reasonCode).toBe("no_time_remaining");
    expect(uitkomst.litres).toBeNull();
  });

  it("geeft nul als de sessie is afgelopen", () => {
    const uitkomst = estimateFuelToFinish({
      remainingSeconds: 0,
      averageLapSeconds: 90,
      fuelPerLap: 3,
      fuelLitres: 10,
    });
    expect(uitkomst.litres).toBe(0);
    expect(uitkomst.lapsRemaining).toBe(0);
    expect(uitkomst.sufficient).toBe(true);
  });
});

describe("averageLapSecondsFromLaps", () => {
  it("neemt de mediaan, zodat een uitloopronde de maat niet bepaalt", () => {
    // 363,6 s valt buiten 1,25 × de snelste ronde (89,9) en telt niet mee.
    expect(averageLapSecondsFromLaps([90, 90.5, 363.6, 89.9])).toBe(90);
  });

  it("negeert lege en onbruikbare waarden", () => {
    expect(averageLapSecondsFromLaps([null, undefined, 0, Number.NaN, 91, 89])).toBe(90);
  });

  it("geeft null zonder bruikbare rondetijd", () => {
    expect(averageLapSecondsFromLaps([])).toBeNull();
    expect(averageLapSecondsFromLaps(null)).toBeNull();
    expect(averageLapSecondsFromLaps([null, 0])).toBeNull();
  });
});
