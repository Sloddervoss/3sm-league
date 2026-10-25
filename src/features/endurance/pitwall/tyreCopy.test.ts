import { describe, expect, it } from "vitest";
import {
  adviceLine,
  bindingSentence,
  causeLine,
  gradeLabel,
  gradeWord,
  lapsLabel,
  limitLabel,
  marginAria,
  rangeSuffix,
  stayOutLine,
  whatToDo,
} from "./tyreCopy";
import type { TyreEstimate } from "./strategy/tyreGrade";

/**
 * De copy is een contract, geen tekst.
 *
 * Deze tests eisen de letterlijke regels uit 3sm-bandenplan §4 en plan-04 §3a.
 * Zo kan een latere "verduidelijking" de betekenis niet stilzwijgend veranderen:
 * "wacht op stop" is een instructie, "onbekend" is een schouderophalen.
 */

const estimate = (overrides: Partial<TyreEstimate> = {}): TyreEstimate => ({
  grade: "A",
  source: "server",
  weakest: "fl",
  restPct: 62,
  ratePerLap: 1.8,
  marginPp: 4,
  sigmaLaps: 1.1,
  lapsToThreshold: 12.22,
  lapsRange: { low: 11, high: 14 },
  pctRange: null,
  cause: null,
  causeLap: null,
  causeLaps: 21,
  limitPct: 40,
  samples: 1,
  ...overrides,
});

describe("graadwoorden", () => {
  it("koppelt elke graad aan één woord", () => {
    expect(gradeLabel("A")).toBe("A · gemeten");
    expect(gradeLabel("B")).toBe("B · geschat");
    expect(gradeLabel("C")).toBe("C · alleen bereik");
    expect(gradeLabel("D")).toBe("D · geen meting");
    expect(gradeWord("D")).toBe("geen meting");
  });

  it("noemt de grens bij naam: 40% of kaal, nooit door elkaar", () => {
    expect(limitLabel(40)).toBe("40%");
    expect(limitLabel(40, true)).toBe("tot 40%");
    expect(limitLabel(0, true)).toBe("tot kaal");
    expect(limitLabel(null)).toBeNull();
  });
});

describe("adviesregel per graad", () => {
  it("A: puntgetal, helling en rondes tot 40%", () => {
    expect(adviceLine(estimate())).toBe("62% · −1,8/r · nog 12 rondes tot 40%");
  });

  it("B: getal met marge, rondes als bereik", () => {
    expect(adviceLine(estimate({ grade: "B" }))).toBe("62% ±4 · 11–14 rondes (geschat)");
  });

  it("C: bereik en een instructie, geen tempo", () => {
    expect(adviceLine(estimate({ grade: "C", ratePerLap: null, lapsToThreshold: null, pctRange: { low: 55, high: 70 } }))).toBe(
      "55–70% · geschat · wacht op stop",
    );
  });

  it("D: een streepje en de oorzaak", () => {
    expect(
      adviceLine(
        estimate({ grade: "D", restPct: null, cause: "stalled_values", causeLap: 7 }),
      ),
    ).toBe("— · waarde staat stil sinds r7");
  });

  it("zegt het als de grens onbekend is in plaats van een getal te verzinnen", () => {
    expect(adviceLine(estimate({ lapsToThreshold: null, limitPct: null }))).toBe(
      "62% · −1,8/r · grens onbekend",
    );
  });
});

describe("oorzaakregels", () => {
  const oorzaak = (cause: TyreEstimate["cause"], extra: Partial<TyreEstimate> = {}) =>
    causeLine(estimate({ grade: "D", cause, ...extra }));

  it("gebruikt de vaste lijst uit plan-04 §3a", () => {
    expect(oorzaak("stalled_values", { causeLap: 7 })).toBe("waarde staat stil sinds r7");
    expect(oorzaak("jump")).toBe("waarde versprong in één ronde");
    expect(oorzaak("not_wearing")).toBe("geen slijtage gemeten");
    expect(oorzaak("implausible")).toBe("slijtage per ronde onmogelijk hoog");
    expect(oorzaak("unknown_horizon")).toBe("volgende stop onbekend");
    expect(oorzaak("stale_telemetry", { causeLaps: 42 })).toBe("meting 42 s oud");
    expect(oorzaak("no_baseline")).toBe("afstand tot de finish onbekend");
    expect(oorzaak("too_few_samples", { causeLaps: 3 })).toBe("3 rondes op deze set");
  });

  it("zegt bij een ontbrekende oorzaak wat er dan wél waar is", () => {
    expect(causeLine(estimate({ cause: null }))).toBe("geen bandenmeting sinds de vorige stop");
  });

  it("geeft bij elke oorzaak één instructie en nooit een excuus", () => {
    expect(whatToDo("stalled_values")).toBe("plan op de tank");
    expect(whatToDo("too_few_samples")).toBe("plan op de tank");
    expect(whatToDo("unknown_horizon")).toBe("wacht op de volgende stop");
    expect(whatToDo("stale_telemetry")).toBe("wacht op een nieuwe meting");
    expect(whatToDo("no_baseline")).toBe("geen uitspraak");
  });
});

describe("de ene grens in woorden", () => {
  it("zegt wie de grens is, met de stop erbij", () => {
    expect(bindingSentence({ binding: "tyres", laps: 12, tyreLaps: 12, fuelLaps: 15 })).toBe(
      "banden zijn de grens; wissel bij de stop van r12",
    );
    expect(bindingSentence({ binding: "both", laps: 12, tyreLaps: 12, fuelLaps: 12 })).toBe(
      "beide op dezelfde ronde; wissel bij de stop van r12",
    );
    expect(bindingSentence({ binding: "fuel", laps: 12, tyreLaps: 15, fuelLaps: 12 })).toBe(
      "tank is de grens; banden gaan nog 3 rondes langer mee",
    );
  });

  it("zegt bij een onbekende band dat de tank de grens is, niet dat de banden ok zijn", () => {
    expect(bindingSentence({ binding: "fuel", laps: 9, tyreLaps: null, fuelLaps: 9 })).toBe(
      "tank is de grens; banden onbekend",
    );
  });

  it("vat blijven buiten samen in één regel", () => {
    expect(stayOutLine({ restPct: 62, fuelLaps: 9, lapsToFinish: 9 })).toBe(
      "banden 62% · tank 9 rondes · beide halen de finish (9 rondes)",
    );
    expect(stayOutLine({ restPct: null, fuelLaps: 9, lapsToFinish: 9 })).toBe(
      "tank 9 rondes · haalt de finish (9 rondes)",
    );
  });

  it("houdt de eenheden heel: rondes, en dash, geen afkapping", () => {
    expect(lapsLabel(12)).toBe("nog 12 rondes");
    expect(lapsLabel(1)).toBe("nog 1 ronde");
    expect(lapsLabel(null)).toBe("onbekend");
    expect(rangeSuffix({ low: 11, high: 14 })).toBe("(11–14)");
    expect(marginAria(4)).toBe("plus of min 4 procent");
  });
});
