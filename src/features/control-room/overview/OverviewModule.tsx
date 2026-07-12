import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bell, CheckCircle2, ClipboardList, Loader2, TriangleAlert, Users } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { OverviewModuleProps } from "./types";

type Race = Pick<Database["public"]["Tables"]["races"]["Row"], "id" | "league_id" | "name" | "track" | "race_date" | "round" | "status">;
type Registration = Pick<Database["public"]["Tables"]["race_registrations"]["Row"], "race_id" | "status">;
type SeasonRegistration = Pick<Database["public"]["Tables"]["season_registrations"]["Row"], "league_id" | "status" | "car_locked">;
type TeamRequest = Pick<Database["public"]["Tables"]["team_creation_requests"]["Row"], "id">;
type Announcement = Pick<Database["public"]["Tables"]["announcements"]["Row"], "id">;

const formatRaceDate = (value: string) => new Intl.DateTimeFormat("nl-NL", {
  weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam",
}).format(new Date(value));

const isRegistered = (status: string) => status === "registered";

export function OverviewModule({ onNavigate }: OverviewModuleProps) {
  const { user, isAdmin, isSuperAdmin } = useAuth();
  const canRead = Boolean(user && (isAdmin || isSuperAdmin));

  const teamRequestsQuery = useQuery({
    queryKey: ["control-room", "overview", "pending-team-requests"],
    enabled: canRead,
    queryFn: async (): Promise<TeamRequest[]> => {
      const { data, error } = await supabase.from("team_creation_requests").select("id").eq("status", "pending").order("created_at", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });
  const announcementsQuery = useQuery({
    queryKey: ["control-room", "overview", "unsent-announcements"],
    enabled: canRead,
    queryFn: async (): Promise<Announcement[]> => {
      const { data, error } = await supabase.from("announcements").select("id").eq("sent", false).order("created_at", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });
  const racesQuery = useQuery({
    queryKey: ["control-room", "overview", "upcoming-races"],
    enabled: canRead,
    queryFn: async (): Promise<Race[]> => {
      const { data, error } = await supabase.from("races").select("id,league_id,name,track,race_date,round,status").neq("status", "completed").gte("race_date", new Date().toISOString()).order("race_date", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });
  const raceRegistrationsQuery = useQuery({
    queryKey: ["control-room", "overview", "race-registrations"],
    enabled: canRead,
    queryFn: async (): Promise<Registration[]> => {
      const { data, error } = await supabase.from("race_registrations").select("race_id,status");
      if (error) throw error;
      return data || [];
    },
  });
  const seasonRegistrationsQuery = useQuery({
    queryKey: ["control-room", "overview", "season-registrations"],
    enabled: canRead,
    queryFn: async (): Promise<SeasonRegistration[]> => {
      const { data, error } = await supabase.from("season_registrations").select("league_id,status,car_locked");
      if (error) throw error;
      return data || [];
    },
  });

  const isLoading = [teamRequestsQuery, announcementsQuery, racesQuery, raceRegistrationsQuery, seasonRegistrationsQuery].some((query) => query.isLoading);
  const failedQuery = [teamRequestsQuery, announcementsQuery, racesQuery, raceRegistrationsQuery, seasonRegistrationsQuery].find((query) => query.isError);
  const teamRequests = teamRequestsQuery.data || [];
  const unsentAnnouncements = announcementsQuery.data || [];
  const nextRace = racesQuery.data?.[0];
  const raceRegistrations = useMemo(() => (raceRegistrationsQuery.data || []).filter((registration) => registration.race_id === nextRace?.id && isRegistered(registration.status)), [nextRace?.id, raceRegistrationsQuery.data]);
  const seasonRegistrations = useMemo(() => (seasonRegistrationsQuery.data || []).filter((registration) => registration.league_id === nextRace?.league_id && isRegistered(registration.status)), [nextRace?.league_id, seasonRegistrationsQuery.data]);
  const seasonLockedCars = seasonRegistrations.filter((registration) => registration.car_locked).length;
  const hasFacts = Boolean(teamRequests.length || unsentAnnouncements.length || nextRace);

  if (!canRead) return <section aria-label="Control Room overzicht" className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5 text-sm text-gray-400">Meld je aan met een adminaccount om het overzicht te laden.</section>;

  return <section aria-label="Control Room overzicht" className="space-y-6 text-gray-100">
    <header className="flex flex-col gap-2 border-b border-white/[0.08] pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="text-[11px] font-black uppercase tracking-[0.16em] text-orange-300">Control Room</p><h2 className="mt-1 font-heading text-2xl font-black">OVERZICHT</h2><p className="mt-1 text-sm text-gray-400">Live feiten uit teamverzoeken, botwachtrij en registraties.</p></div>
    </header>

    {isLoading && <div className="flex items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.025] p-5 text-sm text-gray-400"><Loader2 className="h-4 w-4 animate-spin" />Overzicht laden…</div>}
    {failedQuery && <div role="alert" className="flex gap-3 rounded-xl border border-red-400/25 bg-red-400/[0.07] p-5 text-sm text-red-100"><TriangleAlert className="h-5 w-5 shrink-0 text-red-300" /><div><p className="font-bold">Overzicht kon niet volledig worden geladen.</p><p className="mt-1 text-red-100/75">Controleer je adminrechten of vernieuw de pagina.</p></div></div>}

    {!isLoading && !failedQuery && !hasFacts && <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.05] p-6 text-center"><CheckCircle2 className="mx-auto h-7 w-7 text-emerald-300" /><h3 className="mt-3 font-heading text-lg font-black text-white">Geen openstaande aandachtspunten</h3><p className="mt-1 text-sm text-gray-400">Er zijn geen toekomstige open races, wachtende team-aanvragen of niet-verzonden aankondigingen.</p></div>}

    {!isLoading && !failedQuery && hasFacts && <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-2">
        <OverviewFact icon={Users} title="Team-aanvragen" value={teamRequests.length} description="in afwachting van beoordeling" onClick={teamRequests.length ? () => onNavigate?.({ destination: "community", focus: { kind: "pending-team-requests", requestId: teamRequests[0]?.id } }) : undefined} />
        <OverviewFact icon={Bell} title="Botwachtrij" value={unsentAnnouncements.length} description="niet-verzonden aankondigingen" onClick={unsentAnnouncements.length ? () => onNavigate?.({ destination: "communications", focus: { kind: "unsent-announcements", announcementId: unsentAnnouncements[0]?.id } }) : undefined} />
      </div>

      {nextRace && <article className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between"><div><p className="text-[11px] font-black uppercase tracking-[0.16em] text-orange-300">Eerstvolgende open race</p><h3 className="mt-1 font-heading text-xl font-black text-white">{nextRace.name}</h3><p className="mt-1 text-sm text-gray-400">{nextRace.track} · {formatRaceDate(nextRace.race_date)}{nextRace.round != null ? ` · ronde ${nextRace.round}` : ""}</p></div><button type="button" disabled={!onNavigate} onClick={() => onNavigate?.({ destination: "season", focus: { kind: "race", raceId: nextRace.id, leagueId: nextRace.league_id } })} className="inline-flex items-center justify-center rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-gray-200 hover:border-orange-400/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50">Open race</button></div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <RaceFact label="Race-inschrijvingen" value={raceRegistrations.length} onClick={() => onNavigate?.({ destination: "season", focus: { kind: "registrations", raceId: nextRace.id, leagueId: nextRace.league_id } })} enabled={Boolean(onNavigate)} />
          <RaceFact label="Seizoeninschrijvingen" value={seasonRegistrations.length} onClick={() => onNavigate?.({ destination: "season", focus: { kind: "registrations", raceId: nextRace.id, leagueId: nextRace.league_id } })} enabled={Boolean(onNavigate)} />
          <RaceFact label="Gelockte seizoenauto's" value={seasonLockedCars} detail="Alleen seizoeninschrijvingen bepalen deze lock." onClick={() => onNavigate?.({ destination: "season", focus: { kind: "car-locks", raceId: nextRace.id, leagueId: nextRace.league_id } })} enabled={Boolean(onNavigate)} />
        </div>
      </article>}
    </div>}
  </section>;
}

function OverviewFact({ icon: Icon, title, value, description, onClick }: { icon: typeof Users; title: string; value: number; description: string; onClick?: () => void }) {
  const content = <><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-400/10 text-orange-300"><Icon className="h-5 w-5" /></span><span><span className="block text-xs font-black uppercase tracking-[0.13em] text-gray-400">{title}</span><span className="mt-1 block font-heading text-2xl font-black text-white">{value}</span><span className="mt-1 block text-xs text-gray-500">{description}</span></span></>;
  if (!onClick) return <div className="flex items-start gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] p-4">{content}</div>;
  return <button type="button" onClick={onClick} className="flex w-full items-start gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] p-4 text-left transition hover:border-orange-400/30 hover:bg-orange-400/[0.04]">{content}</button>;
}

function RaceFact({ label, value, detail, onClick, enabled }: { label: string; value: number; detail?: string; onClick: () => void; enabled: boolean }) {
  return <button type="button" disabled={!enabled} onClick={onClick} className="rounded-xl border border-white/[0.07] bg-black/15 p-4 text-left transition hover:border-orange-400/30 disabled:cursor-not-allowed disabled:hover:border-white/[0.07]"><span className="flex items-center gap-2 text-xs font-bold text-gray-400"><ClipboardList className="h-3.5 w-3.5 text-orange-300" />{label}</span><span className="mt-2 block font-heading text-2xl font-black text-white">{value}</span>{detail && <span className="mt-1 block text-xs text-gray-500">{detail}</span>}</button>;
}
