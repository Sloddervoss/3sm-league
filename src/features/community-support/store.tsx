import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  CommunitySupportSettings,
  CommunitySupportState,
  SupportLedgerEntry,
  SupportProduct,
  SupportRecurringCost,
} from "./types";

const STORAGE_KEY = "3sm-community-support-v1";

const INITIAL_STATE: CommunitySupportState = {
  ledger: [],
  recurringCosts: [],
  products: [],
  settings: {
    reserve: 0,
    publicSupporterNamesByDefault: true,
    publicSupporterAmountsByDefault: false,
    paypalEnabled: false,
  },
};

const safeAmount = (value: number) => Number.isFinite(value) ? Math.max(0, Math.round(value * 100) / 100) : 0;
const withId = <T extends object>(value: T): T & { id: string } => ({ ...value, id: crypto.randomUUID() });

const loadState = (): CommunitySupportState => {
  if (typeof window === "undefined") return INITIAL_STATE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return INITIAL_STATE;
    const parsed = JSON.parse(raw) as Partial<CommunitySupportState>;
    return {
      ledger: Array.isArray(parsed.ledger) ? parsed.ledger : [],
      recurringCosts: Array.isArray(parsed.recurringCosts) ? parsed.recurringCosts : [],
      products: Array.isArray(parsed.products) ? parsed.products : [],
      settings: { ...INITIAL_STATE.settings, ...(parsed.settings || {}) },
    };
  } catch {
    return INITIAL_STATE;
  }
};

export type SupportLedgerDraft = Omit<SupportLedgerEntry, "id">;
export type SupportRecurringCostDraft = Omit<SupportRecurringCost, "id">;
export type SupportProductDraft = Omit<SupportProduct, "id">;

type CommunitySupportStore = {
  state: CommunitySupportState;
  addLedgerEntry: (draft: SupportLedgerDraft) => void;
  removeLedgerEntry: (id: string) => void;
  addRecurringCost: (draft: SupportRecurringCostDraft) => void;
  toggleRecurringCost: (id: string) => void;
  removeRecurringCost: (id: string) => void;
  addProduct: (draft: SupportProductDraft) => void;
  toggleProduct: (id: string) => void;
  removeProduct: (id: string) => void;
  updateSettings: (settings: Partial<CommunitySupportSettings>) => void;
  clearLocalData: () => void;
};

const CommunitySupportContext = createContext<CommunitySupportStore | null>(null);

export const CommunitySupportProvider = ({ children }: { children: ReactNode }) => {
  const [state, setState] = useState<CommunitySupportState>(loadState);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const addLedgerEntry = useCallback((draft: SupportLedgerDraft) => {
    setState((current) => ({
      ...current,
      ledger: [{ ...withId(draft), amount: safeAmount(draft.amount) }, ...current.ledger],
    }));
  }, []);
  const removeLedgerEntry = useCallback((id: string) => setState((current) => ({ ...current, ledger: current.ledger.filter((entry) => entry.id !== id) })), []);
  const addRecurringCost = useCallback((draft: SupportRecurringCostDraft) => {
    setState((current) => ({ ...current, recurringCosts: [{ ...withId(draft), amount: safeAmount(draft.amount) }, ...current.recurringCosts] }));
  }, []);
  const toggleRecurringCost = useCallback((id: string) => setState((current) => ({ ...current, recurringCosts: current.recurringCosts.map((cost) => cost.id === id ? { ...cost, active: !cost.active } : cost) })), []);
  const removeRecurringCost = useCallback((id: string) => setState((current) => ({ ...current, recurringCosts: current.recurringCosts.filter((cost) => cost.id !== id) })), []);
  const addProduct = useCallback((draft: SupportProductDraft) => {
    setState((current) => ({ ...current, products: [{ ...withId(draft), price: safeAmount(draft.price), purchasePrice: safeAmount(draft.purchasePrice), shippingCost: safeAmount(draft.shippingCost), stock: Math.max(0, Math.floor(draft.stock)) }, ...current.products] }));
  }, []);
  const toggleProduct = useCallback((id: string) => setState((current) => ({ ...current, products: current.products.map((product) => product.id === id ? { ...product, active: !product.active } : product) })), []);
  const removeProduct = useCallback((id: string) => setState((current) => ({ ...current, products: current.products.filter((product) => product.id !== id) })), []);
  const updateSettings = useCallback((settings: Partial<CommunitySupportSettings>) => setState((current) => ({ ...current, settings: { ...current.settings, ...settings, reserve: settings.reserve === undefined ? current.settings.reserve : safeAmount(settings.reserve) } })), []);
  const clearLocalData = useCallback(() => setState(INITIAL_STATE), []);

  const value = useMemo<CommunitySupportStore>(() => ({
    state,
    addLedgerEntry,
    removeLedgerEntry,
    addRecurringCost,
    toggleRecurringCost,
    removeRecurringCost,
    addProduct,
    toggleProduct,
    removeProduct,
    updateSettings,
    clearLocalData,
  }), [state, addLedgerEntry, removeLedgerEntry, addRecurringCost, toggleRecurringCost, removeRecurringCost, addProduct, toggleProduct, removeProduct, updateSettings, clearLocalData]);

  return <CommunitySupportContext.Provider value={value}>{children}</CommunitySupportContext.Provider>;
};

export const useCommunitySupport = () => {
  const context = useContext(CommunitySupportContext);
  if (!context) throw new Error("useCommunitySupport must be used within CommunitySupportProvider");
  return context;
};
