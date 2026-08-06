import { useCallback, useEffect, useRef, useState } from "react";
import { cancelPayPalMerchOrder, capturePayPalMerchOrder, createPayPalMerchOrder, fetchPayPalCheckoutConfig, recoverPayPalMerchOrder } from "../paymentApi";
import type { SupportProduct } from "../types";
import { loadPayPalSdk, type PayPalButtonsInstance } from "./paypalSdk";

type Props = {
  product: SupportProduct;
  language: "nl" | "en";
  onCompleted: () => void;
  onCancelled: () => void;
};

const MerchandiseCheckout = ({ product, language, onCompleted, onCancelled }: Props) => {
  const targetRef = useRef<HTMLDivElement>(null);
  const merchOrderIdRef = useRef("");
  const paypalOrderIdRef = useRef("");
  const completedRef = useRef(false);
  const lifecycleRef = useRef(0);
  const onCompletedRef = useRef(onCompleted);
  const onCancelledRef = useRef(onCancelled);
  const languageRef = useRef(language);
  onCompletedRef.current = onCompleted;
  onCancelledRef.current = onCancelled;
  languageRef.current = language;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [checking, setChecking] = useState(false);

  const capture = useCallback(async (expectedLifecycle = lifecycleRef.current) => {
    if (expectedLifecycle !== lifecycleRef.current) return;
    const orderId = merchOrderIdRef.current;
    const lifecycle = lifecycleRef.current;
    if (!orderId) throw new Error("Merchandise order missing");
    setChecking(true);
    setError("");
    try {
      await capturePayPalMerchOrder(orderId);
      if (lifecycle !== lifecycleRef.current || merchOrderIdRef.current !== orderId) return;
      completedRef.current = true;
      onCompletedRef.current();
    } catch {
      if (lifecycle !== lifecycleRef.current || merchOrderIdRef.current !== orderId) return;
      setUncertain(true);
      setError(languageRef.current === "en"
        ? "The payment result is uncertain. Check the same order again; this never creates a second charge."
        : "De betaalstatus is onzeker. Controleer dezelfde bestelling opnieuw; dit maakt nooit een tweede afschrijving.");
      throw new Error("Merchandise capture uncertain");
    } finally {
      if (lifecycle === lifecycleRef.current && merchOrderIdRef.current === orderId) setChecking(false);
    }
  }, []);

  const cancel = useCallback(async (expectedLifecycle = lifecycleRef.current) => {
    if (expectedLifecycle !== lifecycleRef.current) return;
    const orderId = merchOrderIdRef.current;
    const lifecycle = lifecycleRef.current;
    try {
      if (orderId && !completedRef.current) await cancelPayPalMerchOrder(orderId);
      if (lifecycle !== lifecycleRef.current || merchOrderIdRef.current !== orderId) return;
      merchOrderIdRef.current = "";
      paypalOrderIdRef.current = "";
      onCancelledRef.current();
    } catch {
      if (lifecycle !== lifecycleRef.current || merchOrderIdRef.current !== orderId) return;
      setError(languageRef.current === "en" ? "This order can no longer be cancelled safely. Check its payment status." : "Deze bestelling kan niet meer veilig worden geannuleerd. Controleer de betaalstatus.");
      setUncertain(true);
    }
  }, []);

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;
    let active = true;
    const lifecycle = ++lifecycleRef.current;
    merchOrderIdRef.current = "";
    paypalOrderIdRef.current = "";
    completedRef.current = false;
    const isActive = () => active && lifecycleRef.current === lifecycle;
    let buttons: PayPalButtonsInstance | null = null;
    const mount = async () => {
      try {
        const recovered = await recoverPayPalMerchOrder(product.id);
        if (!isActive()) return;
        if (recovered.result === "confirmed" || recovered.result === "already_confirmed") {
          completedRef.current = true;
          onCompletedRef.current();
          return;
        }
        if (recovered.result === "pending") {
          merchOrderIdRef.current = recovered.merchOrderId;
          paypalOrderIdRef.current = recovered.orderId;
        }
        const config = await fetchPayPalCheckoutConfig();
        const paypal = await loadPayPalSdk(config.clientId);
        if (!isActive()) return;
        buttons = paypal.Buttons({
          createOrder: async () => {
            if (!isActive()) throw new Error("Merchandise checkout is no longer active");
            if (paypalOrderIdRef.current) return paypalOrderIdRef.current;
            const created = await createPayPalMerchOrder(product.id);
            if (!isActive()) return created.orderId;
            merchOrderIdRef.current = created.merchOrderId;
            paypalOrderIdRef.current = created.orderId;
            return created.orderId;
          },
          onApprove: () => capture(lifecycle),
          onCancel: () => { void cancel(lifecycle); },
          onError: () => {
            if (!isActive()) return;
            setUncertain(true);
            setError(languageRef.current === "en" ? "PayPal Checkout stopped unexpectedly. Check this same order before trying again." : "PayPal Checkout stopte onverwacht. Controleer dezelfde bestelling voordat je opnieuw probeert.");
          },
        });
        await buttons.render(target);
      } catch {
        if (isActive()) setError(languageRef.current === "en" ? "PayPal Checkout is temporarily unavailable." : "PayPal Checkout is tijdelijk niet beschikbaar.");
      } finally {
        if (isActive()) setLoading(false);
      }
    };
    void mount();
    return () => {
      active = false;
      if (lifecycleRef.current === lifecycle) lifecycleRef.current += 1;
      const orderId = merchOrderIdRef.current;
      if (orderId && !completedRef.current) void cancelPayPalMerchOrder(orderId).catch(() => undefined);
      void buttons?.close?.();
      target.replaceChildren();
    };
  }, [cancel, capture, product.id]);

  return <div>
    <div className="mb-5 rounded-2xl bg-black/20 p-4 ring-1 ring-white/[0.07]">
      <p className="font-heading text-xl font-black text-white">{product.name}</p>
      <p className="mt-1 text-sm text-gray-400">{product.fulfillmentMode === "physical" ? (language === "en" ? "Quantity: 1 · Shipping address is taken securely from PayPal." : "Aantal: 1 · Het verzendadres wordt veilig uit PayPal overgenomen.") : (language === "en" ? "Quantity: 1 · Digital delivery uses your PayPal email address." : "Aantal: 1 · Digitale levering gebruikt je PayPal-e-mailadres.")}</p>
      <p className="mt-3 font-heading text-2xl font-black text-orange-300">{new Intl.NumberFormat(language === "en" ? "en-IE" : "nl-NL", { style: "currency", currency: "EUR" }).format(product.price)}</p>
    </div>
    {loading && <p role="status" className="text-sm font-bold text-gray-400">{language === "en" ? "Loading secure PayPal Checkout…" : "Beveiligde PayPal Checkout laden…"}</p>}
    <div ref={targetRef} className={loading ? "hidden" : "min-h-12"} />
    {error && <p role="alert" className="mt-4 text-sm font-bold text-rose-300">{error}</p>}
    {uncertain && <button type="button" disabled={checking} onClick={() => void capture().catch(() => undefined)} className="mt-4 min-h-11 w-full rounded-xl bg-amber-400/10 px-5 text-sm font-black text-amber-200 ring-1 ring-amber-300/25 disabled:opacity-60">{checking ? (language === "en" ? "Checking…" : "Controleren…") : (language === "en" ? "Check payment again" : "Controleer betaling opnieuw")}</button>}
    {!uncertain && <button type="button" onClick={() => void cancel()} className="mt-4 min-h-11 w-full rounded-xl bg-white/[0.045] px-5 text-sm font-bold text-gray-300 ring-1 ring-white/10">{language === "en" ? "Cancel order" : "Bestelling annuleren"}</button>}
  </div>;
};

export default MerchandiseCheckout;
