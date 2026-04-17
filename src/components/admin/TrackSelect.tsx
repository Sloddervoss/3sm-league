import { useState } from "react";
import { IRACING_TRACKS } from "@/lib/iracingTracks";

export const TrackSelect = ({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) => {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const filtered = query.length > 1
    ? IRACING_TRACKS.filter(t => t.toLowerCase().includes(query.toLowerCase())).slice(0, 40)
    : [];
  return (
    <div className="relative">
      <input
        type="text"
        value={open ? query : value}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => { setQuery(""); setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={value || "Zoek circuit..."}
        className={className || "w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"}
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-card border border-border rounded-md shadow-xl max-h-56 overflow-y-auto">
          {filtered.map(t => (
            <button
              key={t}
              type="button"
              onMouseDown={() => { onChange(t); setQuery(""); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-secondary transition-colors truncate"
            >
              {t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
