import { motion, AnimatePresence } from "framer-motion";
import { Calendar, MapPin, Clock, UserPlus, Check, Lock, Users, Timer, Flag, CloudSun, Gauge, AlertCircle, X } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { useState } from "react";

const statusStyles: Record<string, string> = {
  completed: "bg-muted text-muted-foreground",
  upcoming:  "bg-primary/10 text-primary border border-primary/20",
  live:      "bg-primary text-primary-foreground animate-pulse-glow",
};

const statusLabels: Record<string, string> = {
  completed: "Afgelopen",
  upcoming:  "Upcoming",
  live:      "🔴 LIVE",
};

const UpcomingRaces = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [showProfileWarning, setShowProfileWarning] = useState(false);

  const { data: races, isLoading } = useQuery({
    queryKey: ["races-with-leagues"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("races")
        .select("*, leagues(name, car_class, id)")
        .order("race_date", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const { data: profile } = useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("iracing_id, iracing_name").eq("user_id", user!.id).maybeSingle();
      return data;
    },
  });

  const profileComplete = !!(profile as any)?.iracing_id && !!(profile as any)?.iracing_name;

  // All league IDs referenced by races
  const leagueIds = [...new Set((races || []).map((r: any) => r.league_id))];

  // Season registrations for all leagues
  const { data: seasonRegs } = useQuery({
    queryKey: ["season-registrations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("season_registrations")
        .select("*");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: raceRegs } = useQuery({
    queryKey: ["race-registrations"],
    queryFn: async () => {
      const { data, error } = await supabase.from("race_registrations").select("*");
      if (error) throw error;
      return data || [];
    },
  });

  const isRegisteredForRace = (raceId: string) =>
    user && (raceRegs || []).some((r: any) => r.race_id === raceId && r.user_id === user.id);

  const raceRegCount = (raceId: string) =>
    (raceRegs || []).filter((r: any) => r.race_id === raceId).length;

  const registerForRace = useMutation({
    mutationFn: async (raceId: string) => {
      const { error } = await (supabase as any).from("race_registrations").insert({
        race_id: raceId,
        user_id: user!.id,
        status: "registered",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Ingeschreven voor race!");
      queryClient.invalidateQueries({ queryKey: ["race-registrations"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const unregisterFromRace = useMutation({
    mutationFn: async (raceId: string) => {
      const { error } = await (supabase as any)
        .from("race_registrations")
        .delete()
        .eq("race_id", raceId)
        .eq("user_id", user!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Uitgeschreven van race");
      queryClient.invalidateQueries({ queryKey: ["race-registrations"] });
    },
  });

  // Is this season "started" = has at least one completed race?
  const seasonStarted = (leagueId: string) => {
    return (races || []).some((r: any) => r.league_id === leagueId && r.status === "completed");
  };

  const isRegisteredForSeason = (leagueId: string) =>
    user && (seasonRegs || []).some((r: any) => r.league_id === leagueId && r.user_id === user.id);

  const registrationCount = (leagueId: string) =>
    (seasonRegs || []).filter((r: any) => r.league_id === leagueId).length;

  const registerForSeason = useMutation({
    mutationFn: async (leagueId: string) => {
      const { error } = await (supabase as any).from("season_registrations").insert({
        league_id: leagueId,
        user_id: user!.id,
        status: "registered",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Ingeschreven voor het seizoen!");
      queryClient.invalidateQueries({ queryKey: ["season-registrations"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const unregisterFromSeason = useMutation({
    mutationFn: async (leagueId: string) => {
      const { error } = await (supabase as any)
        .from("season_registrations")
        .delete()
        .eq("league_id", leagueId)
        .eq("user_id", user!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Uitgeschreven van seizoen");
      queryClient.invalidateQueries({ queryKey: ["season-registrations"] });
    },
  });

  if (isLoading) {
    return (
      <section className="py-20">
        <div className="container mx-auto px-4">
          <div className="animate-pulse space-y-3">
            {[1, 2, 3].map((i) => <div key={i} className="h-20 bg-card rounded-lg" />)}
          </div>
        </div>
      </section>
    );
  }

  if (!races?.length) {
    return (
      <section className="py-20">
        <div className="container mx-auto px-4">
          <div className="flex items-center gap-2 mb-2">
            <Calendar className="w-5 h-5 text-primary" />
            <span className="text-sm font-medium text-primary uppercase tracking-[0.15em]">Race Kalender</span>
          </div>
          <h2 className="font-heading text-3xl md:text-4xl font-black mb-10">RACE KALENDER</h2>
          <div className="text-center py-12 text-muted-foreground">
            <Calendar className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p>Nog geen races gepland. Check later terug!</p>
          </div>
        </div>
      </section>
    );
  }

  // Group races by league
  const leagueGroups = leagueIds.map((lid) => ({
    leagueId: lid,
    leagueName: (races.find((r: any) => r.league_id === lid) as any)?.leagues?.name || "Unknown",
    carClass: (races.find((r: any) => r.league_id === lid) as any)?.leagues?.car_class,
    races: races.filter((r: any) => r.league_id === lid),
  }));

  return (
    <section className="py-20">
      <div className="container mx-auto px-4">
        <div className="flex items-center gap-2 mb-2">
          <Calendar className="w-5 h-5 text-primary" />
          <span className="text-sm font-medium text-primary uppercase tracking-[0.15em]">Race Kalender</span>
        </div>
        <h2 className="font-heading text-3xl md:text-4xl font-black mb-10">RACE KALENDER</h2>

        <div className="space-y-10">
          {leagueGroups.map(({ leagueId, leagueName, carClass, races: leagueRaces }) => {
            const started = seasonStarted(leagueId);
            const registered = isRegisteredForSeason(leagueId);
            const regCount = registrationCount(leagueId);

            return (
              <div key={leagueId}>
                {/* Season header + registration */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 pb-4 border-b border-border">
                  <div>
                    <h3 className="font-heading font-black text-xl">{leagueName}</h3>
                    <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                      {carClass && <span className="px-2 py-0.5 rounded bg-secondary text-xs font-bold">{carClass}</span>}
                      <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{regCount} ingeschreven</span>
                      {started && (
                        <span className="flex items-center gap-1 text-yellow-500 text-xs font-bold">
                          <Lock className="w-3 h-3" /> Seizoen gestart — inschrijving gesloten
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Season registration button */}
                  {!started ? (
                    user ? (
                      registered ? (
                        <button
                          onClick={() => unregisterFromSeason.mutate(leagueId)}
                          disabled={unregisterFromSeason.isPending}
                          className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-bold bg-accent/20 text-accent border border-accent/30 hover:bg-accent/30 transition-colors"
                        >
                          <Check className="w-4 h-4" />
                          Ingeschreven — Uitschrijven
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            if (!profileComplete) { setShowProfileWarning(true); return; }
                            registerForSeason.mutate(leagueId);
                          }}
                          disabled={registerForSeason.isPending}
                          className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-bold bg-gradient-racing text-white hover:opacity-90 transition-opacity"
                        >
                          <UserPlus className="w-4 h-4" />
                          Inschrijven voor Seizoen
                        </button>
                      )
                    ) : (
                      <button
                        onClick={() => navigate("/auth")}
                        className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-bold border border-border text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <UserPlus className="w-4 h-4" />
                        Log in om in te schrijven
                      </button>
                    )
                  ) : (
                    <div className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-bold bg-secondary text-muted-foreground border border-border">
                      <Lock className="w-4 h-4" />
                      Inschrijving gesloten
                    </div>
                  )}
                </div>

                {/* Race list */}
                <div className="grid gap-3">
                  {leagueRaces.map((race: any, i: number) => (
                    <motion.div
                      key={race.id}
                      initial={{ opacity: 0, x: -20 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: i * 0.05 }}
                      className="group bg-card border border-border rounded-lg p-4 md:p-5 card-hover racing-stripe-left flex flex-col md:flex-row md:items-center gap-3 md:gap-6"
                    >
                      <div className="flex items-center gap-4 md:w-16 shrink-0">
                        <span className={`font-heading font-black text-2xl ${race.status === "completed" ? "text-muted-foreground/50" : "text-muted-foreground"}`}>
                          R{String(race.round).padStart(2, "0")}
                        </span>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className={`font-heading font-bold text-lg ${race.status === "completed" ? "text-muted-foreground" : ""}`}>
                            {race.name}
                          </h3>
                          {race.race_type && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-primary/10 text-primary border border-primary/20">
                              {race.race_type}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-sm text-muted-foreground mt-1 flex-wrap">
                          <span className="flex items-center gap-1">
                            <MapPin className="w-3.5 h-3.5 shrink-0" />
                            {race.track}
                          </span>
                        </div>
                        {(race.race_duration || race.practice_duration || race.qualifying_duration || race.start_type || race.weather) && (
                          <div className="flex items-center gap-3 mt-2 flex-wrap">
                            {race.race_duration && (
                              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Timer className="w-3 h-3" /> {race.race_duration}
                              </span>
                            )}
                            {race.practice_duration && (
                              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Gauge className="w-3 h-3" /> Practice {race.practice_duration}
                              </span>
                            )}
                            {race.qualifying_duration && (
                              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Clock className="w-3 h-3" /> Quali {race.qualifying_duration}
                              </span>
                            )}
                            {race.start_type && (
                              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Flag className="w-3 h-3" /> {race.start_type} start
                              </span>
                            )}
                            {race.weather && (
                              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                <CloudSun className="w-3 h-3" /> {race.weather}
                              </span>
                            )}
                            {race.setup && (
                              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Gauge className="w-3 h-3" /> Setup: {race.setup}
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-col items-end gap-2 shrink-0">
                        <div className="flex items-center gap-4 text-sm">
                          <span className="flex items-center gap-1.5 text-muted-foreground">
                            <Calendar className="w-3.5 h-3.5" />
                            {new Date(race.race_date).toLocaleDateString("nl-NL", { day: "numeric", month: "short" })}
                          </span>
                          <span className="flex items-center gap-1.5 text-muted-foreground">
                            <Clock className="w-3.5 h-3.5" />
                            {new Date(race.race_date).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                        <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider w-fit ${statusStyles[race.status] || statusStyles.upcoming}`}>
                          {statusLabels[race.status] || race.status}
                        </span>
                        {race.status !== "completed" && user && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Users className="w-3 h-3" />{raceRegCount(race.id)}
                            </span>
                            {isRegisteredForRace(race.id) ? (
                              <button
                                onClick={() => unregisterFromRace.mutate(race.id)}
                                disabled={unregisterFromRace.isPending}
                                className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold bg-accent/20 text-accent border border-accent/30 hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/30 transition-colors"
                              >
                                <Check className="w-3 h-3" /> Aangemeld
                              </button>
                            ) : (
                              <button
                                onClick={() => {
                                  if (!profileComplete) { setShowProfileWarning(true); return; }
                                  registerForRace.mutate(race.id);
                                }}
                                disabled={registerForRace.isPending}
                                className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold bg-secondary border border-border hover:border-primary/50 hover:text-primary transition-colors"
                              >
                                <UserPlus className="w-3 h-3" /> Aanmelden
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Profile incomplete warning modal */}
      <AnimatePresence>
        {showProfileWarning && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 z-50"
              onClick={() => setShowProfileWarning(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md px-4"
            >
              <div className="bg-card border border-border rounded-xl p-6 shadow-2xl">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-yellow-500/15 border border-yellow-500/30 flex items-center justify-center shrink-0">
                      <AlertCircle className="w-5 h-5 text-yellow-400" />
                    </div>
                    <h3 className="font-heading font-black text-lg">Profiel incompleet</h3>
                  </div>
                  <button onClick={() => setShowProfileWarning(false)} className="text-muted-foreground hover:text-foreground transition-colors">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <p className="text-sm text-muted-foreground mb-4">
                  Om je in te schrijven voor een seizoen moet je eerst je iRacing gegevens invullen. Dit is nodig om je resultaten correct te koppelen.
                </p>

                <div className="space-y-2 mb-5">
                  <div className={`flex items-center gap-2 text-sm px-3 py-2 rounded-md ${(profile as any)?.iracing_id ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
                    <div className={`w-1.5 h-1.5 rounded-full ${(profile as any)?.iracing_id ? "bg-green-400" : "bg-red-400"}`} />
                    iRacing Customer ID — {(profile as any)?.iracing_id ? "ingevuld ✓" : "nog niet ingevuld"}
                  </div>
                  <div className={`flex items-center gap-2 text-sm px-3 py-2 rounded-md ${(profile as any)?.iracing_name ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
                    <div className={`w-1.5 h-1.5 rounded-full ${(profile as any)?.iracing_name ? "bg-green-400" : "bg-red-400"}`} />
                    iRacing Naam — {(profile as any)?.iracing_name ? `"${(profile as any).iracing_name}" ✓` : "nog niet ingevuld"}
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => { setShowProfileWarning(false); navigate("/profile"); }}
                    className="flex-1 px-4 py-2.5 rounded-md bg-gradient-racing text-white font-heading font-bold text-sm hover:opacity-90 transition-opacity"
                  >
                    Naar mijn profiel
                  </button>
                  <button
                    onClick={() => setShowProfileWarning(false)}
                    className="px-4 py-2.5 rounded-md border border-border text-muted-foreground font-heading font-bold text-sm hover:text-foreground transition-colors"
                  >
                    Annuleren
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </section>
  );
};

export default UpcomingRaces;
