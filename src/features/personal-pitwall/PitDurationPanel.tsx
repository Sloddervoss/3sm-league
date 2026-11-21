import { useEffect, useRef, useState } from "react";
import { Timer } from "lucide-react";
import { PitwallPanel } from "@/features/endurance/pitwall/PitwallPanel";
import {
  PIT_DURATION_SEMANTICS,
  formatPitDuration,
  type PersonalPitFeed,
} from "./pitVisits";

interface Props {
  deviceId: string | null;
  enabled: boolean;
  /** Injectable for tests; production uses the owner-scoped RPC. */
  load: (deviceId: string) => Promise<PersonalPitFeed>;
  pollMs?: number;
}

const EMPTY: PersonalPitFeed = { available: false, reason: "no_completed_visit", sessionKey: null, visits: [] };

/**
 * Persoonlijke pitduur, van pit-in tot pit-uit.
 *
 * De kaart is met opzet smal gehouden: één gemeten getal, de ronde en de
 * herkomst. Zij voedt geen strategie-advies en noemt de waarde nooit
 * "netto verlies"; service zit in de bruto pitstraattijd.
 */
export function PitDurationPanel({ deviceId, enabled, load, pollMs = 5_000 }: Props) {
  const [feed, setFeed] = useState<PersonalPitFeed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    generation.current += 1;
    const mine = generation.current;
    if (!enabled || !deviceId) {
      setFeed(null);
      setError(null);
      return;
    }
    let alive = true;
    const run = async () => {
      try {
        const next = await load(deviceId);
        if (!alive || mine !== generation.current) return;
        setFeed(next);
        setError(null);
      } catch {
        if (!alive || mine !== generation.current) return;
        // Een mislukte eigenaar-read mag de rest van de pitwall niet raken.
        setFeed((previous) => previous ?? EMPTY);
        setError("Pitduur kon niet worden geladen.");
      }
    };
    void run();
    const timer = window.setInterval(() => void run(), pollMs);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [deviceId, enabled, load, pollMs]);

  const visit = feed?.visits[0] ?? null;
  const meta = <span className="text-[10px] text-slate-500">pit-in → pit-out</span>;

  if (!enabled || !deviceId) return null;

  return (
    <PitwallPanel title="Pitduur" slot="pitduration" meta={meta}>
      {error ? <p className="text-[11px] text-amber-300">{error}</p> : null}
      {!feed && !error ? (
        <p className="text-[11px] text-slate-500">Pitduur laden…</p>
      ) : visit ? (
        <div data-pit-visit={visit.visitKey} data-pit-source={visit.source}>
          <p className="flex items-baseline gap-1.5 font-mono text-[18px] font-bold text-slate-100" data-pit-duration={visit.pitLaneSeconds}>
            <Timer aria-hidden size={13} className="text-slate-500" />
            {formatPitDuration(visit.pitLaneSeconds)}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-400">
            {visit.exitLap != null ? `Ronde ${visit.exitLap}` : "Afgeronde stop"}
            {feed && feed.visits.length > 1 ? ` · ${feed.visits.length} stops in deze sessie` : ""}
          </p>
          <p className="mt-1 text-[10px] leading-snug text-slate-400">{PIT_DURATION_SEMANTICS}</p>
        </div>
      ) : (
        <p className="text-[11px] text-slate-500">
          {feed?.reason === "no_session"
            ? "Nog geen sessie op dit apparaat."
            : "Nog geen afgeronde pitstop in deze sessie."}
        </p>
      )}
    </PitwallPanel>
  );
}
