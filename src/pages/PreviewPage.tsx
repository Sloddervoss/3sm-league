/**
 * PREVIEW PAGE — Nieuwe UI/UX designs
 * Volledig geïsoleerd. Geen bestaande pagina's gewijzigd.
 * Toegankelijk via /preview (niet in navigatie)
 */
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import NewHeroRace from "@/components/preview/NewHeroRace";
import NewDriverCard from "@/components/preview/NewDriverCard";
import NewTeamCard from "@/components/preview/NewTeamCard";
import NewStandingsTable from "@/components/preview/NewStandingsTable";
import NewRaceCard from "@/components/preview/NewRaceCard";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Eye, Users, Car, Trophy, Calendar, ChevronRight, ExternalLink, FlaskConical } from "lucide-react";
import {
  MOCK_TEAMS, MOCK_PROFILES, MOCK_STATS, MOCK_STANDINGS, MOCK_MEMBERSHIPS,
} from "@/lib/mockData";

// ── Countdown ──────────────────────────────────────────────
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

// ── Section header ─────────────────────────────────────────
interface SectionHeaderProps {
  icon: React.ReactNode;
  overline: string;
  title: string;
  action?: string;
}
const SectionHeader = ({ icon, overline, title, action }: SectionHeaderProps) => (
  <div className="flex items-end justify-between mb-8">
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-orange-500">{icon}</span>
        <span className="text-xs font-black text-orange-500 uppercase tracking-[0.25em]">{overline}</span>
      </div>
      <h2 className="font-heading font-black text-3xl md:text-4xl text-white leading-none">{title}</h2>
    </div>
    {action && (
      <button className="flex items-center gap-1 text-xs text-gray-600 hover:text-orange-500 transition-colors font-medium">
        {action} <ChevronRight className="w-3 h-3" />
      </button>
    )}
  </div>
);

// ── Divider ────────────────────────────────────────────────
const Divider = () => (
  <div
    className="h-px w-full my-20"
    style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)" }}
  />
);

// ── Preview Banner ─────────────────────────────────────────
interface BannerProps { mockMode: boolean; onToggle: () => void; }
const PreviewBanner = ({ mockMode, onToggle }: BannerProps) => (
  <div
    className="sticky top-16 z-40 flex items-center justify-between px-6 py-2"
    style={{ background: "rgba(8,8,15,0.9)", borderBottom: "1px solid rgba(249,115,22,0.15)", backdropFilter: "blur(12px)" }}
  >
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2">
        <Eye className="w-3.5 h-3.5 text-orange-500" />
        <span className="text-xs font-black text-orange-500 uppercase tracking-widest">Design Preview</span>
      </div>
      <div className="w-px h-3 bg-white/10" />
      <span className="text-xs text-gray-600">Nieuwe UI · geen bestaande pagina's gewijzigd</span>
    </div>
    <button
      onClick={onToggle}
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
);

// ══════════════════════════════════════════════════════════
const PreviewPage = () => {
  const now = useNow();
  const [mockMode, setMockMode] = useState(false);

  // ── Data (exact zelfde queries als bestaande pagina's) ──
  const { data: profiles = [] } = useQuery({
    queryKey: ["drivers"],
    queryFn: async () => {
      const { data } = await supabase.from("confirmed_profiles").select("*");
      return data || [];
    },
  });

  const { data: driverStats } = useQuery({
    queryKey: ["driver-stats"],
    queryFn: async () => {
      const { data } = await supabase.from("race_results").select("user_id, position, points, incidents");
      const map = new Map<string, { races: number; wins: number; podiums: number; points: number; incidents: number }>();
      data?.forEach((r: any) => {
        const e = map.get(r.user_id) || { races: 0, wins: 0, podiums: 0, points: 0, incidents: 0 };
        e.races++; e.points += r.points;
        if (r.position === 1) e.wins++;
        if (r.position <= 3) e.podiums++;
        e.incidents += r.incidents || 0;
        map.set(r.user_id, e);
      });
      return map;
    },
  });

  const { data: teams = [] } = useQuery({
    queryKey: ["teams"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("teams").select("*").order("name");
      return data || [];
    },
  });

  const { data: memberships = [] } = useQuery({
    queryKey: ["team-memberships-with-profiles"],
    queryFn: async () => {
      const { data } = await supabase.from("team_memberships").select("*, profiles(display_name, iracing_name)");
      return data || [];
    },
  });

  const { data: results = [] } = useQuery({
    queryKey: ["team-results"],
    queryFn: async () => {
      const { data } = await supabase.from("race_results").select("user_id, position, points");
      return data || [];
    },
  });

  const { data: leagues = [] } = useQuery({
    queryKey: ["leagues-for-standings"],
    queryFn: async () => {
      const { data } = await supabase.from("leagues").select("id, name, season, car_class").order("created_at", { ascending: false });
      return data || [];
    },
  });

  const { data: races = [] } = useQuery({
    queryKey: ["races-with-leagues"],
    queryFn: async () => {
      const { data } = await supabase.from("races").select("*, leagues(name, car_class, id)").order("race_date", { ascending: true });
      return data || [];
    },
  });

  const { data: standingsData = [] } = useQuery({
    queryKey: ["standings-preview", leagues?.[0]?.id],
    enabled: !!leagues?.length && !!teams?.length,
    queryFn: async () => {
      const leagueId = leagues[0].id;
      const { data: res } = await supabase.from("race_results").select("user_id, position, points, race_id, races(league_id)");
      const filtered = (res || []).filter((r: any) => r.races?.league_id === leagueId);
      const map = new Map<string, { total_points: number; wins: number }>();
      filtered.forEach((r: any) => {
        const e = map.get(r.user_id) || { total_points: 0, wins: 0 };
        e.total_points += r.points;
        if (r.position === 1) e.wins++;
        map.set(r.user_id, e);
      });
      const userIds = Array.from(map.keys());
      if (!userIds.length) return [];
      const { data: profs } = await supabase.from("profiles").select("user_id, display_name, team_id").in("user_id", userIds);
      return userIds.map((uid) => {
        const stats = map.get(uid)!;
        const prof = (profs || []).find((p: any) => p.user_id === uid);
        const team = teams.find((t: any) => t.id === prof?.team_id);
        return {
          user_id: uid,
          display_name: prof?.display_name || "Unknown",
          total_points: stats.total_points,
          wins: stats.wins,
          team: team ? { name: team.name, color: team.color } : undefined,
        };
      }).sort((a: any, b: any) => b.total_points - a.total_points);
    },
  });

  const { data: raceRegs = [] } = useQuery({
    queryKey: ["race-registrations"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("race_registrations").select("race_id");
      return data || [];
    },
  });

  // ── Mock data merge ──────────────────────────────────────
  const activeProfiles  = mockMode ? MOCK_PROFILES  : profiles;
  const activeTeams     = mockMode ? MOCK_TEAMS     : teams;
  const activeMemberships = mockMode ? MOCK_MEMBERSHIPS : memberships;
  const activeStandings = mockMode ? MOCK_STANDINGS : standingsData;
  const activeStatsMap  = mockMode
    ? new Map(Object.entries(MOCK_STATS))
    : driverStats;

  // ── Derived data ─────────────────────────────────────────
  const sortedDrivers = [...activeProfiles].sort((a: any, b: any) =>
    (activeStatsMap?.get(b.user_id)?.points || 0) - (activeStatsMap?.get(a.user_id)?.points || 0)
  );

  const getTeamMembers = (teamId: string) => activeMemberships.filter((m: any) => m.team_id === teamId);
  const getTeamStats = (teamId: string) => {
    if (mockMode) {
      const ids = getTeamMembers(teamId).map((m: any) => m.user_id);
      let total = 0, wins = 0;
      ids.forEach((id: string) => {
        const s = MOCK_STATS[id];
        if (s) { total += s.points; wins += s.wins; }
      });
      return { total, wins };
    }
    const ids = getTeamMembers(teamId).map((m: any) => m.user_id);
    let total = 0, wins = 0;
    results.forEach((r: any) => { if (ids.includes(r.user_id)) { total += r.points; if (r.position === 1) wins++; } });
    return { total, wins };
  };

  const nextRace = [...races]
    .filter((r: any) => r.status !== "completed" && new Date(r.race_date) > now)
    .sort((a: any, b: any) => new Date(a.race_date).getTime() - new Date(b.race_date).getTime())[0] as any;

  const upcomingRaces = races.filter((r: any) => r.status !== "completed").slice(0, 8);
  const activeLeagueName = leagues?.[0]?.name;

  const sortedTeams = [...activeTeams]
    .map((t: any) => ({ ...t, ...getTeamStats(t.id) }))
    .sort((a: any, b: any) => b.total - a.total);

  const nextRaceRegCount = nextRace
    ? raceRegs.filter((r: any) => r.race_id === nextRace.id).length
    : 0;

  // ══════════════════════════════════════════════════════════
  return (
    <div className="min-h-screen" style={{ background: "#08080f" }}>
      <Navbar />
      <PreviewBanner mockMode={mockMode} onToggle={() => setMockMode(m => !m)} />

      <main className="pt-8">
        <div className="container mx-auto px-4 max-w-7xl">

          {/* ═══ PREVIEW SUB-PAGES NAV ═════════════════════ */}
          <div className="py-8 mb-4">
            <div className="flex items-center gap-2 mb-4">
              <ExternalLink className="w-4 h-4 text-orange-500" />
              <span className="text-xs font-black text-orange-500 uppercase tracking-widest">Preview Sub-Pages</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { to: "/preview/driver", label: "Driver Profile", icon: <Users className="w-5 h-5" />, desc: "Driver stats, race history, iRating" },
                { to: "/preview/race",   label: "Race Detail",    icon: <Calendar className="w-5 h-5" />, desc: "Race info, resultaten, track map" },
                { to: "/preview/team",   label: "Team Profile",   icon: <Car className="w-5 h-5" />, desc: "Team stats, drivers, resultaten" },
                { to: "/preview/standings", label: "Standings",   icon: <Trophy className="w-5 h-5" />, desc: "Volledig kampioenschap overzicht" },
              ].map(({ to, label, icon, desc }) => (
                <Link
                  key={to}
                  to={to}
                  className="group rounded-xl p-4 transition-all"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-orange-500 group-hover:scale-110 transition-transform">{icon}</span>
                    <span className="font-heading font-black text-sm text-white">{label}</span>
                    <ExternalLink className="w-3 h-3 text-gray-700 ml-auto group-hover:text-orange-500 transition-colors" />
                  </div>
                  <p className="text-[11px] text-gray-600">{desc}</p>
                </Link>
              ))}
            </div>
          </div>

          {/* ═══ HERO NEXT RACE ════════════════════════════ */}
          {nextRace && (
            <section className="mb-4">
              <NewHeroRace
                race={nextRace}
                countdown={formatCountdown(nextRace.race_date, now)}
                registrantCount={nextRaceRegCount}
              />
            </section>
          )}

          {/* ═══ CALENDAR + STANDINGS (2-col) ══════════════ */}
          <section className="py-16">
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-8">

              {/* Calendar */}
              <div>
                <SectionHeader
                  icon={<Calendar className="w-4 h-4" />}
                  overline="Race Kalender"
                  title="KALENDER"
                  action="Alle races"
                />
                <div className="space-y-3">
                  {upcomingRaces.map((race: any, i: number) => (
                    <NewRaceCard
                      key={race.id}
                      race={race}
                      index={i}
                      countdown={race.status === "upcoming" ? formatCountdown(race.race_date, now) : null}
                    />
                  ))}
                  {!upcomingRaces.length && (
                    <div className="text-center py-16 text-gray-700 text-sm">Geen aankomende races</div>
                  )}
                </div>
              </div>

              {/* Standings sidebar */}
              <div>
                <SectionHeader
                  icon={<Trophy className="w-4 h-4" />}
                  overline="Championship"
                  title="STANDINGS"
                  action="Volledig"
                />
                <NewStandingsTable
                  standings={activeStandings}
                  leagueName={mockMode ? "GT Master Challenge Cup" : activeLeagueName}
                />
              </div>
            </div>
          </section>

          <Divider />

          {/* ═══ DRIVERS ════════════════════════════════════ */}
          <section className="pb-16">
            <SectionHeader
              icon={<Users className="w-4 h-4" />}
              overline="Community"
              title="DRIVERS"
              action="Alle drivers"
            />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {sortedDrivers.slice(0, 6).map((driver: any, i: number) => (
                <NewDriverCard
                  key={driver.user_id}
                  driver={driver}
                  stats={activeStatsMap?.get(driver.user_id)}
                  team={activeTeams.find((t: any) => t.id === driver.team_id)}
                  rank={i + 1}
                />
              ))}
            </div>

            {!sortedDrivers.length && (
              <div className="text-center py-16 text-gray-700 text-sm">Geen drivers gevonden</div>
            )}
          </section>

          <Divider />

          {/* ═══ TEAMS ══════════════════════════════════════ */}
          <section className="pb-16">
            <SectionHeader
              icon={<Car className="w-4 h-4" />}
              overline="3SM"
              title="TEAMS"
              action="Alle teams"
            />
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {sortedTeams.map((team: any, i: number) => (
                <NewTeamCard
                  key={team.id}
                  team={team}
                  members={getTeamMembers(team.id)}
                  points={team.total}
                  wins={team.wins}
                  rank={i + 1}
                />
              ))}
              {!sortedTeams.length && (
                <div className="text-center py-16 text-gray-700 text-sm col-span-3">Geen teams gevonden</div>
              )}
            </div>
          </section>

          <Divider />

          {/* ═══ DESIGN SYSTEM ══════════════════════════════ */}
          <section className="pb-20">
            <SectionHeader
              icon={<Eye className="w-4 h-4" />}
              overline="Design System"
              title="KLEUREN"
            />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { name: "bg-base",    hex: "#08080f", label: "Achtergrond" },
                { name: "bg-card",    hex: "#111118", label: "Card" },
                { name: "bg-raised",  hex: "#1a1a24", label: "Elevated" },
                { name: "accent",     hex: "#f97316", label: "Oranje accent" },
                { name: "gold-p1",    hex: "#facc15", label: "Goud — P1" },
                { name: "silver-p2",  hex: "#94a3b8", label: "Zilver — P2" },
                { name: "bronze-p3",  hex: "#d97706", label: "Brons — P3" },
                { name: "live",       hex: "#22c55e", label: "Live / Groen" },
              ].map(({ name, hex, label }) => (
                <motion.div
                  key={name}
                  whileHover={{ scale: 1.02 }}
                  className="rounded-xl p-4"
                  style={{ background: "#111118", border: "1px solid rgba(255,255,255,0.06)" }}
                >
                  <div
                    className="w-full h-10 rounded-lg mb-3"
                    style={{ backgroundColor: hex, boxShadow: `0 4px 12px ${hex}40` }}
                  />
                  <div className="text-xs font-bold text-white">{label}</div>
                  <div className="text-[10px] text-gray-600 font-mono mt-0.5">{hex}</div>
                </motion.div>
              ))}
            </div>
          </section>

        </div>
      </main>
      <Footer />
    </div>
  );
};

export default PreviewPage;
