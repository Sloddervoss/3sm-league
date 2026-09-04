import { describe, expect, it } from "vitest";
import { deriveStandings, renderGap, renderPosition } from "../features/endurance/pitwall/standings";
import type { V3Normalized, V3Opponent } from "../features/endurance/pitwall/pitwallHelpers";

const opp = (o: Partial<V3Opponent> & { id: string }): V3Opponent => ({
  connected: true, isPlayer: false, ...o,
});

const mkV3 = (opponents: V3Opponent[], position?: number, classPosition?: number): V3Normalized => ({
  position: position != null ? { position, classPosition } : undefined,
  opponents,
});

describe("0.4.2 standings derivation", () => {
  it("returns noData + empty when no opponents array", () => {
    const d = deriveStandings({});
    expect(d.noData).toBe(true);
    expect(d.rows).toEqual([]);
    expect(d.ahead).toBeNull();
    expect(d.behind).toBeNull();
  });

  it("sorts rows by overall position asc, player first when tied", () => {
    const d = deriveStandings(mkV3([
      opp({ id: "b", position: 2 }),
      opp({ id: "player", position: 2, isPlayer: true }),
      opp({ id: "a", position: 1 }),
    ], 2));
    expect(d.rows.map((r) => r.id)).toEqual(["a", "player", "b"]);
    expect(d.rows[1].isPlayer).toBe(true);
  });

  it("selects directly ahead (nearest lower position) and behind (nearest higher position)", () => {
    const d = deriveStandings(mkV3([
      opp({ id: "p1", position: 1 }),
      opp({ id: "p5", position: 5 }),
      opp({ id: "player", position: 3, isPlayer: true }),
      opp({ id: "p2", position: 2 }),
      opp({ id: "p7", position: 7 }),
    ], 3));
    expect(d.ahead?.id).toBe("p2");
    expect(d.behind?.id).toBe("p5");
  });

  it("excludes disconnected and player rows from ahead/behind", () => {
    const d = deriveStandings(mkV3([
      opp({ id: "p1", position: 2 }),
      opp({ id: "disc", position: 2, connected: false }),
      opp({ id: "player", position: 3, isPlayer: true }),
      opp({ id: "p5", position: 5 }),
    ], 3));
    expect(d.ahead?.id).toBe("p1");
    expect(d.behind?.id).toBe("p5");
  });

  it("returns null ahead/behind when positions missing or none relevant", () => {
    const d = deriveStandings(mkV3([opp({ id: "x", connected: true })], 3));
    expect(d.ahead).toBeNull();
    expect(d.behind).toBeNull();
  });

  it("bounds rows to cap + player (no >40 from 0.4.1 ingest)", () => {
    const many = Array.from({ length: 45 }, (_, i) => opp({ id: `c${i}`, position: i + 1 }));
    const d = deriveStandings(mkV3(many, 1));
    expect(d.rows.length).toBeLessThanOrEqual(41);
  });

  it("renderGap / renderPosition handle null", () => {
    expect(renderGap(null)).toBe("—");
    expect(renderPosition(null)).toBe("—");
    expect(renderGap(opp({ id: "a", gapToPlayerSeconds: 2.1 }))).toBe("+2.1s");
    expect(renderPosition(6)).toBe("6");
  });

  it("own overall position prefers v3.position over player snapshot", () => {
    const d = deriveStandings(mkV3([opp({ id: "player", position: 10, isPlayer: true })], 6, 2));
    expect(d.overallPosition).toBe(6);
    expect(d.classPosition).toBe(2);
  });

  it("applies closing-rate trends to ahead/behind from the trends map", () => {
    const d = deriveStandings(mkV3([
      opp({ id: "p2", position: 2 }),
      opp({ id: "player", position: 3, isPlayer: true }),
      opp({ id: "p5", position: 5 }),
    ], 3), 40, { p2: 0.2, p5: -0.1 });
    expect(d.ahead?.id).toBe("p2");
    expect(d.aheadTrend).toBe(0.2);
    expect(d.behind?.id).toBe("p5");
    expect(d.behindTrend).toBe(-0.1);
  });

  it("trends default to null when no trends map provided", () => {
    const d = deriveStandings(mkV3([
      opp({ id: "p2", position: 2 }),
      opp({ id: "player", position: 3, isPlayer: true }),
      opp({ id: "p5", position: 5 }),
    ], 3));
    expect(d.aheadTrend).toBeNull();
    expect(d.behindTrend).toBeNull();
  });
});