import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays, Car, CheckCircle2, Clock3, ExternalLink, Flag, Gauge, Heart, MapPinned, ShieldCheck, Users } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { amsToUTC } from "@/lib/dateHelpers";
import PreviewModal from "@/components/preview/PreviewModal";
import { Field, inputClass, Panel, PrimaryButton, SecondaryButton, StatusPill } from "../shared/ui";
import { InviteePicker } from "./InviteePicker";
import {
  catalogDateWindow,
  catalogTodayAmsterdam,
  expectedCatalogRaceStart,
  formatCatalogInstant,
  phaseRange,
  selectedCatalogSlot,
  type IRacingCatalogEvent,
  type IRacingCatalogSlot,
} from "./iracingCatalogPresentation";
import {
  useActivateIRacingEnduranceSlot,
  useIRacingEnduranceCatalog,
  useIRacingInterestSummary,
  useSetIRacingInterest,
} from "../repository/iracingEventsRepository";

const durationLabel = (event: IRacingCatalogEvent, slot: IRacingCatalogSlot) => {
  if (slot.race_lap_limit) return `${slot.race_lap_limit} ronden`;
  const minutes = slot.race_duration_minutes ?? event.duration_minutes;
  if (!minutes) return "Raceduur nog niet gepubliceerd";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}u ${rest}m` : `${hours} uur`;
};

const officialEventLogos: Record<string, string> = {
  "iracing:2026:portimao-1000": "/endurance-assets/official/iracing-2026-portimao-1000.png",
};

const fallbackEventVisual = "/endurance-assets/endurance-card-landscape.webp";

const EventVisual = ({ event, className }: { event: IRacingCatalogEvent; className: string }) => {
  const sources = useMemo(
    () => [event.poster_url, officialEventLogos[event.source_key], fallbackEventVisual].filter(
      (source, index, all): source is string => Boolean(source) && all.indexOf(source) === index,
    ),
    [event.poster_url, event.source_key],
  );
  const [sourceIndex, setSourceIndex] = useState(0);
  useEffect(() => setSourceIndex(0), [event.id, event.poster_url]);
  const source = sources[Math.min(sourceIndex, sources.length - 1)] ?? fallbackEventVisual;
  const originalPoster = source === event.poster_url;
  const officialLogo = source === officialEventLogos[event.source_key];
  return <img
    src={source}
    alt={originalPoster ? `Originele iRacing-eventvisual voor ${event.name}` : officialLogo ? `Officieel iRacing-logo voor ${event.name}` : `3SM Endurance-visual voor ${event.name}`}
    className={className}
    onError={() => setSourceIndex((current) => Math.min(current + 1, sources.length - 1))}
  />;
};

/** Activatie is pas mogelijk wanneer zowel lokale 3SM-klassen als officiële auto's zijn gemapt. */
const activationBlockedReason = (event: IRacingCatalogEvent): string | null => {
  if (event.selectedEventId) return null;
  if (event.local_class_ids.length === 0 && event.local_car_ids.length === 0) {
    return "Activatie geblokkeerd: koppel eerst expliciet ondersteunde lokale 3SM-klassen én de officiële auto's aan dit event.";
  }
  if (event.local_class_ids.length === 0) {
    return "Activatie geblokkeerd: koppel eerst expliciet ondersteunde lokale 3SM-klassen aan dit event.";
  }
  if (event.local_car_ids.length === 0) {
    return "Activatie geblokkeerd: koppel eerst de officieel beschikbare auto's aan de lokale 3SM-autocatalogus.";
  }
  return null;
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
  const expectedRaceStart = expectedCatalogRaceStart(slot);
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
          <div><dt className="text-gray-500">Verwachte racestart</dt><dd>{expectedRaceStart ? `circa ${formatCatalogInstant(expectedRaceStart, "amsterdam")}` : "Niet gepubliceerd door iRacing"}</dd></div>
        </dl>
      </div>
      {canManage && !event.selectedEventId && !activationBlockedReason(event) && <SecondaryButton onClick={() => onActivate(slot)} className="shrink-0">Deze gaan we rijden</SecondaryButton>}
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

const CompactEventCard = ({ event, onOpen }: { event: IRacingCatalogEvent; onOpen: () => void }) => {
  const selected = selectedCatalogSlot(event);
  return <button
    type="button"
    aria-haspopup="dialog"
    aria-label={`Details voor ${event.name} bekijken`}
    onClick={onOpen}
    className="group overflow-hidden rounded-[1.75rem] bg-[#111318] text-left shadow-2xl shadow-black/30 ring-1 ring-white/[0.07] transition hover:-translate-y-0.5 hover:ring-orange-400/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
  >
    <div className="relative aspect-video overflow-hidden border-b border-white/[0.07] bg-[radial-gradient(circle_at_center,_#24104d_0%,_#0a0711_62%,_#050506_100%)] p-4 sm:p-6">
      <EventVisual event={event} className="h-full w-full object-contain opacity-100 transition duration-300 group-hover:scale-[1.02]" />
      {selected && <span className="absolute left-3 top-3"><StatusPill tone="orange">Geselecteerd door 3SM</StatusPill></span>}
    </div>
    <div className="space-y-3 p-5">
      <div className="flex flex-wrap gap-2">
        <StatusPill>Officiële bron</StatusPill>
        <StatusPill tone={selected ? "orange" : "neutral"}>{selected ? "Geselecteerd" : event.slots.length ? `${event.slots.length} timeslot${event.slots.length === 1 ? "" : "s"}` : "Tijden volgen"}</StatusPill>
      </div>
      <h3 className="font-heading text-xl font-black leading-tight text-white">{event.name}</h3>
      <div className="space-y-1.5 text-xs text-gray-400">
        <p className="flex gap-2"><CalendarDays className="mt-0.5 h-3.5 w-3.5 shrink-0 text-orange-400" />{catalogDateWindow(event)}</p>
        <p className="flex gap-2"><MapPinned className="mt-0.5 h-3.5 w-3.5 shrink-0 text-orange-400" />{event.circuit ?? "Circuit nog niet gepubliceerd"}{event.configuration ? ` · ${event.configuration}` : ""}</p>
        <p className="flex gap-2"><Gauge className="mt-0.5 h-3.5 w-3.5 shrink-0 text-orange-400" />{event.class_ids.join(" · ") || "Klassen nog niet gepubliceerd"}</p>
      </div>
      <p className="pt-1 text-xs font-bold text-orange-300 group-hover:text-orange-200">Details & timeslots bekijken →</p>
    </div>
  </button>;
};

const InterestPanel = ({ event, interestedCount, isCurrentUserInterested }: {
  event: IRacingCatalogEvent;
  interestedCount: number;
  isCurrentUserInterested: boolean;
}) => {
  const { user } = useAuth();
  const setInterest = useSetIRacingInterest();
  const toggling = setInterest.isPending;
  const toggle = () => setInterest.mutate({ catalogEventId: event.id, interested: !isCurrentUserInterested });
  return <div className="rounded-2xl bg-black/25 p-4 ring-1 ring-white/[0.07]">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-500/10 text-orange-300 ring-1 ring-orange-500/25"><Users className="h-4 w-4" /></span>
        <div>
          <p className="text-sm font-black text-white">{interestedCount} {interestedCount === 1 ? "coureur" : "coureurs"} tonen interesse</p>
          <p className="text-xs text-gray-500">Voorbereidend animo vóór 3SM een slot kiest.</p>
        </div>
      </div>
      {user && <SecondaryButton onClick={toggle} disabled={toggling} className={isCurrentUserInterested ? "!text-emerald-300 ring-emerald-500/30" : ""}>
        <Heart className={`h-4 w-4 ${isCurrentUserInterested ? "fill-current" : ""}`} />
        {toggling ? "Bijwerken…" : isCurrentUserInterested ? "Interesse opgeven" : "Interesse aanmelden"}
      </SecondaryButton>}
    </div>
  </div>;
};

const EventDetailModal = ({ event, open, onClose, canManage }: {
  event: IRacingCatalogEvent | null;
  open: boolean;
  onClose: () => void;
  canManage: boolean;
}) => {
  const navigate = useNavigate();
  const [activating, setActivating] = useState<IRacingCatalogSlot | null>(null);
  const { data: interestRows = [] } = useIRacingInterestSummary();
  if (!event) return null;
  const selected = selectedCatalogSlot(event);
  const officialEventLogo = officialEventLogos[event.source_key];
  const blockedReason = activationBlockedReason(event);
  const interest = interestRows.find((row) => row.catalog_event_id === event.id);
  const interestedCount = interest?.interested_count ?? 0;
  const isCurrentUserInterested = interest?.is_current_user_interested ?? false;

  return <PreviewModal open={open} onClose={onClose} ariaLabel={`${event.name} details`} maxWidth="880px">
    <div className="relative border-b border-white/[0.07] bg-[radial-gradient(circle_at_center,_#24104d_0%,_#0a0711_62%,_#050506_100%)] px-6 pb-6 pt-10 sm:px-10 sm:pt-12">
      <div className="flex flex-wrap gap-2">
        <StatusPill tone={selected ? "orange" : "neutral"}>{selected ? "Geselecteerd door 3SM" : "Nog niet door 3SM geselecteerd"}</StatusPill>
        <StatusPill>Officiële bron</StatusPill>
      </div>
      <h3 className="mt-4 max-w-2xl font-heading text-2xl font-black leading-tight text-white sm:text-3xl">{event.name}</h3>
      <div className="mt-4 flex flex-col gap-2 text-sm text-gray-300 sm:flex-row sm:flex-wrap sm:gap-x-5">
        <p className="flex gap-2"><CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-orange-400" />{catalogDateWindow(event)}</p>
        <p className="flex gap-2"><MapPinned className="mt-0.5 h-4 w-4 shrink-0 text-orange-400" />{event.circuit ?? "Circuit nog niet gepubliceerd"}{event.configuration ? ` · ${event.configuration}` : ""}</p>
      </div>
      <EventVisual event={event} className="mt-4 h-24 w-full max-w-md object-contain object-left" />
      {event.official_url && <a href={event.official_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 text-xs font-bold text-orange-300 hover:text-orange-200">Officiële eventinformatie <ExternalLink className="h-3.5 w-3.5" /></a>}
      <p className="mt-2 text-[11px] text-gray-500">Originele eventvisual © iRacing · rechtstreeks van de officiële Special Events-pagina.</p>
    </div>

    <div className="space-y-5 p-6 sm:p-8">
      {canManage && blockedReason && <p role="alert" className="rounded-xl bg-amber-500/[0.08] p-3 text-xs text-amber-100 ring-1 ring-amber-500/20">{blockedReason}</p>}
      {selected && <p className="flex items-center gap-2 text-xs text-emerald-300"><CheckCircle2 className="h-4 w-4" />Alleen het gemarkeerde slot is gekoppeld aan de inschrijving.</p>}
      <InterestPanel event={event} interestedCount={interestedCount} isCurrentUserInterested={isCurrentUserInterested} />

      <section aria-labelledby={`classes-${event.id}`}>
        <h4 id={`classes-${event.id}`} className="mb-2 font-heading text-base font-black text-white">Officiële klassen & auto's</h4>
        <div className="flex flex-wrap gap-2">
          {event.class_ids.length ? event.class_ids.map((cls) => <StatusPill key={cls} tone="blue">{cls}</StatusPill>) : <StatusPill>Klassen nog niet gepubliceerd</StatusPill>}
        </div>
        {event.cars.length > 0 && <ul className="mt-3 flex flex-wrap gap-2">
          {event.cars.map((car) => (
            <li key={car.id ?? car.name} className="flex items-center gap-2 rounded-xl bg-black/25 px-3 py-2 text-xs text-gray-200 ring-1 ring-white/[0.07]">
              <Car className="h-3.5 w-3.5 text-orange-400" />
              <span>{car.name}</span>
            </li>
          ))}
        </ul>}
        {event.cars.length === 0 && <p className="mt-3 text-xs text-gray-500">Officiële deelnemende auto's nog niet gepubliceerd door iRacing.</p>}
      </section>

      <section aria-labelledby={`slots-${event.id}`}>
        <div className="mb-2 flex items-center justify-between">
          <h4 id={`slots-${event.id}`} className="font-heading text-base font-black text-white">Alle timeslots</h4>
          <span className="text-xs text-gray-500">{event.slots.length} officiële slot{event.slots.length === 1 ? "" : "s"}</span>
        </div>
        {event.slots.length ? <div className="space-y-3">
          {event.slots.map((slot) => <SlotTimeline key={slot.id} event={event} slot={slot} selected={slot.id === event.selectedSlotId} canManage={canManage} onActivate={setActivating} onOpen={(eventId) => navigate(`/endurance/races/${eventId}`)} />)}
          {activating && <ActivationPanel event={event} slot={activating} onClose={() => setActivating(null)} />}
        </div> : <div className="rounded-2xl bg-black/25 p-5 ring-1 ring-white/[0.07]"><p className="flex items-center gap-2 text-sm font-bold text-white"><Flag className="h-4 w-4 text-orange-400" />Exacte starttijden nog niet gepubliceerd door iRacing.</p><p className="mt-2 text-xs text-gray-500">3SM kan dit officiële event pas selecteren zodra een timeslot bekend is.</p></div>}
      </section>

      <p className="flex items-center gap-2 text-xs text-gray-500"><Clock3 className="h-3.5 w-3.5" />Laatst gecontroleerd: {formatCatalogInstant(event.last_seen_at, "amsterdam")}</p>
    </div>
  </PreviewModal>;
};

export const IRacingEventCatalog = () => {
  const { isSuperAdmin, isEnduranceManager } = useAuth();
  const canManage = Boolean(isSuperAdmin || isEnduranceManager);
  const { data: events = [], isLoading, isError, error } = useIRacingEnduranceCatalog();
  const [openEventId, setOpenEventId] = useState<string | null>(null);
  const visible = useMemo(() => {
    const today = catalogTodayAmsterdam();
    return events.filter((event) => event.active && (!event.event_end_date || event.event_end_date >= today || Boolean(event.selectedEventId)));
  }, [events]);

  if (isLoading) return <Panel><p role="status" className="text-sm text-gray-400">Officiële iRacing Endurance-kalender laden…</p></Panel>;
  if (isError) return <Panel><p role="alert" className="text-sm text-red-300">Officiële kalender kon niet worden geladen: {(error as Error).message}</p></Panel>;
  if (!visible.length) return null;

  const openEvent = openEventId ? visible.find((event) => event.id === openEventId) ?? null : null;

  return <section aria-labelledby="official-endurance-title" className="space-y-5">
    <div><p className="text-xs font-black uppercase tracking-[0.22em] text-orange-400">Officiële iRacing-kalender</p><h2 id="official-endurance-title" className="mt-2 font-heading text-3xl font-black text-white">Endurance & Special Events</h2><p className="mt-2 max-w-3xl text-sm leading-relaxed text-gray-400">Eén evenement, alle officiële timeslots. Inschrijven verschijnt pas wanneer een Endurance Manager één slot namens 3SM heeft gekozen.</p></div>
    <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
      {visible.map((event) => <CompactEventCard key={event.id} event={event} onOpen={() => setOpenEventId(event.id)} />)}
    </div>
    <EventDetailModal event={openEvent} open={Boolean(openEvent)} onClose={() => setOpenEventId(null)} canManage={canManage} />
  </section>;
};
