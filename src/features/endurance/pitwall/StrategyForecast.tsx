import type { PitwallStrategyRow } from "./pitwallHelpers";
import { calcPitLap, calcFuelToAdd, formatFuel } from "./pitwallHelpers";

interface Props {
  strategy: PitwallStrategyRow | null;
}

export const StrategyForecast = ({ strategy }: Props) => {
  if (!strategy) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
        <h3 className="mb-3 text-[11px] font-black uppercase tracking-widest text-gray-500">STRATEGIE FORECAST</h3>
        <p className="text-sm text-gray-500">Geen strategiedata</p>
      </div>
    );
  }

  const completedLaps = strategy.last_completed_laps;
  const fuelLaps = strategy.fuel_laps_remaining;
  const pitLap = calcPitLap(completedLaps, fuelLaps);
  const fuelToAdd = calcFuelToAdd(strategy.current_fuel_litres, strategy.fuel_per_lap_litres, fuelLaps);

  return (
    <div className="rounded-2xl border border-orange-500/20 bg-white/[0.02] p-4">
      <h3 className="mb-3 text-[11px] font-black uppercase tracking-widest text-orange-400">STRATEGIE FORECAST</h3>

      <div className="space-y-4">
        {/* Current state */}
        <div>
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-gray-600">HUIDIG</div>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <ForecastCard label="Brandstof" value={strategy.current_fuel_litres != null ? formatFuel(strategy.current_fuel_litres) : "—"} />
            <ForecastCard label="Per ronde" value={strategy.fuel_per_lap_litres != null ? `${strategy.fuel_per_lap_litres.toFixed(3)}L` : "—"} />
            <ForecastCard label="Ronden over" value={fuelLaps != null ? `${fuelLaps.toFixed(1)}` : "—"} />
          </div>
        </div>

        {/* Next stop */}
        <div>
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-gray-600">VOLGENDE STOP</div>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <ForecastCard label="Pit ronde" value={pitLap != null ? String(pitLap) : "—"} />
            <ForecastCard label="Bijvullen" value={fuelToAdd != null ? formatFuel(fuelToAdd) : "—"} />
            <ForecastCard label="Banden" value="geen plan" note />
          </div>
        </div>

        {/* Status */}
        <div className="flex items-center gap-2 text-xs pt-1">
          <span className={`inline-block h-2 w-2 rounded-full ${
            strategy.strategy_status === "ready" ? "bg-emerald-400" :
            strategy.strategy_status === "low_sample" ? "bg-yellow-400" :
            "bg-gray-500"
          }`} />
          <span className="text-gray-400">{strategy.strategy_status === "ready" ? `${strategy.valid_fuel_sample_count} samples` : strategy.strategy_status}</span>
        </div>
      </div>
    </div>
  );
};

const ForecastCard = ({ label, value, note }: { label: string; value: string; note?: boolean }) => (
  <div className="rounded-lg bg-black/20 px-2.5 py-2 text-center">
    <div className="text-[10px] text-gray-500">{label}</div>
    <div className={`font-bold font-mono ${note ? "text-gray-500" : "text-white"}`}>{value}</div>
  </div>
);