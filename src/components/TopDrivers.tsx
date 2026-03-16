import { motion } from "framer-motion";
import { Users, Trophy, Flag, Gamepad2, ChevronRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";

const TopDrivers = () => {
  const { data: driverStats } = useQuery({
    queryKey: ["top-drivers-home"],
    queryFn: async () => {
      const { data: results, error } = await supabase
        .from("race_results")
        .select("user_id, position, points, incidents, profiles(display_name, iracing_name, iracing_id)");
      if (error) throw error;

      const map = new Map<string, {
        name: string; iracingName: string | null; iracingId: string | null;
        points: number; wins: number; races: number; podiums: number; incidents: number;
      }>();

      results?.forEach((r: any) => {
        const existing = map.get(r.user_id) || {
          name: r.profiles?.display_name || r.profiles?.iracing_name || "Unknown",
          iracingName: r.profiles?.iracing_name || null,
          iracingId: r.profiles?.iracing_id || null,
          points: 0, wins: 0, races: 0, podiums: 0, incidents: 0,
        };
        existing.points += r.points;
        existing.races += 1;
        if (r.position === 1) existing.wins += 1;
        if (r.position <= 3) existing.podiums += 1;
        existing.incidents += r.incidents || 0;
        map.set(r.user_id, existing);
      });

      return [...map.values()].sort((a, b) => b.points - a.points).slice(0, 6);
    },
  });

  if (!driverStats?.length) return null;

  return (
    <section className="py-20">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between mb-10">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-5 h-5 text-primary" />
              <span className="text-sm font-medium text-primary uppercase tracking-[0.15em]">Community</span>
            </div>
            <h2 className="font-heading text-3xl md:text-4xl font-black">TOP DRIVERS</h2>
          </div>
          <Link to="/drivers" className="text-sm text-muted-foreground hover:text-primary transition-colors font-medium">
            Alle drivers →
          </Link>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {driverStats.map((driver, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.06 }}
              className="bg-card border border-border rounded-lg p-5 card-hover racing-stripe-left"
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    {i < 3 && (
                      <span className={`font-heading font-black text-sm ${i === 0 ? "text-yellow-400" : i === 1 ? "text-slate-300" : "text-amber-600"}`}>
                        #{i + 1}
                      </span>
                    )}
                    <h3 className="font-heading font-bold text-lg">{driver.name}</h3>
                  </div>
                  {driver.iracingName && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Gamepad2 className="w-3 h-3" />
                      {driver.iracingName}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <div className="font-heading font-black text-2xl text-gradient-racing">{driver.points}</div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider">pts</div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-secondary/50 rounded-md p-2">
                  <div className="font-heading font-black text-lg">{driver.wins}</div>
                  <div className="text-[10px] text-muted-foreground uppercase">Wins</div>
                </div>
                <div className="bg-secondary/50 rounded-md p-2">
                  <div className="font-heading font-black text-lg">{driver.podiums}</div>
                  <div className="text-[10px] text-muted-foreground uppercase">Podiums</div>
                </div>
                <div className="bg-secondary/50 rounded-md p-2">
                  <div className="font-heading font-black text-lg">{driver.races}</div>
                  <div className="text-[10px] text-muted-foreground uppercase">Races</div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default TopDrivers;
