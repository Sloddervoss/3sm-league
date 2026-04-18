/**
 * StandingsFullPreview — Volledige standings pagina (preview only)
 * Toegang via /preview/standings
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";
import { Trophy, Users, Car, ArrowLeft, FlaskConical } from "lucide-react";
import Navbar from "@/components/Navbar";
import StickyRaceBar from "@/components/StickyRaceBar";
import Footer from "@/components/Footer";
import { useMockMode } from "@/lib/useMockMode";
import { MOCK_LEAGUE, MOCK_STANDINGS_FULL, MOCK_TEAM_STANDINGS } from "@/lib/mockData";

const PODIUM_C      = ["#facc15", "#94a3b8", "#d97706"];
const PODIUM_BG     = ["rgba(250,204,21,0.08)", "rgba(148,163,184,0.06)", "rgba(217,119,6,0.07)"];
const PODIUM_BORDER = ["rgba(250,204,21,0.2)", "rgba(148,163,184,0.15)", "rgba(217,119,6,0.15)"];

const StandingsFullPreview = () => {
  const [activeLeague, setActiveLeague] = useState<string | null>(null);
  const [view, setView] = useState<"drivers" | "teams">("drivers");
  const [mockMode, setMockMode] = useMockMode();

  const { data: leagues = [] } = useQuery({
    queryKey: ["leagues-for-standings"],
    queryFn: async () => {
      const { data } = await supabase.from("leagues").select("id, name, season, car_class").order("created_at", { ascending: false });
      return data || [];
    },
  });

  const leagueId = activeLeague ?? (mockMode ? MOCK_LEAGUE.id : (leagues[0]?.id ?? null));

  const { data: teams = [] } = useQuery({
    queryKey: ["teams"],
    queryFn: async () => {
      const { data } = await supabase.from("teams").select("id, name, color, logo_url");
      return data || [];
    },
  });

  const { data: realStandings = [], isLoading } = useQuery({
    queryKey: ["standings-full", leagueId],
    enabled: !!leagueId && !mockMode,
    queryFn: async () => {
      const { data: res } = await supabase.from("race_results").select("user_id, position, points, incidents, fastest_lap, race_id, races(league_id)");
      const filtered = (res || []).filter((r: any) => r.races?.league_id === leagueId);
      const map = new Map<string, { points: number; wins: number; podiums: number; races: number; fastest: number; incidents: number }>();
      filtered.forEach((r: any) => {
        const e = map.get(r.user_id) || { points: 0, wins: 0, podiums: 0, races: 0, fastest: 0, incidents: 0 };
        e.points += r.points; e.races++;
        if (r.position === 1) e.wins++;
        if (r.position <= 3) e.podiums++;
        if (r.fastest_lap) e.fastest++;
        e.incidents += r.incidents || 0;
        map.set(r.user_id, e);
      });
      const userIds = Array.from(map.keys());
      if (!userIds.length) return [];
      const { data: profs } = await supabase.from("profiles").select("user_id, display_name, team_id, irating").in("user_id", userIds);
      return userIds.map((uid) => {
        const s = map.get(uid)!;
        const prof = (profs || []).find((p: any) => p.user_id === uid);
        const team = teams.find((t: any) => t.id === prof?.team_id);
        return { user_id: uid, display_name: prof?.display_name || "Unknown", irating: prof?.irating, team, ...s };
      }).sort((a, b) => b.points - a.points);
    },
  });

  const { data: realTeamStandings = [] } = useQuery({
    queryKey: ["team-standings-full", leagueId, teams],
    enabled: !!leagueId && teams.length > 0 && !mockMode,
    queryFn: async () => {
      const { data: res } = await supabase.from("race_results").select("user_id, position, points, race_id, races(league_id)");
      const filtered = (res || []).filter((r: any) => r.races?.league_id === leagueId);
      const { data: memberships } = await supabase.from("team_memberships").select("user_id, team_id");
      const teamMap = new Map<string, { points: number; wins: number }>();
      filtered.forEach((r: any) => {
        const m = memberships?.find((mb: any) => mb.user_id === r.user_id);
        if (!m) return;
        const e = teamMap.get(m.team_id) || { points: 0, wins: 0 };
        e.points += r.points;
        if (r.position === 1) e.wins++;
        teamMap.set(m.team_id, e);
      });
      return teams
        .map((t: any) => ({ ...t, ...(teamMap.get(t.id) || { points: 0, wins: 0 }) }))
        .sort((a: any, b: any) => b.points - a.points);
    },
  });

  const standings     = mockMode ? MOCK_STANDINGS_FULL  : realStandings;
  const teamStandings = mockMode ? MOCK_TEAM_STANDINGS   : realTeamStandings;
  const activeLeagues = mockMode ? [MOCK_LEAGUE]          : leagues;

  const top3Driver = [standings[1], standings[0], standings[2]];
  const top3Team   = [teamStandings[1], teamStandings[0], teamStandings[2]];
  const topPodium  = view === "drivers" ? top3Driver : top3Team;
  const actualRanks = [2, 1, 3];

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
            <span className="text-xs font-black text-orange-500 uppercase tracking-widest">Standings Preview</span>
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

        {/* Header */}
        <div
          className="relative overflow-hidden py-12"
          style={{ background: "linear-gradient(180deg, #0d0d18 0%, #08080f 100%)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}
        >
          <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: "linear-gradient(90deg, #f97316, transparent)" }} />
          <div className="container mx-auto px-4">
            <div className="flex items-center gap-2 mb-2">
              <Trophy className="w-4 h-4 text-orange-500" />
              <span className="text-xs font-black text-orange-500 uppercase tracking-widest">Championship</span>
            </div>
            <h1 className="font-heading font-black text-5xl md:text-6xl text-white leading-none">STANDINGS</h1>
          </div>
        </div>

        {/* League tabs + toggle */}
        <div className="sticky top-[calc(4rem+2.25rem)] z-30 border-b border-white/5" style={{ background: "rgba(8,8,15,0.95)", backdropFilter: "blur(12px)" }}>
          <div className="container mx-auto px-4">
            <div className="flex items-center justify-between py-2">
              <div className="flex gap-1 overflow-x-auto">
                {activeLeagues.map((l: any) => (
                  <button
                    key={l.id}
                    onClick={() => setActiveLeague(l.id)}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold whitespace-nowrap transition-colors"
                    style={
                      leagueId === l.id
                        ? { background: "rgba(249,115,22,0.15)", color: "#f97316", border: "1px solid rgba(249,115,22,0.3)" }
                        : { color: "#6b7280", border: "1px solid transparent" }
                    }
                  >
                    {l.name}
                    {l.season && <span className="opacity-60">{l.season}</span>}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1 p-1 rounded-lg shrink-0" style={{ background: "rgba(255,255,255,0.05)" }}>
                <button
                  onClick={() => setView("drivers")}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-colors"
                  style={view === "drivers" ? { background: "#f97316", color: "#fff" } : { color: "#6b7280" }}
                >
                  <Users className="w-3 h-3" /> Drivers
                </button>
                <button
                  onClick={() => setView("teams")}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-colors"
                  style={view === "teams" ? { background: "#f97316", color: "#fff" } : { color: "#6b7280" }}
                >
                  <Car className="w-3 h-3" /> Teams
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="container mx-auto px-4 py-12">
          {isLoading && !mockMode ? (
            <div className="animate-pulse space-y-3">
              {[1,2,3,4,5].map(i => <div key={i} className="h-14 rounded-xl bg-white/5" />)}
            </div>
          ) : (
            <>
              {/* Podium */}
              {topPodium.filter(Boolean).length >= 2 && (
                <div className="grid grid-cols-3 gap-4 mb-8 items-end max-w-2xl mx-auto">
                  {topPodium.map((item: any, vi: number) => {
                    const rank = actualRanks[vi];
                    if (!item) return <div key={vi} />;
                    const c = PODIUM_C[rank - 1];
                    const isCenter = vi === 1;
                    const name = view === "drivers" ? item.display_name : item.name;
                    const pts  = item.points;
                    const delta = (topPodium[1] as any)?.points - pts;

                    return (
                      <motion.div
                        key={item.user_id || item.id}
                        initial={{ opacity: 0, y: 24 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: vi * 0.1 }}
                        className={`rounded-2xl p-5 text-center ${isCenter ? "pt-7 pb-7" : ""}`}
                        style={{ background: PODIUM_BG[rank-1], border: `1px solid ${PODIUM_BORDER[rank-1]}`, boxShadow: isCenter ? `0 8px 40px ${c}20` : "none" }}
                      >
                        {view === "teams" && item.color && (
                          <div className="w-8 h-8 rounded-full mx-auto mb-2" style={{ background: item.color, boxShadow: `0 0 12px ${item.color}50` }} />
                        )}
                        <div
                          className={`mx-auto mb-3 rounded-full flex items-center justify-center font-heading font-black ${isCenter ? "w-12 h-12 text-xl" : "w-9 h-9 text-base"}`}
                          style={{ background: `${c}20`, border: `2px solid ${c}50`, color: c, boxShadow: isCenter ? `0 0 20px ${c}30` : "none" }}
                        >
                          {rank}
                        </div>
                        <div className="font-heading font-bold text-sm text-white truncate mb-1">{name}</div>
                        {view === "drivers" && item.team && (
                          <div className="flex items-center justify-center gap-1 mb-2">
                            <div className="w-1 h-1 rounded-full" style={{ backgroundColor: item.team.color }} />
                            <span className="text-[10px] text-gray-600">{item.team.name}</span>
                          </div>
                        )}
                        <div className="font-heading font-black mt-2 leading-none" style={{ fontSize: isCenter ? "2rem" : "1.5rem", color: c }}>{pts}</div>
                        <div className="text-[10px] text-gray-600 mt-0.5">pts</div>
                        {delta > 0 && <div className="text-[10px] text-gray-700 mt-1">-{delta}</div>}
                      </motion.div>
                    );
                  })}
                </div>
              )}

              {/* Full table */}
              <div className="rounded-2xl overflow-hidden max-w-3xl mx-auto" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
                <div
                  className="grid gap-2 px-5 py-2.5 text-[10px] font-black uppercase tracking-widest text-gray-600"
                  style={{ gridTemplateColumns: view === "drivers" ? "2.5rem 1fr 4rem 4rem 4rem 4rem" : "2.5rem 1fr 4rem 5rem", background: "rgba(255,255,255,0.03)" }}
                >
                  <span>Pos</span>
                  <span>{view === "drivers" ? "Driver" : "Team"}</span>
                  {view === "drivers"
                    ? <><span className="text-center">Races</span><span className="text-center">Wins</span><span className="text-center">FL</span></>
                    : <span className="text-center">Wins</span>}
                  <span className="text-center">PTS</span>
                </div>

                {(view === "drivers" ? standings : teamStandings).map((item: any, i: number) => {
                  const podColor  = i < 3 ? PODIUM_C[i] : null;
                  const name      = view === "drivers" ? item.display_name : item.name;
                  const glowColor = view === "drivers" ? item.team?.color : item.color;
                  const linkTo    = view === "drivers"
                    ? `/preview/driver?id=${item.user_id}`
                    : `/preview/team?id=${item.id}`;

                  return (
                    <motion.div
                      key={item.user_id || item.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: Math.min(i, 10) * 0.03 }}
                      className="relative overflow-hidden"
                      style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}
                    >
                      {/* Team/own color left glow bar */}
                      {glowColor && (
                        <div
                          className="absolute left-0 top-0 bottom-0 w-0.5"
                          style={{ background: glowColor, boxShadow: `2px 0 8px ${glowColor}60` }}
                        />
                      )}
                      <Link
                        to={linkTo}
                        className="group grid gap-2 pl-5 pr-5 py-3.5 items-center"
                        style={{
                          gridTemplateColumns: view === "drivers" ? "2.5rem 1fr 4rem 4rem 4rem 4rem" : "2.5rem 1fr 4rem 5rem",
                          display: "grid",
                          background: glowColor
                            ? `linear-gradient(90deg, ${glowColor}08 0%, transparent 40%)`
                            : "transparent",
                          transition: "background 0.15s",
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = glowColor ? `linear-gradient(90deg, ${glowColor}18 0%, rgba(255,255,255,0.02) 60%)` : "rgba(255,255,255,0.025)")}
                        onMouseLeave={e => (e.currentTarget.style.background = glowColor ? `linear-gradient(90deg, ${glowColor}08 0%, transparent 40%)` : "transparent")}
                      >
                        <div
                          className="w-8 h-8 rounded-lg flex items-center justify-center font-heading font-black text-sm"
                          style={podColor ? { background: `${podColor}15`, color: podColor } : { color: "#4b5563" }}
                        >
                          {i + 1}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            {i === 0 && <div className="w-1 h-4 rounded-full bg-orange-500 shrink-0" />}
                            {view === "teams" && item.color && (
                              <div className="w-2 h-6 rounded-sm shrink-0" style={{ backgroundColor: item.color, boxShadow: `0 0 6px ${item.color}80` }} />
                            )}
                            <span className="font-heading font-bold text-sm text-white truncate group-hover:text-orange-400 transition-colors">{name}</span>
                          </div>
                          {view === "drivers" && item.team && (
                            <div className="flex items-center gap-1 mt-0.5">
                              <div className="w-1 h-1 rounded-full" style={{ backgroundColor: item.team.color }} />
                              <span className="text-[10px] truncate" style={{ color: item.team.color + "99" }}>{item.team.name}</span>
                            </div>
                          )}
                        </div>
                        {view === "drivers" ? (
                          <>
                            <div className="text-center text-xs text-gray-600">{item.races}</div>
                            <div className="text-center font-bold text-sm" style={{ color: item.wins > 0 ? "#facc15" : "#4b5563" }}>{item.wins}</div>
                            <div className="text-center text-xs" style={{ color: item.fastest > 0 ? "#a855f7" : "#4b5563" }}>{item.fastest}</div>
                          </>
                        ) : (
                          <div className="text-center font-bold text-sm" style={{ color: item.wins > 0 ? "#facc15" : "#4b5563" }}>{item.wins}</div>
                        )}
                        <div className="text-center font-heading font-black text-base" style={{ color: podColor || "#d1d5db" }}>
                          {item.points}
                        </div>
                      </Link>
                    </motion.div>
                  );
                })}

                {!standings.length && !teamStandings.length && (
                  <div className="text-center py-12 text-gray-700 text-sm">Nog geen resultaten</div>
                )}
              </div>
            </>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default StandingsFullPreview;
