/**
 * RaceModal — race detail in popup
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";
import { MapPin, Clock, CloudSun, Gauge, Users, Trophy, Flag, Zap, LogIn, LogOut, CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import { getTrackInfo } from "@/lib/trackData";
import { getTrackPhoto } from "@/lib/trackPhotos";
import { MOCK_TEAMS, MOCK_RACE_DETAIL_RESULTS, MOCK_RACE_REGISTRANTS } from "@/lib/mockData";

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

interface RegistrationProps {
  isRegistered: boolean;
  isRegisteredViaSeason: boolean;
  profileComplete: boolean;
  isLoading?: boolean;
  hasLeague: boolean;
  onRegister: () => void;
  onUnregister: () => void;
}

interface Props {
  race: Race;
  mockMode?: boolean;
  registration?: RegistrationProps;
}

const RaceModal = ({ race, mockMode = false, registration }: Props) => {
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

  const { data: registrants = [] } = useQuery({
    queryKey: ["race-modal-registrants", race.id, (race as any).leagues?.id],
    enabled: !mockMode && race.status !== "completed",
    queryFn: async () => {
      // Direct race registrants
      const { data: raceRegs } = await (supabase as any)
        .from("race_registrations")
        .select("user_id")
        .eq("race_id", race.id);

      // Season registrants (if race belongs to a league)
      let seasonUserIds: string[] = [];
      const leagueId = (race as any).leagues?.id;
      if (leagueId) {
        const { data } = await (supabase as any)
          .from("season_registrations")
          .select("user_id")
          .eq("league_id", leagueId);
        seasonUserIds = (data || []).map((r: any) => r.user_id);
      }

      // Merge + deduplicate user_ids
      const seen = new Set<string>();
      const raceUserIds = (raceRegs || []).map((r: any) => r.user_id);
      const allUserIds = [...raceUserIds, ...seasonUserIds].filter((uid) => {
        if (seen.has(uid)) return false;
        seen.add(uid);
        return true;
      });

      if (!allUserIds.length) return [];

      // Fetch profiles for all user_ids
      const { data: profs } = await supabase
        .from("profiles")
        .select("user_id, display_name, iracing_name, team_id")
        .in("user_id", allUserIds);

      return allUserIds.map((uid) => {
        const prof = (profs || []).find((p: any) => p.user_id === uid);
        return {
          user_id: uid,
          display_name: prof?.display_name || prof?.iracing_name || "Unknown",
          team_id: prof?.team_id,
        };
      });
    },
  });

  const activeTeams    = mockMode ? MOCK_TEAMS : teams;
  const results        = mockMode && race.status === "completed" ? MOCK_RACE_DETAIL_RESULTS : realResults;
  const activeRegistrants = mockMode ? MOCK_RACE_REGISTRANTS : registrants;
  const activeRegCount = mockMode ? MOCK_RACE_REGISTRANTS.length : registrants.length;

  const showResults    = race.status === "completed" && results.length > 0;
  const showRegistrants = !showResults;

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

          {/* Registration button — alle niet-afgeronde races */}
          {registration && race.status !== "completed" && (
            <div className="mt-5 pt-5" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
              {!registration.profileComplete ? (
                <div className="flex items-center gap-2 text-sm text-yellow-500/80 px-4 py-2.5 rounded-xl w-fit"
                  style={{ background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.15)" }}>
                  <AlertCircle className="w-4 h-4" />
                  Vul eerst je iRacing profiel in om je in te schrijven
                </div>
              ) : registration.isRegisteredViaSeason ? (
                <div className="flex items-center gap-2 text-sm font-bold text-green-400 px-4 py-2.5 rounded-xl w-fit"
                  style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.2)" }}>
                  <CheckCircle2 className="w-4 h-4" />
                  Ingeschreven via seizoensregistratie
                </div>
              ) : registration.isRegistered ? (
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2 text-sm font-bold text-green-400">
                    <CheckCircle2 className="w-4 h-4" />
                    Ingeschreven voor deze race
                  </div>
                  <button
                    onClick={registration.onUnregister}
                    disabled={registration.isLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                    style={{ background: "rgba(107,114,128,0.1)", border: "1px solid rgba(107,114,128,0.2)", color: "#6b7280", opacity: registration.isLoading ? 0.6 : 1 }}
                  >
                    {registration.isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <LogOut className="w-3 h-3" />}
                    Uitschrijven
                  </button>
                </div>
              ) : (
                <button
                  onClick={registration.onRegister}
                  disabled={registration.isLoading}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all"
                  style={{
                    background: "rgba(249,115,22,0.15)",
                    border: "1px solid rgba(249,115,22,0.35)",
                    color: "#f97316",
                    opacity: registration.isLoading ? 0.6 : 1,
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(249,115,22,0.25)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(249,115,22,0.15)"; }}
                >
                  {registration.isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
                  {registration.hasLeague ? "Schrijf in voor deze race" : "Schrijf in voor race"}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="px-8 pb-8">

        {/* ── COMPLETED: summary stats + uitslag ── */}
        {showResults && (
          <>
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
          </>
        )}

        {/* ── UPCOMING / LIVE: deelnemers ── */}
        {showRegistrants && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-orange-500" />
                <span className="text-xs font-black text-orange-500 uppercase tracking-widest">Ingeschreven</span>
              </div>
              {activeRegistrants.length > 0 && (
                <span className="text-xs text-gray-600">{activeRegistrants.length} deelnemer{activeRegistrants.length !== 1 ? "s" : ""}</span>
              )}
            </div>

            {activeRegistrants.length > 0 ? (
              <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
                {activeRegistrants.map((r: any, i: number) => {
                  const team = activeTeams.find((t: any) => t.id === r.team_id);
                  return (
                    <motion.div
                      key={r.user_id}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.04 }}
                      className="relative overflow-hidden"
                      style={{ borderTop: i > 0 ? "1px solid rgba(255,255,255,0.04)" : undefined }}
                    >
                      {team?.color && (
                        <div className="absolute left-0 top-0 bottom-0 w-0.5" style={{ background: team.color, boxShadow: `2px 0 6px ${team.color}50` }} />
                      )}
                      <div
                        className="flex items-center gap-3 pl-5 pr-5 py-3"
                        style={{
                          background: team?.color
                            ? `linear-gradient(90deg, ${team.color}08 0%, transparent 40%)`
                            : "transparent",
                        }}
                      >
                        <div
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black shrink-0"
                          style={{ background: "rgba(255,255,255,0.05)", color: "#4b5563" }}
                        >
                          {i + 1}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-bold text-white truncate">{r.display_name}</div>
                          {team && (
                            <div className="text-[10px] mt-0.5" style={{ color: team.color + "99" }}>{team.name}</div>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-10 text-gray-700 text-sm">
                Nog niemand ingeschreven
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default RaceModal;
