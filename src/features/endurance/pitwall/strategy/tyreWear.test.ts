import { describe, expect, it } from "vitest";
import {
  adviseTyreChange,
  recordTyreSample,
  tyreWearRate,
  type TyreSample,
} from "./tyreWear";

const sample = (lap: number, wear: number): TyreSample => ({
  lap,
  lapTime: 97,
  fl: wear,
  fr: wear + 0.2,
  rl: wear + 0.1,
  rr: wear + 0.3,
});

/** Een reeks waarin linksvoor het zwakste wiel is en per ronde met `stap` zakt. */
const aflopend = (start: number, stap: number, aantal: number, vanafLap = 10): TyreSample[] =>
  Array.from({ length: aantal }, (_, i) => ({
    lap: vanafLap + i,
    lapTime: 97,
    fl: start - i * stap,
    fr: start - i * stap + 3,
    rl: start - i * stap + 5,
    rr: start - i * stap + 6,
  }));

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

  it("rekent na een wissel alleen met de set die er nu op ligt", () => {
    // Oude set slijt hard, nieuwe set slijt rustig: het antwoord moet over de
    // nieuwe set gaan, niet over het gemiddelde van twee sets.
    const metingen = [
      ...[0, 1, 2, 3].map((i) => sample(5 + i, 60 - i * 2)),
      sample(9, 99.9),
      ...[1, 2, 3, 4].map((i) => sample(9 + i, 99.9 - i * 0.4)),
    ];
    const rate = tyreWearRate(metingen);

    expect(rate.reasonCode).toBe("ok");
    expect(rate.wearPerLap).toBeCloseTo(0.4, 3);
    expect(rate.samples).toBe(5);
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
    expect(rate.weakestCorner).toBe("fl");
  });

  it("rekent de resterende rondes op het zwakste wiel, niet op het gemiddelde", () => {
    const rate = tyreWearRate(aflopend(14.5, 0.5, 10));
    // 10,0 procent over bij 0,5 per ronde = 20 rondes.
    expect(rate.lapsRemaining).toBe(20);
    expect(rate.weakestCorner).toBe("fl");
  });

  describe("reeksen die niet per ronde verversen", () => {
    it("herkent de race van 24-10: zeven rondes dezelfde waarde en dan een sprong", () => {
      // Precies wat er op de pitwall stond: 81,3 / 85,3 / 88,9 / 89,2, zeven
      // rondes lang gelijk, daarna in één keer anders. Hier een snelheid per
      // ronde van maken gaf 0,17 in plaats van 0,45.
      const metingen: TyreSample[] = [
        ...[0, 1, 2, 3, 4, 5, 6].map((i) => ({
          lap: 40 + i,
          lapTime: 97,
          fl: 81.3,
          fr: 85.3,
          rl: 88.9,
          rr: 89.2,
        })),
        { lap: 47, lapTime: 97, fl: 79.9, fr: 84.1, rl: 87.6, rr: 88.0 },
        { lap: 48, lapTime: 97, fl: 79.7, fr: 83.9, rl: 87.4, rr: 87.8 },
        { lap: 49, lapTime: 97, fl: 79.5, fr: 83.7, rl: 87.2, rr: 87.6 },
      ];

      const rate = tyreWearRate(metingen);
      expect(rate.reasonCode).toBe("stalled_values");
      expect(rate.reliable).toBe(false);
      expect(rate.wearPerLap).toBeNull();
      expect(rate.stalledLaps).toBe(7);
    });

    it("herkent een sprong omlaag als bijwerking en niet als slijtage", () => {
      const metingen = [
        sample(10, 95), sample(11, 94.6), sample(12, 94.2),
        sample(13, 91.8), // 2,4 punt in één ronde
        sample(14, 91.4),
      ];
      const rate = tyreWearRate(metingen);
      expect(rate.reasonCode).toBe("jump");
      expect(rate.wearPerLap).toBeNull();
    });
  });
});

describe("adviseTyreChange", () => {
  it("waarschuwt als de band eerder op is dan de geplande stop", () => {
    const advies = adviseTyreChange({
      samples: aflopend(14.5, 0.5, 10),
      mustSurviveLaps: 25,
      horizon: "planned_stop",
    });

    expect(advies.action).toBe("CHANGE_BEFORE_PLANNED_STOP");
    expect(advies.reasonCode).toBe("tyre_life_before_stop");
    expect(advies.lapsRemaining).toBe(20);
    expect(advies.wearPerLap).toBeCloseTo(0.5, 4);
    expect(advies.weakestCorner).toBe("fl");
    expect(advies.reason).toContain("over 20 rondes op");
    expect(advies.reason).toContain("vóór de geplande stop");
  });

  it("zegt wisselen bij de stop als de band die wel haalt", () => {
    const advies = adviseTyreChange({
      samples: aflopend(14.5, 0.5, 10),
      mustSurviveLaps: 15,
      horizon: "planned_stop",
    });

    expect(advies.action).toBe("CHANGE_AT_PLANNED_STOP");
    expect(advies.reason).toContain("wisselen bij die stop");
  });

  it("zegt geen wissel als de band de finish haalt", () => {
    const advies = adviseTyreChange({
      samples: aflopend(14.5, 0.5, 10),
      mustSurviveLaps: 10,
      horizon: "finish",
    });

    expect(advies.action).toBe("NO_CHANGE");
    expect(advies.reason).toContain("geen wissel nodig");
  });

  it("dwingt een wissel als de band de finish niet haalt", () => {
    const advies = adviseTyreChange({
      samples: aflopend(14.5, 0.5, 10),
      mustSurviveLaps: 30,
      horizon: "finish",
    });

    expect(advies.action).toBe("CHANGE_BEFORE_PLANNED_STOP");
    expect(advies.reasonCode).toBe("tyre_life_before_finish");
    expect(advies.reason).toContain("zonder wissel haal je het niet");
  });

  it("geeft geen advies als de slijtage niet te meten is, met de oorzaak erbij", () => {
    const metingen: TyreSample[] = [
      ...[0, 1, 2, 3, 4, 5, 6].map((i) => ({
        lap: 40 + i,
        lapTime: 97,
        fl: 81.3,
        fr: 85.3,
        rl: 88.9,
        rr: 89.2,
      })),
      { lap: 47, lapTime: 97, fl: 79.9, fr: 84.1, rl: 87.6, rr: 88.0 },
      { lap: 48, lapTime: 97, fl: 79.7, fr: 83.9, rl: 87.4, rr: 87.8 },
    ];

    const advies = adviseTyreChange({ samples: metingen, mustSurviveLaps: 20, horizon: "planned_stop" });

    expect(advies.action).toBe("NO_ADVICE");
    expect(advies.reasonCode).toBe("stalled_values");
    expect(advies.lapsRemaining).toBeNull();
    expect(advies.wearPerLap).toBeNull();
    expect(advies.reason.startsWith("Geen bandenadvies:")).toBe(true);
    expect(advies.reason).toContain("stil");
  });

  it("geeft geen advies zonder reeks metingen", () => {
    const advies = adviseTyreChange({ samples: [], mustSurviveLaps: 20, horizon: "planned_stop" });
    expect(advies.action).toBe("NO_ADVICE");
    expect(advies.reason).toContain("Geen bandenadvies");
  });

  it("geeft geen rondes-tot-stop als het stopmoment onbekend is", () => {
    const advies = adviseTyreChange({
      samples: aflopend(14.5, 0.5, 10),
      mustSurviveLaps: null,
      horizon: "planned_stop",
    });

    expect(advies.action).toBe("NO_ADVICE");
    expect(advies.reasonCode).toBe("unknown_horizon");
    expect(advies.lapsRemaining).toBe(20);
    expect(advies.reason).toContain("volgende stop is onbekend");
  });
});

describe("recordTyreSample", () => {
  const meting = (lap: number, wear: number): TyreSample => ({
    lap,
    lapTime: 97,
    fl: wear,
    fr: wear,
    rl: wear,
    rr: wear,
  });

  it("houdt één meting per ronde bij", () => {
    const reeks = recordTyreSample(recordTyreSample([], meting(10, 99)), meting(11, 98.6));
    expect(reeks.map((s) => s.lap)).toEqual([10, 11]);
  });

  it("laat de laatste lezing van een ronde winnen", () => {
    const reeks = recordTyreSample(recordTyreSample([], meting(10, 99)), meting(10, 98.8));
    expect(reeks).toHaveLength(1);
    expect(reeks[0].fl).toBe(98.8);
  });

  it("begint opnieuw als de rondeteller terugspringt", () => {
    const reeks = recordTyreSample([meting(40, 80), meting(41, 79.5)], meting(1, 100));
    expect(reeks.map((s) => s.lap)).toEqual([1]);
  });

  it("negeert een meting zonder vier wielen", () => {
    const bestaand = [meting(10, 99)];
    const zonder = { ...meting(11, 98), fr: Number.NaN };
    expect(recordTyreSample(bestaand, zonder)).toHaveLength(1);
  });

  it("bewaart een begrensde reeks", () => {
    let reeks: TyreSample[] = [];
    for (let lap = 1; lap <= 50; lap += 1) reeks = recordTyreSample(reeks, meting(lap, 100 - lap), 40);
    expect(reeks).toHaveLength(40);
    expect(reeks[reeks.length - 1].lap).toBe(50);
  });
});
