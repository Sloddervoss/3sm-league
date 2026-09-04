import type { PitwallStrategyRow, PitwallPaceTarget } from "./pitwallHelpers";

interface Props {
  strategy: PitwallStrategyRow | null;
  paceTargets: PitwallPaceTarget[];
}

export const PacePanel = ({ strategy, paceTargets }: Props) => {
  const lastLapSeconds = null; /* last lap time is in events, not in strategy_latest */

  /* Best lap is not available in current V3 data — only in events payload */
  const bestTarget = paceTargets?.[0];

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <h3 className="mb-3 text-[11px] font-black uppercase tracking-widest text-gray-500">PACE</h3>

      <div className="space-y-2 text-sm">
        <Row label="Laatste ronde" value={lastLapSeconds != null ? `${lastLapSeconds.toFixed(3)}s` : "—"} />
        <Row label="Beste ronde" value={bestTarget?.best_lap_seconds != null ? `${bestTarget.best_lap_seconds.toFixed(3)}s` : (lastLapSeconds != null ? "—" : "—")} />
        <Row label="Doel" value={bestTarget?.average_lap_seconds != null ? `${bestTarget.average_lap_seconds.toFixed(3)}s` : "—"} />
      </div>

      {(!bestTarget || !lastLapSeconds) && (
        <p className="mt-2 text-[11px] text-gray-500">
          {!lastLapSeconds && !bestTarget ? "Geen rondetijd data beschikbaar" :
           !lastLapSeconds ? "Geen live rondetijd (vereist V3 timing)" :
           "Geen doeltijd in PacePanel"}
        </p>
      )}
    </div>
  );
};

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-center justify-between">
    <span className="text-gray-400">{label}</span>
    <span className="font-mono font-bold text-white">{value}</span>
  </div>
);