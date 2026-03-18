import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { motion } from "framer-motion";
import { Car, Users, Trophy, Shield } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const TeamsPage = () => {
  const { data: teams, isLoading } = useQuery({
    queryKey: ["teams"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("*")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: memberships } = useQuery({
    queryKey: ["team-memberships-with-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("team_memberships")
        .select("*, profiles(display_name, iracing_name, iracing_id)");
      if (error) throw error;
      return data;
    },
  });

  const { data: results } = useQuery({
    queryKey: ["team-results"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("race_results")
        .select("user_id, position, points");
      if (error) throw error;
      return data;
    },
  });

  const getTeamMembers = (teamId: string) =>
    memberships?.filter((m: any) => m.team_id === teamId) || [];

  const getTeamPoints = (teamId: string) => {
    const members = getTeamMembers(teamId);
    const memberIds = members.map((m: any) => m.user_id);
    let total = 0;
    let wins = 0;
    results?.forEach((r: any) => {
      if (memberIds.includes(r.user_id)) {
        total += r.points;
        if (r.position === 1) wins++;
      }
    });
    return { total, wins };
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-16">
        {/* Page header */}
        <section className="py-12 bg-gradient-to-b from-card/50 to-transparent border-b border-border">
          <div className="container mx-auto px-4">
            <div className="flex items-center gap-2 mb-2">
              <Car className="w-5 h-5 text-accent" />
              <span className="text-sm font-medium text-accent uppercase tracking-[0.15em]">3SM</span>
            </div>
            <h1 className="font-heading text-4xl md:text-5xl font-black">TEAMS</h1>
            <p className="text-muted-foreground mt-2">Alle deelnemende teams in het kampioenschap</p>
          </div>
        </section>

        <section className="py-12">
          <div className="container mx-auto px-4">
            {isLoading ? (
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-48 bg-card rounded-lg animate-pulse" />
                ))}
              </div>
            ) : !teams?.length ? (
              <div className="text-center py-24 text-muted-foreground">
                <Car className="w-12 h-12 mx-auto mb-4 opacity-40" />
                <p className="text-lg font-heading font-bold">GEEN TEAMS</p>
                <p className="text-sm mt-1">Er zijn nog geen teams aangemaakt.</p>
              </div>
            ) : (
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {teams.map((team: any, i: number) => {
                  const members = getTeamMembers(team.id);
                  const { total, wins } = getTeamPoints(team.id);
                  return (
                    <motion.div
                      key={team.id}
                      initial={{ opacity: 0, y: 20 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: i * 0.05 }}
                      className="bg-card border border-border rounded-lg overflow-hidden card-hover group"
                      style={{ borderTopColor: team.color, borderTopWidth: 3 }}
                    >
                      <div
                        className="w-full h-48 flex items-center justify-center relative overflow-hidden"
                        style={{ background: `linear-gradient(135deg, ${team.color}30 0%, ${team.color}08 100%)` }}
                      >
                        {team.logo_url ? (
                          <img src={team.logo_url} alt={team.name} className="h-40 w-40 object-contain drop-shadow-lg" />
                        ) : (
                          <Shield className="w-14 h-14" style={{ color: team.color, opacity: 0.25 }} />
                        )}
                      </div>
                      <div className="p-5">
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="font-heading font-black text-xl">{team.name}</h3>
                          <div className="text-right">
                            <div className="font-heading font-black text-2xl" style={{ color: team.color }}>{total}</div>
                            <div className="text-xs text-muted-foreground uppercase tracking-wider">punten</div>
                          </div>
                        </div>
                        {team.description && (
                          <p className="text-sm text-muted-foreground mb-4 line-clamp-2">{team.description}</p>
                        )}

                        <div className="flex gap-4 text-sm text-muted-foreground border-t border-border pt-4 mt-4">
                          <span className="flex items-center gap-1">
                            <Users className="w-3.5 h-3.5" />
                            {members.length} drivers
                          </span>
                          <span className="flex items-center gap-1">
                            <Trophy className="w-3.5 h-3.5" />
                            {wins} wins
                          </span>
                        </div>

                        {members.length > 0 && (
                          <div className="mt-3 space-y-1">
                            {members.map((m: any) => (
                              <div key={m.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                                <div
                                  className="w-1.5 h-1.5 rounded-full"
                                  style={{ backgroundColor: team.color }}
                                />
                                {m.profiles?.display_name || m.profiles?.iracing_name || "Unknown Driver"}
                                {m.role === "reserve" && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground">Reserve</span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* Team Standings */}
        {teams && teams.length > 0 && results && results.length > 0 && (
          <section className="py-12 bg-card/30">
            <div className="container mx-auto px-4">
              <div className="flex items-center gap-2 mb-2">
                <Trophy className="w-5 h-5 text-accent" />
                <span className="text-sm font-medium text-accent uppercase tracking-[0.15em]">Championship</span>
              </div>
              <h2 className="font-heading text-3xl font-black mb-8">TEAM STANDINGS</h2>
              <div className="bg-card border border-border rounded-lg overflow-hidden">
                <div className="grid grid-cols-[3rem_1fr_5rem_5rem] gap-2 px-4 py-3 bg-secondary/50 text-xs font-bold uppercase tracking-wider text-muted-foreground border-b border-border">
                  <span>Pos</span>
                  <span>Team</span>
                  <span className="text-center">Wins</span>
                  <span className="text-center">Pts</span>
                </div>
                {[...teams]
                  .map((t: any) => ({ ...t, ...getTeamPoints(t.id) }))
                  .sort((a: any, b: any) => b.total - a.total)
                  .map((team: any, i: number) => (
                    <div
                      key={team.id}
                      className={`grid grid-cols-[3rem_1fr_5rem_5rem] gap-2 px-4 py-3.5 items-center border-b border-border/50 hover:bg-secondary/30 transition-colors ${i === 0 ? "racing-stripe-left" : ""}`}
                    >
                      <span className={`font-heading font-black text-lg ${i === 0 ? "text-accent" : i < 3 ? "text-primary" : "text-muted-foreground"}`}>{i + 1}</span>
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-8 rounded-sm" style={{ backgroundColor: team.color }} />
                        <span className="font-heading font-bold">{team.name}</span>
                      </div>
                      <span className="text-center font-heading font-bold">{team.wins}</span>
                      <span className="text-center font-heading font-black text-lg">{team.total}</span>
                    </div>
                  ))}
              </div>
            </div>
          </section>
        )}
      </main>
      <Footer />
    </div>
  );
};

export default TeamsPage;
