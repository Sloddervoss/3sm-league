import { useMemo, useState } from "react";
import { ChevronsRight, Copy, Minus, Plus, Trash2 } from "lucide-react";
import { availabilityForStint, formatAmsterdam } from "../core/selectors";
import type { AvailabilityBlock, EnduranceEvent, EndurancePersona, EnduranceStint } from "../core/types";

const colors = ["bg-orange-500/80", "bg-sky-500/75", "bg-violet-500/75", "bg-emerald-500/75", "bg-rose-500/75"];

const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * StintTimeline met swimlanes. Iedere coureur heeft een eigen rij, waardoor een
 * 24u-planning (16+ stints over één balk) wél schaalbaar en bewerkbaar blijft:
 * - Sleep een stint langs de tijdlijn (horizontaal) om de tijd te verplaatsen.
 * - Sleep een stint naar een andere rij om van coureur te wisselen.
 * - Klik een stint aan → een detailpaneel toont starttijd, duur en coureur, met
 *   knopjes om precies aan te passen, te verlengen, te kopiëren of te wissen.
 * Alle tijden blijven op snapronde (snapMinutes) en binnen de race.
 */
export const StintTimeline = ({ event, stints, personas, availability, editable, snapMinutes, onMove, onResize, onDelete, onCopy, onExtend, onAssign }: { event: EnduranceEvent; stints: EnduranceStint[]; personas: EndurancePersona[]; availability: AvailabilityBlock[]; editable: boolean; snapMinutes: number; onMove: (stint: EnduranceStint, startAt: string) => void; onResize: (stint: EnduranceStint, deltaMinutes: number) => void; onDelete: (id: string) => void; onCopy: (stint: EnduranceStint) => void; onExtend: (stint: EnduranceStint) => void; onAssign: (stint: EnduranceStint, driverId: string) => void }) => {
  const start = new Date(event.startAt).getTime(); const end = new Date(event.endAt).getTime(); const span = end - start;
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Coureurs: echte teamleden eerst, daarna alle stints-coureurs (voor balken
  // waarvan de coureur tijdelijk uit het team is). Alleen 'driver'-rol krijgt
  // een eigen rij.
  const laneDrivers = useMemo(() => {
    const ordered = personas.filter((p) => p.role !== "reserve").map((p) => p.id);
    const seen = new Set(ordered);
    for (const stint of stints) {
      if (stint.driverId && !seen.has(stint.driverId)) ordered.push(stint.driverId);
      if (stint.driverId) seen.add(stint.driverId);
    }
    return ordered;
  }, [personas, stints]);

  const driverName = (id: string | null) => {
    if (!id) return "Onbekend";
    return personas.find((p) => p.id === id)?.name ?? stints.find((s) => s.driverId === id)?.driverId ?? id;
  };

  // Tijd-van-pixel in een lane (relatief aan de event-span).
  const minutesFromEvent = (clientX: number, rect: { left: number; width: number }) => {
    const rawMinutes = ((clientX - rect.left) / rect.width) * (span / 60_000);
    return Math.max(0, Math.round(rawMinutes / snapMinutes) * snapMinutes);
  };

  const laneDrop = (dropEvent: React.DragEvent<HTMLDivElement>, targetDriverId: string) => {
    if (!editable) return;
    dropEvent.preventDefault();
    const id = dropEvent.dataTransfer.getData("text/endurance-stint");
    const stint = stints.find((candidate) => candidate.id === id);
    if (!stint) return;
    const rect = dropEvent.currentTarget.getBoundingClientRect();
    const startMinutes = minutesFromEvent(dropEvent.clientX, { left: rect.left, width: rect.width });
    const duration = new Date(stint.actualEndAt).getTime() - new Date(stint.actualStartAt).getTime();
    const maxStartMinutes = Math.max(0, ((end - start - duration) / 60_000));
    const effectiveMinutes = Math.min(startMinutes, maxStartMinutes);
    // Coureur gewijzigd? Dat fikt zogezegd eerst, dan de tijd.
    if (stint.driverId !== targetDriverId) onAssign(stint, targetDriverId);
    onMove(stint, new Date(start + effectiveMinutes * 60_000).toISOString());
  };

  const selected = stints.find((s) => s.id === selectedId) ?? null;
  const selectedDurationMinutes = selected ? Math.round((new Date(selected.actualEndAt).getTime() - new Date(selected.actualStartAt).getTime()) / 60_000) : 0;

  const minutesToLabel = (adjustMinutes: number) => shiftClock(event.startAt, adjustMinutes);

  return <div className="space-y-4">
    {/* Tijdlijn */}
    <div className="overflow-x-auto">
      <div className="min-w-[880px] rounded-2xl bg-black/25 p-4 ring-1 ring-white/5">
        <div className="mb-2 flex justify-between text-[10px] font-bold uppercase tracking-wider text-gray-500"><span>{formatAmsterdam(event.startAt)}</span><span>25%</span><span>50%</span><span>75%</span><span>{formatAmsterdam(event.endAt)}</span></div>
        {/* Header-rij: tijds-as met elk uur eerlijk verdeeld */}
        <div className="relative h-6">
          {Array.from({ length: Math.ceil((end - start) / 3_600_000) + 1 }).map((_, h) => (
            <span key={h} className="absolute top-0 text-[10px] tabular-nums text-gray-500" style={{ left: `${(h * 3_600_000) / span * 100}%` }}>{shiftClock(event.startAt, h * 60).split(" ").pop()}</span>
          ))}
        </div>
        <div className="relative">
          {laneDrivers.map((driverId, laneIndex) => {
            const laneStints = stints.filter((s) => s.driverId === driverId);
            return (
              <div key={driverId} className="grid grid-cols-[120px_1fr]">
                {/* Coureur-label */}
                <div className={`flex items-center px-2 text-xs font-bold ${laneIndex === 0 ? "pt-4" : ""}`} style={{ color: colors[laneIndex % colors.length].replace("bg-", "") }}>
                  <span className="w-full truncate" style={{ textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}>{driverName(driverId)}</span>
                </div>
                {/* Lane */}
                <div
                  onDragOver={(e) => editable && e.preventDefault()}
                  onDrop={(e) => laneDrop(e, driverId)}
                  className={`relative h-16 rounded-lg ${laneIndex === 0 ? "mt-4" : "mt-1.5"} bg-white/[0.025] ring-1 ring-white/5`}
                >
                  <span className="pointer-events-none absolute left-2 top-1 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-white/40"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: colors[laneIndex % colors.length] }} />{laneIndex + 1}</span>
                  {laneStints.map((stint) => {
                    const left = ((new Date(stint.actualStartAt).getTime() - start) / span) * 100;
                    const width = ((new Date(stint.actualEndAt).getTime() - new Date(stint.actualStartAt).getTime()) / span) * 100;
                    const availabilityState = availabilityForStint(availability, stint);
                    const isSelected = stint.id === selectedId;
                    return <div
                      key={stint.id}
                      draggable={editable}
                      onClick={() => setSelectedId(isSelected ? null : stint.id)}
                      onDragStart={(e) => e.dataTransfer.setData("text/endurance-stint", stint.id)}
                      className={`absolute inset-y-1.5 cursor-pointer overflow-hidden rounded-lg shadow-md ring-2 transition-opacity ${isSelected ? "ring-2 ring-white" : "ring-white/15 opacity-90 hover:opacity-100"} ${colors[laneIndex % colors.length]} ${availabilityState === "hard" ? "ring-red-300" : availabilityState === "soft" || availabilityState === "missing" ? "ring-amber-300/70" : "ring-white/15"}`}
                      style={{ left: `${left}%`, width: `${Math.max(2, width)}%` }}
                      title={`${driverName(stint.driverId)} · ${formatAmsterdam(stint.actualStartAt)} – ${formatAmsterdam(stint.actualEndAt)}\nKlik voor details`}
                    >
                      <span className="block truncate px-1.5 text-[9px] font-black text-white" style={{ textShadow: "0 1px 2px rgba(0,0,0,0.7)" }}>{stint.expectedLaps}r</span>
                    </div>;
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-gray-500">{editable ? "Sleep een stint over de tijdlijn (tijd) of naar een andere rij (coureur). Klik een stint aan voor details." : "Klik op een stint voor details."}</p>
      </div>
    </div>

    {/* Detailpaneel */}
    {selected && (
      <div className="rounded-2xl bg-black/25 p-4 ring-1 ring-white/5">
        <div className="mb-3 flex items-center justify-between">
          <strong className="text-sm text-white">{driverName(selected.driverId)} · {selectedDurationMinutes} min</strong>
          <button type="button" onClick={() => setSelectedId(null)} className="text-xs text-gray-400 hover:text-white" aria-label="Detail sluiten">Sluiten</button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block text-xs">
            <span className="mb-1 block font-bold text-gray-400">Starttijd</span>
            <div className="flex items-center gap-1">
              <button type="button" disabled={!editable} onClick={() => onMove(selected, new Date(new Date(selected.actualStartAt).getTime() - snapMinutes * 60_000).toISOString())} className="rounded bg-black/30 px-2 py-1.5 text-white disabled:opacity-40" aria-label="Start eerder"><Minus className="h-3 w-3" /></button>
              <input className="w-full rounded-lg bg-black/30 px-2 py-1.5 text-sm text-white focus:outline-none" type="time" step={60} value={toLocalInput(selected.actualStartAt)} disabled={!editable} onChange={(e) => { if (!e.target.value) return; const parsed = new Date(`${event.startAt.slice(0, 10)}T${e.target.value}:00`); const startMs = Math.max(start, parsed.getTime()); onMove(selected, new Date(startMs).toISOString()); }} aria-label="Stint starttijd" />
              <button type="button" disabled={!editable} onClick={() => onMove(selected, new Date(new Date(selected.actualStartAt).getTime() + snapMinutes * 60_000).toISOString())} className="rounded bg-black/30 px-2 py-1.5 text-white disabled:opacity-40" aria-label="Start later"><Plus className="h-3 w-3" /></button>
            </div>
          </label>
          <label className="block text-xs">
            <span className="mb-1 block font-bold text-gray-400">Duur (min)</span>
            <div className="flex items-center gap-1">
              <button type="button" disabled={!editable} onClick={() => onResize(selected, -snapMinutes)} className="rounded bg-black/30 px-2 py-1.5 text-white disabled:opacity-40" aria-label="Duur korter"><Minus className="h-3 w-3" /></button>
              <span className="w-full rounded-lg bg-black/30 px-2 py-1.5 text-center text-sm font-bold text-white tabular-nums">{selectedDurationMinutes}</span>
              <button type="button" disabled={!editable} onClick={() => onResize(selected, snapMinutes)} className="rounded bg-black/30 px-2 py-1.5 text-white disabled:opacity-40" aria-label="Duur langer"><Plus className="h-3 w-3" /></button>
            </div>
          </label>
          <label className="block text-xs">
            <span className="mb-1 block font-bold text-gray-400">Einde</span>
            <span className="block rounded-lg bg-black/30 px-2 py-1.5 text-sm text-gray-300 tabular-nums">{formatAmsterdam(selected.actualEndAt)}</span>
          </label>
          <label className="block text-xs">
            <span className="mb-1 block font-bold text-gray-400">Coureur</span>
            <select className="w-full rounded-lg bg-black/30 px-2 py-1.5 text-sm text-white focus:outline-none" value={selected.driverId ?? ""} disabled={!editable} onChange={(e) => { if (e.target.value) onAssign(selected, e.target.value); }} aria-label="Stint coureur">
              {laneDrivers.map((driver) => <option key={driver} value={driver}>{driverName(driver)}</option>)}
            </select>
          </label>
        </div>
        {editable && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => onExtend(selected)} className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-xs font-bold text-white hover:bg-white/15" aria-label="Zelfde coureur nog een stint"><ChevronsRight className="h-3.5 w-3.5" /> Verlengen</button>
            <button type="button" onClick={() => onCopy(selected)} className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-xs font-bold text-white hover:bg-white/15" aria-label="Stint kopiëren"><Copy className="h-3.5 w-3.5" /> Kopiëren</button>
            <button type="button" onClick={() => onDelete(selected.id)} className="flex items-center gap-1.5 rounded-lg bg-red-500/20 px-3 py-2 text-xs font-bold text-red-200 hover:bg-red-500/30" aria-label="Stint verwijderen"><Trash2 className="h-3.5 w-3.5" /> Verwijderen</button>
          </div>
        )}
      </div>
    )}
  </div>;
};

// Kleine helper: verschuif een ISO-tijd over de event-as en return als label ("HH:mm").
function shiftClock(iso: string, adjustMinutes: number) {
  const d = new Date(new Date(iso).getTime() + adjustMinutes * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}