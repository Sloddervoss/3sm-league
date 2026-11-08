import { describe, expect, it } from "vitest";
import { fieldSectorBests, sectorDeltas } from "@/features/endurance/pitwall/sectorField";

/**
 * De veldbeste per sector is alleen te vergelijken binnen één sectordeling.
 * Deze tests leggen vast dat onbruikbare tijden niet als "snelste" doorgaan en dat
 * een gemengde indeling geen vergelijking oplevert.
 */
describe("fieldSectorBests", () => {
  it("kiest per sector de snelste coureur", () => {
    const bests = fieldSectorBests([
      { id: "a", sectors: [30, 40, 35] },
      { id: "b", sectors: [31, 39, 34] },
      { id: "c", sectors: [29, 41, 36] },
    ]);
    expect(bests).not.toBeNull();
    expect(bests!.map((b) => b.seconds)).toEqual([29, 39, 34]);
    expect(bests!.map((b) => b.holderId)).toEqual(["c", "b", "b"]);
  });

  it("negeert null, nul en negatieve tijden", () => {
    const bests = fieldSectorBests([
      { id: "a", sectors: [0, -1, 35] },
      { id: "b", sectors: [Number.NaN, 40, Number.POSITIVE_INFINITY] },
    ]);
    expect(bests).toBeNull();
  });

  it("geeft null bij een gemengde sectordeling", () => {
    expect(fieldSectorBests([
      { id: "a", sectors: [30, 40, 35] },
      { id: "b", sectors: [30, 40, 35, 20] },
    ])).toBeNull();
  });

  it("geeft null als niemand een indeling heeft", () => {
    expect(fieldSectorBests([{ id: "a", sectors: null }, { id: "b", sectors: [] }])).toBeNull();
    expect(fieldSectorBests([])).toBeNull();
  });

  it("een enkele coureur is zijn eigen veldbeste", () => {
    const bests = fieldSectorBests([{ id: "a", sectors: [30, 40, 35] }]);
    expect(bests!.map((b) => b.holderId)).toEqual(["a", "a", "a"]);
  });
});

describe("sectorDeltas", () => {
  const bests = fieldSectorBests([
    { id: "a", sectors: [30, 40, 35] },
    { id: "b", sectors: [29, 41, 34] },
  ])!;

  it("rekent het verschil tegen de veldbeste uit", () => {
    expect(sectorDeltas([30, 40, 35], bests)).toEqual([1, 0, 1]);
  });

  it("rondt af op milliseconden", () => {
    expect(sectorDeltas([29.0004, 40.0004, 34.0004], bests)).toEqual([0, 0, 0]);
    // En een milliseconde verschil blijft zichtbaar.
    expect(sectorDeltas([29.001, 40, 34], bests)).toEqual([0.001, 0, 0]);
  });

  it("laat een onbruikbare eigen tijd leeg", () => {
    expect(sectorDeltas([30, null as unknown as number, 35], bests)).toEqual([1, null, 1]);
  });

  it("geeft null bij een andere lengte of ontbrekende invoer", () => {
    expect(sectorDeltas([30, 40], bests)).toBeNull();
    expect(sectorDeltas(null, bests)).toBeNull();
    expect(sectorDeltas([30, 40, 35], null)).toBeNull();
  });
});
