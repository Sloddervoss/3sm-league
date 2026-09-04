import type { PitwallStrategyRow, PitwallPositionData, PitwallPaceData, PitwallPlannedStint } from "./pitwallHelpers";
import { formatFuel, formatSeconds, formatLapTime, calcPitLap } from "./pitwallHelpers";

interface Props {
  strategy: PitwallStrategyRow | null;
  position: PitwallPositionData | null;
  pace: PitwallPaceData | null;
  plannedStints: PitwallPlannedStint[];
  nextDriverName: string | null;
}

export const StrategyForecast = ({ strategy, position, pace, plannedStints, nextDriverName }: Props) => {
  if (!strategy) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
        <h3 className="mb-3 text-[11px] font-black uppercase tracking-widest text-gray-500">STRATEGIE FORECAST</h3>
        <p className="text-sm text-gray-500">Geen strategiedata</p>
      </div>
    );
  }

  const isLowData = strategy.strategy_status === "low_sample";
  const isInsufficient = strategy.strategy_status === "insufficient_data";

  const completedLaps = strategy.last_completed_laps;
  const fuelLaps = strategy.fuel_laps_remaining;
  const pitLap = calcPitLap(completedLaps, fuelLaps);

  const nextStint = plannedStints.find((s) => s.status === "draft");

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <h3 className="mb-3 text-[11px] font-black uppercase tracking-widest text-gray-400">STRATEGIE FORECAST</h3>

      <div className="space-y-4">
        {/* CURRENT */}
        <div>
          <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-600">HUIDIG</div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <ForecastRow label="Positie" value={
              position?.overallPosition != null
                ? `P${position.overallPosition}${position.classPosition != null ? ` / K${position.classPosition}` : ""}`
                : "—"
            } />
            <ForecastRow label="Brandstof" value={strategy.current_fuel_litres != null ? formatFuel(strategy.current_fuel_litres) : "—"} />
            <ForecastRow label="Per ronde" value={strategy.fuel_per_lap_litres != null ? `${strategy.fuel_per_lap_litres.toFixed(3)}L` : "—"} />
            <ForecastRow label="Ronden over" value={fuelLaps != null ? `${fuelLaps.toFixed(1)}` : "—"} />
          </div>
        </div>

        {/* NEXT STOP */}
        {!isLowData && !isInsufficient && (
          <div>
            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-600">VOLGENDE STOP</div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <ForecastRow label="Verwacht" value={pitLap != null ? `Ronde ${pitLap}` : "—"} />
              <ForecastRow label="Coureur" value={nextDriverName ?? "—"} highlight />
              <ForecastRow label="Brandstof" value={
                strategy.fuel_to_add_litres != null
                  ? `+${formatFuel(strategy.fuel_to_add_litres)}`
                  : "—"
              } />
              <ForecastRow label="Banden" value="wisselen" />
            </div>
          </div>
        )}

        {/* LOW DATA / INSUFFICIENT */}
        {isLowData && (
          <div className="rounded-lg bg-yellow-500/8 px-3 py-2.5 text-xs">
            <span className="font-bold text-yellow-400">Nog te weinig data</span>
            <span className="ml-1 text-gray-400">({strategy.valid_fuel_sample_count} sample(s)). Actuele data wordt getoond maar strategie is nog niet betrouwbaar.</span>
          </div>
        )}
        {isInsufficient && (
          <div className="rounded-lg bg-gray-500/10 px-3 py-2.5 text-xs">
            <span className="font-bold text-gray-400">Strategie niet beschikbaar</span>
            <span className="ml-1 text-gray-500">— telemetrie verbinding verloren</span>
          </div>
        )}

        {/* AFTER THAT — next stint estimate */}
        {nextStint && !isLowData && !isInsufficient && (
          <div>
            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-600">DAARNA</div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <ForecastRow label="Coureur" value={nextStint.driver_id} />
              <ForecastRow label="Stint" value={`${nextStint.expected_laps}r`} />
              {nextStint.tyre_change && <ForecastRow label="Banden" value="wisselen" />}
            </div>
          </div>
        )}

        {/* SAMPLES / STATUS */}
        {!isInsufficient && (
          <div className="flex items-center gap-2 text-[11px] pt-1 border-t border-white/5">
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${
              strategy.strategy_status === "ready" ? "bg-emerald-400" :
              strategy.strategy_status === "low_sample" ? "bg-yellow-400" : "bg-gray-500"
            }`} />
            <span className="text-gray-500">
              {strategy.valid_fuel_sample_count} sample{strategy.valid_fuel_sample_count !== 1 ? "s" : ""}
              {strategy.current_stint_valid_sample_count > 0 && ` · ${strategy.current_stint_valid_sample_count} deze stint`}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

const ForecastRow = ({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) => (
  <div className="rounded-lg bg-black/20 px-2.5 py-1.5">
    <div className="text-[10px] text-gray-500">{label}</div>
    <div className={`font-bold font-mono ${highlight ? "text-orange-400" : "text-white"}`}>{value}</div>
  </div>
);