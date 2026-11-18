import { createRoot } from "react-dom/client";
import { useMemo } from "react";
import { PremiumMasthead } from "../../../src/features/endurance/pitwall/test-premium/PremiumMasthead";
import { PremiumTimingPanel } from "../../../src/features/endurance/pitwall/test-premium/PremiumTimingPanel";
import { RaceTelemetryStrip } from "../../../src/features/endurance/pitwall/RaceTelemetryStrip";
import { LiveTrackPanel } from "../../../src/features/endurance/pitwall/LiveTrackPanel";
import { StandingsWidget } from "../../../src/features/endurance/pitwall/StandingsWidget";
import { deriveStandings } from "../../../src/features/endurance/pitwall/standings";
import type { V3Normalized, V3Opponent } from "../../../src/features/endurance/pitwall/pitwallHelpers";
import "../../../src/index.css";
import "../../../src/features/endurance/pitwall/test-premium/testPremium.css";

type Scenario = "live" | "stale" | "noposition" | "single" | "sixteen";

const params = new URLSearchParams(location.search);
const scenario = (params.get("scenario") as Scenario) || "live";

const now = Date.now();
const iso = (offsetSeconds: number) => new Date(now + offsetSeconds * 1000).toISOString();

const opponent = (over: Partial<V3Opponent> & { id: string }): V3Opponent => ({
  lap: 18,
  position: 1,
  classPosition: 1,
  carNumber: "17",
  driverName: "Bart",
  teamName: "3SM",
  carClass: "GT3",
  lastLapSeconds: 90,
  bestLapSeconds: 89,
  gapToPlayerSeconds: 0,
  connected: true,
  isPlayer: false,
  lapDistancePct: 0.42,
  ...over,
});

function makeV3(): V3Normalized {
  const sixteen = scenario === "sixteen";
  const count = sixteen ? 16 : 3;
  const values = Array.from({ length: count }, () => 90 / count);
  const single = scenario === "single" || sixteen;
  const noPosition = scenario === "noposition";
  const stale = scenario === "stale";
  const opponents: V3Opponent[] = [
    opponent({
      id: "me",
      isPlayer: true,
      lapDistancePct: noPosition ? null : 0.42,
      ...(single ? {} : {}),
    }),
    ...(single ? [] : [opponent({ id: "rival", position: 2, classPosition: 2, carNumber: "12", driverName: "Rival", lap: 17, lapDistancePct: noPosition ? null : 0.31 })]),
  ];
  return {
    capturedAt: stale ? iso(-42) : iso(0),
    transportSessionId: "ux-fixture",
    identity: { trackId: 596, trackName: "Road America", trackConfig: "Full Course", currentDriverName: "Bart", carName: "Porsche 911 GT3 R" },
    session: { sessionTimeSeconds: 300, isInCar: true, sessionTimeRemainingSeconds: 3200 },
    timing: { lastLapTimeSeconds: 90, bestLapTimeSeconds: 89, completedLaps: 18 },
    position: { position: 1, classPosition: 1, gapToLeaderSeconds: 0 },
    track: { lapDistancePct: noPosition ? null : 0.42 },
    opponents,
    paceHistory: {
      schemaRevision: 1,
      observedSessionId: "ux-session",
      segmentId: "ux-segment",
      transportSessionId: "ux-fixture",
      updatedAt: iso(0),
      cars: [{
        id: "me",
        laps: [],
        traces: [],
        sectorBests: [],
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
          sectorCount: count,
          sectorLap: 17,
        },
      }],
    },
  } as V3Normalized;
}

function Fixture() {
  const v3 = useMemo(makeV3, []);
  const standings = useMemo(() => deriveStandings(v3, 40), [v3]);
  const live = scenario !== "stale";
  const state = scenario === "stale" ? "stale" : "live";
  return (
    <div className="ptp-root" data-pitwall-test-premium="true" data-motion="off" data-fixture-scenario={scenario}>
      <PremiumMasthead
        deviceName="PC-BART"
        trackLabel="Road America - Full Course"
        driverName="Bart"
        carName="Porsche 911 GT3 R"
        teamName="3SM"
        connector="0.7.6.4"
        lastSeen="2s geleden"
        telemetryAge={scenario === "stale" ? "42s geleden" : null}
        state={state}
        sectorCount={scenario === "sixteen" ? 16 : 3}
        refreshing={false}
      />
      <div className="ptp-kpi">
        <RaceTelemetryStrip v3={v3} live={live} showClassPosition={false} sectorCountOverride={scenario === "sixteen" ? 16 : 3} stableLayout contextKey="ux" />
      </div>
      <div className="ptp-main">
        <div className="ptp-track-col">
          <LiveTrackPanel v3={v3} live={live} fallbackTrack="Road America" />
        </div>
        <div className="ptp-timing-col">
          <PremiumTimingPanel
            v3={v3}
            standings={standings}
            ownCarLabel="Porsche 911 GT3 R"
            ownCarNumber="17"
            live={live}
            contextKey="ux"
            gap={false}
            motionEnabled={false}
            layoutSectorCount={scenario === "sixteen" ? 16 : 3}
          />
        </div>
      </div>
      <section className="mt-6 rounded-xl border border-[#1D2431] bg-[#0B0D11] p-3" data-classic-fixture>
        <p className="mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Klassieke route · gedeelde tabel</p>
        <StandingsWidget v3={v3} standings={standings} ownCarLabel="Bart" ownCarNumber="17" live={live} />
      </section>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
