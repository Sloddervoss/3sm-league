import { motion } from "framer-motion";
import { Trophy, TrendingUp, Minus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface DriverStanding {
  user_id: string;
  display_name: string;
  total_points: number;
  wins: number;
}

const StandingsPreview = ({ leagueId }: { leagueId?: string }) => {
  const { data: standings, isLoading } = useQuery({
    queryKey: ["standings", leagueId],
    queryFn: async () => {
      // Get all race results with profiles
      let query = supabase
        .from("race_results")
        .select("user_id, position, points, race_id, races(league_id)");

      const { data: results, error } = await query;
      if (error) throw error;

      // Filter by league if specified
      const filtered = leagueId
        ? results?.filter((r: any) => r.races?.league_id === leagueId)
        : results;

      // Aggregate by user
      const driverMap = new Map<string, { total_points: number; wins: number }>();
      filtered?.forEach((r: any) => {
        const existing = driverMap.get(r.user_id) || { total_points: 0, wins: 0 };
        existing.total_points += r.points;
        if (r.position === 1) existing.wins += 1;
        driverMap.set(r.user_id, existing);
      });

      // Get profiles for these users
      const userIds = Array.from(driverMap.keys());
      if (userIds.length === 0) return [];

      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", userIds);

      const standings: DriverStanding[] = userIds.map((uid) => {
        const stats = driverMap.get(uid)!;
        const profile = profiles?.find((p) => p.user_id === uid);
        return {
          user_id: uid,
          display_name: profile?.display_name || "Unknown",
          total_points: stats.total_points,
          wins: stats.wins,
        };
      });

      return standings.sort((a, b) => b.total_points - a.total_points);
    },
  });

  if (isLoading) {
    return (
      <section className="py-20 bg-card/50">
        <div className="container mx-auto px-4">
          <div className="animate-pulse space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-14 bg-secondary rounded" />
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="py-20 bg-card/50">
      <div className="container mx-auto px-4">
        <div className="flex items-center gap-2 mb-2">
          <Trophy className="w-5 h-5 text-accent" />
          <span className="text-sm font-medium text-accent uppercase tracking-[0.15em]">Championship</span>
        </div>
        <h2 className="font-heading text-3xl md:text-4xl font-black mb-10">DRIVER STANDINGS</h2>

        {!standings?.length ? (
          <div className="text-center py-12 text-muted-foreground">
            <Trophy className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p>Nog geen resultaten beschikbaar. De standings worden bijgewerkt na elke race.</p>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="grid grid-cols-[3rem_1fr_4rem_4rem] md:grid-cols-[4rem_1fr_5rem_5rem] gap-2 px-4 py-3 bg-secondary/50 text-xs font-bold uppercase tracking-wider text-muted-foreground border-b border-border">
              <span>Pos</span>
              <span>Driver</span>
              <span className="text-center">Wins</span>
              <span className="text-center">Pts</span>
            </div>

            {standings.map((driver, i) => (
              <motion.div
                key={driver.user_id}
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.05 }}
                className={`grid grid-cols-[3rem_1fr_4rem_4rem] md:grid-cols-[4rem_1fr_5rem_5rem] gap-2 px-4 py-3.5 items-center border-b border-border/50 hover:bg-secondary/30 transition-colors ${
                  i === 0 ? "racing-stripe-left" : ""
                }`}
              >
                <span className={`font-heading font-black text-lg ${i === 0 ? "text-accent" : i < 3 ? "text-primary" : "text-muted-foreground"}`}>
                  {i + 1}
                </span>
                <span className="font-heading font-bold text-sm md:text-base truncate">{driver.display_name}</span>
                <span className="text-center font-heading font-bold">{driver.wins}</span>
                <span className="text-center font-heading font-black text-lg">{driver.total_points}</span>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};

export default StandingsPreview;
