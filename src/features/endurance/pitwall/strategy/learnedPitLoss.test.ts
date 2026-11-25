import { describe, expect, it } from "vitest";
import { hasLearnedLoss, mapLearnedPitLoss, pickPitLossDisplay } from "./learnedPitLoss";

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

  it("keeps the circuit median separate and only fills the gap", () => {
    const shared = { source: "circuit", samples: 6, laneSeconds: 49, stretchSeconds: 12.45, lossSeconds: 36.55 };
    const ownNone = mapLearnedPitLoss({ source: "none", samples: 0, circuit: shared });
    expect(pickPitLossDisplay(ownNone)).toEqual({ kind: "circuit", seconds: 36.55, samples: 6 });

    const ownThin = mapLearnedPitLoss({ source: "insufficient", samples: 2, circuit: shared });
    expect(pickPitLossDisplay(ownThin)).toEqual({ kind: "circuit", seconds: 36.55, samples: 6 });

    const own = mapLearnedPitLoss({
      source: "personal", samples: 4, stretchSeconds: 12.5, lossSeconds: 34.5, circuit: shared,
    });
    expect(pickPitLossDisplay(own)).toEqual({ kind: "personal", seconds: 34.5, samples: 4 });

    const thinCircuit = mapLearnedPitLoss({ source: "none", samples: 0, circuit: { source: "none", samples: 3, lossSeconds: null } });
    expect(pickPitLossDisplay(thinCircuit)).toBeNull();
    expect(pickPitLossDisplay(null)).toBeNull();
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
