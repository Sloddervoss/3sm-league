import { useEffect, useId, useMemo, useState } from "react";
import {
  loadLayeredTrackManifest,
  normalizeTrackName,
  type LayeredTrackEntry,
} from "@/lib/layeredTrackMaps";

type TrackOption = LayeredTrackEntry & { circuit: string; config: string | null };

const toOption = (entry: LayeredTrackEntry): TrackOption => {
  const config = entry.configName.trim();
  const suffix = config ? ` - ${config}` : "";
  const circuit = suffix && entry.name.endsWith(suffix)
    ? entry.name.slice(0, -suffix.length)
    : entry.name;
  return { ...entry, circuit, config: config || null };
};

/**
 * Authoritative Circuit + Configuratie selector.
 * Every selectable value comes from the local layered manifest and emits both
 * the readable full name and its numeric iRacing TrackID.
 */
export const TrackSelect = ({
  value,
  trackId = null,
  onChange,
  className,
}: {
  value: string;
  trackId?: number | null;
  onChange: (name: string, trackId: number | null) => void;
  className?: string;
}) => {
  const [entries, setEntries] = useState<TrackOption[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [circuitChoice, setCircuitChoice] = useState("");
  const uid = useId();

  useEffect(() => {
    let active = true;
    void loadLayeredTrackManifest().then((manifest) => {
      if (!active) return;
      if (!manifest) {
        setLoadFailed(true);
        return;
      }
      setEntries(manifest.tracks.map(toOption));
    });
    return () => { active = false; };
  }, []);

  const selected = useMemo(() => {
    if (trackId != null) return entries.find((entry) => entry.trackId === trackId) ?? null;
    const normalized = normalizeTrackName(value || "");
    return entries.find((entry) => normalizeTrackName(entry.name) === normalized) ?? null;
  }, [entries, trackId, value]);
  useEffect(() => {
    if (selected) setCircuitChoice(selected.circuit);
  }, [selected]);
  const selectedCircuit = selected?.circuit ?? circuitChoice;
  const circuits = useMemo(
    () => [...new Set(entries.map((entry) => entry.circuit))].sort((a, b) => a.localeCompare(b, "nl")),
    [entries],
  );
  const configurations = useMemo(
    () => entries.filter((entry) => entry.circuit === selectedCircuit).sort((a, b) => (a.config ?? a.name).localeCompare(b.config ?? b.name, "nl")),
    [entries, selectedCircuit],
  );
  const inputCls = className ?? "w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50";

  const selectCircuit = (circuit: string) => {
    setCircuitChoice(circuit);
    if (!circuit) {
      onChange("", null);
      return;
    }
    const options = entries.filter((entry) => entry.circuit === circuit);
    if (options.length === 1) onChange(options[0].name, options[0].trackId);
    else onChange(circuit, null);
  };

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <select
        id={`${uid}-circuit`}
        value={selectedCircuit}
        onChange={(event) => selectCircuit(event.target.value)}
        className={inputCls}
        aria-label="Circuit"
        disabled={!entries.length}
      >
        <option value="">{loadFailed ? "Circuitcatalogus niet beschikbaar" : "Kies circuit…"}</option>
        {circuits.map((circuit) => <option key={circuit} value={circuit}>{circuit}</option>)}
      </select>
      <select
        id={`${uid}-configuration`}
        value={selected?.trackId ?? ""}
        onChange={(event) => {
          const entry = entries.find((candidate) => candidate.trackId === Number(event.target.value));
          if (entry) onChange(entry.name, entry.trackId);
        }}
        className={inputCls}
        aria-label="Configuratie"
        disabled={!selectedCircuit || !configurations.length}
      >
        <option value="">{selectedCircuit ? "Kies configuratie / layout…" : "Kies eerst een circuit"}</option>
        {configurations.map((entry) => (
          <option key={entry.trackId} value={entry.trackId}>{entry.config ?? entry.name}</option>
        ))}
      </select>
      {value && !selected && (
        <p className="text-xs text-amber-400 sm:col-span-2">
          Bestaande historische waarde: {value}. Kies een geldige lokale configuratie om een TrackID vast te leggen.
        </p>
      )}
    </div>
  );
};
