import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Flag, Gauge, Lock, Radio, Route } from "lucide-react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import Navbar from "@/components/Navbar";
import { EnduranceBetaBadge } from "@/components/EnduranceBetaBadge";
import Footer from "@/components/Footer";
import { useAuth } from "@/contexts/AuthContext";
import { EnduranceStoreProvider, useEnduranceStore } from "../core/EnduranceStore";
import { EnduranceActorProvider } from "../core/ActorContext";
import { useDriverNameMap } from "@/hooks/data/useSharedQueries";
import { UpcomingRaces } from "../calendar/UpcomingRaces";
import { MyRaces } from "../calendar/MyRaces";
import { EventManager } from "../calendar/EventManager";
import { IRacingEventCatalog } from "../calendar/IRacingEventCatalog";
import { RaceWorkspace } from "../workspace/RaceWorkspace";
import { Panel, SecondaryButton, SectionHeading, StatusPill } from "../shared/ui";
import { EnduranceNav, type EnduranceSection } from "./EnduranceNav";
import { useEnduranceEvents } from "../repository/eventsRepository";
import { enduranceEventRowToAppModel } from "../repository/mappers";
import { useEnduranceCapabilities } from "../repository/capabilitiesRepository";
import { useEnduranceArchiveSummary } from "../repository/archiveRepository";
import { ArchiveRacePage } from "../archive/ArchiveRacePage";
import { formatLapTime } from "../archive/archiveDetail";
import { formatAmsterdam } from "../core/selectors";

const ENDURANCE_SECTIONS: EnduranceSection[] = ["upcoming", "mine", "archive", "manage"];

/** Leest de actieve sectie uit ?section=… (het archief heet in de URL "archief"). */
const sectionFromSearch = (search: string): EnduranceSection => {
  try {
    const raw = new URLSearchParams(search).get("section");
    if (raw === "archief" || raw === "archive") return "archive";
    return ENDURANCE_SECTIONS.find((candidate) => candidate === raw) ?? "upcoming";
  } catch {
    return "upcoming";
  }
};

const ARCHIVE_STAT = ({ label, value }: { label: string; value: string }) => (
  <div>
    <p className="text-[10px] uppercase tracking-widest text-gray-500">{label}</p>
    <p className="mt-0.5 font-heading text-lg font-black text-white">{value}</p>
  </div>
);

/**
 * Archiefkaart. De kaart is de doorklik naar /endurance/archief/:eventId, waar
 * de volledige uitslag, stintverdeling en statistieken staan.
 */
const ArchiveCard = ({ event }: { event: ReturnType<typeof enduranceEventRowToAppModel> }) => {
  const { data: teams = [] } = useEnduranceArchiveSummary(event.id);
  const main = teams[0];
  return (
    <Link
      to={`/endurance/archief/${event.id}`}
      className="block rounded-[1.5rem] transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400"
      aria-label={`${event.name} — uitslag, stints en statistieken`}
    >
      <Panel className="h-full transition hover:bg-card/85">
        <StatusPill tone="green">Afgerond</StatusPill>
        <h3 className="mt-3 font-heading text-xl font-black text-white">{event.name}</h3>
        <p className="mt-1 text-sm text-gray-400">{event.circuit} · {formatAmsterdam(event.startAt)}</p>
        {main ? (
          <>
            <div className="mt-4 grid grid-cols-3 gap-3">
              <ARCHIVE_STAT label="Rondes" value={String(main.laps)} />
              <ARCHIVE_STAT label="Snelste" value={formatLapTime(main.best_lap_seconds)} />
              <ARCHIVE_STAT label="Stops" value={String(main.stops)} />
            </div>
            <p className="mt-3 text-xs text-gray-500">{main.team_name}{main.drivers?.length ? ` · ${main.drivers.join(" · ")}` : ""}</p>
          </>
        ) : (
          <p className="mt-4 text-sm text-gray-500">Geen telemetrie bewaard voor deze race.</p>
        )}
        <p className="mt-4 flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-orange-300">
          Bekijk uitslag <ArrowRight className="h-3.5 w-3.5" />
        </p>
      </Panel>
    </Link>
  );
};

const ArchivePanel = () => {
  const { data: dbEvents = [] } = useEnduranceEvents();
  const completed = dbEvents
    .filter((event) => event.status === "completed")
    .map(enduranceEventRowToAppModel);
  return <div><SectionHeading eyebrow="Historie" title="Endurance-archief" description="Afgeronde races met hun uitslag, rondes en stops." /><div className="grid gap-4 lg:grid-cols-2">{completed.map((event) => <ArchiveCard key={event.id} event={event} />)}</div>{!completed.length && <Panel><p className="text-sm text-gray-400">Nog geen afgeronde endurance-races. Zodra een race wordt afgesloten verschijnt hij hier.</p></Panel>}</div>;
};

const EnduranceContent = () => {
  const { user, isSuperAdmin, isEnduranceManager } = useAuth();
  const { capabilities } = useEnduranceCapabilities(user?.id, { isSuperAdmin, isEnduranceManager });
  const { data: dbEvents = [], isLoading: eventsLoading } = useEnduranceEvents();
  const location = useLocation();
  const navigate = useNavigate();
  // De sectie staat in de URL (?section=archief), zodat de terugknop vanuit een
  // archiefrace weer op het archief uitkomt en een refresh niet naar de lijst
  // met aankomende races springt.
  const [section, setSection] = useState<EnduranceSection>(() => sectionFromSearch(location.search));
  const changeSection = (next: EnduranceSection) => {
    setSection(next);
    const params = new URLSearchParams(location.search);
    if (next === "upcoming") params.delete("section");
    else params.set("section", next === "archive" ? "archief" : next);
    const search = params.toString();
    navigate({ pathname: "/endurance", search: search ? `?${search}` : "" }, { replace: true });
  };
  // Beheer (events aanmaken) is voor super_admin + endurance_manager.
  // Gewone leden zien de suite wel, maar geen beheer-tab.
  const showManage = capabilities.can_manage_events;
  useEffect(() => { if (!showManage && section === "manage") setSection("upcoming"); }, [showManage, section]);

  // URL-gedreven navigatie: /endurance/ = lijst, /endurance/races/:id = workspace,
  // /endurance/archief/:id = uitslag van een afgeronde race.
  // Zodat browser-back/forward én refresh correct werken.
  const raceMatch = location.pathname.match(/^\/endurance\/races\/([^/]+)/);
  const raceRow = raceMatch ? dbEvents.find((event) => event.id === raceMatch[1]) ?? null : null;
  const selected = raceRow ? enduranceEventRowToAppModel(raceRow) : null;
  const selectRace = (id: string) => navigate(`/endurance/races/${id}${location.search}`);
  const backToList = () => navigate(`/endurance${location.search}`);
  const archiveMatch = location.pathname.match(/^\/endurance\/archief\/([^/]+)/);
  const archiveRow = archiveMatch ? dbEvents.find((event) => event.id === archiveMatch[1]) ?? null : null;
  const archiveEvent = archiveRow ? enduranceEventRowToAppModel(archiveRow) : null;
  const backToArchive = () => navigate("/endurance?section=archief");

  /* Focus mode: hide hero/footer when active */
  const isFocus = useMemo(() => {
    try { return new URLSearchParams(location.search).get("pitwallFocus") === "1"; }
    catch { return false; }
  }, [location.search]);

  return <>{!isFocus && <Navbar />}<main data-no-translate className={`min-h-screen bg-background ${isFocus ? "pb-0 pt-0" : "pb-20 pt-16"}`}>{!isFocus && <div className="relative overflow-hidden border-b border-white/5"><div className="pointer-events-none absolute -top-40 left-1/2 h-[34rem] w-[65rem] -translate-x-1/2 rounded-full bg-orange-500/[0.11] blur-3xl" /><div className="container relative mx-auto px-4 py-10 sm:py-14"><div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-end"><div><div className="mb-4 flex items-center gap-2 text-xs font-black uppercase tracking-[0.24em] text-orange-400"><Flag className="h-4 w-4" />3Stripe Endurance <EnduranceBetaBadge /></div><h1 className="max-w-4xl font-heading text-4xl font-black leading-[0.98] text-white sm:text-5xl lg:text-6xl">Endurance Control Center</h1><p className="mt-5 max-w-3xl text-base leading-relaxed text-gray-300 sm:text-lg">Van beschikbaarheid en pace tot teams, stints en live Race Control—één besloten werkruimte per race.</p></div><div className="grid grid-cols-3 gap-3"><div className="rounded-2xl bg-black/20 p-4 text-center ring-1 ring-white/5"><Gauge className="mx-auto h-5 w-5 text-orange-400" /><span className="mt-2 block text-xs text-gray-400">Pace & data</span></div><div className="rounded-2xl bg-black/20 p-4 text-center ring-1 ring-white/5"><Route className="mx-auto h-5 w-5 text-orange-400" /><span className="mt-2 block text-xs text-gray-400">Stintplanning</span></div><div className="rounded-2xl bg-black/20 p-4 text-center ring-1 ring-white/5"><Radio className="mx-auto h-5 w-5 text-orange-400" /><span className="mt-2 block text-xs text-gray-400">Race Control</span></div></div></div></div></div>}
    <div className={isFocus ? "w-full px-2 py-2" : "container mx-auto space-y-6 px-4 py-6"}>{archiveMatch ? (
      archiveEvent ? (
        <ArchiveRacePage event={archiveEvent} onBack={backToArchive} />
      ) : eventsLoading ? (
        <Panel><p className="text-sm text-gray-400">Archiefrace laden…</p></Panel>
      ) : (
        <Panel>
          <h2 className="font-heading text-xl font-black text-white">Race niet gevonden</h2>
          <p className="mt-2 text-sm text-gray-400">Deze race staat niet (meer) in het archief. Mogelijk is hij verwijderd of hoort hij bij een andere omgeving.</p>
          <SecondaryButton onClick={backToArchive} className="mt-4"><ArrowLeft className="h-4 w-4" /> Terug naar archief</SecondaryButton>
        </Panel>
      )
    ) : selected ? <RaceWorkspace event={selected} onBack={backToList} /> : <><EnduranceNav section={section} onChange={changeSection} showManage={showManage} />{section === "upcoming" && <><IRacingEventCatalog /><UpcomingRaces onSelect={(event) => selectRace(event.id)} /></>}{section === "mine" && <MyRaces onSelect={(event) => selectRace(event.id)} />}{section === "archive" && <ArchivePanel />}{section === "manage" && <EventManager />}</>}</div></main>{!isFocus && <Footer />}</>;
};

const EndurancePage = () => {
  const { loading, rolesLoading, user, isSuperAdmin, isEnduranceManager } = useAuth();
  const { capabilities, isPending: capabilitiesPending, usingFallback } = useEnduranceCapabilities(user?.id, { isSuperAdmin, isEnduranceManager });
  const profileNames = useDriverNameMap();
  const canUseEndurance = capabilities.can_access;
  useEffect(() => { document.title = "3Stripe Endurance Control Center"; const description = document.querySelector('meta[name="description"]'); description?.setAttribute("content", "Plan 3Stripe endurance-races, beschikbaarheid, teams, stints en Race Control in één besloten omgeving."); }, []);
  if (loading || rolesLoading) return <div className="flex min-h-screen items-center justify-center bg-background text-sm text-gray-400">Account laden…</div>;
  if (!user) return <Navigate to="/auth?redirect=/endurance" replace />;
  // De wachtstand geldt nu voor iedereen: voorheen sloegen staff en testers hem
  // over en zagen zij op basis van de fallback al toegang voordat de server
  // antwoord gaf.
  if (capabilitiesPending) return <div className="p-8 text-gray-400">Toegang laden…</div>;
  if (!canUseEndurance && usingFallback) {
    return <><Navbar /><main className="flex min-h-[70vh] flex-col items-center justify-center gap-4 bg-background px-4 pt-20 text-center"><Lock className="h-10 w-10 text-orange-400" /><h1 className="font-heading text-3xl font-black text-white">Toegang kon niet geladen worden</h1><p className="max-w-md text-sm text-gray-400">We konden je rechten niet ophalen. Dit is geen weigering — probeer het zo opnieuw.</p></main><Footer /></>;
  }
  if (!canUseEndurance) {
    return <><Navbar /><main className="flex min-h-[70vh] flex-col items-center justify-center gap-4 bg-background px-4 pt-20 text-center"><Lock className="h-10 w-10 text-orange-400" /><h1 className="font-heading text-3xl font-black text-white">Besloten omgeving</h1><p className="max-w-md text-sm text-gray-400">Het Endurance Control Center is een besloten, niet-openbare omgeving. Hier is niets zichtbaar voor jou.</p></main><Footer /></>;
  }
  return <EnduranceStoreProvider><EnduranceActorProvider selfId={user.id} names={profileNames}><EnduranceContent /></EnduranceActorProvider></EnduranceStoreProvider>;
};

export default EndurancePage;
