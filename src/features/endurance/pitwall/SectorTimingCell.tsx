import {
  describeSectorSlot,
  formatSectorDelta,
  formatSectorSeconds,
  sectorDeltaTone,
  statusLabel,
  type SectorSlot,
} from "./sectorTiming";

const deltaClass: Record<ReturnType<typeof sectorDeltaTone>, string> = {
  negative: "text-emerald-400",
  positive: "text-red-400",
  neutral: "text-slate-500",
};

const statusClass = {
  provisional: "text-amber-300",
  verified: "text-emerald-400",
} as const;

/**
 * Compacte sectorcel voor de klassieke en premium timingtabellen.
 *
 * Tijd, status en ronde blijven los zichtbaar. Een vorige ronde wordt gedimd;
 * een mengeling van laatste sectoren krijgt per cel zijn eigen rondelabel en
 * wordt nooit als één complete ronde gepresenteerd. Ontbrekend of ongeldig
 * blijft een streepje.
 */
export function SectorTimingCell({ slot, className = "" }: { slot: SectorSlot | null; className?: string }) {
  if (!slot) {
    return <span className={`text-slate-600 ${className}`} data-sector-status="missing">—</span>;
  }
  const title = describeSectorSlot(slot) ?? undefined;
  if (slot.status === "invalidated" || slot.seconds == null) {
    return (
      <span
        className={`text-slate-600 ${className}`}
        data-sector-status="invalidated"
        data-sector-lap={slot.lap}
        title={title}
      >
        —
      </span>
    );
  }

  const delta = formatSectorDelta(slot.deltaSeconds);
  const tone = sectorDeltaTone(slot.deltaSeconds);
  const status = slot.status;
  return (
    <span
      className={`inline-flex min-w-0 flex-col items-end whitespace-nowrap leading-tight ${slot.isPreviousLap ? "opacity-60" : ""} ${className}`}
      data-sector-status={status}
      data-sector-lap={slot.lap}
      data-sector-previous={slot.isPreviousLap ? "true" : undefined}
      data-sector-session-best={slot.isSessionBest ? "true" : undefined}
      title={title}
    >
      <span className="inline-flex items-baseline gap-1">
        <span className={slot.isSessionBest ? "font-bold text-fuchsia-300" : undefined}>
          {formatSectorSeconds(slot.seconds)}
        </span>
        <span
          className={`text-[8px] font-bold uppercase ${statusClass[status === "provisional" ? "provisional" : "verified"]}`}
          title={statusLabel(status)}
          aria-label={statusLabel(status)}
        >
          {status === "provisional" ? "P" : "✓"}
        </span>
      </span>
      <span className="inline-flex items-baseline gap-1 text-[9px]">
        {delta != null
          ? <span className={deltaClass[tone]} data-sector-delta={delta}>{delta}</span>
          : <span className="text-slate-600" data-sector-delta="missing" title="Geen referentie voor dit verschil">—</span>}
        <span className="text-slate-500">R{slot.lap}</span>
      </span>
    </span>
  );
}
