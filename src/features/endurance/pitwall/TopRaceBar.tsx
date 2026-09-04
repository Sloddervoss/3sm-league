import type { PitwallStrategyRow } from "./pitwallHelpers";
import { formatFuel, formatLaps } from "./pitwallHelpers";

interface Props {
  strategy: PitwallStrategyRow | null;
}

export const TopRaceBar = ({ strategy }: Props) => {
  if (!strategy) {
    return (
      <div className="rounded-xl bg-black/40 px-4 py-3 text-center text-sm text-gray-500 ring-1 ring-white/5">
        Geen live data
      </div>
    );
  }

  const fuelLaps = strategy.fuel_laps_remaining;
  const completedLaps = strategy.last_completed_laps;
  const currentFuel = strategy.current_fuel_litres;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-black/40 px-4 py-2.5 text-sm ring-1 ring-white/5">
      <DataPill label={completedLaps != null ? `LAP ${completedLaps}` : "LAP —"} />
      <DataPill label={currentFuel != null ? `⛽ ${formatFuel(currentFuel)}` : "⛽ —"} />
      <DataPill label={fuelLaps != null ? `${formatLaps(fuelLaps)} over` : "—"} />
      {fuelLaps != null && fuelLaps < 5 && (
        <span className="rounded-md bg-orange-500/20 px-2 py-0.5 font-bold text-orange-400 text-xs whitespace-nowrap">
          PIT IN {Math.floor(fuelLaps)}
        </span>
      )}
    </div>
  );
};

const DataPill = ({ label }: { label: string }) => (
  <span className="whitespace-nowrap font-mono text-xs text-gray-300">{label}</span>
);