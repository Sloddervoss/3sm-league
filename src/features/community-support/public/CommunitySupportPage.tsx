import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  ExternalLink,
  Flag,
  Heart,
  Info,
  Package,
  ReceiptText,

  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Users,
  WalletCards,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import PreviewModal from "@/components/preview/PreviewModal";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import { setSeoMeta } from "@/lib/seo";
import { COMMUNITY_SUPPORT_HAS_SHARED_DATA, COMMUNITY_SUPPORT_PUBLIC, monthKey, publicLedgerForYear, publicRaceCostsForYear, supportMetricsForYear } from "../model";
import { fetchOwnedActiveMerchProductIds } from "../merchApi";
import { fetchPublicPaymentConfig, fetchSharedPaymentLedger, submitPaymentIntent } from "../paymentApi";
import { emptySharedSupportState, fetchPublicCommunitySupportData } from "../supportDataApi";
import { useCommunitySupport } from "../store";
import type { SupportProduct } from "../types";
import MerchandiseCheckout from "./MerchandiseCheckout";
import SeasonLedgerModal from "./SeasonLedgerModal";
import PayPalContributionModal from "./PayPalContributionModal";

const DISCORD_URL = "https://discord.gg/H7tZVuzBgT";

type Language = "nl" | "en";

const getCopy = (language: Language) => language === "en" ? {
  eyebrow: "Community Support · race season",
  title: "Together, we keep 3SM on track",
  intro: "This page lists the income and expenses for this race season. It also shows how much was covered by 3SM and how much by the community.",
  transparency: "Open paddock, clear figures",
  transparencyText: "We show the season's public income and expenses openly. Contributions are optional and never determine whether 3SM continues.",
  monthOverview: "Season overview",
  selectMonth: "Transaction detail",
  selectYear: "Select season",
  allMonths: "Full season",
  costs: "Season costs",
  covered: "Carried by community",
  selfFunded: "Carried by 3SM",
  reserve: "Available reserve",
  reserveCarryText: "Only the community money left after all recorded costs is automatically carried into the next season.",
  openingReserve: "Carried in from earlier seasons",
  reserveUsed: "Used from reserve this season",
  coveredStatus: "The recorded season costs have been fully carried by community funds.",
  partialStatus: "The community is voluntarily carrying part of this season's costs.",
  openStatus: "3SM has carried the recorded season costs itself so far.",
  noCostsStatus: "No operational costs have been recorded for this season yet.",
  progressLabel: "Distribution of season costs between the community and 3SM",
  noTarget: "This is a transparent cost overview, not a donation target.",
  openBookEyebrow: "Full financial detail",
  openBookTitle: "Open the season ledger",
  openBookIntro: "Transactions and Hosted Session details are kept together in one clear season ledger, instead of filling the entire page.",
  openBookTransactions: "Transactions",
  openBookRaces: "Races",
  openBookRaceCosts: "Race costs",
  openBookCta: "View full season ledger",
  supportTitle: "Contribute voluntarily",
  supportCta: "See how you can contribute",
  supportIntro: "Would you like to help cover the race season costs? Choose an amount. Contributions are always voluntary.",
  paypalTitle: "Voluntary contribution",
  paypalText: "Choose an amount and pay directly through secure PayPal Checkout. 3SM books the contribution only after server-side capture verification.",
  paypalManualText: "Choose an amount and continue to PayPal.Me. The contribution is booked only after the 3SM payment admin has manually verified it.",
  paypalCta: "Contribute through PayPal",
  paypalOffTitle: "Financial support",
  paypalOffText: "Direct PayPal contributions are not currently enabled. You can still help in the other ways below.",
  merchandiseTitle: "Community merchandise",
  merchandiseText: "Merchandise supports the community through its net proceeds. Available items are shown below.",
  shareTitle: "Build the grid",
  shareText: "Invite respectful drivers, join events and help others on Discord. A strong community is our most valuable support.",
  discordCta: "Open Discord",
  referralTitle: "New to iRacing?",
  referralText: "Create your account through the 3SM referral link. We receive iRacing credit that we can use to host races, at no extra cost to you.",
  referralCta: "Use the referral link",
  merchandiseSection: "Community merchandise",
  merchandiseIntro: "Products entered by 3SM are shown here with their current price and availability.",
  concept: "Concept",
  active: "Available",
  soldOut: "Out of stock",
  stock: "in stock",
  buy: "Buy with PayPal",
  signInToBuy: "Sign in to order",
  orderComplete: "Payment confirmed. Your order and shipping address are saved.",
  merchandiseEmpty: "There are no community products available at the moment.",
  merchandiseEmptyHint: "New items will appear here after they have been added and made available by 3SM.",
  spendingTitle: "Where the season costs sit",
  spendingIntro: "A category breakdown of the public expenses recorded for the selected season.",
  spendingEmpty: "No public expenses have been recorded for this season.",
  spendingEmptyHint: "When costs are published, their categories and totals will appear here.",
  ledgerTitle: "Season ledger",
  ledgerIntro: "View the full season or select a month to inspect public income, expenses and active recurring costs.",
  raceConversion: "Original USD price and stored rate",
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
  intro: "Hier zie je de inkomsten en uitgaven van dit raceseizoen. Ook zie je welk deel door 3SM en welk deel door de community is betaald.",
  transparency: "Open paddock, heldere cijfers",
  transparencyText: "We laten de openbare inkomsten en uitgaven van het seizoen zien. Bijdragen zijn vrijwillig en bepalen nooit of 3SM doorgaat.",
  monthOverview: "Seizoensoverzicht",
  selectMonth: "Transactiedetail",
  selectYear: "Kies een seizoen",
  allMonths: "Hele seizoen",
  costs: "Kosten seizoen",
  covered: "Gedragen door community",
  selfFunded: "Gedragen door 3SM",
  reserve: "Beschikbare reserve",
  reserveCarryText: "Alleen het communitygeld dat na alle geregistreerde kosten overblijft, schuift automatisch door naar het volgende seizoen.",
  openingReserve: "Meegenomen uit eerdere seizoenen",
  reserveUsed: "Dit seizoen uit reserve gebruikt",
  coveredStatus: "De geregistreerde seizoenskosten zijn volledig door communitygeld gedragen.",
  partialStatus: "De community draagt vrijwillig een deel van de kosten van dit seizoen.",
  openStatus: "3SM heeft de geregistreerde seizoenskosten tot nu toe zelf gedragen.",
  noCostsStatus: "Voor dit seizoen zijn nog geen operationele kosten geregistreerd.",
  progressLabel: "Verdeling van de seizoenskosten tussen de community en 3SM",
  noTarget: "Dit is een transparant kostenoverzicht, geen donatiedoel.",
  openBookEyebrow: "Volledige financiële details",
  openBookTitle: "Open het seizoensboek",
  openBookIntro: "Transacties en Hosted Session-details staan samen in één overzichtelijk seizoensboek, in plaats van over de hele pagina.",
  openBookTransactions: "Transacties",
  openBookRaces: "Races",
  openBookRaceCosts: "Racekosten",
  openBookCta: "Bekijk volledig seizoensboek",
  supportTitle: "Vrijwillig bijdragen",
  supportCta: "Bekijk hoe je kunt bijdragen",
  supportIntro: "Wil je meehelpen met de kosten van het raceseizoen? Kies zelf een bedrag. Bijdragen is altijd vrijwillig.",
  paypalTitle: "Vrijwillige bijdrage",
  paypalText: "Kies een bedrag en reken direct af via beveiligde PayPal Checkout. 3SM boekt de bijdrage pas na server-side verificatie van de capture.",
  paypalManualText: "Kies een bedrag en ga verder via PayPal.Me. 3SM boekt de bijdrage pas nadat de betaaladmin deze handmatig heeft gecontroleerd.",
  paypalCta: "Bijdragen via PayPal",
  paypalOffTitle: "Financieel steunen",
  paypalOffText: "Rechtstreeks bijdragen via PayPal staat momenteel niet aan. Je kunt wel op de andere manieren hieronder helpen.",
  merchandiseTitle: "Communitymerchandise",
  merchandiseText: "Merchandise steunt de community met de netto-opbrengst. Beschikbare producten staan hieronder.",
  shareTitle: "Bouw mee aan de grid",
  shareText: "Nodig sportieve coureurs uit, doe mee aan evenementen en help anderen op Discord. Een sterke community is onze waardevolste steun.",
  discordCta: "Open Discord",
  referralTitle: "Nieuw bij iRacing?",
  referralText: "Maak je account aan via de 3SM-referrallink. Wij krijgen dan iRacing-tegoed voor het hosten van races. Voor jou kost dat niets extra.",
  referralCta: "Gebruik de referrallink",
  merchandiseSection: "Communitymerchandise",
  merchandiseIntro: "Door 3SM ingevoerde producten staan hier met hun actuele prijs en beschikbaarheid.",
  concept: "Concept",
  active: "Beschikbaar",
  soldOut: "Niet op voorraad",
  stock: "op voorraad",
  buy: "Kopen met PayPal",
  signInToBuy: "Log in om te bestellen",
  orderComplete: "Betaling bevestigd. Je bestelling en verzendadres zijn opgeslagen.",
  merchandiseEmpty: "Er zijn momenteel geen communityproducten beschikbaar.",
  merchandiseEmptyHint: "Nieuwe producten verschijnen hier zodra 3SM ze heeft toegevoegd en beschikbaar heeft gemaakt.",
  spendingTitle: "Waar de seizoenskosten zitten",
  spendingIntro: "Een verdeling van de openbaar geregistreerde uitgaven in het gekozen seizoen.",
  spendingEmpty: "Voor dit seizoen zijn geen openbare uitgaven geregistreerd.",
  spendingEmptyHint: "Zodra kosten worden gepubliceerd, verschijnen de categorieën en totalen hier.",
  ledgerTitle: "Seizoensboek",
  ledgerIntro: "Bekijk het hele seizoen of kies een maand voor de openbare inkomsten, uitgaven en actieve terugkerende kosten.",
  raceConversion: "Oorspronkelijke USD-prijs en opgeslagen koers",
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


const MetricCard = ({ label, value, icon, accent = false }: { label: string; value: string; icon: ReactNode; accent?: boolean }) => (
  <div className={`rounded-2xl p-4 ring-1 ${accent ? "bg-orange-500/[0.08] ring-orange-400/20" : "bg-black/15 ring-white/[0.055]"}`}>
    <div className={`flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] ${accent ? "text-orange-300" : "text-gray-500"}`}>{icon}{label}</div>
    <p className="mt-2 font-heading text-xl font-black tabular-nums text-white sm:text-2xl">{value}</p>
  </div>
);

const CommunitySupportPage = () => {
  const { language } = useLanguage();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { state: adminState, addPaymentIntent } = useCommunitySupport();
  const lang: Language = language === "en" ? "en" : "nl";
  const copy = getCopy(lang);
  const currentMonth = monthKey(new Date());
  const currentYear = currentMonth.slice(0, 4);
  const { data: sharedPaymentLedger } = useQuery({
    queryKey: ["community-support", "payment-ledger", "public"],
    queryFn: fetchSharedPaymentLedger,
    enabled: COMMUNITY_SUPPORT_HAS_SHARED_DATA,
    staleTime: 60_000,
  });
  const { data: sharedSupportData, isError: sharedSupportDataError } = useQuery({
    queryKey: ["community-support", "shared-data", "public"],
    queryFn: fetchPublicCommunitySupportData,
    enabled: COMMUNITY_SUPPORT_HAS_SHARED_DATA,
    staleTime: 0,
  });
  const { data: activeMerchProductIds = [] } = useQuery({
    queryKey: ["community-support", "merch-orders", "active", user?.id],
    queryFn: fetchOwnedActiveMerchProductIds,
    enabled: COMMUNITY_SUPPORT_HAS_SHARED_DATA && Boolean(user),
    staleTime: 0,
  });
  const activeMerchProducts = useMemo(() => new Set(activeMerchProductIds), [activeMerchProductIds]);
  const emptyPublicState = useMemo(emptySharedSupportState, []);
  const state = COMMUNITY_SUPPORT_HAS_SHARED_DATA ? (sharedSupportData?.displayState ?? emptyPublicState) : adminState;

  const availableYears = useMemo(() => Array.from(new Set([
    currentYear,
    ...state.ledger.map((entry) => entry.date.slice(0, 4)),
    ...state.recurringCosts.map((cost) => cost.startsOn.slice(0, 4)),
    ...state.raceCosts.map((cost) => cost.date.slice(0, 4)),
    ...(sharedSupportData?.metricLedger ?? []).map((entry) => entry.date.slice(0, 4)),
    ...(sharedPaymentLedger?.entries ?? []).map((entry) => entry.date.slice(0, 4)),
    ...(sharedPaymentLedger?.metricEntries ?? []).map((entry) => entry.date.slice(0, 4)),
  ].filter((value) => /^\d{4}$/.test(value)))).sort((a, b) => b.localeCompare(a)), [currentYear, sharedPaymentLedger, sharedSupportData, state.ledger, state.raceCosts, state.recurringCosts]);

  const requestedPeriodRef = useRef({
    year: new URLSearchParams(window.location.search).get("year"),
    month: new URLSearchParams(window.location.search).get("month"),
  });
  const queryPeriodAppliedRef = useRef(false);
  const initialYear = useMemo(() => {
    const queryYear = requestedPeriodRef.current.year;
    return queryYear && availableYears.includes(queryYear) ? queryYear : currentYear;
  }, [availableYears, currentYear]);
  const [selectedYear, setSelectedYear] = useState(initialYear);
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const queryMonth = requestedPeriodRef.current.month;
    return queryMonth && /^\d{4}-\d{2}$/.test(queryMonth) && queryMonth.startsWith(initialYear) ? queryMonth : "all";
  });
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<SupportProduct | null>(null);
  const [orderComplete, setOrderComplete] = useState(false);
  const requirePaymentAuthentication = () => {
    setPaymentOpen(false);
    navigate("/auth?redirect=/support/");
  };
  const beginContribution = () => {
    if (COMMUNITY_SUPPORT_HAS_SHARED_DATA && !user) {
      requirePaymentAuthentication();
      return;
    }
    setPaymentOpen(true);
  };
  const beginProductOrder = (product: SupportProduct) => {
    if (!user) {
      navigate("/auth?redirect=/support/%23merchandise");
      return;
    }
    setOrderComplete(false);
    setSelectedProduct(product);
  };
  const refreshPaymentLedger = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["community-support", "payment-ledger"] });
  }, [queryClient]);
  const { data: sharedPaymentConfig } = useQuery({
    queryKey: ["community-support", "payment-config", "public"],
    queryFn: fetchPublicPaymentConfig,
    enabled: COMMUNITY_SUPPORT_HAS_SHARED_DATA,
    staleTime: 60_000,
  });
  const paymentSettings = useMemo(() => sharedPaymentConfig ? { ...state.settings, ...sharedPaymentConfig } : state.settings, [sharedPaymentConfig, state.settings]);
  const paymentEnabled = paymentSettings.paypalCheckoutEnabled || paymentSettings.paypalEnabled;

  const availableMonths = useMemo(() => Array.from({ length: 12 }, (_, index) => `${selectedYear}-${String(index + 1).padStart(2, "0")}`), [selectedYear]);

  useEffect(() => {
    const requestedYear = requestedPeriodRef.current.year;
    if (!queryPeriodAppliedRef.current && requestedYear && availableYears.includes(requestedYear)) {
      queryPeriodAppliedRef.current = true;
      setSelectedYear(requestedYear);
      const requestedMonth = requestedPeriodRef.current.month;
      setSelectedMonth(requestedMonth && /^\d{4}-\d{2}$/.test(requestedMonth) && requestedMonth.startsWith(requestedYear) ? requestedMonth : "all");
      return;
    }
    if (!requestedYear) queryPeriodAppliedRef.current = true;
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

  const stateWithoutLocalPayPal = useMemo(() => COMMUNITY_SUPPORT_HAS_SHARED_DATA
    ? { ...state, ledger: state.ledger.filter((entry) => !entry.id.startsWith("paypal-contribution:") && !entry.id.startsWith("paypal-fee:")) }
    : state, [state]);
  const metricState = useMemo(() => {
    if (!COMMUNITY_SUPPORT_HAS_SHARED_DATA) return stateWithoutLocalPayPal;
    return {
      ...stateWithoutLocalPayPal,
      ledger: [...(sharedSupportData?.metricLedger ?? []), ...(sharedPaymentLedger?.metricEntries ?? [])],
      recurringCosts: [],
      raceCosts: [],
    };
  }, [sharedPaymentLedger, sharedSupportData, stateWithoutLocalPayPal]);
  const metrics = useMemo(() => supportMetricsForYear(metricState, selectedYear), [metricState, selectedYear]);
  const annualPublicLedger = useMemo(() => [
    ...publicLedgerForYear(stateWithoutLocalPayPal, selectedYear),
    ...(sharedPaymentLedger?.entries ?? []).filter((entry) => entry.date.startsWith(selectedYear)),
  ].sort((a, b) => b.date.localeCompare(a.date)), [selectedYear, sharedPaymentLedger, stateWithoutLocalPayPal]);
  const annualPublicRaceCosts = useMemo(() => publicRaceCostsForYear(state, selectedYear), [state, selectedYear]);
  const publicLedger = useMemo(() => selectedMonth === "all" ? annualPublicLedger : annualPublicLedger.filter((entry) => entry.date.startsWith(selectedMonth)), [annualPublicLedger, selectedMonth]);
  const products = useMemo(() => state.products.filter((product) => COMMUNITY_SUPPORT_PUBLIC
    ? product.active && !product.concept
    : product.active || product.concept), [state.products]);

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
        {sharedSupportDataError && <div role="alert" className="mx-auto mt-6 max-w-7xl px-4 sm:px-6"><div className="rounded-2xl border border-rose-400/25 bg-rose-500/10 p-4 text-sm font-bold text-rose-100">{lang === "en" ? "The current Community Support data could not be loaded. Please try again." : "De actuele Community Support-gegevens konden niet worden geladen. Probeer de pagina opnieuw."}</div></div>}
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

              <div className="mt-4 flex items-start gap-3 rounded-2xl bg-sky-400/[0.045] p-4 ring-1 ring-sky-300/10">
                <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" aria-hidden="true" />
                <div className="min-w-0 text-xs leading-5 text-gray-400">
                  <p>{copy.reserveCarryText}</p>
                  {metrics.openingReserve > 0 && <dl className="mt-2 flex flex-col gap-1 font-bold sm:flex-row sm:flex-wrap sm:gap-x-5">
                    <div className="flex justify-between gap-3 sm:justify-start"><dt>{copy.openingReserve}</dt><dd className="shrink-0 text-gray-200">{formatMoney(metrics.openingReserve, lang)}</dd></div>
                    <div className="flex justify-between gap-3 sm:justify-start"><dt>{copy.reserveUsed}</dt><dd className="shrink-0 text-gray-200">{formatMoney(metrics.reserveUsed, lang)}</dd></div>
                  </dl>}
                </div>
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

            <button type="button" onClick={() => setLedgerOpen(true)} aria-haspopup="dialog" className="group relative w-full overflow-hidden rounded-[1.65rem] bg-white/[0.035] p-5 text-left shadow-2xl shadow-black/20 ring-1 ring-white/[0.065] transition hover:bg-white/[0.05] hover:ring-orange-400/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300 sm:p-7">
              <div aria-hidden="true" className="absolute -right-16 -top-24 h-64 w-64 rounded-full bg-orange-500/[0.09] blur-3xl transition group-hover:bg-orange-500/[0.13]" />
              <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                <div className="max-w-2xl">
                  <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-orange-400"><ReceiptText className="h-4 w-4" aria-hidden="true" />{copy.openBookEyebrow}</div>
                  <h2 className="mt-2 font-heading text-2xl font-black uppercase text-white sm:text-3xl">{copy.openBookTitle} · {selectedYear}</h2>
                  <p className="mt-2 text-sm leading-6 text-gray-400">{copy.openBookIntro}</p>
                </div>
                <div className="grid shrink-0 grid-cols-3 gap-2 lg:w-[430px]">
                  <div className="rounded-xl bg-black/15 p-3 ring-1 ring-white/[0.055]"><span className="text-[9px] font-black uppercase tracking-wider text-gray-500">{copy.openBookTransactions}</span><p className="mt-1 font-heading text-xl font-black text-white">{annualPublicLedger.filter((entry) => entry.category !== "race_hosting").length}</p></div>
                  <div className="rounded-xl bg-black/15 p-3 ring-1 ring-white/[0.055]"><span className="text-[9px] font-black uppercase tracking-wider text-gray-500">{copy.openBookRaces}</span><p className="mt-1 font-heading text-xl font-black text-white">{annualPublicRaceCosts.length}</p></div>
                  <div className="rounded-xl bg-orange-500/[0.08] p-3 ring-1 ring-orange-400/20"><span className="text-[9px] font-black uppercase tracking-wider text-orange-300">{copy.openBookRaceCosts}</span><p className="mt-1 font-heading text-xl font-black text-white">{formatMoney(annualPublicRaceCosts.reduce((total, cost) => total + cost.amount, 0), lang)}</p></div>
                </div>
              </div>
              <div className="relative mt-5 flex items-center gap-2 border-t border-white/[0.06] pt-4 text-sm font-black text-orange-300">{copy.openBookCta}<ChevronRight className="h-4 w-4 transition group-hover:translate-x-1" aria-hidden="true" /></div>
            </button>

            <section id="support-options" className="scroll-mt-24">
              <SectionHeading icon={<Heart className="h-4 w-4" aria-hidden="true" />} eyebrow={copy.eyebrow} title={copy.supportTitle} intro={copy.supportIntro} />
              <div className="grid gap-4 lg:grid-cols-3">
                <Surface className="flex flex-col p-6">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-500/10 text-orange-300 ring-1 ring-orange-400/20"><CircleDollarSign className="h-5 w-5" aria-hidden="true" /></div>
                  <h3 className="mt-5 font-heading text-lg font-black uppercase text-white">{paymentEnabled ? copy.paypalTitle : copy.paypalOffTitle}</h3>
                  <p className="mt-2 flex-1 text-sm leading-6 text-gray-400">{paymentEnabled ? (paymentSettings.paypalCheckoutEnabled ? copy.paypalText : copy.paypalManualText) : copy.paypalOffText}</p>
                  {paymentEnabled && <button type="button" onClick={beginContribution} aria-haspopup="dialog" className="mt-5 inline-flex items-center gap-2 self-start rounded-xl bg-gradient-racing px-4 py-2.5 text-sm font-black text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300">{copy.paypalCta}<ChevronRight className="h-4 w-4" aria-hidden="true" /></button>}
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
              {paymentSettings.iracingReferralEnabled && paymentSettings.iracingReferralUrl && <Surface className="mt-4 flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
                <div className="flex items-start gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.045] text-gray-200 ring-1 ring-white/[0.08]"><Flag className="h-4 w-4" aria-hidden="true" /></div>
                  <div><h3 className="font-heading text-base font-black uppercase text-white">{copy.referralTitle}</h3><p className="mt-1 max-w-3xl text-sm leading-6 text-gray-400">{copy.referralText}</p></div>
                </div>
                <a href={paymentSettings.iracingReferralUrl} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-2 self-start text-sm font-black text-orange-300 transition hover:text-orange-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300 sm:self-center">{copy.referralCta}<ExternalLink className="h-4 w-4" aria-hidden="true" /></a>
              </Surface>}
            </section>

            <section id="merchandise" className="scroll-mt-24">
              <SectionHeading icon={<Package className="h-4 w-4" aria-hidden="true" />} eyebrow={copy.merchandiseTitle} title={copy.merchandiseSection} intro={copy.merchandiseIntro} />
              {products.length === 0 ? <EmptyState icon={<ShoppingBag className="h-5 w-5" aria-hidden="true" />} title={copy.merchandiseEmpty} hint={copy.merchandiseEmptyHint} /> : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {products.map((product) => <Surface key={product.id} className="overflow-hidden">
                    {product.imageUrls.length > 0 ? <div className={`grid aspect-[16/10] gap-px overflow-hidden bg-black/20 ${product.imageUrls.length > 1 ? "grid-cols-2" : ""}`}>{product.imageUrls.map((imageUrl, index) => <img key={`${imageUrl.slice(-24)}-${index}`} src={imageUrl} alt={`${product.name} ${index + 1}`} loading="lazy" className="h-full min-h-0 w-full object-cover" />)}</div> : <div className="flex aspect-[16/10] items-center justify-center bg-[radial-gradient(circle_at_center,rgba(249,115,22,0.10),transparent_65%)] text-orange-300"><ShoppingBag className="h-9 w-9" aria-hidden="true" /></div>}
                    <div className="p-5">
                      <div className="flex flex-wrap items-center gap-2">
                        {!COMMUNITY_SUPPORT_PUBLIC && product.concept && <span className="rounded-full bg-amber-400/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-amber-200 ring-1 ring-amber-300/20">{copy.concept}</span>}
                        {product.active && <span className="rounded-full bg-emerald-400/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-emerald-200 ring-1 ring-emerald-300/20">{copy.active}</span>}
                        <span className="rounded-full bg-violet-400/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-violet-200 ring-1 ring-violet-300/20">{product.fulfillmentMode === "digital" ? (lang === "en" ? "Digital delivery" : "Digitale levering") : (lang === "en" ? "Shipping" : "Wordt verzonden")}</span>
                      </div>
                      <h3 className="mt-4 font-heading text-xl font-black text-white">{product.name}</h3>
                      <p className="mt-2 min-h-12 text-sm leading-6 text-gray-400">{product.description}</p>
                      <div className="mt-5 flex items-end justify-between gap-3 border-t border-white/[0.065] pt-4">
                        <span className="font-heading text-xl font-black text-white">{formatMoney(product.price, lang)}</span>
                        <span className={`text-xs font-bold ${product.stock > 0 ? "text-gray-400" : "text-rose-300"}`}>{product.stock > 0 ? `${product.stock} ${copy.stock}` : copy.soldOut}</span>
                      </div>
                      {(product.stock > 0 || activeMerchProducts.has(product.id)) && paymentSettings.paypalCheckoutEnabled && <button type="button" onClick={() => beginProductOrder(product)} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 text-sm font-black text-white shadow-lg shadow-orange-950/20 transition hover:bg-orange-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300"><ShoppingBag className="h-4 w-4" aria-hidden="true" />{activeMerchProducts.has(product.id) ? (lang === "en" ? "Resume order" : "Bestelling hervatten") : user ? copy.buy : copy.signInToBuy}</button>}
                    </div>
                  </Surface>)}
                </div>
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
      <PreviewModal
        open={ledgerOpen}
        onClose={() => setLedgerOpen(false)}
        maxWidth="1100px"
        ariaLabel={`${copy.ledgerTitle} ${selectedYear}`}
        closeLabel={lang === "en" ? "Close season ledger" : "Sluit seizoensboek"}
      >
        <SeasonLedgerModal
          language={lang}
          selectedYear={selectedYear}
          selectedMonth={selectedMonth}
          availableMonths={availableMonths}
          onSelectedMonthChange={selectMonth}
          annualLedger={annualPublicLedger}
          visibleLedger={publicLedger}
          raceCosts={annualPublicRaceCosts}
          totalRaceCount={metrics.raceCosts.length}
          raceCostTotalEur={metrics.raceCostTotal}
          summary={{
            operationalExpenses: metrics.operationalExpenses,
            communityCovered: metrics.communityCovered,
            selfFunded: metrics.selfFunded,
            reserve: metrics.reserve,
          }}
        />
      </PreviewModal>
      <PreviewModal
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        maxWidth="720px"
        ariaLabel={copy.paypalTitle}
        closeLabel={lang === "en" ? "Close PayPal contribution" : "Sluit PayPal-bijdrage"}
      >
        <PayPalContributionModal
          language={lang}
          settings={paymentSettings}
          localReview={!COMMUNITY_SUPPORT_HAS_SHARED_DATA}
          canOpenPayPal={!COMMUNITY_SUPPORT_HAS_SHARED_DATA || Boolean(user)}
          onAuthenticationRequired={requirePaymentAuthentication}
          onCheckoutCompleted={refreshPaymentLedger}
          onSubmit={async (draft) => {
            if (COMMUNITY_SUPPORT_HAS_SHARED_DATA) {
              await submitPaymentIntent(draft);
              return true;
            }
            return Boolean(addPaymentIntent(draft));
          }}
        />
      </PreviewModal>
      <PreviewModal
        open={Boolean(selectedProduct)}
        onClose={() => setSelectedProduct(null)}
        maxWidth="640px"
        ariaLabel={lang === "en" ? "Merchandise checkout" : "Merchandise afrekenen"}
        closeLabel={lang === "en" ? "Close merchandise checkout" : "Sluit merchandise checkout"}
      >
        {selectedProduct && (orderComplete ? <div role="status" className="rounded-2xl bg-emerald-500/10 p-6 text-emerald-100 ring-1 ring-emerald-400/20"><CheckCircle2 className="h-7 w-7" aria-hidden="true" /><p className="mt-4 font-heading text-xl font-black">{selectedProduct.fulfillmentMode === "digital" ? (lang === "en" ? "Payment confirmed. Your digital order is saved for email delivery." : "Betaling bevestigd. Je digitale bestelling is opgeslagen voor levering per e-mail.") : copy.orderComplete}</p><button type="button" onClick={() => setSelectedProduct(null)} className="mt-5 min-h-11 rounded-xl bg-white/10 px-5 text-sm font-black ring-1 ring-white/15">{lang === "en" ? "Close" : "Sluiten"}</button></div> : <MerchandiseCheckout product={selectedProduct} language={lang} onCancelled={() => {
          setSelectedProduct(null);
          void queryClient.invalidateQueries({ queryKey: ["community-support", "merch-orders", "active"] });
        }} onCompleted={() => {
          setOrderComplete(true);
          void queryClient.invalidateQueries({ queryKey: ["community-support", "shared-data"] });
          void queryClient.invalidateQueries({ queryKey: ["community-support", "payment-ledger"] });
          void queryClient.invalidateQueries({ queryKey: ["community-support", "merch-orders", "active"] });
        }} />)}
      </PreviewModal>
    </div>
  );
};

export default CommunitySupportPage;
