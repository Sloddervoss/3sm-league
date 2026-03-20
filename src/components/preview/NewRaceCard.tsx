import { motion } from "framer-motion";
import { MapPin, Clock, Timer, CloudSun, Zap } from "lucide-react";
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

const STATUS = {
  upcoming:  { label: "Upcoming",  dot: "#f97316", text: "#f97316", bg: "rgba(249,115,22,0.1)",  bar: "#f97316" },
  live:      { label: "● LIVE",    dot: "#22c55e", text: "#22c55e", bg: "rgba(34,197,94,0.1)",   bar: "#22c55e" },
  completed: { label: "Afgelopen", dot: "#374151", text: "#6b7280", bg: "rgba(55,65,81,0.1)",    bar: "#1f2937" },
};

const SESSION_COLORS: Record<string, { color: string; bg: string }> = {
  P: { color: "#3b82f6", bg: "rgba(59,130,246,0.12)" },
  Q: { color: "#eab308", bg: "rgba(234,179,8,0.12)" },
  R: { color: "#f97316", bg: "rgba(249,115,22,0.12)" },
};

const NewRaceCard = ({ race, index = 0, countdown }: Props) => {
  const trackInfo = getTrackInfo(race.track);
  const st = STATUS[race.status as keyof typeof STATUS] || STATUS.upcoming;

  const raceDate = new Date(race.race_date);
  const dateStr = raceDate.toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const timeStr = raceDate.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

  const sessions = [
    race.practice_duration   && { key: "P", label: "P",  dur: race.practice_duration },
    race.qualifying_duration && { key: "Q", label: "Q",  dur: race.qualifying_duration },
    race.race_duration       && { key: "R", label: "R",  dur: race.race_duration },
  ].filter(Boolean) as { key: string; label: string; dur: string }[];

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay: Math.min(index, 6) * 0.06 }}
      whileHover={{ x: 4 }}
      className="relative flex items-stretch overflow-hidden rounded-xl"
      style={{
        background: "linear-gradient(135deg, #111118 0%, #0d0d14 100%)",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      {/* Status bar left */}
      <div
        className="w-1 shrink-0 rounded-l-xl"
        style={{ background: st.bar }}
      />

      {/* Circuit image */}
      <div
        className="w-20 h-20 shrink-0 self-center flex items-center justify-center relative overflow-hidden mx-1"
      >
        {trackInfo?.imageUrl ? (
          <img
            src={trackInfo.imageUrl}
            alt={race.track}
            className="w-16 h-16 object-contain invert"
            style={{ opacity: race.status === "completed" ? 0.12 : 0.2 }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <span className="font-heading font-black text-xs text-gray-800 text-center">
            {race.track.slice(0, 4).toUpperCase()}
          </span>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 py-4 pr-2 min-w-0">
        {/* Name + status */}
        <div className="flex items-center gap-2 mb-1">
          <h3 className="font-heading font-black text-sm text-white leading-tight truncate">{race.name}</h3>
          <span
            className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full"
            style={{ background: st.bg, color: st.text }}
          >
            {st.label}
          </span>
        </div>

        {/* Track */}
        <div className="flex items-center gap-1.5 mb-2">
          <MapPin className="w-3 h-3 text-gray-700 shrink-0" />
          <span className="text-xs text-gray-600 truncate">{race.track}</span>
          {trackInfo?.country && (
            <span className="text-xs text-gray-700 shrink-0">· {trackInfo.country}</span>
          )}
        </div>

        {/* Date + sessions */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs text-gray-600">
            <Clock className="w-3 h-3" />
            <span>{dateStr}</span>
            <span
              className="font-bold text-orange-500/80 px-1.5 py-0.5 rounded text-[11px]"
              style={{ background: "rgba(249,115,22,0.08)" }}
            >
              {timeStr}
            </span>
          </div>

          {sessions.map((s) => {
            const sc = SESSION_COLORS[s.key] || SESSION_COLORS.R;
            return (
              <span
                key={s.key}
                className="text-[10px] font-bold px-2 py-0.5 rounded-md"
                style={{ background: sc.bg, color: sc.color }}
              >
                {s.label} · {s.dur}
              </span>
            );
          })}
        </div>
      </div>

      {/* Right: countdown */}
      <div className="shrink-0 flex flex-col items-end justify-center gap-1.5 pr-4 pl-2">
        {countdown && race.status === "upcoming" ? (
          <div className="text-right">
            <div className="font-heading font-black text-lg leading-none" style={{ color: "#f97316" }}>
              {countdown}
            </div>
            <div className="flex items-center justify-end gap-1 text-[10px] text-gray-700 mt-0.5">
              <Timer className="w-3 h-3" />
              tot start
            </div>
          </div>
        ) : null}

        {race.weather && (
          <div className="flex items-center gap-1 text-[10px] text-gray-700">
            <CloudSun className="w-3 h-3" />
            {race.weather}
          </div>
        )}

        {race.leagues?.car_class && (
          <div className="flex items-center gap-1 text-[10px] text-gray-700">
            <Zap className="w-3 h-3" />
            {race.leagues.car_class}
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default NewRaceCard;
