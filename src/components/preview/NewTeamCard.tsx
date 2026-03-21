import { motion } from "framer-motion";
import { Users, Trophy, Shield } from "lucide-react";

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
  profiles?: { display_name?: string; iracing_name?: string };
}

interface Props {
  team: Team;
  members: Member[];
  points: number;
  wins: number;
  rank: number;
  onSelect?: () => void;
}

const NewTeamCard = ({ team, members, points, wins, rank, onSelect }: Props) => {
  const color = team.color || "#f97316";
  const drivers = members.filter((m) => m.role !== "reserve");
  const reserves = members.filter((m) => m.role === "reserve");

  return (
    <motion.div
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.35 }}
      whileHover={{ y: -4, boxShadow: `0 12px 40px ${color}20` }}
      onClick={onSelect}
      className="relative rounded-2xl overflow-hidden cursor-pointer"
      style={{
        background: "linear-gradient(160deg, #111118 0%, #0c0c12 100%)",
        border: "1px solid rgba(255,255,255,0.07)",
      }}
    >
      {/* Top color bar */}
      <div
        className="h-[3px]"
        style={{ background: `linear-gradient(90deg, ${color}, ${color}30, transparent)` }}
      />

      {/* Logo hero area */}
      <div
        className="relative h-48 flex items-center justify-center overflow-hidden"
        style={{ background: `radial-gradient(ellipse at 50% 80%, ${color}18 0%, ${color}06 50%, transparent 75%)` }}
      >
        {/* Rank badge */}
        <div
          className="absolute top-4 left-4 w-9 h-9 rounded-xl flex items-center justify-center font-heading font-black text-sm"
          style={{ background: `${color}20`, border: `1.5px solid ${color}40`, color }}
        >
          {rank}
        </div>

        {/* Points top-right */}
        <div className="absolute top-4 right-4 text-right">
          <div className="font-heading font-black text-3xl leading-none" style={{ color }}>
            {points}
          </div>
          <div className="text-[10px] text-gray-600 uppercase tracking-widest">pts</div>
        </div>

        {/* Logo */}
        {team.logo_url ? (
          <img
            src={team.logo_url}
            alt={team.name}
            className="h-28 w-28 object-contain drop-shadow-2xl"
          />
        ) : (
          <div
            className="w-20 h-20 rounded-2xl flex items-center justify-center"
            style={{ background: `${color}15`, border: `2px solid ${color}30` }}
          >
            <Shield className="w-10 h-10" style={{ color, opacity: 0.6 }} />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-5">
        <h3 className="font-heading font-black text-xl text-white mb-1">{team.name}</h3>
        {team.description && (
          <p className="text-xs text-gray-600 mb-4 line-clamp-2">{team.description}</p>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div
            className="rounded-xl p-3 flex items-center gap-3"
            style={{ background: "rgba(255,255,255,0.04)" }}
          >
            <Trophy className="w-5 h-5 shrink-0" style={{ color: wins > 0 ? "#facc15" : "#374151" }} />
            <div>
              <div className="font-heading font-black text-xl text-white leading-none">{wins}</div>
              <div className="text-[10px] text-gray-600 uppercase tracking-wide mt-0.5">Wins</div>
            </div>
          </div>
          <div
            className="rounded-xl p-3 flex items-center gap-3"
            style={{ background: "rgba(255,255,255,0.04)" }}
          >
            <Users className="w-5 h-5 shrink-0 text-gray-600" />
            <div>
              <div className="font-heading font-black text-xl text-white leading-none">{members.length}</div>
              <div className="text-[10px] text-gray-600 uppercase tracking-wide mt-0.5">Drivers</div>
            </div>
          </div>
        </div>

        {/* Driver list */}
        {members.length > 0 && (
          <div
            className="rounded-xl p-3 space-y-2"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}
          >
            {drivers.map((m) => (
              <div key={m.id} className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                <span className="text-sm text-gray-300 font-medium">
                  {m.profiles?.display_name || m.profiles?.iracing_name || "Unknown"}
                </span>
              </div>
            ))}
            {reserves.map((m) => (
              <div key={m.id} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full shrink-0 opacity-40" style={{ backgroundColor: color }} />
                  <span className="text-xs text-gray-600">
                    {m.profiles?.display_name || m.profiles?.iracing_name || "Unknown"}
                  </span>
                </div>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-600">Reserve</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default NewTeamCard;
