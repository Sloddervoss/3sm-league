import { motion } from "framer-motion";
import { MapPin, Clock, Timer, CloudSun, Gauge, Users, CheckCircle2, ChevronRight } from "lucide-react";
import { getTrackInfo } from "@/lib/trackData";
import { getTrackPhoto } from "@/lib/trackPhotos";

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
  leagues?: { name: string; car_class?: string; season?: string };
}

interface Props {
  race: Race;
  countdown: string | null;
  registrantCount?: number;
  isRegistered?: boolean;
  isRegisteredViaSeason?: boolean;
  onSelect?: () => void;
}

const sessions = (race: Race) => [
  race.practice_duration   && { label: "Practice",   dur: race.practice_duration,   color: "#3b82f6", bg: "rgba(59,130,246,0.15)" },
  race.qualifying_duration && { label: "Qualifying",  dur: race.qualifying_duration,  color: "#eab308", bg: "rgba(234,179,8,0.15)" },
  race.race_duration       && { label: "Race",        dur: race.race_duration,        color: "#f97316", bg: "rgba(249,115,22,0.15)" },
].filter(Boolean) as { label: string; dur: string; color: string; bg: string }[];

const SOLO_COLOR = "#818cf8";

const NewHeroRace = ({ race, countdown, registrantCount = 0, isRegistered, isRegisteredViaSeason, onSelect }: Props) => {
  const trackInfo = getTrackInfo(race.track);
  const trackPhoto = getTrackPhoto(race.track);
  const isStandalone = !race.leagues;
  const isLive = countdown === null && race.status !== "completed";
  const accentColor = isLive ? "#22c55e" : isStandalone ? SOLO_COLOR : "#f97316";
  const raceDate = new Date(race.race_date);
  const dateStr = raceDate.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Amsterdam" });
  const timeStr = raceDate.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" });
  const ses = sessions(race);

  return (
    <motion.div
      initial={{ opacity: 0, y: 32 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="relative w-full overflow-hidden rounded-2xl"
      style={{ minHeight: 340 }}
    >
      {/* Track foto achtergrond */}
      <div className="absolute inset-0" style={{ background: "#08080f" }} />
      <img
        src={trackPhoto}
        alt=""
        className="absolute inset-0 w-full h-full object-cover select-none pointer-events-none"
        style={{ opacity: 0.5, filter: "saturate(0.7) brightness(0.75)", objectPosition: "center right" }}
      />

      {/* Track map (circuit layout) rechts */}
      {trackInfo?.imageUrl && (
        <img
          src={trackInfo.imageUrl}
          alt=""
          aria-hidden
          className="absolute right-6 top-1/2 -translate-y-1/2 w-64 h-64 object-contain select-none pointer-events-none hidden md:block"
          style={{ opacity: 0.55, filter: "invert(1) brightness(3)" }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
      )}

      {/* Gradient overlay */}
      <div className="absolute inset-0" style={{ background: "linear-gradient(90deg, rgba(8,8,15,0.92) 0%, rgba(8,8,15,0.7) 50%, rgba(8,8,15,0.3) 100%)" }} />
      <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, rgba(8,8,15,0.4) 0%, transparent 60%)" }} />
      <div className="absolute inset-0" style={{ background: `linear-gradient(90deg, ${accentColor}1a 0%, transparent 45%)` }} />
      {/* Top accent bar */}
      <div
        className="absolute top-0 left-0 right-0 h-0.5"
        style={{ background: `linear-gradient(90deg, ${accentColor}, ${accentColor}40, transparent)` }}
      />
      {/* Bottom fade */}
      <div
        className="absolute bottom-0 left-0 right-0 h-24"
        style={{ background: "linear-gradient(to top, rgba(8,8,15,0.8), transparent)" }}
      />

      {/* Clickable overlay */}
      {onSelect && (
        <button onClick={onSelect} className="absolute inset-0 z-10 w-full text-left" aria-label={`Open ${race.name}`} />
      )}

      {/* Content */}
      <div className="relative z-20 p-8 md:p-10 flex flex-col h-full" style={{ minHeight: 340 }}>

        {/* Top row: label + countdown */}
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div
                className="w-2 h-2 rounded-full animate-pulse"
                style={{ background: accentColor, boxShadow: `0 0 8px ${accentColor}` }}
              />
              <span className="text-xs font-black uppercase tracking-[0.25em]" style={{ color: accentColor }}>
                {isLive ? "● Live" : "Volgende Race"}
              </span>
            </div>
            {isStandalone ? (
              <span
                className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded"
                style={{ background: "rgba(99,102,241,0.12)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.2)" }}
              >
                Losse Race
              </span>
            ) : race.leagues && (
              <span
                className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded"
                style={{ background: "rgba(249,115,22,0.08)", color: "#f97316", border: "1px solid rgba(249,115,22,0.2)" }}
              >
                {race.leagues.name}{race.leagues.season ? ` · ${race.leagues.season}` : ""}
              </span>
            )}
          </div>

          {/* Countdown of LIVE badge */}
          {isLive ? (
            <div className="text-right">
              <div
                className="font-heading font-black text-4xl md:text-5xl leading-none animate-pulse"
                style={{ color: "#22c55e", textShadow: "0 0 30px rgba(34,197,94,0.5)" }}
              >
                LIVE
              </div>
              <div className="text-[10px] text-gray-600 uppercase tracking-widest mt-1">
                Nu bezig
              </div>
            </div>
          ) : countdown ? (
            <div className="text-right">
              <div
                className="font-heading font-black text-4xl md:text-5xl tabular-nums leading-none"
                style={{ color: accentColor, textShadow: `0 0 30px ${accentColor}66` }}
              >
                {countdown}
              </div>
              <div className="text-[10px] text-gray-600 uppercase tracking-widest mt-1 flex items-center justify-end gap-1">
                <Timer className="w-3 h-3" />
                tot start
              </div>
            </div>
          ) : null}
        </div>

        {/* Race name */}
        <div className="flex-1">
          <h2
            className="font-heading font-black leading-none mb-2"
            style={{
              fontSize: "clamp(2rem, 5vw, 3.5rem)",
              color: "#f1f1f1",
              textShadow: "0 2px 20px rgba(0,0,0,0.5)",
            }}
          >
            {race.name}
          </h2>

          {/* Track + country */}
          <div className="flex items-center gap-2 mb-6 text-gray-400">
            <MapPin className="w-4 h-4 text-orange-500 shrink-0" />
            <span className="font-medium">{race.track}</span>
            {trackInfo?.country && (
              <>
                <span className="text-gray-700">·</span>
                <span className="text-gray-600">{trackInfo.country}</span>
              </>
            )}
          </div>

          {/* Info row */}
          <div className="flex flex-wrap items-center gap-4 mb-6">
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <Clock className="w-4 h-4 text-gray-600" />
              <span>{dateStr}</span>
              <span
                className="font-bold px-2 py-0.5 rounded-md text-orange-400"
                style={{ background: "rgba(249,115,22,0.1)", border: "1px solid rgba(249,115,22,0.2)" }}
              >
                {timeStr}
              </span>
            </div>

            {race.weather && (
              <div className="flex items-center gap-1.5 text-sm text-gray-500">
                <CloudSun className="w-4 h-4" />
                <span>{race.weather}</span>
              </div>
            )}

            {race.setup && (
              <div className="flex items-center gap-1.5 text-sm text-gray-500">
                <Gauge className="w-4 h-4" />
                <span>{race.setup}</span>
              </div>
            )}

            {registrantCount > 0 && (
              <div className="flex items-center gap-1.5 text-sm text-gray-500">
                <Users className="w-4 h-4" />
                <span>{registrantCount} ingeschreven</span>
              </div>
            )}
          </div>

          {/* Session pills */}
          {ses.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap mb-4">
              {ses.map((s) => (
                <span
                  key={s.label}
                  className="text-xs font-bold px-3 py-1.5 rounded-lg"
                  style={{ background: s.bg, color: s.color, border: `1px solid ${s.color}30` }}
                >
                  {s.label} · {s.dur}
                </span>
              ))}
            </div>
          )}

          {/* Registration status + open hint */}
          <div className="flex items-center gap-3 flex-wrap">
            {(isRegistered || isRegisteredViaSeason) && (
              <div
                className="flex items-center gap-2 text-sm font-bold px-3 py-1.5 rounded-lg"
                style={{ background: "rgba(34,197,94,0.12)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.2)" }}
              >
                <CheckCircle2 className="w-4 h-4" />
                {isRegisteredViaSeason ? "Ingeschreven via seizoen" : "Ingeschreven"}
              </div>
            )}
            {onSelect && (
              <button
                onClick={onSelect}
                className="relative z-30 flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg transition-all"
                style={{ background: "rgba(255,255,255,0.06)", color: "#6b7280", border: "1px solid rgba(255,255,255,0.08)" }}
              >
                Details & inschrijven
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

      </div>
    </motion.div>
  );
};

export default NewHeroRace;
