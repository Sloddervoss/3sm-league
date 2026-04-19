import { motion } from "framer-motion";
import { Crown, Trophy, Link as LinkIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";

const PODIUM = ["#facc15", "#94a3b8", "#d97706"];

type ChampionshipResult = {
  user_id: string;
  position: number | null;
  points: number | null;
  profiles: {
    display_name: string | null;
    iracing_name: string | null;
    iracing_id: number | null;
  } | null;
};

type ChampionshipStanding = {
  name: string;
  points: number;
  wins: number;
  races: number;
  podiums: number;
};

const ChampionshipLeader = () => {
  const { data: standings } = useQuery({
    queryKey: ["championship-leader"],
    queryFn: async (): Promise<ChampionshipStanding[]> => {
      const { data: results } = await supabase
        .from("race_results")
        .select("user_id, position, points, profiles(display_name, iracing_name, iracing_id), races!inner(league_id)")
        .not("races.league_id", "is", null);

      const map = new Map<string, { name: string; points: number; wins: number; races: number; podiums: number }>();
      ((results || []) as ChampionshipResult[]).forEach((r) => {
        const e = map.get(r.user_id) || {
          name: r.profiles?.display_name || r.profiles?.iracing_name || "Unknown",
          points: 0, wins: 0, races: 0, podiums: 0,
        };
        e.points += r.points || 0; e.races++;
        if (r.position === 1) e.wins++;
        if (r.position !== null && r.position <= 3) e.podiums++;
        map.set(r.user_id, e);
      });

      return [...map.values()].sort((a, b) => b.points - a.points).slice(0, 5);
    },
  });

  if (!standings?.length) return null;

  const leader = standings[0];
  const maxPts = leader.points;

  return (
    <section className="py-20" style={{ background: "#08080f" }}>
      <div className="container mx-auto px-4 max-w-7xl">

        <div className="flex items-end justify-between mb-8">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <Crown className="w-4 h-4 text-yellow-400" />
              <span className="text-xs font-black text-yellow-400 uppercase tracking-[0.25em]">Kampioenschap</span>
            </div>
            <h2 className="font-heading font-black text-3xl md:text-4xl text-white leading-none">KLASSEMENT LEIDER</h2>
          </div>
          <Link to="/standings" className="text-xs text-gray-600 hover:text-orange-500 transition-colors font-bold">
            Volledig klassement →
          </Link>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Leader card */}
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            className="relative rounded-2xl overflow-hidden p-6"
            style={{
              background: "linear-gradient(160deg, #111118 0%, #0c0c12 100%)",
              border: "1px solid rgba(250,204,21,0.2)",
              boxShadow: "0 8px 40px rgba(250,204,21,0.06)",
            }}
          >
            <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: "linear-gradient(90deg, #facc15, transparent)" }} />
            <div className="absolute -right-4 -top-4 font-heading font-black text-[8rem] leading-none select-none pointer-events-none" style={{ color: "#facc15", opacity: 0.03 }}>1</div>

            <div className="flex items-start gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(250,204,21,0.12)", border: "1.5px solid rgba(250,204,21,0.3)" }}>
                <Crown className="w-5 h-5 text-yellow-400" />
              </div>
              <div>
                <div className="text-[10px] font-black text-yellow-400 uppercase tracking-widest mb-0.5">Leider</div>
                <h3 className="font-heading font-black text-2xl text-white leading-tight">{leader.name}</h3>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 mb-5">
              {[
                { label: "Punten", value: leader.points, color: "#facc15" },
                { label: "Wins",   value: leader.wins,   color: null },
                { label: "Races",  value: leader.races,  color: null },
              ].map(({ label, value, color }) => (
                <div key={label} className="rounded-xl p-3 text-center" style={{ background: "rgba(255,255,255,0.04)" }}>
                  <div className="font-heading font-black text-2xl leading-none mb-1" style={{ color: color || "#e5e7eb" }}>{value}</div>
                  <div className="text-[10px] text-gray-600 uppercase tracking-wide">{label}</div>
                </div>
              ))}
            </div>

            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
              <div className="h-full rounded-full" style={{ width: "100%", background: "linear-gradient(90deg, #facc15, #d97706)" }} />
            </div>
          </motion.div>

          {/* Top 5 list */}
          <div className="space-y-2">
            {standings.map((driver, i) => {
              const podiumColor = i < 3 ? PODIUM[i] : null;
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: 16 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.06 }}
                  className="relative overflow-hidden rounded-xl px-4 py-3 flex items-center gap-4"
                  style={{
                    background: i === 0 ? "rgba(250,204,21,0.05)" : "rgba(255,255,255,0.03)",
                    border: `1px solid ${i === 0 ? "rgba(250,204,21,0.15)" : "rgba(255,255,255,0.05)"}`,
                  }}
                >
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center font-heading font-black text-sm shrink-0"
                    style={podiumColor
                      ? { background: `${podiumColor}15`, color: podiumColor }
                      : { color: "#4b5563" }}
                  >
                    {i + 1}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="font-heading font-bold text-sm text-white truncate">{driver.name}</div>
                    <div className="h-1 rounded-full mt-1.5 overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
                      <motion.div
                        initial={{ width: 0 }}
                        whileInView={{ width: `${maxPts > 0 ? (driver.points / maxPts) * 100 : 0}%` }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.8, delay: i * 0.06 }}
                        className="h-full rounded-full"
                        style={{ background: podiumColor || "#f97316" }}
                      />
                    </div>
                  </div>

                  <div className="shrink-0 text-right">
                    <div className="font-heading font-black text-lg" style={{ color: podiumColor || "#d1d5db" }}>{driver.points}</div>
                    <div className="text-[10px] text-gray-700">{driver.wins}W</div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
};

export default ChampionshipLeader;
