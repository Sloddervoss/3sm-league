import { motion } from "framer-motion";
import { Users, Trophy, Shield, TrendingUp } from "lucide-react";

interface Team {
  id: string;
  name: string;
  description?: string;
  color: string;
  logo_url?: string;
}

interface Member {
  id: string;
  user_id: string;
  role: string;
  profiles?: {
    display_name?: string;
    iracing_name?: string;
  };
}

interface Props {
  team: Team;
  members: Member[];
  points: number;
  wins: number;
  rank: number;
}

const NewTeamCard = ({ team, members, points, wins, rank }: Props) => {
  const color = team.color || "#f97316";

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.35 }}
      whileHover={{ y: -3 }}
      className="relative rounded-xl overflow-hidden"
      style={{
        background: "linear-gradient(160deg, #14141c 0%, #0d0d12 100%)",
        border: "1px solid rgba(255,255,255,0.06)",
        boxShadow: `0 0 0 0 ${color}00`,
      }}
    >
      {/* Color bar top */}
      <div className="h-1" style={{ background: `linear-gradient(90deg, ${color}, ${color}30)` }} />

      {/* Hero gradient area with logo */}
      <div
        className="relative h-44 flex items-center justify-center overflow-hidden"
        style={{
          background: `radial-gradient(ellipse at 50% 60%, ${color}22 0%, ${color}08 50%, transparent 75%)`,
        }}
      >
        {/* Rank badge */}
        <div
          className="absolute top-3 left-4 w-8 h-8 rounded-full flex items-center justify-center font-heading font-black text-sm"
          style={{ background: `${color}20`, border: `1.5px solid ${color}50`, color }}
        >
          {rank}
        </div>

        {/* Background color glow */}
        <div
          className="absolute inset-0 opacity-10"
          style={{
            background: `radial-gradient(circle at 50% 100%, ${color} 0%, transparent 70%)`,
          }}
        />

        {team.logo_url ? (
          <img
            src={team.logo_url}
            alt={team.name}
            className="h-28 w-28 object-contain relative z-10 drop-shadow-2xl"
          />
        ) : (
          <div
            className="w-20 h-20 rounded-2xl flex items-center justify-center relative z-10"
            style={{ background: `${color}20`, border: `2px solid ${color}40` }}
          >
            <Shield className="w-10 h-10" style={{ color }} />
          </div>
        )}

        {/* Points overlay */}
        <div className="absolute bottom-3 right-4 text-right">
          <div className="font-heading font-black text-3xl" style={{ color }}>
            {points}
          </div>
          <div className="text-[10px] text-gray-500 uppercase tracking-widest">PUNTEN</div>
        </div>
      </div>

      {/* Content */}
      <div className="p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="font-heading font-black text-xl text-white">{team.name}</h3>
            {team.description && (
              <p className="text-xs text-gray-500 mt-1 line-clamp-2">{team.description}</p>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div
            className="rounded-lg p-3 flex items-center gap-2"
            style={{ background: "rgba(255,255,255,0.04)" }}
          >
            <Trophy className="w-4 h-4" style={{ color: wins > 0 ? "#facc15" : "#4b5563" }} />
            <div>
              <div className="font-heading font-black text-lg text-white">{wins}</div>
              <div className="text-[10px] text-gray-500 uppercase">Wins</div>
            </div>
          </div>
          <div
            className="rounded-lg p-3 flex items-center gap-2"
            style={{ background: "rgba(255,255,255,0.04)" }}
          >
            <Users className="w-4 h-4 text-gray-500" />
            <div>
              <div className="font-heading font-black text-lg text-white">{members.length}</div>
              <div className="text-[10px] text-gray-500 uppercase">Drivers</div>
            </div>
          </div>
        </div>

        {/* Drivers list */}
        {members.length > 0 && (
          <div
            className="rounded-lg p-3 space-y-2"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}
          >
            {members.map((m) => (
              <div key={m.id} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
                  <span className="text-xs text-gray-300 font-medium">
                    {m.profiles?.display_name || m.profiles?.iracing_name || "Unknown"}
                  </span>
                </div>
                {m.role === "reserve" && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-500">
                    Reserve
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default NewTeamCard;
