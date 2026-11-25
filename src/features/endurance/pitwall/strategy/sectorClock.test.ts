import { describe, expect, it } from "vitest";
import { mapSectorClock } from "./sectorClock";

describe("mapSectorClock", () => {
  it("leest een geldige meting", () => {
    const clock = mapSectorClock({ index: 2, count: 3, elapsedSeconds: 14.7, progressPct: 41.3, learned: true });
    expect(clock).toEqual({ index: 2, count: 3, elapsedSeconds: 14.7, progressPct: 41.3, learned: true });
  });

  it("weigert onvolledige of onmogelijke metingen", () => {
    expect(mapSectorClock(null)).toBeNull();
    expect(mapSectorClock({ index: 2, count: 3 })).toBeNull();
    expect(mapSectorClock({ index: 4, count: 3, elapsedSeconds: 1, progressPct: 10 })).toBeNull();
    expect(mapSectorClock({ index: 1, count: 1, elapsedSeconds: 1, progressPct: 10 })).toBeNull();
    expect(mapSectorClock({ index: 1, count: 3, elapsedSeconds: -1, progressPct: 10 })).toBeNull();
    expect(mapSectorClock({ index: 1, count: 3, elapsedSeconds: 5, progressPct: 140 })).toBeNull();
    expect(mapSectorClock("sector")).toBeNull();
  });

  it("zet learned alleen op true als het echt true is", () => {
    expect(mapSectorClock({ index: 1, count: 3, elapsedSeconds: 5, progressPct: 10 })?.learned).toBe(false);
    expect(mapSectorClock({ index: 1, count: 3, elapsedSeconds: 5, progressPct: 10, learned: "ja" })?.learned).toBe(false);
  });
});
