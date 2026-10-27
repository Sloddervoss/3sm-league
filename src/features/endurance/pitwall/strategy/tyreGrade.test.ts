import { describe, expect, it } from "vitest";
import {
  GRADE_A_MAX_SIGMA_LAPS,
  GRADE_B_MAX_SIGMA_LAPS,
  LAPS_MIN_GRADE,
  TYRE_CHANGE_THRESHOLD_PCT,
  clientTyreEstimate,
  formatLapsRange,
  formatPct,
  formatPctRange,
  formatRate,
  gradeFromSigma,
  lapsRange,
  lapsToThreshold,
  parseTyreEstimate,
  pctRange,
} from "./tyreGrade";
import type { TyreSample } from "./tyreWear";

/**
 * De vier graden op hun grenzen.
 *
 * Elke test hier pakt een drempel uit plan-03 en legt vast wat er nét wel en
 * nét niet door mag. De waarden zijn de constanten zelf, niet een tweede mening:
 * 1,5 / 3,0 rondes, 4 rondes sinds het anker, 40% rest.
 */
describe("gradeFromSigma", () => {
  it("houdt de drempels uit plan-03 vast", () => {
    expect(TYRE_CHANGE_THRESHOLD_PCT).toBe(40);
    expect(GRADE_A_MAX_SIGMA_LAPS).toBe(1.5);
    expect(GRADE_B_MAX_SIGMA_LAPS).toBe(3.0);
    expect(LAPS_MIN_GRADE).toBe(4);
  });

  it("geeft A bij twee ankers en σ_laps op de grens van 1,5", () => {
    expect(gradeFromSigma({ anchors: 2, sigmaLaps: 1.5, lapsSinceAnchor: 20 })).toBe("A");
  });

  it("zakt naar B zodra σ_laps boven 1,5 komt", () => {
    expect(gradeFromSigma({ anchors: 2, sigmaLaps: 1.51, lapsSinceAnchor: 20 })).toBe("B");
  });

  it("geeft nooit A met één anker, ook niet bij σ = 0,5", () => {
    expect(gradeFromSigma({ anchors: 1, sigmaLaps: 0.5, lapsSinceAnchor: 20 })).toBe("B");
  });

  it("geeft B op de grens van 3,0 en C daarboven", () => {
    expect(gradeFromSigma({ anchors: 1, sigmaLaps: 3.0, lapsSinceAnchor: 20 })).toBe("B");
    expect(gradeFromSigma({ anchors: 1, sigmaLaps: 3.01, lapsSinceAnchor: 20 })).toBe("C");
  });

  it("geeft C als er minder dan vier rondes sinds het anker zijn", () => {
    expect(gradeFromSigma({ anchors: 2, sigmaLaps: 0.4, lapsSinceAnchor: 3 })).toBe("C");
    expect(gradeFromSigma({ anchors: 2, sigmaLaps: 0.4, lapsSinceAnchor: 4 })).toBe("A");
  });

  it("plafonneert op C als het anker uit een run-einde komt", () => {
    expect(gradeFromSigma({ anchors: 2, sigmaLaps: 0.4, lapsSinceAnchor: 20, anchorSource: "run_end" })).toBe("C");
  });

  it("geeft maximaal B als twee hoeken even zwak zijn", () => {
    expect(gradeFromSigma({ anchors: 2, sigmaLaps: 0.4, lapsSinceAnchor: 20, bindingAmbiguous: true })).toBe("B");
  });

  it("geeft D zonder anker of zonder σ", () => {
    expect(gradeFromSigma({ anchors: 0, sigmaLaps: 0.4 })).toBe("D");
    expect(gradeFromSigma({ anchors: 2, sigmaLaps: null, lapsSinceAnchor: 20 })).toBe("D");
  });

  it("laat een oorzaak altijd winnen, ook bij een perfect anker", () => {
    expect(
      gradeFromSigma({ anchors: 2, sigmaLaps: 0.2, lapsSinceAnchor: 20, cause: "wet" }),
    ).toBe("D");
  });
});

describe("lapsToThreshold", () => {
  it("rekent naar de drempel, niet naar nul (plan-03 T14a)", () => {
    // 62% rest, 1,8 pp per ronde: (62 − 40) / 1,8 = 12,22
    expect(lapsToThreshold({ restPct: 62, ratePerLap: 1.8 }).laps).toBeCloseTo(12.222, 3);
  });

  it("zegt 'nu wisselen' als de drempel al bereikt is", () => {
    expect(lapsToThreshold({ restPct: 38, ratePerLap: 1.8 })).toEqual({ laps: 0, reason: "at_threshold" });
  });

  it("geeft geen levensduur zonder helling", () => {
    expect(lapsToThreshold({ restPct: 62, ratePerLap: 0 }).reason).toBe("no_degradation");
    expect(lapsToThreshold({ restPct: 62, ratePerLap: null }).reason).toBe("no_measurement");
    expect(lapsToThreshold({ restPct: null, ratePerLap: 1.8 }).reason).toBe("no_measurement");
  });

  it("laat 1,8 pp/ronde door: dat is het getal uit plan-03 T14, geen fout", () => {
    // MAX_RATE = 1,5 is een poort op een ankerpaar, geen grens op de weergave.
    expect(lapsToThreshold({ restPct: 62, ratePerLap: 1.8 }).reason).toBe("ok");
  });
});

describe("bereik en opmaak", () => {
  it("rondt het bereik naar buiten af (plan-03 T14b)", () => {
    // 12,22 ± 1,11 -> 11,11–13,33 -> 11–14, niet 11–13.
    expect(lapsRange(12.22, 1.11)).toEqual({ low: 11, high: 14 });
  });

  it("gebruikt een en dash, geen koppelstreep", () => {
    const tekst = formatLapsRange({ low: 11, high: 14 });
    expect(tekst).toBe("11–14");
    expect(tekst).toContain("–");
    expect(tekst).not.toContain("-");
  });

  it("maakt van 55–70% een bereik met de onderkant eerst", () => {
    expect(pctRange(62.4, 11.8)).toEqual({ low: 50, high: 75 });
    expect(formatPctRange({ low: 55, high: 70 })).toBe("55–70%");
  });

  it("schrijft het tempo met een minteken en een komma (nl-NL)", () => {
    expect(formatRate(1.8)).toBe("−1,8/r");
    expect(formatRate(-1.8)).toBe("−1,8/r");
    expect(formatRate(null)).toBeNull();
  });

  it("rondt het percentage naar beneden af: nooit optimistischer dan de meting", () => {
    expect(formatPct(62.9)).toBe("62");
    expect(formatPct(null)).toBeNull();
  });
});

describe("parseTyreEstimate", () => {
  const blok = {
    source: "anchor",
    grade: "A",
    reason: "two_anchors",
    anchor: { lap: 34, laps_since: 21, set_no: 3, wear: { fl: 62.1, fr: 66.4, rl: 70.2, rr: 71.0 } },
    previous_anchor: { lap: 13 },
    estimate: {
      per_corner: {
        fl: { value: 62.1, rate_per_lap: -1.42, sigma: 0.82, laps_to_threshold: 12 },
        fr: {}, rl: {}, rr: {},
      },
      weakest: "fl",
      threshold_pct: 40,
    },
    sigma_laps: 1.1,
  };

  it("leest het blok uit de RPC en rekent de marge uit σ_punt", () => {
    const estimate = parseTyreEstimate(blok)!;
    expect(estimate.grade).toBe("A");
    expect(estimate.source).toBe("server");
    expect(estimate.weakest).toBe("fl");
    expect(estimate.restPct).toBe(62.1);
    expect(estimate.ratePerLap).toBeCloseTo(1.42, 4);
    // De marge hoort bij graad B; A toont geen ±.
    expect(estimate.marginPp).toBeNull();
    expect(estimate.lapsToThreshold).toBe(12);
    // Graad A levert ook een bereik in rondes: de pitwall toont geen percentage
    // rest meer, dus zonder bereik zou A terugvallen op één getal.
    expect(estimate.lapsRange).toEqual({ low: 10, high: 14 });
    expect(estimate.limitPct).toBe(40);
    expect(estimate.cause).toBeNull();
  });

  it("rekent σ in rondes uit σ in procentpunten als de server die niet stuurt", () => {
    // De RPC stuurt sigma_pct (1,6 bij A) en geen sigma_laps. Delen door de
    // helling geeft dezelfde onzekerheid in rondes, zonder een nieuwe aanname.
    const zonderSigmaLaps = {
      ...blok,
      sigma_laps: null,
      estimate: { ...blok.estimate, per_corner: { fl: { value: 62, rate_per_lap: -1.6, sigma: 1.6, laps_to_threshold: 13 } } },
    };
    const estimate = parseTyreEstimate(zonderSigmaLaps)!;
    expect(estimate.sigmaLaps).toBeCloseTo(1.0, 4);
    expect(estimate.lapsRange).toEqual({ low: 12, high: 14 });
  });

  it("leest graad D als oorzaak, zonder getal", () => {
    const estimate = parseTyreEstimate({ source: "none", grade: "D", reason: "no_anchor" })!;
    expect(estimate.grade).toBe("D");
    expect(estimate.restPct).toBeNull();
    expect(estimate.lapsToThreshold).toBeNull();
    expect(estimate.cause).toBe("no_anchor");
  });

  it("rekent de rondes zelf als de server ze niet meestuurt", () => {
    const zonderLaps = {
      ...blok,
      estimate: { ...blok.estimate, per_corner: { fl: { value: 62, rate_per_lap: -1.8, sigma: 0.8 } } },
    };
    expect(parseTyreEstimate(zonderLaps)!.lapsToThreshold).toBeCloseTo(12.222, 3);
  });

  it("geeft null als het veld ontbreekt of geen graad heeft", () => {
    expect(parseTyreEstimate(null)).toBeNull();
    expect(parseTyreEstimate(undefined)).toBeNull();
    expect(parseTyreEstimate({})).toBeNull();
    expect(parseTyreEstimate({ grade: "E" })).toBeNull();
    expect(parseTyreEstimate("A")).toBeNull();
  });
});

describe("clientTyreEstimate — de eerlijke tussenstand", () => {
  /** Linksvoor zakt met 0,5 pp per ronde; de andere wielen blijven hoger. */
  const aflopend = (start: number, stap = 0.5, aantal = 10): TyreSample[] =>
    Array.from({ length: aantal }, (_, i) => ({
      lap: 10 + i,
      lapTime: 90,
      fl: start - i * stap,
      fr: start - i * stap + 3,
      rl: start - i * stap + 5,
      rr: start - i * stap + 6,
    }));

  it("plafonneert op B: zonder ankers is A niet te bewijzen", () => {
    const estimate = clientTyreEstimate(aflopend(90, 0.2));
    expect(estimate.grade).toBe("B");
    expect(estimate.source).toBe("client");
    expect(estimate.ratePerLap).toBeCloseTo(0.2, 4);
    // De live reeks rekent naar kaal, niet naar 40%: dat zegt de grens erbij.
    expect(estimate.limitPct).toBe(0);
    expect(estimate.lapsRange).not.toBeNull();
  });

  it("geeft dezelfde oorzaak als de meetkern bij stilstand, met de ronde erbij", () => {
    const stil: TyreSample[] = [
      ...Array.from({ length: 7 }, (_, i) => ({
        lap: 40 + i,
        lapTime: 90,
        fl: 81.3,
        fr: 85.3,
        rl: 88.9,
        rr: 89.2,
      })),
      { lap: 47, lapTime: 90, fl: 79.9, fr: 84.1, rl: 87.6, rr: 88.0 },
    ];
    const estimate = clientTyreEstimate(stil);
    expect(estimate.grade).toBe("D");
    expect(estimate.cause).toBe("stalled_values");
    expect(estimate.causeLap).toBe(40);
    expect(estimate.restPct).toBeNull();
  });

  it("geeft D zonder metingen, met 'te weinig metingen' als oorzaak", () => {
    const estimate = clientTyreEstimate([]);
    expect(estimate.grade).toBe("D");
    expect(estimate.source).toBe("none");
    expect(estimate.cause).toBe("too_few_samples");
  });

  it("geeft C als de band niet meetbaar slijt maar er wel een reeks is", () => {
    // σ_laps = 0,30 / 0,05 = 6 rondes: te groot voor B.
    const estimate = clientTyreEstimate(aflopend(90, 0.05));
    expect(estimate.grade).toBe("C");
    expect(estimate.lapsToThreshold).toBeNull();
  });
});
