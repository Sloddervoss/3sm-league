import { describe, expect, it } from "vitest";
import { deriveClosingRate, formatClosingRate } from "../features/endurance/pitwall/closingRate";
import { OpponentHistory } from "../features/endurance/pitwall/opponentHistory";

const now = 1700000000;
const mk = (t: number, s: number) => ({ t, s });

describe("0.4.3 DEV closing-rate derivation (s/min, mirrors server)", () => {
  it("returns unreliable when fewer than min samples", () => {
    const r = deriveClosingRate([mk(now, 1), mk(now + 3, 2)]);
    expect(r.reliable).toBe(false);
    expect(r.closingRatePerMin).toBeNull();
  });

  it("computes positive (closing) when gap shrinks over time", () => {
    // gap 6 -> 1 over 50s: slope=-0.1 s/s, x60 negated => +6.0
    const r = deriveClosingRate([mk(now - 50, 6), mk(now - 30, 4), mk(now - 10, 2)]);
    expect(r.reliable).toBe(true);
    expect(r.closingRatePerMin).toBeGreaterThan(0);
  });

  it("computes negative (opening) when gap grows", () => {
    const r = deriveClosingRate([mk(now - 50, 1), mk(now - 30, 3), mk(now - 10, 5)]);
    expect(r.reliable).toBe(true);
    expect(r.closingRatePerMin).toBeLessThan(0);
  });

  it("returns ~0 for a flat gap", () => {
    const r = deriveClosingRate([mk(now - 50, 5), mk(now - 30, 5), mk(now - 10, 5)]);
    expect(r.reliable).toBe(true);
    expect(Math.abs(r.closingRatePerMin ?? 999)).toBeLessThan(0.01);
  });

  it("handles irregular timestamps and still fits a slope", () => {
    const r = deriveClosingRate([mk(now - 49, 6), mk(now - 31, 3), mk(now - 12, 1)]);
    expect(r.reliable).toBe(true);
    expect(r.closingRatePerMin).toBeGreaterThan(0);
  });

  it("returns null for NaN gaps (unreliable)", () => {
    const r = deriveClosingRate([mk(now, NaN), mk(now + 15, 2), mk(now + 30, 3)]);
    expect(r.reliable).toBe(false);
    expect(r.closingRatePerMin).toBeNull();
  });

  it("formats closing rate as s/min", () => {
    expect(formatClosingRate(0.3)).toBe("+0.30 s/min");
    expect(formatClosingRate(-0.2)).toBe("−0.20 s/min");
    expect(formatClosingRate(null)).toBe("—");
  });
});

describe("0.4.3 DEV OpponentHistory (bounded)", () => {
  it("records per-opponent samples and derives s/min trend after min window", () => {
    const h = new OpponentHistory();
    h.record([{ id: "p7", gapToPlayerSeconds: 6 }], now - 50);
    h.record([{ id: "p7", gapToPlayerSeconds: 3 }], now - 25);
    h.record([{ id: "p7", gapToPlayerSeconds: 1 }], now);
    expect(h.trendFor("p7")).not.toBeNull();
  });

  it("returns null for unrecorded opponent", () => {
    const h = new OpponentHistory();
    expect(h.trendFor("nobody")).toBeNull();
  });

  it("skips opponents with missing gap", () => {
    const h = new OpponentHistory();
    h.record([{ id: "x", gapToPlayerSeconds: null }], now);
    expect(h.trendFor("x")).toBeNull();
  });

  it("reset clears history", () => {
    const h = new OpponentHistory();
    h.record([{ id: "a", gapToPlayerSeconds: 1 }], now);
    h.reset();
    expect(h.trendFor("a")).toBeNull();
  });
});