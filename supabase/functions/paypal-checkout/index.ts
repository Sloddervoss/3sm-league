import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  assertApprovedOrderMatchesIntent,
  assertCaptureMatchesIntent,
  buildPayPalMerchOrderPayload,
  buildPayPalOrderPayload,
  extractPayPalCaptureSnapshot,
  extractPayPalPayerEmail,
  extractPayPalShipping,
  paypalCaptureIdFromCorrectionResource,
  paypalApiBase,
} from "../_shared/paypal.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

type Json = Record<string, unknown>;
type PaymentIntentRow = {
  id: string;
  user_id: string;
  requested_amount_eur: number | string;
  status: string;
  payment_flow: string;
  expires_at: string;
  paypal_environment: string | null;
  paypal_order_id: string | null;
  paypal_merchant_id: string | null;
};
type MerchOrderRow = {
  id: string;
  user_id: string;
  product_id: string | null;
  product_name: string;
  unit_price_eur: number | string;
  fulfillment_mode: "physical" | "digital";
  status: string;
  expires_at: string;
  paypal_environment: string;
  paypal_order_id: string | null;
  paypal_capture_id: string | null;
  paypal_merchant_id: string | null;
};

const env = (name: string) => Deno.env.get(name)?.trim() ?? "";
const SUPABASE_URL = env("SUPABASE_URL");
const SUPABASE_ANON_KEY = env("SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_ROLE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const PAYPAL_ENV = env("PAYPAL_ENV");
const PAYPAL_CLIENT_ID = env("PAYPAL_CLIENT_ID");
const PAYPAL_CLIENT_SECRET = env("PAYPAL_CLIENT_SECRET");
const PAYPAL_MERCHANT_ID = env("PAYPAL_MERCHANT_ID");
const PAYPAL_WEBHOOK_ID = env("PAYPAL_WEBHOOK_ID");
const PAYPAL_CHECKOUT_ENABLED = env("PAYPAL_CHECKOUT_ENABLED") === "true";
const ALLOWED_ORIGINS = new Set(env("PAYPAL_ALLOWED_ORIGINS").split(",").map((value) => value.trim()).filter(Boolean));

const MAX_BODY_BYTES = 64 * 1024;
const readJsonBody = async (req: Request): Promise<Json> => {
  const declaredLength = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) throw new Error("Request body too large");
  if (!req.body) throw new Error("Request body missing");
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new Error("Request body too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const raw = new TextDecoder().decode(bytes);
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid JSON body");
  return parsed as Json;
};

const jsonResponse = (body: Json, status = 200, origin = "") => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    ...(origin && ALLOWED_ORIGINS.has(origin) ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin" } : {}),
  },
});

const assertRuntime = () => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("Supabase configuration missing");
  if (!PAYPAL_CHECKOUT_ENABLED) throw new Error("PayPal Checkout is disabled");
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET || !PAYPAL_MERCHANT_ID) throw new Error("PayPal configuration missing");
  paypalApiBase(PAYPAL_ENV);
};

let accessToken: { value: string; expiresAt: number } | null = null;
const paypalToken = async () => {
  if (accessToken && accessToken.expiresAt > Date.now() + 30_000) return accessToken.value;
  const basic = btoa(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`);
  const response = await fetch(`${paypalApiBase(PAYPAL_ENV)}/v1/oauth2/token`, {
    method: "POST",
    headers: { "Authorization": `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!response.ok) throw new Error(`PayPal authentication failed (${response.status})`);
  const body = await response.json() as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error("PayPal authentication returned no token");
  accessToken = { value: body.access_token, expiresAt: Date.now() + Math.max(60, body.expires_in ?? 300) * 1_000 };
  return accessToken.value;
};

class PayPalRequestError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const paypalRequest = async (path: string, init: RequestInit = {}) => {
  const response = await fetch(`${paypalApiBase(PAYPAL_ENV)}${path}`, {
    ...init,
    headers: {
      "Authorization": `Bearer ${await paypalToken()}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation",
      ...(init.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({})) as Json;
  if (!response.ok) {
    const name = typeof body.name === "string" ? body.name : "PAYPAL_ERROR";
    throw new PayPalRequestError(response.status, `PayPal request failed (${response.status}, ${name})`);
  }
  return body;
};

const serviceClient = () => createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const authenticatedUser = async (req: Request) => {
  const authorization = req.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) throw new Error("Authentication required");
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error("Authentication required");
  return data.user;
};

const getIntent = async (id: string): Promise<PaymentIntentRow> => {
  const { data, error } = await serviceClient().from("community_support_payment_intents")
    .select("id,user_id,requested_amount_eur,status,payment_flow,expires_at,paypal_environment,paypal_order_id,paypal_merchant_id")
    .eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Payment intent not found");
  return data as PaymentIntentRow;
};

const settleOrder = async (intent: PaymentIntentRow, order: Json) => {
  if (intent.payment_flow !== "paypal_checkout") throw new Error("Payment intent is not a Checkout intent");
  const snapshot = extractPayPalCaptureSnapshot(order);
  assertCaptureMatchesIntent(snapshot, {
    intentId: intent.id,
    orderId: String(intent.paypal_order_id),
    merchantId: PAYPAL_MERCHANT_ID,
    amountEur: Number(intent.requested_amount_eur),
  });
  const { data, error } = await serviceClient().rpc("paypal_settle_community_support_capture", {
    p_intent_id: intent.id,
    p_environment: PAYPAL_ENV,
    p_order_id: snapshot.orderId,
    p_capture_id: snapshot.captureId,
    p_merchant_id: snapshot.merchantId,
    p_currency: snapshot.currency,
    p_gross_amount_eur: snapshot.grossAmount,
    p_fee_amount_eur: snapshot.feeAmount,
    p_net_amount_eur: snapshot.netAmount,
    p_captured_at: snapshot.capturedAt,
  });
  if (error) throw error;
  if (data !== "confirmed" && data !== "already_confirmed") throw new Error(`Capture settlement rejected: ${data}`);
  return { result: data, captureId: snapshot.captureId, grossAmount: snapshot.grossAmount, feeAmount: snapshot.feeAmount, netAmount: snapshot.netAmount };
};

const reconcileContributionIntent = async (intent: PaymentIntentRow) => {
  if (!intent.paypal_order_id || intent.paypal_environment !== PAYPAL_ENV || intent.paypal_merchant_id !== PAYPAL_MERCHANT_ID) {
    throw new Error("Payment intent has no valid PayPal order");
  }
  const orderPath = `/v2/checkout/orders/${encodeURIComponent(intent.paypal_order_id)}`;
  const currentOrder = await paypalRequest(orderPath);
  if (currentOrder.status === "COMPLETED") return settleOrder(intent, currentOrder);
  if (intent.status === "expired") return { result: "cancelled", intentId: intent.id };
  if (currentOrder.status === "CREATED" || currentOrder.status === "PAYER_ACTION_REQUIRED") {
    return { result: "pending", intentId: intent.id };
  }
  assertApprovedOrderMatchesIntent(currentOrder, {
    intentId: intent.id,
    orderId: intent.paypal_order_id,
    merchantId: PAYPAL_MERCHANT_ID,
    amountEur: Number(intent.requested_amount_eur),
  });
  const { data: beginResult, error: beginError } = await serviceClient().rpc("paypal_begin_community_support_capture", {
    p_intent_id: intent.id,
    p_user_id: intent.user_id,
    p_environment: PAYPAL_ENV,
    p_order_id: intent.paypal_order_id,
  });
  if (beginError) throw beginError;
  if (beginResult !== "begun" && beginResult !== "already_begun") {
    return { result: String(beginResult), intentId: intent.id };
  }
  try {
    return settleOrder(intent, await paypalRequest(`${orderPath}/capture`, {
      method: "POST",
      headers: { "PayPal-Request-Id": `capture-${intent.paypal_order_id}` },
      body: "{}",
    }));
  } catch (error) {
    // Browser approval and the signed webhook can race. If PayPal reports that
    // the other caller already captured the order, reconcile the authoritative
    // completed representation instead of treating the idempotent race as loss.
    if (error instanceof PayPalRequestError && error.status === 422) {
      const completedOrder = await paypalRequest(orderPath);
      if (completedOrder.status === "COMPLETED") return settleOrder(intent, completedOrder);
    }
    throw error;
  }
};

const getMerchOrder = async (id: string): Promise<MerchOrderRow> => {
  const { data, error } = await serviceClient().from("community_support_merch_orders")
    .select("id,user_id,product_id,product_name,unit_price_eur,fulfillment_mode,status,expires_at,paypal_environment,paypal_order_id,paypal_capture_id,paypal_merchant_id")
    .eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Merchandise order not found");
  return data as MerchOrderRow;
};

const getActiveMerchOrder = async (userId: string, productId: string): Promise<MerchOrderRow | null> => {
  const { data, error } = await serviceClient().from("community_support_merch_orders")
    .select("id,user_id,product_id,product_name,unit_price_eur,fulfillment_mode,status,expires_at,paypal_environment,paypal_order_id,paypal_capture_id,paypal_merchant_id")
    .eq("user_id", userId).eq("product_id", productId).in("status", ["pending", "approved"]).maybeSingle();
  if (error) throw error;
  return data ? data as MerchOrderRow : null;
};

const settleMerchOrder = async (merch: MerchOrderRow, order: Json) => {
  const snapshot = extractPayPalCaptureSnapshot(order);
  assertCaptureMatchesIntent(snapshot, {
    intentId: merch.id,
    orderId: String(merch.paypal_order_id),
    merchantId: PAYPAL_MERCHANT_ID,
    amountEur: Number(merch.unit_price_eur),
  });
  const deliveryEmail = extractPayPalPayerEmail(order);
  const shipping = merch.fulfillment_mode === "physical" ? extractPayPalShipping(order) : null;
  const { data, error } = await serviceClient().rpc("paypal_settle_community_support_merch_capture", {
    p_order_id: merch.id,
    p_environment: PAYPAL_ENV,
    p_paypal_order_id: snapshot.orderId,
    p_capture_id: snapshot.captureId,
    p_merchant_id: snapshot.merchantId,
    p_currency: snapshot.currency,
    p_gross_amount_eur: snapshot.grossAmount,
    p_fee_amount_eur: snapshot.feeAmount,
    p_net_amount_eur: snapshot.netAmount,
    p_captured_at: snapshot.capturedAt,
    p_delivery_email: deliveryEmail,
    p_shipping_name: shipping?.fullName ?? "",
    p_shipping_address: shipping?.address ?? null,
  });
  if (error) throw error;
  if (data !== "confirmed" && data !== "already_confirmed") throw new Error(`Merchandise settlement rejected: ${data}`);
  return { result: data, orderId: merch.id, captureId: snapshot.captureId, grossAmount: snapshot.grossAmount };
};

const cancelMerchOrderFromProviderState = async (merch: MerchOrderRow, providerStatus: string | null) => {
  const { data, error } = await serviceClient().rpc("paypal_cancel_community_support_merch_order", {
    p_order_id: merch.id,
    p_user_id: merch.user_id,
    p_environment: PAYPAL_ENV,
    p_provider_status: providerStatus,
  });
  if (error) throw error;
  if (!["cancelled", "already_cancelled", "awaiting_provider_expiry"].includes(String(data))) {
    throw new Error(`Merchandise cancellation rejected: ${data}`);
  }
  return String(data);
};

const reconcileMerchOrder = async (merch: MerchOrderRow) => {
  if (!merch.paypal_order_id) {
    const result = await cancelMerchOrderFromProviderState(merch, null);
    return { result, merchOrderId: merch.id };
  }
  if (merch.paypal_environment !== PAYPAL_ENV || merch.paypal_merchant_id !== PAYPAL_MERCHANT_ID) {
    throw new Error("Merchandise order has invalid PayPal binding");
  }
  const orderPath = `/v2/checkout/orders/${encodeURIComponent(merch.paypal_order_id)}`;
  const currentOrder = await paypalRequest(orderPath);
  const providerStatus = String(currentOrder.status ?? "");
  if (providerStatus === "COMPLETED") return settleMerchOrder(merch, currentOrder);
  if (providerStatus === "VOIDED") {
    const result = await cancelMerchOrderFromProviderState(merch, providerStatus);
    return { result, merchOrderId: merch.id };
  }
  if (providerStatus === "CREATED" || providerStatus === "PAYER_ACTION_REQUIRED") {
    return { result: "pending", merchOrderId: merch.id, orderId: merch.paypal_order_id };
  }
  if (providerStatus !== "APPROVED") throw new Error(`Unsupported PayPal merchandise order status: ${providerStatus}`);
  const { data: begun, error: beginError } = await serviceClient().rpc("paypal_begin_community_support_merch_capture", {
    p_order_id: merch.id,
    p_user_id: merch.user_id,
    p_environment: PAYPAL_ENV,
    p_paypal_order_id: merch.paypal_order_id,
  });
  if (beginError) throw beginError;
  if (begun !== "begun" && begun !== "already_begun") throw new Error(`Merchandise capture start rejected: ${begun}`);
  const captured = await paypalRequest(`${orderPath}/capture`, {
    method: "POST",
    headers: { "PayPal-Request-Id": `merch-capture-${merch.paypal_order_id}` },
    body: "{}",
  });
  return settleMerchOrder(merch, captured);
};

const reconcileActiveMerchOrders = async () => {
  const { data, error } = await serviceClient().from("community_support_merch_orders")
    .select("id,user_id,product_id,product_name,unit_price_eur,purchase_price_eur,shipping_cost_eur,fulfillment_mode,delivery_email,status,expires_at,paypal_environment,paypal_order_id,paypal_merchant_id,paypal_capture_id")
    .in("status", ["pending", "approved"])
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) throw error;
  const summary = { inspected: 0, confirmed: 0, cancelled: 0, pending: 0, failed: 0 };
  for (const row of (data ?? []) as MerchOrderRow[]) {
    summary.inspected += 1;
    try {
      if (!row.paypal_order_id) {
        if (new Date(row.expires_at).getTime() <= Date.now()) {
          const result = await cancelMerchOrderFromProviderState(row, null);
          if (result === "cancelled" || result === "already_cancelled") summary.cancelled += 1;
          else summary.pending += 1;
        } else summary.pending += 1;
        continue;
      }
      const result = await reconcileMerchOrder(row);
      if ("captureId" in result) summary.confirmed += 1;
      else if (result.result === "cancelled" || result.result === "already_cancelled") summary.cancelled += 1;
      else summary.pending += 1;
    } catch (error) {
      if (error instanceof PayPalRequestError && error.status === 404 && new Date(row.expires_at).getTime() <= Date.now()) {
        const result = await cancelMerchOrderFromProviderState(row, "VOIDED");
        if (result === "cancelled" || result === "already_cancelled") summary.cancelled += 1;
        else summary.failed += 1;
      } else summary.failed += 1;
    }
  }
  return summary;
};

const reconcileActiveContributionIntents = async () => {
  const { data, error } = await serviceClient().from("community_support_payment_intents")
    .select("id,user_id,requested_amount_eur,status,payment_flow,expires_at,paypal_environment,paypal_order_id,paypal_merchant_id")
    .eq("payment_flow", "paypal_checkout")
    .eq("paypal_environment", PAYPAL_ENV)
    .in("status", ["pending", "approved"])
    .not("paypal_order_id", "is", null)
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) throw error;
  const summary = { inspected: 0, confirmed: 0, cancelled: 0, pending: 0, failed: 0 };
  for (const row of (data ?? []) as PaymentIntentRow[]) {
    summary.inspected += 1;
    try {
      const result = await reconcileContributionIntent(row);
      if ("captureId" in result) summary.confirmed += 1;
      else if (result.result === "cancelled" || result.result === "not_pending") summary.cancelled += 1;
      else summary.pending += 1;
    } catch {
      summary.failed += 1;
    }
  }
  return summary;
};

const reconcileActiveCheckoutRecords = async () => {
  const contributions = await reconcileActiveContributionIntents();
  const merchandise = await reconcileActiveMerchOrders();
  return {
    inspected: contributions.inspected + merchandise.inspected,
    confirmed: contributions.confirmed + merchandise.confirmed,
    cancelled: contributions.cancelled + merchandise.cancelled,
    pending: contributions.pending + merchandise.pending,
    failed: contributions.failed + merchandise.failed,
    contributions,
    merchandise,
  };
};

const verifyWebhook = async (req: Request, event: Json) => {
  if (!PAYPAL_WEBHOOK_ID) throw new Error("PayPal webhook configuration missing");
  const requiredHeaders = ["paypal-auth-algo", "paypal-cert-url", "paypal-transmission-id", "paypal-transmission-sig", "paypal-transmission-time"];
  if (requiredHeaders.some((name) => !req.headers.get(name))) throw new Error("Incomplete PayPal webhook headers");
  const verification = await paypalRequest("/v1/notifications/verify-webhook-signature", {
    method: "POST",
    body: JSON.stringify({
      auth_algo: req.headers.get("paypal-auth-algo"),
      cert_url: req.headers.get("paypal-cert-url"),
      transmission_id: req.headers.get("paypal-transmission-id"),
      transmission_sig: req.headers.get("paypal-transmission-sig"),
      transmission_time: req.headers.get("paypal-transmission-time"),
      webhook_id: PAYPAL_WEBHOOK_ID,
      webhook_event: event,
    }),
  });
  if (verification.verification_status !== "SUCCESS") throw new Error("Invalid PayPal webhook signature");
};

const processWebhook = async (req: Request, origin: string) => {
  const event = await readJsonBody(req);
  await verifyWebhook(req, event);
  const eventId = String(event.id ?? "");
  const eventType = String(event.event_type ?? "");
  const resource = event.resource && typeof event.resource === "object" ? event.resource as Json : {};
  const resourceId = String(resource.id ?? "");
  if (!eventId || !eventType) throw new Error("Incomplete PayPal webhook event");

  const client = serviceClient();
  const { data: claimed, error: claimError } = await client.rpc("paypal_claim_community_support_webhook_event", {
    p_event_id: eventId, p_event_type: eventType, p_resource_id: resourceId,
  });
  if (claimError) throw claimError;
  if (!claimed) return jsonResponse({ received: true, duplicate: true }, 200, origin);

  try {
    let status: "processed" | "ignored" = "ignored";
    if (eventType === "CHECKOUT.ORDER.APPROVED" || eventType === "CHECKOUT.ORDER.VOIDED") {
      if (!resourceId) throw new Error("PayPal order lifecycle event missing order ID");
      const { data: merch, error: merchError } = await client.from("community_support_merch_orders")
        .select("id,user_id,product_id,product_name,unit_price_eur,fulfillment_mode,status,expires_at,paypal_environment,paypal_order_id,paypal_capture_id,paypal_merchant_id")
        .eq("paypal_environment", PAYPAL_ENV).eq("paypal_order_id", resourceId).maybeSingle();
      if (merchError) throw merchError;
      if (merch) {
        if (eventType === "CHECKOUT.ORDER.APPROVED") {
          const reconciled = await reconcileMerchOrder(merch as MerchOrderRow);
          if (!("captureId" in reconciled)) throw new Error("Approved merchandise order did not settle");
        } else {
          await cancelMerchOrderFromProviderState(merch as MerchOrderRow, "VOIDED");
        }
        status = "processed";
      } else {
        const { data: intent, error: intentError } = await client.from("community_support_payment_intents")
          .select("id,user_id,requested_amount_eur,status,payment_flow,expires_at,paypal_environment,paypal_order_id,paypal_merchant_id")
          .eq("paypal_environment", PAYPAL_ENV).eq("paypal_order_id", resourceId).maybeSingle();
        if (intentError) throw intentError;
        if (intent && eventType === "CHECKOUT.ORDER.APPROVED") {
          const reconciled = await reconcileContributionIntent(intent as PaymentIntentRow);
          if (!("captureId" in reconciled) && !["cancelled", "not_pending"].includes(reconciled.result)) {
            throw new Error(`Approved contribution did not settle: ${reconciled.result}`);
          }
          status = "processed";
        }
      }
    } else if (eventType === "PAYMENT.CAPTURE.COMPLETED") {
      if (!resourceId) throw new Error("Completed capture missing capture ID");
      const { data: settledMerch, error: settledMerchError } = await client.from("community_support_merch_orders")
        .select("id")
        .eq("paypal_environment", PAYPAL_ENV).eq("paypal_capture_id", resourceId).maybeSingle();
      if (settledMerchError) throw settledMerchError;
      const { data: settledIntent, error: settledError } = await client.from("community_support_payment_intents")
        .select("id")
        .eq("paypal_environment", PAYPAL_ENV).eq("paypal_capture_id", resourceId).maybeSingle();
      if (settledError) throw settledError;
      if (!settledMerch && !settledIntent) {
        const supplementary = resource.supplementary_data as Json | undefined;
        const related = supplementary?.related_ids as Json | undefined;
        const orderId = String(related?.order_id ?? "");
        if (!orderId) throw new Error("Completed capture missing order ID");
        const { data: merch, error: merchError } = await client.from("community_support_merch_orders")
          .select("id,user_id,product_id,product_name,unit_price_eur,fulfillment_mode,status,expires_at,paypal_environment,paypal_order_id,paypal_capture_id,paypal_merchant_id")
          .eq("paypal_environment", PAYPAL_ENV).eq("paypal_order_id", orderId).maybeSingle();
        if (merchError) throw merchError;
        if (merch) {
          await settleMerchOrder(merch as MerchOrderRow, await paypalRequest(`/v2/checkout/orders/${encodeURIComponent(orderId)}`));
        } else {
          const { data: intent, error } = await client.from("community_support_payment_intents")
            .select("id,user_id,requested_amount_eur,status,payment_flow,expires_at,paypal_environment,paypal_order_id,paypal_merchant_id")
            .eq("paypal_environment", PAYPAL_ENV).eq("paypal_order_id", orderId).maybeSingle();
          if (error || !intent) throw error ?? new Error("Webhook order not linked to a checkout record");
          await settleOrder(intent as PaymentIntentRow, await paypalRequest(`/v2/checkout/orders/${encodeURIComponent(orderId)}`));
        }
      }
      status = "processed";
    } else if (eventType === "PAYMENT.CAPTURE.REFUNDED" || eventType === "PAYMENT.CAPTURE.REVERSED") {
      const amount = resource.amount as Json | undefined;
      const reversal = eventType === "PAYMENT.CAPTURE.REVERSED";
      const captureId = reversal ? resourceId : paypalCaptureIdFromCorrectionResource(resource);
      if (!captureId) throw new Error("PayPal correction missing capture ID");
      const { data: merch, error: merchError } = await client.from("community_support_merch_orders")
        .select("id").eq("paypal_environment", PAYPAL_ENV).eq("paypal_capture_id", captureId).maybeSingle();
      if (merchError) throw merchError;
      const rpc = merch ? "paypal_refund_community_support_merch_capture" : "paypal_refund_community_support_capture";
      const args = merch ? {
        p_environment: PAYPAL_ENV,
        p_capture_id: captureId,
        p_refund_id: reversal ? `reversal:${eventId}` : resourceId,
        p_currency: String(amount?.currency_code ?? ""),
        p_refund_amount_eur: Number(amount?.value),
        p_refunded_at: String(resource.create_time ?? new Date().toISOString()),
        p_reversal: reversal,
      } : {
        p_environment: PAYPAL_ENV,
        p_capture_id: captureId,
        p_refund_id: reversal ? `reversal:${eventId}` : resourceId,
        p_currency: String(amount?.currency_code ?? ""),
        p_refund_amount_eur: Number(amount?.value),
        p_refunded_at: String(resource.create_time ?? new Date().toISOString()),
        p_correction_type: reversal ? "reversal" : "refund",
      };
      const { data, error } = await client.rpc(rpc, args);
      if (error) throw error;
      if (data !== "refunded" && data !== "already_refunded") throw new Error(`PayPal correction rejected: ${data}`);
      status = "processed";
    }
    const { data: finished, error: finishError } = await client.rpc("paypal_finish_community_support_webhook_event", {
      p_event_id: eventId, p_claim_token: claimed, p_status: status, p_error: null,
    });
    if (finishError) throw finishError;
    if (!finished) throw new Error("Webhook completion acknowledgement rejected");
    return jsonResponse({ received: true }, 200, origin);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook processing failed";
    await client.rpc("paypal_finish_community_support_webhook_event", {
      p_event_id: eventId, p_claim_token: claimed, p_status: "failed", p_error: message,
    });
    throw error;
  }
};

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") ?? "";
  const pathname = new URL(req.url).pathname;
  const webhookRequest = pathname.endsWith("/webhook");
  const maintenanceRequest = pathname.endsWith("/maintenance");
  if (req.method === "OPTIONS") {
    if (!origin || !ALLOWED_ORIGINS.has(origin)) return jsonResponse({ error: "Origin not allowed" }, 403);
    return jsonResponse({ ok: true }, 200, origin);
  }
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, origin);

  try {
    assertRuntime();
    if (webhookRequest) return await processWebhook(req, origin);
    if (maintenanceRequest) {
      if (req.headers.get("Authorization") !== `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) return jsonResponse({ error: "Authentication required" }, 401);
      return jsonResponse(await reconcileActiveCheckoutRecords(), 200);
    }
    if (!origin || !ALLOWED_ORIGINS.has(origin)) return jsonResponse({ error: "Origin not allowed" }, 403, origin);

    const body = await readJsonBody(req);
    const action = String(body.action ?? "");
    if (action === "config") {
      await authenticatedUser(req);
      return jsonResponse({ clientId: PAYPAL_CLIENT_ID, environment: PAYPAL_ENV, currency: "EUR" }, 200, origin);
    }

    const user = await authenticatedUser(req);

    if (action === "recover-merch-order") {
      const productId = String(body.productId ?? "");
      const merch = await getActiveMerchOrder(user.id, productId);
      if (!merch) return jsonResponse({ result: "none" }, 200, origin);
      if (merch.paypal_environment !== PAYPAL_ENV) throw new Error("Merchandise recovery environment mismatch");
      return jsonResponse(await reconcileMerchOrder(merch), 200, origin);
    }

    if (action === "create-merch-order") {
      const productId = String(body.productId ?? "");
      const { data: created, error: createError } = await serviceClient().rpc("paypal_create_community_support_merch_order", {
        p_user_id: user.id, p_product_id: productId, p_environment: PAYPAL_ENV,
      });
      if (createError || !created) throw createError ?? new Error("Merchandise reservation failed");
      const merch = created as MerchOrderRow;
      if (merch.paypal_order_id) return jsonResponse({ orderId: merch.paypal_order_id, merchOrderId: merch.id }, 200, origin);
      const paypalOrder = await paypalRequest("/v2/checkout/orders", {
        method: "POST",
        headers: { "PayPal-Request-Id": `merch-${merch.id}` },
        body: JSON.stringify(buildPayPalMerchOrderPayload(merch.id, merch.product_name, Number(merch.unit_price_eur), merch.fulfillment_mode)),
      });
      const paypalOrderId = String(paypalOrder.id ?? "");
      const purchaseUnit = Array.isArray(paypalOrder.purchase_units) ? paypalOrder.purchase_units[0] as Json | undefined : undefined;
      const payee = purchaseUnit?.payee as Json | undefined;
      if (!paypalOrderId || paypalOrder.status !== "CREATED" || payee?.merchant_id !== PAYPAL_MERCHANT_ID) throw new Error("PayPal merchandise order binding failed");
      const { data: attached, error: attachError } = await serviceClient().rpc("paypal_attach_community_support_merch_order", {
        p_order_id: merch.id, p_user_id: user.id, p_environment: PAYPAL_ENV,
        p_paypal_order_id: paypalOrderId, p_merchant_id: PAYPAL_MERCHANT_ID,
      });
      if (attachError) throw attachError;
      if (attached !== "attached" && attached !== "already_attached") throw new Error(`Merchandise order attachment rejected: ${attached}`);
      return jsonResponse({ orderId: paypalOrderId, merchOrderId: merch.id }, 200, origin);
    }

    if (action === "capture-merch-order" || action === "cancel-merch-order") {
      const merchOrderId = String(body.merchOrderId ?? "");
      const merch = await getMerchOrder(merchOrderId);
      if (merch.user_id !== user.id || merch.paypal_environment !== PAYPAL_ENV) throw new Error("Merchandise order does not belong to this user");
      if (action === "cancel-merch-order") {
        const providerStatus = merch.paypal_order_id
          ? String((await paypalRequest(`/v2/checkout/orders/${encodeURIComponent(merch.paypal_order_id)}`)).status ?? "")
          : null;
        const data = await cancelMerchOrderFromProviderState(merch, providerStatus);
        return jsonResponse({ result: data }, 200, origin);
      }
      const reconciled = await reconcileMerchOrder(merch);
      if (!("captureId" in reconciled)) throw new Error(`Merchandise order is not ready for settlement: ${reconciled.result}`);
      return jsonResponse(reconciled, 200, origin);
    }

    const intentId = String(body.intentId ?? "");
    const intent = await getIntent(intentId);
    if (intent.user_id !== user.id) throw new Error("Payment intent does not belong to this user");
    if (intent.payment_flow !== "paypal_checkout") throw new Error("Payment intent is not a Checkout intent");

    if (action === "create-order") {
      if (intent.status !== "pending" || new Date(intent.expires_at).getTime() <= Date.now()) throw new Error("Payment intent is no longer pending");
      if (intent.paypal_order_id) return jsonResponse({ orderId: intent.paypal_order_id }, 200, origin);
      const order = await paypalRequest("/v2/checkout/orders", {
        method: "POST",
        headers: { "PayPal-Request-Id": intent.id },
        body: JSON.stringify(buildPayPalOrderPayload(intent.id, Number(intent.requested_amount_eur))),
      });
      const orderId = String(order.id ?? "");
      const purchaseUnit = Array.isArray(order.purchase_units) ? order.purchase_units[0] as Json | undefined : undefined;
      const payee = purchaseUnit?.payee as Json | undefined;
      if (!orderId || order.status !== "CREATED" || payee?.merchant_id !== PAYPAL_MERCHANT_ID) throw new Error("PayPal order binding failed");
      const { data, error } = await serviceClient().rpc("paypal_attach_community_support_order", {
        p_intent_id: intent.id,
        p_user_id: user.id,
        p_environment: PAYPAL_ENV,
        p_order_id: orderId,
        p_merchant_id: PAYPAL_MERCHANT_ID,
      });
      if (error) throw error;
      if (data !== "attached" && data !== "already_attached") throw new Error(`Order attachment rejected: ${data}`);
      return jsonResponse({ orderId }, 200, origin);
    }

    if (action === "capture-order") {
      const reconciled = await reconcileContributionIntent(intent);
      if (!("captureId" in reconciled)) throw new Error(`Payment intent is not ready for settlement: ${reconciled.result}`);
      return jsonResponse(reconciled, 200, origin);
    }

    return jsonResponse({ error: "Unknown action" }, 400, origin);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = /Authentication required/.test(message) ? 401 : 400;
    return jsonResponse({ error: webhookRequest ? "PayPal webhook rejected" : "PayPal Checkout request failed" }, status, origin);
  }
});
