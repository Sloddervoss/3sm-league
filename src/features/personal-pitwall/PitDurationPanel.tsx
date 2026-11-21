import { useEffect, useRef, useState } from "react";
import { Timer } from "lucide-react";
import { PitwallPanel } from "@/features/endurance/pitwall/PitwallPanel";
import {
  EMPTY_PIT_DIAGNOSTICS,
  PIT_BENCHMARK_SEMANTICS,
  PIT_DURATION_SEMANTICS,
  formatPitDuration,
  type PersonalPitFeed,
} from "./pitVisits";

interface Props {
  deviceId: string | null;
  enabled: boolean;
  /** Injectable for tests; production uses the owner-scoped or admin reader. */
  load: (deviceId: string) => Promise<PersonalPitFeed>;
  pollMs?: number;
  /**
   * Identiteit van het device én de sessie die op dit moment op het scherm
   * staat (device + last_session_id + session_id + race_run_id). Zonder deze
   * grens zou een net gewisseld device één frame lang de stop van het vorige
   * device kunnen tonen. Een oude, later binnenkomende query mag de nieuwe
   * context nooit overschrijven.
   */
  contextKey?: string | null;
}

const EMPTY: PersonalPitFeed = {
  available: false,
  reason: "no_completed_visit",
  sessionKey: null,
  visits: [],
  diagnostics: EMPTY_PIT_DIAGNOSTICS,
};

type ScopedFeed = { context: string; feed: PersonalPitFeed };
type ScopedError = { context: string; message: string };

/**
 * Persoonlijke pitduur, van pit-in tot pit-uit.
 *
 * De kaart is met opzet smal gehouden: één gemeten getal, de bronflanken en de
 * herkomst. Zij voedt geen strategie-advies en noemt de waarde nooit "netto
 * verlies"; service zit in de bruto pitstraattijd. De strategie leest hem
 * alleen als aparte laatste-stop-benchmark.
 *
 * Dezelfde kaart en dezelfde copy worden gebruikt door Mijn Pitwall en de
 * admin-pitwalltest. Alleen de lezer verschilt (owner vs. beheerder); de
 * server-RPC bewaakt de autorisatie in beide gevallen.
 */
export function PitDurationPanel({ deviceId, enabled, load, pollMs = 5_000, contextKey = null }: Props) {
  // De context staat naast de data, niet alleen in een ref. Daardoor kan een
  // render met een nieuw device/de nieuwe sessie de oude feed niet één frame
  // lang laten zien; de mismatch verbergt hem vóór de effect-cleanup loopt.
  const scopedContext = `${enabled ? "1" : "0"}|${deviceId ?? ""}|${contextKey ?? ""}`;
  const [scopedFeed, setScopedFeed] = useState<ScopedFeed | null>(null);
  const [scopedError, setScopedError] = useState<ScopedError | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    generation.current += 1;
    const mine = generation.current;
    if (!enabled || !deviceId) {
      setScopedFeed(null);
      setScopedError(null);
      return;
    }
    let alive = true;
    const run = async () => {
      try {
        const next = await load(deviceId);
        if (!alive || mine !== generation.current) return;
        setScopedFeed({ context: scopedContext, feed: next });
        setScopedError(null);
      } catch {
        if (!alive || mine !== generation.current) return;
        // Een mislukte lees mag de rest van de pitwall niet raken en ook geen
        // oude stop van een vorige sessie laten staan.
        setScopedFeed((previous) =>
          previous?.context === scopedContext ? previous : { context: scopedContext, feed: EMPTY },
        );
        setScopedError({ context: scopedContext, message: "Pitduur kon niet worden geladen." });
      }
    };
    void run();
    const timer = window.setInterval(() => void run(), pollMs);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [deviceId, enabled, load, pollMs, scopedContext]);

  const feed = scopedFeed?.context === scopedContext ? scopedFeed.feed : null;
  const error = scopedError?.context === scopedContext ? scopedError.message : null;
  const visit = feed?.visits[0] ?? null;
  const meta = <span className="text-[10px] text-slate-500">pit-in → pit-out</span>;
  const diagnostics = feed?.diagnostics ?? EMPTY_PIT_DIAGNOSTICS;

  if (!enabled || !deviceId) return null;

  return (
    <PitwallPanel title="Laatste stop" slot="pitduration" meta={meta}>
      {error ? <p className="text-[11px] text-amber-300">{error}</p> : null}
      {!feed && !error ? (
        <p className="text-[11px] text-slate-500">Pitduur laden…</p>
      ) : visit ? (
        <div data-pit-visit={visit.visitKey} data-pit-source={visit.source} data-pit-benchmark="gross">
          <p className="flex items-baseline gap-1.5 font-mono text-[18px] font-bold text-slate-100" data-pit-duration={visit.pitLaneSeconds}>
            <Timer aria-hidden size={13} className="text-slate-500" />
            {formatPitDuration(visit.pitLaneSeconds)}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-400" data-pit-benchmark-label="true">
            {PIT_BENCHMARK_SEMANTICS}
            {feed && feed.visits.length > 1 ? ` · ${feed.visits.length} stops in deze sessie` : ""}
          </p>
          <p className="mt-1 text-[10px] leading-snug text-slate-400">{PIT_DURATION_SEMANTICS}</p>
        </div>
      ) : (
        <div data-pit-benchmark-empty="true">
          <p className="text-[11px] text-slate-500">
            {feed?.reason === "no_session"
              ? "Nog geen sessie op dit apparaat."
              : "Nog geen afgeronde pitstop in deze sessie."}
          </p>
          {diagnostics.pendingEdges > 0 && (
            <p className="mt-1 text-[10px] text-amber-300" data-pit-pending-edges={diagnostics.pendingEdges}>
              {diagnostics.pendingEdges} bronflank(en) wachten nog op hun paar.
            </p>
          )}
          {diagnostics.rejectedEdges > 0 && (
            <p className="mt-1 text-[10px] text-slate-400" data-pit-rejected-edges={diagnostics.rejectedEdges}>
              {diagnostics.rejectedEdges} flank(en) afgekeurd
              {diagnostics.lastRejectReason ? ` · ${diagnostics.lastRejectReason}` : ""}
            </p>
          )}
        </div>
      )}
    </PitwallPanel>
  );
}
