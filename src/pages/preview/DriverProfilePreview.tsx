/**
 * DriverProfilePreview — Nieuwe driver profiel pagina (preview only)
 * Toegang via /preview/driver?id=USER_ID
 */
import { useSearchParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";
import { TrendingUp, Shield, Trophy, Flag, Zap, ArrowLeft, Users, AlertTriangle, Medal, FlaskConical } from "lucide-react";
import Navbar from "@/components/Navbar";
import StickyRaceBar from "@/components/StickyRaceBar";
import Footer from "@/components/Footer";
import { useMockMode } from "@/lib/useMockMode";
import { MOCK_PROFILES, MOCK_TEAMS, MOCK_DRIVER_RESULTS } from "@/lib/mockData";

const SAFETY_COLOR: Record<string, string> = {
  A: "#22c55e", B: "#eab308", C: "#f97316", D: "#ef4444",
};
const PODIUM_COLOR = ["#facc15", "#94a3b8", "#d97706"];

const StatBox = ({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) => (
  <div className="rounded-2xl p-5 text-center" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
    <div className="font-heading font-black text-3xl leading-none mb-1" style={{ color: accent || "#e5e7eb" }}>{value}</div>
    <div className="text-[11px] text-gray-600 uppercase tracking-widest">{label}</div>
  </div>
);

const DriverProfilePreview = () => {
  const [params] = useSearchParams();
  const selectedId = params.get("id");
  const [mockMode, setMockMode] = useMockMode();

  const { data: profiles = [], isLoading: driversLoading } = useQuery({
    queryKey: ["drivers"],
    queryFn: async () => {
      const { data } = await supabase.from("confirmed_profiles").select("*");
      return data || [];
    },
  });

  const { data: teams = [] } = useQuery({
    queryKey: ["teams"],
    queryFn: async () => {
      const { data } = await supabase.from("teams").select("id, name, color, logo_url");
      return data || [];
    },
  });

  const activeProfiles = mockMode ? MOCK_PROFILES : profiles;
  const activeTeams    = mockMode ? MOCK_TEAMS    : teams;

  // When navigating from /drivers with a real ID, always search real data first
  const driver: any = selectedId
    ? (profiles.find((p: any) => p.user_id === selectedId) || activeProfiles.find((p: any) => p.user_id === selectedId))
    : activeProfiles[0];

  const { data: realRaceResults = [] } = useQuery({
    queryKey: ["driver-race-results", driver?.user_id],
    enabled: !!driver?.user_id && !mockMode,
    queryFn: async () => {
      const { data } = await supabase
        .from("race_results")
        .select("*, races(name, track, race_date, league_id, leagues(name))")
        .eq("user_id", driver.user_id)
        .order("races(race_date)", { ascending: false });
      return data || [];
    },
  });

  const raceResults = mockMode
    ? (MOCK_DRIVER_RESULTS[driver?.user_id] || [])
    : realRaceResults;

  const team = driver ? activeTeams.find((t: any) => t.id === driver.team_id) : null;
  const safetyLetter = (driver?.safety_rating || "").split(" ")[0] || "?";
  const safColor = SAFETY_COLOR[safetyLetter] || "#6b7280";

  const wins = raceResults.filter((r: any) => r.position === 1).length;
  const podiums = raceResults.filter((r: any) => r.position <= 3).length;
  const totalPoints = raceResults.reduce((acc: number, r: any) => acc + (r.points || 0), 0);
  const avgInc = raceResults.length > 0
    ? (raceResults.reduce((a: number, r: any) => a + (r.incidents || 0), 0) / raceResults.length).toFixed(1)
    : "—";
  const bestFinish = raceResults.length > 0 ? Math.min(...raceResults.map((r: any) => r.position)) : null;
  const fastestLaps = raceResults.filter((r: any) => r.fastest_lap).length;

  if (!mockMode && selectedId && !driver && (driversLoading || profiles.length === 0)) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#08080f" }}>
        <div className="w-8 h-8 rounded-full border-2 border-orange-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!driver) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#08080f" }}>
        <div className="text-center">
          <p className="text-gray-600 text-sm mb-4">Geen driver geselecteerd</p>
          <Link to="/drivers" className="text-orange-500 text-sm hover:underline">← Terug naar drivers</Link>
        </div>
      </div>
    );
  }

  const name = driver.display_name || driver.iracing_name || "Unknown";
  const teamColor = team?.color || "#f97316";

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
            <span className="text-xs font-black text-orange-500 uppercase tracking-widest">Driver Profile Preview</span>
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

        {/* Driver selector */}
        {activeProfiles.length > 1 && (
          <div className="border-b border-white/5 overflow-x-auto">
            <div className="container mx-auto px-4">
              <div className="flex gap-1 py-2">
                {activeProfiles.map((p: any) => (
                  <Link
                    key={p.user_id}
                    to={`/preview/driver?id=${p.user_id}`}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors"
                    style={
                      (p.user_id === driver.user_id)
                        ? { background: "rgba(249,115,22,0.15)", color: "#f97316", border: "1px solid rgba(249,115,22,0.3)" }
                        : { color: "#6b7280", border: "1px solid transparent" }
                    }
                  >
                    {p.display_name || p.iracing_name || "Unknown"}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Hero */}
        <div className="relative overflow-hidden" style={{ minHeight: 280 }}>
          <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, #0d0d16 0%, #111120 100%)` }} />
          <div className="absolute inset-0" style={{ background: `linear-gradient(90deg, ${teamColor}12 0%, transparent 60%)` }} />
          <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: `linear-gradient(90deg, ${teamColor}, transparent)` }} />

          <div className="relative container mx-auto px-4 py-12">
            <div className="flex flex-col md:flex-row items-start md:items-center gap-8">
              <div
                className="w-24 h-24 rounded-3xl flex items-center justify-center font-heading font-black text-3xl shrink-0"
                style={{ background: `${teamColor}20`, border: `2px solid ${teamColor}40`, color: teamColor }}
              >
                {name.charAt(0).toUpperCase()}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-1">
                  {team && (
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: teamColor }} />
                      <span className="text-xs font-bold uppercase tracking-widest" style={{ color: teamColor }}>{team.name}</span>
                    </div>
                  )}
                </div>
                <h1
                  className="font-heading font-black text-4xl md:text-5xl text-white leading-none mb-3"
                  style={{ textShadow: `0 0 40px ${teamColor}30` }}
                >
                  {name}
                </h1>
                <div className="flex items-center gap-4 flex-wrap">
                  {driver.iracing_name && driver.display_name !== driver.iracing_name && (
                    <span className="text-sm text-gray-600">iRacing: {driver.iracing_name}</span>
                  )}
                  {driver.iracing_id && (
                    <span className="text-xs font-mono px-2 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.05)", color: "#6b7280" }}>
                      #{driver.iracing_id}
                    </span>
                  )}
                  {driver.safety_rating && (
                    <div className="flex items-center gap-1.5">
                      <Shield className="w-4 h-4" style={{ color: safColor }} />
                      <span className="text-sm font-bold" style={{ color: safColor }}>{driver.safety_rating}</span>
                    </div>
                  )}
                  {driver.irating && (
                    <div className="flex items-center gap-1.5">
                      <TrendingUp className="w-4 h-4 text-blue-400" />
                      <span className="text-sm font-bold text-white">{driver.irating.toLocaleString()}</span>
                      <span className="text-xs text-gray-600">iRating</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="text-right shrink-0">
                <div className="font-heading font-black text-6xl leading-none" style={{ color: teamColor }}>
                  {totalPoints}
                </div>
                <div className="text-xs text-gray-600 uppercase tracking-widest mt-1">Totaal punten</div>
              </div>
            </div>
          </div>
        </div>

        {/* Stats grid */}
        <div className="container mx-auto px-4 py-10">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-12">
            <StatBox label="Races"          value={raceResults.length} />
            <StatBox label="Wins"           value={wins}        accent={wins > 0 ? "#facc15" : undefined} />
            <StatBox label="Podiums"        value={podiums}     accent={podiums > 0 ? "#d97706" : undefined} />
            <StatBox label="Beste finish"   value={bestFinish ? `P${bestFinish}` : "—"} accent={bestFinish === 1 ? "#facc15" : undefined} />
            <StatBox label="Snelste ronden" value={fastestLaps} accent={fastestLaps > 0 ? "#a855f7" : undefined} />
            <StatBox label="Gem. incidents" value={avgInc} />
          </div>

          {/* iRating bar */}
          {driver.irating && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl p-6 mb-8"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-blue-400" />
                  <span className="text-sm font-bold text-white">iRating</span>
                </div>
                <span className="text-2xl font-heading font-black text-white">{driver.irating.toLocaleString()}</span>
              </div>
              <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min((driver.irating / 8000) * 100, 100)}%` }}
                  transition={{ duration: 1.2, ease: "easeOut" }}
                  className="h-full rounded-full"
                  style={{ background: "linear-gradient(90deg, #3b82f680, #3b82f6)" }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-gray-700 mt-1">
                <span>0</span><span>2000</span><span>4000</span><span>6000</span><span>8000+</span>
              </div>
            </motion.div>
          )}

          {/* Race history */}
          <div>
            <div className="flex items-center gap-2 mb-6">
              <Flag className="w-4 h-4 text-orange-500" />
              <span className="text-xs font-black text-orange-500 uppercase tracking-widest">Race Historie</span>
            </div>
            <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
              <div
                className="grid gap-2 px-5 py-2.5 text-[10px] font-black uppercase tracking-widest text-gray-600"
                style={{ gridTemplateColumns: "3rem 1fr 5rem 4rem 5rem 5rem", background: "rgba(255,255,255,0.03)" }}
              >
                <span>Pos</span><span>Race</span><span>Track</span><span>Pts</span><span>Snelste</span><span>Inc</span>
              </div>
              {raceResults.length === 0 && (
                <div className="text-center py-10 text-gray-700 text-sm">Nog geen race resultaten</div>
              )}
              {raceResults.map((r: any, i: number) => {
                const posColor = r.position <= 3 ? PODIUM_COLOR[r.position - 1] : "#6b7280";
                return (
                  <motion.div
                    key={r.id || i}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.04 }}
                    className="grid gap-2 px-5 py-3.5 items-center"
                    style={{ gridTemplateColumns: "3rem 1fr 5rem 4rem 5rem 5rem", borderTop: "1px solid rgba(255,255,255,0.04)" }}
                  >
                    <div className="font-heading font-black text-base" style={{ color: posColor }}>P{r.position}</div>
                    <div>
                      <div className="text-sm font-bold text-white truncate">{r.races?.name || "—"}</div>
                      <div className="text-[10px] text-gray-600">{r.races?.leagues?.name}</div>
                    </div>
                    <div className="text-xs text-gray-500 truncate">{r.races?.track || "—"}</div>
                    <div className="font-heading font-bold text-sm text-orange-400">{r.points}</div>
                    <div>{r.fastest_lap ? <span className="text-[10px] font-bold text-purple-400 px-1.5 py-0.5 rounded" style={{ background: "rgba(168,85,247,0.1)" }}>⚡ Snelst</span> : <span className="text-gray-700">—</span>}</div>
                    <div className="text-xs text-gray-600">{r.incidents ?? 0}</div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default DriverProfilePreview;
