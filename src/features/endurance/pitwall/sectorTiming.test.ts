import { describe, expect, it } from "vitest";
import type { PaceCar, PaceHistory, PaceSectorBest, PaceSectorUpdate } from "../../../../supabase/functions/_shared/paceCapture";
import {
  buildSectorTimingIndex,
  describeSectorSlot,
  formatSectorDelta,
  parseSectorUpdate,
  sectorCountFromHistory,
  sectorDeltaTone,
  sectorNamespace,
} from "./sectorTiming";

/** Synthetische, contractvormige PACE-data. Geen claim over live nauwkeurigheid. */
const update = (over: Partial<PaceSectorUpdate> = {}): PaceSectorUpdate => ({
  id: "a",
  lap: 10,
  sectorIndex: 0,
  sectorCount: 3,
  seconds: 30,
  completedSessionTimeSeconds: 200,
  observedSessionTimeSeconds: 201,
  revision: 1,
  status: "verified",
  referenceSeconds: 30.5,
  ...over,
});

const car = (id: string, sectors: PaceSectorUpdate[], sectorBests: PaceSectorBest[] = []): PaceCar => ({
  id,
  laps: [],
  traces: [],
  sectors,
  sectorBests,
});

const history = (cars: PaceCar[]): PaceHistory => ({
  schemaRevision: 1,
  observedSessionId: "obs-a",
  segmentId: "seg-a",
  transportSessionId: "transport-a",
  updatedAt: new Date().toISOString(),
  cars,
});

describe("sectorTiming — contractvalidatie en retentie", () => {
  it("accepteert alleen de bevroren veldvorm en status/seconden-combinatie", () => {
    expect(parseSectorUpdate(update(), "a")).toMatchObject({ id: "a", seconds: 30, status: "verified" });
    expect(parseSectorUpdate(update({ status: "verified", seconds: null }), "a")).toBeNull();
    expect(parseSectorUpdate(update({ status: "invalidated", seconds: 30 }), "a")).toBeNull();
    expect(parseSectorUpdate(update({ status: "invalidated", seconds: null }), "a")).toMatchObject({ status: "invalidated", seconds: null });
    expect(parseSectorUpdate(update({ referenceSeconds: 0 }), "a")).toBeNull();
    expect(parseSectorUpdate(update({ sectorIndex: 3, sectorCount: 3 }), "a")).toBeNull();
    expect(parseSectorUpdate(update({ sectorCount: 17 }), "a")).toBeNull();
    expect(parseSectorUpdate(update({ revision: 1.5 }), "a")).toBeNull();
    expect(parseSectorUpdate(update({ id: "b" }), "a")).toBeNull();
    expect(parseSectorUpdate(update({ observedSessionTimeSeconds: 199 }), "a")).toBeNull();
  });

  it("kiest per sectorIndex eerst de hoogste lap en daarna de hoogste revision", () => {
    const index = buildSectorTimingIndex(history([car("a", [
      update({ sectorIndex: 0, lap: 10, revision: 5, seconds: 30 }),
      update({ sectorIndex: 0, lap: 11, revision: 1, seconds: 29.9 }),
      update({ sectorIndex: 0, lap: 10, revision: 9, seconds: 29.8 }),
    ])]), [{ id: "a", currentLap: 12 }]);
    const timing = index.get("a")!;
    expect(timing.slots[0]).toMatchObject({ lap: 11, seconds: 29.9, revision: 1 });
    expect(timing.lap).toBe(11);
    expect(timing.mixedLaps).toBe(false);
  });

  it("houdt een oude sector uit de vorige ronde apart en dimt die", () => {
    const timing = buildSectorTimingIndex(history([car("a", [
      update({ sectorIndex: 0, lap: 10, seconds: 29.8 }),
      update({ sectorIndex: 1, lap: 10, seconds: 31.1 }),
      update({ sectorIndex: 2, lap: 9, seconds: 32.4 }),
    ])]), [{ id: "a", currentLap: 11 }]).get("a")!;
    expect(timing.mixedLaps).toBe(true);
    expect(timing.slots[0]!.isPreviousLap).toBe(false);
    expect(timing.slots[1]!.isPreviousLap).toBe(false);
    expect(timing.slots[2]!.isPreviousLap).toBe(true);
  });

  it("weigert een sectorsprong van meerdere ronden vooruit", () => {
    const guarded = buildSectorTimingIndex(history([car("a", [
      update({ sectorIndex: 0, lap: 12, seconds: 29.8 }),
    ])]), [{ id: "a", currentLap: 9 }]);
    expect(guarded.has("a")).toBe(false);

    const oneFrameAhead = buildSectorTimingIndex(history([car("a", [
      update({ sectorIndex: 0, lap: 10, seconds: 29.8 }),
    ])]), [{ id: "a", currentLap: 9 }]);
    expect(oneFrameAhead.get("a")!.slots[0]!.lap).toBe(10);
  });

  it("berekent de delta tegen de bevroren vorige persoonlijke beste, niet tegen nul", () => {
    const timing = buildSectorTimingIndex(history([car("a", [
      update({ sectorIndex: 0, seconds: 29.8, referenceSeconds: 30, status: "provisional" }),
      update({ sectorIndex: 1, seconds: 30.2, referenceSeconds: 30 }),
      update({ sectorIndex: 2, seconds: 30, referenceSeconds: null }),
    ])]), [{ id: "a", currentLap: 11 }]).get("a")!;
    expect(timing.slots[0]!.deltaSeconds).toBeCloseTo(-0.2);
    expect(timing.slots[0]!.isPersonalBest).toBe(true);
    expect(formatSectorDelta(timing.slots[0]!.deltaSeconds)).toBe("-0.200");
    expect(sectorDeltaTone(timing.slots[0]!.deltaSeconds)).toBe("negative");
    expect(formatSectorDelta(timing.slots[1]!.deltaSeconds)).toBe("+0.200");
    expect(sectorDeltaTone(timing.slots[1]!.deltaSeconds)).toBe("positive");
    expect(timing.slots[2]!.deltaSeconds).toBeNull();
  });

  it("maakt alleen een geverifieerde, consistente sectorBests-waarde uit beeld paars", () => {
    const data = history([
      car("a", [update({ sectorIndex: 0, seconds: 29.8 })], [{ sectorIndex: 0, lap: 10, seconds: 29.8 }]),
      car("b", [update({ id: "b", sectorIndex: 0, seconds: 30.0 })], [{ sectorIndex: 0, lap: 10, seconds: 30.0 }]),
    ]);
    const both = buildSectorTimingIndex(data, [{ id: "a" }, { id: "b" }]);
    expect(both.get("a")!.slots[0]!.isSessionBest).toBe(true);
    expect(both.get("b")!.slots[0]!.isSessionBest).toBe(false);

    // Alleen auto a is in beeld: de beste van een niet-getoonde auto telt niet.
    const onlyA = buildSectorTimingIndex(data, [{ id: "a" }]);
    expect(onlyA.has("b")).toBe(false);
    expect(onlyA.get("a")!.slots[0]!.isSessionBest).toBe(true);

    // Best history die niet bij de getoonde geverifieerde tijd past, geeft geen paars.
    const inconsistent = history([car("a", [update({ sectorIndex: 0, seconds: 29.8 })], [{ sectorIndex: 0, lap: 10, seconds: 29.0 }])]);
    expect(buildSectorTimingIndex(inconsistent, [{ id: "a" }]).get("a")!.slots[0]!.isSessionBest).toBe(false);

    // Een auto in beeld zonder huidige sectorrijen maar met een snellere
    // geverifieerde best voorkomt dat een ander zich ten onrechte paars tooit.
    const unseenSectorRows = history([
      car("a", [update({ sectorIndex: 0, seconds: 29.8 })], [{ sectorIndex: 0, lap: 10, seconds: 29.8 }]),
      car("c", [], [{ sectorIndex: 0, lap: 9, seconds: 29.5 }]),
    ]);
    expect(buildSectorTimingIndex(unseenSectorRows, [{ id: "a" }, { id: "c" }]).get("a")!.slots[0]!.isSessionBest).toBe(false);
  });

  it("isoleert misvormde entries en laat ongeldige sectoren als streepje", () => {
    const timing = buildSectorTimingIndex(history([car("a", [
      update({ sectorIndex: 0, seconds: 29.8 }),
      update({ sectorIndex: 1, seconds: "kapot" as unknown as number }),
      update({ sectorIndex: 2, status: "invalidated", seconds: null }),
    ])]), [{ id: "a", currentLap: 11 }]).get("a")!;
    expect(timing.slots[0]!.seconds).toBe(29.8);
    expect(timing.slots[1]).toBeNull();
    expect(timing.slots[2]).toMatchObject({ status: "invalidated", seconds: null, deltaSeconds: null });
    expect(describeSectorSlot(timing.slots[2])).toContain("Ongeldig");
  });

  it("meldt de layout onafhankelijk van metriekleeftijd en weigert gemengde counts", () => {
    const six = buildSectorTimingIndex(history([car("a", [
      update({ sectorIndex: 0, sectorCount: 6 }),
      update({ sectorIndex: 1, sectorCount: 6, seconds: 20 }),
    ])]), [{ id: "a" }]);
    expect(six.get("a")!.sectorCount).toBe(6);
    expect(sectorCountFromHistory(history([car("a", [update()])]))).toBe(3);

    const mixed = history([car("a", [
      update({ sectorIndex: 0, sectorCount: 3 }),
      update({ sectorIndex: 0, sectorCount: 6, lap: 11, revision: 2 }),
    ])]);
    expect(buildSectorTimingIndex(mixed, [{ id: "a" }]).get("a")!.sectorCount).toBe(6);
    expect(sectorCountFromHistory(history([
      car("a", [update({ id: "a", sectorCount: 3 })]),
      car("b", [update({ id: "b", sectorCount: 6 })]),
    ]))).toBe(0);
  });

  it("geeft een unieke namespace en wist niets over een reset heen", () => {
    const data = history([]);
    expect(sectorNamespace(data)).toBe("transport-a\u0000obs-a\u0000seg-a");
    expect(sectorNamespace({ ...data, segmentId: "seg-b" })).not.toBe(sectorNamespace(data));
    expect(sectorNamespace(null)).toBeNull();
  });
});
