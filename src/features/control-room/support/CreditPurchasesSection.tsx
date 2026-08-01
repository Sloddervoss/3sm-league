import { FormEvent, useMemo, useState } from "react";
import { Banknote, Check, CircleAlert, Coins, ReceiptText, Trash2 } from "lucide-react";
import type { SupportCreditPurchase, SupportRaceCost } from "@/features/community-support/types";
import type { SupportCreditPurchaseDraft } from "@/features/community-support/store";

type Language = "nl" | "en";

type Props = {
  language: Language;
  selectedYear: string;
  purchases: SupportCreditPurchase[];
  raceCosts: SupportRaceCost[];
  onAdd: (draft: SupportCreditPurchaseDraft) => void;
  onRemove: (id: string) => void;
};

const COPY = {
  nl: {
    title: "iRacing Credits",
    help: "Boek hier de echte aankoop van iRacing Credits. Het betaalde eurobedrag is de financiële uitgave; races verbruiken daarna USD-credits en worden niet nogmaals als uitgave geboekt.",
    date: "Aankoopdatum",
    description: "Omschrijving",
    credits: "Gekochte USD-credits",
    paid: "Werkelijk betaald in EUR",
    note: "Interne notitie (optioneel)",
    public: "Aankoop openbaar in het seizoensboek",
    save: "Credit-aankoop opslaan",
    saved: "Credit-aankoop lokaal opgeslagen",
    purchased: "Credits gekocht",
    consumed: "Door races verbruikt",
    balance: "Geregistreerde balans",
    expenses: "Werkelijke EUR-uitgave",
    noPurchases: "Nog geen Credit-aankopen in dit seizoen.",
    remove: "Verwijderen",
    confirmRemove: "Deze lokale Credit-aankoop verwijderen?",
    cancel: "Annuleren",
    confirm: "Ja, verwijderen",
    missing: "Er zijn meer racecredits geregistreerd als verbruikt dan lokaal als gekocht. Voeg eerdere Credit-aankopen toe om de balans compleet te maken.",
    effectiveRate: "Effectieve kostprijs",
  },
  en: {
    title: "iRacing Credits",
    help: "Record the actual iRacing Credits purchase here. The euro amount paid is the financial expense; races then consume USD credits and are not booked as a second expense.",
    date: "Purchase date",
    description: "Description",
    credits: "USD credits purchased",
    paid: "Actually paid in EUR",
    note: "Internal note (optional)",
    public: "Show purchase in the season ledger",
    save: "Save credit purchase",
    saved: "Credit purchase saved locally",
    purchased: "Credits purchased",
    consumed: "Consumed by races",
    balance: "Recorded balance",
    expenses: "Actual EUR expense",
    noPurchases: "No Credit purchases in this season yet.",
    remove: "Delete",
    confirmRemove: "Delete this local Credit purchase?",
    cancel: "Cancel",
    confirm: "Yes, delete",
    missing: "More race credits are recorded as consumed than locally purchased. Add earlier Credit purchases to complete the balance.",
    effectiveRate: "Effective cost",
  },
} as const;

const card = "rounded-[1.65rem] bg-card/65 shadow-2xl shadow-black/20 ring-1 ring-white/[0.065]";
const input = "mt-2 w-full rounded-xl bg-black/25 px-3.5 py-3 text-sm text-white outline-none ring-1 ring-white/10 transition placeholder:text-gray-600 focus:ring-2 focus:ring-orange-500/55";
const label = "text-xs font-bold uppercase tracking-[0.14em] text-gray-400";
const eur = (value: number, language: Language) => new Intl.NumberFormat(language === "en" ? "en-GB" : "nl-NL", { style: "currency", currency: "EUR" }).format(value);
const usd = (value: number, language: Language) => new Intl.NumberFormat(language === "en" ? "en-US" : "nl-NL", { style: "currency", currency: "USD" }).format(value);
const today = () => new Date().toISOString().slice(0, 10);
const defaultDateForYear = (selectedYear: string) => {
  const current = today();
  return current.startsWith(selectedYear) ? current : `${selectedYear}-01-01`;
};

const CreditPurchasesSection = ({ language, selectedYear, purchases, raceCosts, onAdd, onRemove }: Props) => {
  const t = COPY[language];
  const [saved, setSaved] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const yearPurchases = useMemo(() => purchases.filter((purchase) => purchase.date.startsWith(selectedYear)).sort((a, b) => b.date.localeCompare(a.date)), [purchases, selectedYear]);
  const purchasedUsd = yearPurchases.reduce((sum, purchase) => sum + purchase.creditsUsd, 0);
  const paidEur = yearPurchases.reduce((sum, purchase) => sum + purchase.amountEur, 0);
  const consumedUsd = raceCosts.filter((cost) => cost.date.startsWith(selectedYear)).reduce((sum, cost) => sum + cost.creditCostUsd, 0);
  const cumulativePurchasedUsd = purchases.filter((purchase) => purchase.date.slice(0, 4) <= selectedYear).reduce((sum, purchase) => sum + purchase.creditsUsd, 0);
  const cumulativeConsumedUsd = raceCosts.filter((cost) => cost.date.slice(0, 4) <= selectedYear).reduce((sum, cost) => sum + cost.creditCostUsd, 0);
  const balanceUsd = Math.round((cumulativePurchasedUsd - cumulativeConsumedUsd + Number.EPSILON) * 100) / 100;
  const defaultPurchaseDate = defaultDateForYear(selectedYear);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const creditsUsd = Number(data.get("creditsUsd"));
    const amountEur = Number(data.get("amountEur"));
    if (!Number.isFinite(creditsUsd) || creditsUsd <= 0 || !Number.isFinite(amountEur) || amountEur <= 0) return;
    onAdd({
      date: String(data.get("date")),
      description: String(data.get("description")).trim(),
      creditsUsd,
      amountEur,
      isPublic: data.get("isPublic") === "on",
      note: String(data.get("note") || "").trim() || undefined,
    });
    form.reset();
    const dateInput = form.elements.namedItem("date") as HTMLInputElement | null;
    const descriptionInput = form.elements.namedItem("description") as HTMLInputElement | null;
    if (dateInput) dateInput.value = defaultPurchaseDate;
    if (descriptionInput) descriptionInput.value = "iRacing Credits";
    setSaved(true);
  };

  return <section aria-labelledby="credit-purchases-title" className="space-y-5">
    <div><h2 id="credit-purchases-title" className="font-heading text-2xl font-black text-white">{t.title}</h2><p className="mt-2 max-w-3xl text-sm leading-relaxed text-gray-400">{t.help}</p></div>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[
        [t.purchased, usd(purchasedUsd, language), <Coins className="h-4 w-4" key="coins" />],
        [t.consumed, usd(consumedUsd, language), <ReceiptText className="h-4 w-4" key="receipt" />],
        [t.balance, usd(balanceUsd, language), <Banknote className="h-4 w-4" key="balance" />],
        [t.expenses, eur(paidEur, language), <Banknote className="h-4 w-4" key="expense" />],
      ].map(([title, value, icon]) => <article key={String(title)} className={`${card} p-5`}><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-gray-500">{icon}{title}</div><p className="mt-3 text-2xl font-black text-white">{value}</p></article>)}
    </div>

    {balanceUsd < 0 && <div role="alert" className="flex gap-3 rounded-2xl bg-amber-400/[0.06] p-4 ring-1 ring-amber-300/15"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" /><p className="text-sm leading-6 text-amber-100">{t.missing}</p></div>}

    <form onSubmit={submit} className={`${card} grid gap-5 p-6 md:grid-cols-2 xl:grid-cols-4 md:p-8`}>
      <label><span className={label}>{t.date}</span><input key={defaultPurchaseDate} name="date" type="date" defaultValue={defaultPurchaseDate} required className={input} /></label>
      <label><span className={label}>{t.description}</span><input name="description" defaultValue="iRacing Credits" maxLength={160} required className={input} /></label>
      <label><span className={label}>{t.credits}</span><input name="creditsUsd" type="number" min="0.01" max="1000000" step="0.01" inputMode="decimal" required className={input} /></label>
      <label><span className={label}>{t.paid}</span><input name="amountEur" type="number" min="0.01" max="1000000" step="0.01" inputMode="decimal" required className={input} /></label>
      <label className="md:col-span-2 xl:col-span-3"><span className={label}>{t.note}</span><input name="note" maxLength={240} className={input} /></label>
      <label className="flex min-h-12 cursor-pointer items-center gap-3 self-end rounded-xl bg-white/[0.025] px-4 py-3 ring-1 ring-white/[0.07]"><input name="isPublic" type="checkbox" defaultChecked className="h-4 w-4 accent-orange-500" /><span className="text-sm font-semibold text-gray-200">{t.public}</span></label>
      <button type="submit" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-gradient-racing px-5 py-3 text-sm font-black text-white shadow-lg shadow-orange-950/25 md:col-span-2 md:justify-self-start"><Check className="h-4 w-4" />{saved ? t.saved : t.save}</button>
    </form>

    {yearPurchases.length === 0 ? <div role="status" className="rounded-2xl bg-black/10 p-6 text-center text-sm text-gray-500 ring-1 ring-white/[0.05]">{t.noPurchases}</div> : <div className="grid gap-3">
      {yearPurchases.map((purchase) => <article key={purchase.id} className={`${card} p-5`}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1"><h3 className="font-bold text-white">{purchase.description}</h3><p className="mt-1 text-xs text-gray-500">{purchase.date} · {usd(purchase.creditsUsd, language)} · {t.effectiveRate} {eur(purchase.amountEur / purchase.creditsUsd, language)}/$1{purchase.note ? ` · ${purchase.note}` : ""}</p></div>
          <p className="shrink-0 font-heading text-xl font-black text-white">{eur(purchase.amountEur, language)}</p>
          <button type="button" onClick={() => setDeleteId(purchase.id)} aria-label={`${t.remove}: ${purchase.description}`} className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-gray-500 hover:bg-rose-500/10 hover:text-rose-300"><Trash2 className="h-4 w-4" /></button>
        </div>
        {deleteId === purchase.id && <div role="alert" className="mt-4 flex flex-col gap-3 rounded-xl bg-rose-500/[0.06] p-4 ring-1 ring-rose-400/15 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm font-bold text-rose-100">{t.confirmRemove}</p><div className="flex gap-2"><button type="button" onClick={() => setDeleteId(null)} className="min-h-10 rounded-xl bg-white/[0.04] px-3 text-xs font-bold text-gray-300">{t.cancel}</button><button type="button" onClick={() => { onRemove(purchase.id); setDeleteId(null); }} className="min-h-10 rounded-xl bg-rose-600 px-3 text-xs font-black text-white">{t.confirm}</button></div></div>}
      </article>)}
    </div>}
  </section>;
};

export default CreditPurchasesSection;
