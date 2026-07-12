/**
 * RaceModal — race detail in popup
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTeams } from "@/hooks/data/useSharedQueries";
import { motion } from "framer-motion";
import { MapPin, Clock, CloudSun, Gauge, Users, Trophy, Flag, Zap, LogIn, LogOut, CheckCircle2, Loader2, AlertCircle, KeyRound, Eye, EyeOff } from "lucide-react";
import { getTrackInfo } from "@/lib/trackData";
import { getTrackPhoto } from "@/lib/trackPhotos";
import { useNow, formatCountdown } from "@/lib/useCountdown";
import { toast } from "sonner";
import { useState, useEffect, useRef } from "react";
import { isRaceRegistrationOpen } from "@/lib/raceRegistration";

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
  lobby_name?: string | null;
  lobby_password?: string | null;
  lobby_reveal_minutes?: number | null;
  leagues?: { id?: string; name: string; car_class?: string | null };
}

type RaceResultProfile = {
  display_name: string | null;
  iracing_name: string | null;
  team_id: string | null;
};

type RaceModalResult = {
  id: string;
  position: number | null;
  points: number | null;
  best_lap: string | null;
  fastest_lap: boolean | null;
  incidents: number | null;
  dnf: boolean | null;
  profiles: RaceResultProfile | null;
};

type PublicResultProfile = RaceResultProfile & {
  user_id: string | null;
};


type UserIdRow = {
  user_id: string;
};

type RegistrantProfile = {
  user_id: string;
  display_name: string | null;
  iracing_name: string | null;
  team_id: string | null;
};

type RaceRegistrant = {
  user_id: string;
  display_name: string;
  team_id: string | null;
};

type Session = {
  label: string;
  dur: string;
  color: string;
  bg: string;
};

interface RegistrationProps {
  isAuthenticated: boolean;
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
  registration?: RegistrationProps;
}

const RaceModal = ({ race, registration }: Props) => {
  const now = useNow();
  const [showPassword, setShowPassword] = useState(false);
  const lobbyToastShown = useRef(false);

  const { data: results = [] } = useQuery({
    queryKey: ["race-modal-results", race.id],
    queryFn: async (): Promise<RaceModalResult[]> => {
      const { data } = await supabase
        .from("race_results")
        .select("*")
        .eq("race_id", race.id)
        .order("position");
      const resultRows = (data || []) as (Omit<RaceModalResult, "profiles"> & UserIdRow)[];
      const userIds = [...new Set(resultRows.map((row) => row.user_id).filter(Boolean))];
      const { data: profileData } = await supabase
        .from("public_profiles")
        .select("user_id, display_name, iracing_name, team_id")
        .in("user_id", userIds);
      const profiles = new Map(
        ((profileData || []) as PublicResultProfile[])
          .filter((profile): profile is PublicResultProfile & { user_id: string } => Boolean(profile.user_id))
          .map((profile) => [profile.user_id, profile]),
      );
      return resultRows.map((row) => ({ ...row, profiles: profiles.get(row.user_id) || null }));
    },
  });

  const { data: teams = [] } = useTeams();

  const { data: registrants = [] } = useQuery({
    queryKey: ["race-modal-registrants", race.id, race.leagues?.id],
    enabled: race.status !== "completed",
    queryFn: async (): Promise<RaceRegistrant[]> => {
      // Direct race registrants
      const { data: raceRegs } = await supabase
        .from("race_registrations")
        .select("user_id")
        .eq("race_id", race.id);

      // Season registrants (if race belongs to a league)
      let seasonUserIds: string[] = [];
      const leagueId = race.leagues?.id;
      if (leagueId) {
        const { data } = await supabase
          .from("season_registrations")
          .select("user_id")
          .eq("league_id", leagueId);
        seasonUserIds = ((data || []) as UserIdRow[]).map((r) => r.user_id);
      }

      // Merge + deduplicate user_ids
      const seen = new Set<string>();
      const raceUserIds = ((raceRegs || []) as UserIdRow[]).map((r) => r.user_id);
      const allUserIds = [...raceUserIds, ...seasonUserIds].filter((uid) => {
        if (seen.has(uid)) return false;
        seen.add(uid);
        return true;
      });

      if (!allUserIds.length) return [];

      // Fetch profiles for all user_ids
      const { data: profs } = await supabase
        .from("public_profiles")
        .select("user_id, display_name, iracing_name, team_id")
        .in("user_id", allUserIds);

      const profiles = (profs || []) as RegistrantProfile[];
      return allUserIds.map((uid) => {
        const prof = profiles.find((p) => p.user_id === uid);
        return {
          user_id: uid,
          display_name: prof?.display_name || prof?.iracing_name || "Onbekend",
          team_id: prof?.team_id ?? null,
        };
      });
    },
  });

  const showResults    = race.status === "completed" && results.length > 0;
  const showRegistrants = !showResults;

  const trackInfo  = getTrackInfo(race.track);
  const trackPhoto = getTrackPhoto(race.track);
  const raceDate   = new Date(race.race_date);
  const dateStr    = raceDate.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Amsterdam" });
  const timeStr    = raceDate.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" });

  const sessions = [
    race.practice_duration   && { label: "Training",   dur: race.practice_duration,   color: "#3b82f6", bg: "rgba(59,130,246,0.12)" },
    race.qualifying_duration && { label: "Kwalificatie",  dur: race.qualifying_duration,  color: "#eab308", bg: "rgba(234,179,8,0.12)" },
    race.race_duration       && { label: "Race",        dur: race.race_duration,        color: "#f97316", bg: "rgba(249,115,22,0.12)" },
  ].filter((session): session is Session => Boolean(session));

  const winner     = results[0];
  const fastestLap = results.find((r) => r.fastest_lap);
  const dnfCount   = results.filter((r) => r.dnf).length;

  const statusColor = race.status === "completed" ? "#6b7280" : race.status === "live" ? "#22c55e" : "#f97316";
  const statusBg    = race.status === "completed" ? "rgba(107,114,128,0.15)" : race.status === "live" ? "rgba(34,197,94,0.15)" : "rgba(249,115,22,0.15)";
  const statusLabel = race.status === "completed" ? "Afgelopen" : race.status === "live" ? "🔴 LIVE" : "Aankomend";

  const hasLobbyInfo = Boolean(race.lobby_name && race.lobby_password);
  const canViewLobby = Boolean(registration && (registration.isRegistered || registration.isRegisteredViaSeason));
  const lobbyRevealMinutes = race.lobby_reveal_minutes ?? 15;
  const raceTimeMs = raceDate.getTime();
  const lobbyRevealTimeMs = raceTimeMs - lobbyRevealMinutes * 60 * 1000;
  const isLobbyRevealed = now.getTime() >= lobbyRevealTimeMs;
  const isBeforeRace = now.getTime() < raceTimeMs;
  const lobbyRevealTimeStr = new Date(lobbyRevealTimeMs).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" });
  const lobbyCountdown = lobbyRevealTimeMs > now.getTime() ? formatCountdown(new Date(lobbyRevealTimeMs).toISOString(), now) : null;

  useEffect(() => {
    lobbyToastShown.current = false;
  }, [race.id]);

  useEffect(() => {
    if (!hasLobbyInfo || !canViewLobby || race.status === "completed" || !isLobbyRevealed || !isBeforeRace || lobbyToastShown.current) return;

    lobbyToastShown.current = true;
    const msUntilRaceEnd = raceTimeMs + 7200000 - now.getTime();

    toast.custom((t) => (
      <motion.div
        initial={{ opacity: 0, y: -20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="pointer-events-auto rounded-2xl overflow-hidden w-[22rem] max-w-[calc(100vw-2rem)] shadow-2xl"
        style={{ background: "linear-gradient(135deg, rgba(249,115,22,0.18), rgba(14,14,22,0.98))", border: "1px solid rgba(249,115,22,0.35)", backdropFilter: "blur(16px)" }}
      >
        <div className="px-5 pt-4 pb-3">
          <div className="flex items-center gap-2 mb-2">
            <KeyRound className="w-5 h-5 text-orange-500" />
            <span className="text-sm font-black text-white uppercase tracking-wider">Lobby info beschikbaar</span>
          </div>
          <p className="text-xs text-muted-foreground mb-3">{race.name}</p>
          <div className="rounded-xl p-3 space-y-2" style={{ background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] text-muted-foreground uppercase tracking-wider">Lobby naam</span>
              <span className="text-sm font-bold text-white font-mono text-right break-all">{race.lobby_name}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] text-muted-foreground uppercase tracking-wider">Wachtwoord</span>
              <code className="text-sm font-mono font-bold text-orange-400 break-all">{race.lobby_password}</code>
            </div>
          </div>
        </div>
        <button
          onClick={() => toast.dismiss(t)}
          className="w-full py-2.5 text-xs font-bold text-orange-400 uppercase tracking-wider transition-colors hover:bg-orange-500/10"
          style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
        >
          Sluiten
        </button>
      </motion.div>
    ), { duration: msUntilRaceEnd > 0 ? Math.min(msUntilRaceEnd, 3600000) : 60000 });
  }, [canViewLobby, hasLobbyInfo, isBeforeRace, isLobbyRevealed, now, race.id, race.lobby_name, race.lobby_password, race.name, race.status, raceTimeMs]);

  const renderLobbyCard = () => {
    if (race.status === "completed" || !hasLobbyInfo || !canViewLobby) return null;

    return (
      <div className="w-full lg:w-[22rem] rounded-2xl p-4" style={{ background: isLobbyRevealed ? "rgba(249,115,22,0.08)" : "rgba(255,255,255,0.035)", border: isLobbyRevealed ? "1px solid rgba(249,115,22,0.22)" : "1px solid rgba(255,255,255,0.07)" }}>
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-orange-500" />
            <span className="text-xs font-black text-orange-500 uppercase tracking-widest">Lobby info</span>
          </div>
          <span className="text-[10px] text-muted-foreground">🔒 Ingeschreven</span>
        </div>

        {isLobbyRevealed ? (
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-3">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider pt-1">Lobby naam</span>
              <span className="text-sm font-bold text-white font-mono text-right break-all">{race.lobby_name}</span>
            </div>
            <div className="flex items-start justify-between gap-3">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider pt-1">Wachtwoord</span>
              <div className="flex items-center gap-2 min-w-0">
                <code className="text-sm font-mono font-bold text-orange-400 px-2.5 py-0.5 rounded-md break-all" style={{ background: "rgba(249,115,22,0.1)" }}>
                  {showPassword ? race.lobby_password : "••••••••"}
                </code>
                <button
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-muted-foreground hover:text-white transition-colors p-1 shrink-0"
                  title={showPassword ? "Verberg wachtwoord" : "Toon wachtwoord"}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div>
            <div className="text-[11px] text-muted-foreground mb-1">Beschikbaar om {lobbyRevealTimeStr}</div>
            <div className="font-heading font-black text-xl text-white tabular-nums">
              {lobbyCountdown || "00m 00s"}
            </div>
          </div>
        )}
      </div>
    );
  };

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
        {trackInfo?.imageUrl && (
          <img
            src={trackInfo.imageUrl}
            alt=""
            aria-hidden
            className="absolute right-6 top-1/2 -translate-y-1/2 w-48 h-48 object-contain select-none pointer-events-none hidden md:block"
            style={{ opacity: 0.55, filter: "invert(1) brightness(3)" }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        )}
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
            {registrants.length > 0 && <div className="flex items-center gap-1.5"><Users className="w-4 h-4" />{registrants.length} deelnemers</div>}
          </div>

          {sessions.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {sessions.map((s) => (
                <span key={s.label} className="text-xs font-bold px-3 py-1.5 rounded-lg" style={{ background: s.bg, color: s.color, border: `1px solid ${s.color}25` }}>
                  {s.label} · {s.dur}
                </span>
              ))}
            </div>
          )}

          {/* Details / inschrijven / lobby */}
          {registration && isRaceRegistrationOpen(race, now) && (
            <div className="mt-5 pt-5 flex flex-col lg:flex-row lg:items-start gap-4" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
              <div className="flex-1 min-w-0">
              {!registration.isAuthenticated ? (
                <div className="flex items-center gap-2 text-sm text-yellow-500/80 px-4 py-2.5 rounded-xl w-fit"
                  style={{ background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.15)" }}>
                  <AlertCircle className="w-4 h-4" />
                  Log eerst in om je in te schrijven
                </div>
              ) : !registration.profileComplete ? (
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
              {renderLobbyCard()}
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
                { label: "Winnaar",       value: winner?.profiles?.display_name || "—",      accent: "#facc15", icon: <Trophy className="w-4 h-4" /> },
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
                <span>Pos</span><span>Coureur</span><span>Pts</span><span>Ronde</span><span>Inc</span>
              </div>
              {results.map((r, i) => {
                const posColor = r.position !== null && r.position <= 3 ? PODIUM[r.position - 1] : (r.dnf ? "#ef4444" : "#6b7280");
                const team = teams.find((t) => t.id === r.profiles?.team_id);
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
                        <div className="text-sm font-bold text-white truncate">{r.profiles?.display_name || r.profiles?.iracing_name || "Onbekend"}</div>
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
              {registrants.length > 0 && (
                <span className="text-xs text-gray-600">{registrants.length} deelnemer{registrants.length !== 1 ? "s" : ""}</span>
              )}
            </div>

            {registrants.length > 0 ? (
              <div className="rounded-2xl overflow-hidden relative" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="overflow-y-auto" style={{ maxHeight: "20rem", overscrollBehavior: "contain" }}>
                {registrants.map((r, i) => {
                  const team = teams.find((t) => t.id === r.team_id);
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
                {registrants.length > 8 && (
                  <div className="absolute bottom-0 left-0 right-0 h-10 pointer-events-none rounded-b-2xl" style={{ background: "linear-gradient(to bottom, transparent, #0e0e16)" }} />
                )}
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
