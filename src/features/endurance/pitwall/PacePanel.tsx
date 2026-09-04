import type { PitwallPaceData, PitwallStrategyRow } from "./pitwallHelpers";
import { formatLapTime, formatDelta } from "./pitwallHelpers";

interface Props {
  strategy: PitwallStrategyRow | null;
  pace: PitwallPaceData | null;
}

export const PacePanel = ({ strategy, pace }: Props) => {
  if (!strategy) {
    return <PanelShell title="PACE"><p className="text-sm text-gray-500">Geen data</p></PanelShell>;
  }

  const lastLap = pace?.lastLapSeconds;
  const bestLap = pace?.bestLapSeconds;
  const stintAvg = pace?.stintAvgSeconds;
  const target = pace?.targetSeconds;

  const delta = (lastLap != null && target != null) ? lastLap - target : null;
  const deltaInfo = delta != null ? { text: `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}s`, faster: delta < 0 } : null;

  const showPaceSection = lastLap != null || stintAvg != null || target != null;

  if (!showPaceSection) {
    return (
      <PanelShell title="PACE">
        <p className="text-sm text-gray-500">Geen rondetijd data in deze scenario</p>
        {strategy.strategy_status === "ready" && (
          <p className="mt-1 text-[11px] text-gray-600">Vereist V3 timing data of pace targets</p>
        )}
      </PanelShell>
    );
  }

  return (
    <PanelShell title="PACE">
      <div className="space-y-2 text-sm">
        {/* Last lap */}
        <div className="flex items-center justify-between">
          <span className="text-gray-400">Laatste ronde</span>
          <span className="font-mono font-bold text-white">{formatLapTime(lastLap)}</span>
        </div>

        {/* Best lap — secondary */}
        {bestLap != null && (
          <div className="flex items-center justify-between">
            <span className="text-gray-400">Beste</span>
            <span className="font-mono font-bold text-gray-300">{formatLapTime(bestLap)}</span>
          </div>
        )}

        {/* Stint average */}
        {stintAvg != null && (
          <div className="flex items-center justify-between">
            <span className="text-gray-400">Stint gem.</span>
            <span className="font-mono font-bold text-white">{formatLapTime(stintAvg)}</span>
          </div>
        )}

        {/* Target */}
        {target != null && (
          <div className="flex items-center justify-between">
            <span className="text-gray-400">Doel</span>
            <span className="font-mono font-bold text-white">{formatLapTime(target)}</span>
          </div>
        )}

        {/* Delta */}
        {deltaInfo && (
          <div className="flex items-center justify-between rounded-lg bg-black/20 px-2 py-1.5">
            <span className="text-gray-400 text-xs font-bold uppercase tracking-wider">Delta</span>
            <span className={`font-mono font-black text-sm ${
              deltaInfo.faster ? "text-emerald-400" : "text-orange-400"
            }`}>
              {deltaInfo.faster ? "−" : "+"}{delta != null ? Math.abs(delta).toFixed(1) : "—"}s
            </span>
          </div>
        )}
      </div>
    </PanelShell>
  );
};

const PanelShell = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
    <h3 className="mb-3 text-[11px] font-black uppercase tracking-widest text-gray-500">{title}</h3>
    {children}
  </div>
);