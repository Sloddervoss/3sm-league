import type { PitwallStrategyRow, PitwallPlannedStint } from "./pitwallHelpers";

interface Props {
  strategy: PitwallStrategyRow | null;
  plannedStints: PitwallPlannedStint[];
  driverName: string | null;
}

export const StintDriverPanel = ({ strategy, plannedStints, driverName }: Props) => {
  const current = plannedStints?.find((s) => s.status === "in_car" || s.status === "ready");
  const next = plannedStints?.find((s) => s.status === "draft" && s.id !== current?.id);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <h3 className="mb-3 text-[11px] font-black uppercase tracking-widest text-gray-500">COUREUR / STINT</h3>

      <div className="space-y-3">
        <div>
          <div className="text-xs text-gray-400">NU</div>
          <div className="text-lg font-bold text-white">{driverName ?? "—"}</div>
        </div>

        <div className="flex gap-4 text-sm">
          <div>
            <div className="text-xs text-gray-400">VOLGENDE</div>
            <div className="font-bold text-orange-400">{next?.driver_id ?? "—"}</div>
          </div>
          {next?.expected_laps ? (
            <div>
              <div className="text-xs text-gray-400">Gepland</div>
              <div className="font-bold text-gray-300">{next.expected_laps} ronden</div>
            </div>
          ) : null}
        </div>

        {plannedStints && plannedStints.length > 0 ? (
          <div className="max-h-28 space-y-1 overflow-y-auto text-xs">
            {plannedStints.slice(0, 4).map((stint) => (
              <div key={stint.id} className="flex justify-between rounded-lg bg-black/20 px-2 py-1">
                <span className="text-gray-400">{stint.driver_id}</span>
                <span className="text-gray-500">
                  {stint.expected_laps}r{stint.tyre_change ? " · banden" : ""}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-500">Geen geplande stints</p>
        )}
      </div>
    </div>
  );
};