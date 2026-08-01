import { supabase } from "@/integrations/supabase/client";
import type { CommunitySupportSettings, PublicSupportLedgerEntry, SupportLedgerEntry, SupportPaymentIntentDraft } from "./types";

export type PublicPaymentConfig = Pick<CommunitySupportSettings, "paypalEnabled" | "paypalMeUrl" | "paypalSuggestedAmounts" | "iracingReferralEnabled" | "iracingReferralUrl">;
export type AdminPaymentConfig = PublicPaymentConfig & Pick<CommunitySupportSettings, "paymentAdminDiscordId">;
export type SharedPaymentLedger = {
  entries: PublicSupportLedgerEntry[];
  metricEntries: SupportLedgerEntry[];
};

const firstRow = <T>(data: T[] | null): T | null => data?.[0] ?? null;

export const fetchPublicPaymentConfig = async (): Promise<PublicPaymentConfig> => {
  const { data, error } = await supabase.rpc("get_community_support_payment_config");
  if (error) throw error;
  const row = firstRow(data);
  if (!row) return { paypalEnabled: false, paypalMeUrl: "", paypalSuggestedAmounts: [], iracingReferralEnabled: false, iracingReferralUrl: "" };
  return {
    paypalEnabled: row.paypal_enabled,
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
    category: row.category === "contribution" ? "contribution" : "payment_fee",
    description: row.description,
    amount: row.amount_eur === null ? null : Number(row.amount_eur),
    isPublic: true,
    ...(row.supporter_name ? { supporterName: row.supporter_name } : {}),
  }));
  const metricEntries: SupportLedgerEntry[] = (totalsResult.data ?? []).flatMap((row) => {
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
  return { entries, metricEntries };
};

export const fetchAdminPaymentConfig = async (): Promise<AdminPaymentConfig> => {
  const { data, error } = await supabase.rpc("admin_get_community_support_payment_config");
  if (error) throw error;
  const row = firstRow(data);
  if (!row) throw new Error("Community Support payment configuration is missing.");
  return {
    paypalEnabled: row.paypal_enabled,
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
  if (error) throw error;
  if (!data) throw new Error("Payment intent was not created.");
  return data;
};
