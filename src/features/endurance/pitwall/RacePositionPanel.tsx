import type { PitwallStrategyRow, PitwallPositionData } from "./pitwallHelpers";
import { formatSeconds } from "./pitwallHelpers";

interface Props {
  strategy: PitwallStrategyRow | null;
  position: PitwallPositionData | null;
}

export const RacePositionPanel = ({ strategy, position }: Props) => {
  if (!strategy) {
    return <PanelShell title="RACE POSITIE"><p className="text-sm text-gray-500">Geen data</p></PanelShell>;
  }

  const completedLaps = strategy.last_completed_laps;
  const ov = position?.overallPosition;
  const cls = position?.classPosition;
  const gap = position?.gapToLeaderSeconds;

  return (
    <PanelShell title="RACE POSITIE">
      <div className="space-y-2 text-sm">
        <Row
          label="Overall"
          value={ov != null ? `P${ov}` : "—"}
          note={ov == null ? "vereist V3 telemetrie" : undefined}
        />
        <Row
          label="Klasse"
          value={cls != null ? `K${cls}` : "—"}
          note={cls == null ? "vereist V3 telemetrie" : undefined}
        />
        <Row label="Ronde" value={completedLaps != null ? String(completedLaps) : "—"} />
        <Row
          label="Gap leider"
          value={gap != null ? `+${gap.toFixed(1)}s` : "—"}
          note={gap == null ? "vereist V3 telemetrie" : undefined}
        />
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

const Row = ({ label, value, note }: { label: string; value: string; note?: string }) => (
  <div className="flex items-center justify-between">
    <span className="text-gray-400">{label}</span>
    <div className="text-right">
      <div className="font-mono font-bold text-white">{value}</div>
      {note && <div className="text-[10px] text-gray-600">{note}</div>}
    </div>
  </div>
);