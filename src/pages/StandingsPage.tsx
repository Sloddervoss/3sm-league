import Navbar from "@/components/Navbar";
import StickyRaceBar from "@/components/StickyRaceBar";
import Footer from "@/components/Footer";
import NewStandingsTable from "@/components/preview/NewStandingsTable";
import PreviewModal from "@/components/preview/PreviewModal";
import DriverModal from "@/components/preview/DriverModal";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useDrivers, useTeams, useLeagues } from "@/hooks/data/useSharedQueries";
import { useState } from "react";
import { Trophy } from "lucide-react";
import type { DriverModalProfile, StandingRow, StandingsProfile, StandingsRaceResult, StandingTeam } from "@/lib/standingsTypes";

const StandingsPage = () => {
  const [activeLeagueId, setActiveLeagueId] = useState<string | null>(null);
  const [selectedDriver, setSelectedDriver] = useState<DriverModalProfile | null>(null);

  const { data: leagues = [] } = useLeagues();
  const { data: teams = [] } = useTeams();
  const { data: profiles = [] } = useDrivers();

  const selectedId = activeLeagueId ?? leagues?.[0]?.id ?? null;

  const { data: standings = [] } = useQuery({
    queryKey: ["standings-full", selectedId],
    enabled: !!selectedId && !!teams.length,
    queryFn: async (): Promise<StandingRow[]> => {
      const { data: res } = await supabase
        .from("race_results")
        .select("user_id, position, points, fastest_lap, race_id, races(league_id)");
      const filtered = ((res || []) as StandingsRaceResult[]).filter((r) => r.races?.league_id === selectedId);
      const map = new Map<string, { total_points: number; wins: number; podiums: number; fl: number }>();
      filtered.forEach((r) => {
        const e = map.get(r.user_id) || { total_points: 0, wins: 0, podiums: 0, fl: 0 };
        e.total_points += r.points || 0;
        if (r.position === 1) e.wins++;
        if (r.position !== null && r.position <= 3) e.podiums++;
        if (r.fastest_lap) e.fl++;
        map.set(r.user_id, e);
      });
      const userIds = Array.from(map.keys());
      if (!userIds.length) return [];
      const { data: profs } = await supabase
        .from("profiles")
        .select("user_id, display_name, team_id")
        .in("user_id", userIds);
      const profiles = (profs || []) as StandingsProfile[];
      const standingTeams = teams as StandingTeam[];
      return userIds.map((uid) => {
        const stats = map.get(uid)!;
        const prof = profiles.find((p) => p.user_id === uid);
        const team = standingTeams.find((t) => t.id === prof?.team_id);
        return {
          user_id: uid,
          display_name: prof?.display_name || "Unknown",
          total_points: stats.total_points,
          wins: stats.wins,
          podiums: stats.podiums,
          fl: stats.fl,
          team: team ? { name: team.name, color: team.color } : undefined,
        };
      }).sort((a, b) =>
        b.total_points - a.total_points ||
        b.wins - a.wins ||
        (b.podiums || 0) - (a.podiums || 0) ||
        (b.fl || 0) - (a.fl || 0)
      );
    },
  });

  const selectedLeague = leagues.find((l) => l.id === selectedId);

  return (
    <div className="min-h-screen" style={{ background: "#08080f" }}>
      <Navbar />
      <StickyRaceBar />
      <main className="pt-[108px]">
        <div className="container mx-auto px-4 max-w-4xl py-12">

          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-1.5">
              <Trophy className="w-4 h-4 text-orange-500" />
              <span className="text-xs font-black text-orange-500 uppercase tracking-[0.25em]">Championship</span>
            </div>
            <h1 className="font-heading font-black text-4xl md:text-5xl text-white leading-none">STAND</h1>
          </div>

          {/* League tabs */}
          {leagues.length > 1 && (
            <div className="flex gap-2 mb-8 overflow-x-auto pb-1">
              {leagues.map((l) => (
                <button
                  key={l.id}
                  onClick={() => setActiveLeagueId(l.id)}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold whitespace-nowrap transition-all shrink-0"
                  style={
                    selectedId === l.id
                      ? { background: "rgba(249,115,22,0.15)", border: "1px solid rgba(249,115,22,0.3)", color: "#f97316" }
                      : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", color: "#6b7280" }
                  }
                >
                  {l.name}
                  {l.season && <span className="text-xs opacity-60">{l.season}</span>}
                </button>
              ))}
            </div>
          )}

          <NewStandingsTable
            standings={standings}
            leagueName={selectedLeague?.name}
            onSelectDriver={(uid) => {
              const driver = (profiles as DriverModalProfile[]).find((p) => p.user_id === uid);
              if (driver) setSelectedDriver(driver);
            }}
          />
        </div>
      </main>
      <Footer />

      <PreviewModal open={!!selectedDriver} onClose={() => setSelectedDriver(null)}>
        {selectedDriver && <DriverModal driver={selectedDriver} />}
      </PreviewModal>
    </div>
  );
};

export default StandingsPage;
