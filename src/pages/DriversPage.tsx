import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { motion } from "framer-motion";
import { Users, Trophy, Flag, Gamepad2, TrendingUp, Shield, Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";

const safetyColors: Record<string, string> = {
  A: "text-green-400",
  B: "text-yellow-400",
  C: "text-orange-400",
  D: "text-red-400",
};

const DriversPage = () => {
  const [search, setSearch] = useState("");

  const { data: profiles, isLoading } = useQuery({
    queryKey: ["drivers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*");
      if (error) throw error;
      return data;
    },
  });

  const { data: stats } = useQuery({
    queryKey: ["driver-stats"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("race_results")
        .select("user_id, position, points, incidents");
      if (error) throw error;
      const map = new Map<string, { races: number; wins: number; podiums: number; points: number; incidents: number }>();
      data?.forEach((r: any) => {
        const e = map.get(r.user_id) || { races: 0, wins: 0, podiums: 0, points: 0, incidents: 0 };
        e.races += 1;
        e.points += r.points;
        if (r.position === 1) e.wins += 1;
        if (r.position <= 3) e.podiums += 1;
        e.incidents += r.incidents || 0;
        map.set(r.user_id, e);
      });
      return map;
    },
  });

  const { data: teams } = useQuery({
    queryKey: ["teams-for-drivers"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("teams").select("id, name, color");
      if (error) throw error;
      return data || [];
    },
  });

  const filtered = (profiles || []).filter((p: any) =>
    !search || (p.display_name || p.iracing_name || "").toLowerCase().includes(search.toLowerCase())
  );

  // Sort by points desc
  const sorted = [...filtered].sort((a: any, b: any) => {
    const ap = stats?.get(a.user_id)?.points || 0;
    const bp = stats?.get(b.user_id)?.points || 0;
    return bp - ap;
  });

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-16">
        {/* Header */}
        <section className="py-12 bg-gradient-to-b from-card/50 to-transparent border-b border-border">
          <div className="container mx-auto px-4">
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-5 h-5 text-primary" />
              <span className="text-sm font-medium text-primary uppercase tracking-[0.15em]">Community</span>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
              <h1 className="font-heading text-4xl md:text-5xl font-black">DRIVERS</h1>
              {/* Search */}
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Driver zoeken..."
                  className="w-full pl-9 pr-4 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
            </div>
          </div>
        </section>

        <section className="py-12">
          <div className="container mx-auto px-4">
            {isLoading ? (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {[1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="h-40 bg-card rounded-lg animate-pulse" />)}
              </div>
            ) : !sorted.length ? (
              <div className="text-center py-24 text-muted-foreground">
                <Users className="w-12 h-12 mx-auto mb-4 opacity-40" />
                <p className="text-lg font-heading font-bold">GEEN DRIVERS GEVONDEN</p>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {sorted.map((driver: any, i: number) => {
                  const driverStats = stats?.get(driver.user_id);
                  const team = teams?.find((t: any) => t.id === driver.team_id);
                  const safetyLetter = (driver.safety_rating || "").split(" ")[0] || "A";
                  const avgIncidents = driverStats && driverStats.races > 0
                    ? (driverStats.incidents / driverStats.races).toFixed(1)
                    : "—";

                  return (
                    <motion.div
                      key={driver.id}
                      initial={{ opacity: 0, y: 20 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: Math.min(i, 5) * 0.05 }}
                      className="bg-card border border-border rounded-lg p-5 card-hover"
                      style={team ? { borderTopColor: team.color, borderTopWidth: 3 } : {}}
                    >
                      {/* Header row */}
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <div className="flex items-center gap-2">
                            {i < 3 && driverStats?.points ? (
                              <span className={`font-heading font-black text-base ${i === 0 ? "text-yellow-400" : i === 1 ? "text-slate-300" : "text-amber-600"}`}>
                                #{i + 1}
                              </span>
                            ) : null}
                            <h3 className="font-heading font-bold text-lg leading-tight">{driver.display_name || driver.iracing_name || "Unknown"}</h3>
                          </div>
                          {driver.iracing_name && driver.display_name !== driver.iracing_name && (
                            <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                              <Gamepad2 className="w-3 h-3" />
                              {driver.iracing_name}
                            </p>
                          )}
                          {team && (
                            <span className="inline-flex items-center gap-1 text-xs mt-1 font-medium" style={{ color: team.color }}>
                              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: team.color }} />
                              {team.name}
                            </span>
                          )}
                        </div>

                        {/* Points badge */}
                        {driverStats ? (
                          <div className="text-right shrink-0">
                            <div className="font-heading font-black text-2xl text-gradient-racing">{driverStats.points}</div>
                            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">pts</div>
                          </div>
                        ) : null}
                      </div>

                      {/* Stats grid */}
                      <div className="grid grid-cols-3 gap-2 mb-3">
                        <div className="bg-secondary/50 rounded p-2 text-center">
                          <div className="font-heading font-black text-lg">{driverStats?.wins ?? 0}</div>
                          <div className="text-[10px] text-muted-foreground uppercase">Wins</div>
                        </div>
                        <div className="bg-secondary/50 rounded p-2 text-center">
                          <div className="font-heading font-black text-lg">{driverStats?.podiums ?? 0}</div>
                          <div className="text-[10px] text-muted-foreground uppercase">Podiums</div>
                        </div>
                        <div className="bg-secondary/50 rounded p-2 text-center">
                          <div className="font-heading font-black text-lg">{driverStats?.races ?? 0}</div>
                          <div className="text-[10px] text-muted-foreground uppercase">Races</div>
                        </div>
                      </div>

                      {/* iRacing stats row */}
                      <div className="flex items-center justify-between pt-3 border-t border-border text-xs text-muted-foreground">
                        <div className="flex items-center gap-3">
                          {driver.irating ? (
                            <span className="flex items-center gap-1">
                              <TrendingUp className="w-3 h-3 text-blue-400" />
                              <span className="font-bold text-foreground">{driver.irating.toLocaleString()}</span>
                              <span>iRating</span>
                            </span>
                          ) : null}
                          {driver.safety_rating ? (
                            <span className="flex items-center gap-1">
                              <Shield className="w-3 h-3" />
                              <span className={`font-bold ${safetyColors[safetyLetter] || ""}`}>{driver.safety_rating}</span>
                            </span>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-2">
                          {driver.iracing_id && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary font-mono">
                              #{driver.iracing_id}
                            </span>
                          )}
                          <span className="text-[10px] text-muted-foreground/70">{avgIncidents} inc/race</span>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default DriversPage;
