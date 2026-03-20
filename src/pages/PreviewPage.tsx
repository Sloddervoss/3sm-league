import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import NewDriverCard from "@/components/preview/NewDriverCard";
import NewTeamCard from "@/components/preview/NewTeamCard";
import NewStandingsTable from "@/components/preview/NewStandingsTable";
import NewRaceCard from "@/components/preview/NewRaceCard";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { Eye, Users, Car, Trophy, Calendar } from "lucide-react";

// -- Countdown hook --
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

// -- Section header --
const SectionHeader = ({ icon, label, title }: { icon: React.ReactNode; label: string; title: string }) => (
  <div className="mb-8">
    <div className="flex items-center gap-2 mb-1">
      <span className="text-orange-500">{icon}</span>
      <span className="text-xs font-bold text-orange-500 uppercase tracking-widest">{label}</span>
    </div>
    <h2 className="font-heading font-black text-3xl md:text-4xl text-white">{title}</h2>
  </div>
);

// -- Compare bar --
const CompareBar = ({ label }: { label: string }) => (
  <div className="flex items-center gap-3 mb-4">
    <div className="flex-1 h-px bg-white/5" />
    <span className="text-[10px] font-bold text-gray-600 uppercase tracking-widest">{label}</span>
    <div className="flex-1 h-px bg-white/5" />
  </div>
);

const PreviewPage = () => {
  const { isAdmin, loading } = useAuth();
  const navigate = useNavigate();
  const now = useNow();

  useEffect(() => {
    if (!loading && !isAdmin) navigate("/");
  }, [isAdmin, loading, navigate]);

  // -- Data queries (identical to existing pages) --
  const { data: profiles } = useQuery({
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

  const { data: teams } = useQuery({
    queryKey: ["teams"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("teams").select("*").order("name");
      return data || [];
    },
  });

  const { data: memberships } = useQuery({
    queryKey: ["team-memberships-with-profiles"],
    queryFn: async () => {
      const { data } = await supabase.from("team_memberships").select("*, profiles(display_name, iracing_name)");
      return data || [];
    },
  });

  const { data: results } = useQuery({
    queryKey: ["team-results"],
    queryFn: async () => {
      const { data } = await supabase.from("race_results").select("user_id, position, points");
      return data || [];
    },
  });

  const { data: leagues } = useQuery({
    queryKey: ["leagues-for-standings"],
    queryFn: async () => {
      const { data } = await supabase.from("leagues").select("id, name, season, car_class").order("created_at", { ascending: false });
      return data || [];
    },
  });

  const { data: standingsData } = useQuery({
    queryKey: ["standings", leagues?.[0]?.id],
    enabled: !!leagues?.length,
    queryFn: async () => {
      const leagueId = leagues![0].id;
      const { data: res } = await supabase.from("race_results").select("user_id, position, points, race_id, races(league_id)");
      const filtered = res?.filter((r: any) => r.races?.league_id === leagueId) || [];
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
        const prof = profs?.find((p: any) => p.user_id === uid);
        const team = teams?.find((t: any) => t.id === prof?.team_id);
        return {
          user_id: uid,
          display_name: prof?.display_name || "Unknown",
          total_points: stats.total_points,
          wins: stats.wins,
          team: team ? { name: team.name, color: team.color } : undefined,
        };
      }).sort((a, b) => b.total_points - a.total_points);
    },
  });

  const { data: races } = useQuery({
    queryKey: ["races-with-leagues"],
    queryFn: async () => {
      const { data } = await supabase.from("races").select("*, leagues(name, car_class, id)").order("race_date", { ascending: true });
      return data || [];
    },
  });

  // -- Derived data --
  const sortedDrivers = [...(profiles || [])].sort((a: any, b: any) => {
    return (driverStats?.get(b.user_id)?.points || 0) - (driverStats?.get(a.user_id)?.points || 0);
  });

  const getTeamMembers = (teamId: string) => (memberships || []).filter((m: any) => m.team_id === teamId);
  const getTeamStats = (teamId: string) => {
    const memberIds = getTeamMembers(teamId).map((m: any) => m.user_id);
    let total = 0; let wins = 0;
    (results || []).forEach((r: any) => {
      if (memberIds.includes(r.user_id)) { total += r.points; if (r.position === 1) wins++; }
    });
    return { total, wins };
  };

  const upcomingRaces = (races || []).filter((r: any) => r.status !== "completed").slice(0, 5);
  const activeLeagueName = leagues?.[0]?.name;

  return (
    <div className="min-h-screen" style={{ background: "#0a0a0f" }}>
      <Navbar />
      <main className="pt-16">

        {/* Preview Banner */}
        <div
          className="sticky top-16 z-40 flex items-center justify-between px-6 py-2.5"
          style={{ background: "rgba(249,115,22,0.1)", borderBottom: "1px solid rgba(249,115,22,0.2)" }}
        >
          <div className="flex items-center gap-2">
            <Eye className="w-4 h-4 text-orange-500" />
            <span className="text-sm font-bold text-orange-500">DESIGN PREVIEW</span>
            <span className="text-xs text-gray-500 ml-2">Nieuwe UI — geen bestaande pagina's gewijzigd</span>
          </div>
          <span className="text-xs text-gray-600">Admin only · /preview</span>
        </div>

        <div className="container mx-auto px-4 py-16 space-y-24">

          {/* ===== DRIVERS ===== */}
          <section>
            <SectionHeader icon={<Users className="w-4 h-4" />} label="Preview" title="DRIVERS" />
            <CompareBar label="Nieuwe driver cards" />
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {sortedDrivers.slice(0, 6).map((driver: any, i: number) => (
                <NewDriverCard
                  key={driver.user_id}
                  driver={driver}
                  stats={driverStats?.get(driver.user_id)}
                  team={teams?.find((t: any) => t.id === driver.team_id)}
                  rank={i + 1}
                />
              ))}
            </div>
          </section>

          {/* ===== STANDINGS ===== */}
          <section>
            <SectionHeader icon={<Trophy className="w-4 h-4" />} label="Preview" title="STANDINGS" />
            <CompareBar label="Nieuwe standings met podium" />
            <div className="max-w-2xl">
              <NewStandingsTable
                standings={standingsData || []}
                leagueName={activeLeagueName}
              />
            </div>
          </section>

          {/* ===== TEAMS ===== */}
          <section>
            <SectionHeader icon={<Car className="w-4 h-4" />} label="Preview" title="TEAMS" />
            <CompareBar label="Nieuwe team cards" />
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {[...(teams || [])]
                .map((t: any) => ({ ...t, ...getTeamStats(t.id) }))
                .sort((a: any, b: any) => b.total - a.total)
                .map((team: any, i: number) => (
                  <NewTeamCard
                    key={team.id}
                    team={team}
                    members={getTeamMembers(team.id)}
                    points={team.total}
                    wins={team.wins}
                    rank={i + 1}
                  />
                ))}
            </div>
          </section>

          {/* ===== CALENDAR ===== */}
          <section>
            <SectionHeader icon={<Calendar className="w-4 h-4" />} label="Preview" title="KALENDER" />
            <CompareBar label="Nieuwe race cards" />
            <div className="space-y-3 max-w-3xl">
              {upcomingRaces.map((race: any, i: number) => (
                <NewRaceCard
                  key={race.id}
                  race={race}
                  index={i}
                  countdown={race.status === "upcoming" ? formatCountdown(race.race_date, now) : null}
                />
              ))}
              {!upcomingRaces.length && (
                <div className="text-center py-12 text-gray-600 text-sm">
                  Geen aankomende races gevonden
                </div>
              )}
            </div>
          </section>

          {/* ===== DESIGN SYSTEM ===== */}
          <section>
            <SectionHeader icon={<Eye className="w-4 h-4" />} label="Preview" title="DESIGN SYSTEM" />
            <CompareBar label="Kleuren & componenten" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { name: "Background", hex: "#0a0a0f" },
                { name: "Card", hex: "#13131a" },
                { name: "Elevated", hex: "#1a1a24" },
                { name: "Accent Orange", hex: "#f97316" },
                { name: "Gold #1", hex: "#facc15" },
                { name: "Silver #2", hex: "#94a3b8" },
                { name: "Bronze #3", hex: "#d97706" },
                { name: "Green Live", hex: "#22c55e" },
              ].map(({ name, hex }) => (
                <div
                  key={name}
                  className="rounded-xl p-4 flex flex-col gap-2"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
                >
                  <div className="w-full h-10 rounded-lg" style={{ backgroundColor: hex }} />
                  <div className="text-xs font-bold text-white">{name}</div>
                  <div className="text-[10px] text-gray-500 font-mono">{hex}</div>
                </div>
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
