import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PaceCar, PaceHistory, PaceSectorUpdate } from "../../../../supabase/functions/_shared/paceCapture";
import type { SharedRace, SharedSectorCar } from "@/features/personal-pitwall/share";
import { sharedViewerV3 } from "@/features/personal-pitwall/share";
import { PremiumTimingPanel } from "./test-premium/PremiumTimingPanel";
import { StandingsWidget } from "./StandingsWidget";
import { deriveStandings } from "./standings";
import type { V3Normalized, V3Opponent } from "./pitwallHelpers";

const SESSION = "transport-structural-1";

const opp = (id: string, carNumber: string, position: number, lap: number): V3Opponent => ({
  id,
  carNumber,
  driverName: `Driver ${carNumber}`,
  teamName: `Team ${carNumber}`,
  carClass: "GT3",
  position,
  classPosition: position,
  lap,
  lastLapSeconds: 121.7,
  bestLapSeconds: 121.2,
  connected: true,
  isPlayer: id === "player",
  gapToPlayerSeconds: position - 1,
});

const metric = (id: string, sectorLap: number | null, observed: number, sectors: number[] | null) => {
  const sum = sectors ? sectors.reduce((a, b) => a + b, 0) : 121.7;
  return {
    id,
    observedSessionTimeSeconds: observed,
    lastLapSeconds: sum,
    bestLapSeconds: Math.max(1, sum - 2),
    lastLapSectorSeconds: sectors,
    bestLapSectorSeconds: null,
    bestSectorSeconds: null,
    bestLapDeltaToFieldBestSeconds: null,
    bestLapDeltaToPlayerSeconds: null,
    lapValid: true,
    lapHighPrecision: null,
    trackPositionPercentRaw: null,
    sectorMismatchCount: 0,
    sectorCount: 3,
    sectorLap,
  };
};

const paceCar = (
  id: string,
  sectorLap: number | null,
  observed: number,
  sectors: number[] | null,
  live: PaceSectorUpdate[] = [],
): PaceCar => ({
  id,
  laps: [],
  traces: [],
  sectors: live,
  sectorBests: [],
  metrics: metric(id, sectorLap, observed, sectors) as PaceCar["metrics"],
});

const liveUpdate = (id: string, lap: number, sectorIndex: number, seconds: number): PaceSectorUpdate => ({
  id,
  lap,
  sectorIndex,
  sectorCount: 3,
  seconds,
  completedSessionTimeSeconds: 500 + lap * 30 + sectorIndex * 1.2,
  observedSessionTimeSeconds: 500 + lap * 30 + sectorIndex * 1.2 + 0.4,
  revision: 1,
  status: "verified",
  referenceSeconds: null,
});

const FIELD: V3Opponent[] = [
  opp("player", "134", 1, 5),
  opp("leroy", "103", 2, 5),
  opp("bart", "128", 3, 2),
  opp("albert", "151", 4, 3),
  opp("f0820", "77", 5, 4),
];

const frame = ({
  sessionTime,
  cars,
  opponents = FIELD,
  transport = SESSION,
}: {
  sessionTime: number;
  cars: PaceCar[];
  opponents?: V3Opponent[];
  transport?: string;
}): V3Normalized => ({
  transportSessionId: transport,
  identity: { trackId: 596, trackName: "Spa", trackConfig: "Full Course" },
  capturedAt: new Date().toISOString(),
  session: { sessionTimeSeconds: sessionTime },
  timing: { lastLapTimeSeconds: 121.7, bestLapTimeSeconds: 121.2, completedLaps: 5 },
  opponents,
  paceHistory: {
    schemaRevision: 1,
    observedSessionId: "obs-structural",
    segmentId: "seg-structural",
    transportSessionId: transport,
    updatedAt: new Date().toISOString(),
    cars,
  } as PaceHistory,
});

const fullField = (sessionTime: number) =>
  frame({
    sessionTime,
    cars: [
      paceCar("player", 4, sessionTime - 1, [40.1, 40.2, 40.3]),
      paceCar("leroy", 4, sessionTime - 2, [35.503, 52.35, 33.853]),
      paceCar("bart", 1, sessionTime - 80, [38.1, 40.2, 43.1]),
      paceCar("albert", 2, sessionTime - 40, [39.1, 41.2, 44.1]),
      paceCar("f0820", 3, sessionTime - 3, [36.5, 37.5, 38.5]),
    ],
  });

const panel = (v3: V3Normalized, contextKey = "device|session") => (
  <PremiumTimingPanel
    v3={v3}
    standings={deriveStandings(v3, 40)}
    ownCarLabel="Jaimy"
    ownCarNumber="134"
    live
    contextKey={contextKey}
    motionEnabled={false}
  />
);

/** Dezelfde frames als de owner-route, maar via de publieke sectorprojectie. */
const sharedBoard = (source: V3Normalized, track = { name: "Spa", config: "Full Course" }): SharedRace => ({
  ok: true,
  created_at: "2026-11-21T18:00:00.000Z",
  expires_at: "2026-11-21T20:00:00.000Z",
  updated_at: new Date().toISOString(),
  track,
  session: { driver: "Jaimy", car: "GT3", state: "racing" },
  v3: {
    identity: source.identity,
    transportSessionId: source.transportSessionId,
    capturedAt: source.capturedAt,
    session: source.session,
    timing: source.timing,
    opponents: source.opponents,
  },
  sectors: {
    available: true,
    reason: null,
    sectorCount: 3,
    cars: (source.paceHistory?.cars ?? []).map((car) => ({
      id: car.id,
      sectorCount: 3,
      sectors: car.sectors as SharedSectorCar["sectors"],
      sectorBests: car.sectorBests ?? [],
      metrics: car.metrics,
    })),
  },
  laps: [],
  pace: null,
});

const rowOf = (container: HTMLElement, id: string) =>
  container.querySelector(`[data-timing-row-id="${id}"]`);

const cellOf = (container: HTMLElement, id: string, sector: number) =>
  rowOf(container, id)?.querySelector(`td[data-sector-index="${sector}"]`) ?? null;

const value = (container: HTMLElement, id: string, sector = 0) => {
  const cell = cellOf(container, id, sector);
  if (!cell) return null;
  const explicit = cell.querySelector("[data-sector-value]")?.textContent;
  if (explicit) return explicit;
  return cell.textContent?.match(/\d+\.\d{3}/)?.[0] ?? null;
};

describe("sector continuity — identity, merge and live-slot edges", () => {
  it("keeps verified sectors when one API snapshot transiently loses track identity", () => {
    const view = render(panel(fullField(600)));
    expect(value(view.container, "leroy", 0)).toBe("35.503");
    expect(value(view.container, "f0820", 2)).toBe("38.500");

    // A partial projector/API snapshot in the same transport session: no
    // track block and only the player's pace car. This is not a track change.
    const partial = fullField(601);
    partial.identity = {};
    partial.paceHistory!.cars = [paceCar("player", 4, 600, [40.1, 40.2, 40.3])];
    view.rerender(panel(partial));
    expect(value(view.container, "leroy", 0)).toBe("35.503");
    expect(value(view.container, "f0820", 2)).toBe("38.500");

    // The next complete frame restores live updates without a flash of empty rows.
    view.rerender(panel(fullField(602)));
    expect(value(view.container, "leroy", 0)).toBe("35.503");
  });

  it("shows a verified new S1 immediately and keeps older S2/S3 with their own R", () => {
    const base = fullField(600);
    const view = render(panel(base));
    expect(value(view.container, "f0820", 0)).toBe("36.500");
    expect(value(view.container, "f0820", 1)).toBe("37.500");
    expect(value(view.container, "f0820", 2)).toBe("38.500");

    // S1 of the next lap arrived, S2/S3 did not. The verified new S1 is not
    // delayed; S2/S3 stay with their own explicit R3 label.
    const partial = fullField(601);
    const f0820 = partial.paceHistory!.cars.find((car) => car.id === "f0820")!;
    f0820.sectors = [liveUpdate("f0820", 4, 0, 36.2)];
    f0820.metrics = metric("f0820", 3, 601, [36.5, 37.5, 38.5]) as PaceCar["metrics"];
    view.rerender(panel(partial));
    expect(value(view.container, "f0820", 0)).toBe("36.200");
    expect(value(view.container, "f0820", 1)).toBe("37.500");
    expect(value(view.container, "f0820", 2)).toBe("38.500");
    expect(cellOf(view.container, "f0820", 0)?.querySelector("[data-sector-status='verified']")).not.toBeNull();
    expect(cellOf(view.container, "f0820", 1)?.querySelector('[data-sector-lap-mark="3"]')).not.toBeNull();
    expect(cellOf(view.container, "f0820", 1)?.querySelector("[data-sector-previous='true']")).not.toBeNull();
    expect(view.container.querySelector('[data-timing-row-id="f0820"]')?.getAttribute("data-sector-mixed-laps")).toBe("true");

    // Once the live row is complete, all three new values replace the cached lap.
    const complete = fullField(602);
    const next = complete.paceHistory!.cars.find((car) => car.id === "f0820")!;
    next.sectors = [0, 1, 2].map((index) => liveUpdate("f0820", 4, index, 36.2 + index));
    next.metrics = metric("f0820", 4, 602, [36.2, 37.2, 38.2]) as PaceCar["metrics"];
    view.rerender(panel(complete));
    expect(value(view.container, "f0820", 0)).toBe("36.200");
    expect(value(view.container, "f0820", 1)).toBe("37.200");
    expect(value(view.container, "f0820", 2)).toBe("38.200");
    expect(cellOf(view.container, "f0820", 0)?.querySelector("[data-sector-status]")).not.toBeNull();
  });

  it("composes a mixed-lap live row per sector with explicit R labels", () => {
    const base = fullField(600);
    const view = render(panel(base));

    const mixed = fullField(601);
    const f0820 = mixed.paceHistory!.cars.find((car) => car.id === "f0820")!;
    // Two sectors from R4 and one from R3: a valid live row, but not one lap.
    f0820.sectors = [
      liveUpdate("f0820", 4, 0, 36.2),
      { ...liveUpdate("f0820", 3, 1, 37.5), revision: 2 },
      { ...liveUpdate("f0820", 3, 2, 38.5), revision: 2 },
    ];
    view.rerender(panel(mixed));
    expect(value(view.container, "f0820", 0)).toBe("36.200");
    expect(value(view.container, "f0820", 1)).toBe("37.500");
    expect(value(view.container, "f0820", 2)).toBe("38.500");
    expect(cellOf(view.container, "f0820", 0)?.textContent).toContain("R4");
    expect(cellOf(view.container, "f0820", 1)?.textContent).toContain("R3");
    expect(view.container.querySelector('[data-timing-row-id="f0820"]')?.getAttribute("data-sector-mixed-laps")).toBe("true");
  });

  it("never resurrects a lap after a confirmed invalidation", () => {
    const base = fullField(600);
    const f0820 = base.paceHistory!.cars.find((car) => car.id === "f0820")!;
    f0820.sectors = [0, 1, 2].map((index) => liveUpdate("f0820", 3, index, 36.5 + index));
    f0820.metrics = metric("f0820", 3, 600, [36.5, 37.5, 38.5]) as PaceCar["metrics"];
    const view = render(panel(base));
    expect(value(view.container, "f0820", 0)).toBe("36.500");

    // Confirmed invalidation of exactly that lap: the cached row must go.
    const invalid = fullField(601);
    const invalidCar = invalid.paceHistory!.cars.find((car) => car.id === "f0820")!;
    invalidCar.sectors = [
      { ...liveUpdate("f0820", 3, 0, 36.5), status: "invalidated", seconds: null, revision: 2 },
    ];
    invalidCar.metrics = metric("f0820", 3, 601, [36.5, 37.5, 38.5]) as PaceCar["metrics"];
    view.rerender(panel(invalid));
    expect(value(view.container, "f0820", 0)).toBeNull();
    expect(cellOf(view.container, "f0820", 0)?.querySelector("[data-sector-status='invalidated']")).not.toBeNull();

    // A later older/legacy frame still carries the same lap. It must not
    // resurrect the value; the invalidation is remembered for this session.
    const older = fullField(602);
    const olderCar = older.paceHistory!.cars.find((car) => car.id === "f0820")!;
    olderCar.sectors = [];
    olderCar.metrics = metric("f0820", 3, 602, [36.5, 37.5, 38.5]) as PaceCar["metrics"];
    view.rerender(panel(older));
    expect(value(view.container, "f0820", 0)).toBeNull();
    expect(view.container.textContent).not.toContain("36.500");
  });

  it("still clears on a confirmed track change and a share/device context switch", () => {
    const view = render(panel(fullField(600), "device-a|share-a"));
    expect(value(view.container, "leroy", 0)).toBe("35.503");

    const otherTrack = fullField(601);
    otherTrack.identity = { trackId: 597, trackName: "Monza", trackConfig: "Full Course" };
    otherTrack.paceHistory!.cars = [paceCar("player", 4, 600, [40.1, 40.2, 40.3])];
    view.rerender(panel(otherTrack, "device-a|share-a"));
    expect(value(view.container, "leroy", 0)).toBeNull();

    // A new share context starts empty. A sparse poll in that context must not
    // resurrect the previous share's cache.
    const sparse = fullField(602);
    sparse.paceHistory!.cars = [paceCar("player", 4, 601, [40.1, 40.2, 40.3])];
    view.rerender(panel(sparse, "device-a|share-b"));
    expect(value(view.container, "leroy", 0)).toBeNull();

    // The same context's own complete frame is valid data, not a resurrection.
    view.rerender(panel(fullField(603), "device-a|share-b"));
    expect(value(view.container, "leroy", 0)).toBe("35.503");
  });

  it("keeps the classic and premium tables in agreement after a partial poll", () => {
    const base = fullField(600);
    const view = render(panel(base));
    const classic = render(
      <StandingsWidget
        v3={base}
        standings={deriveStandings(base, 40)}
        ownCarLabel="Jaimy"
        ownCarNumber="134"
      />,
    );
    expect(classic.container.textContent).toContain("35.503");

    const partial = fullField(601);
    partial.paceHistory!.cars = [paceCar("player", 4, 600, [40.1, 40.2, 40.3])];
    view.rerender(panel(partial));
    classic.rerender(
      <StandingsWidget
        v3={partial}
        standings={deriveStandings(partial, 40)}
        ownCarLabel="Jaimy"
        ownCarNumber="134"
      />,
    );
    expect(classic.container.textContent).toContain("35.503");
    expect(value(view.container, "leroy", 0)).toBe("35.503");
  });

  it("keeps the shared projection stable through the same transient frame", () => {
    const full = fullField(600);
    const view = render(panel(sharedViewerV3(sharedBoard(full)), "share|a"));
    expect(value(view.container, "leroy", 0)).toBe("35.503");

    const partial = fullField(601);
    partial.identity = {};
    partial.paceHistory!.cars = [paceCar("player", 4, 600, [40.1, 40.2, 40.3])];
    view.rerender(panel(sharedViewerV3(sharedBoard(partial)), "share|a"));
    expect(value(view.container, "leroy", 0)).toBe("35.503");
    expect(value(view.container, "f0820", 2)).toBe("38.500");

    // A new share token is a different world: no values from the old share.
    const sparse = fullField(602);
    sparse.paceHistory!.cars = [paceCar("player", 4, 601, [40.1, 40.2, 40.3])];
    view.rerender(panel(sharedViewerV3(sharedBoard(sparse)), "share|b"));
    expect(value(view.container, "leroy", 0)).toBeNull();
  });
});
