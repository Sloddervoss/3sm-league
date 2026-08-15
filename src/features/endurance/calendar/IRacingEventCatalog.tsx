import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays, Car, CheckCircle2, Clock3, ExternalLink, Flag, Gauge, Heart, MapPinned, ShieldCheck, Users } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
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
  useIRacingEventInterestSummary,
  useIRacingManagerInterestOverview,
  useIRacingSlotInterestMembers,
  useIRacingSlotInterestSummary,
  useSetIRacingSlotInterest,
  useSetIRacingEventInterest,
} from "../repository/iracingEventsRepository";

const copy = {
  nl: {
    officialSlot: "Officieel tijdslot", selectedSlot: "3SM rijdt dit tijdslot", canSlot: "Ik kan dit tijdslot",
    cannotSlot: "Ik kan dit tijdslot niet meer", driversCan: "coureurs kunnen", driverCan: "coureur kan", thisSlot: "dit tijdslot",
    activateError: "Tijdslot activeren mislukt.", confirmSlot: "Bevestig dit 3SM-tijdslot", cardDetails: "Details & tijdsloten bekijken →",
    allSlots: "Alle tijdsloten", slotsKnown: (n: number) => `${n} tijdslot${n === 1 ? "" : "en"}`,
    officialSlots: (n: number) => `${n} officiële tijdslot${n === 1 ? "" : "en"}`,
    noSlotSelection: "3SM kan dit officiële event pas selecteren zodra een tijdslot bekend is.",
    intro: "Eén evenement, alle officiële tijdsloten. Inschrijven verschijnt pas wanneer een Endurance Manager één tijdslot namens 3SM heeft gekozen.",
    preliminary: "Ik heb interesse in dit event", removePreliminary: "Interesse in dit event intrekken",
    preliminaryHelp: "Nog geen tijden bekend? Laat alvast weten dat je dit event later zou willen rijden.",
    managerInterest: (n: number) => `${n} geïnteresseerde ${n === 1 ? "coureur" : "coureurs"}`,
    updating: "Bijwerken…", timesFollow: "Tijden volgen", officialSource: "Officiële bron", selected: "Geselecteerd",
    laps: "ronden", durationUnknown: "Raceduur nog niet gepubliceerd", hours: "uur", netherlands: "Nederland",
    expectedApproximately: "circa", detailsAria: (name: string) => `Details voor ${name} bekijken`, lastChecked: "Laatst gecontroleerd:",
    notPublished: "Niet gepubliceerd door iRacing", qualifying: "Kwalificatie", expectedStart: "Verwachte racestart",
    available: "Beschikbaar:", raceThis: "Deze gaan we rijden", openRace: "Open race / inschrijven",
    selectedBy3sm: "Geselecteerd door 3SM", notSelectedBy3sm: "Nog niet door 3SM geselecteerd",
    officialInfo: "Officiële eventinformatie", visualAttribution: "Originele eventvisual © iRacing · rechtstreeks van de officiële Special Events-pagina.",
    classesCars: "Officiële klassen & auto's", classesPending: "Klassen nog niet gepubliceerd",
    carsPending: "Officiële deelnemende auto's nog niet gepubliceerd door iRacing.", unknownDriver: "Onbekende coureur",
    exactTimesPending: "Exacte starttijden nog niet gepubliceerd door iRacing.", loading: "Officiële iRacing Endurance-kalender laden…",
    calendarEyebrow: "Officiële iRacing-kalender", onlySelectedSlot: "Alleen het gemarkeerde slot is gekoppeld aan de inschrijving.",
  },
  en: {
    officialSlot: "Official time slot", selectedSlot: "3SM races this time slot", canSlot: "I can make this time slot",
    cannotSlot: "I can no longer make this time slot", driversCan: "drivers can make", driverCan: "driver can make", thisSlot: "this time slot",
    activateError: "Failed to activate time slot.", confirmSlot: "Confirm this 3SM time slot", cardDetails: "View details & time slots →",
    allSlots: "All time slots", slotsKnown: (n: number) => `${n} time slot${n === 1 ? "" : "s"}`,
    officialSlots: (n: number) => `${n} official time slot${n === 1 ? "" : "s"}`,
    noSlotSelection: "3SM can select this official event once a time slot is known.",
    intro: "One event, all official time slots. Registration appears after an Endurance Manager selects one time slot for 3SM.",
    preliminary: "I am interested in this event", removePreliminary: "Remove my interest in this event",
    preliminaryHelp: "No times published yet? Let us know now that you may want to race this event later.",
    managerInterest: (n: number) => `${n} interested ${n === 1 ? "driver" : "drivers"}`,
    updating: "Updating…", timesFollow: "Times pending", officialSource: "Official source", selected: "Selected",
    laps: "laps", durationUnknown: "Race duration not yet published", hours: "hours", netherlands: "Netherlands",
    expectedApproximately: "approximately", detailsAria: (name: string) => `View details for ${name}`, lastChecked: "Last checked:",
    notPublished: "Not published by iRacing", qualifying: "Qualifying", expectedStart: "Expected race start",
    available: "Available:", raceThis: "Race this one", openRace: "Open race / register",
    selectedBy3sm: "Selected by 3SM", notSelectedBy3sm: "Not yet selected by 3SM",
    officialInfo: "Official event information", visualAttribution: "Original event visual © iRacing · directly from the official Special Events page.",
    classesCars: "Official classes & cars", classesPending: "Classes not yet published",
    carsPending: "Official participating cars not yet published by iRacing.", unknownDriver: "Unknown driver",
    exactTimesPending: "Exact start times not yet published by iRacing.", loading: "Loading official iRacing Endurance calendar…",
    calendarEyebrow: "Official iRacing calendar", onlySelectedSlot: "Only the highlighted time slot is linked to registration.",
  },
} as const;

const durationLabel = (event: IRacingCatalogEvent, slot: IRacingCatalogSlot, language: "nl" | "en") => {
  const c = copy[language];
  if (slot.race_lap_limit) return `${slot.race_lap_limit} ${c.laps}`;
  const minutes = slot.race_duration_minutes ?? event.duration_minutes;
  if (!minutes) return c.durationUnknown;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours} ${c.hours}`;
};

const officialEventLogos: Record<string, string> = {
  "iracing:2026:portimao-1000": "/endurance-assets/official/iracing-2026-portimao-1000.png",
  "iracing:2026:imsa-endurance-series": "/endurance-assets/official/iracing-2026-imsa-endurance-series.png",
  "iracing:2026:global-endurance-tour": "/endurance-assets/official/iracing-2026-global-endurance-tour.png",
  "iracing:2026:creventic-endurance-series": "/endurance-assets/official/iracing-2026-creventic-endurance-series.png",
  "iracing:2026:production-endurance-challenge": "/endurance-assets/official/iracing-2026-production-endurance-challenge.png",
  "iracing:2026:imsa-sportscar-endurance-challenge": "/endurance-assets/official/iracing-2026-imsa-sportscar-endurance-challenge.png",
  "iracing:2026:imsa-michelin-pilot-challenge": "/endurance-assets/official/iracing-2026-imsa-michelin-pilot-challenge.png",
  "iracing:2026:gt-endurance-series-by-simucube": "/endurance-assets/official/iracing-2026-gt-endurance-series-by-simucube.png",
  "iracing:2026:nurburgring-endurance-championship": "/endurance-assets/official/iracing-2026-nurburgring-endurance-championship.jpg",
};

/** Uniek-logo voor een event: exacte source_key eerste, dan serie-prefix (bv. serie-race). */
const officialEventLogoFor = (sourceKey: string): string | undefined => {
  const exact = officialEventLogos[sourceKey];
  if (exact) return exact;
  return Object.entries(officialEventLogos)
    .filter(([key]) => key !== "iracing:2026:portimao-1000")
    .sort(([a], [b]) => b.length - a.length)
    .find(([key]) => sourceKey.startsWith(`${key}:`))?.[1];
};

const fallbackEventVisual = "/endurance-assets/endurance-card-landscape.webp";

const EventVisual = ({ event, className }: { event: IRacingCatalogEvent; className: string }) => {
  const officialLogoForEvent = officialEventLogoFor(event.source_key);
  const sources = useMemo(
    () => [event.poster_url, officialLogoForEvent, fallbackEventVisual].filter(
      (source, index, all): source is string => Boolean(source) && all.indexOf(source) === index,
    ),
    [event.poster_url, officialLogoForEvent],
  );
  const [sourceIndex, setSourceIndex] = useState(0);
  useEffect(() => setSourceIndex(0), [event.id, event.poster_url]);
  const source = sources[Math.min(sourceIndex, sources.length - 1)] ?? fallbackEventVisual;
  const originalPoster = source === event.poster_url;
  const officialLogo = source === officialLogoForEvent;
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

const SlotTimeline = ({ event, slot, selected, canManage, isAuthenticated, interestedCount, isCurrentUserInterested, interestedNames, interestPending, onToggleInterest, onActivate, onOpen }: {
  event: IRacingCatalogEvent;
  slot: IRacingCatalogSlot;
  selected: boolean;
  canManage: boolean;
  isAuthenticated: boolean;
  interestedCount: number;
  isCurrentUserInterested: boolean;
  interestedNames: string[];
  interestPending: boolean;
  onToggleInterest: (slot: IRacingCatalogSlot, interested: boolean) => void;
  onActivate: (slot: IRacingCatalogSlot) => void;
  onOpen: (eventId: string) => void;
}) => {
  const { language } = useLanguage();
  const c = copy[language];
  const practice = phaseRange(slot.practice_start_at ?? slot.session_start_at, slot.practice_duration_minutes, language);
  const qualifying = phaseRange(slot.qualifying_start_at, slot.qualifying_duration_minutes, language);
  const expectedRaceStart = expectedCatalogRaceStart(slot);
  return <div className={`rounded-2xl p-4 ring-1 transition ${selected ? "bg-orange-500/[0.10] ring-orange-400/35" : "bg-black/25 ring-white/[0.07]"}`}>
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={selected ? "orange" : "neutral"}>{selected ? c.selectedSlot : c.officialSlot}</StatusPill>
          <span className="text-xs text-gray-500">{durationLabel(event, slot, language)}</span>
        </div>
        <div>
          <p className="text-sm font-black text-white">{formatCatalogInstant(slot.session_start_at, "amsterdam", language)}</p>
          <p className="mt-1 text-xs text-gray-500">iRacing/UTC · {formatCatalogInstant(slot.session_start_at, "utc", language)}</p>
        </div>
        <dl className="grid gap-2 text-xs text-gray-300 sm:grid-cols-3">
          <div><dt className="text-gray-500">Practice / warm-up</dt><dd>{practice ? `${practice} ${c.netherlands}` : c.notPublished}</dd></div>
          <div><dt className="text-gray-500">{c.qualifying}</dt><dd>{qualifying ? `${qualifying} ${c.netherlands}` : c.notPublished}</dd></div>
          <div><dt className="text-gray-500">{c.expectedStart}</dt><dd>{expectedRaceStart ? `${c.expectedApproximately} ${formatCatalogInstant(expectedRaceStart, "amsterdam", language)}` : c.notPublished}</dd></div>
        </dl>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-300"><Users className="h-3.5 w-3.5 text-orange-400" /><span>{interestedCount}</span> <span>{interestedCount === 1 ? c.driverCan : c.driversCan}</span> <span>{c.thisSlot}</span></span>
          {isAuthenticated && <SecondaryButton
            onClick={() => onToggleInterest(slot, !isCurrentUserInterested)}
            disabled={interestPending}
            className={isCurrentUserInterested ? "!text-emerald-300 ring-emerald-500/30" : ""}
          >
            <Heart className={`h-4 w-4 ${isCurrentUserInterested ? "fill-current" : ""}`} />
            {interestPending ? c.updating : isCurrentUserInterested ? c.cannotSlot : c.canSlot}
          </SecondaryButton>}
        </div>
        {canManage && interestedNames.length > 0 && <div className="rounded-xl bg-white/[0.035] px-3 py-2 text-xs text-gray-400 ring-1 ring-white/[0.06]">
          <span className="font-bold text-gray-200">{c.available}</span> {interestedNames.join(", ")}
        </div>}
      </div>
      {canManage && !event.selectedEventId && <SecondaryButton onClick={() => onActivate(slot)} className="shrink-0">{c.raceThis}</SecondaryButton>}
      {selected && event.selectedEventId && <PrimaryButton onClick={() => onOpen(event.selectedEventId!)} className="shrink-0">{c.openRace}</PrimaryButton>}
    </div>
  </div>;
};

const ActivationPanel = ({ event, slot, onClose }: { event: IRacingCatalogEvent; slot: IRacingCatalogSlot; onClose: () => void }) => {
  const { language } = useLanguage();
  const c = copy[language];
  const activate = useActivateIRacingEnduranceSlot();
  const [deadline, setDeadline] = useState("");
  const [visibility, setVisibility] = useState<"open" | "invite_only" | "hidden">("open");
  const [maxDrivers, setMaxDrivers] = useState(4);
  const [invitees, setInvitees] = useState<string[]>([]);
  const [error, setError] = useState("");
  const blockedReason = activationBlockedReason(event);
  if (blockedReason) return <Panel className="mt-4 bg-amber-500/[0.06] ring-amber-500/20">
    <p role="alert" className="text-sm font-bold text-amber-100">{blockedReason}</p>
    <p className="mt-2 text-xs text-amber-100/70">Dit is beheerinformatie; bezoekers zien deze technische reden niet.</p>
    <SecondaryButton type="button" onClick={onClose} className="mt-4">Sluiten</SecondaryButton>
  </Panel>;
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
      setError(caught instanceof Error ? caught.message : c.activateError);
    }
  };
  return <Panel className="mt-4 bg-black/45 ring-orange-400/25">
    <div className="mb-5 flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 text-orange-400" /><div><h4 className="font-heading text-lg font-black text-white">{c.confirmSlot}</h4><p className="mt-1 text-sm text-gray-400">{formatCatalogInstant(slot.session_start_at, "amsterdam", language)} · {language === "en" ? "only this time slot will become available for registration." : "daarna wordt uitsluitend dit tijdslot inschrijfbaar."}</p></div></div>
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

const CompactEventCard = ({ event, onOpen, canManage, interestedCount }: { event: IRacingCatalogEvent; onOpen: () => void; canManage: boolean; interestedCount: number }) => {
  const { language } = useLanguage();
  const c = copy[language];
  const selected = selectedCatalogSlot(event);
  return <button
    type="button"
    aria-haspopup="dialog"
    aria-label={c.detailsAria(event.name)}
    onClick={onOpen}
    className="group overflow-hidden rounded-[1.75rem] bg-[#111318] text-left shadow-2xl shadow-black/30 ring-1 ring-white/[0.07] transition hover:-translate-y-0.5 hover:ring-orange-400/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
  >
    <div className="relative aspect-video overflow-hidden border-b border-white/[0.07] bg-[radial-gradient(circle_at_center,_#24104d_0%,_#0a0711_62%,_#050506_100%)] p-4 sm:p-6">
      <EventVisual event={event} className="h-full w-full object-contain opacity-100 transition duration-300 group-hover:scale-[1.02]" />
      {selected && <span className="absolute left-3 top-3"><StatusPill tone="orange">{c.selectedBy3sm}</StatusPill></span>}
      {canManage && <span aria-label={c.managerInterest(interestedCount)} title={c.managerInterest(interestedCount)} className="absolute right-3 top-3 inline-flex min-h-9 items-center gap-1.5 rounded-full bg-black/75 px-3 text-sm font-black text-white shadow-lg ring-1 ring-white/15 backdrop-blur"><Users className="h-4 w-4 text-orange-400" /><span>{interestedCount}</span></span>}
    </div>
    <div className="space-y-3 p-5">
      <div className="flex flex-wrap gap-2">
        <StatusPill>{c.officialSource}</StatusPill>
        <StatusPill tone={selected ? "orange" : "neutral"}>{selected ? c.selected : event.slots.length ? c.slotsKnown(event.slots.length) : c.timesFollow}</StatusPill>
      </div>
      <h3 className="font-heading text-xl font-black leading-tight text-white">{event.name}</h3>
      <div className="space-y-1.5 text-xs text-gray-400">
        <p className="flex gap-2"><CalendarDays className="mt-0.5 h-3.5 w-3.5 shrink-0 text-orange-400" />{catalogDateWindow(event, language)}</p>
        <p className="flex gap-2"><MapPinned className="mt-0.5 h-3.5 w-3.5 shrink-0 text-orange-400" />{event.circuit ?? "Circuit nog niet gepubliceerd"}{event.configuration ? ` · ${event.configuration}` : ""}</p>
        <p className="flex gap-2"><Gauge className="mt-0.5 h-3.5 w-3.5 shrink-0 text-orange-400" />{event.class_ids.join(" · ") || "Klassen nog niet gepubliceerd"}</p>
      </div>
      <p className="pt-1 text-xs font-bold text-orange-300 group-hover:text-orange-200">{c.cardDetails}</p>
    </div>
  </button>;
};

const EventDetailModal = ({ event, open, onClose, canManage }: {
  event: IRacingCatalogEvent | null;
  open: boolean;
  onClose: () => void;
  canManage: boolean;
}) => {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const c = copy[language];
  const { user } = useAuth();
  const [activating, setActivating] = useState<IRacingCatalogSlot | null>(null);
  const { data: interestRows = [] } = useIRacingSlotInterestSummary();
  const { data: interestMembers = [] } = useIRacingSlotInterestMembers(event?.id ?? null, canManage && open);
  const { data: eventInterestRows = [] } = useIRacingEventInterestSummary(Boolean(user));
  const setInterest = useSetIRacingSlotInterest();
  const setEventInterest = useSetIRacingEventInterest();
  if (!event) return null;
  const selected = selectedCatalogSlot(event);
  const officialEventLogo = officialEventLogos[event.source_key];
  const eventInterest = eventInterestRows.find((row) => row.catalog_event_id === event.id);
  const toggleInterest = (slot: IRacingCatalogSlot, interested: boolean) => setInterest.mutate({ catalogSlotId: slot.id, interested });
  const toggleEventInterest = () => setEventInterest.mutate({ catalogEventId: event.id, interested: !eventInterest?.is_current_user_interested });

  return <PreviewModal open={open} onClose={onClose} ariaLabel={`${event.name} details`} maxWidth="880px">
    <div className="relative border-b border-white/[0.07] bg-[radial-gradient(circle_at_center,_#24104d_0%,_#0a0711_62%,_#050506_100%)] px-6 pb-6 pt-10 sm:px-10 sm:pt-12">
      <div className="flex flex-wrap gap-2">
        <StatusPill tone={selected ? "orange" : "neutral"}>{selected ? c.selectedBy3sm : c.notSelectedBy3sm}</StatusPill>
        <StatusPill>{c.officialSource}</StatusPill>
      </div>
      <h3 className="mt-4 max-w-2xl font-heading text-2xl font-black leading-tight text-white sm:text-3xl">{event.name}</h3>
      <div className="mt-4 flex flex-col gap-2 text-sm text-gray-300 sm:flex-row sm:flex-wrap sm:gap-x-5">
        <p className="flex gap-2"><CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-orange-400" />{catalogDateWindow(event, language)}</p>
        <p className="flex gap-2"><MapPinned className="mt-0.5 h-4 w-4 shrink-0 text-orange-400" />{event.circuit ?? "Circuit nog niet gepubliceerd"}{event.configuration ? ` · ${event.configuration}` : ""}</p>
      </div>
      <EventVisual event={event} className="mt-4 h-24 w-full max-w-md object-contain object-left" />
      {event.official_url && <a href={event.official_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 text-xs font-bold text-orange-300 hover:text-orange-200">{c.officialInfo} <ExternalLink className="h-3.5 w-3.5" /></a>}
      <p className="mt-2 text-[11px] text-gray-500">{c.visualAttribution}</p>
    </div>

    <div className="space-y-5 p-6 sm:p-8">
      {selected && <p className="flex items-center gap-2 text-xs text-emerald-300"><CheckCircle2 className="h-4 w-4" />{c.onlySelectedSlot}</p>}

      <section aria-labelledby={`classes-${event.id}`}>
        <h4 id={`classes-${event.id}`} className="mb-2 font-heading text-base font-black text-white">{c.classesCars}</h4>
        <div className="flex flex-wrap gap-2">
          {event.class_ids.length ? event.class_ids.map((cls) => <StatusPill key={cls} tone="blue">{cls}</StatusPill>) : <StatusPill>{c.classesPending}</StatusPill>}
        </div>
        {event.cars.length > 0 && <ul className="mt-3 flex flex-wrap gap-2">
          {event.cars.map((car) => (
            <li key={car.id ?? car.name} className="flex items-center gap-2 rounded-xl bg-black/25 px-3 py-2 text-xs text-gray-200 ring-1 ring-white/[0.07]">
              <Car className="h-3.5 w-3.5 text-orange-400" />
              <span>{car.name}</span>
            </li>
          ))}
        </ul>}
        {event.cars.length === 0 && <p className="mt-3 text-xs text-gray-500">{c.carsPending}</p>}
      </section>

      <section aria-labelledby={`slots-${event.id}`}>
        <div className="mb-2 flex items-center justify-between">
          <h4 id={`slots-${event.id}`} className="font-heading text-base font-black text-white">{c.allSlots}</h4>
          <span className="text-xs text-gray-500">{c.officialSlots(event.slots.length)}</span>
        </div>
        {event.slots.length ? <div className="space-y-3">
          {event.slots.map((slot) => {
            const interest = interestRows.find((row) => row.catalog_slot_id === slot.id);
            const interestedNames = interestMembers
              .filter((member) => member.catalog_slot_id === slot.id)
              .map((member) => member.iracing_name ?? member.display_name ?? c.unknownDriver);
            return <SlotTimeline
              key={slot.id}
              event={event}
              slot={slot}
              selected={slot.id === event.selectedSlotId}
              canManage={canManage}
              isAuthenticated={Boolean(user)}
              interestedCount={interest?.interested_count ?? 0}
              isCurrentUserInterested={interest?.is_current_user_interested ?? false}
              interestedNames={interestedNames}
              interestPending={setInterest.isPending && setInterest.variables?.catalogSlotId === slot.id}
              onToggleInterest={toggleInterest}
              onActivate={setActivating}
              onOpen={(eventId) => navigate(`/endurance/races/${eventId}`)}
            />;
          })}
          {activating && <ActivationPanel event={event} slot={activating} onClose={() => setActivating(null)} />}
        </div> : <div className="rounded-2xl bg-black/25 p-5 ring-1 ring-white/[0.07]">
          <p className="flex items-center gap-2 text-sm font-bold text-white"><Flag className="h-4 w-4 text-orange-400" />{c.exactTimesPending}</p>
          <p className="mt-2 text-xs text-gray-500">{c.noSlotSelection}</p>
          <p className="mt-4 text-sm text-gray-300">{c.preliminaryHelp}</p>
          {user && <SecondaryButton type="button" onClick={toggleEventInterest} disabled={setEventInterest.isPending} className={`mt-3 ${eventInterest?.is_current_user_interested ? "!text-rose-300 ring-rose-500/30" : ""}`}>
            <Heart className={`h-4 w-4 ${eventInterest?.is_current_user_interested ? "fill-current" : ""}`} />
            {setEventInterest.isPending ? c.updating : eventInterest?.is_current_user_interested ? c.removePreliminary : c.preliminary}
          </SecondaryButton>}
        </div>}
      </section>

      <p className="flex items-center gap-2 text-xs text-gray-500"><Clock3 className="h-3.5 w-3.5" />{c.lastChecked} {formatCatalogInstant(event.last_seen_at, "amsterdam", language)}</p>
    </div>
  </PreviewModal>;
};

export const IRacingEventCatalog = () => {
  const { language } = useLanguage();
  const c = copy[language];
  const { isSuperAdmin, isEnduranceManager } = useAuth();
  const canManage = Boolean(isSuperAdmin || isEnduranceManager);
  const { data: events = [], isLoading, isError, error } = useIRacingEnduranceCatalog();
  const { data: managerInterest = [] } = useIRacingManagerInterestOverview(canManage);
  const [openEventId, setOpenEventId] = useState<string | null>(null);
  const visible = useMemo(() => {
    const today = catalogTodayAmsterdam();
    return events.filter((event) => event.active && (!event.event_end_date || event.event_end_date >= today || Boolean(event.selectedEventId)));
  }, [events]);

  if (isLoading) return <Panel><p role="status" className="text-sm text-gray-400">{c.loading}</p></Panel>;
  if (isError) return <Panel><p role="alert" className="text-sm text-red-300">Officiële kalender kon niet worden geladen: {(error as Error).message}</p></Panel>;
  if (!visible.length) return null;

  const openEvent = openEventId ? visible.find((event) => event.id === openEventId) ?? null : null;

  return <section aria-labelledby="official-endurance-title" className="space-y-5">
    <div><p className="text-xs font-black uppercase tracking-[0.22em] text-orange-400">{c.calendarEyebrow}</p><h2 id="official-endurance-title" className="mt-2 font-heading text-3xl font-black text-white">Endurance & Special Events</h2><p className="mt-2 max-w-3xl text-sm leading-relaxed text-gray-400">{c.intro}</p></div>
    <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
      {visible.map((event) => <CompactEventCard
        key={event.id}
        event={event}
        onOpen={() => setOpenEventId(event.id)}
        canManage={canManage}
        interestedCount={managerInterest.find((row) => row.catalog_event_id === event.id)?.interested_count ?? 0}
      />)}
    </div>
    <EventDetailModal event={openEvent} open={Boolean(openEvent)} onClose={() => setOpenEventId(null)} canManage={canManage} />
  </section>;
};
