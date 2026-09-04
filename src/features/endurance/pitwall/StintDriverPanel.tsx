import type { PitwallStrategyRow, PitwallPlannedStint } from "./pitwallHelpers";
import { formatSeconds } from "./pitwallHelpers";

interface Props {
  strategy: PitwallStrategyRow | null;
  plannedStints: PitwallPlannedStint[];
  driverName: string | null;
}

export const StintDriverPanel = ({ strategy, plannedStints, driverName }: Props) => {
  const current = plannedStints?.find((s) => s.status === "in_car" || s.status === "ready");
  const next = plannedStints?.filter((s) => s.id !== current?.id);
  const firstNext = next?.[0];
  const secondNext = next?.[1];

  /* Stint duration/formatted from strategy laps */
  const stintLaps = strategy?.current_stint_valid_sample_count ?? null;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <h3 className="mb-3 text-[11px] font-black uppercase tracking-widest text-gray-500">COUREUR / STINT</h3>

      <div className="space-y-3">
        {/* NU — primary */}
        <div className="rounded-lg bg-black/20 px-3 py-2">
          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">NU</div>
          <div className="text-xl font-black text-white">{driverName ?? current?.driver_id ?? "—"}</div>
          {stintLaps != null && (
            <div className="mt-0.5 text-xs text-gray-400">
              {stintLaps} ronden{current?.expected_laps ? ` / max ${current.expected_laps}r` : ""}
            </div>
          )}
        </div>

        {/* VOLGENDE */}
        {firstNext ? (
          <div className="flex items-center gap-3 text-sm">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Volgende</div>
              <div className="font-bold text-orange-400">{firstNext.driver_id}</div>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Gepland</div>
              <div className="font-bold text-gray-300">
                {firstNext.expected_laps}r{firstNext.tyre_change ? " · banden" : ""}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-xs text-gray-500">Geen volgende stint gepland</p>
        )}

        {/* DAARNA */}
        {secondNext && (
          <div className="text-xs">
            <span className="text-gray-500">Daarna: </span>
            <span className="font-bold text-gray-400">{secondNext.driver_id}</span>
            <span className="text-gray-500"> · {secondNext.expected_laps}r{secondNext.tyre_change ? " · banden" : ""}</span>
          </div>
        )}

        {/* PLAN — compact driver sequence */}
        {next && next.length > 0 && (
          <div className="max-h-24 space-y-0.5 overflow-y-auto text-xs pt-2 border-t border-white/5">
            {next.slice(0, 4).map((stint) => (
              <div key={stint.id} className="flex justify-between rounded-lg bg-black/10 px-2 py-0.5">
                <span className="text-gray-400">{stint.driver_id}</span>
                <span className="text-gray-500">
                  {stint.expected_laps}r{stint.tyre_change ? " · banden" : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};