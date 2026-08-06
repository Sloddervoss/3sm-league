import { useCallback, useEffect, useRef, useState } from "react";
import type { SupportPaymentIntentDraft } from "../types";
import { loadPayPalSdk, type PayPalButtonsInstance } from "./paypalSdk";
import {
  cancelPayPalCheckoutIntent,
  capturePayPalCheckoutOrder,
  createPayPalCheckoutOrder,
  fetchPayPalCheckoutRecoveryIntent,
  fetchPayPalCheckoutConfig,
  submitPayPalCheckoutIntent,
  type PayPalCaptureResult,
  type PayPalCheckoutConfig,
  type PayPalCheckoutRecoveryIntent,
} from "../paymentApi";

type Props = {
  draft: SupportPaymentIntentDraft;
  language: "nl" | "en";
  onCompleted: (result: PayPalCaptureResult) => void;
  onCancelled: () => void;
  getConfig?: () => Promise<PayPalCheckoutConfig>;
  createIntent?: (draft: SupportPaymentIntentDraft) => Promise<string>;
  createOrder?: (intentId: string) => Promise<string>;
  captureOrder?: (intentId: string) => Promise<PayPalCaptureResult>;
  cancelIntent?: (intentId: string) => Promise<void>;
  recoverIntent?: () => Promise<PayPalCheckoutRecoveryIntent | null>;
};

const PayPalCheckoutButtons = ({
  draft,
  language,
  onCompleted,
  onCancelled,
  getConfig = fetchPayPalCheckoutConfig,
  createIntent = submitPayPalCheckoutIntent,
  createOrder = createPayPalCheckoutOrder,
  captureOrder = capturePayPalCheckoutOrder,
  cancelIntent = cancelPayPalCheckoutIntent,
  recoverIntent = fetchPayPalCheckoutRecoveryIntent,
}: Props) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const intentIdRef = useRef("");
  const recoveringRef = useRef(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [captureUncertain, setCaptureUncertain] = useState(false);
  const [recovering, setRecovering] = useState(false);

  const reconcileCapture = useCallback(async () => {
    if (!intentIdRef.current || recoveringRef.current) return;
    recoveringRef.current = true;
    setRecovering(true);
    setError("");
    try {
      onCompleted(await captureOrder(intentIdRef.current));
    } catch {
      setCaptureUncertain(true);
      setError(language === "en"
        ? "PayPal confirmation is uncertain. Use ‘Check payment again’; 3SM will never charge again during this check."
        : "De PayPal-bevestiging is onzeker. Kies ‘Controleer betaling opnieuw’; 3SM schrijft tijdens die controle nooit opnieuw af.");
    } finally {
      recoveringRef.current = false;
      setRecovering(false);
    }
  }, [captureOrder, language, onCompleted]);

  const cancelFlow = useCallback(async () => {
    try {
      if (intentIdRef.current) await cancelIntent(intentIdRef.current);
      intentIdRef.current = "";
      setCaptureUncertain(false);
      onCancelled();
    } catch {
      setError(language === "en"
        ? "The Checkout attempt could not be cancelled safely. Try again or check the payment first."
        : "De Checkout-poging kon niet veilig worden geannuleerd. Probeer opnieuw of controleer eerst de betaling.");
    }
  }, [cancelIntent, language, onCancelled]);

  useEffect(() => {
    let active = true;
    let buttons: PayPalButtonsInstance | null = null;
    const container = containerRef.current;
    if (!container) return;
    const mount = async () => {
      try {
        const recoveredIntent = await recoverIntent();
        if (!active) return;
        if (recoveredIntent?.status === "approved") {
          intentIdRef.current = recoveredIntent.intentId;
          setCaptureUncertain(true);
          setError(language === "en"
            ? "An earlier PayPal confirmation still needs checking. Use ‘Check payment again’; this check never charges again."
            : "Een eerdere PayPal-bevestiging moet nog worden gecontroleerd. Kies ‘Controleer betaling opnieuw’; deze controle schrijft nooit opnieuw af.");
          return;
        }
        if (recoveredIntent?.status === "pending") {
          // A parent-modal close cannot reliably finish async cleanup. Expire
          // the orphaned draft on the next open before creating another one.
          intentIdRef.current = recoveredIntent.intentId;
          try {
            await cancelIntent(recoveredIntent.intentId);
            intentIdRef.current = "";
          } catch {
            const racedIntent = await recoverIntent();
            if (!active) return;
            if (racedIntent?.status === "approved") {
              intentIdRef.current = racedIntent.intentId;
              setCaptureUncertain(true);
              setError(language === "en"
                ? "An earlier PayPal confirmation still needs checking. Use ‘Check payment again’; this check never charges again."
                : "Een eerdere PayPal-bevestiging moet nog worden gecontroleerd. Kies ‘Controleer betaling opnieuw’; deze controle schrijft nooit opnieuw af.");
              return;
            }
            throw new Error("Pending PayPal Checkout intent could not be cleared");
          }
        }
        const config = await getConfig();
        if (config.currency !== "EUR") throw new Error("PayPal Checkout currency mismatch");
        const paypal = await loadPayPalSdk(config.clientId);
        if (!active) return;
        buttons = paypal.Buttons({
          createOrder: async () => {
            if (!intentIdRef.current) {
              intentIdRef.current = await createIntent(draft);
            }
            return createOrder(intentIdRef.current);
          },
          onApprove: reconcileCapture,
          onCancel: () => { void cancelFlow(); },
          onError: () => {
            console.error("PayPal Checkout failed");
            if (active) setError(language === "en" ? "PayPal Checkout failed. No contribution was booked." : "PayPal Checkout is mislukt. Er is geen bijdrage geboekt.");
          },
        });
        await buttons.render(container);
      } catch {
        console.error("PayPal Checkout initialization failed");
        if (active) setError(language === "en" ? "PayPal Checkout is temporarily unavailable." : "PayPal Checkout is tijdelijk niet beschikbaar.");
      } finally {
        if (active) setLoading(false);
      }
    };
    void mount();
    return () => {
      active = false;
      void buttons?.close?.();
      container.replaceChildren();
    };
  }, [cancelFlow, cancelIntent, createIntent, createOrder, draft, getConfig, language, reconcileCapture, recoverIntent]);

  return <div>
    {loading && <p role="status" className="text-sm font-bold text-gray-400">{language === "en" ? "Loading secure PayPal Checkout…" : "Beveiligde PayPal Checkout laden…"}</p>}
    <div ref={containerRef} className={loading ? "hidden" : "min-h-12"} />
    {error && <p role="alert" className="mt-4 text-sm font-bold text-rose-300">{error}</p>}
    {error && captureUncertain && <button type="button" disabled={recovering} onClick={() => void reconcileCapture()} className="mt-4 min-h-11 w-full rounded-xl bg-amber-400/10 px-5 text-sm font-black text-amber-200 ring-1 ring-amber-300/25 hover:bg-amber-400/15 disabled:cursor-wait disabled:opacity-60">{recovering ? (language === "en" ? "Checking…" : "Controleren…") : (language === "en" ? "Check payment again" : "Controleer betaling opnieuw")}</button>}
    {!captureUncertain && <button type="button" disabled={recovering} onClick={() => void cancelFlow()} className="mt-4 min-h-11 w-full rounded-xl bg-white/[0.045] px-5 text-sm font-bold text-gray-300 ring-1 ring-white/10 hover:bg-white/[0.08] disabled:cursor-wait disabled:opacity-60">{language === "en" ? "Change amount or privacy choices" : "Bedrag of privacykeuzes wijzigen"}</button>}
  </div>;
};

export default PayPalCheckoutButtons;
