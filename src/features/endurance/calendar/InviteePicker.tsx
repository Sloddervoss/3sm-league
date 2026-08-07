import { useMemo, useState } from "react";
import { Check, Search, X } from "lucide-react";
import { useDrivers } from "@/hooks/data/useSharedQueries";
import { inputClass } from "../shared/ui";

/**
 * Uitnodigings-picker — Fase 3.
 * Zoekbare ledenlijst (uit `public_profiles`, veilige publieke profieldata).
 * Geselecteerde rijders worden als verwijderbare chips getoond. De gekozen
 * `user_id`s worden in `invited_user_ids` van het endurance-event opgeslagen.
 */
type Driver = { user_id: string; display_name: string | null; iracing_name: string | null };
const nameOf = (d: Driver) => (d.display_name || d.iracing_name || "Onbekende rijder").trim();

export const InviteePicker = ({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) => {
  const { data: rows = [], isLoading } = useDrivers();
  const [query, setQuery] = useState("");

  const byId = useMemo(() => {
    const map = new Map<string, Driver>();
    for (const d of rows as Driver[]) map.set(d.user_id, d);
    return map;
  }, [rows]);

  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  const selected = value.map((id) => byId.get(id)).filter(Boolean) as Driver[];
  const q = query.trim().toLowerCase();
  const suggestions = (rows as Driver[])
    .filter((d) => !value.includes(d.user_id))
    .filter((d) => !q || nameOf(d).toLowerCase().includes(q))
    .slice(0, 24);

  return (
    <div className="sm:col-span-2 lg:col-span-3">
      <span className="mb-2 block text-xs font-bold uppercase tracking-wide text-gray-500">Uitgenodigde rijders</span>
      {selected.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {selected.map((d) => (
            <span key={d.user_id} className="flex items-center gap-2 rounded-xl bg-black/30 px-3 py-1.5 text-sm text-gray-200 ring-1 ring-white/10">
              {nameOf(d)}
              <button type="button" onClick={() => toggle(d.user_id)} aria-label={`Verwijder ${nameOf(d)}`} className="text-gray-400 transition hover:text-white">
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
        <input className={`${inputClass} pl-9`} placeholder={isLoading ? "Leden laden…" : "Zoek een rijder…"} value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {query && !isLoading && suggestions.length > 0 && (
        <div className="mt-2 max-h-56 overflow-y-auto rounded-xl bg-black/20 p-2 ring-1 ring-white/10">
          {suggestions.map((d) => (
            <button
              key={d.user_id}
              type="button"
              onClick={() => { toggle(d.user_id); setQuery(""); }}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-gray-200 transition hover:bg-white/5"
            >
              <span>{nameOf(d)}</span>
              <Check className="h-4 w-4 text-orange-400" />
            </button>
          ))}
        </div>
      )}
      {query && !isLoading && suggestions.length === 0 && <p className="mt-2 text-xs text-gray-500">Geen rijders gevonden.</p>}
    </div>
  );
};