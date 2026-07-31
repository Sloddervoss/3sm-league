import { useMemo, useState, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { analyzeTrackHistory, type MemberTrackHistoryRow, type TrackIntelligenceSource } from "@/lib/trackIntelligence";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { CONTROL_ROOM_ACTIONS, type ControlRoomActionId } from "@/features/control-room/actionModel";
import { SeasonRaceWorkspace, type SeasonWorkspaceAction } from "@/features/control-room/season/SeasonRaceWorkspace";
import { RaceDeleteConfirmation } from "@/features/control-room/season/RaceDeleteConfirmation";
import { ResultImportWorkspace } from "@/features/control-room/results/ResultImportWorkspace";
import { CommunityModule } from "@/features/control-room/community/CommunityModule";
import { CommunicationsModule } from "@/features/control-room/communications/CommunicationsModule";
import { PointsManager } from "@/features/control-room/settings/PointsManager";
import { SeasonCarLockManager } from "@/features/control-room/season/SeasonCarLockManager";
import { SeasonRaceActionForm } from "@/features/control-room/season/SeasonRaceActionForm";
import { TrackIntelligenceModule } from "@/features/control-room/track";
import { EditorialWorkspace } from "@/features/control-room/editorial";
import { OverviewModule, type OverviewNavigation } from "@/features/control-room/overview";
import { RolesRightsModule } from "@/features/control-room/roles/RolesRightsModule";
import { StewardingWorkspace } from "@/features/control-room/stewarding";
import { CommunitySupportModule } from "@/features/control-room/support";
import {
  Activity,
  ArrowRight,
  Bell,
  BrainCircuit,
  CalendarDays,
  Car,
  Check,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  Download,
  Eye,
  FileUp,
  Flag,
  FolderKanban,
  Gauge,
  HandHeart,
  LayoutDashboard,
  Menu,
  Plus,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Trophy,
  Upload,
  Users,
  X,
} from "lucide-react";

type Workspace = "overview" | "race" | "season" | "community" | "support" | "intelligence" | "announcements" | "settings";
type Audience = "none" | "everyone" | "team";

type AdminProfile = { user_id: string; display_name: string | null; iracing_name: string | null; iracing_id: string | number | null; irating: number | null; safety_rating: string | null };
type AdminUserRole = { user_id: string; role: string };
type LinkedProfile = { user_id: string; display_name: string | null; iracing_name: string | null; iracing_id: string | null };
type TrackRun = { started_at: string; finished_at: string | null; status: string; members_success: number | null; members_failed: number | null; created_records: number | null; error_summary: string | null };

const navigation: { id: Workspace; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "overview", label: "Overzicht", icon: LayoutDashboard },
  { id: "race", label: "Resultaten", icon: Flag },
  { id: "season", label: "Races", icon: Trophy },
  { id: "community", label: "Community", icon: Users },
  { id: "support", label: "Community Support", icon: HandHeart },
  { id: "intelligence", label: "Track Intelligence", icon: BrainCircuit },
  { id: "announcements", label: "Communicatie", icon: Bell },
  { id: "settings", label: "Instellingen", icon: Settings },
];

const importRows = [
  { pos: 1, name: "Jaimy Peters", source: "iRacing ID match", status: "correct" },
  { pos: 2, name: "Vincent de Vos", source: "iRacing ID match", status: "correct" },
  { pos: 3, name: "Ricky Godefrooij", source: "Naam match", status: "review" },
  { pos: 4, name: "Nieuwe coureur", source: "Geen profiel gevonden", status: "missing" },
];

const AdminWorkspacePrototype = () => {
  const [workspace, setWorkspace] = useState<Workspace>("overview");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [importStep, setImportStep] = useState(1);
  const [activeAction, setActiveAction] = useState<ControlRoomActionId | null>(null);
  const [announcementQueued, setAnnouncementQueued] = useState(false);
  const [announcementTitle, setAnnouncementTitle] = useState("Race 9 · inschrijving geopend");
  const [announcementMessage, setAnnouncementMessage] = useState("De inschrijving voor Race 9 is geopend. Controleer je auto en schrijf je op tijd in.");
  const [audience, setAudience] = useState<Audience>("team");
  const [query, setQuery] = useState("");
  const [trackSearch, setTrackSearch] = useState("");
  const [trackSource, setTrackSource] = useState<"all" | TrackIntelligenceSource>("all");
  const [seasonView, setSeasonView] = useState<"overview" | "calendar" | "registrations" | "cars" | "lobby">("overview");
  const [rolePreview, setRolePreview] = useState<Record<string, string[]>>({});
  const [roleSubject, setRoleSubject] = useState<AdminProfile | null>(null);
  const [seasonAction, setSeasonAction] = useState<SeasonWorkspaceAction | null>(null);
  const [carLockLeagueId, setCarLockLeagueId] = useState<string | undefined>();
  const { user, isAdmin, isSuperAdmin, loading, rolesLoading } = useAuth();

  const { data: profiles = [] } = useQuery({
    queryKey: ["workspace-prototype-profiles"],
    enabled: !!user && (isAdmin || isSuperAdmin),
    queryFn: async (): Promise<AdminProfile[]> => {
      const { data, error } = await supabase.rpc("admin_get_all_profiles");
      if (error) throw error;
      return (data || []) as AdminProfile[];
    },
  });
  const { data: seasonLeagues = [] } = useQuery({
    queryKey: ["workspace-prototype-leagues"], enabled: !!user && (isAdmin || isSuperAdmin),
    queryFn: async () => { const { data, error } = await supabase.from("leagues").select("id, name, season, car_class, status").order("created_at", { ascending: false }); if (error) throw error; return data || []; },
  });
  const { data: seasonRaces = [] } = useQuery({
    queryKey: ["workspace-prototype-season-races"], enabled: !!user && (isAdmin || isSuperAdmin),
    queryFn: async () => { const { data, error } = await supabase.from("races").select("id, league_id, name, track, race_date, status, race_duration, practice_duration, qualifying_duration, start_type, weather, setup, lobby_name, lobby_password, lobby_reveal_minutes").order("race_date", { ascending: true }); if (error) throw error; return data || []; },
  });
  const { data: seasonRegistrations = [] } = useQuery({
    queryKey: ["workspace-prototype-season-registrations"], enabled: !!user && (isAdmin || isSuperAdmin),
    queryFn: async () => { const { data, error } = await supabase.from("season_registrations").select("league_id, user_id, car_choice, car_locked, profiles(display_name, iracing_name)"); if (error) throw error; return (data || []) as unknown as Array<{ league_id: string; user_id: string; car_choice: string | null; car_locked: boolean; profiles: { display_name: string | null; iracing_name: string | null } | null }>; },
  });
  const { data: userRoles = [] } = useQuery({
    queryKey: ["workspace-prototype-roles"],
    enabled: !!user && (isAdmin || isSuperAdmin),
    queryFn: async (): Promise<AdminUserRole[]> => {
      const { data, error } = await supabase.rpc("admin_get_user_roles");
      if (error) throw error;
      return (data || []) as AdminUserRole[];
    },
  });
  const { data: linkedProfiles = [] } = useQuery({
    queryKey: ["workspace-prototype-linked-profiles"],
    enabled: !!user && (isAdmin || isSuperAdmin),
    queryFn: async (): Promise<LinkedProfile[]> => {
      const { data, error } = await supabase.from("profiles").select("user_id, display_name, iracing_name, iracing_id").not("iracing_id", "is", null);
      if (error) throw error;
      return ((data || []) as LinkedProfile[]).filter((profile) => String(profile.iracing_id || "").trim());
    },
  });
  const { data: historyRows = [] } = useQuery({
    queryKey: ["workspace-prototype-track-history"],
    enabled: !!user && (isAdmin || isSuperAdmin),
    queryFn: async (): Promise<MemberTrackHistoryRow[]> => {
      const { data, error } = await supabase.from("member_track_history" as never).select("id, member_id, iracing_customer_id, iracing_name, track_id, track_name, race_date, subsession_id, series_name, source, first_seen_at, last_seen_at").order("last_seen_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as MemberTrackHistoryRow[];
    },
  });
  const { data: trackRuns = [] } = useQuery({
    queryKey: ["workspace-prototype-track-runs"],
    enabled: !!user && (isAdmin || isSuperAdmin),
    queryFn: async (): Promise<TrackRun[]> => {
      const { data, error } = await supabase.from("track_intelligence_runs" as never).select("started_at, finished_at, status, members_success, members_failed, created_records, error_summary").order("started_at", { ascending: false }).limit(10);
      if (error) throw error;
      return (data || []) as unknown as TrackRun[];
    },
  });
  const insights = useMemo(() => analyzeTrackHistory(historyRows, linkedProfiles.length), [historyRows, linkedProfiles.length]);
  const filteredInsights = useMemo(() => insights.filter((track) => (trackSource === "all" || track.sources.includes(trackSource)) && track.trackName.toLowerCase().includes(trackSearch.trim().toLowerCase())), [insights, trackSearch, trackSource]);
  const sourceCounts = useMemo(() => historyRows.reduce<Record<TrackIntelligenceSource, number>>((counts, row) => { counts[row.source] = (counts[row.source] || 0) + 1; return counts; }, { iracing_recent_races: 0, site_result_json: 0, extension_scan: 0 }), [historyRows]);
  const highMediumCount = insights.filter((track) => track.reliability !== "Laag").length;
  const rolesFor = (userId: string) => rolePreview[userId] ?? userRoles.filter((role) => role.user_id === userId).map((role) => role.role);
  const togglePreviewRole = (userId: string, role: string) => setRolePreview((current) => {
    const roles = current[userId] ?? userRoles.filter((item) => item.user_id === userId).map((item) => item.role);
    return { ...current, [userId]: roles.includes(role) ? roles.filter((item) => item !== role) : [...roles, role] };
  });

  const currentTitle = useMemo(
    () => navigation.find((item) => item.id === workspace)?.label ?? "Actiecentrum",
    [workspace],
  );
  const mention = audience === "everyone" ? "@everyone" : audience === "team" ? "@3 Stripe Motorsport" : "";
  const embedColor = audience === "team" ? "#f97316" : "#f97316";

  const openAction = (action: ControlRoomActionId) => {
    setActiveAction(action);
  };

  const openSeasonAction = (action: SeasonWorkspaceAction) => {
    const mapped: Record<SeasonWorkspaceAction["id"], ControlRoomActionId> = {
      "season-create": "season-create", "season-edit": "season-edit", "race-create": "race-create", "race-edit": "race-edit", "race-delete": "race-delete", "registration-manage": "season-registration", "car-lock": "car-lock", "lobby-edit": "lobby-edit", "solo-race-create": "solo-race-create", "solo-race-edit": "solo-race-edit", "solo-race-delete": "solo-race-delete",
    };
    setSeasonAction(action);
    if (action.id === "car-lock") setCarLockLeagueId(action.context.seasonId);
    openAction(mapped[action.id]);
  };

  const openTrackAction = (action: { id: "track-sync" | "track-log" | "track-export" }) => openAction(action.id);

  const openOverviewNavigation = (navigation: OverviewNavigation) => {
    if (navigation.destination === "community") { openWorkspace("community"); return; }
    if (navigation.destination === "communications") { openWorkspace("announcements"); return; }
    setWorkspace("season");
    if (navigation.focus.kind === "race") openSeasonAction({ id: "race-edit", impact: "write", allowedRoles: ["admin", "super_admin"], panel: "race-form", context: { seasonId: navigation.focus.leagueId || undefined, raceId: navigation.focus.raceId, tab: "calendar" } });
    if (navigation.focus.kind === "car-locks") openSeasonAction({ id: "car-lock", impact: "write", allowedRoles: ["admin", "super_admin"], panel: "car-lock-confirm", context: { seasonId: navigation.focus.leagueId || undefined, tab: "registrations" } });
  };

  const openWorkspace = (next: Workspace) => {
    setWorkspace(next);
    setMobileOpen(false);
    setActiveAction(null);
    setRoleSubject(null);
  };

  const Sidebar = ({ mobile = false }: { mobile?: boolean }) => (
    <nav className={mobile ? "space-y-1 p-4" : "flex h-full flex-col p-3"}>
      {!mobile && (
        <div className="mb-8 flex items-center gap-3 px-3 pt-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-racing text-xs font-black text-white">3SM</div>
          <div>
            <p className="font-heading text-sm font-black text-white">CONTROL ROOM</p>
            <p className="text-[10px] uppercase tracking-[0.16em] text-gray-500">Admin workspace</p>
          </div>
        </div>
      )}
      <div className="space-y-1">
        {navigation.filter((item) => item.id !== "support" || isSuperAdmin).map((item) => {
          const Icon = item.icon;
          const active = item.id === workspace;
          return (
            <button
              key={item.id}
              onClick={() => openWorkspace(item.id)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-semibold transition-colors ${active ? "bg-orange-500/12 text-white ring-1 ring-orange-400/20" : "text-gray-400 hover:bg-white/[0.04] hover:text-white"}`}
            >
              <Icon className={`h-4 w-4 ${active ? "text-orange-400" : ""}`} />
              <span className="flex-1">{item.label}</span>

            </button>
          );
        })}
      </div>

    </nav>
  );

  const renderLiveActionContent = () => {
    switch (activeAction ? CONTROL_ROOM_ACTIONS[activeAction].panel : null) {
      case "editor-role-manager":
      case "privileged-role-manager":
      case "driver-delete-confirm": return <RolesRightsModule />;
      case "team-request-review":
      case "team-form":
      case "team-delete-confirm": return <CommunityModule />;
      case "result-import-wizard": return <ResultImportWorkspace />;
      case "season-form":
      case "season-delete-confirm":
      case "race-form":
      case "lobby-manager":
      case "solo-race-form": return seasonAction ? <SeasonRaceActionForm action={seasonAction} key={`${seasonAction.id}:${seasonAction.context.seasonId || ""}:${seasonAction.context.raceId || ""}`} onComplete={() => setActiveAction(null)} /> : null;
      case "registration-manager": return <SeasonRaceWorkspace initialTab="registrations" initialSeasonId={seasonAction?.context.seasonId} onAction={openSeasonAction} />;
      case "race-delete-confirm":
      case "solo-race-delete-confirm": return seasonAction?.context.raceId ? <RaceDeleteConfirmation target={{ raceId: seasonAction.context.raceId, name: typeof seasonAction.context.fields?.name === "string" ? seasonAction.context.fields.name : null, track: typeof seasonAction.context.fields?.track === "string" ? seasonAction.context.fields.track : null, race_date: typeof seasonAction.context.fields?.race_date === "string" ? seasonAction.context.fields.race_date : null, isSolo: seasonAction.id === "solo-race-delete" }} onCancel={() => setActiveAction(null)} onDeleted={() => setActiveAction(null)} /> : null;
      case "car-lock-confirm": return <SeasonCarLockManager initialLeagueId={carLockLeagueId} />;
      case "announcement-composer": return <CommunicationsModule />;
      case "points-manager": return <PointsManager />;
      case "news-editor": return <EditorialWorkspace />;
      case "track-sync-confirm":
      case "track-run-log":
      case "track-export": return <TrackIntelligenceModule />;
      case "steward-inbox": return <StewardingWorkspace />;
      default: return null;
    }
  };

  const renderActionDrawer = () => activeAction ? (
    <aside className="fixed inset-y-0 right-0 z-[70] w-full max-w-6xl border-l border-white/10 bg-[#11141d] shadow-2xl shadow-black/50">
      <div className="flex h-16 items-center justify-between border-b border-white/10 px-5">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-400">Control Room</p>
          <h3 className="font-heading text-lg font-black text-white">{CONTROL_ROOM_ACTIONS[activeAction].title}</h3>
        </div>
        <button onClick={() => { setActiveAction(null); setRoleSubject(null); }} className="rounded-lg p-2 text-gray-400 hover:bg-white/5 hover:text-white" aria-label="Sluiten"><X className="h-5 w-5" /></button>
      </div>
      <div className="h-[calc(100vh-4rem)] overflow-y-auto p-5 text-sm text-gray-300">{renderLiveActionContent()}</div>
    </aside>
  ) : null;

  const ActionCard = ({ icon: Icon, title, detail, target, label }: { icon: typeof Flag; title: string; detail: string; target: Workspace; label: string }) => (
    <button onClick={() => openWorkspace(target)} className="group flex w-full items-center gap-4 rounded-xl border border-white/[0.07] bg-white/[0.025] p-4 text-left transition hover:border-orange-400/25 hover:bg-orange-400/[0.045]">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-orange-400/10 text-orange-300"><Icon className="h-5 w-5" /></span>
      <span className="min-w-0 flex-1"><span className="block font-bold text-white">{title}</span><span className="mt-0.5 block text-xs leading-relaxed text-gray-400">{detail}</span></span>
      <span className="hidden items-center gap-1 text-xs font-bold text-orange-300 sm:flex">{label}<ChevronRight className="h-4 w-4" /></span>
    </button>
  );

  const Overview = () => (
    <div className="space-y-7">
      <section className="grid gap-5 xl:grid-cols-[1.3fr_.7fr]">
        <div className="relative overflow-hidden rounded-2xl border border-orange-400/20 bg-gradient-to-br from-orange-500/[0.11] via-[#181a24] to-[#12141c] p-6 md:p-7">
          <div className="absolute -right-10 -top-12 h-48 w-48 rounded-full bg-orange-500/10 blur-3xl" />
          <div className="relative">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-orange-300">Volgende operationele stap</p>
            <h2 className="mt-2 font-heading text-2xl font-black text-white md:text-3xl">GT Master Challenge Cup · Race 9</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-400">Woensdag 22 juli · Motorsport Arena Oschersleben · nog 13 dagen. De race wacht op communicatie, auto-locks en later een gecontroleerde uitslag-import.</p>
            <div className="mt-5 flex flex-wrap gap-2"><button onClick={() => openWorkspace("season")} className="rounded-lg bg-gradient-racing px-4 py-2.5 text-sm font-black text-white">Open racebeheer</button><button onClick={() => openAction("announcement-compose")} className="rounded-lg border border-white/10 px-4 py-2.5 text-sm font-bold text-gray-200 hover:bg-white/5">Aankondiging voorbereiden</button></div>
          </div>
        </div>
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5">
          <div className="flex items-center justify-between"><p className="text-xs font-black uppercase tracking-wider text-gray-400">Systeemstatus</p><Activity className="h-4 w-4 text-emerald-400" /></div>
          <div className="mt-5 space-y-4">{[["22", "ingeschreven coureurs"], ["3", "auto’s nog niet gelockt"], ["2", "team-aanvragen wachten"], ["1", "aankondiging in wachtrij"]].map(([value, label]) => <div className="flex items-end justify-between" key={label}><span className="text-sm text-gray-400">{label}</span><span className="font-heading text-xl font-black text-white">{value}</span></div>)}</div>
        </div>
      </section>
      <section>
        <div className="mb-3 flex items-end justify-between"><div><p className="text-[11px] font-black uppercase tracking-[0.16em] text-orange-300">Werkvoorraad</p><h2 className="font-heading text-xl font-black text-white">Wat heeft nu aandacht nodig?</h2></div><span className="text-xs text-gray-500">Gerangschikt op tijd en impact</span></div>
        <div className="grid gap-3 md:grid-cols-2">
          <ActionCard icon={ClipboardCheck} title="Twee team-aanvragen beoordelen" detail="Goedkeuring maakt team, Discord-rol en teamsectie aan via de bestaande botflow." target="community" label="Beoordelen" />
          <ActionCard icon={FileUp} title="Resultaten Race 8 controleren" detail="Valideer coureurmatches en impact voordat standings, straffen en 3SR wijzigen." target="race" label="Import openen" />
          <ActionCard icon={BrainCircuit} title="Track Intelligence bekijken" detail="Beschikbare tracks, bronkwaliteit, syncstatus en 13-weken kalenderadvies." target="intelligence" label="Open analyse" />
          <ActionCard icon={Bell} title="Race 9 aankondiging klaarzetten" detail="Bekijk de daadwerkelijke Discord-opbouw: mentions boven de embed, embedkleur, footer en tijdstempel." target="announcements" label="Open communicatie" />
        </div>
      </section>
      <section className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5"><div className="mb-4 flex items-center gap-2"><Activity className="h-4 w-4 text-orange-300" /><h2 className="font-heading text-lg font-black text-white">Recente activiteiten</h2></div><div className="space-y-3 border-l border-white/10 pl-4 text-sm">{["Vandaag 20:14 · Resultaten van Race 8 gecontroleerd", "Vandaag 18:02 · Team-aanvraag van Noaber Racing ontvangen", "Gisteren 21:41 · Aankondiging voor Race 8 succesvol verstuurd"].map((item) => <p className="text-gray-400" key={item}>{item}</p>)}</div></section>
    </div>
  );

  const RaceManagement = () => (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5 md:flex-row md:items-center md:justify-between"><div><p className="text-[11px] font-black uppercase tracking-[0.16em] text-orange-300">Veilige importflow</p><h2 className="font-heading text-2xl font-black text-white">Resultaten importeren</h2><p className="mt-1 text-sm text-gray-400">Eerst valideren, daarna pas schrijven naar standings, 3SR, straffen en auto-keuzes.</p></div><div className="flex gap-2">{[1, 2, 3, 4].map((step) => <button key={step} onClick={() => setImportStep(step)} className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-black ${step === importStep ? "bg-orange-500 text-white" : step < importStep ? "bg-emerald-400/15 text-emerald-300" : "bg-white/5 text-gray-500"}`}>{step < importStep ? <Check className="h-4 w-4" /> : step}</button>)}</div></section>
      <section className="rounded-2xl border border-white/[0.07] bg-[#151821] p-5"><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-bold text-white">{["Kies race en bron", "Controleer coureurmatches", "Bekijk impact", "Bevestig import"][importStep - 1]}</p><p className="text-xs text-gray-500">Stap {importStep} van 4 · prototype, geen writes</p></div><button onClick={() => setImportStep(Math.min(4, importStep + 1))} className="flex items-center gap-2 rounded-lg bg-gradient-racing px-4 py-2 text-sm font-bold text-white">Volgende stap <ArrowRight className="h-4 w-4" /></button></div>
        {importStep === 1 && <div className="grid gap-4 md:grid-cols-2"><button className="rounded-xl border border-orange-400/25 bg-orange-400/[0.06] p-5 text-left"><Upload className="mb-3 h-5 w-5 text-orange-300" /><p className="font-bold text-white">Upload iRacing JSON</p><p className="mt-1 text-xs text-gray-400">Leest race-metadata, sessies, resultaten en iRating-snapshots vooraf uit.</p></button><button className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 text-left"><ClipboardCheck className="mb-3 h-5 w-5 text-gray-300" /><p className="font-bold text-white">Handmatige correctie</p><p className="mt-1 text-xs text-gray-400">Voor uitzonderingen, ontbrekende data of een kleine uitslagcorrectie.</p></button></div>}
        {importStep === 2 && <div className="overflow-hidden rounded-xl border border-white/[0.07]"><div className="grid grid-cols-[3rem_1fr_10rem_7rem] gap-3 bg-white/[0.035] px-4 py-3 text-[11px] font-black uppercase tracking-wider text-gray-500"><span>Pos</span><span>Coureur</span><span>Herkenning</span><span>Status</span></div>{importRows.map((row) => <div className="grid grid-cols-[3rem_1fr_10rem_7rem] gap-3 border-t border-white/[0.05] px-4 py-3 text-sm" key={row.pos}><span className="font-heading font-black text-white">{row.pos}</span><span className="font-bold text-gray-200">{row.name}</span><span className="text-xs text-gray-400">{row.source}</span><span className={`text-xs font-bold ${row.status === "correct" ? "text-emerald-300" : row.status === "review" ? "text-amber-300" : "text-red-300"}`}>{row.status === "correct" ? "Correct" : row.status === "review" ? "Controleren" : "Actie nodig"}</span></div>)}</div>}
        {importStep === 3 && <div className="grid gap-3 md:grid-cols-3">{[["18", "resultaten worden bijgewerkt"], ["1", "onbekende coureur blokkeert import"], ["Ja", "standings, straffen en 3SR herberekenen"]].map(([value, label]) => <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-4" key={label}><p className="font-heading text-2xl font-black text-white">{value}</p><p className="mt-1 text-xs text-gray-400">{label}</p></div>)}</div>}
        {importStep === 4 && <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-5"><div className="flex gap-3"><CircleAlert className="h-5 w-5 shrink-0 text-amber-300" /><div><p className="font-bold text-amber-100">Klaar voor definitieve import</p><p className="mt-1 text-sm leading-relaxed text-amber-100/65">De echte importknop wordt pas actief zodra iedere coureur is opgelost. Daarna volgt één bevestiging met de volledige impact.</p></div></div><button onClick={() => openAction("result-import")} className="mt-4 rounded-lg bg-orange-500 px-4 py-2.5 text-sm font-black text-white">Import ter bevestiging openen</button></div>}
      </section>
    </div>
  );

  const Season = () => {
    const activeLeague = (seasonLeagues.find((league) => league.status === "active") || seasonLeagues[0]) as { id: string; name: string; season: string | null; car_class: string | null } | undefined;
    const races = seasonRaces.filter((race) => !activeLeague || race.league_id === activeLeague.id);
    const registrations = seasonRegistrations.filter((registration) => !activeLeague || registration.league_id === activeLeague.id);
    const title = activeLeague?.name || "Geen actief seizoen";
    const panel = seasonView === "calendar" ? <section className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5"><div className="flex items-center justify-between"><div><p className="text-xs font-black uppercase tracking-wider text-orange-300">Kalender</p><h3 className="font-heading text-xl font-black text-white">Alle races van {title}</h3></div><button onClick={() => openAction("race-create")} className="rounded-lg bg-gradient-racing px-3 py-2 text-xs font-bold text-white">+ Nieuwe race</button></div><div className="mt-5 space-y-2">{races.map((race) => <button key={race.id} onClick={() => openAction("race-edit")} className="grid w-full grid-cols-[1fr_10rem_7rem] gap-3 rounded-lg border border-white/[0.06] bg-black/10 p-3 text-left hover:border-orange-400/25"><span><span className="block font-bold text-white">{race.name}</span><span className="text-xs text-gray-400">{race.track}</span></span><span className="text-xs text-gray-400">{race.race_date ? new Date(race.race_date).toLocaleString("nl-NL", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" }) : "Datum onbekend"}</span><span className="text-xs font-bold text-orange-300">Bewerken</span></button>)}{!races.length && <p className="text-sm text-gray-500">Geen races gevonden.</p>}</div></section> : seasonView === "registrations" ? <section className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5"><p className="text-xs font-black uppercase tracking-wider text-orange-300">Inschrijvingen</p><h3 className="mt-1 font-heading text-xl font-black text-white">{registrations.length} seizoeninschrijvingen</h3><div className="mt-5 grid gap-2 md:grid-cols-2">{registrations.map((registration) => <div key={registration.user_id} className="rounded-lg border border-white/[0.06] bg-black/10 p-3"><p className="font-bold text-white">{registration.profiles?.display_name || registration.profiles?.iracing_name || registration.user_id}</p><p className="mt-1 text-xs text-gray-400">Auto: {registration.car_choice || "nog niet gekozen"} · {registration.car_locked ? "gelockt" : "open"}</p></div>)}</div></section> : seasonView === "cars" ? <section className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5"><p className="text-xs font-black uppercase tracking-wider text-orange-300">Auto-keuzes</p><h3 className="mt-1 font-heading text-xl font-black text-white">Lockstatus per coureur</h3><div className="mt-5 space-y-2">{registrations.map((registration) => <button key={registration.user_id} onClick={() => openAction("car-lock")} className="flex w-full items-center justify-between rounded-lg border border-white/[0.06] bg-black/10 p-3 text-left"><span><span className="block font-bold text-white">{registration.profiles?.display_name || registration.profiles?.iracing_name || registration.user_id}</span><span className="text-xs text-gray-400">{registration.car_choice || "Geen auto gekozen"}</span></span><span className={`text-xs font-bold ${registration.car_locked ? "text-emerald-300" : "text-amber-300"}`}>{registration.car_locked ? "Gelockt" : "Open"}</span></button>)}</div></section> : seasonView === "lobby" ? <section className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5"><p className="text-xs font-black uppercase tracking-wider text-orange-300">Lobbybeheer</p><h3 className="mt-1 font-heading text-xl font-black text-white">Lobby’s per race</h3><div className="mt-5 space-y-2">{races.map((race) => <button key={race.id} onClick={() => openAction("lobby-edit")} className="grid w-full grid-cols-[1fr_1fr_7rem] gap-3 rounded-lg border border-white/[0.06] bg-black/10 p-3 text-left"><span><span className="block font-bold text-white">{race.name}</span><span className="text-xs text-gray-400">{race.track}</span></span><span className="text-xs text-gray-400">{race.lobby_name || "Nog geen lobby ingesteld"}</span><span className="text-xs font-bold text-orange-300">Beheren</span></button>)}</div></section> : null;
    return <div className="space-y-5"><section className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-6"><p className="text-[11px] font-black uppercase tracking-[0.16em] text-orange-300">Actief seizoen</p><div className="mt-2 flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><h2 className="font-heading text-3xl font-black text-white">{title}</h2><p className="mt-2 text-sm text-gray-400">{activeLeague?.season || "—"} · {activeLeague?.car_class || "—"} · {registrations.length} actieve inschrijvingen</p></div><button onClick={() => openAction("race-create")} className="flex items-center gap-2 rounded-lg border border-white/10 px-4 py-2.5 text-sm font-bold text-gray-200 hover:bg-white/5"><Plus className="h-4 w-4" /> Nieuwe race</button></div></section><div className="grid gap-3 md:grid-cols-4"><button onClick={() => setSeasonView("calendar")} className={`rounded-xl border p-5 text-left ${seasonView === "calendar" ? "border-orange-400/40 bg-orange-400/[0.08]" : "border-white/[0.07] bg-white/[0.025]"}`}><CalendarDays className="h-5 w-5 text-orange-300" /><p className="mt-4 font-heading text-lg font-black text-white">Kalender</p><p className="mt-1 text-xs text-gray-400">{races.length} races beheren</p></button><button onClick={() => setSeasonView("registrations")} className={`rounded-xl border p-5 text-left ${seasonView === "registrations" ? "border-orange-400/40 bg-orange-400/[0.08]" : "border-white/[0.07] bg-white/[0.025]"}`}><Users className="h-5 w-5 text-orange-300" /><p className="mt-4 font-heading text-lg font-black text-white">Inschrijvingen</p><p className="mt-1 text-xs text-gray-400">{registrations.length} coureurs</p></button><button onClick={() => setSeasonView("cars")} className={`rounded-xl border p-5 text-left ${seasonView === "cars" ? "border-orange-400/40 bg-orange-400/[0.08]" : "border-white/[0.07] bg-white/[0.025]"}`}><Car className="h-5 w-5 text-orange-300" /><p className="mt-4 font-heading text-lg font-black text-white">Auto’s</p><p className="mt-1 text-xs text-gray-400">{registrations.filter((registration) => !registration.car_locked).length} nog open</p></button><button onClick={() => setSeasonView("lobby")} className={`rounded-xl border p-5 text-left ${seasonView === "lobby" ? "border-orange-400/40 bg-orange-400/[0.08]" : "border-white/[0.07] bg-white/[0.025]"}`}><FolderKanban className="h-5 w-5 text-orange-300" /><p className="mt-4 font-heading text-lg font-black text-white">Lobby</p><p className="mt-1 text-xs text-gray-400">Naam, wachtwoord en vrijgavetijd</p></button></div>{panel}</div>;
  };

  const Community = () => {
    const members = profiles.filter((profile) => `${profile.display_name || ""} ${profile.iracing_name || ""}`.toLowerCase().includes(query.toLowerCase()));
    return <div className="space-y-5">
      <section className="flex flex-col gap-4 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5 md:flex-row md:items-center md:justify-between"><div><p className="text-[11px] font-black uppercase tracking-[0.16em] text-orange-300">Communitybeheer</p><h2 className="font-heading text-2xl font-black text-white">Coureurs, teams en rollen</h2><p className="mt-1 text-sm text-gray-400">Rollen bepalen zowel site-toegang als de Discord-rolsync van teamleden.</p></div><div className="relative"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-500" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Zoek coureur of team..." className="rounded-lg border border-white/10 bg-black/15 py-2 pl-9 pr-3 text-sm text-white outline-none placeholder:text-gray-600 focus:border-orange-400/40" /></div></section>
      <section className="rounded-2xl border border-amber-400/15 bg-amber-400/[0.045] p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-bold text-amber-100">2 team-aanvragen wachten op beoordeling</p><p className="mt-1 text-sm text-amber-100/60">Na goedkeuring maakt de bot de Discord-teamrol en categorie aan, synchroniseert teamleden en plaatst de teamrol boven Rijder voor de juiste kleur.</p></div><button onClick={() => openAction("team-request-review")} className="rounded-lg bg-amber-400/15 px-4 py-2 text-sm font-bold text-amber-200 ring-1 ring-amber-400/20">Open inbox</button></div></section>
      <section className="grid gap-3 md:grid-cols-3"><div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-4"><p className="font-bold text-white">Editor</p><p className="mt-1 text-xs leading-relaxed text-gray-400">Kan nieuwsconcepten en publicaties beheren. Geen race-, team- of rolrechten.</p></div><div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-4"><p className="font-bold text-white">Steward</p><p className="mt-1 text-xs leading-relaxed text-gray-400">Kan protesten, straffen en uitslagcorrecties behandelen. Geen adminrollen wijzigen.</p></div><div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-4"><p className="font-bold text-white">Admin</p><p className="mt-1 text-xs leading-relaxed text-gray-400">Beheert races, teams, communicatie en editors. Super-admin beheert admin/stewardrollen.</p></div></section>
      <section className="overflow-hidden rounded-2xl border border-white/[0.07]"><div className="grid grid-cols-[1fr_11rem_8rem] gap-3 bg-white/[0.035] px-5 py-3 text-[11px] font-black uppercase tracking-wider text-gray-500"><span>Coureur</span><span>Rollen & Discord</span><span>Actie</span></div>{members.map((profile) => { const roles = rolesFor(profile.user_id); return <div className="grid grid-cols-[1fr_11rem_8rem] gap-3 border-t border-white/[0.06] px-5 py-4 text-sm" key={profile.user_id}><span><span className="block font-bold text-white">{profile.display_name || profile.iracing_name || "Onbekend"}</span><span className="text-xs text-gray-500">iRacing: {profile.iracing_id || "niet gekoppeld"} · iRating: {profile.irating ?? "—"}</span></span><span className="self-center text-xs text-gray-400">{roles.length ? roles.map((role) => role === "moderator" ? "Steward" : role).join(" · ") : "Geen site-rollen"}</span><button onClick={() => { setRoleSubject(profile); openAction("driver-editor-role"); }} className="self-center text-left text-xs font-bold text-orange-300">Beheer rollen</button></div>})}{!members.length && <p className="p-5 text-sm text-gray-500">Geen coureurs gevonden of data wordt geladen…</p>}</section>
    </div>;
  };

  const Intelligence = () => (
    <div className="space-y-5">
      <section className="flex flex-col gap-4 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-6 md:flex-row md:items-center md:justify-between"><div><p className="text-[11px] font-black uppercase tracking-[0.16em] text-orange-300">Planning op echte data</p><h2 className="font-heading text-2xl font-black text-white">Track Intelligence</h2><p className="mt-1 max-w-2xl text-sm leading-relaxed text-gray-400">Combineert bestaande site-resultaten, iRacing recente-racehistorie van gekoppelde members en scans uit de iRacing Content Extension. Het is een advieslaag voor kalenderplanning, geen ownership-check.</p></div><button onClick={() => openAction("track-sync")} className="flex items-center gap-2 rounded-lg bg-gradient-racing px-4 py-2.5 text-sm font-black text-white"><BrainCircuit className="h-4 w-4" /> Synchronisatie voorbereiden</button></section>
      <section className="grid gap-3 md:grid-cols-4">{[[String(linkedProfiles.length), "gekoppelde members"], [String(insights.length), "tracks gevonden"], [`${insights.length ? Math.round(insights.slice(0, 13).reduce((sum, track) => sum + track.percentage, 0) / Math.min(13, insights.length)) : 0}%`, "gemiddelde dekking top 13"], [String(trackRuns[0]?.members_failed ?? (trackRuns[0]?.error_summary ? 1 : 0)), "fouten laatste sync"]].map(([value, label]) => <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-4" key={label}><p className="font-heading text-2xl font-black text-white">{value}</p><p className="mt-1 text-xs text-gray-400">{label}</p></div>)}</section>
      <section className="grid gap-5 xl:grid-cols-[1.1fr_.9fr]"><div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-wider text-gray-400">13 weken shortlist</p><h3 className="mt-1 font-heading text-xl font-black text-white">Kalenderadvies op member-dekking</h3></div><button className="flex items-center gap-1 text-xs font-bold text-orange-300"><Download className="h-4 w-4" /> Export</button></div><div className="mt-5 space-y-3">{insights.slice(0, 13).map((track, index) => <div className="grid grid-cols-[3rem_1fr_3.5rem_4rem] items-center gap-3" key={track.trackId || track.trackName}><span className="flex h-9 w-9 items-center justify-center rounded-full bg-orange-400/10 text-xs font-black text-orange-300">W{index + 1}</span><span><span className="block text-sm font-bold text-white">{track.trackName}</span><span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-white/5"><span className="block h-full bg-gradient-to-r from-orange-500 to-amber-300" style={{ width: `${Math.min(track.percentage, 100)}%` }} /></span></span><span className="text-xs text-gray-300">{track.percentage}%</span><span className={`text-xs font-bold ${track.reliability === "Hoog" ? "text-emerald-300" : track.reliability === "Middel" ? "text-amber-300" : "text-gray-400"}`}>{track.reliability}</span></div>)}{!insights.length && <p className="text-sm text-gray-500">Nog geen Track Intelligence-data beschikbaar voor deze account.</p>}</div></div><div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5"><p className="text-xs font-black uppercase tracking-wider text-gray-400">Bronnen & synclog</p><div className="mt-4 space-y-3">{[["Site result JSON", "42 records · bestaande 3SM-races", "text-blue-300"], ["iRacing recente races", "61 records · admin-only batch sync", "text-emerald-300"], ["Content Extension", "33 records · member scan", "text-violet-300"]].map(([source, detail, color]) => <div className="rounded-lg border border-white/[0.06] bg-black/10 p-3" key={source}><p className={`text-sm font-bold ${color}`}>{source}</p><p className="mt-1 text-xs text-gray-400">{detail}</p></div>)}</div><button onClick={() => openAction("track-log")} className="mt-4 flex items-center gap-2 text-xs font-bold text-orange-300"><Eye className="h-4 w-4" /> Bekijk laatste runs en fouten</button></div></section>
    </div>
  );

  const TrackDataDetail = () => (
    <div className="mt-5 space-y-5">
      <section className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5">
        <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-wider text-orange-300">Trackdekking top 30</p><p className="mt-1 text-sm text-gray-400">Volledige dekkingsoverzicht voor kalenderkeuze, niet alleen de top 13.</p></div><span className="font-heading text-2xl font-black text-white">{Math.min(30, insights.length)} <span className="text-xs font-normal text-gray-500">tracks</span></span></div>
        <div className="mt-5 grid gap-2 md:grid-cols-2">{insights.slice(0, 30).map((track, index) => <div className="rounded-lg border border-white/[0.06] bg-black/10 px-3 py-2.5" key={`coverage-${track.trackId || track.trackName}`}><div className="flex items-center justify-between gap-3 text-xs"><span className="truncate font-semibold text-white"><span className="mr-2 text-gray-500">#{index + 1}</span>{track.trackName}</span><span className="shrink-0 text-gray-400">{track.uniqueMemberCount}/{linkedProfiles.length}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]"><span className="block h-full bg-orange-500" style={{ width: `${Math.min(track.percentage, 100)}%` }} /></div></div>)}</div>
      </section>
      <section className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5">
        <p className="text-xs font-black uppercase tracking-wider text-orange-300">Datakwaliteit</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2"><div className="rounded-lg border border-white/[0.06] bg-black/10 p-4"><p className="font-heading text-2xl font-black text-white">{highMediumCount}</p><p className="mt-1 text-xs text-gray-400">hoog / middel betrouwbaar</p></div><div className="rounded-lg border border-white/[0.06] bg-black/10 p-4"><p className="font-heading text-2xl font-black text-white">{sourceCounts.extension_scan}</p><p className="mt-1 text-xs text-gray-400">extensie-records</p></div></div>
        <div className="mt-5 space-y-3">{[["iRacing recente races", sourceCounts.iracing_recent_races, "bg-emerald-500"], ["Site result JSON", sourceCounts.site_result_json, "bg-orange-500"], ["Extensie scan", sourceCounts.extension_scan, "bg-violet-500"]].map(([label, count, color]) => <div key={String(label)}><div className="mb-1 flex justify-between text-xs"><span className="text-gray-300">{label}</span><span className="text-gray-500">{count}</span></div><div className="h-2 overflow-hidden rounded-full bg-white/[0.06]"><span className={`block h-full ${color}`} style={{ width: `${historyRows.length ? (Number(count) / historyRows.length) * 100 : 0}%` }} /></div></div>)}</div>
      </section>
      <section className="overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.025]">
        <div className="flex flex-col gap-4 border-b border-white/[0.07] p-5 xl:flex-row xl:items-center xl:justify-between"><div><p className="text-xs font-black uppercase tracking-wider text-orange-300">Trackanalyse</p><p className="mt-1 text-sm text-gray-400">Alle {insights.length} unieke tracks, met bron, laatste waarneming en betrouwbaarheid.</p></div><div className="flex flex-wrap gap-2"><div className="relative"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-500" /><input value={trackSearch} onChange={(event) => setTrackSearch(event.target.value)} placeholder="Zoek track..." className="rounded-lg border border-white/10 bg-black/15 py-2 pl-9 pr-3 text-sm text-white outline-none" /></div><select value={trackSource} onChange={(event) => setTrackSource(event.target.value as "all" | TrackIntelligenceSource)} className="rounded-lg border border-white/10 bg-black/15 px-3 py-2 text-sm text-white outline-none"><option value="all">Alle bronnen</option><option value="iracing_recent_races">iRacing recente races</option><option value="site_result_json">Site result JSON</option><option value="extension_scan">Extensie scan</option></select><button onClick={() => openAction("track-export")} className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-gray-300 hover:bg-white/5"><Download className="h-4 w-4" /> Export CSV</button><button onClick={() => openAction("track-log")} className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-gray-300 hover:bg-white/5"><Eye className="h-4 w-4" /> Bekijk synclog</button></div></div>
        <div className="max-h-[46rem] overflow-auto"><div className="min-w-[850px]"><div className="grid grid-cols-[2fr_.7fr_1.25fr_1.4fr_1.5fr_.8fr] gap-4 bg-white/[0.035] px-5 py-3 text-[10px] font-black uppercase tracking-wider text-gray-500"><span>Track</span><span>Members</span><span>Percentage</span><span>Laatst gezien</span><span>Bronnen</span><span>Betrouwbaarheid</span></div>{filteredInsights.map((track) => <div className="grid grid-cols-[2fr_.7fr_1.25fr_1.4fr_1.5fr_.8fr] gap-4 border-t border-white/[0.06] px-5 py-3 text-sm" key={`analysis-${track.trackId || track.trackName}`}><span className="font-semibold text-white">{track.trackName}</span><span className="text-gray-300">{track.uniqueMemberCount}</span><span className="text-gray-300">{track.percentage}% van gekoppelde members</span><span className="text-xs text-gray-400">{new Date(track.lastSeenAt).toLocaleString("nl-NL", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" })}</span><span className="flex flex-wrap gap-1">{track.sources.map((source) => <span key={source} className="rounded border border-orange-400/25 bg-orange-400/[0.07] px-1.5 py-0.5 text-[10px] text-orange-200">{source === "site_result_json" ? "Site result JSON" : source === "extension_scan" ? "Extensie scan" : "iRacing recente races"}</span>)}</span><span className={`text-xs font-bold ${track.reliability === "Hoog" ? "text-emerald-300" : track.reliability === "Middel" ? "text-amber-300" : "text-gray-400"}`}>{track.reliability}</span></div>)}{!filteredInsights.length && <p className="p-5 text-sm text-gray-500">Geen tracks voor deze zoekopdracht of bronfilter.</p>}</div></div>
      </section>
    </div>
  );

  const Announcements = () => (
    <div className="grid gap-5 xl:grid-cols-[.9fr_1.1fr]">
      <section className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5"><p className="text-[11px] font-black uppercase tracking-[0.16em] text-orange-300">Communicatie</p><h2 className="mt-1 font-heading text-2xl font-black text-white">Nieuwe Discord-aankondiging</h2><p className="mt-1 text-sm text-gray-400">De bot verstuurt de mention als berichtinhoud en daarna de embed met titel, omschrijving, footer en tijdstempel.</p><div className="mt-5 space-y-4"><input value={announcementTitle} onChange={(event) => setAnnouncementTitle(event.target.value)} className="w-full rounded-lg border border-white/10 bg-black/15 px-3 py-2.5 text-sm text-white outline-none" /><textarea value={announcementMessage} onChange={(event) => setAnnouncementMessage(event.target.value)} rows={7} className="w-full resize-none rounded-lg border border-white/10 bg-black/15 px-3 py-2.5 text-sm text-white outline-none" /><div><p className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-400">Mention</p><div className="flex flex-wrap gap-2">{(["none", "everyone", "team"] as Audience[]).map((value) => <button key={value} onClick={() => setAudience(value)} className={`rounded-full border px-3 py-1.5 text-xs font-bold ${audience === value ? "border-orange-400/40 bg-orange-400/12 text-orange-200" : "border-white/10 text-gray-400"}`}>{value === "none" ? "Geen" : value === "everyone" ? "@everyone" : "@3 Stripe Motorsport"}</button>)}</div></div><button onClick={() => openAction("announcement-compose")} className="flex items-center gap-2 rounded-lg bg-gradient-racing px-4 py-2.5 text-sm font-black text-white"><Send className="h-4 w-4" />Open live Discord-actie</button>{announcementQueued && <p className="rounded-lg border border-emerald-400/20 bg-emerald-400/[0.07] px-3 py-2 text-sm text-emerald-200">Klaargezet in prototype. De bestaande bot haalt ongestuurde items op, verstuurt de embed en markeert hem daarna als verzonden.</p>}</div></section>
      <section className="rounded-2xl border border-white/[0.07] bg-[#313338] p-5"><div className="flex items-center justify-between"><p className="text-[11px] font-black uppercase tracking-[0.16em] text-gray-400">Live Discord-preview</p><span className="rounded bg-[#5865f2] px-1.5 py-0.5 text-[10px] font-black text-white">APP</span></div><div className="mt-5 rounded-lg bg-[#2b2d31] p-4"><div className="flex items-center gap-2"><div className="flex h-9 w-9 items-center justify-center rounded-full bg-orange-500 text-xs font-black text-white">3</div><div><p className="text-sm font-bold text-white">3SM Bot <span className="ml-1 rounded bg-[#5865f2] px-1 py-0.5 text-[9px] text-white">APP</span></p><p className="text-[11px] text-[#b5bac1]">Vandaag om 20:30</p></div></div>{mention && <p className="mt-4 text-sm font-semibold text-[#c9cdfb]">{mention}</p>}<div className="mt-3 overflow-hidden rounded border-l-4 bg-[#2b2d31] p-4" style={{ borderLeftColor: embedColor }}><p className="font-bold text-white">{announcementTitle || "Titel van de aankondiging"}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[#dbdee1]">{announcementMessage || "Schrijf hier de aankondiging..."}</p><p className="mt-4 text-xs text-[#b5bac1]">3 Stripe Motorsport · Vandaag om 20:30</p></div></div><div className="mt-4 rounded-xl border border-white/[0.07] bg-black/10 p-4"><p className="text-xs font-black uppercase tracking-wider text-gray-500">Queue-status</p><div className="mt-3 space-y-2 text-sm"><p className={announcementQueued ? "text-amber-200" : "text-gray-400"}>{announcementQueued ? "● In wachtrij — bot pakt hem op" : "○ Concept — nog niet in queue"}</p><p className="text-emerald-300">● Race 8 uitslag — verzonden gisteren 22:16</p></div></div></section>
    </div>
  );

  const SettingsView = () => <div className="grid gap-4 md:grid-cols-2"><button onClick={() => openAction("points-config")} className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5 text-left"><Trophy className="h-5 w-5 text-orange-300" /><p className="mt-4 font-heading text-lg font-black text-white">Puntensysteem</p><p className="mt-1 text-sm text-gray-400">Toon eerst de impact per league en sla daarna bewust op.</p></button><button onClick={() => openAction("driver-editor-role")} className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5 text-left"><ShieldCheck className="h-5 w-5 text-orange-300" /><p className="mt-4 font-heading text-lg font-black text-white">Rollen & rechten</p><p className="mt-1 text-sm text-gray-400">Site- en Discord-impact samen in één detailpaneel.</p></button></div>;

  const content: Record<Workspace, ReactNode> = {
    overview: <OverviewModule onNavigate={openOverviewNavigation} />,
    race: <ResultImportWorkspace />,
    season: <SeasonRaceWorkspace onAction={openSeasonAction} />,
    community: <CommunityModule />,
    support: <CommunitySupportModule />,
    intelligence: <TrackIntelligenceModule onAction={openTrackAction} />,
    announcements: <CommunicationsModule />,
    settings: <SettingsView />,
  };

  if (loading || rolesLoading) return <div className="flex min-h-screen items-center justify-center bg-[#0c0e14]" role="status"><span className="sr-only">Toegangsrechten laden…</span></div>;
  if (!user) return <Navigate to="/auth" replace />;
  if (!isAdmin && !isSuperAdmin) return <div className="flex min-h-screen flex-col bg-[#0c0e14] text-gray-100"><Navbar /><main className="flex flex-1 items-center justify-center p-6 pt-20 text-center"><div><ShieldCheck className="mx-auto h-10 w-10 text-orange-300" /><h1 className="mt-4 font-heading text-2xl font-black text-white">GEEN ADMINTOEGANG</h1><p className="mt-2 text-sm text-gray-400">Je hebt een Admin- of Super-adminrol nodig om de Control Room te gebruiken.</p></div></main><Footer /></div>;

  return (
    <div className="min-h-screen bg-[#0c0e14] text-gray-100">
      <Navbar />
      <div className="pt-16">
      <div className="flex min-h-[calc(100vh-4rem)]">
        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-64 shrink-0 border-r border-white/[0.07] bg-[#10131b] lg:block"><Sidebar /></aside>
        <div className="min-w-0 flex-1">
          <header className="sticky top-16 z-40 flex h-16 items-center justify-between border-b border-white/[0.07] bg-[#0c0e14]/90 px-4 backdrop-blur md:px-7"><div className="flex items-center gap-3"><button onClick={() => setMobileOpen(true)} className="rounded-lg p-2 text-gray-400 hover:bg-white/5 lg:hidden" aria-label="Open menu"><Menu className="h-5 w-5" /></button><div><p className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-500">Admin workspace</p><h1 className="font-heading text-lg font-black text-white">{currentTitle}</h1></div></div></header>
          <main className="mx-auto max-w-7xl p-4 md:p-7">{content[workspace]}</main>
        </div>
      </div>
      </div>
      <Footer />
      {mobileOpen && <div className="fixed inset-0 z-[60] bg-black/65 lg:hidden" onClick={() => setMobileOpen(false)}><aside className="h-full w-72 bg-[#10131b]" onClick={(event) => event.stopPropagation()}><div className="flex h-16 items-center justify-between border-b border-white/[0.07] px-4"><span className="font-heading font-black text-white">CONTROL ROOM</span><button onClick={() => setMobileOpen(false)} className="p-2 text-gray-400"><X className="h-5 w-5" /></button></div><Sidebar mobile /></aside></div>}
      {renderActionDrawer()}
    </div>
  );
};

export default AdminWorkspacePrototype;
