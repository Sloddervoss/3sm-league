import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useEnduranceActor } from "../core/ActorContext";
import { useEnduranceAvailability, useEnduranceAvailabilityMutations } from "../repository/availabilityRepository";
import { formatAmsterdam } from "../core/selectors";
import { utcToZonedInput, zonedInputToUtc } from "../core/time";
import type { EnduranceEvent } from "../core/types";
import { Field, inputClass, Panel, PrimaryButton, SecondaryButton, SectionHeading, StatusPill } from "../shared/ui";
import { AvailabilityTimeline } from "./AvailabilityTimeline";

const typeLabels = { available: "Beschikbaar", preferred: "Voorkeur", avoid: "Liever niet", unavailable: "Niet beschikbaar", uncertain: "Onzeker" } as const;
type TypeKey = keyof typeof typeLabels;

/**
 * Beschikbaarheid — Fase 3 (test-als).
 * Leest/schrijft availability-blokken via de DB-repository. De coureur is de
 * geselecteerde actor (Test-als); de sessie blijft super-admin.
 */
export const AvailabilityPanel = ({ event }: { event: EnduranceEvent }) => {
  const { actorId, displayName } = useEnduranceActor();
  const { data: blocks = [], isLoading } = useEnduranceAvailability(event.id);
  const { upsert, remove } = useEnduranceAvailabilityMutations(event.id);
  const participants = useMemo(() => [{ id: actorId, name: displayName(actorId), role: "endurance_admin" as const, timezone: "Europe/Amsterdam" }], [actorId, displayName]);
  const [start, setStart] = useState(utcToZonedInput(event.startAt));
  const [end, setEnd] = useState(utcToZonedInput(event.endAt));
  const [type, setType] = useState<TypeKey>("available");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const ownBlocks = blocks.filter((block) => block.user_id === actorId);

  const add = (formEvent: React.FormEvent) => {
    formEvent.preventDefault();
    if (!actorId) return;
    setError("");
    try {
      const startAt = zonedInputToUtc(start);
      const endAt = zonedInputToUtc(end);
      if (new Date(endAt) <= new Date(startAt)) throw new Error("Eindtijd moet na de starttijd liggen.");
      void upsert.mutateAsync({ event_id: event.id, user_id: actorId, start_at: startAt, end_at: endAt, type: type as EnduranceAvailabilityTypeAlias, note: note || null });
      setNote("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Beschikbaarheid kon niet worden opgeslagen.");
    }
  };

  return <div className="space-y-5"><Panel><SectionHeading eyebrow="Nederlandse tijd" title="Beschikbaarheid" description={`Planningvenster: ${formatAmsterdam(event.briefingStartAt)} tot ${formatAmsterdam(event.expectedEndAt)}. Intern wordt alles als UTC opgeslagen.`} />
    {isLoading ? <p className="text-sm text-gray-400">Laden…</p> : <AvailabilityTimeline event={event} personas={participants} blocks={blocks.map((block) => ({ id: block.id, eventId: block.event_id, userId: block.user_id, startAt: block.start_at, endAt: block.end_at, type: block.type, note: block.note ?? "" }))} />}
    <div className="mt-4 flex flex-wrap gap-2">{Object.entries(typeLabels).map(([key, label]) => <StatusPill key={key} tone={key === "unavailable" ? "red" : key === "uncertain" || key === "avoid" ? "orange" : "green"}>{label}</StatusPill>)}</div>
  </Panel>
  <Panel><SectionHeading title="Beschikbaarheidsblok toevoegen" description={`Je voegt nu toe als ${displayName(actorId)}. Maak meerdere blokken voor langere races.`} />
    <form onSubmit={add} className="grid gap-4 md:grid-cols-2 xl:grid-cols-5"><Field label="Vanaf"><input required type="datetime-local" className={inputClass} value={start} onChange={(e) => setStart(e.target.value)} /></Field><Field label="Tot"><input required type="datetime-local" className={inputClass} value={end} onChange={(e) => setEnd(e.target.value)} /></Field><Field label="Type"><select className={inputClass} value={type} onChange={(e) => setType(e.target.value as TypeKey)}>{Object.entries(typeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field><Field label="Opmerking"><input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} /></Field><div className="flex items-end"><PrimaryButton type="submit"><Plus className="h-4 w-4" /> Blok toevoegen</PrimaryButton></div></form>
    {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
    <div className="mt-5 grid gap-2 sm:grid-cols-2">{ownBlocks.map((block) => <div key={block.id} className="flex items-center justify-between gap-3 rounded-xl bg-black/20 p-3 text-sm ring-1 ring-white/5"><div><strong className="text-gray-200">{typeLabels[block.type]}</strong><p className="text-xs text-gray-500">{formatAmsterdam(block.start_at)} – {formatAmsterdam(block.end_at)}</p>{block.note && <p className="mt-1 text-xs text-gray-400">{block.note}</p>}</div><SecondaryButton onClick={() => void remove.mutateAsync(block.id)} className="h-9 min-h-9 px-2" aria-label="Verwijder beschikbaarheidsblok"><Trash2 className="h-4 w-4" /></SecondaryButton></div>)}</div>
  </Panel></div>;
};

type EnduranceAvailabilityTypeAlias = "available" | "preferred" | "avoid" | "unavailable" | "uncertain";
