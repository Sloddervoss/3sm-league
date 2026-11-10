import { describe, expect, it } from "vitest";
import {
  initialTimingState,
  reduceTimingTransitions,
  type TimingSnapshotRow,
  type TimingTransitionState,
} from "./timingTransitions";

const row = (id: string, position: number | null, lap: number | null = 10): TimingSnapshotRow => ({
  id,
  position,
  lap,
});

const snapshot = (
  state: TimingTransitionState,
  rows: TimingSnapshotRow[],
  overrides: { contextKey?: string; live?: boolean; gap?: boolean } = {},
) =>
  reduceTimingTransitions(state, {
    type: "snapshot",
    contextKey: overrides.contextKey ?? "device-1|session-a",
    rows,
    live: overrides.live ?? true,
    gap: overrides.gap ?? false,
  });

describe("timing-transities — alleen echte positiewijzigingen per auto-id", () => {
  it("eerste snapshot is een ijkpunt zonder beweging of rondeflits", () => {
    const state = snapshot(initialTimingState(), [row("a", 1), row("b", 2)]);

    expect(state.armed).toBe(true);
    expect(state.moves).toEqual({});
    expect(state.lapFlash).toEqual({});
    expect(state.positions).toEqual({ a: 1, b: 2 });
  });

  it("meldt +1 als een auto een plaats wint en -1 als hij een plaats verliest", () => {
    const first = snapshot(initialTimingState(), [row("a", 2), row("b", 1)]);
    const second = snapshot(first, [row("a", 1), row("b", 2)]);

    expect(second.moves).toEqual({ a: 1, b: -1 });
    expect(second.lapFlash).toEqual({});
  });

  it("negeert een andere rijvolgorde of index zolang de positie per id gelijk blijft", () => {
    const first = snapshot(initialTimingState(), [row("a", 1), row("b", 2), row("c", 3)]);
    const shuffled = snapshot(first, [row("c", 3), row("a", 1), row("b", 2)]);

    expect(shuffled.moves).toEqual({});
  });

  it("negeert klassefilters: alleen posities tellen, geen row-index", () => {
    const first = snapshot(initialTimingState(), [row("gt3-a", 1), row("gt3-b", 2), row("lmp-a", 3)]);
    const filterWissel = snapshot(first, [row("lmp-a", 3), row("gt3-a", 1), row("gt3-b", 2)]);

    expect(filterWissel.moves).toEqual({});
  });

  it("houdt een meerplaatsige sprong eerlijk bij als +2/-2", () => {
    const first = snapshot(initialTimingState(), [row("a", 5), row("b", 1), row("c", 2)]);
    const second = snapshot(first, [row("a", 2), row("b", 3), row("c", 4)]);

    expect(second.moves).toEqual({ a: 3, b: -2, c: -2 });
  });

  it("claimt niets bij een nieuwe auto in de snapshot", () => {
    const first = snapshot(initialTimingState(), [row("a", 1)]);
    const second = snapshot(first, [row("a", 1), row("nieuw", 2)]);

    expect(second.moves).toEqual({});
    expect(second.positions.nieuw).toBe(2);
  });

  it("vergelijkt niet met een oude race na een contextwissel", () => {
    const first = snapshot(initialTimingState(), [row("a", 5)]);
    const nextRace = snapshot(first, [row("a", 1)], { contextKey: "device-2|session-b" });

    expect(nextRace.contextKey).toBe("device-2|session-b");
    expect(nextRace.moves).toEqual({});
    expect(nextRace.positions).toEqual({ a: 1 });
  });

  it("reset bij offline en ijk opnieuw bij reconnect, zonder oude beweging", () => {
    const first = snapshot(initialTimingState(), [row("a", 5)]);
    const offline = snapshot(first, [row("a", 5)], { live: false });

    expect(offline.armed).toBe(false);
    expect(offline.moves).toEqual({});
    expect(offline.resetReason).toBe("offline");

    const weerLive = snapshot(offline, [row("a", 1)]);
    expect(weerLive.armed).toBe(true);
    expect(weerLive.moves).toEqual({});
  });

  it("reset bij een datagat en vergeet daarna de oude positie", () => {
    const first = snapshot(initialTimingState(), [row("a", 5)]);
    const gap = snapshot(first, [row("a", 1)], { gap: true });
    expect(gap.armed).toBe(false);
    expect(gap.resetReason).toBe("gap");

    const naGat = snapshot(gap, [row("a", 1)]);
    expect(naGat.moves).toEqual({});
  });

  it("vergeet auto's die uit de snapshot verdwijnen, zodat een latere terugkeer geen oude move lekt", () => {
    const first = snapshot(initialTimingState(), [row("a", 5), row("b", 2)]);
    const zonderA = snapshot(first, [row("b", 2)]);
    const terug = snapshot(zonderA, [row("a", 1), row("b", 2)]);

    expect(terug.moves).toEqual({});
    expect(terug.positions).toEqual({ a: 1, b: 2 });
  });

  it("flitst alleen bij een echte rondeverhoging van één", () => {
    const first = snapshot(initialTimingState(), [row("a", 1, 10), row("b", 2, 10)]);
    const next = snapshot(first, [row("a", 1, 11), row("b", 2, 10)]);

    expect(next.lapFlash).toEqual({ a: 11 });
  });

  it("flitst niet bij de eerste meting of een gelijke ronde", () => {
    const first = snapshot(initialTimingState(), [row("a", 1, 10)]);
    expect(first.lapFlash).toEqual({});
    expect(snapshot(first, [row("a", 1, 10)]).lapFlash).toEqual({});
  });

  it("reset bij een onmogelijke ronde-sprong in plaats van te flitsen", () => {
    const first = snapshot(initialTimingState(), [row("a", 1, 10)]);
    const sprong = snapshot(first, [row("a", 1, 18)]);

    expect(sprong.armed).toBe(false);
    expect(sprong.lapFlash).toEqual({});
    expect(sprong.resetReason).toBe("lap-jump");
  });

  it("reset bij een teruglopende ronde (nieuwe sessie in dezelfde context)", () => {
    const first = snapshot(initialTimingState(), [row("a", 1, 10)]);
    const terug = snapshot(first, [row("a", 1, 3)]);

    expect(terug.armed).toBe(false);
    expect(terug.resetReason).toBe("lap-jump");
  });

  it("negeert ongeldige posities en rondes", () => {
    const first = snapshot(initialTimingState(), [
      row("a", 0, 10),
      row("b", -2, 10),
      row("c", null, 10),
      row("d", 4, -1),
    ]);
    expect(first.positions).toEqual({ d: 4 });
    expect(first.laps).toEqual({ a: 10, b: 10, c: 10 });

    const next = snapshot(first, [row("a", 1, 10), row("d", 4, 0)]);
    expect(next.moves).toEqual({});
  });

  it("reset bij een verborgen tab en ijk opnieuw bij terugkomst", () => {
    const first = snapshot(initialTimingState(), [row("a", 5)]);
    const hidden = reduceTimingTransitions(first, { type: "visibility", hidden: true });

    expect(hidden.armed).toBe(false);
    expect(hidden.resetReason).toBe("hidden");
    expect(snapshot(hidden, [row("a", 1)]).moves).toEqual({});
  });

  it("een expliciete reset wist de vergelijkingsbasis", () => {
    const first = snapshot(initialTimingState(), [row("a", 5)]);
    const reset = reduceTimingTransitions(first, { type: "reset", reason: "manual" });

    expect(reset.armed).toBe(false);
    expect(reset.positions).toEqual({});
    expect(reset.moves).toEqual({});
  });
});
