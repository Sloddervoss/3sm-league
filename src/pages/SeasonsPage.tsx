import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { motion } from "framer-motion";
import { Trophy, Calendar, Flag, Car, Users, ChevronRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";

const statusColors: Record<string, string> = {
  active: "bg-green-500/20 text-green-400 border-green-500/30",
  completed: "bg-muted text-muted-foreground border-border",
  upcoming: "bg-primary/10 text-primary border-primary/20",
};

const statusLabels: Record<string, string> = {
  active: "Actief",
  completed: "Afgelopen",
  upcoming: "Aankomend",
};

const SeasonsPage = () => {
  const { data: leagues, isLoading } = useQuery({
    queryKey: ["all-leagues"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leagues")
        .select("*, races(*)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: results } = useQuery({
    queryKey: ["all-results-for-seasons"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("race_results")
        .select("user_id, points, position, race_id, races(league_id), profiles(display_name, iracing_name)");
      if (error) throw error;
      return data;
    },
  });

  const getLeaderForLeague = (leagueId: string) => {
    const leagueResults = (results || []).filter((r: any) => r.races?.league_id === leagueId);
    const driverMap = new Map<string, { name: string; points: number }>();
    leagueResults.forEach((r: any) => {
      const existing = driverMap.get(r.user_id) || { name: r.profiles?.display_name || r.profiles?.iracing_name || "Unknown", points: 0 };
      existing.points += r.points;
      driverMap.set(r.user_id, existing);
    });
    const sorted = [...driverMap.values()].sort((a, b) => b.points - a.points);
    return sorted[0] || null;
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-16">
        {/* Header */}
        <section className="py-12 bg-gradient-to-b from-card/50 to-transparent border-b border-border">
          <div className="container mx-auto px-4">
            <div className="flex items-center gap-2 mb-2">
              <Trophy className="w-5 h-5 text-accent" />
              <span className="text-sm font-medium text-accent uppercase tracking-[0.15em]">3SM</span>
            </div>
            <h1 className="font-heading text-4xl md:text-5xl font-black">SEIZOENEN</h1>
            <p className="text-muted-foreground mt-2">Alle kampioenschappen en seizoenen</p>
          </div>
        </section>

        <section className="py-12">
          <div className="container mx-auto px-4">
            {isLoading ? (
              <div className="grid gap-6 md:grid-cols-2">
                {[1, 2].map((i) => <div key={i} className="h-48 bg-card rounded-lg animate-pulse" />)}
              </div>
            ) : !leagues?.length ? (
              <div className="text-center py-24 text-muted-foreground">
                <Trophy className="w-12 h-12 mx-auto mb-4 opacity-40" />
                <p className="text-lg font-heading font-bold">GEEN SEIZOENEN</p>
                <p className="text-sm mt-1">Er zijn nog geen seizoenen aangemaakt.</p>
              </div>
            ) : (
              <div className="grid gap-6 md:grid-cols-2">
                {leagues.map((league: any, i: number) => {
                  const races = (league as any).races || [];
                  const completedRaces = races.filter((r: any) => r.status === "completed").length;
                  const totalRaces = races.length;
                  const progress = totalRaces > 0 ? (completedRaces / totalRaces) * 100 : 0;
                  const leader = getLeaderForLeague(league.id);
                  const nextRace = races
                    .filter((r: any) => r.status === "upcoming")
                    .sort((a: any, b: any) => new Date(a.race_date).getTime() - new Date(b.race_date).getTime())[0];

                  return (
                    <motion.div
                      key={league.id}
                      initial={{ opacity: 0, y: 20 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: i * 0.05 }}
                      className="bg-card border border-border rounded-lg p-6 card-hover racing-stripe-left"
                    >
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <h2 className="font-heading font-black text-2xl">{league.name}</h2>
                          <div className="flex flex-wrap gap-2 mt-1">
                            {league.season && (
                              <span className="text-xs px-2 py-0.5 rounded bg-secondary text-secondary-foreground">{league.season}</span>
                            )}
                            {league.car_class && (
                              <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-secondary text-secondary-foreground">
                                <Car className="w-3 h-3" />
                                {league.car_class}
                              </span>
                            )}
                          </div>
                        </div>
                        <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider border ${statusColors[league.status] || statusColors.upcoming}`}>
                          {statusLabels[league.status] || league.status}
                        </span>
                      </div>

                      {league.description && (
                        <p className="text-sm text-muted-foreground mb-4">{league.description}</p>
                      )}

                      {/* Progress bar */}
                      {totalRaces > 0 && (
                        <div className="mb-4">
                          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
                            <span>{completedRaces} van {totalRaces} races gereden</span>
                            <span>{Math.round(progress)}%</span>
                          </div>
                          <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                            <motion.div
                              initial={{ width: 0 }}
                              whileInView={{ width: `${progress}%` }}
                              viewport={{ once: true }}
                              transition={{ duration: 1, ease: "easeOut" }}
                              className="h-full bg-gradient-racing rounded-full"
                            />
                          </div>
                        </div>
                      )}

                      {/* Stats */}
                      <div className="grid grid-cols-3 gap-3 mb-4">
                        <div className="text-center p-2 bg-secondary/50 rounded-md">
                          <div className="font-heading font-black text-lg">{totalRaces}</div>
                          <div className="text-xs text-muted-foreground">Races</div>
                        </div>
                        <div className="text-center p-2 bg-secondary/50 rounded-md">
                          <div className="font-heading font-black text-lg">{completedRaces}</div>
                          <div className="text-xs text-muted-foreground">Gereden</div>
                        </div>
                        <div className="text-center p-2 bg-secondary/50 rounded-md">
                          <div className="font-heading font-black text-lg">{totalRaces - completedRaces}</div>
                          <div className="text-xs text-muted-foreground">Te gaan</div>
                        </div>
                      </div>

                      {/* Leader & next race */}
                      <div className="border-t border-border pt-4 space-y-2">
                        {leader && (
                          <div className="flex items-center justify-between text-sm">
                            <span className="flex items-center gap-1.5 text-muted-foreground">
                              <Trophy className="w-3.5 h-3.5 text-yellow-400" />
                              Leider
                            </span>
                            <span className="font-heading font-bold text-yellow-400">{leader.name} — {leader.points} pts</span>
                          </div>
                        )}
                        {nextRace && (
                          <div className="flex items-center justify-between text-sm">
                            <span className="flex items-center gap-1.5 text-muted-foreground">
                              <Calendar className="w-3.5 h-3.5" />
                              Volgende race
                            </span>
                            <span className="font-heading font-bold">
                              {nextRace.name} — {new Date(nextRace.race_date).toLocaleDateString("nl-NL", { day: "numeric", month: "short" })}
                            </span>
                          </div>
                        )}
                      </div>

                      <Link
                        to="/standings"
                        className="mt-4 flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors font-medium"
                      >
                        Bekijk standings <ChevronRight className="w-3.5 h-3.5" />
                      </Link>
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

export default SeasonsPage;
