import { readFileSync } from "node:fs";
import { render, renderHook, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PaceCar, PaceHistory, PaceSectorUpdate } from "../../../../supabase/functions/_shared/paceCapture";
import { PremiumMasthead } from "./test-premium/PremiumMasthead";
import { PremiumTimingPanel } from "./test-premium/PremiumTimingPanel";
import { LiveTrackPanel } from "./LiveTrackPanel";
import { RaceTelemetryStrip } from "./RaceTelemetryStrip";
import { SectorTimingCell } from "./SectorTimingCell";
import { StandingsWidget } from "./StandingsWidget";
import { deriveStandings } from "./standings";
import { useRetainedLapSectors } from "./useRetainedLapSectors";
import { formatSectorDelta, formatSectorSeconds, type SectorSlot } from "./sectorTiming";
import { buildStrategySnapshot } from "./strategy/snapshot";
import { advise, withoutLiveTelemetry } from "./strategy/advise";
import type { V3Normalized, V3Opponent } from "./pitwallHelpers";

const update = (over: Partial<PaceSectorUpdate> = {}): PaceSectorUpdate => ({
  id: "me",
  lap: 17,
  sectorIndex: 0,
  sectorCount: 3,
  seconds: 30,
  completedSessionTimeSeconds: 290,
  observedSessionTimeSeconds: 296,
  revision: 1,
  status: "verified",
  referenceSeconds: 30.5,
  ...over,
});

const opponent = (over: Partial<V3Opponent> = {}): V3Opponent => ({
  id: "me",
  lap: 18,
  position: 1,
  classPosition: 1,
  carNumber: "17",
  driverName: "Bart",
  teamName: "3SM",
  carClass: "GT3",
  lastLapSeconds: 90,
  bestLapSeconds: 89,
  connected: true,
  isPlayer: true,
  ...over,
});

const car = (sectors: PaceSectorUpdate[] = []): PaceCar => ({ id: "me", laps: [], traces: [], sectors, sectorBests: [] });

function frame({
  sessionTime = 300,
  segments = false,
  values = [30, 30, 30],
  sectors = [],
  lap = 18,
}: {
  sessionTime?: number;
  segments?: boolean;
  values?: number[] | null;
  sectors?: PaceSectorUpdate[];
  lap?: number;
} = {}): V3Normalized {
  return {
    transportSessionId: "transport-a",
    identity: { trackId: 596, trackConfig: "Full Course" },
    capturedAt: new Date(Date.now() - (segments ? 1_000 : 60_000)).toISOString(),
    session: { sessionTimeSeconds: sessionTime },
    timing: { lastLapTimeSeconds: 90, bestLapTimeSeconds: 89, completedLaps: lap },
    opponents: [opponent({ lap })],
    paceHistory: {
      schemaRevision: 1,
      observedSessionId: "obs-a",
      segmentId: "seg-a",
      transportSessionId: "transport-a",
      updatedAt: new Date().toISOString(),
      cars: [{
        ...car(sectors),
        metrics: {
          id: "me",
          observedSessionTimeSeconds: 296,
          lastLapSeconds: 90,
          bestLapSeconds: 89,
          lastLapSectorSeconds: values,
          bestLapSectorSeconds: null,
          bestSectorSeconds: null,
          bestLapDeltaToFieldBestSeconds: null,
          bestLapDeltaToPlayerSeconds: null,
          lapValid: true,
          lapHighPrecision: null,
          trackPositionPercentRaw: null,
          sectorMismatchCount: 0,
          sectorCount: values?.length ?? 3,
          sectorLap: lap - 1,
        },
      }],
    },
  } as V3Normalized;
}

describe("Bart UX defect 1 — status, age and stale advice", () => {
  it("says online-without-telemetry instead of claiming live, with the telemetry age", () => {
    const view = render(
      <PremiumMasthead
        deviceName="PC-BART"
        trackLabel="Spa"
        driverName="Bart"
        carName={null}
        teamName={null}
        connector="0.7.6.4"
        lastSeen="2s geleden"
        telemetryAge="42s geleden"
        state="stale"
        sectorCount={3}
        refreshing={false}
      />,
    );
    expect(view.container.textContent).toContain("ONLINE · GEEN TELEMETRIE");
    expect(view.container.textContent).toContain("wacht op telemetrie · 1s polling");
    expect(view.container.textContent).toContain("laatste telemetrie 42s geleden");
    expect(view.container.textContent).not.toContain("LIVE TELEMETRIE");
    expect(view.container.textContent).toContain("Apparaat gezien");
  });

  it("says offline without a live-polling claim and without inventing a telemetry age", () => {
    const view = render(
      <PremiumMasthead
        deviceName="PC-BART"
        trackLabel="Spa"
        driverName={null}
        carName={null}
        teamName={null}
        connector={null}
        lastSeen="3m geleden"
        telemetryAge={null}
        state="offline"
        sectorCount={0}
        refreshing={false}
      />,
    );
    expect(view.container.textContent).toContain("OFFLINE");
    expect(view.container.textContent).toContain("geen verbinding · 1s polling");
    expect(view.container.textContent).toContain("nog geen telemetrie ontvangen");
    expect(view.container.textContent).not.toContain("LIVE TELEMETRIE");
  });

  it("does not let a freshly updated strategy row make old telemetry advise a stop", () => {
    const old = frame();
    old.capturedAt = new Date(Date.now() - 30_000).toISOString();
    const snapshot = buildStrategySnapshot({ strategy: null, v3: old });
    expect(snapshot.sampleAgeSeconds).toBeGreaterThan(5);
    expect(advise(snapshot).decision).toBe("NO_ADVICE");
    expect(advise(snapshot).reasonCode).toBe("stale_telemetry");
  });

  it("turns any prior stop advice into GEEN ADVIES when the feed is off", () => {
    const snapshot = buildStrategySnapshot({ strategy: null, v3: frame() });
    const live = advise(snapshot);
    const off = withoutLiveTelemetry(live);
    expect(off.decision).toBe("NO_ADVICE");
    expect(off.lapsUntilPit).toBeNull();
    expect(off.fuelToAddLitres).toBeNull();
    expect(off.window).toBeNull();
    expect(off.tyres).toBeNull();
    expect(off.reasonCode).toBe("stale_telemetry");
  });

  it("shows no 100% lap scale when there is no position, and no stale scale offline", () => {
    const noPosition = frame();
    noPosition.opponents = [opponent({ lapDistancePct: null })];
    const live = render(<LiveTrackPanel v3={noPosition} live fallbackTrack="Spa" />);
    expect(live.container.querySelector('[data-ptp-lap-progress="unavailable"]')).not.toBeNull();
    expect(live.container.textContent).toContain("Nog geen autopositie");
    expect(live.container.textContent).not.toContain("100%");

    const offline = render(<LiveTrackPanel v3={noPosition} live={false} fallbackTrack="Spa" />);
    expect(offline.container.textContent).toContain("Offline — geen live rondevoortgang");
    expect(offline.container.textContent).not.toContain("100%");
  });

  it("keeps the scale when a real position exists", () => {
    const positioned = frame();
    positioned.opponents = [opponent({ lapDistancePct: 0.5 })];
    const view = render(<LiveTrackPanel v3={positioned} live fallbackTrack="Spa" />);
    expect(view.container.querySelector('[data-ptp-lap-progress="available"]')).not.toBeNull();
    expect(view.container.textContent).toContain("100%");
  });
});

describe("Bart UX defect 2 — verified lap versus live sectors and honest references", () => {
  it("shows R17 verified sectors next to the R18 live car in the KPI and both timing tables", () => {
    const data = frame();
    const kpi = render(<RaceTelemetryStrip v3={data} live />);
    expect(kpi.container.textContent).toContain("Sectoren · laatst geverifieerd R17");
    expect(kpi.container.textContent).toContain("30.000");
    expect(kpi.container.querySelector('[data-sector-source="verified-lap"]')).not.toBeNull();

    const standings = render(
      <StandingsWidget v3={data} standings={deriveStandings(data, 40)} ownCarLabel="Bart" ownCarNumber="17" />,
    );
    const classicCell = standings.container.querySelector('td[data-sector-index="0"]') as HTMLElement;
    expect(classicCell.querySelector('[data-sector-source="verified-lap"]')).not.toBeNull();
    expect(classicCell.querySelector('[data-sector-lap-mark="17"]')?.textContent).toBe("R17");
    expect(classicCell.textContent).toContain("30.000");

    const premium = render(
      <PremiumTimingPanel
        v3={data} standings={deriveStandings(data, 40)} ownCarLabel="Bart" ownCarNumber="17"
        live contextKey="device|transport-a" motionEnabled={false}
      />,
    );
    const premiumCell = premium.container.querySelector('tbody [data-sector-source="verified-lap"]') as HTMLElement;
    expect(premiumCell.querySelector('[data-sector-lap-mark="17"]')?.textContent).toBe("R17");
    expect(premiumCell.getAttribute("title")).toContain("Laatst geverifieerd · ronde 17");
  });

  it("labels the same car as live R18 when the sector contract has a current-lap update", () => {
    const data = frame({
      sectors: [
        update({ sectorIndex: 0, lap: 18, seconds: 29.8 }),
        update({ sectorIndex: 1, lap: 18, seconds: 30.1 }),
        update({ sectorIndex: 2, lap: 18, seconds: 30.2 }),
      ],
    });
    const kpi = render(<RaceTelemetryStrip v3={data} live />);
    expect(kpi.container.textContent).toContain("Sectoren · live ronde 18");
    expect(kpi.container.querySelector('[data-sector-source="live"]')).not.toBeNull();
    expect(kpi.container.querySelector('[data-sector-lap="18"]')).not.toBeNull();
  });

  it("renders a dash for a missing delta reference and keeps a genuine 0.000", () => {
    expect(formatSectorSeconds(null)).toBe("—");
    expect(formatSectorDelta(null)).toBeNull();
    expect(formatSectorDelta(0)).toBe("0.000");

    const slot: SectorSlot = {
      sectorIndex: 0, lap: 18, status: "verified", seconds: 30,
      referenceSeconds: null, deltaSeconds: null, isPersonalBest: false,
      isSessionBest: false, isPreviousLap: false, revision: 1,
    };
    const missing = render(<SectorTimingCell slot={slot} />);
    expect(missing.container.textContent).toContain("30.000");
    expect(missing.container.querySelector('[data-sector-delta="missing"]')?.textContent).toBe("—");

    const zero = render(<SectorTimingCell slot={{ ...slot, referenceSeconds: 30, deltaSeconds: 0 }} />);
    expect(zero.container.querySelector('[data-sector-delta="0.000"]')?.textContent).toBe("0.000");
  });
});

describe("Bart UX defect 3 — bounded retention without cross-identity or invalidation leaks", () => {
  it("keeps a verified lap through a missing poll, a null frame and a late poll", () => {
    const first = frame();
    const { result, rerender } = renderHook(
      ({ input }) => useRetainedLapSectors(input, "device|transport-a"),
      { initialProps: { input: first as V3Normalized | null } },
    );
    expect(result.current.count).toBe(3);
    expect(result.current.laps.get("me")?.lap).toBe(17);

    const blank = { ...frame({ sessionTime: 308 }) };
    delete (blank as { paceHistory?: PaceHistory }).paceHistory;
    rerender({ input: blank });
    expect(result.current.laps.get("me")?.seconds).toEqual([30, 30, 30]);

    rerender({ input: null });
    expect(result.current.laps.get("me")?.seconds).toEqual([30, 30, 30]);

    // Retentie is geen hartslag: ook twee minuten zonder nieuwe meting is de
    // laatste bewezen ronde nog steeds de laatste bewezen ronde. Alleen een
    // echte wissel (sessie/track/ronde-identiteit) wist hem.
    rerender({ input: frame({ sessionTime: 430 }) });
    expect(result.current.laps.get("me")?.seconds).toEqual([30, 30, 30]);
  });

  it("still shows the verified lap in the KPI after a poll returns no frame", () => {
    const view = render(<RaceTelemetryStrip v3={frame()} live />);
    expect(view.container.textContent).toContain("30.000");
    view.rerender(<RaceTelemetryStrip v3={null} live={false} />);
    expect(view.container.textContent).toContain("Sectoren · laatst geverifieerd R17");
    expect(view.container.textContent).toContain("30.000");
    expect(view.container.querySelector('[data-retained-stale="true"]')).not.toBeNull();
  });

  it("never carries sectors across an identity reset, a session rewind or an explicit invalidation", () => {
    const first = frame();
    const { result, rerender } = renderHook(
      ({ input }) => useRetainedLapSectors(input, "device|transport-a"),
      { initialProps: { input: first as V3Normalized } },
    );

    const otherTransport = frame();
    otherTransport.transportSessionId = "transport-b";
    rerender({ input: otherTransport });
    expect(result.current.laps.size).toBe(0);

    rerender({ input: frame() });
    expect(result.current.laps.size).toBe(1);
    rerender({ input: frame({ sessionTime: 100 }) });
    expect(result.current.laps.size).toBe(0);

    rerender({ input: frame() });
    const invalid = frame({ sectors: [update({ status: "invalidated", seconds: null })] });
    rerender({ input: invalid });
    expect(result.current.laps.size).toBe(0);
  });

  it("keeps a 16-sector layout and bounded car cache", () => {
    const values = Array.from({ length: 16 }, () => 90 / 16);
    const { result } = renderHook(() => useRetainedLapSectors(frame({ values }), "device|transport-a"));
    expect(result.current.count).toBe(16);
    expect(result.current.laps.get("me")?.seconds).toHaveLength(16);
  });

  it("does not duplicate the pinned own row when only one car is present", () => {
    const data = frame();
    const view = render(
      <PremiumTimingPanel
        v3={data} standings={deriveStandings(data, 40)} ownCarLabel="Bart" ownCarNumber="17"
        live contextKey="device|transport-a" motionEnabled={false}
      />,
    );
    expect(view.container.querySelector("[data-premium-pinned-own-row]")).toBeNull();
    expect(view.container.querySelectorAll("[data-timing-row-id]")).toHaveLength(1);
  });

  it("declares the 390px priority columns and keeps secondary details in the accessibility tree", () => {
    const premiumCss = readFileSync("src/features/endurance/pitwall/test-premium/testPremium.css", "utf8");
    expect(premiumCss).toMatch(/@media \(max-width: 430px\)[\s\S]*ptp-col-best[\s\S]*display: none/);
    expect(premiumCss).toMatch(/ptp-col-driver[\s\S]*ptp-col-time[\s\S]*ptp-col-sector/);

    const classicCss = readFileSync("src/features/endurance/pitwall/pitwallTimingResponsive.css", "utf8");
    expect(classicCss).toContain(".pitwall-col-secondary");
    expect(classicCss).toContain(".pitwall-col-driver");
    expect(classicCss).toContain(".pitwall-col-last");

    const data = frame();
    const view = render(
      <StandingsWidget v3={data} standings={deriveStandings(data, 40)} ownCarLabel="Bart" ownCarNumber="17" />,
    );
    const secondary = view.container.querySelector("[data-pitwall-mobile-secondary]") as HTMLElement;
    expect(secondary.textContent).toContain("Positie 1");
    expect(secondary.textContent).toContain("beste 1:29.000");
    expect(within(secondary).queryByText(/ronde 18/)).not.toBeNull();
  });
});
