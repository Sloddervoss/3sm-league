import { useMemo } from "react";
import { Flag, Timer, UsersRound } from "lucide-react";
import { useLiveStandings } from "./useLiveStandings";

/**
 * LiveStandingsWidget — herbruikbare publieke/spectator-klassement widget.
 * Nog NIET op een route geplaatst; importeer + plant hem later waar nodig.
 * Presentational: haalt zelf zijn data via useLiveStandings(eventId).
 * (Bij publieke plaatsing: DB-policy voor anon-lees nog openzetten.)
 */
export function LiveStandingsWidget({ eventId, eventName }: { eventId: string; eventName?: string }) {
  const { standings, loading, error, updatedAt } = useLiveStandings(eventId);

  const sorted = useMemo(() => standings, [standings]);

  const fmtClock = (seconds: number | null) => {
    if (seconds == null) return "—";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.02]">
      <header className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <Timer className="h-4 w-4 text-orange-400" />
          <h2 className="font-heading font-black text-white">{eventName ? `${eventName} — live` : "Live"}</h2>
        </div>
        <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-gray-500">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />Live
        </span>
      </header>

      {error && <p className="px-4 py-3 text-sm text-red-300">Live-stand kon niet worden geladen.</p>}
      {loading && !standings.length && <p className="px-4 py-3 text-sm text-gray-400">Live-stand laden…</p>}
      {!loading && !standings.length && !error && (
        <p className="flex items-center gap-2 px-4 py-3 text-sm text-gray-400"><UsersRound className="h-4 w-4" />Nog geen teams met live data.</p>
      )}

      {standings.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-[11px] font-black uppercase tracking-wider text-gray-500">
                <th className="px-4 py-2">#</th>
                <th className="px-2 py-2">Team</th>
                <th className="px-2 py-2">Bestuurder</th>
                <th className="px-2 py-2 text-center">Pos</th>
                <th className="px-2 py-2 text-center">Klasse</th>
                <th className="px-2 py-2 text-center">Ronden</th>
                <th className="px-2 py-2 text-right">Laatste</th>
                <th className="px-2 py-2 text-center">Klok</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((line) => (
                <tr key={line.teamId} className="border-b border-white/5 last:border-0">
                  <td className="px-4 py-2.5 font-black text-orange-300">{line.rank}</td>
                  <td className="px-2 py-2.5">
                    <span className="font-bold text-white">{line.teamName}</span>
                    {line.carNumber && <span className="ml-2 text-xs text-gray-500">#{line.carNumber}</span>}
                  </td>
                  <td className="px-2 py-2.5 text-gray-300">{line.currentDriverName ?? "—"}</td>
                  <td className="px-2 py-2.5 text-center">{line.position ?? "—"}</td>
                  <td className="px-2 py-2.5 text-center text-gray-400">{line.classPosition ?? "—"}</td>
                  <td className="px-2 py-2.5 text-center">{line.completedLaps ?? "—"}</td>
                  <td className="px-2 py-2.5 text-right font-mono text-xs">
                    {line.lastLapSeconds != null ? `${line.lastLapSeconds.toFixed(3)}s` : "—"}
                    {line.flag?.toLowerCase() === "yellow" && <Flag className="ml-1 inline h-3 w-3 text-yellow-300" />}
                  </td>
                  <td className="px-2 py-2.5 text-center text-xs text-gray-400">{fmtClock(line.sessionTimeSeconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <footer className="flex items-center justify-between border-t border-white/10 px-4 py-2 text-[11px] text-gray-600">
        <span>Classificatie op voltooide ronden dan positie</span>
        {updatedAt && <span>bijgewerkt {new Date(updatedAt).toLocaleTimeString("nl-NL")}</span>}
      </footer>
    </section>
  );
}