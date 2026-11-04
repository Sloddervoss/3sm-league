import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Fuel, LifeBuoy } from "lucide-react";
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
  /** Voorbeeldkaart als er nog geen pitstop is waargenomen (testpagina en demo). */
  showExample?: boolean;
  /** Hoe vaak er wordt gekeken; alleen voor tests anders dan 15 s. */
  pollMs?: number;
}

/**
 * Hoe lang de vraag open blijft staan. Daarna klapt hij dicht tot een teller:
 * de pitwall mag nooit blijven vragen terwijl niemand meekijkt.
 */
const VRAAG_OPEN_MS = 30_000;

/** Onthouden welke stops al gevraagd zijn, ook over een herlaad heen. */
const GEVRAAAGD_KEY = "pitwall.pitstop.gevraagd";

const formatClock = (seconds: number | null): string => {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

/** Dezelfde stop in een andere sessie of bij een ander device is een andere stop. */
const vraagSleutel = (sourceKey: string, sessionKey: string | null, visitKey: string): string =>
  `${sourceKey}|${sessionKey ?? "-"}|${visitKey}`;

const bronSleutel = (source: TyreStopSource): string =>
  source.deviceId ?? `${source.eventId ?? "-"}:${source.teamId ?? "-"}`;

const leesGevraagd = (): Set<string> => {
  try {
    return new Set(JSON.parse(window.sessionStorage.getItem(GEVRAAAGD_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
};

const bewaarGevraagd = (keys: Set<string>) => {
  try {
    window.sessionStorage.setItem(GEVRAAAGD_KEY, JSON.stringify([...keys].slice(-40)));
  } catch {
    /* opslag geweigerd: dan geldt alleen dit geheugen */
  }
};

const KEUZES: ReadonlyArray<readonly [TyreStopAnswer, string]> = [
  ["tyres", "Banden gewisseld"],
  ["fuel", "Alleen getankt"],
  ["both", "Beide"],
  ["none", "Geen van beide"],
];

/**
 * Bevestiging van een pitbezoek.
 *
 * De meting kan niet bewijzen wat er in de pitstraat is gebeurd; de crew wel.
 * Daarom vraagt dit vak het — maar nooit blijvend: de vraag staat dertig
 * seconden open, klapt daarna dicht tot een teller, en is later alsnog in te
 * vullen. Niets invullen betekent onbekend, niet "geen service".
 */
export const PitStopAnchor = ({ source, enabled, showExample = false, pollMs = 15000 }: Props) => {
  const [stops, setStops] = useState<TyreStop[]>([]);
  const [sessionKey, setSessionKey] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exampleDone, setExampleDone] = useState<string | null>(null);
  const [geladen, setGeladen] = useState(false);
  const [bevestigd, setBevestigd] = useState(false);
  const generation = useRef(0);
  const gevraagd = useRef<Set<string>>(new Set());
  // Lokaal bevestigde stops: een poll die vóór het opslaan begon mag ze niet
  // terugzetten, anders kan de crew hetzelfde antwoord nog eens overschrijven.
  const beantwoord = useRef<Set<string>>(new Set());
  // De sessie waaronder de zichtbare stops zijn opgehaald. Een bevestiging die
  // na een sessiewissel terugkomt mag die lijst niet meer aanraken.
  const sessieRef = useRef<string | null>(null);
  // Zodra er één stop is gezien, valt het vak nooit meer terug op de voorbeeld-
  // kaart. Anders wisselt het elke poll van inhoud als een sessie net leeg is.
  const hadStop = useRef(false);
  const sluitTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    if (!enabled || !source) return;
    const mine = generation.current;
    try {
      const feed = await readTyreStops(source);
      if (mine !== generation.current) return;
      const key = feed?.sessionKey ?? null;
      const vorigeSessie = sessieRef.current;
      sessieRef.current = key;
      setSessionKey(key);
      const bron = bronSleutel(source);
      const openStops = (feed?.stops ?? []).filter(
        (s) => s.answer == null && !beantwoord.current.has(vraagSleutel(bron, key, s.visitKey)),
      );
      if (openStops.length > 0) hadStop.current = true;
      setStops((prev) => {
        // Een lege poll in dezelfde sessie mag een openstaande vraag niet
        // weghalen; pas bij een andere sessie of een bevestigd antwoord vervalt ze.
        if (openStops.length === 0 && prev.length > 0 && vorigeSessie === key) return prev;
        return openStops;
      });
      setError(null);
      setGeladen(true);

      // De nieuwste onbeantwoorde stop opent de vraag — één keer. Alle stops die
      // nu in het vak staan gelden als gevraagd, zodat er na het beantwoorden
      // geen oudere vraag vanzelf opnieuw openklapt.
      const nieuwste = openStops[0];
      const nieuw = nieuwste ? vraagSleutel(bron, key, nieuwste.visitKey) : null;
      if (nieuw && !gevraagd.current.has(nieuw)) {
        for (const s of openStops) gevraagd.current.add(vraagSleutel(bron, key, s.visitKey));
        bewaarGevraagd(gevraagd.current);
        setOpen(true);
        setBevestigd(false);
        if (sluitTimer.current) window.clearTimeout(sluitTimer.current);
        sluitTimer.current = window.setTimeout(() => setOpen(false), VRAAG_OPEN_MS);
      }
    } catch {
      if (mine !== generation.current) return;
      setStops([]);
      setGeladen(true);
      setError("Kon de pitbezoeken niet ophalen.");
    }
  }, [enabled, source]);

  useEffect(() => {
    generation.current += 1;
    gevraagd.current = leesGevraagd();
    setStops([]);
    setOpen(false);
    setSessionKey(null);
    setError(null);
    setExampleDone(null);
    setBevestigd(false);
    setBusy(null);
    setGeladen(false);
    void load();
    if (!enabled) return;
    const timer = window.setInterval(() => void load(), pollMs);
    return () => {
      window.clearInterval(timer);
      if (sluitTimer.current) window.clearTimeout(sluitTimer.current);
    };
  }, [enabled, load, pollMs]);

  // De vraag sluit pas als de lijst leeg is én er iets bevestigd is; niet op
  // het moment van bevestigen zelf, want de lijst kan intussen zijn aangevuld.
  useEffect(() => {
    if (bevestigd && stops.length === 0) setOpen(false);
  }, [bevestigd, stops.length]);

  if (!enabled || !source) return null;

  const stop = stops[0] ?? null;

  if (!stop) {
    if (error) {
      return (
        <PitwallPanel title="Pitstop" slot="tyrestop">
          <p className="text-[11px] text-amber-300">{error}</p>
        </PitwallPanel>
      );
    }
    if (!geladen) {
      return (
        <PitwallPanel title="Pitstop" slot="tyrestop">
          <p className="text-[11px] text-slate-500">Pitstops laden…</p>
        </PitwallPanel>
      );
    }
    if (showExample && !hadStop.current) {
      return (
        <PitwallPanel title="Pitstop" slot="tyrestop" meta={<span className="text-slate-500">voorbeeld</span>}>
          <p className="text-[12px] text-slate-300">Pitstop · ronde —</p>
          <p className="mt-1 text-[11px] text-slate-500">
            Nog geen pitstop waargenomen. Zo ziet de vraag eruit zodra de auto binnenkomt.
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {KEUZES.map(([value, label]) => (
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
    return (
      <PitwallPanel title="Pitstop" slot="tyrestop">
        <p className="text-[11px] text-slate-500">
          {error ?? (bevestigd ? "Bevestigd — bedankt." : "Geen openstaande stops.")}
        </p>
      </PitwallPanel>
    );
  }

  const fuelAdded =
    stop.fuelBeforeLitres != null && stop.fuelAfterLitres != null
      ? stop.fuelAfterLitres - stop.fuelBeforeLitres
      : null;

  // Handmatig openen mag niet meteen weer dichtgaan door de timer van de
  // automatische vraag; die hoort alleen bij het moment dat de stop binnenkomt.
  const openMetTik = () => {
    if (sluitTimer.current) {
      window.clearTimeout(sluitTimer.current);
      sluitTimer.current = null;
    }
    setOpen(true);
  };

  const submit = async (target: TyreStop, answer: TyreStopAnswer) => {
    if (!sessionKey || busy) return;
    const mine = generation.current;
    const onderSessie = sessionKey;
    setBusy(target.visitKey);
    try {
      const ok = await answerTyreStop(source, target, answer, sessionKey);
      if (mine !== generation.current || sessieRef.current !== onderSessie) return;
      if (ok) {
        beantwoord.current.add(vraagSleutel(bronSleutel(source), onderSessie, target.visitKey));
        // Op de actuele lijst werken: een poll kan er tijdens het bevestigen
        // een nieuwe stop bij hebben gezet, en die mag niet verdwijnen.
        setStops((prev) => prev.filter((s) => s.visitKey !== target.visitKey));
        setBevestigd(true);
        setError(null);
      } else {
        setError("Niet vastgelegd.");
      }
    } catch {
      if (mine === generation.current && sessieRef.current === onderSessie) setError("Niet vastgelegd.");
    } finally {
      if (mine === generation.current) setBusy(null);
    }
  };

  const meta = open ? (
    <span className="text-amber-300">bevestiging nodig</span>
  ) : (
    <button
      type="button"
      onClick={openMetTik}
      className="flex items-center gap-0.5 text-[11px] text-slate-400 hover:text-slate-200"
      aria-expanded={open}
    >
      {stops.length === 1 ? "1 stop nog te bevestigen" : `${stops.length} stops nog te bevestigen`}
      <ChevronDown className="h-3 w-3" aria-hidden />
    </button>
  );

  if (!open) {
    return (
      <PitwallPanel title="Pitstop" slot="tyrestop" meta={meta}>
        <p className="text-[11px] text-slate-500">
          {stop.lap != null ? `Ronde ${stop.lap}` : "Pitbezoek"}
          {stop.sessionTimeSeconds != null ? ` · ${formatClock(stop.sessionTimeSeconds)}` : ""}
          {" — nog niet bevestigd."}
          {fuelAdded != null
            ? ` Tankverschil ${fuelAdded.toFixed(1).replace(".", ",")} L.`
            : ""}
        </p>
      </PitwallPanel>
    );
  }

  return (
    <PitwallPanel title="Pitstop" slot="tyrestop" meta={meta}>
      <div className="space-y-2">
        {stops.map((s) => {
          const verschil =
            s.fuelBeforeLitres != null && s.fuelAfterLitres != null
              ? s.fuelAfterLitres - s.fuelBeforeLitres
              : null;
          return (
            <div
              key={s.visitKey}
              className="flex flex-col gap-2 rounded border border-white/5 px-3 py-2 md:flex-row md:items-center md:justify-between"
            >
              <div className="min-w-0">
              <p className="text-[12px] text-slate-300">
                {s.lap != null ? `Ronde ${s.lap}` : "Pitbezoek"}
                {s.sessionTimeSeconds != null ? ` · ${formatClock(s.sessionTimeSeconds)}` : ""}
              </p>
              {verschil != null && (
                <p className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-400">
                  <Fuel className="h-3 w-3" aria-hidden />
                  Tankverschil: {verschil.toFixed(1).replace(".", ",")} L (twee metingen)
                </p>
              )}
              </div>
              <div className="flex flex-wrap gap-1">
                {KEUZES.map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    disabled={busy != null}
                    onClick={() => void submit(s, value)}
                    className="rounded border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-200 hover:bg-white/10 disabled:opacity-50"
                  >
                    {busy === s.visitKey ? "…" : label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        {error && <p className="text-[11px] text-amber-300">{error}</p>}
        <p className="flex items-center gap-1 text-[11px] text-slate-500">
          <LifeBuoy className="h-3 w-3" aria-hidden />
          Niets invullen betekent onbekend — niet “geen service”.
        </p>
      </div>
    </PitwallPanel>
  );
};
