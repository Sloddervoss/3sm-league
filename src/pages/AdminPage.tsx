import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trophy, Calendar, Settings, Users, Car, Shield, BarChart2, Upload, Clock, MapPin, Flag, CloudSun, Gauge, Timer } from "lucide-react";
import { getTrackInfo } from "@/lib/trackData";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { toast } from "sonner";
import { Navigate } from "react-router-dom";
import DriversList from "./admin/DriversList";
import AnnouncementsAdmin from "./admin/AnnouncementsAdmin";
import PointsAdmin from "./admin/PointsAdmin";
import TeamsAdmin from "./admin/TeamsAdmin";
import SeasonsAdmin from "./admin/SeasonsAdmin";
import ResultsImportAdmin from "./admin/ResultsImportAdmin";

type AdminTab = "overview" | "seasons" | "teams" | "results" | "points" | "drivers" | "announcements";

const AdminPage = () => {
  const { user, isAdmin, loading } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<AdminTab>("overview");

  const [iratingSyncing, setIratingSyncing] = useState(false);
  const [iratingSyncResult, setIratingSyncResult] = useState<{ updated?: number; error?: string } | null>(null);


  const { data: leagues } = useQuery({
    queryKey: ["admin-leagues"],
    queryFn: async () => {
      const { data, error } = await supabase.from("leagues").select("*, races(*)");
      if (error) throw error;
      return data;
    },
  });

  const { data: allRaces } = useQuery({
    queryKey: ["all-races-admin"],
    queryFn: async () => {
      const { data, error } = await supabase.from("races").select("id, name, track, race_date, league_id, status, practice_duration, qualifying_duration, race_duration, start_type, weather, setup, leagues(name, season)").order("race_date", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const { data: totalDrivers } = useQuery({
    queryKey: ["total-drivers"],
    queryFn: async () => {
      const { count } = await supabase.from("profiles").select("*", { count: "exact", head: true });
      return count || 0;
    },
  });


  const { data: totalTeams } = useQuery({
    queryKey: ["admin-team-count"],
    queryFn: async () => {
      const { count } = await supabase.from("teams").select("*", { count: "exact", head: true });
      return count || 0;
    },
  });

  const { data: totalResults } = useQuery({
    queryKey: ["total-results"],
    queryFn: async () => {
      const { count } = await supabase.from("race_results").select("*", { count: "exact", head: true });
      return count || 0;
    },
  });




  if (loading) return null;
  if (!user) return <Navigate to="/auth" />;
  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <main className="pt-16 flex items-center justify-center min-h-screen">
          <div className="text-center">
            <Settings className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h1 className="font-heading text-2xl font-black mb-2">GEEN TOEGANG</h1>
            <p className="text-muted-foreground">Je hebt admin rechten nodig om deze pagina te bekijken.</p>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  const nextRace = allRaces?.find((r: any) => r.status !== "completed");
  const activeLeague = leagues?.find((l: any) => l.status === "active");

  const tabs: { id: AdminTab; label: string; icon: React.ElementType }[] = [
    { id: "overview", label: "Dashboard", icon: BarChart2 },
    { id: "seasons", label: "Seizoenen", icon: Trophy },
    { id: "teams", label: "Teams", icon: Car },
    { id: "drivers", label: "Coureurs", icon: Users },
    { id: "results", label: "Resultaten", icon: Upload },
    { id: "points", label: "Punten", icon: Shield },
    { id: "announcements", label: "Aankondigingen", icon: Flag },
  ];

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-16">
        <section className="py-10 bg-gradient-to-b from-card/50 to-transparent border-b border-border">
          <div className="container mx-auto px-4">
            <div className="flex items-center gap-2 mb-1">
              <Settings className="w-5 h-5 text-accent" />
              <span className="text-sm font-medium text-accent uppercase tracking-[0.15em]">Admin</span>
            </div>
            <h1 className="font-heading text-4xl font-black">ADMIN PANEL</h1>
          </div>
        </section>

        <div className="border-b border-border bg-card/30 sticky top-16 z-40">
          <div className="container mx-auto px-4">
            <div className="flex overflow-x-auto gap-1 py-2">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${
                    activeTab === tab.id ? "bg-gradient-racing text-white" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                  }`}
                >
                  <tab.icon className="w-4 h-4" />
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <section className="py-10">
          <div className="container mx-auto px-4">

            {activeTab === "overview" && (
              <div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
                  {[
                    { label: "Coureurs", value: totalDrivers ?? 0, icon: Users, color: "text-blue-400" },
                    { label: "Teams", value: totalTeams ?? 0, icon: Car, color: "text-green-400" },
                    { label: "Seizoenen", value: leagues?.length ?? 0, icon: Trophy, color: "text-yellow-400" },
                    { label: "Resultaten", value: totalResults ?? 0, icon: BarChart2, color: "text-accent" },
                  ].map((stat) => (
                    <div key={stat.label} className="bg-card border border-border rounded-lg p-5 text-center">
                      <stat.icon className={`w-6 h-6 mx-auto mb-2 ${stat.color}`} />
                      <div className="font-heading font-black text-3xl">{stat.value}</div>
                      <div className="text-xs text-muted-foreground uppercase tracking-wider mt-1">{stat.label}</div>
                    </div>
                  ))}
                </div>
                <div className="grid md:grid-cols-2 gap-6">
                  {nextRace && (() => {
                    const nr = nextRace as any;
                    const trackInfo = getTrackInfo(nr.track);
                    const diff = new Date(nr.race_date).getTime() - Date.now();
                    const d = Math.floor(diff / 86400000);
                    const h = Math.floor((diff % 86400000) / 3600000);
                    const m = Math.floor((diff % 3600000) / 60000);
                    const countdown = diff > 0 ? (d > 0 ? `${d}d ${String(h).padStart(2,"0")}h ${String(m).padStart(2,"0")}m` : `${String(h).padStart(2,"0")}h ${String(m).padStart(2,"0")}m`) : null;
                    const sessions = [
                      nr.practice_duration  && { label: "Practice",   dur: nr.practice_duration,   color: "bg-blue-500/70" },
                      nr.qualifying_duration && { label: "Qualifying", dur: nr.qualifying_duration, color: "bg-yellow-500/70" },
                      nr.race_duration       && { label: "Race",       dur: nr.race_duration,       color: "bg-primary/80" },
                    ].filter(Boolean) as { label: string; dur: string; color: string }[];
                    return (
                      <div className="bg-card border border-primary/30 rounded-lg p-5 racing-stripe-left relative overflow-hidden">
                        <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-transparent to-transparent pointer-events-none" />
                        <div className="relative flex gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-primary uppercase tracking-[0.1em] flex items-center gap-2 mb-2"><Calendar className="w-4 h-4" />Volgende Race</div>
                            <h3 className="font-heading font-black text-xl mb-1">{nr.name}</h3>
                            <div className="flex items-center gap-1.5 text-sm text-muted-foreground mb-2">
                              <MapPin className="w-3.5 h-3.5 shrink-0" />
                              <span>{nr.track}</span>
                              {trackInfo?.country && <span className="opacity-60 text-xs">— {trackInfo.country}</span>}
                            </div>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground mb-2 flex-wrap">
                              <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{new Date(nr.race_date).toLocaleDateString("nl-NL", { day: "numeric", month: "long", timeZone: "Europe/Amsterdam" })}</span>
                              <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{new Date(nr.race_date).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" })}</span>
                              {!nr.leagues ? (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wide" style={{ background: "rgba(99,102,241,0.12)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.2)" }}>Losse Race</span>
                              ) : (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wide" style={{ background: "rgba(249,115,22,0.08)", color: "#f97316", border: "1px solid rgba(249,115,22,0.2)" }}>{nr.leagues.name}{nr.leagues.season ? ` · ${nr.leagues.season}` : ""}</span>
                              )}
                            </div>
                            {sessions.length > 0 && (
                              <div className="flex items-center gap-1.5 flex-wrap mb-2">
                                {sessions.map((s, i) => (
                                  <span key={i} className={`${s.color} px-2 py-0.5 rounded text-[10px] font-bold text-white tracking-wide`}>{s.label} · {s.dur}</span>
                                ))}
                              </div>
                            )}
                            <div className="flex items-center gap-3 flex-wrap">
                              {nr.start_type && <span className="flex items-center gap-1 text-xs text-muted-foreground"><Flag className="w-3 h-3" /> {nr.start_type} start</span>}
                              {nr.weather && <span className="flex items-center gap-1 text-xs text-muted-foreground"><CloudSun className="w-3 h-3" /> Weather: {nr.weather}</span>}
                              {nr.setup && <span className="flex items-center gap-1 text-xs text-muted-foreground"><Gauge className="w-3 h-3" /> Setup: {nr.setup}</span>}
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-3 shrink-0">
                            {trackInfo?.imageUrl && (
                              <img src={trackInfo.imageUrl} alt="" aria-hidden className="w-24 h-16 object-contain invert opacity-25" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                            )}
                            {countdown && (
                              <div className="text-right">
                                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Aftellen</p>
                                <p className="font-heading font-black text-xl tabular-nums flex items-center gap-1"><Timer className="w-4 h-4 text-primary" />{countdown}</p>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                  {activeLeague && (
                    <div className="bg-card border border-border rounded-lg p-5 racing-stripe-left">
                      <div className="text-sm font-medium text-accent uppercase tracking-[0.1em] flex items-center gap-2 mb-1"><Trophy className="w-4 h-4" />Actief Seizoen</div>
                      <h3 className="font-heading font-black text-xl">{activeLeague.name}</h3>
                      <p className="text-muted-foreground text-sm mt-1">{activeLeague.season} {activeLeague.car_class && `• ${activeLeague.car_class}`} • {(activeLeague as any).races?.length || 0} races</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === "seasons" && <SeasonsAdmin />}

            {activeTab === "teams" && <TeamsAdmin />}

            {activeTab === "results" && <ResultsImportAdmin />}

            {activeTab === "drivers" && (
              <div>
                <div className="flex items-center justify-between mb-6">
                  <h2 className="font-heading text-2xl font-black">COUREURS</h2>
                  <button
                    onClick={async () => {
                      setIratingSyncing(true);
                      setIratingSyncResult(null);
                      try {
                        const { data: result, error } = await supabase.functions.invoke("sync-irating");
                        if (error) throw error;
                        setIratingSyncResult(result);
                        if (result?.updated !== undefined) {
                          toast.success(`iRating gesynchroniseerd — ${result.updated} drivers bijgewerkt`);
                          queryClient.invalidateQueries({ queryKey: ["all-profiles"] });
                        } else {
                          toast.error(result?.error ?? "Sync mislukt");
                        }
                      } catch (e: any) {
                        toast.error(e.message);
                        setIratingSyncResult({ error: e.message });
                      } finally {
                        setIratingSyncing(false);
                      }
                    }}
                    disabled={iratingSyncing}
                    className="flex items-center gap-2 px-4 py-2 rounded-md bg-gradient-racing text-white font-heading font-bold text-sm uppercase tracking-wider hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    {iratingSyncing ? (
                      <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Synchroniseren...</>
                    ) : (
                      <><BarChart2 className="w-4 h-4" />iRating Sync</>
                    )}
                  </button>
                </div>
                {iratingSyncResult && (
                  <div className={`mb-4 px-4 py-3 rounded-md text-sm font-medium border ${iratingSyncResult.error ? "bg-red-500/10 text-red-400 border-red-500/30" : "bg-accent/10 text-accent border-accent/30"}`}>
                    {iratingSyncResult.error ? `Fout: ${iratingSyncResult.error}` : `${iratingSyncResult.updated} driver${iratingSyncResult.updated !== 1 ? "s" : ""} bijgewerkt met iRating & safety rating van iRacing.`}
                  </div>
                )}
                <DriversList />
              </div>
            )}

            {activeTab === "points" && <PointsAdmin />}

            {activeTab === "announcements" && <AnnouncementsAdmin />}

          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default AdminPage;
