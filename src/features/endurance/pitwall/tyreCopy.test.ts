import { describe, expect, it } from "vitest";
import {
  adviceLine,
  bindingSentence,
  causeLine,
  combinatie,
  eigenRegel,
  gedeeldRegel,
  gradeLabel,
  gradeWord,
  hellingenUiteen,
  lapsAdvice,
  lapsLabel,
  limitLabel,
  marginAria,
  rangeSuffix,
  redenIsWaarschuwing,
  redenRegel,
  staleRegel,
  stapRegel,
  stayOutLine,
  uiteenloopRegel,
  voorlopigRegel,
  whatToDo,
} from "./tyreCopy";
import { parseTyreEstimateV2, type TyreEstimateV2 } from "./strategy/tyreEstimateV2";
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
    expect(gradeLabel("A")).toBe("A · sterk");
    expect(gradeLabel("B")).toBe("B · matig");
    expect(gradeLabel("C")).toBe("C · zwak");
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

/**
 * De eerlijke bronregels van 31-10: wat de pool vindt naast wat je zelf meet,
 * een teller die de stints telt die er echt zijn, en geen belofte die de server
 * niet waarmaakt.
 *
 * De oude copy zei bij een eigen meting niets over de pool (ook als het getal
 * geblend was), noemde zestien stints "nog geen tweede meting", en beloofde dat
 * elke stop de band smaller maakt. Deze tests leggen de drie correcties vast.
 */
describe("gedeeld en eigen naast elkaar", () => {
  /** Een graad B met de contractvelden van 31-10; `basis` mag per test afwijken. */
  const v2 = (basis: Record<string, unknown>, extra: Record<string, unknown> = {}): TyreEstimateV2 =>
    parseTyreEstimateV2({
      grade: "B",
      usable: true,
      stints: 2,
      wear_per_lap: 1.9,
      range_laps: { low: 9, high: 13 },
      provenance: "estimated",
      voorlopig: true,
      ...extra,
      basis: {
        car_key: "bmw_m4_gt3",
        track_key: "spa",
        rondes_in_basis: 18,
        ...basis,
      },
    })!;

  const GEDEELD = { rate: 2.14, rondes: 41, stints: 7, accounts: 3 };
  const EIGEN = { rate: 1.9, rondes: 18, stints: 2 };

  it("noemt bij beide bronnen de combinatie, het tempo en de meetbasis", () => {
    const estimate = v2({ bron: "eigen", gedeeld: GEDEELD, eigen: EIGEN });

    expect(gedeeldRegel(estimate)).toBe(
      "Gedeeld voor bmw_m4_gt3 op spa: 2,1% per ronde, uit 41 rondes van 3 rijders.",
    );
    expect(eigenRegel(estimate)).toBe("Eigen voor bmw_m4_gt3 op spa: 1,9% per ronde, uit 2 stints en 18 rondes.");
  });

  it("leest de contractvelden, en niets als ze ontbreken", () => {
    const met = v2({ bron: "eigen", gedeeld: GEDEELD, eigen: EIGEN, redenen: ["thin_pool", "short_basis"] });
    expect(met.basis.gedeeld).toEqual({ rate: 2.14, rondes: 41, stints: 7, accounts: 3 });
    expect(met.basis.eigen).toEqual({ rate: 1.9, rondes: 18, stints: 2 });
    // Gesorteerd en gededupliceerd, ook als de server dat niet deed.
    expect(met.basis.redenen).toEqual(["thin_pool", "short_basis"]);

    const zonder = v2({ bron: "eigen" });
    expect(zonder.basis.gedeeld).toBeNull();
    expect(zonder.basis.eigen).toBeNull();
    expect(zonder.basis.redenen).toEqual([]);
    expect(zonder.basis.actualiteit).toBeNull();
    // En dus valt de UI terug op de oude weergave: geen regel, geen breuk.
    expect(gedeeldRegel(zonder)).toBeNull();
    expect(eigenRegel(zonder)).toBeNull();
  });

  it("negeert onbekende codes en een lege huls", () => {
    const estimate = v2({ redenen: ["iets_nieuws", "zero_slope", "zero_slope"], gedeeld: {} });
    expect(estimate.basis.redenen).toEqual(["zero_slope"]);
    expect(estimate.basis.gedeeld).toBeNull();
    expect(gedeeldRegel(estimate)).toBeNull();
  });

  it("zegt bij nul eigen stints dat er nog niets eigens is", () => {
    const estimate = v2({ gedeeld: GEDEELD, eigen: { rate: null, rondes: 0, stints: 0 } });
    expect(eigenRegel(estimate)).toBe("Eigen voor bmw_m4_gt3 op spa: nog geen eigen meting op deze combinatie.");
    expect(stapRegel(estimate)).toBeNull();
  });

  it("laat de combinatie weg als de server hem niet stuurde", () => {
    expect(combinatie("bmw_m4_gt3", "spa")).toBe("bmw_m4_gt3 op spa");
    expect(combinatie("bmw_m4_gt3", null)).toBe("bmw_m4_gt3");
    expect(combinatie(null, null)).toBeNull();

    const estimate = v2({ car_key: null, track_key: null, eigen: EIGEN });
    expect(eigenRegel(estimate)).toBe("Eigen: 1,9% per ronde, uit 2 stints en 18 rondes.");
  });
});

describe("de teller onder het bereik", () => {
  const metEigen = (stints: number, gedeeld: number | null = 2.0): TyreEstimateV2 =>
    parseTyreEstimateV2({
      grade: "C",
      usable: true,
      stints,
      wear_per_lap: 1.9,
      range_laps: { low: 9, high: 13 },
      voorlopig: true,
      basis: {
        car_key: "bmw_m4_gt3",
        track_key: "spa",
        eigen: { rate: 1.9, rondes: stints * 9, stints },
        gedeeld: gedeeld == null ? null : { rate: gedeeld, rondes: 41, stints: 7, accounts: 3 },
      },
    })!;

  it("telt de eigen stints en noemt de eerstvolgende graad", () => {
    expect(stapRegel(metEigen(1))).toBe(
      "Nog 1 stint op deze combinatie tot graad B; elke stint met hetzelfde beeld maakt de band smaller.",
    );
    expect(stapRegel(metEigen(2))).toBe(
      "Nog 1 stint op deze combinatie tot graad A; elke stint met hetzelfde beeld maakt de band smaller.",
    );
    expect(stapRegel(metEigen(3))).toBe(
      "Graad A: op deze combinatie is de band zo smal als deze metingen toelaten; meer stints veranderen de graad niet.",
    );
  });

  it("belooft geen smaller wordende band als de hellingen uiteenlopen", () => {
    // Precies de fout van 31-10: de server verbreedt de band hier juist.
    expect(hellingenUiteen(2.8, 1.1)).toBe(true);
    expect(hellingenUiteen(1.9, 2.0)).toBe(false);
    expect(hellingenUiteen(null, 2.0)).toBe(false);

    const estimate = metEigen(2, 1.1);
    expect(stapRegel(estimate)).toBe("Nog 1 stint op deze combinatie tot graad A.");
    expect(uiteenloopRegel(estimate)).toBe(
      "Je eigen slijtage (1,9% per ronde) en de gedeelde (1,1% per ronde) lopen uiteen: " +
        "een volgende stint kan de band breder maken in plaats van smaller.",
    );

    // Zonder uiteenlopende hellingen is er geen waarschuwing.
    expect(uiteenloopRegel(metEigen(2, 2.0))).toBeNull();
  });

  it("zwijgt bij een niet-verse stand en bij een onmeetbare helling", () => {
    const stale = parseTyreEstimateV2({
      grade: "C",
      usable: false,
      stints: 16,
      range_laps: null,
      basis: {
        eigen: { rate: 1.9, rondes: 140, stints: 16 },
        actualiteit: { wear_ouderheid_min: 47, sessie_match: true, set_match: true, vers: false },
        redenen: ["stale_state"],
      },
    })!;
    expect(stapRegel(stale)).toBeNull();

    const vlak = parseTyreEstimateV2({
      grade: "C",
      usable: true,
      stints: 2,
      basis: { eigen: { rate: 0.01, rondes: 18, stints: 2 }, redenen: ["zero_slope"] },
    })!;
    expect(stapRegel(vlak)).toBeNull();
  });

  it("vervangt 'nog geen tweede meting' door het echte aantal stints", () => {
    // Het geval uit de review: zestien stints en toch "nog geen tweede meting".
    const zestien = parseTyreEstimateV2({
      grade: "B",
      usable: true,
      stints: 16,
      range_laps: { low: 9, high: 13 },
      voorlopig: true,
    })!;
    const regel = voorlopigRegel(zestien)!;
    expect(regel).toBe(
      "Dit bereik is voorlopig: het rust op 16 stints. Een nieuwe stint met hetzelfde beeld maakt de band smaller.",
    );
    expect(regel).not.toMatch(/tweede meting/i);
    expect(regel).not.toMatch(/elke stop/i);

    expect(voorlopigRegel(parseTyreEstimateV2({ grade: "B", stints: 1 })!)).toContain("Eén stint is nog geen band");
    expect(voorlopigRegel(parseTyreEstimateV2({ grade: "B", stints: 0 })!)).toBe(
      "Dit bereik is voorlopig: er is nog te weinig gemeten om de band smaller te maken.",
    );
  });
});

describe("de niet-verse bandmeting", () => {
  const stale = (actualiteit: Record<string, unknown> | null, redenen: string[] = ["stale_state"]): TyreEstimateV2 =>
    parseTyreEstimateV2({
      grade: "C",
      usable: false,
      stints: 16,
      range_laps: null,
      basis: { actualiteit, redenen },
    })!;

  it("zegt 'geen actuele bandmeting' met de leeftijd in minuten", () => {
    expect(staleRegel(stale({ wear_ouderheid_min: 47, sessie_match: true, set_match: true, vers: false }))).toBe(
      "Geen actuele bandmeting: de laatste meting is 47 minuten oud. Daarom geen rondes tot de grens.",
    );
    expect(staleRegel(stale({ wear_ouderheid_min: 1, sessie_match: true, set_match: true, vers: false }))).toContain(
      "de laatste meting is 1 minuut oud",
    );
    expect(staleRegel(stale({ wear_ouderheid_min: 0, sessie_match: true, set_match: true, vers: false }))).toContain(
      "de laatste meting is minder dan een minuut oud",
    );
  });

  it("zegt waarom een jonge meting toch niet vers is", () => {
    expect(staleRegel(stale({ wear_ouderheid_min: 3, sessie_match: true, set_match: false, vers: false }))).toBe(
      "Geen actuele bandmeting: de laatste meting hoort bij een andere set. Daarom geen rondes tot de grens.",
    );
    expect(staleRegel(stale({ wear_ouderheid_min: 3, sessie_match: false, set_match: true, vers: false }))).toContain(
      "komt uit een andere sessie",
    );
  });

  it("weegt een ontbrekend vers-veld zelf met de grens uit het contract", () => {
    const vers = stale({ wear_ouderheid_min: 4, sessie_match: true, set_match: true }, []);
    expect(vers.basis.actualiteit?.vers).toBe(true);
    expect(staleRegel(vers)).toBeNull();

    const oud = stale({ wear_ouderheid_min: 47, sessie_match: true, set_match: true });
    expect(oud.basis.actualiteit?.vers).toBe(false);
    expect(staleRegel(oud)).not.toBeNull();

    // Een verse stand met een vergeten `vers`-veld telt als vers, ook als de
    // samenvatting nog "stale_state" zegt: `vers` is de scherpste uitspraak.
    const tegenstrijdig = stale({ wear_ouderheid_min: 4, sessie_match: true, set_match: true });
    expect(staleRegel(tegenstrijdig)).toBeNull();
  });

  it("zegt niets over actualiteit zonder bewijs", () => {
    expect(staleRegel(stale(null, []))).toBeNull();
  });
});

describe("één regel per reden-code", () => {
  it("vertaalt elke code naar één zin, zonder Engels of veldnamen", () => {
    expect(redenRegel("short_basis")).toContain("Minder dan 8 rondes eigen basis");
    expect(redenRegel("inferred_boundary")).toContain("sprong in de wear-stand");
    expect(redenRegel("context_mismatch")).toContain("andere auto of een ander circuit");
    expect(redenRegel("thin_pool")).toBe(
      "Nog te weinig rijders op deze combinatie: er zijn minstens twee rijders nodig voor een gedeelde verwachting.",
    );
    expect(redenRegel("zero_slope")).toContain("Geen meetbare slijtage");

    for (const code of ["short_basis", "inferred_boundary", "context_mismatch", "thin_pool", "zero_slope"] as const) {
      const regel = redenRegel(code)!;
      expect(regel).not.toMatch(/basis\.|redenen|prior|thin_pool|zero_slope|shared/i);
    }
    // De niet-verse stand heeft zijn eigen regel met de leeftijd.
    expect(redenRegel("stale_state")).toBeNull();
  });

  it("weet welke codes een waarschuwing zijn en welke een voorbehoud", () => {
    expect(redenIsWaarschuwing("thin_pool")).toBe(true);
    expect(redenIsWaarschuwing("context_mismatch")).toBe(true);
    expect(redenIsWaarschuwing("zero_slope")).toBe(true);
    expect(redenIsWaarschuwing("short_basis")).toBe(false);
    expect(redenIsWaarschuwing("inferred_boundary")).toBe(false);
  });
});
