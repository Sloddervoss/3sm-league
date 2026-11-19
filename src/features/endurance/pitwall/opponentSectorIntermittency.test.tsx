import { render, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PaceCar, PaceHistory, PaceSectorUpdate } from "../../../../supabase/functions/_shared/paceCapture";
import type { SharedRace } from "@/features/personal-pitwall/share";
import { sharedViewerV3 } from "@/features/personal-pitwall/share";
import { PremiumTimingPanel } from "./test-premium/PremiumTimingPanel";
import { StandingsWidget } from "./StandingsWidget";
import { RaceTelemetryStrip } from "./RaceTelemetryStrip";
import { useRetainedLapSectors } from "./useRetainedLapSectors";
import { deriveStandings } from "./standings";
import type { V3Normalized, V3Opponent } from "./pitwallHelpers";

const SESSION = "transport-live-1";

const opp = (
  id: string,
  carNumber: string,
  position: number,
  lap: number,
  over: Partial<V3Opponent> = {},
): V3Opponent => ({
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
  ...over,
});

const metric = (
  id: string,
  sectorLap: number | null,
  observed: number,
  sectors: number[] | null,
  over: Record<string, unknown> = {},
) => {
  const sum = sectors ? sectors.reduce((a, b) => a + b, 0) : 121.7;
  return {
    id,
    observedSessionTimeSeconds: observed,
    lastLapSeconds: sum,
    // Een beste ronde is per definitie niet langzamer dan de laatste ronde.
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
    ...over,
  };
};

const paceCar = (
  id: string,
  sectorLap: number | null,
  observed: number,
  sectors: number[] | null,
  live: PaceSectorUpdate[] = [],
  over: Record<string, unknown> = {},
): PaceCar => ({
  id,
  laps: [],
  traces: [],
  sectors: live,
  sectorBests: [],
  metrics: metric(id, sectorLap, observed, sectors, over) as PaceCar["metrics"],
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
  ...Array.from({ length: 11 }, (_, i) => opp(`car-${i}`, String(200 + i), i + 6, 5)),
];

const frame = ({
  sessionTime,
  cars,
  opponents = FIELD,
  transport = SESSION,
  track = { trackId: 596, trackName: "Spa", trackConfig: "Full Course" },
  segment = "seg-live",
}: {
  sessionTime: number;
  cars: PaceCar[];
  opponents?: V3Opponent[];
  transport?: string;
  track?: { trackId: number; trackName: string; trackConfig: string };
  segment?: string;
}): V3Normalized => ({
  transportSessionId: transport,
  identity: track,
  capturedAt: new Date().toISOString(),
  session: { sessionTimeSeconds: sessionTime },
  timing: { lastLapTimeSeconds: 121.7, bestLapTimeSeconds: 121.2, completedLaps: 5 },
  opponents,
  paceHistory: {
    schemaRevision: 1,
    observedSessionId: "obs-live",
    segmentId: segment,
    transportSessionId: transport,
    updatedAt: new Date().toISOString(),
    cars,
  } as PaceHistory,
});

const panel = (v3: V3Normalized, contextKey = "device|session", live = true) => (
  <PremiumTimingPanel
    v3={v3}
    standings={deriveStandings(v3, 40)}
    ownCarLabel="Jaimy"
    ownCarNumber="134"
    live={live}
    contextKey={contextKey}
    motionEnabled={false}
  />
);

const rowOf = (container: HTMLElement, id: string) =>
  container.querySelector(`[data-timing-row-id="${id}"]`);

const cellOf = (container: HTMLElement, id: string, sector: number) =>
  rowOf(container, id)?.querySelector(`td[data-sector-index="${sector}"]`) ?? null;

const cellText = (container: HTMLElement, id: string, sector = 0) => {
  const cell = cellOf(container, id, sector);
  return (cell?.textContent ?? "<no cell>").replace(/\s+/g, " ");
};

const value = (container: HTMLElement, id: string, sector = 0) => {
  const cell = cellOf(container, id, sector);
  if (!cell) return null;
  const explicit = cell.querySelector("[data-sector-value]")?.textContent;
  if (explicit) return explicit;
  return cell.textContent?.match(/\d+\.\d{3}/)?.[0] ?? null;
};

/** The 14-car snapshot from the field report: four pace cars, one full set. */
const snapshot718 = () =>
  frame({
    sessionTime: 600,
    cars: [
      paceCar("player", 4, 598, [40.1, 40.2, 40.3]),
      paceCar("leroy", 4, 597, null),
      paceCar("bart", 1, 519, null),
      paceCar("albert", 2, 559, null),
    ],
  });

/** seq 720: five full-lap series; Leroy R4, Bart R1, Albert R2, f0820 R3. */
const snapshot720 = () =>
  frame({
    sessionTime: 602,
    cars: [
      paceCar("player", 4, 601, [40.1, 40.2, 40.3]),
      paceCar("leroy", 4, 601, [35.503, 52.35, 33.853]),
      paceCar("bart", 1, 521, [38.1, 40.2, 43.1]),
      paceCar("albert", 2, 561, [39.1, 41.2, 44.1]),
      paceCar("f0820", 3, 600, [36.5, 37.5, 38.5]),
    ],
  });

/** seq 722: four full-lap series again; f0820's slot is refreshed mid-lap. */
const snapshot722 = () =>
  frame({
    sessionTime: 604,
    cars: [
      paceCar("player", 4, 603, [40.1, 40.2, 40.3]),
      paceCar("leroy", 4, 603, [35.503, 52.35, 33.853]),
      paceCar("bart", 1, 523, [38.1, 40.2, 43.1]),
      paceCar("albert", 2, 563, [39.1, 41.2, 44.1]),
      paceCar("f0820", 4, 604, null),
    ],
  });

describe("opponent sector intermittency — sparse PACE field", () => {
  it("keeps every car's verified lap through 4 -> 5 -> 4 full-lap series", () => {
    const view = render(panel(snapshot718()));
    expect(value(view.container, "player", 0)).toBe("40.100");
    expect(value(view.container, "leroy", 0)).toBeNull();

    view.rerender(panel(snapshot720()));
    expect(value(view.container, "leroy", 0)).toBe("35.503");
    expect(value(view.container, "f0820", 0)).toBe("36.500");

    view.rerender(panel(snapshot722()));
    // f0820's metric slot was refreshed mid-lap: the last proven lap stays.
    expect(value(view.container, "f0820", 0)).toBe("36.500");
    expect(value(view.container, "f0820", 1)).toBe("37.500");
    expect(value(view.container, "leroy", 0)).toBe("35.503");
    expect(value(view.container, "bart", 0)).toBe("38.100");
    expect(value(view.container, "albert", 0)).toBe("39.100");
    expect(cellText(view.container, "f0820")).toContain("R3");
  });

  it("shows a persisted completed lap whose metric is older than the 5s live gate", () => {
    const late = frame({
      sessionTime: 640,
      cars: [
        paceCar("player", 4, 638, [40.1, 40.2, 40.3]),
        // The rotation only refreshes this car every few seconds; the completed
        // lap is factual even though the observation is 14s old.
        paceCar("leroy", 4, 626, [35.503, 52.35, 33.853]),
      ],
    });
    const view = render(panel(late));
    expect(value(view.container, "leroy", 0)).toBe("35.503");
    expect(view.container.querySelector("table")?.getAttribute("data-sector-count")).toBe("3");

    // Same data reaches the KPI strip (own car) and the classic opponent table.
    const strip = render(<RaceTelemetryStrip v3={late} live />);
    expect(strip.container.textContent).toContain("40.100");
    expect(strip.container.querySelector('[data-sector-count="3"]')).not.toBeNull();
    const classic = render(
      <StandingsWidget v3={late} standings={deriveStandings(late, 40)} ownCarLabel="Jaimy" ownCarNumber="134" />,
    );
    expect(classic.container.textContent).toContain("35.503");
  });

  it("keeps the lap when the row has already advanced past the series lap", () => {
    const lagging = frame({
      sessionTime: 660,
      cars: [
        paceCar("player", 4, 658, [40.1, 40.2, 40.3]),
        // Fresh observation, but the row's lap counter is already two ahead of
        // the completed lap in the sparse metric slot.
        paceCar("leroy", 4, 658, [35.503, 52.35, 33.853]),
      ],
      opponents: FIELD.map((o) => (o.id === "leroy" ? { ...o, lap: 6 } : o)),
    });
    const view = render(panel(lagging));
    expect(value(view.container, "leroy", 0)).toBe("35.503");
    const mark = cellOf(view.container, "leroy", 0)?.querySelector("[data-sector-lap]");
    expect(mark?.getAttribute("data-sector-lap")).toBe("4");
    expect(mark?.getAttribute("data-sector-previous")).toBe("true");
  });

  it("survives a 14 -> 13 car field, reordering and a missing packet without mixing rows", () => {
    const view = render(panel(snapshot720()));
    const shrunk = snapshot720();
    shrunk.opponents = [...FIELD.filter((o) => o.id !== "car-10")].reverse();
    shrunk.session = { sessionTimeSeconds: 604 };
    view.rerender(panel(shrunk));
    expect(view.container.querySelector("table")?.getAttribute("data-sector-count")).toBe("3");
    expect(value(view.container, "leroy", 0)).toBe("35.503");
    expect(value(view.container, "f0820", 0)).toBe("36.500");
    expect(rowOf(view.container, "f0820")?.textContent).toContain("77");

    const missing = snapshot720();
    view.rerender(panel(missing));
    expect(value(view.container, "leroy", 0)).toBe("35.503");

    // A poll without a frame keeps the proven results (no expiry, no
    // invalidation) and the next sparse frame gets them back.
    const { result, rerender } = renderHook(
      ({ input }: { input: V3Normalized | null }) => useRetainedLapSectors(input, "device|session"),
      { initialProps: { input: snapshot720() as V3Normalized | null } },
    );
    rerender({ input: null });
    expect(result.current.laps.get("leroy")?.seconds).toEqual([35.503, 52.35, 33.853]);
    rerender({ input: snapshot722() });
    expect(result.current.laps.get("leroy")?.lap).toBe(4);

    // Offline is labelled and dimmed; it is not a reason to erase.
    view.rerender(panel(snapshot722(), "device|session", false));
    expect(value(view.container, "leroy", 0)).toBe("35.503");
    expect(cellOf(view.container, "leroy", 0)?.querySelector("[data-sector-lap]")?.getAttribute("data-retained-stale")).toBe("true");
  });

  it("erases only the car whose cached lap is explicitly invalidated", () => {
    const clean = snapshot720();
    const { result, rerender } = renderHook(
      ({ input }: { input: V3Normalized }) => useRetainedLapSectors(input, "device|session"),
      { initialProps: { input: clean } },
    );
    expect(result.current.laps.get("f0820")?.lap).toBe(3);
    expect(result.current.laps.get("leroy")?.lap).toBe(4);

    // A reset invalidates the lap in progress (R4); f0820's proven R3 stays.
    const current = snapshot720();
    const f0820 = current.paceHistory!.cars.find((car) => car.id === "f0820")!;
    f0820.sectors = [{ ...liveUpdate("f0820", 4, 0, 0), seconds: null, status: "invalidated" as const }];
    f0820.metrics = metric("f0820", 4, 604, null, { lapValid: false }) as PaceCar["metrics"];
    current.session = { sessionTimeSeconds: 604 };
    current.opponents = FIELD.map((o) => (o.id === "f0820" ? { ...o, lap: 5 } : o));
    rerender({ input: current });
    expect(result.current.laps.get("f0820")?.lap).toBe(3);
    expect(result.current.laps.get("leroy")?.lap).toBe(4);

    // The same reset for Leroy's proven R4 removes exactly that entry.
    const ownLap = snapshot720();
    const leroy = ownLap.paceHistory!.cars.find((car) => car.id === "leroy")!;
    leroy.sectors = [{ ...liveUpdate("leroy", 4, 0, 0), seconds: null, status: "invalidated" as const }];
    leroy.metrics = metric("leroy", 4, 604, [35.503, 52.35, 33.853], { lapValid: false }) as PaceCar["metrics"];
    ownLap.session = { sessionTimeSeconds: 606 };
    rerender({ input: ownLap });
    expect(result.current.laps.get("leroy")).toBeUndefined();
    expect(result.current.laps.get("f0820")?.lap).toBe(3);
  });

  it("erases on a real session, track, layout or view switch — never on a sparse poll", () => {
    // A real switch starts without the previous session's pace cars.
    const otherSession = frame({ sessionTime: 602, cars: [paceCar("player", 4, 601, [40.1, 40.2, 40.3])], transport: "transport-live-2" });
    const view = render(panel(snapshot720()));
    view.rerender(panel(otherSession));
    expect(value(view.container, "leroy", 0)).toBeNull();

    view.rerender(panel(snapshot720()));
    expect(value(view.container, "leroy", 0)).toBe("35.503");
    view.rerender(panel(otherSession, "other-device|session"));
    expect(value(view.container, "leroy", 0)).toBeNull();

    view.rerender(panel(snapshot720()));
    const otherTrack = frame({
      sessionTime: 604,
      cars: [paceCar("player", 4, 603, [40.1, 40.2, 40.3])],
      track: { trackId: 597, trackName: "Monza", trackConfig: "Full Course" },
    });
    view.rerender(panel(otherTrack));
    expect(value(view.container, "leroy", 0)).toBeNull();
  });

  it("keeps a proven lap as fallback when the live per-sector row disappears", () => {
    const liveRows = snapshot720();
    const f0820 = liveRows.paceHistory!.cars.find((car) => car.id === "f0820")!;
    f0820.metrics = metric("f0820", 4, 601, null) as PaceCar["metrics"];
    f0820.sectors = [0, 1, 2].map((i) => liveUpdate("f0820", 3, i, 36.5 + i));

    const view = render(panel(liveRows));
    expect(value(view.container, "f0820", 0)).toBe("36.500");
    expect(cellOf(view.container, "f0820", 0)?.querySelector("[data-sector-status]")).not.toBeNull();

    const liveGone = snapshot720();
    const gone = liveGone.paceHistory!.cars.find((car) => car.id === "f0820")!;
    gone.metrics = metric("f0820", 4, 603, null) as PaceCar["metrics"];
    gone.sectors = [];
    liveGone.session = { sessionTimeSeconds: 604 };
    view.rerender(panel(liveGone));
    expect(value(view.container, "f0820", 0)).toBe("36.500");
    expect(cellOf(view.container, "f0820", 0)?.querySelector('[data-sector-source="verified-lap"]')).not.toBeNull();
  });

  it("rolls the result over per car and keeps the others untouched", () => {
    const view = render(panel(snapshot720()));
    const rolled = snapshot720();
    const leroy = rolled.paceHistory!.cars.find((car) => car.id === "leroy")!;
    leroy.metrics = metric("leroy", 5, 604, [35.1, 52.0, 33.5]) as PaceCar["metrics"];
    rolled.session = { sessionTimeSeconds: 604 };
    rolled.opponents = FIELD.map((o) => (o.id === "leroy" ? { ...o, lap: 6 } : o));
    view.rerender(panel(rolled));
    expect(value(view.container, "leroy", 0)).toBe("35.100");
    expect(cellText(view.container, "leroy")).toContain("R5");
    expect(value(view.container, "f0820", 0)).toBe("36.500");
    expect(value(view.container, "bart", 0)).toBe("38.100");
  });

  it("works from the shared projection, without touching another session's cache", () => {
    const board = (withF0820: boolean): SharedRace => ({
      ok: true,
      created_at: "2026-11-19T20:00:00.000Z",
      expires_at: "2026-11-19T22:00:00.000Z",
      updated_at: new Date().toISOString(),
      track: { name: "Spa", config: "Full Course" },
      session: { driver: "Jaimy", car: "GT3", state: "racing" },
      v3: {
        identity: { trackId: 596, trackName: "Spa", trackConfig: "Full Course" },
        session: { sessionTimeSeconds: 602 },
        opponents: FIELD,
      },
      sectors: {
        available: true,
        reason: null,
        sectorCount: 3,
        cars: [
          { id: "player", sectorCount: 3, sectors: [], sectorBests: [], metrics: metric("player", 4, 601, [40.1, 40.2, 40.3]) },
          { id: "leroy", sectorCount: 3, sectors: [], sectorBests: [], metrics: metric("leroy", 4, 601, [35.503, 52.35, 33.853]) },
          ...(withF0820
            ? [{ id: "f0820", sectorCount: 3, sectors: [], sectorBests: [], metrics: metric("f0820", 3, 600, [36.5, 37.5, 38.5]) }]
            : []),
        ],
      },
      laps: [],
      pace: null,
    });

    const sharedContext = "2026-11-19T20:00:00.000Z|Spa|Full Course";
    const first = sharedViewerV3(board(true));
    const view = render(panel(first, sharedContext));
    expect(value(view.container, "f0820", 0)).toBe("36.500");

    const second = sharedViewerV3({ ...board(false), updated_at: new Date().toISOString() });
    second.session = { sessionTimeSeconds: 604 };
    view.rerender(panel(second, sharedContext));
    expect(value(view.container, "f0820", 0)).toBe("36.500");
    expect(value(view.container, "leroy", 0)).toBe("35.503");

    // A different share/device context must not inherit the previous results.
    view.rerender(panel(sharedViewerV3(board(false)), "other-share|Spa|Full Course"));
    expect(value(view.container, "f0820", 0)).toBeNull();
  });
});
