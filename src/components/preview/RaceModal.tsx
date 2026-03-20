/**
 * RaceModal — race detail in popup
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";
import { MapPin, Clock, CloudSun, Gauge, Users, Trophy, Flag, Zap } from "lucide-react";
import { getTrackInfo } from "@/lib/trackData";
import { getTrackPhoto } from "@/lib/trackPhotos";
import { MOCK_TEAMS, MOCK_RACE_DETAIL_RESULTS } from "@/lib/mockData";

const PODIUM = ["#facc15", "#94a3b8", "#d97706"];

interface Race {
  id: string;
  name: string;
  track: string;
  race_date: string;
  status: string;
  weather?: string;
  setup?: string;
  practice_duration?: string;
  qualifying_duration?: string;
  race_duration?: string;
  leagues?: { name: string; car_class?: string };
}

interface Props {
  race: Race;
  mockMode?: boolean;
}

const RaceModal = ({ race, mockMode = false }: Props) => {
  const { data: realResults = [] } = useQuery({
    queryKey: ["race-modal-results", race.id],
    enabled: !mockMode,
    queryFn: async () => {
      const { data } = await supabase
        .from("race_results")
        .select("*, profiles(display_name, iracing_name, team_id)")
        .eq("race_id", race.id)
        .order("position");
      return data || [];
    },
  });

  const { data: teams = [] } = useQuery({
    queryKey: ["teams"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("teams").select("id, name, color");
      return data || [];
    },
  });

  const { data: regCount } = useQuery({
    queryKey: ["race-modal-reg", race.id],
    enabled: !mockMode,
    queryFn: async () => {
      const { count } = await (supabase as any)
        .from("race_registrations").select("id", { count: "exact" }).eq("race_id", race.id);
      return count || 0;
    },
  });

  const activeTeams   = mockMode ? MOCK_TEAMS : teams;
  const results       = mockMode ? MOCK_RACE_DETAIL_RESULTS : realResults;
  const activeRegCount = mockMode ? 6 : (regCount || 0);

  const trackInfo  = getTrackInfo(race.track);
  const trackPhoto = getTrackPhoto(race.track);
  const raceDate   = new Date(race.race_date);
  const dateStr    = raceDate.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  const timeStr    = raceDate.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

  const sessions = [
    race.practice_duration   && { label: "Practice",   dur: race.practice_duration,   color: "#3b82f6", bg: "rgba(59,130,246,0.12)" },
    race.qualifying_duration && { label: "Qualifying",  dur: race.qualifying_duration,  color: "#eab308", bg: "rgba(234,179,8,0.12)" },
    race.race_duration       && { label: "Race",        dur: race.race_duration,        color: "#f97316", bg: "rgba(249,115,22,0.12)" },
  ].filter(Boolean) as any[];

  const winner     = results[0];
  const fastestLap = results.find((r: any) => r.fastest_lap);
  const dnfCount   = results.filter((r: any) => r.dnf).length;

  const statusColor = race.status === "completed" ? "#6b7280" : race.status === "live" ? "#22c55e" : "#f97316";
  const statusBg    = race.status === "completed" ? "rgba(107,114,128,0.15)" : race.status === "live" ? "rgba(34,197,94,0.15)" : "rgba(249,115,22,0.15)";
  const statusLabel = race.status === "completed" ? "Afgelopen" : race.status === "live" ? "🔴 LIVE" : "Upcoming";

  return (
    <div>
      {/* Hero met track foto */}
      <div className="relative overflow-hidden" style={{ minHeight: 220 }}>
        <img
          src={trackPhoto}
          alt=""
          className="absolute inset-0 w-full h-full object-cover pointer-events-none select-none"
          style={{ opacity: 0.45, filter: "saturate(0.6) brightness(0.7)", objectPosition: "center right" }}
        />
        <div className="absolute inset-0" style={{ background: "linear-gradient(90deg, rgba(14,14,22,0.95) 0%, rgba(14,14,22,0.7) 55%, rgba(14,14,22,0.3) 100%)" }} />
        <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(14,14,22,1) 0%, transparent 50%)" }} />
        <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: "linear-gradient(90deg, #f97316, transparent)" }} />

        <div className="relative px-8 pt-8 pb-6">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: statusBg, color: statusColor }}>
              {statusLabel}
            </span>
            {race.leagues && <span className="text-xs text-gray-500">{race.leagues.name}</span>}
          </div>

          <h2 className="font-heading font-black text-3xl md:text-4xl text-white leading-none mb-3">
            {race.name}
          </h2>

          <div className="flex items-center gap-2 mb-4 text-gray-400">
            <MapPin className="w-4 h-4 text-orange-500 shrink-0" />
            <span className="font-medium">{race.track}</span>
            {trackInfo?.country && <span className="text-gray-600">· {trackInfo.country}</span>}
          </div>

          <div className="flex flex-wrap gap-x-5 gap-y-2 mb-4 text-sm text-gray-500">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4" />
              <span>{dateStr}</span>
              <span className="font-bold text-orange-400 px-2 py-0.5 rounded text-xs" style={{ background: "rgba(249,115,22,0.08)" }}>{timeStr}</span>
            </div>
            {race.weather && <div className="flex items-center gap-1.5"><CloudSun className="w-4 h-4" />{race.weather}</div>}
            {race.setup   && <div className="flex items-center gap-1.5"><Gauge className="w-4 h-4" />{race.setup}</div>}
            {activeRegCount > 0 && <div className="flex items-center gap-1.5"><Users className="w-4 h-4" />{activeRegCount} deelnemers</div>}
          </div>

          {sessions.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {sessions.map((s: any) => (
                <span key={s.label} className="text-xs font-bold px-3 py-1.5 rounded-lg" style={{ background: s.bg, color: s.color, border: `1px solid ${s.color}25` }}>
                  {s.label} · {s.dur}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="px-8 pb-8">

        {/* Summary stats bij completed race */}
        {race.status === "completed" && results.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
            {[
              { label: "Winner",        value: winner?.profiles?.display_name || "—",      accent: "#facc15", icon: <Trophy className="w-4 h-4" /> },
              { label: "Snelste ronde", value: fastestLap?.profiles?.display_name || "—",  accent: "#a855f7", icon: <Zap className="w-4 h-4" /> },
              { label: "Starters",      value: results.length,                              accent: null,      icon: <Users className="w-4 h-4" /> },
              { label: "DNF's",         value: dnfCount,                                    accent: dnfCount > 0 ? "#ef4444" : null, icon: <Flag className="w-4 h-4" /> },
            ].map(({ label, value, accent, icon }) => (
              <div key={label} className="rounded-2xl p-4" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="flex items-center gap-2 mb-1.5" style={{ color: accent || "#6b7280" }}>{icon}<span className="text-[10px] uppercase tracking-widest text-gray-600">{label}</span></div>
                <div className="font-heading font-black text-lg text-white" style={{ color: accent || "#e5e7eb" }}>{value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Results table */}
        {results.length > 0 ? (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Trophy className="w-4 h-4 text-orange-500" />
              <span className="text-xs font-black text-orange-500 uppercase tracking-widest">Race Uitslag</span>
            </div>
            <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
              <div
                className="grid gap-2 px-5 py-2.5 text-[10px] font-black uppercase tracking-widest text-gray-600"
                style={{ gridTemplateColumns: "3rem 1fr 4rem 4rem 4rem", background: "rgba(255,255,255,0.03)" }}
              >
                <span>Pos</span><span>Driver</span><span>Pts</span><span>Ronde</span><span>Inc</span>
              </div>
              {results.map((r: any, i: number) => {
                const posColor = r.position <= 3 ? PODIUM[r.position - 1] : (r.dnf ? "#ef4444" : "#6b7280");
                const team = activeTeams.find((t: any) => t.id === r.profiles?.team_id);
                return (
                  <motion.div
                    key={r.id || i}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.03 }}
                    className="relative overflow-hidden"
                    style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}
                  >
                    {team?.color && (
                      <div className="absolute left-0 top-0 bottom-0 w-0.5" style={{ background: team.color, boxShadow: `2px 0 6px ${team.color}50` }} />
                    )}
                    <div
                      className="grid gap-2 pl-5 pr-5 py-3 items-center"
                      style={{
                        gridTemplateColumns: "3rem 1fr 4rem 4rem 4rem",
                        background: team?.color ? `linear-gradient(90deg, ${team.color}08 0%, transparent 40%)` : i === 0 ? "rgba(250,204,21,0.03)" : "transparent",
                      }}
                    >
                      <div className="font-heading font-black text-base" style={{ color: posColor }}>
                        {r.dnf ? "DNF" : `P${r.position}`}
                      </div>
                      <div>
                        <div className="text-sm font-bold text-white truncate">{r.profiles?.display_name || r.profiles?.iracing_name || "Unknown"}</div>
                        {team && <div className="text-[10px] mt-0.5" style={{ color: team.color + "99" }}>{team.name}</div>}
                      </div>
                      <div className="font-heading font-bold text-sm text-orange-400">{r.points}</div>
                      <div className="text-xs text-gray-500 tabular-nums">{r.best_lap || "—"}{r.fastest_lap && <span className="ml-1 text-purple-400">⚡</span>}</div>
                      <div className="text-xs text-gray-600">{r.incidents ?? 0}</div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="text-center py-10 text-gray-700 text-sm">
            {race.status === "upcoming" ? "Race nog niet gereden" : "Geen resultaten beschikbaar"}
          </div>
        )}
      </div>
    </div>
  );
};

export default RaceModal;
