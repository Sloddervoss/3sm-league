import type { PitwallPaceData, PitwallStrategyRow } from "./pitwallHelpers";
import { formatLapTime } from "./pitwallHelpers";

interface Props {
  strategy: PitwallStrategyRow | null;
  pace: PitwallPaceData | null;
}

export const PacePanel = ({ strategy, pace }: Props) => {
  if (!strategy) {
    return <PanelShell title="PACE"><p className="text-xs text-gray-500">Geen data</p></PanelShell>;
  }

  const lastLap = pace?.lastLapSeconds;
  const bestLap = pace?.bestLapSeconds;
  const stintAvg = pace?.stintAvgSeconds;
  const target = pace?.targetSeconds;
  const delta = (lastLap != null && target != null) ? lastLap - target : null;

  const showAny = lastLap != null || stintAvg != null || target != null;

  if (!showAny) {
    return (
      <PanelShell title="PACE">
        <p className="text-xs text-gray-500">Geen rondetijd data</p>
      </PanelShell>
    );
  }

  return (
    <PanelShell title="PACE">
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
        {lastLap != null && (
          <span className="text-gray-500">Laatste <span className="font-bold font-mono text-white">{formatLapTime(lastLap)}</span></span>
        )}
        {bestLap != null && (
          <span className="text-gray-500">Beste <span className="font-bold font-mono text-gray-300">{formatLapTime(bestLap)}</span></span>
        )}
        {stintAvg != null && (
          <span className="text-gray-500">Stint <span className="font-bold font-mono text-white">{formatLapTime(stintAvg)}</span></span>
        )}
        {target != null && (
          <span className="text-gray-500">Doel <span className="font-bold font-mono text-white">{formatLapTime(target)}</span></span>
        )}
        {delta != null && (
          <span className={`font-bold text-[11px] ${delta < 0 ? "text-emerald-400" : "text-orange-400"}`}>
            Δ {delta >= 0 ? "+" : ""}{delta.toFixed(1)}s
          </span>
        )}
      </div>
    </PanelShell>
  );
};

const PanelShell = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
    <div className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">{title}</div>
    {children}
  </div>
);