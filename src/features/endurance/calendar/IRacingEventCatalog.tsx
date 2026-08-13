import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays, CheckCircle2, Clock3, ExternalLink, Flag, Gauge, MapPinned, ShieldCheck } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { amsToUTC } from "@/lib/dateHelpers";
import { Field, inputClass, Panel, PrimaryButton, SecondaryButton, StatusPill } from "../shared/ui";
import { InviteePicker } from "./InviteePicker";
import {
  catalogDateWindow,
  formatCatalogInstant,
  phaseRange,
  selectedCatalogSlot,
  type IRacingCatalogEvent,
  type IRacingCatalogSlot,
} from "./iracingCatalogPresentation";
import { useActivateIRacingEnduranceSlot, useIRacingEnduranceCatalog } from "../repository/iracingEventsRepository";

const durationLabel = (event: IRacingCatalogEvent, slot: IRacingCatalogSlot) => {
  if (slot.race_lap_limit) return `${slot.race_lap_limit} ronden`;
  const minutes = slot.race_duration_minutes ?? event.duration_minutes;
  if (!minutes) return "Raceduur nog niet gepubliceerd";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}u ${rest}m` : `${hours} uur`;
};


const SlotTimeline = ({ event, slot, selected, canManage, onActivate, onOpen }: {
  event: IRacingCatalogEvent;
  slot: IRacingCatalogSlot;
  selected: boolean;
  canManage: boolean;
  onActivate: (slot: IRacingCatalogSlot) => void;
  onOpen: (eventId: string) => void;
}) => {
  const practice = phaseRange(slot.practice_start_at ?? slot.session_start_at, slot.practice_duration_minutes);
  const qualifying = phaseRange(slot.qualifying_start_at, slot.qualifying_duration_minutes);
  return <div className={`rounded-2xl p-4 ring-1 transition ${selected ? "bg-orange-500/[0.10] ring-orange-400/35" : "bg-black/25 ring-white/[0.07]"}`}>
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={selected ? "orange" : "neutral"}>{selected ? "3SM rijdt dit slot" : "Officieel timeslot"}</StatusPill>
          <span className="text-xs text-gray-500">{durationLabel(event, slot)}</span>
        </div>
        <div>
          <p className="text-sm font-black text-white">{formatCatalogInstant(slot.session_start_at, "amsterdam")}</p>
          <p className="mt-1 text-xs text-gray-500">iRacing/UTC · {formatCatalogInstant(slot.session_start_at, "utc")}</p>
        </div>
        <dl className="grid gap-2 text-xs text-gray-300 sm:grid-cols-3">
          <div><dt className="text-gray-500">Practice / warm-up</dt><dd>{practice ? `${practice} Nederland` : "Niet gepubliceerd door iRacing"}</dd></div>
          <div><dt className="text-gray-500">Kwalificatie</dt><dd>{qualifying ? `${qualifying} Nederland` : "Niet gepubliceerd door iRacing"}</dd></div>
          <div><dt className="text-gray-500">Verwachte racestart</dt><dd>{slot.estimated_race_start_at ? `circa ${formatCatalogInstant(slot.estimated_race_start_at, "amsterdam")}` : "Niet gepubliceerd door iRacing"}</dd></div>
        </dl>
      </div>
      {canManage && !event.selectedEventId && event.local_class_ids.length > 0 && <SecondaryButton onClick={() => onActivate(slot)} className="shrink-0">Deze gaan we rijden</SecondaryButton>}
      {selected && event.selectedEventId && <PrimaryButton onClick={() => onOpen(event.selectedEventId!)} className="shrink-0">Open race / inschrijven</PrimaryButton>}
    </div>
  </div>;
};

const ActivationPanel = ({ event, slot, onClose }: { event: IRacingCatalogEvent; slot: IRacingCatalogSlot; onClose: () => void }) => {
  const activate = useActivateIRacingEnduranceSlot();
  const [deadline, setDeadline] = useState("");
  const [visibility, setVisibility] = useState<"open" | "invite_only" | "hidden">("open");
  const [maxDrivers, setMaxDrivers] = useState(4);
  const [invitees, setInvitees] = useState<string[]>([]);
  const [error, setError] = useState("");
  const submit = async (formEvent: React.FormEvent) => {
    formEvent.preventDefault();
    setError("");
    try {
      await activate.mutateAsync({
        catalogEventId: event.id,
        catalogSlotId: slot.id,
        registrationDeadline: deadline ? amsToUTC(deadline) : null,
        visibility,
        maxDriversPerCar: maxDrivers,
        invitedUserIds: invitees,
      });
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Timeslot activeren mislukt.");
    }
  };
  return <Panel className="mt-4 bg-black/45 ring-orange-400/25">
    <div className="mb-5 flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 text-orange-400" /><div><h4 className="font-heading text-lg font-black text-white">Bevestig dit 3SM-timeslot</h4><p className="mt-1 text-sm text-gray-400">{formatCatalogInstant(slot.session_start_at, "amsterdam")} · daarna wordt uitsluitend dit slot inschrijfbaar.</p></div></div>
    <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
      <Field label="Aanmelddeadline (Nederland, optioneel)"><input type="datetime-local" className={inputClass} value={deadline} onChange={(event) => setDeadline(event.target.value)} /><span className="mt-1 block text-[11px] text-gray-500">Geen vaste voorlooptijd: laat leeg als inschrijven tot de sessiestart open mag blijven.</span></Field>
      <Field label="Zichtbaarheid"><select className={inputClass} value={visibility} onChange={(event) => setVisibility(event.target.value as typeof visibility)}><option value="open">Open voor alle leden</option><option value="invite_only">Alleen op uitnodiging</option><option value="hidden">Verborgen</option></select></Field>
      <Field label="Max. coureurs per auto"><input required type="number" min={1} max={30} className={inputClass} value={maxDrivers} onChange={(event) => setMaxDrivers(Math.max(1, Math.min(30, Number(event.target.value) || 1)))} /></Field>
      <InviteePicker value={invitees} onChange={setInvitees} />
      {error && <p role="alert" className="md:col-span-2 rounded-xl bg-red-500/10 p-3 text-sm text-red-200 ring-1 ring-red-500/20">{error}</p>}
      <div className="md:col-span-2 flex flex-wrap gap-2"><PrimaryButton type="submit" disabled={activate.isPending}>{activate.isPending ? "Activeren…" : "Bevestigen en inschrijving openen"}</PrimaryButton><SecondaryButton type="button" onClick={onClose}>Annuleren</SecondaryButton></div>
    </form>
  </Panel>;
};

export const IRacingEventCatalog = () => {
  const navigate = useNavigate();
  const { isSuperAdmin, isEnduranceManager } = useAuth();
  const canManage = Boolean(isSuperAdmin || isEnduranceManager);
  const { data: events = [], isLoading, isError, error } = useIRacingEnduranceCatalog();
  const [activating, setActivating] = useState<{ event: IRacingCatalogEvent; slot: IRacingCatalogSlot } | null>(null);
  const visible = useMemo(() => events.filter((event) => event.active), [events]);

  if (isLoading) return <Panel><p role="status" className="text-sm text-gray-400">Officiële iRacing Endurance-kalender laden…</p></Panel>;
  if (isError) return <Panel><p role="alert" className="text-sm text-red-300">Officiële kalender kon niet worden geladen: {(error as Error).message}</p></Panel>;
  if (!visible.length) return null;

  return <section aria-labelledby="official-endurance-title" className="space-y-5">
    <div><p className="text-xs font-black uppercase tracking-[0.22em] text-orange-400">Officiële iRacing-kalender</p><h2 id="official-endurance-title" className="mt-2 font-heading text-3xl font-black text-white">Endurance & Special Events</h2><p className="mt-2 max-w-3xl text-sm leading-relaxed text-gray-400">Eén evenement, alle officiële timeslots. Inschrijven verschijnt pas wanneer een Endurance Manager één slot namens 3SM heeft gekozen.</p></div>
    <div className="grid gap-6">{visible.map((event) => {
      const selected = selectedCatalogSlot(event);
      return <article key={event.id} className="relative overflow-hidden rounded-[1.75rem] bg-[#111318] shadow-2xl shadow-black/30 ring-1 ring-white/[0.07]">
        <div className="absolute inset-0"><img src="/endurance-assets/endurance-card-landscape.webp" alt="" className="h-full w-full object-cover opacity-25" /><div className="absolute inset-0 bg-gradient-to-r from-[#0e1014] via-[#0e1014]/95 to-[#0e1014]/55" /></div>
        <div className="relative grid gap-6 p-5 sm:p-7 lg:grid-cols-[0.72fr_1.28fr]">
          <header>
            <div className="flex flex-wrap gap-2"><StatusPill tone={selected ? "orange" : "neutral"}>{selected ? "Geselecteerd door 3SM" : "Nog niet door 3SM geselecteerd"}</StatusPill><StatusPill>Officiële bron</StatusPill></div>
            <h3 className="mt-4 font-heading text-3xl font-black leading-tight text-white">{event.name}</h3>
            <div className="mt-4 space-y-2 text-sm text-gray-300"><p className="flex gap-2"><CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-orange-400" />{catalogDateWindow(event)}</p><p className="flex gap-2"><MapPinned className="mt-0.5 h-4 w-4 shrink-0 text-orange-400" />{event.circuit ?? "Circuit nog niet gepubliceerd"}{event.configuration ? ` · ${event.configuration}` : ""}</p><p className="flex gap-2"><Gauge className="mt-0.5 h-4 w-4 shrink-0 text-orange-400" />{event.class_ids.join(" · ") || "Klassen nog niet gepubliceerd"}</p></div>
            {event.official_url && <a href={event.official_url} target="_blank" rel="noreferrer" className="mt-5 inline-flex items-center gap-2 text-xs font-bold text-orange-300 hover:text-orange-200">Officiële eventinformatie <ExternalLink className="h-3.5 w-3.5" /></a>}
            {canManage && !event.selectedEventId && event.local_class_ids.length === 0 && <p className="mt-4 rounded-xl bg-amber-500/[0.08] p-3 text-xs text-amber-100 ring-1 ring-amber-500/20">Activatie geblokkeerd: koppel eerst expliciet ondersteunde lokale 3SM-klassen aan dit event.</p>}
            <p className="mt-5 flex items-center gap-2 text-xs text-gray-500"><Clock3 className="h-3.5 w-3.5" />Laatst gecontroleerd: {formatCatalogInstant(event.last_seen_at, "amsterdam")}</p>
          </header>
          <div className="space-y-3">
            {event.slots.length ? event.slots.map((slot) => <SlotTimeline key={slot.id} event={event} slot={slot} selected={slot.id === event.selectedSlotId} canManage={canManage} onActivate={(next) => setActivating({ event, slot: next })} onOpen={(eventId) => navigate(`/endurance/races/${eventId}`)} />) : <div className="rounded-2xl bg-black/25 p-5 ring-1 ring-white/[0.07]"><p className="flex items-center gap-2 text-sm font-bold text-white"><Flag className="h-4 w-4 text-orange-400" />Exacte starttijden nog niet gepubliceerd door iRacing.</p><p className="mt-2 text-xs text-gray-500">3SM kan dit officiële event pas selecteren zodra een timeslot bekend is.</p></div>}
            {activating?.event.id === event.id && <ActivationPanel event={event} slot={activating.slot} onClose={() => setActivating(null)} />}
            {selected && <p className="flex items-center gap-2 text-xs text-emerald-300"><CheckCircle2 className="h-4 w-4" />Alleen het gemarkeerde slot is gekoppeld aan de inschrijving.</p>}
          </div>
        </div>
      </article>;
    })}</div>
  </section>;
};
