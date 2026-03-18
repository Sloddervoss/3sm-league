import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { motion } from "framer-motion";
import { List, Trophy, Clock, AlertTriangle, Flag, ChevronDown, ChevronUp } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";

const positionColors: Record<number, string> = {
  1: "text-yellow-400",
  2: "text-slate-300",
  3: "text-amber-600",
};

const ResultsPage = () => {
  const [expandedRace, setExpandedRace] = useState<string | null>(null);

  const { data: races, isLoading } = useQuery({
    queryKey: ["completed-races"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("races")
        .select("*, leagues(name, car_class)")
        .eq("status", "completed")
        .order("race_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: results } = useQuery({
    queryKey: ["all-results-with-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("race_results")
        .select("*, profiles(display_name, iracing_name)");
      if (error) throw error;
      return data;
    },
  });

  const getRaceResults = (raceId: string) =>
    (results || [])
      .filter((r: any) => r.race_id === raceId)
      .sort((a: any, b: any) => a.position - b.position);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-16">
        {/* Header */}
        <section className="py-12 bg-gradient-to-b from-card/50 to-transparent border-b border-border">
          <div className="container mx-auto px-4">
            <div className="flex items-center gap-2 mb-2">
              <List className="w-5 h-5 text-accent" />
              <span className="text-sm font-medium text-accent uppercase tracking-[0.15em]">3SM</span>
            </div>
            <h1 className="font-heading text-4xl md:text-5xl font-black">RACE RESULTS</h1>
            <p className="text-muted-foreground mt-2">Alle race uitslagen en klassementen</p>
          </div>
        </section>

        <section className="py-12">
          <div className="container mx-auto px-4">
            {isLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => <div key={i} className="h-20 bg-card rounded-lg animate-pulse" />)}
              </div>
            ) : !races?.length ? (
              <div className="text-center py-24 text-muted-foreground">
                <Flag className="w-12 h-12 mx-auto mb-4 opacity-40" />
                <p className="text-lg font-heading font-bold">GEEN RESULTATEN</p>
                <p className="text-sm mt-1">Er zijn nog geen race resultaten beschikbaar.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {races.map((race: any, i: number) => {
                  const raceResults = getRaceResults(race.id);
                  const winner = raceResults[0];
                  const isExpanded = expandedRace === race.id;

                  return (
                    <motion.div
                      key={race.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04 }}
                      className="bg-card border border-border rounded-lg overflow-hidden"
                    >
                      {/* Race header */}
                      <button
                        onClick={() => setExpandedRace(isExpanded ? null : race.id)}
                        className="w-full px-6 py-4 flex items-center gap-4 hover:bg-secondary/30 transition-colors text-left"
                      >
                        <div className="font-heading font-black text-2xl text-muted-foreground w-10 shrink-0">
                          R{String(race.round).padStart(2, "0")}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-heading font-bold text-lg">{race.name}</h3>
                          <div className="flex flex-wrap gap-3 text-sm text-muted-foreground mt-0.5">
                            <span>{race.track}</span>
                            {(race as any).leagues?.name && (
                              <span className="text-xs px-2 py-0.5 rounded bg-secondary text-secondary-foreground">
                                {(race as any).leagues.name}
                              </span>
                            )}
                            <span>{new Date(race.race_date).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" })}</span>
                          </div>
                        </div>
                        {winner && (
                          <div className="hidden md:flex items-center gap-3 shrink-0">
                            <div className="text-right">
                              <div className="text-xs text-muted-foreground uppercase tracking-wider mb-0.5">Winner</div>
                              <div className="font-heading font-bold text-yellow-400">
                                {winner.profiles?.display_name || winner.profiles?.iracing_name || "Unknown"}
                              </div>
                            </div>
                            <Trophy className="w-5 h-5 text-yellow-400" />
                          </div>
                        )}
                        <div className="shrink-0 text-muted-foreground">
                          {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                        </div>
                      </button>

                      {/* Expanded results table */}
                      {isExpanded && raceResults.length > 0 && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          className="border-t border-border"
                        >
                          <div className="overflow-x-auto">
                          <div className="grid grid-cols-[3rem_1fr_5rem_6rem_5rem_4rem] gap-2 px-4 py-2 bg-secondary/30 text-xs font-bold uppercase tracking-wider text-muted-foreground min-w-[380px]">
                            <span>Pos</span>
                            <span>Driver</span>
                            <span className="text-center">Laps</span>
                            <span className="text-center">Best Lap</span>
                            <span className="text-center hidden md:block">Inc.</span>
                            <span className="text-center">Pts</span>
                          </div>
                          {raceResults.map((result: any) => (
                            <div
                              key={result.id}
                              className={`grid grid-cols-[3rem_1fr_5rem_6rem_5rem_4rem] gap-2 px-4 py-2.5 items-center border-b border-border/30 hover:bg-secondary/20 transition-colors ${result.position <= 3 ? "racing-stripe-left" : ""}`}
                            >
                              <span className={`font-heading font-black text-lg ${positionColors[result.position] || "text-muted-foreground"}`}>
                                {result.dnf ? "DNF" : result.position}
                              </span>
                              <div>
                                <span className="font-heading font-bold text-sm">
                                  {result.profiles?.display_name || result.profiles?.iracing_name || "Unknown"}
                                </span>
                                {result.fastest_lap && (
                                  <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 border border-purple-500/30 font-bold">FL</span>
                                )}
                              </div>
                              <span className="text-center text-sm text-muted-foreground">{result.laps || "-"}</span>
                              <span className="text-center text-sm font-mono text-muted-foreground">{result.best_lap || "-"}</span>
                              <span className="text-center text-sm text-muted-foreground hidden md:block">
                                {result.incidents != null ? (
                                  <span className={result.incidents > 4 ? "text-red-400" : ""}>
                                    {result.incidents}x
                                  </span>
                                ) : "-"}
                              </span>
                              <span className="text-center font-heading font-black">{result.points}</span>
                            </div>
                          ))}
                          </div>
                        </motion.div>
                      )}

                      {isExpanded && raceResults.length === 0 && (
                        <div className="px-6 py-8 text-center text-muted-foreground border-t border-border">
                          <p className="text-sm">Geen resultaten beschikbaar voor deze race.</p>
                        </div>
                      )}
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

export default ResultsPage;
