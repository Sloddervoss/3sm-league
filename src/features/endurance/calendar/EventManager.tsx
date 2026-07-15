import { useState } from "react";
import { Copy, Plus } from "lucide-react";
import { useEnduranceStore } from "../core/EnduranceStore";
import { makeId } from "../core/actions";
import type { EnduranceEvent, EventVisibility } from "../core/types";
import { formatAmsterdam } from "../core/selectors";
import { Field, inputClass, Panel, PrimaryButton, SecondaryButton, SectionHeading, StatusPill } from "../shared/ui";

const toIso = (value: string) => new Date(value).toISOString();

export const EventManager = () => {
  const { state, activePersona, dispatch } = useEnduranceStore();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [circuit, setCircuit] = useState("");
  const [configuration, setConfiguration] = useState("Full Course");
  const [startAt, setStartAt] = useState("2026-08-15T13:00");
  const [duration, setDuration] = useState(6);
  const [deadline, setDeadline] = useState("2026-08-10T23:59");
  const [visibility, setVisibility] = useState<EventVisibility>("open");
  const [className, setClassName] = useState("GT3");
  const [carName, setCarName] = useState("Porsche 911 GT3 R (992)");
  const canManage = activePersona.role === "endurance_admin" || activePersona.role === "race_manager";

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    const id = makeId("event");
    const start = toIso(startAt);
    const end = new Date(new Date(start).getTime() + duration * 3_600_000).toISOString();
    const now = new Date().toISOString();
    dispatch({ type: "create_event", event: { id, name, circuit, configuration, startAt: start, endAt: end, briefingStartAt: new Date(new Date(start).getTime() - 3_600_000).toISOString(), expectedEndAt: new Date(new Date(end).getTime() + 30 * 60_000).toISOString(), registrationDeadline: toIso(deadline), slots: [{ id: makeId("slot"), startAt: start, label: new Intl.DateTimeFormat("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" }).format(new Date(start)) }], cars: [{ id: makeId("car"), className, carName, maxDrivers: 4 }], maxDriversPerCar: 4, visibility, status: "registration_open", source: "manual", invitedUserIds: [], managerIds: [activePersona.id], createdAt: now, updatedAt: now } });
    setName(""); setCircuit(""); setOpen(false);
  };

  const copyEvent = (source: EnduranceEvent) => {
    const id = makeId("event"); const now = new Date().toISOString();
    dispatch({ type: "create_event", event: { ...source, id, name: `${source.name} – kopie`, source: "copied", status: "draft", slots: source.slots.map((slot) => ({ ...slot, id: makeId("slot") })), cars: source.cars.map((car) => ({ ...car, id: makeId("car") })), invitedUserIds: [], managerIds: [activePersona.id], createdAt: now, updatedAt: now } });
  };

  if (!canManage) return <Panel><p className="text-sm text-gray-400">Racebeheer is alleen beschikbaar voor endurance- en racemanagers.</p></Panel>;

  return <div><SectionHeading eyebrow="Manager" title="Racebeheer" description="Maak evenementen handmatig aan of kopieer een bestaande race. Kalenderimport komt via dezelfde adapter, maar is niet nodig voor deze MVP." action={<PrimaryButton onClick={() => setOpen((value) => !value)}><Plus className="h-4 w-4" /> Nieuwe race</PrimaryButton>} />
    {open && <Panel className="mb-5"><form onSubmit={save} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Naam"><input required className={inputClass} value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Circuit"><input required className={inputClass} value={circuit} onChange={(e) => setCircuit(e.target.value)} /></Field>
      <Field label="Configuratie"><input required className={inputClass} value={configuration} onChange={(e) => setConfiguration(e.target.value)} /></Field>
      <Field label="Start (lokale tijd)"><input required type="datetime-local" className={inputClass} value={startAt} onChange={(e) => setStartAt(e.target.value)} /></Field>
      <Field label="Duur in uren"><input required type="number" min={1} max={30} className={inputClass} value={duration} onChange={(e) => setDuration(Number(e.target.value))} /></Field>
      <Field label="Aanmelddeadline"><input required type="datetime-local" className={inputClass} value={deadline} onChange={(e) => setDeadline(e.target.value)} /></Field>
      <Field label="Zichtbaarheid"><select className={inputClass} value={visibility} onChange={(e) => setVisibility(e.target.value as EventVisibility)}><option value="open">Open voor alle leden</option><option value="invite_only">Alleen op uitnodiging</option><option value="hidden">Verborgen</option></select></Field>
      <Field label="Klasse"><input required className={inputClass} value={className} onChange={(e) => setClassName(e.target.value)} /></Field>
      <Field label="Auto"><input required className={inputClass} value={carName} onChange={(e) => setCarName(e.target.value)} /></Field>
      <div className="sm:col-span-2 lg:col-span-3"><PrimaryButton type="submit">Race opslaan</PrimaryButton></div>
    </form></Panel>}
    <div className="grid gap-4 lg:grid-cols-2">{state.events.map((event) => <Panel key={event.id}><div className="flex items-start justify-between gap-4"><div><StatusPill tone={event.status === "draft" ? "neutral" : "orange"}>{event.status}</StatusPill><h3 className="mt-3 font-heading text-lg font-black text-white">{event.name}</h3><p className="mt-1 text-sm text-gray-400">{event.circuit} · {formatAmsterdam(event.startAt)}</p><p className="mt-2 text-xs text-gray-500">{event.cars.map((car) => `${car.className}: ${car.carName}`).join(" · ")}</p></div><SecondaryButton onClick={() => copyEvent(event)} className="shrink-0 px-3"><Copy className="h-4 w-4" /> Kopiëren</SecondaryButton></div></Panel>)}</div>
  </div>;
};
