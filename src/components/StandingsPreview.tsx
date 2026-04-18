import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Trophy, ChevronRight } from "lucide-react";
import NewStandingsTable from "@/components/preview/NewStandingsTable";
import PreviewModal from "@/components/preview/PreviewModal";
import DriverModal from "@/components/preview/DriverModal";

const StandingsPreview = ({ leagueId }: { leagueId?: string }) => {
  const [selectedDriver, setSelectedDriver] = useState<any>(null);

  const { data: leagues = [] } = useQuery({
    queryKey: ["leagues-for-standings"],
    queryFn: async () => {
      const { data } = await supabase
        .from("leagues")
        .select("id, name")
        .order("created_at", { ascending: false });
      return data || [];
    },
  });

  const { data: teams = [] } = useQuery({
    queryKey: ["teams"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("teams").select("id, name, color, logo_url");
      return data || [];
    },
  });

  const { data: profiles = [] } = useQuery({
    queryKey: ["drivers"],
    queryFn: async () => {
      const { data } = await supabase.from("confirmed_profiles").select("*");
      return data || [];
    },
  });

  const activeLeagueId = leagueId ?? leagues?.[0]?.id;

  const { data: standings = [] } = useQuery({
    queryKey: ["standings-preview", activeLeagueId],
    enabled: !!activeLeagueId && !!teams.length,
    queryFn: async () => {
      const { data: res } = await supabase
        .from("race_results")
        .select("user_id, position, points, race_id, races(league_id)");
      const filtered = (res || []).filter((r: any) => r.races?.league_id === activeLeagueId);
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

  if (!standings.length) return null;

  const leagueName = leagues.find((l: any) => l.id === activeLeagueId)?.name;

  return (
    <section className="py-20" style={{ background: "#08080f" }}>
      <div className="container mx-auto px-4 max-w-4xl">

        <div className="flex items-end justify-between mb-8">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <Trophy className="w-4 h-4 text-orange-500" />
              <span className="text-xs font-black text-orange-500 uppercase tracking-[0.25em]">Championship</span>
            </div>
            <h2 className="font-heading font-black text-3xl md:text-4xl text-white leading-none">COUREURS STAND</h2>
          </div>
          <Link to="/standings" className="flex items-center gap-1 text-xs font-bold text-gray-600 hover:text-orange-500 transition-colors">
            Volledig <ChevronRight className="w-3 h-3" />
          </Link>
        </div>

        <NewStandingsTable
          standings={standings}
          leagueName={leagueName}
          onSelectDriver={(uid) => {
            const driver = profiles.find((p: any) => p.user_id === uid);
            if (driver) setSelectedDriver(driver);
          }}
        />
      </div>

      <PreviewModal open={!!selectedDriver} onClose={() => setSelectedDriver(null)}>
        {selectedDriver && <DriverModal driver={selectedDriver} />}
      </PreviewModal>
    </section>
  );
};

export default StandingsPreview;
