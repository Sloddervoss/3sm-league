import type { SupportLedgerEntry, SupportPaymentIntent, SupportPaymentIntentDraft } from "./types";

export const DEFAULT_PAYPAL_AMOUNTS_EUR = [5, 10, 25] as const;

const roundMoney = (value: number) => Math.round(value * 100) / 100;

export const normalizePayPalMeUrl = (value: string): string | null => {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:") return null;
    if (!["paypal.me", "www.paypal.me"].includes(url.hostname.toLowerCase())) return null;
    if (url.username || url.password || url.port || url.search || url.hash) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length !== 1 || !/^[a-z0-9._-]{1,80}$/i.test(parts[0])) return null;
    return `https://paypal.me/${parts[0]}`;
  } catch {
    return null;
  }
};

export const normalizeDiscordUserId = (value: string): string | null => {
  const normalized = value.trim();
  return /^\d{17,20}$/.test(normalized) ? normalized : null;
};

export const normalizePayPalAmounts = (values: number[]): number[] => Array.from(new Set(values
  .filter((value) => Number.isFinite(value) && value >= 1 && value <= 1_000)
  .map(roundMoney)))
  .sort((left, right) => left - right)
  .slice(0, 6);

export const buildPayPalMeUrl = (baseUrl: string, amountEur: number): string | null => {
  const normalizedBase = normalizePayPalMeUrl(baseUrl);
  if (!normalizedBase || !Number.isFinite(amountEur) || amountEur < 1 || amountEur > 1_000) return null;
  const amount = roundMoney(amountEur).toFixed(2).replace(/\.00$/, "");
  return `${normalizedBase}/${amount}EUR`;
};

export const createPaymentIntent = (
  draft: SupportPaymentIntentDraft,
  id: string,
  createdAt = new Date().toISOString(),
): SupportPaymentIntent | null => {
  const requestedAmount = roundMoney(draft.requestedAmount);
  const payerName = draft.payerName.trim();
  if (!id || !Number.isFinite(requestedAmount) || requestedAmount < 1 || requestedAmount > 1_000 || !payerName || payerName.length > 100) return null;
  return {
    id,
    requestedAmount,
    payerName,
    showSupporterName: Boolean(draft.showSupporterName),
    showAmount: Boolean(draft.showAmount),
    status: "pending",
    createdAt,
  };
};

export type PaymentResolution = {
  intent: SupportPaymentIntent;
  ledgerEntries: SupportLedgerEntry[];
};

export const resolvePaymentIntent = (
  intent: SupportPaymentIntent,
  action: "confirm" | "not_found",
  options: { grossAmount?: number; feeAmount?: number; resolutionNote?: string; resolvedAt?: string } = {},
): PaymentResolution | null => {
  if (intent.status !== "pending") return null;
  const resolvedAt = options.resolvedAt ?? new Date().toISOString();
  const resolutionNote = options.resolutionNote?.trim() ?? "";
  if (!resolutionNote || resolutionNote.length > 500) return null;
  if (action === "not_found") {
    return { intent: { ...intent, status: "not_found", resolvedAt, resolutionNote }, ledgerEntries: [] };
  }

  const grossAmount = roundMoney(options.grossAmount ?? Number.NaN);
  const feeAmount = roundMoney(options.feeAmount ?? 0);
  if (!Number.isFinite(grossAmount) || grossAmount <= 0 || grossAmount > 1_000) return null;
  if (!Number.isFinite(feeAmount) || feeAmount < 0 || feeAmount >= grossAmount) return null;
  const date = resolvedAt.slice(0, 10);
  const entries: SupportLedgerEntry[] = [{
    id: `paypal-contribution:${intent.id}`,
    date,
    direction: "income",
    category: "contribution",
    description: "Vrijwillige PayPal-bijdrage",
    amount: grossAmount,
    isPublic: true,
    supporterName: intent.payerName,
    showSupporterName: intent.showSupporterName,
    showAmount: intent.showAmount,
  }];
  if (feeAmount > 0) entries.push({
    id: `paypal-fee:${intent.id}`,
    date,
    direction: "expense",
    category: "payment_fee",
    description: "PayPal-transactiekosten",
    amount: feeAmount,
    isPublic: true,
  });
  return {
    intent: { ...intent, status: "confirmed", resolvedAt, grossAmount, feeAmount, resolutionNote },
    ledgerEntries: entries,
  };
};
