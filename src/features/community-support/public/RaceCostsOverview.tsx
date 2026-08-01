import { CalendarDays, Clock3, Flag, Gauge, MapPin, Percent, ReceiptText } from "lucide-react";
import type { PublicSupportRaceCost } from "../types";

type Language = "nl" | "en";

type Props = {
  language: Language;
  selectedYear: string;
  costs: PublicSupportRaceCost[];
};

const COPY = {
  nl: {
    eyebrow: "Kosten op de kalender",
    title: "Wat kost een race?",
    intro: "Per verreden race tonen we de gehoste uren, eventuele activiteitskorting en het berekende bedrag. Samen vormen die één helder seizoensoverzicht.",
    recorded: "Races met kosten",
    total: "Racekosten seizoen",
    average: "Gemiddeld per race",
    empty: "Nog geen openbare racekosten voor dit seizoen",
    emptyHint: "Zodra een racebedrag is ingevuld en openbaar gemaakt, verschijnt de race hier.",
    seasonRace: "Seizoensrace",
    standaloneRace: "Losse race",
    date: "Datum",
    circuit: "Circuit",
    hours: "gehoste uren",
    discounted: "25% korting",
  },
  en: {
    eyebrow: "Costs on the calendar",
    title: "What does a race cost?",
    intro: "For each completed race we show its hosted hours, any activity discount and the calculated amount. Together they form one clear season overview.",
    recorded: "Races with costs",
    total: "Season race costs",
    average: "Average per race",
    empty: "No public race costs for this season yet",
    emptyHint: "Once a race amount is entered and made public, the race will appear here.",
    seasonRace: "Season race",
    standaloneRace: "Standalone race",
    date: "Date",
    circuit: "Circuit",
    hours: "hosted hours",
    discounted: "25% discount",
  },
} as const;

const money = (value: number, language: Language) => new Intl.NumberFormat(language === "en" ? "en-GB" : "nl-NL", { style: "currency", currency: "EUR", minimumFractionDigits: 2 }).format(value);
const dateLabel = (value: string, language: Language) => {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat(language === "en" ? "en-GB" : "nl-NL", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(year, month - 1, day));
};

const RaceCostsOverview = ({ language, selectedYear, costs }: Props) => {
  const t = COPY[language];
  const total = costs.reduce((sum, cost) => sum + cost.amount, 0);
  const average = costs.length ? total / costs.length : 0;

  return <section aria-labelledby="race-costs-title">
    <div className="mb-6 max-w-3xl">
      <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.22em] text-orange-400"><Flag className="h-4 w-4" aria-hidden="true" />{t.eyebrow}</div>
      <h2 id="race-costs-title" className="mt-2 font-heading text-2xl font-black uppercase leading-tight text-white sm:text-3xl">{t.title} · {selectedYear}</h2>
      <p className="mt-3 text-sm leading-6 text-gray-400 sm:text-base">{t.intro}</p>
    </div>

    <div className="grid gap-3 sm:grid-cols-3">
      <article className="rounded-2xl bg-white/[0.035] p-5 ring-1 ring-white/[0.065]"><div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-gray-500"><Flag className="h-3.5 w-3.5" />{t.recorded}</div><p className="mt-2 font-heading text-2xl font-black text-white">{costs.length}</p></article>
      <article className="rounded-2xl bg-orange-500/[0.08] p-5 ring-1 ring-orange-400/20"><div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-orange-300"><ReceiptText className="h-3.5 w-3.5" />{t.total}</div><p className="mt-2 font-heading text-2xl font-black text-white">{money(total, language)}</p></article>
      <article className="rounded-2xl bg-white/[0.035] p-5 ring-1 ring-white/[0.065]"><div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-gray-500"><Gauge className="h-3.5 w-3.5" />{t.average}</div><p className="mt-2 font-heading text-2xl font-black text-white">{money(average, language)}</p></article>
    </div>

    {costs.length === 0 ? <div role="status" className="mt-4 flex min-h-44 flex-col items-center justify-center rounded-[1.65rem] bg-black/10 px-6 py-10 text-center ring-1 ring-inset ring-white/[0.055]">
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/[0.04] text-gray-400 ring-1 ring-white/[0.07]"><CalendarDays className="h-5 w-5" aria-hidden="true" /></div>
      <p className="mt-4 font-bold text-gray-200">{t.empty}</p><p className="mt-1 max-w-md text-sm leading-6 text-gray-500">{t.emptyHint}</p>
    </div> : <div className="mt-4 grid gap-4 md:grid-cols-2">
      {costs.map((cost) => <article key={`${cost.date}-${cost.raceName}-${cost.track}`} className="group relative overflow-hidden rounded-[1.65rem] bg-white/[0.035] p-5 shadow-2xl shadow-black/20 ring-1 ring-white/[0.065] sm:p-6">
        <div aria-hidden="true" className="absolute -right-10 -top-12 h-32 w-32 rounded-full bg-orange-500/[0.08] blur-3xl" />
        <div className="relative flex items-start justify-between gap-4">
          <div className="min-w-0"><span className="inline-flex rounded-full bg-orange-400/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-orange-200 ring-1 ring-orange-300/15">{cost.raceScope === "season" ? cost.leagueName || t.seasonRace : t.standaloneRace}</span><h3 className="mt-3 font-heading text-xl font-black text-white">{cost.raceName}</h3></div>
          <p className="shrink-0 font-heading text-xl font-black tabular-nums text-white sm:text-2xl">{money(cost.amount, language)}</p>
        </div>
        <dl className="relative mt-5 grid gap-3 border-t border-white/[0.06] pt-4 text-xs sm:grid-cols-2">
          <div><dt className="sr-only">{t.date}</dt><dd className="flex items-center gap-2 text-gray-400"><CalendarDays className="h-3.5 w-3.5 text-orange-400" aria-hidden="true" />{dateLabel(cost.date, language)}</dd></div>
          <div><dt className="sr-only">{t.circuit}</dt><dd className="flex items-center gap-2 text-gray-400 sm:justify-end"><MapPin className="h-3.5 w-3.5 text-orange-400" aria-hidden="true" /><span className="truncate">{cost.track}</span></dd></div>
          <div><dt className="sr-only">{t.hours}</dt><dd className="flex items-center gap-2 text-gray-400"><Clock3 className="h-3.5 w-3.5 text-orange-400" aria-hidden="true" />{cost.hostedHours} {t.hours}</dd></div>
          {cost.discountApplied && <div><dt className="sr-only">{t.discounted}</dt><dd className="flex items-center gap-2 text-orange-200 sm:justify-end"><Percent className="h-3.5 w-3.5 text-orange-400" aria-hidden="true" />{t.discounted}</dd></div>}
        </dl>
      </article>)}
    </div>}
  </section>;
};

export default RaceCostsOverview;
