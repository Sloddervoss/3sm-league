import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Check, CircleAlert, Flag, MapPin, Pencil, ReceiptText, Trash2, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { SupportRaceCost } from "@/features/community-support/types";
import type { SupportRaceCostDraft } from "@/features/community-support/store";
import { isSupportedCommunitySupportRace } from "@/features/community-support/raceEligibility";

type Language = "nl" | "en";

type RaceOption = {
  id: string;
  league_id: string | null;
  name: string;
  track: string;
  race_date: string;
  race_type: string | null;
  round: number | null;
  status: string;
  leagues: { name: string; season: string | null } | null;
};

type Props = {
  language: Language;
  selectedYear: string;
  onSelectedYearChange: (year: string) => void;
  raceCosts: SupportRaceCost[];
  hasRecurringServerCost: boolean;
  onSave: (draft: SupportRaceCostDraft) => void;
  onRemove: (id: string) => void;
};

const COPY = {
  nl: {
    title: "Racekosten",
    help: "Koppel het werkelijk betaalde, afgeronde totaalbedrag aan een bestaande Sprint- of Feature-race. Practice, kwalificatie en race horen samen in één bedrag.",
    season: "Seizoen",
    race: "Race",
    chooseRace: "Kies een race",
    seasonRaces: "Seizoensraces",
    standaloneRaces: "Losse races",
    amount: "Afgerond totaalbedrag",
    note: "Interne notitie (optioneel)",
    public: "Race en bedrag openbaar tonen",
    save: "Racekosten opslaan",
    update: "Racekosten bijwerken",
    saved: "Racekosten lokaal opgeslagen",
    loading: "Races laden…",
    loadError: "De bestaande races konden niet worden geladen.",
    noRaces: "Voor dit seizoen zijn geen Sprint- of Feature-races beschikbaar.",
    noCosts: "Voor dit seizoen zijn nog geen racekosten ingevuld.",
    recorded: "Ingevulde races",
    total: "Totale racekosten",
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
    duplicateWarning: "Racehosting wordt hier per race geboekt. Gebruik een terugkerende serverpost alleen voor vaste technische servers, niet opnieuw voor dezelfde races.",
  },
  en: {
    title: "Race costs",
    help: "Link the actual rounded total paid to an existing Sprint or Feature race. Practice, qualifying and the race belong in one amount.",
    season: "Season",
    race: "Race",
    chooseRace: "Choose a race",
    seasonRaces: "Season races",
    standaloneRaces: "Standalone races",
    amount: "Rounded total amount",
    note: "Internal note (optional)",
    public: "Show race and amount publicly",
    save: "Save race costs",
    update: "Update race costs",
    saved: "Race costs saved locally",
    loading: "Loading races…",
    loadError: "The existing races could not be loaded.",
    noRaces: "No Sprint or Feature races are available for this season.",
    noCosts: "No race costs have been entered for this season yet.",
    recorded: "Recorded races",
    total: "Total race costs",
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
    duplicateWarning: "Race hosting is recorded here per race. Use a recurring server item only for fixed technical servers, not again for the same races.",
  },
} as const;

const card = "rounded-[1.65rem] bg-card/65 shadow-2xl shadow-black/20 ring-1 ring-white/[0.065]";
const input = "mt-2 w-full rounded-xl bg-black/25 px-3.5 py-3 text-sm text-white outline-none ring-1 ring-white/10 transition placeholder:text-gray-600 focus:ring-2 focus:ring-orange-500/55";
const label = "text-xs font-bold uppercase tracking-[0.14em] text-gray-400";
const money = (value: number, language: Language) => new Intl.NumberFormat(language === "en" ? "en-GB" : "nl-NL", { style: "currency", currency: "EUR" }).format(value);
const dateLabel = (value: string, language: Language) => new Intl.DateTimeFormat(language === "en" ? "en-GB" : "nl-NL", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
const raceYear = (race: RaceOption) => race.race_date.slice(0, 4);
const isCompleted = (race: RaceOption) => race.status === "completed";

const RaceCostsSection = ({ language, selectedYear, onSelectedYearChange, raceCosts, hasRecurringServerCost, onSave, onRemove }: Props) => {
  const t = COPY[language];
  const formRef = useRef<HTMLFormElement>(null);
  const [selectedRaceId, setSelectedRaceId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [saved, setSaved] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const racesQuery = useQuery({
    queryKey: ["community-support", "race-cost-options"],
    queryFn: async (): Promise<RaceOption[]> => {
      const { data, error } = await supabase
        .from("races")
        .select("id,league_id,name,track,race_date,race_type,round,status,leagues(name,season)")
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
  const availableYears = useMemo(() => Array.from(new Set([
    String(new Date().getFullYear()),
    ...supportedRaces.map(raceYear),
    ...raceCosts.map((cost) => cost.date.slice(0, 4)),
  ])).sort((a, b) => b.localeCompare(a)), [raceCosts, supportedRaces]);
  const racesForYear = useMemo(() => supportedRaces.filter((race) => raceYear(race) === selectedYear && (isCompleted(race) || raceCosts.some((cost) => cost.raceId === race.id))), [raceCosts, selectedYear, supportedRaces]);
  const seasonRaces = racesForYear.filter((race) => race.league_id);
  const standaloneRaces = racesForYear.filter((race) => !race.league_id);
  const costsForYear = useMemo(() => raceCosts.filter((cost) => cost.date.startsWith(selectedYear)).sort((a, b) => b.date.localeCompare(a.date)), [raceCosts, selectedYear]);
  const total = costsForYear.reduce((sum, cost) => sum + cost.amount, 0);
  const missingCompleted = racesForYear.filter((race) => isCompleted(race) && !raceCosts.some((cost) => cost.raceId === race.id)).length;
  const selectedRace = racesForYear.find((race) => race.id === selectedRaceId) ?? null;
  const existingCost = selectedRace ? raceCosts.find((cost) => cost.raceId === selectedRace.id) : undefined;

  useEffect(() => {
    if (!racesForYear.length) {
      setSelectedRaceId("");
      return;
    }
    if (racesForYear.some((race) => race.id === selectedRaceId)) return;
    const preferred = racesForYear.find((race) => isCompleted(race) && !raceCosts.some((cost) => cost.raceId === race.id)) ?? racesForYear[0];
    setSelectedRaceId(preferred.id);
  }, [raceCosts, racesForYear, selectedRaceId]);

  useEffect(() => {
    if (!selectedRace) return;
    const stored = raceCosts.find((cost) => cost.raceId === selectedRace.id);
    setAmount(stored ? String(stored.amount) : "");
    setNote(stored?.note ?? "");
    setIsPublic(stored?.isPublic ?? true);
    setSaved(false);
  }, [raceCosts, selectedRace]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedRace) return;
    const parsedAmount = Number(amount.replace(",", "."));
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) return;
    onSave({
      raceId: selectedRace.id,
      raceScope: selectedRace.league_id ? "season" : "standalone",
      ...(selectedRace.league_id ? { leagueId: selectedRace.league_id } : {}),
      ...(selectedRace.leagues?.name ? { leagueName: selectedRace.leagues.name } : {}),
      ...(selectedRace.leagues?.season ? { season: selectedRace.leagues.season } : {}),
      raceName: selectedRace.name,
      track: selectedRace.track,
      date: selectedRace.race_date.slice(0, 10),
      ...(selectedRace.race_type ? { raceFormat: selectedRace.race_type } : {}),
      amount: parsedAmount,
      isPublic,
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    setSaved(true);
  };

  const startEdit = (cost: SupportRaceCost) => {
    onSelectedYearChange(cost.date.slice(0, 4));
    setSelectedRaceId(cost.raceId);
    window.setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
  };

  return <section className="space-y-6">
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

    <form ref={formRef} onSubmit={submit} className={`${card} grid gap-5 p-6 md:grid-cols-2 xl:grid-cols-4 md:p-8`}>
      <label className="block md:col-span-2 xl:col-span-4"><span className={label}>{t.race}</span>
        <select value={selectedRaceId} onChange={(event) => setSelectedRaceId(event.target.value)} disabled={racesQuery.isLoading || racesForYear.length === 0} required className={input}>
          <option value="">{racesQuery.isLoading ? t.loading : t.chooseRace}</option>
          {seasonRaces.length > 0 && <optgroup label={t.seasonRaces}>{seasonRaces.map((race) => <option key={race.id} value={race.id}>{race.leagues?.name ? `${race.leagues.name} · ` : ""}{race.round ? `R${race.round} · ` : ""}{race.name} · {race.track}</option>)}</optgroup>}
          {standaloneRaces.length > 0 && <optgroup label={t.standaloneRaces}>{standaloneRaces.map((race) => <option key={race.id} value={race.id}>{race.name} · {race.track}</option>)}</optgroup>}
        </select>
      </label>

      {racesQuery.isError ? <p role="alert" className="md:col-span-2 xl:col-span-4 text-sm text-rose-300">{t.loadError}</p> : !racesQuery.isLoading && racesForYear.length === 0 ? <p role="status" className="md:col-span-2 xl:col-span-4 text-sm text-gray-500">{t.noRaces}</p> : null}

      {selectedRace && <div className="md:col-span-2 xl:col-span-4 flex flex-wrap gap-2 rounded-2xl bg-black/15 p-4 text-xs ring-1 ring-white/[0.055]">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.04] px-3 py-1.5 font-bold text-gray-300"><CalendarDays className="h-3.5 w-3.5 text-orange-400" />{dateLabel(selectedRace.race_date, language)}</span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.04] px-3 py-1.5 font-bold text-gray-300"><MapPin className="h-3.5 w-3.5 text-orange-400" />{selectedRace.track}</span>
        <span className="rounded-full bg-white/[0.04] px-3 py-1.5 font-bold text-gray-300">{selectedRace.league_id ? selectedRace.leagues?.name : t.standalone}</span>
        <span className={`rounded-full px-3 py-1.5 font-bold ${isCompleted(selectedRace) ? "bg-emerald-400/10 text-emerald-200" : "bg-sky-400/10 text-sky-200"}`}>{isCompleted(selectedRace) ? t.completed : t.upcoming}</span>
      </div>}

      <label className="block"><span className={label}>{t.amount}</span><input value={amount} onChange={(event) => setAmount(event.target.value)} name="race-cost-amount" type="number" inputMode="decimal" min="0.01" step="0.01" required disabled={!selectedRace} className={input} /></label>
      <label className="block md:col-span-1 xl:col-span-2"><span className={label}>{t.note}</span><input value={note} onChange={(event) => setNote(event.target.value)} maxLength={240} disabled={!selectedRace} className={input} /></label>
      <label className="flex cursor-pointer items-center justify-between gap-4 self-end rounded-xl bg-white/[0.025] px-4 py-3 ring-1 ring-white/[0.07]"><span className="text-sm font-semibold text-gray-200">{t.public}</span><input type="checkbox" checked={isPublic} onChange={(event) => setIsPublic(event.target.checked)} disabled={!selectedRace} className="h-5 w-5 accent-orange-500" /></label>
      <button type="submit" disabled={!selectedRace} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-gradient-racing px-5 py-3 text-sm font-black text-white shadow-lg shadow-orange-950/25 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 md:col-span-2 md:justify-self-start"><Check className="h-4 w-4" />{saved ? t.saved : existingCost ? t.update : t.save}</button>
    </form>

    {costsForYear.length === 0 ? <div role="status" className="flex min-h-36 items-center justify-center rounded-2xl bg-black/10 p-6 text-center text-sm text-gray-500 ring-1 ring-white/[0.05]">{t.noCosts}</div> : <div className="grid gap-3">
      {costsForYear.map((cost) => <article key={cost.id} className={`${card} p-5`}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-500/10 text-orange-300"><Flag className="h-4 w-4" /></div>
          <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-bold text-white">{cost.raceName}</h3><span className="rounded-full bg-white/[0.04] px-2 py-1 text-[10px] font-black uppercase tracking-wider text-gray-400">{cost.raceScope === "season" ? cost.leagueName : t.standalone}</span>{!cost.isPublic && <span className="rounded-full bg-amber-400/10 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-amber-200">{t.private}</span>}</div><p className="mt-1 text-xs text-gray-500">{dateLabel(cost.date, language)} · {cost.track}{cost.note ? ` · ${cost.note}` : ""}</p></div>
          <p className="shrink-0 font-heading text-xl font-black text-white">{money(cost.amount, language)}</p>
          <div className="flex gap-2"><button type="button" onClick={() => startEdit(cost)} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-white/[0.04] px-3 text-xs font-bold text-gray-300 ring-1 ring-white/10 hover:bg-white/[0.08]"><Pencil className="h-3.5 w-3.5" />{t.edit}</button><button type="button" onClick={() => setDeleteId(cost.id)} aria-label={`${t.remove}: ${cost.raceName}`} className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-gray-500 hover:bg-rose-500/10 hover:text-rose-300"><Trash2 className="h-4 w-4" /></button></div>
        </div>
        {deleteId === cost.id && <div role="alert" className="mt-4 flex flex-col gap-3 rounded-xl bg-rose-500/[0.06] p-4 ring-1 ring-rose-400/15 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm font-bold text-rose-100">{t.confirmRemove}</p><div className="flex gap-2"><button type="button" onClick={() => setDeleteId(null)} className="min-h-10 rounded-xl bg-white/[0.04] px-3 text-xs font-bold text-gray-300">{t.cancel}</button><button type="button" onClick={() => { onRemove(cost.id); setDeleteId(null); }} className="min-h-10 rounded-xl bg-rose-600 px-3 text-xs font-black text-white">{t.confirm}</button></div></div>}
      </article>)}
    </div>}
  </section>;
};

export default RaceCostsSection;
