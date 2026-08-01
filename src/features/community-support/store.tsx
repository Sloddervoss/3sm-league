import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { z } from "zod";
import { useAuth } from "@/contexts/AuthContext";
import type {
  CommunitySupportSettings,
  CommunitySupportState,
  SupportLedgerEntry,
  SupportProduct,
  SupportRaceCost,
  SupportRecurringCost,
} from "./types";
import { isSupportedCommunitySupportRace } from "./raceEligibility";
import { calculateRaceHostingAmount, normalizeHostedHours } from "./raceHostingPricing";

const STORAGE_PREFIX = "3sm-community-support-session-v2";
const INCOME_CATEGORIES = new Set(["contribution", "merchandise_income", "referral_income", "other"]);
const EXPENSE_CATEGORIES = new Set(["hosting", "server", "domain", "software", "development", "event", "payment_fee", "merchandise_purchase", "shipping", "other"]);

const INITIAL_STATE: CommunitySupportState = {
  ledger: [],
  recurringCosts: [],
  raceCosts: [],
  products: [],
  settings: {
    reserve: 0,
    reserveStartYear: String(new Date().getFullYear()),
    racePricingInitialized: false,
    publicSupporterNamesByDefault: true,
    publicSupporterAmountsByDefault: false,
    paypalEnabled: false,
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
  description: z.string().min(1).max(160), amount: moneySchema, isPublic: z.boolean(), active: z.boolean(),
});
const raceCostSchema = z.object({
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
  amount: positiveMoneySchema,
  isPublic: z.boolean(),
  note: z.string().max(240).optional(),
}).superRefine((cost, context) => {
  if (cost.raceScope === "season" && !cost.leagueId) context.addIssue({ code: z.ZodIssueCode.custom, message: "season race requires leagueId", path: ["leagueId"] });
  if (cost.raceScope === "standalone" && cost.leagueId) context.addIssue({ code: z.ZodIssueCode.custom, message: "standalone race cannot have leagueId", path: ["leagueId"] });
  if (!isSupportedCommunitySupportRace(cost)) context.addIssue({ code: z.ZodIssueCode.custom, message: "race format is outside this prototype", path: ["raceFormat"] });
});
const productSchema = z.object({
  id: z.string().min(1).max(100), name: z.string().min(1).max(100), description: z.string().min(1).max(500),
  price: moneySchema, purchasePrice: moneySchema, shippingCost: moneySchema,
  stock: z.number().int().min(0).max(1_000_000), active: z.boolean(), concept: z.boolean(),
  imageUrl: z.string().url().max(500).optional(),
});
const stateSchema = z.object({
  ledger: z.array(ledgerSchema).max(5_000),
  recurringCosts: z.array(recurringSchema).max(500),
  raceCosts: z.array(raceCostSchema).max(1_000).default([]),
  products: z.array(productSchema).max(500),
  settings: z.object({
    reserve: moneySchema,
    reserveStartYear: z.string().regex(/^\d{4}$/).optional(),
    racePricingInitialized: z.boolean().default(false),
    publicSupporterNamesByDefault: z.boolean(),
    publicSupporterAmountsByDefault: z.boolean(),
    paypalEnabled: z.boolean(),
  }),
}).superRefine((state, context) => {
  const seenRaceIds = new Set<string>();
  state.raceCosts.forEach((cost, index) => {
    if (seenRaceIds.has(cost.raceId)) context.addIssue({ code: z.ZodIssueCode.custom, message: "race cost must be unique per race", path: ["raceCosts", index, "raceId"] });
    seenRaceIds.add(cost.raceId);
  });
});

const safeAmount = (value: number) => Number.isFinite(value) ? Math.max(0, Math.round(value * 100) / 100) : 0;
const withId = <T extends object>(value: T): T & { id: string } => ({ ...value, id: crypto.randomUUID() });
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
    return {
      ...result.data,
      raceCosts: result.data.raceCosts.map((cost) => ({
        ...cost,
        amount: calculateRaceHostingAmount(cost.hostedHours, cost.discountApplied),
      })),
    } as CommunitySupportState;
  } catch {
    return INITIAL_STATE;
  }
};

export type SupportLedgerDraft = Omit<SupportLedgerEntry, "id">;
export type SupportRecurringCostDraft = Omit<SupportRecurringCost, "id">;
export type SupportRaceCostDraft = Omit<SupportRaceCost, "id" | "amount"> & { amount?: number };
export type SupportProductDraft = Omit<SupportProduct, "id">;

const normalizeRaceCostDraft = (draft: SupportRaceCostDraft): Omit<SupportRaceCost, "id"> | null => {
  if (!isSupportedCommunitySupportRace(draft)) return null;
  if ((draft.raceScope === "season") !== Boolean(draft.leagueId)) return null;
  const hostedHours = normalizeHostedHours(draft.hostedHours);
  if (hostedHours === null) return null;
  return {
    ...draft,
    hostedHours,
    discountApplied: Boolean(draft.discountApplied),
    date: draft.date.slice(0, 10),
    amount: calculateRaceHostingAmount(hostedHours, draft.discountApplied),
    note: draft.note?.trim() || undefined,
  };
};

const saveRaceCostDrafts = (current: CommunitySupportState, drafts: SupportRaceCostDraft[]): CommunitySupportState => {
  const raceCosts = [...current.raceCosts];
  drafts.forEach((draft) => {
    const normalized = normalizeRaceCostDraft(draft);
    if (!normalized) return;
    const existingIndex = raceCosts.findIndex((cost) => cost.raceId === normalized.raceId);
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
    if (current.settings.racePricingInitialized) return current;
    const existingByRaceId = new Map(current.raceCosts.map((cost) => [cost.raceId, cost]));
    const initialized = saveRaceCostDrafts(current, drafts.map((draft) => {
      const existing = existingByRaceId.get(draft.raceId);
      return existing ? { ...draft, isPublic: existing.isPublic, note: existing.note } : draft;
    }));
    return { ...initialized, settings: { ...initialized.settings, racePricingInitialized: true } };
  }), []);
  const removeRaceCost = useCallback((id: string) => setState((current) => ({ ...current, raceCosts: current.raceCosts.filter((cost) => cost.id !== id) })), []);
  const addProduct = useCallback((draft: SupportProductDraft) => setState((current) => ({ ...current, products: [{ ...withId(draft), price: safeAmount(draft.price), purchasePrice: safeAmount(draft.purchasePrice), shippingCost: safeAmount(draft.shippingCost), stock: Math.max(0, Math.floor(draft.stock)) }, ...current.products] })), []);
  const toggleProduct = useCallback((id: string) => setState((current) => ({ ...current, products: current.products.map((product) => product.id === id ? { ...product, active: !product.active } : product) })), []);
  const removeProduct = useCallback((id: string) => setState((current) => ({ ...current, products: current.products.filter((product) => product.id !== id) })), []);
  const updateSettings = useCallback((settings: Partial<CommunitySupportSettings>) => setState((current) => ({ ...current, settings: { ...current.settings, ...settings, reserve: settings.reserve === undefined ? current.settings.reserve : safeAmount(settings.reserve) } })), []);
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
    clearLocalData,
  }), [state, addLedgerEntry, removeLedgerEntry, addRecurringCost, toggleRecurringCost, removeRecurringCost, saveRaceCost, saveRaceCosts, initializeRaceCosts, removeRaceCost, addProduct, toggleProduct, removeProduct, updateSettings, clearLocalData]);
  return <CommunitySupportContext.Provider value={value}>{children}</CommunitySupportContext.Provider>;
};

export const useCommunitySupport = () => {
  const context = useContext(CommunitySupportContext);
  if (!context) throw new Error("useCommunitySupport must be used within CommunitySupportProvider");
  return context;
};
