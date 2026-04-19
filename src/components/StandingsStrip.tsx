import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Trophy, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTeams } from "@/hooks/data/useSharedQueries";
import type { StandingsRaceResult, StandingsProfile, StandingRow } from "@/lib/standingsTypes";

const PODIUM_COLORS = ["#facc15", "#94a3b8", "#d97706"];

const StandingsStrip = () => {
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

  const { data: teams = [] } = useTeams();

  const activeLeagueId = leagues[0]?.id;

  const { data: standings = [] } = useQuery({
    queryKey: ["standings-preview", activeLeagueId],
    enabled: !!activeLeagueId && !!teams.length,
    queryFn: async (): Promise<StandingRow[]> => {
      const { data: res } = await supabase
        .from("race_results")
        .select("user_id, position, points, race_id, races(league_id)");
      const filtered = ((res || []) as StandingsRaceResult[]).filter(
        (r) => r.races?.league_id === activeLeagueId
      );
      const map = new Map<string, { total_points: number; wins: number }>();
      filtered.forEach((r) => {
        const e = map.get(r.user_id) || { total_points: 0, wins: 0 };
        e.total_points += r.points || 0;
        if (r.position === 1) e.wins++;
        map.set(r.user_id, e);
      });
      const userIds = Array.from(map.keys());
      if (!userIds.length) return [];
      const { data: profs } = await supabase
        .from("profiles")
        .select("user_id, display_name, team_id")
        .in("user_id", userIds);
      const profiles = (profs || []) as StandingsProfile[];
      return userIds
        .map((uid) => {
          const stats = map.get(uid)!;
          const prof = profiles.find((p) => p.user_id === uid);
          const team = teams.find((t) => t.id === prof?.team_id);
          return {
            user_id: uid,
            display_name: prof?.display_name || "Unknown",
            total_points: stats.total_points,
            wins: stats.wins,
            team: team ? { name: team.name, color: team.color } : undefined,
          };
        })
        .sort((a, b) => b.total_points - a.total_points)
        .slice(0, 5);
    },
  });

  if (!standings.length) return null;

  const leagueName = leagues.find((l) => l.id === activeLeagueId)?.name;

  return (
    <section className="py-20" style={{ background: "#08080f" }}>
      <div className="container mx-auto px-4 max-w-7xl">

        <div className="flex items-end justify-between mb-8">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <Trophy className="w-4 h-4 text-orange-500" />
              <span className="text-xs font-black text-orange-500 uppercase tracking-[0.25em]">
                Championship{leagueName ? ` · ${leagueName}` : ""}
              </span>
            </div>
            <h2 className="font-heading font-black text-3xl md:text-4xl text-white leading-none">
              COUREURS STAND
            </h2>
          </div>
          <Link
            to="/standings"
            className="flex items-center gap-1 text-xs font-bold text-gray-600 hover:text-orange-500 transition-colors"
          >
            Volledig <ChevronRight className="w-3 h-3" />
          </Link>
        </div>

        <div
          className="rounded-2xl overflow-hidden"
          style={{ border: "1px solid rgba(255,255,255,0.06)" }}
        >
          {standings.map((driver, i) => {
            const podiumColor = i < 3 ? PODIUM_COLORS[i] : null;
            const teamColor = driver.team?.color || null;

            return (
              <div
                key={driver.user_id}
                className="relative flex items-center gap-4 px-5 py-3.5"
                style={{
                  borderTop: i > 0 ? "1px solid rgba(255,255,255,0.04)" : undefined,
                  background: i === 0
                    ? "rgba(249,115,22,0.04)"
                    : teamColor
                    ? `linear-gradient(90deg, ${teamColor}08 0%, transparent 40%)`
                    : "transparent",
                }}
              >
                {teamColor && (
                  <div
                    className="absolute left-0 top-0 bottom-0 w-0.5"
                    style={{ background: teamColor, boxShadow: `2px 0 8px ${teamColor}60` }}
                  />
                )}

                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center font-heading font-black text-sm shrink-0"
                  style={
                    podiumColor
                      ? { background: `${podiumColor}15`, color: podiumColor }
                      : { color: "#4b5563" }
                  }
                >
                  {i + 1}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="font-heading font-bold text-sm text-white truncate">
                    {driver.display_name}
                  </div>
                  {driver.team && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <div
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ backgroundColor: teamColor || "#6b7280" }}
                      />
                      <span
                        className="text-[10px] truncate"
                        style={{ color: (teamColor || "#6b7280") + "99" }}
                      >
                        {driver.team.name}
                      </span>
                    </div>
                  )}
                </div>

                <div className="font-heading font-bold text-sm text-gray-500 shrink-0">
                  {driver.wins}W
                </div>

                <div className="text-right shrink-0 w-14">
                  <div
                    className="font-heading font-black text-lg leading-none"
                    style={{ color: podiumColor || "#d1d5db" }}
                  >
                    {driver.total_points}
                  </div>
                  <div className="text-[10px] text-gray-700 uppercase">pts</div>
                </div>
              </div>
            );
          })}
        </div>

      </div>
    </section>
  );
};

export default StandingsStrip;
