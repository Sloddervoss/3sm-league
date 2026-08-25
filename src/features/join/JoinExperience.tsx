import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowDown,
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  Check,
  CircuitBoard,
  Clock3,
  ExternalLink,
  Flag,
  Gauge,
  HeartHandshake,
  Layers3,
  MessageCircle,
  Radio,
  Sparkles,
  TimerReset,
  Trophy,
  UserRound,
  UsersRound,
} from "lucide-react";
import { TrackMap } from "@/components/track-map/TrackMap";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { cn } from "@/lib/utils";
import type { JoinPodiumEntry, JoinRaceSummary } from "@/features/join/data";
import { shouldShowRegistrationCount } from "@/features/join/data";
import { joinCopy, type JoinLocale } from "@/features/join/content";

const DISCORD_URL = "https://discord.gg/H7tZVuzBgT";

export type JoinExperienceProps = {
  language: JoinLocale;
  nextRace: JoinRaceSummary | null;
  latestRace: JoinRaceSummary | null;
  podium: JoinPodiumEntry[];
  completedRaceCount: number | null;
  uniqueCircuitCount: number | null;
  registrationCount: number | null;
  loading: {
    nextRace: boolean;
    latestRace: boolean;
    activityFacts: boolean;
    registrationCount: boolean;
  };
  failed: {
    nextRace: boolean;
    latestRace: boolean;
    activityFacts: boolean;
    registrationCount: boolean;
  };
};

const reveal = (reduced: boolean | null, delay = 0) => reduced
  ? {}
  : {
      initial: { opacity: 0, y: 24 },
      whileInView: { opacity: 1, y: 0 },
      viewport: { once: true, amount: 0.14 },
      transition: { duration: 0.62, delay, ease: [0.22, 1, 0.36, 1] as const },
    };

const SectionLabel = ({ children, icon: Icon = Sparkles }: { children: ReactNode; icon?: typeof Sparkles }) => (
  <div className="flex items-center gap-3 text-[10px] font-black uppercase tracking-[0.26em] text-orange-400 sm:text-xs">
    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-500/10 ring-1 ring-orange-400/20">
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
    </span>
    {children}
  </div>
);

const TrackFallback = ({ compact = false }: { compact?: boolean }) => (
  <div className={cn("relative overflow-hidden rounded-[1.5rem] bg-[#0c0f15] ring-1 ring-white/[0.06]", compact ? "h-32" : "h-56 sm:h-64")} aria-hidden="true">
    <svg viewBox="0 0 420 250" className="h-full w-full opacity-80" role="presentation">
      <defs>
        <linearGradient id={compact ? "fallback-compact" : "fallback-large"} x1="0" x2="1">
          <stop stopColor="#f97316" />
          <stop offset="1" stopColor="#ef4444" />
        </linearGradient>
      </defs>
      <path d="M48 161C77 81 164 40 231 83c52 33 31 74 83 89 34 10 55-13 64-46" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="42" strokeLinecap="round" />
      <path d="M48 161C77 81 164 40 231 83c52 33 31 74 83 89 34 10 55-13 64-46" fill="none" stroke="rgba(5,7,11,0.9)" strokeWidth="24" strokeLinecap="round" />
      <path d="M48 161C77 81 164 40 231 83c52 33 31 74 83 89 34 10 55-13 64-46" fill="none" stroke={`url(#${compact ? "fallback-compact" : "fallback-large"})`} strokeWidth="3" strokeDasharray="16 10" strokeLinecap="round" />
    </svg>
  </div>
);

const formatRaceDate = (race: JoinRaceSummary, language: JoinLocale) => {
  const locale = language === "en" ? "en-GB" : "nl-NL";
  const date = new Date(race.raceDate);
  return {
    date: date.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" }),
    time: date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" }),
  };
};

const RaceMap = ({ race, language, compact = false }: { race: JoinRaceSummary; language: JoinLocale; compact?: boolean }) => (
  <TrackMap
    track={race.track}
    trackId={race.trackId}
    decorative={false}
    alt={language === "en" ? `${race.track} circuit map` : `Circuitkaart van ${race.track}`}
    loading={compact ? "lazy" : "eager"}
    className={cn("w-full object-contain", compact ? "h-32" : "h-56 sm:h-64")}
    style={{ opacity: 0.92 }}
    fallbackStyle={{ opacity: 0.7, filter: "invert(1) brightness(2.4)" }}
    fallback={<TrackFallback compact={compact} />}
  />
);

const HeroNextRace = ({
  language,
  race,
  registrationCount,
  registrationLoading,
  registrationFailed,
  loading,
  failed,
  reduced,
}: {
  language: JoinLocale;
  race: JoinRaceSummary | null;
  registrationCount: number | null;
  registrationLoading: boolean;
  registrationFailed: boolean;
  loading: boolean;
  failed: boolean;
  reduced: boolean | null;
}) => {
  const copy = joinCopy[language];
  const when = race ? formatRaceDate(race, language) : null;
  const circuitName = race?.track.split(" - ")[0]?.trim() || race?.track;

  return (
    <div className="relative mx-auto w-full max-w-[34rem] lg:ml-auto">
      <motion.div
        className="absolute -inset-10 bg-[radial-gradient(circle,rgba(249,115,22,0.17),transparent_62%)] blur-2xl"
        aria-hidden="true"
        animate={reduced ? undefined : { opacity: [0.45, 0.75, 0.45] }}
        transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
      />
      <article className="relative overflow-hidden rounded-[2rem] bg-[#0d1017]/94 p-4 shadow-2xl shadow-black/40 ring-1 ring-white/[0.09] sm:p-5">
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] pb-4">
          <div className="flex items-center gap-3">
            <div className="grid grid-cols-3 gap-1" aria-hidden="true">
              {[0, 1, 2].map((item) => <span key={item} className="h-2 w-2 rounded-full bg-orange-500 shadow-[0_0_12px_rgba(249,115,22,0.65)]" />)}
            </div>
            <span className="font-heading text-[11px] font-black uppercase tracking-[0.2em] text-gray-200 sm:text-xs">3SM Next on Grid</span>
          </div>
          {race && !failed && (
            <span className="flex shrink-0 items-center gap-1.5 text-[9px] font-black uppercase tracking-wider text-emerald-300 sm:text-[10px]">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_9px_rgba(52,211,153,0.65)]" aria-hidden="true" />
              {copy.live.hiddenRegistrationNote}
            </span>
          )}
        </div>

        {loading ? (
          <div className="mt-4 h-[23rem] animate-pulse rounded-[1.55rem] bg-white/[0.035] ring-1 ring-white/[0.06]" role="status" aria-label={language === "en" ? "Loading next race" : "Volgende race laden"} />
        ) : race ? (
          <div className="relative mt-4 overflow-hidden rounded-[1.55rem] bg-[#090b10] p-5 ring-1 ring-white/[0.06] sm:p-6">
            <div className="absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(255,255,255,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.045)_1px,transparent_1px)] [background-size:32px_32px]" aria-hidden="true" />
            <div className="relative">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-400">{copy.live.next}</p>
                  <h2 className="mt-2 font-heading text-2xl font-black uppercase leading-none text-white sm:text-3xl">{circuitName}</h2>
                  <p className="mt-2 text-sm font-semibold text-gray-300">{race.name}{race.league?.carClass ? ` · ${race.league.carClass}` : ""}</p>
                </div>
                {when && (
                  <div className="shrink-0 text-right">
                    <strong className="block font-heading text-xl font-black uppercase text-white">{new Date(race.raceDate).toLocaleDateString(language === "en" ? "en-GB" : "nl-NL", { day: "2-digit", month: "short", timeZone: "Europe/Amsterdam" })}</strong>
                    <span className="mt-1 block text-xs font-bold text-gray-400">{when.time}</span>
                  </div>
                )}
              </div>

              <div className="relative my-5 flex min-h-40 items-center justify-center overflow-hidden rounded-2xl bg-orange-500/[0.025] px-5 ring-1 ring-white/[0.05]">
                <div className="absolute inset-8 bg-orange-500/[0.12] blur-3xl" aria-hidden="true" />
                <TrackMap
                  track={race.track}
                  trackId={race.trackId}
                  decorative={false}
                  alt={language === "en" ? `${race.track} circuit map` : `Circuitkaart van ${race.track}`}
                  loading="eager"
                  className="relative h-40 w-full object-contain"
                  style={{ opacity: 0.96 }}
                  fallbackStyle={{ opacity: 0.78, filter: "invert(1) brightness(2.6)" }}
                  fallback={<TrackFallback compact />}
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.07] pt-4">
                {!registrationFailed && shouldShowRegistrationCount(registrationCount) && !registrationLoading ? (
                  <span className="inline-flex items-center gap-2 text-xs font-black text-emerald-300"><UsersRound className="h-4 w-4" />{registrationCount} {copy.live.registrations}</span>
                ) : <span />}
                <Link to="/calendar/" className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-orange-500 px-4 text-xs font-black uppercase tracking-wider text-white transition hover:bg-orange-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300">
                  {copy.live.calendar}<ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-4 flex min-h-80 flex-col items-center justify-center rounded-[1.55rem] bg-[#090b10] p-7 text-center ring-1 ring-white/[0.06]" role={failed ? "status" : undefined}>
            <Flag className="h-7 w-7 text-orange-400" />
            <h2 className="mt-4 font-heading text-2xl font-black text-white">{failed ? copy.live.unavailableTitle : copy.live.noUpcoming}</h2>
            <p className="mt-3 max-w-sm text-[15px] leading-7 text-gray-300">{failed ? copy.live.unavailable : copy.live.noUpcomingDetail}</p>
            <Link to="/calendar/" className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-xl bg-white/[0.06] px-4 text-sm font-black text-white ring-1 ring-white/[0.10]">{copy.live.calendar}<ArrowRight className="h-4 w-4 text-orange-400" /></Link>
          </div>
        )}
      </article>
    </div>
  );
};

const RaceSkeleton = ({ compact = false, language }: { compact?: boolean; language: JoinLocale }) => (
  <div className={cn("animate-pulse rounded-[1.75rem] bg-white/[0.035] ring-1 ring-white/[0.06]", compact ? "h-80" : "h-[30rem]")} aria-label={language === "en" ? "Loading race data" : "Racegegevens laden"} role="status">
    <span className="sr-only">{language === "en" ? "Loading race data" : "Racegegevens laden"}</span>
  </div>
);

const Podium = ({ entries, language }: { entries: JoinPodiumEntry[]; language: JoinLocale }) => {
  const order = [entries.find((entry) => entry.position === 2), entries.find((entry) => entry.position === 1), entries.find((entry) => entry.position === 3)].filter(Boolean) as JoinPodiumEntry[];
  if (!order.length) return null;
  return (
    <div className="mt-6 grid grid-cols-3 items-end gap-2" role="group" aria-label={language === "en" ? "Latest race podium" : "Podium van de laatste race"}>
      {order.map((entry) => {
        const first = entry.position === 1;
        const color = entry.position === 1 ? "#facc15" : entry.position === 2 ? "#cbd5e1" : "#d97706";
        return (
          <div key={entry.position} className={cn("relative overflow-hidden rounded-t-2xl bg-white/[0.035] px-2 pb-3 pt-4 text-center ring-1 ring-white/[0.07]", first ? "min-h-36" : "min-h-28")}>
            <span className="font-heading text-2xl font-black" style={{ color }}>{entry.position}</span>
            <span className="mt-2 block break-words text-xs font-black leading-tight text-white sm:text-sm">{entry.name}</span>
            {first && <Trophy className="mx-auto mt-3 h-5 w-5 text-yellow-400" aria-hidden="true" />}
          </div>
        );
      })}
    </div>
  );
};

const EmptyRaceCard = ({ title, detail, failed }: { title: string; detail: string; failed?: boolean }) => (
  <div className="flex min-h-80 flex-col items-center justify-center rounded-[1.75rem] bg-white/[0.025] p-7 text-center ring-1 ring-white/[0.06]" role={failed ? "status" : undefined}>
    <Flag className="h-8 w-8 text-orange-400" />
    <h3 className="mt-5 font-heading text-2xl font-black text-white">{title}</h3>
    <p className="mt-3 max-w-sm text-sm leading-6 text-gray-400">{detail}</p>
  </div>
);

export const JoinExperience = ({
  language,
  nextRace,
  latestRace,
  podium,
  completedRaceCount,
  uniqueCircuitCount,
  registrationCount,
  loading,
  failed,
}: JoinExperienceProps) => {
  const copy = joinCopy[language];
  const reduced = useReducedMotion();
  const trustIcons = [HeartHandshake, Gauge, UserRound, UsersRound, Clock3];
  const whyIcons = [CalendarDays, Trophy, Layers3, MessageCircle];

  return (
    <div className="overflow-hidden bg-[#080a0f] text-white">
      <section className="relative border-b border-white/[0.06]">
        <div className="absolute inset-0 [background-image:linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:linear-gradient(to_bottom,black,transparent_88%)]" aria-hidden="true" />
        <div className="absolute -left-36 top-0 h-[34rem] w-[34rem] rounded-full bg-red-500/[0.11] blur-[110px]" aria-hidden="true" />
        <div className="absolute -right-40 bottom-0 h-[32rem] w-[32rem] rounded-full bg-orange-500/[0.10] blur-[120px]" aria-hidden="true" />
        <div className="container relative mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:py-16 lg:grid-cols-[minmax(0,1.05fr)_minmax(24rem,0.95fr)] lg:items-center lg:py-20">
          <motion.div {...reveal(reduced)}>
            <SectionLabel icon={Flag}>{copy.hero.eyebrow}</SectionLabel>
            <h1 className="mt-7 max-w-4xl font-heading text-[clamp(2.8rem,8vw,6.7rem)] font-black uppercase leading-[0.86] tracking-[-0.045em] text-white">
              {copy.hero.title}<br /><span className="bg-gradient-to-r from-orange-300 via-orange-500 to-red-500 bg-clip-text text-transparent">{copy.hero.accent}</span>
            </h1>
            <p className="mt-7 max-w-2xl text-base leading-7 text-gray-300 sm:text-lg sm:leading-8">{copy.hero.lead}</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a href="#join-steps" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-orange-500 px-5 font-heading text-sm font-black uppercase tracking-wider text-white shadow-xl shadow-orange-950/25 transition hover:bg-orange-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300">
                {copy.hero.explore}<ArrowDown className="h-4 w-4" />
              </a>
              <Link to="/calendar/" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-white/[0.045] px-5 font-heading text-sm font-black uppercase tracking-wider text-white ring-1 ring-white/[0.10] transition hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300">
                {copy.hero.calendar}<CalendarDays className="h-4 w-4 text-orange-400" />
              </Link>
            </div>
            <p className="mt-9 border-l-2 border-orange-500 pl-4 font-heading text-sm font-black uppercase tracking-[0.16em] text-gray-300 sm:text-base">{copy.hero.slogan}</p>
          </motion.div>
          <motion.div {...reveal(reduced, 0.08)}>
            <HeroNextRace
              language={language}
              race={nextRace}
              registrationCount={registrationCount}
              registrationLoading={loading.registrationCount}
              registrationFailed={failed.registrationCount}
              loading={loading.nextRace}
              failed={failed.nextRace}
              reduced={reduced}
            />
          </motion.div>
        </div>
      </section>

      <section aria-label={language === "en" ? "Participation facts" : "Feiten over deelname"} className="relative border-b border-white/[0.06] bg-[#0b0e14]">
        <div className="container mx-auto max-w-7xl px-4 py-6 sm:py-8">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[1.4rem] bg-white/[0.07] ring-1 ring-white/[0.06] md:grid-cols-5">
            {copy.trust.map((item, index) => {
              const Icon = trustIcons[index];
              return (
                <div key={item.title} className="group min-w-0 bg-[#0d1017] p-4 transition last:col-span-2 hover:bg-[#11151e] sm:p-5 md:last:col-span-1">
                  <Icon className="h-4 w-4 text-orange-400" aria-hidden="true" />
                  <strong className="mt-3 block font-heading text-base font-black text-white sm:text-lg">{item.title}</strong>
                  <span className="mt-1 block text-sm leading-6 text-gray-300">{item.detail}</span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section id="race-activity" className="relative scroll-mt-28 py-16 sm:py-24">
        <div className="absolute left-1/2 top-20 h-[30rem] w-[58rem] -translate-x-1/2 rounded-full bg-orange-500/[0.06] blur-[120px]" aria-hidden="true" />
        <div className="container relative mx-auto max-w-7xl px-4">
          <motion.div {...reveal(reduced)} className="max-w-3xl">
            <SectionLabel icon={Radio}>{copy.live.eyebrow}</SectionLabel>
            <h2 className="mt-6 font-heading text-4xl font-black uppercase leading-[0.96] tracking-tight text-white sm:text-5xl">{copy.live.title}</h2>
            <p className="mt-5 max-w-2xl text-[17px] leading-8 text-gray-300">{copy.live.lead}</p>
          </motion.div>

          <div className="mt-10">
            <motion.div {...reveal(reduced, 0.04)}>
              {loading.latestRace ? <RaceSkeleton language={language} /> : latestRace ? (
                <article className="relative overflow-hidden rounded-[1.8rem] bg-[#10131a] p-5 shadow-2xl shadow-black/25 ring-1 ring-white/[0.07] sm:p-8">
                  <div className="absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-orange-400/75 to-transparent" aria-hidden="true" />
                  <div className="relative grid gap-7 lg:grid-cols-[minmax(0,0.82fr)_minmax(20rem,0.68fr)] lg:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="rounded-full bg-orange-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-orange-300 ring-1 ring-orange-400/20">{copy.live.latest}</span>
                        <span className="text-sm font-semibold text-gray-400">{formatRaceDate(latestRace, language).date}</span>
                      </div>
                      <h3 className="mt-5 font-heading text-3xl font-black uppercase leading-none text-white sm:text-4xl">{latestRace.name}</h3>
                      <p className="mt-3 text-[15px] leading-6 text-gray-300">{latestRace.track}</p>
                      <Podium entries={podium} language={language} />
                      <Link to={`/results/?race=${latestRace.id}`} className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-xl bg-orange-500 px-4 text-sm font-black text-white shadow-lg shadow-orange-950/20 transition hover:bg-orange-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300">{copy.live.results}<ArrowRight className="h-4 w-4" /></Link>
                    </div>
                    <div className="relative overflow-hidden rounded-[1.5rem] bg-black/20 p-4 ring-1 ring-white/[0.05]">
                      <div className="absolute inset-8 bg-orange-500/[0.10] blur-3xl" aria-hidden="true" />
                      <RaceMap race={latestRace} language={language} />
                    </div>
                  </div>
                </article>
              ) : (
                <EmptyRaceCard title={failed.latestRace ? copy.live.unavailableTitle : copy.live.noResult} detail={failed.latestRace ? copy.live.unavailable : copy.live.noResultDetail} failed={failed.latestRace} />
              )}
            </motion.div>
          </div>

          {!loading.activityFacts && !failed.activityFacts && (completedRaceCount !== null || uniqueCircuitCount !== null) && (
            <motion.div {...reveal(reduced, 0.05)} className="mt-5 grid gap-3 sm:grid-cols-2">
              {completedRaceCount !== null && <div className="flex items-center justify-between rounded-2xl bg-white/[0.025] px-5 py-4 ring-1 ring-white/[0.06]"><span className="text-sm font-semibold text-gray-400">{copy.live.completed}</span><strong className="font-heading text-3xl font-black text-orange-400">{completedRaceCount}</strong></div>}
              {uniqueCircuitCount !== null && <div className="flex items-center justify-between rounded-2xl bg-white/[0.025] px-5 py-4 ring-1 ring-white/[0.06]"><span className="text-sm font-semibold text-gray-400">{copy.live.circuits}</span><strong className="font-heading text-3xl font-black text-orange-400">{uniqueCircuitCount}</strong></div>}
            </motion.div>
          )}
        </div>
      </section>

      <section className="border-y border-white/[0.06] bg-[#0b0e14] py-16 sm:py-24">
        <div className="container mx-auto grid max-w-7xl gap-12 px-4 lg:grid-cols-[0.86fr_1.14fr] lg:items-start">
          <motion.div {...reveal(reduced)} className="lg:sticky lg:top-32">
            <SectionLabel icon={CircuitBoard}>{copy.why.eyebrow}</SectionLabel>
            <h2 className="mt-6 font-heading text-3xl font-black uppercase leading-[0.98] text-white sm:text-5xl">{copy.why.title}</h2>
            <p className="mt-6 max-w-xl text-[17px] leading-8 text-gray-300">{copy.why.lead}</p>
          </motion.div>
          <div className="relative">
            <div className="absolute bottom-8 left-5 top-8 w-px bg-gradient-to-b from-orange-500 via-red-500/50 to-transparent sm:left-7" aria-hidden="true" />
            {copy.why.items.map((item, index) => {
              const Icon = whyIcons[index];
              return (
                <motion.article key={item.title} {...reveal(reduced, index * 0.04)} className="relative ml-12 border-b border-white/[0.06] py-7 last:border-0 sm:ml-16 sm:py-9">
                  <span className="absolute -left-[3.25rem] top-7 flex h-10 w-10 items-center justify-center rounded-full bg-[#11151d] text-orange-400 ring-1 ring-orange-400/25 sm:-left-[4.1rem] sm:top-9 sm:h-12 sm:w-12"><Icon className="h-5 w-5" /></span>
                  <span className="text-[10px] font-black tracking-[0.24em] text-gray-400">0{index + 1}</span>
                  <h3 className="mt-2 font-heading text-2xl font-black text-white sm:text-3xl">{item.title}</h3>
                  <p className="mt-3 max-w-2xl text-[15px] leading-7 text-gray-300 sm:text-base">{item.text}</p>
                </motion.article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="py-16 sm:py-24">
        <div className="container mx-auto max-w-7xl px-4">
          <motion.div {...reveal(reduced)} className="max-w-3xl">
            <SectionLabel icon={UsersRound}>{copy.participation.eyebrow}</SectionLabel>
            <h2 className="mt-6 font-heading text-3xl font-black uppercase leading-[0.98] text-white sm:text-5xl">{copy.participation.title}</h2>
            <p className="mt-5 text-[17px] leading-8 text-gray-300">{copy.participation.lead}</p>
          </motion.div>
          <div className="mt-10 grid gap-4 lg:grid-cols-2">
            {[{ ...copy.participation.solo, icon: UserRound, number: "01" }, { ...copy.participation.team, icon: UsersRound, number: "02" }].map((route, index) => (
              <motion.article key={route.title} {...reveal(reduced, index * 0.06)} className="group relative overflow-hidden rounded-[1.8rem] bg-gradient-to-br from-white/[0.055] to-white/[0.018] p-6 ring-1 ring-white/[0.07] sm:p-7">
                <span className="absolute right-5 top-2 font-heading text-8xl font-black text-white/[0.025]">{route.number}</span>
                <route.icon className="h-7 w-7 text-orange-400" />
                <span className="mt-5 inline-flex rounded-full bg-orange-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-orange-300 ring-1 ring-orange-400/20">{route.tag}</span>
                <h3 className="mt-4 max-w-md font-heading text-2xl font-black text-white sm:text-3xl">{route.title}</h3>
                <p className="mt-3 max-w-xl text-[15px] leading-7 text-gray-300 sm:text-base">{route.text}</p>
              </motion.article>
            ))}
          </div>
        </div>
      </section>

      <section id="join-steps" className="scroll-mt-28 border-y border-white/[0.06] bg-[#0b0e14] py-16 sm:py-24">
        <div className="container mx-auto max-w-7xl px-4">
          <motion.div {...reveal(reduced)} className="mx-auto max-w-3xl text-center">
            <SectionLabel icon={Flag}><span className="mx-auto">{copy.steps.eyebrow}</span></SectionLabel>
            <h2 className="mt-6 font-heading text-3xl font-black uppercase leading-[0.98] text-white sm:text-5xl">{copy.steps.title}</h2>
            <p className="mt-5 text-[17px] leading-8 text-gray-300">{copy.steps.lead}</p>
          </motion.div>
          <div className="relative mx-auto mt-10 grid max-w-5xl gap-3 lg:grid-cols-4">
            <div className="absolute left-[12.5%] right-[12.5%] top-7 hidden h-px bg-gradient-to-r from-orange-500 via-red-500 to-orange-500 lg:block" aria-hidden="true" />
            {copy.steps.items.map((step, index) => (
              <motion.article key={step.number} {...reveal(reduced, index * 0.035)} className="relative grid grid-cols-[3.5rem_1fr] gap-4 rounded-2xl bg-white/[0.035] p-5 ring-1 ring-white/[0.07] lg:block lg:bg-transparent lg:p-2 lg:text-center lg:ring-0">
                <span className="relative z-10 flex h-12 w-12 items-center justify-center rounded-full bg-[#11151d] font-heading text-sm font-black text-orange-300 ring-1 ring-orange-400/30 lg:mx-auto lg:h-14 lg:w-14">{step.number}</span>
                <div className="lg:mt-6">
                  <h3 className="font-heading text-lg font-black text-white lg:text-xl">{step.title}</h3>
                  <p className="mt-2 text-[15px] leading-7 text-gray-300 lg:text-sm lg:leading-6">{step.text}</p>
                </div>
              </motion.article>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 sm:py-24">
        <div className="container mx-auto max-w-7xl px-4">
          <motion.div {...reveal(reduced)} className="max-w-4xl">
            <SectionLabel icon={Layers3}>{copy.formats.eyebrow}</SectionLabel>
            <h2 className="mt-6 font-heading text-3xl font-black uppercase leading-[0.98] text-white sm:text-5xl">{copy.formats.title}</h2>
            <p className="mt-5 max-w-2xl text-[17px] leading-8 text-gray-300">{copy.formats.lead}</p>
          </motion.div>
          <div className="mt-10 overflow-hidden rounded-[1.8rem] bg-white/[0.025] ring-1 ring-white/[0.07]">
            {copy.formats.items.map((item, index) => {
              const status = item.status === "now" ? copy.formats.now : item.status === "interest" ? copy.formats.interest : copy.formats.development;
              const Icon = item.status === "now" ? Gauge : item.status === "interest" ? Sparkles : TimerReset;
              return (
                <motion.article key={item.title} {...reveal(reduced, index * 0.04)} className="grid gap-5 border-b border-white/[0.06] p-6 last:border-0 sm:p-8 md:grid-cols-[3rem_minmax(12rem,0.5fr)_minmax(0,1fr)_auto] md:items-center">
                  <Icon className="h-6 w-6 text-orange-400" />
                  <h3 className="font-heading text-2xl font-black text-white">{item.title}</h3>
                  <p className="text-[15px] leading-7 text-gray-300 sm:text-base">{item.text}</p>
                  <span className={cn("justify-self-start rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.15em] ring-1", item.status === "now" ? "bg-emerald-500/10 text-emerald-300 ring-emerald-400/20" : item.status === "development" ? "bg-orange-500/10 text-orange-300 ring-orange-400/20" : "bg-white/[0.04] text-gray-300 ring-white/[0.08]")}>{status}</span>
                </motion.article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="border-y border-white/[0.06] bg-[#0b0e14] py-16 sm:py-24">
        <div className="container mx-auto max-w-5xl px-4">
          <motion.div {...reveal(reduced)} className="text-center">
            <SectionLabel icon={BadgeCheck}><span className="mx-auto">{copy.faq.eyebrow}</span></SectionLabel>
            <h2 className="mt-6 font-heading text-3xl font-black uppercase leading-[0.98] text-white sm:text-5xl">{copy.faq.title}</h2>
          </motion.div>
          <Accordion type="single" collapsible className="mt-10 grid items-start gap-3 md:grid-cols-2">
            {copy.faq.items.map((item, index) => (
              <AccordionItem key={item.question} value={`faq-${index}`} className="overflow-hidden rounded-2xl border-0 bg-white/[0.028] px-5 ring-1 ring-white/[0.07] data-[state=open]:bg-white/[0.045] data-[state=open]:ring-orange-400/20">
                <AccordionTrigger className="min-h-16 py-4 text-left font-heading text-base font-black text-white hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-300 sm:text-lg">{item.question}</AccordionTrigger>
                <AccordionContent className="pb-5 text-[15px] leading-7 text-gray-300 sm:text-base">{item.answer}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </section>

      <section className="py-16 sm:py-24">
        <div className="container mx-auto max-w-7xl px-4">
          <motion.div {...reveal(reduced)} className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-orange-500/[0.17] via-[#151419] to-red-500/[0.08] p-7 shadow-2xl shadow-black/30 ring-1 ring-orange-400/20 sm:p-10 lg:p-14">
            <div className="absolute -right-20 -top-20 h-80 w-80 rounded-full bg-orange-500/[0.15] blur-3xl" aria-hidden="true" />
            <div className="relative grid gap-9 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <div>
                <SectionLabel icon={MessageCircle}>{copy.closing.eyebrow}</SectionLabel>
                <h2 className="mt-6 max-w-4xl font-heading text-3xl font-black uppercase leading-[0.98] text-white sm:text-5xl">{copy.closing.title}</h2>
                <p className="mt-5 max-w-2xl text-base leading-7 text-gray-300 sm:text-lg">{copy.closing.lead}</p>
                <p className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-orange-200"><Check className="h-4 w-4" />{copy.closing.note}</p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
                <a href={DISCORD_URL} target="_blank" rel="noreferrer" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-orange-500 px-5 font-heading text-sm font-black uppercase tracking-wider text-white shadow-xl shadow-orange-950/25 transition hover:bg-orange-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300">{copy.closing.discord}<ExternalLink className="h-4 w-4" /></a>
                <Link to="/calendar/" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-black/25 px-5 font-heading text-sm font-black uppercase tracking-wider text-white ring-1 ring-white/[0.10] transition hover:bg-black/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300">{copy.closing.calendar}<CalendarDays className="h-4 w-4 text-orange-400" /></Link>
              </div>
            </div>
          </motion.div>
        </div>
      </section>
    </div>
  );
};
