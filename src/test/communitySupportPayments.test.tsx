import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import PayPalContributionModal from "@/features/community-support/public/PayPalContributionModal";
import PaymentReviewSection from "@/features/control-room/support/PaymentReviewSection";
import {
  buildPayPalMeUrl,
  createPaymentIntent,
  normalizeDiscordUserId,
  normalizeIracingReferralUrl,
  normalizePayPalMeUrl,
  resolvePaymentIntent,
} from "@/features/community-support/paymentFlow";
import type { CommunitySupportSettings, SupportPaymentIntent } from "@/features/community-support/types";

const settings: CommunitySupportSettings = {
  reserve: 0,
  reserveStartYear: "2026",
  usdEurRate: 0.92,
  racePricingInitialized: true,
  publicSupporterNamesByDefault: true,
  publicSupporterAmountsByDefault: false,
  paypalEnabled: true,
  paypalMeUrl: "https://paypal.me/ExampleAccount",
  paypalSuggestedAmounts: [5, 10, 25],
  paymentAdminDiscordId: "123456789012345678",
  iracingReferralEnabled: true,
  iracingReferralUrl: "https://www.iracing.com/referral/?ref=3sm",
};

const pendingIntent: SupportPaymentIntent = {
  id: "intent-a",
  requestedAmount: 10,
  payerName: "Vincent de Vos",
  showSupporterName: true,
  showAmount: false,
  status: "pending",
  createdAt: "2026-08-01T18:42:00.000Z",
};

describe("PayPal.Me contribution flow", () => {
  it("accepts only a clean PayPal.Me base URL and a Discord snowflake", () => {
    expect(normalizePayPalMeUrl("https://paypal.me/ExampleAccount/")).toBe("https://paypal.me/ExampleAccount");
    expect(normalizePayPalMeUrl("https://www.paypal.me/ExampleAccount")).toBe("https://paypal.me/ExampleAccount");
    expect(normalizePayPalMeUrl("http://paypal.me/ExampleAccount")).toBeNull();
    expect(normalizePayPalMeUrl("https://paypal.me/ExampleAccount/10EUR")).toBeNull();
    expect(normalizePayPalMeUrl("https://evil.example/ExampleAccount")).toBeNull();
    expect(normalizePayPalMeUrl("https://paypal.me/ExampleAccount?redirect=evil")).toBeNull();
    expect(normalizeDiscordUserId("123456789012345678")).toBe("123456789012345678");
    expect(normalizeDiscordUserId("admin")).toBeNull();
  });

  it("builds an external EUR amount link without treating the click as payment", () => {
    expect(buildPayPalMeUrl(settings.paypalMeUrl, 10)).toBe("https://paypal.me/ExampleAccount/10EUR");
    expect(buildPayPalMeUrl(settings.paypalMeUrl, 10.5)).toBe("https://paypal.me/ExampleAccount/10.50EUR");
    expect(buildPayPalMeUrl("https://evil.example/pay", 10)).toBeNull();
  });

  it("accepts only secure referral links on official iRacing domains", () => {
    expect(normalizeIracingReferralUrl("https://www.iracing.com/referral/?ref=3sm")).toBe("https://www.iracing.com/referral/?ref=3sm");
    expect(normalizeIracingReferralUrl("https://members.iracing.com/referral/3sm")).toBe("https://members.iracing.com/referral/3sm");
    expect(normalizeIracingReferralUrl("http://www.iracing.com/referral/3sm")).toBeNull();
    expect(normalizeIracingReferralUrl("https://iracing.com.evil.example/referral/3sm")).toBeNull();
    expect(normalizeIracingReferralUrl("https://-bad.iracing.com/referral/3sm")).toBeNull();
    expect(normalizeIracingReferralUrl("https://bad-.iracing.com/referral/3sm")).toBeNull();
  });

  it("saves the referral link separately without creating a payment claim", async () => {
    const onUpdateSettings = vi.fn();
    render(<PaymentReviewSection language="nl" settings={{ ...settings, iracingReferralEnabled: false, iracingReferralUrl: "" }} intents={[]} localReview onUpdateSettings={onUpdateSettings} onResolve={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/^Officiële iRacing-referrallink/), { target: { value: "https://www.iracing.com/referral/?ref=3sm" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "iRacing-referral tonen op de supportpagina" }));
    fireEvent.click(screen.getByRole("button", { name: "Betaalinstellingen opslaan" }));
    await waitFor(() => expect(onUpdateSettings).toHaveBeenCalledWith(expect.objectContaining({
      iracingReferralEnabled: true,
      iracingReferralUrl: "https://www.iracing.com/referral/?ref=3sm",
    })));
  });

  it("creates a pending intent and books gross income plus the actual fee only after confirmation", () => {
    const intent = createPaymentIntent({ requestedAmount: 10, payerName: " Vincent ", showSupporterName: true, showAmount: false }, "intent-a", "2026-08-01T18:42:00.000Z");
    expect(intent).toMatchObject({ payerName: "Vincent", requestedAmount: 10, status: "pending" });
    expect(resolvePaymentIntent(intent!, "confirm", { grossAmount: 10, feeAmount: 0.69 })).toBeNull();
    expect(intent && resolvePaymentIntent(intent, "confirm", { grossAmount: 10, feeAmount: 0.69, resolutionNote: "PayPal-saldo handmatig gecontroleerd", resolvedAt: "2026-08-01T19:00:00.000Z" })).toEqual(expect.objectContaining({
      intent: expect.objectContaining({ status: "confirmed", grossAmount: 10, feeAmount: 0.69, resolutionNote: "PayPal-saldo handmatig gecontroleerd" }),
      ledgerEntries: [
        expect.objectContaining({ id: "paypal-contribution:intent-a", direction: "income", category: "contribution", amount: 10 }),
        expect.objectContaining({ id: "paypal-fee:intent-a", direction: "expense", category: "payment_fee", amount: 0.69 }),
      ],
    }));
    const confirmed = resolvePaymentIntent(intent!, "confirm", { grossAmount: 10, feeAmount: 0.69, resolutionNote: "Gecontroleerd" })!.intent;
    expect(resolvePaymentIntent(confirmed, "confirm", { grossAmount: 10, feeAmount: 0.69, resolutionNote: "Nogmaals" })).toBeNull();
  });

  it("opens PayPal separately and requires an explicit 'Ik heb betaald' action", async () => {
    const onSubmit = vi.fn(() => true);
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<PayPalContributionModal language="nl" settings={settings} localReview canOpenPayPal onAuthenticationRequired={vi.fn()} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText(/^Naam zichtbaar in PayPal/), { target: { value: "Vincent de Vos" } });
    fireEvent.click(screen.getByRole("button", { name: "Ga veilig verder naar PayPal" }));
    expect(open).toHaveBeenCalledWith("https://paypal.me/ExampleAccount/5EUR", "_blank", "noopener,noreferrer");
    expect(onSubmit).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Rond de betaling af in PayPal" })).toHaveFocus());
    expect(screen.getByLabelText("Voortgang PayPal-bijdrage")).toHaveAttribute("aria-live", "polite");

    fireEvent.click(screen.getByRole("button", { name: "Ik heb betaald" }));
    expect(onSubmit).toHaveBeenCalledWith({ requestedAmount: 5, payerName: "Vincent de Vos", showSupporterName: true, showAmount: false });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("geen echte Discord-DM verzonden"));
    open.mockRestore();
  });

  it("never opens PayPal before shared-mode authentication", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const onAuthenticationRequired = vi.fn();
    render(<PayPalContributionModal language="nl" settings={settings} localReview={false} canOpenPayPal={false} onAuthenticationRequired={onAuthenticationRequired} onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/^Naam zichtbaar in PayPal/), { target: { value: "Bezoeker" } });
    fireEvent.click(screen.getByRole("button", { name: "Ga veilig verder naar PayPal" }));
    expect(onAuthenticationRequired).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Rond de betaling af in PayPal" })).not.toBeInTheDocument();
    open.mockRestore();
  });

  it("keeps processing disabled until the payment admin confirms a balance check", () => {
    const onResolve = vi.fn(() => true);
    render(<PaymentReviewSection language="nl" settings={settings} intents={[pendingIntent]} localReview onUpdateSettings={vi.fn()} onResolve={onResolve} />);
    const process = screen.getByRole("button", { name: "Na controle verwerken" });
    expect(process).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /PayPal-saldo gecontroleerd/ }));
    expect(process).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Interne controlenotitie"), { target: { value: "PayPal-saldo handmatig gecontroleerd" } });
    expect(process).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Werkelijke PayPal-kosten"), { target: { value: "0.69" } });
    fireEvent.click(process);
    expect(onResolve).toHaveBeenCalledWith("intent-a", "confirm", 10, 0.69, "PayPal-saldo handmatig gecontroleerd");
  });

  it("keeps shared verification exclusive to the configured payment-admin DM", () => {
    render(<PaymentReviewSection language="nl" settings={settings} intents={[]} localReview={false} onUpdateSettings={vi.fn()} onResolve={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Controle via de privé-DM van de bot" })).toBeInTheDocument();
    expect(screen.getByText(/geen tweede verwerkingspad/)).toBeInTheDocument();
    expect(screen.queryByText("Geen openstaande betaalcontroles.")).not.toBeInTheDocument();
  });

  it("keeps payment tables private and bot confirmation service-role-only", () => {
    const migration = readFileSync("supabase/migrations/20260801180000_community_support_paypal_intents.sql", "utf8");
    expect(migration).toContain("ALTER TABLE public.community_support_payment_intents ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("REVOKE ALL ON public.community_support_payment_intents FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("IF auth.uid() IS NULL THEN\n    RAISE EXCEPTION 'Sign-in required'");
    expect(migration).toContain("IF auth.role() <> 'service_role' THEN");
    expect(migration).toContain("UNIQUE (source_payment_intent_id, category)");
    expect(migration).toContain("FOR UPDATE SKIP LOCKED");
    expect(migration).toContain("notification_claim_token = gen_random_uuid()");
    expect(migration).toContain("notification_claim_token = NULL");
    expect(migration).toContain("payment_config.payment_admin_discord_id");
    expect(migration).toContain("notification_claim_token = p_claim_token");
    expect(migration).toContain("RETURN v_updated = 1");
    expect(migration).toMatch(/SELECT cfg\.payment_admin_discord_id INTO v_expected_admin[\s\S]{0,160}FOR SHARE;/);
    expect(migration).toMatch(/v_previous_admin IS DISTINCT FROM trim\(p_payment_admin_discord_id\)[\s\S]{0,100}THEN NULL/);
    expect(migration).toContain("notification_attempts < 5");
    expect(migration).toContain("discord_notified_at = CASE WHEN p_error IS NULL THEN now() ELSE NULL END");
    expect(migration).toContain("IF v_intent.status = 'confirmed' THEN RETURN 'already_confirmed'");
    expect(migration).toContain("IF v_intent.status = 'not_found' THEN RETURN 'already_not_found'");
    expect(migration).toContain("resolution_note TEXT CHECK");
    expect(migration).toContain("resolution_note = trim(p_resolution_note)");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.get_public_community_support_payment_ledger()");
    expect(migration).toContain("ledger.category = 'contribution' AND ledger.show_amount = false THEN NULL");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.get_public_community_support_payment_totals()");
    expect(migration).toContain("iracing_referral_enabled BOOLEAN NOT NULL DEFAULT false");
    expect(migration).toContain("cfg.iracing_referral_enabled AND cfg.iracing_referral_url <> ''");
    expect(migration).toContain("p_iracing_referral_enabled BOOLEAN");
    const publicPage = readFileSync("src/features/community-support/public/CommunitySupportPage.tsx", "utf8");
    expect(publicPage).toContain("paymentSettings.iracingReferralEnabled && paymentSettings.iracingReferralUrl");
    expect(publicPage).toContain("Gebruik de referrallink");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.get_public_community_support_payment_ledger() TO anon, authenticated");
    expect(migration).not.toContain("GRANT SELECT ON public.community_support_payment_intents TO anon");
  });
});
