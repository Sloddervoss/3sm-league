import { motion } from "framer-motion";
import { TrendingUp, Shield, Trophy, Flag, Zap } from "lucide-react";

interface Driver {
  user_id: string;
  display_name?: string;
  iracing_name?: string;
  iracing_id?: number;
  irating?: number;
  safety_rating?: string;
  team_id?: string;
}

interface DriverStats {
  races: number;
  wins: number;
  podiums: number;
  points: number;
  incidents: number;
}

interface Team {
  id: string;
  name: string;
  color: string;
}

interface Props {
  driver: Driver;
  stats?: DriverStats;
  team?: Team;
  rank: number;
}

const safetyGrade = (sr: string) => sr?.split(" ")[0] || "?";

const safetyColor: Record<string, string> = {
  A: "#22c55e",
  B: "#eab308",
  C: "#f97316",
  D: "#ef4444",
};

const medalColor = (rank: number) => {
  if (rank === 1) return "#facc15";
  if (rank === 2) return "#94a3b8";
  if (rank === 3) return "#d97706";
  return null;
};

const iRatingLevel = (ir?: number) => {
  if (!ir) return { label: "—", pct: 0, color: "#6b7280" };
  if (ir >= 6000) return { label: "Pro", pct: 100, color: "#a855f7" };
  if (ir >= 4000) return { label: "Expert", pct: 80, color: "#3b82f6" };
  if (ir >= 2500) return { label: "Advanced", pct: 60, color: "#22c55e" };
  if (ir >= 1500) return { label: "Intermediate", pct: 40, color: "#eab308" };
  return { label: "Rookie", pct: 20, color: "#f97316" };
};

const NewDriverCard = ({ driver, stats, team, rank }: Props) => {
  const name = driver.display_name || driver.iracing_name || "Unknown";
  const safetyLetter = safetyGrade(driver.safety_rating || "");
  const safColor = safetyColor[safetyLetter] || "#6b7280";
  const medal = medalColor(rank);
  const irLevel = iRatingLevel(driver.irating);
  const winRate = stats && stats.races > 0 ? ((stats.wins / stats.races) * 100).toFixed(0) : "0";
  const avgInc = stats && stats.races > 0 ? (stats.incidents / stats.races).toFixed(1) : "—";
  const teamColor = team?.color || "#f97316";

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.3 }}
      whileHover={{ y: -3, boxShadow: `0 8px 32px ${teamColor}30` }}
      className="relative rounded-xl overflow-hidden"
      style={{
        background: "linear-gradient(145deg, #13131a 0%, #0e0e14 100%)",
        border: `1px solid rgba(255,255,255,0.06)`,
      }}
    >
      {/* Top color bar */}
      <div className="h-1 w-full" style={{ background: `linear-gradient(90deg, ${teamColor}, ${teamColor}40)` }} />

      {/* Rank watermark */}
      <div
        className="absolute top-3 right-4 font-heading font-black text-5xl opacity-[0.04] select-none pointer-events-none"
        style={{ color: teamColor }}
      >
        {rank}
      </div>

      <div className="p-5">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-start gap-3">
            {/* Avatar placeholder / rank medal */}
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-heading font-black shrink-0"
              style={{
                background: medal
                  ? `radial-gradient(circle, ${medal}30, ${medal}10)`
                  : "rgba(255,255,255,0.06)",
                border: medal ? `1.5px solid ${medal}60` : "1.5px solid rgba(255,255,255,0.1)",
                color: medal || "#9ca3af",
              }}
            >
              {rank}
            </div>

            <div>
              <h3 className="font-heading font-black text-base leading-tight text-white">{name}</h3>
              {team && (
                <div className="flex items-center gap-1.5 mt-0.5">
                  <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: teamColor }} />
                  <span className="text-xs font-medium" style={{ color: teamColor }}>
                    {team.name}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Points */}
          <div className="text-right shrink-0">
            <div className="font-heading font-black text-2xl" style={{ color: medal || "#f97316" }}>
              {stats?.points ?? 0}
            </div>
            <div className="text-[10px] text-gray-500 uppercase tracking-widest">PTS</div>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          {[
            { label: "Wins", value: stats?.wins ?? 0, icon: <Trophy className="w-3 h-3" />, highlight: stats?.wins ? "#facc15" : undefined },
            { label: "Podiums", value: stats?.podiums ?? 0, icon: <Flag className="w-3 h-3" />, highlight: undefined },
            { label: "Races", value: stats?.races ?? 0, icon: null, highlight: undefined },
          ].map(({ label, value, icon, highlight }) => (
            <div
              key={label}
              className="rounded-lg p-2.5 text-center"
              style={{ background: "rgba(255,255,255,0.04)" }}
            >
              <div
                className="font-heading font-black text-xl"
                style={{ color: highlight || "#e5e7eb" }}
              >
                {value}
              </div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wide flex items-center justify-center gap-1 mt-0.5">
                {icon}
                {label}
              </div>
            </div>
          ))}
        </div>

        {/* iRating bar */}
        {driver.irating ? (
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-gray-500 uppercase tracking-wide flex items-center gap-1">
                <TrendingUp className="w-3 h-3" />
                iRating
              </span>
              <span className="text-xs font-bold" style={{ color: irLevel.color }}>
                {driver.irating.toLocaleString()} · {irLevel.label}
              </span>
            </div>
            <div className="h-1 rounded-full bg-white/5 overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                whileInView={{ width: `${irLevel.pct}%` }}
                viewport={{ once: true }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                className="h-full rounded-full"
                style={{ background: `linear-gradient(90deg, ${irLevel.color}80, ${irLevel.color})` }}
              />
            </div>
          </div>
        ) : null}

        {/* Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-white/5">
          <div className="flex items-center gap-3">
            {driver.safety_rating && (
              <div className="flex items-center gap-1">
                <Shield className="w-3 h-3" style={{ color: safColor }} />
                <span className="text-xs font-bold" style={{ color: safColor }}>
                  {driver.safety_rating}
                </span>
              </div>
            )}
            <span className="text-[10px] text-gray-600">{avgInc} inc/race</span>
          </div>
          <div className="flex items-center gap-1 text-[10px] text-gray-600">
            <Zap className="w-3 h-3 text-yellow-500" />
            {winRate}% win rate
          </div>
        </div>
      </div>
    </motion.div>
  );
};

export default NewDriverCard;
