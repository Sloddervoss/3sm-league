import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Check, CircleAlert, Clock3, Flag, MapPin, Pencil, Percent, ReceiptText, Trash2, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { SupportRaceCost } from "@/features/community-support/types";
import type { SupportRaceCostDraft } from "@/features/community-support/store";
import { isSupportedCommunitySupportRace } from "@/features/community-support/raceEligibility";
import {
  calculateRaceHostingAmountUsd,
  calculateRaceHostingEurBreakdown,
  configuredRaceHours,
  DEFAULT_RACE_HOSTING_HOURS,
  normalizeHostedHours,
} from "@/features/community-support/raceHostingPricing";

type Language = "nl" | "en";

type RaceOption = {
  id: string;
  league_id: string | null;
  name: string;
  track: string;
  race_date: string;
  race_type: string | null;
  race_duration: string | null;
  practice_duration: string | null;
  qualifying_duration: string | null;
  round: number | null;
  status: string;
  leagues: { name: string; season: string | null } | null;
};

type Props = {
  language: Language;
  selectedYear: string;
  onSelectedYearChange: (year: string) => void;
  raceCosts: SupportRaceCost[];
  sharedDataLoading?: boolean;
  defaultUsdEurRate: number;
  hasRecurringServerCost: boolean;
  onSave: (draft: SupportRaceCostDraft) => Promise<boolean>;
  onSaveMany: (drafts: SupportRaceCostDraft[]) => Promise<boolean>;
  onInitialize: (drafts: SupportRaceCostDraft[]) => Promise<boolean>;

  onRemove: (id: string) => Promise<boolean>;
};

type BulkDraft = { hours: string; discountApplied: boolean };
type SeasonGroup = { id: string; name: string; costs: SupportRaceCost[] };

const COPY = {
  nl: {
    title: "Racekosten",
    help: "Iedere afgeronde Sprint-, Feature- of losse race wordt geboekt in euro inclusief 21% btw. De bronprijs is $0,50 per gehost uur; uren, eventuele 25% korting, de opgeslagen USD/EUR-koers en daarna 21% btw bepalen het definitieve EUR-bedrag.",
    season: "Seizoen",
    race: "Race",
    chooseRace: "Kies een race",
    seasonRaces: "Seizoensraces",
    standaloneRaces: "Losse races",
    hours: "Gehoste uren",
    configuredDuration: "Ingestelde raceduur",
    useConfiguredDuration: "Neem raceduur over",
    discount: "25% korting toegepast",
    calculatedAmount: "Berekend EUR-bedrag incl. btw",
    rate: "$0,50 per gehost uur",
    exchangeRate: "Opgeslagen koers",
    sourceAmount: "Bronprijs",
    note: "Interne notitie (optioneel)",
    public: "Race en bedrag openbaar tonen",
    save: "Racekosten opslaan",
    update: "Racekosten bijwerken",
    saved: "Racekosten gedeeld opgeslagen",
    loading: "Races laden…",
    loadError: "De bestaande races konden niet worden geladen.",
    noRaces: "Voor dit seizoen zijn geen ondersteunde afgeronde races beschikbaar.",
    noCosts: "Voor dit seizoen zijn nog geen racekosten ingevuld.",
    recorded: "Ingevulde races",
    total: "Totale racekosten incl. btw",
    average: "Gemiddeld per race",
    completedMissing: "afgeronde races zonder kosten",
    completed: "Afgerond",
    upcoming: "Gepland",
    standalone: "Losse race",
    private: "Privé",
    edit: "Bewerken",
    remove: "Verwijderen",
    confirmRemove: "Deze lokale racekosten verwijderen?",
    cancel: "Annuleren",
    confirm: "Ja, verwijderen",
    duplicateWarningTitle: "Voorkom dubbele racehosting",
    duplicateWarning: "Racehosting wordt hier rechtstreeks geboekt. Gebruik een terugkerende serverpost alleen voor vaste technische servers, niet opnieuw voor dezelfde races.",
    seeded: "afgeronde races lokaal geboekt met de actuele USD/EUR-koers",
    bulkTitle: "Seizoenen in één keer aanpassen",
    bulkHelp: "Wijzig uren en korting voor alle ingevulde races binnen één seizoen. Losse races pas je per race aan.",
    races: "races",
    applySeason: "Toepassen op heel seizoen",
    seasonUpdated: "Seizoen lokaal bijgewerkt",
    discounted: "Korting",
    noDiscount: "Geen korting",
    vat: "21% btw",
    net: "Netto",
  },
  en: {
    title: "Race costs",
    help: "Every completed Sprint, Feature or standalone race is booked in euros including 21% VAT. The $0.50 hosted-hour rate, any 25% discount and the stored USD/EUR rate determine the net amount; 21% VAT is then added.",
    season: "Season",
    race: "Race",
    chooseRace: "Choose a race",
    seasonRaces: "Season races",
    standaloneRaces: "Standalone races",
    hours: "Hosted hours",
    configuredDuration: "Configured race duration",
    useConfiguredDuration: "Use race duration",
    discount: "25% discount applied",
    calculatedAmount: "Calculated EUR amount incl. VAT",
    rate: "$0.50 per hosted hour",
    exchangeRate: "Stored rate",
    sourceAmount: "Source price",
    note: "Internal note (optional)",
    public: "Show race and amount publicly",
    save: "Save race costs",
    update: "Update race costs",
    saved: "Race costs saved to the shared backend",
    loading: "Loading races…",
    loadError: "The existing races could not be loaded.",
    noRaces: "No supported completed races are available for this season.",
    noCosts: "No race costs have been entered for this season yet.",
    recorded: "Recorded races",
    total: "Total race costs incl. VAT",
    average: "Average per race",
    completedMissing: "completed races without costs",
    completed: "Completed",
    upcoming: "Scheduled",
    standalone: "Standalone race",
    private: "Private",
    edit: "Edit",
    remove: "Delete",
    confirmRemove: "Delete these local race costs?",
    cancel: "Cancel",
    confirm: "Yes, delete",
    duplicateWarningTitle: "Avoid duplicate race hosting",
    duplicateWarning: "Race hosting is recorded here directly. Use a recurring server item only for fixed technical servers, not again for the same races.",
    seeded: "completed races locally booked with the current USD/EUR rate",
    bulkTitle: "Update seasons at once",
    bulkHelp: "Change hours and discount for every recorded race in one season. Standalone races remain individually editable.",
    races: "races",
    applySeason: "Apply to entire season",
    seasonUpdated: "Season updated locally",
    discounted: "Discount",
    noDiscount: "No discount",
    vat: "21% VAT",
    net: "Net",
  },
} as const;

const card = "rounded-[1.65rem] bg-card/65 shadow-2xl shadow-black/20 ring-1 ring-white/[0.065]";
const input = "mt-2 w-full rounded-xl bg-black/25 px-3.5 py-3 text-sm text-white outline-none ring-1 ring-white/10 transition placeholder:text-gray-600 focus:ring-2 focus:ring-orange-500/55";
const label = "text-xs font-bold uppercase tracking-[0.14em] text-gray-400";
const money = (value: number, language: Language) => new Intl.NumberFormat(language === "en" ? "en-GB" : "nl-NL", { style: "currency", currency: "EUR" }).format(value);
const moneyUsd = (value: number, language: Language) => new Intl.NumberFormat(language === "en" ? "en-US" : "nl-NL", { style: "currency", currency: "USD" }).format(value);
const dateLabel = (value: string, language: Language) => new Intl.DateTimeFormat(language === "en" ? "en-GB" : "nl-NL", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
const raceYear = (race: RaceOption) => race.race_date.slice(0, 4);
const isCompleted = (race: RaceOption) => race.status === "completed";

const raceDraft = (race: RaceOption, hostedHours: number, discountApplied: boolean): SupportRaceCostDraft => ({
  raceId: race.id,
  raceScope: race.league_id ? "season" : "standalone",
  ...(race.league_id ? { leagueId: race.league_id } : {}),
  ...(race.leagues?.name ? { leagueName: race.leagues.name } : {}),
  ...(race.leagues?.season ? { season: race.leagues.season } : {}),
  raceName: race.name,
  track: race.track,
  date: race.race_date.slice(0, 10),
  ...(race.race_type ? { raceFormat: race.race_type } : {}),
  hostedHours,
  discountApplied,
  isPublic: true,
});

const storedCostDraft = (cost: SupportRaceCost, hostedHours = cost.hostedHours, discountApplied = cost.discountApplied): SupportRaceCostDraft => ({
  raceId: cost.raceId,
  raceScope: cost.raceScope,
  ...(cost.leagueId ? { leagueId: cost.leagueId } : {}),
  ...(cost.leagueName ? { leagueName: cost.leagueName } : {}),
  ...(cost.season ? { season: cost.season } : {}),
  raceName: cost.raceName,
  track: cost.track,
  date: cost.date,
  ...(cost.raceFormat ? { raceFormat: cost.raceFormat } : {}),
  hostedHours,
  discountApplied,
  exchangeRateUsdEur: cost.exchangeRateUsdEur,
  isPublic: cost.isPublic,
  ...(cost.note ? { note: cost.note } : {}),
});

const Toggle = ({ checked, onChange, text, disabled = false }: { checked: boolean; onChange: (checked: boolean) => void; text: string; disabled?: boolean }) => <label className="flex min-h-12 cursor-pointer items-center justify-between gap-4 rounded-xl bg-white/[0.025] px-4 py-3 ring-1 ring-white/[0.07] has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
  <span className="text-sm font-semibold text-gray-200">{text}</span>
  <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} disabled={disabled} className="peer sr-only" />
  <span aria-hidden="true" className="relative h-6 w-11 shrink-0 rounded-full bg-gray-700 transition peer-checked:bg-orange-500 peer-focus-visible:ring-2 peer-focus-visible:ring-orange-300"><span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition ${checked ? "left-6" : "left-1"}`} /></span>
</label>;

const RaceCostsSection = ({ language, selectedYear, onSelectedYearChange, raceCosts, sharedDataLoading = false, defaultUsdEurRate, hasRecurringServerCost, onSave, onSaveMany, onInitialize, onRemove }: Props) => {
  const t = COPY[language];
  const formRef = useRef<HTMLFormElement>(null);
  const [selectedRaceId, setSelectedRaceId] = useState("");
  const [hostedHours, setHostedHours] = useState(String(DEFAULT_RACE_HOSTING_HOURS));
  const [discountApplied, setDiscountApplied] = useState(false);
  const [note, setNote] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [saved, setSaved] = useState(false);

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [bulkDrafts, setBulkDrafts] = useState<Record<string, BulkDraft>>({});
  const [updatedSeasonId, setUpdatedSeasonId] = useState<string | null>(null);

  const racesQuery = useQuery({
    queryKey: ["community-support", "race-cost-options"],
    queryFn: async (): Promise<RaceOption[]> => {
      const { data, error } = await supabase
        .from("races")
        .select("id,league_id,name,track,race_date,race_type,race_duration,practice_duration,qualifying_duration,round,status,leagues(name,season)")
        .order("race_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as RaceOption[];
    },
  });

  const supportedRaces = useMemo(() => (racesQuery.data ?? []).filter((race) => isSupportedCommunitySupportRace({
    raceScope: race.league_id ? "season" : "standalone",
    leagueId: race.league_id,
    leagueName: race.leagues?.name,
    raceName: race.name,
    raceFormat: race.race_type,
  })), [racesQuery.data]);

  useEffect(() => {
    if (sharedDataLoading || !racesQuery.isSuccess) return;
    const completed = supportedRaces.filter(isCompleted);
    void onInitialize(completed.map((race) => raceDraft(race, DEFAULT_RACE_HOSTING_HOURS, false)));
  }, [onInitialize, racesQuery.isSuccess, sharedDataLoading, supportedRaces]);

  const availableYears = useMemo(() => Array.from(new Set([
    selectedYear,
    String(new Date().getFullYear()),
    ...supportedRaces.map(raceYear),
    ...raceCosts.map((cost) => cost.date.slice(0, 4)),
  ])).sort((a, b) => b.localeCompare(a)), [raceCosts, selectedYear, supportedRaces]);
  const racesForYear = useMemo(() => supportedRaces.filter((race) => raceYear(race) === selectedYear && (isCompleted(race) || raceCosts.some((cost) => cost.raceId === race.id))), [raceCosts, selectedYear, supportedRaces]);
  const seasonRaces = racesForYear.filter((race) => race.league_id);
  const standaloneRaces = racesForYear.filter((race) => !race.league_id);
  const costsForYear = useMemo(() => raceCosts.filter((cost) => cost.date.startsWith(selectedYear)).sort((a, b) => b.date.localeCompare(a.date)), [raceCosts, selectedYear]);
  const total = costsForYear.reduce((sum, cost) => sum + cost.amount, 0);
  const missingCompleted = racesForYear.filter((race) => isCompleted(race) && !raceCosts.some((cost) => cost.raceId === race.id)).length;
  const selectedRace = racesForYear.find((race) => race.id === selectedRaceId) ?? null;
  const existingCost = selectedRace ? raceCosts.find((cost) => cost.raceId === selectedRace.id) : undefined;
  const normalizedHours = normalizeHostedHours(Number(hostedHours)) ?? DEFAULT_RACE_HOSTING_HOURS;
  const calculatedSourceAmountUsd = calculateRaceHostingAmountUsd(normalizedHours, discountApplied);
  const calculatedExchangeRate = existingCost?.exchangeRateUsdEur ?? defaultUsdEurRate;
  const calculatedBreakdown = calculateRaceHostingEurBreakdown(calculatedSourceAmountUsd, calculatedExchangeRate);
  const raceDurationHours = configuredRaceHours(selectedRace?.race_duration);

  const seasonGroups = useMemo<SeasonGroup[]>(() => {
    const grouped = new Map<string, SeasonGroup>();
    costsForYear.filter((cost) => cost.raceScope === "season" && cost.leagueId).forEach((cost) => {
      const id = cost.leagueId as string;
      const group = grouped.get(id) ?? { id, name: cost.leagueName || cost.season || t.season, costs: [] };
      group.costs.push(cost);
      grouped.set(id, group);
    });
    return Array.from(grouped.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [costsForYear, t.season]);

  useEffect(() => {
    if (!racesForYear.length) {
      setSelectedRaceId("");
      return;
    }
    if (racesForYear.some((race) => race.id === selectedRaceId)) return;
    setSelectedRaceId(racesForYear[0].id);
  }, [racesForYear, selectedRaceId]);

  useEffect(() => {
    if (!selectedRace) return;
    const stored = raceCosts.find((cost) => cost.raceId === selectedRace.id);
    setHostedHours(String(stored?.hostedHours ?? DEFAULT_RACE_HOSTING_HOURS));
    setDiscountApplied(stored?.discountApplied ?? false);
    setNote(stored?.note ?? "");
    setIsPublic(stored?.isPublic ?? true);
    setSaved(false);
  }, [raceCosts, selectedRace]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedRace) return;
    const hours = normalizeHostedHours(Number(hostedHours));
    if (hours === null) return;
    const stored = await onSave({ ...raceDraft(selectedRace, hours, discountApplied), ...(existingCost ? { exchangeRateUsdEur: existingCost.exchangeRateUsdEur } : {}), isPublic, ...(note.trim() ? { note: note.trim() } : {}) });
    if (!stored) return;
    setSaved(true);
  };

  const startEdit = (cost: SupportRaceCost) => {
    onSelectedYearChange(cost.date.slice(0, 4));
    setSelectedRaceId(cost.raceId);
    window.setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
  };

  const remove = async (id: string) => {
    if (await onRemove(id)) setDeleteId(null);
  };

  const bulkDraftFor = (group: SeasonGroup): BulkDraft => bulkDrafts[group.id] ?? {
    hours: String(group.costs[0]?.hostedHours ?? DEFAULT_RACE_HOSTING_HOURS),
    discountApplied: group.costs.every((cost) => cost.discountApplied),
  };

  const updateBulkDraft = (group: SeasonGroup, update: Partial<BulkDraft>) => {
    setUpdatedSeasonId(null);
    setBulkDrafts((current) => ({ ...current, [group.id]: { ...bulkDraftFor(group), ...update } }));
  };

  const applySeason = async (group: SeasonGroup) => {
    const draft = bulkDraftFor(group);
    const hours = normalizeHostedHours(Number(draft.hours));
    if (hours === null) return;
    if (!(await onSaveMany(group.costs.map((cost) => storedCostDraft(cost, hours, draft.discountApplied))))) return;
    setUpdatedSeasonId(group.id);
  };

  return <section className="min-w-0 space-y-6">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div><h2 className="font-heading text-2xl font-black text-white">{t.title}</h2><p className="mt-2 max-w-3xl text-sm leading-relaxed text-gray-400">{t.help}</p></div>
      <label className="block w-full sm:w-44"><span className={label}>{t.season}</span><select value={selectedYear} onChange={(event) => onSelectedYearChange(event.target.value)} className={input}>{availableYears.map((year) => <option key={year} value={year}>{year}</option>)}</select></label>
    </div>


    {hasRecurringServerCost && <div className="flex gap-3 rounded-2xl bg-amber-400/[0.06] p-4 ring-1 ring-amber-300/15">
      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
      <div><p className="text-sm font-bold text-amber-100">{t.duplicateWarningTitle}</p><p className="mt-1 text-xs leading-5 text-gray-400">{t.duplicateWarning}</p></div>
    </div>}

    <div className="grid gap-4 sm:grid-cols-3">
      {[
        [t.recorded, String(costsForYear.length), <Flag className="h-4 w-4" key="flag" />],
        [t.total, money(total, language), <ReceiptText className="h-4 w-4" key="receipt" />],
        [t.average, money(costsForYear.length ? total / costsForYear.length : 0, language), <Trophy className="h-4 w-4" key="trophy" />],
      ].map(([title, value, icon]) => <article key={String(title)} className={`${card} p-5`}><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-gray-500">{icon}{title}</div><p className="mt-3 text-2xl font-black text-white">{value}</p></article>)}
    </div>

    {missingCompleted > 0 && <p role="status" className="text-sm font-bold text-orange-300">{missingCompleted} {t.completedMissing}</p>}

    {seasonGroups.length > 0 && <section aria-labelledby="season-bulk-title" className={`${card} min-w-0 max-w-full p-5 sm:p-6`}>
      <div className="min-w-0 max-w-full"><h3 id="season-bulk-title" className="max-w-full break-words font-heading text-xl font-black leading-tight text-white">{t.bulkTitle}</h3><p className="mt-2 max-w-full break-words text-sm leading-6 text-gray-400">{t.bulkHelp}</p></div>
      <div className="mt-5 grid min-w-0 gap-4">
        {seasonGroups.map((group) => {
          const draft = bulkDraftFor(group);
          const hours = normalizeHostedHours(Number(draft.hours)) ?? DEFAULT_RACE_HOSTING_HOURS;
          const sourceAmountUsd = calculateRaceHostingAmountUsd(hours, draft.discountApplied);
          const groupAmount = group.costs.reduce((sum, cost) => sum + calculateRaceHostingEurBreakdown(sourceAmountUsd, cost.exchangeRateUsdEur).amount, 0);
          return <article key={group.id} className="grid min-w-0 max-w-full gap-4 rounded-2xl bg-black/15 p-4 ring-1 ring-white/[0.055] md:grid-cols-2 md:items-end 2xl:grid-cols-[minmax(0,1fr)_8rem_minmax(13rem,17rem)_auto]">
            <div className="min-w-0 md:col-span-2 2xl:col-span-1"><p className="break-words font-bold leading-snug text-white">{group.name}</p><p className="mt-1 truncate text-xs text-gray-500">{group.costs.length} {t.races} · {money(groupAmount, language)}</p></div>
            <label className="block min-w-0"><span className={label}>{t.hours}</span><input value={draft.hours} onChange={(event) => updateBulkDraft(group, { hours: event.target.value })} type="number" min="1" max="24" step="1" inputMode="numeric" className={input} /></label>
            <Toggle checked={draft.discountApplied} onChange={(checked) => updateBulkDraft(group, { discountApplied: checked })} text={t.discount} />
            <button type="button" onClick={() => void applySeason(group)} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-white/[0.05] px-4 text-center text-sm font-black leading-snug text-white ring-1 ring-white/10 transition hover:bg-white/[0.09] md:col-span-2 md:w-auto md:justify-self-start 2xl:col-span-1 2xl:w-full 2xl:justify-self-stretch"><Check className="h-4 w-4 shrink-0" />{updatedSeasonId === group.id ? t.seasonUpdated : t.applySeason}</button>
          </article>;
        })}
      </div>
    </section>}

    <form ref={formRef} onSubmit={submit} className={`${card} grid min-w-0 gap-5 p-6 md:grid-cols-2 xl:grid-cols-4 md:p-8`}>
      <label className="block min-w-0 md:col-span-2 xl:col-span-4"><span className={label}>{t.race}</span>
        <select value={selectedRaceId} onChange={(event) => setSelectedRaceId(event.target.value)} disabled={racesQuery.isLoading || racesForYear.length === 0} required className={input}>
          <option value="">{racesQuery.isLoading ? t.loading : t.chooseRace}</option>
          {seasonRaces.length > 0 && <optgroup label={t.seasonRaces}>{seasonRaces.map((race) => <option key={race.id} value={race.id}>{race.leagues?.name ? `${race.leagues.name} · ` : ""}{race.round ? `R${race.round} · ` : ""}{race.name} · {race.track}</option>)}</optgroup>}
          {standaloneRaces.length > 0 && <optgroup label={t.standaloneRaces}>{standaloneRaces.map((race) => <option key={race.id} value={race.id}>{race.name} · {race.track}</option>)}</optgroup>}
        </select>
      </label>

      {racesQuery.isError ? <p role="alert" className="md:col-span-2 xl:col-span-4 text-sm text-rose-300">{t.loadError}</p> : !racesQuery.isLoading && racesForYear.length === 0 ? <p role="status" className="md:col-span-2 xl:col-span-4 text-sm text-gray-500">{t.noRaces}</p> : null}

      {selectedRace && <div className="md:col-span-2 xl:col-span-4 flex min-w-0 flex-wrap gap-2 rounded-2xl bg-black/15 p-4 text-xs ring-1 ring-white/[0.055]">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.04] px-3 py-1.5 font-bold text-gray-300"><CalendarDays className="h-3.5 w-3.5 text-orange-400" />{dateLabel(selectedRace.race_date, language)}</span>
        <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-white/[0.04] px-3 py-1.5 font-bold text-gray-300"><MapPin className="h-3.5 w-3.5 shrink-0 text-orange-400" /><span className="truncate">{selectedRace.track}</span></span>
        <span className="rounded-full bg-white/[0.04] px-3 py-1.5 font-bold text-gray-300">{selectedRace.league_id ? selectedRace.leagues?.name : t.standalone}</span>
        <span className={`rounded-full px-3 py-1.5 font-bold ${isCompleted(selectedRace) ? "bg-emerald-400/10 text-emerald-200" : "bg-sky-400/10 text-sky-200"}`}>{isCompleted(selectedRace) ? t.completed : t.upcoming}</span>
        {selectedRace.race_duration && <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.04] px-3 py-1.5 font-bold text-gray-300"><Clock3 className="h-3.5 w-3.5 text-orange-400" />{t.configuredDuration}: {selectedRace.race_duration}</span>}
      </div>}

      <label className="block"><span className={label}>{t.hours}</span><input value={hostedHours} onChange={(event) => setHostedHours(event.target.value)} name="race-hosted-hours" type="number" inputMode="numeric" min="1" max="24" step="1" required disabled={!selectedRace} className={input} /></label>
      <div className="self-end"><Toggle checked={discountApplied} onChange={setDiscountApplied} text={t.discount} disabled={!selectedRace} /></div>
      <div className="rounded-xl bg-orange-500/[0.07] px-4 py-3 ring-1 ring-orange-400/20"><p className={label}>{t.calculatedAmount}</p><p className="mt-1 font-heading text-xl font-black text-white">{money(calculatedBreakdown.amount, language)}</p><p className="mt-1 text-[11px] text-gray-500">{t.net}: {money(calculatedBreakdown.netAmount, language)} · {t.vat}: {money(calculatedBreakdown.vatAmount, language)}</p><p className="mt-1 text-[11px] text-gray-500">{t.sourceAmount}: {moneyUsd(calculatedSourceAmountUsd, language)} · {t.exchangeRate}: {calculatedExchangeRate.toFixed(4)} · {t.rate}</p></div>
      {raceDurationHours && raceDurationHours !== normalizedHours ? <button type="button" onClick={() => setHostedHours(String(raceDurationHours))} className="min-h-12 self-end rounded-xl bg-white/[0.04] px-4 text-sm font-bold text-gray-300 ring-1 ring-white/10 hover:bg-white/[0.08]">{t.useConfiguredDuration}: {raceDurationHours}u</button> : <div />}
      <label className="block md:col-span-1 xl:col-span-2"><span className={label}>{t.note}</span><input value={note} onChange={(event) => setNote(event.target.value)} maxLength={240} disabled={!selectedRace} className={input} /></label>
      <div className="md:col-span-1 xl:col-span-2"><Toggle checked={isPublic} onChange={setIsPublic} text={t.public} disabled={!selectedRace} /></div>
      <button type="submit" disabled={!selectedRace} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-gradient-racing px-5 py-3 text-sm font-black text-white shadow-lg shadow-orange-950/25 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 md:col-span-2 md:justify-self-start"><Check className="h-4 w-4" />{saved ? t.saved : existingCost ? t.update : t.save}</button>
    </form>

    {costsForYear.length === 0 ? <div role="status" className="flex min-h-36 items-center justify-center rounded-2xl bg-black/10 p-6 text-center text-sm text-gray-500 ring-1 ring-white/[0.05]">{t.noCosts}</div> : <div className="grid min-w-0 gap-3">
      {costsForYear.map((cost) => <article key={cost.id} className={`${card} min-w-0 p-5`}>
        <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-500/10 text-orange-300"><Flag className="h-4 w-4" /></div>
          <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-bold text-white">{cost.raceName}</h3><span className="rounded-full bg-white/[0.04] px-2 py-1 text-[10px] font-black uppercase tracking-wider text-gray-400">{cost.raceScope === "season" ? cost.leagueName : t.standalone}</span><span className="rounded-full bg-sky-400/10 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-sky-200">{t.vat}</span>{!cost.isPublic && <span className="rounded-full bg-amber-400/10 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-amber-200">{t.private}</span>}</div><p className="mt-1 text-xs text-gray-500">{dateLabel(cost.date, language)} · {cost.track} · {cost.hostedHours}u · {cost.discountApplied ? t.discounted : t.noDiscount} · {moneyUsd(cost.sourceAmountUsd, language)} × {cost.exchangeRateUsdEur.toFixed(4)} · {t.net}: {money(cost.netAmount, language)}{cost.note ? ` · ${cost.note}` : ""}</p></div>
          <button type="button" role="switch" aria-checked={cost.discountApplied} onClick={() => void onSave(storedCostDraft(cost, cost.hostedHours, !cost.discountApplied))} className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl px-3 text-xs font-black ring-1 transition ${cost.discountApplied ? "bg-orange-500/10 text-orange-200 ring-orange-400/20" : "bg-white/[0.035] text-gray-400 ring-white/10"}`}><Percent className="h-3.5 w-3.5" />{cost.discountApplied ? t.discounted : t.noDiscount}</button>
          <p className="shrink-0 font-heading text-xl font-black text-white">{money(cost.amount, language)}</p>
          <div className="flex gap-2"><button type="button" onClick={() => startEdit(cost)} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-white/[0.04] px-3 text-xs font-bold text-gray-300 ring-1 ring-white/10 hover:bg-white/[0.08]"><Pencil className="h-3.5 w-3.5" />{t.edit}</button><button type="button" onClick={() => setDeleteId(cost.id)} aria-label={`${t.remove}: ${cost.raceName}`} className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-gray-500 hover:bg-rose-500/10 hover:text-rose-300"><Trash2 className="h-4 w-4" /></button></div>
        </div>
        {deleteId === cost.id && <div role="alert" className="mt-4 flex flex-col gap-3 rounded-xl bg-rose-500/[0.06] p-4 ring-1 ring-rose-400/15 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm font-bold text-rose-100">{t.confirmRemove}</p><div className="flex gap-2"><button type="button" onClick={() => setDeleteId(null)} className="min-h-10 rounded-xl bg-white/[0.04] px-3 text-xs font-bold text-gray-300">{t.cancel}</button><button type="button" onClick={() => void remove(cost.id)} className="min-h-10 rounded-xl bg-rose-600 px-3 text-xs font-black text-white">{t.confirm}</button></div></div>}
      </article>)}
    </div>}
  </section>;
};

export default RaceCostsSection;
