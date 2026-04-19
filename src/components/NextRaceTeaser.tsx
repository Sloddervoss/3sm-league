/**
 * NextRaceTeaser — compacte "Volgende Race" sectie op de home pagina.
 * Toont alleen de eerstvolgende race + countdown + CTA naar /calendar.
 */
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { MapPin, Clock, Timer, ChevronRight, Calendar, CheckCircle2 } from "lucide-react";
import { getTrackInfo } from "@/lib/trackData";
import { getTrackPhoto } from "@/lib/trackPhotos";
import { useRegistration } from "@/lib/useRegistration";
import { useNow, formatCountdown } from "@/lib/useCountdown";
import type { RaceWithLeagueSummary } from "@/lib/raceTypes";

type NextRace = RaceWithLeagueSummary;

type Session = {
  key: string;
  label: string;
  dur: string;
  color: string;
  bg: string;
};

const SOLO_COLOR = "#818cf8";

const NextRaceTeaser = () => {
  const now = useNow();
  const reg = useRegistration();

  const { data: races = [] } = useQuery({
    queryKey: ["races-with-leagues"],
    queryFn: async (): Promise<NextRace[]> => {
      const { data } = await supabase
        .from("races")
        .select("*, leagues(name, car_class, id, season)")
        .order("race_date", { ascending: true });
      return (data || []) as NextRace[];
    },
  });

  const nextRace = [...races]
    .filter((r) => r.status !== "completed" && new Date(r.race_date) > now)
    .sort((a, b) => new Date(a.race_date).getTime() - new Date(b.race_date).getTime())[0] as NextRace | undefined;

  if (!nextRace) return null;

  const isStandalone = !nextRace.leagues;
  const accentColor = isStandalone ? SOLO_COLOR : "#f97316";

  const leagueId = nextRace.leagues?.id;
  const isRegistered = reg.isRegisteredForRace(nextRace.id, leagueId);
  const isRegisteredViaSeason = reg.isRegisteredViaSeason(leagueId);

  const trackInfo  = getTrackInfo(nextRace.track);
  const trackPhoto = getTrackPhoto(nextRace.track);
  const countdown  = formatCountdown(nextRace.race_date, now);
  const dateStr    = new Date(nextRace.race_date).toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Amsterdam" });
  const timeStr    = new Date(nextRace.race_date).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" });

  const sessionItems: Array<Session | false> = [
    nextRace.practice_duration   && { key: "P", label: "Practice",   dur: nextRace.practice_duration,   color: "#3b82f6", bg: "rgba(59,130,246,0.12)" },
    nextRace.qualifying_duration && { key: "Q", label: "Qualifying",  dur: nextRace.qualifying_duration,  color: "#eab308", bg: "rgba(234,179,8,0.12)" },
    nextRace.race_duration       && { key: "R", label: "Race",        dur: nextRace.race_duration,        color: "#f97316", bg: "rgba(249,115,22,0.12)" },
  ];
  const sessions = sessionItems.filter((s): s is Session => Boolean(s));

  return (
    <section className="py-16" style={{ background: "#08080f" }}>
      <div className="container mx-auto px-4 max-w-7xl">

        {/* Section label */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-orange-500" />
            <span className="text-xs font-black text-orange-500 uppercase tracking-[0.25em]">Volgende Race</span>
          </div>
          <Link
            to="/calendar"
            className="flex items-center gap-1 text-xs font-bold text-gray-600 hover:text-orange-500 transition-colors"
          >
            Bekijk kalender <ChevronRight className="w-3 h-3" />
          </Link>
        </div>

        {/* Race card */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="relative overflow-hidden rounded-2xl"
          style={{
            background: "linear-gradient(135deg, #111118 0%, #0d0d14 100%)",
            border: `1px solid ${accentColor}33`,
          }}
        >
          {/* Top accent bar */}
          <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: `linear-gradient(90deg, ${accentColor}, transparent)` }} />

          <div className="flex flex-col md:flex-row items-stretch">
            {/* Track photo */}
            <div className="relative md:w-72 h-48 md:h-auto shrink-0 overflow-hidden">
              <img
                src={trackPhoto}
                alt={nextRace.track}
                className="absolute inset-0 w-full h-full object-cover"
                style={{ opacity: 0.5, filter: "saturate(0.6) brightness(0.7)" }}
              />
              <div className="absolute inset-0 md:hidden" style={{ background: "linear-gradient(to top, #0d0d14 0%, transparent 60%)" }} />
              <div className="absolute inset-0 hidden md:block" style={{ background: "linear-gradient(to right, transparent 60%, #0d0d14 100%)" }} />
            </div>

            {/* Content */}
            <div className="relative flex-1 p-6 md:p-8 flex flex-col justify-between overflow-hidden">
              {trackInfo?.imageUrl && (
                <img
                  src={trackInfo.imageUrl}
                  alt=""
                  aria-hidden
                  className="absolute right-4 top-1/2 -translate-y-1/2 w-48 h-48 object-contain select-none pointer-events-none hidden md:block"
                  style={{ opacity: 0.55, filter: "invert(1) brightness(3)" }}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              )}
              <div>
                {/* Status + type badge */}
                <div className="flex items-center gap-3 mb-3 flex-wrap">
                  <span
                    className="text-[10px] font-bold px-2.5 py-1 rounded-full"
                    style={{ background: `${accentColor}1f`, color: accentColor }}
                  >
                    Binnenkort
                  </span>
                  {isStandalone ? (
                    <span
                      className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded"
                      style={{ background: "rgba(99,102,241,0.12)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.2)" }}
                    >
                      Losse Race
                    </span>
                  ) : nextRace.leagues && (
                    <span
                      className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded"
                      style={{ background: "rgba(249,115,22,0.08)", color: "#f97316", border: "1px solid rgba(249,115,22,0.2)" }}
                    >
                      {nextRace.leagues.name}{nextRace.leagues.season ? ` · ${nextRace.leagues.season}` : ""}
                    </span>
                  )}
                </div>

                {/* Race name */}
                <h2 className="font-heading font-black text-2xl md:text-3xl text-white leading-tight mb-3">
                  {nextRace.name}
                </h2>

                {/* Track */}
                <div className="flex items-center gap-2 mb-4 text-gray-500">
                  <MapPin className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                  <span className="text-sm">{nextRace.track}</span>
                  {trackInfo?.country && <span className="text-gray-700">· {trackInfo.country}</span>}
                </div>

                {/* Date + time */}
                <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
                  <Clock className="w-3.5 h-3.5" />
                  <span>{dateStr}</span>
                  <span
                    className="font-bold text-orange-400 px-2 py-0.5 rounded text-xs"
                    style={{ background: "rgba(249,115,22,0.08)" }}
                  >
                    {timeStr}
                  </span>
                </div>

                {/* Session pills */}
                {sessions.length > 0 && (
                  <div className="flex gap-2 flex-wrap">
                    {sessions.map((s) => (
                      <span
                        key={s.key}
                        className="text-[11px] font-bold px-3 py-1 rounded-lg"
                        style={{ background: s.bg, color: s.color, border: `1px solid ${s.color}25` }}
                      >
                        {s.label} · {s.dur}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Bottom row: countdown + CTA */}
              <div className="flex items-end justify-between mt-6 pt-6 flex-wrap gap-4" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                {countdown ? (
                  <div>
                    <div className="flex items-center gap-1.5 text-[10px] text-gray-600 uppercase tracking-wide mb-1">
                      <Timer className="w-3 h-3" /> Tot start
                    </div>
                    <div className="font-heading font-black text-2xl leading-none tabular-nums" style={{ color: accentColor }}>
                      {countdown}
                    </div>
                  </div>
                ) : <div />}

                {/* Registration status + CTA */}
                <div className="flex items-center gap-3">
                  {(isRegistered || isRegisteredViaSeason) && (
                    <div className="flex items-center gap-2 text-sm font-bold text-green-400 px-3 py-1.5 rounded-lg"
                      style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.2)" }}>
                      <CheckCircle2 className="w-4 h-4" />
                      {isRegisteredViaSeason ? "Ingeschreven via seizoen" : "Ingeschreven"}
                    </div>
                  )}
                  <Link
                    to="/calendar"
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-heading font-bold text-sm transition-all"
                    style={{ background: `${accentColor}26`, border: `1px solid ${accentColor}4d`, color: accentColor }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = `${accentColor}40`; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = `${accentColor}26`; }}
                  >
                    {isRegistered || isRegisteredViaSeason ? "Bekijk kalender" : "Schrijf in"} <ChevronRight className="w-4 h-4" />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
};

export default NextRaceTeaser;
