import type { PitwallStrategyRow } from "./pitwallHelpers";
import { strategyStatusInfo, formatFuel, formatLaps, calcPitLap } from "./pitwallHelpers";

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
  const isLowData = strategy.strategy_status === "low_sample";
  const isInsufficient = strategy.strategy_status === "insufficient_data";
  const completedLaps = strategy.last_completed_laps;
  const fuelLaps = strategy.fuel_laps_remaining;
  const pitLap = calcPitLap(completedLaps, fuelLaps);
  const pitInLaps = pitLap != null && completedLaps != null ? Math.max(0, pitLap - completedLaps) : null;
  const isPitThisLap = fuelLaps != null && fuelLaps < 1.5;

  /* Use strategy's fuel_to_add if available, else calculate */
  const fuelToAdd = strategy.fuel_to_add_litres ?? (
    isLowData ? null : pitLap != null ? null : null
  );
  const showFuelToAdd = fuelToAdd != null && !isLowData && !isInsufficient;
  const showFuelCalcMissing = !isLowData && !isInsufficient && !showFuelToAdd && pitLap != null;

  return (
    <div className={`rounded-2xl border p-5 ring-1 ${
      isPitThisLap
        ? "border-red-500/40 bg-gradient-to-br from-red-500/[0.10] to-red-950/[0.15] ring-red-500/20"
        : isLowData || isInsufficient
          ? "border-yellow-500/20 bg-gradient-to-br from-yellow-500/[0.04] to-yellow-950/[0.08] ring-yellow-500/10"
          : "border-orange-500/30 bg-gradient-to-br from-orange-500/[0.08] to-orange-950/[0.12] ring-orange-500/15"
    }`}>
      {/* HEADLINE */}
      {isPitThisLap ? (
        <div className="mb-4 text-center">
          <div className="text-[13px] font-black uppercase tracking-widest text-red-400">PIT ACTIE</div>
          <div className="mt-1 text-2xl font-black text-red-300 tracking-tight">PIT DEZE RONDE</div>
          <div className="mt-1 text-sm text-gray-400">
            Brandstof kritiek — {formatFuel(strategy.current_fuel_litres ?? 0)} / {fuelLaps != null ? `${fuelLaps.toFixed(1)} ronden` : "—"}
          </div>
        </div>
      ) : isLowData ? (
        <div className="mb-3">
          <div className="text-[11px] font-black uppercase tracking-widest text-yellow-400">PIT ACTIE</div>
          <div className="mt-1 text-xl font-black text-yellow-300 tracking-tight">
            STRATEGIE NOG NIET BETROUWBAAR
          </div>
          <div className="mt-1 text-sm text-gray-400">
            Nog te weinig data — {strategy.valid_fuel_sample_count} sample(s)
          </div>
        </div>
      ) : isInsufficient ? (
        <div className="mb-3">
          <div className="text-[11px] font-black uppercase tracking-widest text-gray-500">PIT ACTIE</div>
          <div className="mt-1 text-lg font-bold text-gray-400 tracking-tight">
            Telemetrie verloren
          </div>
          <div className="mt-1 text-sm text-gray-500">Strategie tijdelijk niet beschikbaar</div>
        </div>
      ) : (
        <div className="mb-4">
          <div className="text-[11px] font-black uppercase tracking-widest text-orange-400">PIT ACTIE</div>
          {pitInLaps != null && (
            <div className="mt-1 text-3xl font-black text-white tracking-tight">
              PIT IN {pitInLaps} RONDEN
            </div>
          )}
          {pitLap != null && (
            <div className="text-xs text-gray-500 mt-1">
              {fuelLaps != null && `Ronde ${pitLap} (${formatLaps(fuelLaps)} over)`}
            </div>
          )}
        </div>
      )}

      {/* SUB-ACTIONS — only show when strategy is trustworthy */}
      {!isLowData && !isInsufficient && (
        <div className="flex flex-wrap gap-3 text-sm">
          {/* FUEL */}
          <div className="rounded-xl bg-black/30 px-3 py-2.5 min-w-[80px]">
            <span className="block text-[10px] uppercase tracking-wider text-gray-500 font-bold">Brandstof</span>
            <div className="mt-0.5 font-bold text-white text-base">
              {showFuelToAdd ? `+${formatFuel(fuelToAdd)}` : showFuelCalcMissing ? "—" : "—"}
            </div>
            {(isPitThisLap && isNaN(strategy.current_fuel_litres ?? NaN)) ? (
              <div className="text-[10px] text-gray-500">berekening niet beschikbaar</div>
            ) : null}
          </div>

          {/* TYRES */}
          <div className="rounded-xl bg-black/30 px-3 py-2.5 min-w-[80px]">
            <span className="block text-[10px] uppercase tracking-wider text-gray-500 font-bold">Banden</span>
            <div className="mt-0.5 font-bold text-gray-300 text-base">wisselen</div>
          </div>

          {/* DRIVER */}
          <div className="rounded-xl bg-black/30 px-3 py-2.5 min-w-[100px]">
            <span className="block text-[10px] uppercase tracking-wider text-gray-500 font-bold">Coureur</span>
            <div className="mt-0.5 font-bold text-white text-base">
              {driverName ?? "—"}
              {nextDriverName && <span className="ml-0.5 text-orange-400"> → {nextDriverName}</span>}
            </div>
          </div>
        </div>
      )}

      {/* STATUS */}
      <div className="flex items-center gap-2 text-xs mt-3 pt-2 border-t border-white/5">
        <span className={`inline-block h-2 w-2 rounded-full ${
          status.tone === "green" ? "bg-emerald-400" :
          status.tone === "yellow" ? "bg-yellow-400" :
          status.tone === "red" ? "bg-red-400" : "bg-gray-500"
        }`} />
        <span className="text-gray-400">{status.label}</span>
        {status.reason && <span className="text-gray-500">— {status.reason}</span>}
      </div>
    </div>
  );
};