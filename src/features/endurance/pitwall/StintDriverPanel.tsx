import type { PitwallStrategyRow, PitwallPlannedStint } from "./pitwallHelpers";

interface Props {
  strategy: PitwallStrategyRow | null;
  plannedStints: PitwallPlannedStint[];
  driverName: string | null;
}

export const StintDriverPanel = ({ strategy, plannedStints, driverName }: Props) => {
  const current = plannedStints?.find((s) => s.status === "in_car" || s.status === "ready");
  const rest = plannedStints?.filter((s) => s.id !== current?.id);
  const firstNext = rest?.[0];
  const secondNext = rest?.[1];

  if (!strategy || !current) {
    return <PanelShell title="COUREUR"><p className="text-xs text-gray-500">Geen data</p></PanelShell>;
  }

  const stintLaps = strategy.current_stint_valid_sample_count ?? null;

  return (
    <PanelShell title="COUREUR">
      {/* NU */}
      <div className="mb-1.5">
        <div className="text-[9px] font-bold uppercase tracking-wider text-gray-500">NU</div>
        <div className="font-black text-white text-lg leading-tight">{driverName ?? current?.driver_id ?? "—"}</div>
        {stintLaps != null && (
          <div className="text-[11px] text-gray-400">{stintLaps} ronden{current?.expected_laps ? ` / max ${current.expected_laps}r` : ""}</div>
        )}
      </div>

      {/* VOLGENDE */}
      {firstNext && (
        <div className="mb-1">
          <div className="text-[9px] font-bold uppercase tracking-wider text-gray-500">VOLGENDE</div>
          <div className="font-bold text-orange-400 text-sm">{firstNext.driver_id}</div>
          <div className="text-[10px] text-gray-500">{firstNext.expected_laps}r{firstNext.tyre_change ? " · banden" : ""}</div>
        </div>
      )}

      {/* DAARNA */}
      {secondNext && (
        <div className="mb-1 text-[10px]">
          <span className="text-gray-500">Daarna: </span>
          <span className="font-bold text-gray-300">{secondNext.driver_id}</span>
          <span className="text-gray-500"> · {secondNext.expected_laps}r{secondNext.tyre_change ? " · banden" : ""}</span>
        </div>
      )}

      {/* PLAN — compact sequence */}
      {rest && rest.length > 0 && (
        <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-gray-500 pt-1 mt-1 border-t border-white/5">
          {rest.slice(0, 4).map((stint) => (
            <span key={stint.id}>
              <span className="font-bold text-gray-400">{stint.driver_id}</span>
              <span> {stint.expected_laps}r</span>
              {stint.tyre_change && <span className="text-orange-500"> ⚡</span>}
            </span>
          ))}
        </div>
      )}
    </PanelShell>
  );
};

const PanelShell = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
    <div className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">{title}</div>
    {children}
  </div>
);