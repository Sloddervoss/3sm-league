import { useState } from "react";
import { Copy, Pencil, Plus, Trash2 } from "lucide-react";
import {
  useEnduranceEvents,
  useUpsertEnduranceEvent,
  useDeleteEnduranceEvent,
} from "../repository/eventsRepository";
import { useCreateEnduranceNotifications } from "../repository/notificationsRepository";
import { useEnduranceRealtime } from "../repository/useEnduranceRealtime";
import { InviteePicker } from "./InviteePicker";
import { makeId } from "../core/actions";
import { IRACING_ENDURANCE_CLASSES, getEnduranceCar, type EnduranceClassId } from "../core/carCatalog";
import { ENDURANCE_CIRCUIT_OPTIONS, ENDURANCE_CONFIGURATION_OPTIONS, ENDURANCE_CONFIGURATION_FOR_CIRCUIT } from "../core/enduranceTracks";
import { formatAmsterdam } from "../core/selectors";
import { Field, inputClass, Panel, PrimaryButton, SecondaryButton, SectionHeading, StatusPill } from "../shared/ui";
import type { EnduranceEventRow } from "../repository/eventsRepository";
import { eventManagedFields } from "./eventFormPayload";

const toIso = (value: string) => new Date(value).toISOString();
const toLocalInput = (iso?: string | null) => {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/**
 * Racebeheer — Fase 3.
 * Leest/schrijft ECHTE endurance-events via de repository (super-admin-only
 * RLS). Ondersteunt aanmaken, bewerken en verwijderen; kopiëren is secundair.
 * Een formulier wordt gedeeld tussen "nieuwe race" en "bestaande race bewerken"
 * (bij bewerken krijgt het veld `id` mee → updateEnduranceEvent).
 */
export const EventManager = () => {
  const { data: dbEvents = [], isLoading, isError, error } = useEnduranceEvents();
  // Realtime: events die een andere admin aanmaakt/bewerkt verschijnen live
  // in de kalender zonder te verversen.
  useEnduranceRealtime(
    [
      {
        table: "endurance_events",
        queryKeys: [["endurance", "events"]],
      },
    ],
    []
  );
  const upsert = useUpsertEnduranceEvent();
  const remove = useDeleteEnduranceEvent();
  const sendInvites = useCreateEnduranceNotifications();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");

  // Formuliervelden
  const [name, setName] = useState("");
  const [circuit, setCircuit] = useState("");
  const [configuration, setConfiguration] = useState("Full Course");
  const [startAt, setStartAt] = useState("2026-08-15T13:00");
  const [duration, setDuration] = useState(6);
  const [deadline, setDeadline] = useState("2026-08-10T23:59");
  const [visibility, setVisibility] = useState<"open" | "invite_only" | "hidden">("open");
  const [maxDrivers, setMaxDrivers] = useState(4);
  const [classIds, setClassIds] = useState<EnduranceClassId[]>(() => [...IRACING_ENDURANCE_CLASSES]);
  const [invitedUserIds, setInvitedUserIds] = useState<string[]>([]);
  const [prevInvited, setPrevInvited] = useState<string[]>([]);

  const openNew = () => {
    setEditingId(null);
    setName(""); setCircuit(""); setConfiguration("Full Course");
    setStartAt("2026-08-15T13:00"); setDuration(6); setDeadline("2026-08-10T23:59");
    setVisibility("open"); setMaxDrivers(4); setClassIds([...IRACING_ENDURANCE_CLASSES]);
    setInvitedUserIds([]); setPrevInvited([]);
    setOpen(true);
  };

  const openEdit = (event: EnduranceEventRow) => {
    setEditingId(event.id);
    setName(event.name); setCircuit(event.circuit); setConfiguration(event.configuration ?? "Full Course");
    setStartAt(toLocalInput(event.start_at));
    setDuration(Math.max(1, Math.round((new Date(event.end_at).getTime() - new Date(event.start_at).getTime()) / 3_600_000)));
    setDeadline(toLocalInput(event.registration_deadline) || "2026-08-10T23:59");
    setVisibility(event.visibility as "open" | "invite_only" | "hidden");
    setMaxDrivers(event.max_drivers_per_car);
    setClassIds((event.class_ids.length ? event.class_ids : [...IRACING_ENDURANCE_CLASSES]) as EnduranceClassId[]);
    setInvitedUserIds(event.invited_user_ids ?? []);
    setPrevInvited(event.invited_user_ids ?? []);
    setOpen(true);
    setConfirmDeleteId(null);
  };

  const save = async (formEvent: React.FormEvent) => {
    formEvent.preventDefault();
    if (!classIds.length || upsert.isPending) return;
    const start = toIso(startAt);
    const end = new Date(new Date(start).getTime() + duration * 3_600_000).toISOString();
    const existing = editingId ? dbEvents.find((event) => event.id === editingId) : undefined;
    const defaultSlot = {
      id: makeId("slot"),
      startAt: start,
      label: new Intl.DateTimeFormat("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" }).format(new Date(start)),
    };
    const saved = await upsert.mutateAsync({
      ...(editingId ? { id: editingId } : {}),
      name,
      circuit,
      configuration,
      start_at: start,
      end_at: end,
      briefing_start_at: new Date(new Date(start).getTime() - 3_600_000).toISOString(),
      expected_end_at: new Date(new Date(end).getTime() + 30 * 60_000).toISOString(),
      registration_deadline: toIso(deadline),
      class_ids: classIds,
      max_drivers_per_car: maxDrivers,
      visibility,
      invited_user_ids: invitedUserIds,
      ...eventManagedFields(existing, defaultSlot),
    });
    // Stuur alleen een uitnodigings-melding naar NIET eerder genodigde rijders.
    const newly = invitedUserIds.filter((id) => !prevInvited.includes(id));
    if (newly.length > 0) {
      try {
        await sendInvites.mutateAsync(
          newly.map((userId) => ({
            user_id: userId,
            event_id: saved.id,
            type: "invitation" as const,
            title: `Je bent uitgenodigd voor ${name}`,
            message: `Open de race en bevestig je deelname aan de endurance.`,
            private_path: `/endurance/races/${saved.id}`,
          }))
        );
      } catch {
        // Opslaan is gelukt; een mislukte melding mag de opslag niet ongedaan maken.
      }
    }
    setName(""); setCircuit(""); setOpen(false); setEditingId(null);
  };

  const copyEvent = (source: EnduranceEventRow) => {
    if (upsert.isPending) return;
    void upsert.mutateAsync({
      name: `${source.name} – kopie`,
      circuit: source.circuit,
      configuration: source.configuration,
      start_at: source.start_at,
      end_at: source.end_at,
      class_ids: source.class_ids as EnduranceClassId[],
      visibility: source.visibility as "open" | "invite_only" | "hidden",
      status: "draft",
      source: "copied",
    });
  };

  const doDelete = async (id: string) => {
    if (confirmDeleteId !== id) { setConfirmDeleteId(id); setDeleteError(""); return; }
    setDeleteError("");
    try {
      await remove.mutateAsync(id);
      setConfirmDeleteId(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Verwijderen mislukt.");
      setConfirmDeleteId(null);
    }
  };

  return <div><SectionHeading eyebrow="Manager" title="Racebeheer" description="Maak evenementen aan in de databank, bewerk of verwijder ze. Alleen een super-admin kan dit: de RLS weigert elke andere rol." action={<PrimaryButton onClick={openNew}><Plus className="h-4 w-4" /> Nieuwe race</PrimaryButton>} />
    {open && <Panel className="mb-5"><form onSubmit={save} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Naam"><input required className={inputClass} value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Circuit"><input required className={inputClass} value={circuit} list="endurance-circuit-options" onChange={(e) => { setCircuit(e.target.value); if (ENDURANCE_CONFIGURATION_FOR_CIRCUIT[e.target.value]) setConfiguration(ENDURANCE_CONFIGURATION_FOR_CIRCUIT[e.target.value]); }} /><datalist id="endurance-circuit-options">{ENDURANCE_CIRCUIT_OPTIONS.map((value) => <option key={value} value={value} />)}</datalist></Field>
      <Field label="Configuratie"><input required className={inputClass} value={configuration} list="endurance-config-options" onChange={(e) => setConfiguration(e.target.value)} /><datalist id="endurance-config-options">{ENDURANCE_CONFIGURATION_OPTIONS.map((value) => <option key={value} value={value} />)}</datalist></Field>
      <Field label="Start (lokale tijd)"><input required type="datetime-local" className={inputClass} value={startAt} onChange={(e) => setStartAt(e.target.value)} /></Field>
      <Field label="Duur in uren"><input required type="number" min={1} max={30} className={inputClass} value={duration} onChange={(e) => setDuration(Number(e.target.value))} /></Field>
      <Field label="Aanmelddeadline"><input required type="datetime-local" className={inputClass} value={deadline} onChange={(e) => setDeadline(e.target.value)} /></Field>
      <Field label="Max. coureurs per auto" hint="Bovengrens, niet verplicht vol. Sta gerust hoger in voor teams met 6+ rijders."><input required type="number" min={1} max={30} className={inputClass} value={maxDrivers} onChange={(e) => setMaxDrivers(Math.max(1, Math.min(30, Number(e.target.value) || 1)))} /></Field>
      <Field label="Zichtbaarheid"><select className={inputClass} value={visibility} onChange={(e) => setVisibility(e.target.value as "open" | "invite_only" | "hidden")}><option value="open">Open voor alle leden</option><option value="invite_only">Alleen op uitnodiging</option><option value="hidden">Verborgen</option></select></Field>
      <InviteePicker value={invitedUserIds} onChange={setInvitedUserIds} />
      <div className="sm:col-span-2 lg:col-span-3"><span className="mb-2 block text-xs font-bold uppercase tracking-wide text-gray-500">Klassen voor de stemming</span><div className="flex flex-wrap gap-2">{IRACING_ENDURANCE_CLASSES.map((value) => <label key={value} className="flex items-center gap-2 rounded-xl bg-black/20 px-4 py-3 text-sm text-gray-200 ring-1 ring-white/5"><input type="checkbox" checked={classIds.includes(value)} onChange={(e) => setClassIds((current) => e.target.checked ? [...current, value] : current.filter((item) => item !== value))} className="accent-orange-500" />{value}</label>)}</div></div>
      <div className="sm:col-span-2 lg:col-span-3 flex flex-wrap gap-2"><PrimaryButton type="submit" disabled={!classIds.length || upsert.isPending}>{upsert.isPending ? "Opslaan…" : editingId ? "Wijzigingen opslaan" : "Race opslaan"}</PrimaryButton><SecondaryButton type="button" onClick={() => { setOpen(false); setEditingId(null); }}>Annuleren</SecondaryButton></div>
    </form></Panel>}
    {isError ? <Panel><p className="text-sm text-red-400">Kon evenementen niet laden: {(error as Error)?.message}</p></Panel> : null}
    {deleteError ? <Panel><p role="alert" className="text-sm text-red-400">Verwijderen mislukt: {deleteError}</p></Panel> : null}
    <div className="grid gap-4 lg:grid-cols-2">{isLoading ? <Panel><p className="text-sm text-gray-400">Laden…</p></Panel> : dbEvents.map((event) => <Panel key={event.id}><div className="flex items-start justify-between gap-4"><div><StatusPill tone={event.status === "draft" ? "neutral" : "orange"}>{event.status}</StatusPill><h3 className="mt-3 font-heading text-lg font-black text-white">{event.name}</h3><p className="mt-1 text-sm text-gray-400">{event.circuit} · {formatAmsterdam(event.start_at)}</p><p className="mt-2 text-xs text-gray-500">Stemming: {event.class_ids.join(" · ") || "—"} · Definitief: {event.selected_class_id && getEnduranceCar(event.selected_car_id) ? `${event.selected_class_id} · ${getEnduranceCar(event.selected_car_id)?.name}` : "nog niet gekozen"}</p></div><div className="flex shrink-0 flex-wrap justify-end gap-2"><SecondaryButton onClick={() => openEdit(event)} className="px-3"><Pencil className="h-4 w-4" /></SecondaryButton><SecondaryButton onClick={() => copyEvent(event)} className="px-3" aria-label="Kopiëren"><Copy className="h-4 w-4" /></SecondaryButton><PrimaryButton onClick={() => doDelete(event.id)} className={`px-3 ${confirmDeleteId === event.id ? "bg-red-600 text-white hover:bg-red-500" : ""}`}>{confirmDeleteId === event.id ? "Zeker?" : <Trash2 className="h-4 w-4" />}</PrimaryButton></div></div></Panel>)}</div>
  </div>;
};
