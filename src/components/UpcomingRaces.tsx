import { motion } from "framer-motion";
import { Calendar, MapPin, Clock, UserPlus, Check, Lock, Users } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

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
  const { user, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

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

  // Is this season "started" = has at least one completed race?
  const seasonStarted = (leagueId: string) => {
    return (races || []).some((r: any) => r.league_id === leagueId && r.status === "completed");
  };

  const isRegisteredForSeason = (leagueId: string) =>
    user && (seasonRegs || []).some((r: any) => r.league_id === leagueId && r.user_id === user.id);

  const registrationCount = (leagueId: string) =>
    (seasonRegs || []).filter((r: any) => r.league_id === leagueId && !(isAdmin && r.user_id === user?.id)).length;

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
                          onClick={() => registerForSeason.mutate(leagueId)}
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
                        <h3 className={`font-heading font-bold text-lg ${race.status === "completed" ? "text-muted-foreground" : ""}`}>
                          {race.name}
                        </h3>
                        <div className="flex items-center gap-3 text-sm text-muted-foreground mt-1">
                          <span className="flex items-center gap-1">
                            <MapPin className="w-3.5 h-3.5" />
                            {race.track}
                          </span>
                          {race.car && <span className="text-xs">· {race.car}</span>}
                        </div>
                      </div>

                      <div className="flex items-center gap-4 text-sm shrink-0">
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <Calendar className="w-3.5 h-3.5" />
                          {new Date(race.race_date).toLocaleDateString("nl-NL", { day: "numeric", month: "short" })}
                        </span>
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <Clock className="w-3.5 h-3.5" />
                          {new Date(race.race_date).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                        {race.total_laps && (
                          <span className="text-xs text-muted-foreground">{race.total_laps} ronden</span>
                        )}
                      </div>

                      <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider w-fit shrink-0 ${statusStyles[race.status] || statusStyles.upcoming}`}>
                        {statusLabels[race.status] || race.status}
                      </span>
                    </motion.div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default UpcomingRaces;
