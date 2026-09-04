import type { PitwallStrategyRow } from "./pitwallHelpers";
import { strategyStatusInfo, formatFuel, formatLaps, formatSeconds, calcPitLap, calcFuelToAdd } from "./pitwallHelpers";

interface Props {
  strategy: PitwallStrategyRow | null;
  currentFuel: number | null;
  driverName: string | null;
  nextDriverName?: string | null;
}

export const PitStrategyBlock = ({ strategy, currentFuel, driverName, nextDriverName }: Props) => {
  if (!strategy) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-5 text-center">
        <p className="text-sm text-gray-500">Geen strategiedata — wacht op telemetrie</p>
      </div>
    );
  }

  const status = strategyStatusInfo(strategy.strategy_status, strategy.strategy_reason);
  const completedLaps = strategy.last_completed_laps;
  const fuelLaps = strategy.fuel_laps_remaining;
  const pitLap = calcPitLap(completedLaps, fuelLaps);
  const fuelPerLap = strategy.fuel_per_lap_litres;
  const fuelToAdd = calcFuelToAdd(
    strategy.current_fuel_litres,
    fuelPerLap,
    fuelLaps,
  );

  return (
    <div className="rounded-2xl border border-orange-500/30 bg-gradient-to-br from-orange-500/[0.08] to-orange-950/[0.12] p-5 ring-1 ring-orange-500/15">
      <div className="mb-3 text-[11px] font-black uppercase tracking-widest text-orange-400">PIT ACTIE</div>

      <div className="space-y-3">
        {pitLap != null ? (
          <div>
            <div className="text-3xl font-black text-white tracking-tight">
              PIT IN {Math.max(0, pitLap - (completedLaps ?? 0))} RONDEN
            </div>
            <div className="text-xs text-gray-500 mt-1">Ronde {pitLap} ({formatLaps(fuelLaps)} over)</div>
          </div>
        ) : (
          <div className="text-lg font-bold text-gray-400">PIT IN: —</div>
        )}

        <div className="flex flex-wrap gap-4 text-sm">
          {fuelToAdd != null ? (
            <div className="rounded-xl bg-black/30 px-3 py-2">
              <span className="text-gray-400">Brandstof</span>
              <div className="font-bold text-white">+{formatFuel(fuelToAdd)}</div>
            </div>
          ) : (
            <div className="rounded-xl bg-black/30 px-3 py-2">
              <span className="text-gray-400">Brandstof</span>
              <div className="text-sm text-gray-500">berekening niet beschikbaar</div>
            </div>
          )}

          <div className="rounded-xl bg-black/30 px-3 py-2">
            <span className="text-gray-400">Banden</span>
            <div className="font-bold text-gray-300">geen plan</div>
          </div>

          <div className="rounded-xl bg-black/30 px-3 py-2">
            <span className="text-gray-400">Coureur</span>
            <div className="font-bold text-white">
              {driverName ?? "—"}
              {nextDriverName && <span className="text-orange-400"> → {nextDriverName}</span>}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs pt-1">
          <span className={`inline-block h-2 w-2 rounded-full ${
            status.tone === "green" ? "bg-emerald-400" :
            status.tone === "yellow" ? "bg-yellow-400" :
            status.tone === "red" ? "bg-red-400" : "bg-gray-500"
          }`} />
          <span className="text-gray-400">{status.label}</span>
        </div>
      </div>
    </div>
  );
};