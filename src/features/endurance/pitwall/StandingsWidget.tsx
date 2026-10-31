import { Fragment } from "react";
import type { StandingsDerivation } from "./standings";
import { renderGap, renderPosition } from "./standings";
import type { V3Opponent } from "./pitwallHelpers";
import { formatClosingRate } from "./closingRate";
import { preciseLapTime } from "./telemetryFormat";
import { PitwallPanel } from "./PitwallPanel";

interface Props {
  standings: StandingsDerivation;
  /** Own car label (team name or "Mijn auto"). */
  ownCarLabel: string | null;
  /** Own car number. */
  ownCarNumber: string | null;
  /** Valse feed mag niet als live staan. */
  live?: boolean;
}

/** Coureur is de hoofdregel; het team alleen als het gevuld is. */
const driverLabel = (r: V3Opponent): string =>
  r.driverName ?? r.teamName ?? (r.carNumber ? `#${r.carNumber}` : `#${r.id}`);

const teamLabel = (r: V3Opponent): string | null => {
  if (!r.teamName) return null;
  // Geen tweede regel die de eerste herhaalt.
  return r.teamName === r.driverName ? null : r.teamName;
};

/** Compact trend annotation: "+0.2s/lap" (closing) or "los" (pulling away) — muted, no over-color. */
const TrendMark = ({ rate }: { rate: number | null }) => {
  if (rate == null || !Number.isFinite(rate)) return null;
  const closing = rate >= 0;
  return (
    <span className={`text-[10px] font-bold ${closing ? "text-emerald-400" : "text-slate-500"}`}>
      {closing ? "sluit " : "los "}
      {formatClosingRate(rate)}
    </span>
  );
};

/**
 * Live timing.
 *
 * Kolommen en klassesortering zijn ongewijzigd; alleen de leesbaarheid is
 * anders: meer rijhoogte, duidelijke klassekoppen, en de eigen rij met een
 * gedempt oranje vlak en een smalle markering links.
 *
 * De gap is `gapToPlayerSeconds` en heet daarom "Gap tot jou" — niet "achter
 * leider". P en K blijven losse waarden: de snapshot is begrensd en bewijst
 * geen volledig deelnemersaantal.
 */
export const StandingsWidget = ({ standings, ownCarLabel, ownCarNumber, live = true }: Props) => {
  if (standings.noData) {
    return (
      <PitwallPanel title="Live timing" slot="standings" meta={live ? "Live" : "Offline"}>
        <p className="py-6 text-center text-[13px] text-slate-400">Wacht op tegenstanderdata…</p>
      </PitwallPanel>
    );
  }

  const { overallPosition, classPosition, ahead, behind, aheadTrend, behindTrend, rows } = standings;

  const perClass = rows.reduce<Record<string, number>>((acc, r) => {
    const key = r.carClass ?? "Zonder klasse";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <PitwallPanel
      title="Live timing"
      slot="standings"
      meta={
        <span className={`flex items-center gap-1.5 text-[11px] font-bold ${live ? "text-emerald-300" : "text-slate-500"}`}>
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${live ? "bg-emerald-400" : "bg-slate-600"}`} />
          {live ? "Live" : "Offline"}
        </span>
      }
      className="pitwall-timing"
      bodyClassName="pitwall-timing-body px-0 py-0"
    >
      {/* AHEAD / YOU / BEHIND — wie zit er direct voor en achter je. */}
      <div className="grid gap-px border-b border-[#161C27] bg-[#161C27] sm:grid-cols-3" data-pitwall-slot="ahead-you-behind">
        <RelativeRow tone="sky" label="Voor" opponent={ahead} trend={aheadTrend} />
        <div className="bg-orange-500/[0.09] px-3.5 py-2">
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-orange-300">Jij</p>
          <div className="mt-1 flex items-baseline gap-1.5 font-mono text-[13px] font-bold text-white">
            <span>{overallPosition != null ? `P${renderPosition(overallPosition)}` : "P—"}</span>
            {typeof classPosition === "number" && <span className="text-[11px] font-semibold text-slate-300">K{classPosition}</span>}
            {ownCarNumber && <span className="text-slate-400">#{ownCarNumber}</span>}
            <span className="truncate">{ownCarLabel ?? "Mijn auto"}</span>
            {ahead && (
              <span className="ml-auto text-[13px] font-black text-orange-300">{ahead.inPit ? "PIT" : renderGap(ahead)}</span>
            )}
          </div>
        </div>
        <RelativeRow tone="rose" label="Achter" opponent={behind} trend={behindTrend} />
      </div>

      {rows.length > 1 && (
        <div className="pitwall-timing-scroll overflow-x-auto" tabIndex={0} role="region" aria-label="Live timing — scrollbaar klassement">
          <table className="w-full min-w-[720px] text-left text-[12px] tabular-nums">
            <thead className="bg-[#0A0C10] text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">
              <tr>
                <th className="px-2.5 py-1.5">P</th>
                <th className="px-2 py-1.5">K</th>
                <th className="px-2 py-1.5">#</th>
                <th className="px-2 py-1.5">Coureur</th>
                <th className="px-2 py-1.5">Klasse</th>
                <th className="px-2 py-1.5 text-right">Laatste</th>
                <th className="px-2 py-1.5 text-right">Beste</th>
                <th className="px-2 py-1.5 text-right">Ronde</th>
                <th className="px-2 py-1.5 text-right">Gap tot jou</th>
                <th className="px-2 py-1.5 text-center">Pit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, index) => (
                <Fragment key={r.id}>
                  {(index === 0 || rows[index - 1].carClass !== r.carClass) && (
                    <tr className="border-t border-[#1D2431] bg-[#0A0C10]">
                      <td colSpan={10} className="px-2.5 py-1.5">
                        <span className="text-[11px] font-black uppercase tracking-[0.14em] text-sky-200">
                          {r.carClass ?? "Zonder klasse"}
                        </span>
                        <span className="ml-2 text-[10px] uppercase tracking-[0.12em] text-slate-500">
                          {perClass[r.carClass ?? "Zonder klasse"]} in beeld
                        </span>
                      </td>
                    </tr>
                  )}
                  <tr
                    data-pitwall-own-row={r.isPlayer ? "true" : undefined}
                    className={`border-t border-[#12171F] ${
                      r.isPlayer
                        ? "bg-orange-500/[0.10] text-white shadow-[inset_3px_0_0_#F97316]"
                        : "text-slate-300 hover:bg-white/[0.03]"
                    }`}
                  >
                    <td className="px-2.5 py-1.5 font-mono font-bold">{r.position != null ? `P${renderPosition(r.position)}` : "—"}</td>
                    <td className="px-2 py-1.5 font-mono text-slate-500">
                      {r.classPosition != null ? `K${renderPosition(r.classPosition)}` : "—"}
                    </td>
                    <td className="px-2 py-1.5 font-mono text-slate-400">{r.carNumber ?? "—"}</td>
                    <td className="max-w-[15rem] px-2 py-1.5">
                      <p className={`truncate ${r.isPlayer ? "font-bold text-white" : "font-semibold text-slate-100"}`}>
                        {driverLabel(r)}
                      </p>
                      {teamLabel(r) && <p className="mt-0.5 truncate text-[10.5px] leading-tight text-slate-500">{teamLabel(r)}</p>}
                    </td>
                    <td className="px-2 py-1.5 text-[11px] uppercase tracking-[0.08em] text-sky-300">{r.carClass ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-amber-200">{preciseLapTime(r.lastLapSeconds)}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-fuchsia-300">{preciseLapTime(r.bestLapSeconds)}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-slate-300">{r.lap ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right font-mono font-semibold text-orange-300">{renderGap(r, false)}</td>
                    <td className="px-2 py-1.5 text-center text-[11px] font-bold text-yellow-400">{r.inPit ? "PIT" : "—"}</td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="px-3.5 py-2 text-[10px] text-slate-500">
        Snapshot van tegenstanders, geen volledig klassement. Gap is het verschil tot jouw auto. Scroll voor alle rijen.
      </p>
    </PitwallPanel>
  );
};

function RelativeRow({
  tone,
  label,
  opponent,
  trend,
}: {
  tone: "sky" | "rose";
  label: string;
  opponent: V3Opponent | null;
  trend: number | null;
}) {
  const labelClass = tone === "sky" ? "text-sky-300" : "text-rose-300";
  return (
    <div className="bg-[#0B0D11] px-3.5 py-2">
      <p className={`text-[10px] font-black uppercase tracking-[0.16em] ${labelClass}`}>{label}</p>
      {opponent ? (
        <div className="mt-1 flex items-baseline gap-1.5 font-mono text-[13px] text-slate-300">
          <span className="font-bold text-white">P{renderPosition(opponent.position)}</span>
          {typeof opponent.classPosition === "number" && <span className="text-[11px] text-slate-500">K{opponent.classPosition}</span>}
          {opponent.carNumber && <span className="text-slate-400">#{opponent.carNumber}</span>}
          <span className="truncate">{driverLabel(opponent)}</span>
          <span className="ml-auto flex items-center gap-1.5">
            <TrendMark rate={trend} />
            <span className="text-[13px] font-black text-orange-300">{opponent.inPit ? "PIT" : renderGap(opponent)}</span>
          </span>
        </div>
      ) : (
        <p className="mt-1 font-mono text-[13px] text-slate-600">—</p>
      )}
    </div>
  );
}
