import { beforeEach, describe, expect, it, vi } from "vitest";
import { snapshotIsOlder } from "./snapshotOrder";
import {
  SECTOR_TRACE_LIMIT,
  carRef,
  resetSectorTraceForTests,
  sectorTraceEnabled,
  traceSector,
} from "./sectorTrace";

const at = (seconds: number) => new Date(Date.UTC(2026, 10, 21, 12, 0, seconds)).toISOString();

describe("poll ordering", () => {
  it("rejects a lower sequence in the same session", () => {
    expect(snapshotIsOlder({ sessionId: "s", sequence: 10, capturedAt: at(10) }, { sessionId: "s", sequence: 9, capturedAt: at(11) })).toBe(true);
    expect(snapshotIsOlder({ sessionId: "s", sequence: 10 }, { sessionId: "s", sequence: 11 })).toBe(false);
  });

  it("uses captured time across a session restart, where sequence restarts", () => {
    expect(snapshotIsOlder({ sessionId: "a", sequence: 900, capturedAt: at(10) }, { sessionId: "b", sequence: 2, capturedAt: at(9) })).toBe(true);
    expect(snapshotIsOlder({ sessionId: "a", sequence: 900, capturedAt: at(10) }, { sessionId: "b", sequence: 2, capturedAt: at(11) })).toBe(false);
  });

  it("does not reject when order is unknown", () => {
    expect(snapshotIsOlder({ sessionId: "s" }, { sessionId: "s" })).toBe(false);
    expect(snapshotIsOlder(null, { sessionId: "s", sequence: 1 })).toBe(false);
    expect(snapshotIsOlder({ sessionId: "s", sequence: 5 }, null)).toBe(false);
  });
});

describe("sector diagnostic trace", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, "", "/pitwall/");
    resetSectorTraceForTests();
  });

  it("is off by default and writes nothing", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    expect(sectorTraceEnabled()).toBe(false);
    traceSector("retained_reset", { scope: "device|session", detail: { reason: "identity" } });
    expect(window.__pitwallSectorTrace).toBeUndefined();
    expect(debug).not.toHaveBeenCalled();
    debug.mockRestore();
  });

  it("is opt-in, bounded and strips direct identifiers", () => {
    window.history.replaceState({}, "", "/pitwall/?pitwallTrace=1");
    resetSectorTraceForTests();
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    expect(sectorTraceEnabled()).toBe(true);

    const ref = carRef("Leroy Bolkestein");
    expect(ref).toMatch(/^[0-9a-f]{8}$/);
    expect(ref).not.toContain("Leroy");

    traceSector("live_partial_ignored", {
      scope: "device|session",
      car: ref,
      lap: 4,
      detail: { slots: 1, count: 3, mixed_laps: false, status: "verified", name: "Leroy Bolkestein" },
    });
    const events = window.__pitwallSectorTrace!.dump();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ code: "live_partial_ignored", car: ref, lap: 4 });
    expect(JSON.stringify(events[0])).not.toContain("Leroy");
    expect(debug).toHaveBeenCalledTimes(1);

    for (let index = 0; index < SECTOR_TRACE_LIMIT + 25; index += 1) {
      traceSector("tick", { scope: "device|session", detail: { index } });
    }
    expect(window.__pitwallSectorTrace!.dump()).toHaveLength(SECTOR_TRACE_LIMIT);
    debug.mockRestore();
  });
});
