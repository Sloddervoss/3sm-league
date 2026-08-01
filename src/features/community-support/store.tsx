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
import { calculateRaceHostingAmountUsd, convertUsdToEur, DEFAULT_USD_EUR_RATE, normalizeHostedHours, normalizeUsdEurRate } from "./raceHostingPricing";
import { createPaymentIntent, DEFAULT_PAYPAL_AMOUNTS_EUR, normalizeDiscordUserId, normalizePayPalAmounts, normalizePayPalMeUrl, resolvePaymentIntent } from "./paymentFlow";

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
    paypalMeUrl: "",
    paypalSuggestedAmounts: [...DEFAULT_PAYPAL_AMOUNTS_EUR],
    paymentAdminDiscordId: "",
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
  const amount = record.sourceAmountUsd !== undefined && typeof record.amount === "number"
    ? record.amount
    : convertUsdToEur(sourceAmountUsd, exchangeRateUsdEur);
  const migrated = { ...record };
  delete migrated.creditCostUsd;
  delete migrated.pricingSource;
  delete migrated.amountEur;
  return { ...migrated, sourceAmountUsd, exchangeRateUsdEur, amount };
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
  stock: z.number().int().min(0).max(1_000_000), active: z.boolean(), concept: z.boolean(),
  imageUrls: z.array(productImageSchema).max(4).default([]),
}));
const paymentIntentSchema = z.object({
  id: z.string().min(1).max(100),
  requestedAmount: positiveMoneySchema,
  payerName: z.string().min(1).max(100),
  showSupporterName: z.boolean(),
  showAmount: z.boolean(),
  status: z.enum(["pending", "confirmed", "not_found"]),
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
    paypalMeUrl: z.string().max(200).default(""),
    paypalSuggestedAmounts: z.array(positiveMoneySchema).max(6).default([...DEFAULT_PAYPAL_AMOUNTS_EUR]),
    paymentAdminDiscordId: z.string().max(20).default(""),
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
export type SupportRaceCostDraft = Omit<SupportRaceCost, "id" | "amount" | "sourceAmountUsd" | "exchangeRateUsdEur"> & { amount?: number; sourceAmountUsd?: number; exchangeRateUsdEur?: number };
export type SupportProductDraft = Omit<SupportProduct, "id">;

const normalizeRaceCostDraft = (draft: SupportRaceCostDraft, defaultUsdEurRate: number): Omit<SupportRaceCost, "id"> | null => {
  if (!isSupportedCommunitySupportRace(draft)) return null;
  if ((draft.raceScope === "season") !== Boolean(draft.leagueId)) return null;
  const hostedHours = normalizeHostedHours(draft.hostedHours);
  if (hostedHours === null) return null;
  const exchangeRateUsdEur = normalizeUsdEurRate(draft.exchangeRateUsdEur ?? defaultUsdEurRate);
  if (exchangeRateUsdEur === null) return null;
  const sourceAmountUsd = calculateRaceHostingAmountUsd(hostedHours, draft.discountApplied);
  return {
    ...draft,
    hostedHours,
    discountApplied: Boolean(draft.discountApplied),
    date: draft.date.slice(0, 10),
    sourceAmountUsd,
    exchangeRateUsdEur,
    amount: convertUsdToEur(sourceAmountUsd, exchangeRateUsdEur),
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
  addLedgerEntry: (draft: SupportLedgerDraft) => void;
  removeLedgerEntry: (id: string) => void;
  addRecurringCost: (draft: SupportRecurringCostDraft) => void;
  toggleRecurringCost: (id: string) => void;
  removeRecurringCost: (id: string) => void;
  saveRaceCost: (draft: SupportRaceCostDraft) => void;
  saveRaceCosts: (drafts: SupportRaceCostDraft[]) => void;
  initializeRaceCosts: (drafts: SupportRaceCostDraft[]) => void;
  removeRaceCost: (id: string) => void;
  addProduct: (draft: SupportProductDraft) => void;
  toggleProduct: (id: string) => void;
  removeProduct: (id: string) => void;
  updateSettings: (settings: Partial<CommunitySupportSettings>) => void;
  addPaymentIntent: (draft: SupportPaymentIntentDraft) => SupportPaymentIntent | null;
  resolvePayment: (id: string, action: "confirm" | "not_found", grossAmount?: number, feeAmount?: number, resolutionNote?: string) => boolean;
  clearLocalData: () => void;
};

const CommunitySupportContext = createContext<CommunitySupportStore | null>(null);

export const CommunitySupportProvider = ({ children }: { children: ReactNode }) => {
  const { user, isSuperAdmin } = useAuth();
  const storageKey = user && isSuperAdmin ? storageKeyFor(user.id) : null;
  const [state, setState] = useState<CommunitySupportState>(INITIAL_STATE);
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);
  const activeKeyRef = useRef<string | null>(null);
  const skipNextPersistRef = useRef(false);

  useEffect(() => {
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

  const addLedgerEntry = useCallback((draft: SupportLedgerDraft) => setState((current) => {
    if (draft.category === "race_hosting") return current;
    return { ...current, ledger: [{ ...withId(draft), amount: safeAmount(draft.amount) }, ...current.ledger] };
  }), []);
  const removeLedgerEntry = useCallback((id: string) => setState((current) => ({ ...current, ledger: current.ledger.filter((entry) => entry.id !== id) })), []);
  const addRecurringCost = useCallback((draft: SupportRecurringCostDraft) => setState((current) => ({ ...current, recurringCosts: [{ ...withId(draft), amount: safeAmount(draft.amount) }, ...current.recurringCosts] })), []);
  const toggleRecurringCost = useCallback((id: string) => setState((current) => ({ ...current, recurringCosts: current.recurringCosts.map((cost) => cost.id === id ? { ...cost, active: !cost.active } : cost) })), []);
  const removeRecurringCost = useCallback((id: string) => setState((current) => ({ ...current, recurringCosts: current.recurringCosts.filter((cost) => cost.id !== id) })), []);
  const saveRaceCost = useCallback((draft: SupportRaceCostDraft) => setState((current) => saveRaceCostDrafts(current, [draft])), []);
  const saveRaceCosts = useCallback((drafts: SupportRaceCostDraft[]) => setState((current) => saveRaceCostDrafts(current, drafts)), []);
  const initializeRaceCosts = useCallback((drafts: SupportRaceCostDraft[]) => setState((current) => {
    const existingRaceIds = new Set(current.raceCosts.map((cost) => cost.raceId));
    const missingDrafts = drafts.filter((draft) => !existingRaceIds.has(draft.raceId));
    if (missingDrafts.length === 0) {
      if (current.settings.racePricingInitialized) return current;
      return { ...current, settings: { ...current.settings, racePricingInitialized: true } };
    }
    const initialized = saveRaceCostDrafts(current, missingDrafts);
    return { ...initialized, settings: { ...initialized.settings, racePricingInitialized: true } };
  }), []);
  const removeRaceCost = useCallback((id: string) => setState((current) => ({ ...current, raceCosts: current.raceCosts.filter((cost) => cost.id !== id) })), []);
  const addProduct = useCallback((draft: SupportProductDraft) => setState((current) => ({ ...current, products: [{ ...withId(draft), price: safeAmount(draft.price), purchasePrice: safeAmount(draft.purchasePrice), shippingCost: safeAmount(draft.shippingCost), stock: Math.max(0, Math.floor(draft.stock)) }, ...current.products] })), []);
  const toggleProduct = useCallback((id: string) => setState((current) => ({ ...current, products: current.products.map((product) => product.id === id ? { ...product, active: !product.active } : product) })), []);
  const removeProduct = useCallback((id: string) => setState((current) => ({ ...current, products: current.products.filter((product) => product.id !== id) })), []);
  const updateSettings = useCallback((settings: Partial<CommunitySupportSettings>) => setState((current) => {
    const usdEurRate = settings.usdEurRate === undefined ? current.settings.usdEurRate : normalizeUsdEurRate(settings.usdEurRate);
    if (usdEurRate === null) return current;
    const paypalMeUrl = settings.paypalMeUrl === undefined ? current.settings.paypalMeUrl : (normalizePayPalMeUrl(settings.paypalMeUrl) ?? "");
    const paymentAdminDiscordId = settings.paymentAdminDiscordId === undefined ? current.settings.paymentAdminDiscordId : (normalizeDiscordUserId(settings.paymentAdminDiscordId) ?? "");
    const paypalSuggestedAmounts = settings.paypalSuggestedAmounts === undefined ? current.settings.paypalSuggestedAmounts : normalizePayPalAmounts(settings.paypalSuggestedAmounts);
    const paypalEnabled = settings.paypalEnabled === undefined ? current.settings.paypalEnabled : Boolean(settings.paypalEnabled && paypalMeUrl && paymentAdminDiscordId && paypalSuggestedAmounts.length > 0);
    return { ...current, settings: { ...current.settings, ...settings, paypalEnabled, paypalMeUrl, paymentAdminDiscordId, paypalSuggestedAmounts, usdEurRate, reserve: settings.reserve === undefined ? current.settings.reserve : safeAmount(settings.reserve) } };
  }), []);
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
  const clearLocalData = useCallback(() => {
    if (storageKey) {
      try { window.sessionStorage.removeItem(storageKey); } catch { /* state is still cleared */ }
    }
    skipNextPersistRef.current = true;
    setState(INITIAL_STATE);
  }, [storageKey]);

  const value = useMemo<CommunitySupportStore>(() => ({
    state,
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
    removeProduct,
    updateSettings,
    addPaymentIntent,
    resolvePayment,
    clearLocalData,
  }), [state, addLedgerEntry, removeLedgerEntry, addRecurringCost, toggleRecurringCost, removeRecurringCost, saveRaceCost, saveRaceCosts, initializeRaceCosts, removeRaceCost, addProduct, toggleProduct, removeProduct, updateSettings, addPaymentIntent, resolvePayment, clearLocalData]);
  return <CommunitySupportContext.Provider value={value}>{children}</CommunitySupportContext.Provider>;
};

export const useCommunitySupport = () => {
  const context = useContext(CommunitySupportContext);
  if (!context) throw new Error("useCommunitySupport must be used within CommunitySupportProvider");
  return context;
};
