import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
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
  toEurValue,
} from "../../supabase/functions/_shared/paypal";

const intentId = "2a9ad46e-f4c1-4c77-94fd-cde7531b76d7";
const orderId = "5O190127TN364715T";
const merchantId = "Q4AR23RSYFWE6";

const completedOrder = {
  id: orderId,
  purchase_units: [{
    custom_id: intentId,
    payee: { merchant_id: merchantId },
    payments: { captures: [{
      id: "3C679366HH908993F",
      status: "COMPLETED",
      create_time: "2026-08-02T20:00:00Z",
      amount: { currency_code: "EUR", value: "10.00" },
      seller_receivable_breakdown: {
        paypal_fee: { currency_code: "EUR", value: "0.69" },
        net_amount: { currency_code: "EUR", value: "9.31" },
      },
    }] },
  }],
};

const approvedOrder = {
  id: orderId,
  status: "APPROVED",
  purchase_units: [{
    custom_id: intentId,
    payee: { merchant_id: merchantId },
    amount: { currency_code: "EUR", value: "10.00" },
  }],
};

describe("PayPal Checkout server contract", () => {
  it("builds a single EUR order tied to the immutable intent UUID", () => {
    expect(buildPayPalOrderPayload(intentId, 10.01)).toEqual({
      intent: "CAPTURE",
      purchase_units: [{
        reference_id: intentId,
        custom_id: intentId,
        invoice_id: `3SM-${intentId}`,
        description: "3SM Community Support-bijdrage",
        amount: { currency_code: "EUR", value: "10.01" },
      }],
    });
    expect(() => buildPayPalOrderPayload("not-a-uuid", 10)).toThrow(/intent ID/);
    expect(() => toEurValue(10.005)).toThrow(/amount/);
    expect(() => toEurValue(0)).toThrow(/amount/);
    expect(() => toEurValue(1_001)).toThrow(/amount/);
  });

  it("builds merchandise orders with one immutable item and PayPal shipping address collection", () => {
    const payload = buildPayPalMerchOrderPayload(intentId, "3SM cap", 25);
    expect(payload).toMatchObject({
      intent: "CAPTURE",
      application_context: { shipping_preference: "GET_FROM_FILE", user_action: "PAY_NOW" },
      purchase_units: [{
        reference_id: intentId,
        custom_id: intentId,
        invoice_id: `3SM-MERCH-${intentId}`,
        amount: { currency_code: "EUR", value: "25.00" },
        items: [{ name: "3SM cap", quantity: "1", unit_amount: { currency_code: "EUR", value: "25.00" } }],
      }],
    });
    expect(extractPayPalShipping({ purchase_units: [{ shipping: { name: { full_name: "Vincent de Vos" }, address: { address_line_1: "Gridstraat 3", postal_code: "1234AB", admin_area_2: "Assen", country_code: "NL", unsafe: "drop" } } }] })).toEqual({
      fullName: "Vincent de Vos",
      address: { address_line_1: "Gridstraat 3", postal_code: "1234AB", admin_area_2: "Assen", country_code: "NL" },
    });
    expect(() => extractPayPalShipping({ purchase_units: [{}] })).toThrow(/shipping/);
    expect(buildPayPalMerchOrderPayload(intentId, "Digitale pas", 5, "digital").application_context?.shipping_preference).toBe("NO_SHIPPING");
    expect(extractPayPalPayerEmail({ payer: { email_address: "Member@Example.COM" } })).toBe("member@example.com");
    expect(() => extractPayPalPayerEmail({ payer: {} })).toThrow(/email/);
  });

  it("verifies the approved order binding before any server-side capture", () => {
    expect(() => assertApprovedOrderMatchesIntent(approvedOrder, { intentId, orderId, merchantId, amountEur: 10 })).not.toThrow();
    expect(() => assertApprovedOrderMatchesIntent({ ...approvedOrder, status: "CREATED" }, { intentId, orderId, merchantId, amountEur: 10 })).toThrow(/not approved/);
    expect(() => assertApprovedOrderMatchesIntent({ ...approvedOrder, purchase_units: [{ ...approvedOrder.purchase_units[0], custom_id: "wrong" }] }, { intentId, orderId, merchantId, amountEur: 10 })).toThrow(/intent mismatch/);
    expect(() => assertApprovedOrderMatchesIntent({ ...approvedOrder, purchase_units: [{ ...approvedOrder.purchase_units[0], amount: { currency_code: "EUR", value: "11.00" } }] }, { intentId, orderId, merchantId, amountEur: 10 })).toThrow(/amount mismatch/);
  });

  it("extracts PayPal gross, fee and net snapshots and verifies every financial binding", () => {
    const snapshot = extractPayPalCaptureSnapshot(completedOrder);
    expect(snapshot).toMatchObject({
      orderId,
      captureId: "3C679366HH908993F",
      status: "COMPLETED",
      customId: intentId,
      merchantId,
      currency: "EUR",
      grossAmount: 10,
      feeAmount: 0.69,
      netAmount: 9.31,
    });
    expect(() => assertCaptureMatchesIntent(snapshot, { intentId, orderId, merchantId, amountEur: 10 })).not.toThrow();
    expect(() => assertCaptureMatchesIntent(snapshot, { intentId, orderId, merchantId: "WRONG", amountEur: 10 })).toThrow(/merchant/);
    expect(() => assertCaptureMatchesIntent(snapshot, { intentId, orderId, merchantId, amountEur: 11 })).toThrow(/amount/);
  });

  it("fails closed on missing fee data, non-EUR data and inconsistent settlement math", () => {
    const withoutFee = structuredClone(completedOrder);
    delete withoutFee.purchase_units[0].payments.captures[0].seller_receivable_breakdown.paypal_fee;
    expect(() => extractPayPalCaptureSnapshot(withoutFee)).toThrow(/fee/);

    const usd = structuredClone(completedOrder);
    usd.purchase_units[0].payments.captures[0].amount.currency_code = "USD";
    expect(() => extractPayPalCaptureSnapshot(usd)).toThrow(/currency/);

    const mismatch = structuredClone(completedOrder);
    mismatch.purchase_units[0].payments.captures[0].seller_receivable_breakdown.net_amount.value = "9.30";
    expect(() => extractPayPalCaptureSnapshot(mismatch)).toThrow(/settlement/);
  });

  it("keeps sandbox and live API hosts explicit and rejects every other value", () => {
    expect(paypalApiBase("sandbox")).toBe("https://api-m.sandbox.paypal.com");
    expect(paypalApiBase("live")).toBe("https://api-m.paypal.com");
    expect(() => paypalApiBase("staging")).toThrow(/environment/);
  });

  it("resolves refund capture IDs from both PayPal correction payload shapes", () => {
    expect(paypalCaptureIdFromCorrectionResource({
      supplementary_data: { related_ids: { capture_id: "CAPTURE-FROM-RELATED" } },
    })).toBe("CAPTURE-FROM-RELATED");
    expect(paypalCaptureIdFromCorrectionResource({
      links: [{ rel: "up", href: "https://api-m.sandbox.paypal.com/v2/payments/captures/CAPTURE-FROM-LINK" }],
    })).toBe("CAPTURE-FROM-LINK");
    expect(paypalCaptureIdFromCorrectionResource({
      links: [{ rel: "up", href: "https://example.com/v2/payments/refunds/not-a-capture" }],
    })).toBe("");
  });

  it("keeps all secrets server-side and verifies auth, origin and webhook signatures", () => {
    const edge = readFileSync("supabase/functions/paypal-checkout/index.ts", "utf8");
    const config = readFileSync("supabase/config.toml", "utf8");
    expect(edge).toContain('Deno.env.get(name)');
    expect(edge).not.toContain("VITE_PAYPAL_CLIENT_SECRET");
    expect(edge).toContain('await client.auth.getUser()');
    expect(edge).toContain('ALLOWED_ORIGINS.has(origin)');
    expect(edge).toContain('req.body.getReader()');
    expect(edge).toContain('/v1/notifications/verify-webhook-signature');
    expect(edge).toContain('verification.verification_status !== "SUCCESS"');
    expect(edge).toContain('PAYMENT.CAPTURE.COMPLETED');
    expect(edge).toContain('PAYMENT.CAPTURE.REFUNDED');
    expect(edge).toContain('PAYMENT.CAPTURE.REVERSED');
    expect(edge).toContain('CHECKOUT.ORDER.APPROVED');
    expect(edge).toContain('const reconcileContributionIntent = async');
    expect(edge).toContain('await reconcileContributionIntent(intent as PaymentIntentRow)');
    expect(edge).toContain('assertApprovedOrderMatchesIntent(currentOrder');
    expect(edge).toContain('PayPal-Request-Id": `capture-${intent.paypal_order_id}`');
    expect(edge).toContain('error instanceof PayPalRequestError && error.status === 422');
    expect(edge).toContain('.eq("paypal_environment", PAYPAL_ENV).eq("paypal_capture_id", resourceId)');
    expect(edge).toContain('currentOrder.status === "COMPLETED"');
    expect(config).toMatch(/\[functions\.paypal-checkout\]\nverify_jwt = false/);
  });

  it("settles and refunds atomically through service-role-only idempotent SQL contracts", () => {
    const migration = readFileSync("supabase/migrations/20260802210000_community_support_paypal_checkout.sql", "utf8");
    expect(migration).toContain("FOR UPDATE");
    expect(migration).toContain("paypal_order_id IS NOT NULL");
    expect(migration).toContain("paypal_capture_id IS NOT NULL");
    expect(migration).toContain("round(p_gross_amount_eur, 2) <> v_intent.requested_amount_eur");
    expect(migration).toContain("round(p_gross_amount_eur - p_fee_amount_eur, 2) <> round(p_net_amount_eur, 2)");
    expect(migration).toContain("payment_refund");
    expect(migration).toContain("refund_exceeds_capture");
    expect(migration).toContain("reversal_amount_mismatch");
    expect(migration).toContain("Manual PayPal.Me contributions are disabled");
    expect(migration).toContain("CHECK (NOT (paypal_enabled AND paypal_checkout_enabled))");
    expect(migration).toContain("paypal_begin_community_support_capture");
    expect(migration).toContain("cancel_community_support_paypal_checkout_intent");
    expect(migration).toContain("get_community_support_paypal_checkout_recovery_intent");
    expect(migration).toContain("Super-admin required for live PayPal Checkout");
    expect(migration).toContain("WHERE paypal_environment = p_environment");
    expect(migration).toContain("claim_token = p_claim_token");
    expect(migration).toContain("ledger.category IN ('contribution', 'payment_refund') AND ledger.show_amount = false");
    expect(migration).toContain("intent.payment_flow = 'paypal_me_manual'");
    expect(migration).toContain("paypal_event_id TEXT PRIMARY KEY");
    expect(migration).toContain("community_support_paypal_webhook_events.status = 'failed'");
    expect(migration.match(/IF auth\.role\(\) <> 'service_role'/g)).toHaveLength(8);
    expect(migration).toContain("REVOKE ALL ON public.community_support_paypal_webhook_events FROM PUBLIC, anon, authenticated");
  });

  it("keeps merchandise reservations recoverable and reconciles them server-side", () => {
    const edge = readFileSync("supabase/functions/paypal-checkout/index.ts", "utf8");
    const migration = readFileSync("supabase/migrations/20260803150000_community_support_merch_checkout.sql", "utf8");
    const bot = readFileSync("bot/index.js", "utf8");
    const merchApi = readFileSync("src/features/community-support/merchApi.ts", "utf8");
    expect(migration).toContain("PayPal Checkout is disabled");
    expect(migration).toContain("PayPal Checkout is disabled or the environment does not match");
    expect(migration).toContain("interval '73 hours'");
    expect(migration).toContain("awaiting_provider_expiry");
    expect(migration).toContain("get_owned_active_community_support_merch_product_ids");
    expect(migration).not.toContain("GRANT SELECT ON public.community_support_merch_orders TO authenticated");
    expect(migration).not.toContain("current_user NOT IN ('service_role','supabase_admin')");
    expect(migration.match(/coalesce\(auth\.role\(\), ''\) <> 'service_role'/g)).toHaveLength(6);
    expect(migration.indexOf("SELECT id INTO v_refund_id FROM public.community_support_merch_refunds")).toBeLessThan(migration.indexOf("v_order.refunded_amount_eur+p_refund_amount_eur>v_order.unit_price_eur"));
    expect(merchApi).not.toContain('.from("community_support_merch_orders")');
    expect(edge).toContain('pathname.endsWith("/maintenance")');
    expect(edge).toContain('const reconcileActiveContributionIntents = async');
    expect(edge).toContain('return jsonResponse(await reconcileActiveCheckoutRecords(), 200)');
    expect(edge).toContain('.eq("payment_flow", "paypal_checkout")');
    expect(edge).toContain('req.headers.get("Authorization") !== `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`');
    expect(edge).toContain('.in("status", ["pending", "approved"])');
    expect(bot).toContain("reconcileMerchOrders");
  });
});
