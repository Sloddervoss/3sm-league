import { useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  Flag,
  Heart,
  ReceiptText,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { SUPPORT_CATEGORY_LABELS, type PublicSupportLedgerEntry, type PublicSupportRaceCost, type SupportLedgerCategory } from "../types";
import RaceCostsOverview from "./RaceCostsOverview";

type Language = "nl" | "en";
type Tab = "transactions" | "races";

type Props = {
  language: Language;
  selectedYear: string;
  selectedMonth: string;
  availableMonths: string[];
  onSelectedMonthChange: (month: string) => void;
  annualLedger: PublicSupportLedgerEntry[];
  visibleLedger: PublicSupportLedgerEntry[];
  raceCosts: PublicSupportRaceCost[];
  totalRaceCount: number;
  raceCostTotalEur: number;
  summary: {
    operationalExpenses: number;
    communityCovered: number;
    selfFunded: number;
    reserve: number;
  };
};

const COPY = {
  nl: {
    eyebrow: "Open boek",
    title: "Seizoensboek",
    intro: "Alle openbare inkomsten en overige uitgaven staan bij Transacties. Hosted Sessions staan apart bij Racehosting, zodat dezelfde races niet dubbel als lange lijst verschijnen.",
    transactions: "Transacties",
    races: "Racehosting",
    costs: "Kosten seizoen",
    covered: "Community",
    selfFunded: "3SM",
    reserve: "Reserve",
    period: "Periode",
    allMonths: "Hele seizoen",
    expenseBreakdown: "Kostenverdeling seizoen",
    date: "Datum",
    category: "Categorie",
    income: "Inkomst",
    expense: "Uitgave",
    protectedAmount: "Afgeschermd",
    empty: "Geen openbare overige transacties voor deze periode.",
    emptyHint: "Racehosting staat in het aparte tabblad Racehosting.",
  },
  en: {
    eyebrow: "Open ledger",
    title: "Season ledger",
    intro: "Public income and other expenses are listed under Transactions. Hosted Sessions have their own Race hosting tab, so the same races are not repeated as another long list.",
    transactions: "Transactions",
    races: "Race hosting",
    costs: "Season costs",
    covered: "Community",
    selfFunded: "3SM",
    reserve: "Reserve",
    period: "Period",
    allMonths: "Full season",
    expenseBreakdown: "Season cost breakdown",
    date: "Date",
    category: "Category",
    income: "Income",
    expense: "Expense",
    protectedAmount: "Private",
    empty: "No public non-race transactions for this period.",
    emptyHint: "Race hosting is available in the separate Race hosting tab.",
  },
} as const;

const money = (value: number, language: Language) => new Intl.NumberFormat(language === "en" ? "en-GB" : "nl-NL", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
}).format(value);

const dateLabel = (value: string, language: Language) => {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat(language === "en" ? "en-GB" : "nl-NL", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(year, month - 1, day));
};

const monthLabel = (value: string, language: Language) => {
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(language === "en" ? "en-GB" : "nl-NL", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
};

const Summary = ({ label, value, icon, accent = false }: { label: string; value: string; icon: React.ReactNode; accent?: boolean }) => <div className={`rounded-xl p-3 ring-1 ${accent ? "bg-orange-500/[0.09] ring-orange-400/20" : "bg-white/[0.035] ring-white/[0.06]"}`}>
  <div className={`flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.13em] ${accent ? "text-orange-300" : "text-gray-500"}`}>{icon}{label}</div>
  <p className="mt-1.5 font-heading text-lg font-black tabular-nums text-white sm:text-xl">{value}</p>
</div>;

const SeasonLedgerModal = ({ language, selectedYear, selectedMonth, availableMonths, onSelectedMonthChange, annualLedger, visibleLedger, raceCosts, totalRaceCount, raceCostTotalEur, summary }: Props) => {
  const t = COPY[language];
  const [activeTab, setActiveTab] = useState<Tab>("transactions");
  const nonRaceLedger = useMemo(() => visibleLedger.filter((entry) => entry.category !== "race_hosting"), [visibleLedger]);
  const spending = useMemo(() => {
    const totals = new Map<SupportLedgerCategory, number>();
    annualLedger.filter((entry) => entry.direction === "expense").forEach((entry) => totals.set(entry.category, (totals.get(entry.category) || 0) + (entry.amount ?? 0)));
    return [...totals.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
  }, [annualLedger]);
  const spendingTotal = spending.reduce((sum, item) => sum + item.amount, 0);

  return <div className="min-h-[70vh]">
    <header className="relative overflow-hidden border-b border-white/[0.065] px-5 pb-6 pt-7 sm:px-8 sm:pb-7 sm:pt-8">
      <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(circle_at_80%_0%,rgba(249,115,22,0.16),transparent_38%),linear-gradient(135deg,#11141d_0%,#0d0f16_100%)]" />
      <div className="relative pr-10">
        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-orange-400"><ReceiptText className="h-3.5 w-3.5" />{t.eyebrow} · {selectedYear}</div>
        <h2 className="mt-2 font-heading text-2xl font-black uppercase text-white sm:text-3xl">{t.title}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-400">{t.intro}</p>
      </div>
      <div className="relative mt-5 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Summary label={t.costs} value={money(summary.operationalExpenses, language)} icon={<ReceiptText className="h-3 w-3" />} />
        <Summary label={t.covered} value={money(summary.communityCovered, language)} icon={<Heart className="h-3 w-3" />} accent />
        <Summary label={t.selfFunded} value={money(summary.selfFunded, language)} icon={<WalletCards className="h-3 w-3" />} />
        <Summary label={t.reserve} value={money(summary.reserve, language)} icon={<ShieldCheck className="h-3 w-3" />} />
      </div>
    </header>

    <div className="sticky top-0 z-10 border-b border-white/[0.065] bg-[#0e0e16]/95 px-4 py-3 backdrop-blur sm:px-8">
      <div role="tablist" aria-label={t.title} className="grid grid-cols-2 gap-1 rounded-xl bg-black/25 p-1 ring-1 ring-white/[0.055]">
        <button type="button" role="tab" aria-selected={activeTab === "transactions"} onClick={() => setActiveTab("transactions")} className={`flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 text-xs font-black uppercase tracking-wider transition ${activeTab === "transactions" ? "bg-orange-500/15 text-orange-200 ring-1 ring-orange-400/20" : "text-gray-500 hover:text-gray-200"}`}><ReceiptText className="h-4 w-4" />{t.transactions}</button>
        <button type="button" role="tab" aria-selected={activeTab === "races"} aria-label={`${t.races} (${totalRaceCount})`} onClick={() => setActiveTab("races")} className={`flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 text-xs font-black uppercase tracking-wider transition ${activeTab === "races" ? "bg-orange-500/15 text-orange-200 ring-1 ring-orange-400/20" : "text-gray-500 hover:text-gray-200"}`}><Flag className="h-4 w-4" />{t.races}<span className="rounded-full bg-white/[0.06] px-2 py-0.5 tabular-nums text-gray-300">{totalRaceCount}</span></button>
      </div>
    </div>

    <div className="p-4 sm:p-8">
      {activeTab === "transactions" ? <div role="tabpanel" className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0 flex-1">
            <h3 className="font-heading text-lg font-black uppercase text-white">{t.expenseBreakdown}</h3>
            {spending.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{spending.map((item) => {
              const percent = spendingTotal > 0 ? Math.round((item.amount / spendingTotal) * 100) : 0;
              return <div key={item.category} className="rounded-xl bg-white/[0.035] px-3 py-2 text-xs ring-1 ring-white/[0.06]"><span className="font-bold text-gray-300">{SUPPORT_CATEGORY_LABELS[item.category][language]}</span><span className="ml-2 font-heading font-black text-white">{money(item.amount, language)}</span><span className="ml-1 text-gray-600">{percent}%</span></div>;
            })}</div>}
          </div>
          <label className="block w-full lg:w-56">
            <span className="mb-2 block text-[10px] font-black uppercase tracking-[0.14em] text-gray-500">{t.period}</span>
            <select value={selectedMonth} onChange={(event) => onSelectedMonthChange(event.target.value)} className="h-11 w-full rounded-xl border-0 bg-white/[0.055] px-3 text-sm font-bold text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-orange-400">
              <option value="all" className="bg-[#151821]">{t.allMonths} {selectedYear}</option>
              {availableMonths.map((month) => <option key={month} value={month} className="bg-[#151821]">{monthLabel(month, language)}</option>)}
            </select>
          </label>
        </div>

        {nonRaceLedger.length === 0 ? <div role="status" className="rounded-2xl bg-black/15 px-5 py-10 text-center ring-1 ring-white/[0.055]"><CalendarDays className="mx-auto h-5 w-5 text-gray-500" /><p className="mt-3 font-bold text-gray-300">{t.empty}</p><p className="mt-1 text-sm text-gray-600">{t.emptyHint}</p></div> : <div className="overflow-hidden rounded-2xl bg-white/[0.025] ring-1 ring-white/[0.06]">
          {nonRaceLedger.map((entry) => <article key={entry.id} className="flex flex-col gap-3 border-b border-white/[0.055] px-4 py-4 last:border-0 sm:flex-row sm:items-center sm:gap-4">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${entry.direction === "income" ? "bg-emerald-400/10 text-emerald-300" : "bg-rose-400/10 text-rose-300"}`}>{entry.direction === "income" ? <ArrowDownRight className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}</span>
              <div className="min-w-0"><h4 className="font-bold text-gray-200">{entry.description}</h4><p className="mt-1 text-xs text-gray-500">{dateLabel(entry.date, language)} · {SUPPORT_CATEGORY_LABELS[entry.category][language]}{entry.supporterName ? ` · ${entry.supporterName}` : ""}</p></div>
            </div>
            <div className="flex items-center justify-between gap-3 pl-11 sm:block sm:pl-0 sm:text-right"><span className={`text-[9px] font-black uppercase tracking-wider ${entry.direction === "income" ? "text-emerald-300" : "text-rose-300"}`}>{entry.direction === "income" ? t.income : t.expense}</span><p className="font-heading text-lg font-black tabular-nums text-white">{entry.amount === null ? t.protectedAmount : money(entry.amount, language)}</p></div>
          </article>)}
        </div>}
      </div> : <div role="tabpanel"><RaceCostsOverview language={language} selectedYear={selectedYear} costs={raceCosts} totalCount={totalRaceCount} totalAmountEur={raceCostTotalEur} /></div>}
    </div>
  </div>;
};

export default SeasonLedgerModal;
