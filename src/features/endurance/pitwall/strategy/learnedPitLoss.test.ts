import { describe, expect, it } from "vitest";
import { hasLearnedLoss, mapLearnedPitLoss } from "./learnedPitLoss";

describe("mapLearnedPitLoss", () => {
  it("accepts a personal measurement with a real loss", () => {
    const value = mapLearnedPitLoss({
      source: "personal", samples: 4, laneSeconds: 47, standingSeconds: 41,
      stretchSeconds: 12.5, lossSeconds: 34.5,
    });
    expect(value).not.toBeNull();
    expect(hasLearnedLoss(value)).toBe(true);
    expect(value?.lossSeconds).toBe(34.5);
  });

  it("never turns a thin sample into a number", () => {
    const value = mapLearnedPitLoss({ source: "insufficient", samples: 2, laneSeconds: 46, lossSeconds: null });
    expect(value).not.toBeNull();
    expect(hasLearnedLoss(value)).toBe(false);
    expect(value?.lossSeconds).toBeNull();
  });

  it("drops a personal answer without a loss", () => {
    expect(mapLearnedPitLoss({ source: "personal", samples: 5, lossSeconds: null })).toBeNull();
    expect(mapLearnedPitLoss({ source: "personal", samples: 5, lossSeconds: -1 })).toBeNull();
  });

  it("ignores unknown or malformed answers", () => {
    expect(mapLearnedPitLoss(null)).toBeNull();
    expect(mapLearnedPitLoss("personal")).toBeNull();
    expect(mapLearnedPitLoss([])).toBeNull();
    expect(mapLearnedPitLoss({ source: "guessed", samples: 3 })).toBeNull();
    expect(mapLearnedPitLoss({ source: "none", samples: 0 }).source).toBe("none");
  });
});
