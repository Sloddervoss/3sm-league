import { describe, expect, it } from "vitest";
import { advise, bindingConstraint } from "./advise";
import type { StrategySnapshot } from "./types";
import type { TyreEstimate } from "./tyreGrade";

/**
 * De harde invariant uit plan-04 §4d: `lapsUntilPit === min(band, tank)`.
 *
 * Deze tests bewaken twee dingen tegelijk: de selector zelf (tie = beide,
 * onbekend telt niet als nul en niet als oneindig) en het feit dat `advise()`
 * precies dat getal gebruikt en geen tweede berekening heeft.
 */

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

/** Graad A met een grens in rondes; `laps` is wat de motor moet gebruiken. */
const graadA = (laps: number, overrides: Partial<TyreEstimate> = {}): TyreEstimate => ({
  grade: "A",
  source: "server",
  weakest: "fl",
  restPct: 62,
  ratePerLap: 1.8,
  marginPp: 2,
  sigmaLaps: 1.1,
  lapsToThreshold: laps,
  lapsRange: { low: Math.max(0, Math.floor(laps - 1.1)), high: Math.ceil(laps + 1.1) },
  pctRange: null,
  cause: null,
  causeLap: null,
  causeLaps: 21,
  limitPct: 40,
  samples: 1,
  ...overrides,
});

const graadC: TyreEstimate = graadA(0, {
  grade: "C",
  ratePerLap: null,
  marginPp: 11.8,
  lapsToThreshold: null,
  lapsRange: null,
  pctRange: { low: 55, high: 70 },
  limitPct: null,
});

const graadD: TyreEstimate = graadA(0, {
  grade: "D",
  restPct: null,
  ratePerLap: null,
  marginPp: null,
  lapsToThreshold: null,
  lapsRange: null,
  limitPct: null,
  cause: "stalled_values",
  causeLap: 7,
});

describe("bindingConstraint", () => {
  it("kiest de kleinste van de twee", () => {
    expect(bindingConstraint({ tyreLaps: 12, fuelLaps: 15 })).toEqual({ binding: "tyres", laps: 12 });
    expect(bindingConstraint({ tyreLaps: 15, fuelLaps: 12 })).toEqual({ binding: "fuel", laps: 12 });
  });

  it("zegt 'beide' bij gelijkstand, en het getal blijft hetzelfde", () => {
    expect(bindingConstraint({ tyreLaps: 12, fuelLaps: 12 })).toEqual({ binding: "both", laps: 12 });
    // Minder dan een halve ronde verschil is in hele rondes dezelfde grens.
    expect(bindingConstraint({ tyreLaps: 12, fuelLaps: 12.3 })).toEqual({ binding: "both", laps: 12 });
  });

  it("laat een onbekende band de tank niet vervangen", () => {
    expect(bindingConstraint({ tyreLaps: null, fuelLaps: 9 })).toEqual({ binding: "fuel", laps: 9 });
    expect(bindingConstraint({ tyreLaps: 9, fuelLaps: null })).toEqual({ binding: "tyres", laps: 9 });
    expect(bindingConstraint({ tyreLaps: null, fuelLaps: null })).toEqual({ binding: null, laps: null });
  });
});

describe("advise — de invariant op de uitvoer", () => {
  const invariant = (snapshot: StrategySnapshot) => {
    const advies = advise(snapshot);
    const band = advies.tyreFuel?.tyres.laps ?? null;
    const tank = advies.tyreFuel?.fuel.laps ?? null;
    if (advies.decision === "PIT_IN_LAPS" || advies.decision === "PIT_THIS_LAP") {
      const verwacht = Math.min(
        band ?? Number.POSITIVE_INFINITY,
        tank ?? Number.POSITIVE_INFINITY,
      );
      expect(advies.lapsUntilPit).toBe(verwacht);
      expect(advies.lapsUntilPit).toBeLessThanOrEqual(band ?? Number.POSITIVE_INFINITY);
      expect(advies.lapsUntilPit).toBeLessThanOrEqual(tank ?? Number.POSITIVE_INFINITY);
    }
    return advies;
  };

  it("laat de band winnen als die eerder op is dan de tank", () => {
    const advies = invariant(basisSnapshot({ plannedLaps: 100, fuelLitres: 100, tyreEstimate: graadA(12.4) }));
    expect(advies.binding).toBe("tyres");
    expect(advies.lapsUntilPit).toBe(12);
    expect(advies.reasonCode).toBe("tyre_life");
  });

  it("laat de tank winnen als de band langer meegaat", () => {
    const advies = invariant(basisSnapshot({ plannedLaps: 100, fuelLitres: 100, tyreEstimate: graadA(40) }));
    expect(advies.binding).toBe("fuel");
    expect(advies.lapsUntilPit).toBe(31); // 100/3 ≈ 33 rondes, min de marge
    expect(advies.reasonCode).toBe("in_window");
  });

  it("houdt de invariant over de hele reeks graden en tankvullingen", () => {
    for (const tyre of [null, graadA(5), graadA(12.4), graadA(31), graadA(40), graadC, graadD]) {
      for (const fuelLitres of [8, 20, 40, 60, 100]) {
        invariant(basisSnapshot({ plannedLaps: 100, fuelLitres, tyreEstimate: tyre }));
      }
    }
  });

  it("geeft bij graad C en D geen bandengrens en dus de tank", () => {
    for (const estimate of [graadC, graadD]) {
      const advies = invariant(basisSnapshot({ plannedLaps: 100, fuelLitres: 100, tyreEstimate: estimate }));
      expect(advies.tyreFuel?.tyres.laps).toBeNull();
      expect(advies.binding).toBe("fuel");
    }
  });

  it("zet band en tank in dezelfde eenheid: rondes tot de grens", () => {
    const advies = advise(basisSnapshot({ plannedLaps: 100, fuelLitres: 100, tyreEstimate: graadA(12.4) }));
    expect(advies.tyreFuel?.fuel.laps).toBe(advies.lapsOnFuel! - 1);
    expect(advies.tyreFuel?.tyres.laps).toBe(12);
    expect(advies.tyreFuel?.tyres.limitPct).toBe(40);
  });

  it("valt zonder tyre_estimate terug op de live reeks, met dezelfde vorm", () => {
    const banden = Array.from({ length: 10 }, (_, i) => ({
      lap: 10 + i,
      lapTime: 90,
      fl: 90 - i * 0.2,
      fr: 93 - i * 0.2,
      rl: 95 - i * 0.2,
      rr: 96 - i * 0.2,
    }));
    const advies = advise(basisSnapshot({ plannedLaps: 100, fuelLitres: 100, tyreSamples: banden }));
    // Geen servermeting: graad B hooguit, en de terugval zegt dat de grens kaal is.
    expect(advies.tyreEstimate?.source).toBe("client");
    expect(advies.tyreEstimate?.grade).toBe("B");
    expect(advies.tyreFuel?.tyres.laps).toBeGreaterThan(0);
    invariant(basisSnapshot({ plannedLaps: 100, fuelLitres: 100, tyreSamples: banden }));
  });

  it("verzint geen bandengrens als er niets gemeten is", () => {
    const advies = advise(basisSnapshot({ plannedLaps: 100, fuelLitres: 100 }));
    expect(advies.tyreEstimate?.grade).toBe("D");
    expect(advies.tyreFuel?.tyres.laps).toBeNull();
    expect(advies.binding).toBe("fuel");
  });
});
