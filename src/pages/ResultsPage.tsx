import Navbar from "@/components/Navbar";
import StickyRaceBar from "@/components/StickyRaceBar";
import Footer from "@/components/Footer";
import { motion } from "framer-motion";
import { List, Trophy, AlertTriangle, Flag, ChevronDown, ChevronUp } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";

const positionColors: Record<number, string> = {
  1: "text-yellow-400",
  2: "text-slate-300",
  3: "text-amber-600",
};

const PODIUM_COLORS = [
  { text: "#facc15", bg: "rgba(250,204,21,0.10)", border: "rgba(250,204,21,0.25)" },
  { text: "#94a3b8", bg: "rgba(148,163,184,0.08)", border: "rgba(148,163,184,0.20)" },
  { text: "#d97706", bg: "rgba(217,119,6,0.08)",   border: "rgba(217,119,6,0.20)"  },
];

const STALE = 5 * 60 * 1000;

type RaceDetailResult = {
  id: string;
  user_id: string;
  position: number | null;
  points: number | null;
  laps: number | null;
  best_lap: string | null;
  fastest_lap: boolean | null;
  incidents: number | null;
  dnf: boolean | null;
  gap_to_leader: string | null;
  profiles: {
    display_name: string | null;
    iracing_name: string | null;
  } | null;
};

type CompletedRace = {
  id: string;
  name: string;
  track: string;
  race_date: string;
  round: number | null;
  leagues: {
    name: string;
    car_class: string | null;
  } | null;
};

type RaceWinner = {
  race_id: string;
  profiles: {
    display_name: string | null;
    iracing_name: string | null;
  } | null;
};

// Separate component so hooks run per expanded race, not for all races at once
const ExpandedRaceContent = ({ raceId }: { raceId: string }) => {
  const { data: results = [], isLoading } = useQuery({
    queryKey: ["race-results-detail", raceId],
    staleTime: STALE,
    queryFn: async (): Promise<RaceDetailResult[]> => {
      const { data, error } = await supabase
        .from("race_results")
        .select("*, profiles(display_name, iracing_name)")
        .eq("race_id", raceId)
        .order("position", { ascending: true });
      if (error) throw error;
      return (data || []) as RaceDetailResult[];
    },
  });

  const { data: penalties = [] } = useQuery({
    queryKey: ["race-penalties-detail", raceId],
    staleTime: STALE,
    queryFn: async () => {
      const { data } = await supabase
        .from("penalties")
        .select("user_id, penalty_type, points_deduction")
        .eq("race_id", raceId);
      return (data || []) as { user_id: string; penalty_type: string; points_deduction: number }[];
    },
  });

  if (isLoading) {
    return (
      <div className="px-6 py-6 border-t border-border">
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="h-10 bg-secondary/30 rounded animate-pulse" />)}
        </div>
      </div>
    );
  }

  if (!results.length) {
    return (
      <div className="px-6 py-8 text-center text-muted-foreground border-t border-border">
        <p className="text-sm">Geen resultaten beschikbaar voor deze race.</p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      className="border-t border-border"
    >
      <div className="overflow-x-auto">
        <div className="grid grid-cols-[3rem_1fr_5rem_6rem_5rem_4rem] gap-2 px-4 py-2 bg-secondary/30 text-xs font-bold uppercase tracking-wider text-muted-foreground min-w-[500px]">
          <span>Pos</span>
          <span>Driver</span>
          <span className="text-center">Laps</span>
          <span className="text-center">Best Lap</span>
          <span className="text-center hidden md:block">Inc.</span>
          <span className="text-center">Pts</span>
        </div>
        {results.map((result) => {
          const pen = penalties.find((p) => p.user_id === result.user_id && p.penalty_type !== "warning") || null;
          return (
            <div
              key={result.id}
              className={`grid grid-cols-[3rem_1fr_5rem_6rem_5rem_4rem] gap-2 px-4 py-2.5 items-center border-b border-border/30 hover:bg-secondary/20 transition-colors min-w-[500px] ${result.position !== null && result.position <= 3 ? "racing-stripe-left" : ""}`}
            >
              <span className={`font-heading font-black text-lg ${positionColors[result.position!] || "text-muted-foreground"}`}>
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
                  <span className={result.incidents > 4 ? "text-red-400" : ""}>{result.incidents}x</span>
                ) : "-"}
              </span>
              <span className="flex items-center justify-center gap-0">
                <span className="w-4 shrink-0" />
                <span className="font-heading font-black">{result.points}</span>
                <span className="w-4 shrink-0 flex items-center justify-center">
                  {pen && (
                    <span className="group relative cursor-default">
                      <AlertTriangle className="w-3.5 h-3.5 text-orange-400" />
                      <span className="absolute bottom-full right-0 mb-1.5 px-2 py-1 rounded bg-popover border border-border text-xs text-foreground whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                        {pen.penalty_type === "disqualification" ? "DSQ — Steward" : `-${pen.points_deduction}pt — Steward`}
                      </span>
                    </span>
                  )}
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
};

const ResultsPage = () => {
  const [expandedRace, setExpandedRace] = useState<string | null>(null);

  const { data: races, isLoading } = useQuery({
    queryKey: ["completed-races"],
    staleTime: STALE,
    queryFn: async (): Promise<CompletedRace[]> => {
      const { data, error } = await supabase
        .from("races")
        .select("*, leagues(name, car_class)")
        .eq("status", "completed")
        .order("race_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as CompletedRace[];
    },
  });

  const { data: winners } = useQuery({
    queryKey: ["race-winners"],
    staleTime: STALE,
    queryFn: async (): Promise<RaceWinner[]> => {
      const { data } = await supabase
        .from("race_results")
        .select("race_id, profiles(display_name, iracing_name)")
        .eq("position", 1);
      return (data || []) as RaceWinner[];
    },
  });

  const latestRace = races?.[0];

  // Same queryKey as ExpandedRaceContent — cache shared when user expands this race
  const { data: latestResults = [], isLoading: latestLoading } = useQuery({
    queryKey: ["race-results-detail", latestRace?.id],
    enabled: !!latestRace?.id,
    staleTime: STALE,
    queryFn: async (): Promise<RaceDetailResult[]> => {
      const { data, error } = await supabase
        .from("race_results")
        .select("*, profiles(display_name, iracing_name)")
        .eq("race_id", latestRace!.id)
        .order("position", { ascending: true });
      if (error) throw error;
      return (data || []) as RaceDetailResult[];
    },
  });

  // Spotlight computations
  const spFinishers = latestResults.filter((r) => !r.dnf);
  const spPodium = spFinishers.slice(0, 3);
  const spFastest = latestResults.find((r) => r.fastest_lap);
  const spDnfCount = latestResults.filter((r) => r.dnf).length;
  const spFinishersWithInc = spFinishers.filter((r) => r.incidents != null);
  const spCleanest = spFinishersWithInc.length
    ? spFinishersWithInc.reduce((best, r) =>
        (r.incidents ?? 0) < (best.incidents ?? 0) ||
        ((r.incidents ?? 0) === (best.incidents ?? 0) && (r.position ?? 99) < (best.position ?? 99))
          ? r : best
      )
    : null;
  const spTotalInc = latestResults.reduce((sum, r) => sum + (r.incidents ?? 0), 0);
  const spHasIncData = latestResults.some((r) => r.incidents != null);

  const spDriverName = (r: RaceDetailResult) =>
    r.profiles?.display_name || r.profiles?.iracing_name || "Onbekend";

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <StickyRaceBar />
      <main className="pt-[108px]">
        <section className="py-12 bg-gradient-to-b from-card/50 to-transparent border-b border-border">
          <div className="container mx-auto px-4">
            <div className="flex items-center gap-2 mb-2">
              <List className="w-5 h-5 text-accent" />
              <span className="text-sm font-medium text-accent uppercase tracking-[0.15em]">3SM</span>
            </div>
            <h1 className="font-heading text-4xl md:text-5xl font-black">UITSLAGEN</h1>
            <p className="text-muted-foreground mt-2">Alle race uitslagen en klassementen</p>
          </div>
        </section>

        <section className="py-12">
          <div className="container mx-auto px-4">

            {/* Latest Result Spotlight */}
            {!isLoading && latestRace && (
              <div className="mb-10">
                <div className="flex items-center gap-2 mb-4">
                  <Flag className="w-4 h-4 text-orange-500" />
                  <span className="text-xs font-black text-orange-500 uppercase tracking-[0.25em]">Laatste Uitslag</span>
                </div>

                {latestLoading ? (
                  <div className="h-48 bg-card rounded-lg animate-pulse border border-border" />
                ) : latestResults.length === 0 ? (
                  <div className="bg-card border border-border rounded-lg px-6 py-8 text-center text-muted-foreground text-sm">
                    Nog geen detailresultaten beschikbaar.
                  </div>
                ) : (
                  <div className="bg-card border border-orange-500/20 rounded-lg overflow-hidden">
                    <div className="h-0.5" style={{ background: "linear-gradient(90deg, #f97316, transparent)" }} />

                    {/* Race meta */}
                    <div className="px-6 py-4 flex flex-wrap items-center gap-3 border-b border-border">
                      <div className="flex items-center gap-2">
                        {latestRace.round != null && (
                          <span className="font-heading font-black text-sm text-muted-foreground">
                            R{String(latestRace.round).padStart(2, "0")}
                          </span>
                        )}
                        <h3 className="font-heading font-black text-lg">{latestRace.name}</h3>
                      </div>
                      {latestRace.leagues?.name && (
                        <span className="text-xs px-2 py-0.5 rounded bg-secondary text-secondary-foreground">
                          {latestRace.leagues.name}
                        </span>
                      )}
                      <div className="flex items-center gap-2 text-sm text-muted-foreground ml-auto">
                        <span>{latestRace.track}</span>
                        <span>·</span>
                        <span>
                          {new Date(latestRace.race_date).toLocaleDateString("nl-NL", {
                            day: "numeric", month: "long", timeZone: "Europe/Amsterdam",
                          })}
                        </span>
                      </div>
                    </div>

                    {/* Podium + highlights */}
                    <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border">

                      {/* Podium */}
                      <div className="p-6">
                        <div className="text-[10px] font-black text-muted-foreground uppercase tracking-widest mb-4">Podium</div>
                        <div className="space-y-2.5">
                          {spPodium.map((r, i) => {
                            const c = PODIUM_COLORS[i];
                            return (
                              <div
                                key={r.user_id}
                                className="flex items-center gap-3 rounded-lg px-4 py-3"
                                style={{ background: c.bg, border: `1px solid ${c.border}` }}
                              >
                                <div
                                  className="w-8 h-8 rounded-lg flex items-center justify-center font-heading font-black text-sm shrink-0"
                                  style={{ background: `${c.text}20`, color: c.text }}
                                >
                                  {i + 1}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="font-heading font-bold text-sm truncate">{spDriverName(r)}</div>
                                  {i > 0 && r.gap_to_leader && (
                                    <div className="text-[10px] text-muted-foreground">+{r.gap_to_leader}</div>
                                  )}
                                </div>
                                <div className="text-right shrink-0">
                                  <div className="font-heading font-black text-base" style={{ color: c.text }}>{r.points}</div>
                                  <div className="text-[10px] text-muted-foreground">pts</div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Highlights */}
                      <div className="p-6">
                        <div className="text-[10px] font-black text-muted-foreground uppercase tracking-widest mb-4">Highlights</div>
                        <div className="space-y-3">

                          {spFastest && (
                            <div
                              className="flex items-start gap-3 rounded-lg px-4 py-3"
                              style={{ background: "rgba(167,139,250,0.08)", border: "1px solid rgba(167,139,250,0.2)" }}
                            >
                              <span className="text-base shrink-0 leading-none mt-0.5">⚡</span>
                              <div className="min-w-0">
                                <div className="text-[10px] font-black text-purple-400 uppercase tracking-widest mb-0.5">Snelste ronde</div>
                                <div className="font-heading font-bold text-sm truncate">{spDriverName(spFastest)}</div>
                                {spFastest.best_lap && (
                                  <div className="text-[11px] font-mono text-purple-300 mt-0.5">{spFastest.best_lap}</div>
                                )}
                              </div>
                            </div>
                          )}

                          {spCleanest && (
                            <div
                              className="flex items-start gap-3 rounded-lg px-4 py-3"
                              style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.15)" }}
                            >
                              <span className="text-base shrink-0 leading-none mt-0.5">🧊</span>
                              <div className="min-w-0">
                                <div className="text-[10px] font-black text-green-500 uppercase tracking-widest mb-0.5">Clean drive</div>
                                <div className="font-heading font-bold text-sm truncate">{spDriverName(spCleanest)}</div>
                                <div className="text-[11px] text-green-400 mt-0.5">{spCleanest.incidents} inc</div>
                              </div>
                            </div>
                          )}

                          <div
                            className="flex items-center gap-4 rounded-lg px-4 py-3"
                            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
                          >
                            <div className="text-center">
                              <div className="font-heading font-black text-lg leading-none">{spFinishers.length}</div>
                              <div className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">Finishers</div>
                            </div>
                            {spDnfCount > 0 && (
                              <>
                                <div className="w-px h-8 bg-border" />
                                <div className="text-center">
                                  <div className="font-heading font-black text-lg text-red-400 leading-none">{spDnfCount}</div>
                                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">DNF</div>
                                </div>
                              </>
                            )}
                            {spHasIncData && (
                              <>
                                <div className="w-px h-8 bg-border" />
                                <div className="text-center">
                                  <div className="font-heading font-black text-lg text-orange-400 leading-none">{spTotalInc}</div>
                                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">Incidents</div>
                                </div>
                              </>
                            )}
                          </div>

                        </div>
                      </div>
                    </div>

                    {/* CTA */}
                    <div className="px-6 py-4 border-t border-border">
                      <button
                        onClick={() => setExpandedRace(latestRace.id)}
                        className="text-sm font-heading font-bold text-orange-500 hover:text-orange-400 transition-colors flex items-center gap-1"
                      >
                        Bekijk volledige uitslag <ChevronDown className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Race archive */}
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
              <>
                <div className="mb-6">
                  <div className="flex items-center gap-2 mb-0.5">
                    <Flag className="w-4 h-4 text-orange-500" />
                    <span className="text-xs font-black text-orange-500 uppercase tracking-[0.25em]">Race Archief</span>
                  </div>
                  <p className="text-xs text-muted-foreground ml-6">Alle afgeronde races</p>
                </div>
              <div className="space-y-4">
                {races.map((race, i) => {
                  const winner = winners?.find((w) => w.race_id === race.id);
                  const isExpanded = expandedRace === race.id;

                  return (
                    <motion.div
                      key={race.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04 }}
                      className="bg-card border border-border rounded-lg overflow-hidden"
                    >
                      <button
                        onClick={() => setExpandedRace(isExpanded ? null : race.id)}
                        className="w-full px-6 py-4 flex items-center gap-4 hover:bg-secondary/30 transition-colors text-left"
                      >
                        <div className="w-10 shrink-0 flex flex-col items-center justify-center">
                          {race.round != null && (
                            <>
                              <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50 leading-none mb-0.5">Ronde</span>
                              <span className="font-heading font-black text-lg text-muted-foreground leading-none">{String(race.round).padStart(2, "0")}</span>
                            </>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-heading font-bold text-lg">{race.name}</h3>
                          <div className="flex flex-wrap gap-3 text-sm text-muted-foreground mt-0.5">
                            <span>{race.track}</span>
                            {race.leagues?.name && (
                              <span className="text-xs px-2 py-0.5 rounded bg-secondary text-secondary-foreground">
                                {race.leagues.name}
                              </span>
                            )}
                            <span>{new Date(race.race_date).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" })}</span>
                          </div>
                          {winner && (
                            <div className="flex items-center gap-1 mt-1.5 md:hidden">
                              <Trophy className="w-3 h-3 text-yellow-400 shrink-0" />
                              <span className="font-heading font-bold text-sm text-yellow-400 truncate">
                                {winner.profiles?.display_name || winner.profiles?.iracing_name || "Unknown"}
                              </span>
                            </div>
                          )}
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

                      {isExpanded && <ExpandedRaceContent raceId={race.id} />}
                    </motion.div>
                  );
                })}
              </div>
              </>
            )}
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default ResultsPage;
