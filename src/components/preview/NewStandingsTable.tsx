import { motion } from "framer-motion";
import { Trophy } from "lucide-react";

interface Standing {
  user_id: string;
  display_name: string;
  total_points: number;
  wins: number;
  team?: { name: string; color: string };
}

interface Props {
  standings: Standing[];
  leagueName?: string;
}

const podiumColors = ["#facc15", "#94a3b8", "#d97706"];
const podiumBg = ["rgba(250,204,21,0.08)", "rgba(148,163,184,0.06)", "rgba(217,119,6,0.06)"];

const NewStandingsTable = ({ standings, leagueName }: Props) => {
  if (!standings.length) {
    return (
      <div className="text-center py-16 text-gray-600">
        <Trophy className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p className="text-sm">Nog geen resultaten</p>
      </div>
    );
  }

  const leader = standings[0];

  return (
    <div>
      {leagueName && (
        <div className="flex items-center gap-2 mb-6">
          <Trophy className="w-4 h-4 text-orange-500" />
          <span className="text-xs font-bold text-orange-500 uppercase tracking-widest">{leagueName}</span>
        </div>
      )}

      {/* Podium top-3 */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[standings[1], standings[0], standings[2]].map((driver, visualIdx) => {
          // Reorder: left=2nd, center=1st, right=3rd
          const actualRank = visualIdx === 0 ? 2 : visualIdx === 1 ? 1 : 3;
          if (!driver) return <div key={visualIdx} />;
          const color = podiumColors[actualRank - 1];
          const bg = podiumBg[actualRank - 1];
          const delta = leader.total_points - driver.total_points;

          return (
            <motion.div
              key={driver.user_id}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: visualIdx * 0.08 }}
              className={`relative rounded-xl p-4 text-center ${visualIdx === 1 ? "mt-0" : "mt-4"}`}
              style={{
                background: bg,
                border: `1px solid ${color}30`,
              }}
            >
              {/* Rank crown */}
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center font-heading font-black text-base mx-auto mb-2"
                style={{ background: `${color}20`, border: `2px solid ${color}60`, color }}
              >
                {actualRank}
              </div>
              <div className="font-heading font-bold text-sm text-white truncate">{driver.display_name}</div>
              {driver.team && (
                <div className="flex items-center justify-center gap-1 mt-0.5">
                  <div className="w-1 h-1 rounded-full" style={{ backgroundColor: driver.team.color }} />
                  <span className="text-[10px] text-gray-500 truncate">{driver.team.name}</span>
                </div>
              )}
              <div className="font-heading font-black text-xl mt-2" style={{ color }}>
                {driver.total_points}
              </div>
              <div className="text-[10px] text-gray-600">pts</div>
              {delta > 0 && (
                <div className="text-[10px] text-gray-600 mt-1">-{delta} van #1</div>
              )}
            </motion.div>
          );
        })}
      </div>

      {/* Full table */}
      <div
        className="rounded-xl overflow-hidden"
        style={{ border: "1px solid rgba(255,255,255,0.06)" }}
      >
        {/* Header */}
        <div
          className="grid grid-cols-[2.5rem_1fr_4rem_4rem] gap-2 px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-gray-600"
          style={{ background: "rgba(255,255,255,0.03)" }}
        >
          <span>Pos</span>
          <span>Driver</span>
          <span className="text-center">Wins</span>
          <span className="text-center">Pts</span>
        </div>

        {standings.map((driver, i) => {
          const color = i < 3 ? podiumColors[i] : null;
          const delta = i > 0 ? driver.total_points - standings[i - 1].total_points : 0;

          return (
            <motion.div
              key={driver.user_id}
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ delay: Math.min(i, 8) * 0.04 }}
              className="group grid grid-cols-[2.5rem_1fr_4rem_4rem] gap-2 px-4 py-3 items-center transition-colors"
              style={{
                borderTop: "1px solid rgba(255,255,255,0.04)",
                background: i === 0 ? "rgba(249,115,22,0.04)" : "transparent",
              }}
              whileHover={{ backgroundColor: "rgba(255,255,255,0.025)" }}
            >
              {/* Position */}
              <div
                className="font-heading font-black text-base w-7 h-7 flex items-center justify-center rounded-md"
                style={
                  color
                    ? { background: `${color}15`, color }
                    : { color: "#6b7280" }
                }
              >
                {i + 1}
              </div>

              {/* Driver name + team */}
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {i === 0 && (
                    <div className="w-1 h-4 rounded-full bg-orange-500 shrink-0" />
                  )}
                  <span className="font-heading font-bold text-sm text-white truncate">
                    {driver.display_name}
                  </span>
                </div>
                {driver.team && (
                  <div className="flex items-center gap-1 mt-0.5">
                    <div className="w-1 h-1 rounded-full" style={{ backgroundColor: driver.team.color }} />
                    <span className="text-[10px] text-gray-600 truncate">{driver.team.name}</span>
                  </div>
                )}
              </div>

              {/* Wins */}
              <div className="text-center font-heading font-bold text-sm text-gray-400">
                {driver.wins}
              </div>

              {/* Points */}
              <div className="text-center">
                <span className="font-heading font-black text-base" style={{ color: color || "#e5e7eb" }}>
                  {driver.total_points}
                </span>
                {delta < 0 && (
                  <div className="text-[10px] text-gray-700">{delta}</div>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};

export default NewStandingsTable;
