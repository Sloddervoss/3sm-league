import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Lock, Loader2, Unlock, Users } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

type SeasonRow = { id: string; name: string; season: string | null; status: string };
type SeasonRegistrationRow = {
  id: string;
  league_id: string;
  user_id: string;
  status: string;
  car_choice: string | null;
  car_locked: boolean;
};
type RaceRegistrationRow = Omit<SeasonRegistrationRow, "league_id"> & { race_id: string };
type RaceRow = { id: string; league_id: string | null };
type LockRegistration = SeasonRegistrationRow & { source: "Heel seizoen" | "Losse races" };
type ProfileRow = { user_id: string; display_name: string | null; iracing_name: string | null };

type PendingChange = { registration: LockRegistration; nextLocked: boolean; affectedRaceRegistrations: RaceRegistrationRow[] };

const matchingRaceRegistrationChanges = (registration: LockRegistration, rows: RaceRegistrationRow[], leagueRaceIds: Set<string>) =>
  rows.filter((row) => row.user_id === registration.user_id && leagueRaceIds.has(row.race_id) && row.car_locked === registration.car_locked);

export type SeasonCarLockManagerProps = {
  /** Opens the exact season that invoked the manager when supplied. */
  initialLeagueId?: string;
};

const driverName = (profile: ProfileRow | undefined, userId: string) =>
  profile?.display_name || profile?.iracing_name || `Coureur ${userId.slice(0, 8)}`;

const invalidateCarLockQueries = (queryClient: ReturnType<typeof useQueryClient>) => {
  [
    ["control-room", "season", "season-registrations"],
    ["control-room", "season", "race-registrations"],
    ["control-room", "season", "leagues"],
    ["admin-season-registrations"],
    ["workspace-prototype-season-registrations"],
    ["all-races-admin"],
  ].forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
};

/**
 * The only Control Room surface allowed to manage car-lock exceptions.
 * Full-season entries mutate their season registration; race-by-race entries mutate
 * only the selected league's existing race registrations after a visible impact preview.
 */
export function SeasonCarLockManager({ initialLeagueId }: SeasonCarLockManagerProps) {
  const { user, isAdmin, isSuperAdmin } = useAuth();
  const queryClient = useQueryClient();
  const canRead = Boolean(user && (isAdmin || isSuperAdmin));
  const [leagueId, setLeagueId] = useState(initialLeagueId || "");
  const [pendingChange, setPendingChange] = useState<PendingChange | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const seasonsQuery = useQuery({
    queryKey: ["control-room", "season", "leagues"],
    enabled: canRead,
    queryFn: async (): Promise<SeasonRow[]> => {
      const { data, error } = await supabase.from("leagues").select("id,name,season,status").order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as SeasonRow[];
    },
  });
  const registrationsQuery = useQuery({
    queryKey: ["control-room", "season", "season-registrations"],
    enabled: canRead,
    queryFn: async (): Promise<SeasonRegistrationRow[]> => {
      const { data, error } = await supabase.from("season_registrations").select("id,league_id,user_id,status,car_choice,car_locked");
      if (error) throw error;
      return (data || []) as SeasonRegistrationRow[];
    },
  });
  const raceRegistrationsQuery = useQuery({
    queryKey: ["control-room", "season", "race-registrations"],
    enabled: canRead,
    queryFn: async (): Promise<RaceRegistrationRow[]> => {
      const { data, error } = await supabase.from("race_registrations").select("id,race_id,user_id,status,car_choice,car_locked");
      if (error) throw error;
      return (data || []) as RaceRegistrationRow[];
    },
  });
  const racesQuery = useQuery({
    queryKey: ["control-room", "season", "races"],
    enabled: canRead,
    queryFn: async (): Promise<RaceRow[]> => {
      const { data, error } = await supabase.from("races").select("id,league_id");
      if (error) throw error;
      return (data || []) as RaceRow[];
    },
  });
  const profilesQuery = useQuery({
    queryKey: ["control-room", "season", "profiles"],
    enabled: canRead,
    queryFn: async (): Promise<ProfileRow[]> => {
      const { data, error } = await supabase.from("public_profiles").select("user_id,display_name,iracing_name");
      if (error) throw error;
      return (data || []) as ProfileRow[];
    },
  });

  useEffect(() => {
    if (initialLeagueId) setLeagueId(initialLeagueId);
  }, [initialLeagueId]);
  useEffect(() => {
    if (!leagueId && seasonsQuery.data?.[0]) setLeagueId(seasonsQuery.data[0].id);
  }, [leagueId, seasonsQuery.data]);

  const profileByUser = useMemo(() => new Map((profilesQuery.data || []).map((profile) => [profile.user_id, profile])), [profilesQuery.data]);
  const leagueRaceIds = useMemo(() => new Set((racesQuery.data || []).filter((race) => race.league_id === leagueId).map((race) => race.id)), [leagueId, racesQuery.data]);
  const registrations = useMemo((): LockRegistration[] => {
    const fullSeason = (registrationsQuery.data || []).filter((registration) => registration.league_id === leagueId);
    const fullSeasonUserIds = new Set(fullSeason.map((registration) => registration.user_id));
    const leagueRaceIds = new Set((racesQuery.data || []).filter((race) => race.league_id === leagueId).map((race) => race.id));
    const perRaceByUser = new Map<string, RaceRegistrationRow[]>();
    (raceRegistrationsQuery.data || []).forEach((registration) => {
      if (!leagueRaceIds.has(registration.race_id) || fullSeasonUserIds.has(registration.user_id)) return;
      perRaceByUser.set(registration.user_id, [...(perRaceByUser.get(registration.user_id) || []), registration]);
    });
    return [
      ...fullSeason.map((registration) => ({ ...registration, source: "Heel seizoen" as const })),
      ...[...perRaceByUser.entries()].map(([user_id, rows]) => {
        const locked = rows.find((row) => row.car_locked);
        const current = locked || rows.find((row) => row.car_choice) || rows[0];
        return { ...current, id: `race:${user_id}`, league_id: leagueId, source: "Losse races" as const, car_locked: Boolean(locked) };
      }),
    ];
  }, [leagueId, raceRegistrationsQuery.data, racesQuery.data, registrationsQuery.data]);

  const lockMutation = useMutation({
    mutationFn: async (change: PendingChange) => {
      const { registration, nextLocked } = change;
      if (nextLocked && !registration.car_choice?.trim()) throw new Error("Een auto zonder auto-keuze kan niet worden gelockt.");
      if (registration.source === "Heel seizoen") {
        const { error } = await supabase
          .from("season_registrations")
          .update({ car_locked: nextLocked })
          .eq("id", registration.id)
          .eq("car_locked", registration.car_locked);
        if (error) throw error;
        return;
      }
      const affected = change.affectedRaceRegistrations;
      if (!affected.length) throw new Error("Geen passende losse-race inschrijvingen gevonden voor deze uitzondering.");
      const { error } = await supabase
        .from("race_registrations")
        .update({ car_locked: nextLocked })
        .in("id", affected.map((row) => row.id))
        .eq("car_locked", registration.car_locked);
      if (error) throw error;
    },
    onSuccess: (_data, change) => {
      invalidateCarLockQueries(queryClient);
      setFeedback(`${driverName(profileByUser.get(change.registration.user_id), change.registration.user_id)} is ${change.nextLocked ? "gelockt voor dit seizoen" : "weer vrijgegeven voor dit seizoen"}.`);
      setPendingChange(null);
    },
  });

  if (!canRead) return <section className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-6 text-sm text-gray-400">Meld je aan met een adminrol om seizoenauto&apos;s te beheren.</section>;

  const error = seasonsQuery.error || registrationsQuery.error || raceRegistrationsQuery.error || racesQuery.error || profilesQuery.error;
  const loading = seasonsQuery.isLoading || registrationsQuery.isLoading || raceRegistrationsQuery.isLoading || racesQuery.isLoading || profilesQuery.isLoading;
  const selectedSeason = (seasonsQuery.data || []).find((season) => season.id === leagueId);

  return <section className="space-y-5" aria-label="Seizoenauto locks">
    <header className="rounded-2xl border border-orange-400/20 bg-orange-400/[0.06] p-5">
      <p className="text-[11px] font-black uppercase tracking-[0.16em] text-orange-300">Control Room · seizoenbeleid</p>
      <h2 className="mt-1 font-heading text-2xl font-black text-white">Admin-uitzonderingen: seizoenauto&apos;s</h2>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-gray-300">Alleen voor bewuste correcties: volledige seizoeninschrijvingen gebruiken hun seizoeninschrijving; losse-race deelnemers gebruiken alle race-inschrijvingen van dit seizoen. Een wijziging geldt uitsluitend binnen dit seizoen.</p>
    </header>

    {feedback && <p role="status" className="rounded-xl border border-emerald-400/25 bg-emerald-400/[0.08] px-4 py-3 text-sm text-emerald-100"><CheckCircle2 className="mr-2 inline h-4 w-4" />{feedback}</p>}
    {error && <p role="alert" className="rounded-xl border border-red-400/25 bg-red-400/[0.08] px-4 py-3 text-sm text-red-100">Seizoenauto&apos;s konden niet laden: {error.message}</p>}

    <section className="rounded-2xl border border-white/[0.08] bg-[#151821] p-5">
      <label className="block text-xs font-black uppercase tracking-wider text-gray-400">Seizoen
        <select value={leagueId} onChange={(event) => { setLeagueId(event.target.value); setFeedback(null); }} disabled={loading} className="mt-2 block w-full max-w-xl rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none focus:border-orange-400/50">
          <option value="">{loading ? "Seizoenen laden…" : "Selecteer seizoen…"}</option>
          {(seasonsQuery.data || []).map((season) => <option key={season.id} value={season.id}>{season.name}{season.season ? ` · ${season.season}` : ""}</option>)}
        </select>
      </label>
      {selectedSeason && <p className="mt-3 text-xs text-gray-500">{selectedSeason.status} · {registrations.filter((registration) => registration.car_locked).length}/{registrations.length} seizoenauto&apos;s gelockt</p>}
    </section>

    {!loading && !error && leagueId && <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#151821]">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_7rem] gap-3 bg-white/[0.025] px-5 py-3 text-[10px] font-black uppercase tracking-wider text-gray-500"><span>Coureur</span><span>Seizoenauto</span><span>Status</span></div>
      {registrations.map((registration) => <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_7rem] items-center gap-3 border-t border-white/[0.06] px-5 py-4 text-sm" key={registration.id}>
        <span className="min-w-0"><strong className="block truncate text-white">{driverName(profileByUser.get(registration.user_id), registration.user_id)}</strong><small className="text-xs text-gray-500">{registration.status}</small></span>
        <span className="truncate text-gray-300">{registration.car_choice || "Nog geen auto uit een race-import"}</span>
        <button type="button" disabled={lockMutation.isPending} onClick={() => {
          setFeedback(null);
          const affectedRaceRegistrations = registration.source === "Losse races"
            ? matchingRaceRegistrationChanges(registration, raceRegistrationsQuery.data || [], leagueRaceIds)
            : [];
          setPendingChange({ registration, nextLocked: !registration.car_locked, affectedRaceRegistrations });
        }} className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-45 ${registration.car_locked ? "border-orange-400/30 bg-orange-400/[0.08] text-orange-200" : "border-white/10 text-gray-300 hover:border-orange-400/40 hover:text-white"}`}>
          {registration.car_locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}{registration.car_locked ? "Unlock" : "Lock"}
        </button>
      </div>)}
      {!registrations.length && <p className="p-8 text-center text-sm text-gray-500"><Users className="mx-auto mb-2 h-5 w-5" />Geen seizoeninschrijvingen voor dit seizoen.</p>}
    </section>}

    {pendingChange && <div className="fixed inset-0 z-[100] flex items-end bg-black/70 p-4 sm:items-center sm:justify-center" role="dialog" aria-modal="true" aria-labelledby="season-car-lock-confirmation">
      <div className="w-full max-w-lg rounded-2xl border border-amber-400/30 bg-[#151821] p-6 shadow-2xl">
        <div className="flex gap-3"><AlertTriangle className="h-6 w-6 shrink-0 text-amber-300" /><div><p className="text-[11px] font-black uppercase tracking-[0.16em] text-amber-200">Bevestiging vereist</p><h3 id="season-car-lock-confirmation" className="mt-1 font-heading text-xl font-black text-white">{pendingChange.nextLocked ? "Seizoenauto vastzetten?" : "Seizoenauto vrijgeven?"}</h3><p className="mt-2 text-sm leading-relaxed text-gray-300">{driverName(profileByUser.get(pendingChange.registration.user_id), pendingChange.registration.user_id)} · <strong>{pendingChange.registration.car_choice || "geen auto"}</strong></p><p className="mt-2 text-sm text-gray-400">{pendingChange.nextLocked ? "Deze keuze blijft voor de rest van dit specifieke seizoen vaststaan, tenzij je hem hier bewust weer vrijgeeft." : pendingChange.registration.source === "Heel seizoen" ? "Dit maakt uitsluitend de seizoeninschrijving weer wijzigbaar." : "Dit geeft de losse-race inschrijvingen van dit seizoen weer vrij; toekomstige inschrijvingen erven dan geen lock totdat een uitslag opnieuw lockt."}</p></div></div>
        {pendingChange.registration.source === "Losse races" && <div className="rounded-lg border border-amber-400/20 bg-amber-400/[0.06] p-3 text-sm text-amber-100"><p className="font-bold">Impact op losse-race inschrijvingen: {pendingChange.affectedRaceRegistrations.length}</p><p className="mt-1 text-xs text-amber-100/75">Alleen deze bestaande inschrijvingen van het geselecteerde seizoen worden gewijzigd: {pendingChange.affectedRaceRegistrations.map((row) => row.race_id).join(", ") || "geen"}.</p></div>}
        {lockMutation.error && <p role="alert" className="mt-4 rounded-lg border border-red-400/25 bg-red-400/[0.08] p-3 text-sm text-red-100">Wijziging mislukt: {lockMutation.error.message}</p>}
        <div className="mt-6 flex justify-end gap-2"><button type="button" disabled={lockMutation.isPending} onClick={() => setPendingChange(null)} className="rounded-lg border border-white/10 px-4 py-2 text-sm font-bold text-gray-300">Annuleren</button><button type="button" disabled={lockMutation.isPending} onClick={() => lockMutation.mutate(pendingChange)} className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-black text-white disabled:opacity-50">{lockMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{pendingChange.nextLocked ? "Ja, lock seizoenauto" : "Ja, geef seizoenauto vrij"}</button></div>
      </div>
    </div>}
  </section>;
}

export default SeasonCarLockManager;
