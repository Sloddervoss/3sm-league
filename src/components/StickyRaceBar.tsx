/**
 * StickyRaceBar — compacte sticky balk onder de navbar met de volgende race.
 */
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Timer, ChevronRight, CheckCircle2, MapPin } from "lucide-react";
import { useRegistration } from "@/lib/useRegistration";
import { useNow, formatCountdown } from "@/lib/useCountdown";

const SOLO_COLOR = "#818cf8";

const StickyRaceBar = () => {
  const now = useNow();
  const reg = useRegistration();

  const { data: races = [] } = useQuery({
    queryKey: ["races-with-leagues"],
    queryFn: async () => {
      const { data } = await supabase
        .from("races")
        .select("*, leagues(name, car_class, id, season)")
        .order("race_date", { ascending: true });
      return data || [];
    },
  });

  const nextRace = [...races]
    .filter((r: any) => r.status !== "completed" && new Date(r.race_date) > now)
    .sort((a: any, b: any) => new Date(a.race_date).getTime() - new Date(b.race_date).getTime())[0] as any;

  if (!nextRace) return null;

  const isStandalone = !nextRace.leagues;
  const accentColor = isStandalone ? SOLO_COLOR : "#f97316";
  const leagueId = nextRace.leagues?.id;
  const isRegistered = reg.isRegisteredForRace(nextRace.id, leagueId);
  const isRegisteredViaSeason = reg.isRegisteredViaSeason(leagueId);
  const countdown = formatCountdown(nextRace.race_date, now);

  const dateStr = new Date(nextRace.race_date).toLocaleDateString("nl-NL", {
    weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Amsterdam",
  });
  const timeStr = new Date(nextRace.race_date).toLocaleTimeString("nl-NL", {
    hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam",
  });

  return (
    <div
      className="fixed top-16 left-0 right-0 z-30 w-full"
      style={{
        background: "rgba(10,10,18,0.92)",
        borderBottom: `1px solid ${accentColor}33`,
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
    >
      {/* Accent line top */}
      <div className="absolute top-0 left-0 right-0 h-px" style={{ background: `linear-gradient(90deg, ${accentColor}, ${accentColor}40, transparent)` }} />

      <div className="container mx-auto px-4 max-w-7xl">
        <div className="flex items-center gap-4 py-2.5 min-w-0">

          {/* Label */}
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: accentColor }} />
            <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: accentColor }}>
              Next
            </span>
          </div>

          {/* Type badge */}
          {isStandalone ? (
            <span
              className="shrink-0 text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded"
              style={{ background: "rgba(99,102,241,0.12)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.2)" }}
            >
              Losse Race
            </span>
          ) : nextRace.leagues?.name && (
            <span
              className="shrink-0 text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded"
              style={{ background: "rgba(249,115,22,0.08)", color: "#f97316", border: "1px solid rgba(249,115,22,0.2)" }}
            >
              {nextRace.leagues.name}{nextRace.leagues.season ? ` · ${nextRace.leagues.season}` : ""}
            </span>
          )}

          {/* Race name */}
          <span className="font-heading font-black text-sm text-white truncate">
            {nextRace.name}
          </span>

          {/* Track */}
          <div className="hidden md:flex items-center gap-1 text-xs text-gray-600 truncate shrink-0">
            <MapPin className="w-3 h-3 shrink-0" />
            <span className="truncate">{nextRace.track}</span>
          </div>

          {/* Date + time */}
          <span className="hidden sm:block text-xs text-gray-600 shrink-0">
            {dateStr} · <span className="font-bold" style={{ color: accentColor }}>{timeStr}</span>
          </span>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Countdown */}
          {countdown && (
            <div className="hidden sm:flex items-center gap-1.5 shrink-0">
              <Timer className="w-3 h-3 text-gray-600" />
              <span className="font-heading font-black text-sm tabular-nums" style={{ color: accentColor }}>
                {countdown}
              </span>
            </div>
          )}

          {/* Registration status */}
          {(isRegistered || isRegisteredViaSeason) && (
            <div className="hidden sm:flex items-center gap-1 text-[10px] font-bold text-green-400 shrink-0">
              <CheckCircle2 className="w-3 h-3" />
              {isRegisteredViaSeason ? "Via seizoen" : "Ingeschreven"}
            </div>
          )}

          {/* CTA */}
          <Link
            to="/calendar"
            className="shrink-0 flex items-center gap-1 text-[11px] font-bold px-3 py-1.5 rounded-lg transition-all"
            style={{ background: `${accentColor}1f`, color: accentColor, border: `1px solid ${accentColor}33` }}
          >
            {isRegistered || isRegisteredViaSeason ? "Kalender" : "Schrijf in"}
            <ChevronRight className="w-3 h-3" />
          </Link>
        </div>
      </div>
    </div>
  );
};

export default StickyRaceBar;
