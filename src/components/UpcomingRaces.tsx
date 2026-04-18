import { motion, AnimatePresence } from "framer-motion";
import { Calendar, MapPin, Clock, UserPlus, Check, Lock, Users, Timer, Flag, CloudSun, Gauge, AlertCircle, X, Zap } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { getTrackInfo } from "@/lib/trackData";

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

function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function formatCountdown(raceDate: string, now: Date) {
  const diff = new Date(raceDate).getTime() - now.getTime();
  if (diff <= 0) return null;
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  if (d > 0) return `${d}d ${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m`;
  if (h > 0) return `${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  return `${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}

function SessionTimeline({ practice, qualifying, race }: { practice?: string; qualifying?: string; race?: string }) {
  const sessions = [
    practice  && { label: "Practice", duration: practice,   color: "bg-blue-500/70" },
    qualifying && { label: "Qualifying", duration: qualifying, color: "bg-yellow-500/70" },
    race      && { label: "Race",     duration: race,       color: "bg-primary/80" },
  ].filter(Boolean) as { label: string; duration: string; color: string }[];

  if (!sessions.length) return null;

  return (
    <div className="flex items-center gap-1.5 mt-2 flex-wrap">
      {sessions.map((s, i) => (
        <span key={i} className={`${s.color} px-2 py-0.5 rounded text-[10px] font-bold text-white tracking-wide`}>
          {s.label} · {s.duration}
        </span>
      ))}
    </div>
  );
}

const UpcomingRaces = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [showProfileWarning, setShowProfileWarning] = useState(false);
  const now = useNow();

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

  const leagueIds = [...new Set((races || []).map((r: any) => r.league_id))];

  const { data: seasonRegs } = useQuery({
    queryKey: ["season-registrations"],
    queryFn: async () => {
      const { data, error } = await supabase.from("season_registrations").select("*");
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
      const { error } = await supabase.from("race_registrations").insert({
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
      const { error } = await supabase
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

  const seasonStarted = (leagueId: string) =>
    (races || []).some((r: any) => r.league_id === leagueId && r.status === "completed");

  const isRegisteredForSeason = (leagueId: string) =>
    user && (seasonRegs || []).some((r: any) => r.league_id === leagueId && r.user_id === user.id);

  const registrationCount = (leagueId: string) =>
    (seasonRegs || []).filter((r: any) => r.league_id === leagueId).length;

  const registerForSeason = useMutation({
    mutationFn: async (leagueId: string) => {
      const { error } = await supabase.from("season_registrations").insert({
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
      const { error } = await supabase
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

  // Find the single next upcoming race across all leagues
  const nextRace = [...(races || [])]
    .filter((r: any) => r.status !== "completed" && new Date(r.race_date) > now)
    .sort((a: any, b: any) => new Date(a.race_date).getTime() - new Date(b.race_date).getTime())[0] as any | undefined;

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

        {/* ── Next Race Hero Card ── */}
        {nextRace && (() => {
          const trackInfo = getTrackInfo(nextRace.track);
          const countdown = formatCountdown(nextRace.race_date, now);
          return (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="relative overflow-hidden rounded-xl border border-primary/30 bg-card mb-12"
            >
              {/* Racing stripe accent */}
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-racing" />
              <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-transparent to-transparent pointer-events-none" />

              <div className="relative p-6 md:p-8">
                <div className="flex items-center gap-2 mb-4">
                  <Zap className="w-4 h-4 text-primary" />
                  <span className="text-xs font-bold text-primary uppercase tracking-[0.2em]">Volgende Race</span>
                </div>

                <div className="flex flex-col md:flex-row md:items-center gap-6">
                  {/* Left: round + track info */}
                  <div className="flex-1 min-w-0">
                    <h3 className="font-heading font-black text-2xl md:text-3xl mb-1">
                      {nextRace.name}
                    </h3>
                    <div className="flex items-center gap-2 text-base text-muted-foreground mb-3">
                      <MapPin className="w-4 h-4 shrink-0" />
                      <span>{nextRace.track}</span>
                      {trackInfo?.country && (
                        <span className="text-sm opacity-60">— {trackInfo.country}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1.5">
                        <Calendar className="w-4 h-4" />
                        {new Date(nextRace.race_date).toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Amsterdam" })}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Clock className="w-4 h-4" />
                        {new Date(nextRace.race_date).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" })}
                      </span>
                      {(nextRace as any).leagues?.name && (
                        <span className="px-2 py-0.5 rounded bg-secondary text-xs font-bold">
                          {(nextRace as any).leagues.name}
                        </span>
                      )}
                    </div>
                    <SessionTimeline
                      practice={nextRace.practice_duration}
                      qualifying={nextRace.qualifying_duration}
                      race={nextRace.race_duration}
                    />
                    {(nextRace.start_type || nextRace.weather || nextRace.setup) && (
                      <div className="flex items-center gap-3 mt-2 flex-wrap">
                        {nextRace.start_type && (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Flag className="w-3 h-3" /> {nextRace.start_type} start
                          </span>
                        )}
                        {nextRace.weather && (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <CloudSun className="w-3 h-3" /> Weather: {nextRace.weather}
                          </span>
                        )}
                        {nextRace.setup && (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Gauge className="w-3 h-3" /> Setup: {nextRace.setup}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Right: circuit image + countdown + registration */}
                  <div className="flex flex-col items-start md:items-end gap-4 shrink-0">
                    {trackInfo?.imageUrl && (
                      <img
                        src={trackInfo.imageUrl}
                        alt=""
                        aria-hidden
                        className="w-36 h-24 object-contain invert opacity-30 hidden md:block"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                    )}
                    {countdown && (
                      <div className="text-right">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-0.5">Aftellen</p>
                        <p className="font-heading font-black text-3xl text-foreground tabular-nums">
                          {countdown}
                        </p>
                      </div>
                    )}
                    {user && (() => {
                      const nextSeasonReg = isRegisteredForSeason(nextRace.league_id);
                      const nextRaceReg = isRegisteredForRace(nextRace.id);
                      return (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Users className="w-3.5 h-3.5" />{raceRegCount(nextRace.id)} aangemeld
                          </span>
                          {(nextSeasonReg || nextRaceReg) ? (
                            <button
                              onClick={() => !nextSeasonReg && unregisterFromRace.mutate(nextRace.id)}
                              disabled={nextSeasonReg || unregisterFromRace.isPending}
                              title={nextSeasonReg ? "Aangemeld via seizoensinschrijving" : undefined}
                              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-bold bg-accent/20 text-accent border border-accent/30 ${nextSeasonReg ? "cursor-default opacity-80" : "hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/30 transition-colors"}`}
                            >
                              <Check className="w-3.5 h-3.5" /> Aangemeld
                            </button>
                          ) : (
                            <button
                              onClick={() => {
                                if (!profileComplete) { setShowProfileWarning(true); return; }
                                registerForRace.mutate(nextRace.id);
                              }}
                              disabled={registerForRace.isPending}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-bold bg-gradient-racing text-white hover:opacity-90 transition-opacity"
                            >
                              <UserPlus className="w-3.5 h-3.5" /> Aanmelden
                            </button>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>
            </motion.div>
          );
        })()}

        {/* ── Per-league calendar ── */}
        <div className="space-y-10">
          {leagueGroups.map(({ leagueId, leagueName, carClass, races: leagueRaces }) => {
            const started = seasonStarted(leagueId);
            const registered = isRegisteredForSeason(leagueId);
            const regCount = registrationCount(leagueId);

            return (
              <div key={leagueId}>
                {/* Season header */}
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
                  {leagueRaces.map((race: any, i: number) => {
                    const trackInfo = getTrackInfo(race.track);
                    const isNext = nextRace?.id === race.id;
                    const countdown = race.status !== "completed" ? formatCountdown(race.race_date, now) : null;

                    return (
                      <motion.div
                        key={race.id}
                        initial={{ opacity: 0, x: -20 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true }}
                        transition={{ delay: i * 0.05 }}
                        className={`group relative overflow-hidden bg-card border rounded-lg p-4 md:p-5 card-hover racing-stripe-left flex flex-col md:flex-row md:items-center gap-3 md:gap-6 ${
                          isNext ? "border-primary/40 shadow-[0_0_20px_rgba(var(--primary),0.08)]" : "border-border"
                        }`}
                      >
                        {/* Round number / circuit map */}
                        <div className="md:w-20 shrink-0 flex items-center justify-center relative self-stretch">
                          {trackInfo?.imageUrl ? (
                            <div className="relative w-16 h-14 flex items-center justify-center">
                              <img
                                src={trackInfo.imageUrl}
                                alt=""
                                aria-hidden
                                className="w-full h-full object-contain invert opacity-40"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = "none";
                                  const fb = (e.target as HTMLImageElement).nextElementSibling as HTMLElement | null;
                                  if (fb) fb.style.display = "block";
                                }}
                              />
                              <span className="absolute bottom-0 left-0 font-heading font-black text-[10px] text-muted-foreground/40 hidden" data-fallback>
                                R{String(race.round).padStart(2, "0")}
                              </span>
                            </div>
                          ) : (
                            <span className={`font-heading font-black text-2xl ${race.status === "completed" ? "text-muted-foreground/40" : isNext ? "text-primary/60" : "text-muted-foreground"}`}>
                              R{String(race.round).padStart(2, "0")}
                            </span>
                          )}
                        </div>

                        {/* Track info */}
                        <div className="flex-1 min-w-0 relative">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className={`font-heading font-bold text-lg ${race.status === "completed" ? "text-muted-foreground" : ""}`}>
                              {race.name}
                            </h3>
                            {race.race_type && (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-primary/10 text-primary border border-primary/20">
                                {race.race_type}
                              </span>
                            )}
                            {isNext && (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-primary/20 text-primary border border-primary/30">
                                Volgende race
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                            <MapPin className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate">{race.track}</span>
                          </div>
                          <SessionTimeline
                            practice={race.practice_duration}
                            qualifying={race.qualifying_duration}
                            race={race.race_duration}
                          />
                          {(race.start_type || race.weather || race.setup) && (
                            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                              {race.start_type && (
                                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <Flag className="w-3 h-3" /> {race.start_type} start
                                </span>
                              )}
                              {race.weather && (
                                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <CloudSun className="w-3 h-3" /> Weather: {race.weather}
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

                        {/* Right: date + status + countdown + registration */}
                        <div className="flex flex-col items-end gap-2 shrink-0 relative">
                          <div className="flex items-center gap-4 text-sm">
                            <span className="flex items-center gap-1.5 text-muted-foreground">
                              <Calendar className="w-3.5 h-3.5" />
                              {new Date(race.race_date).toLocaleDateString("nl-NL", { day: "numeric", month: "short", timeZone: "Europe/Amsterdam" })}
                            </span>
                            <span className="flex items-center gap-1.5 text-muted-foreground">
                              <Clock className="w-3.5 h-3.5" />
                              {new Date(race.race_date).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" })}
                            </span>
                          </div>
                          <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider w-fit ${statusStyles[race.status] || statusStyles.upcoming}`}>
                            {statusLabels[race.status] || race.status}
                          </span>
                          {countdown && (
                            <span className="flex items-center gap-1 text-xs font-bold text-primary tabular-nums">
                              <Timer className="w-3 h-3" /> {countdown}
                            </span>
                          )}
                          {race.status !== "completed" && user && (() => {
                            const seasonReg = isRegisteredForSeason(leagueId);
                            const raceReg = isRegisteredForRace(race.id);
                            return (
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground flex items-center gap-1">
                                <Users className="w-3 h-3" />{raceRegCount(race.id)}
                              </span>
                              {(seasonReg || raceReg) ? (
                                <button
                                  onClick={() => !seasonReg && unregisterFromRace.mutate(race.id)}
                                  disabled={seasonReg || unregisterFromRace.isPending}
                                  title={seasonReg ? "Aangemeld via seizoensinschrijving" : undefined}
                                  className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold bg-accent/20 text-accent border border-accent/30 ${seasonReg ? "cursor-default opacity-80" : "hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/30 transition-colors"}`}
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
                            );
                          })()}
                        </div>
                      </motion.div>
                    );
                  })}
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
