import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarDays,
  CircleAlert,
  Flag,
  KeyRound,
  Plus,
  Trophy,
  Users,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export type SeasonWorkspaceTab = "overview" | "calendar" | "registrations" | "lobby" | "solo";
export type SeasonWorkspaceActionId =
  | "season-create"
  | "season-edit"
  | "race-create"
  | "race-edit"
  | "race-delete"
  | "registration-manage"
  | "car-lock"
  | "lobby-edit"
  | "solo-race-create"
  | "solo-race-edit"
  | "solo-race-delete";

type SeasonRow = {
  id: string;
  name: string;
  description: string | null;
  season: string | null;
  car_class: string | null;
  status: string;
};

type RaceRow = {
  id: string;
  league_id: string | null;
  name: string;
  track: string;
  race_date: string;
  round: number | null;
  status: string;
  car: string | null;
  race_type: string | null;
  race_duration: string | null;
  practice_duration: string | null;
  qualifying_duration: string | null;
  start_type: string | null;
  weather: string | null;
  setup: string | null;
  lobby_name: string | null;
  lobby_password: string | null;
  lobby_reveal_minutes: number;
};

type RegistrationRow = {
  id: string;
  league_id?: string;
  race_id?: string;
  user_id: string;
  status: string;
  car_choice: string | null;
  car_locked: boolean;
  created_at: string;
};

type CombinedRegistration = {
  id: string;
  user_id: string;
  status: string;
  source: "Heel seizoen" | "Losse races";
  car_choice: string | null;
  car_locked: boolean;
};

type ProfileRow = {
  user_id: string;
  display_name: string | null;
  iracing_name: string | null;
  iracing_id: string | null;
};

export type SeasonWorkspaceAction = {
  id: SeasonWorkspaceActionId;
  impact: "write" | "destructive";
  /** Independent authorization set; do not treat this as a role hierarchy. */
  allowedRoles: Array<"admin" | "super_admin">;
  /** The live Control Room panel/confirmation expected to receive this action. */
  panel: "season-form" | "race-form" | "race-delete-confirm" | "registration-manager" | "car-lock-confirm" | "lobby-manager" | "solo-race-form" | "solo-race-delete-confirm";
  /** Exact route context required by the eventual live form/confirmation. */
  context: {
    seasonId?: string;
    raceId?: string;
    registrationId?: string;
    registrationScope?: "season" | "race";
    userId?: string;
    tab: SeasonWorkspaceTab;
    /** Fields surfaced by the native read model and expected by the live editor. */
    fields?: Record<string, string | number | boolean | null>;
  };
};

export type SeasonRaceWorkspaceProps = {
  /** Optional integration seam. This module never writes directly to Supabase. */
  onAction?: (action: SeasonWorkspaceAction) => void;
  initialTab?: SeasonWorkspaceTab;
  /** Exact season selected by an upstream Control Room action. */
  initialSeasonId?: string;
};

type SeasonWorkspaceActionDraft = Omit<SeasonWorkspaceAction, "allowedRoles" | "panel">;
type SeasonWorkspacePanel = SeasonWorkspaceAction["panel"];

const tabs: Array<{ id: SeasonWorkspaceTab; label: string; icon: typeof Trophy }> = [
  { id: "overview", label: "Overzicht", icon: Trophy },
  { id: "calendar", label: "Kalender", icon: CalendarDays },
  { id: "registrations", label: "Inschrijvingen", icon: Users },
  { id: "lobby", label: "Seizoen", icon: Trophy },
  { id: "solo", label: "Losse races", icon: Flag },
];

const actionPanel: Record<SeasonWorkspaceActionId, SeasonWorkspacePanel> = {
  "season-create": "season-form", "season-edit": "season-form",
  "race-create": "race-form", "race-edit": "race-form", "race-delete": "race-delete-confirm",
  "registration-manage": "registration-manager", "car-lock": "car-lock-confirm", "lobby-edit": "lobby-manager",
  "solo-race-create": "solo-race-form", "solo-race-edit": "solo-race-form", "solo-race-delete": "solo-race-delete-confirm",
};

const fieldContext = (race: RaceRow) => ({
  name: race.name,
  track: race.track,
  race_date: race.race_date,
  round: race.round,
  status: race.status,
  car: race.car,
  race_type: race.race_type,
  race_duration: race.race_duration,
  practice_duration: race.practice_duration,
  qualifying_duration: race.qualifying_duration,
  start_type: race.start_type,
  weather: race.weather,
  setup: race.setup,
  lobby_name: race.lobby_name,
  lobby_password: race.lobby_password,
  lobby_reveal_minutes: race.lobby_reveal_minutes,
});

const displayDate = (value: string) => new Intl.DateTimeFormat("nl-NL", {
  day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam",
}).format(new Date(value));

const driverName = (profile: ProfileRow | undefined, userId: string) =>
  profile?.display_name || profile?.iracing_name || `Coureur ${userId.slice(0, 8)}`;

export const SeasonRaceWorkspace = ({ onAction, initialTab = "overview", initialSeasonId }: SeasonRaceWorkspaceProps = {}) => {
  const { user, isAdmin, isSuperAdmin } = useAuth();
  const [activeTab, setActiveTab] = useState<SeasonWorkspaceTab>(initialTab);
  const [seasonId, setSeasonId] = useState<string | null>(initialSeasonId || null);
  const canRead = Boolean(user && (isAdmin || isSuperAdmin));

  const { data: seasons = [], isLoading: seasonsLoading, error: seasonsError } = useQuery({
    queryKey: ["control-room", "season", "leagues"],
    enabled: canRead,
    queryFn: async (): Promise<SeasonRow[]> => {
      const { data, error } = await supabase.from("leagues")
        .select("id,name,description,season,car_class,status")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as SeasonRow[];
    },
  });
  const { data: races = [], isLoading: racesLoading, error: racesError } = useQuery({
    queryKey: ["control-room", "season", "races"],
    enabled: canRead,
    queryFn: async (): Promise<RaceRow[]> => {
      const { data, error } = await supabase.from("races")
        .select("id,league_id,name,track,race_date,round,status,car,race_type,race_duration,practice_duration,qualifying_duration,start_type,weather,setup,lobby_name,lobby_password,lobby_reveal_minutes")
        .order("race_date", { ascending: true });
      if (error) throw error;
      return (data || []) as RaceRow[];
    },
  });
  const { data: seasonRegistrations = [], isLoading: seasonRegsLoading } = useQuery({
    queryKey: ["control-room", "season", "season-registrations"],
    enabled: canRead,
    queryFn: async (): Promise<RegistrationRow[]> => {
      const { data, error } = await supabase.from("season_registrations")
        .select("id,league_id,user_id,status,car_choice,car_locked,created_at");
      if (error) throw error;
      return (data || []) as RegistrationRow[];
    },
  });
  const { data: raceRegistrations = [], isLoading: raceRegsLoading } = useQuery({
    queryKey: ["control-room", "season", "race-registrations"],
    enabled: canRead,
    queryFn: async (): Promise<RegistrationRow[]> => {
      const { data, error } = await supabase.from("race_registrations")
        .select("id,race_id,user_id,status,car_choice,car_locked,created_at");
      if (error) throw error;
      return (data || []) as RegistrationRow[];
    },
  });
  const { data: profiles = [] } = useQuery({
    queryKey: ["control-room", "season", "profiles"],
    enabled: canRead,
    queryFn: async (): Promise<ProfileRow[]> => {
      const { data, error } = await supabase.from("profiles")
        .select("user_id,display_name,iracing_name,iracing_id");
      if (error) throw error;
      return (data || []) as ProfileRow[];
    },
  });

  useEffect(() => {
    if (initialSeasonId) setSeasonId(initialSeasonId);
  }, [initialSeasonId]);
  useEffect(() => {
    if (!seasonId && seasons[0]) setSeasonId(seasons[0].id);
  }, [seasonId, seasons]);

  const selectedSeason = seasons.find((season) => season.id === seasonId) ?? null;
  const sortActiveFirst = (rows: RaceRow[]) => [...rows].sort((left, right) => {
    const completedDifference = Number(left.status === "completed") - Number(right.status === "completed");
    if (completedDifference) return completedDifference;
    return new Date(left.race_date).getTime() - new Date(right.race_date).getTime();
  });
  const seasonRaces = useMemo(() => sortActiveFirst(races.filter((race) => race.league_id === seasonId)), [races, seasonId]);
  const soloRaces = useMemo(() => sortActiveFirst(races.filter((race) => !race.league_id)), [races]);
  const profileByUser = useMemo(() => new Map(profiles.map((profile) => [profile.user_id, profile])), [profiles]);
  const combinedRegistrations = useMemo((): CombinedRegistration[] => {
    if (!seasonId) return [];
    const fullSeason = seasonRegistrations.filter((registration) => registration.league_id === seasonId);
    const fullSeasonUserIds = new Set(fullSeason.map((registration) => registration.user_id));
    const seasonRaceIds = new Set(races.filter((race) => race.league_id === seasonId).map((race) => race.id));
    const perRaceByUser = new Map<string, RegistrationRow[]>();
    raceRegistrations.forEach((registration) => {
      if (!registration.race_id || !seasonRaceIds.has(registration.race_id) || fullSeasonUserIds.has(registration.user_id)) return;
      perRaceByUser.set(registration.user_id, [...(perRaceByUser.get(registration.user_id) || []), registration]);
    });
    const perRaceOnly = [...perRaceByUser.entries()].map(([user_id, registrations]) => {
      const ordered = [...registrations].sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime());
      const locked = ordered.find((registration) => registration.car_locked);
      const current = locked || ordered.find((registration) => registration.car_choice) || ordered[ordered.length - 1];
      return { id: `race:${user_id}`, user_id, status: current.status, source: "Losse races" as const, car_choice: current.car_choice, car_locked: Boolean(locked) };
    });
    return [
      ...fullSeason.map((registration) => ({ ...registration, source: "Heel seizoen" as const })),
      ...perRaceOnly,
    ].sort((left, right) => driverName(profileByUser.get(left.user_id), left.user_id).localeCompare(driverName(profileByUser.get(right.user_id), right.user_id), "nl"));
  }, [profileByUser, raceRegistrations, races, seasonId, seasonRegistrations]);
  const loading = seasonsLoading || racesLoading || seasonRegsLoading || raceRegsLoading;
  const dataError = seasonsError || racesError;

  const emit = (action: SeasonWorkspaceActionDraft) => onAction?.({
    ...action,
    allowedRoles: ["admin", "super_admin"],
    panel: actionPanel[action.id],
  });
  const actionButton = (label: string, action: SeasonWorkspaceActionDraft, className = "") => (
    <button type="button" onClick={() => emit(action)} disabled={!onAction || (action.id === "race-create" && !action.context.seasonId)}
      title={!onAction ? "Live action integration is not connected yet" : action.id === "race-create" && !action.context.seasonId ? "Selecteer eerst een seizoen" : label}
      className={`rounded-md border border-white/[0.10] px-3 py-1.5 text-xs font-bold text-gray-200 transition hover:border-orange-400/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-45 ${className}`}>
      {label}
    </button>
  );

  if (!canRead) {
    return <section className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-6 text-sm text-gray-400"><CircleAlert className="mb-2 h-5 w-5 text-orange-300" />Meld je aan met een adminrol om seizoenen en races te beheren.</section>;
  }

  return (
    <section aria-label="Seizoen en racebeheer" className="space-y-5 text-gray-100">
      <header className="flex flex-col gap-4 border-b border-white/[0.08] pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div><p className="text-xs font-black uppercase tracking-[0.18em] text-orange-300">Control Room</p><h2 className="mt-1 font-heading text-2xl font-black">SEIZOEN & RACES</h2><p className="mt-1 text-sm text-gray-400">Native read workspace. Live actions are passed through typed callbacks.</p></div>
        <div className="flex flex-wrap gap-2">
          {actionButton("Nieuw seizoen", { id: "season-create", impact: "write", context: { tab: activeTab } }, "border-orange-400/40 bg-orange-500/15 text-orange-100")}
          {activeTab === "solo"
            ? actionButton("Nieuwe losse race", { id: "solo-race-create", impact: "write", context: { tab: "solo" } })
            : actionButton("Nieuwe race", { id: "race-create", impact: "write", context: { seasonId: seasonId || undefined, tab: activeTab } })}
        </div>
      </header>

      <div className="flex gap-1 overflow-x-auto border-b border-white/[0.08] pb-1" role="tablist" aria-label="Seizoenwerkruimte tabs">
        {tabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" role="tab" aria-selected={activeTab === id} onClick={() => setActiveTab(id)} className={`flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold ${activeTab === id ? "bg-orange-500/15 text-white" : "text-gray-400 hover:bg-white/[0.04] hover:text-white"}`}><Icon className="h-4 w-4" />{label}</button>)}
      </div>

      {dataError && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">Kon seizoendata niet laden: {dataError.message}</div>}
      {loading && <div className="rounded-lg border border-white/[0.08] bg-white/[0.025] p-6 text-sm text-gray-400">Seizoendata laden…</div>}
      {!loading && !dataError && <>
        {activeTab !== "solo" && <label className="block max-w-md text-xs font-bold uppercase tracking-wider text-gray-500">Seizoen<select value={seasonId || ""} onChange={(event) => setSeasonId(event.target.value || null)} className="mt-1.5 block w-full rounded-md border border-white/[0.1] bg-[#151820] px-3 py-2 text-sm font-semibold text-white outline-none focus:border-orange-400"><option value="">Kies een seizoen</option>{seasons.map((season) => <option key={season.id} value={season.id}>{season.name}{season.season ? ` · ${season.season}` : ""}</option>)}</select></label>}
        {activeTab === "overview" && <Overview season={selectedSeason} races={seasonRaces} registrants={combinedRegistrations} actionButton={actionButton} />}
        {activeTab === "calendar" && <RaceList races={seasonRaces} tab="calendar" actionButton={actionButton} seasonRegistrations={seasonRegistrations} raceRegistrations={raceRegistrations} profileByUser={profileByUser} />}
        {activeTab === "registrations" && <Registrations seasonId={seasonId} registrations={combinedRegistrations} profileByUser={profileByUser} actionButton={actionButton} />}
        {activeTab === "lobby" && <LobbyList races={seasonRaces} tab="lobby" actionButton={actionButton} />}
        {activeTab === "solo" && <RaceList races={soloRaces} tab="solo" actionButton={actionButton} seasonRegistrations={seasonRegistrations} raceRegistrations={raceRegistrations} profileByUser={profileByUser} />}
      </>}
    </section>
  );
};

type ActionButton = (label: string, action: SeasonWorkspaceActionDraft, className?: string) => JSX.Element;

const Overview = ({ season, races, registrants, actionButton }: { season: SeasonRow | null; races: RaceRow[]; registrants: CombinedRegistration[]; actionButton: ActionButton }) => {
  if (!season) return <EmptyState icon={Trophy} text="Nog geen seizoen geselecteerd of beschikbaar." />;
  const nextRace = races.find((race) => new Date(race.race_date).getTime() >= Date.now()) || races[0];
  return <div className="grid gap-4 lg:grid-cols-3"><article className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-5 lg:col-span-2"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-widest text-orange-300">{season.status}</p><h3 className="mt-1 font-heading text-xl font-black">{season.name}</h3><p className="mt-1 text-sm text-gray-400">{season.season || "Seizoen niet benoemd"}{season.car_class ? ` · ${season.car_class}` : ""}</p></div>{actionButton("Seizoen bewerken", { id: "season-edit", impact: "write", context: { seasonId: season.id, tab: "overview" } })}</div>{season.description && <p className="mt-4 max-w-2xl text-sm leading-6 text-gray-300">{season.description}</p>}<div className="mt-5 grid grid-cols-3 gap-3"><Metric label="Races" value={String(races.length)} /><Metric label="Ingeschreven" value={String(registrants.length)} /><Metric label="Auto's locked" value={String(registrants.filter((row) => row.car_locked).length)} /></div></article><article className="rounded-xl border border-orange-400/20 bg-orange-500/[0.06] p-5"><p className="text-xs font-black uppercase tracking-widest text-orange-300">Volgende race</p>{nextRace ? <><h3 className="mt-2 font-heading font-black">{nextRace.name}</h3><p className="mt-1 text-sm text-gray-300">{nextRace.track}</p><p className="mt-2 text-xs text-gray-400">{displayDate(nextRace.race_date)}</p></> : <p className="mt-2 text-sm text-gray-400">Geen race in de kalender.</p>}</article></div>;
};

const RaceList = ({ races, tab, actionButton, seasonRegistrations, raceRegistrations, profileByUser }: { races: RaceRow[]; tab: "calendar" | "solo"; actionButton: ActionButton; seasonRegistrations: RegistrationRow[]; raceRegistrations: RegistrationRow[]; profileByUser: Map<string, ProfileRow> }) => {
  const attendees = (race: RaceRow) => {
    const userIds = new Set<string>();
    if (race.league_id) seasonRegistrations.filter((registration) => registration.league_id === race.league_id && registration.status !== "withdrawn").forEach((registration) => userIds.add(registration.user_id));
    raceRegistrations.filter((registration) => registration.race_id === race.id && registration.status !== "withdrawn").forEach((registration) => userIds.add(registration.user_id));
    return [...userIds].sort((left, right) => driverName(profileByUser.get(left), left).localeCompare(driverName(profileByUser.get(right), right), "nl"));
  };
  if (!races.length) return <EmptyState icon={CalendarDays} text={tab === "solo" ? "Geen losse races beschikbaar." : "Geen races in dit seizoen."} />;
  return <div className="space-y-3">{races.map((race) => {
    const registered = attendees(race);
    return <article key={race.id} className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-4"><div className="flex flex-col justify-between gap-4 md:flex-row"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="rounded bg-white/[0.07] px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-gray-300">{tab === "calendar" ? `R${String(race.round || 0).padStart(2, "0")}` : "Losse race"}</span><span className="text-xs font-bold text-orange-300">{race.status}</span></div><h3 className="mt-2 font-heading font-bold">{race.name}</h3><p className="mt-1 text-sm text-gray-300">{race.track} · {displayDate(race.race_date)}</p><p className="mt-2 text-xs text-gray-500">{[race.race_type, race.race_duration, race.practice_duration && `P ${race.practice_duration}`, race.qualifying_duration && `Q ${race.qualifying_duration}`, race.start_type, race.weather, race.setup].filter(Boolean).join(" · ") || "Sessiegegevens nog niet ingevuld"}</p><div className="mt-4 border-t border-white/[0.06] pt-3"><p className="text-[10px] font-black uppercase tracking-wider text-gray-500">Ingeschreven <span className="ml-1 text-orange-300">{registered.length}</span></p><p className="mt-1 text-sm leading-6 text-gray-300">{registered.length ? registered.map((userId) => driverName(profileByUser.get(userId), userId)).join(" · ") : "Nog niemand ingeschreven"}</p></div></div><div className="flex shrink-0 items-start gap-2">{actionButton("Bewerken", { id: tab === "solo" ? "solo-race-edit" : "race-edit", impact: "write", context: { seasonId: race.league_id || undefined, raceId: race.id, tab, fields: fieldContext(race) } })}{actionButton("Verwijderen", { id: tab === "solo" ? "solo-race-delete" : "race-delete", impact: "destructive", context: { seasonId: race.league_id || undefined, raceId: race.id, tab, fields: fieldContext(race) } }, "hover:border-red-400/50 hover:text-red-200")}</div></div></article>;
  })}</div>;
};

const Registrations = ({ seasonId, registrations, profileByUser, actionButton }: { seasonId: string | null; registrations: CombinedRegistration[]; profileByUser: Map<string, ProfileRow>; actionButton: ActionButton }) => {
  if (!seasonId) return <EmptyState icon={Users} text="Selecteer eerst een seizoen." />;
  return <article className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-4"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div><h3 className="flex items-center gap-2 font-heading font-black"><Users className="h-4 w-4 text-orange-300" />Deelnemers van dit seizoen <span className="text-sm text-gray-500">{registrations.length}</span></h3><p className="mt-2 max-w-2xl text-xs leading-relaxed text-gray-500">Eén rij per coureur: volledige seizoeninschrijvingen en losse-race deelnemers van dit geselecteerde seizoen. De eerste geïmporteerde race zet hun auto voor de resterende rondes vast.</p></div>{actionButton("Admin: uitzonderingen beheren", { id: "car-lock", impact: "write", context: { seasonId, tab: "registrations" } }, "border-amber-400/40 text-amber-100")}</div><div className="mt-4 overflow-x-auto"><div className="min-w-[680px]"><div className="grid grid-cols-[minmax(12rem,1fr)_9rem_minmax(12rem,1fr)_14rem] gap-3 border-b border-white/[0.08] px-1 pb-2 text-[10px] font-black uppercase tracking-wider text-gray-500"><span>Coureur</span><span>Bron</span><span>Huidige auto</span><span>Vergrendeling</span></div>{registrations.length ? registrations.map((row) => <div key={row.id} className="grid grid-cols-[minmax(12rem,1fr)_9rem_minmax(12rem,1fr)_14rem] gap-3 border-b border-white/[0.06] px-1 py-3 text-sm last:border-b-0"><div className="min-w-0"><p className="truncate font-bold">{driverName(profileByUser.get(row.user_id), row.user_id)}</p><p className="mt-0.5 text-xs text-gray-500">{row.status}</p></div><span className="text-gray-300">{row.source}</span><span className="font-semibold text-gray-200">{row.car_choice || "Nog geen auto gereden"}</span><span className={`font-bold ${row.car_locked ? "text-orange-300" : "text-gray-500"}`}>{row.car_locked ? "Vastgezet" : "Wordt vastgezet na eerste uitslag"}</span></div>) : <p className="py-4 text-sm text-gray-500">Nog geen deelnemers voor dit seizoen.</p>}</div></div></article>;
};

const LobbyList = ({ races, tab, actionButton }: { races: RaceRow[]; tab: "lobby"; actionButton: ActionButton }) => <div className="space-y-3">{races.length === 0 ? <EmptyState icon={KeyRound} text="Geen races met lobbygegevens." /> : races.map((race) => <article key={race.id} className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-4"><div className="flex flex-col justify-between gap-4 md:flex-row"><div><p className="text-xs font-black uppercase tracking-widest text-orange-300">R{String(race.round || 0).padStart(2, "0")} · {race.status}</p><h3 className="mt-1 font-heading font-bold">{race.name}</h3><p className="mt-1 text-sm text-gray-400">{race.track} · {displayDate(race.race_date)}</p><div className="mt-3 grid gap-2 text-sm sm:grid-cols-3"><Data label="Lobby" value={race.lobby_name || "Niet ingesteld"} /><Data label="Wachtwoord" value={race.lobby_password || "Niet ingesteld"} /><Data label="Vrijgave" value={`${race.lobby_reveal_minutes} min voor start`} /></div></div>{actionButton("Lobby bewerken", { id: "lobby-edit", impact: "write", context: { seasonId: race.league_id || undefined, raceId: race.id, tab, fields: { lobby_name: race.lobby_name, lobby_password: race.lobby_password, lobby_reveal_minutes: race.lobby_reveal_minutes, race_date: race.race_date } } })}</div></article>)}</div>;

const Metric = ({ label, value }: { label: string; value: string }) => <div className="rounded-lg bg-black/15 p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{label}</p><p className="mt-1 font-heading text-xl font-black text-white">{value}</p></div>;
const Data = ({ label, value }: { label: string; value: string }) => <div><p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{label}</p><p className="mt-0.5 break-all text-gray-200">{value}</p></div>;
const EmptyState = ({ icon: Icon, text }: { icon: typeof Trophy; text: string }) => <div className="rounded-xl border border-dashed border-white/[0.12] bg-white/[0.02] p-10 text-center"><Icon className="mx-auto h-6 w-6 text-gray-600" /><p className="mt-3 text-sm text-gray-500">{text}</p></div>;

export default SeasonRaceWorkspace;
