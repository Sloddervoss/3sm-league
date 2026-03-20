import { motion } from "framer-motion";
import { TrendingUp, Shield, Trophy, Zap } from "lucide-react";

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
  onSelect?: () => void;
}

const safetyGrade = (sr: string) => sr?.split(" ")[0] || "?";
const safetyColor: Record<string, string> = {
  A: "#22c55e", B: "#eab308", C: "#f97316", D: "#ef4444",
};

const iRatingTier = (ir?: number) => {
  if (!ir)        return { label: "—",            pct: 0,   color: "#374151" };
  if (ir >= 6000) return { label: "World Class",  pct: 100, color: "#a855f7" };
  if (ir >= 4000) return { label: "Expert",       pct: 75,  color: "#3b82f6" };
  if (ir >= 2500) return { label: "Advanced",     pct: 55,  color: "#22c55e" };
  if (ir >= 1500) return { label: "Intermediate", pct: 38,  color: "#eab308" };
  return                 { label: "Rookie",       pct: 20,  color: "#f97316" };
};

const rankStyle = (rank: number) => {
  if (rank === 1) return { color: "#facc15", glow: "rgba(250,204,21,0.2)",  label: "P1" };
  if (rank === 2) return { color: "#94a3b8", glow: "rgba(148,163,184,0.15)", label: "P2" };
  if (rank === 3) return { color: "#d97706", glow: "rgba(217,119,6,0.15)",  label: "P3" };
  return               { color: "#374151",  glow: "transparent",            label: `P${rank}` };
};

const NewDriverCard = ({ driver, stats, team, rank, onSelect }: Props) => {
  const name = driver.display_name || driver.iracing_name || "Unknown";
  const safetyLetter = safetyGrade(driver.safety_rating || "");
  const safColor = safetyColor[safetyLetter] || "#6b7280";
  const rs = rankStyle(rank);
  const ir = iRatingTier(driver.irating);
  const teamColor = team?.color || "#f97316";
  const winRate = stats?.races ? Math.round((stats.wins / stats.races) * 100) : 0;
  const avgInc = stats?.races ? (stats.incidents / stats.races).toFixed(1) : "—";

  return (
    <motion.div
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.35 }}
      whileHover={{ y: -4, boxShadow: `0 12px 40px ${teamColor}25` }}
      className="relative rounded-2xl overflow-hidden"
      style={{
        background: "linear-gradient(160deg, #111118 0%, #0c0c12 100%)",
        border: "1px solid rgba(255,255,255,0.07)",
      }}
    >
      {onSelect && <button onClick={onSelect} className="absolute inset-0 z-10 w-full text-left" aria-label={`Open profiel van ${name}`} />}
      {/* Team color top bar */}
      <div
        className="h-[3px]"
        style={{ background: `linear-gradient(90deg, ${teamColor}, ${teamColor}20, transparent)` }}
      />

      {/* Big rank number watermark */}
      <div
        className="absolute -right-2 top-2 font-heading font-black text-[6rem] leading-none select-none pointer-events-none"
        style={{ color: rs.color, opacity: 0.04 }}
      >
        {rank}
      </div>

      <div className="p-6">
        {/* Rank badge + name row */}
        <div className="flex items-start justify-between mb-5">
          <div className="flex items-center gap-3">
            {/* Rank badge */}
            <div
              className="w-11 h-11 rounded-xl flex items-center justify-center font-heading font-black text-base shrink-0"
              style={{
                background: `${rs.color}18`,
                border: `1.5px solid ${rs.color}40`,
                color: rs.color,
                boxShadow: rank <= 3 ? `0 0 16px ${rs.glow}` : "none",
              }}
            >
              {rs.label}
            </div>

            {/* Avatar */}
            {driver.avatar_url ? (
              <img
                src={driver.avatar_url}
                alt={name}
                className="w-11 h-11 rounded-xl object-cover shrink-0"
                style={{ border: `1.5px solid ${teamColor}40` }}
              />
            ) : null}

            <div>
              <h3 className="font-heading font-black text-lg leading-tight text-white">{name}</h3>
              {team && (
                <div className="flex items-center gap-1.5 mt-0.5">
                  <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: teamColor }} />
                  <span className="text-xs font-medium" style={{ color: teamColor }}>{team.name}</span>
                </div>
              )}
            </div>
          </div>

          {stats ? (
            <div className="text-right shrink-0">
              <div
                className="font-heading font-black text-3xl leading-none"
                style={{ color: rank <= 3 ? rs.color : "#e5e7eb" }}
              >
                {stats.points}
              </div>
              <div className="text-[10px] text-gray-600 uppercase tracking-widest mt-0.5">PTS</div>
            </div>
          ) : null}
        </div>

        {/* Stats 3-grid */}
        <div className="grid grid-cols-3 gap-2 mb-5">
          {[
            { label: "Wins",    value: stats?.wins ?? 0,    accent: stats?.wins ? "#facc15" : null },
            { label: "Podiums", value: stats?.podiums ?? 0, accent: null },
            { label: "Races",   value: stats?.races ?? 0,   accent: null },
          ].map(({ label, value, accent }) => (
            <div
              key={label}
              className="rounded-xl py-3 text-center"
              style={{ background: "rgba(255,255,255,0.04)" }}
            >
              <div
                className="font-heading font-black text-2xl leading-none"
                style={{ color: accent || "#d1d5db" }}
              >
                {value}
              </div>
              <div className="text-[10px] text-gray-600 uppercase tracking-wide mt-1">{label}</div>
            </div>
          ))}
        </div>

        {/* iRating bar */}
        {driver.irating ? (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5 text-[10px] text-gray-600 uppercase tracking-wide">
                <TrendingUp className="w-3 h-3" />
                iRating
              </div>
              <div className="flex items-center gap-2">
                <span
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                  style={{ background: `${ir.color}18`, color: ir.color }}
                >
                  {ir.label}
                </span>
                <span className="text-xs font-bold text-white">{driver.irating.toLocaleString()}</span>
              </div>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
              <motion.div
                initial={{ width: 0 }}
                whileInView={{ width: `${ir.pct}%` }}
                viewport={{ once: true }}
                transition={{ duration: 1, ease: "easeOut", delay: 0.2 }}
                className="h-full rounded-full"
                style={{ background: `linear-gradient(90deg, ${ir.color}60, ${ir.color})` }}
              />
            </div>
          </div>
        ) : null}

        {/* Footer */}
        <div
          className="flex items-center justify-between pt-4"
          style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
        >
          <div className="flex items-center gap-3">
            {driver.safety_rating && (
              <div className="flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5" style={{ color: safColor }} />
                <span className="text-xs font-bold" style={{ color: safColor }}>{driver.safety_rating}</span>
              </div>
            )}
            <span className="text-[11px] text-gray-700">{avgInc} inc/race</span>
          </div>

          <div
            className="flex items-center gap-1.5 text-[11px] font-bold px-2 py-1 rounded-lg"
            style={{ background: "rgba(255,255,255,0.04)", color: winRate > 0 ? "#facc15" : "#4b5563" }}
          >
            <Zap className="w-3 h-3" />
            {winRate}% win
          </div>
        </div>
      </div>
    </motion.div>
  );
};

export default NewDriverCard;
