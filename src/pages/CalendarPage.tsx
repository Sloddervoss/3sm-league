import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import NewHeroRace from "@/components/preview/NewHeroRace";
import NewRaceCard from "@/components/preview/NewRaceCard";
import NewStandingsTable from "@/components/preview/NewStandingsTable";
import SeasonBanner from "@/components/preview/SeasonBanner";
import PreviewModal from "@/components/preview/PreviewModal";
import RaceModal from "@/components/preview/RaceModal";
import DriverModal from "@/components/preview/DriverModal";
import { useRegistration } from "@/lib/useRegistration";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { Calendar, Trophy } from "lucide-react";
import { useNow, formatCountdown } from "@/lib/useCountdown";

const CalendarPage = () => {
  const now = useNow();
  const reg = useRegistration();
  const [selectedRace, setSelectedRace] = useState<any>(null);
  const [selectedDriver, setSelectedDriver] = useState<any>(null);

  const { data: races = [] } = useQuery({
    queryKey: ["races-with-leagues"],
    queryFn: async () => {
      const { data } = await supabase
        .from("races")
        .select("*, leagues(name, car_class, id, season)")
        .order("race_date", { ascending: true });
      return data || [];
    },
  });

  const { data: leagues = [] } = useQuery({
    queryKey: ["leagues-for-standings"],
    queryFn: async () => {
      const { data } = await supabase
        .from("leagues")
        .select("id, name, season, car_class")
        .order("created_at", { ascending: false });
      return data || [];
    },
  });

  const { data: teams = [] } = useQuery({
    queryKey: ["teams"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("teams").select("*").order("name");
      return data || [];
    },
  });

  const { data: standingsData = [] } = useQuery({
    queryKey: ["standings-preview", leagues?.[0]?.id],
    enabled: !!leagues?.length && !!teams?.length,
    queryFn: async () => {
      const leagueId = leagues[0].id;
      const { data: res } = await supabase
        .from("race_results")
        .select("user_id, position, points, race_id, races(league_id)");
      const filtered = (res || []).filter((r: any) => r.races?.league_id === leagueId);
      const map = new Map<string, { total_points: number; wins: number }>();
      filtered.forEach((r: any) => {
        const e = map.get(r.user_id) || { total_points: 0, wins: 0 };
        e.total_points += r.points;
        if (r.position === 1) e.wins++;
        map.set(r.user_id, e);
      });
      const userIds = Array.from(map.keys());
      if (!userIds.length) return [];
      const { data: profs } = await supabase
        .from("profiles")
        .select("user_id, display_name, team_id")
        .in("user_id", userIds);
      return userIds.map((uid) => {
        const stats = map.get(uid)!;
        const prof = (profs || []).find((p: any) => p.user_id === uid);
        const team = teams.find((t: any) => t.id === prof?.team_id);
        return {
          user_id: uid,
          display_name: prof?.display_name || "Unknown",
          total_points: stats.total_points,
          wins: stats.wins,
          team: team ? { name: team.name, color: team.color } : undefined,
        };
      }).sort((a: any, b: any) => b.total_points - a.total_points);
    },
  });

  const { data: profiles = [] } = useQuery({
    queryKey: ["drivers"],
    queryFn: async () => {
      const { data } = await supabase.from("confirmed_profiles").select("*");
      return data || [];
    },
  });

  const { data: seasonRegCount } = useQuery({
    queryKey: ["season-reg-count", leagues?.[0]?.id],
    enabled: !!leagues?.length,
    queryFn: async () => {
      const { count } = await (supabase as any)
        .from("season_registrations")
        .select("id", { count: "exact" })
        .eq("league_id", leagues[0].id);
      return count || 0;
    },
  });

  const liveRace = races.find((r: any) =>
    r.status !== "completed" && new Date(r.race_date) <= now
  ) as any;
  const upcomingRace = [...races]
    .filter((r: any) => r.status !== "completed" && new Date(r.race_date) > now)
    .sort((a: any, b: any) => new Date(a.race_date).getTime() - new Date(b.race_date).getTime())[0] as any;
  const nextRace = liveRace || upcomingRace;

  const activeLeague = leagues?.[0];

  return (
    <div className="min-h-screen" style={{ background: "#08080f" }}>
      <Navbar />
      <main className="pt-16">
        <div className="container mx-auto px-4 max-w-7xl py-8">

          {/* Page title */}
          <div className="flex items-center gap-2 mb-8 pt-4">
            <Calendar className="w-4 h-4 text-orange-500" />
            <span className="text-xs font-black text-orange-500 uppercase tracking-[0.25em]">Race Kalender</span>
          </div>

          {/* Hero next race */}
          {nextRace && (
            <section className="mb-8">
              <NewHeroRace
                race={nextRace}
                countdown={formatCountdown(nextRace.race_date, now)}
                registrantCount={0}
                isRegistered={reg.isRegisteredForRace(nextRace.id, nextRace.leagues?.id)}
                isRegisteredViaSeason={reg.isRegisteredViaSeason(nextRace.leagues?.id)}
                onSelect={() => setSelectedRace(nextRace)}
              />
            </section>
          )}

          {/* Calendar + Standings grid */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-8">

            {/* Calendar */}
            <div>
              <div className="flex items-center gap-2 mb-6">
                <Calendar className="w-4 h-4 text-orange-500" />
                <span className="text-xs font-black text-orange-500 uppercase tracking-[0.25em]">Alle Races</span>
              </div>

              {/* Season banner */}
              {activeLeague && (
                <SeasonBanner
                  leagueId={activeLeague.id}
                  leagueName={activeLeague.name}
                  season={activeLeague.season}
                  carClass={activeLeague.car_class}
                  registrantCount={seasonRegCount || 0}
                  isRegistered={reg.isRegisteredForSeason(activeLeague.id)}
                  profileComplete={reg.profileComplete}
                  isLoading={reg.registerForSeason.isPending || reg.unregisterFromSeason.isPending}
                  onRegister={() => reg.registerForSeason.mutate(activeLeague.id)}
                  onUnregister={() => reg.unregisterFromSeason.mutate(activeLeague.id)}
                />
              )}

              <div className="space-y-3">
                {races.filter((race: any) =>
                  race.status !== "completed"
                ).map((race: any, i: number) => {
                  const leagueId = race.leagues?.id;
                  return (
                    <NewRaceCard
                      key={race.id}
                      race={race}
                      index={i}
                      countdown={race.status !== "completed" ? formatCountdown(race.race_date, now) : null}
                      isRegistered={reg.isRegisteredForRace(race.id, leagueId)}
                      onSelect={() => setSelectedRace(race)}
                    />
                  );
                })}
                {!races.length && (
                  <div className="text-center py-16 text-gray-700 text-sm">Geen races gevonden</div>
                )}
              </div>
            </div>

            {/* Standings sidebar */}
            <div>
              <div className="flex items-center gap-2 mb-6">
                <Trophy className="w-4 h-4 text-orange-500" />
                <span className="text-xs font-black text-orange-500 uppercase tracking-[0.25em]">Championship</span>
              </div>
              <NewStandingsTable
                standings={standingsData}
                leagueName={activeLeague?.name}
                onSelectDriver={(uid) => {
                  const driver = profiles.find((p: any) => p.user_id === uid);
                  if (driver) setSelectedDriver(driver);
                }}
              />
            </div>
          </div>
        </div>
      </main>
      <Footer />

      {/* Race modal */}
      <PreviewModal open={!!selectedRace} onClose={() => setSelectedRace(null)}>
        {selectedRace && (
          <RaceModal
            race={selectedRace}
            registration={{
              isRegistered: reg.isRegisteredForRace(selectedRace.id, selectedRace.leagues?.id),
              isRegisteredViaSeason: reg.isRegisteredViaSeason(selectedRace.leagues?.id),
              profileComplete: reg.profileComplete,
              isLoading: reg.registerForRace.isPending || reg.unregisterFromRace.isPending,
              hasLeague: !!selectedRace.leagues?.id,
              onRegister: () => reg.registerForRace.mutate(selectedRace.id),
              onUnregister: () => reg.unregisterFromRace.mutate(selectedRace.id),
            }}
          />
        )}
      </PreviewModal>

      {/* Driver modal */}
      <PreviewModal open={!!selectedDriver} onClose={() => setSelectedDriver(null)}>
        {selectedDriver && <DriverModal driver={selectedDriver} />}
      </PreviewModal>
    </div>
  );
};

export default CalendarPage;
