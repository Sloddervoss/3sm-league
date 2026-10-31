import { createRoot } from "react-dom/client";
import { useMemo } from "react";
import { PitwallContextBar } from "../../../src/features/endurance/pitwall/PitwallContextBar";
import { PitwallDashboard } from "../../../src/features/endurance/pitwall/PitwallDashboard";
import { RaceTelemetryStrip } from "../../../src/features/endurance/pitwall/RaceTelemetryStrip";
import { DecisionBand } from "../../../src/features/endurance/pitwall/DecisionBand";
import { OwnCarPanel } from "../../../src/features/endurance/pitwall/OwnCarPanel";
import { LiveTrackPanel } from "../../../src/features/endurance/pitwall/LiveTrackPanel";
import { StandingsWidget } from "../../../src/features/endurance/pitwall/StandingsWidget";
import { PacePanel } from "../../../src/features/endurance/pitwall/PacePanel";
import { MySessionPanel } from "../../../src/features/endurance/pitwall/MySessionPanel";
import { FuelPanel } from "../../../src/features/endurance/pitwall/FuelPanel";
import { VehicleTelemetryPanel } from "../../../src/features/endurance/pitwall/VehicleTelemetryPanel";
import { TyreModelPanel } from "../../../src/features/endurance/pitwall/TyreModelPanel";
import { RawTelemetryDetails } from "../../../src/features/endurance/pitwall/RawTelemetryDetails";
import { deriveStandings } from "../../../src/features/endurance/pitwall/standings";
import { usePitwallStrategy } from "../../../src/features/endurance/pitwall/usePitwallStrategy";
import type { PitwallStrategyRow } from "../../../src/features/endurance/pitwall/pitwallHelpers";
import { fixtureSandboxLaps, fixtureSandboxPace, fixtureV3 } from "./fixtures";
import "./preview.css";

/*
 * Wat de testpagina van een apparaat krijgt: alleen tankinhoud, geen gebonden
 * race. Zelfde adaptervorm als `deviceStrategyRow`, hier als fixture.
 */
const deviceStrategy: PitwallStrategyRow = {
  race_run_id: "",
  event_id: "",
  team_id: "",
  fuel_per_lap_litres: null,
  race_fuel_per_lap_litres: null,
  fuel_laps_remaining: null,
  valid_fuel_sample_count: 0,
  current_stint_valid_sample_count: 0,
  current_fuel_stint: 0,
  last_completed_laps: fixtureV3.timing?.completedLaps ?? null,
  current_fuel_litres: fixtureV3.fuel?.fuelLitres ?? null,
  session_laps_remaining: fixtureV3.session?.sessionLapsRemaining ?? null,
  fuel_to_finish_litres: null,
  fuel_sufficient_to_finish: null,
  strategy_status: "insufficient_data",
  strategy_reason: null,
  updated_at: new Date().toISOString(),
  fuel_to_add_litres: null,
};

const points = fixtureSandboxLaps.map((lap) => ({ lap: lap.lap, seconds: lap.seconds }));

function Preview() {
  const standings = useMemo(() => deriveStandings(fixtureV3, 40), []);
  const advice = usePitwallStrategy({ strategy: deviceStrategy, v3: fixtureV3, nowMs: Date.now() });

  return (
    <div className="min-h-screen bg-[#07080A] p-4 text-slate-200" data-pitwall-mode="test">
      <div className="mx-auto max-w-[1600px] space-y-3">
        <PitwallContextBar
          eyebrow="3SM · Pitwall test"
          title="SIM-PC Vincent"
          state="live"
          items={[
            { label: "Circuit", value: "Circuit de Spa-Francorchamps - Grand Prix" },
            { label: "Connector", value: "0.7.2.1" },
            { label: "Laatst gezien", value: "nu" },
          ]}
          actions={<span className="text-[11px] text-slate-500">nu · Realtime</span>}
        />

        <PitwallDashboard
          kpi={<RaceTelemetryStrip v3={fixtureV3} live />}
          decision={<DecisionBand advice={advice} />}
          track={<><LiveTrackPanel v3={fixtureV3} live fallbackTrack="Circuit de Spa-Francorchamps - Grand Prix" /><OwnCarPanel driverName={fixtureV3.identity?.currentDriverName ?? null} carName={fixtureV3.identity?.carName ?? null} teamName={null} carNumber={fixtureV3.opponents?.find(c => c.isPlayer)?.carNumber} completedLaps={fixtureV3.timing?.completedLaps} lastLapSeconds={fixtureV3.timing?.lastLapTimeSeconds ?? null} bestLapSeconds={fixtureV3.timing?.bestLapTimeSeconds ?? null} gapToLeaderSeconds={fixtureV3.position?.gapToLeaderSeconds ?? null} /></>}
          timing={<StandingsWidget standings={standings} ownCarLabel="Porsche 911 GT3 R" ownCarNumber={null} live />}
          panels={[
            <PacePanel v3={fixtureV3} live key="pace" strategy={deviceStrategy} pace={null} lapTimes={[]} points={points} />,
            <MySessionPanel
              key="session"
              driverName="Vincent"
              carName="Porsche 911 GT3 R"
              recordedLaps={fixtureSandboxPace.count}
              fastestSeconds={fixtureSandboxPace.fastest}
              medianSeconds={fixtureSandboxPace.median}
            />,
            <FuelPanel key="fuel" strategy={deviceStrategy} />,
            <VehicleTelemetryPanel key="tyres" v3={fixtureV3} live />,
          ]}
          extra={
            <>
              <TyreModelPanel estimate={null} bron="geen" coverage={[]} />
              <RawTelemetryDetails value={fixtureV3} />
            </>
          }
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Preview />);
