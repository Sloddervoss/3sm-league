import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isActiveRaceRegistration, isRaceRegistrationOpen } from "@/lib/raceRegistration";

const STALE_TIME = 5 * 60 * 1000;
const COMPLETED_RACE_LOOKBACK = 12;

export type JoinLeagueSummary = {
  id: string;
  name: string;
  carClass: string | null;
  season: string | null;
};

export type JoinRaceSummary = {
  id: string;
  name: string;
  track: string;
  trackId: number | null;
  raceDate: string;
  status: string;
  raceType: string | null;
  raceDuration: string | null;
  league: JoinLeagueSummary | null;
};

export type JoinPodiumEntry = {
  position: number;
  name: string;
};

type RaceRow = {
  id: string;
  name: string;
  track: string;
  iracing_track_id: number | null;
  race_date: string;
  status: string;
  race_type: string | null;
  race_duration: string | null;
  league_id: string | null;
  leagues: {
    id: string;
    name: string;
    car_class: string | null;
    season: string | null;
  } | null;
};

type ResultRow = {
  race_id: string;
  user_id: string;
  position: number | null;
  dnf: boolean | null;
};

type PublicProfileRow = {
  user_id: string | null;
  display_name: string | null;
  iracing_name: string | null;
};

const raceSelect = "id,name,track,iracing_track_id,race_date,status,race_type,race_duration,league_id,leagues(id,name,car_class,season)";

export const toJoinRaceSummary = (race: RaceRow): JoinRaceSummary => ({
  id: race.id,
  name: race.name.trim(),
  track: race.track.trim(),
  trackId: race.iracing_track_id,
  raceDate: race.race_date,
  status: race.status,
  raceType: race.race_type,
  raceDuration: race.race_duration,
  league: race.leagues
    ? {
        id: race.leagues.id,
        name: race.leagues.name.trim(),
        carClass: race.leagues.car_class?.trim() || null,
        season: race.leagues.season?.trim() || null,
      }
    : null,
});

export const shouldShowRegistrationCount = (count: number | null | undefined): count is number =>
  typeof count === "number" && count >= 10;

export const uniqueRegistrationCount = (
  raceRegistrations: Array<{ user_id: string; status: string | null }>,
  seasonRegistrations: Array<{ user_id: string }>,
): number => {
  const userIds = new Set<string>();
  raceRegistrations.forEach((registration) => {
    if (isActiveRaceRegistration(registration.status)) userIds.add(registration.user_id);
  });
  seasonRegistrations.forEach((registration) => userIds.add(registration.user_id));
  return userIds.size;
};

const useNextRace = () => useQuery({
  queryKey: ["join-page", "next-race"],
  staleTime: STALE_TIME,
  queryFn: async (): Promise<JoinRaceSummary | null> => {
    const { data, error } = await supabase
      .from("races")
      .select(raceSelect)
      .eq("status", "upcoming")
      .order("race_date", { ascending: true })
      .limit(20);
    if (error) throw error;

    const now = new Date();
    const next = ((data || []) as unknown as RaceRow[]).find((race) => isRaceRegistrationOpen({
      race_date: race.race_date,
      status: race.status,
    }, now));
    return next ? toJoinRaceSummary(next) : null;
  },
});

const useLatestRace = () => useQuery({
  queryKey: ["join-page", "latest-result"],
  staleTime: STALE_TIME,
  queryFn: async (): Promise<{ race: JoinRaceSummary | null; podium: JoinPodiumEntry[] }> => {
    const { data: raceData, error: raceError } = await supabase
      .from("races")
      .select(raceSelect)
      .eq("status", "completed")
      .order("race_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(COMPLETED_RACE_LOOKBACK);
    if (raceError) throw raceError;

    const races = (raceData || []) as unknown as RaceRow[];
    if (!races.length) return { race: null, podium: [] };

    const raceIds = races.map((race) => race.id);
    const { data: resultData, error: resultError } = await supabase
      .from("race_results")
      .select("race_id,user_id,position,dnf")
      .in("race_id", raceIds)
      .not("position", "is", null)
      .order("position", { ascending: true });
    if (resultError) throw resultError;

    const results = (resultData || []) as ResultRow[];
    const raceWithResults = races.find((race) => results.some((result) => result.race_id === race.id)) || races[0];
    const raceResults = results
      .filter((result) => result.race_id === raceWithResults.id && !result.dnf && result.position !== null)
      .sort((a, b) => (a.position ?? 999) - (b.position ?? 999));
    const podiumResults = raceResults.filter((result) => (result.position ?? 999) <= 3);

    if (!podiumResults.length) return { race: toJoinRaceSummary(raceWithResults), podium: [] };

    const userIds = [...new Set(podiumResults.map((result) => result.user_id))];
    const { data: profileData, error: profileError } = await supabase
      .from("public_profiles")
      .select("user_id,display_name,iracing_name")
      .in("user_id", userIds);
    if (profileError) throw profileError;

    const nameByUser = new Map(
      ((profileData || []) as PublicProfileRow[])
        .filter((profile): profile is PublicProfileRow & { user_id: string } => Boolean(profile.user_id))
        .map((profile) => [profile.user_id, profile.iracing_name?.trim() || profile.display_name?.trim() || "Onbekend"]),
    );

    return {
      race: toJoinRaceSummary(raceWithResults),
      podium: podiumResults.map((result) => ({
        position: result.position as number,
        name: nameByUser.get(result.user_id) || "Onbekend",
      })),
    };
  },
});

const useActivityFacts = () => useQuery({
  queryKey: ["join-page", "activity-facts"],
  staleTime: STALE_TIME,
  queryFn: async (): Promise<{ completedRaceCount: number; uniqueCircuitCount: number }> => {
    const { data, error } = await supabase
      .from("races")
      .select("id,track")
      .eq("status", "completed");
    if (error) throw error;

    const rows = (data || []) as Array<{ id: string; track: string }>;
    const tracks = new Set(
      rows
        .map((race) => race.track.split(" - ")[0]?.trim())
        .filter((track): track is string => Boolean(track)),
    );
    return { completedRaceCount: rows.length, uniqueCircuitCount: tracks.size };
  },
});

const useRegistrationCount = (race: JoinRaceSummary | null | undefined) => useQuery({
  queryKey: ["join-page", "registration-count", race?.id, race?.league?.id],
  enabled: Boolean(race?.id),
  staleTime: STALE_TIME,
  queryFn: async (): Promise<number | null> => {
    if (!race) return null;

    const racePromise = supabase
      .from("race_registrations")
      .select("user_id,status")
      .eq("race_id", race.id);
    const seasonPromise = race.league?.id
      ? supabase.from("season_registrations").select("user_id").eq("league_id", race.league.id)
      : Promise.resolve({ data: [], error: null });

    const [raceResponse, seasonResponse] = await Promise.all([racePromise, seasonPromise]);
    if (raceResponse.error) throw raceResponse.error;
    if (seasonResponse.error) throw seasonResponse.error;

    return uniqueRegistrationCount(
      (raceResponse.data || []) as Array<{ user_id: string; status: string | null }>,
      (seasonResponse.data || []) as Array<{ user_id: string }>,
    );
  },
});

export const useJoinPageData = () => {
  const nextRace = useNextRace();
  const latestRace = useLatestRace();
  const activityFacts = useActivityFacts();
  const registrationCount = useRegistrationCount(nextRace.data);

  return {
    nextRace: nextRace.data ?? null,
    latestRace: latestRace.data?.race ?? null,
    podium: latestRace.data?.podium ?? [],
    completedRaceCount: activityFacts.data?.completedRaceCount ?? null,
    uniqueCircuitCount: activityFacts.data?.uniqueCircuitCount ?? null,
    registrationCount: registrationCount.data ?? null,
    loading: {
      nextRace: nextRace.isLoading,
      latestRace: latestRace.isLoading,
      activityFacts: activityFacts.isLoading,
      registrationCount: registrationCount.isLoading,
    },
    failed: {
      nextRace: nextRace.isError,
      latestRace: latestRace.isError,
      activityFacts: activityFacts.isError,
      registrationCount: registrationCount.isError,
    },
  };
};
