import { describe, expect, it } from "vitest";
import { tyreWearRate, type TyreSample } from "./tyreWear";

const sample = (lap: number, wear: number): TyreSample => ({
  lap,
  lapTime: 97,
  fl: wear,
  fr: wear + 0.2,
  rl: wear + 0.1,
  rr: wear + 0.3,
});

describe("tyreWearRate", () => {
  it("vindt een bekende slijtage terug", () => {
    // 0,35 procentpunt per ronde, van 99,5 naar 97,75 over vijf ronden.
    const metingen = [0, 1, 2, 3, 4, 5].map((i) => sample(10 + i, 99.5 - i * 0.35));
    const rate = tyreWearRate(metingen);

    expect(rate.reasonCode).toBe("ok");
    expect(rate.wearPerLap).toBeCloseTo(0.35, 3);
    expect(rate.lapsRemaining).toBe(279);
    expect(rate.reliable).toBe(true);
  });

  it("ziet een bandenwissel en middelt hem niet weg", () => {
    const metingen = [
      sample(10, 95), sample(11, 94.6), sample(12, 94.2),
      sample(13, 99.9), // nieuwe set
      sample(14, 99.5), sample(15, 99.1),
    ];
    expect(tyreWearRate(metingen).reasonCode).toBe("tyre_change");
  });

  it("weigert te weinig metingen", () => {
    const rate = tyreWearRate([sample(10, 99), sample(11, 98.6)]);
    expect(rate.reasonCode).toBe("too_few_samples");
    expect(rate.wearPerLap).toBeNull();
  });

  it("weigert een reeks waarin niets slijt", () => {
    const metingen = [0, 1, 2, 3, 4].map((i) => sample(10 + i, 99.5));
    expect(tyreWearRate(metingen).reasonCode).toBe("not_wearing");
  });

  it("weigert een onmogelijke slijtagesnelheid", () => {
    // 20 punten per ronde: dat is geen band maar een verkeerde eenheid.
    const metingen = [0, 1, 2, 3].map((i) => sample(10 + i, 100 - i * 20));
    expect(tyreWearRate(metingen).reasonCode).toBe("implausible");
  });

  it("neemt het zwakste wiel als maat, niet het gemiddelde", () => {
    const metingen = [0, 1, 2, 3, 4].map((i) => ({
      lap: 10 + i,
      lapTime: 97,
      fl: 96 - i * 0.9, // dit wiel slijt het hardst
      fr: 99 - i * 0.2,
      rl: 99 - i * 0.2,
      rr: 99 - i * 0.2,
    }));
    const rate = tyreWearRate(metingen);
    expect(rate.wearPerLap).toBeCloseTo(0.9, 3);
  });
});
