/**
 * RaceDetailPreview — Nieuwe race detail pagina (preview only)
 * Toegang via /preview/race?id=RACE_ID
 */
import { useSearchParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";
import { MapPin, Clock, CloudSun, Gauge, Users, Trophy, ArrowLeft, Flag, Zap, Timer, FlaskConical } from "lucide-react";
import Navbar from "@/components/Navbar";
import StickyRaceBar from "@/components/StickyRaceBar";
import Footer from "@/components/Footer";
import { getTrackInfo } from "@/lib/trackData";
import { useMockMode } from "@/lib/useMockMode";
import { MOCK_TEAMS, MOCK_RACE_DETAIL_RESULTS } from "@/lib/mockData";

const PODIUM = ["#facc15", "#94a3b8", "#d97706"];

// Mock race voor detail view (gebruik Race 1 als completed voorbeeld)
const MOCK_RACE_DETAIL = {
  id: "r1",
  name: "Race 1",
  track: "Summit Point Raceway",
  race_date: "2025-04-02T19:00:00Z",
  status: "completed",
  weather: "Droog",
  setup: "Fixed",
  practice_duration: "20 min",
  qualifying_duration: "10 min",
  race_duration: "30 min",
  leagues: { name: "GT Master Challenge Cup", car_class: "GT3" },
};

const RaceDetailPreview = () => {
  const [params] = useSearchParams();
  const selectedId = params.get("id");
  const [mockMode, setMockMode] = useMockMode();

  const { data: races = [] } = useQuery({
    queryKey: ["races-with-leagues"],
    queryFn: async () => {
      const { data } = await supabase.from("races").select("*, leagues(name, car_class, id)").order("race_date", { ascending: false });
      return data || [];
    },
  });

  const realRace: any = selectedId ? races.find((r: any) => r.id === selectedId) : races[0];
  const race: any = mockMode ? MOCK_RACE_DETAIL : (realRace || MOCK_RACE_DETAIL);

  const { data: realRaceResults = [] } = useQuery({
    queryKey: ["race-detail-results", realRace?.id],
    enabled: !!realRace?.id && !mockMode,
    queryFn: async () => {
      const { data } = await supabase
        .from("race_results")
        .select("*, profiles(display_name, iracing_name, team_id)")
        .eq("race_id", realRace.id)
        .order("position");
      return data || [];
    },
  });

  const { data: teams = [] } = useQuery({
    queryKey: ["teams"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("teams").select("id, name, color");
      return data || [];
    },
  });

  const { data: regCount } = useQuery({
    queryKey: ["race-reg-count", realRace?.id],
    enabled: !!realRace?.id && !mockMode,
    queryFn: async () => {
      const { count } = await (supabase as any).from("race_registrations").select("id", { count: "exact" }).eq("race_id", realRace.id);
      return count || 0;
    },
  });

  const activeTeams = mockMode ? MOCK_TEAMS : teams;
  const raceResults = mockMode ? MOCK_RACE_DETAIL_RESULTS : realRaceResults;
  const activeRegCount = mockMode ? 6 : (regCount || 0);

  const trackInfo = getTrackInfo(race.track);
  const raceDate = new Date(race.race_date);
  const dateStr = raceDate.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" });
  const timeStr = raceDate.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" });

  const sessions = [
    race.practice_duration   && { label: "Practice",   dur: race.practice_duration,   color: "#3b82f6", bg: "rgba(59,130,246,0.12)" },
    race.qualifying_duration && { label: "Qualifying",  dur: race.qualifying_duration,  color: "#eab308", bg: "rgba(234,179,8,0.12)" },
    race.race_duration       && { label: "Race",        dur: race.race_duration,        color: "#f97316", bg: "rgba(249,115,22,0.12)" },
  ].filter(Boolean) as any[];

  const winner = raceResults[0];
  const fastestLap = raceResults.find((r: any) => r.fastest_lap);
  const dnfCount = raceResults.filter((r: any) => r.dnf).length;

  return (
    <div className="min-h-screen" style={{ background: "#08080f" }}>
      <Navbar />
      <StickyRaceBar />
      <main className="pt-[108px]">

        {/* Preview banner */}
        <div className="sticky top-16 z-40 flex items-center justify-between px-6 py-2" style={{ background: "rgba(8,8,15,0.9)", borderBottom: "1px solid rgba(249,115,22,0.15)", backdropFilter: "blur(12px)" }}>
          <div className="flex items-center gap-3">
            <Link to="/preview" className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-orange-500 transition-colors">
              <ArrowLeft className="w-3.5 h-3.5" /> Terug
            </Link>
            <div className="w-px h-3 bg-white/10" />
            <span className="text-xs font-black text-orange-500 uppercase tracking-widest">Race Detail Preview</span>
          </div>
          <button
            onClick={() => setMockMode(m => !m)}
            className="flex items-center gap-2 px-3 py-1 rounded-lg transition-all text-[11px] font-bold"
            style={{
              background: mockMode ? "rgba(168,85,247,0.15)" : "rgba(255,255,255,0.05)",
              border: `1px solid ${mockMode ? "rgba(168,85,247,0.4)" : "rgba(255,255,255,0.08)"}`,
              color: mockMode ? "#a855f7" : "#4b5563",
            }}
          >
            <FlaskConical className="w-3.5 h-3.5" />
            {mockMode ? "Mock data aan" : "Mock data"}
          </button>
        </div>

        {/* Race selector (alleen echte races in de tabs, mock data toont altijd Race 1) */}
        {races.length > 1 && !mockMode && (
          <div className="border-b border-white/5 overflow-x-auto">
            <div className="container mx-auto px-4">
              <div className="flex gap-1 py-2">
                {races.slice(0, 12).map((r: any) => (
                  <Link
                    key={r.id}
                    to={`/preview/race?id=${r.id}`}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors"
                    style={
                      r.id === realRace?.id
                        ? { background: "rgba(249,115,22,0.15)", color: "#f97316", border: "1px solid rgba(249,115,22,0.3)" }
                        : { color: "#6b7280", border: "1px solid transparent" }
                    }
                  >
                    {r.name}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Hero */}
        <div className="relative overflow-hidden" style={{ minHeight: 320 }}>
          {trackInfo?.imageUrl && (
            <div className="absolute inset-0 flex items-center justify-end">
              <img
                src={trackInfo.imageUrl}
                alt=""
                className="absolute right-0 w-1/2 max-w-lg h-full object-contain select-none pointer-events-none"
                style={{ opacity: 0.05, filter: "invert(1)", mixBlendMode: "screen" }}
              />
            </div>
          )}
          <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, #0d0d16 0%, #0e0e18 100%)" }} />
          <div className="absolute inset-0" style={{ background: "linear-gradient(90deg, rgba(249,115,22,0.07) 0%, transparent 60%)" }} />
          <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: "linear-gradient(90deg, #f97316, transparent)" }} />

          <div className="relative container mx-auto px-4 py-12">
            <div className="flex flex-col lg:flex-row gap-8 items-start">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-3">
                  <span
                    className="text-xs font-bold px-2.5 py-1 rounded-full"
                    style={{
                      background: race.status === "completed" ? "rgba(107,114,128,0.15)" : race.status === "live" ? "rgba(34,197,94,0.15)" : "rgba(249,115,22,0.15)",
                      color: race.status === "completed" ? "#6b7280" : race.status === "live" ? "#22c55e" : "#f97316",
                    }}
                  >
                    {race.status === "completed" ? "Afgelopen" : race.status === "live" ? "🔴 LIVE" : "Upcoming"}
                  </span>
                  {race.leagues && <span className="text-xs text-gray-600">{race.leagues.name}</span>}
                </div>

                <h1 className="font-heading font-black text-4xl md:text-5xl text-white leading-none mb-4">{race.name}</h1>

                <div className="flex items-center gap-2 mb-4 text-gray-400">
                  <MapPin className="w-4 h-4 text-orange-500" />
                  <span className="font-medium">{race.track}</span>
                  {trackInfo?.country && <span className="text-gray-600">· {trackInfo.country}</span>}
                </div>

                <div className="flex flex-wrap gap-4 mb-6 text-sm text-gray-500">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    <span>{dateStr}</span>
                    <span className="font-bold text-orange-400 px-2 py-0.5 rounded" style={{ background: "rgba(249,115,22,0.08)" }}>{timeStr}</span>
                  </div>
                  {race.weather && <div className="flex items-center gap-1.5"><CloudSun className="w-4 h-4" />{race.weather}</div>}
                  {race.setup  && <div className="flex items-center gap-1.5"><Gauge className="w-4 h-4" />{race.setup}</div>}
                  {activeRegCount > 0 && <div className="flex items-center gap-1.5"><Users className="w-4 h-4" />{activeRegCount} deelnemers</div>}
                </div>

                {sessions.length > 0 && (
                  <div className="flex gap-2 flex-wrap">
                    {sessions.map((s: any) => (
                      <span key={s.label} className="text-xs font-bold px-3 py-1.5 rounded-lg" style={{ background: s.bg, color: s.color, border: `1px solid ${s.color}25` }}>
                        {s.label} · {s.dur}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {trackInfo?.imageUrl && (
                <div
                  className="w-64 h-64 rounded-2xl shrink-0 flex items-center justify-center"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
                >
                  <img src={trackInfo.imageUrl} alt={race.track} className="w-56 h-56 object-contain invert opacity-60" />
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="container mx-auto px-4 py-10">

          {/* Summary stats */}
          {race.status === "completed" && raceResults.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-10">
              {[
                { label: "Winner", value: winner?.profiles?.display_name || winner?.profiles?.iracing_name || "—", accent: "#facc15", icon: <Trophy className="w-4 h-4" /> },
                { label: "Snelste ronde", value: fastestLap?.profiles?.display_name || "—", accent: "#a855f7", icon: <Zap className="w-4 h-4" /> },
                { label: "Starters", value: raceResults.length, accent: null, icon: <Users className="w-4 h-4" /> },
                { label: "DNF's", value: dnfCount, accent: dnfCount > 0 ? "#ef4444" : null, icon: <Flag className="w-4 h-4" /> },
              ].map(({ label, value, accent, icon }) => (
                <div key={label} className="rounded-2xl p-5" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <div className="flex items-center gap-2 mb-2 text-gray-600" style={{ color: accent || undefined }}>{icon}<span className="text-[10px] uppercase tracking-widest">{label}</span></div>
                  <div className="font-heading font-black text-xl" style={{ color: accent || "#e5e7eb" }}>{value}</div>
                </div>
              ))}
            </div>
          )}

          {/* Results table */}
          {raceResults.length > 0 ? (
            <div>
              <div className="flex items-center gap-2 mb-6">
                <Trophy className="w-4 h-4 text-orange-500" />
                <span className="text-xs font-black text-orange-500 uppercase tracking-widest">Race Uitslag</span>
              </div>
              <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
                <div
                  className="grid gap-2 px-5 py-2.5 text-[10px] font-black uppercase tracking-widest text-gray-600"
                  style={{ gridTemplateColumns: "3rem 1fr 5rem 4rem 5rem 4rem", background: "rgba(255,255,255,0.03)" }}
                >
                  <span>Pos</span><span>Driver</span><span>Team</span><span>Pts</span><span>Beste ronde</span><span>Inc</span>
                </div>
                {raceResults.map((r: any, i: number) => {
                  const posColor = r.position <= 3 ? PODIUM[r.position - 1] : (r.dnf ? "#ef4444" : "#6b7280");
                  const team = activeTeams.find((t: any) => t.id === r.profiles?.team_id);
                  return (
                    <motion.div
                      key={r.id || i}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.03 }}
                      className="grid gap-2 px-5 py-3.5 items-center"
                      style={{ gridTemplateColumns: "3rem 1fr 5rem 4rem 5rem 4rem", borderTop: "1px solid rgba(255,255,255,0.04)", background: i === 0 ? "rgba(250,204,21,0.04)" : "transparent" }}
                    >
                      <div className="font-heading font-black text-base" style={{ color: posColor }}>
                        {r.dnf ? "DNF" : `P${r.position}`}
                      </div>
                      <div>
                        <div className="text-sm font-bold text-white truncate">{r.profiles?.display_name || r.profiles?.iracing_name || "Unknown"}</div>
                        {team && (
                          <div className="flex items-center gap-1 mt-0.5">
                            <div className="w-1 h-1 rounded-full" style={{ backgroundColor: team.color }} />
                            <span className="text-[10px] text-gray-600">{team.name}</span>
                          </div>
                        )}
                      </div>
                      <div className="text-xs text-gray-600 truncate">{team?.name || "—"}</div>
                      <div className="font-heading font-bold text-sm text-orange-400">{r.points}</div>
                      <div className="text-xs text-gray-500 tabular-nums">{r.best_lap || "—"}{r.fastest_lap && <span className="ml-1 text-purple-400">⚡</span>}</div>
                      <div className="text-xs text-gray-600">{r.incidents ?? 0}</div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="text-center py-16 text-gray-700 text-sm">
              {race.status === "upcoming" ? "Race nog niet gereden" : "Geen resultaten beschikbaar"}
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default RaceDetailPreview;
