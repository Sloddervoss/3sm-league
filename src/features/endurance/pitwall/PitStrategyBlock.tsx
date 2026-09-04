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
      <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.02] p-4 text-center">
        <p className="text-sm text-gray-500">Geen strategie — wacht op telemetrie</p>
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

  const fuelToAdd = strategy.fuel_to_add_litres ?? null;
  const showFuelToAdd = fuelToAdd != null && !isLowData && !isInsufficient;

  return (
    <div className={`rounded-lg border p-4 ring-1 ${
      isPitThisLap
        ? "border-red-500/40 bg-gradient-to-br from-red-500/[0.10] to-red-950/[0.15] ring-red-500/20"
        : isLowData || isInsufficient
          ? "border-yellow-500/20 bg-gradient-to-br from-yellow-500/[0.04] to-yellow-950/[0.08] ring-yellow-500/10"
          : "border-orange-500/30 bg-gradient-to-br from-orange-500/[0.08] to-orange-950/[0.12] ring-orange-500/15"
    }`}>
      {/* HEADLINE */}
      {isPitThisLap ? (
        <div className="text-center mb-3">
          <div className="text-[10px] font-black uppercase tracking-widest text-red-400">PIT ACTIE</div>
          <div className="mt-0.5 text-2xl font-black text-red-300 tracking-tight">PIT DEZE RONDE</div>
          <div className="mt-0.5 text-xs text-gray-400">
            {formatFuel(strategy.current_fuel_litres ?? 0)} — {fuelLaps != null ? `${fuelLaps.toFixed(1)} ronden` : "—"}
          </div>
        </div>
      ) : isLowData ? (
        <div className="mb-3">
          <div className="text-[10px] font-black uppercase tracking-widest text-yellow-400">PIT ACTIE</div>
          <div className="mt-0.5 text-lg font-black text-yellow-300 tracking-tight">
            STRATEGIE ONBETROUWBAAR
          </div>
          <div className="mt-0.5 text-xs text-gray-400">{strategy.valid_fuel_sample_count} sample(s)</div>
        </div>
      ) : isInsufficient ? (
        <div className="mb-3">
          <div className="text-[10px] font-black uppercase tracking-widest text-gray-500">PIT ACTIE</div>
          <div className="mt-0.5 text-lg font-bold text-gray-400">Telemetrie verloren</div>
          <div className="mt-0.5 text-xs text-gray-500">Strategie niet beschikbaar</div>
        </div>
      ) : (
        <div className="mb-3">
          <div className="text-[10px] font-black uppercase tracking-widest text-orange-400">PIT ACTIE</div>
          {pitInLaps != null && (
            <div className="mt-0.5 text-3xl font-black text-white tracking-tight leading-none">
              PIT IN {pitInLaps}
            </div>
          )}
          {pitLap != null && (
            <div className="mt-0.5 text-xs text-gray-500">
              Ronde {pitLap}{fuelLaps != null ? ` — ${formatLaps(fuelLaps)} over` : ""}
            </div>
          )}
        </div>
      )}

      {/* SUB-ACTIONS — only when trustworthy */}
      {!isLowData && !isInsufficient && (
        <div className="flex gap-2 text-sm mb-3">
          <ActionItem label="Brandstof" value={showFuelToAdd ? `+${formatFuel(fuelToAdd)}` : "—"} />
          <ActionItem label="Banden" value="wisselen" />
          <ActionItem
            label="Coureur"
            value={
              <>
                {driverName ?? "—"}
                {nextDriverName && <span className="text-orange-400"> → {nextDriverName}</span>}
              </>
            }
          />
        </div>
      )}

      {/* STATUS */}
      <div className="flex items-center gap-1.5 text-[11px] pt-2 border-t border-white/5">
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${
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

const ActionItem = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="flex-1 rounded-lg bg-black/30 px-2.5 py-1.5 text-center min-w-0">
    <div className="text-[9px] font-bold uppercase tracking-widest text-gray-500">{label}</div>
    <div className="mt-0.5 font-bold text-white text-xs">{value}</div>
  </div>
);