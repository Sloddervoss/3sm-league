import { useState } from "react";
import Navbar from "@/components/Navbar";
import StickyRaceBar from "@/components/StickyRaceBar";
import Footer from "@/components/Footer";
import NewTeamCard from "@/components/preview/NewTeamCard";
import NewStandingsTable from "@/components/preview/NewStandingsTable";
import PreviewModal from "@/components/preview/PreviewModal";
import TeamModal from "@/components/preview/TeamModal";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Car, Trophy } from "lucide-react";

const TeamsPage = () => {
  const [selectedTeam, setSelectedTeam] = useState<any>(null);
  const { data: teams = [], isLoading } = useQuery({
    queryKey: ["teams"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("teams").select("*").order("name");
      return data || [];
    },
  });

  const { data: memberships = [] } = useQuery({
    queryKey: ["team-memberships-with-profiles"],
    queryFn: async () => {
      const { data } = await supabase
        .from("team_memberships")
        .select("*, profiles(display_name, iracing_name)");
      return data || [];
    },
  });

  const { data: results = [] } = useQuery({
    queryKey: ["team-results"],
    queryFn: async () => {
      const { data } = await supabase.from("race_results").select("user_id, position, points");
      return data || [];
    },
  });

  const getTeamMembers = (teamId: string) =>
    memberships.filter((m: any) => m.team_id === teamId);

  const getTeamStats = (teamId: string) => {
    const ids = getTeamMembers(teamId).map((m: any) => m.user_id);
    let total = 0, wins = 0;
    results.forEach((r: any) => {
      if (ids.includes(r.user_id)) { total += r.points; if (r.position === 1) wins++; }
    });
    return { total, wins };
  };

  const sortedTeams = [...teams]
    .map((t: any) => ({ ...t, ...getTeamStats(t.id) }))
    .sort((a: any, b: any) => b.total - a.total);

  // Team standings for NewStandingsTable format
  const teamStandings = sortedTeams.map((t: any) => ({
    user_id: t.id,
    display_name: t.name,
    total_points: t.total,
    wins: t.wins,
    team: { name: t.name, color: t.color },
  }));

  return (
    <div className="min-h-screen" style={{ background: "#08080f" }}>
      <Navbar />
      <StickyRaceBar />
      <main className="pt-[108px]">
        <div className="container mx-auto px-4 max-w-7xl py-12">

          {/* Header */}
          <div className="mb-10">
            <div className="flex items-center gap-2 mb-1.5">
              <Car className="w-4 h-4 text-orange-500" />
              <span className="text-xs font-black text-orange-500 uppercase tracking-[0.25em]">3SM</span>
            </div>
            <h1 className="font-heading font-black text-4xl md:text-5xl text-white leading-none">TEAMS</h1>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-12">
            {/* Team cards */}
            <div>
              {isLoading ? (
                <div className="grid gap-6 sm:grid-cols-2">
                  {[1,2,3,4].map((i) => (
                    <div key={i} className="h-72 rounded-2xl animate-pulse" style={{ background: "rgba(255,255,255,0.03)" }} />
                  ))}
                </div>
              ) : !sortedTeams.length ? (
                <div className="text-center py-24 text-gray-700">
                  <Car className="w-12 h-12 mx-auto mb-4 opacity-30" />
                  <p className="font-heading font-bold text-lg">Geen teams gevonden</p>
                </div>
              ) : (
                <div className="grid gap-6 sm:grid-cols-2">
                  {sortedTeams.map((team: any, i: number) => (
                    <NewTeamCard
                      key={team.id}
                      team={team}
                      members={getTeamMembers(team.id)}
                      points={team.total}
                      wins={team.wins}
                      rank={i + 1}
                      onSelect={() => setSelectedTeam(team)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Team standings sidebar */}
            <div>
              <div className="flex items-center gap-2 mb-6">
                <Trophy className="w-4 h-4 text-orange-500" />
                <span className="text-xs font-black text-orange-500 uppercase tracking-[0.25em]">Team Standings</span>
              </div>
              <NewStandingsTable standings={teamStandings} />
            </div>
          </div>
        </div>
      </main>
      <Footer />

      <PreviewModal open={!!selectedTeam} onClose={() => setSelectedTeam(null)} maxWidth="780px">
        {selectedTeam && <TeamModal team={selectedTeam} />}
      </PreviewModal>
    </div>
  );
};

export default TeamsPage;
