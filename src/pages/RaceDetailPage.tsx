import Footer from "@/components/Footer";
import Navbar from "@/components/Navbar";
import StickyRaceBar from "@/components/StickyRaceBar";
import { supabase } from "@/integrations/supabase/client";
import { formatRaceGapDisplay, getRaceDetailStats, type RaceDetailStatsResult } from "@/lib/raceDetailStats";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowUp, Car, Cloud, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, Droplets, Flag, List, Share2, Sun, Thermometer, Trophy, Zap } from "lucide-react";
import { useEffect } from "react";
import { useLanguage } from "@/i18n/useLanguage";
import { Link, useParams } from "react-router-dom";

const STALE = 5 * 60 * 1000;

type RaceDetailRace = {
  id: string;
  name: string;
  track: string;
  race_date: string;
  round: number | null;
  total_laps: number | null;
  race_duration: string | null;
  weather: string | null;
  car: string | null;
  iracing_session_id: string | null;
  sof: number | null;
  cautions: number | null;
  caution_laps: number | null;
  lead_changes: number | null;
  leagues: {
    name: string;
    car_class: string | null;
  } | null;
};

type RaceResultRow = RaceDetailStatsResult & {
  id: string;
  points: number | null;
  gap_to_leader: string | null;
  country_code?: string | null;
};

type SessionResultRow = {
  id: string;
  session_type: "practice" | "qualifying";
  session_name: string | null;
  session_number: number | null;
  position: number;
  display_name: string;
  laps: number | null;
  best_lap: string | null;
  best_lap_num: number | null;
  incidents: number | null;
  car_name: string | null;
  club_name: string | null;
  country_code: string | null;
};

type PenaltyRow = {
  user_id: string;
  penalty_type: string;
  points_deduction: number;
};

const formatRaceDate = (value: string, locale: string) =>
  new Date(value).toLocaleDateString(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Amsterdam",
  });

const positionColor = (position: number | null) => {
  if (position === 1) return "text-yellow-400";
  if (position === 2) return "text-slate-300";
  if (position === 3) return "text-amber-600";
  return "text-muted-foreground";
};

const medal = (position: number | null) => {
  if (position === 1) return "🥇";
  if (position === 2) return "🥈";
  if (position === 3) return "🥉";
  return position ?? "-";
};

const normalizeCountryCodeForFlag = (code?: string | null) => {
  const normalized = code?.trim().toLowerCase();
  return normalized && /^[a-z]{2}$/.test(normalized) ? normalized : null;
};

const CountryFlag = ({ code }: { code?: string | null }) => {
  const normalized = normalizeCountryCodeForFlag(code);
  if (!normalized) return null;
  return (
    <img
      src={`https://flagcdn.com/20x15/${normalized}.png`}
      srcSet={`https://flagcdn.com/40x30/${normalized}.png 2x`}
      width="20"
      height="15"
      alt={code?.toUpperCase() ?? ""}
      title={code?.toUpperCase() ?? ""}
      className="inline-block h-[15px] w-5 rounded-[2px] object-cover ring-1 ring-white/10"
      loading="lazy"
    />
  );
};

const deltaClass = (delta: number | null) => {
  if (delta == null) return "border-muted/25 bg-muted/10 text-muted-foreground";
  if (delta > 0) return "border-green-500/25 bg-green-500/10 text-green-400";
  if (delta < 0) return "border-red-500/25 bg-red-500/10 text-red-400";
  return "border-muted/25 bg-muted/10 text-muted-foreground";
};

const carCounts = (results: RaceResultRow[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const r of results) {
    if (r.car_name) {
      const label = r.car_name.replace(/ \(992\)/g, "").replace(/ 2020/g, "");
      counts[label] = (counts[label] || 0) + 1;
    }
  }
  return counts;
};

const distinctColors = ["bg-gradient-racing", "bg-sky-500", "bg-purple-500", "bg-emerald-500", "bg-amber-500", "bg-pink-500"];
type WeatherTile = {
  key: string;
  value: string;
  label: string;
  kind: "sky" | "temperature" | "humidity" | "wind" | "default";
  windDirection?: string;
};

const WIND_DIRECTION_DEGREES: Record<string, number> = {
  N: 0,
  NO: 45,
  NE: 45,
  O: 90,
  E: 90,
  ZO: 135,
  SE: 135,
  Z: 180,
  S: 180,
  ZW: 225,
  SW: 225,
  W: 270,
  NW: 315,
};

const WIND_DIRECTION_EN: Record<string, string> = {
  N: "N",
  NO: "NE",
  O: "E",
  ZO: "SE",
  Z: "S",
  ZW: "SW",
  W: "W",
  NW: "NW",
};

const getWindDirection = (value: string) => {
  const firstToken = value.trim().split(/\s+/)[0]?.toUpperCase();
  return firstToken && WIND_DIRECTION_DEGREES[firstToken] != null ? firstToken : undefined;
};

const formatWeatherValue = (tile: WeatherTile, language: "nl" | "en") => {
  if (language === "nl") return tile.value;

  if (tile.kind === "wind" && tile.windDirection) {
    const englishDirection = WIND_DIRECTION_EN[tile.windDirection] ?? tile.windDirection;
    return tile.value.replace(new RegExp(`^${tile.windDirection}\\b`), englishDirection);
  }

  if (tile.kind === "sky") {
    const lower = tile.value.toLowerCase();
    const SKY_NL_EN: Record<string, string> = {
      "half bewolkt": "Partly cloudy",
      "licht bewolkt": "Partly cloudy",
      "zwaar bewolkt": "Overcast",
      "lichte regen": "Light rain",
      "zware regen": "Heavy rain",
      "lichte bui": "Light shower",
      "zware bui": "Heavy shower",
      helder: "Clear",
      bewolkt: "Overcast",
      regen: "Rain",
      bui: "Shower",
      mist: "Fog",
      nevel: "Haze",
      onweer: "Thunderstorm",
      sneeuw: "Snow",
    };
    for (const [nl, en] of Object.entries(SKY_NL_EN)) {
      if (lower.includes(nl)) return tile.value.replace(new RegExp(nl, "i"), en);
    }
  }

  return tile.value;
};

const parseWeatherTiles = (weather: string | null): WeatherTile[] => {
  if (!weather) return [];

  return weather
    .split(/ · /g)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part, index): WeatherTile => {
      const [rawLabel, ...rawValueParts] = part.split(":");
      const valueFromLabel = rawValueParts.join(":").trim();
      const lower = part.toLowerCase();

      if (valueFromLabel) {
        const isWind = rawLabel.trim().toLowerCase().includes("wind");
        const windDirection = isWind ? getWindDirection(valueFromLabel) : undefined;

        return {
          key: `${index}-${part}`,
          value: valueFromLabel,
          label: rawLabel.trim() || "Weer",
          kind: isWind ? "wind" : "default",
          windDirection,
        };
      }

      if (/^-?\d+(\.\d+)?\s*°c$/i.test(part)) {
        return { key: `${index}-${part}`, value: part, label: "Temperatuur", kind: "temperature" };
      }

      if (/^-?\d+(\.\d+)?\s*%$/i.test(part)) {
        return { key: `${index}-${part}`, value: part, label: "Luchtvochtigheid", kind: "humidity" };
      }

      if (lower.includes("helder") || lower.includes("clear") || lower.includes("cloud") || lower.includes("bewolkt") || lower.includes("rain") || lower.includes("regen") || lower.includes("mist") || lower.includes("fog") || lower.includes("nevel") || lower.includes("haze") || lower.includes("onweer") || lower.includes("thunder") || lower.includes("sneeuw") || lower.includes("snow")) {
        return { key: `${index}-${part}`, value: part, label: "Lucht", kind: "sky" };
      }

      return { key: `${index}-${part}`, value: part, label: "Weer", kind: "default" };
    });
};

const WeatherTileIcon = ({ tile }: { tile: WeatherTile }) => {
  const iconClass = "w-5 h-5";

  if (tile.kind === "temperature") return <Thermometer className={iconClass} />;
  if (tile.kind === "humidity") return <Droplets className={iconClass} />;
  if (tile.kind === "wind") {
    const degrees = tile.windDirection ? WIND_DIRECTION_DEGREES[tile.windDirection] : 0;
    return <ArrowUp className={iconClass} style={{ transform: `rotate(${degrees}deg)` }} />;
  }

  const lower = tile.value.toLowerCase();
  if (lower.includes("thunder") || lower.includes("onweer")) return <CloudLightning className={iconClass} />;
  if (lower.includes("snow") || lower.includes("sneeuw")) return <CloudSnow className={iconClass} />;
  if (lower.includes("fog") || lower.includes("mist") || lower.includes("haze") || lower.includes("nevel")) return <CloudFog className={iconClass} />;
  if (lower.includes("rain") || lower.includes("regen") || lower.includes("bui")) return <CloudRain className={iconClass} />;
  if (lower.includes("partly") || lower.includes("half") || lower.includes("licht bewolkt")) return <CloudSun className={iconClass} />;
  if (lower.includes("cloud") || lower.includes("bewolkt")) return <Cloud className={iconClass} />;
  if (lower.includes("clear") || lower.includes("helder")) return <Sun className={iconClass} />;

  return <CloudSun className={iconClass} />;
};

const weatherTileStyles = (kind: WeatherTile["kind"]) => {
  if (kind === "temperature") return "border-orange-400/20 bg-orange-500/5 text-orange-300 shadow-[0_0_22px_rgba(249,115,22,0.08)]";
  if (kind === "humidity") return "border-sky-400/20 bg-sky-500/5 text-sky-300 shadow-[0_0_22px_rgba(56,189,248,0.08)]";
  if (kind === "wind") return "border-cyan-400/20 bg-cyan-500/5 text-cyan-300 shadow-[0_0_22px_rgba(34,211,238,0.08)]";
  if (kind === "sky") return "border-blue-400/20 bg-blue-500/5 text-blue-300 shadow-[0_0_22px_rgba(96,165,250,0.08)]";
  return "border-border bg-secondary/40 text-muted-foreground";
};

const StatCard = ({ label, value, sub, icon }: { label: string; value: string; sub: string; icon?: string }) => (
  <div className="bg-card border border-border rounded-lg p-4 card-hover overflow-hidden">
    <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-black mb-2">
      {icon && <span className="text-sm leading-none">{icon}</span>}
      <span className="truncate">{label}</span>
    </div>
    <div className="font-heading text-xl font-black leading-none truncate" title={value}>{value}</div>
    {sub && <div className="text-xs text-muted-foreground mt-1 truncate" title={sub}>{sub}</div>}
  </div>
);

const SessionResultsCard = ({ title, rows, t }: { title: string; rows: SessionResultRow[]; t: (value: string) => string }) => {
  if (!rows.length) return null;

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-secondary/30 flex items-center justify-between gap-3">
        <h3 className="font-heading text-xl font-black">{title}</h3>
        <span className="text-xs text-muted-foreground">{rows.length} {t("coureurs")}</span>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[620px]">
          <div className="grid grid-cols-[3.5rem_1fr_5rem_7rem_4rem] gap-2 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            <span>{t("Pos")}</span><span>{t("Coureur")}</span><span className="text-center">{t("ronden")}</span><span className="text-right">{t("Beste")}</span><span className="text-center">{t("Inc")}</span>
          </div>
          {rows.map((row) => (
            <div key={row.id} className="grid grid-cols-[3.5rem_1fr_5rem_7rem_4rem] gap-2 px-4 py-2.5 border-t border-border/50 items-center text-sm hover:bg-secondary/20 transition-colors">
              <span className={`font-heading font-black ${positionColor(row.position)}`}>{row.position}</span>
              <div className="min-w-0">
                <div className="font-heading font-bold truncate flex items-center gap-2"><CountryFlag code={row.country_code} />{row.display_name}</div>
                {row.car_name && <div className="text-xs text-muted-foreground truncate">{row.car_name}</div>}
              </div>
              <span className="text-center text-muted-foreground">{row.laps ?? "-"}</span>
              <span className="text-right font-mono text-muted-foreground">{row.best_lap ?? "-"}{row.best_lap_num ? <span className="block text-[10px] font-sans text-muted-foreground/70">{t("ronde")} {row.best_lap_num}</span> : null}</span>
              <span className="text-center text-muted-foreground">{row.incidents != null ? `${row.incidents}x` : "-"}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const RaceDetailPage = () => {
  const { raceId } = useParams<{ raceId: string }>();
  const { language, t } = useLanguage();
  const dateLocale = language === "en" ? "en-GB" : "nl-NL";

  const { data: race, isLoading: raceLoading } = useQuery({
    queryKey: ["race-detail-page", raceId],
    enabled: !!raceId,
    staleTime: STALE,
    queryFn: async (): Promise<RaceDetailRace | null> => {
      const { data, error } = await supabase
        .from("races")
        .select("id, name, track, race_date, round, total_laps, race_duration, weather, car, iracing_session_id, sof, cautions, caution_laps, lead_changes, leagues(name, car_class)")
        .eq("id", raceId!)
        .eq("status", "completed")
        .maybeSingle();
      if (error) throw error;
      return data as RaceDetailRace | null;
    },
  });

  const { data: results = [], isLoading: resultsLoading } = useQuery({
    queryKey: ["race-results-detail", raceId],
    enabled: !!raceId,
    staleTime: STALE,
    queryFn: async (): Promise<RaceResultRow[]> => {
      const selectWithCountry = "id, user_id, position, start_position, points, laps, laps_led, best_lap, best_lap_num, avg_lap, fastest_lap, incidents, dnf, gap_to_leader, car_name, country_code, club_name, reason_out, profiles(display_name, iracing_name)";
      const selectLegacy = "id, user_id, position, start_position, points, laps, laps_led, best_lap, best_lap_num, avg_lap, fastest_lap, incidents, dnf, gap_to_leader, car_name, club_name, reason_out, profiles(display_name, iracing_name)";
      const firstResponse = await supabase
        .from("race_results")
        .select(selectWithCountry)
        .eq("race_id", raceId!)
        .order("position", { ascending: true });
      let resultData: unknown = firstResponse.data;
      let resultError = firstResponse.error;
      if (resultError && resultError.message.includes("country_code")) {
        const legacyResponse = await supabase
          .from("race_results")
          .select(selectLegacy)
          .eq("race_id", raceId!)
          .order("position", { ascending: true });
        resultData = legacyResponse.data;
        resultError = legacyResponse.error;
      }
      if (resultError) throw resultError;
      return (resultData || []) as RaceResultRow[];
    },
  });

  const { data: sessionResults = [] } = useQuery({
    queryKey: ["race-session-results-detail", raceId],
    enabled: !!raceId,
    staleTime: STALE,
    queryFn: async (): Promise<SessionResultRow[]> => {
      const { data, error } = await supabase
        .from("race_session_results" as never)
        .select("id, session_type, session_name, session_number, position, display_name, laps, best_lap, best_lap_num, avg_lap, incidents, car_name, club_name, country_code")
        .eq("race_id", raceId!)
        .order("session_type", { ascending: true })
        .order("position", { ascending: true });
      if (error) {
        if (error.message.includes("race_session_results")) return [];
        throw error;
      }
      return (data || []) as SessionResultRow[];
    },
  });

  const { data: penalties = [] } = useQuery({
    queryKey: ["race-penalties-detail", raceId],
    enabled: !!raceId,
    staleTime: STALE,
    queryFn: async (): Promise<PenaltyRow[]> => {
      const { data } = await supabase
        .from("penalties")
        .select("user_id, penalty_type, points_deduction")
        .eq("race_id", raceId!);
      return (data || []) as PenaltyRow[];
    },
  });

  const stats = getRaceDetailStats(results);
  const leaderLaps = stats.winner?.laps ?? stats.maxLaps;
  const loading = raceLoading || resultsLoading;
  const cars = carCounts(results);
  const carEntries = Object.entries(cars);
  const weatherTiles = parseWeatherTiles(race?.weather ?? null);
  const practiceResults = sessionResults.filter((row) => row.session_type === "practice");
  const qualifyingResults = sessionResults.filter((row) => row.session_type === "qualifying");
  const weatherSummary = weatherTiles.length
    ? weatherTiles.map((tile) => `${t(tile.label)}: ${formatWeatherValue(tile, language)}`).join(" · ")
    : race?.weather ?? null;

  useEffect(() => {
    if (!race) return;
    document.title = `${race.name} uitslag - 3 Stripe Motorsport`;
  }, [race]);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <StickyRaceBar />
      <main className="pt-[108px]">
        <section className="py-8 md:py-12 bg-gradient-to-b from-card/60 to-transparent border-b border-border">
          <div className="container mx-auto px-4">
            <div className="mb-6 flex flex-wrap items-center gap-3">
              <Link
                to={raceId ? `/results?race=${raceId}` : "/results"}
                className="inline-flex items-center gap-2 rounded-md border border-orange-500/25 bg-orange-500/10 px-3 py-2 text-xs font-heading font-bold uppercase tracking-wider text-orange-400 hover:bg-orange-500/15 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" /> {t("Terug naar archief")}
              </Link>
              <Link to="/results" className="inline-flex items-center gap-2 rounded-md border border-border bg-secondary/30 px-3 py-2 text-xs font-heading font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground hover:border-orange-500/40 transition-colors">
                {t("Alle uitslagen")}
              </Link>
            </div>

            {loading ? (
              <div className="space-y-4">
                <div className="h-12 max-w-xl rounded bg-card animate-pulse" />
                <div className="h-5 max-w-sm rounded bg-secondary animate-pulse" />
              </div>
            ) : !race ? (
              <div className="bg-card border border-border rounded-lg px-6 py-16 text-center">
                <Flag className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
                <h1 className="font-heading text-3xl font-black mb-2">{t("Race niet gevonden")}</h1>
                <p className="text-muted-foreground text-sm mb-6">{t("Deze race is niet gepubliceerd of bestaat niet.")}</p>
                <Link to="/results" className="inline-flex items-center gap-2 text-orange-500 font-heading font-bold hover:text-orange-400">
                  {t("Bekijk alle uitslagen")}
                </Link>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-3 mb-2">
                      <span className="text-xs uppercase tracking-widest px-2.5 py-0.5 rounded-full bg-orange-500/10 text-orange-400 border border-orange-500/20">{t("Race uitslag")}</span>
                      {race.leagues?.name && <span className="text-xs uppercase tracking-widest px-2.5 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border">{race.leagues.name}</span>}
                      {race.round != null && <span className="text-xs uppercase tracking-widest px-2.5 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border">{t("Ronde")} {race.round}</span>}
                    </div>
                    <h1 className="font-heading text-4xl md:text-6xl font-black tracking-tight">
                      <span className="text-gradient-racing">{race.name}</span>
                    </h1>
                    <p className="text-lg md:text-xl text-muted-foreground font-heading font-semibold mt-1">
                      {race.track} · {formatRaceDate(race.race_date, dateLocale)}
                    </p>
                  </div>
                  <div className="text-left lg:text-right text-muted-foreground">
                    <div className="font-heading text-2xl font-black">{race.iracing_session_id ? `#${race.iracing_session_id}` : race.total_laps ? `${race.total_laps} ${t("ronden")}` : "3SM"}</div>
                    <div className="text-xs uppercase tracking-[0.2em]">{race.iracing_session_id ? t("iRacing sessie") : t("Racedetail")}</div>
                  </div>
                </div>

                {stats.winner && (
                  <div className="mt-6 flex items-center gap-4 rounded-lg border border-orange-500/20 bg-gradient-to-r from-orange-500/10 via-card to-transparent p-4 border-glow">
                    <div className="w-1 h-12 rounded-full bg-gradient-racing" />
                    <div>
                      <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-black">{t("Race winnaar")}</div>
                      <div className="font-heading text-2xl font-black">{stats.winner.name}</div>
                    </div>
                    <div className="ml-auto hidden sm:flex items-center gap-4 text-sm text-muted-foreground">
                      {stats.winner.laps != null && <span><b className="text-orange-400">{stats.winner.laps}</b> {t("ronden")}</span>}
                      {stats.winner.best_lap && <><span className="opacity-30">|</span><span><b className="text-orange-400">{stats.winner.best_lap}</b> {t("beste ronde")}</span></>}
                      {stats.winner.incidents != null && <><span className="opacity-30">|</span><span><b className="text-orange-400">{stats.winner.incidents}</b>x</span></>}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        {!loading && race && (
          <section className="py-10">
            <div className="container mx-auto px-4 space-y-8">
              {/* Stats grid — styled like preview */}
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                {stats.pole && (
                  <StatCard icon="🏁" label="Pole" value={stats.pole.name} sub={stats.pole.best_lap ? `${stats.pole.best_lap}` : "—"} />
                )}
                {stats.fastest && (
                  <StatCard
                    icon="⚡"
                    label={t("Snelste ronde")}
                    value={stats.fastest.name}
                    sub={stats.fastest.best_lap ? `${stats.fastest.best_lap}${stats.fastest.best_lap_num ? ` — ${t("ronde")} ${stats.fastest.best_lap_num}` : ""}` : "—"}
                  />
                )}
                {stats.biggestMover && (
                  <StatCard
                    icon="⬆️"
                    label={t("Grootste stijger")}
                    value={`+${stats.biggestMover.positionGain}`}
                    sub={`${stats.biggestMover.name} P${stats.biggestMover.start_position} → P${stats.biggestMover.position}`}
                  />
                )}
                {stats.cleanest && (
                  <StatCard icon="🧹" label={t("Cleanste")} value={stats.cleanest.name} sub={`${stats.cleanest.incidents} ${t("incidenten")}`} />
                )}
                {stats.mostLapsLed && (
                  <StatCard
                    icon="👑"
                    label={t("Meeste ronden op kop")}
                    value={stats.mostLapsLed.name}
                    sub={`${stats.mostLapsLed.laps_led}/${race.total_laps || stats.maxLaps || "?"} ${t("ronden")}`}
                  />
                )}
                <StatCard icon="🏎️" label="Grid" value={`${results.length}`} sub={carEntries.length ? `${carEntries.length} ${carEntries.length === 1 ? t("model") : t("modellen")}` : ""} />
              </div>

              {/* Race result stays full-width on desktop; supporting detail cards sit below. */}
              <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="font-heading text-2xl font-black flex items-center gap-2"><List className="w-5 h-5 text-accent" /> {t("Race resultaat")}</h2>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="px-2 py-1 rounded bg-secondary border border-border">{results.length} {t("coureurs")}</span>
                      {race.total_laps != null && <span className="px-2 py-1 rounded bg-secondary border border-border">{race.total_laps} {t("ronden")}</span>}
                      <button
                        type="button"
                        onClick={() => navigator.clipboard?.writeText(window.location.href)}
                        className="inline-flex items-center gap-2 rounded border border-border bg-secondary/40 px-3 py-2 text-xs font-heading font-bold hover:border-orange-500/40 transition-colors"
                      >
                        <Share2 className="w-3.5 h-3.5" /> {t("Link kopiëren")}
                      </button>
                    </div>
                  </div>

                  <div className="bg-card border border-border rounded-lg overflow-hidden">
                    <div className="overflow-x-auto">
                      <div className="min-w-[1060px]">
                        <div className="grid grid-cols-[3.5rem_1fr_4rem_4rem_4rem_5rem_6rem_6rem_6rem_4rem_4rem] gap-2 px-4 py-2 bg-secondary/40 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                          <span>{t("Pos")}</span><span>{t("Coureur")}</span><span className="text-center">{t("ronden")}</span><span className="text-center">{t("Kop")}</span><span className="text-center">{t("Start")}</span><span className="text-center">+/-</span><span className="text-right">{t("Beste")}</span><span className="text-right">{t("Gem.")}</span><span className="text-right">{t("Achter")}</span><span className="text-center">{t("Inc")}</span><span className="text-center">{t("Pts")}</span>
                        </div>
                        {stats.sorted.map((driver) => {
                          const pen = penalties.find((p) => p.user_id === driver.user_id && p.penalty_type !== "warning");
                          const positionDelta = driver.start_position != null && driver.position != null ? driver.start_position - driver.position : null;
                          return (
                            <div key={driver.user_id} className={`grid grid-cols-[3.5rem_1fr_4rem_4rem_4rem_5rem_6rem_6rem_6rem_4rem_4rem] gap-2 px-4 py-3 items-center border-t border-border/50 hover:bg-secondary/20 transition-colors ${driver.position != null && driver.position <= 3 ? "racing-stripe-left" : ""}`}>
                              <span className={`font-heading font-black text-lg ${positionColor(driver.position)}`}>{driver.dnf ? "DNF" : medal(driver.position)}</span>
                              <div className="min-w-0">
                                <div className="font-heading font-black truncate flex items-center gap-2">
                                  <CountryFlag code={driver.country_code} />
                                  {driver.name}
                                  {driver.fastest_lap && <span className="text-[10px] px-1.5 py-0.5 rounded border border-purple-500/30 bg-purple-500/15 text-purple-300">FL</span>}
                                  {(driver.laps_led ?? 0) > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded border border-orange-500/30 bg-orange-500/15 text-orange-300">LED {driver.laps_led}</span>}
                                </div>
                                <div className="text-xs text-muted-foreground truncate">
                                  {[driver.car_name, driver.club_name].filter(Boolean).join(" · ")}
                                </div>
                                {driver.reason_out && <div className="text-xs text-red-300 truncate">{driver.reason_out}</div>}
                              </div>
                              <span className="text-center text-sm font-heading text-muted-foreground">{driver.laps ?? "-"}</span>
                              <span className={`text-center text-sm font-heading ${(driver.laps_led ?? 0) > 0 ? "text-yellow-400 font-black" : "text-muted-foreground"}`}>{driver.laps_led ?? "-"}</span>
                              <span className="text-center text-sm font-heading text-muted-foreground">{driver.start_position != null ? `P${driver.start_position}` : "-"}</span>
                              <span className="text-center"><span className={`inline-flex min-w-12 justify-center rounded-full border px-2 py-0.5 text-xs font-heading font-black ${deltaClass(positionDelta)}`}>{positionDelta == null ? "-" : positionDelta > 0 ? `+${positionDelta}` : String(positionDelta)}</span></span>
                              <span className="text-right text-sm font-mono text-muted-foreground">{driver.best_lap ?? "-"}{driver.best_lap_num ? <span className="block text-[10px] font-sans text-muted-foreground/70">{t("ronde")} {driver.best_lap_num}</span> : null}</span>
                              <span className="text-right text-sm font-mono text-muted-foreground">{driver.avg_lap ?? "-"}</span>
                              <span className={`text-right text-sm font-mono ${driver.dnf ? "text-red-300" : "text-muted-foreground"}`}>{formatRaceGapDisplay(driver, leaderLaps, { lap: t("ronde"), laps: t("ronden") })}</span>
                              <span className={`text-center text-sm font-heading ${driver.incidents === 0 ? "text-green-400 font-black" : (driver.incidents ?? 0) > 8 ? "text-red-400" : "text-muted-foreground"}`}>{driver.incidents != null ? `${driver.incidents}x` : "-"}</span>
                              <span className="text-center font-heading font-black">
                                {driver.points ?? "-"}
                                {pen && <span className="ml-1 text-[10px] text-orange-400" title={pen.penalty_type === "disqualification" ? "DSQ — Steward" : `-${pen.points_deduction}pt — Steward`}>⚠</span>}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
              </div>

              {/* Supporting content: session results + sidebar */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-4">
                  <SessionResultsCard title={t("Training")} rows={practiceResults} t={t} />
                  <SessionResultsCard title={t("Kwalificatie")} rows={qualifyingResults} t={t} />
                </div>

                {/* Sidebar */}
                <aside className="space-y-4">
                  <div className="bg-card border border-border rounded-lg p-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-black mb-3">{t("Deze race")}</div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-1">
                      <button
                        type="button"
                        onClick={() => navigator.clipboard?.writeText(window.location.href)}
                        className="rounded border border-border bg-secondary/40 py-2 text-xs font-heading hover:border-orange-500/40 transition-colors flex items-center justify-center gap-1"
                      >
                        <Share2 className="w-3 h-3" /> {t("Link")}
                      </button>
                      {raceId && <Link to={`/results?race=${raceId}`} className="rounded border border-border bg-secondary/40 py-2 text-xs font-heading hover:border-orange-500/40 transition-colors text-center">{t("Terug naar archief")}</Link>}
                      <Link to="/results" className="rounded border border-border bg-secondary/40 py-2 text-xs font-heading hover:border-orange-500/40 transition-colors text-center">{t("Alle uitslagen")}</Link>
                    </div>
                  </div>

                  {weatherTiles.length > 0 && (
                    <div className="bg-card border border-border rounded-lg p-4">
                      <h3 className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-black mb-3 flex items-center gap-2"><CloudSun className="w-4 h-4 text-sky-400" /> {t("Condities")}</h3>
                      <div className="grid grid-cols-2 gap-3">
                        {weatherTiles.map((tile) => (
                          <div
                            key={tile.key}
                            className={`group relative overflow-hidden rounded-xl border px-3 py-3 min-h-[5.5rem] flex items-center gap-3 transition-colors hover:border-orange-500/25 ${weatherTileStyles(tile.kind)}`}
                          >
                            <div className="absolute inset-0 bg-gradient-to-br from-white/[0.07] via-transparent to-transparent opacity-70" />
                            <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-current/15 bg-black/20 text-current">
                              <WeatherTileIcon tile={tile} />
                            </div>
                            <div className="relative min-w-0 flex-1 text-left">
                              <div className="font-heading text-lg font-black leading-tight truncate" title={formatWeatherValue(tile, language)}>
                                {formatWeatherValue(tile, language)}
                              </div>
                              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1 truncate">{t(tile.label)}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="bg-card border border-border rounded-lg p-4">
                    <h3 className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-black mb-3 flex items-center gap-2"><Flag className="w-4 h-4 text-accent" /> {t("Race overzicht")}</h3>
                    <div className="space-y-2.5 text-sm">
                      <div className="flex justify-between gap-3"><span className="text-muted-foreground">{t("Circuit")}</span><span className="font-heading font-bold text-right">{race.track}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">{t("Datum")}</span><span className="font-heading font-bold">{formatRaceDate(race.race_date, dateLocale)}</span></div>
                      {race.round != null && <div className="flex justify-between"><span className="text-muted-foreground">{t("Ronde")}</span><span className="font-heading font-bold">{race.round}</span></div>}
                      {race.total_laps != null && <div className="flex justify-between"><span className="text-muted-foreground">{t("Geplande ronden")}</span><span className="font-heading font-bold">{race.total_laps}</span></div>}
                      {race.race_duration && <div className="flex justify-between"><span className="text-muted-foreground">{t("Race duur")}</span><span className="font-heading font-bold">{race.race_duration}</span></div>}
                      {weatherSummary && <div className="flex justify-between gap-3"><span className="text-muted-foreground">{t("Weer")}</span><span className="font-heading font-bold text-right">{weatherSummary}</span></div>}
                      {race.sof != null && <div className="flex justify-between"><span className="text-muted-foreground">SOF</span><span className="font-heading font-bold">{race.sof}</span></div>}
                      {race.lead_changes != null && <div className="flex justify-between"><span className="text-muted-foreground">{t("Kopwisselingen")}</span><span className="font-heading font-bold">{race.lead_changes}</span></div>}
                      {race.cautions != null && <div className="flex justify-between"><span className="text-muted-foreground">{t("Cauties")}</span><span className="font-heading font-bold">{race.cautions}{race.caution_laps != null ? ` / ${race.caution_laps} ${t("ronden")}` : ""}</span></div>}
                      {race.car && <div className="flex justify-between gap-3"><span className="text-muted-foreground">{t("Auto")}</span><span className="font-heading font-bold text-right">{race.car}</span></div>}
                    </div>
                  </div>

                  {carEntries.length > 0 && (
                    <div className="bg-card border border-border rounded-lg p-4">
                      <h3 className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-black mb-3 flex items-center gap-2"><Car className="w-4 h-4 text-muted-foreground" /> {t("Grid auto's")}</h3>
                      <div className="space-y-3">
                        {carEntries.map(([car, count], index) => (
                          <div key={car}>
                            <div className="flex justify-between text-sm mb-1"><span className="font-heading font-bold truncate mr-2">{car}</span><span className="text-muted-foreground shrink-0">{count}</span></div>
                            <div className="h-2 rounded-full bg-secondary overflow-hidden"><div className={`h-full rounded-full ${distinctColors[index % distinctColors.length]}`} style={{ width: `${(count / results.length) * 100}%` }} /></div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="bg-card border border-border rounded-lg p-4">
                    <h3 className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-black mb-3 flex items-center gap-2"><Trophy className="w-4 h-4 text-yellow-400" /> Highlights</h3>
                    <div className="space-y-3 text-sm text-muted-foreground">
                      {stats.winner && <p><strong className="text-foreground font-heading">{stats.winner.name}</strong> {t("won de race op")} {race.track}.</p>}
                      {stats.fastest && <p><Zap className="w-3.5 h-3.5 inline mr-1 text-purple-400" /> {t("Snelste ronde")}: <strong className="text-foreground font-heading">{stats.fastest.name}</strong>{stats.fastest.best_lap ? ` — ${stats.fastest.best_lap}` : ""}.</p>}
                      {stats.cleanest && <p>{t("Cleanste rit")}: <strong className="text-foreground font-heading">{stats.cleanest.name}</strong> {t("met")} {stats.cleanest.incidents}x.</p>}
                    </div>
                  </div>
                </aside>
              </div>
            </div>
          </section>
        )}
      </main>
      <Footer />
    </div>
  );
};

export default RaceDetailPage;
