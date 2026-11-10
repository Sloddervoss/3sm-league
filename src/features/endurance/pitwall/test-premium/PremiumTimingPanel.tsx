import { Fragment, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ChevronRight, Flag, ListOrdered } from "lucide-react";
import type { V3Normalized, V3Opponent } from "../pitwallHelpers";
import { renderGap, renderPosition, type StandingsDerivation } from "../standings";
import { freshMetrics, rowSectors, trackSectorCount } from "../paceSeries";
import { preciseLapTime } from "../telemetryFormat";
import { initialTimingState, reduceTimingTransitions } from "./timingTransitions";
import { useRowFlip } from "./useRowFlip";

interface Props {
  v3: V3Normalized | null;
  standings: StandingsDerivation;
  ownCarLabel: string | null;
  ownCarNumber: string | null;
  live: boolean;
  /** Contextwissel (apparaat + sessie + baan) wist de vergelijkingsbasis. */
  contextKey: string;
  /** Offline, RPC-fout of een expliciet datagat. */
  gap?: boolean;
  motionEnabled: boolean;
}

type TimingView = "live" | "class";

/** Korte levensduur van +/− en rondeflits; daarna is het weer gewone data. */
export const TIMING_SIGNAL_TTL_MS = 2600;

const driverLabel = (r: V3Opponent): string =>
  r.driverName ?? r.teamName ?? (r.carNumber ? `#${r.carNumber}` : `#${r.id}`);

const teamLabel = (r: V3Opponent): string | null =>
  r.teamName && r.teamName !== r.driverName ? r.teamName : null;

const classOf = (r: V3Opponent): string => r.carClass ?? "Zonder klasse";

const LICENSES = new Set(["R", "D", "C", "B", "A", "Pro", "WC"]);

function SafetyRating({ opponent }: { opponent: V3Opponent }) {
  const rating = opponent.safetyRating;
  const license = opponent.licenseClass;
  if (rating == null || !Number.isFinite(rating) || rating < 0 || rating > 4.99 || !license || !LICENSES.has(license)) {
    return <span className="ptp-sr is-empty" aria-label="Safety Rating onbekend">—</span>;
  }
  return (
    <span
      className="ptp-sr"
      data-license={license}
      title={`Safety Rating ${license} ${rating.toFixed(2)} · huidige coureur, sessiegegevens`}
    >
      {license} {rating.toFixed(2)}
    </span>
  );
}

function FocusCell({
  tone,
  label,
  opponent,
  own,
}: {
  tone: "ahead" | "own" | "behind";
  label: string;
  opponent?: V3Opponent | null;
  own?: {
    position: number | null;
    number: string | null;
    name: string | null;
    /** Zelfde gap als de klassieke "Jij"-strook: de afstand tot de auto voor je. */
    gap?: string | null;
    pit?: boolean;
  };
}) {
  const value = own
    ? {
        position: own.position,
        number: own.number,
        name: own.name ?? "Mijn auto",
        gap: own.gap ?? null,
        pit: Boolean(own.pit),
      }
    : opponent
      ? {
          position: opponent.position ?? null,
          number: opponent.carNumber ?? null,
          name: driverLabel(opponent),
          gap: opponent.inPit ? "PIT" : renderGap(opponent),
          pit: Boolean(opponent.inPit),
        }
      : null;

  return (
    <div className="ptp-focus-cell" data-tone={tone}>
      <span className="ptp-focus-label">{label}</span>
      {value ? (
        <span className="ptp-focus-value">
          <span className="ptp-focus-pos">{value.position != null ? `P${renderPosition(value.position)}` : "P—"}</span>
          {value.number && <span className="ptp-focus-number">#{value.number}</span>}
          <span className="ptp-focus-name">{value.name}</span>
          {value.gap && <span className={`ptp-focus-gap${value.pit ? " is-pit" : ""}`}>{value.gap}</span>}
        </span>
      ) : (
        <span className="ptp-focus-value is-empty">—</span>
      )}
    </div>
  );
}

/**
 * Premium timingtoren voor de testpagina.
 *
 * De tabel is een echte `<table>` met kolomkoppen, klassekoppen en een benoemd
 * scrollgebied. De eigen data komt uit dezelfde `deriveStandings` als de
 * endurance-pitwall; dit component verandert niets aan sortering of waarden.
 *
 * Beweging is decoratie: de DOM toont altijd direct de nieuwste snapshot. De
 * FLIP-hook speelt alleen het gemeten verschil terug en de reducer levert
 * uitsluitend id-gebonden positie- en rondesignalen.
 */
export function PremiumTimingPanel({
  v3,
  standings,
  ownCarLabel,
  ownCarNumber,
  live,
  contextKey,
  gap = false,
  motionEnabled,
}: Props) {
  const [view, setView] = useState<TimingView>("live");
  const [selectedClass, setSelectedClass] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const [transition, dispatch] = useReducer(reduceTimingTransitions, initialTimingState());

  const rows = standings.rows;
  const sectorCount = live ? trackSectorCount(v3) : 0;
  const sectorColumns = useMemo(() => Array.from({ length: sectorCount }, (_, n) => n), [sectorCount]);
  const classes = useMemo(() => [...new Set(rows.map(classOf))], [rows]);
  const activeClass = selectedClass && classes.includes(selectedClass) ? selectedClass : classes[0] ?? null;
  const visibleRows = view === "class" && activeClass ? rows.filter((r) => classOf(r) === activeClass) : rows;
  const perClass = useMemo(
    () =>
      rows.reduce<Record<string, number>>((acc, r) => {
        const key = classOf(r);
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {}),
    [rows],
  );
  const ownRow = rows.find((r) => r.isPlayer) ?? null;

  const signature = rows.map((r) => `${r.id}:${r.position ?? ""}:${r.lap ?? ""}`).join("|");

  useEffect(() => {
    dispatch({
      type: "snapshot",
      contextKey,
      live: live && !gap,
      gap,
      rows: rows.map((r) => ({ id: r.id, position: r.position, lap: r.lap })),
    });
    // `signature` dekt precies de velden die de reducer gebruikt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextKey, live, gap, signature]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) dispatch({ type: "visibility", hidden: true });
      else dispatch({ type: "reset", reason: "hidden" });
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // Een contextwissel mag nooit één frame oude seinen tonen, ook niet voordat
  // de effect hierboven de nieuwe basis heeft gezet.
  const compared = transition.contextKey === contextKey && live && !gap ? transition : null;
  const moves = useMemo(() => compared?.moves ?? {}, [compared]);
  const lapFlash = useMemo(() => compared?.lapFlash ?? {}, [compared]);

  // Positie- en rondeseinen zijn een korte gebeurtenis, geen blijvende status.
  // De DOM houdt de nieuwste snapshot; na deze termijn verdwijnt alleen de
  // decoratie per auto-id. Identieke frames starten geen nieuwe timer en dus
  // ook geen tweede flits. Een reset/contextwissel ruimt de timers op.
  useEffect(() => {
    const ids = new Set([...Object.keys(moves), ...Object.keys(lapFlash)]);
    if (ids.size === 0) return;
    const timers = [...ids].map((id) =>
      window.setTimeout(() => dispatch({ type: "expire", ids: [id] }), TIMING_SIGNAL_TTL_MS),
    );
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [moves, lapFlash]);

  useRowFlip(scroller, {
    enabled: motionEnabled && live && !gap,
    resetKey: `${contextKey}|${view}|${activeClass ?? ""}`,
  });

  const scrollToOwn = () => {
    const root = scroller.current;
    if (!root) return;
    const row = ownRow
      ? [...root.querySelectorAll<HTMLElement>("[data-timing-row-id]")].find((el) => el.dataset.timingRowId === ownRow.id) ?? null
      : null;
    if (!row) return;
    const headerHeight = root.querySelector("thead")?.getBoundingClientRect().height ?? 28;
    const ownHeight = root.querySelector(".ptp-own-pinned")?.getBoundingClientRect().height ?? 0;
    const top = row.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop - headerHeight - ownHeight;
    if (typeof root.scrollTo === "function") {
      root.scrollTo({ top: Math.max(0, top), behavior: motionEnabled ? "smooth" : "auto" });
    } else {
      root.scrollTop = Math.max(0, top);
    }
  };

  // Dezelfde gevalideerde waarden in de ranglijst en de vastgezette eigen rij.
  // De samenvatting heeft geen FLIP-id en verandert de echte sorteervolgorde niet.
  const renderTimingRow = (r: StandingsDerivation["rows"][number], pinned = false) => {
    const move = pinned ? 0 : moves[r.id] ?? 0;
    const sectors = live ? rowSectors(v3, r.id, r.lastLapSeconds) : null;
    const metrics = freshMetrics(v3, r.id);
    // Zelfde ongeldigheidsgrens als de klassieke StandingsWidget: een
    // reset/tow-ronde mag ook niet via de verse PACE-meting als tijd
    // verschijnen. De tooltip is identiek.
    const invalidLast = (r as { lastLapInvalid?: boolean }).lastLapInvalid === true;
    const last = invalidLast
      ? null
      : live && sectors
        ? metrics?.lastLapSeconds ?? r.lastLapSeconds
        : r.lastLapSeconds;
    const sectorTitle = live && sectors
      ? `Gecontroleerde laatste ronde · ${metrics?.sectorSource ?? "bron onbekend"} · afwijking ${metrics?.sectorErrorSeconds?.toFixed(3) ?? "onbekend"} s`
      : `Geen gecontroleerde sectorreeks · bronafwijkingen ${metrics?.sectorMismatchCount ?? "onbekend"}`;
    const flashLap = !pinned && lapFlash[r.id] === r.lap ? r.lap : null;
    return (
      <tr
        data-timing-row-id={pinned ? undefined : r.id}
        data-premium-pinned-own-row={pinned ? "true" : undefined}
        data-pitwall-own-row={!pinned && r.isPlayer ? "true" : undefined}
        data-premium-own-row={!pinned && r.isPlayer ? "true" : undefined}
        className={r.isPlayer ? "is-own" : undefined}
      >
        <td className="ptp-col-pos" aria-label={r.position != null ? `Positie ${r.position}` : "Positie onbekend"}>
          <span className="ptp-pos">{r.position != null ? renderPosition(r.position) : "—"}</span>
          {move !== 0 && (
            <span
              className="ptp-move"
              data-direction={move > 0 ? "up" : "down"}
              aria-label={`${Math.abs(move)} ${Math.abs(move) === 1 ? "plaats" : "plaatsen"} ${move > 0 ? "gewonnen" : "verloren"}`}
              title={`${Math.abs(move)} ${Math.abs(move) === 1 ? "plaats" : "plaatsen"} ${move > 0 ? "gewonnen" : "verloren"} sinds de vorige meting`}
            >
              {move > 0 ? `+${move}` : `${move}`}
            </span>
          )}
        </td>
        <td data-timing="car-number" className="ptp-col-num">{r.carNumber ?? "—"}</td>
        <td className="ptp-col-driver">
          <div className="ptp-driver">
            <span className="ptp-driver-line">
              <span className="ptp-driver-name">{driverLabel(r)}</span>
              {r.isPlayer && <span className="ptp-you">{pinned ? "JIJ · VAST" : "JIJ"}</span>}
            </span>
            <span className="ptp-driver-meta">
              {teamLabel(r) && <span className="ptp-team">{teamLabel(r)}</span>}
              {Number.isInteger(r.irating) && Number(r.irating) > 0 && Number(r.irating) <= 100000 && (
                <span title="iRating · huidige coureur, sessiegegevens">iR {r.irating}</span>
              )}
              <SafetyRating opponent={r} />
            </span>
          </div>
        </td>
        <td className="ptp-col-class">
          <span className="ptp-class-chip">{r.carClass ?? "—"}</span>
        </td>
        <td
          data-timing="last-lap"
          className="ptp-col-time ptp-last"
          title={invalidLast ? "Laatste ronde ongeldig (reset of baanverlating) — telt niet als rondetijd" : undefined}
        >
          {preciseLapTime(last)}
        </td>
        <td data-timing="best-lap" className="ptp-col-time ptp-best">{preciseLapTime(r.bestLapSeconds)}</td>
        {sectorCount === 0 && <td className="ptp-col-sector" title="Sectorindeling onbekend; geen tijden beschikbaar">—</td>}
        {sectorColumns.map((n) => (
          <td key={n} className="ptp-col-sector" title={sectorTitle}>
            {sectors?.[n] != null ? sectors[n]!.toFixed(3) : "—"}
          </td>
        ))}
        <td className="ptp-col-lap ptp-lap" data-lap-flash={flashLap ?? undefined}>
          {r.lap ?? "—"}
          {flashLap != null && (
            <span className="ptp-lap-flash" aria-hidden key={flashLap}>
              <Flag size={10} />
            </span>
          )}
        </td>
        <td className="ptp-col-gap">{renderGap(r, false)}</td>
        <td className="ptp-col-pit">
          {r.inPit ? (
            <span className="ptp-pit" title="Auto in de pitstraat volgens de telemetrie">
              PIT
            </span>
          ) : (
            <span className="ptp-empty">—</span>
          )}
        </td>
      </tr>
    );
  };

  if (standings.noData) {
    return (
      <section className="ptp-panel ptp-timing" data-pitwall-slot="standings" data-premium-timing="true" data-live={live ? "true" : "false"}>
        <header className="ptp-panel-head">
          <div>
            <p className="ptp-kicker">Timing tower</p>
            <h2>Live timing</h2>
          </div>
          <span className={`ptp-live-pill${live ? " is-live" : ""}`}>
            <span aria-hidden className="ptp-dot" />
            {live ? "Live" : "Offline"}
          </span>
        </header>
        <div className="ptp-timing-empty">
          <ListOrdered aria-hidden size={20} />
          <p>Wacht op tegenstanderdata…</p>
        </div>
      </section>
    );
  }

  return (
    <section className="ptp-panel ptp-timing" data-pitwall-slot="standings" data-premium-timing="true" data-live={live ? "true" : "false"} data-ptp-view={view}>
      <header className="ptp-panel-head ptp-timing-head">
        <div className="min-w-0">
          <p className="ptp-kicker">Timing tower · {rows.length} auto's</p>
          <h2>Live timing</h2>
        </div>
        <div className="ptp-timing-actions">
          <span className={`ptp-live-pill${live ? " is-live" : ""}`}>
            <span aria-hidden className="ptp-dot" />
            {live ? "Live" : "Offline"}
          </span>
          {ownRow && visibleRows.some((row) => row.id === ownRow.id) && (
            <button type="button" className="ptp-ghost-button" onClick={scrollToOwn}>
              Eigen rij <ChevronRight aria-hidden size={13} />
            </button>
          )}
        </div>
      </header>

      <div className="ptp-timing-tabs" role="group" aria-label="Timing-weergave">
        <button type="button" aria-pressed={view === "live"} onClick={() => setView("live")}>
          Live timing
        </button>
        <button type="button" aria-pressed={view === "class"} onClick={() => setView("class")}>
          Klasse
        </button>
        {view === "class" && classes.length > 1 && (
          <span className="ptp-class-filter">
            {classes.map((name) => (
              <button
                key={name}
                type="button"
                aria-pressed={activeClass === name}
                onClick={() => setSelectedClass(name)}
              >
                {name} <span className="ptp-count">{perClass[name] ?? 0}</span>
              </button>
            ))}
          </span>
        )}
      </div>

      <div className="ptp-focus" aria-label="Direct voor, jij en direct achter">
        <FocusCell tone="ahead" label="Voor" opponent={standings.ahead} />
        <FocusCell
          tone="own"
          label="Jij"
          own={{
            position: standings.overallPosition,
            number: ownCarNumber,
            name: ownCarLabel,
            gap: standings.ahead ? (standings.ahead.inPit ? "PIT" : renderGap(standings.ahead)) : null,
            pit: Boolean(standings.ahead?.inPit),
          }}
        />
        <FocusCell tone="behind" label="Achter" opponent={standings.behind} />
      </div>

      <div
        ref={scroller}
        className="ptp-timing-scroll"
        tabIndex={0}
        role="region"
        aria-label="Live timing — scrollbaar klassement"
      >
        <table className="ptp-timing-table" data-sector-count={sectorCount}>
          <caption className="sr-only">
            Live timing per klasse met positie, coureur, rondetijden, ronde, gap tot jouw auto en pitstatus.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="ptp-col-pos">P</th>
              <th scope="col" className="ptp-col-num">#</th>
              <th scope="col" className="ptp-col-driver">Coureur</th>
              <th scope="col" className="ptp-col-class">Klasse</th>
              <th scope="col" className="ptp-col-time">Laatste</th>
              <th scope="col" className="ptp-col-time">Beste</th>
              {sectorCount === 0 && <th scope="col" className="ptp-col-sector">Sectoren</th>}
              {sectorColumns.map((n) => (
                <th key={n} scope="col" className="ptp-col-sector">S{n + 1}</th>
              ))}
              <th scope="col" className="ptp-col-lap">Ronde</th>
              <th scope="col" className="ptp-col-gap">Gap tot jou</th>
              <th scope="col" className="ptp-col-pit">Pit</th>
            </tr>
          </thead>
          {ownRow && (
            <tbody className="ptp-own-pinned" aria-label="Eigen auto — vastgezet">
              {renderTimingRow(ownRow, true)}
            </tbody>
          )}
          <tbody>
            {visibleRows.map((r, index) => (
              <Fragment key={r.id}>
                {(index === 0 || classOf(visibleRows[index - 1]) !== classOf(r)) && (
                  <tr className="ptp-class-row" data-premium-class-row={classOf(r)}>
                    <th scope="colgroup" colSpan={9 + Math.max(1, sectorColumns.length)}>
                      <span>{classOf(r)}</span>
                      <span className="ptp-class-count">{perClass[classOf(r)] ?? 0} auto's</span>
                    </th>
                  </tr>
                )}
                {renderTimingRow(r)}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <p className="ptp-timing-note">
        Snapshot van tegenstanders, geen volledig klassement. +/− is het positieverschil per auto sinds de vorige
        meting — geen inhaalclaim. Gap is tot jouw auto. Scroll voor alle rijen.
      </p>
    </section>
  );
}
