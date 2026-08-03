import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  assertCaptureMatchesIntent,
  buildPayPalOrderPayload,
  extractPayPalCaptureSnapshot,
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
    throw new Error(`PayPal request failed (${response.status}, ${name})`);
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
    if (eventType === "PAYMENT.CAPTURE.COMPLETED") {
      const supplementary = resource.supplementary_data as Json | undefined;
      const related = supplementary?.related_ids as Json | undefined;
      const orderId = String(related?.order_id ?? "");
      if (!orderId) throw new Error("Completed capture missing order ID");
      const { data: intent, error } = await client.from("community_support_payment_intents")
        .select("id,user_id,requested_amount_eur,status,payment_flow,expires_at,paypal_environment,paypal_order_id,paypal_merchant_id")
        .eq("paypal_environment", PAYPAL_ENV).eq("paypal_order_id", orderId).maybeSingle();
      if (error || !intent) throw error ?? new Error("Webhook order not linked to an intent");
      await settleOrder(intent as PaymentIntentRow, await paypalRequest(`/v2/checkout/orders/${encodeURIComponent(orderId)}`));
      status = "processed";
    } else if (eventType === "PAYMENT.CAPTURE.REFUNDED" || eventType === "PAYMENT.CAPTURE.REVERSED") {
      const supplementary = resource.supplementary_data as Json | undefined;
      const related = supplementary?.related_ids as Json | undefined;
      const amount = resource.amount as Json | undefined;
      const reversal = eventType === "PAYMENT.CAPTURE.REVERSED";
      const { data, error } = await client.rpc("paypal_refund_community_support_capture", {
        p_environment: PAYPAL_ENV,
        p_capture_id: reversal ? resourceId : String(related?.capture_id ?? ""),
        p_refund_id: reversal ? `reversal:${eventId}` : resourceId,
        p_currency: String(amount?.currency_code ?? ""),
        p_refund_amount_eur: Number(amount?.value),
        p_refunded_at: String(resource.create_time ?? new Date().toISOString()),
        p_correction_type: reversal ? "reversal" : "refund",
      });
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
  const webhookRequest = new URL(req.url).pathname.endsWith("/webhook");
  if (req.method === "OPTIONS") {
    if (!origin || !ALLOWED_ORIGINS.has(origin)) return jsonResponse({ error: "Origin not allowed" }, 403);
    return jsonResponse({ ok: true }, 200, origin);
  }
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, origin);

  try {
    assertRuntime();
    if (webhookRequest) return await processWebhook(req, origin);
    if (!origin || !ALLOWED_ORIGINS.has(origin)) return jsonResponse({ error: "Origin not allowed" }, 403, origin);

    const body = await readJsonBody(req);
    const action = String(body.action ?? "");
    if (action === "config") {
      await authenticatedUser(req);
      return jsonResponse({ clientId: PAYPAL_CLIENT_ID, environment: PAYPAL_ENV, currency: "EUR" }, 200, origin);
    }

    const user = await authenticatedUser(req);
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
      if (!intent.paypal_order_id || intent.paypal_environment !== PAYPAL_ENV || intent.paypal_merchant_id !== PAYPAL_MERCHANT_ID) throw new Error("Payment intent has no valid PayPal order");
      const orderPath = `/v2/checkout/orders/${encodeURIComponent(intent.paypal_order_id)}`;
      const currentOrder = await paypalRequest(orderPath);
      if (currentOrder.status === "COMPLETED") {
        return jsonResponse(await settleOrder(intent, currentOrder), 200, origin);
      }
      if (currentOrder.status !== "APPROVED") throw new Error("PayPal order is not approved for capture");
      const { data: beginResult, error: beginError } = await serviceClient().rpc("paypal_begin_community_support_capture", {
        p_intent_id: intent.id,
        p_user_id: user.id,
        p_environment: PAYPAL_ENV,
        p_order_id: intent.paypal_order_id,
      });
      if (beginError) throw beginError;
      if (beginResult !== "begun" && beginResult !== "already_begun") throw new Error(`Capture start rejected: ${beginResult}`);
      const capturedOrder = await paypalRequest(`${orderPath}/capture`, {
        method: "POST",
        headers: { "PayPal-Request-Id": `capture-${intent.paypal_order_id}` },
        body: "{}",
      });
      return jsonResponse(await settleOrder(intent, capturedOrder), 200, origin);
    }

    return jsonResponse({ error: "Unknown action" }, 400, origin);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = /Authentication required/.test(message) ? 401 : 400;
    return jsonResponse({ error: webhookRequest ? "PayPal webhook rejected" : "PayPal Checkout request failed" }, status, origin);
  }
});
