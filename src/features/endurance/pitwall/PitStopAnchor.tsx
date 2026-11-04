import { useCallback, useEffect, useRef, useState } from "react";
import { Fuel, LifeBuoy } from "lucide-react";
import { PitwallPanel } from "./PitwallPanel";
import {
  answerTyreStop,
  readTyreStops,
  type TyreStop,
  type TyreStopAnswer,
  type TyreStopSource,
} from "@/lib/pitwallTyreStops";

interface Props {
  source: TyreStopSource | null;
  /** Alleen ophalen als de pitwall live is; in de demo bestaat er geen bron. */
  enabled: boolean;
  /**
   * Toon een voorbeeldkaart als er nog geen pitstop is waargenomen. Alleen voor
   * de testpagina en de demo: daar moet het onderdeel zichtbaar en aanklikbaar
   * zijn zonder dat er iets wordt opgeslagen.
   */
  showExample?: boolean;
}

const formatClock = (seconds: number | null): string => {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
};

/**
 * Ankervak voor één pitbezoek.
 *
 * De plugin kan niet bewijzen dat er gewisseld is; de crew wel. Dit vak vraagt het
 * één keer per stop en legt het antwoord apart vast. Het verandert niets aan het
 * bandenadvies: zonder bewijs blijft de setgrens onbekend.
 */
export const PitStopAnchor = ({ source, enabled, showExample = false }: Props) => {
  const [stop, setStop] = useState<TyreStop | null>(null);
  const [sessionKey, setSessionKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exampleDone, setExampleDone] = useState<string | null>(null);
  // Elke bronwissel (ander team of event) krijgt een eigen reeks; een antwoord
  // van de vorige reeks mag deze nooit overschrijven.
  const generation = useRef(0);

  const load = useCallback(async () => {
    if (!enabled || !source) return;
    const mine = generation.current;
    try {
      const feed = await readTyreStops(source);
      if (mine !== generation.current) return;
      setSessionKey(feed?.sessionKey ?? null);
      const open = feed?.stops.find((s) => s.answer == null) ?? null;
      setStop(open);
      setError(null);
    } catch {
      if (mine !== generation.current) return;
      setStop(null);
      setError("Kon de pitbezoeken niet ophalen.");
    }
  }, [enabled, source]);

  useEffect(() => {
    generation.current += 1;
    setStop(null);
    setSessionKey(null);
    setDone(false);
    setError(null);
    void load();
    if (!enabled) return;
    const timer = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(timer);
  }, [enabled, load]);

  if (!enabled || !source) return null;
  if (!stop) {
    if (done) {
      return (
        <PitwallPanel title="Pitstop" slot="tyrestop">
          <p className="flex items-center gap-1 text-[11px] text-emerald-300">
            <LifeBuoy className="h-3 w-3" aria-hidden />
            Bedankt — vastgelegd.
          </p>
        </PitwallPanel>
      );
    }
    if (showExample) {
      return (
        <PitwallPanel title="Pitstop" slot="tyrestop" meta={<span className="text-slate-500">voorbeeld</span>}>
          <p className="text-[12px] text-slate-300">Pitstop · ronde —</p>
          <p className="mt-1 text-[11px] text-slate-500">
            Nog geen pitstop waargenomen. Zo ziet de vraag eruit zodra de auto binnenkomt.
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {([
              ["tyres", "Banden gewisseld"],
              ["fuel", "Alleen getankt"],
              ["both", "Beide"],
              ["none", "Geen van beide"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setExampleDone(label)}
                className="rounded border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-200 hover:bg-white/10"
              >
                {label}
              </button>
            ))}
          </div>
          {exampleDone && (
            <p className="mt-2 text-[11px] text-slate-500">
              Voorbeeld — “{exampleDone}” is niet opgeslagen; er is nog geen pitstop.
            </p>
          )}
        </PitwallPanel>
      );
    }
    if (error) {
      return (
        <PitwallPanel title="Pitstop" slot="tyrestop">
          <p className="text-[11px] text-amber-300">{error}</p>
        </PitwallPanel>
      );
    }
    // Zonder voorbeeld blijft het vak zichtbaar: anders denkt de crew dat de
    // vraag niet bestaat tot de eerste stop er is.
    return (
      <PitwallPanel title="Pitstop" slot="tyrestop">
        <p className="text-[11px] text-slate-500">
          Nog geen pitstop waargenomen in deze sessie.
        </p>
      </PitwallPanel>
    );
  }

  const fuelAdded =
    stop.fuelBeforeLitres != null && stop.fuelAfterLitres != null
      ? stop.fuelAfterLitres - stop.fuelBeforeLitres
      : null;

  const submit = async (answer: TyreStopAnswer) => {
    if (!sessionKey || busy) return;
    const mine = generation.current;
    setBusy(true);
    try {
      const ok = await answerTyreStop(source, stop, answer, sessionKey);
      if (mine !== generation.current) return;
      if (ok) {
        setDone(true);
        setStop(null);
      } else {
        setError("Niet vastgelegd.");
      }
    } catch {
      if (mine === generation.current) setError("Niet vastgelegd.");
    } finally {
      if (mine === generation.current) setBusy(false);
    }
  };

  return (
    <PitwallPanel title="Pitstop" slot="tyrestop" meta={<span className="text-amber-300">bevestiging nodig</span>}>
      <p className="text-[12px] text-slate-300">
        Pitstop{stop.lap != null ? ` · ronde ${stop.lap}` : ""}
        {stop.sessionTimeSeconds != null ? ` · ${formatClock(stop.sessionTimeSeconds)}` : ""}
      </p>
      {fuelAdded != null && (
        <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-400">
          <Fuel className="h-3 w-3" aria-hidden />
          Tankverschil: {fuelAdded.toFixed(1).replace(".", ",")} L (twee metingen)
        </p>
      )}
      <p className="mt-2 text-[11px] text-slate-500">Wat is er gebeurd?</p>
      <div className="mt-1 flex flex-wrap gap-1">
        <button type="button" disabled={busy} onClick={() => void submit("tyres")} className="rounded border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-200 hover:bg-white/10 disabled:opacity-50">
          Banden gewisseld
        </button>
        <button type="button" disabled={busy} onClick={() => void submit("fuel")} className="rounded border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-200 hover:bg-white/10 disabled:opacity-50">
          Alleen getankt
        </button>
        <button type="button" disabled={busy} onClick={() => void submit("both")} className="rounded border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-200 hover:bg-white/10 disabled:opacity-50">
          Beide
        </button>
        <button type="button" disabled={busy} onClick={() => void submit("none")} className="rounded border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-400 hover:bg-white/10 disabled:opacity-50">
          Geen van beide
        </button>
      </div>
      {done && (
        <p className="mt-2 flex items-center gap-1 text-[11px] text-emerald-300">
          <LifeBuoy className="h-3 w-3" aria-hidden />
          Bedankt — vastgelegd.
        </p>
      )}
      {error && <p className="mt-2 text-[11px] text-amber-300">{error}</p>}
    </PitwallPanel>
  );
};
