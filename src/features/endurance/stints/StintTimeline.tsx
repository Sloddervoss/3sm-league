import { utcToZonedInput, zonedInputToUtc } from "../core/time";
import { useMemo, useRef, useState } from "react";
import { ChevronsRight, Copy, Minus, Plus, Trash2 } from "lucide-react";
import { availabilityForStint, formatAmsterdam } from "../core/selectors";
import type { AvailabilityBlock, EnduranceEvent, EndurancePersona, EnduranceStint } from "../core/types";

const colors = ["bg-orange-500/80", "bg-sky-500/75", "bg-violet-500/75", "bg-emerald-500/75", "bg-rose-500/75"];
// Echte kleurwaarden (hex) voor tekst/dot — de bg-klassen hierboven zijn géén
// geldige CSS-kleuren voor style. Beide rijen staan op dezelfde volgorde.
const laneHex = ["#f97316", "#38bdf8", "#a78bfa", "#34d399", "#fb7185"];
// Breedte van de coureur-labelkolom in het lane-grid (svg grid-cols-[120px_1fr]).
// Rand-slepen en drop meten tegen de tijdlijn-track ná deze kolom.
const LANE_LABEL_PX = 120;

/**
 * StintTimeline met swimlanes. Iedere coureur heeft een eigen rij, waardoor een
 * 24u-planning (16+ stints over één balk) wél schaalbaar en bewerkbaar blijft:
 * - Sleep een stint langs de tijdlijn (horizontaal) om de tijd te verplaatsen.
 * - Sleep een stint naar een andere rij om van coureur te wisselen.
 * - Klik een stint aan → een detailpaneel toont starttijd, duur en coureur, met
 *   knopjes om precies aan te passen, te verlengen, te kopiëren of te wissen.
 * Alle tijden blijven op snapronde (snapMinutes) en binnen de race.
 */
export const StintTimeline = ({ event, stints, personas, availability, editable, snapMinutes, onMove, onResize, onDelete, onCopy, onExtend, onAssign, onResizeEdge }: { event: EnduranceEvent; stints: EnduranceStint[]; personas: EndurancePersona[]; availability: AvailabilityBlock[]; editable: boolean; snapMinutes: number; onMove: (stint: EnduranceStint, startAt: string, driverId?: string) => void; onResize: (stint: EnduranceStint, deltaMinutes: number) => void; onDelete: (id: string) => void; onCopy: (stint: EnduranceStint) => void; onExtend: (stint: EnduranceStint) => void; onAssign: (stint: EnduranceStint, driverId: string) => void; onResizeEdge: (stint: EnduranceStint, startAt: string, endAt: string) => void }) => {
  const start = new Date(event.startAt).getTime(); const end = new Date(event.endAt).getTime(); const span = end - start;
  const [timeError, setTimeError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Dragging-state voor de rand-handgrepen. ref i.p.v. state zodat pointermove
  // niet hoef te re-renderen; de live tijdelijke stint-positie wordt via een kleine
  // state bijgewerkt t.b.v. visuele feedback.
  const dragEdge = useRef<{ stintId: string; side: "left" | "right"; startMs: number; endMs: number } | null>(null);
  const [liveEdge, setLiveEdge] = useState<{ stintId: string; startAt: string; endAt: string } | null>(null);
  // Anchors de tijdlijn-container zodat rand-slepen pixels → minuten kan mappen.
  const laneRef = useRef<HTMLDivElement | null>(null);

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
    if (rect.width <= 0 || !Number.isFinite(dropEvent.clientX)) return;
    const startMinutes = minutesFromEvent(dropEvent.clientX, { left: rect.left, width: rect.width });
    const duration = new Date(stint.actualEndAt).getTime() - new Date(stint.actualStartAt).getTime();
    const maxStartMinutes = Math.max(0, ((end - start - duration) / 60_000));
    const effectiveMinutes = Math.min(startMinutes, maxStartMinutes);
    // Save the driver and time together; two writes would overwrite each other.
    onMove(stint, new Date(start + effectiveMinutes * 60_000).toISOString(), targetDriverId);
  };

  // Tijd van een clientX (viewport) naar racetijd → ms. Meet tegen de
  // tijdlijn-track (na de vaste labelkolom), zodat rand-slepen/drop op dezelfde
  // schaal werkt als de positieberekening van de stints-balkjes. (bevinding 5)
  const msFromEventX = (clientX: number) => {
    const lane = laneRef.current;
    if (!lane) return 0;
    const rect = lane.getBoundingClientRect();
    const trackLeft = rect.left + LANE_LABEL_PX;
    const trackWidth = Math.max(1, rect.width - LANE_LABEL_PX);
    return start + ((clientX - trackLeft) / trackWidth) * span;
  };

  const beginEdgeDrag = (e: React.PointerEvent, stint: EnduranceStint, side: "left" | "right") => {
    if (!editable) return;
    e.preventDefault(); e.stopPropagation();
    dragEdge.current = { stintId: stint.id, side, startMs: new Date(stint.actualStartAt).getTime(), endMs: new Date(stint.actualEndAt).getTime() };
    setLiveEdge({ stintId: stint.id, startAt: stint.actualStartAt, endAt: stint.actualEndAt });
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const moveEdgeDrag = (e: React.PointerEvent) => {
    if (!dragEdge.current) return;
    const d = dragEdge.current;
    const ms = msFromEventX(e.clientX);
    const minSnap = Math.round((ms - start) / 60_000 / snapMinutes) * snapMinutes;
    // Snap naar de dichtstbijzijnde snapboundary, afgeklemd op de andere rand.
    const p = () => Math.max(start, Math.min(end, start + minSnap * 60_000));
    let nextStartMs = d.startMs;
    let nextEndMs = d.endMs;
    if (d.side === "left") {
      const candidate = p();
      if (candidate <= d.endMs - 5 * 60_000) nextStartMs = candidate;
    } else {
      const candidate = p();
      if (candidate >= d.startMs + 5 * 60_000) nextEndMs = candidate;
    }
    setLiveEdge({ stintId: d.stintId, startAt: new Date(nextStartMs).toISOString(), endAt: new Date(nextEndMs).toISOString() });
  };

  const endEdgeDrag = (e: React.PointerEvent) => {
    if (!dragEdge.current) return;
    const d = dragEdge.current;
    dragEdge.current = null;
    const stint = stints.find((candidate) => candidate.id === d.stintId);
    setLiveEdge(null);
    if (!stint || !liveEdge) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    onResizeEdge(stint, liveEdge.startAt, liveEdge.endAt);
  };

  const selected = stints.find((s) => s.id === selectedId) ?? null;
  const selectedDurationMinutes = selected ? Math.round((new Date(selected.actualEndAt).getTime() - new Date(selected.actualStartAt).getTime()) / 60_000) : 0;

  const minutesToLabel = (adjustMinutes: number) => shiftClock(event.startAt, adjustMinutes);

  return <div className="space-y-4">
    <div className="space-y-2 md:hidden" aria-label="Stints op volgorde">
      {[...stints].sort((a,b) => Date.parse(a.actualStartAt)-Date.parse(b.actualStartAt)).map(stint => <button key={stint.id} type="button" onClick={() => setSelectedId(selectedId === stint.id ? null : stint.id)} aria-expanded={selectedId === stint.id} className={`w-full rounded-xl border p-4 text-left transition ${selectedId === stint.id ? "border-orange-400 bg-orange-500/10" : "border-white/10 bg-black/20"}`}><span className="flex items-center justify-between gap-3"><strong className="text-sm text-white">{driverName(stint.driverId)}</strong><span className="text-xs font-bold text-orange-300">{Math.round((Date.parse(stint.actualEndAt)-Date.parse(stint.actualStartAt))/60000)} min</span></span><span className="mt-2 block text-xs text-gray-300">{formatAmsterdam(stint.actualStartAt)} → {formatAmsterdam(stint.actualEndAt)}</span><span className="mt-2 block text-[11px] text-gray-500">Tik voor details{editable ? " en aanpassen" : ""}</span></button>)}
      {!stints.length && <p className="rounded-xl bg-black/20 p-4 text-sm text-gray-400">Nog geen stints gepland.</p>}
    </div>
    {/* Tijdlijn */}
    <div className="hidden overflow-x-auto md:block">
      <div className="min-w-[880px] rounded-2xl bg-black/25 p-4 ring-1 ring-white/5">
        {/* Header + uren-as: zelfde breedte-referentie als de stints (1fr-track
            ná de 120px coureurkolom). Anders staan de uur-markeringen ±120px te
            ver naar links t.o.v. de stints-blokken → 'tijd klopt niet'. */}
        <div className="grid grid-cols-[120px_1fr]">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-500">{formatAmsterdam(event.startAt)}</div>
          <div className="mb-2 flex justify-between text-[10px] font-bold uppercase tracking-wider text-gray-500"><span>25%</span><span>50%</span><span>75%</span><span className="mr-14 text-gray-600/70">{formatAmsterdam(event.endAt)}</span></div>
        </div>
        <div className="grid grid-cols-[120px_1fr]">
          <div />
          <div className="relative h-6">
            {Array.from({ length: Math.ceil((end - start) / 3_600_000) + 1 }).map((_, h) => h).filter(h => h % Math.max(1, Math.ceil(span / 3_600_000 / 10)) === 0 && h * 3_600_000 < span).map(h => (
              <span key={h} className="absolute top-0 text-[10px] tabular-nums text-gray-500" style={{ left: `${(h * 3_600_000) / span * 100}%` }}>{shiftClock(event.startAt, h * 60).split(" ").pop()}</span>
            ))}
          </div>
        </div>
        <div
          className="relative"
          ref={laneRef}
          onPointerMove={editable ? moveEdgeDrag : undefined}
          onPointerUp={editable ? endEdgeDrag : undefined}
          onPointerCancel={() => { dragEdge.current = null; setLiveEdge(null); }}
        >
          {laneDrivers.map((driverId, laneIndex) => {
            const laneStints = stints.filter((s) => s.driverId === driverId);
            return (
              <div key={driverId} className="grid grid-cols-[120px_1fr]">
                {/* Coureur-label */}
                <div className={`flex items-center px-2 text-xs font-bold ${laneIndex === 0 ? "pt-4" : ""}`} style={{ color: laneHex[laneIndex % laneHex.length] }}>
                  <span className="w-full truncate" style={{ textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}>{driverName(driverId)}</span>
                </div>
                {/* Lane */}
                <div
                  onDragOver={(e) => editable && e.preventDefault()}
                  onDrop={(e) => laneDrop(e, driverId)}
                  className={`relative h-16 rounded-lg ${laneIndex === 0 ? "mt-4" : "mt-1.5"} bg-white/[0.025] ring-1 ring-white/5`}
                >
                  <span className="pointer-events-none absolute left-2 top-1 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-white/40"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: laneHex[laneIndex % laneHex.length] }} />{laneIndex + 1}</span>
                  {laneStints.map((stint) => {
                    const live = liveEdge && liveEdge.stintId === stint.id;
                    const startAt = live ? liveEdge.startAt : stint.actualStartAt;
                    const endAt = live ? liveEdge.endAt : stint.actualEndAt;
                    const left = ((new Date(startAt).getTime() - start) / span) * 100;
                    const width = ((new Date(endAt).getTime() - new Date(startAt).getTime()) / span) * 100;
                    const availabilityState = availabilityForStint(availability, stint);
                    const isSelected = stint.id === selectedId;
                    return <div
                      key={stint.id}
                      draggable={editable}
                      role="button" tabIndex={0} aria-label={`${driverName(stint.driverId)} · ${formatAmsterdam(startAt)}`} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedId(isSelected ? null : stint.id); } }} onClick={() => setSelectedId(isSelected ? null : stint.id)}
                      onDragStart={(e) => e.dataTransfer.setData("text/endurance-stint", stint.id)}
                      className={`absolute inset-y-1.5 overflow-hidden rounded-lg shadow-md ring-2 transition-opacity ${isSelected ? "ring-2 ring-white" : "ring-white/15 opacity-90 hover:opacity-100"} ${colors[laneIndex % colors.length]} ${availabilityState === "hard" ? "ring-red-300" : availabilityState === "soft" || availabilityState === "missing" ? "ring-amber-300/70" : "ring-white/15"}`}
                      style={{ left: `${left}%`, width: `${Math.max(2, width)}%`, cursor: editable ? "default" : undefined }}
                      title={`${driverName(stint.driverId)} · ${formatAmsterdam(startAt)} – ${formatAmsterdam(endAt)}\nKlik voor details; versleep de randen om te rekken`}
                    >
                      <span className="block truncate px-1.5 text-[9px] font-black text-white" style={{ textShadow: "0 1px 2px rgba(0,0,0,0.7)" }}>{stint.expectedLaps > 0 ? `${stint.expectedLaps}r` : "—"}</span>
                      {editable && <><span
                        onPointerDown={(e) => beginEdgeDrag(e, stint, "left")}
                        className="absolute inset-y-0 left-0 w-2 cursor-ew-resize bg-black/30 opacity-0 transition-opacity hover:opacity-100"
                        aria-label="Stint links uitrekken"
                      /><span
                        onPointerDown={(e) => beginEdgeDrag(e, stint, "right")}
                        className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-black/30 opacity-0 transition-opacity hover:opacity-100"
                        aria-label="Stint rechts uitrekken"
                      /></>}
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

    {timeError && <p role="alert" className="text-sm text-red-300">{timeError}</p>}
    {/* Detailpaneel */}
    {selected && (
      <div className="rounded-2xl bg-black/25 p-4 ring-1 ring-white/5">
        <div className="mb-3 flex items-center justify-between">
          <strong className="text-sm text-white">{driverName(selected.driverId)} · {selectedDurationMinutes} min</strong>
          <button type="button" onClick={() => setSelectedId(null)} className="text-xs text-gray-400 hover:text-white" aria-label="Detail sluiten">Sluiten</button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block text-xs">
            <span className="mb-1 block font-bold text-gray-400">Starttijd (Nederland)</span>
            <div className="flex items-center gap-1">
              <button type="button" disabled={!editable} onClick={() => onMove(selected, new Date(new Date(selected.actualStartAt).getTime() - snapMinutes * 60_000).toISOString())} className="rounded bg-black/30 px-2 py-1.5 text-white disabled:opacity-40" aria-label="Start eerder"><Minus className="h-3 w-3" /></button>
              <input className="w-full rounded-lg bg-black/30 px-2 py-1.5 text-sm text-white focus:outline-none" type="datetime-local" step={60} value={utcToZonedInput(selected.actualStartAt)} disabled={!editable} onChange={(e) => { if (!e.target.value) return; try { const next = zonedInputToUtc(e.target.value); setTimeError(""); onMove(selected, next); } catch (error) { setTimeError(error instanceof Error ? error.message : "Ongeldige starttijd."); } }} aria-label="Stint starttijd" />
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
  return new Intl.DateTimeFormat("nl-NL", { timeZone: "Europe/Amsterdam", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
}