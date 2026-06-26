import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Calendar, CheckCircle2, ChevronRight, Clock, Flag, MapPin, Newspaper, Timer, Trophy, UserPlus, Zap } from "lucide-react";
import Navbar from "@/components/Navbar";
import StickyRaceBar from "@/components/StickyRaceBar";
import HomeNewsSection from "@/components/HomeNewsSection";
import Footer from "@/components/Footer";
import { supabase } from "@/integrations/supabase/client";
import heroBg from "@/assets/hero-bg.webp";
import heroBgDesktop from "@/assets/hero-bg-desktop.webp";
import heroBgMobile from "@/assets/hero-bg-mobile.webp";
import { getTrackInfo } from "@/lib/trackData";
import { getTrackPhoto } from "@/lib/trackPhotos";
import { formatCountdown, useNow } from "@/lib/useCountdown";
import { useRegistration } from "@/lib/useRegistration";
import { useTeams } from "@/hooks/data/useSharedQueries";
import type { RaceWithLeagueSummary } from "@/lib/raceTypes";
import type { StandingsProfile, StandingsRaceResult, StandingRow } from "@/lib/standingsTypes";

type ResultRow = {
  id: string;
  race_id: string;
  user_id: string;
  position: number | null;
  points: number | null;
  dnf: boolean | null;
  fastest_lap: boolean | null;
  best_lap: string | null;
  incidents: number | null;
  gap_to_leader: string | null;
  profiles: { display_name: string | null; iracing_name: string | null } | null;
};

type RecapRace = {
  id: string;
  name: string;
  track: string;
  race_date: string;
  leagues: { name: string } | null;
};

const sectionShell = "relative overflow-hidden rounded-[1.65rem] bg-card/58 shadow-2xl shadow-black/18 ring-1 ring-white/[0.055]";
const orangeGlow = "before:absolute before:inset-0 before:pointer-events-none before:bg-[radial-gradient(ellipse_at_18%_0%,rgba(249,115,22,0.06),transparent_48%)]";
const smallKicker = "flex items-center gap-2 text-xs font-black uppercase tracking-[0.24em] text-orange-500";
const container = "container mx-auto px-4 max-w-7xl";
const podiumColors = ["#facc15", "#94a3b8", "#d97706"];

const driverName = (row: ResultRow) => row.profiles?.display_name || row.profiles?.iracing_name || "Onbekend";

const HomeHeroRefresh = () => (
  <section className="relative isolate overflow-hidden bg-background">
    <div className="absolute inset-0 -z-10">
      <picture className="absolute inset-0 block h-full w-full">
        <source srcSet={heroBgMobile} media="(max-width: 640px)" />
        <source srcSet={heroBgDesktop} media="(max-width: 1400px)" />
        <img src={heroBg} alt="" className="h-full w-full object-cover opacity-95 saturate-110 brightness-110 contrast-105" width="1920" height="1080" />
      </picture>
      <div className="absolute inset-0 bg-gradient-to-r from-background via-background/70 to-background/12" />
      <div className="absolute inset-0 bg-gradient-to-t from-background via-background/10 to-background/5" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_78%_24%,rgba(249,115,22,0.14),transparent_32%)]" />
    </div>
    <div className={`${container} grid min-h-[500px] items-center gap-10 py-12 md:py-16 lg:grid-cols-[1fr_minmax(20rem,25rem)]`}>
      <div>
        <div className={smallKicker}><span className="h-0.5 w-10 rounded-full bg-orange-500" /> IRACING LEAGUE</div>
        <h1 className="mt-6 font-heading text-5xl font-black uppercase leading-[0.86] tracking-[-0.06em] text-white md:text-7xl">
          3 Stripe<br /><span className="text-orange-500">Motorsport</span>
        </h1>
        <p className="mt-7 max-w-2xl text-base leading-relaxed text-gray-300 md:text-lg">
          3 Stripe Motorsport is een Nederlandse iRacing league en sim racing community voor coureurs die clean, fair en met plezier willen racen.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link to="/calendar" className="inline-flex h-12 items-center gap-2 rounded-xl bg-gradient-racing px-5 font-heading text-sm font-black uppercase tracking-wider text-white shadow-lg shadow-orange-950/25 transition hover:opacity-90">
            <Calendar className="h-4 w-4" /> Kalender <ChevronRight className="h-4 w-4" />
          </Link>
          <Link to="/standings" className="inline-flex h-12 items-center gap-2 rounded-xl border border-white/20 bg-card/75 px-5 font-heading text-sm font-black uppercase tracking-wider text-white transition hover:border-orange-500/50 hover:text-orange-300">
            <Trophy className="h-4 w-4" /> Bekijk stand
          </Link>
        </div>
      </div>

      <Link to="/meedoen" className="group justify-self-start lg:justify-self-end lg:-translate-x-6">
        <div className="relative max-w-[440px] overflow-hidden rounded-[1.65rem] bg-card/36 p-6 shadow-2xl shadow-black/12 ring-1 ring-white/[0.06] backdrop-blur-sm transition duration-300 group-hover:-translate-y-0.5 group-hover:ring-orange-500/18">
          <div className="pointer-events-none absolute -right-16 -top-20 h-40 w-40 rounded-full bg-orange-500/[0.045] blur-3xl" />
          <div className="relative flex items-center gap-5">
            <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-orange-500/18 bg-orange-500/10 text-orange-300 shadow-lg shadow-black/10">
              <UserPlus className="h-7 w-7" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-orange-400">Meedoen</p>
              <h2 className="mt-1 font-heading text-2xl font-black leading-tight text-white">Meedoen met onze iRacing community</h2>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">Bekijk hoe je aansluit bij de iRacing community van 3SM.</p>
            </div>
            <ArrowRight className="ml-auto h-6 w-6 shrink-0 text-white/70 transition group-hover:translate-x-1 group-hover:text-orange-300" />
          </div>
        </div>
      </Link>
    </div>
  </section>
);

const NextRaceRefresh = () => {
  const now = useNow();
  const reg = useRegistration();
  const { data: races = [] } = useQuery({
    queryKey: ["races-with-leagues"],
    queryFn: async (): Promise<RaceWithLeagueSummary[]> => {
      const { data } = await supabase.from("races").select("*, leagues(name, car_class, id, season)").order("race_date", { ascending: true });
      return (data || []) as RaceWithLeagueSummary[];
    },
  });

  const nextRace = [...races].filter((race) => race.status !== "completed" && new Date(race.race_date) > now).sort((a, b) => new Date(a.race_date).getTime() - new Date(b.race_date).getTime())[0];
  if (!nextRace) return null;

  const trackInfo = getTrackInfo(nextRace.track);
  const trackPhoto = getTrackPhoto(nextRace.track);
  const countdown = formatCountdown(nextRace.race_date, now);
  const dateStr = new Date(nextRace.race_date).toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Amsterdam" });
  const timeStr = new Date(nextRace.race_date).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" });
  const isRegistered = reg.isRegisteredForRace(nextRace.id, nextRace.leagues?.id);
  const isRegisteredViaSeason = reg.isRegisteredViaSeason(nextRace.leagues?.id);
  const sessions = [
    nextRace.practice_duration && ["Practice", nextRace.practice_duration, "#3b82f6"],
    nextRace.qualifying_duration && ["Qualifying", nextRace.qualifying_duration, "#eab308"],
    nextRace.race_duration && ["Race", nextRace.race_duration, "#f97316"],
  ].filter(Boolean) as string[][];

  return (
    <section className="bg-background py-12 md:py-16">
      <div className={container}>
        <div className="mb-7 flex items-end justify-between gap-4">
          <div>
            <div className={smallKicker}><Calendar className="h-4 w-4" /> Volgende race</div>
            <h2 className="mt-2 font-heading text-3xl font-black uppercase leading-none text-white md:text-4xl">Race center</h2>
          </div>
          <Link to="/calendar" className="hidden items-center gap-1 text-xs font-bold text-gray-400 transition hover:text-orange-400 sm:flex">Bekijk kalender <ChevronRight className="h-3 w-3" /></Link>
        </div>

        <div className={`${sectionShell} ${orangeGlow} ring-orange-500/[0.075] shadow-orange-950/12`}>
          <div className="pointer-events-none absolute -top-28 left-1/2 h-80 w-[115%] -translate-x-1/2 rounded-full bg-orange-500/[0.045] blur-[72px]" />
          <div className="relative grid lg:grid-cols-[0.9fr_1.15fr_0.55fr]">
            <div className="relative min-h-[260px] overflow-hidden lg:min-h-full [clip-path:inset(0)]">
              <img src={trackPhoto} alt={nextRace.track} className="absolute inset-0 h-full w-full object-cover object-[30%_50%] opacity-100 saturate-[95%] brightness-[1.35] contrast-130 scale-[1.04]" loading="lazy" />
              <div className="absolute inset-0 bg-gradient-to-b from-background/45 via-transparent to-card/10" />
              <div className="absolute inset-0 bg-gradient-to-t from-card via-card/72 to-card/24 lg:bg-gradient-to-r lg:from-card/20 lg:via-card/8 lg:to-card/28" />
              <div className="absolute -left-4 -top-4 h-48 w-72 bg-gradient-to-br from-background/85 via-background/35 to-transparent" />
              <div className="absolute bottom-3 left-4 right-4">
                <div className="text-[10px] font-medium tracking-wide text-white/[0.08]">{nextRace.track}</div>
              </div>
            </div>

            <div className="relative p-6 md:p-8">
              <div className="mb-4 flex flex-wrap gap-2">
                <span className="rounded-full border border-orange-500/25 bg-orange-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-orange-400">Binnenkort</span>
                {nextRace.leagues?.name && <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-gray-300">{nextRace.leagues.name}</span>}
              </div>
              <h3 className="font-heading text-4xl font-black leading-none text-white">{nextRace.name}</h3>
              <div className="mt-4 grid gap-2 text-sm text-gray-400">
                <div className="flex items-center gap-2 text-gray-200"><MapPin className="h-4 w-4 text-orange-400" /> {nextRace.track}{trackInfo?.country ? ` • ${trackInfo.country}` : ""}</div>
                <div className="flex items-center gap-2 text-gray-200"><Clock className="h-4 w-4 text-orange-400" /> {dateStr} <span className="rounded bg-orange-500/10 px-2 py-0.5 font-bold text-orange-300">{timeStr}</span></div>
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                {sessions.map(([label, dur, color], idx) => (
                  <span key={label} className="rounded-xl border px-3 py-1.5 text-xs font-bold" style={{ borderColor: `${color}40`, background: `${color}18`, color: idx === 2 ? '#f97316' : '#cbd5e1' }}>{label} • {dur}</span>
                ))}
              </div>
              <div className="mt-7 flex flex-wrap items-end justify-between gap-4 border-t border-white/10 pt-6">
                <div>
                  <div className="mb-1 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-gray-200"><Timer className="h-3 w-3 text-orange-400" /> Tot start</div>
                  <div className="rounded-2xl border border-orange-500/25 bg-orange-500/[0.08] px-4 py-2 font-heading text-3xl font-black tabular-nums text-orange-400 shadow-[0_0_30px_rgba(249,115,22,0.16)]">{countdown}</div>
                </div>
                <div className="flex items-center gap-3">
                  {(isRegistered || isRegisteredViaSeason) && (
                    <div className="flex items-center gap-2 rounded-xl border border-green-400/25 bg-green-500/10 px-4 py-2.5 text-sm font-bold text-green-400">
                      <CheckCircle2 className="h-4 w-4" />
                      {isRegisteredViaSeason ? "Ingeschreven via seizoen" : "Ingeschreven"}
                    </div>
                  )}
                  <Link to="/calendar" className="inline-flex h-11 items-center gap-2 rounded-xl bg-orange-500 px-4 font-heading text-sm font-black text-white shadow-lg shadow-orange-500/25 ring-1 ring-orange-300/20 transition hover:bg-orange-400 hover:shadow-orange-500/35">
                    {isRegistered || isRegisteredViaSeason ? "Bekijk kalender" : "Schrijf in"} <ChevronRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>
            </div>

            <div className="relative hidden self-center place-items-center overflow-hidden p-8 lg:grid">
              <div className="absolute left-0 top-0 h-full w-px bg-gradient-to-b from-transparent via-white/[0.07] to-transparent" />
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_30%_50%,rgba(249,115,22,0.04),transparent_60%)]" />
              {trackInfo?.imageUrl ? <img src={trackInfo.imageUrl} alt="" className="max-h-60 max-w-full object-contain opacity-75 invert" /> : <Flag className="h-28 w-28 text-white/10" />}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

const RaceRecapRefresh = () => {
  const { data: lastRace } = useQuery({
    queryKey: ["latest-completed-race"],
    queryFn: async (): Promise<RecapRace | null> => {
      const { data, error } = await supabase.from("races").select("*, leagues(name)").eq("status", "completed").order("race_date", { ascending: false }).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (error) return null;
      return data as RecapRace | null;
    },
  });
  const { data: results = [] } = useQuery({
    queryKey: ["latest-race-results", lastRace?.id],
    enabled: !!lastRace?.id,
    queryFn: async (): Promise<ResultRow[]> => {
      const { data, error } = await supabase.from("race_results").select("*, profiles(display_name, iracing_name)").eq("race_id", lastRace!.id).order("position", { ascending: true });
      if (error) throw error;
      return (data || []) as ResultRow[];
    },
  });
  if (!lastRace || !results.length) return null;

  const finishers = results.filter((r) => !r.dnf);
  const podium = finishers.slice(0, 3);
  const fastest = results.find((r) => r.fastest_lap);
  const cleanest = finishers.filter((r) => r.incidents != null).sort((a, b) => (a.incidents ?? 99) - (b.incidents ?? 99) || (a.position ?? 99) - (b.position ?? 99))[0];
  const totalInc = results.reduce((sum, r) => sum + (r.incidents ?? 0), 0);
  const dnfCount = results.filter((r) => r.dnf).length;
  const dateStr = new Date(lastRace.race_date).toLocaleDateString("nl-NL", { day: "numeric", month: "long", timeZone: "Europe/Amsterdam" });

  return (
    <section className="bg-background py-10 md:py-12">
      <div className={container}>
        <div className="mb-7 flex items-end justify-between gap-4">
          <div><div className={smallKicker}><Flag className="h-4 w-4" /> Laatste race</div><h2 className="mt-2 font-heading text-3xl font-black uppercase leading-none text-white md:text-4xl">Race recap</h2></div>
          <Link to="/results" className="hidden items-center gap-1 text-xs font-bold text-gray-400 transition hover:text-orange-400 sm:flex">Alle uitslagen <ChevronRight className="h-3 w-3" /></Link>
        </div>
        <div className={`${sectionShell} ${orangeGlow} ring-orange-500/[0.08] shadow-orange-950/10`}>
          <div className="h-px bg-gradient-to-r from-transparent via-orange-500/35 to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-orange-500/[0.055] to-transparent" />
          <div className="relative border-b border-white/[0.06] px-6 py-4 md:flex md:items-center md:justify-between">
            <div className="flex flex-wrap items-center gap-3"><h3 className="font-heading text-xl font-black text-white">{lastRace.name}</h3>{lastRace.leagues?.name && <span className="rounded-full border border-orange-500/25 bg-orange-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-orange-400">{lastRace.leagues.name}</span>}</div>
            <div className="mt-2 text-sm text-gray-300 md:mt-0">{lastRace.track} • {dateStr}</div>
          </div>
          <div className="relative grid divide-y divide-white/[0.06] lg:grid-cols-2 lg:divide-x lg:divide-y-0">
            <div className="p-6"><div className="mb-4 text-[10px] font-black uppercase tracking-[0.2em] text-gray-300">Podium</div><div className="space-y-3">{podium.map((row, index) => <div key={row.user_id} className="flex items-center gap-4 rounded-2xl border px-4 py-3 shadow-lg shadow-black/10" style={{ borderColor: `${podiumColors[index]}26`, background: `linear-gradient(135deg, ${podiumColors[index]}14, rgba(255,255,255,0.035))` }}><div className="grid h-10 w-10 place-items-center rounded-xl font-heading font-black shadow-inner" style={{ color: podiumColors[index], background: `${podiumColors[index]}20` }}>{index + 1}</div><div className="min-w-0 flex-1"><div className="truncate font-heading font-bold text-white">{driverName(row)}</div>{index > 0 && row.gap_to_leader && <div className="text-xs text-gray-300">+{row.gap_to_leader}</div>}</div><div className="text-right font-heading text-2xl font-black text-white">{row.points}<span className="ml-1 text-xs text-gray-300">PTS</span></div></div>)}</div></div>
            <div className="p-6"><div className="mb-4 text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Highlights</div><div className="grid gap-3 sm:grid-cols-2">{fastest && <div className="min-h-[116px] rounded-2xl border border-purple-400/20 bg-purple-400/10 p-4"><div className="text-[10px] font-black uppercase tracking-[0.16em] text-purple-300">⚡ Snelste ronde</div><b className="mt-2 block text-white">{driverName(fastest)}</b><span className="font-mono text-sm text-purple-200">{fastest.best_lap}</span></div>}{cleanest && <div className="min-h-[116px] rounded-2xl border border-green-400/20 bg-green-400/10 p-4"><div className="text-[10px] font-black uppercase tracking-[0.16em] text-green-300">✓ Clean drive</div><b className="mt-2 block text-white">{driverName(cleanest)}</b><span className="text-sm text-green-200">{cleanest.incidents} inc</span></div>}<div className="grid grid-cols-3 gap-3 sm:col-span-2">{[[finishers.length,"Finishers"],[dnfCount,"DNF"],[totalInc,"Incidents"]].map(([value,label]) => <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 text-center"><b className="block font-heading text-3xl text-white">{value}</b><span className="text-[10px] font-black uppercase tracking-wider text-gray-400">{label}</span></div>)}</div></div></div>
          </div>
        </div>
      </div>
    </section>
  );
};

const StandingsRefresh = () => {
  const { data: leagues = [] } = useQuery({ queryKey: ["leagues-for-standings"], queryFn: async () => { const { data } = await supabase.from("leagues").select("id, name").order("created_at", { ascending: false }); return data || []; } });
  const { data: teams = [] } = useTeams();
  const activeLeagueId = leagues[0]?.id;
  const { data: standings = [] } = useQuery({
    queryKey: ["standings-preview", activeLeagueId],
    enabled: !!activeLeagueId && !!teams.length,
    queryFn: async (): Promise<StandingRow[]> => {
      const { data: res } = await supabase.from("race_results").select("user_id, position, points, race_id, races(league_id)");
      const filtered = ((res || []) as StandingsRaceResult[]).filter((r) => r.races?.league_id === activeLeagueId);
      const map = new Map<string, { total_points: number; wins: number }>();
      filtered.forEach((r) => { const entry = map.get(r.user_id) || { total_points: 0, wins: 0 }; entry.total_points += r.points || 0; if (r.position === 1) entry.wins++; map.set(r.user_id, entry); });
      const userIds = Array.from(map.keys());
      if (!userIds.length) return [];
      const { data: profs } = await supabase.from("profiles").select("user_id, display_name, team_id").in("user_id", userIds);
      const profiles = (profs || []) as StandingsProfile[];
      return userIds.map((uid) => { const stats = map.get(uid)!; const prof = profiles.find((p) => p.user_id === uid); const team = teams.find((t) => t.id === prof?.team_id); return { user_id: uid, display_name: prof?.display_name || "Unknown", total_points: stats.total_points, wins: stats.wins, team: team ? { name: team.name, color: team.color } : undefined }; }).sort((a, b) => b.total_points - a.total_points).slice(0, 5);
    },
  });
  if (!standings.length) return null;
  const leagueName = leagues.find((league) => league.id === activeLeagueId)?.name;

  return (
    <section className="bg-background py-10 md:py-12">
      <div className={container}>
        <div className="mb-7 flex items-end justify-between gap-4"><div><div className={smallKicker}><Trophy className="h-4 w-4" /> Championship{leagueName ? ` • ${leagueName}` : ""}</div><h2 className="mt-2 font-heading text-3xl font-black uppercase leading-none text-white md:text-4xl">Coureurs stand</h2></div><Link to="/standings" className="hidden items-center gap-1 text-xs font-bold text-gray-400 transition hover:text-orange-400 sm:flex">Volledig <ChevronRight className="h-3 w-3" /></Link></div>
        <div className={`${sectionShell} ${orangeGlow}`}>
          <div className="relative divide-y divide-white/10">
            {standings.map((driver, index) => {
              const isPodium = index < 3;
              const color = isPodium ? podiumColors[index] : "#9ca3af";
              return (
                <Link
                  to="/standings"
                  key={driver.user_id}
                  className="group grid grid-cols-[42px_1fr_56px_86px] items-center gap-3 px-5 py-3 transition hover:bg-white/[0.04]"
                  style={isPodium ? { background: `linear-gradient(90deg, ${color}12, transparent 42%)` } : undefined}
                >
                  <div
                    className="grid h-9 w-9 place-items-center rounded-xl border font-heading font-black"
                    style={{
                      color,
                      background: isPodium ? `${color}1f` : "rgba(255,255,255,0.045)",
                      borderColor: isPodium ? `${color}2e` : "rgba(255,255,255,0.10)",
                      boxShadow: isPodium ? `0 0 24px ${color}16` : undefined,
                    }}
                  >
                    {index + 1}
                  </div>
                  <div className="min-w-0"><div className="truncate font-heading font-bold text-white group-hover:text-orange-300">{driver.display_name}</div>{driver.team && <div className="mt-0.5 flex items-center gap-1.5 text-xs" style={{ color: isPodium ? `${driver.team.color}ee` : "#9ca3af" }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: driver.team.color }} />{driver.team.name}</div>}</div>
                  <div className="text-center font-heading font-bold text-gray-300">{driver.wins}W</div>
                  <div className="text-right font-heading text-xl font-black text-white">{driver.total_points}<span className="ml-1 text-[10px] text-gray-300">PTS</span></div>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
};

const HomepagePrototype = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <StickyRaceBar />
      <main className="relative overflow-hidden pt-36 md:pt-[108px] bg-[radial-gradient(circle_at_50%_38%,rgba(249,115,22,0.045),transparent_28%),linear-gradient(180deg,hsl(220,20%,7%)_0%,hsl(220,20%,7%)_100%)]">
        <HomeHeroRefresh />
        <NextRaceRefresh />
        <HomeNewsSection />
        <RaceRecapRefresh />
        <StandingsRefresh />
      </main>
      <Footer />
    </div>
  );
};

export default HomepagePrototype;
