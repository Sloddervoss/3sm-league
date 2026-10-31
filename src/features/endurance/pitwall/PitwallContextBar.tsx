import type { ReactNode } from "react";

export type PitwallConnectionState = "live" | "offline" | "stale";

const stateCopy: Record<PitwallConnectionState, { label: string; dot: string; text: string }> = {
  live: { label: "LIVE", dot: "bg-emerald-400", text: "text-emerald-300" },
  stale: { label: "VERTRAAGD", dot: "bg-amber-300", text: "text-amber-300" },
  offline: { label: "OFFLINE", dot: "bg-slate-600", text: "text-slate-400" },
};

export interface PitwallContextItem {
  label: string;
  value: ReactNode;
  tone?: "neutral" | "accent" | "muted";
}

/**
 * De contextregel boven het dashboard: wie, waar, en of het nog vers is.
 *
 * Dit is de enige plek met de verbindingsstatus. De oude bovenbalk toonde
 * dezelfde cijfers als de KPI-strip en de beslissingsband; die dubbeling is
 * hier weg. Wat resteert is context — race of apparaat, team, versheid — plus
 * de knoppen van de pagina.
 */
export function PitwallContextBar({
  eyebrow,
  title,
  state,
  stateLabel,
  items = [],
  note,
  actions,
}: {
  eyebrow: string;
  title: string;
  state: PitwallConnectionState;
  /** Afwijkend woord bij de status, bijvoorbeeld "geen telemetrie". */
  stateLabel?: string;
  items?: PitwallContextItem[];
  note?: string;
  actions?: ReactNode;
}) {
  const copy = stateCopy[state];
  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-[#1D2431] bg-[#0A0C10] px-4 py-2.5"
      data-pitwall-context="true"
      data-pitwall-connection={state}
    >
      <div className="min-w-0">
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-400">{eyebrow}</p>
        <p className="truncate font-heading text-[15px] font-black text-white">{title}</p>
      </div>

      {items.length > 0 && <span aria-hidden className="hidden h-8 w-px shrink-0 bg-[#1D2431] self-center sm:block" />}

      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{item.label}</p>
          <p
            className={`truncate text-[13px] font-bold ${
              item.tone === "accent" ? "text-orange-300" : item.tone === "muted" ? "text-slate-400" : "text-slate-200"
            }`}
          >
            {item.value}
          </p>
        </div>
      ))}

      {note && <p className="min-w-0 truncate text-[11px] text-slate-500">{note}</p>}

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 text-[11px] font-black tracking-[0.12em] ${copy.text}`}
          data-pitwall-connection-label={state}
        >
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${copy.dot}`} aria-hidden />
          {stateLabel ?? copy.label}
        </span>
        {actions}
      </div>
    </div>
  );
}
