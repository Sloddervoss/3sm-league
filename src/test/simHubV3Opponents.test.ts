import { describe, expect, it } from "vitest";
import { exactKeysAllowExtra, MaxOpponentsPerSnapshot, parseOpponents, type V3Opponent } from "../../supabase/functions/_shared/opponents.ts";

describe("0.4.1 opponent parsing (opponents.ts)", () => {
  const valid = (over: Partial<V3Opponent> = {}): V3Opponent => ({
    id: "car1", carNumber: "123", driverName: "A", teamName: "T1", carClass: "GT3", carClassId: "gt3",
    position: 1, classPosition: 1, lap: 4, lapDistancePct: 0.5, gapToPlayerSeconds: 0, gapToLeaderSeconds: 0,
    lastLapSeconds: 129.0, bestLapSeconds: 128.0, inPit: false, speedKph: 210, connected: true, isPlayer: true,
    ...over,
  });

  it("returns null for absent/undefined opponents (0.3.16/0.4.0 compat)", () => {
    expect(parseOpponents(null)).toBeNull();
    expect(parseOpponents(undefined)).toBeNull();
  });

  it("parses a bounded opponent array, keeping identity + fields", () => {
    const out = parseOpponents([valid()]);
    expect(out).toHaveLength(1);
    expect(out![0].id).toBe("car1");
    expect(out![0].lapDistancePct).toBe(0.5);
    expect(out![0].connected).toBe(true);
  });

  it("rejects array > cap (" + MaxOpponentsPerSnapshot + ", bounded)", () => {
    const many = Array.from({ length: MaxOpponentsPerSnapshot + 1 }, (_, i) => valid({ id: `c${i}` }));
    expect(() => parseOpponents(many)).toThrow(/cap/);
  });

  it("rejects opponent missing stable id", () => {
    const bad = valid(); (bad as any).id = undefined;
    expect(() => parseOpponents([bad])).toThrow(/id is invalid/);
  });

  it("rejects NaN / Infinity / out-of-range lapDistancePct", () => {
    expect(() => parseOpponents([valid({ lapDistancePct: NaN })])).toThrow();
    expect(() => parseOpponents([valid({ lapDistancePct: 1.5 })])).toThrow();
    expect(() => parseOpponents([valid({ gapToLeaderSeconds: Infinity })])).toThrow();
    expect(() => parseOpponents([valid({ speedKph: Number.NaN })])).toThrow();
  });

  it("normalizes sentinel gaps/positions to null; rejects real out-of-range", () => {
    // -1/0 are iRacing sentinels -> null (not errors)
    expect(parseOpponents([valid({ gapToPlayerSeconds: -1 })])![0].gapToPlayerSeconds).toBeNull();
    expect(parseOpponents([valid({ position: 0 })])![0].position).toBeNull();
    // genuine out-of-range still rejected
    expect(() => parseOpponents([valid({ position: 1001 })])).toThrow();
    expect(() => parseOpponents([valid({ gapToLeaderSeconds: 90000 })])).toThrow();
  });

  it("exactKeysAllowExtra permits optional opponents but rejects unknown root keys", () => {
    const root: Record<string, unknown> = { protocolVersion: 3, sequence: 1, opponents: [] };
    expect(() => exactKeysAllowExtra(root, ["protocolVersion", "sequence"], ["opponents"], "payload")).not.toThrow();
    expect(() => exactKeysAllowExtra(root, ["protocolVersion", "sequence"], [], "payload")).toThrow(/unknown/);
    expect(() => exactKeysAllowExtra({ sequence: 1 }, ["protocolVersion", "sequence"], [], "payload")).toThrow(/missing/);
  });
});