import Footer from "@/components/Footer";
import Navbar from "@/components/Navbar";
import StickyRaceBar from "@/components/StickyRaceBar";
import { supabase } from "@/integrations/supabase/client";
import { getRaceDetailStats, type RaceDetailStatsResult } from "@/lib/raceDetailStats";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CalendarDays, Flag, List, Share2, Trophy, Zap } from "lucide-react";
import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";

const STALE = 5 * 60 * 1000;

type RaceDetailRace = {
  id: string;
  name: string;
  track: string;
  race_date: string;
  round: number | null;
  total_laps: number | null;
  race_duration: string | null;
  weather: string | null;
  car: string | null;
  iracing_session_id: string | null;
  sof: number | null;
  cautions: number | null;
  caution_laps: number | null;
  lead_changes: number | null;
  leagues: {
    name: string;
    car_class: string | null;
  } | null;
};

type RaceResultRow = RaceDetailStatsResult & {
  id: string;
  points: number | null;
  gap_to_leader: string | null;
};

type PenaltyRow = {
  user_id: string;
  penalty_type: string;
  points_deduction: number;
};

const formatRaceDate = (value: string) =>
  new Date(value).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Amsterdam",
  });

const positionColor = (position: number | null) => {
  if (position === 1) return "text-yellow-400";
  if (position === 2) return "text-slate-300";
  if (position === 3) return "text-amber-600";
  return "text-muted-foreground";
};

const medal = (position: number | null) => {
  if (position === 1) return "🥇";
  if (position === 2) return "🥈";
  if (position === 3) return "🥉";
  return position ?? "-";
};

const RaceDetailPage = () => {
  const { raceId } = useParams<{ raceId: string }>();

  const { data: race, isLoading: raceLoading } = useQuery({
    queryKey: ["race-detail-page", raceId],
    enabled: !!raceId,
    staleTime: STALE,
    queryFn: async (): Promise<RaceDetailRace | null> => {
      const { data, error } = await supabase
        .from("races")
        .select("id, name, track, race_date, round, total_laps, race_duration, weather, car, iracing_session_id, sof, cautions, caution_laps, lead_changes, leagues(name, car_class)")
        .eq("id", raceId!)
        .eq("status", "completed")
        .maybeSingle();
      if (error) throw error;
      return data as RaceDetailRace | null;
    },
  });

  const { data: results = [], isLoading: resultsLoading } = useQuery({
    queryKey: ["race-results-detail", raceId],
    enabled: !!raceId,
    staleTime: STALE,
    queryFn: async (): Promise<RaceResultRow[]> => {
      const { data, error } = await supabase
        .from("race_results")
        .select("id, user_id, position, start_position, points, laps, laps_led, best_lap, best_lap_num, avg_lap, fastest_lap, incidents, dnf, gap_to_leader, car_name, club_name, reason_out, profiles(display_name, iracing_name)")
        .eq("race_id", raceId!)
        .order("position", { ascending: true });
      if (error) throw error;
      return (data || []) as RaceResultRow[];
    },
  });

  const { data: penalties = [] } = useQuery({
    queryKey: ["race-penalties-detail", raceId],
    enabled: !!raceId,
    staleTime: STALE,
    queryFn: async (): Promise<PenaltyRow[]> => {
      const { data } = await supabase
        .from("penalties")
        .select("user_id, penalty_type, points_deduction")
        .eq("race_id", raceId!);
      return (data || []) as PenaltyRow[];
    },
  });

  const stats = getRaceDetailStats(results);
  const loading = raceLoading || resultsLoading;

  useEffect(() => {
    if (!race) return;
    document.title = `${race.name} uitslag - 3 Stripe Motorsport`;

    const siteUrl = "https://3stripemotorsport.cc";
    const scriptId = "race-detail-jsonld";
    let script = document.getElementById(scriptId) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement("script");
      script.id = scriptId;
      script.type = "application/ld+json";
      document.head.appendChild(script);
    }

    script.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "SportsEvent",
      name: race.name,
      sport: "Sim racing",
      startDate: race.race_date,
      url: `${siteUrl}/results/${race.id}/`,
      eventStatus: "https://schema.org/EventCompleted",
      location: { "@type": "VirtualLocation", name: race.track },
      organizer: { "@type": "SportsOrganization", name: "3 Stripe Motorsport", url: siteUrl },
      ...(race.leagues?.name ? { superEvent: { "@type": "SportsEvent", name: race.leagues.name } } : {}),
      ...(stats.winner?.name ? { result: `Winner: ${stats.winner.name}` } : {}),
    });

    return () => {
      document.getElementById(scriptId)?.remove();
    };
  }, [race, stats.winner?.name]);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <StickyRaceBar />
      <main className="pt-[108px]">
        <section className="py-8 md:py-12 bg-gradient-to-b from-card/60 to-transparent border-b border-border">
          <div className="container mx-auto px-4">
            <Link to="/results" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-accent transition-colors mb-6">
              <ArrowLeft className="w-4 h-4" /> Terug naar uitslagen
            </Link>

            {loading ? (
              <div className="space-y-4">
                <div className="h-12 max-w-xl rounded bg-card animate-pulse" />
                <div className="h-5 max-w-sm rounded bg-secondary animate-pulse" />
              </div>
            ) : !race ? (
              <div className="bg-card border border-border rounded-lg px-6 py-16 text-center">
                <Flag className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
                <h1 className="font-heading text-3xl font-black mb-2">Race niet gevonden</h1>
                <p className="text-muted-foreground text-sm mb-6">Deze race is niet gepubliceerd of bestaat niet.</p>
                <Link to="/results" className="inline-flex items-center gap-2 text-orange-500 font-heading font-bold hover:text-orange-400">
                  Bekijk alle uitslagen
                </Link>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-3 mb-2">
                      <span className="text-xs uppercase tracking-widest px-2.5 py-0.5 rounded-full bg-orange-500/10 text-orange-400 border border-orange-500/20">Race uitslag</span>
                      {race.leagues?.name && <span className="text-xs uppercase tracking-widest px-2.5 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border">{race.leagues.name}</span>}
                      {race.round != null && <span className="text-xs uppercase tracking-widest px-2.5 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border">Ronde {race.round}</span>}
                    </div>
                    <h1 className="font-heading text-4xl md:text-6xl font-black tracking-tight">
                      <span className="text-gradient-racing">{race.name}</span>
                    </h1>
                    <p className="text-lg md:text-xl text-muted-foreground font-heading font-semibold mt-1">
                      {race.track} · {formatRaceDate(race.race_date)}
                    </p>
                  </div>
                  <div className="text-left lg:text-right text-muted-foreground">
                    <div className="font-heading text-2xl font-black">{race.iracing_session_id ? `#${race.iracing_session_id}` : race.total_laps ? `${race.total_laps} laps` : "3SM"}</div>
                    <div className="text-xs uppercase tracking-[0.2em]">{race.iracing_session_id ? "iRacing sessie" : "Race detail"}</div>
                  </div>
                </div>

                {stats.winner && (
                  <div className="mt-6 flex items-center gap-4 rounded-lg border border-orange-500/20 bg-gradient-to-r from-orange-500/10 via-card to-transparent p-4 border-glow">
                    <div className="w-1 h-12 rounded-full bg-gradient-racing" />
                    <div>
                      <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-black">Race winner</div>
                      <div className="font-heading text-2xl font-black">{stats.winner.name}</div>
                    </div>
                    <div className="ml-auto hidden sm:flex items-center gap-4 text-sm text-muted-foreground">
                      {stats.winner.laps != null && <span><b className="text-orange-400">{stats.winner.laps}</b> laps</span>}
                      {stats.winner.best_lap && <><span className="opacity-30">|</span><span><b className="text-orange-400">{stats.winner.best_lap}</b> best lap</span></>}
                      {stats.winner.incidents != null && <><span className="opacity-30">|</span><span><b className="text-orange-400">{stats.winner.incidents}</b>x</span></>}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        {!loading && race && (
          <section className="py-10">
            <div className="container mx-auto px-4 space-y-8">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-card border border-border rounded-lg p-4 card-hover">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-black mb-2">Podium</div>
                  <div className="font-heading text-xl font-black">{stats.podium.length ? stats.podium.map((driver) => driver.name).join(" · ") : "Nog leeg"}</div>
                </div>
                <div className="bg-card border border-border rounded-lg p-4 card-hover">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-black mb-2">Snelste ronde</div>
                  <div className="font-heading text-xl font-black">{stats.fastest?.name || "-"}</div>
                  {stats.fastest?.best_lap && <div className="text-xs font-mono text-purple-300 mt-1">{stats.fastest.best_lap}</div>}
                </div>
                <div className="bg-card border border-border rounded-lg p-4 card-hover">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-black mb-2">Clean drive</div>
                  <div className="font-heading text-xl font-black">{stats.cleanest?.name || "-"}</div>
                  {stats.cleanest?.incidents != null && <div className="text-xs text-green-400 mt-1">{stats.cleanest.incidents} incidents</div>}
                </div>
                <div className="bg-card border border-border rounded-lg p-4 card-hover">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-black mb-2">Race stats</div>
                  <div className="font-heading text-xl font-black">{stats.finishers} finishers</div>
                  <div className="text-xs text-muted-foreground mt-1">{stats.dnfCount} DNF · {stats.hasIncidentData ? `${stats.totalIncidents} incidents` : "incidents onbekend"}</div>
                </div>
              </div>

              {(stats.pole || stats.biggestMover || stats.mostLapsLed || race.sof || race.lead_changes != null || race.cautions != null || race.weather) && (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3">
                  {stats.pole && <div className="bg-card border border-border rounded-lg p-4"><div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-black mb-2">Pole</div><div className="font-heading text-lg font-black">{stats.pole.name}</div></div>}
                  {stats.biggestMover && <div className="bg-card border border-border rounded-lg p-4"><div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-black mb-2">Grootste stijger</div><div className="font-heading text-lg font-black">{stats.biggestMover.name}</div><div className="text-xs text-green-400 mt-1">+{stats.biggestMover.positionGain} posities</div></div>}
                  {stats.mostLapsLed && <div className="bg-card border border-border rounded-lg p-4"><div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-black mb-2">Meeste laps led</div><div className="font-heading text-lg font-black">{stats.mostLapsLed.name}</div><div className="text-xs text-orange-400 mt-1">{stats.mostLapsLed.laps_led} laps</div></div>}
                  {race.sof != null && <div className="bg-card border border-border rounded-lg p-4"><div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-black mb-2">SOF</div><div className="font-heading text-lg font-black">{race.sof}</div></div>}
                  {race.lead_changes != null && <div className="bg-card border border-border rounded-lg p-4"><div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-black mb-2">Lead changes</div><div className="font-heading text-lg font-black">{race.lead_changes}</div></div>}
                  {race.cautions != null && <div className="bg-card border border-border rounded-lg p-4"><div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-black mb-2">Cautions</div><div className="font-heading text-lg font-black">{race.cautions}</div>{race.caution_laps != null && <div className="text-xs text-muted-foreground mt-1">{race.caution_laps} laps</div>}</div>}
                  {race.weather && <div className="bg-card border border-border rounded-lg p-4"><div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-black mb-2">Weer</div><div className="text-xs font-heading font-bold leading-relaxed">{race.weather}</div></div>}
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="font-heading text-2xl font-black flex items-center gap-2"><List className="w-5 h-5 text-accent" /> Volledige uitslag</h2>
                    <button
                      type="button"
                      onClick={() => navigator.clipboard?.writeText(window.location.href)}
                      className="inline-flex items-center gap-2 rounded border border-border bg-secondary/40 px-3 py-2 text-xs font-heading font-bold hover:border-orange-500/40 transition-colors"
                    >
                      <Share2 className="w-3.5 h-3.5" /> Link kopiëren
                    </button>
                  </div>

                  <div className="bg-card border border-border rounded-lg overflow-hidden">
                    <div className="grid grid-cols-[3.5rem_3.5rem_1fr_4rem_4rem_6rem_4rem_4rem] gap-2 px-4 py-2 bg-secondary/40 text-[10px] font-black uppercase tracking-widest text-muted-foreground min-w-[820px]">
                      <span>Pos</span><span>Start</span><span>Coureur</span><span className="text-center">Δ</span><span className="text-center">Laps</span><span className="text-right">Best</span><span className="text-center">Inc</span><span className="text-center">Pts</span>
                    </div>
                    <div className="overflow-x-auto">
                      {stats.sorted.map((driver) => {
                        const pen = penalties.find((p) => p.user_id === driver.user_id && p.penalty_type !== "warning");
                        const positionDelta = driver.start_position != null && driver.position != null ? driver.start_position - driver.position : null;
                        return (
                          <div key={driver.user_id} className={`grid grid-cols-[3.5rem_3.5rem_1fr_4rem_4rem_6rem_4rem_4rem] gap-2 px-4 py-3 items-center border-t border-border/50 min-w-[820px] hover:bg-secondary/20 transition-colors ${driver.position != null && driver.position <= 3 ? "racing-stripe-left" : ""}`}>
                            <span className={`font-heading font-black text-lg ${positionColor(driver.position)}`}>{driver.dnf ? "DNF" : medal(driver.position)}</span>
                            <span className="text-sm font-heading text-muted-foreground">{driver.start_position ?? "-"}</span>
                            <div className="min-w-0">
                              <div className="font-heading font-black truncate flex items-center gap-2">
                                {driver.name}
                                {driver.fastest_lap && <span className="text-[10px] px-1.5 py-0.5 rounded border border-purple-500/30 bg-purple-500/15 text-purple-300">FL</span>}
                                {(driver.laps_led ?? 0) > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded border border-orange-500/30 bg-orange-500/15 text-orange-300">LED {driver.laps_led}</span>}
                              </div>
                              {driver.gap_to_leader && <div className="text-xs text-muted-foreground truncate">+{driver.gap_to_leader}</div>}
                              {driver.reason_out && <div className="text-xs text-red-300 truncate">{driver.reason_out}</div>}
                            </div>
                            <span className={`text-center text-sm font-heading ${positionDelta == null ? "text-muted-foreground" : positionDelta > 0 ? "text-green-400" : positionDelta < 0 ? "text-red-400" : "text-muted-foreground"}`}>{positionDelta == null ? "-" : positionDelta > 0 ? `+${positionDelta}` : positionDelta}</span>
                            <span className="text-center text-sm font-heading text-muted-foreground">{driver.laps ?? "-"}</span>
                            <span className="text-right text-sm font-mono text-muted-foreground">{driver.best_lap ?? "-"}{driver.best_lap_num ? <span className="block text-[10px] font-sans text-muted-foreground/70">lap {driver.best_lap_num}</span> : null}</span>
                            <span className={`text-center text-sm font-heading ${driver.incidents === 0 ? "text-green-400 font-black" : (driver.incidents ?? 0) > 8 ? "text-red-400" : "text-muted-foreground"}`}>{driver.incidents != null ? `${driver.incidents}x` : "-"}</span>
                            <span className="text-center font-heading font-black">
                              {driver.points ?? "-"}
                              {pen && <span className="ml-1 text-[10px] text-orange-400" title={pen.penalty_type === "disqualification" ? "DSQ — Steward" : `-${pen.points_deduction}pt — Steward`}>⚠</span>}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <aside className="space-y-4">
                  <div className="bg-card border border-border rounded-lg p-4">
                    <h3 className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-black mb-3 flex items-center gap-2"><Flag className="w-4 h-4 text-accent" /> Race overview</h3>
                    <div className="space-y-2.5 text-sm">
                      <div className="flex justify-between gap-3"><span className="text-muted-foreground">Track</span><span className="font-heading font-bold text-right">{race.track}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Datum</span><span className="font-heading font-bold">{formatRaceDate(race.race_date)}</span></div>
                      {race.round != null && <div className="flex justify-between"><span className="text-muted-foreground">Ronde</span><span className="font-heading font-bold">{race.round}</span></div>}
                      {race.total_laps != null && <div className="flex justify-between"><span className="text-muted-foreground">Geplande laps</span><span className="font-heading font-bold">{race.total_laps}</span></div>}
                      {race.race_duration && <div className="flex justify-between"><span className="text-muted-foreground">Race duur</span><span className="font-heading font-bold">{race.race_duration}</span></div>}
                      {race.weather && <div className="flex justify-between gap-3"><span className="text-muted-foreground">Weather</span><span className="font-heading font-bold text-right">{race.weather}</span></div>}
                      {race.sof != null && <div className="flex justify-between"><span className="text-muted-foreground">SOF</span><span className="font-heading font-bold">{race.sof}</span></div>}
                      {race.lead_changes != null && <div className="flex justify-between"><span className="text-muted-foreground">Lead changes</span><span className="font-heading font-bold">{race.lead_changes}</span></div>}
                      {race.cautions != null && <div className="flex justify-between"><span className="text-muted-foreground">Cautions</span><span className="font-heading font-bold">{race.cautions}{race.caution_laps != null ? ` / ${race.caution_laps} laps` : ""}</span></div>}
                      {race.car && <div className="flex justify-between gap-3"><span className="text-muted-foreground">Auto</span><span className="font-heading font-bold text-right">{race.car}</span></div>}
                    </div>
                  </div>

                  <div className="bg-card border border-border rounded-lg p-4">
                    <h3 className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-black mb-3 flex items-center gap-2"><Trophy className="w-4 h-4 text-yellow-400" /> Highlights</h3>
                    <div className="space-y-3 text-sm text-muted-foreground">
                      {stats.winner && <p><strong className="text-foreground font-heading">{stats.winner.name}</strong> won de race op {race.track}.</p>}
                      {stats.fastest && <p><Zap className="w-3.5 h-3.5 inline mr-1 text-purple-400" /> Snelste ronde: <strong className="text-foreground font-heading">{stats.fastest.name}</strong>{stats.fastest.best_lap ? ` — ${stats.fastest.best_lap}` : ""}.</p>}
                      {stats.cleanest && <p>Cleanest drive: <strong className="text-foreground font-heading">{stats.cleanest.name}</strong> met {stats.cleanest.incidents}x.</p>}
                    </div>
                  </div>

                </aside>
              </div>
            </div>
          </section>
        )}
      </main>
      <Footer />
    </div>
  );
};

export default RaceDetailPage;
