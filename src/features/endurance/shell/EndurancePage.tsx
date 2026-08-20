import { useEffect, useState } from "react";
import { Flag, Gauge, Radio, Route } from "lucide-react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { useAuth } from "@/contexts/AuthContext";
import { EnduranceStoreProvider, useEnduranceStore } from "../core/EnduranceStore";
import { EnduranceActorProvider } from "../core/ActorContext";
import { useDriverNameMap } from "@/hooks/data/useSharedQueries";
import { UpcomingRaces } from "../calendar/UpcomingRaces";
import { MyRaces } from "../calendar/MyRaces";
import { EventManager } from "../calendar/EventManager";
import { RaceWorkspace } from "../workspace/RaceWorkspace";
import { Panel, SectionHeading, StatusPill } from "../shared/ui";
import { EnduranceNav, type EnduranceSection } from "./EnduranceNav";
import { useEnduranceEvents } from "../repository/eventsRepository";
import { enduranceEventRowToAppModel } from "../repository/mappers";
import { IRacingEventCatalog } from "../calendar/IRacingEventCatalog";
import { useEnduranceCapabilities } from "../repository/capabilitiesRepository";

const ArchivePanel = () => {
  const { data: dbEvents = [] } = useEnduranceEvents();
  const completed = dbEvents.filter((event) => event.status === "completed");
  return <div><SectionHeading eyebrow="Historie" title="Endurance-archief" description="Afgeronde races bewaren planningversies, auditgeschiedenis en evaluatiegegevens als basis voor de volgende race." /><div className="grid gap-4 lg:grid-cols-2">{completed.map((event) => <Panel key={event.id}><StatusPill tone="green">Afgerond</StatusPill><h3 className="mt-3 font-heading text-xl font-black text-white">{event.name}</h3><p className="mt-1 text-sm text-gray-400">{event.circuit} · Afgerond</p></Panel>)}</div>{!completed.length && <Panel><p className="text-sm text-gray-400">Nog geen afgeronde endurance-races. Zodra een race wordt afgesloten verschijnt hij hier met zijn bewaarde planning en auditgeschiedenis.</p></Panel>}</div>;
};

const EnduranceContent = () => {
  const { user, isSuperAdmin, isTester, isEnduranceManager } = useAuth();
  const { capabilities, isPending: capabilitiesPending } = useEnduranceCapabilities(user?.id, { isSuperAdmin, isEnduranceManager, isTester });
  const { data: dbEvents = [] } = useEnduranceEvents();
  const location = useLocation();
  const navigate = useNavigate();
  const [section, setSection] = useState<EnduranceSection>("upcoming");
  // Beheer (events aanmaken) is voor super_admin + endurance_manager; testers
  // en managers mogen de suite zien/gebruiken, testers zien geen beheer-tab.
  const showManage = capabilities.can_manage_events;
  const canUseEndurance = capabilities.can_access;
  const legacyStaff = isSuperAdmin || isEnduranceManager || isTester;
  useEffect(() => { if (!showManage && section === "manage") setSection("upcoming"); }, [showManage, section]);

  // URL-gedreven navigatie: /endurance/ = lijst, /endurance/races/:id = workspace.
  // Zodat browser-back/forward én refresh correct werken.
  const raceMatch = location.pathname.match(/^\/endurance\/races\/([^/]+)/);
  const raceRow = raceMatch ? dbEvents.find((event) => event.id === raceMatch[1]) ?? null : null;
  const selected = raceRow ? enduranceEventRowToAppModel(raceRow) : null;
  const selectRace = (id: string) => navigate(`/endurance/races/${id}`);
  const backToList = () => navigate("/endurance");

  if (!legacyStaff && capabilitiesPending) return <div className="flex min-h-screen items-center justify-center bg-background text-sm text-gray-400">Toegang controleren…</div>;
  if (!canUseEndurance) return <Navigate to="/" replace />;
  return <><Navbar /><main data-no-translate className="min-h-screen bg-background pb-20 pt-16"><div className="relative overflow-hidden border-b border-white/5"><div className="pointer-events-none absolute -top-40 left-1/2 h-[34rem] w-[65rem] -translate-x-1/2 rounded-full bg-orange-500/[0.11] blur-3xl" /><div className="container relative mx-auto px-4 py-10 sm:py-14"><div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-end"><div><div className="mb-4 flex items-center gap-2 text-xs font-black uppercase tracking-[0.24em] text-orange-400"><Flag className="h-4 w-4" />3Stripe Endurance</div><h1 className="max-w-4xl font-heading text-4xl font-black leading-[0.98] text-white sm:text-5xl lg:text-6xl">Endurance Control Center</h1><p className="mt-5 max-w-3xl text-base leading-relaxed text-gray-300 sm:text-lg">Van beschikbaarheid en pace tot teams, stints en live Race Control—één besloten werkruimte per race.</p></div><div className="grid grid-cols-3 gap-3"><div className="rounded-2xl bg-black/20 p-4 text-center ring-1 ring-white/5"><Gauge className="mx-auto h-5 w-5 text-orange-400" /><span className="mt-2 block text-xs text-gray-400">Pace & data</span></div><div className="rounded-2xl bg-black/20 p-4 text-center ring-1 ring-white/5"><Route className="mx-auto h-5 w-5 text-orange-400" /><span className="mt-2 block text-xs text-gray-400">Stintplanning</span></div><div className="rounded-2xl bg-black/20 p-4 text-center ring-1 ring-white/5"><Radio className="mx-auto h-5 w-5 text-orange-400" /><span className="mt-2 block text-xs text-gray-400">Race Control</span></div></div></div></div></div>
    <div className="container mx-auto space-y-8 px-4 py-6">{selected ? <RaceWorkspace event={selected} onBack={backToList} /> : <><EnduranceNav section={section} onChange={setSection} showManage={showManage} />{section === "upcoming" && <><IRacingEventCatalog /><UpcomingRaces onSelect={(event) => selectRace(event.id)} /></>}{section === "mine" && <MyRaces onSelect={(event) => selectRace(event.id)} />}{section === "archive" && <ArchivePanel />}{section === "manage" && <EventManager />}</>}</div></main><Footer /></>;
};

const EndurancePage = () => {
  const { loading, rolesLoading, user } = useAuth();
  const profileNames = useDriverNameMap();
  useEffect(() => { document.title = "3Stripe Endurance Control Center"; const description = document.querySelector('meta[name="description"]'); description?.setAttribute("content", "Plan 3Stripe endurance-races, beschikbaarheid, teams, stints en Race Control in één besloten omgeving."); }, []);
  if (loading || rolesLoading) return <div className="flex min-h-screen items-center justify-center bg-background text-sm text-gray-400">Account laden…</div>;
  if (!user) return <Navigate to="/auth?redirect=/endurance" replace />;
  return <EnduranceStoreProvider><EnduranceActorProvider selfId={user.id} names={profileNames}><EnduranceContent /></EnduranceActorProvider></EnduranceStoreProvider>;
};

export default EndurancePage;
