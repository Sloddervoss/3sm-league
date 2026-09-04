import type { PitwallStrategyRow, PitwallPositionData } from "./pitwallHelpers";

interface Props {
  strategy: PitwallStrategyRow | null;
  position: PitwallPositionData | null;
}

export const RacePositionPanel = ({ strategy, position }: Props) => {
  if (!strategy) {
    return <PanelShell title="POSITIE"><p className="text-xs text-gray-500">Geen data</p></PanelShell>;
  }

  const completedLaps = strategy.last_completed_laps;
  const ov = position?.overallPosition;
  const cls = position?.classPosition;
  const gap = position?.gapToLeaderSeconds;

  return (
    <PanelShell title="POSITIE">
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
        <span className="text-gray-500">Overall <span className="font-bold text-white">{ov != null ? `P${ov}` : "—"}</span></span>
        <span className="text-gray-500">Klasse <span className="font-bold text-orange-300">{cls != null ? `K${cls}` : "—"}</span></span>
        <span className="text-gray-500">Ronde <span className="font-bold text-white">{completedLaps ?? "—"}</span></span>
        <span className="text-gray-500">Gap <span className="font-bold text-white">{gap != null ? `+${gap.toFixed(1)}s` : "—"}</span></span>
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