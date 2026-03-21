/**
 * TeamProfilePreview — Nieuwe team profiel pagina (preview only)
 * Toegang via /preview/team?id=TEAM_ID
 */
import { useSearchParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";
import { Users, Trophy, Shield, ArrowLeft, Flag, TrendingUp, FlaskConical } from "lucide-react";
import Navbar from "@/components/Navbar";
import StickyRaceBar from "@/components/StickyRaceBar";
import Footer from "@/components/Footer";
import { useMockMode } from "@/lib/useMockMode";
import { MOCK_TEAMS, MOCK_MEMBERSHIPS, MOCK_ALL_RESULTS } from "@/lib/mockData";

const PODIUM = ["#facc15", "#94a3b8", "#d97706"];

const TeamProfilePreview = () => {
  const [params] = useSearchParams();
  const selectedId = params.get("id");
  const [mockMode, setMockMode] = useMockMode();

  const { data: teams = [], isLoading: teamsLoading } = useQuery({
    queryKey: ["teams"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("teams").select("*").order("name");
      return data || [];
    },
  });

  const { data: memberships = [] } = useQuery({
    queryKey: ["team-memberships-with-profiles"],
    queryFn: async () => {
      const { data } = await supabase.from("team_memberships").select("*, profiles(user_id, display_name, iracing_name, irating, safety_rating, iracing_id)");
      return data || [];
    },
  });

  const { data: allResults = [] } = useQuery({
    queryKey: ["all-results-with-profiles"],
    queryFn: async () => {
      const { data } = await supabase.from("race_results").select("*, races(name, track, race_date, leagues(name))");
      return data || [];
    },
  });

  const activeTeams      = mockMode ? MOCK_TEAMS      : teams;
  const activeMemberships = mockMode ? MOCK_MEMBERSHIPS : memberships;
  const activeAllResults  = mockMode ? MOCK_ALL_RESULTS  : allResults;

  // When navigating from /teams with a real ID, always search real data first
  const team: any = selectedId
    ? (teams.find((t: any) => t.id === selectedId) || activeTeams.find((t: any) => t.id === selectedId))
    : activeTeams[0];

  const color = team?.color || "#f97316";

  const members = activeMemberships.filter((m: any) => m.team_id === team?.id);
  const memberIds = members.map((m: any) => m.user_id);

  const teamResults = activeAllResults.filter((r: any) => memberIds.includes(r.user_id));
  const totalPoints = teamResults.reduce((a: number, r: any) => a + (r.points || 0), 0);
  const wins    = teamResults.filter((r: any) => r.position === 1).length;
  const podiums = teamResults.filter((r: any) => r.position <= 3).length;
  const races   = new Set(teamResults.map((r: any) => r.race_id)).size;

  const driverStats = members.map((m: any) => {
    const dr = teamResults.filter((r: any) => r.user_id === m.user_id);
    return {
      ...m,
      races:   dr.length,
      wins:    dr.filter((r: any) => r.position === 1).length,
      podiums: dr.filter((r: any) => r.position <= 3).length,
      points:  dr.reduce((a: number, r: any) => a + (r.points || 0), 0),
    };
  }).sort((a: any, b: any) => b.points - a.points);

  const recentResults = teamResults
    .sort((a: any, b: any) => new Date(b.races?.race_date || 0).getTime() - new Date(a.races?.race_date || 0).getTime())
    .slice(0, 10);

  if (!mockMode && selectedId && !team && (teamsLoading || teams.length === 0)) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#08080f" }}>
        <div className="w-8 h-8 rounded-full border-2 border-orange-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!team) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#08080f" }}>
        <div className="text-center">
          <p className="text-gray-600 text-sm mb-4">Geen team geselecteerd</p>
          <Link to="/teams" className="text-orange-500 text-sm hover:underline">← Terug naar teams</Link>
        </div>
      </div>
    );
  }

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
            <span className="text-xs font-black text-orange-500 uppercase tracking-widest">Team Profile Preview</span>
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

        {/* Team selector */}
        {activeTeams.length > 1 && (
          <div className="border-b border-white/5 overflow-x-auto">
            <div className="container mx-auto px-4">
              <div className="flex gap-1 py-2">
                {activeTeams.map((t: any) => (
                  <Link
                    key={t.id}
                    to={`/preview/team?id=${t.id}`}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors"
                    style={
                      t.id === team.id
                        ? { background: `${t.color}20`, color: t.color, border: `1px solid ${t.color}40` }
                        : { color: "#6b7280", border: "1px solid transparent" }
                    }
                  >
                    <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: t.color }} />
                    {t.name}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Hero */}
        <div className="relative overflow-hidden" style={{ minHeight: 300 }}>
          <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, #0d0d16, #0e0e18)` }} />
          <div className="absolute inset-0" style={{ background: `radial-gradient(ellipse at 70% 50%, ${color}18 0%, transparent 60%)` }} />
          <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: `linear-gradient(90deg, ${color}, transparent)` }} />

          <div className="relative container mx-auto px-4 py-12">
            <div className="flex flex-col md:flex-row items-start md:items-center gap-10">
              <div
                className="w-32 h-32 rounded-3xl flex items-center justify-center shrink-0"
                style={{ background: `${color}15`, border: `2px solid ${color}35` }}
              >
                {team.logo_url ? (
                  <img src={team.logo_url} alt={team.name} className="w-28 h-28 object-contain drop-shadow-xl" />
                ) : (
                  <Shield className="w-16 h-16" style={{ color, opacity: 0.5 }} />
                )}
              </div>

              <div className="flex-1">
                <h1
                  className="font-heading font-black text-5xl text-white leading-none mb-2"
                  style={{ textShadow: `0 0 40px ${color}30` }}
                >
                  {team.name}
                </h1>
                {team.description && (
                  <p className="text-gray-500 text-sm mb-4 max-w-lg">{team.description}</p>
                )}
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5 text-sm" style={{ color }}>
                    <Users className="w-4 h-4" />
                    <span>{members.length} drivers</span>
                  </div>
                </div>
              </div>

              <div className="text-right shrink-0">
                <div className="font-heading font-black text-6xl leading-none" style={{ color }}>{totalPoints}</div>
                <div className="text-xs text-gray-600 uppercase tracking-widest mt-1">Championship punten</div>
              </div>
            </div>
          </div>
        </div>

        <div className="container mx-auto px-4 py-10">
          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-12">
            {[
              { label: "Wins",    value: wins,           accent: wins > 0 ? "#facc15" : null },
              { label: "Podiums", value: podiums,         accent: podiums > 0 ? "#d97706" : null },
              { label: "Races",   value: races,           accent: null },
              { label: "Drivers", value: members.length,  accent: null },
            ].map(({ label, value, accent }) => (
              <div key={label} className="rounded-2xl p-5 text-center" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="font-heading font-black text-3xl leading-none mb-1" style={{ color: accent || "#e5e7eb" }}>{value}</div>
                <div className="text-[11px] text-gray-600 uppercase tracking-widest">{label}</div>
              </div>
            ))}
          </div>

          {/* Drivers */}
          <div className="mb-12">
            <div className="flex items-center gap-2 mb-6">
              <Users className="w-4 h-4 text-orange-500" />
              <span className="text-xs font-black text-orange-500 uppercase tracking-widest">Drivers</span>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              {driverStats.map((m: any, i: number) => {
                const prof = m.profiles;
                const safLetter = (prof?.safety_rating || "").split(" ")[0];
                const safColor: Record<string, string> = { A: "#22c55e", B: "#eab308", C: "#f97316", D: "#ef4444" };
                return (
                  <motion.div
                    key={m.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.07 }}
                    className="rounded-2xl p-5 flex items-center gap-4"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
                  >
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center font-heading font-black text-sm shrink-0"
                      style={{ background: `${color}20`, border: `1.5px solid ${color}40`, color }}
                    >
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-heading font-bold text-base text-white truncate">
                        {prof?.display_name || prof?.iracing_name || "Unknown"}
                        {m.role === "reserve" && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-600">Reserve</span>}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        {prof?.irating && (
                          <span className="text-xs text-blue-400 flex items-center gap-1">
                            <TrendingUp className="w-3 h-3" />{prof.irating.toLocaleString()}
                          </span>
                        )}
                        {prof?.safety_rating && (
                          <span className="text-xs font-bold" style={{ color: safColor[safLetter] || "#6b7280" }}>
                            {prof.safety_rating}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-heading font-black text-xl" style={{ color }}>{m.points}</div>
                      <div className="text-[10px] text-gray-600">pts</div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>

          {/* Recent results */}
          {recentResults.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-6">
                <Flag className="w-4 h-4 text-orange-500" />
                <span className="text-xs font-black text-orange-500 uppercase tracking-widest">Recente Resultaten</span>
              </div>
              <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="grid gap-2 px-5 py-2.5 text-[10px] font-black uppercase tracking-widest text-gray-600"
                  style={{ gridTemplateColumns: "3rem 1fr 1fr 4rem 4rem", background: "rgba(255,255,255,0.03)" }}>
                  <span>Pos</span><span>Race</span><span>Driver</span><span>Pts</span><span>Inc</span>
                </div>
                {recentResults.map((r: any, i: number) => {
                  const posColor = r.position <= 3 ? PODIUM[r.position - 1] : "#6b7280";
                  const drMember = members.find((m: any) => m.user_id === r.user_id);
                  const drName = drMember?.profiles?.display_name || drMember?.profiles?.iracing_name || "Unknown";
                  return (
                    <div key={r.id || i} className="grid gap-2 px-5 py-3 items-center"
                      style={{ gridTemplateColumns: "3rem 1fr 1fr 4rem 4rem", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                      <div className="font-heading font-black text-sm" style={{ color: posColor }}>P{r.position}</div>
                      <div className="text-sm text-white truncate">{r.races?.name}</div>
                      <div className="text-xs text-gray-500 truncate">{drName}</div>
                      <div className="text-sm font-bold text-orange-400">{r.points}</div>
                      <div className="text-xs text-gray-600">{r.incidents ?? 0}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default TeamProfilePreview;
