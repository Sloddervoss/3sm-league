import { motion } from "framer-motion";
import { MapPin, Clock, CloudSun, Timer, Zap } from "lucide-react";
import { getTrackInfo } from "@/lib/trackData";

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
  index?: number;
  countdown?: string | null;
}

const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
  upcoming:  { label: "Upcoming",  color: "#f97316", bg: "rgba(249,115,22,0.12)" },
  live:      { label: "🔴 LIVE",   color: "#22c55e", bg: "rgba(34,197,94,0.12)" },
  completed: { label: "Afgelopen", color: "#6b7280", bg: "rgba(107,114,128,0.12)" },
};

const NewRaceCard = ({ race, index = 0, countdown }: Props) => {
  const trackInfo = getTrackInfo(race.track);
  const status = statusConfig[race.status] || statusConfig.upcoming;

  const raceDate = new Date(race.race_date);
  const dateStr = raceDate.toLocaleDateString("nl-NL", {
    weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
  const timeStr = raceDate.toLocaleTimeString("nl-NL", {
    hour: "2-digit", minute: "2-digit", timeZone: "UTC",
  });

  const sessions = [
    race.practice_duration  && { label: "P",  duration: race.practice_duration,  color: "#3b82f6" },
    race.qualifying_duration && { label: "Q",  duration: race.qualifying_duration, color: "#eab308" },
    race.race_duration      && { label: "R",  duration: race.race_duration,       color: "#f97316" },
  ].filter(Boolean) as { label: string; duration: string; color: string }[];

  return (
    <motion.div
      initial={{ opacity: 0, x: -16 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true }}
      transition={{ delay: Math.min(index, 5) * 0.06 }}
      whileHover={{ x: 4 }}
      className="relative rounded-xl overflow-hidden flex gap-0"
      style={{
        background: "linear-gradient(135deg, #13131a 0%, #0e0e14 100%)",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      {/* Status bar left */}
      <div
        className="w-1 shrink-0 self-stretch rounded-l-xl"
        style={{ background: status.color }}
      />

      {/* Circuit image column */}
      <div
        className="w-20 shrink-0 flex items-center justify-center relative overflow-hidden"
        style={{ background: "rgba(255,255,255,0.02)" }}
      >
        {trackInfo?.imageUrl ? (
          <img
            src={trackInfo.imageUrl}
            alt={race.track}
            className="w-16 h-16 object-contain invert opacity-25"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <div className="font-heading font-black text-xs text-gray-700 text-center px-1">{race.track.slice(0, 3).toUpperCase()}</div>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 p-4 min-w-0">
        <div className="flex items-start justify-between gap-2 mb-1">
          <h3 className="font-heading font-black text-sm text-white leading-tight truncate">{race.name}</h3>

          {/* Status badge */}
          <span
            className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full"
            style={{ background: status.bg, color: status.color }}
          >
            {status.label}
          </span>
        </div>

        {/* Track + country */}
        <div className="flex items-center gap-1.5 mb-2">
          <MapPin className="w-3 h-3 text-gray-600 shrink-0" />
          <span className="text-xs text-gray-500 truncate">{race.track}</span>
          {trackInfo?.country && (
            <span className="text-xs text-gray-700">· {trackInfo.country}</span>
          )}
        </div>

        {/* Date + time */}
        <div className="flex items-center gap-3 text-xs text-gray-500 mb-2">
          <div className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            <span>{dateStr} · {timeStr}</span>
          </div>
        </div>

        {/* Session pills */}
        {sessions.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {sessions.map((s) => (
              <span
                key={s.label}
                className="text-[10px] font-bold px-2 py-0.5 rounded"
                style={{ background: `${s.color}18`, color: s.color }}
              >
                {s.label} · {s.duration}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Right column: countdown / extra info */}
      <div className="shrink-0 pr-4 flex flex-col items-end justify-center gap-1">
        {countdown && race.status === "upcoming" ? (
          <div className="text-right">
            <div className="flex items-center gap-1 text-orange-500">
              <Timer className="w-3 h-3" />
              <span className="font-heading font-black text-sm">{countdown}</span>
            </div>
            <div className="text-[10px] text-gray-600">tot start</div>
          </div>
        ) : null}

        {race.weather && (
          <div className="flex items-center gap-1 text-[10px] text-gray-600">
            <CloudSun className="w-3 h-3" />
            <span>{race.weather}</span>
          </div>
        )}

        {race.leagues?.car_class && (
          <div className="flex items-center gap-1 text-[10px] text-gray-600">
            <Zap className="w-3 h-3" />
            <span>{race.leagues.car_class}</span>
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default NewRaceCard;
