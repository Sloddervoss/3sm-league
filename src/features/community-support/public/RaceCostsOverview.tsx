import { CalendarDays, ChevronDown, Clock3, Flag, Gauge, MapPin, Percent, ReceiptText } from "lucide-react";
import type { PublicSupportRaceCost } from "../types";

type Language = "nl" | "en";

type Props = {
  language: Language;
  selectedYear: string;
  costs: PublicSupportRaceCost[];
  totalCount: number;
  totalAmountEur: number;
};

const COPY = {
  nl: {
    eyebrow: "Kosten op de kalender",
    title: "Racehosting in het open boek",
    intro: "Iedere Hosted Session is één EUR-kostenpost. Open een race voor de oorspronkelijke USD-prijs, gehoste uren, eventuele korting en de koers die bij deze boeking is vastgelegd.",
    recorded: "Races met kosten",
    total: "Racekosten seizoen",
    average: "Gemiddeld per race",
    empty: "Nog geen openbare racekosten voor dit seizoen",
    emptyHint: "Zodra een racebedrag is ingevuld en openbaar gemaakt, verschijnt de race hier.",
    seasonRace: "Seizoensrace",
    standaloneRace: "Losse race",
    date: "Datum",
    circuit: "Circuit",
    hours: "Gehoste uren",
    discount: "Korting",
    discounted: "25% toegepast",
    noDiscount: "Geen korting",
    sourceAmount: "Oorspronkelijke USD-prijs",
    exchangeRate: "Gebruikte USD/EUR-koers",
    bookedAmount: "Geboekt EUR-bedrag",
    details: "Details",
  },
  en: {
    eyebrow: "Costs on the calendar",
    title: "Race hosting in the open ledger",
    intro: "Every Hosted Session is one EUR expense entry. Open a race to view its original USD price, hosted hours, any discount and the exchange rate stored with that entry.",
    recorded: "Races with costs",
    total: "Season race costs",
    average: "Average per race",
    empty: "No public race costs for this season yet",
    emptyHint: "Once a race amount is entered and made public, the race will appear here.",
    seasonRace: "Season race",
    standaloneRace: "Standalone race",
    date: "Date",
    circuit: "Circuit",
    hours: "Hosted hours",
    discount: "Discount",
    discounted: "25% applied",
    noDiscount: "No discount",
    sourceAmount: "Original USD price",
    exchangeRate: "USD/EUR rate used",
    bookedAmount: "Booked EUR amount",
    details: "Details",
  },
} as const;

const eur = (value: number, language: Language) => new Intl.NumberFormat(language === "en" ? "en-GB" : "nl-NL", { style: "currency", currency: "EUR", minimumFractionDigits: 2 }).format(value);
const usd = (value: number, language: Language) => new Intl.NumberFormat(language === "en" ? "en-US" : "nl-NL", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(value);
const dateLabel = (value: string, language: Language) => {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat(language === "en" ? "en-GB" : "nl-NL", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(year, month - 1, day));
};

const RaceCostsOverview = ({ language, selectedYear, costs, totalCount, totalAmountEur }: Props) => {
  const t = COPY[language];
  const average = totalCount ? totalAmountEur / totalCount : 0;

  return <section aria-labelledby="race-costs-title">
    <div className="mb-6 max-w-3xl">
      <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.22em] text-orange-400"><Flag className="h-4 w-4" aria-hidden="true" />{t.eyebrow}</div>
      <h2 id="race-costs-title" className="mt-2 font-heading text-2xl font-black uppercase leading-tight text-white sm:text-3xl">{t.title} · {selectedYear}</h2>
      <p className="mt-3 text-sm leading-6 text-gray-400 sm:text-base">{t.intro}</p>
    </div>

    <div className="grid gap-3 sm:grid-cols-3">
      <article className="rounded-2xl bg-white/[0.035] p-5 ring-1 ring-white/[0.065]"><div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-gray-500"><Flag className="h-3.5 w-3.5" />{t.recorded}</div><p className="mt-2 font-heading text-2xl font-black text-white">{totalCount}</p></article>
      <article className="rounded-2xl bg-orange-500/[0.08] p-5 ring-1 ring-orange-400/20"><div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-orange-300"><ReceiptText className="h-3.5 w-3.5" />{t.total}</div><p className="mt-2 font-heading text-2xl font-black text-white">{eur(totalAmountEur, language)}</p></article>
      <article className="rounded-2xl bg-white/[0.035] p-5 ring-1 ring-white/[0.065]"><div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-gray-500"><Gauge className="h-3.5 w-3.5" />{t.average}</div><p className="mt-2 font-heading text-2xl font-black text-white">{eur(average, language)}</p></article>
    </div>

    {costs.length === 0 ? <div role="status" className="mt-4 flex min-h-44 flex-col items-center justify-center rounded-[1.65rem] bg-black/10 px-6 py-10 text-center ring-1 ring-inset ring-white/[0.055]">
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/[0.04] text-gray-400 ring-1 ring-white/[0.07]"><CalendarDays className="h-5 w-5" aria-hidden="true" /></div>
      <p className="mt-4 font-bold text-gray-200">{t.empty}</p><p className="mt-1 max-w-md text-sm leading-6 text-gray-500">{t.emptyHint}</p>
    </div> : <div className="mt-4 overflow-hidden rounded-[1.65rem] bg-white/[0.025] ring-1 ring-white/[0.065]">
      {costs.map((cost) => <details key={`${cost.date}-${cost.raceName}-${cost.track}`} className="group border-b border-white/[0.055] last:border-b-0">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-4 marker:hidden sm:px-5">
          <ChevronDown className="h-4 w-4 shrink-0 text-gray-500 transition group-open:rotate-180" aria-hidden="true" />
          <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate font-bold text-white">{cost.raceName}</h3><span className="rounded-full bg-orange-400/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-orange-200">{cost.raceScope === "season" ? cost.leagueName || t.seasonRace : t.standaloneRace}</span></div><p className="mt-1 truncate text-xs text-gray-500">{dateLabel(cost.date, language)} · {cost.track}</p></div>
          <span className="sr-only">{t.details}</span><p className="shrink-0 font-heading text-lg font-black tabular-nums text-white">{eur(cost.amount, language)}</p>
        </summary>
        <dl className="grid gap-3 border-t border-white/[0.05] bg-black/10 px-5 py-4 text-xs sm:grid-cols-2 lg:grid-cols-3">
          <div><dt className="text-gray-500">{t.date}</dt><dd className="mt-1 flex items-center gap-2 font-bold text-gray-200"><CalendarDays className="h-3.5 w-3.5 text-orange-400" />{dateLabel(cost.date, language)}</dd></div>
          <div><dt className="text-gray-500">{t.circuit}</dt><dd className="mt-1 flex items-center gap-2 font-bold text-gray-200"><MapPin className="h-3.5 w-3.5 text-orange-400" /><span className="truncate">{cost.track}</span></dd></div>
          <div><dt className="text-gray-500">{t.hours}</dt><dd className="mt-1 flex items-center gap-2 font-bold text-gray-200"><Clock3 className="h-3.5 w-3.5 text-orange-400" />{cost.hostedHours}</dd></div>
          <div><dt className="text-gray-500">{t.discount}</dt><dd className="mt-1 flex items-center gap-2 font-bold text-gray-200"><Percent className="h-3.5 w-3.5 text-orange-400" />{cost.discountApplied ? t.discounted : t.noDiscount}</dd></div>
          <div><dt className="text-gray-500">{t.sourceAmount}</dt><dd className="mt-1 font-bold text-gray-200">{usd(cost.sourceAmountUsd, language)}</dd></div>
          <div><dt className="text-gray-500">{t.exchangeRate}</dt><dd className="mt-1 font-bold text-gray-200">1 USD = {cost.exchangeRateUsdEur.toFixed(4)} EUR</dd></div>
          <div className="sm:col-span-2 lg:col-span-3"><dt className="text-gray-500">{t.bookedAmount}</dt><dd className="mt-1 font-heading text-lg font-black text-white">{eur(cost.amount, language)}</dd></div>
        </dl>
      </details>)}
    </div>}
  </section>;
};

export default RaceCostsOverview;
