import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";
import { Users, Trophy, Shield, Flag, TrendingUp } from "lucide-react";

interface Team {
  id: string;
  name: string;
  description?: string;
  color: string;
  logo_url?: string;
}

interface Props {
  team: Team;
}

const PODIUM = ["#facc15", "#94a3b8", "#d97706"];

const TeamModal = ({ team }: Props) => {
  const color = team.color || "#f97316";

  const { data: memberships = [] } = useQuery({
    queryKey: ["team-memberships-with-profiles"],
    queryFn: async () => {
      const { data } = await supabase
        .from("team_memberships")
        .select("*, profiles(user_id, display_name, iracing_name, irating, safety_rating)");
      return data || [];
    },
  });

  const { data: allResults = [] } = useQuery({
    queryKey: ["all-results-with-profiles"],
    queryFn: async () => {
      const { data } = await supabase
        .from("race_results")
        .select("*, races(name, track, race_date, leagues(name))");
      return data || [];
    },
  });

  const members = memberships.filter((m: any) => m.team_id === team.id);
  const memberIds = members.map((m: any) => m.user_id);
  const teamResults = allResults.filter((r: any) => memberIds.includes(r.user_id));

  const totalPoints = teamResults.reduce((a: number, r: any) => a + (r.points || 0), 0);
  const wins    = teamResults.filter((r: any) => r.position === 1).length;
  const podiums = teamResults.filter((r: any) => r.position <= 3).length;
  const races   = new Set(teamResults.map((r: any) => r.race_id)).size;

  const driverStats = members.map((m: any) => {
    const dr = teamResults.filter((r: any) => r.user_id === m.user_id);
    return {
      ...m,
      points: dr.reduce((a: number, r: any) => a + (r.points || 0), 0),
      wins:   dr.filter((r: any) => r.position === 1).length,
    };
  }).sort((a: any, b: any) => b.points - a.points);

  const recentResults = [...teamResults]
    .sort((a: any, b: any) => new Date(b.races?.race_date || 0).getTime() - new Date(a.races?.race_date || 0).getTime())
    .slice(0, 8);

  const SAFETY_COLOR: Record<string, string> = { A: "#22c55e", B: "#eab308", C: "#f97316", D: "#ef4444" };

  return (
    <div>
      {/* Hero */}
      <div
        className="relative overflow-hidden p-6 pb-8"
        style={{ background: `linear-gradient(135deg, #0d0d16, #0e0e18)` }}
      >
        <div className="absolute inset-0" style={{ background: `radial-gradient(ellipse at 70% 50%, ${color}18 0%, transparent 60%)` }} />
        <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: `linear-gradient(90deg, ${color}, transparent)` }} />

        <div className="relative flex items-center gap-6">
          <div
            className="w-20 h-20 rounded-2xl flex items-center justify-center shrink-0"
            style={{ background: `${color}15`, border: `2px solid ${color}35` }}
          >
            {team.logo_url ? (
              <img src={team.logo_url} alt={team.name} className="w-16 h-16 object-contain drop-shadow-xl" />
            ) : (
              <Shield className="w-10 h-10" style={{ color, opacity: 0.5 }} />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <h2 className="font-heading font-black text-3xl text-white leading-none mb-1" style={{ textShadow: `0 0 30px ${color}30` }}>
              {team.name}
            </h2>
            {team.description && (
              <p className="text-gray-500 text-sm line-clamp-2">{team.description}</p>
            )}
            <div className="flex items-center gap-1.5 mt-1" style={{ color }}>
              <Users className="w-3.5 h-3.5" />
              <span className="text-sm">{members.length} drivers</span>
            </div>
          </div>

          <div className="text-right shrink-0">
            <div className="font-heading font-black text-5xl leading-none" style={{ color }}>{totalPoints}</div>
            <div className="text-[10px] text-gray-600 uppercase tracking-widest mt-1">punten</div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-2 px-6 py-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        {[
          { label: "Wins",    value: wins,    accent: wins > 0 ? "#facc15" : null },
          { label: "Podiums", value: podiums, accent: podiums > 0 ? "#d97706" : null },
          { label: "Races",   value: races,   accent: null },
          { label: "Drivers", value: members.length, accent: null },
        ].map(({ label, value, accent }) => (
          <div key={label} className="rounded-xl p-3 text-center" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="font-heading font-black text-2xl leading-none" style={{ color: accent || "#e5e7eb" }}>{value}</div>
            <div className="text-[10px] text-gray-600 uppercase tracking-wider mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      <div className="p-6 space-y-6">
        {/* Drivers */}
        {driverStats.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Users className="w-3.5 h-3.5 text-orange-500" />
              <span className="text-xs font-black text-orange-500 uppercase tracking-widest">Drivers</span>
            </div>
            <div className="space-y-2">
              {driverStats.map((m: any, i: number) => {
                const prof = m.profiles;
                const safLetter = (prof?.safety_rating || "").split(" ")[0];
                return (
                  <motion.div
                    key={m.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="flex items-center gap-3 rounded-xl p-3"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.05)" }}
                  >
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center font-heading font-black text-xs shrink-0"
                      style={{ background: `${color}20`, border: `1.5px solid ${color}40`, color }}
                    >
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm text-white truncate">
                        {prof?.display_name || prof?.iracing_name || "Unknown"}
                        {m.role === "reserve" && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-600">Reserve</span>}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {prof?.irating && (
                          <span className="text-xs text-blue-400 flex items-center gap-1">
                            <TrendingUp className="w-3 h-3" />{prof.irating.toLocaleString()}
                          </span>
                        )}
                        {prof?.safety_rating && (
                          <span className="text-xs font-bold" style={{ color: SAFETY_COLOR[safLetter] || "#6b7280" }}>
                            {prof.safety_rating}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-heading font-black text-lg" style={{ color }}>{m.points}</div>
                      <div className="text-[10px] text-gray-600">pts</div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        )}

        {/* Recent results */}
        {recentResults.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Flag className="w-3.5 h-3.5 text-orange-500" />
              <span className="text-xs font-black text-orange-500 uppercase tracking-widest">Recente Resultaten</span>
            </div>
            <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
              <div
                className="grid gap-2 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-gray-600"
                style={{ gridTemplateColumns: "2.5rem 1fr 1fr 3.5rem", background: "rgba(255,255,255,0.03)" }}
              >
                <span>Pos</span><span>Race</span><span>Driver</span><span>Pts</span>
              </div>
              {recentResults.map((r: any, i: number) => {
                const posColor = r.position <= 3 ? PODIUM[r.position - 1] : "#6b7280";
                const drMember = members.find((m: any) => m.user_id === r.user_id);
                const drName = drMember?.profiles?.display_name || drMember?.profiles?.iracing_name || "—";
                return (
                  <div
                    key={r.id || i}
                    className="grid gap-2 px-4 py-2.5 items-center text-sm"
                    style={{ gridTemplateColumns: "2.5rem 1fr 1fr 3.5rem", borderTop: "1px solid rgba(255,255,255,0.04)" }}
                  >
                    <div className="font-heading font-black text-sm" style={{ color: posColor }}>P{r.position}</div>
                    <div className="text-white text-xs truncate">{r.races?.name}</div>
                    <div className="text-gray-500 text-xs truncate">{drName}</div>
                    <div className="font-bold text-orange-400 text-xs">{r.points}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {driverStats.length === 0 && recentResults.length === 0 && (
          <div className="text-center py-8 text-gray-700">
            <Trophy className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">Nog geen resultaten</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default TeamModal;
