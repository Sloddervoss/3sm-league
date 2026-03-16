import { motion } from "framer-motion";
import { Crown, Trophy, Flag, Star } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";

const ChampionshipLeader = () => {
  const { data: standings } = useQuery({
    queryKey: ["championship-leader"],
    queryFn: async () => {
      const { data: results, error } = await supabase
        .from("race_results")
        .select("user_id, position, points, profiles(display_name, iracing_name, iracing_id)");
      if (error) throw error;

      const map = new Map<string, { name: string; iracingId: string | null; points: number; wins: number; races: number; podiums: number }>();
      results?.forEach((r: any) => {
        const existing = map.get(r.user_id) || {
          name: r.profiles?.display_name || r.profiles?.iracing_name || "Unknown",
          iracingId: r.profiles?.iracing_id || null,
          points: 0, wins: 0, races: 0, podiums: 0,
        };
        existing.points += r.points;
        existing.races += 1;
        if (r.position === 1) existing.wins += 1;
        if (r.position <= 3) existing.podiums += 1;
        map.set(r.user_id, existing);
      });

      return [...map.values()].sort((a, b) => b.points - a.points).slice(0, 5);
    },
  });

  if (!standings?.length) return null;

  const leader = standings[0];
  const maxPoints = leader.points;

  return (
    <section className="py-20 bg-card/30">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between mb-10">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Crown className="w-5 h-5 text-yellow-400" />
              <span className="text-sm font-medium text-yellow-400 uppercase tracking-[0.15em]">Kampioenschap</span>
            </div>
            <h2 className="font-heading text-3xl md:text-4xl font-black">KLASSEMENT LEIDER</h2>
          </div>
          <Link to="/standings" className="text-sm text-muted-foreground hover:text-primary transition-colors font-medium">
            Volledig klassement →
          </Link>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Leader card */}
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            className="relative bg-card border border-yellow-500/30 rounded-xl p-6 overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-yellow-500/5 rounded-full -translate-y-8 translate-x-8" />
            <div className="absolute top-4 right-4">
              <Crown className="w-8 h-8 text-yellow-400/40" />
            </div>
            <div className="relative">
              <div className="text-xs font-bold uppercase tracking-[0.2em] text-yellow-400 mb-1">Leider</div>
              <h3 className="font-heading font-black text-3xl mb-1">{leader.name}</h3>
              {leader.iracingId && (
                <div className="text-xs text-muted-foreground mb-4">iRacing #{leader.iracingId}</div>
              )}
              <div className="flex gap-6 mb-5">
                <div>
                  <div className="font-heading font-black text-4xl text-yellow-400">{leader.points}</div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wider">Punten</div>
                </div>
                <div>
                  <div className="font-heading font-black text-4xl">{leader.wins}</div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wider">Overwinningen</div>
                </div>
                <div>
                  <div className="font-heading font-black text-4xl">{leader.podiums}</div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wider">Podiums</div>
                </div>
              </div>
              <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-yellow-400 to-amber-500 rounded-full" style={{ width: "100%" }} />
              </div>
              <div className="text-xs text-muted-foreground mt-1">{leader.races} races gereden</div>
            </div>
          </motion.div>

          {/* Top 5 */}
          <div className="space-y-2">
            {standings.map((driver, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: 20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.06 }}
                className="bg-card border border-border rounded-lg px-4 py-3 flex items-center gap-4"
              >
                <span className={`font-heading font-black text-xl w-8 shrink-0 ${i === 0 ? "text-yellow-400" : i === 1 ? "text-slate-300" : i === 2 ? "text-amber-600" : "text-muted-foreground"}`}>
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-heading font-bold truncate">{driver.name}</div>
                  <div className="flex-1 h-1 bg-secondary rounded-full mt-1.5 overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      whileInView={{ width: `${maxPoints > 0 ? (driver.points / maxPoints) * 100 : 0}%` }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.8, delay: i * 0.06 }}
                      className={`h-full rounded-full ${i === 0 ? "bg-gradient-to-r from-yellow-400 to-amber-500" : "bg-gradient-racing"}`}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-muted-foreground hidden sm:block">{driver.wins}W</span>
                  <span className="font-heading font-black text-lg">{driver.points}</span>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default ChampionshipLeader;
