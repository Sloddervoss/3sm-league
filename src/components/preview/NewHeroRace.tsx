import { motion } from "framer-motion";
import { MapPin, Clock, Timer, CloudSun, Gauge, Users } from "lucide-react";
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
  leagues?: { name: string; car_class?: string };
}

interface Props {
  race: Race;
  countdown: string | null;
  registrantCount?: number;
}

const sessions = (race: Race) => [
  race.practice_duration   && { label: "Practice",   dur: race.practice_duration,   color: "#3b82f6", bg: "rgba(59,130,246,0.15)" },
  race.qualifying_duration && { label: "Qualifying",  dur: race.qualifying_duration,  color: "#eab308", bg: "rgba(234,179,8,0.15)" },
  race.race_duration       && { label: "Race",        dur: race.race_duration,        color: "#f97316", bg: "rgba(249,115,22,0.15)" },
].filter(Boolean) as { label: string; dur: string; color: string; bg: string }[];

const NewHeroRace = ({ race, countdown, registrantCount = 0 }: Props) => {
  const trackInfo = getTrackInfo(race.track);
  const trackPhoto = getTrackPhoto(race.track);
  const raceDate = new Date(race.race_date);
  const dateStr = raceDate.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  const timeStr = raceDate.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  const ses = sessions(race);

  return (
    <motion.div
      initial={{ opacity: 0, y: 32 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="relative w-full overflow-hidden rounded-2xl"
      style={{ minHeight: 340 }}
    >
      {/* Donkere base achtergrond */}
      <div className="absolute inset-0" style={{ background: "#0a0a12" }} />

      {/* Track photo — hoog in de stack, vóór de overlay */}
      {trackPhoto && (
        <img
          src={trackPhoto}
          alt=""
          className="absolute inset-0 w-full h-full object-cover select-none pointer-events-none"
          style={{ opacity: 0.35, filter: "saturate(0.5) brightness(0.7)" }}
        />
      )}

      {/* Gradient overlay bovenop de foto */}
      <div
        className="absolute inset-0"
        style={{
          background: "linear-gradient(135deg, rgba(8,8,15,0.75) 0%, rgba(8,8,15,0.4) 50%, rgba(8,8,15,0.65) 100%)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background: "linear-gradient(90deg, rgba(249,115,22,0.12) 0%, transparent 60%)",
        }}
      />
      {/* Top orange accent bar */}
      <div
        className="absolute top-0 left-0 right-0 h-0.5"
        style={{ background: "linear-gradient(90deg, #f97316, #f9731640, transparent)" }}
      />
      {/* Bottom fade */}
      <div
        className="absolute bottom-0 left-0 right-0 h-24"
        style={{ background: "linear-gradient(to top, rgba(8,8,15,0.8), transparent)" }}
      />

      {/* Content */}
      <div className="relative z-10 p-8 md:p-10 flex flex-col h-full" style={{ minHeight: 340 }}>

        {/* Top row: label + countdown */}
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-center gap-2">
            <div
              className="w-2 h-2 rounded-full bg-orange-500 animate-pulse"
              style={{ boxShadow: "0 0 8px #f97316" }}
            />
            <span className="text-xs font-black text-orange-500 uppercase tracking-[0.25em]">
              Volgende Race
            </span>
          </div>

          {/* Countdown */}
          {countdown && (
            <div className="text-right">
              <div
                className="font-heading font-black text-4xl md:text-5xl tabular-nums leading-none"
                style={{
                  color: "#f97316",
                  textShadow: "0 0 30px rgba(249,115,22,0.4)",
                }}
              >
                {countdown}
              </div>
              <div className="text-[10px] text-gray-600 uppercase tracking-widest mt-1 flex items-center justify-end gap-1">
                <Timer className="w-3 h-3" />
                tot start
              </div>
            </div>
          )}
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
            <div className="flex items-center gap-2 flex-wrap">
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
        </div>

        {/* League name bottom-right */}
        {race.leagues && (
          <div className="flex justify-end mt-6">
            <span className="text-xs text-gray-700 font-medium">
              {race.leagues.name}
              {race.leagues.car_class && ` · ${race.leagues.car_class}`}
            </span>
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default NewHeroRace;
