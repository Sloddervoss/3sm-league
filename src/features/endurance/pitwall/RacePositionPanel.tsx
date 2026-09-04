import type { PitwallStrategyRow } from "./pitwallHelpers";
import { formatSeconds } from "./pitwallHelpers";

interface Props {
  strategy: PitwallStrategyRow | null;
}

export const RacePositionPanel = ({ strategy }: Props) => {
  /* Position/laps not in strategy_latest — requires V3 telemetry */
  const completedLaps = strategy?.last_completed_laps;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <h3 className="mb-3 text-[11px] font-black uppercase tracking-widest text-gray-500">RACE POSITIE</h3>

      <div className="space-y-2 text-sm">
        <Row label="Overall" value="—" note="vereist V3 telemetrie" />
        <Row label="Klasse" value="—" note="vereist V3 telemetrie" />
        <Row label="Ronde" value={completedLaps != null ? String(completedLaps) : "—"} />
        <Row label="Gap leider" value="—" note="vereist V3 telemetrie" />
      </div>
    </div>
  );
};

const Row = ({ label, value, note }: { label: string; value: string; note?: string }) => (
  <div className="flex items-center justify-between">
    <span className="text-gray-400">{label}</span>
    <div className="text-right">
      <div className="font-mono font-bold text-white">{value}</div>
      {note && <div className="text-[10px] text-gray-600">{note}</div>}
    </div>
  </div>
);