import { motion } from "framer-motion";
import { Trophy, Medal } from "lucide-react";
import { Link } from "react-router-dom";

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
  onSelectDriver?: (userId: string) => void;
  variant?: "compact" | "page";
}

const PODIUM = [
  { color: "#facc15", bg: "rgba(250,204,21,0.08)",  border: "rgba(250,204,21,0.2)",  shadow: "rgba(250,204,21,0.15)" },
  { color: "#94a3b8", bg: "rgba(148,163,184,0.06)", border: "rgba(148,163,184,0.15)", shadow: "rgba(148,163,184,0.1)" },
  { color: "#d97706", bg: "rgba(217,119,6,0.07)",   border: "rgba(217,119,6,0.15)",  shadow: "rgba(217,119,6,0.1)" },
];

const NewStandingsTable = ({ standings, leagueName, onSelectDriver, variant = "compact" }: Props) => {
  const isPage = variant === "page";
  const tableColumns = isPage
    ? "3rem minmax(0,1fr) minmax(8rem,12rem) 4rem 5rem"
    : "2.5rem 1fr 4rem 4.5rem";

  if (!standings.length) {
    return (
      <div className="text-center py-16 text-gray-700">
        <Trophy className="w-10 h-10 mx-auto mb-3 opacity-20" />
        <p className="text-sm">Nog geen resultaten beschikbaar</p>
      </div>
    );
  }

  const top3 = [standings[1], standings[0], standings[2]]; // left=P2, center=P1, right=P3
  const actualRanks = [2, 1, 3];
  const rest = standings.slice(3);
  const leader = standings[0];

  return (
    <div>
      {leagueName && (
        <div className="flex items-center gap-2 mb-8">
          <Trophy className="w-4 h-4 text-orange-500" />
          <span className="text-xs font-black text-orange-500 uppercase tracking-[0.25em]">{leagueName}</span>
        </div>
      )}

      {/* Podium */}
      {standings.length >= 2 && (
        <div className={`grid grid-cols-3 items-end ${isPage ? "gap-4 mb-8" : "gap-3 mb-6"}`}>
          {top3.map((driver, visualIdx) => {
            const rank = actualRanks[visualIdx];
            const p = PODIUM[rank - 1];
            if (!driver) return <div key={visualIdx} className="h-0" />;
            const delta = leader.total_points - driver.total_points;
            const isCenter = visualIdx === 1;

            return (
              <motion.div
                key={driver.user_id}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: visualIdx * 0.1 }}
                className={`rounded-2xl text-center ${isPage ? "p-5" : "p-4"} ${isCenter ? (isPage ? "pb-8 pt-7" : "pb-6 pt-6") : "pt-4 pb-4"}`}
                style={{
                  background: p.bg,
                  border: `1px solid ${p.border}`,
                  boxShadow: isCenter ? `0 8px 32px ${p.shadow}` : "none",
                }}
              >
                {/* Rank icon */}
                <div
                  className={`mx-auto mb-3 flex items-center justify-center rounded-full font-heading font-black ${isCenter ? "w-12 h-12 text-lg" : "w-9 h-9 text-sm"}`}
                  style={{
                    background: `${p.color}20`,
                    border: `2px solid ${p.color}50`,
                    color: p.color,
                    boxShadow: isCenter ? `0 0 20px ${p.shadow}` : "none",
                  }}
                >
                  {rank}
                </div>

                {isCenter && isPage && (
                  <div className="mb-2 text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: p.color }}>
                    Leider
                  </div>
                )}

                <div
                  className={`font-heading font-bold leading-tight text-white truncate ${isCenter ? (isPage ? "text-lg" : "text-base") : (isPage ? "text-base" : "text-sm")}`}
                >
                  {driver.display_name}
                </div>

                {driver.team && (
                  <div className="flex items-center justify-center gap-1 mt-0.5 mb-2">
                    <div className="w-1 h-1 rounded-full" style={{ backgroundColor: driver.team.color }} />
                    <span className="text-[10px] text-gray-600 truncate">{driver.team.name}</span>
                  </div>
                )}

                <div
                  className={`font-heading font-black mt-2 leading-none ${isCenter ? (isPage ? "text-4xl" : "text-3xl") : (isPage ? "text-3xl" : "text-2xl")}`}
                  style={{ color: p.color }}
                >
                  {driver.total_points}
                </div>
                <div className="text-[10px] text-gray-600 uppercase tracking-wide mt-0.5">pts</div>

                {delta > 0 && (
                  <div className="text-[10px] text-gray-700 mt-1">-{delta}</div>
                )}
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Full table */}
      {rest.length > 0 && (
        <div
          className="rounded-2xl overflow-x-auto"
          style={{ border: "1px solid rgba(255,255,255,0.06)" }}
        >
          {/* Header */}
          <div
            className="grid gap-2 px-5 py-2.5 text-[10px] font-black uppercase tracking-widest text-gray-600"
            style={{
              gridTemplateColumns: tableColumns,
              background: "rgba(255,255,255,0.03)",
            }}
          >
            <span>Pos</span>
            <span>Coureur</span>
            {isPage && <span>Team</span>}
            <span className="text-center">W</span>
            <span className="text-center">Pts</span>
          </div>

          {standings.map((driver, i) => {
            const delta = i > 0 ? driver.total_points - standings[i - 1].total_points : 0;
            const isFirst = i === 0;
            const podiumColor = i < 3 ? PODIUM[i].color : null;
            const teamColor = driver.team?.color;

            return (
              <motion.div
                key={driver.user_id}
                initial={{ opacity: 0, x: -12 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: Math.min(i, 10) * 0.03 }}
                className="relative overflow-hidden"
                style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}
              >
                {/* Team color left glow bar */}
                {teamColor && (
                  <div
                    className="absolute left-0 top-0 bottom-0 w-0.5"
                    style={{ background: teamColor, boxShadow: `2px 0 8px ${teamColor}60` }}
                  />
                )}
                <button
                  onClick={() => onSelectDriver ? onSelectDriver(driver.user_id) : undefined}
                  className={`group grid gap-2 pl-5 pr-5 items-center w-full text-left ${isPage ? "py-4" : "py-3.5"}`}
                  style={{
                    gridTemplateColumns: tableColumns,
                    background: teamColor
                      ? `linear-gradient(90deg, ${teamColor}08 0%, transparent 40%)`
                      : isFirst ? "rgba(249,115,22,0.04)" : "transparent",
                    display: "grid",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = teamColor ? `linear-gradient(90deg, ${teamColor}18 0%, rgba(255,255,255,0.02) 60%)` : "rgba(255,255,255,0.025)")}
                  onMouseLeave={e => (e.currentTarget.style.background = teamColor ? `linear-gradient(90deg, ${teamColor}08 0%, transparent 40%)` : isFirst ? "rgba(249,115,22,0.04)" : "transparent")}
                >
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center font-heading font-black text-sm"
                    style={
                      podiumColor
                        ? { background: `${podiumColor}15`, color: podiumColor }
                        : { color: "#4b5563" }
                    }
                  >
                    {i + 1}
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {isFirst && <div className="w-1 h-4 rounded-full bg-orange-500 shrink-0" />}
                      <span className={`font-heading font-bold text-white truncate group-hover:text-orange-400 transition-colors ${isPage ? "text-base" : "text-sm"}`}>{driver.display_name}</span>
                    </div>
                    {driver.team && !isPage && (
                      <div className="flex items-center gap-1 mt-0.5">
                        <div className="w-1 h-1 rounded-full" style={{ backgroundColor: driver.team.color }} />
                        <span className="text-[10px] truncate" style={{ color: driver.team.color + "99" }}>{driver.team.name}</span>
                      </div>
                    )}
                  </div>

                  {isPage && (
                    <div className="flex items-center gap-2 min-w-0">
                      {driver.team ? (
                        <>
                          <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: driver.team.color }} />
                          <span className="text-xs truncate" style={{ color: driver.team.color + "aa" }}>{driver.team.name}</span>
                        </>
                      ) : (
                        <span className="text-xs text-gray-700">-</span>
                      )}
                    </div>
                  )}

                  <div className="text-center font-heading font-bold text-sm text-gray-500">{driver.wins}</div>

                  <div className="text-center">
                    <span className="font-heading font-black text-base" style={{ color: podiumColor || "#d1d5db" }}>
                      {driver.total_points}
                    </span>
                    {delta < 0 && (
                      <div className="text-[10px] text-gray-700">{delta}</div>
                    )}
                  </div>
                </button>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default NewStandingsTable;
