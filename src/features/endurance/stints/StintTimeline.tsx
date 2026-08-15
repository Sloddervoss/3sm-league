import { Copy, GripVertical, Minus, Plus, Trash2 } from "lucide-react";
import { availabilityForStint, formatAmsterdam } from "../core/selectors";
import type { AvailabilityBlock, EnduranceEvent, EndurancePersona, EnduranceStint } from "../core/types";

const colors = ["bg-orange-500/80", "bg-sky-500/75", "bg-violet-500/75", "bg-emerald-500/75", "bg-rose-500/75"];

export const StintTimeline = ({ event, stints, personas, availability, editable, snapMinutes, onMove, onResize, onDelete, onCopy }: { event: EnduranceEvent; stints: EnduranceStint[]; personas: EndurancePersona[]; availability: AvailabilityBlock[]; editable: boolean; snapMinutes: number; onMove: (stint: EnduranceStint, startAt: string) => void; onResize: (stint: EnduranceStint, deltaMinutes: number) => void; onDelete: (id: string) => void; onCopy: (stint: EnduranceStint) => void }) => {
  const start = new Date(event.startAt).getTime(); const end = new Date(event.endAt).getTime(); const span = end - start;
  const sorted = [...stints].sort((a, b) => a.actualStartAt.localeCompare(b.actualStartAt));
  const drop = (dropEvent: React.DragEvent<HTMLDivElement>) => { if (!editable) return; dropEvent.preventDefault(); const id = dropEvent.dataTransfer.getData("text/endurance-stint"); const stint = stints.find((candidate) => candidate.id === id); if (!stint) return; const rect = dropEvent.currentTarget.getBoundingClientRect(); const rawMinutes = ((dropEvent.clientX - rect.left) / rect.width) * (span / 60_000); const snapped = Math.max(0, Math.round(rawMinutes / snapMinutes) * snapMinutes); const duration = new Date(stint.actualEndAt).getTime() - new Date(stint.actualStartAt).getTime(); const maxStart = end - duration; onMove(stint, new Date(Math.min(maxStart, start + snapped * 60_000)).toISOString()); };
  return <div className="overflow-x-auto"><div className="min-w-[880px] rounded-2xl bg-black/25 p-4 ring-1 ring-white/5">
    <div className="mb-2 flex justify-between text-[10px] font-bold uppercase tracking-wider text-gray-500"><span>{formatAmsterdam(event.startAt)}</span><span>25%</span><span>50%</span><span>75%</span><span>{formatAmsterdam(event.endAt)}</span></div>
    <div onDragOver={(e) => editable && e.preventDefault()} onDrop={drop} className="relative h-36 overflow-hidden rounded-xl bg-white/[0.025] ring-1 ring-white/5">
      {[25, 50, 75].map((position) => <span key={position} className="absolute bottom-0 top-0 w-px bg-white/5" style={{ left: `${position}%` }} />)}
      {sorted.map((stint) => {
        const left = ((new Date(stint.actualStartAt).getTime() - start) / span) * 100;
        const width = ((new Date(stint.actualEndAt).getTime() - new Date(stint.actualStartAt).getTime()) / span) * 100;
        const driverIndex = Math.max(0, personas.findIndex((persona) => persona.id === stint.driverId));
        const driver = personas[driverIndex];
        const availabilityState = availabilityForStint(availability, stint);
        const wide = width >= 12;
        return <div key={stint.id} draggable={editable} onDragStart={(e) => e.dataTransfer.setData("text/endurance-stint", stint.id)} className={`absolute inset-y-3 overflow-hidden rounded-xl shadow-lg ring-2 ${colors[driverIndex % colors.length]} ${availabilityState === "hard" ? "ring-red-300" : availabilityState === "soft" || availabilityState === "missing" ? "ring-amber-300/70" : "ring-white/15"}`} style={{ left: `${left}%`, width: `${Math.max(3, width)}%` }} title={`${driver?.name} · ${formatAmsterdam(stint.actualStartAt)} – ${formatAmsterdam(stint.actualEndAt)}`}>
          <div className="flex h-full min-w-0 flex-col justify-between p-2 text-white">
            <div className="flex items-start justify-between gap-1">
              <div className="min-w-0"><strong className="block truncate text-xs">{driver?.name ?? stint.driverId}</strong><span className="block truncate text-[9px] opacity-80">{stint.expectedLaps} ronden · {stint.status}</span></div>
              {editable && <GripVertical className="h-3.5 w-3.5 shrink-0 opacity-70" />}
            </div>
            {editable && (wide ? (
              <div className="flex gap-1">
                <button type="button" onClick={() => onResize(stint, -snapMinutes)} className="rounded bg-black/25 p-1" aria-label="Stint verkorten"><Minus className="h-3 w-3" /></button>
                <button type="button" onClick={() => onResize(stint, snapMinutes)} className="rounded bg-black/25 p-1" aria-label="Stint verlengen"><Plus className="h-3 w-3" /></button>
                <button type="button" onClick={() => onCopy(stint)} className="rounded bg-black/25 p-1" aria-label="Stint kopiëren"><Copy className="h-3 w-3" /></button>
                <button type="button" onClick={() => onDelete(stint.id)} className="rounded bg-black/25 p-1" aria-label="Stint verwijderen"><Trash2 className="h-3 w-3" /></button>
              </div>
            ) : (
              <div className="flex gap-1">
                <button type="button" onClick={() => onDelete(stint.id)} className="rounded bg-black/25 p-1" aria-label="Stint verwijderen"><Trash2 className="h-3 w-3" /></button>
              </div>
            ))}
          </div>
        </div>;
      })}
    </div>
    <p className="mt-3 text-xs text-gray-500">Sleep een stint over de tijdlijn. Rode ring = niet beschikbaar; oranje ring = onzeker of geen beschikbaarheid.</p>
  </div></div>;
};