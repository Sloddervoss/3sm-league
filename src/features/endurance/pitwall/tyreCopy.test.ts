import { describe, expect, it } from "vitest";
import {
  adviceLine,
  bindingSentence,
  causeLine,
  gradeLabel,
  gradeWord,
  lapsAdvice,
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
 *
 * Sinds de eerlijke bandenstrook is de vorm overal hetzelfde: een bereik in
 * rondes, geen percentage rest. Wat een percentage wél mag zijn is de naam van
 * de drempel ("tot 40%") — dat is geen voorspelling maar een grens.
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
  it("koppelt elke graad aan één betrouwbaarheidswoord", () => {
    expect(gradeLabel("A")).toBe("A · gemeten");
    expect(gradeLabel("B")).toBe("B · voorlopig");
    expect(gradeLabel("C")).toBe("C · schatting");
    expect(gradeLabel("D")).toBe("D · plan");
  });

  it("gebruikt geen woord twee keer voor twee graden", () => {
    const woorden = (["A", "B", "C", "D"] as const).map((graad) => gradeWord(graad));
    expect(new Set(woorden).size).toBe(4);
  });

  it("noemt de grens bij naam: 40% of kaal, nooit door elkaar", () => {
    expect(limitLabel(40)).toBe("40%");
    expect(limitLabel(40, true)).toBe("tot 40%");
    expect(limitLabel(0, true)).toBe("tot kaal");
    expect(limitLabel(null)).toBeNull();
  });
});

describe("het bereik in rondes", () => {
  it("gebruikt het bereik als de band bekend is", () => {
    expect(lapsAdvice(estimate())).toEqual({ rangeText: "11–14", range: { low: 11, high: 14 }, limit: "tot 40%" });
  });

  it("valt terug op het puntgetal zonder band", () => {
    // Eén getal is eerlijker dan een bereik dat de UI zelf verbreedt.
    expect(lapsAdvice(estimate({ lapsRange: null }))).toEqual({
      rangeText: "12",
      range: null,
      limit: "tot 40%",
    });
  });

  it("zegt onbekend als er geen rondes zijn in plaats van een nul", () => {
    expect(lapsAdvice(estimate({ lapsRange: null, lapsToThreshold: null, limitPct: null }))).toEqual({
      rangeText: null,
      range: null,
      limit: null,
    });
  });
});

describe("adviesregel per graad", () => {
  it("A: het bereik in rondes tot de drempel, zonder percentage rest", () => {
    expect(adviceLine(estimate())).toBe("11–14 rondes tot 40%");
    expect(adviceLine(estimate())).not.toContain("62%");
  });

  it("B: dezelfde vorm, met een bredere band", () => {
    // Het woord verschilt (voorlopig), niet de vorm: twee verschillende zinnen
    // voor hetzelfde getal is precies hoe dit paneel eerder ongeloofwaardig werd.
    expect(adviceLine(estimate({ grade: "B" }))).toBe("11–14 rondes tot 40%");
  });

  it("laat de grens weg als hij onbekend is, maar houdt de rondes", () => {
    expect(adviceLine(estimate({ limitPct: null }))).toBe("11–14 rondes");
  });

  it("noemt de kaal-grens bij kaal, niet 40%", () => {
    expect(adviceLine(estimate({ limitPct: 0 }))).toBe("11–14 rondes tot kaal");
  });

  it("zegt rondes onbekend als de band er wel is maar de rondes niet", () => {
    expect(adviceLine(estimate({ lapsRange: null, lapsToThreshold: null, limitPct: null }))).toBe(
      "rondes onbekend",
    );
  });

  it("C: geen rondes, geen tempo, wel de instructie", () => {
    const regel = adviceLine(
      estimate({ grade: "C", ratePerLap: null, lapsToThreshold: null, lapsRange: null, pctRange: { low: 55, high: 70 }, limitPct: null }),
    );
    expect(regel).toBe("rondes onbekend · wacht op stop");
    expect(regel).not.toContain("/r");
    expect(regel).not.toContain("55");
  });

  it("D: een streepje en de oorzaak", () => {
    expect(adviceLine(estimate({ grade: "D", restPct: null, cause: "stalled_values", causeLap: 7 }))).toBe(
      "— · waarde staat stil sinds r7",
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
