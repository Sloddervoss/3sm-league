import { describe, expect, it } from "vitest";
import {
  advise,
  computePitLoss,
  computePitWindow,
  cumulativeDegradationLoss,
  decideTyreChange,
  estimateFuelPerLap,
  evaluateTyreWear,
  fuelToAddForFinish,
  lapsOnFuel,
  median,
  planRotation,
  theilSen,
  windowIsInfeasible,
} from "./index";
import type { StrategySnapshot } from "./types";

const basisSnapshot = (overrides: Partial<StrategySnapshot> = {}): StrategySnapshot => ({
  raceClockSeconds: 600,
  lapsCompleted: 10,
  currentLapSeconds: 90,
  fuelLitres: 40,
  tankCapacityLitres: 100,
  plannedLaps: 40,
  plannedDurationMinutes: null,
  fuelPerLapSamples: [2.9, 3.0, 2.95, 2.98, 3.01, 2.97, 3.0, 2.96],
  fuelPerLapPrior: null,
  sampleAgeSeconds: 1,
  pitLaneSeconds: 25,
  secondsPerLitre: 1,
  tyreSeconds: 30,
  ...overrides,
});

describe("fuelModel", () => {
  it("rekent de mediaan van oneven en even reeksen", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it("verwerpt een uitschieter en houdt de rest", () => {
    const schatting = estimateFuelPerLap([2.9, 3.0, 2.95, 9.0, 2.98]);
    expect(schatting.samples).toBe(4);
    expect(schatting.rejected).toBe(1);
    expect(schatting.perLap).toBeGreaterThan(2.9);
    expect(schatting.perLap).toBeLessThan(3.2);
  });

  it("is pessimistisch: nooit onder de mediaan", () => {
    const schatting = estimateFuelPerLap([2.80, 3.20, 2.90, 3.10]);
    const mediaan = median([2.80, 3.20, 2.90, 3.10])!;
    expect(schatting.perLap).toBeGreaterThanOrEqual(mediaan);
  });

  it("valt terug op de prior zonder metingen", () => {
    const schatting = estimateFuelPerLap([], 3.1);
    expect(schatting).toMatchObject({ perLap: 3.1, source: "prior", samples: 0 });
  });

  it("geeft geen getal zonder metingen en zonder prior", () => {
    expect(estimateFuelPerLap([], null).perLap).toBeNull();
  });

  it("rekent de actieradius met reserve", () => {
    expect(lapsOnFuel(40, 3, 0.5)).toBe(12); // 40/3 = 13,33 - 0,5 = 12,83
    expect(lapsOnFuel(null, 3)).toBeNull();
    expect(lapsOnFuel(40, 0)).toBeNull();
  });

  it("kapt het tanken af op de tankinhoud", () => {
    // 35 rondes x 3 liter = 105, er zit nog 90 in: 15 nodig, maar er kan nog 10 bij.
    expect(fuelToAddForFinish(35, 3, 90, 100, 0)).toBe(10);
    expect(fuelToAddForFinish(20, 3, 90, null, 0)).toBe(0);
    expect(fuelToAddForFinish(35, 3, 90, null, 0)).toBe(15);
    expect(fuelToAddForFinish(5, 3, 90, 100, 0)).toBe(0);
  });
});

describe("pitLoss", () => {
  it("neemt het maximum van parallelle bewerkingen, niet de som", () => {
    const verlies = computePitLoss({
      pitLaneSeconds: 25,
      fuelLitres: 40,
      secondsPerLitre: 1,
      tyreSeconds: 30,
    });
    expect(verlies.fuel).toBe(40);
    expect(verlies.total).toBe(65); // 25 + max(40, 30), niet 95
    expect(verlies.boundedBy).toBe("fuel");
  });

  it("laat banden de stop bepalen als die langer duren", () => {
    const verlies = computePitLoss({
      pitLaneSeconds: 25,
      fuelLitres: 10,
      secondsPerLitre: 1,
      tyreSeconds: 30,
    });
    expect(verlies.total).toBe(55);
    expect(verlies.boundedBy).toBe("tyre");
  });

  it("geeft geen totaal zonder pitbaan-basis", () => {
    const verlies = computePitLoss({
      pitLaneSeconds: null,
      fuelLitres: 40,
      secondsPerLitre: 1,
      tyreSeconds: 30,
    });
    expect(verlies.total).toBeNull();
    expect(verlies.fuel).toBe(40);
  });
});

describe("pitWindow", () => {
  it("legt de randen op nu en op droogvallen", () => {
    // 79 rondes te gaan, 20 rondes per tank -> 4 stops, 19 rondes op deze tank.
    const venster = computePitWindow({
      lapsToFinish: 79,
      lapsOnFuel: 19.4,
      stintCapacityLaps: 20,
      lapsCompleted: 10,
    });
    // 79 te gaan, 19 in de tank: nog 60 rondes tanken, 20 per stop -> 3 stops.
    expect(venster).toMatchObject({
      stopsRequired: 3,
      earliestLap: 10,
      latestLap: 29,
      lapsOnFuel: 19,
      finalStintLaps: 20,
    });
  });

  it("telt de brandstof die er al in zit mee in het aantal stops", () => {
    // 79 te gaan met 10 in de tank: 69 tanken, 20 per stop -> 4 stops (niet 5).
    const venster = computePitWindow({
      lapsToFinish: 79,
      lapsOnFuel: 10,
      stintCapacityLaps: 20,
      lapsCompleted: 10,
    });
    expect(venster!.stopsRequired).toBe(4);
    expect(windowIsInfeasible(venster)).toBe(false);
  });

  it("weet wanneer de laatste stop maar half gevuld hoeft", () => {
    // 50 te gaan met 25 in de tank: 25 tanken, 20 per stop -> 2 stops, laatste 5.
    const venster = computePitWindow({
      lapsToFinish: 50,
      lapsOnFuel: 25,
      stintCapacityLaps: 20,
      lapsCompleted: 5,
    });
    expect(venster!.stopsRequired).toBe(2);
    expect(venster!.finalStintLaps).toBe(5);
  });

  it("geeft geen venster zonder afstand", () => {
    expect(
      computePitWindow({ lapsToFinish: null, lapsOnFuel: 10, stintCapacityLaps: 20, lapsCompleted: 5 }),
    ).toBeNull();
  });
});

describe("tyreModel", () => {
  const samples = Array.from({ length: 12 }, (_, i) => ({
    tyreLap: i,
    lapSeconds: 90 + 0.05 * i + 0.035 * (100 - 3 * i) * 0.75,
    fuelLitres: 100 - 3 * i,
  }));

  it("vindt de helling terug die naïeve regressie mist", () => {
    const naief = theilSen(samples.map((s) => ({ x: s.tyreLap, y: s.lapSeconds })));
    const correctie = evaluateTyreWear({ samples });

    expect(naief.slope!).toBeLessThan(0); // gewicht maskeert de slijtage volledig
    expect(correctie.slopeSecondsPerLap!).toBeCloseTo(0.05, 2);
    expect(correctie.reliable).toBe(true);
  });

  it("weigert zonder brandstofcorrectie", () => {
    const zonder = samples.map((s) => ({ ...s, fuelLitres: null }));
    const uitkomst = evaluateTyreWear({ samples: zonder });
    expect(uitkomst.reliable).toBe(false);
    expect(uitkomst.reasonCode).toBe("no_fuel_correction");
  });

  it("cumuleert verlies kwadratisch over de stint", () => {
    expect(cumulativeDegradationLoss(0.05, 40)).toBe(41); // 0,05 * 40*41/2
    expect(cumulativeDegradationLoss(0.05, 0)).toBe(0);
  });

  it("laat wisselen lonen bij een stop die je toch maakt", () => {
    const uitkomst = decideTyreChange({
      evaluation: { slopeSecondsPerLap: 0.05, halfWidth: 0.004, samples: 12, reliable: true, reasonCode: "ok" },
      extraStopSeconds: 0,
      lapsRemaining: 40,
    });
    expect(uitkomst.changeTyres).toBe(true);
  });

  it("wisselt niet als de slijtage onder de meetbare grens blijft", () => {
    const uitkomst = decideTyreChange({
      evaluation: { slopeSecondsPerLap: 0.01, halfWidth: 0.002, samples: 12, reliable: true, reasonCode: "ok" },
      extraStopSeconds: 0,
      lapsRemaining: 40,
    });
    expect(uitkomst.changeTyres).toBe(false);
    expect(uitkomst.reasonCode).toBe("wear_too_small");
  });
});

describe("advise", () => {
  it("weigert advies op verouderde telemetrie", () => {
    const advies = advise(basisSnapshot({ sampleAgeSeconds: 12 }));
    expect(advies.decision).toBe("NO_ADVICE");
    expect(advies.reasonCode).toBe("stale_telemetry");
  });

  it("zegt blijven buiten als de tank de finish haalt", () => {
    // 30 rondes te gaan, 40 liter bij 3,0 L/ronde = 12 rondes? Nee: 40/3 = 13.
    // Dus met een volle tank van 100 liter haalt hij het wel.
    const advies = advise(basisSnapshot({ fuelLitres: 100 }));
    expect(advies.decision).toBe("STAY_OUT");
    expect(advies.reasonCode).toBe("fuel_to_finish");
  });

  it("stuurt naar binnen als de tank leeg dreigt", () => {
    const advies = advise(basisSnapshot({ fuelLitres: 3 }));
    expect(advies.decision).toBe("PIT_THIS_LAP");
    expect(advies.reasonCode).toBe("fuel_critical");
  });

  it("adviseert een stop over n rondes met een haalbaar venster", () => {
    // 90 rondes te gaan, 33 per tank -> 3 stops, deze tank moet er 24; hij heeft 80 L = 26.
    const advies = advise(basisSnapshot({ fuelLitres: 80, plannedLaps: 100, lapsCompleted: 10 }));
    expect(advies.decision).toBe("PIT_IN_LAPS");
    expect(advies.reasonCode).toBe("in_window");
    expect(advies.lapsUntilPit).toBeGreaterThan(0);
    expect(advies.window).not.toBeNull();
  });

  it("telt bij een half lege tank het juiste aantal stops", () => {
    // 90 te gaan, 20 L = 6 rondes, 33 rondes per volle tank.
    const advies = advise(basisSnapshot({ fuelLitres: 20, plannedLaps: 100, lapsCompleted: 10 }));
    expect(advies.decision).toBe("PIT_IN_LAPS");
    expect(advies.window).not.toBeNull();
    // 84 rondes tanken / 33 per stop = 3 stops, niet 4.
    expect(advies.window!.stopsRequired).toBe(3);
  });

  it("geeft geen advies zonder verbruik", () => {
    const advies = advise(basisSnapshot({ fuelPerLapSamples: [], fuelPerLapPrior: null }));
    expect(advies.decision).toBe("NO_ADVICE");
    expect(advies.reasonCode).toBe("no_consumption");
  });

  it("rekent tijdraces om naar rondes als de duur bekend is", () => {
    const advies = advise(
      basisSnapshot({
        plannedLaps: null,
        plannedDurationMinutes: 60,
        raceClockSeconds: 1800, // half uur gereden, 90 s per ronde -> 20 rondes te gaan
        currentLapSeconds: 90,
      }),
    );
    expect(advies.lapsToFinish).toBe(20);
  });
});

describe("rotation", () => {
  it("plant stints en respecteert het minimumdeel", () => {
    const plan = planRotation({
      totalMinutes: 360,
      stintMinutes: 90,
      referenceLapSeconds: 90,
      drivers: [
        { id: "a", name: "A", lapSeconds: 90 },
        { id: "b", name: "B", lapSeconds: 90.5 },
        { id: "c", name: "C", lapSeconds: 91 },
      ],
    });

    expect(plan.stints).toHaveLength(4);
    expect(plan.equalShareMinutes).toBe(120);
    expect(plan.minimumMinutes).toBe(30);
    expect(plan.fairShareSatisfied).toBe(true);
    expect(Object.values(plan.minutesPerDriver).reduce((a, b) => a + b, 0)).toBeCloseTo(360, 0);
  });

  it("houdt rekening met beschikbaarheid", () => {
    const plan = planRotation({
      totalMinutes: 180,
      stintMinutes: 90,
      referenceLapSeconds: 90,
      drivers: [
        { id: "a", name: "A", lapSeconds: 90 },
        { id: "b", name: "B", lapSeconds: 90, availableFromMinute: 60 },
      ],
    });
    expect(plan.stints[0].driverId).toBe("a");
    expect(plan.stints[1].driverId).toBe("b");
  });

  it("faalt eerlijk als niemand beschikbaar is", () => {
    const plan = planRotation({
      totalMinutes: 60,
      stintMinutes: 30,
      referenceLapSeconds: 90,
      drivers: [{ id: "a", name: "A", lapSeconds: 90, availableFromMinute: 120 }],
    });
    expect(plan.reasonCode).toBe("no_available_driver");
    expect(plan.stints).toHaveLength(0);
  });
});
