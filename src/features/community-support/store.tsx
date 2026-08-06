import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { z } from "zod";
import { useAuth } from "@/contexts/AuthContext";
import type {
  CommunitySupportSettings,
  CommunitySupportState,
  SupportLedgerEntry,
  SupportProduct,
  SupportPaymentIntent,
  SupportPaymentIntentDraft,
  SupportRaceCost,
  SupportRecurringCost,
} from "./types";
import { isSupportedCommunitySupportRace } from "./raceEligibility";
import { calculateRaceHostingAmountUsd, calculateRaceHostingEurBreakdown, DEFAULT_USD_EUR_RATE, normalizeHostedHours, normalizeUsdEurRate, RACE_HOSTING_VAT_RATE } from "./raceHostingPricing";
import { createPaymentIntent, DEFAULT_PAYPAL_AMOUNTS_EUR, normalizeDiscordUserId, normalizeIracingReferralUrl, normalizePayPalAmounts, normalizePayPalMeUrl, resolvePaymentIntent } from "./paymentFlow";
import { COMMUNITY_SUPPORT_HAS_SHARED_DATA } from "./model";
import {
  clearSharedCommunitySupportData,
  deleteLedgerEntry,
  deleteProduct,
  deleteRaceCost,
  deleteRecurringCost,
  emptySharedSupportState,
  fetchAdminCommunitySupportState,
  insertLedgerEntry,
  insertProduct,
  insertRecurringCost,
  saveCommunitySupportSettings,
  setProductVisibility,
  setRecurringCostActive,
  upsertRaceCosts,
} from "./supportDataApi";

const STORAGE_PREFIX = "3sm-community-support-session-v2";
const INCOME_CATEGORIES = new Set(["contribution", "merchandise_income", "referral_income", "other"]);
const EXPENSE_CATEGORIES = new Set(["hosting", "server", "domain", "software", "development", "event", "payment_fee", "merchandise_purchase", "shipping", "other"]);

const INITIAL_STATE: CommunitySupportState = {
  ledger: [],
  recurringCosts: [],
  raceCosts: [],
  products: [],
  paymentIntents: [],
  settings: {
    reserve: 0,
    reserveStartYear: String(new Date().getFullYear()),
    racePricingInitialized: false,
    usdEurRate: DEFAULT_USD_EUR_RATE,
    publicSupporterNamesByDefault: true,
    publicSupporterAmountsByDefault: false,
    paypalEnabled: false,
    paypalCheckoutEnabled: false,
    paypalCheckoutEnvironment: "sandbox",
    paypalMeUrl: "",
    paypalSuggestedAmounts: [...DEFAULT_PAYPAL_AMOUNTS_EUR],
    paymentAdminDiscordId: "",
    iracingReferralEnabled: false,
    iracingReferralUrl: "",
  },
};

const categorySchema = z.enum([
  "contribution", "merchandise_income", "referral_income", "hosting", "server", "race_hosting", "domain", "software",
  "development", "event", "payment_fee", "merchandise_purchase", "shipping", "other",
]);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const moneySchema = z.number().finite().min(0).max(1_000_000);
const positiveMoneySchema = z.number().finite().gt(0).max(1_000_000);
const ledgerSchema = z.object({
  id: z.string().min(1).max(100),
  date: dateSchema,
  direction: z.enum(["income", "expense"]),
  category: categorySchema,
  description: z.string().min(1).max(160),
  amount: moneySchema,
  isPublic: z.boolean(),
  supporterName: z.string().max(100).optional(),
  showSupporterName: z.boolean().optional(),
  showAmount: z.boolean().optional(),
}).superRefine((entry, context) => {
  const valid = entry.direction === "income" ? INCOME_CATEGORIES.has(entry.category) : EXPENSE_CATEGORIES.has(entry.category);
  if (!valid) context.addIssue({ code: z.ZodIssueCode.custom, message: "category does not match direction", path: ["category"] });
});
const recurringSchema = z.object({
  id: z.string().min(1).max(100), startsOn: dateSchema,
  category: z.enum(["hosting", "server", "domain", "software", "development", "other"]),
  description: z.string().min(1).max(160), amount: moneySchema, frequency: z.enum(["monthly", "yearly"]).default("monthly"), isPublic: z.boolean(), active: z.boolean(),
});
const raceCostSchema = z.preprocess((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const hostedHours = typeof record.hostedHours === "number" ? record.hostedHours : 1;
  const discountApplied = record.discountApplied === true;
  const sourceAmountUsd = typeof record.sourceAmountUsd === "number"
    ? record.sourceAmountUsd
    : calculateRaceHostingAmountUsd(hostedHours, discountApplied);
  const exchangeRateUsdEur = typeof record.exchangeRateUsdEur === "number" ? record.exchangeRateUsdEur : DEFAULT_USD_EUR_RATE;
  const vatRate = typeof record.vatRate === "number" ? record.vatRate : RACE_HOSTING_VAT_RATE;
  const breakdown = calculateRaceHostingEurBreakdown(sourceAmountUsd, exchangeRateUsdEur, vatRate);
  const vatAmountUsd = typeof record.vatAmountUsd === "number" ? record.vatAmountUsd : breakdown.vatAmountUsd;
  const grossAmountUsd = typeof record.grossAmountUsd === "number" ? record.grossAmountUsd : breakdown.grossAmountUsd;
  const netAmount = typeof record.netAmount === "number" ? record.netAmount : breakdown.netAmount;
  const vatAmount = typeof record.vatAmount === "number" ? record.vatAmount : breakdown.vatAmount;
  const amount = typeof record.amount === "number" && record.vatRate !== undefined ? record.amount : breakdown.amount;
  const migrated = { ...record };
  delete migrated.creditCostUsd;
  delete migrated.pricingSource;
  delete migrated.amountEur;
  return { ...migrated, sourceAmountUsd, exchangeRateUsdEur, vatRate, vatAmountUsd, grossAmountUsd, netAmount, vatAmount, amount };
}, z.object({
  id: z.string().min(1).max(100),
  raceId: z.string().min(1).max(100),
  raceScope: z.enum(["season", "standalone"]),
  leagueId: z.string().min(1).max(100).optional(),
  leagueName: z.string().min(1).max(120).optional(),
  season: z.string().min(1).max(40).optional(),
  raceName: z.string().min(1).max(160),
  track: z.string().min(1).max(160),
  date: dateSchema,
  raceFormat: z.string().max(80).optional(),
  hostedHours: z.number().int().min(1).max(24).default(1),
  discountApplied: z.boolean().default(false),
  sourceAmountUsd: positiveMoneySchema,
  exchangeRateUsdEur: z.number().finite().gt(0).max(10),
  vatRate: z.number().finite().min(0).max(1), vatAmountUsd: moneySchema, grossAmountUsd: positiveMoneySchema,
  netAmount: positiveMoneySchema, vatAmount: moneySchema,
  amount: positiveMoneySchema,
  isPublic: z.boolean(),
  note: z.string().max(240).optional(),
}).superRefine((cost, context) => {
  if (cost.raceScope === "season" && !cost.leagueId) context.addIssue({ code: z.ZodIssueCode.custom, message: "season race requires leagueId", path: ["leagueId"] });
  if (cost.raceScope === "standalone" && cost.leagueId) context.addIssue({ code: z.ZodIssueCode.custom, message: "standalone race cannot have leagueId", path: ["leagueId"] });
  if (!isSupportedCommunitySupportRace(cost)) context.addIssue({ code: z.ZodIssueCode.custom, message: "race format is outside this prototype", path: ["raceFormat"] });
}));
const productImageSchema = z.string().max(300_000).refine((value) => /^data:image\/(?:jpeg|png|webp);base64,/i.test(value) || /^https?:\/\//i.test(value), "unsupported product image");
const productSchema = z.preprocess((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const { imageUrl, ...rest } = record;
  return {
    ...rest,
    imageUrls: Array.isArray(record.imageUrls)
      ? record.imageUrls
      : typeof imageUrl === "string" && imageUrl.length > 0 ? [imageUrl] : [],
  };
}, z.object({
  id: z.string().min(1).max(100), name: z.string().min(1).max(100), description: z.string().min(1).max(500),
  price: moneySchema, purchasePrice: moneySchema, shippingCost: moneySchema,
  fulfillmentMode: z.enum(["physical", "digital"]).default("physical"),
  stock: z.number().int().min(0).max(1_000_000), active: z.boolean(), concept: z.boolean(),
  imageUrls: z.array(productImageSchema).max(4).default([]),
}));
const paymentIntentSchema = z.object({
  id: z.string().min(1).max(100),
  requestedAmount: positiveMoneySchema,
  payerName: z.string().min(1).max(100),
  showSupporterName: z.boolean(),
  showAmount: z.boolean(),
  status: z.enum(["pending", "approved", "confirmed", "partially_refunded", "refunded", "reversed", "not_found"]),
  createdAt: z.string().datetime(),
  resolvedAt: z.string().datetime().optional(),
  grossAmount: positiveMoneySchema.optional(),
  feeAmount: moneySchema.optional(),
  resolutionNote: z.string().min(1).max(500).optional(),
});
const stateSchema = z.object({
  ledger: z.array(ledgerSchema).max(5_000),
  recurringCosts: z.array(recurringSchema).max(500),
  raceCosts: z.array(raceCostSchema).max(1_000).default([]),
  products: z.array(productSchema).max(500),
  paymentIntents: z.array(paymentIntentSchema).max(500).default([]),
  settings: z.object({
    reserve: moneySchema,
    reserveStartYear: z.string().regex(/^\d{4}$/).optional(),
    racePricingInitialized: z.boolean().default(false),
    usdEurRate: z.number().finite().gt(0).max(10).default(DEFAULT_USD_EUR_RATE),
    publicSupporterNamesByDefault: z.boolean(),
    publicSupporterAmountsByDefault: z.boolean(),
    paypalEnabled: z.boolean(),
    paypalCheckoutEnabled: z.boolean().default(false),
    paypalCheckoutEnvironment: z.enum(["sandbox", "live"]).default("sandbox"),
    paypalMeUrl: z.string().max(200).default(""),
    paypalSuggestedAmounts: z.array(positiveMoneySchema).max(6).default([...DEFAULT_PAYPAL_AMOUNTS_EUR]),
    paymentAdminDiscordId: z.string().max(20).default(""),
    iracingReferralEnabled: z.boolean().default(false),
    iracingReferralUrl: z.string().max(500).refine((value) => value === "" || normalizeIracingReferralUrl(value) !== null, "invalid iRacing referral URL").default(""),
  }),
}).superRefine((state, context) => {
  const seenRaceIds = new Set<string>();
  state.raceCosts.forEach((cost, index) => {
    if (seenRaceIds.has(cost.raceId)) context.addIssue({ code: z.ZodIssueCode.custom, message: "race cost must be unique per race", path: ["raceCosts", index, "raceId"] });
    seenRaceIds.add(cost.raceId);
  });
});

const safeAmount = (value: number) => Number.isFinite(value) ? Math.max(0, Math.round(value * 100) / 100) : 0;
const createLocalId = () => {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === "function") globalThis.crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
};
const withId = <T extends object>(value: T): T & { id: string } => ({ ...value, id: createLocalId() });
const storageKeyFor = (userId: string) => `${STORAGE_PREFIX}:${userId}`;

const loadState = (storageKey: string): CommunitySupportState => {
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) return INITIAL_STATE;
    const result = stateSchema.safeParse(JSON.parse(raw));
    if (!result.success) {
      window.sessionStorage.removeItem(storageKey);
      console.warn("Community Support session data was invalid and has been cleared.");
      return INITIAL_STATE;
    }
    return result.data as CommunitySupportState;
  } catch {
    return INITIAL_STATE;
  }
};

export type SupportLedgerDraft = Omit<SupportLedgerEntry, "id">;
export type SupportRecurringCostDraft = Omit<SupportRecurringCost, "id">;
export type SupportRaceCostDraft = Omit<SupportRaceCost, "id" | "amount" | "sourceAmountUsd" | "exchangeRateUsdEur" | "vatRate" | "vatAmountUsd" | "grossAmountUsd" | "netAmount" | "vatAmount"> & { exchangeRateUsdEur?: number };
export type SupportProductDraft = Omit<SupportProduct, "id">;

const normalizeRaceCostDraft = (draft: SupportRaceCostDraft, defaultUsdEurRate: number): Omit<SupportRaceCost, "id"> | null => {
  if (!isSupportedCommunitySupportRace(draft)) return null;
  if ((draft.raceScope === "season") !== Boolean(draft.leagueId)) return null;
  const hostedHours = normalizeHostedHours(draft.hostedHours);
  if (hostedHours === null) return null;
  const exchangeRateUsdEur = normalizeUsdEurRate(draft.exchangeRateUsdEur ?? defaultUsdEurRate);
  if (exchangeRateUsdEur === null) return null;
  const sourceAmountUsd = calculateRaceHostingAmountUsd(hostedHours, draft.discountApplied);
  const breakdown = calculateRaceHostingEurBreakdown(sourceAmountUsd, exchangeRateUsdEur);
  return {
    ...draft,
    hostedHours,
    discountApplied: Boolean(draft.discountApplied),
    date: draft.date.slice(0, 10),
    sourceAmountUsd,
    exchangeRateUsdEur,
    ...breakdown,
    note: draft.note?.trim() || undefined,
  };
};

const saveRaceCostDrafts = (current: CommunitySupportState, drafts: SupportRaceCostDraft[]): CommunitySupportState => {
  const raceCosts = [...current.raceCosts];
  drafts.forEach((draft) => {
    const existingIndex = raceCosts.findIndex((cost) => cost.raceId === draft.raceId);
    const normalized = normalizeRaceCostDraft({
      ...draft,
      ...(existingIndex >= 0 ? { exchangeRateUsdEur: raceCosts[existingIndex].exchangeRateUsdEur } : {}),
    }, current.settings.usdEurRate);
    if (!normalized) return;
    if (existingIndex >= 0) raceCosts[existingIndex] = { ...normalized, id: raceCosts[existingIndex].id };
    else raceCosts.unshift(withId(normalized));
  });
  return { ...current, raceCosts };
};

type CommunitySupportStore = {
  state: CommunitySupportState;
  loading: boolean;
  persistenceError: string | null;
  addLedgerEntry: (draft: SupportLedgerDraft) => Promise<boolean>;
  removeLedgerEntry: (id: string) => Promise<boolean>;
  addRecurringCost: (draft: SupportRecurringCostDraft) => Promise<boolean>;
  toggleRecurringCost: (id: string) => Promise<boolean>;
  removeRecurringCost: (id: string) => Promise<boolean>;
  saveRaceCost: (draft: SupportRaceCostDraft) => Promise<boolean>;
  saveRaceCosts: (drafts: SupportRaceCostDraft[]) => Promise<boolean>;
  initializeRaceCosts: (drafts: SupportRaceCostDraft[]) => Promise<boolean>;
  removeRaceCost: (id: string) => Promise<boolean>;
  addProduct: (draft: SupportProductDraft) => Promise<boolean>;
  toggleProduct: (id: string) => Promise<boolean>;
  toggleProductPublication: (id: string) => Promise<boolean>;
  removeProduct: (id: string) => Promise<boolean>;
  updateSettings: (settings: Partial<CommunitySupportSettings>) => Promise<boolean>;
  addPaymentIntent: (draft: SupportPaymentIntentDraft) => SupportPaymentIntent | null;
  resolvePayment: (id: string, action: "confirm" | "not_found", grossAmount?: number, feeAmount?: number, resolutionNote?: string) => boolean;
  clearLocalData: () => Promise<boolean>;
};

const CommunitySupportContext = createContext<CommunitySupportStore | null>(null);

export const CommunitySupportProvider = ({ children }: { children: ReactNode }) => {
  const { user, isAdmin, isSuperAdmin } = useAuth();
  const canManage = Boolean(user && (isAdmin || isSuperAdmin));
  const storageKey = !COMMUNITY_SUPPORT_HAS_SHARED_DATA && canManage && user ? storageKeyFor(user.id) : null;
  const [state, setState] = useState<CommunitySupportState>(() => COMMUNITY_SUPPORT_HAS_SHARED_DATA ? emptySharedSupportState() : INITIAL_STATE);
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(COMMUNITY_SUPPORT_HAS_SHARED_DATA && canManage);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const activeKeyRef = useRef<string | null>(null);
  const skipNextPersistRef = useRef(false);

  const persist = useCallback(async (operation: Promise<void>) => {
    setPersistenceError(null);
    try {
      await operation;
      setState(await fetchAdminCommunitySupportState());
      return true;
    } catch (error) {
      setPersistenceError(error instanceof Error ? error.message : "Community Support-wijziging kon niet worden opgeslagen.");
      try {
        setState(await fetchAdminCommunitySupportState());
      } catch {
        setState(emptySharedSupportState());
      }
      return false;
    }
  }, []);

  useEffect(() => {
    if (!COMMUNITY_SUPPORT_HAS_SHARED_DATA) return;
    if (!canManage) {
      setState(emptySharedSupportState());
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void fetchAdminCommunitySupportState().then((sharedState) => {
      if (!cancelled) {
        setState(sharedState);
        setPersistenceError(null);
      }
    }).catch((error) => {
      if (!cancelled) setPersistenceError(error instanceof Error ? error.message : "Community Support-data kon niet worden geladen.");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [canManage]);

  useEffect(() => {
    if (COMMUNITY_SUPPORT_HAS_SHARED_DATA) return;
    const previousKey = activeKeyRef.current;
    if (previousKey && previousKey !== storageKey) {
      try { window.sessionStorage.removeItem(previousKey); } catch { /* memory state is still cleared below */ }
    }
    activeKeyRef.current = storageKey;
    if (!storageKey) {
      setState(INITIAL_STATE);
      setHydratedKey(null);
      return;
    }
    setState(loadState(storageKey));
    setHydratedKey(storageKey);
  }, [storageKey]);

  useEffect(() => {
    if (COMMUNITY_SUPPORT_HAS_SHARED_DATA) return;
    if (!storageKey || hydratedKey !== storageKey) return;
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false;
      return;
    }
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      console.warn("Community Support session data could not be saved; changes remain in memory only.");
    }
  }, [state, storageKey, hydratedKey]);

  const addLedgerEntry = useCallback(async (draft: SupportLedgerDraft) => {
    if (draft.category === "race_hosting") return true;
    const normalized = withId({ ...draft, amount: safeAmount(draft.amount) });
    setState((current) => ({ ...current, ledger: [normalized, ...current.ledger] }));
    return COMMUNITY_SUPPORT_HAS_SHARED_DATA ? persist(insertLedgerEntry(normalized)) : true;
  }, [persist]);
  const removeLedgerEntry = useCallback(async (id: string) => {
    setState((current) => ({ ...current, ledger: current.ledger.filter((entry) => entry.id !== id) }));
    return COMMUNITY_SUPPORT_HAS_SHARED_DATA ? persist(deleteLedgerEntry(id)) : true;
  }, [persist]);
  const addRecurringCost = useCallback(async (draft: SupportRecurringCostDraft) => {
    const normalized = withId({ ...draft, amount: safeAmount(draft.amount) });
    setState((current) => ({ ...current, recurringCosts: [normalized, ...current.recurringCosts] }));
    return COMMUNITY_SUPPORT_HAS_SHARED_DATA ? persist(insertRecurringCost(normalized)) : true;
  }, [persist]);
  const toggleRecurringCost = useCallback(async (id: string) => {
    const existing = state.recurringCosts.find((cost) => cost.id === id);
    if (!existing) return true;
    setState((current) => ({ ...current, recurringCosts: current.recurringCosts.map((cost) => cost.id === id ? { ...cost, active: !cost.active } : cost) }));
    return COMMUNITY_SUPPORT_HAS_SHARED_DATA ? persist(setRecurringCostActive(id, !existing.active)) : true;
  }, [persist, state.recurringCosts]);
  const removeRecurringCost = useCallback(async (id: string) => {
    setState((current) => ({ ...current, recurringCosts: current.recurringCosts.filter((cost) => cost.id !== id) }));
    return COMMUNITY_SUPPORT_HAS_SHARED_DATA ? persist(deleteRecurringCost(id)) : true;
  }, [persist]);
  const saveRaceCost = useCallback(async (draft: SupportRaceCostDraft) => {
    const next = saveRaceCostDrafts(state, [draft]);
    const saved = next.raceCosts.find((cost) => cost.raceId === draft.raceId);
    setState(next);
    return COMMUNITY_SUPPORT_HAS_SHARED_DATA && saved ? persist(upsertRaceCosts([saved])) : true;
  }, [persist, state]);
  const saveRaceCosts = useCallback(async (drafts: SupportRaceCostDraft[]) => {
    const next = saveRaceCostDrafts(state, drafts);
    const raceIds = new Set(drafts.map((draft) => draft.raceId));
    const saved = next.raceCosts.filter((cost) => raceIds.has(cost.raceId));
    setState(next);
    return COMMUNITY_SUPPORT_HAS_SHARED_DATA ? persist(upsertRaceCosts(saved)) : true;
  }, [persist, state]);
  const initializeRaceCosts = useCallback(async (drafts: SupportRaceCostDraft[]) => {
    const existingRaceIds = new Set(state.raceCosts.map((cost) => cost.raceId));
    const missingDrafts = drafts.filter((draft) => !existingRaceIds.has(draft.raceId));
    if (missingDrafts.length === 0) {
      if (!state.settings.racePricingInitialized) {
        const settings = { ...state.settings, racePricingInitialized: true };
        setState({ ...state, settings });
        return COMMUNITY_SUPPORT_HAS_SHARED_DATA ? persist(saveCommunitySupportSettings(settings)) : true;
      }
      return true;
    }
    const initialized = saveRaceCostDrafts(state, missingDrafts);
    const next = { ...initialized, settings: { ...initialized.settings, racePricingInitialized: true } };
    const newRaceIds = new Set(missingDrafts.map((draft) => draft.raceId));
    setState(next);
    if (COMMUNITY_SUPPORT_HAS_SHARED_DATA) {
      return persist(Promise.all([
        upsertRaceCosts(next.raceCosts.filter((cost) => newRaceIds.has(cost.raceId)), true),
        saveCommunitySupportSettings(next.settings),
      ]).then(() => undefined));
    }
    return true;
  }, [persist, state]);
  const removeRaceCost = useCallback(async (id: string) => {
    setState((current) => ({ ...current, raceCosts: current.raceCosts.filter((cost) => cost.id !== id) }));
    return COMMUNITY_SUPPORT_HAS_SHARED_DATA ? persist(deleteRaceCost(id)) : true;
  }, [persist]);
  const addProduct = useCallback(async (draft: SupportProductDraft) => {
    const normalized = withId({ ...draft, price: safeAmount(draft.price), purchasePrice: safeAmount(draft.purchasePrice), shippingCost: draft.fulfillmentMode === "physical" ? safeAmount(draft.shippingCost) : 0, stock: Math.max(0, Math.floor(draft.stock)) });
    setState((current) => ({ ...current, products: [normalized, ...current.products] }));
    return COMMUNITY_SUPPORT_HAS_SHARED_DATA ? persist(insertProduct(normalized)) : true;
  }, [persist]);
  const toggleProduct = useCallback(async (id: string) => {
    const existing = state.products.find((product) => product.id === id);
    if (!existing) return true;
    const active = !existing.active;
    const concept = active ? false : existing.concept;
    setState((current) => ({ ...current, products: current.products.map((product) => product.id === id ? { ...product, active, concept } : product) }));
    return COMMUNITY_SUPPORT_HAS_SHARED_DATA ? persist(setProductVisibility(id, active, concept)) : true;
  }, [persist, state.products]);
  const toggleProductPublication = useCallback(async (id: string) => {
    const existing = state.products.find((product) => product.id === id);
    if (!existing) return true;
    const concept = !existing.concept;
    const active = !concept;
    setState((current) => ({ ...current, products: current.products.map((product) => product.id === id ? { ...product, active, concept } : product) }));
    return COMMUNITY_SUPPORT_HAS_SHARED_DATA ? persist(setProductVisibility(id, active, concept)) : true;
  }, [persist, state.products]);
  const removeProduct = useCallback(async (id: string) => {
    setState((current) => ({ ...current, products: current.products.filter((product) => product.id !== id) }));
    return COMMUNITY_SUPPORT_HAS_SHARED_DATA ? persist(deleteProduct(id)) : true;
  }, [persist]);
  const updateSettings = useCallback(async (settings: Partial<CommunitySupportSettings>) => {
    const current = state;
    const usdEurRate = settings.usdEurRate === undefined ? current.settings.usdEurRate : normalizeUsdEurRate(settings.usdEurRate);
    if (usdEurRate === null) return false;
    const paypalMeUrl = settings.paypalMeUrl === undefined ? current.settings.paypalMeUrl : (normalizePayPalMeUrl(settings.paypalMeUrl) ?? "");
    const paymentAdminDiscordId = settings.paymentAdminDiscordId === undefined ? current.settings.paymentAdminDiscordId : (normalizeDiscordUserId(settings.paymentAdminDiscordId) ?? "");
    const paypalSuggestedAmounts = settings.paypalSuggestedAmounts === undefined ? current.settings.paypalSuggestedAmounts : normalizePayPalAmounts(settings.paypalSuggestedAmounts);
    const paypalCheckoutEnabled = settings.paypalCheckoutEnabled === undefined ? current.settings.paypalCheckoutEnabled : Boolean(settings.paypalCheckoutEnabled);
    const requestedPaypalEnabled = settings.paypalEnabled === undefined ? current.settings.paypalEnabled : settings.paypalEnabled;
    const paypalEnabled = Boolean(requestedPaypalEnabled && !paypalCheckoutEnabled && paypalMeUrl && paymentAdminDiscordId && paypalSuggestedAmounts.length > 0);
    const iracingReferralUrl = settings.iracingReferralUrl === undefined ? current.settings.iracingReferralUrl : (normalizeIracingReferralUrl(settings.iracingReferralUrl) ?? "");
    const iracingReferralEnabled = settings.iracingReferralEnabled === undefined ? current.settings.iracingReferralEnabled : Boolean(settings.iracingReferralEnabled && iracingReferralUrl);
    const nextSettings = { ...current.settings, ...settings, paypalEnabled, paypalMeUrl, paymentAdminDiscordId, paypalSuggestedAmounts, iracingReferralEnabled, iracingReferralUrl, usdEurRate, reserve: settings.reserve === undefined ? current.settings.reserve : safeAmount(settings.reserve) };
    setState({ ...current, settings: nextSettings });
    return COMMUNITY_SUPPORT_HAS_SHARED_DATA ? persist(saveCommunitySupportSettings(nextSettings)) : true;
  }, [persist, state]);
  const addPaymentIntent = useCallback((draft: SupportPaymentIntentDraft) => {
    const intent = createPaymentIntent(draft, createLocalId());
    if (!intent) return null;
    setState((current) => ({ ...current, paymentIntents: [intent, ...current.paymentIntents] }));
    return intent;
  }, []);
  const resolvePayment = useCallback((id: string, action: "confirm" | "not_found", grossAmount?: number, feeAmount?: number, resolutionNote?: string) => {
    let resolved = false;
    setState((current) => {
      const existing = current.paymentIntents.find((intent) => intent.id === id);
      if (!existing) return current;
      const result = resolvePaymentIntent(existing, action, { grossAmount, feeAmount, resolutionNote });
      if (!result) return current;
      resolved = true;
      const existingLedgerIds = new Set(current.ledger.map((entry) => entry.id));
      return {
        ...current,
        paymentIntents: current.paymentIntents.map((intent) => intent.id === id ? result.intent : intent),
        ledger: [...result.ledgerEntries.filter((entry) => !existingLedgerIds.has(entry.id)), ...current.ledger],
      };
    });
    return resolved;
  }, []);
  const clearLocalData = useCallback(async () => {
    if (COMMUNITY_SUPPORT_HAS_SHARED_DATA) {
      setState(emptySharedSupportState());
      return persist(clearSharedCommunitySupportData());
    }
    if (storageKey) {
      try { window.sessionStorage.removeItem(storageKey); } catch { /* state is still cleared */ }
    }
    skipNextPersistRef.current = true;
    setState(INITIAL_STATE);
    return true;
  }, [persist, storageKey]);

  const value = useMemo<CommunitySupportStore>(() => ({
    state,
    loading,
    persistenceError,
    addLedgerEntry,
    removeLedgerEntry,
    addRecurringCost,
    toggleRecurringCost,
    removeRecurringCost,
    saveRaceCost,
    saveRaceCosts,
    initializeRaceCosts,
    removeRaceCost,
    addProduct,
    toggleProduct,
    toggleProductPublication,
    removeProduct,
    updateSettings,
    addPaymentIntent,
    resolvePayment,
    clearLocalData,
  }), [state, loading, persistenceError, addLedgerEntry, removeLedgerEntry, addRecurringCost, toggleRecurringCost, removeRecurringCost, saveRaceCost, saveRaceCosts, initializeRaceCosts, removeRaceCost, addProduct, toggleProduct, toggleProductPublication, removeProduct, updateSettings, addPaymentIntent, resolvePayment, clearLocalData]);
  return <CommunitySupportContext.Provider value={value}>{children}</CommunitySupportContext.Provider>;
};

export const useCommunitySupport = () => {
  const context = useContext(CommunitySupportContext);
  if (!context) throw new Error("useCommunitySupport must be used within CommunitySupportProvider");
  return context;
};
