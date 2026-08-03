import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_PAYPAL_AMOUNTS_EUR } from "./paymentFlow";
import { DEFAULT_USD_EUR_RATE } from "./raceHostingPricing";
import type {
  CommunitySupportSettings,
  CommunitySupportState,
  SupportLedgerEntry,
  SupportProduct,
  SupportRaceCost,
  SupportRecurringCost,
} from "./types";

// Narrow generated-schema supplement for the forward migration. Keeping this
// local lets old application builds keep working while the additive tables are
// deployed backend-first.
type RowTable<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};
type SettingsRow = {
  singleton: boolean; reserve_eur: number; reserve_start_year: number; race_pricing_initialized: boolean;
  usd_eur_rate: number; public_supporter_names_by_default: boolean; public_supporter_amounts_by_default: boolean;
  updated_at: string; updated_by: string | null;
};
type LedgerRow = {
  id: string; entry_date: string; direction: "income" | "expense"; category: SupportLedgerEntry["category"];
  description: string; amount_eur: number; is_public: boolean; supporter_name: string | null;
  show_supporter_name: boolean; show_amount: boolean; source_type: "manual" | "merch_order" | "merch_refund"; created_at: string; created_by: string | null;
};
type RecurringRow = {
  id: string; starts_on: string; category: SupportRecurringCost["category"]; description: string; amount_eur: number;
  frequency: SupportRecurringCost["frequency"]; is_public: boolean; active: boolean; created_at: string;
  created_by: string | null; updated_at: string; updated_by: string | null;
};
type RaceRow = {
  id: string; race_id: string; race_scope: SupportRaceCost["raceScope"]; league_id: string | null;
  league_name: string | null; season: string | null; race_name: string; track: string; race_date: string;
  race_format: string | null; hosted_hours: number; discount_applied: boolean; source_amount_usd: number;
  exchange_rate_usd_eur: number; amount_eur: number; is_public: boolean; note: string | null;
  deleted_at: string | null; created_at: string; created_by: string | null; updated_at: string; updated_by: string | null;
};
type ProductRow = {
  id: string; name: string; description: string; price_eur: number; purchase_price_eur: number;
  shipping_cost_eur: number; fulfillment_mode: "physical" | "digital"; stock: number; active: boolean; concept: boolean; image_urls: string[];
  created_at: string; created_by: string | null; updated_at: string; updated_by: string | null;
};
type SupportDatabase = {
  public: {
    Tables: {
      community_support_settings: RowTable<SettingsRow>;
      community_support_ledger_entries: RowTable<LedgerRow>;
      community_support_recurring_costs: RowTable<RecurringRow>;
      community_support_race_costs: RowTable<RaceRow>;
      community_support_products: RowTable<ProductRow>;
    };
    Views: Record<string, never>;
    Functions: {
      get_public_community_support_data: { Args: Record<PropertyKey, never>; Returns: unknown };
      admin_clear_community_support_data: { Args: Record<PropertyKey, never>; Returns: undefined };
      admin_upsert_community_support_race_costs: { Args: { p_items: unknown; p_initialize_only: boolean }; Returns: number };
      admin_delete_community_support_item: { Args: { p_entity: string; p_id: string }; Returns: boolean };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
const db = supabase as unknown as SupabaseClient<SupportDatabase>;

const defaultSettings = (): CommunitySupportSettings => ({
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
});
export const emptySharedSupportState = (): CommunitySupportState => ({
  ledger: [], recurringCosts: [], raceCosts: [], products: [], paymentIntents: [], settings: defaultSettings(),
});

const ledgerFromRow = (row: LedgerRow): SupportLedgerEntry => ({
  id: row.id, date: row.entry_date, direction: row.direction, category: row.category,
  description: row.description, amount: Number(row.amount_eur), isPublic: row.is_public,
  ...(row.supporter_name ? { supporterName: row.supporter_name } : {}),
  showSupporterName: row.show_supporter_name, showAmount: row.show_amount,
  automatic: Boolean(row.source_type && row.source_type !== "manual"),
});
const recurringFromRow = (row: RecurringRow): SupportRecurringCost => ({
  id: row.id, startsOn: row.starts_on, category: row.category, description: row.description,
  amount: Number(row.amount_eur), frequency: row.frequency, isPublic: row.is_public, active: row.active,
});
const raceFromRow = (row: RaceRow): SupportRaceCost => ({
  id: row.id, raceId: row.race_id, raceScope: row.race_scope,
  ...(row.league_id ? { leagueId: row.league_id } : {}), ...(row.league_name ? { leagueName: row.league_name } : {}),
  ...(row.season ? { season: row.season } : {}), raceName: row.race_name, track: row.track, date: row.race_date,
  ...(row.race_format ? { raceFormat: row.race_format } : {}), hostedHours: row.hosted_hours,
  discountApplied: row.discount_applied, sourceAmountUsd: Number(row.source_amount_usd),
  exchangeRateUsdEur: Number(row.exchange_rate_usd_eur), amount: Number(row.amount_eur), isPublic: row.is_public,
  ...(row.note ? { note: row.note } : {}),
});
const productFromRow = (row: ProductRow): SupportProduct => ({
  id: row.id, name: row.name, description: row.description, price: Number(row.price_eur),
  purchasePrice: Number(row.purchase_price_eur), shippingCost: Number(row.shipping_cost_eur), fulfillmentMode: row.fulfillment_mode ?? "physical",
  stock: row.stock, active: row.active, concept: row.concept, imageUrls: row.image_urls,
});
const settingsFromRow = (row: SettingsRow): CommunitySupportSettings => ({
  ...defaultSettings(), reserve: Number(row.reserve_eur), reserveStartYear: String(row.reserve_start_year),
  racePricingInitialized: row.race_pricing_initialized, usdEurRate: Number(row.usd_eur_rate),
  publicSupporterNamesByDefault: row.public_supporter_names_by_default,
  publicSupporterAmountsByDefault: row.public_supporter_amounts_by_default,
});

const requireData = <T>(data: T | null, error: { message: string } | null): T => {
  if (error) throw new Error(error.message);
  if (data === null) throw new Error("Community Support backend returned no data.");
  return data;
};

export const fetchAdminCommunitySupportState = async (): Promise<CommunitySupportState> => {
  const [settings, ledger, recurring, races, products] = await Promise.all([
    db.from("community_support_settings").select("*").eq("singleton", true).single(),
    db.from("community_support_ledger_entries").select("*").order("entry_date", { ascending: false }),
    db.from("community_support_recurring_costs").select("*").order("starts_on", { ascending: false }),
    db.from("community_support_race_costs").select("*").is("deleted_at", null).order("race_date", { ascending: false }),
    db.from("community_support_products").select("*").order("created_at", { ascending: false }),
  ]);
  return {
    settings: settingsFromRow(requireData(settings.data, settings.error)),
    ledger: requireData(ledger.data, ledger.error).map(ledgerFromRow),
    recurringCosts: requireData(recurring.data, recurring.error).map(recurringFromRow),
    raceCosts: requireData(races.data, races.error).map(raceFromRow),
    products: requireData(products.data, products.error).map(productFromRow),
    paymentIntents: [],
  };
};

type PublicPayload = {
  settings?: Partial<CommunitySupportSettings>;
  ledger?: Array<Partial<SupportLedgerEntry> & { amount: number | null }>;
  ledgerTotals?: Array<{ month: string; direction: "income" | "expense"; category: SupportLedgerEntry["category"]; amount: number }>;
  costTotals?: Array<{ month: string; category: SupportLedgerEntry["category"]; amount: number }>;
  recurringCosts?: SupportRecurringCost[];
  raceCosts?: SupportRaceCost[];
  products?: SupportProduct[];
};
export type PublicCommunitySupportData = { displayState: CommunitySupportState; metricLedger: SupportLedgerEntry[] };
export const fetchPublicCommunitySupportData = async (): Promise<PublicCommunitySupportData> => {
  const result = await db.rpc("get_public_community_support_data");
  const payload = requireData(result.data, result.error) as PublicPayload;
  const displayState = emptySharedSupportState();
  displayState.settings = { ...displayState.settings, ...(payload.settings ?? {}) };
  displayState.ledger = (payload.ledger ?? []).map((entry) => ({
    id: String(entry.id), date: String(entry.date), direction: entry.direction === "expense" ? "expense" : "income",
    category: entry.category as SupportLedgerEntry["category"], description: String(entry.description ?? ""),
    amount: entry.amount === null ? (null as unknown as number) : Number(entry.amount), isPublic: true,
    ...(entry.supporterName ? { supporterName: String(entry.supporterName) } : {}),
    showSupporterName: entry.showSupporterName === true, showAmount: entry.showAmount === true,
  }));
  displayState.recurringCosts = payload.recurringCosts ?? [];
  displayState.raceCosts = payload.raceCosts ?? [];
  displayState.products = (payload.products ?? []).map((product) => ({ ...product, purchasePrice: 0, shippingCost: 0, fulfillmentMode: product.fulfillmentMode ?? "physical" }));
  const metricLedger = (payload.ledgerTotals ?? []).map((entry) => ({
    id: `manual-total:${entry.month}:${entry.direction}:${entry.category}`,
    date: `${entry.month}-01`, direction: entry.direction, category: entry.category,
    description: "Community Support totaal", amount: Number(entry.amount), isPublic: false,
  })).concat((payload.costTotals ?? []).map((entry) => ({
    id: `cost-total:${entry.month}:${entry.category}`,
    date: `${entry.month}-01`, direction: "expense" as const, category: entry.category,
    description: "Community Support kostentotaal", amount: Number(entry.amount), isPublic: false,
  })));
  return { displayState, metricLedger };
};

export const insertLedgerEntry = async (entry: SupportLedgerEntry) => {
  const { error } = await db.from("community_support_ledger_entries").insert({
    id: entry.id, entry_date: entry.date, direction: entry.direction, category: entry.category, description: entry.description,
    amount_eur: entry.amount, is_public: entry.isPublic, supporter_name: entry.supporterName ?? null,
    show_supporter_name: entry.showSupporterName === true, show_amount: entry.showAmount === true,
  });
  if (error) throw new Error(error.message);
};
const deleteSharedItem = async (entity: "ledger" | "recurring_cost" | "race_cost" | "product", id: string) => {
  const { data, error } = await db.rpc("admin_delete_community_support_item", { p_entity: entity, p_id: id });
  if (error) throw new Error(error.message);
  if (data !== true) throw new Error("Community Support-record bestaat niet meer.");
};
export const deleteLedgerEntry = async (id: string) => deleteSharedItem("ledger", id);
export const insertRecurringCost = async (cost: SupportRecurringCost) => {
  const { error } = await db.from("community_support_recurring_costs").insert({ id: cost.id, starts_on: cost.startsOn, category: cost.category, description: cost.description, amount_eur: cost.amount, frequency: cost.frequency, is_public: cost.isPublic, active: cost.active });
  if (error) throw new Error(error.message);
};
export const setRecurringCostActive = async (id: string, active: boolean) => { const { error } = await db.from("community_support_recurring_costs").update({ active }).eq("id", id); if (error) throw new Error(error.message); };
export const deleteRecurringCost = async (id: string) => deleteSharedItem("recurring_cost", id);
export const upsertRaceCosts = async (costs: SupportRaceCost[], ignoreDuplicates = false) => {
  if (!costs.length) return;
  const { error } = await db.rpc("admin_upsert_community_support_race_costs", {
    p_items: costs.map((cost) => ({
      raceId: cost.raceId,
      hostedHours: cost.hostedHours,
      discountApplied: cost.discountApplied,
      isPublic: cost.isPublic,
      ...(cost.note ? { note: cost.note } : {}),
    })),
    p_initialize_only: ignoreDuplicates,
  });
  if (error) throw new Error(error.message);
};
export const deleteRaceCost = async (id: string) => deleteSharedItem("race_cost", id);
export const insertProduct = async (product: SupportProduct) => {
  const { error } = await db.from("community_support_products").insert({ id: product.id, name: product.name, description: product.description, price_eur: product.price, purchase_price_eur: product.purchasePrice, shipping_cost_eur: product.fulfillmentMode === "physical" ? product.shippingCost : 0, fulfillment_mode: product.fulfillmentMode, stock: product.stock, active: product.active, concept: product.concept, image_urls: product.imageUrls });
  if (error) throw new Error(error.message);
};
export const setProductVisibility = async (id: string, active: boolean, concept: boolean) => {
  const { error } = await db.from("community_support_products").update({ active, concept }).eq("id", id);
  if (error) throw new Error(error.message);
};
export const deleteProduct = async (id: string) => deleteSharedItem("product", id);
export const saveCommunitySupportSettings = async (settings: CommunitySupportSettings) => {
  const { error } = await db.from("community_support_settings").update({ reserve_eur: settings.reserve, reserve_start_year: Number(settings.reserveStartYear), race_pricing_initialized: settings.racePricingInitialized, usd_eur_rate: settings.usdEurRate, public_supporter_names_by_default: settings.publicSupporterNamesByDefault, public_supporter_amounts_by_default: settings.publicSupporterAmountsByDefault }).eq("singleton", true);
  if (error) throw new Error(error.message);
};
export const clearSharedCommunitySupportData = async () => {
  const { error } = await db.rpc("admin_clear_community_support_data");
  if (error) throw new Error(error.message);
};
