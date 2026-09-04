import type { StandingsDerivation, StandingsRow } from "./standings";
import { renderGap, renderPosition } from "./standings";
import type { V3Opponent } from "./pitwallHelpers";

interface Props {
  standings: StandingsDerivation;
  /** Own car label (team name or "Mijn auto"). */
  ownCarLabel: string | null;
  /** Own car number. */
  ownCarNumber: string | null;
}

const rowLabel = (r: V3Opponent): string => {
  return r.teamName ?? r.driverName ?? r.carNumber ?? `#${r.id}`;
};

export const StandingsWidget = ({ standings, ownCarLabel, ownCarNumber }: Props) => {
  if (standings.noData) {
    return (
      <section data-pitwall-slot="standings" className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-3">
        <h3 className="text-[10px] font-black uppercase tracking-wider text-gray-500">Live-stand</h3>
        <p className="mt-2 text-xs text-gray-400">Wacht op tegenstanderdata…</p>
      </section>
    );
  }

  const { overallPosition, classPosition, ahead, behind, rows } = standings;

  return (
    <section data-pitwall-slot="standings" className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[10px] font-black uppercase tracking-wider text-gray-500">Live-stand</h3>
        <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />Live
        </span>
      </div>

      {/* AHEAD / YOU / BEHIND */}
      <div className="space-y-1 text-[11px] font-mono">
        <div className="flex items-center gap-2 rounded px-1.5 py-1 text-gray-300">
          <span className="w-10 font-black text-sky-300">AHEAD</span>
          {ahead ? (
            <>
              <span className="font-bold text-white">{renderPosition(ahead.position)}</span>
              {typeof ahead.classPosition === "number" && <span className="text-gray-500">K{ahead.classPosition}</span>}
              {ahead.carNumber && <span className="text-gray-400">#{ahead.carNumber}</span>}
              <span className="truncate text-gray-300">{rowLabel(ahead)}</span>
              <span className="ml-auto text-orange-300">{ahead.inPit ? "PIT" : renderGap(ahead)}</span>
            </>
          ) : (
            <span className="text-gray-600">—</span>
          )}
        </div>
        <div className="flex items-center gap-2 rounded bg-orange-500/10 px-1.5 py-1 font-bold text-white ring-1 ring-orange-500/20">
          <span className="w-10 font-black text-orange-300">YOU</span>
          <span>{renderPosition(overallPosition)}</span>
          {typeof classPosition === "number" && <span className="font-semibold text-gray-300">K{classPosition}</span>}
          {ownCarNumber && <span className="text-gray-400">#{ownCarNumber}</span>}
          <span className="truncate">{ownCarLabel ?? "Mijn auto"}</span>
        </div>
        <div className="flex items-center gap-2 rounded px-1.5 py-1 text-gray-300">
          <span className="w-10 font-black text-rose-300">BEHIND</span>
          {behind ? (
            <>
              <span className="font-bold text-white">{renderPosition(behind.position)}</span>
              {typeof behind.classPosition === "number" && <span className="text-gray-500">K{behind.classPosition}</span>}
              {behind.carNumber && <span className="text-gray-400">#{behind.carNumber}</span>}
              <span className="truncate text-gray-300">{rowLabel(behind)}</span>
              <span className="ml-auto text-orange-300">{behind.inPit ? "PIT" : renderGap(behind)}</span>
            </>
          ) : (
            <span className="text-gray-600">—</span>
          )}
        </div>
      </div>

      {/* COMPACT TABLE */}
      {rows.length > 1 && (
        <div className="mt-2 overflow-hidden rounded border border-white/5">
          <table className="w-full text-left text-[10px]">
            <thead className="bg-black/30 text-[9px] font-black uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-1.5 py-1">P</th>
                <th className="px-1 py-1">K</th>
                <th className="px-1 py-1">#</th>
                <th className="px-1 py-1">Team</th>
                <th className="px-1 py-1 text-right">Ronde</th>
                <th className="px-1 py-1 text-right">Gap</th>
                <th className="px-1 py-1 text-center">Pit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={`border-t border-white/5 ${r.isPlayer ? "bg-orange-500/10 font-bold text-white" : "text-gray-300"}`}>
                  <td className="px-1.5 py-1">{renderPosition(r.position)}</td>
                  <td className="px-1 py-1 text-gray-500">{renderPosition(r.classPosition)}</td>
                  <td className="px-1 py-1 text-gray-400">{r.carNumber ?? "—"}</td>
                  <td className="px-1 py-1 truncate max-w-[7rem]">{rowLabel(r)}</td>
                  <td className="px-1 py-1 text-right">{r.lap ?? "—"}</td>
                  <td className="px-1 py-1 text-right text-orange-300">{renderGap(r, false)}</td>
                  <td className="px-1 py-1 text-center text-yellow-400">{r.inPit ? "PIT" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};