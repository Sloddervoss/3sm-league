import { supabase } from "@/integrations/supabase/client";
import type { CommunitySupportSettings, PublicSupportLedgerEntry, SupportLedgerEntry, SupportPaymentIntentDraft } from "./types";

export type PublicPaymentConfig = Pick<CommunitySupportSettings, "paypalEnabled" | "paypalCheckoutEnabled" | "paypalMeUrl" | "paypalSuggestedAmounts" | "iracingReferralEnabled" | "iracingReferralUrl">;
export type AdminPaymentConfig = PublicPaymentConfig & Pick<CommunitySupportSettings, "paymentAdminDiscordId" | "paypalCheckoutEnvironment">;
export type SharedPaymentLedger = {
  entries: PublicSupportLedgerEntry[];
  metricEntries: SupportLedgerEntry[];
};
export type PayPalCheckoutConfig = { clientId: string; environment: "sandbox" | "live"; currency: "EUR" };
export type PayPalCaptureResult = { result: "confirmed" | "already_confirmed"; captureId: string; grossAmount: number; feeAmount: number; netAmount: number };
type PublicPaymentTotalRow = { month: string; contribution_total_eur: number; fee_total_eur: number };

export const mapPaymentTotalsToMetricEntries = (rows: PublicPaymentTotalRow[]): SupportLedgerEntry[] => rows.flatMap((row) => {
  const result: SupportLedgerEntry[] = [];
  const contribution = Number(row.contribution_total_eur);
  const fee = Number(row.fee_total_eur);
  if (contribution > 0) result.push({
    id: `paypal-total-contribution-${row.month}`,
    date: `${row.month}-01`,
    direction: "income",
    category: "contribution",
    description: "Geaggregeerde bevestigde PayPal-bijdragen",
    amount: contribution,
    isPublic: false,
  });
  if (contribution < 0) result.push({
    id: `paypal-total-refund-${row.month}`,
    date: `${row.month}-01`,
    direction: "expense",
    category: "payment_refund",
    description: "Geaggregeerde PayPal-terugbetalingen en terugboekingen",
    amount: Math.abs(contribution),
    isPublic: false,
  });
  if (fee > 0) result.push({
    id: `paypal-total-fee-${row.month}`,
    date: `${row.month}-01`,
    direction: "expense",
    category: "payment_fee",
    description: "Geaggregeerde PayPal-kosten",
    amount: fee,
    isPublic: false,
  });
  return result;
});

const invokePayPalCheckout = async <T>(body: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.functions.invoke("paypal-checkout", { body });
  if (error) throw error;
  if (!data || typeof data !== "object") throw new Error("Invalid PayPal Checkout response.");
  if ("error" in data && data.error) throw new Error(String(data.error));
  return data as T;
};

const firstRow = <T>(data: T[] | null): T | null => data?.[0] ?? null;

export const fetchPublicPaymentConfig = async (): Promise<PublicPaymentConfig> => {
  const { data, error } = await supabase.rpc("get_community_support_payment_config");
  if (error) throw error;
  const row = firstRow(data);
  if (!row) return { paypalEnabled: false, paypalCheckoutEnabled: false, paypalMeUrl: "", paypalSuggestedAmounts: [], iracingReferralEnabled: false, iracingReferralUrl: "" };
  return {
    paypalEnabled: row.paypal_enabled,
    paypalCheckoutEnabled: row.paypal_checkout_enabled,
    paypalMeUrl: row.paypal_me_url,
    paypalSuggestedAmounts: row.suggested_amounts_eur.map(Number),
    iracingReferralEnabled: row.iracing_referral_enabled,
    iracingReferralUrl: row.iracing_referral_url,
  };
};

export const fetchSharedPaymentLedger = async (): Promise<SharedPaymentLedger> => {
  const [ledgerResult, totalsResult] = await Promise.all([
    supabase.rpc("get_public_community_support_payment_ledger"),
    supabase.rpc("get_public_community_support_payment_totals"),
  ]);
  if (ledgerResult.error) throw ledgerResult.error;
  if (totalsResult.error) throw totalsResult.error;

  const entries: PublicSupportLedgerEntry[] = (ledgerResult.data ?? []).map((row) => ({
    id: `paypal-${row.id}`,
    date: row.date,
    direction: row.direction === "income" ? "income" : "expense",
    category: row.category === "contribution" ? "contribution" : row.category === "payment_refund" ? "payment_refund" : "payment_fee",
    description: row.description,
    amount: row.amount_eur === null ? null : Number(row.amount_eur),
    isPublic: true,
    ...(row.supporter_name ? { supporterName: row.supporter_name } : {}),
  }));
  const metricEntries = mapPaymentTotalsToMetricEntries(totalsResult.data ?? []);
  return { entries, metricEntries };
};

export const fetchAdminPaymentConfig = async (): Promise<AdminPaymentConfig> => {
  const { data, error } = await supabase.rpc("admin_get_community_support_payment_config");
  if (error) throw error;
  const row = firstRow(data);
  if (!row) throw new Error("Community Support payment configuration is missing.");
  if (row.paypal_checkout_environment !== "sandbox" && row.paypal_checkout_environment !== "live") {
    throw new Error("Invalid PayPal Checkout environment.");
  }
  return {
    paypalEnabled: row.paypal_enabled,
    paypalCheckoutEnabled: row.paypal_checkout_enabled,
    paypalCheckoutEnvironment: row.paypal_checkout_environment,
    paypalMeUrl: row.paypal_me_url,
    paypalSuggestedAmounts: row.suggested_amounts_eur.map(Number),
    paymentAdminDiscordId: row.payment_admin_discord_id,
    iracingReferralEnabled: row.iracing_referral_enabled,
    iracingReferralUrl: row.iracing_referral_url,
  };
};

export const updateAdminPaymentConfig = async (settings: AdminPaymentConfig): Promise<void> => {
  const { error } = await supabase.rpc("admin_update_community_support_payment_config", {
    p_paypal_enabled: settings.paypalEnabled,
    p_paypal_checkout_enabled: settings.paypalCheckoutEnabled,
    p_paypal_checkout_environment: settings.paypalCheckoutEnvironment,
    p_paypal_me_url: settings.paypalMeUrl,
    p_suggested_amounts_eur: settings.paypalSuggestedAmounts,
    p_payment_admin_discord_id: settings.paymentAdminDiscordId,
    p_iracing_referral_enabled: settings.iracingReferralEnabled,
    p_iracing_referral_url: settings.iracingReferralUrl,
  });
  if (error) throw error;
};

export const submitPaymentIntent = async (draft: SupportPaymentIntentDraft): Promise<string> => {
  const { data, error } = await supabase.rpc("create_community_support_payment_intent", {
    p_requested_amount_eur: draft.requestedAmount,
    p_payer_name_private: draft.payerName,
    p_show_supporter_name: draft.showSupporterName,
    p_show_amount: draft.showAmount,
  });
  if (error || !data) throw error ?? new Error("Payment intent could not be created");
  return data;
};

export const submitPayPalCheckoutIntent = async (draft: SupportPaymentIntentDraft): Promise<string> => {
  const { data, error } = await supabase.rpc("create_community_support_paypal_checkout_intent", {
    p_requested_amount_eur: draft.requestedAmount,
    p_payer_name_private: draft.payerName,
    p_show_supporter_name: draft.showSupporterName,
    p_show_amount: draft.showAmount,
  });
  if (error || !data) throw error ?? new Error("PayPal Checkout intent could not be created");
  return data;
};

export const cancelPayPalCheckoutIntent = async (intentId: string): Promise<void> => {
  const { data, error } = await supabase.rpc("cancel_community_support_paypal_checkout_intent", { p_intent_id: intentId });
  if (error || !["cancelled", "already_cancelled"].includes(data)) {
    throw error ?? new Error("PayPal Checkout intent could not be cancelled");
  }
};

export type PayPalCheckoutRecoveryIntent = { intentId: string; status: "pending" | "approved" };
export const fetchPayPalCheckoutRecoveryIntent = async (): Promise<PayPalCheckoutRecoveryIntent | null> => {
  const { data, error } = await supabase.rpc("get_community_support_paypal_checkout_recovery_intent");
  if (error) throw error;
  const row = data?.[0];
  if (!row) return null;
  if (row.status !== "pending" && row.status !== "approved") throw new Error("Invalid PayPal Checkout recovery state");
  return { intentId: row.intent_id, status: row.status };
};


export const fetchPayPalCheckoutConfig = async (): Promise<PayPalCheckoutConfig> => {
  const config = await invokePayPalCheckout<PayPalCheckoutConfig>({ action: "config" });
  if (!config.clientId || config.currency !== "EUR" || !["sandbox", "live"].includes(config.environment)) {
    throw new Error("PayPal Checkout is not configured.");
  }
  return config;
};

export const createPayPalCheckoutOrder = async (intentId: string): Promise<string> => {
  const result = await invokePayPalCheckout<{ orderId: string }>({ action: "create-order", intentId });
  if (!result.orderId) throw new Error("PayPal order was not created.");
  return result.orderId;
};

export const capturePayPalCheckoutOrder = async (intentId: string): Promise<PayPalCaptureResult> => {
  const result = await invokePayPalCheckout<PayPalCaptureResult>({ action: "capture-order", intentId });
  if (!result.captureId || !["confirmed", "already_confirmed"].includes(result.result)) {
    throw new Error("PayPal payment was not confirmed.");
  }
  return result;
};

export type PayPalMerchOrderResult = { orderId: string; merchOrderId: string };
export type PayPalMerchCaptureResult = { result: "confirmed" | "already_confirmed"; orderId: string; captureId: string; grossAmount: number };
export type PayPalMerchRecoveryResult =
  | PayPalMerchCaptureResult
  | { result: "pending"; merchOrderId: string; orderId: string }
  | { result: "none" | "cancelled" | "already_cancelled" | "awaiting_provider_expiry"; merchOrderId?: string };

export const recoverPayPalMerchOrder = async (productId: string): Promise<PayPalMerchRecoveryResult> =>
  invokePayPalCheckout<PayPalMerchRecoveryResult>({ action: "recover-merch-order", productId });

export const createPayPalMerchOrder = async (productId: string): Promise<PayPalMerchOrderResult> => {
  const result = await invokePayPalCheckout<PayPalMerchOrderResult>({ action: "create-merch-order", productId });
  if (!result.orderId || !result.merchOrderId) throw new Error("Merchandise order was not created.");
  return result;
};

export const capturePayPalMerchOrder = async (merchOrderId: string): Promise<PayPalMerchCaptureResult> => {
  const result = await invokePayPalCheckout<PayPalMerchCaptureResult>({ action: "capture-merch-order", merchOrderId });
  if (!result.captureId || !["confirmed", "already_confirmed"].includes(result.result)) throw new Error("Merchandise payment was not confirmed.");
  return result;
};

export const cancelPayPalMerchOrder = async (merchOrderId: string): Promise<void> => {
  const result = await invokePayPalCheckout<{ result: string }>({ action: "cancel-merch-order", merchOrderId });
  if (!["cancelled", "already_cancelled", "awaiting_provider_expiry"].includes(result.result)) throw new Error("Merchandise order was not cancelled safely.");
};
