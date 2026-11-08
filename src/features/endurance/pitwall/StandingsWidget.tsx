import { freshMetrics, rowSectors, trackSectorCount } from "./paceSeries";
import type { V3Normalized } from "./pitwallHelpers";
import { Fragment, useState } from "react";
import type { StandingsDerivation } from "./standings";
import { renderGap, renderPosition } from "./standings";
import type { PitwallPlannedStint, PitwallTimelineEvent, V3Opponent } from "./pitwallHelpers";
import { formatClosingRate } from "./closingRate";
import { preciseLapTime } from "./telemetryFormat";
import { PitwallPanel } from "./PitwallPanel";

interface Props {
  v3?: V3Normalized | null;
  plannedStints?: PitwallPlannedStint[];
  events?: PitwallTimelineEvent[];
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

const licenseStyles: Record<string, string> = {
  R: "border-red-400/50 bg-red-500/15 text-red-200",
  D: "border-orange-400/50 bg-orange-500/15 text-orange-200",
  C: "border-yellow-400/50 bg-yellow-500/15 text-yellow-200",
  B: "border-green-400/50 bg-green-500/15 text-green-200",
  A: "border-sky-400/50 bg-sky-500/15 text-sky-100",
  Pro: "border-slate-400/50 bg-slate-700/40 text-slate-100",
  WC: "border-slate-300/60 bg-slate-900 text-slate-100",
};

const SafetyRatingBadge = ({ opponent }: { opponent: V3Opponent }) => {
  const rating = opponent.safetyRating;
  const license = opponent.licenseClass;
  if (rating == null || !Number.isFinite(rating) || rating < 0 || rating > 4.99 || !license || !Object.prototype.hasOwnProperty.call(licenseStyles, license)) {
    return <span className="text-slate-500">—</span>;
  }
  return (
    <span
      className={`inline-block whitespace-nowrap rounded border px-1 py-px text-[11px] leading-none ${licenseStyles[license]}`}
      title={`Safety Rating ${license} ${rating.toFixed(2)} · huidige coureur, sessiegegevens`}
    >
      {license} {rating.toFixed(2)}
    </span>
  );
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
 * iRating en Safety Rating horen bij de huidige coureur in de sessie.
 * Klassepositie blijft beschikbaar voor klassesortering, maar de losse K-kolom
 * vervalt. Ontbrekende ratings blijven onbekend, ook met een oudere connector.
 */
export const StandingsWidget = ({ v3, standings, ownCarLabel, ownCarNumber, live = true, plannedStints = [], events = [] }: Props) => {
  const sectorCount = live ? trackSectorCount(v3) : 0;
  const sectorColumns = Array.from({length:sectorCount},(_,n)=>n);
  const [view, setView] = useState('live');
  const [selectedClass, setSelectedClass] = useState<string | null>(null);
  const pitEvents = events.filter(e => e.event_type === 'pit_entry' || e.event_type === 'pit_exit');
  const views = [{ id: 'live', label: 'Live timing' }, ...(!standings.noData ? [{ id: 'class', label: 'Klasse' }] : []), ...(plannedStints.length ? [{ id: 'stints', label: 'Stints' }] : []), ...(pitEvents.length ? [{ id: 'pits', label: 'Pitstops' }] : []), ...(events.length ? [{ id: 'events', label: 'Gebeurtenissen' }] : [])];
  const active = views.some(v => v.id === view) ? view : 'live';
  if (standings.noData && views.length === 1) {
    return (
      <PitwallPanel title="Live timing" slot="standings" meta={live ? "Live" : "Offline"}>
        <p className="py-6 text-center text-[12px] text-slate-400">Wacht op tegenstanderdata…</p>
      </PitwallPanel>
    );
  }

  const { overallPosition, ahead, behind, aheadTrend, behindTrend, rows } = standings;

  const classes = [...new Set(rows.map(r => r.carClass ?? 'Zonder klasse'))];
  const activeClass = selectedClass && classes.includes(selectedClass) ? selectedClass : classes[0];
  const visibleRows = active === 'class' ? rows.filter(r => (r.carClass ?? 'Zonder klasse') === activeClass) : rows;
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
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-[#161C27] px-3.5 py-1" aria-label="Timing-weergave">
        {views.map(v => <button key={v.id} type="button" aria-pressed={active === v.id} onClick={() => setView(v.id)} className={`text-[12px] font-bold ${active === v.id ? 'border-b border-orange-400 text-orange-300' : 'text-slate-400'}`}>{v.label}</button>)}
      </div>
      {active === 'class' && <div className="flex flex-wrap gap-2 px-3.5 py-1">{classes.map(c => <button key={c} type="button" aria-pressed={activeClass === c} onClick={() => setSelectedClass(c)} className="text-[12px] text-sky-300">{c}</button>)}</div>}
      {(active === 'stints' || active === 'pits' || active === 'events') ? <div className="pitwall-timing-scroll p-3 text-[12px] text-slate-300" tabIndex={0} role="region" aria-label="Eigen opgeslagen planning en gebeurtenissen">
        <p className="mb-2 text-[12px] text-slate-400">{active === 'stints' ? 'Eigen team · planning, geen gemeten rivalenstints.' : 'Eigen auto · opgeslagen gebeurtenissen, geen volledig wedstrijdtotaal.'}</p>
        {active === 'stints' ? <ol>{plannedStints.map((s, i) => <li key={s.id} className="border-t border-white/10 py-2">{i + 1}. {s.driver_id} · {s.expected_laps} ronden gepland · {s.status}{s.tyre_change ? ' · bandenwissel gepland' : ''}</li>)}</ol> : <ol>{(active === 'pits' ? pitEvents : events).map((e, i) => <li key={`${e.event_key}:${i}`} className="border-t border-white/10 py-1"><time>{e.captured_at}</time> · R{e.completed_laps ?? e.lap ?? '—'} · {e.event_type}</li>)}</ol>}
      </div> : <>
      {/* AHEAD / YOU / BEHIND — wie zit er direct voor en achter je. */}
      <div className="grid gap-px border-b border-[#161C27] bg-[#161C27] sm:grid-cols-3" data-pitwall-slot="ahead-you-behind">
        <RelativeRow tone="sky" label="Voor" opponent={ahead} trend={aheadTrend} />
        <div className="bg-orange-500/[0.09] px-3.5 py-2">
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-orange-300">Jij</p>
          <div className="mt-1 flex items-baseline gap-1.5 font-mono text-[12px] font-bold text-white">
            <span>{overallPosition != null ? `P${renderPosition(overallPosition)}` : "P—"}</span>
            {ownCarNumber && <span className="text-slate-400">#{ownCarNumber}</span>}
            <span className="truncate">{ownCarLabel ?? "Mijn auto"}</span>
            {ahead && (
              <span className="ml-auto text-[12px] font-black text-orange-300">{ahead.inPit ? "PIT" : renderGap(ahead)}</span>
            )}
          </div>
        </div>
        <RelativeRow tone="rose" label="Achter" opponent={behind} trend={behindTrend} />
      </div>

      {visibleRows.length > 0 && (
        <div className="pitwall-timing-scroll overflow-x-auto" tabIndex={0} role="region" aria-label="Live timing — scrollbaar klassement">
          <table data-sector-count={sectorCount} className={`w-full min-w-[840px] text-left tabular-nums ${sectorCount > 3 ? "text-[10px] [&_th]:px-1 [&_td]:px-1" : "text-[12px]"}`}>
            <thead className="bg-[#0A0C10] text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">
              <tr>
                <th className="px-2.5 py-1.5">P</th>
                <th className="px-2 py-1.5">#</th>
                <th className="px-2 py-1.5">Coureur</th>
                <th scope="col" className="px-2 py-1.5 text-right"><abbr title="iRating" className="no-underline">iR</abbr></th>
                <th scope="col" className="px-2 py-1.5"><abbr title="Safety Rating en licentieklasse" className="no-underline">SR</abbr></th>
                <th className="px-2 py-1.5">Klasse</th>
                <th className="px-2 py-1.5 text-right">Laatste</th>
                <th className="px-2 py-1.5 text-right">Beste</th>
                {sectorColumns.map(n=><th key={n} className="px-2 py-1.5 text-right">S{n+1}</th>)}
                <th className="px-2 py-1.5 text-right">Ronde</th>
                <th className="px-2 py-1.5 text-right">Gap tot jou</th>
                <th className="px-2 py-1.5 text-center">Pit</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r, index) => (
                <Fragment key={r.id}>
                  {(index === 0 || visibleRows[index - 1].carClass !== r.carClass) && (
                    <tr className="border-t border-[#1D2431] bg-[#0A0C10]">
                      <td colSpan={11+sectorCount} className="px-2.5 py-1.5">
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
                    <td data-timing="car-number" className="px-2 py-1.5 font-mono text-slate-400">{r.carNumber ?? "—"}</td>
                    <td className="max-w-[15rem] px-2 py-1.5">
                      <p className={`truncate ${r.isPlayer ? "font-bold text-white before:mr-1 before:text-orange-400 before:content-['▸']" : "font-semibold text-slate-100"}`}>
                        {driverLabel(r)}
                      </p>
                      {teamLabel(r) && <p className="mt-0.5 truncate text-[10.5px] leading-tight text-slate-500">{teamLabel(r)}</p>}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-slate-200" title="iRating · huidige coureur, sessiegegevens">
                      {Number.isInteger(r.irating) && r.irating > 0 && r.irating <= 100000 ? r.irating : "—"}
                    </td>
                    <td className="px-2 py-1.5 font-mono"><SafetyRatingBadge opponent={r} /></td>
                    <td className="px-2 py-1.5 text-[11px] uppercase tracking-[0.08em] text-sky-300">{r.carClass ?? "—"}</td>
                    <td
                        data-timing="last-lap"
                        className="px-2 py-1.5 text-right font-mono text-amber-200"
                        title={(r as { lastLapInvalid?: boolean }).lastLapInvalid ? "Laatste ronde ongeldig (reset of baanverlating) — telt niet als rondetijd" : undefined}
                      >
                        {(r as { lastLapInvalid?: boolean }).lastLapInvalid
                          ? "—"
                          : preciseLapTime(live && rowSectors(v3,r.id,r.lastLapSeconds) ? freshMetrics(v3,r.id)?.lastLapSeconds : r.lastLapSeconds)}
                      </td>
                    <td data-timing="best-lap" className="px-2 py-1.5 text-right font-mono text-fuchsia-300">{preciseLapTime(r.bestLapSeconds)}</td>
                    {sectorColumns.map(n=><td key={n} className="px-2 py-1.5 text-right font-mono text-slate-300" title={live && rowSectors(v3,r.id,r.lastLapSeconds) ? `Gecontroleerde laatste ronde · ${freshMetrics(v3,r.id)?.sectorSource ?? "bron onbekend"} · afwijking ${freshMetrics(v3,r.id)?.sectorErrorSeconds?.toFixed(3) ?? "onbekend"} s` : `Geen gecontroleerde sectorreeks · bronafwijkingen ${freshMetrics(v3,r.id)?.sectorMismatchCount ?? "onbekend"}`}>{live ? rowSectors(v3,r.id,r.lastLapSeconds)?.[n]?.toFixed(3) ?? "—" : "—"}</td>)}
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

      </>}
      <p className="px-3.5 py-2 text-[10px] text-slate-500">
        Snapshot van tegenstanders, geen volledig klassement. Gap is het verschil tot jouw auto. iR = iRating · SR = Safety Rating van de huidige coureur. Scroll voor alle rijen.
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
        <div className="mt-1 flex items-baseline gap-1.5 font-mono text-[12px] text-slate-300">
          <span className="font-bold text-white">P{renderPosition(opponent.position)}</span>
          {opponent.carNumber && <span className="text-slate-400">#{opponent.carNumber}</span>}
          <span className="truncate">{driverLabel(opponent)}</span>
          <span className="ml-auto flex items-center gap-1.5">
            <TrendMark rate={trend} />
            <span className="text-[12px] font-black text-orange-300">{opponent.inPit ? "PIT" : renderGap(opponent)}</span>
          </span>
        </div>
      ) : (
        <p className="mt-1 font-mono text-[12px] text-slate-600">—</p>
      )}
    </div>
  );
}
