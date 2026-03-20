/**
 * DriverModal — driver profiel in popup
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";
import { TrendingUp, Shield, Trophy, Flag, Zap } from "lucide-react";
import { MOCK_TEAMS, MOCK_DRIVER_RESULTS } from "@/lib/mockData";

const SAFETY_COLOR: Record<string, string> = { A: "#22c55e", B: "#eab308", C: "#f97316", D: "#ef4444" };
const PODIUM_COLOR = ["#facc15", "#94a3b8", "#d97706"];

const iRatingTier = (ir?: number) => {
  if (!ir)        return { label: "—",            pct: 0,   color: "#374151" };
  if (ir >= 6000) return { label: "World Class",  pct: 100, color: "#a855f7" };
  if (ir >= 4000) return { label: "Expert",       pct: 75,  color: "#3b82f6" };
  if (ir >= 2500) return { label: "Advanced",     pct: 55,  color: "#22c55e" };
  if (ir >= 1500) return { label: "Intermediate", pct: 38,  color: "#eab308" };
  return                 { label: "Rookie",       pct: 20,  color: "#f97316" };
};

interface Driver {
  user_id: string;
  display_name?: string;
  iracing_name?: string;
  iracing_id?: number;
  irating?: number;
  safety_rating?: string;
  team_id?: string;
  avatar_url?: string;
}

interface Props {
  driver: Driver;
  mockMode?: boolean;
}

const StatBox = ({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) => (
  <div className="rounded-xl p-4 text-center" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
    <div className="font-heading font-black text-2xl leading-none mb-1" style={{ color: accent || "#e5e7eb" }}>{value}</div>
    <div className="text-[10px] text-gray-600 uppercase tracking-widest">{label}</div>
  </div>
);

const DriverModal = ({ driver, mockMode = false }: Props) => {
  const { data: teams = [] } = useQuery({
    queryKey: ["teams"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("teams").select("id, name, color, logo_url");
      return data || [];
    },
  });

  const { data: realResults = [] } = useQuery({
    queryKey: ["driver-modal-results", driver.user_id],
    enabled: !mockMode,
    queryFn: async () => {
      const { data } = await supabase
        .from("race_results")
        .select("*, races(name, track, race_date, leagues(name))")
        .eq("user_id", driver.user_id)
        .order("races(race_date)", { ascending: false });
      return data || [];
    },
  });

  const activeTeams  = mockMode ? MOCK_TEAMS : teams;
  const raceResults  = mockMode ? (MOCK_DRIVER_RESULTS[driver.user_id] || []) : realResults;
  const team         = activeTeams.find((t: any) => t.id === driver.team_id);
  const teamColor    = team?.color || "#f97316";

  const safetyLetter = (driver.safety_rating || "").split(" ")[0] || "?";
  const safColor     = SAFETY_COLOR[safetyLetter] || "#6b7280";
  const ir           = iRatingTier(driver.irating);
  const name         = driver.display_name || driver.iracing_name || "Unknown";

  const wins       = raceResults.filter((r: any) => r.position === 1).length;
  const podiums    = raceResults.filter((r: any) => r.position <= 3).length;
  const totalPts   = raceResults.reduce((a: number, r: any) => a + (r.points || 0), 0);
  const avgInc     = raceResults.length > 0
    ? (raceResults.reduce((a: number, r: any) => a + (r.incidents || 0), 0) / raceResults.length).toFixed(1)
    : "—";
  const bestFinish = raceResults.length > 0 ? Math.min(...raceResults.map((r: any) => r.position)) : null;
  const fastestLaps = raceResults.filter((r: any) => r.fastest_lap).length;
  const winRate    = raceResults.length > 0 ? Math.round((wins / raceResults.length) * 100) : 0;

  return (
    <div>
      {/* Hero */}
      <div
        className="relative overflow-hidden px-8 pt-8 pb-7"
        style={{ background: `linear-gradient(135deg, #0d0d16 0%, #111120 100%)` }}
      >
        <div className="absolute inset-0" style={{ background: `linear-gradient(90deg, ${teamColor}10 0%, transparent 60%)` }} />
        <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: `linear-gradient(90deg, ${teamColor}, transparent)` }} />

        {/* Groot rang getal watermark */}
        <div
          className="absolute right-6 top-4 font-heading font-black text-[8rem] leading-none select-none pointer-events-none"
          style={{ color: teamColor, opacity: 0.04 }}
        >
          {name.charAt(0)}
        </div>

        <div className="relative flex items-start gap-6">
          {/* Avatar */}
          {driver.avatar_url ? (
            <img
              src={driver.avatar_url}
              alt={name}
              className="w-20 h-20 rounded-2xl object-cover shrink-0"
              style={{ border: `2px solid ${teamColor}40` }}
            />
          ) : (
            <div
              className="w-20 h-20 rounded-2xl flex items-center justify-center font-heading font-black text-3xl shrink-0"
              style={{ background: `${teamColor}20`, border: `2px solid ${teamColor}40`, color: teamColor }}
            >
              {name.charAt(0).toUpperCase()}
            </div>
          )}

          <div className="flex-1 min-w-0">
            {team && (
              <div className="flex items-center gap-1.5 mb-1">
                <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: teamColor }} />
                <span className="text-xs font-bold uppercase tracking-widest" style={{ color: teamColor }}>{team.name}</span>
              </div>
            )}
            <h2
              className="font-heading font-black text-2xl md:text-3xl text-white leading-tight mb-2"
              style={{ textShadow: `0 0 30px ${teamColor}25` }}
            >
              {name}
            </h2>
            <div className="flex items-center gap-4 flex-wrap">
              {driver.iracing_id && (
                <span className="text-xs font-mono px-2 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.05)", color: "#6b7280" }}>
                  #{driver.iracing_id}
                </span>
              )}
              {driver.safety_rating && (
                <div className="flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5" style={{ color: safColor }} />
                  <span className="text-sm font-bold" style={{ color: safColor }}>{driver.safety_rating}</span>
                </div>
              )}
              {driver.irating && (
                <div className="flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5 text-blue-400" />
                  <span className="text-sm font-bold text-white">{driver.irating.toLocaleString()}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded font-bold" style={{ background: `${ir.color}18`, color: ir.color }}>{ir.label}</span>
                </div>
              )}
            </div>
          </div>

          {/* Total points */}
          <div className="text-right shrink-0">
            <div className="font-heading font-black text-4xl leading-none" style={{ color: teamColor }}>{totalPts}</div>
            <div className="text-[10px] text-gray-600 uppercase tracking-widest mt-1">PTS</div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-8 pb-8 pt-6">

        {/* Stats grid */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-6">
          <StatBox label="Races"   value={raceResults.length} />
          <StatBox label="Wins"    value={wins}    accent={wins > 0 ? "#facc15" : undefined} />
          <StatBox label="Podiums" value={podiums} accent={podiums > 0 ? "#d97706" : undefined} />
          <StatBox label="Beste"   value={bestFinish ? `P${bestFinish}` : "—"} accent={bestFinish === 1 ? "#facc15" : undefined} />
          <StatBox label="FL"      value={fastestLaps} accent={fastestLaps > 0 ? "#a855f7" : undefined} />
          <StatBox label="Inc/race" value={avgInc} />
        </div>

        {/* iRating bar */}
        {driver.irating && (
          <div className="rounded-2xl p-5 mb-6" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-3.5 h-3.5 text-blue-400" />
                <span className="text-xs font-bold text-white">iRating</span>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: `${ir.color}18`, color: ir.color }}>{ir.label}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-gray-700 flex items-center gap-1"><Zap className="w-3 h-3" />{winRate}% win rate</span>
                <span className="font-heading font-black text-lg text-white">{driver.irating.toLocaleString()}</span>
              </div>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${Math.min((driver.irating / 8000) * 100, 100)}%` }}
                transition={{ duration: 1.2, ease: "easeOut", delay: 0.1 }}
                className="h-full rounded-full"
                style={{ background: `linear-gradient(90deg, ${ir.color}60, ${ir.color})` }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-gray-700 mt-1">
              <span>0</span><span>2000</span><span>4000</span><span>6000</span><span>8000+</span>
            </div>
          </div>
        )}

        {/* Race history */}
        {raceResults.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Flag className="w-4 h-4 text-orange-500" />
              <span className="text-xs font-black text-orange-500 uppercase tracking-widest">Race Historie</span>
            </div>
            <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
              <div
                className="grid gap-2 px-5 py-2.5 text-[10px] font-black uppercase tracking-widest text-gray-600"
                style={{ gridTemplateColumns: "3rem 1fr 4rem 4rem 4rem", background: "rgba(255,255,255,0.03)" }}
              >
                <span>Pos</span><span>Race</span><span>Pts</span><span>FL</span><span>Inc</span>
              </div>
              {raceResults.map((r: any, i: number) => {
                const posColor = r.position <= 3 ? PODIUM_COLOR[r.position - 1] : "#6b7280";
                return (
                  <motion.div
                    key={r.id || i}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.04 }}
                    className="grid gap-2 px-5 py-3 items-center"
                    style={{ gridTemplateColumns: "3rem 1fr 4rem 4rem 4rem", borderTop: "1px solid rgba(255,255,255,0.04)" }}
                  >
                    <div className="font-heading font-black text-sm" style={{ color: posColor }}>P{r.position}</div>
                    <div>
                      <div className="text-sm font-bold text-white truncate">{r.races?.name || "—"}</div>
                      <div className="text-[10px] text-gray-600 truncate">{r.races?.track}</div>
                    </div>
                    <div className="font-heading font-bold text-sm text-orange-400">{r.points}</div>
                    <div>{r.fastest_lap ? <span className="text-[10px] font-bold text-purple-400">⚡</span> : <span className="text-gray-700">—</span>}</div>
                    <div className="text-xs text-gray-600">{r.incidents ?? 0}</div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        )}

        {raceResults.length === 0 && (
          <div className="text-center py-8 text-gray-700 text-sm">Nog geen race resultaten</div>
        )}
      </div>
    </div>
  );
};

export default DriverModal;
