import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PaceCar, PaceHistory, PaceSectorBest, PaceSectorUpdate } from "../../../../supabase/functions/_shared/paceCapture";
import type { V3Normalized, V3Opponent } from "./pitwallHelpers";
import { deriveStandings } from "./standings";
import { PremiumTimingPanel } from "./test-premium/PremiumTimingPanel";
import { StandingsWidget } from "./StandingsWidget";
import { RaceTelemetryStrip } from "./RaceTelemetryStrip";

/**
 * Echte componenttests met contractvormige PACE-snapshots. De tijden zijn
 * synthetisch; dit bewijst de weergaveketen, niet de live nauwkeurigheid.
 */

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

const opponent = (id: string, over: Partial<V3Opponent> = {}): V3Opponent => ({
  id,
  lap: 11,
  position: id === "a" ? 1 : 2,
  classPosition: id === "a" ? 1 : 2,
  carNumber: id.toUpperCase(),
  driverName: `Coureur ${id}`,
  teamName: `Team ${id}`,
  carClass: "GT3",
  lastLapSeconds: 90,
  bestLapSeconds: 89,
  connected: true,
  ...over,
});

/** Metriek is bewust ouder dan 5 s: de nieuwe sectordata mag daar niet van afhangen. */
const staleMetric = (id: string) => ({
  id,
  observedSessionTimeSeconds: 100,
  lastLapSeconds: 90,
  bestLapSeconds: 89,
  lastLapSectorSeconds: [30, 30, 30],
  bestLapSectorSeconds: null,
  bestSectorSeconds: null,
  bestLapDeltaToFieldBestSeconds: null,
  bestLapDeltaToPlayerSeconds: null,
  lapValid: true,
  lapHighPrecision: null,
  trackPositionPercentRaw: null,
  sectorMismatchCount: 0,
  sectorCount: 3,
  sectorLap: 9,
});

function frame(
  cars: PaceCar[],
  {
    sessionTime = 300,
    opponents = cars.map((entry) => opponent(entry.id)),
    history = {},
  }: {
    sessionTime?: number;
    opponents?: V3Opponent[];
    history?: Partial<PaceHistory>;
  } = {},
): V3Normalized {
  return {
    transportSessionId: "transport-a",
    identity: { trackId: 596, trackConfig: "Full Course" },
    session: { sessionTimeSeconds: sessionTime },
    timing: { lastLapTimeSeconds: 90, bestLapTimeSeconds: 89, completedLaps: 10 },
    opponents,
    paceHistory: {
      schemaRevision: 1,
      observedSessionId: "obs-a",
      segmentId: "seg-a",
      transportSessionId: "transport-a",
      updatedAt: new Date().toISOString(),
      cars,
      ...history,
    },
  };
}

const premium = (v3: V3Normalized, contextKey = "device|transport-a|596") =>
  render(
    <PremiumTimingPanel
      v3={v3}
      standings={deriveStandings(v3, 40)}
      ownCarLabel={null}
      ownCarNumber={null}
      live
      contextKey={contextKey}
      motionEnabled={false}
    />,
  );

const premiumCell = (container: HTMLElement, carId: string, index: number): HTMLElement => {
  const row = container.querySelector(`tr[data-timing-row-id='${carId}']`);
  expect(row).not.toBeNull();
  const cell = row!.querySelector(`td[data-sector-index='${index}']`);
  expect(cell).not.toBeNull();
  return cell as HTMLElement;
};

describe("retained full-lap sectors", () => {
  const make = (lap: number, time: number, values: number[] | null, segmentId = "seg-a") => {
    const data = frame([car("a", [])], { sessionTime: time, opponents: [opponent("a", { lap, isPlayer: true })], history: { segmentId } });
    data.paceHistory!.cars[0].metrics = {
      ...staleMetric("a"), sectorCount: 5, sectorLap: lap - 1,
      observedSessionTimeSeconds: values ? time : time - 6,
      lastLapSectorSeconds: values,
    };
    return data;
  };
  function views(v3: V3Normalized) {
    const standings = deriveStandings(v3, 40);
    return <><section data-view="normal"><StandingsWidget v3={v3} standings={standings} ownCarLabel={null} ownCarNumber={null} /></section>
      <section data-view="premium"><PremiumTimingPanel v3={v3} standings={standings} ownCarLabel={null} ownCarNumber={null} live contextKey="device" motionEnabled={false} /></section>
      <section data-view="kpi"><RaceTelemetryStrip v3={v3} live /></section></>;
  }
  it("holds five proved sectors through a blank poll and lap advance, then replaces or clears them", () => {
    const first = [16, 17, 18, 19, 20];
    const { container, rerender } = render(views(make(11, 300, first)));
    const all = (value: string) => {
      for (const name of ["normal", "premium", "kpi"]) expect(container.querySelector(`[data-view=${name}]`)?.textContent, name).toContain(value);
    };
    all("16.000"); all("20.000");
    rerender(views(make(11, 308, null)));
    all("16.000"); all("20.000");
    rerender(views(make(12, 390, [1, 2, 3, 4, 5]))); // Wrong sum must not overwrite R10.
    all("16.000");
    expect(container.querySelector('[data-view=normal] [data-sector-lap="10"][data-sector-previous="true"]')).not.toBeNull();
    rerender(views(make(12, 391, [20, 19, 18, 17.5, 15.5])));
    all("15.500");
    rerender(views(make(12, 392, null, "new-segment")));
    expect(container.textContent).not.toContain("15.500");
  });
  it("does not resurrect a full-lap fallback for explicit invalidation", () => {
    const { container, rerender } = render(views(make(11, 300, [16, 17, 18, 19, 20])));
    const invalid = make(11, 301, [16, 17, 18, 19, 20]);
    invalid.paceHistory!.cars[0].sectors = [update({ status: "invalidated", seconds: null, sectorCount: 5 })];
    rerender(views(invalid));
    expect(container.querySelector('[data-view=normal] [data-sector-status=invalidated]')).not.toBeNull();
    expect(container.textContent).not.toContain("16.000");
  });
});

describe("live sector updates — premium consumer", () => {
  it("toont persistente sectortijden ruim na de 5-seconden metriekpoort zonder de geometrie te wijzigen", () => {
    const data = frame([car("a", [
      update({ sectorIndex: 0, seconds: 30, referenceSeconds: 30.5 }),
      update({ sectorIndex: 1, seconds: 30.5, referenceSeconds: 30.4 }),
      update({ sectorIndex: 2, seconds: 31, referenceSeconds: 31.2 }),
    ], [{ sectorIndex: 0, lap: 10, seconds: 30 }])], {
      sessionTime: 300,
      opponents: [opponent("a")],
    });
    // De metriek is 200 s oud; alleen de persistente sectorstand mag overblijven.
    data.paceHistory!.cars[0].metrics = staleMetric("a");

    const view = premium(data);
    expect(screen.getByRole("columnheader", { name: "S1" })).toBeTruthy();
    expect(view.container.querySelectorAll("colgroup col")).toHaveLength(12);

    const cell = premiumCell(view.container, "a", 0);
    expect(within(cell).getByText("30.000")).toBeTruthy();
    expect(cell.querySelector("[data-sector-lap='10']")).not.toBeNull();
    expect(cell.querySelector("[data-sector-status='verified']")).not.toBeNull();
    expect(within(cell).getByText("-0.500")).toBeTruthy();
    expect(within(cell).getByText("R10")).toBeTruthy();

    // Volgende normale poll: dezelfde persistente stand, ouder wordende sessie.
    view.rerender(
      <PremiumTimingPanel
        v3={{ ...data, session: { sessionTimeSeconds: 999 } }}
        standings={deriveStandings({ ...data, session: { sessionTimeSeconds: 999 } }, 40)}
        ownCarLabel={null}
        ownCarNumber={null}
        live
        contextKey="device|transport-a|596"
        motionEnabled={false}
      />,
    );
    expect(within(premiumCell(view.container, "a", 0)).getByText("30.000")).toBeTruthy();
    expect(view.container.querySelectorAll("colgroup col")).toHaveLength(12);
  });

  it("toont een nieuwe S1 direct en houdt de oudere S2/S3 met eigen R", () => {
    const first = frame([car("a", [
      update({ sectorIndex: 0, lap: 9, seconds: 30 }),
      update({ sectorIndex: 1, lap: 9, seconds: 30.5 }),
      update({ sectorIndex: 2, lap: 9, seconds: 31 }),
    ])], { opponents: [opponent("a")] });
    const view = premium(first);
    expect(within(premiumCell(view.container, "a", 0)).getByText("30.000")).toBeTruthy();

    // S1 of R10 arrived, S2/S3 still belong to R9. Showing the new S1 beside
    // the old S2/S3 would combine two laps, so the complete R9 stays visible.
    const nextLap = frame([car("a", [
      update({ sectorIndex: 0, lap: 10, seconds: 29.9 }),
      update({ sectorIndex: 1, lap: 9, seconds: 30.5 }),
      update({ sectorIndex: 2, lap: 9, seconds: 31 }),
    ])], { sessionTime: 420, opponents: [opponent("a")] });
    view.rerender(
      <PremiumTimingPanel
        v3={nextLap}
        standings={deriveStandings(nextLap, 40)}
        ownCarLabel={null}
        ownCarNumber={null}
        live
        contextKey="device|transport-a|596"
        motionEnabled={false}
      />,
    );

    // The new S1 is not delayed for a complete row; the older cells stay
    // explicitly on R9 instead of disappearing or being mislabelled.
    expect(within(premiumCell(view.container, "a", 0)).getByText("29.900")).toBeTruthy();
    expect(premiumCell(view.container, "a", 0).querySelector("[data-sector-lap='10']")).not.toBeNull();
    expect(within(premiumCell(view.container, "a", 1)).getByText("30.500")).toBeTruthy();
    expect(within(premiumCell(view.container, "a", 2)).getByText("31.000")).toBeTruthy();
    for (const index of [1, 2]) {
      const held = premiumCell(view.container, "a", index);
      expect(held.querySelector("[data-sector-lap='9']")).not.toBeNull();
      expect(held.querySelector("[data-sector-previous='true']")).not.toBeNull();
    }
    expect(view.container.querySelector('[data-timing-row-id="a"]')?.getAttribute("data-sector-mixed-laps")).toBe("true");

    // All three sectors of R10 now carry the same lap: replace the whole row.
    const complete = frame([car("a", [
      update({ sectorIndex: 0, lap: 10, seconds: 29.9 }),
      update({ sectorIndex: 1, lap: 10, seconds: 30.4 }),
      update({ sectorIndex: 2, lap: 10, seconds: 30.9 }),
    ])], { sessionTime: 421, opponents: [opponent("a")] });
    view.rerender(
      <PremiumTimingPanel
        v3={complete}
        standings={deriveStandings(complete, 40)}
        ownCarLabel={null}
        ownCarNumber={null}
        live
        contextKey="device|transport-a|596"
        motionEnabled={false}
      />,
    );
    const fresh = premiumCell(view.container, "a", 0);
    expect(within(fresh).getByText("29.900")).toBeTruthy();
    expect(fresh.querySelector("[data-sector-lap='10']")).not.toBeNull();
    expect(fresh.querySelector("[data-sector-previous='true']")).toBeNull();
    expect(within(premiumCell(view.container, "a", 2)).getByText("30.900")).toBeTruthy();
  });

  it("toont delta tegen de bevroren vorige PB, status en paars alleen bij een consistente geverifieerde beste", () => {
    const data = frame([
      car("a", [update({ sectorIndex: 0, seconds: 29.8, referenceSeconds: 30, status: "provisional" })], [{ sectorIndex: 0, lap: 10, seconds: 29.8 }]),
      car("b", [update({ id: "b", sectorIndex: 0, seconds: 30.1, referenceSeconds: 30 })], [{ sectorIndex: 0, lap: 10, seconds: 30.1 }]),
    ], { opponents: [opponent("a"), opponent("b")] });
    const view = premium(data);

    const a = premiumCell(view.container, "a", 0);
    expect(within(a).getByText("-0.200").className).toContain("text-emerald-400");
    expect(a.querySelector("[data-sector-status='provisional']")).not.toBeNull();
    expect(within(a).getByText("P")).toBeTruthy();
    // Provisoire tijd is nog geen bewezen sectorBest: geen paars.
    expect(a.querySelector("[data-sector-session-best='true']")).toBeNull();

    const b = premiumCell(view.container, "b", 0);
    expect(within(b).getByText("+0.100").className).toContain("text-red-400");
    expect(b.querySelector("[data-sector-session-best='true']")).toBeNull();
    expect(within(b).getByText("✓")).toBeTruthy();
  });

  it("maakt een geverifieerde sectorBest uit de getoonde auto's paars", () => {
    const data = frame([
      car("a", [update({ sectorIndex: 0, seconds: 29.8, referenceSeconds: 30 })], [{ sectorIndex: 0, lap: 10, seconds: 29.8 }]),
      car("b", [update({ id: "b", sectorIndex: 0, seconds: 30.1, referenceSeconds: 30 })], [{ sectorIndex: 0, lap: 10, seconds: 30.1 }]),
    ], { opponents: [opponent("a"), opponent("b")] });
    const view = premium(data);
    const a = premiumCell(view.container, "a", 0);
    expect(a.querySelector("[data-sector-session-best='true']")).not.toBeNull();
    expect(within(a).getByText("29.800").className).toContain("text-fuchsia-300");
    expect(premiumCell(view.container, "b", 0).querySelector("[data-sector-session-best='true']")).toBeNull();
  });

  it("volgt de gemeten 1..16-indeling uit het sectorcontract zonder een vaste drie te verzinnen", () => {
    const sectors = Array.from({ length: 6 }, (_, sectorIndex) => update({
      sectorIndex,
      sectorCount: 6,
      seconds: 15 + sectorIndex / 10,
    }));
    const data = frame([car("a", sectors)], { opponents: [opponent("a")] });
    const view = premium(data);
    expect(screen.getByRole("columnheader", { name: "S1" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "S6" })).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: "S7" })).toBeNull();
    expect(view.container.querySelectorAll("colgroup col")).toHaveLength(15);
    expect(view.container.querySelectorAll("tr[data-timing-row-id='a'] td[data-sector-index]")).toHaveLength(6);
  });

  it("toont een ongeldige sector als streepje en wist resultaten bij een namespace-reset", () => {
    const data = frame([car("a", [
      update({ sectorIndex: 0, status: "invalidated", seconds: null }),
      update({ sectorIndex: 1, seconds: 30.5 }),
      update({ sectorIndex: 2, seconds: 31 }),
    ])], { opponents: [opponent("a")] });
    const view = premium(data);
    const invalid = premiumCell(view.container, "a", 0);
    expect(invalid.textContent).toBe("—");
    expect(invalid.querySelector("[data-sector-status='invalidated']")).not.toBeNull();
    expect(within(premiumCell(view.container, "a", 1)).getByText("30.500")).toBeTruthy();

    const reset = frame([], {
      sessionTime: 500,
      opponents: [opponent("a")],
      history: { observedSessionId: "obs-b", segmentId: "seg-b" },
    });
    view.rerender(
      <PremiumTimingPanel
        v3={reset}
        standings={deriveStandings(reset, 40)}
        ownCarLabel={null}
        ownCarNumber={null}
        live
        contextKey="device|transport-a|596"
        motionEnabled={false}
      />,
    );
    expect(screen.queryByText("30.500")).toBeNull();
    expect(screen.queryByText("31.000")).toBeNull();
    for (const cell of view.container.querySelectorAll("tbody td[data-sector-index]")) {
      expect(cell.textContent).toBe("—");
    }
  });

  it("negeert misvormde en toekomstige entries zonder geldige cellen te vullen", () => {
    const data = frame([car("a", [
      update({ sectorIndex: 0, seconds: 29.8 }),
      update({ sectorIndex: 1, seconds: "kapot" as unknown as number }),
      update({ sectorIndex: 2, lap: 99, seconds: 20 }),
    ])], { opponents: [opponent("a", { lap: 11 })] });
    const view = premium(data);
    expect(within(premiumCell(view.container, "a", 0)).getByText("29.800")).toBeTruthy();
    expect(premiumCell(view.container, "a", 1).textContent).toBe("—");
    expect(premiumCell(view.container, "a", 2).textContent).toBe("—");
    expect(view.container.textContent).not.toContain("20.000");
  });
});

describe("live sector updates — klassieke consumenten", () => {
  it("toont dezelfde persistente sectortijden in de klassieke StandingsWidget", () => {
    const data = frame([car("a", [
      update({ sectorIndex: 0, seconds: 29.8, referenceSeconds: 30 }),
      update({ sectorIndex: 1, seconds: 30.5 }),
      update({ sectorIndex: 2, seconds: 31 }),
    ], [{ sectorIndex: 0, lap: 10, seconds: 29.8 }])], { opponents: [opponent("a")] });
    data.paceHistory!.cars[0].metrics = staleMetric("a");

    const view = render(
      <StandingsWidget v3={data} standings={deriveStandings(data, 40)} ownCarLabel="Eigen" ownCarNumber="1" />,
    );
    expect(screen.getByRole("columnheader", { name: "S1" })).toBeTruthy();
    const cell = view.container.querySelector("td[data-sector-index='0']") as HTMLElement;
    expect(cell).not.toBeNull();
    expect(within(cell).getByText("29.800")).toBeTruthy();
    expect(within(cell).getByText("-0.200")).toBeTruthy();
    expect(cell.querySelector("[data-sector-lap='10']")).not.toBeNull();
    expect(cell.querySelector("[data-sector-session-best='true']")).not.toBeNull();
  });

  it("toont de KPI-strip met rondelabel, status en delta los van de metriek-TTL", () => {
    const data = frame([car("a", [
      update({ sectorIndex: 0, seconds: 29.8, referenceSeconds: 30 }),
      update({ sectorIndex: 1, seconds: 30.5, referenceSeconds: 31, status: "provisional" }),
      update({ sectorIndex: 2, seconds: 31 }),
    ], [{ sectorIndex: 0, lap: 10, seconds: 29.8 }])], { opponents: [opponent("a", { isPlayer: true })] });
    data.paceHistory!.cars[0].metrics = staleMetric("a");

    const view = render(<RaceTelemetryStrip v3={data} live />);
    expect(screen.getByText("Sectoren · live ronde 10")).toBeTruthy();
    expect(screen.getByText("29.800")).toBeTruthy();
    expect(screen.getByText("-0.200")).toBeTruthy();
    expect(screen.getByText("-0.500")).toBeTruthy();
    expect(view.container.querySelector("[data-pitwall-kpi-group='sectoren'] [data-sector-status='provisional']")).not.toBeNull();
    expect(view.container.querySelector("[data-pitwall-kpi-group='sectoren'] [data-sector-session-best='true']")).not.toBeNull();
    expect(screen.getAllByText("R10")).toHaveLength(3);
  });

  it("laat een oud frame zonder sectorcontract exact op de bestaande legacy-ronde vallen", () => {
    const data: V3Normalized = {
      transportSessionId: "transport-a",
      session: { sessionTimeSeconds: 100 },
      timing: { lastLapTimeSeconds: 90, bestLapTimeSeconds: 89 },
      opponents: [opponent("a")],
      paceHistory: {
        schemaRevision: 1,
        observedSessionId: "obs-a",
        segmentId: "seg-a",
        transportSessionId: "transport-a",
        updatedAt: new Date().toISOString(),
        cars: [{
          id: "a",
          laps: [],
          traces: [],
          metrics: {
            ...staleMetric("a"),
            observedSessionTimeSeconds: 100,
            lastLapSectorSeconds: [30, 30, 30],
            sectorLap: 10,
          },
        }],
      },
    };
    const view = render(
      <StandingsWidget v3={data} standings={deriveStandings(data, 40)} ownCarLabel="Eigen" ownCarNumber="1" />,
    );
    const cell = view.container.querySelector("td[data-sector-index='0']") as HTMLElement;
    expect(cell.textContent).toBe("30.000R10");
    expect(cell.querySelector("[data-sector-status]")).toBeNull();
    expect(cell.querySelector("[data-sector-value]")?.textContent).toBe("30.000");
    expect(cell.querySelector("[data-sector-lap-mark='10']")).not.toBeNull();
    expect(cell.getAttribute("title")).toContain("Laatst geverifieerd");
  });
});
