import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useEnduranceStore } from "../core/EnduranceStore";
import { makeId } from "../core/actions";
import { canManageEvent, formatAmsterdam } from "../core/selectors";
import { utcToZonedInput, zonedInputToUtc } from "../core/time";
import type { AvailabilityType, EnduranceEvent } from "../core/types";
import { Field, inputClass, Panel, PrimaryButton, SecondaryButton, SectionHeading, StatusPill } from "../shared/ui";
import { AvailabilityTimeline } from "./AvailabilityTimeline";

const typeLabels = { available: "Beschikbaar", preferred: "Voorkeur", avoid: "Liever niet", unavailable: "Niet beschikbaar", uncertain: "Onzeker" };

export const AvailabilityPanel = ({ event }: { event: EnduranceEvent }) => {
  const { state, activePersona, dispatch } = useEnduranceStore();
  const manager = canManageEvent(event, activePersona);
  const participants = useMemo(() => state.personas.filter((persona) => state.registrations.some((registration) => registration.eventId === event.id && registration.userId === persona.id)), [state, event.id]);
  const [userId, setUserId] = useState(participants.some((persona) => persona.id === activePersona.id) ? activePersona.id : participants[0]?.id ?? activePersona.id);
  const [start, setStart] = useState(utcToZonedInput(event.startAt));
  const [end, setEnd] = useState(utcToZonedInput(event.endAt));
  const [type, setType] = useState<AvailabilityType>("available");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const blocks = state.availability.filter((block) => block.eventId === event.id);
  const ownBlocks = blocks.filter((block) => block.userId === (manager ? userId : activePersona.id));

  const add = (formEvent: React.FormEvent) => {
    formEvent.preventDefault(); setError("");
    try { const startAt = zonedInputToUtc(start); const endAt = zonedInputToUtc(end); if (new Date(endAt) <= new Date(startAt)) throw new Error("Eindtijd moet na de starttijd liggen."); dispatch({ type: "add_availability", block: { id: makeId("availability"), eventId: event.id, userId: manager ? userId : activePersona.id, startAt, endAt, type, note } }); setNote(""); } catch (caught) { setError(caught instanceof Error ? caught.message : "Beschikbaarheid kon niet worden opgeslagen."); }
  };

  return <div className="space-y-5"><Panel><SectionHeading eyebrow="Nederlandse tijd" title="Beschikbaarheid" description={`Planningvenster: ${formatAmsterdam(event.briefingStartAt)} tot ${formatAmsterdam(event.expectedEndAt)}. Intern wordt alles als UTC opgeslagen.`} />
    <AvailabilityTimeline event={event} personas={participants} blocks={blocks} />
    <div className="mt-4 flex flex-wrap gap-2">{Object.entries(typeLabels).map(([key, label]) => <StatusPill key={key} tone={key === "unavailable" ? "red" : key === "uncertain" || key === "avoid" ? "orange" : "green"}>{label}</StatusPill>)}</div>
  </Panel>
  <Panel><SectionHeading title="Beschikbaarheidsblok toevoegen" description="Maak meerdere blokken voor langere races. Je kunt voorkeur, onzekerheid en harde onbeschikbaarheid apart vastleggen." />
    <form onSubmit={add} className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">{manager && <Field label="Coureur"><select className={inputClass} value={userId} onChange={(e) => setUserId(e.target.value)}>{participants.map((persona) => <option key={persona.id} value={persona.id}>{persona.name}</option>)}</select></Field>}<Field label="Vanaf"><input required type="datetime-local" className={inputClass} value={start} onChange={(e) => setStart(e.target.value)} /></Field><Field label="Tot"><input required type="datetime-local" className={inputClass} value={end} onChange={(e) => setEnd(e.target.value)} /></Field><Field label="Type"><select className={inputClass} value={type} onChange={(e) => setType(e.target.value as AvailabilityType)}>{Object.entries(typeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field><Field label="Opmerking"><input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} /></Field><div className="flex items-end"><PrimaryButton type="submit"><Plus className="h-4 w-4" /> Blok toevoegen</PrimaryButton></div></form>
    {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
    <div className="mt-5 grid gap-2 sm:grid-cols-2">{ownBlocks.map((block) => <div key={block.id} className="flex items-center justify-between gap-3 rounded-xl bg-black/20 p-3 text-sm ring-1 ring-white/5"><div><strong className="text-gray-200">{typeLabels[block.type]}</strong><p className="text-xs text-gray-500">{formatAmsterdam(block.startAt)} – {formatAmsterdam(block.endAt)}</p>{block.note && <p className="mt-1 text-xs text-gray-400">{block.note}</p>}</div><SecondaryButton onClick={() => dispatch({ type: "delete_availability", id: block.id })} className="h-9 min-h-9 px-2" aria-label="Verwijder beschikbaarheidsblok"><Trash2 className="h-4 w-4" /></SecondaryButton></div>)}</div>
  </Panel></div>;
};
