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
import { COMMUNITY_SUPPORT_PUBLIC, monthKey, publicLedgerForMonth, supportMetrics } from "../model";
import { useCommunitySupport } from "../store";
import { SUPPORT_CATEGORY_LABELS, type PublicSupportLedgerEntry, type SupportLedgerCategory } from "../types";

const DISCORD_URL = "https://discord.gg/H7tZVuzBgT";

type Language = "nl" | "en";

const getCopy = (language: Language) => language === "en" ? {
  eyebrow: "Powered by the community",
  title: "Together, we keep 3SM running",
  intro: "3 Stripe Motorsport is built for and by the community. Contributions help cover the real costs of our servers, website and community events — transparently and without obligation.",
  transparency: "Transparent by design",
  transparencyText: "Every public income and expense is shown per month. Private supporter preferences are always respected.",
  monthOverview: "Monthly overview",
  selectMonth: "Select month",
  costs: "Community costs",
  covered: "Covered by community",
  selfFunded: "Funded by 3SM",
  reserve: "Community reserve",
  coveredStatus: "This month's community costs are fully covered.",
  partialStatus: "The community is helping cover this month's costs.",
  openStatus: "No community contributions have been recorded for these costs yet.",
  noCostsStatus: "No operational costs have been recorded for this month.",
  progressLabel: "Share of monthly community costs covered",
  noTarget: "There is no monthly cost target for this period.",
  supportTitle: "Ways to support",
  supportIntro: "Choose what suits you. Supporting is always voluntary; participating in 3SM never depends on a contribution.",
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
  spendingTitle: "Where support goes",
  spendingIntro: "A category breakdown based on the public expenses recorded for the selected month.",
  spendingEmpty: "No public expenses have been recorded for this month.",
  spendingEmptyHint: "When costs are published, their categories and totals will appear here.",
  ledgerTitle: "Transparent monthly ledger",
  ledgerIntro: "Public income and expenses for the selected month, including active recurring costs.",
  date: "Date",
  description: "Description",
  category: "Category",
  amount: "Amount",
  income: "Income",
  expense: "Expense",
  protectedAmount: "Private",
  ledgerEmpty: "No public ledger entries for this month.",
  ledgerEmptyHint: "Choose another month or check back after entries have been published.",
  supportersTitle: "Supporter wall",
  supportersIntro: "Contributions recorded for the selected month, with each supporter's separate name and amount preferences applied.",
  anonymous: "Anonymous supporter",
  supportersEmpty: "No public contributions for this month.",
  supportersEmptyHint: "Contributions can still be present in the totals when a supporter chooses privacy.",
  privacy: "Privacy respected",
  privacyText: "Names and contribution amounts are separate choices. We only show each detail when the supporter has explicitly enabled it.",
  footerTitle: "Every contribution strengthens the community",
  footerText: "Questions about support, expenses or merchandise? Talk to the 3SM team on Discord.",
} : {
  eyebrow: "Gedragen door de community",
  title: "Samen houden we 3SM draaiend",
  intro: "3 Stripe Motorsport is gebouwd voor en door de community. Bijdragen helpen de echte kosten van onze servers, website en community-evenementen te dekken — transparant en zonder verplichting.",
  transparency: "Transparant ingericht",
  transparencyText: "Alle openbare inkomsten en uitgaven staan per maand inzichtelijk. Privékeuzes van supporters worden altijd gerespecteerd.",
  monthOverview: "Maandoverzicht",
  selectMonth: "Kies een maand",
  costs: "Communitykosten",
  covered: "Gedekt door community",
  selfFunded: "Bijgelegd door 3SM",
  reserve: "Communityreserve",
  coveredStatus: "De communitykosten van deze maand zijn volledig gedekt.",
  partialStatus: "De community helpt de kosten van deze maand te dragen.",
  openStatus: "Voor deze kosten zijn deze maand nog geen bijdragen geregistreerd.",
  noCostsStatus: "Voor deze maand zijn geen operationele kosten geregistreerd.",
  progressLabel: "Aandeel van de maandelijkse communitykosten dat is gedekt",
  noTarget: "Voor deze periode is geen maanddoel aan kosten vastgesteld.",
  supportTitle: "Manieren om te steunen",
  supportIntro: "Kies wat bij je past. Steunen is altijd vrijwillig; meedoen aan 3SM hangt nooit af van een bijdrage.",
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
  spendingTitle: "Waar de steun naartoe gaat",
  spendingIntro: "Een verdeling op basis van de openbaar geregistreerde uitgaven in de gekozen maand.",
  spendingEmpty: "Voor deze maand zijn geen openbare uitgaven geregistreerd.",
  spendingEmptyHint: "Zodra kosten worden gepubliceerd, verschijnen de categorieën en totalen hier.",
  ledgerTitle: "Transparant maandboek",
  ledgerIntro: "Openbare inkomsten en uitgaven van de gekozen maand, inclusief actieve terugkerende kosten.",
  date: "Datum",
  description: "Omschrijving",
  category: "Categorie",
  amount: "Bedrag",
  income: "Inkomst",
  expense: "Uitgave",
  protectedAmount: "Afgeschermd",
  ledgerEmpty: "Geen openbare boekingen voor deze maand.",
  ledgerEmptyHint: "Kies een andere maand of kijk opnieuw nadat boekingen zijn gepubliceerd.",
  supportersTitle: "Supporterwall",
  supportersIntro: "Bijdragen in de gekozen maand, met de losse voorkeuren voor naam en bedrag van iedere supporter toegepast.",
  anonymous: "Anonieme supporter",
  supportersEmpty: "Geen openbare bijdragen voor deze maand.",
  supportersEmptyHint: "Bijdragen kunnen wel in totalen meetellen wanneer een supporter voor privacy kiest.",
  privacy: "Privacy gerespecteerd",
  privacyText: "Naam en bijdragebedrag zijn losse keuzes. We tonen elk detail alleen wanneer de supporter dit expliciet heeft toegestaan.",
  footerTitle: "Iedere bijdrage maakt de community sterker",
  footerText: "Vragen over steun, kosten of merchandise? Bespreek ze met het 3SM-team op Discord.",
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

const SectionHeading = ({ icon, eyebrow, title, intro }: { icon: ReactNode; eyebrow: string; title: string; intro: string }) => (
  <div className="mb-6 max-w-2xl">
    <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.22em] text-orange-400">{icon}{eyebrow}</div>
    <h2 className="mt-2 font-heading text-2xl font-black uppercase leading-tight text-white sm:text-3xl">{title}</h2>
    <p className="mt-3 text-sm leading-6 text-gray-400 sm:text-base">{intro}</p>
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

  const availableMonths = useMemo(() => Array.from(new Set([
    currentMonth,
    ...state.ledger.map((entry) => entry.date.slice(0, 7)),
    ...state.recurringCosts.map((cost) => cost.startsOn.slice(0, 7)),
  ].filter((value) => /^\d{4}-\d{2}$/.test(value)))).sort((a, b) => b.localeCompare(a)), [currentMonth, state.ledger, state.recurringCosts]);

  const initialMonth = useMemo(() => {
    const queryMonth = new URLSearchParams(window.location.search).get("month");
    return queryMonth && availableMonths.includes(queryMonth) ? queryMonth : currentMonth;
  }, [availableMonths, currentMonth]);
  const [selectedMonth, setSelectedMonth] = useState(initialMonth);

  useEffect(() => {
    if (!availableMonths.includes(selectedMonth)) setSelectedMonth(currentMonth);
  }, [availableMonths, currentMonth, selectedMonth]);

  const selectMonth = (nextMonth: string) => {
    setSelectedMonth(nextMonth);
    const url = new URL(window.location.href);
    if (nextMonth === currentMonth) url.searchParams.delete("month");
    else url.searchParams.set("month", nextMonth);
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  };

  const metrics = useMemo(() => supportMetrics(state, selectedMonth), [state, selectedMonth]);
  const publicLedger = useMemo(() => publicLedgerForMonth(state, selectedMonth), [state, selectedMonth]);
  const products = useMemo(() => state.products.filter((product) => COMMUNITY_SUPPORT_PUBLIC
    ? product.active && !product.concept
    : product.active || product.concept), [state.products]);

  const spending = useMemo(() => {
    const totals = new Map<SupportLedgerCategory, number>();
    publicLedger.filter((entry) => entry.direction === "expense").forEach((entry) => totals.set(entry.category, (totals.get(entry.category) || 0) + (entry.amount ?? 0)));
    return Array.from(totals.entries()).map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
  }, [publicLedger]);
  const spendingTotal = spending.reduce((sum, item) => sum + item.amount, 0);

  const supporters = useMemo(() => publicLedger.filter((entry) =>
    entry.direction === "income" && entry.category === "contribution",
  ), [publicLedger]);

  useEffect(() => {
    setSeoMeta(lang === "en" ? {
      title: "Community Support | 3 Stripe Motorsport",
      description: "See how community support helps cover 3SM costs, with transparent monthly figures, public ledger entries and supporter privacy controls.",
      canonicalUrl: "https://3stripemotorsport.cc/support/",
      ogTitle: "Support the 3SM community",
      ogDescription: "Transparent community support for 3 Stripe Motorsport.",
    } : {
      title: "Community Support | 3 Stripe Motorsport",
      description: "Bekijk transparant hoe communitysteun de kosten van 3SM helpt dragen, met maandcijfers, openbare boekingen en respect voor supporterprivacy.",
      canonicalUrl: "https://3stripemotorsport.cc/support/",
      ogTitle: "Steun de 3SM-community",
      ogDescription: "Transparante communitysteun voor 3 Stripe Motorsport.",
    });
  }, [lang]);

  const monthStatus = metrics.operationalExpenses === 0
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
                <Heart className="h-3.5 w-3.5" aria-hidden="true" /> {copy.eyebrow}
              </div>
              <h1 className="mt-6 max-w-3xl font-heading text-4xl font-black uppercase leading-[0.98] text-white sm:text-5xl lg:text-6xl">{copy.title}</h1>
              <p className="mt-6 max-w-2xl text-base leading-7 text-gray-300 sm:text-lg">{copy.intro}</p>
              <a href="#support-options" className="mt-8 inline-flex h-12 items-center gap-2 rounded-xl bg-gradient-racing px-5 font-heading text-sm font-black uppercase tracking-wider text-white shadow-lg shadow-orange-950/30 transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300">
                {copy.supportTitle}<ChevronRight className="h-4 w-4" aria-hidden="true" />
              </a>
            </div>
            <div className="rounded-[1.75rem] bg-black/20 p-6 shadow-2xl shadow-black/25 ring-1 ring-white/[0.08] backdrop-blur sm:p-7">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-500/10 text-orange-300 ring-1 ring-orange-400/20"><ShieldCheck className="h-5 w-5" aria-hidden="true" /></div>
              <h2 className="mt-5 font-heading text-xl font-black uppercase text-white">{copy.transparency}</h2>
              <p className="mt-3 text-sm leading-6 text-gray-400">{copy.transparencyText}</p>
              <div className="mt-6 flex items-center gap-3 border-t border-white/[0.07] pt-5 text-xs font-bold uppercase tracking-wider text-gray-500">
                <CalendarDays className="h-4 w-4 text-orange-400" aria-hidden="true" /> {formatMonth(selectedMonth, lang)}
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
                  <h2 className="mt-2 font-heading text-2xl font-black uppercase text-white sm:text-3xl">{formatMonth(selectedMonth, lang)}</h2>
                </div>
                <label className="block sm:min-w-56">
                  <span className="mb-2 block text-[11px] font-black uppercase tracking-[0.14em] text-gray-500">{copy.selectMonth}</span>
                  <select value={selectedMonth} onChange={(event) => selectMonth(event.target.value)} className="h-11 w-full rounded-xl border-0 bg-white/[0.055] px-3 text-sm font-bold text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-orange-400">
                    {availableMonths.map((month) => <option key={month} value={month} className="bg-[#151821]">{formatMonth(month, lang)}</option>)}
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
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className={`mt-0.5 h-5 w-5 shrink-0 ${metrics.coveragePercent >= 100 ? "text-emerald-400" : "text-orange-400"}`} aria-hidden="true" />
                    <p className="text-sm font-bold text-gray-200">{monthStatus}</p>
                  </div>
                  <span className="font-heading text-lg font-black tabular-nums text-white">{metrics.coveragePercent}%</span>
                </div>
                <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-white/[0.06]" role="progressbar" aria-label={copy.progressLabel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={metrics.coveragePercent} aria-valuetext={`${metrics.coveragePercent}%`}>
                  <div className="h-full rounded-full bg-gradient-to-r from-orange-600 via-orange-500 to-amber-400 transition-[width] duration-500" style={{ width: `${metrics.coveragePercent}%` }} />
                </div>
                {metrics.operationalExpenses === 0 && <p className="mt-3 text-xs text-gray-500">{copy.noTarget}</p>}
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
              <SectionHeading icon={<ReceiptText className="h-4 w-4" aria-hidden="true" />} eyebrow={copy.transparency} title={copy.ledgerTitle} intro={copy.ledgerIntro} />
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
                      <caption className="sr-only">{copy.ledgerTitle} — {formatMonth(selectedMonth, lang)}</caption>
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
