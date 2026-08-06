import { useEffect, useId, useMemo, useState } from "react";
import { IRACING_TRACKS } from "@/lib/iracingTracks";

/**
 * TrackSelect — circuit + layout in twee stappen.
 * Splits de volledige iRacing-naam ("Circuit de Spa - Endurance") op in een
 * schone Circuit- en aparte Configuratie-keuze, zodat de juiste layout makkelijk
 * te vinden is. De uitvoer blijft echter DE VOLLEDIGE naam (identiek aan de
 * invoer), dus de opslag en bestaande tracks veranderen niet : backward-compatibel.
 */
type TrackEntry = { circuit: string; config: string | null };
const SEP = " - ";

const parseTrack = (full: string): TrackEntry => {
  const idx = full.indexOf(SEP);
  return idx === -1 ? { circuit: full, config: null } : { circuit: full.slice(0, idx), config: full.slice(idx + SEP.length) };
};

const ENTRIES: TrackEntry[] = IRACING_TRACKS.map(parseTrack);
const CIRCUITS: string[] = [...new Set(ENTRIES.map((e) => e.circuit))].sort((a, b) => a.localeCompare(b, "nl"));
const CONFIGS_FOR: Record<string, string[]> = {};
for (const e of ENTRIES) {
  if (!e.config) continue;
  const list = CONFIGS_FOR[e.circuit] ?? (CONFIGS_FOR[e.circuit] = []);
  if (!list.includes(e.config)) list.push(e.config);
}
for (const c of Object.keys(CONFIGS_FOR)) CONFIGS_FOR[c].sort((a, b) => a.localeCompare(b, "nl"));

export const TrackSelect = ({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) => {
  const initial = useMemo(() => parseTrack(value || ""), []);
  const [circuit, setCircuit] = useState(initial.circuit || "");
  const [config, setConfig] = useState(initial.config || "");
  const uid = useId();

  useEffect(() => {
    const p = parseTrack(value || "");
    setCircuit(p.circuit || "");
    setConfig(p.config || "");
  }, [value]);

  const configs = CONFIGS_FOR[circuit] ?? [];
  const inputCls = className ?? "w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50";

  const emit = (c: string, cfg: string | null) => {
    const full = cfg ? `${c}${SEP}${cfg}` : c;
    if (full !== value && c) onChange(full);
  };

  const handleCircuit = (c: string) => {
    setCircuit(c);
    // géén layout automatisch invullen: anders verbergt een datalist de rest
    // (alleen prefix-matches). Leeg laten zodat álle layouts zichtbaar zijn.
    setConfig("");
    emit(c, null);
  };
  const handleConfig = (cfg: string) => {
    setConfig(cfg);
    emit(circuit, cfg || null);
  };

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div>
        <input
          type="text"
          list={`${uid}-circuits`}
          value={circuit}
          onChange={(e) => handleCircuit(e.target.value)}
          placeholder="Circuit..."
          aria-label="Circuit"
          className={inputCls}
        />
        <datalist id={`${uid}-circuits`}>{CIRCUITS.map((c) => <option key={c} value={c} />)}</datalist>
      </div>
      <div>
        <input
          type="text"
          list={`${uid}-configs`}
          value={config}
          onChange={(e) => handleConfig(e.target.value)}
          placeholder={configs.length ? "Configuratie / layout" : "Geen aparte layout"}
          disabled={!configs.length}
          aria-label="Configuratie"
          className={inputCls}
        />
        <datalist id={`${uid}-configs`}>{configs.map((c) => <option key={c} value={c} />)}</datalist>
      </div>
    </div>
  );
};
