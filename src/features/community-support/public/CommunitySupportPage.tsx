import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  ExternalLink,
  Heart,
  Info,
  Package,
  ReceiptText,
  Server,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Users,
  WalletCards,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { useLanguage } from "@/i18n/useLanguage";
import { setSeoMeta } from "@/lib/seo";
import { COMMUNITY_SUPPORT_PUBLIC, monthKey, publicLedgerForMonth, publicLedgerForYear, supportMetricsForYear } from "../model";
import { useCommunitySupport } from "../store";
import { SUPPORT_CATEGORY_LABELS, type PublicSupportLedgerEntry, type SupportLedgerCategory } from "../types";

const DISCORD_URL = "https://discord.gg/H7tZVuzBgT";

type Language = "nl" | "en";

const getCopy = (language: Language) => language === "en" ? {
  eyebrow: "Community Support · race season",
  title: "Together, we keep 3SM on track",
  intro: "3SM keeps racing, with or without contributions. This page shows what we have funded ourselves this season and what the community has voluntarily carried. Would you like to help with the costs voluntarily? You can — never feel obliged.",
  transparency: "Open paddock, clear figures",
  transparencyText: "We show the season's public income and expenses openly. Contributions are optional and never determine whether 3SM continues.",
  monthOverview: "Season overview",
  selectMonth: "Transaction detail",
  selectYear: "Select season",
  allMonths: "Full season",
  costs: "Season costs",
  covered: "Carried by community",
  selfFunded: "Carried by 3SM",
  reserve: "Reserve for upcoming races",
  coveredStatus: "The community has carried these season costs together with 3SM.",
  partialStatus: "The community is voluntarily driving part of this season with us.",
  openStatus: "3SM has carried the recorded season costs itself so far.",
  noCostsStatus: "No operational costs have been recorded for this season yet.",
  progressLabel: "Distribution of season costs between the community and 3SM",
  noTarget: "This is a transparent cost overview, not a donation target.",
  supportTitle: "Contribute voluntarily",
  supportCta: "See how you can contribute",
  supportIntro: "3SM keeps going either way. If you would like to contribute voluntarily toward the season's costs, choose what suits you — without obligation.",
  paypalTitle: "Voluntary contribution",
  paypalText: "PayPal support is available. Request the current payment link through our Discord so you always use the verified 3SM destination.",
  paypalCta: "Request PayPal link",
  paypalOffTitle: "Financial support",
  paypalOffText: "Direct PayPal contributions are not currently enabled. You can still help in the other ways below.",
  merchandiseTitle: "Community merchandise",
  merchandiseText: "Merchandise supports the community through its net proceeds. Available items are shown below.",
  shareTitle: "Build the grid",
  shareText: "Invite respectful drivers, join events and help others on Discord. A strong community is our most valuable support.",
  discordCta: "Open Discord",
  merchandiseSection: "Community merchandise",
  merchandiseIntro: "Products entered by 3SM are shown here with their current price and availability.",
  concept: "Concept",
  active: "Available",
  soldOut: "Out of stock",
  stock: "in stock",
  merchandiseEmpty: "There are no community products available at the moment.",
  merchandiseEmptyHint: "New items will appear here after they have been added and made available by 3SM.",
  spendingTitle: "Where the season costs sit",
  spendingIntro: "A category breakdown of the public expenses recorded for the selected season.",
  spendingEmpty: "No public expenses have been recorded for this season.",
  spendingEmptyHint: "When costs are published, their categories and totals will appear here.",
  ledgerTitle: "Season ledger",
  ledgerIntro: "View the full season or select a month to inspect public income, expenses and active recurring costs.",
  date: "Date",
  description: "Description",
  category: "Category",
  amount: "Amount",
  income: "Income",
  expense: "Expense",
  protectedAmount: "Private",
  ledgerEmpty: "No public ledger entries for this period.",
  ledgerEmptyHint: "Choose another month or view the full season.",
  supportersTitle: "Season supporters",
  supportersIntro: "Voluntary contributions recorded this season, with each supporter's separate name and amount preferences applied.",
  anonymous: "Anonymous supporter",
  supportersEmpty: "No public contributions for this season.",
  supportersEmptyHint: "Contributions can still be present in the totals when a supporter chooses privacy.",
  privacy: "Privacy respected",
  privacyText: "Names and contribution amounts are separate choices. We only show each detail when the supporter has explicitly enabled it.",
  footerTitle: "3SM keeps racing, with or without contributions",
  footerText: "We cover the season regardless. Would you like to contribute voluntarily? Talk to the 3SM team on Discord.",
} : {
  eyebrow: "Community Support · raceseizoen",
  title: "Samen houden we 3SM op de baan",
  intro: "3SM blijft racen, met of zonder bijdragen. Hier zie je wat we dit seizoen zelf hebben gedragen en wat de community vrijwillig heeft bijgedragen. Wil je ook vrijwillig helpen met de kosten? Dat kan — voel je nooit verplicht.",
  transparency: "Open paddock, heldere cijfers",
  transparencyText: "We laten de openbare inkomsten en uitgaven van het seizoen zien. Bijdragen zijn vrijwillig en bepalen nooit of 3SM doorgaat.",
  monthOverview: "Seizoensoverzicht",
  selectMonth: "Transactiedetail",
  selectYear: "Kies een seizoen",
  allMonths: "Hele seizoen",
  costs: "Kosten seizoen",
  covered: "Gedragen door community",
  selfFunded: "Gedragen door 3SM",
  reserve: "Reserve voor komende races",
  coveredStatus: "De community heeft deze seizoenskosten samen met 3SM gedragen.",
  partialStatus: "De community rijdt vrijwillig een stukje van dit seizoen met ons mee.",
  openStatus: "3SM heeft de geregistreerde seizoenskosten tot nu toe zelf gedragen.",
  noCostsStatus: "Voor dit seizoen zijn nog geen operationele kosten geregistreerd.",
  progressLabel: "Verdeling van de seizoenskosten tussen de community en 3SM",
  noTarget: "Dit is een transparant kostenoverzicht, geen donatiedoel.",
  supportTitle: "Vrijwillig bijdragen",
  supportCta: "Bekijk hoe je kunt bijdragen",
  supportIntro: "3SM gaat sowieso door. Wil je vrijwillig bijdragen aan de kosten van het seizoen, kies dan wat bij je past — zonder enige verplichting.",
  paypalTitle: "Vrijwillige bijdrage",
  paypalText: "Steunen via PayPal is beschikbaar. Vraag de actuele betaallink via onze Discord, zodat je altijd de gecontroleerde 3SM-bestemming gebruikt.",
  paypalCta: "Vraag PayPal-link",
  paypalOffTitle: "Financieel steunen",
  paypalOffText: "Rechtstreeks bijdragen via PayPal staat momenteel niet aan. Je kunt wel op de andere manieren hieronder helpen.",
  merchandiseTitle: "Communitymerchandise",
  merchandiseText: "Merchandise steunt de community met de netto-opbrengst. Beschikbare producten staan hieronder.",
  shareTitle: "Bouw mee aan de grid",
  shareText: "Nodig sportieve coureurs uit, doe mee aan evenementen en help anderen op Discord. Een sterke community is onze waardevolste steun.",
  discordCta: "Open Discord",
  merchandiseSection: "Communitymerchandise",
  merchandiseIntro: "Door 3SM ingevoerde producten staan hier met hun actuele prijs en beschikbaarheid.",
  concept: "Concept",
  active: "Beschikbaar",
  soldOut: "Niet op voorraad",
  stock: "op voorraad",
  merchandiseEmpty: "Er zijn momenteel geen communityproducten beschikbaar.",
  merchandiseEmptyHint: "Nieuwe producten verschijnen hier zodra 3SM ze heeft toegevoegd en beschikbaar heeft gemaakt.",
  spendingTitle: "Waar de seizoenskosten zitten",
  spendingIntro: "Een verdeling van de openbaar geregistreerde uitgaven in het gekozen seizoen.",
  spendingEmpty: "Voor dit seizoen zijn geen openbare uitgaven geregistreerd.",
  spendingEmptyHint: "Zodra kosten worden gepubliceerd, verschijnen de categorieën en totalen hier.",
  ledgerTitle: "Seizoensboek",
  ledgerIntro: "Bekijk het hele seizoen of kies een maand voor de openbare inkomsten, uitgaven en actieve terugkerende kosten.",
  date: "Datum",
  description: "Omschrijving",
  category: "Categorie",
  amount: "Bedrag",
  income: "Inkomst",
  expense: "Uitgave",
  protectedAmount: "Afgeschermd",
  ledgerEmpty: "Geen openbare boekingen voor deze periode.",
  ledgerEmptyHint: "Kies een andere maand of bekijk het hele seizoen.",
  supportersTitle: "Supporters van dit seizoen",
  supportersIntro: "Vrijwillige bijdragen in het gekozen seizoen, met de losse voorkeuren voor naam en bedrag van iedere supporter toegepast.",
  anonymous: "Anonieme supporter",
  supportersEmpty: "Geen openbare bijdragen voor dit seizoen.",
  supportersEmptyHint: "Bijdragen kunnen wel in totalen meetellen wanneer een supporter voor privacy kiest.",
  privacy: "Privacy gerespecteerd",
  privacyText: "Naam en bijdragebedrag zijn losse keuzes. We tonen elk detail alleen wanneer de supporter dit expliciet heeft toegestaan.",
  footerTitle: "3SM blijft racen, met of zonder bijdrage",
  footerText: "Wij dragen de kosten sowieso. Wil je vrijwillig bijdragen? Bespreek het met het 3SM-team op Discord.",
};

const formatMoney = (value: number, language: Language) => new Intl.NumberFormat(language === "en" ? "en-NL" : "nl-NL", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
}).format(value);

const formatMonth = (value: string, language: Language) => {
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(language === "en" ? "en-GB" : "nl-NL", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
};

const formatDate = (value: string, language: Language) => {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat(language === "en" ? "en-GB" : "nl-NL", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(year, month - 1, day));
};

const Surface = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
  <section className={`rounded-[1.65rem] bg-white/[0.035] shadow-2xl shadow-black/20 ring-1 ring-white/[0.065] ${className}`}>{children}</section>
);

const SectionHeading = ({ icon, eyebrow, title, intro, action }: { icon: ReactNode; eyebrow: string; title: string; intro: string; action?: ReactNode }) => (
  <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
    <div className="max-w-2xl">
      <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.22em] text-orange-400">{icon}{eyebrow}</div>
      <h2 className="mt-2 font-heading text-2xl font-black uppercase leading-tight text-white sm:text-3xl">{title}</h2>
      <p className="mt-3 text-sm leading-6 text-gray-400 sm:text-base">{intro}</p>
    </div>
    {action}
  </div>
);

const EmptyState = ({ icon, title, hint }: { icon: ReactNode; title: string; hint: string }) => (
  <div role="status" className="flex min-h-44 flex-col items-center justify-center rounded-2xl bg-black/10 px-6 py-10 text-center ring-1 ring-inset ring-white/[0.055]">
    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/[0.04] text-gray-400 ring-1 ring-white/[0.07]">{icon}</div>
    <p className="mt-4 font-bold text-gray-200">{title}</p>
    <p className="mt-1 max-w-md text-sm leading-6 text-gray-500">{hint}</p>
  </div>
);

const amountIsPrivate = (entry: PublicSupportLedgerEntry) => entry.amount === null;

const MetricCard = ({ label, value, icon, accent = false }: { label: string; value: string; icon: ReactNode; accent?: boolean }) => (
  <div className={`rounded-2xl p-4 ring-1 ${accent ? "bg-orange-500/[0.08] ring-orange-400/20" : "bg-black/15 ring-white/[0.055]"}`}>
    <div className={`flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] ${accent ? "text-orange-300" : "text-gray-500"}`}>{icon}{label}</div>
    <p className="mt-2 font-heading text-xl font-black tabular-nums text-white sm:text-2xl">{value}</p>
  </div>
);

const CommunitySupportPage = () => {
  const { language } = useLanguage();
  const { state } = useCommunitySupport();
  const lang: Language = language === "en" ? "en" : "nl";
  const copy = getCopy(lang);
  const currentMonth = monthKey(new Date());
  const currentYear = currentMonth.slice(0, 4);

  const availableYears = useMemo(() => Array.from(new Set([
    currentYear,
    ...state.ledger.map((entry) => entry.date.slice(0, 4)),
    ...state.recurringCosts.map((cost) => cost.startsOn.slice(0, 4)),
  ].filter((value) => /^\d{4}$/.test(value)))).sort((a, b) => b.localeCompare(a)), [currentYear, state.ledger, state.recurringCosts]);

  const initialYear = useMemo(() => {
    const queryYear = new URLSearchParams(window.location.search).get("year");
    return queryYear && availableYears.includes(queryYear) ? queryYear : currentYear;
  }, [availableYears, currentYear]);
  const [selectedYear, setSelectedYear] = useState(initialYear);
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const queryMonth = new URLSearchParams(window.location.search).get("month");
    return queryMonth && /^\d{4}-\d{2}$/.test(queryMonth) && queryMonth.startsWith(initialYear) ? queryMonth : "all";
  });

  const availableMonths = useMemo(() => Array.from({ length: 12 }, (_, index) => `${selectedYear}-${String(index + 1).padStart(2, "0")}`), [selectedYear]);

  useEffect(() => {
    if (!availableYears.includes(selectedYear)) setSelectedYear(currentYear);
    if (selectedMonth !== "all" && !selectedMonth.startsWith(selectedYear)) setSelectedMonth("all");
  }, [availableYears, currentYear, selectedMonth, selectedYear]);

  const updateUrlPeriod = (year: string, month: string) => {
    const url = new URL(window.location.href);
    if (year === currentYear) url.searchParams.delete("year");
    else url.searchParams.set("year", year);
    if (month === "all") url.searchParams.delete("month");
    else url.searchParams.set("month", month);
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  };

  const selectYear = (nextYear: string) => {
    setSelectedYear(nextYear);
    setSelectedMonth("all");
    updateUrlPeriod(nextYear, "all");
  };

  const selectMonth = (nextMonth: string) => {
    setSelectedMonth(nextMonth);
    updateUrlPeriod(selectedYear, nextMonth);
  };

  const metrics = useMemo(() => supportMetricsForYear(state, selectedYear), [state, selectedYear]);
  const annualPublicLedger = useMemo(() => publicLedgerForYear(state, selectedYear), [state, selectedYear]);
  const publicLedger = useMemo(() => selectedMonth === "all" ? annualPublicLedger : publicLedgerForMonth(state, selectedMonth), [annualPublicLedger, selectedMonth, state]);
  const products = useMemo(() => state.products.filter((product) => COMMUNITY_SUPPORT_PUBLIC
    ? product.active && !product.concept
    : product.active || product.concept), [state.products]);

  const spending = useMemo(() => {
    const totals = new Map<SupportLedgerCategory, number>();
    annualPublicLedger.filter((entry) => entry.direction === "expense").forEach((entry) => totals.set(entry.category, (totals.get(entry.category) || 0) + (entry.amount ?? 0)));
    return Array.from(totals.entries()).map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
  }, [annualPublicLedger]);
  const spendingTotal = spending.reduce((sum, item) => sum + item.amount, 0);

  const supporters = useMemo(() => annualPublicLedger.filter((entry) =>
    entry.direction === "income" && entry.category === "contribution",
  ), [annualPublicLedger]);

  useEffect(() => {
    setSeoMeta(lang === "en" ? {
      title: "Community Support | 3 Stripe Motorsport",
      description: "See what 3SM has carried this race season and what the community has voluntarily contributed, with transparent annual figures and optional monthly detail.",
      canonicalUrl: "https://3stripemotorsport.cc/support/",
      ogTitle: "Community Support · 3SM race season",
      ogDescription: "3SM keeps racing. See the season costs and how you can contribute voluntarily.",
    } : {
      title: "Community Support | 3 Stripe Motorsport",
      description: "Bekijk wat 3SM dit raceseizoen zelf heeft gedragen en wat de community vrijwillig heeft bijgedragen, met jaarcijfers en optioneel maanddetail.",
      canonicalUrl: "https://3stripemotorsport.cc/support/",
      ogTitle: "Community Support · 3SM-raceseizoen",
      ogDescription: "3SM blijft racen. Bekijk de seizoenskosten en hoe je vrijwillig kunt bijdragen.",
    });
  }, [lang]);

  const seasonStatus = metrics.operationalExpenses === 0
    ? copy.noCostsStatus
    : metrics.coveragePercent >= 100
      ? copy.coveredStatus
      : metrics.communityCovered > 0
        ? copy.partialStatus
        : copy.openStatus;

  return (
    <div className="min-h-screen bg-background text-gray-100">
      <Navbar />
      <main className="overflow-hidden pt-16">
        <header className="relative border-b border-white/[0.055]">
          <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(circle_at_70%_18%,rgba(249,115,22,0.14),transparent_31%),radial-gradient(circle_at_15%_80%,rgba(234,88,12,0.07),transparent_30%),linear-gradient(180deg,#11141c_0%,#0d1016_100%)]" />
          <div aria-hidden="true" className="absolute -right-24 top-10 h-72 w-72 rounded-full border border-orange-400/[0.08]" />
          <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[1.25fr_0.75fr] lg:items-center lg:px-8 lg:py-24">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-orange-500/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-orange-300 ring-1 ring-orange-400/20">
                <Heart className="h-3.5 w-3.5" aria-hidden="true" /> {copy.eyebrow} {selectedYear}
              </div>
              <h1 className="mt-6 max-w-3xl font-heading text-4xl font-black uppercase leading-[0.98] text-white sm:text-5xl lg:text-6xl">{copy.title}</h1>
              <p className="mt-6 max-w-2xl text-base leading-7 text-gray-300 sm:text-lg">{copy.intro}</p>
              <a href="#support-options" className="mt-8 inline-flex h-12 items-center gap-2 rounded-xl bg-gradient-racing px-5 font-heading text-sm font-black uppercase tracking-wider text-white shadow-lg shadow-orange-950/30 transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300">
                {copy.supportCta}<ChevronRight className="h-4 w-4" aria-hidden="true" />
              </a>
            </div>
            <div className="rounded-[1.75rem] bg-black/20 p-6 shadow-2xl shadow-black/25 ring-1 ring-white/[0.08] backdrop-blur sm:p-7">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-500/10 text-orange-300 ring-1 ring-orange-400/20"><ShieldCheck className="h-5 w-5" aria-hidden="true" /></div>
              <h2 className="mt-5 font-heading text-xl font-black uppercase text-white">{copy.transparency}</h2>
              <p className="mt-3 text-sm leading-6 text-gray-400">{copy.transparencyText}</p>
              <div className="mt-6 flex items-center gap-3 border-t border-white/[0.07] pt-5 text-xs font-bold uppercase tracking-wider text-gray-500">
                <CalendarDays className="h-4 w-4 text-orange-400" aria-hidden="true" /> {lang === "en" ? "Race season" : "Raceseizoen"} {selectedYear}
              </div>
            </div>
          </div>
        </header>

        <div className="bg-[radial-gradient(circle_at_50%_12%,rgba(249,115,22,0.055),transparent_26%),linear-gradient(180deg,#0d1016_0%,#0b0e14_100%)]">
          <div className="mx-auto max-w-6xl space-y-20 px-4 py-14 sm:px-6 sm:py-18 lg:px-8 lg:py-20">
            <Surface className="overflow-hidden p-5 sm:p-7 lg:p-8">
              <div className="flex flex-col gap-5 border-b border-white/[0.065] pb-6 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.22em] text-orange-400"><CircleDollarSign className="h-4 w-4" aria-hidden="true" />{copy.monthOverview}</div>
                  <h2 className="mt-2 font-heading text-2xl font-black uppercase text-white sm:text-3xl">{lang === "en" ? "Race season" : "Raceseizoen"} {selectedYear}</h2>
                </div>
                <label className="block sm:min-w-56">
                  <span className="mb-2 block text-[11px] font-black uppercase tracking-[0.14em] text-gray-500">{copy.selectYear}</span>
                  <select value={selectedYear} onChange={(event) => selectYear(event.target.value)} className="h-11 w-full rounded-xl border-0 bg-white/[0.055] px-3 text-sm font-bold text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-orange-400">
                    {availableYears.map((year) => <option key={year} value={year} className="bg-[#151821]">{lang === "en" ? "Season" : "Seizoen"} {year}</option>)}
                  </select>
                </label>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCard label={copy.costs} value={formatMoney(metrics.operationalExpenses, lang)} icon={<ReceiptText className="h-3.5 w-3.5" aria-hidden="true" />} />
                <MetricCard label={copy.covered} value={formatMoney(metrics.communityCovered, lang)} icon={<Heart className="h-3.5 w-3.5" aria-hidden="true" />} accent />
                <MetricCard label={copy.selfFunded} value={formatMoney(metrics.selfFunded, lang)} icon={<WalletCards className="h-3.5 w-3.5" aria-hidden="true" />} />
                <MetricCard label={copy.reserve} value={formatMoney(metrics.reserve, lang)} icon={<ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />} />
              </div>

              <div className="mt-6 rounded-2xl bg-black/15 p-5 ring-1 ring-white/[0.055]">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-orange-400" aria-hidden="true" />
                  <p className="text-sm font-bold text-gray-200">{seasonStatus}</p>
                </div>
                <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-white/[0.06]" role="img" aria-label={`${copy.progressLabel}: Community ${metrics.coveragePercent}%, 3SM ${Math.max(0, 100 - metrics.coveragePercent)}%`}>
                  <div className="h-full bg-gradient-to-r from-orange-600 via-orange-500 to-amber-400 transition-[width] duration-500" style={{ width: `${metrics.coveragePercent}%` }} />
                  <div className="h-full bg-white/[0.12] transition-[width] duration-500" style={{ width: `${Math.max(0, 100 - metrics.coveragePercent)}%` }} />
                </div>
                <div className="mt-3 flex items-center justify-between gap-4 text-xs font-bold tabular-nums">
                  <span className="text-orange-300">Community {metrics.coveragePercent}%</span>
                  <span className="text-gray-400">3SM {Math.max(0, 100 - metrics.coveragePercent)}%</span>
                </div>
                <p className="mt-3 text-xs text-gray-500">{copy.noTarget}</p>
              </div>
            </Surface>

            <section id="support-options" className="scroll-mt-24">
              <SectionHeading icon={<Heart className="h-4 w-4" aria-hidden="true" />} eyebrow={copy.eyebrow} title={copy.supportTitle} intro={copy.supportIntro} />
              <div className="grid gap-4 lg:grid-cols-3">
                <Surface className="flex flex-col p-6">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-500/10 text-orange-300 ring-1 ring-orange-400/20"><CircleDollarSign className="h-5 w-5" aria-hidden="true" /></div>
                  <h3 className="mt-5 font-heading text-lg font-black uppercase text-white">{state.settings.paypalEnabled ? copy.paypalTitle : copy.paypalOffTitle}</h3>
                  <p className="mt-2 flex-1 text-sm leading-6 text-gray-400">{state.settings.paypalEnabled ? copy.paypalText : copy.paypalOffText}</p>
                  {state.settings.paypalEnabled && <a href={DISCORD_URL} target="_blank" rel="noreferrer" className="mt-5 inline-flex items-center gap-2 self-start rounded-xl bg-gradient-racing px-4 py-2.5 text-sm font-black text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300">{copy.paypalCta}<ExternalLink className="h-4 w-4" aria-hidden="true" /></a>}
                </Surface>
                <Surface className="flex flex-col p-6">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/[0.045] text-gray-200 ring-1 ring-white/[0.08]"><ShoppingBag className="h-5 w-5" aria-hidden="true" /></div>
                  <h3 className="mt-5 font-heading text-lg font-black uppercase text-white">{copy.merchandiseTitle}</h3>
                  <p className="mt-2 flex-1 text-sm leading-6 text-gray-400">{copy.merchandiseText}</p>
                  <a href="#merchandise" className="mt-5 inline-flex items-center gap-1 self-start text-sm font-black text-orange-300 transition hover:text-orange-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300">{copy.merchandiseSection}<ChevronRight className="h-4 w-4" aria-hidden="true" /></a>
                </Surface>
                <Surface className="flex flex-col p-6">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/[0.045] text-gray-200 ring-1 ring-white/[0.08]"><Users className="h-5 w-5" aria-hidden="true" /></div>
                  <h3 className="mt-5 font-heading text-lg font-black uppercase text-white">{copy.shareTitle}</h3>
                  <p className="mt-2 flex-1 text-sm leading-6 text-gray-400">{copy.shareText}</p>
                  <a href={DISCORD_URL} target="_blank" rel="noreferrer" className="mt-5 inline-flex items-center gap-2 self-start text-sm font-black text-orange-300 transition hover:text-orange-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300">{copy.discordCta}<ExternalLink className="h-4 w-4" aria-hidden="true" /></a>
                </Surface>
              </div>
            </section>

            <section id="merchandise" className="scroll-mt-24">
              <SectionHeading icon={<Package className="h-4 w-4" aria-hidden="true" />} eyebrow={copy.merchandiseTitle} title={copy.merchandiseSection} intro={copy.merchandiseIntro} />
              {products.length === 0 ? <EmptyState icon={<ShoppingBag className="h-5 w-5" aria-hidden="true" />} title={copy.merchandiseEmpty} hint={copy.merchandiseEmptyHint} /> : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {products.map((product) => <Surface key={product.id} className="overflow-hidden">
                    {product.imageUrl ? <div className="aspect-[16/10] overflow-hidden bg-black/20"><img src={product.imageUrl} alt={product.name} loading="lazy" className="h-full w-full object-cover" /></div> : <div className="flex aspect-[16/10] items-center justify-center bg-[radial-gradient(circle_at_center,rgba(249,115,22,0.10),transparent_65%)] text-orange-300"><ShoppingBag className="h-9 w-9" aria-hidden="true" /></div>}
                    <div className="p-5">
                      <div className="flex flex-wrap items-center gap-2">
                        {!COMMUNITY_SUPPORT_PUBLIC && product.concept && <span className="rounded-full bg-amber-400/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-amber-200 ring-1 ring-amber-300/20">{copy.concept}</span>}
                        {product.active && <span className="rounded-full bg-emerald-400/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-emerald-200 ring-1 ring-emerald-300/20">{copy.active}</span>}
                      </div>
                      <h3 className="mt-4 font-heading text-xl font-black text-white">{product.name}</h3>
                      <p className="mt-2 min-h-12 text-sm leading-6 text-gray-400">{product.description}</p>
                      <div className="mt-5 flex items-end justify-between gap-3 border-t border-white/[0.065] pt-4">
                        <span className="font-heading text-xl font-black text-white">{formatMoney(product.price, lang)}</span>
                        <span className={`text-xs font-bold ${product.stock > 0 ? "text-gray-400" : "text-rose-300"}`}>{product.stock > 0 ? `${product.stock} ${copy.stock}` : copy.soldOut}</span>
                      </div>
                    </div>
                  </Surface>)}
                </div>
              )}
            </section>

            <section>
              <SectionHeading icon={<Server className="h-4 w-4" aria-hidden="true" />} eyebrow={copy.monthOverview} title={copy.spendingTitle} intro={copy.spendingIntro} />
              {spending.length === 0 ? <EmptyState icon={<ReceiptText className="h-5 w-5" aria-hidden="true" />} title={copy.spendingEmpty} hint={copy.spendingEmptyHint} /> : (
                <Surface className="p-5 sm:p-7">
                  <div className="space-y-5">
                    {spending.map((item) => {
                      const percent = spendingTotal > 0 ? Math.round((item.amount / spendingTotal) * 100) : 0;
                      return <div key={item.category}>
                        <div className="mb-2 flex items-center justify-between gap-4 text-sm">
                          <span className="font-bold text-gray-200">{SUPPORT_CATEGORY_LABELS[item.category][lang]}</span>
                          <span className="shrink-0 font-heading font-black tabular-nums text-white">{formatMoney(item.amount, lang)} <span className="ml-1 text-xs text-gray-500">{percent}%</span></span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-white/[0.055]"><div className="h-full rounded-full bg-gradient-to-r from-orange-600 to-orange-400" style={{ width: `${percent}%` }} /></div>
                      </div>;
                    })}
                  </div>
                </Surface>
              )}
            </section>

            <section>
              <SectionHeading
                icon={<ReceiptText className="h-4 w-4" aria-hidden="true" />}
                eyebrow={copy.transparency}
                title={copy.ledgerTitle}
                intro={copy.ledgerIntro}
                action={<label className="block w-full sm:w-56">
                  <span className="mb-2 block text-[11px] font-black uppercase tracking-[0.14em] text-gray-500">{copy.selectMonth}</span>
                  <select value={selectedMonth} onChange={(event) => selectMonth(event.target.value)} className="h-11 w-full rounded-xl border-0 bg-white/[0.055] px-3 text-sm font-bold text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-orange-400">
                    <option value="all" className="bg-[#151821]">{copy.allMonths} {selectedYear}</option>
                    {availableMonths.map((month) => <option key={month} value={month} className="bg-[#151821]">{formatMonth(month, lang)}</option>)}
                  </select>
                </label>}
              />
              {publicLedger.length === 0 ? <EmptyState icon={<CalendarDays className="h-5 w-5" aria-hidden="true" />} title={copy.ledgerEmpty} hint={copy.ledgerEmptyHint} /> : (
                <Surface className="overflow-hidden">
                  <div className="space-y-3 p-4 md:hidden">
                    {publicLedger.map((entry) => <article key={entry.id} className="rounded-2xl bg-black/15 p-4 ring-1 ring-white/[0.055]">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-bold text-gray-200">{entry.description}</p>
                          {entry.supporterName && <p className="mt-1 truncate text-xs text-gray-500">{entry.supporterName}</p>}
                        </div>
                        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ring-1 ${entry.direction === "income" ? "bg-emerald-400/10 text-emerald-200 ring-emerald-300/20" : "bg-rose-400/10 text-rose-200 ring-rose-300/20"}`}>{entry.direction === "income" ? <ArrowDownRight className="h-3 w-3" aria-hidden="true" /> : <ArrowUpRight className="h-3 w-3" aria-hidden="true" />}{entry.direction === "income" ? copy.income : copy.expense}</span>
                      </div>
                      <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-white/[0.055] pt-3 text-xs">
                        <div><dt className="text-gray-600">{copy.date}</dt><dd className="mt-1 text-gray-400">{formatDate(entry.date, lang)}</dd></div>
                        <div className="text-right"><dt className="text-gray-600">{copy.amount}</dt><dd className="mt-1 font-heading font-black text-white">{amountIsPrivate(entry) ? copy.protectedAmount : formatMoney(entry.amount ?? 0, lang)}</dd></div>
                        <div className="col-span-2"><dt className="text-gray-600">{copy.category}</dt><dd className="mt-1 text-gray-400">{SUPPORT_CATEGORY_LABELS[entry.category][lang]}</dd></div>
                      </dl>
                    </article>)}
                  </div>
                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full min-w-[720px] border-collapse text-left">
                      <caption className="sr-only">{copy.ledgerTitle} — {selectedMonth === "all" ? `${copy.allMonths} ${selectedYear}` : formatMonth(selectedMonth, lang)}</caption>
                      <thead className="bg-white/[0.025] text-[10px] font-black uppercase tracking-[0.16em] text-gray-500">
                        <tr><th scope="col" className="px-5 py-4">{copy.date}</th><th scope="col" className="px-5 py-4">{copy.description}</th><th scope="col" className="px-5 py-4">{copy.category}</th><th scope="col" className="px-5 py-4">{copy.income} / {copy.expense}</th><th scope="col" className="px-5 py-4 text-right">{copy.amount}</th></tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.055]">
                        {publicLedger.map((entry) => <tr key={entry.id} className="text-sm transition hover:bg-white/[0.018]">
                          <td className="whitespace-nowrap px-5 py-4 text-gray-500">{formatDate(entry.date, lang)}</td>
                          <td className="px-5 py-4 font-bold text-gray-200">
                            {entry.description}
                            {entry.supporterName && <span className="mt-1 block text-xs font-medium text-gray-500">{entry.supporterName}</span>}
                          </td>
                          <td className="px-5 py-4 text-gray-400">{SUPPORT_CATEGORY_LABELS[entry.category][lang]}</td>
                          <td className="px-5 py-4"><span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ring-1 ${entry.direction === "income" ? "bg-emerald-400/10 text-emerald-200 ring-emerald-300/20" : "bg-rose-400/10 text-rose-200 ring-rose-300/20"}`}>{entry.direction === "income" ? <ArrowDownRight className="h-3 w-3" aria-hidden="true" /> : <ArrowUpRight className="h-3 w-3" aria-hidden="true" />}{entry.direction === "income" ? copy.income : copy.expense}</span></td>
                          <td className="whitespace-nowrap px-5 py-4 text-right font-heading font-black tabular-nums text-white">{amountIsPrivate(entry) ? <span className="text-xs text-gray-500">{copy.protectedAmount}</span> : formatMoney(entry.amount ?? 0, lang)}</td>
                        </tr>)}
                      </tbody>
                    </table>
                  </div>
                </Surface>
              )}
            </section>

            <section>
              <SectionHeading icon={<Users className="h-4 w-4" aria-hidden="true" />} eyebrow={copy.eyebrow} title={copy.supportersTitle} intro={copy.supportersIntro} />
              {supporters.length === 0 ? <EmptyState icon={<Heart className="h-5 w-5" aria-hidden="true" />} title={copy.supportersEmpty} hint={copy.supportersEmptyHint} /> : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {supporters.map((entry) => {
                    const publicName = entry.supporterName || "";
                    return <Surface key={entry.id} className="flex items-center gap-4 p-4">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-orange-500/10 font-heading font-black text-orange-300 ring-1 ring-orange-400/20">{publicName ? publicName.charAt(0).toUpperCase() : <Heart className="h-4 w-4" aria-hidden="true" />}</div>
                      <div className="min-w-0"><p className="truncate font-bold text-white">{publicName || copy.anonymous}</p><p className="mt-0.5 text-xs font-bold text-gray-500">{entry.amount === null ? copy.protectedAmount : formatMoney(entry.amount, lang)}</p></div>
                    </Surface>;
                  })}
                </div>
              )}
              <div className="mt-5 flex items-start gap-3 rounded-2xl bg-sky-400/[0.045] p-4 text-sm ring-1 ring-sky-300/10">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" aria-hidden="true" />
                <div><p className="font-bold text-gray-200">{copy.privacy}</p><p className="mt-1 leading-6 text-gray-500">{copy.privacyText}</p></div>
              </div>
            </section>

            <Surface className="relative overflow-hidden p-7 sm:p-9">
              <div aria-hidden="true" className="absolute -right-20 -top-24 h-64 w-64 rounded-full bg-orange-500/10 blur-3xl" />
              <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
                <div className="max-w-2xl">
                  <Sparkles className="h-5 w-5 text-orange-300" aria-hidden="true" />
                  <h2 className="mt-4 font-heading text-2xl font-black uppercase text-white">{copy.footerTitle}</h2>
                  <p className="mt-2 text-sm leading-6 text-gray-400">{copy.footerText}</p>
                </div>
                <a href={DISCORD_URL} target="_blank" rel="noreferrer" className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-white/[0.065] px-4 text-sm font-black text-white ring-1 ring-white/10 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300">{copy.discordCta}<ExternalLink className="h-4 w-4" aria-hidden="true" /></a>
              </div>
            </Surface>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default CommunitySupportPage;
