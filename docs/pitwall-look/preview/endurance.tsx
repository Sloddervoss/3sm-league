import { createRoot } from "react-dom/client";
import { useMemo } from "react";
import { PitwallContextBar } from "../../../src/features/endurance/pitwall/PitwallContextBar";
import { PitwallDashboard } from "../../../src/features/endurance/pitwall/PitwallDashboard";
import { RaceTelemetryStrip } from "../../../src/features/endurance/pitwall/RaceTelemetryStrip";
import { DecisionBand } from "../../../src/features/endurance/pitwall/DecisionBand";
import { LiveTrackPanel } from "../../../src/features/endurance/pitwall/LiveTrackPanel";
import { OwnCarPanel } from "../../../src/features/endurance/pitwall/OwnCarPanel";
import { StandingsWidget } from "../../../src/features/endurance/pitwall/StandingsWidget";
import { PacePanel } from "../../../src/features/endurance/pitwall/PacePanel";
import { StintDriverPanel } from "../../../src/features/endurance/pitwall/StintDriverPanel";
import { FuelPanel } from "../../../src/features/endurance/pitwall/FuelPanel";
import { VehicleTelemetryPanel } from "../../../src/features/endurance/pitwall/VehicleTelemetryPanel";
import { StrategyForecast } from "../../../src/features/endurance/pitwall/StrategyForecast";
import { PitStrategyBlock } from "../../../src/features/endurance/pitwall/PitStrategyBlock";
import { AlertZone } from "../../../src/features/endurance/pitwall/AlertZone";
import { RaceTimeline } from "../../../src/features/endurance/pitwall/RaceTimeline";
import { deriveStandings } from "../../../src/features/endurance/pitwall/standings";
import { usePitwallStrategy } from "../../../src/features/endurance/pitwall/usePitwallStrategy";
import { fixtureAlerts, fixtureEvents, fixtureStints, fixtureStrategy, fixtureV3 } from "./fixtures";
import "./preview.css";

const teamName = "3 Stumpe Motorsport";
const driverName = "V. de Vos";

const pacePoints = fixtureEvents
  .filter((event) => event.event_type === "lap_completed")
  .map((event) => ({ lap: event.completed_laps ?? 0, seconds: event.lap_time_from_deltas_s ?? 0 }))
  .filter((point) => Number.isFinite(point.seconds) && point.seconds > 0);

function Preview() {
  const standings = useMemo(() => deriveStandings(fixtureV3, 40, { p5: 0.2, p7: -0.1 }), []);
  const advice = usePitwallStrategy({
    strategy: fixtureStrategy,
    v3: fixtureV3,
    plannedLaps: (fixtureStrategy.session_laps_remaining ?? 0) + (fixtureStrategy.last_completed_laps ?? 0),
    nowMs: Date.now(),
  });

  const currentStint = fixtureStints.find((stint) => stint.status === "in_car");
  const nextStints = fixtureStints.filter((stint) => stint.id !== currentStint?.id);

  return (
    <div className="min-h-screen bg-[#07080A] p-4 text-slate-200">
      <div className="mx-auto max-w-[1600px] space-y-3">
        <PitwallContextBar
          eyebrow="3SM · Endurance"
          title="6 uur van Spa-Francorchamps"
          state="live"
          items={[
            { label: "Team", value: teamName },
            { label: "Rijder", value: driverName, tone: "accent" },
            { label: "Auto", value: "Porsche 911 GT3 R" },
          ]}
          actions={
            <>
              <button type="button" className="flex min-h-9 items-center gap-2 rounded-lg bg-orange-500 px-3 text-[12px] font-bold text-white">
                Stints &amp; Race Control
              </button>
              <button type="button" className="rounded-lg bg-white/[0.06] px-2.5 py-1.5 text-[11px] font-bold text-slate-300 ring-1 ring-white/10">
                Focus mode
              </button>
            </>
          }
        />

        <PitwallDashboard
          kpi={<RaceTelemetryStrip v3={fixtureV3} live />}
          decision={<DecisionBand advice={advice} />}
          track={
            <>
              <LiveTrackPanel v3={fixtureV3} live fallbackTrack="Circuit de Spa-Francorchamps - Grand Prix" />
              <OwnCarPanel
                driverName={driverName}
                carName="Porsche 911 GT3 R"
                teamName={teamName}
                lastLapSeconds={fixtureV3.timing?.lastLapTimeSeconds ?? null}
                bestLapSeconds={fixtureV3.timing?.bestLapTimeSeconds ?? null}
                gapToLeaderSeconds={fixtureV3.position?.gapToLeaderSeconds ?? null}
              />
            </>
          }
          timing={<StandingsWidget standings={standings} ownCarLabel={teamName} ownCarNumber={null} live />}
          panels={[
            <PacePanel key="pace" strategy={fixtureStrategy} pace={{ lastLapSeconds: 103.162, bestLapSeconds: 102.513, stintAvgSeconds: 102.9, targetSeconds: null }} points={pacePoints} />,
            <StintDriverPanel key="driver" strategy={fixtureStrategy} plannedStints={nextStints} currentStint={currentStint} driverName={driverName} />,
            <FuelPanel key="fuel" strategy={fixtureStrategy} />,
            <VehicleTelemetryPanel key="tyres" v3={fixtureV3} live />,
          ]}
          extra={
            <>
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
                <StrategyForecast
                  strategy={fixtureStrategy}
                  position={{ overallPosition: 6, classPosition: 5, gapToLeaderSeconds: 12.3 }}
                  pace={{ lastLapSeconds: 103.162, bestLapSeconds: 102.513, stintAvgSeconds: 102.9, targetSeconds: null }}
                  plannedStints={fixtureStints}
                  nextDriverName="Jason"
                />
                <PitStrategyBlock strategy={fixtureStrategy} driverName={driverName} nextDriverName="Jason" pitLoss={null} />
              </div>
              <AlertZone alerts={fixtureAlerts} />
              <RaceTimeline events={fixtureEvents} plannedStints={fixtureStints} />
            </>
          }
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Preview />);
