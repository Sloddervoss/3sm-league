import type { PitwallStrategyRow, PitwallPositionData, PitwallPaceData, PitwallPlannedStint } from "./pitwallHelpers";
import { formatFuel, calcPitLap } from "./pitwallHelpers";

interface Props {
  strategy: PitwallStrategyRow | null;
  position: PitwallPositionData | null;
  pace: PitwallPaceData | null;
  plannedStints: PitwallPlannedStint[];
  nextDriverName: string | null;
}

export const StrategyForecast = ({ strategy, position, pace, plannedStints, nextDriverName }: Props) => {
  if (!strategy) {
    return <PanelShell title="FORECAST"><p className="text-xs text-gray-500">Geen data</p></PanelShell>;
  }

  const isLowData = strategy.strategy_status === "low_sample";
  const isInsufficient = strategy.strategy_status === "insufficient_data";
  const fuelLaps = strategy.fuel_laps_remaining;
  const pitLap = calcPitLap(strategy.last_completed_laps, fuelLaps);
  const nextStint = plannedStints.find((s) => s.status === "draft");

  return (
    <PanelShell title="FORECAST">
      {/* HUIDIG — compact inline */}
      <div className="mb-2">
        <div className="text-[9px] font-bold uppercase tracking-wider text-gray-600 mb-1">HUIDIG</div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
          <span className="text-gray-500">Pos <span className="font-bold text-white">
            {position?.overallPosition != null ? `P${position.overallPosition}${position.classPosition != null ? `/K${position.classPosition}` : ""}` : "—"}
          </span></span>
          <span className="text-gray-500">Brandstof <span className="font-bold text-white">
            {strategy.current_fuel_litres != null ? formatFuel(strategy.current_fuel_litres) : "—"}
          </span></span>
          <span className="text-gray-500">Ronden <span className="font-bold text-white">
            {fuelLaps != null ? `${fuelLaps.toFixed(1)}` : "—"}
          </span></span>
        </div>
      </div>

      {/* NEXT STOP */}
      {!isLowData && !isInsufficient && (
        <div className="mb-2">
          <div className="text-[9px] font-bold uppercase tracking-wider text-gray-600 mb-1">VOLGENDE STOP</div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
            <span className="text-gray-500">Ronde <span className="font-bold text-orange-400">{pitLap != null ? pitLap : "—"}</span></span>
            <span className="text-gray-500">Coureur <span className="font-bold text-orange-400">{nextDriverName ?? "—"}</span></span>
            <span className="text-gray-500">Brandstof <span className="font-bold text-white">
              {strategy.fuel_to_add_litres != null ? `+${formatFuel(strategy.fuel_to_add_litres)}` : "—"}
            </span></span>
            <span className="text-gray-500">Banden <span className="font-bold text-gray-300">wisselen</span></span>
          </div>
        </div>
      )}

      {/* DAARNA */}
      {nextStint && !isLowData && !isInsufficient && (
        <div className="mb-2">
          <div className="text-[9px] font-bold uppercase tracking-wider text-gray-600 mb-1">DAARNA</div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
            <span className="text-gray-500">Coureur <span className="font-bold text-gray-300">{nextStint.driver_id}</span></span>
            <span className="text-gray-500">Stint <span className="font-bold text-white">{nextStint.expected_laps}r</span></span>
            {nextStint.tyre_change && <span className="text-gray-500">Banden <span className="font-bold text-orange-400">wisselen</span></span>}
          </div>
        </div>
      )}

      {/* LOW DATA / INSUFFICIENT */}
      {isLowData && (
        <div className="rounded bg-yellow-500/10 px-2 py-1.5 text-[11px]">
          <span className="font-bold text-yellow-400">Weinig data</span>
          <span className="text-gray-400"> ({strategy.valid_fuel_sample_count} samples) — strategie niet betrouwbaar</span>
        </div>
      )}
      {isInsufficient && (
        <div className="rounded bg-gray-500/10 px-2 py-1.5 text-[11px]">
          <span className="font-bold text-gray-400">Geen data</span>
          <span className="text-gray-500"> — telemetrie verloren</span>
        </div>
      )}

      {/* SAMPLES */}
      {!isInsufficient && (
        <div className="text-[10px] text-gray-600 mt-1">
          {strategy.valid_fuel_sample_count} sample{strategy.valid_fuel_sample_count !== 1 ? "s" : ""}
          {strategy.current_stint_valid_sample_count > 0 && ` · ${strategy.current_stint_valid_sample_count} deze stint`}
        </div>
      )}
    </PanelShell>
  );
};

const PanelShell = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
    <div className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">{title}</div>
    {children}
  </div>
);