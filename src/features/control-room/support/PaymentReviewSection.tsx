import { FormEvent, useEffect, useMemo, useState } from "react";
import { CheckCircle2, CircleDollarSign, MessageCircle, ShieldCheck, XCircle } from "lucide-react";
import type { CommunitySupportSettings, SupportPaymentIntent } from "@/features/community-support/types";
import { normalizeDiscordUserId, normalizePayPalAmounts, normalizePayPalMeUrl } from "@/features/community-support/paymentFlow";

type Language = "nl" | "en";
type Props = {
  language: Language;
  settings: CommunitySupportSettings;
  intents: SupportPaymentIntent[];
  localReview: boolean;
  onUpdateSettings: (settings: Partial<CommunitySupportSettings>) => void | Promise<void>;
  onResolve: (id: string, action: "confirm" | "not_found", grossAmount?: number, feeAmount?: number, resolutionNote?: string) => boolean;
};

const card = "rounded-[1.65rem] bg-card/65 shadow-2xl shadow-black/20 ring-1 ring-white/[0.065]";
const input = "mt-2 w-full rounded-xl bg-black/25 px-3.5 py-3 text-sm text-white outline-none ring-1 ring-white/10 transition placeholder:text-gray-600 focus:ring-2 focus:ring-orange-500/55";
const label = "text-xs font-bold uppercase tracking-[0.14em] text-gray-400";
const formatMoney = (value: number, language: Language) => new Intl.NumberFormat(language === "en" ? "en-GB" : "nl-NL", { style: "currency", currency: "EUR" }).format(value);

const PaymentIntentCard = ({ language, intent, onResolve }: { language: Language; intent: SupportPaymentIntent; onResolve: Props["onResolve"] }) => {
  const [grossAmount, setGrossAmount] = useState(String(intent.requestedAmount));
  const [feeAmount, setFeeAmount] = useState("0");
  const [resolutionNote, setResolutionNote] = useState("");
  const [checked, setChecked] = useState(false);
  const gross = Number(grossAmount.replace(",", "."));
  const fee = Number(feeAmount.replace(",", "."));
  const valid = Number.isFinite(gross) && gross > 0 && Number.isFinite(fee) && fee >= 0 && fee < gross;
  const validNote = resolutionNote.trim().length > 0 && resolutionNote.trim().length <= 500;

  return <article className="rounded-2xl bg-black/15 p-5 ring-1 ring-white/[0.055]">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div><p className="font-heading text-lg font-black text-white">{intent.payerName}</p><p className="mt-1 text-xs text-gray-500">{new Date(intent.createdAt).toLocaleString(language === "en" ? "en-GB" : "nl-NL")} · {language === "en" ? "claimed" : "opgegeven"} {formatMoney(intent.requestedAmount, language)}</p></div>
      <span className="self-start rounded-full bg-amber-400/10 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-amber-200 ring-1 ring-amber-300/20">{language === "en" ? "Awaiting check" : "Wacht op controle"}</span>
    </div>
    <dl className="mt-4 grid gap-2 rounded-xl bg-white/[0.025] p-4 text-xs sm:grid-cols-2">
      <div className="flex justify-between gap-3"><dt className="text-gray-500">{language === "en" ? "Public name" : "Naam openbaar"}</dt><dd className="font-bold text-gray-200">{intent.showSupporterName ? (language === "en" ? "Yes" : "Ja") : (language === "en" ? "No" : "Nee")}</dd></div>
      <div className="flex justify-between gap-3"><dt className="text-gray-500">{language === "en" ? "Public amount" : "Bedrag openbaar"}</dt><dd className="font-bold text-gray-200">{intent.showAmount ? (language === "en" ? "Yes" : "Ja") : (language === "en" ? "No" : "Nee")}</dd></div>
    </dl>
    <div className="mt-5 grid gap-4 sm:grid-cols-2">
      <label className={label}>{language === "en" ? "Actually received gross" : "Werkelijk bruto ontvangen"}<input type="number" min="0.01" max="1000" step="0.01" value={grossAmount} onChange={(event) => setGrossAmount(event.target.value)} className={input} /></label>
      <label className={label}>{language === "en" ? "Actual PayPal fee" : "Werkelijke PayPal-kosten"}<input type="number" min="0" step="0.01" value={feeAmount} onChange={(event) => setFeeAmount(event.target.value)} className={input} /></label>
    </div>
    <label className={`${label} mt-4 block`}>{language === "en" ? "Internal verification note" : "Interne controlenotitie"}<textarea required maxLength={500} value={resolutionNote} onChange={(event) => setResolutionNote(event.target.value)} className={`${input} min-h-24 resize-y`} /></label>
    <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl bg-sky-400/[0.04] p-4 text-sm text-gray-300 ring-1 ring-sky-300/10"><input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} className="mt-0.5 h-4 w-4 accent-orange-500" />{language === "en" ? "I checked the PayPal balance and matched this transfer." : "Ik heb het PayPal-saldo gecontroleerd en deze overboeking gevonden."}</label>
    <div className="mt-5 flex flex-col gap-3 sm:flex-row">
      <button type="button" disabled={!checked || !valid || !validNote} onClick={() => onResolve(intent.id, "confirm", gross, fee, resolutionNote.trim())} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 text-sm font-black text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"><CheckCircle2 className="h-4 w-4" />{language === "en" ? "Process after check" : "Na controle verwerken"}</button>
      <button type="button" disabled={!validNote} onClick={() => onResolve(intent.id, "not_found", undefined, undefined, resolutionNote.trim())} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white/[0.04] px-4 text-sm font-bold text-gray-300 ring-1 ring-white/10 hover:bg-rose-500/10 hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-40"><XCircle className="h-4 w-4" />{language === "en" ? "Not received" : "Niet ontvangen"}</button>
    </div>
  </article>;
};

const PaymentReviewSection = ({ language, settings, intents, localReview, onUpdateSettings, onResolve }: Props) => {
  const [draftUrl, setDraftUrl] = useState(settings.paypalMeUrl);
  const [draftAdminId, setDraftAdminId] = useState(settings.paymentAdminDiscordId);
  const [draftAmounts, setDraftAmounts] = useState(settings.paypalSuggestedAmounts.join(", "));
  const [draftEnabled, setDraftEnabled] = useState(settings.paypalEnabled);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    setDraftUrl(settings.paypalMeUrl);
    setDraftAdminId(settings.paymentAdminDiscordId);
    setDraftAmounts(settings.paypalSuggestedAmounts.join(", "));
    setDraftEnabled(settings.paypalEnabled);
  }, [settings]);

  const normalizedUrl = normalizePayPalMeUrl(draftUrl);
  const normalizedAdminId = normalizeDiscordUserId(draftAdminId);
  const normalizedAmounts = useMemo(() => normalizePayPalAmounts(draftAmounts.split(/[;,\s]+/).filter(Boolean).map((value) => Number(value.replace(",", ".")))), [draftAmounts]);
  const configurationValid = Boolean(normalizedUrl && normalizedAdminId && normalizedAmounts.length > 0);
  const pending = intents.filter((intent) => intent.status === "pending");
  const handled = intents.filter((intent) => intent.status !== "pending");

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!configurationValid) return;
    setSaveError(false);
    try {
      await onUpdateSettings({
        paypalMeUrl: normalizedUrl ?? "",
        paymentAdminDiscordId: normalizedAdminId ?? "",
        paypalSuggestedAmounts: normalizedAmounts,
        paypalEnabled: draftEnabled,
      });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch {
      setSaveError(true);
    }
  };

  return <section id="panel-payments" role="tabpanel" className="space-y-6">
    <div><div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-orange-400"><CircleDollarSign className="h-4 w-4" />Community Support</div><h2 className="mt-2 font-heading text-2xl font-black text-white">{language === "en" ? "PayPal verification" : "PayPal-controle"}</h2><p className="mt-2 max-w-3xl text-sm leading-relaxed text-gray-400">{language === "en" ? "Configure the public PayPal.Me flow and review payment claims. Opening PayPal is never treated as proof of payment." : "Configureer de openbare PayPal.Me-flow en controleer betaalclaims. Alleen PayPal openen geldt nooit als betalingsbewijs."}</p></div>

    <form onSubmit={(event) => void save(event)} className={`${card} space-y-6 p-6 md:p-8`}>
      <div className="flex items-start gap-4"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-500/10 text-orange-300"><MessageCircle className="h-5 w-5" /></div><div><h3 className="font-heading text-lg font-black">{language === "en" ? "Payment destination and private admin" : "Betaalbestemming en privé-admin"}</h3><p className="mt-1 text-sm leading-6 text-gray-500">{language === "en" ? "The Discord ID identifies the single payment admin who will later receive the private bot DM." : "Het Discord-ID bepaalt welke ene betaaladmin later de privé-DM van de bot ontvangt."}</p></div></div>
      <div className="grid gap-5 md:grid-cols-2">
        <label className={label}>PayPal.Me-link<input type="url" required placeholder="https://paypal.me/JouwAccount" value={draftUrl} onChange={(event) => setDraftUrl(event.target.value)} className={input} />{draftUrl && !normalizedUrl && <span role="alert" className="mt-2 block text-xs font-bold text-rose-300">{language === "en" ? "Use a base link on https://paypal.me without an amount or query string." : "Gebruik een basislink op https://paypal.me zonder bedrag of querystring."}</span>}</label>
        <label className={label}>{language === "en" ? "Payment admin Discord user ID" : "Discord-user-ID betaaladmin"}<input inputMode="numeric" required maxLength={20} placeholder="123456789012345678" value={draftAdminId} onChange={(event) => setDraftAdminId(event.target.value)} className={input} />{draftAdminId && !normalizedAdminId && <span role="alert" className="mt-2 block text-xs font-bold text-rose-300">{language === "en" ? "Enter a valid 17–20 digit Discord user ID." : "Vul een geldig Discord-user-ID van 17–20 cijfers in."}</span>}</label>
      </div>
      <label className={`${label} block max-w-2xl`}>{language === "en" ? "Suggested amounts in EUR" : "Voorgestelde bedragen in EUR"}<input required value={draftAmounts} onChange={(event) => setDraftAmounts(event.target.value)} placeholder="5, 10, 25" className={input} /><span className="mt-2 block text-xs font-normal normal-case leading-5 tracking-normal text-gray-500">{language === "en" ? "One to six amounts between €1 and €1,000." : "Eén tot zes bedragen tussen €1 en €1.000."}</span></label>
      <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl bg-white/[0.025] px-4 py-3 ring-1 ring-white/[0.07]"><span className="text-sm font-semibold text-gray-200">{language === "en" ? "Enable PayPal.Me on the support page" : "PayPal.Me inschakelen op de supportpagina"}</span><input type="checkbox" checked={draftEnabled} onChange={(event) => setDraftEnabled(event.target.checked)} className="h-5 w-5 accent-orange-500" /></label>
      <div className="flex flex-wrap items-center gap-3"><button type="submit" disabled={!configurationValid} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-gradient-racing px-5 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40"><ShieldCheck className="h-4 w-4" />{saved ? (language === "en" ? "Saved" : "Opgeslagen") : (language === "en" ? "Save payment settings" : "Betaalinstellingen opslaan")}</button><span className="rounded-full bg-sky-400/[0.06] px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-sky-200 ring-1 ring-sky-300/15">{localReview ? (language === "en" ? "Local review · no real DM" : "Lokale review · geen echte DM") : (language === "en" ? "Shared backend · private bot DM" : "Gedeelde backend · privé bot-DM")}</span></div>
      {saveError && <p role="alert" className="text-sm font-bold text-rose-300">{language === "en" ? "The payment settings could not be saved." : "De betaalinstellingen konden niet worden opgeslagen."}</p>}
    </form>

    {localReview ? <>
      <div className="space-y-4">
        <div className="flex items-end justify-between gap-4"><div><h3 className="font-heading text-xl font-black text-white">{language === "en" ? "Awaiting verification" : "Wacht op verificatie"}</h3><p className="mt-1 text-sm text-gray-500">{language === "en" ? "Local review queue; no real bot message is sent." : "Lokale reviewqueue; er wordt geen echt botbericht verzonden."}</p></div><span className="rounded-full bg-amber-400/10 px-3 py-1 text-xs font-black text-amber-200">{pending.length}</span></div>
        {pending.length === 0 ? <div className="rounded-2xl bg-black/10 p-7 text-center text-sm text-gray-500 ring-1 ring-white/[0.05]">{language === "en" ? "No open payment checks." : "Geen openstaande betaalcontroles."}</div> : <div className="grid gap-4">{pending.map((intent) => <PaymentIntentCard key={intent.id} language={language} intent={intent} onResolve={onResolve} />)}</div>}
      </div>

      {handled.length > 0 && <details className={`${card} p-5 md:p-6`}><summary className="cursor-pointer font-heading font-black text-gray-200">{language === "en" ? `Handled history (${handled.length})` : `Afgehandelde historie (${handled.length})`}</summary><div className="mt-4 space-y-2">{handled.map((intent) => <div key={intent.id} className="flex flex-col gap-2 rounded-xl bg-black/15 p-4 text-sm ring-1 ring-white/[0.05] sm:flex-row sm:items-center sm:justify-between"><div><p className="font-bold text-gray-200">{intent.payerName}</p><p className="mt-1 text-xs text-gray-500">{formatMoney(intent.requestedAmount, language)} · {intent.status === "confirmed" ? (language === "en" ? "processed" : "verwerkt") : (language === "en" ? "not received" : "niet ontvangen")}</p></div>{intent.status === "confirmed" && <p className="text-xs font-bold text-emerald-300">{formatMoney(intent.grossAmount ?? 0, language)} − {formatMoney(intent.feeAmount ?? 0, language)}</p>}</div>)}</div></details>}
    </> : <div className={`${card} p-6 md:p-7`}>
      <h3 className="font-heading text-xl font-black text-white">{language === "en" ? "Verification through the private bot DM" : "Controle via de privé-DM van de bot"}</h3>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-400">{language === "en" ? "Open claims and their private payer details are delivered only to the configured payment admin. Confirm or reject them in that DM after checking PayPal; this page deliberately does not create a second processing path for other website admins." : "Openstaande claims en hun privé-betaalgegevens worden uitsluitend naar de ingestelde betaaladmin gestuurd. Bevestig of wijs ze in die DM af na controle in PayPal; deze pagina maakt bewust geen tweede verwerkingspad voor andere website-admins."}</p>
    </div>}
  </section>;
};

export default PaymentReviewSection;
