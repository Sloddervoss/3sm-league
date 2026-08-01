import { CalendarDays, Clock3, Coins, Flag, MapPin, Percent, ReceiptText } from "lucide-react";
import type { PublicSupportRaceCost } from "../types";

type Language = "nl" | "en";

type Props = {
  language: Language;
  selectedYear: string;
  costs: PublicSupportRaceCost[];
  summary: {
    raceCount: number;
    consumedUsd: number;
    purchasedUsd: number;
    paidEur: number;
  };
};

const COPY = {
  nl: {
    eyebrow: "iRacing-hosting",
    title: "Credits gekocht en verbruikt",
    intro: "Credit-aankopen zijn de werkelijke uitgave in euro. Races verbruiken daarna USD-credits en worden niet nogmaals als financiële uitgave geboekt.",
    recorded: "Races met verbruik",
    consumed: "Credits verbruikt",
    purchased: "Credits gekocht",
    expenses: "Werkelijk betaald",
    empty: "Nog geen openbare racehosting voor dit seizoen",
    emptyHint: "Zodra Credit-aankopen of raceverbruik openbaar worden gemaakt, verschijnt hier een compact overzicht.",
    races: "races",
    hours: "gehoste uren",
    details: "Bekijk racedetails",
    seasonRace: "Seizoensrace",
    standaloneRace: "Losse race",
    discounted: "25% korting",
    accounting: "USD-creditverbruik blijft gescheiden van de EUR-uitgaven. Alleen de aankoop van Credits telt mee in het financiële seizoentotaal.",
  },
  en: {
    eyebrow: "iRacing hosting",
    title: "Credits purchased and consumed",
    intro: "Credit purchases are the actual expense in euros. Races then consume USD credits and are not booked again as a financial expense.",
    recorded: "Races with usage",
    consumed: "Credits consumed",
    purchased: "Credits purchased",
    expenses: "Actually paid",
    empty: "No public race hosting for this season yet",
    emptyHint: "Once Credit purchases or race usage are made public, a compact overview will appear here.",
    races: "races",
    hours: "hosted hours",
    details: "View race details",
    seasonRace: "Season race",
    standaloneRace: "Standalone race",
    discounted: "25% discount",
    accounting: "USD credit consumption remains separate from EUR expenses. Only Credit purchases count towards the financial season total.",
  },
} as const;

const usd = (value: number, language: Language) => new Intl.NumberFormat(language === "en" ? "en-US" : "nl-NL", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(value);
const eur = (value: number, language: Language) => new Intl.NumberFormat(language === "en" ? "en-GB" : "nl-NL", { style: "currency", currency: "EUR", minimumFractionDigits: 2 }).format(value);
const dateLabel = (value: string, language: Language) => {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat(language === "en" ? "en-GB" : "nl-NL", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(year, month - 1, day));
};
const monthLabel = (value: string, language: Language) => new Intl.DateTimeFormat(language === "en" ? "en-GB" : "nl-NL", { month: "long", year: "numeric" }).format(new Date(`${value}-01T12:00:00`));

const RaceCostsOverview = ({ language, selectedYear, costs, summary }: Props) => {
  const t = COPY[language];
  const monthGroups = Array.from(costs.reduce((groups, cost) => {
    const month = cost.date.slice(0, 7);
    groups.set(month, [...(groups.get(month) ?? []), cost]);
    return groups;
  }, new Map<string, PublicSupportRaceCost[]>()).entries()).map(([month, monthCosts]) => ({ month, costs: monthCosts }));
  const hasData = summary.raceCount > 0 || summary.purchasedUsd > 0;

  return <section aria-labelledby="race-costs-title">
    <div className="mb-6 max-w-3xl">
      <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.22em] text-orange-400"><Flag className="h-4 w-4" aria-hidden="true" />{t.eyebrow}</div>
      <h2 id="race-costs-title" className="mt-2 font-heading text-2xl font-black uppercase leading-tight text-white sm:text-3xl">{t.title} · {selectedYear}</h2>
      <p className="mt-3 text-sm leading-6 text-gray-400 sm:text-base">{t.intro}</p>
    </div>

    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {[
        [t.recorded, String(summary.raceCount), <Flag className="h-3.5 w-3.5" key="races" />],
        [t.consumed, usd(summary.consumedUsd, language), <ReceiptText className="h-3.5 w-3.5" key="used" />],
        [t.purchased, usd(summary.purchasedUsd, language), <Coins className="h-3.5 w-3.5" key="purchased" />],
        [t.expenses, eur(summary.paidEur, language), <ReceiptText className="h-3.5 w-3.5" key="paid" />],
      ].map(([label, value, icon]) => <article key={String(label)} className="rounded-2xl bg-white/[0.035] p-5 ring-1 ring-white/[0.065]"><div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-gray-500">{icon}{label}</div><p className="mt-2 font-heading text-2xl font-black text-white">{value}</p></article>)}
    </div>

    <p className="mt-4 rounded-2xl bg-sky-400/[0.045] p-4 text-xs leading-5 text-gray-400 ring-1 ring-sky-300/10">{t.accounting}</p>

    {!hasData ? <div role="status" className="mt-4 flex min-h-44 flex-col items-center justify-center rounded-[1.65rem] bg-black/10 px-6 py-10 text-center ring-1 ring-inset ring-white/[0.055]">
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/[0.04] text-gray-400 ring-1 ring-white/[0.07]"><CalendarDays className="h-5 w-5" aria-hidden="true" /></div>
      <p className="mt-4 font-bold text-gray-200">{t.empty}</p><p className="mt-1 max-w-md text-sm leading-6 text-gray-500">{t.emptyHint}</p>
    </div> : monthGroups.length > 0 && <div className="mt-4 grid gap-3">
      {monthGroups.map(({ month, costs: monthCosts }) => {
        const monthUsd = monthCosts.reduce((sum, cost) => sum + cost.creditCostUsd, 0);
        const monthHours = monthCosts.reduce((sum, cost) => sum + cost.hostedHours, 0);
        return <details key={month} className="group overflow-hidden rounded-[1.65rem] bg-white/[0.035] ring-1 ring-white/[0.065]">
          <summary className="flex cursor-pointer list-none flex-col gap-2 p-5 marker:hidden sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div><h3 className="font-heading text-lg font-black capitalize text-white">{monthLabel(month, language)}</h3><p className="mt-1 text-xs text-gray-500">{monthCosts.length} {t.races} · {monthHours} {t.hours} · {t.details}</p></div>
            <p className="shrink-0 font-heading text-xl font-black text-white">{usd(monthUsd, language)}</p>
          </summary>
          <div className="divide-y divide-white/[0.055] border-t border-white/[0.06]">
            {monthCosts.map((cost) => <article key={`${cost.date}-${cost.raceName}-${cost.track}`} className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-6">
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h4 className="font-bold text-gray-200">{cost.raceName}</h4><span className="rounded-full bg-orange-400/10 px-2 py-1 text-[9px] font-black uppercase tracking-wider text-orange-200">{cost.raceScope === "season" ? cost.leagueName || t.seasonRace : t.standaloneRace}</span></div><p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500"><span className="inline-flex items-center gap-1"><CalendarDays className="h-3 w-3 text-orange-400" />{dateLabel(cost.date, language)}</span><span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3 text-orange-400" />{cost.track}</span><span className="inline-flex items-center gap-1"><Clock3 className="h-3 w-3 text-orange-400" />{cost.hostedHours}u</span>{cost.discountApplied && <span className="inline-flex items-center gap-1 text-orange-200"><Percent className="h-3 w-3 text-orange-400" />{t.discounted}</span>}</p></div>
              <p className="font-heading text-lg font-black text-white">{usd(cost.creditCostUsd, language)}</p>
            </article>)}
          </div>
        </details>;
      })}
    </div>}
  </section>;
};

export default RaceCostsOverview;
