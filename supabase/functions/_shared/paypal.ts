export type PayPalOrderPayload = {
  intent: "CAPTURE";
  purchase_units: Array<{
    reference_id: string;
    custom_id: string;
    invoice_id: string;
    description: string;
    amount: { currency_code: "EUR"; value: string; breakdown?: { item_total: { currency_code: "EUR"; value: string } } };
    items?: Array<{ name: string; quantity: "1"; unit_amount: { currency_code: "EUR"; value: string } }>;
  }>;
  application_context?: { shipping_preference: "GET_FROM_FILE" | "NO_SHIPPING"; user_action: "PAY_NOW" };
};

export type PayPalCaptureSnapshot = {
  orderId: string;
  captureId: string;
  status: string;
  customId: string;
  merchantId: string;
  currency: string;
  grossAmount: number;
  feeAmount: number;
  netAmount: number;
  capturedAt: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONEY_RE = /^\d{1,7}\.\d{2}$/;

export const toEurValue = (value: number): string => {
  if (!Number.isFinite(value) || value < 1 || value > 1_000 || Math.abs(value * 100 - Math.round(value * 100)) > 1e-7) throw new Error("Invalid EUR amount");
  return (Math.round(value * 100) / 100).toFixed(2);
};

export const buildPayPalOrderPayload = (intentId: string, amountEur: number): PayPalOrderPayload => {
  if (!UUID_RE.test(intentId)) throw new Error("Invalid payment intent ID");
  return {
    intent: "CAPTURE",
    purchase_units: [{
      reference_id: intentId,
      custom_id: intentId,
      invoice_id: `3SM-${intentId}`,
      description: "3SM Community Support-bijdrage",
      amount: { currency_code: "EUR", value: toEurValue(amountEur) },
    }],
  };
};

export const buildPayPalMerchOrderPayload = (orderId: string, productName: string, amountEur: number, fulfillmentMode: "physical" | "digital" = "physical"): PayPalOrderPayload => {
  if (!UUID_RE.test(orderId)) throw new Error("Invalid merchandise order ID");
  const name = productName.trim();
  if (!name || name.length > 100) throw new Error("Invalid product name");
  const value = toEurValue(amountEur);
  return {
    intent: "CAPTURE",
    purchase_units: [{
      reference_id: orderId,
      custom_id: orderId,
      invoice_id: `3SM-MERCH-${orderId}`,
      description: `3SM merchandise: ${name}`.slice(0, 127),
      amount: { currency_code: "EUR", value, breakdown: { item_total: { currency_code: "EUR", value } } },
      items: [{ name, quantity: "1", unit_amount: { currency_code: "EUR", value } }],
    }],
    application_context: { shipping_preference: fulfillmentMode === "physical" ? "GET_FROM_FILE" : "NO_SHIPPING", user_action: "PAY_NOW" },
  };
};

export const extractPayPalPayerEmail = (order: Record<string, unknown>): string => {
  if (!order.payer || typeof order.payer !== "object" || Array.isArray(order.payer)) throw new Error("PayPal payer missing");
  const email = String((order.payer as Record<string, unknown>).email_address ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error("PayPal payer email missing");
  return email;
};

export const extractPayPalShipping = (order: Record<string, unknown>) => {
  const unit = Array.isArray(order.purchase_units) ? order.purchase_units[0] as Record<string, unknown> | undefined : undefined;
  const shipping = unit?.shipping as Record<string, unknown> | undefined;
  const name = shipping?.name as Record<string, unknown> | undefined;
  const address = shipping?.address as Record<string, unknown> | undefined;
  const fullName = String(name?.full_name ?? "").trim();
  if (!fullName || !address || typeof address !== "object" || Array.isArray(address)) throw new Error("PayPal shipping address missing");
  const allowed = ["address_line_1", "address_line_2", "admin_area_1", "admin_area_2", "postal_code", "country_code"];
  const safeAddress = Object.fromEntries(allowed.flatMap((key) => typeof address[key] === "string" && String(address[key]).trim()
    ? [[key, String(address[key]).trim().slice(0, 160)]]
    : []));
  if (!safeAddress.address_line_1 || !safeAddress.postal_code || !safeAddress.country_code) throw new Error("PayPal shipping address incomplete");
  return { fullName: fullName.slice(0, 160), address: safeAddress };
};

const money = (value: unknown, label: string): number => {
  if (typeof value !== "string" || !MONEY_RE.test(value)) throw new Error(`Missing ${label}`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid ${label}`);
  return Math.round(parsed * 100) / 100;
};

export const extractPayPalCaptureSnapshot = (order: Record<string, unknown>): PayPalCaptureSnapshot => {
  const purchaseUnits = Array.isArray(order.purchase_units) ? order.purchase_units : [];
  if (purchaseUnits.length !== 1) throw new Error("Expected one PayPal purchase unit");
  const unit = purchaseUnits[0] as Record<string, unknown>;
  const payments = unit.payments as Record<string, unknown> | undefined;
  const captures = Array.isArray(payments?.captures) ? payments.captures : [];
  if (captures.length !== 1) throw new Error("Expected one PayPal capture");
  const capture = captures[0] as Record<string, unknown>;
  const amount = capture.amount as Record<string, unknown> | undefined;
  const seller = capture.seller_receivable_breakdown as Record<string, unknown> | undefined;
  const fee = seller?.paypal_fee as Record<string, unknown> | undefined;
  const net = seller?.net_amount as Record<string, unknown> | undefined;
  const payee = unit.payee as Record<string, unknown> | undefined;

  const grossAmount = money(amount?.value, "gross amount");
  const feeAmount = money(fee?.value, "PayPal fee");
  const netAmount = money(net?.value, "net amount");
  const currency = String(amount?.currency_code ?? "");
  if (currency !== "EUR" || fee?.currency_code !== "EUR" || net?.currency_code !== "EUR") throw new Error("PayPal currency mismatch");
  if (Math.abs(grossAmount - feeAmount - netAmount) > 0.001) throw new Error("PayPal settlement mismatch");

  return {
    orderId: String(order.id ?? ""),
    captureId: String(capture.id ?? ""),
    status: String(capture.status ?? ""),
    customId: String(unit.custom_id ?? ""),
    merchantId: String(payee?.merchant_id ?? ""),
    currency,
    grossAmount,
    feeAmount,
    netAmount,
    capturedAt: String(capture.create_time ?? ""),
  };
};

export const assertCaptureMatchesIntent = (
  snapshot: PayPalCaptureSnapshot,
  expected: { intentId: string; orderId: string; merchantId: string; amountEur: number },
): void => {
  if (snapshot.status !== "COMPLETED") throw new Error("PayPal capture is not completed");
  if (snapshot.customId !== expected.intentId) throw new Error("PayPal intent mismatch");
  if (snapshot.orderId !== expected.orderId) throw new Error("PayPal order mismatch");
  if (snapshot.merchantId !== expected.merchantId) throw new Error("PayPal merchant mismatch");
  if (snapshot.currency !== "EUR" || snapshot.grossAmount !== Number(toEurValue(expected.amountEur))) throw new Error("PayPal amount mismatch");
  if (!snapshot.captureId || !snapshot.capturedAt) throw new Error("Incomplete PayPal capture");
};

export const paypalCaptureIdFromCorrectionResource = (resource: Record<string, unknown>): string => {
  const supplementary = resource.supplementary_data as Record<string, unknown> | undefined;
  const related = supplementary?.related_ids as Record<string, unknown> | undefined;
  const relatedCaptureId = String(related?.capture_id ?? "").trim();
  if (relatedCaptureId) return relatedCaptureId;

  const links = Array.isArray(resource.links) ? resource.links : [];
  for (const candidate of links) {
    const link = candidate as Record<string, unknown>;
    if (link.rel !== "up" || typeof link.href !== "string") continue;
    try {
      const match = new URL(link.href).pathname.match(/\/v2\/payments\/captures\/([^/]+)$/);
      if (match?.[1]) return decodeURIComponent(match[1]);
    } catch {
      // Ignore malformed provider links and fail closed below.
    }
  }
  return "";
};

export const paypalApiBase = (environment: string): string => {
  if (environment === "sandbox") return "https://api-m.sandbox.paypal.com";
  if (environment === "live") return "https://api-m.paypal.com";
  throw new Error("Invalid PayPal environment");
};
