import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ExternalLink, Heart, ShieldCheck } from "lucide-react";
import type { CommunitySupportSettings, SupportPaymentIntentDraft } from "../types";
import { buildPayPalMeUrl } from "../paymentFlow";
import PayPalCheckoutButtons from "./PayPalCheckoutButtons";

type Language = "nl" | "en";
type Props = {
  language: Language;
  settings: CommunitySupportSettings;
  localReview: boolean;
  canOpenPayPal: boolean;
  onAuthenticationRequired: () => void;
  onSubmit: (draft: SupportPaymentIntentDraft) => boolean | Promise<boolean>;
  onCheckoutCompleted?: () => void;
};

const copyFor = (language: Language) => language === "en" ? {
  eyebrow: "Voluntary contribution",
  title: "Contribute through PayPal",
  intro: "Choose an amount and your public preferences first. 3SM only books a Checkout contribution after PayPal confirms the capture.",
  introManual: "Choose an amount and your public preferences first. Manual PayPal.Me transfers are booked only after private verification.",
  amount: "Amount",
  customAmount: "Other amount",
  payerName: "Name visible in PayPal",
  payerHelp: "Used privately by the payment admin to match your transfer.",
  payerHelpCheckout: "Used privately to bind this Checkout attempt to your signed-in 3SM account and PayPal confirmation.",
  showName: "Show my name in the season ledger after confirmation",
  showAmount: "Show my amount in the season ledger after confirmation",
  openPayPal: "Continue to secure PayPal Checkout",
  openPayPalManual: "Open PayPal.Me",
  invalid: "Enter an amount from €1 to €1,000 and the name associated with the payment.",
  checkoutTitle: "Pay securely with PayPal",
  checkoutText: "PayPal processes the payment securely. 3SM verifies amount, currency and recipient on the server before booking anything.",
  checkoutCancel: "Change amount or privacy choices",
  waitingTitle: "Complete the payment in PayPal",
  waitingText: "PayPal has opened in another tab or app. Return here after the transfer. Opening PayPal is not treated as a completed payment.",
  paid: "I have paid",
  notPaid: "Payment not completed",
  fallback: "PayPal did not open? Open the secure link",
  doneTitle: "Ready for manual verification",
  doneCheckoutTitle: "Payment confirmed",
  doneLive: "PayPal has confirmed the payment. The contribution and actual transaction fee have been booked automatically.",
  doneManual: "Your payment check was submitted for private manual verification. Nothing is booked until the payment admin confirms it.",
  doneLocal: "The request is stored in this local review. No real Discord DM has been sent.",
  integrity: "A PayPal.Me click is never counted as payment. Only the admin's confirmation updates the ledger.",
  integrityCheckout: "3SM books only a server-verified COMPLETED capture with the expected EUR amount and business recipient.",
  submitError: "The payment check could not be submitted. Sign in and try again, or contact 3SM through Discord.",
  progressLabel: "PayPal contribution progress",
} : {
  eyebrow: "Vrijwillige bijdrage",
  title: "Bijdragen via PayPal",
  intro: "Kies eerst een bedrag en je openbare voorkeuren. 3SM boekt een Checkout-bijdrage pas nadat PayPal de capture heeft bevestigd.",
  introManual: "Kies eerst een bedrag en je openbare voorkeuren. Handmatige PayPal.Me-betalingen worden pas na privécontrole geboekt.",
  amount: "Bedrag",
  customAmount: "Ander bedrag",
  payerName: "Naam zichtbaar in PayPal",
  payerHelp: "Wordt alleen privé gebruikt door de betaaladmin om je betaling te herkennen.",
  payerHelpCheckout: "Wordt alleen privé gebruikt om deze Checkout-poging aan je ingelogde 3SM-account en PayPal-bevestiging te koppelen.",
  showName: "Toon mijn naam na bevestiging in het seizoensboek",
  showAmount: "Toon mijn bedrag na bevestiging in het seizoensboek",
  openPayPal: "Ga naar beveiligde PayPal Checkout",
  openPayPalManual: "Open PayPal.Me",
  invalid: "Vul een bedrag van €1 tot en met €1.000 in en de naam die bij de betaling hoort.",
  checkoutTitle: "Veilig betalen met PayPal",
  checkoutText: "PayPal verwerkt de betaling beveiligd. 3SM controleert bedrag, valuta en ontvanger server-side voordat iets wordt geboekt.",
  checkoutCancel: "Bedrag of privacykeuzes wijzigen",
  waitingTitle: "Rond de betaling af in PayPal",
  waitingText: "PayPal is geopend in een ander tabblad of de app. Kom hier terug na de overboeking. Alleen PayPal openen geldt niet als betaling.",
  paid: "Ik heb betaald",
  notPaid: "Betaling niet afgerond",
  fallback: "PayPal niet geopend? Open de beveiligde link",
  doneTitle: "Klaar voor handmatige controle",
  doneCheckoutTitle: "Betaling bevestigd",
  doneLive: "PayPal heeft de betaling bevestigd. De bijdrage en werkelijke transactiekosten zijn automatisch geboekt.",
  doneManual: "Je betaalcontrole is privé ingediend voor handmatige verificatie. Er wordt niets geboekt totdat de betaaladmin bevestigt.",
  doneLocal: "De aanvraag staat in deze lokale review. Er is geen echte Discord-DM verzonden.",
  integrity: "Een PayPal.Me-klik telt nooit als betaling. Alleen bevestiging door de admin werkt het seizoensboek bij.",
  integrityCheckout: "3SM boekt uitsluitend een server-side geverifieerde COMPLETED-capture met het verwachte EUR-bedrag en de zakelijke ontvanger.",
  submitError: "De betaalcontrole kon niet worden ingediend. Log in en probeer opnieuw, of neem contact op via Discord.",
  progressLabel: "Voortgang PayPal-bijdrage",
};

const inputClass = "mt-2 h-12 w-full rounded-xl border-0 bg-white/[0.055] px-4 text-sm font-bold text-white outline-none ring-1 ring-white/10 placeholder:text-gray-600 focus:ring-2 focus:ring-orange-400";

const PayPalContributionModal = ({ language, settings, localReview, canOpenPayPal, onAuthenticationRequired, onSubmit, onCheckoutCompleted }: Props) => {
  const copy = copyFor(language);
  const [stage, setStage] = useState<"choose" | "paypal" | "checkout" | "done">("choose");
  const [amount, setAmount] = useState(settings.paypalSuggestedAmounts[0] ?? 5);
  const [customAmount, setCustomAmount] = useState("");
  const [payerName, setPayerName] = useState("");
  const [showName, setShowName] = useState(settings.publicSupporterNamesByDefault);
  const [showAmount, setShowAmount] = useState(settings.publicSupporterAmountsByDefault);
  const [checkoutDraft, setCheckoutDraft] = useState<SupportPaymentIntentDraft | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const stageHeadingRef = useRef<HTMLHeadingElement>(null);
  const previousStageRef = useRef(stage);

  const selectedAmount = customAmount.trim() ? Number(customAmount) : amount;
  const checkoutEnabled = !localReview && settings.paypalCheckoutEnabled;
  const paypalUrl = useMemo(() => buildPayPalMeUrl(settings.paypalMeUrl, selectedAmount), [selectedAmount, settings.paypalMeUrl]);
  const validAmount = Number.isFinite(selectedAmount) && selectedAmount >= 1 && selectedAmount <= 1_000 && Math.abs(selectedAmount * 100 - Math.round(selectedAmount * 100)) < 1e-7;
  const valid = Boolean(validAmount && payerName.trim() && (checkoutEnabled || paypalUrl));

  useEffect(() => {
    if (previousStageRef.current !== stage) stageHeadingRef.current?.focus();
    previousStageRef.current = stage;
  }, [stage]);

  const openPayPal = () => {
    setAttempted(true);
    if (!valid) return;
    if (!canOpenPayPal) {
      onAuthenticationRequired();
      return;
    }
    const draft = {
      requestedAmount: selectedAmount,
      payerName: payerName.trim(),
      showSupporterName: showName,
      showAmount,
    };
    if (!checkoutEnabled) {
      if (!paypalUrl) return;
      window.open(paypalUrl, "_blank", "noopener,noreferrer");
      setStage("paypal");
      return;
    }
    setCheckoutDraft(draft);
    setStage("checkout");
  };

  const declarePaid = async () => {
    if (!valid || submitting) return;
    setSubmitting(true);
    setSubmitError(false);
    try {
      const accepted = await onSubmit({
        requestedAmount: selectedAmount,
        payerName: payerName.trim(),
        showSupporterName: showName,
        showAmount,
      });
      if (accepted) setStage("done");
      else setSubmitError(true);
    } catch {
      setSubmitError(true);
    } finally {
      setSubmitting(false);
    }
  };

  const checkoutCompleted = useCallback(() => {
    onCheckoutCompleted?.();
    setStage("done");
  }, [onCheckoutCompleted]);
  const checkoutCancelled = useCallback(() => {
    setCheckoutDraft(null);
    setStage("choose");
  }, []);

  return <div className="min-h-[560px] p-6 sm:p-8">
    <div className="pr-10">
      <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-orange-400"><Heart className="h-4 w-4" aria-hidden="true" />{copy.eyebrow}</div>
      <h2 ref={stageHeadingRef} tabIndex={-1} className="mt-3 font-heading text-2xl font-black uppercase text-white outline-none sm:text-3xl">{stage === "choose" ? copy.title : stage === "paypal" ? copy.waitingTitle : stage === "checkout" ? copy.checkoutTitle : checkoutEnabled ? copy.doneCheckoutTitle : copy.doneTitle}</h2>
    </div>

    <div aria-live="polite" aria-atomic="false" aria-label={copy.progressLabel}>
    {stage === "choose" && <>
      <p className="mt-4 max-w-2xl text-sm leading-6 text-gray-400">{checkoutEnabled ? copy.intro : copy.introManual}</p>
      <fieldset className="mt-7">
        <legend className="text-xs font-black uppercase tracking-wider text-gray-400">{copy.amount}</legend>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {settings.paypalSuggestedAmounts.map((value) => <button key={value} type="button" aria-pressed={!customAmount && amount === value} onClick={() => { setAmount(value); setCustomAmount(""); }} className={`min-h-12 rounded-xl text-sm font-black ring-1 transition ${!customAmount && amount === value ? "bg-orange-500/15 text-orange-200 ring-orange-400/30" : "bg-white/[0.035] text-gray-300 ring-white/10 hover:bg-white/[0.06]"}`}>€{value.toFixed(2).replace(".00", "")}</button>)}
        </div>
        <label className="mt-4 block text-xs font-bold text-gray-400">{copy.customAmount}<input type="number" min="1" max="1000" step="0.01" inputMode="decimal" value={customAmount} onChange={(event) => setCustomAmount(event.target.value)} className={inputClass} /></label>
      </fieldset>
      <label className="mt-5 block text-xs font-bold text-gray-400">{copy.payerName}<input value={payerName} maxLength={100} autoComplete="name" onChange={(event) => setPayerName(event.target.value)} className={inputClass} /><span className="mt-2 block font-normal leading-5 text-gray-500">{checkoutEnabled ? copy.payerHelpCheckout : copy.payerHelp}</span></label>
      <div className="mt-6 space-y-3">
        <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-white/[0.025] p-4 text-sm text-gray-300 ring-1 ring-white/[0.06]"><input type="checkbox" checked={showName} onChange={(event) => setShowName(event.target.checked)} className="mt-0.5 h-4 w-4 accent-orange-500" />{copy.showName}</label>
        <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-white/[0.025] p-4 text-sm text-gray-300 ring-1 ring-white/[0.06]"><input type="checkbox" checked={showAmount} onChange={(event) => setShowAmount(event.target.checked)} className="mt-0.5 h-4 w-4 accent-orange-500" />{copy.showAmount}</label>
      </div>
      {attempted && !valid && <p role="alert" className="mt-4 text-sm font-bold text-rose-300">{copy.invalid}</p>}
      <button type="button" onClick={openPayPal} className="mt-7 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-racing px-5 text-sm font-black text-white shadow-lg shadow-orange-950/30 transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-orange-300 sm:w-auto"><ExternalLink className="h-4 w-4" aria-hidden="true" />{checkoutEnabled ? copy.openPayPal : copy.openPayPalManual}</button>
    </>}

    {stage === "paypal" && <div className="mt-8 rounded-2xl bg-orange-500/[0.07] p-6 ring-1 ring-orange-400/20">
      <ExternalLink className="h-7 w-7 text-orange-300" aria-hidden="true" />
      <p className="mt-3 text-sm leading-6 text-gray-300">{copy.waitingText}</p>
      {paypalUrl && <a href={paypalUrl} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-orange-300 underline decoration-orange-400/40 underline-offset-4">{copy.fallback}<ExternalLink className="h-4 w-4" aria-hidden="true" /></a>}
      <div className="mt-7 flex flex-col gap-3 sm:flex-row">
        <button type="button" disabled={submitting} onClick={() => void declarePaid()} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 text-sm font-black text-black transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />{copy.paid}</button>
        <button type="button" onClick={() => setStage("choose")} className="min-h-12 rounded-xl bg-white/[0.045] px-5 text-sm font-bold text-gray-300 ring-1 ring-white/10 hover:bg-white/[0.08]">{copy.notPaid}</button>
      </div>
      {submitError && <p role="alert" className="mt-4 text-sm font-bold text-rose-300">{copy.submitError}</p>}
    </div>}

    {stage === "checkout" && checkoutDraft && <div className="mt-8 rounded-2xl bg-white/[0.035] p-6 ring-1 ring-white/10">
      <p className="mb-6 text-sm leading-6 text-gray-300">{copy.checkoutText}</p>
      <PayPalCheckoutButtons draft={checkoutDraft} language={language} onCompleted={checkoutCompleted} onCancelled={checkoutCancelled} />
    </div>}

    {stage === "done" && <div role="status" className="mt-8 rounded-2xl bg-emerald-500/[0.07] p-6 ring-1 ring-emerald-400/20">
      <CheckCircle2 className="h-9 w-9 text-emerald-300" aria-hidden="true" />
      <p className="mt-4 text-sm leading-6 text-gray-300">{checkoutEnabled ? copy.doneLive : localReview ? copy.doneLocal : copy.doneManual}</p>
    </div>}
    </div>

    <div className="mt-7 flex items-start gap-3 rounded-xl bg-sky-400/[0.04] p-4 text-xs leading-5 text-gray-400 ring-1 ring-sky-300/10"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" aria-hidden="true" />{checkoutEnabled ? copy.integrityCheckout : copy.integrity}</div>
  </div>;
};

export default PayPalContributionModal;
