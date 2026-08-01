import { FormEvent, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDownRight,
  ArrowUpRight,
  Box,
  CalendarClock,
  Check,
  ChevronRight,
  CircleDollarSign,
  Eye,
  EyeOff,
  Flag,
  Images,
  LayoutDashboard,
  PackageOpen,
  Plus,
  RotateCcw,
  Settings,
  ShieldAlert,
  Trash2,
  WalletCards,
  X,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import { monthKey, supportMetricsForYear } from "@/features/community-support/model";
import { useCommunitySupport, type SupportLedgerDraft, type SupportProductDraft, type SupportRecurringCostDraft } from "@/features/community-support/store";
import { SUPPORT_CATEGORY_LABELS, type SupportLedgerCategory } from "@/features/community-support/types";
import { MAX_PRODUCT_IMAGES, prepareProductImage } from "@/features/community-support/productImages";
import CreditPurchasesSection from "./CreditPurchasesSection";
import RaceCostsSection from "./RaceCostsSection";

type Language = "nl" | "en";
type SectionId = "dashboard" | "ledger" | "race-costs" | "recurring" | "products" | "settings";

type Copy = {
  [key: string]: string;
};

const COPY: Record<Language, Copy> = {
  nl: {
    title: "Supportbeheer",
    eyebrow: "Community Support",
    intro: "Beheer bijdragen, kosten, producten en publieke voorkeuren vanuit één lokale omgeving.",
    publicPage: "Open publieke supportpagina",
    dashboard: "Overzicht",
    ledger: "Transacties",
    raceCosts: "Racekosten",
    recurring: "Terugkerende kosten",
    products: "Producten",
    settings: "Instellingen",
    month: "Maand",
    season: "Seizoen",
    income: "Inkomsten",
    expenses: "Uitgaven",
    result: "Seizoensresultaat",
    coverage: "Dekking community",
    reserve: "Beschikbare eindreserve",
    openingReserve: "Openingsreserve seizoen",
    reserveUsed: "Uit reserve gebruikt",
    selfFunded: "Zelf gefinancierd",
    newTransaction: "Nieuwe transactie",
    transactionHelp: "Voeg een ontvangen bijdrage of betaalde kostenpost toe.",
    direction: "Type",
    expense: "Uitgave",
    category: "Categorie",
    date: "Datum",
    description: "Omschrijving",
    amount: "Bedrag",
    public: "Zichtbaar op supportpagina",
    supporterName: "Naam supporter (optioneel)",
    showName: "Naam openbaar tonen",
    showAmount: "Bedrag openbaar tonen",
    addTransaction: "Transactie toevoegen",
    noTransactions: "Geen transacties in deze maand.",
    allTransactions: "Alle lokale transacties",
    remove: "Verwijderen",
    recurringHelp: "Kies of een actieve kostenpost iedere maand of eenmaal per jaar terugkomt.",
    startsOn: "Startdatum",
    frequency: "Frequentie",
    monthly: "Maandelijks",
    yearly: "Jaarlijks",
    active: "Actief",
    inactive: "Gepauzeerd",
    addRecurring: "Kostenpost toevoegen",
    noRecurring: "Nog geen terugkerende kosten ingesteld.",
    productsHelp: "Beheer voorraad, verkoopprijs en publicatiestatus van supportproducten.",
    productName: "Productnaam",
    productDescription: "Productomschrijving",
    price: "Verkoopprijs",
    purchasePrice: "Inkoopprijs",
    shippingCost: "Verzendkosten",
    stock: "Voorraad",
    productImages: "Productfoto’s (optioneel)",
    chooseImages: "Foto’s kiezen",
    imageHelp: "Maximaal 4 foto’s. JPEG, PNG of WebP; bestanden worden automatisch verkleind en alleen lokaal bewaard.",
    imageError: "Een of meer foto’s konden niet worden verwerkt. Gebruik JPEG, PNG of WebP van maximaal 12 MB.",
    imageLimit: "Je kunt maximaal 4 productfoto’s toevoegen.",
    removeImage: "Foto verwijderen",
    mainImage: "Hoofdfoto",
    concept: "Concept",
    published: "Gepubliceerd",
    addProduct: "Product toevoegen",
    noProducts: "Nog geen producten toegevoegd.",
    margin: "Marge per stuk",
    settingsHelp: "Stel alleen een eventuele reserve in waarmee Community Support begint. Daarna schuift uitsluitend het echte restant automatisch door.",
    currentReserve: "Startreserve",
    reserveStartYear: "Startjaar reserve",
    supporterDefaults: "Standaardvoorkeuren voor supporters",
    namesDefault: "Supporternaam standaard openbaar",
    amountsDefault: "Supportbedrag standaard openbaar",
    paypal: "PayPal-optie inschakelen",
    saveSettings: "Instellingen opslaan",
    saved: "Instellingen opgeslagen",
    localData: "Lokale gegevens wissen",
    localDataHelp: "Wis alle transacties, kosten, producten en instellingen uit deze browser. Dit kan niet ongedaan worden gemaakt.",
    clearData: "Alle lokale data wissen",
    confirmTitle: "Lokale data definitief wissen?",
    confirmHelp: "Typ WISSEN om te bevestigen. Alle Community Support-data in deze browser wordt verwijderd.",
    confirmPlaceholder: "Typ WISSEN",
    cancel: "Annuleren",
    confirmClear: "Definitief wissen",
    entryCount: "Transacties",
    recurringTotal: "Terugkerende kosten seizoen",
    productValue: "Voorraadwaarde verkoop",
    operational: "Operationele kosten",
    netSupport: "Netto communitysupport",
  },
  en: {
    title: "Support management",
    eyebrow: "Community Support",
    intro: "Manage contributions, costs, products and public preferences in one local workspace.",
    publicPage: "Open public support page",
    dashboard: "Overview",
    ledger: "Transactions",
    raceCosts: "Race costs",
    recurring: "Recurring costs",
    products: "Products",
    settings: "Settings",
    month: "Month",
    season: "Season",
    income: "Income",
    expenses: "Expenses",
    result: "Season result",
    coverage: "Community coverage",
    reserve: "Available closing reserve",
    openingReserve: "Season opening reserve",
    reserveUsed: "Used from reserve",
    selfFunded: "Self-funded",
    newTransaction: "New transaction",
    transactionHelp: "Add a received contribution or paid expense.",
    direction: "Type",
    expense: "Expense",
    category: "Category",
    date: "Date",
    description: "Description",
    amount: "Amount",
    public: "Visible on support page",
    supporterName: "Supporter name (optional)",
    showName: "Show name publicly",
    showAmount: "Show amount publicly",
    addTransaction: "Add transaction",
    noTransactions: "No transactions in this month.",
    allTransactions: "All local transactions",
    remove: "Delete",
    recurringHelp: "Choose whether an active cost recurs every month or once per year.",
    startsOn: "Start date",
    frequency: "Frequency",
    monthly: "Monthly",
    yearly: "Yearly",
    active: "Active",
    inactive: "Paused",
    addRecurring: "Add cost item",
    noRecurring: "No recurring costs configured yet.",
    productsHelp: "Manage stock, sale prices and publication status of support products.",
    productName: "Product name",
    productDescription: "Product description",
    price: "Sale price",
    purchasePrice: "Purchase price",
    shippingCost: "Shipping costs",
    stock: "Stock",
    productImages: "Product photos (optional)",
    chooseImages: "Choose photos",
    imageHelp: "Up to 4 photos. JPEG, PNG or WebP; files are resized automatically and stored locally only.",
    imageError: "One or more photos could not be processed. Use JPEG, PNG or WebP up to 12 MB.",
    imageLimit: "You can add up to 4 product photos.",
    removeImage: "Remove photo",
    mainImage: "Main photo",
    concept: "Draft",
    published: "Published",
    addProduct: "Add product",
    noProducts: "No products added yet.",
    margin: "Margin per item",
    settingsHelp: "Set only an optional reserve that Community Support starts with. After that, only the actual remainder is carried forward automatically.",
    currentReserve: "Starting reserve",
    reserveStartYear: "Reserve start year",
    supporterDefaults: "Default supporter preferences",
    namesDefault: "Supporter name public by default",
    amountsDefault: "Support amount public by default",
    paypal: "Enable PayPal option",
    saveSettings: "Save settings",
    saved: "Settings saved",
    localData: "Clear local data",
    localDataHelp: "Clear all transactions, costs, products and settings from this browser. This cannot be undone.",
    clearData: "Clear all local data",
    confirmTitle: "Permanently clear local data?",
    confirmHelp: "Type DELETE to confirm. All Community Support data in this browser will be removed.",
    confirmPlaceholder: "Type DELETE",
    cancel: "Cancel",
    confirmClear: "Clear permanently",
    entryCount: "Transactions",
    recurringTotal: "Recurring season costs",
    productValue: "Stock retail value",
    operational: "Operational costs",
    netSupport: "Net community support",
  },
};

const today = () => new Date().toISOString().slice(0, 10);
const parseAmount = (value: FormDataEntryValue | null) => Number(String(value ?? "").replace(",", "."));
const formatCurrency = (value: number, language: Language) => new Intl.NumberFormat(language === "en" ? "en-GB" : "nl-NL", { style: "currency", currency: "EUR" }).format(value);
const formatUsd = (value: number, language: Language) => new Intl.NumberFormat(language === "en" ? "en-US" : "nl-NL", { style: "currency", currency: "USD" }).format(value);
const INCOME_CATEGORIES: SupportLedgerCategory[] = ["contribution", "merchandise_income", "referral_income", "other"];
const EXPENSE_CATEGORIES: SupportLedgerCategory[] = ["hosting", "server", "domain", "software", "development", "event", "payment_fee", "merchandise_purchase", "shipping", "other"];

const cx = (...classes: Array<string | false | undefined>) => classes.filter(Boolean).join(" ");
const card = "rounded-[1.65rem] bg-card/65 shadow-2xl shadow-black/20 ring-1 ring-white/[0.065]";
const input = "mt-2 w-full rounded-xl bg-black/25 px-3.5 py-3 text-sm text-white outline-none ring-1 ring-white/10 transition placeholder:text-gray-600 focus:ring-2 focus:ring-orange-500/55";
const label = "text-xs font-bold uppercase tracking-[0.14em] text-gray-400";
const primaryButton = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-gradient-racing px-5 py-3 text-sm font-black text-white shadow-lg shadow-orange-950/25 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50";

const SectionHeader = ({ title, help, action }: { title: string; help: string; action?: ReactNode }) => (
  <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
    <div><h2 className="font-heading text-2xl font-black text-white">{title}</h2><p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-400">{help}</p></div>
    {action}
  </div>
);

const Field = ({ title, children, className }: { title: string; children: ReactNode; className?: string }) => (
  <label className={cx("block", className)}><span className={label}>{title}</span>{children}</label>
);

const Toggle = ({ checked, onChange, label: text }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) => (
  <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl bg-white/[0.025] px-4 py-3 ring-1 ring-white/[0.07]">
    <span className="text-sm font-semibold text-gray-200">{text}</span>
    <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="peer sr-only" />
    <span aria-hidden="true" className="relative h-6 w-11 shrink-0 rounded-full bg-gray-700 transition peer-checked:bg-orange-500 peer-focus-visible:ring-2 peer-focus-visible:ring-orange-300"><span className={cx("absolute top-1 h-4 w-4 rounded-full bg-white transition", checked ? "left-6" : "left-1")} /></span>
  </label>
);

const EmptyState = ({ icon, text }: { icon: ReactNode; text: string }) => <div className="flex min-h-36 flex-col items-center justify-center rounded-2xl bg-black/10 p-6 text-center ring-1 ring-white/[0.05]"><span className="text-gray-600">{icon}</span><p className="mt-3 text-sm text-gray-500">{text}</p></div>;

const CommunitySupportModule = () => {
  const { isSuperAdmin } = useAuth();
  const { language: currentLanguage } = useLanguage();
  const language: Language = currentLanguage === "en" ? "en" : "nl";
  const t = COPY[language];
  const {
    state, addLedgerEntry, removeLedgerEntry, addRecurringCost, toggleRecurringCost,
    removeRecurringCost, addCreditPurchase, removeCreditPurchase, saveRaceCost, saveRaceCosts, initializeRaceCosts, removeRaceCost, addProduct, toggleProduct, removeProduct, updateSettings, clearLocalData,
  } = useCommunitySupport();
  const [section, setSection] = useState<SectionId>("dashboard");
  const [selectedMonth, setSelectedMonth] = useState(() => monthKey(new Date()));
  const [selectedYear, setSelectedYear] = useState(() => String(new Date().getFullYear()));
  const [ledgerDirection, setLedgerDirection] = useState<"income" | "expense">("income");
  const [ledgerPublic, setLedgerPublic] = useState(true);
  const [showSupporterName, setShowSupporterName] = useState(state.settings.publicSupporterNamesByDefault);
  const [showSupporterAmount, setShowSupporterAmount] = useState(state.settings.publicSupporterAmountsByDefault);
  const [recurringPublic, setRecurringPublic] = useState(true);
  const [productActive, setProductActive] = useState(false);
  const [productConcept, setProductConcept] = useState(true);
  const [productImages, setProductImages] = useState<string[]>([]);
  const [productImagesBusy, setProductImagesBusy] = useState(false);
  const [productImageError, setProductImageError] = useState<string | null>(null);
  const [settingsDraft, setSettingsDraft] = useState(state.settings);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearPhrase, setClearPhrase] = useState("");
  const ledgerFormRef = useRef<HTMLFormElement>(null);
  const recurringFormRef = useRef<HTMLFormElement>(null);
  const productFormRef = useRef<HTMLFormElement>(null);
  const cancelClearRef = useRef<HTMLButtonElement>(null);
  const clearDialogRef = useRef<HTMLDivElement>(null);

  const availableYears = useMemo(() => Array.from(new Set([
    String(new Date().getFullYear()),
    ...state.ledger.map((entry) => entry.date.slice(0, 4)),
    ...state.recurringCosts.map((cost) => cost.startsOn.slice(0, 4)),
    ...state.creditPurchases.map((purchase) => purchase.date.slice(0, 4)),
    ...state.raceCosts.map((cost) => cost.date.slice(0, 4)),
  ].filter((value) => /^\d{4}$/.test(value)))).sort((a, b) => b.localeCompare(a)), [state.creditPurchases, state.ledger, state.raceCosts, state.recurringCosts]);
  const metrics = useMemo(() => supportMetricsForYear(state, selectedYear), [state, selectedYear]);
  const visibleEntries = useMemo(() => state.ledger.filter((entry) => entry.date.startsWith(selectedMonth)).sort((a, b) => b.date.localeCompare(a.date)), [state.ledger, selectedMonth]);
  const inventoryValue = useMemo(() => state.products.reduce((sum, product) => sum + product.price * product.stock, 0), [state.products]);
  const confirmationWord = language === "en" ? "DELETE" : "WISSEN";

  useEffect(() => {
    setSettingsDraft(state.settings);
  }, [state.settings]);


  useEffect(() => {
    if (!clearOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    cancelClearRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setClearOpen(false);
      if (event.key !== "Tab") return;
      const focusable = Array.from(clearDialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex='-1'])") ?? []);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); previousFocus?.focus(); };
  }, [clearOpen]);

  const categoryOptions = (allowed?: SupportLedgerCategory[]) => (allowed ?? Object.keys(SUPPORT_CATEGORY_LABELS) as SupportLedgerCategory[]).map((category) => (
    <option key={category} value={category}>{SUPPORT_CATEGORY_LABELS[category][language]}</option>
  ));

  const submitLedger = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const amount = parseAmount(data.get("amount"));
    if (!Number.isFinite(amount) || amount <= 0) return;
    const supporterName = String(data.get("supporterName") ?? "").trim();
    const draft: SupportLedgerDraft = {
      date: String(data.get("date")), direction: ledgerDirection,
      category: String(data.get("category")) as SupportLedgerCategory,
      description: String(data.get("description")).trim(), amount, isPublic: ledgerPublic,
      ...(ledgerDirection === "income" && supporterName ? { supporterName, showSupporterName, showAmount: showSupporterAmount } : {}),
    };
    addLedgerEntry(draft);
    form.reset();
    const dateInput = form.elements.namedItem("date") as HTMLInputElement | null;
    if (dateInput) dateInput.value = today();
  };

  const submitRecurring = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const amount = parseAmount(data.get("amount"));
    if (!Number.isFinite(amount) || amount <= 0) return;
    const draft: SupportRecurringCostDraft = {
      startsOn: String(data.get("startsOn")),
      category: String(data.get("category")) as SupportRecurringCostDraft["category"],
      description: String(data.get("description")).trim(), amount,
      frequency: String(data.get("frequency")) as SupportRecurringCostDraft["frequency"],
      isPublic: recurringPublic, active: true,
    };
    addRecurringCost(draft);
    form.reset();
    const dateInput = form.elements.namedItem("startsOn") as HTMLInputElement | null;
    if (dateInput) dateInput.value = today();
  };

  const addProductImages = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const slots = MAX_PRODUCT_IMAGES - productImages.length;
    if (slots <= 0) {
      setProductImageError(t.imageLimit);
      return;
    }
    setProductImagesBusy(true);
    setProductImageError(files.length > slots ? t.imageLimit : null);
    const prepared: string[] = [];
    for (const file of Array.from(files).slice(0, slots)) {
      try {
        prepared.push(await prepareProductImage(file));
      } catch {
        setProductImageError(t.imageError);
      }
    }
    if (prepared.length > 0) setProductImages((current) => [...current, ...prepared].slice(0, MAX_PRODUCT_IMAGES));
    setProductImagesBusy(false);
  };

  const submitProduct = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const draft: SupportProductDraft = {
      name: String(data.get("name")).trim(), description: String(data.get("description")).trim(),
      price: parseAmount(data.get("price")), purchasePrice: parseAmount(data.get("purchasePrice")),
      shippingCost: parseAmount(data.get("shippingCost")), stock: Number(data.get("stock")),
      active: productActive, concept: productConcept,
      imageUrls: productImages,
    };
    if (![draft.price, draft.purchasePrice, draft.shippingCost, draft.stock].every(Number.isFinite) || draft.price < 0 || draft.purchasePrice < 0 || draft.shippingCost < 0 || draft.stock < 0) return;
    addProduct(draft);
    form.reset();
    setProductActive(false);
    setProductConcept(true);
    setProductImages([]);
    setProductImageError(null);
  };

  const submitSettings = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    updateSettings(settingsDraft);
    setSettingsSaved(true);
    window.setTimeout(() => setSettingsSaved(false), 2500);
  };

  const sections: Array<{ id: SectionId; label: string; icon: ReactNode; count?: number }> = [
    { id: "dashboard", label: t.dashboard, icon: <LayoutDashboard className="h-4 w-4" /> },
    { id: "ledger", label: t.ledger, icon: <WalletCards className="h-4 w-4" />, count: state.ledger.length },
    { id: "race-costs", label: t.raceCosts, icon: <Flag className="h-4 w-4" />, count: state.raceCosts.length },
    { id: "recurring", label: t.recurring, icon: <CalendarClock className="h-4 w-4" />, count: state.recurringCosts.length },
    { id: "products", label: t.products, icon: <Box className="h-4 w-4" />, count: state.products.length },
    { id: "settings", label: t.settings, icon: <Settings className="h-4 w-4" /> },
  ];

  if (!isSuperAdmin) return (
    <section className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.055] p-6 text-amber-100">
      <h2 className="font-heading text-xl font-black">{language === "en" ? "Super-admin access required" : "Super-admintoegang vereist"}</h2>
      <p className="mt-2 text-sm text-amber-100/70">{language === "en" ? "Community Support finances are only available to Super-admins." : "Community Support-financiën zijn alleen beschikbaar voor Super-admins."}</p>
    </section>
  );

  return (
    <div className="relative min-w-0 overflow-hidden text-white">
        <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-0 h-[420px] w-[900px] -translate-x-1/2 rounded-full bg-orange-500/[0.07] blur-[120px]" />
        <div className="relative">
          <header className="flex flex-col gap-6 border-b border-white/[0.07] pb-8 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-3"><span className="text-xs font-black uppercase tracking-[0.24em] text-orange-400">{t.eyebrow}</span><span className="inline-flex rounded-full bg-orange-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-orange-200 ring-1 ring-orange-400/20">Super-admin · lokaal</span></div>
              <h1 className="mt-4 font-heading text-4xl font-black tracking-tight sm:text-5xl">{t.title}</h1>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-gray-400 sm:text-base">{t.intro}</p>
            </div>
            <Link to="/support/" className="inline-flex min-h-11 items-center justify-center gap-2 self-start rounded-xl bg-white/[0.04] px-4 py-3 text-sm font-bold text-gray-200 ring-1 ring-white/10 transition hover:bg-white/[0.08] hover:text-white lg:self-auto">{t.publicPage}<ChevronRight className="h-4 w-4" /></Link>
          </header>

          <div className="mt-8 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[230px_minmax(0,1fr)]">
            <nav aria-label={language === "en" ? "Management sections" : "Beheersecties"} className="min-w-0 max-w-full lg:sticky lg:top-24 lg:self-start">
              <div role="tablist" aria-orientation="vertical" className="flex w-full max-w-full gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:rounded-2xl lg:bg-card/45 lg:p-2 lg:ring-1 lg:ring-white/[0.06]">
                {sections.map((item) => <button key={item.id} role="tab" aria-selected={section === item.id} aria-controls={`panel-${item.id}`} onClick={() => setSection(item.id)} className={cx("flex min-h-11 shrink-0 items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400", section === item.id ? "bg-orange-500/12 text-orange-200 ring-1 ring-orange-400/20" : "text-gray-400 hover:bg-white/[0.04] hover:text-white")}>
                  {item.icon}<span>{item.label}</span>{item.count !== undefined && <span className="ml-auto rounded-full bg-black/25 px-2 py-0.5 text-[10px] text-gray-400">{item.count}</span>}
                </button>)}
              </div>
            </nav>

            <div className="min-w-0">
              {section === "dashboard" && <section id="panel-dashboard" role="tabpanel" className="space-y-6">
                <SectionHeader title={t.dashboard} help={language === "en" ? "A live season summary calculated from all recorded costs and contributions in the selected year." : "Een live seizoenssamenvatting van alle geregistreerde kosten en bijdragen in het gekozen jaar."} action={<Field title={t.season} className="w-full sm:w-44"><select value={selectedYear} onChange={(event) => setSelectedYear(event.target.value)} className={input}>{availableYears.map((year) => <option key={year} value={year}>{year}</option>)}</select></Field>} />
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  {[
                    [t.income, metrics.totalIncome, <ArrowUpRight className="h-5 w-5" />, "text-emerald-300 bg-emerald-500/10"],
                    [t.expenses, metrics.totalExpenses, <ArrowDownRight className="h-5 w-5" />, "text-rose-300 bg-rose-500/10"],
                    [t.result, metrics.totalIncome - metrics.totalExpenses, <CircleDollarSign className="h-5 w-5" />, "text-orange-300 bg-orange-500/10"],
                    [t.reserve, metrics.reserve, <WalletCards className="h-5 w-5" />, "text-sky-300 bg-sky-500/10"],
                  ].map(([metricLabel, value, icon, tone]) => <article key={String(metricLabel)} className={cx(card, "p-5")}><div className={cx("flex h-10 w-10 items-center justify-center rounded-xl", String(tone))}>{icon}</div><p className="mt-5 text-xs font-bold uppercase tracking-[0.14em] text-gray-500">{metricLabel}</p><p className="mt-1 text-2xl font-black text-white">{formatCurrency(Number(value), language)}</p></article>)}
                </div>
                <div className={cx(card, "grid gap-6 p-6 md:grid-cols-[1fr_220px] md:p-8")}>
                  <div><p className="text-xs font-black uppercase tracking-[0.18em] text-orange-400">{t.coverage}</p><p className="mt-3 text-4xl font-black">{metrics.coveragePercent}%</p><div className="mt-5 h-2 overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full rounded-full bg-gradient-to-r from-orange-600 to-orange-300 transition-[width]" style={{ width: `${metrics.coveragePercent}%` }} /></div><p className="mt-3 text-sm text-gray-400">{formatCurrency(metrics.communityCovered, language)} / {formatCurrency(metrics.operationalExpenses, language)}</p></div>
                  <dl className="grid gap-3 text-sm"><div className="flex justify-between gap-4"><dt className="text-gray-500">{t.netSupport}</dt><dd className="font-bold">{formatCurrency(metrics.netCommunitySupport, language)}</dd></div><div className="flex justify-between gap-4"><dt className="text-gray-500">{t.openingReserve}</dt><dd className="font-bold">{formatCurrency(metrics.openingReserve, language)}</dd></div><div className="flex justify-between gap-4"><dt className="text-gray-500">{t.reserveUsed}</dt><dd className="font-bold">{formatCurrency(metrics.reserveUsed, language)}</dd></div><div className="flex justify-between gap-4"><dt className="text-gray-500">{t.operational}</dt><dd className="font-bold">{formatCurrency(metrics.operationalExpenses, language)}</dd></div><div className="flex justify-between gap-4"><dt className="text-gray-500">{t.selfFunded}</dt><dd className="font-bold">{formatCurrency(metrics.selfFunded, language)}</dd></div></dl>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  {[[t.entryCount, metrics.entries.length], [t.raceCosts, formatUsd(metrics.raceCreditCostTotalUsd, language)], [t.recurringTotal, formatCurrency(metrics.recurring.reduce((sum, cost) => sum + cost.amount, 0), language)], [t.productValue, formatCurrency(inventoryValue, language)]].map(([name, value]) => <div key={String(name)} className="rounded-2xl bg-white/[0.025] p-5 ring-1 ring-white/[0.06]"><p className="text-xs font-bold uppercase tracking-wider text-gray-500">{name}</p><p className="mt-2 text-xl font-black text-white">{value}</p></div>)}
                </div>
              </section>}

              {section === "ledger" && <section id="panel-ledger" role="tabpanel" className="space-y-6">
                <SectionHeader title={t.ledger} help={t.transactionHelp} action={<Field title={t.month} className="w-full sm:w-44"><input type="month" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} className={input} /></Field>} />
                <form ref={ledgerFormRef} onSubmit={submitLedger} className={cx(card, "grid gap-5 p-6 md:grid-cols-2 xl:grid-cols-4 md:p-8")}>
                  <div className="md:col-span-2 xl:col-span-4"><h3 className="font-heading text-lg font-black">{t.newTransaction}</h3></div>
                  <Field title={t.direction}><select value={ledgerDirection} onChange={(event) => setLedgerDirection(event.target.value as "income" | "expense")} className={input}><option value="income">{t.income}</option><option value="expense">{t.expense}</option></select></Field>
                  <Field title={t.category}><select key={ledgerDirection} name="category" className={input}>{categoryOptions(ledgerDirection === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES)}</select></Field>
                  <Field title={t.date}><input name="date" type="date" required defaultValue={today()} className={input} /></Field>
                  <Field title={t.amount}><input name="amount" type="number" required min="0.01" step="0.01" inputMode="decimal" className={input} /></Field>
                  <Field title={t.description} className="md:col-span-2"><input name="description" required maxLength={160} className={input} /></Field>
                  {ledgerDirection === "income" && <Field title={t.supporterName} className="md:col-span-2"><input name="supporterName" maxLength={100} className={input} /></Field>}
                  <div className="grid gap-3 md:col-span-2 xl:col-span-4 sm:grid-cols-3"><Toggle checked={ledgerPublic} onChange={setLedgerPublic} label={t.public} />{ledgerDirection === "income" && <><Toggle checked={showSupporterName} onChange={setShowSupporterName} label={t.showName} /><Toggle checked={showSupporterAmount} onChange={setShowSupporterAmount} label={t.showAmount} /></>}</div>
                  <button type="submit" className={cx(primaryButton, "md:col-span-2 md:justify-self-start")}><Plus className="h-4 w-4" />{t.addTransaction}</button>
                </form>
                <div className={cx(card, "p-5 md:p-6")}><div className="mb-4 flex items-center justify-between"><h3 className="font-heading font-black">{t.allTransactions}</h3><span className="text-xs text-gray-500">{visibleEntries.length}</span></div>
                  {visibleEntries.length === 0 ? <EmptyState icon={<WalletCards className="h-7 w-7" />} text={t.noTransactions} /> : <div className="space-y-2">{visibleEntries.map((entry) => <article key={entry.id} className="flex flex-col gap-4 rounded-2xl bg-black/15 p-4 ring-1 ring-white/[0.055] sm:flex-row sm:items-center"><div className={cx("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", entry.direction === "income" ? "bg-emerald-500/10 text-emerald-300" : "bg-rose-500/10 text-rose-300")}>{entry.direction === "income" ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-bold text-gray-100">{entry.description}</p>{entry.isPublic ? <Eye className="h-3.5 w-3.5 text-gray-500" aria-label={t.public} /> : <EyeOff className="h-3.5 w-3.5 text-gray-600" />}</div><p className="mt-1 text-xs text-gray-500">{entry.date} · {SUPPORT_CATEGORY_LABELS[entry.category][language]}{entry.supporterName ? ` · ${entry.supporterName}` : ""}</p></div><p className={cx("font-black", entry.direction === "income" ? "text-emerald-300" : "text-rose-300")}>{entry.direction === "income" ? "+" : "−"}{formatCurrency(entry.amount, language)}</p><button type="button" onClick={() => removeLedgerEntry(entry.id)} aria-label={`${t.remove}: ${entry.description}`} className="inline-flex h-10 w-10 items-center justify-center self-end rounded-xl text-gray-500 transition hover:bg-rose-500/10 hover:text-rose-300 focus-visible:ring-2 focus-visible:ring-rose-400 sm:self-auto"><Trash2 className="h-4 w-4" /></button></article>)}</div>}
                </div>
              </section>}

              {section === "race-costs" && <section id="panel-race-costs" role="tabpanel" className="space-y-10">
                <CreditPurchasesSection
                  language={language}
                  selectedYear={selectedYear}
                  purchases={state.creditPurchases}
                  raceCosts={state.raceCosts}
                  onAdd={addCreditPurchase}
                  onRemove={removeCreditPurchase}
                />
                <RaceCostsSection
                  language={language}
                  selectedYear={selectedYear}
                  onSelectedYearChange={setSelectedYear}
                  raceCosts={state.raceCosts}
                  hasRecurringServerCost={state.recurringCosts.some((cost) => cost.category === "server")}
                  onSave={saveRaceCost}
                  onSaveMany={saveRaceCosts}
                  onInitialize={initializeRaceCosts}
                  pricingInitialized={state.settings.racePricingInitialized}
                  onRemove={removeRaceCost}
                />
              </section>}

              {section === "recurring" && <section id="panel-recurring" role="tabpanel" className="space-y-6">
                <SectionHeader title={t.recurring} help={t.recurringHelp} />
                <form ref={recurringFormRef} onSubmit={submitRecurring} className={cx(card, "grid gap-5 p-6 md:grid-cols-2 2xl:grid-cols-5 md:p-8")}>
                  <Field title={t.startsOn}><input name="startsOn" type="date" required defaultValue={today()} className={input} /></Field>
                  <Field title={t.frequency}><select name="frequency" defaultValue="monthly" className={input}><option value="monthly">{t.monthly}</option><option value="yearly">{t.yearly}</option></select></Field>
                  <Field title={t.category}><select name="category" className={input}>{categoryOptions(["hosting", "server", "domain", "software", "development", "other"])}</select></Field>
                  <Field title={t.amount}><input name="amount" type="number" required min="0.01" step="0.01" inputMode="decimal" className={input} /></Field>
                  <Field title={t.description}><input name="description" required maxLength={160} className={input} /></Field>
                  <div className="md:col-span-2"><Toggle checked={recurringPublic} onChange={setRecurringPublic} label={t.public} /></div><button type="submit" className={cx(primaryButton, "md:col-span-2 md:justify-self-end")}><Plus className="h-4 w-4" />{t.addRecurring}</button>
                </form>
                {state.recurringCosts.length === 0 ? <EmptyState icon={<CalendarClock className="h-7 w-7" />} text={t.noRecurring} /> : <div className="grid gap-3">{state.recurringCosts.map((cost) => <article key={cost.id} className={cx(card, "flex flex-col gap-4 p-5 sm:flex-row sm:items-center")}><button type="button" role="switch" aria-checked={cost.active} onClick={() => toggleRecurringCost(cost.id)} className={cx("inline-flex min-h-10 items-center gap-2 self-start rounded-xl px-3 text-xs font-black ring-1 transition sm:self-auto", cost.active ? "bg-emerald-500/10 text-emerald-300 ring-emerald-400/20" : "bg-white/[0.03] text-gray-500 ring-white/10")}><span className={cx("h-2 w-2 rounded-full", cost.active ? "bg-emerald-400" : "bg-gray-600")} />{cost.active ? t.active : t.inactive}</button><div className="min-w-0 flex-1"><p className="font-bold">{cost.description}</p><p className="mt-1 text-xs text-gray-500">{SUPPORT_CATEGORY_LABELS[cost.category][language]} · {cost.frequency === "yearly" ? t.yearly : t.monthly} · {t.startsOn}: {cost.startsOn} · {cost.isPublic ? t.public : language === "en" ? "Private" : "Privé"}</p></div><p className="font-black">{formatCurrency(cost.amount, language)}<span className="ml-1 text-xs font-medium text-gray-500">/{cost.frequency === "yearly" ? (language === "en" ? "yr" : "jr") : (language === "en" ? "mo" : "mnd")}</span></p><button type="button" onClick={() => removeRecurringCost(cost.id)} aria-label={`${t.remove}: ${cost.description}`} className="inline-flex h-10 w-10 items-center justify-center self-end rounded-xl text-gray-500 hover:bg-rose-500/10 hover:text-rose-300 focus-visible:ring-2 focus-visible:ring-rose-400 sm:self-auto"><Trash2 className="h-4 w-4" /></button></article>)}</div>}
              </section>}

              {section === "products" && <section id="panel-products" role="tabpanel" className="space-y-6">
                <SectionHeader title={t.products} help={t.productsHelp} />
                <form ref={productFormRef} onSubmit={submitProduct} className={cx(card, "grid gap-5 p-6 md:grid-cols-2 xl:grid-cols-4 md:p-8")}>
                  <Field title={t.productName} className="md:col-span-2 xl:col-span-4"><input name="name" required maxLength={100} className={input} /></Field>
                  <div className="min-w-0 md:col-span-2 xl:col-span-4"><p className={label}>{t.productImages}</p><div className="mt-2 rounded-2xl border border-dashed border-white/15 bg-black/15 p-4 sm:p-5"><div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="text-sm font-bold text-gray-200">{productImages.length}/{MAX_PRODUCT_IMAGES} {t.productImages.toLowerCase()}</p><p id="product-image-help" className="mt-1 max-w-2xl text-xs leading-relaxed text-gray-500">{t.imageHelp}</p></div><label className={cx(primaryButton, "shrink-0 cursor-pointer", (productImagesBusy || productImages.length >= MAX_PRODUCT_IMAGES) && "pointer-events-none opacity-50")}><Images className="h-4 w-4" />{productImagesBusy ? (language === "en" ? "Processing…" : "Verwerken…") : t.chooseImages}<input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={productImagesBusy || productImages.length >= MAX_PRODUCT_IMAGES} aria-describedby="product-image-help" className="sr-only" onChange={(event) => { const files = event.currentTarget.files; event.currentTarget.value = ""; void addProductImages(files); }} /></label></div>
                    {productImages.length > 0 && <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">{productImages.map((imageUrl, index) => <div key={`${imageUrl.slice(-24)}-${index}`} className="group relative aspect-square overflow-hidden rounded-xl bg-black/25 ring-1 ring-white/10"><img src={imageUrl} alt={`${t.productImages} ${index + 1}`} className="h-full w-full object-cover" />{index === 0 && <span className="absolute bottom-2 left-2 rounded-full bg-black/75 px-2 py-1 text-[10px] font-black text-white">{t.mainImage}</span>}<button type="button" onClick={() => setProductImages((current) => current.filter((_, imageIndex) => imageIndex !== index))} aria-label={`${t.removeImage} ${index + 1}`} className="absolute right-2 top-2 inline-flex h-9 w-9 items-center justify-center rounded-xl bg-black/75 text-white ring-1 ring-white/15 hover:bg-rose-600"><X className="h-4 w-4" /></button></div>)}</div>}
                    {productImageError && <p role="alert" className="mt-3 text-xs font-bold text-rose-300">{productImageError}</p>}
                  </div></div>
                  <Field title={t.productDescription} className="md:col-span-2 xl:col-span-4"><textarea name="description" required maxLength={500} rows={3} className={input} /></Field><Field title={t.price}><input name="price" type="number" required min="0" step="0.01" className={input} /></Field><Field title={t.purchasePrice}><input name="purchasePrice" type="number" required min="0" step="0.01" className={input} /></Field><Field title={t.shippingCost}><input name="shippingCost" type="number" required min="0" step="0.01" className={input} /></Field><Field title={t.stock}><input name="stock" type="number" required min="0" step="1" className={input} /></Field>
                  <div className="grid gap-3 md:col-span-2 sm:grid-cols-2"><Toggle checked={productConcept} onChange={setProductConcept} label={t.concept} /><Toggle checked={productActive} onChange={setProductActive} label={t.active} /></div><button type="submit" className={cx(primaryButton, "md:col-span-2 md:justify-self-end")}><Plus className="h-4 w-4" />{t.addProduct}</button>
                </form>
                {state.products.length === 0 ? <EmptyState icon={<PackageOpen className="h-7 w-7" />} text={t.noProducts} /> : <div className="grid gap-4 md:grid-cols-2">{state.products.map((product) => { const margin = product.price - product.purchasePrice - product.shippingCost; return <article key={product.id} className={cx(card, "overflow-hidden")}>
                  {product.imageUrls.length > 0 && <div className={cx("grid aspect-[16/7] gap-px overflow-hidden bg-black/30", product.imageUrls.length > 1 && "grid-cols-2")}>{product.imageUrls.map((imageUrl, index) => <img key={`${imageUrl.slice(-24)}-${index}`} src={imageUrl} alt={`${product.name} ${index + 1}`} loading="lazy" className="h-full min-h-0 w-full object-cover" />)}</div>}
                  <div className="p-5"><div className="flex items-start justify-between gap-4"><div><div className="flex flex-wrap gap-2"><span className={cx("rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider", product.concept ? "bg-amber-500/10 text-amber-300" : "bg-sky-500/10 text-sky-300")}>{product.concept ? t.concept : t.published}</span><button type="button" role="switch" aria-checked={product.active} onClick={() => toggleProduct(product.id)} className={cx("rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider", product.active ? "bg-emerald-500/10 text-emerald-300" : "bg-white/[0.04] text-gray-500")}>{product.active ? t.active : t.inactive}</button></div><h3 className="mt-3 font-heading text-lg font-black">{product.name}</h3></div><button type="button" onClick={() => removeProduct(product.id)} aria-label={`${t.remove}: ${product.name}`} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-gray-500 hover:bg-rose-500/10 hover:text-rose-300 focus-visible:ring-2 focus-visible:ring-rose-400"><Trash2 className="h-4 w-4" /></button></div><p className="mt-2 line-clamp-3 text-sm leading-relaxed text-gray-400">{product.description}</p><dl className="mt-5 grid grid-cols-3 gap-3 border-t border-white/[0.06] pt-4 text-xs"><div><dt className="text-gray-500">{t.price}</dt><dd className="mt-1 font-bold text-white">{formatCurrency(product.price, language)}</dd></div><div><dt className="text-gray-500">{t.stock}</dt><dd className="mt-1 font-bold text-white">{product.stock}</dd></div><div><dt className="text-gray-500">{t.margin}</dt><dd className={cx("mt-1 font-bold", margin >= 0 ? "text-emerald-300" : "text-rose-300")}>{formatCurrency(margin, language)}</dd></div></dl></div>
                </article>; })}</div>}
              </section>}

              {section === "settings" && <section id="panel-settings" role="tabpanel" className="space-y-6">
                <SectionHeader title={t.settings} help={t.settingsHelp} />
                <form onSubmit={submitSettings} className={cx(card, "space-y-6 p-6 md:p-8")}>
                  <div className="grid max-w-2xl gap-5 sm:grid-cols-2"><Field title={t.currentReserve}><input type="number" min="0" step="0.01" value={settingsDraft.reserve} onChange={(event) => setSettingsDraft((current) => ({ ...current, reserve: Number(event.target.value) }))} className={input} /></Field><Field title={t.reserveStartYear}><input type="number" min="2000" max="2100" step="1" value={settingsDraft.reserveStartYear ?? String(new Date().getFullYear())} onChange={(event) => setSettingsDraft((current) => ({ ...current, reserveStartYear: event.target.value }))} className={input} /></Field></div>
                  <div><h3 className="mb-3 text-sm font-black text-gray-200">{t.supporterDefaults}</h3><div className="grid gap-3 md:grid-cols-2"><Toggle checked={settingsDraft.publicSupporterNamesByDefault} onChange={(checked) => setSettingsDraft((current) => ({ ...current, publicSupporterNamesByDefault: checked }))} label={t.namesDefault} /><Toggle checked={settingsDraft.publicSupporterAmountsByDefault} onChange={(checked) => setSettingsDraft((current) => ({ ...current, publicSupporterAmountsByDefault: checked }))} label={t.amountsDefault} /><Toggle checked={settingsDraft.paypalEnabled} onChange={(checked) => setSettingsDraft((current) => ({ ...current, paypalEnabled: checked }))} label={t.paypal} /></div></div>
                  <button type="submit" className={primaryButton}>{settingsSaved ? <Check className="h-4 w-4" /> : <Settings className="h-4 w-4" />}{settingsSaved ? t.saved : t.saveSettings}</button>
                </form>
                <div className="rounded-[1.65rem] bg-rose-500/[0.045] p-6 ring-1 ring-rose-400/15 md:p-8"><div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between"><div className="flex gap-4"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-rose-500/10 text-rose-300"><ShieldAlert className="h-5 w-5" /></div><div><h3 className="font-heading text-lg font-black">{t.localData}</h3><p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-400">{t.localDataHelp}</p></div></div><button type="button" onClick={() => { setClearPhrase(""); setClearOpen(true); }} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-rose-500/10 px-4 py-3 text-sm font-black text-rose-200 ring-1 ring-rose-400/20 transition hover:bg-rose-500/20"><Trash2 className="h-4 w-4" />{t.clearData}</button></div></div>
              </section>}
            </div>
          </div>
        </div>
      {clearOpen && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) setClearOpen(false); }}>
        <div ref={clearDialogRef} role="dialog" aria-modal="true" aria-labelledby="clear-data-title" aria-describedby="clear-data-description" className="w-full max-w-lg rounded-[1.65rem] bg-card p-6 shadow-2xl shadow-black/60 ring-1 ring-rose-400/20 md:p-8">
          <div className="flex items-start justify-between gap-4"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-300"><ShieldAlert className="h-5 w-5" /></div><button type="button" onClick={() => setClearOpen(false)} aria-label={t.cancel} className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-gray-500 hover:bg-white/[0.05] hover:text-white"><X className="h-5 w-5" /></button></div>
          <h2 id="clear-data-title" className="mt-5 font-heading text-2xl font-black">{t.confirmTitle}</h2><p id="clear-data-description" className="mt-3 text-sm leading-relaxed text-gray-400">{t.confirmHelp}</p>
          <input value={clearPhrase} onChange={(event) => setClearPhrase(event.target.value)} placeholder={t.confirmPlaceholder} autoComplete="off" className={cx(input, "mt-5")} />
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button ref={cancelClearRef} type="button" onClick={() => setClearOpen(false)} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-white/[0.04] px-4 py-3 text-sm font-bold text-gray-200 ring-1 ring-white/10 hover:bg-white/[0.08]">{t.cancel}</button><button type="button" disabled={clearPhrase !== confirmationWord} onClick={() => { clearLocalData(); setSettingsDraft({ reserve: 0, reserveStartYear: String(new Date().getFullYear()), publicSupporterNamesByDefault: true, publicSupporterAmountsByDefault: false, paypalEnabled: false }); setClearOpen(false); setSection("dashboard"); }} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-3 text-sm font-black text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-40"><RotateCcw className="h-4 w-4" />{t.confirmClear}</button></div>
        </div>
      </div>}
    </div>
  );
};

export default CommunitySupportModule;
