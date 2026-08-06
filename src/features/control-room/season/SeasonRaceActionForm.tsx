import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, KeyRound, Save, Trophy } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { TrackSelect } from "@/components/admin/TrackSelect";
import { supabase } from "@/integrations/supabase/client";
import { amsToUTC, utcToAmsLocal } from "@/lib/dateHelpers";
import type { SeasonWorkspaceAction } from "./SeasonRaceWorkspace";

type RaceSlot = {
  name: string;
  track: string;
  date: string;
  time: string;
  race_type: string;
  race_duration: string;
  practice_duration: string;
  qualifying_duration: string;
  start_type: string;
  weather: string;
  setup: string;
  lobby_name: string;
  lobby_password: string;
  lobby_reveal_minutes: number;
};

type LeagueRow = { id: string; name: string; season: string | null; car_class: string | null; description: string | null };
type RaceRow = {
  id: string; league_id: string | null; name: string; track: string; race_date: string | null; round: number | null; status: string | null;
  race_type: string | null; race_duration: string | null; practice_duration: string | null; qualifying_duration: string | null;
  start_type: string | null; weather: string | null; setup: string | null; lobby_name: string | null; lobby_password: string | null; lobby_reveal_minutes: number | null;
};

type RaceForm = {
  name: string; track: string; race_date: string; race_type: string; race_duration: string; practice_duration: string;
  qualifying_duration: string; start_type: string; weather: string; setup: string; status: string;
  lobby_name: string; lobby_password: string; lobby_reveal_minutes: number;
};

type SeasonRaceDefaults = Pick<RaceSlot, "race_type" | "race_duration" | "practice_duration" | "qualifying_duration" | "start_type" | "weather" | "setup" | "lobby_reveal_minutes">;

const DEFAULT_SEASON_RACE_SETTINGS: SeasonRaceDefaults = {
  race_type: "Feature", race_duration: "60 min", practice_duration: "15 min", qualifying_duration: "10 min",
  start_type: "Standing", weather: "Fixed", setup: "Fixed", lobby_reveal_minutes: 15,
};

const defaultSlot = (name = "", defaults: SeasonRaceDefaults = DEFAULT_SEASON_RACE_SETTINGS): RaceSlot => ({
  name, track: "", date: "", time: "20:00", ...defaults, lobby_name: "", lobby_password: "",
});

const defaultRaceForm = (): RaceForm => ({ ...defaultSlot(), race_date: "", status: "upcoming" });

const raceToForm = (race: RaceRow): RaceForm => ({
  name: race.name || "", track: race.track || "", race_date: race.race_date ? utcToAmsLocal(race.race_date) : "",
  race_type: race.race_type || "", race_duration: race.race_duration || "", practice_duration: race.practice_duration || "",
  qualifying_duration: race.qualifying_duration || "", start_type: race.start_type || "", weather: race.weather || "", setup: race.setup || "",
  status: race.status || "upcoming", lobby_name: race.lobby_name || "", lobby_password: race.lobby_password || "", lobby_reveal_minutes: race.lobby_reveal_minutes ?? 15,
});

const standardPayload = (form: RaceForm) => ({
  name: form.name,
  track: form.track,
  race_date: form.race_date ? amsToUTC(form.race_date) : null,
  race_type: form.race_type || null,
  race_duration: form.race_duration || null,
  practice_duration: form.practice_duration || null,
  qualifying_duration: form.qualifying_duration || null,
  start_type: form.start_type || null,
  weather: form.weather || null,
  setup: form.setup || null,
  status: form.status || "upcoming",
});

const slotPayload = (slot: RaceSlot, leagueId: string | null, round?: number) => ({
  league_id: leagueId,
  ...(round ? { round } : {}),
  name: slot.name,
  track: slot.track,
  race_date: amsToUTC(`${slot.date}T${slot.time}`),
  status: "upcoming" as const,
  race_type: slot.race_type || null,
  race_duration: slot.race_duration || null,
  practice_duration: slot.practice_duration || null,
  qualifying_duration: slot.qualifying_duration || null,
  start_type: slot.start_type || null,
  weather: slot.weather || null,
  setup: slot.setup || null,
  lobby_name: slot.lobby_name || null,
  lobby_password: slot.lobby_password || null,
  lobby_reveal_minutes: slot.lobby_reveal_minutes ?? 15,
});

export type SeasonRaceActionFormProps = {
  action: SeasonWorkspaceAction;
  onComplete?: () => void;
};

/** A single action-specific live form for the Control Room drawer. */
export const SeasonRaceActionForm = ({ action, onComplete }: SeasonRaceActionFormProps) => {
  const { user, isAdmin, isSuperAdmin } = useAuth();
  const queryClient = useQueryClient();
  const canWrite = Boolean(user && (isAdmin || isSuperAdmin));
  const { data: leagues = [] } = useQuery({
    queryKey: ["control-room", "season", "action-form-leagues"],
    enabled: canWrite,
    queryFn: async (): Promise<LeagueRow[]> => {
      const { data, error } = await supabase.from("leagues").select("id,name,season,car_class,description").order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as LeagueRow[];
    },
  });
  const { data: races = [] } = useQuery({
    queryKey: ["control-room", "season", "action-form-races"],
    enabled: canWrite,
    queryFn: async (): Promise<RaceRow[]> => {
      const { data, error } = await supabase.from("races").select("id,league_id,name,track,race_date,round,status,race_type,race_duration,practice_duration,qualifying_duration,start_type,weather,setup,lobby_name,lobby_password,lobby_reveal_minutes");
      if (error) throw error;
      return (data || []) as RaceRow[];
    },
  });

  const [leagueForm, setLeagueForm] = useState({ name: "", description: "", season: "", car_class: "", raceCount: 6 });
  const [seasonDefaults, setSeasonDefaults] = useState<SeasonRaceDefaults>(DEFAULT_SEASON_RACE_SETTINGS);
  const [slots, setSlots] = useState<RaceSlot[]>(() => Array.from({ length: 6 }, (_, index) => defaultSlot(`Race ${index + 1}`)));
  const [raceForm, setRaceForm] = useState<RaceForm>(defaultRaceForm);
  const isSeasonCreate = action.id === "season-create";
  const isSeasonEdit = action.id === "season-edit";
  const isRaceCreate = action.id === "race-create";
  const isRaceEdit = action.id === "race-edit";
  const isSoloCreate = action.id === "solo-race-create";
  const isSoloEdit = action.id === "solo-race-edit";
  const isLobbyEdit = action.id === "lobby-edit";
  const targetRace = races.find((race) => race.id === action.context.raceId) ?? null;
  const targetLeagueId = isSoloCreate ? null : action.context.seasonId || targetRace?.league_id || null;
  const targetLeague = leagues.find((league) => league.id === targetLeagueId) ?? null;
  const hydratedLeagueRef = useRef<string | null>(null);
  const hydratedRaceRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isSeasonEdit || !targetLeague || hydratedLeagueRef.current === targetLeague.id) return;
    hydratedLeagueRef.current = targetLeague.id;
    setLeagueForm({ name: targetLeague.name, description: targetLeague.description || "", season: targetLeague.season || "", car_class: targetLeague.car_class || "", raceCount: 6 });
  }, [isSeasonEdit, targetLeague]);
  useEffect(() => {
    if (!targetRace || !(isRaceEdit || isSoloEdit || isLobbyEdit) || hydratedRaceRef.current === targetRace.id) return;
    hydratedRaceRef.current = targetRace.id;
    setRaceForm(raceToForm(targetRace));
  }, [isLobbyEdit, isRaceEdit, isSoloEdit, targetRace]);

  const invalidate = () => {
    [["admin-leagues"], ["all-races-admin"], ["races-with-leagues"], ["workspace-prototype-leagues"], ["workspace-prototype-season-races"], ["control-room", "season", "leagues"], ["control-room", "season", "races"], ["control-room", "season", "action-form-leagues"], ["control-room", "season", "action-form-races"]]
      .forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
  };
  const failed = (error: Error) => toast.error(error.message);

  const createSeason = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Je moet ingelogd zijn om een seizoen aan te maken.");
      const { data: league, error } = await supabase.from("leagues").insert({ name: leagueForm.name, description: leagueForm.description, season: leagueForm.season, car_class: leagueForm.car_class, created_by: user.id }).select().single();
      if (error) throw error;
      if (slots.length) {
        const { error: racesError } = await supabase.from("races").insert(slots.map((slot, index) => slotPayload(slot, league.id, index + 1)));
        if (racesError) throw racesError;
      }
    },
    onSuccess: () => { invalidate(); toast.success("Seizoen aangemaakt!"); onComplete?.(); }, onError: failed,
  });
  const updateSeason = useMutation({
    mutationFn: async () => {
      if (!targetLeagueId) throw new Error("Er is geen seizoen geselecteerd.");
      const { error } = await supabase.from("leagues").update({ name: leagueForm.name, description: leagueForm.description || null, season: leagueForm.season || null, car_class: leagueForm.car_class || null }).eq("id", targetLeagueId);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success("Seizoen bijgewerkt!"); onComplete?.(); }, onError: failed,
  });
  const createRace = useMutation({
    mutationFn: async () => {
      if (isRaceCreate && !targetLeagueId) throw new Error("Selecteer eerst een seizoen voor deze race.");
      const seasonRaceCount = targetLeagueId ? races.filter((race) => race.league_id === targetLeagueId).length : 0;
      const slot: RaceSlot = { ...raceForm, date: raceForm.race_date.slice(0, 10), time: raceForm.race_date.slice(11, 16) || "20:00" };
      const { error } = await supabase.from("races").insert(slotPayload(slot, targetLeagueId, targetLeagueId ? seasonRaceCount + 1 : undefined));
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success(isSoloCreate ? "Losse race aangemaakt!" : "Race aangemaakt!"); onComplete?.(); }, onError: failed,
  });
  const updateRace = useMutation({
    mutationFn: async () => {
      if (!targetRace) throw new Error("De geselecteerde race kon niet worden gevonden.");
      const payload = isLobbyEdit
        ? { lobby_name: raceForm.lobby_name || null, lobby_password: raceForm.lobby_password || null, lobby_reveal_minutes: raceForm.lobby_reveal_minutes ?? 15 }
        : { ...standardPayload(raceForm), ...(isSoloEdit ? { lobby_name: raceForm.lobby_name || null, lobby_password: raceForm.lobby_password || null, lobby_reveal_minutes: raceForm.lobby_reveal_minutes ?? 15 } : {}) };
      const { error } = await supabase.from("races").update(payload).eq("id", targetRace.id);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success(isLobbyEdit ? "Lobby bijgewerkt!" : "Race opgeslagen!"); onComplete?.(); }, onError: failed,
  });

  const pending = createSeason.isPending || updateSeason.isPending || createRace.isPending || updateRace.isPending;
  const setRace = <K extends keyof RaceForm>(key: K, value: RaceForm[K]) => setRaceForm((current) => ({ ...current, [key]: value }));
  const resizeSlots = (raceCount: number) => {
    const count = Math.max(1, Math.min(24, raceCount || 1));
    setLeagueForm((current) => ({ ...current, raceCount: count }));
    setSlots((current) => Array.from({ length: count }, (_, index) => current[index] || defaultSlot(`Race ${index + 1}`, seasonDefaults)));
  };
  const setSeasonDefault = <K extends keyof SeasonRaceDefaults>(key: K, value: SeasonRaceDefaults[K]) => setSeasonDefaults((current) => ({ ...current, [key]: value }));
  const applySeasonDefaultsToSlots = () => setSlots((current) => current.map((slot) => ({ ...slot, ...seasonDefaults })));

  if (!canWrite) return <section className="rounded-xl border border-orange-400/20 bg-orange-400/[0.06] p-5 text-sm text-orange-100">Alleen admins en super-admins kunnen deze gegevens wijzigen.</section>;
  if ((isSeasonEdit || isRaceCreate) && !targetLeagueId) return <section className="rounded-xl border border-red-400/30 bg-red-500/[0.08] p-5 text-sm text-red-100">Deze actie mist de geselecteerde seizoencontext. Sluit dit paneel en open de actie opnieuw vanuit het seizoen.</section>;
  if ((isRaceEdit || isSoloEdit || isLobbyEdit) && !targetRace) return <section className="rounded-xl border border-red-400/30 bg-red-500/[0.08] p-5 text-sm text-red-100">De geselecteerde race wordt geladen of bestaat niet meer.</section>;

  const submit = () => { if (isSeasonCreate) createSeason.mutate(); else if (isSeasonEdit) updateSeason.mutate(); else if (isRaceCreate || isSoloCreate) createRace.mutate(); else updateRace.mutate(); };
  const raceTitle = isSoloCreate ? "Nieuwe losse race" : isSoloEdit ? "Losse race bewerken" : isRaceCreate ? "Nieuwe race" : "Race bewerken";

  return <section aria-label="Gerichte seizoen- of raceactie" className="mx-auto max-w-4xl space-y-6 text-gray-100">
    <header className="rounded-2xl border border-orange-400/20 bg-orange-500/[0.06] p-5">
      <div className="flex items-start gap-3"><div className="rounded-lg bg-orange-400/15 p-2 text-orange-200">{isLobbyEdit ? <KeyRound className="h-5 w-5" /> : isSeasonCreate || isSeasonEdit ? <Trophy className="h-5 w-5" /> : <CalendarDays className="h-5 w-5" />}</div><div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-300">Control Room · gerichte actie</p><h2 className="mt-1 font-heading text-xl font-black">{isSeasonCreate ? "Nieuw seizoen" : isSeasonEdit ? "Seizoen bewerken" : isLobbyEdit ? "Lobby beheren" : raceTitle}</h2>{targetLeague && <p className="mt-1 text-sm text-gray-300">Seizoencontext: <strong>{targetLeague.name}</strong>{targetLeague.season ? ` · ${targetLeague.season}` : ""}</p>}{targetRace && <p className="mt-1 text-sm text-gray-300">Racecontext: <strong>{targetRace.name}</strong> · {targetRace.track}</p>}</div></div>
    </header>

    {(isSeasonCreate || isSeasonEdit) && <div className="space-y-4 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5"><p className="text-xs font-black uppercase tracking-wider text-gray-400">Seizoensgegevens</p><div className="grid gap-4 md:grid-cols-2"><Field label="Naam *"><input value={leagueForm.name} onChange={(event) => setLeagueForm({ ...leagueForm, name: event.target.value })} placeholder="GT3 Championship" className={inputClass} /></Field><Field label="Seizoen"><input value={leagueForm.season} onChange={(event) => setLeagueForm({ ...leagueForm, season: event.target.value })} placeholder="2026 S1" className={inputClass} /></Field><Field label="Auto klasse"><input value={leagueForm.car_class} onChange={(event) => setLeagueForm({ ...leagueForm, car_class: event.target.value })} placeholder="GT3" className={inputClass} /></Field>{isSeasonCreate && <Field label="Aantal races"><input type="number" min={1} max={24} value={leagueForm.raceCount} onChange={(event) => resizeSlots(Number(event.target.value))} className={inputClass} /></Field>}<Field label="Beschrijving" className="md:col-span-2"><textarea rows={3} value={leagueForm.description} onChange={(event) => setLeagueForm({ ...leagueForm, description: event.target.value })} className={`${inputClass} resize-none`} /></Field></div>{isSeasonCreate && <><SeasonDefaults defaults={seasonDefaults} setDefault={setSeasonDefault} onApply={applySeasonDefaultsToSlots} /><RaceSlots slots={slots} setSlots={setSlots} /></>}</div>}

    {(isRaceCreate || isRaceEdit || isSoloCreate || isSoloEdit) && <div className="space-y-4 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5"><p className="text-xs font-black uppercase tracking-wider text-gray-400">{isSoloCreate || isSoloEdit ? "Losse-racegegevens" : "Racegegevens"}</p><RaceFields form={raceForm} set={setRace} includeLobby={isSoloCreate || isSoloEdit} /></div>}
    {isLobbyEdit && <div className="space-y-4 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5"><p className="text-xs font-black uppercase tracking-wider text-gray-400">Alleen lobbygegevens</p><LobbyFields form={raceForm} set={setRace} /></div>}

    <button type="button" onClick={submit} disabled={pending || (isSeasonCreate && !leagueForm.name) || ((isRaceCreate || isSoloCreate) && (!raceForm.name || !raceForm.track || !raceForm.race_date))} className="flex items-center gap-2 rounded-lg bg-gradient-racing px-5 py-3 text-sm font-black text-white shadow-lg shadow-orange-950/30 disabled:cursor-not-allowed disabled:opacity-50"><Save className="h-4 w-4" />{pending ? "Opslaan…" : isSeasonCreate || isRaceCreate || isSoloCreate ? "Aanmaken" : "Opslaan"}</button>
  </section>;
};

const inputClass = "w-full rounded-md border border-white/[0.12] bg-[#12151d] px-3 py-2 text-sm text-white outline-none placeholder:text-gray-600 focus:border-orange-400";
const Field = ({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) => <label className={`block text-xs font-bold uppercase tracking-wider text-gray-500 ${className}`}><span className="mb-1.5 block">{label}</span>{children}</label>;

const SeasonDefaults = ({ defaults, setDefault, onApply }: { defaults: SeasonRaceDefaults; setDefault: <K extends keyof SeasonRaceDefaults>(key: K, value: SeasonRaceDefaults[K]) => void; onApply: () => void }) => <section className="space-y-4 border-t border-white/[0.08] pt-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-black uppercase tracking-wider text-orange-300">Seizoensdefaults</p><p className="mt-1 text-sm text-gray-400">Basisinstellingen voor alle rondes. Per circuit kun je hieronder afwijken.</p></div><button type="button" onClick={onApply} className="rounded-md border border-orange-400/35 bg-orange-400/10 px-3 py-2 text-xs font-bold text-orange-100 hover:bg-orange-400/20">Pas toe op alle rondes</button></div><div className="grid gap-4 md:grid-cols-3"><SelectField label="Race type" value={defaults.race_type} values={["Sprint", "Feature", "Endurance"]} onChange={(value) => setDefault("race_type", value)} /><Field label="Race duur"><input value={defaults.race_duration} onChange={(event) => setDefault("race_duration", event.target.value)} className={inputClass} /></Field><Field label="Practice"><input value={defaults.practice_duration} onChange={(event) => setDefault("practice_duration", event.target.value)} className={inputClass} /></Field><Field label="Qualifying"><input value={defaults.qualifying_duration} onChange={(event) => setDefault("qualifying_duration", event.target.value)} className={inputClass} /></Field><SelectField label="Start type" value={defaults.start_type} values={["Standing", "Rolling"]} onChange={(value) => setDefault("start_type", value)} /><SelectField label="Weather" value={defaults.weather} values={["Fixed", "Clear", "Partly Cloudy", "Overcast", "Rain", "Dynamic"]} onChange={(value) => setDefault("weather", value)} /><SelectField label="Setup" value={defaults.setup} values={["Fixed", "Open"]} onChange={(value) => setDefault("setup", value)} /><Field label="Lobby vrijgeven (min)"><input type="number" min={1} max={120} value={defaults.lobby_reveal_minutes} onChange={(event) => setDefault("lobby_reveal_minutes", Number(event.target.value))} className={inputClass} /></Field></div></section>;

const RaceSlots = ({ slots, setSlots }: { slots: RaceSlot[]; setSlots: React.Dispatch<React.SetStateAction<RaceSlot[]>> }) => <div className="space-y-3 border-t border-white/[0.08] pt-5"><div><p className="text-xs font-black uppercase tracking-wider text-gray-400">Rondes & circuitcondities · 1–{slots.length}</p><p className="mt-1 text-sm text-gray-500">Elke ronde start met de seizoensdefaults; open de details alleen wanneer dit circuit afwijkt.</p></div>{slots.map((slot, index) => { const set = <K extends keyof RaceSlot>(key: K, value: RaceSlot[K]) => setSlots((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item)); return <div key={index} className="rounded-lg border border-white/[0.07] bg-black/10 p-3"><div className="grid gap-3 md:grid-cols-4"><Field label={`Ronde ${index + 1} · naam`}><input value={slot.name} onChange={(event) => set("name", event.target.value)} className={inputClass} /></Field><Field label="Circuit"><TrackSelect value={slot.track} onChange={(value) => set("track", value)} className={inputClass} /></Field><Field label="Datum"><input type="date" value={slot.date} onChange={(event) => set("date", event.target.value)} className={inputClass} /></Field><Field label="Tijd"><input type="time" value={slot.time} onChange={(event) => set("time", event.target.value)} className={inputClass} /></Field></div><details className="mt-3 rounded-md border border-white/[0.07] bg-white/[0.02] p-3"><summary className="cursor-pointer text-xs font-bold text-orange-200">Afwijkende sessie- of circuitcondities voor deze ronde</summary><div className="mt-4 grid gap-4 md:grid-cols-3"><SelectField label="Race type" value={slot.race_type} values={["Sprint", "Feature", "Endurance"]} onChange={(value) => set("race_type", value)} /><Field label="Race duur"><input value={slot.race_duration} onChange={(event) => set("race_duration", event.target.value)} className={inputClass} /></Field><Field label="Practice"><input value={slot.practice_duration} onChange={(event) => set("practice_duration", event.target.value)} className={inputClass} /></Field><Field label="Qualifying"><input value={slot.qualifying_duration} onChange={(event) => set("qualifying_duration", event.target.value)} className={inputClass} /></Field><SelectField label="Start type" value={slot.start_type} values={["Standing", "Rolling"]} onChange={(value) => set("start_type", value)} /><SelectField label="Weather" value={slot.weather} values={["Fixed", "Clear", "Partly Cloudy", "Overcast", "Rain", "Dynamic"]} onChange={(value) => set("weather", value)} /><SelectField label="Setup" value={slot.setup} values={["Fixed", "Open"]} onChange={(value) => set("setup", value)} /><Field label="Lobby vrijgeven (min)"><input type="number" min={1} max={120} value={slot.lobby_reveal_minutes} onChange={(event) => set("lobby_reveal_minutes", Number(event.target.value))} className={inputClass} /></Field></div></details></div>; })}</div>;

const RaceFields = ({ form, set, includeLobby }: { form: RaceForm; set: <K extends keyof RaceForm>(key: K, value: RaceForm[K]) => void; includeLobby: boolean }) => <><div className="grid gap-4 md:grid-cols-3"><Field label="Naam *"><input value={form.name} onChange={(event) => set("name", event.target.value)} className={inputClass} /></Field><div className="col-span-2"><Field label="Circuit *"><TrackSelect value={form.track} onChange={(value) => set("track", value)} className={inputClass} /></Field></div><SelectField label="Race type" value={form.race_type} values={["Sprint", "Feature", "Endurance"]} onChange={(value) => set("race_type", value)} /><Field label="Race duur"><input value={form.race_duration} onChange={(event) => set("race_duration", event.target.value)} className={inputClass} /></Field><Field label="Practice"><input value={form.practice_duration} onChange={(event) => set("practice_duration", event.target.value)} className={inputClass} /></Field><Field label="Qualifying"><input value={form.qualifying_duration} onChange={(event) => set("qualifying_duration", event.target.value)} className={inputClass} /></Field><SelectField label="Start type" value={form.start_type} values={["Standing", "Rolling"]} onChange={(value) => set("start_type", value)} /><SelectField label="Weather" value={form.weather} values={["Fixed", "Clear", "Partly Cloudy", "Overcast", "Rain", "Dynamic"]} onChange={(value) => set("weather", value)} /><SelectField label="Setup" value={form.setup} values={["Fixed", "Open"]} onChange={(value) => set("setup", value)} /><SelectField label="Status" value={form.status} values={["upcoming", "live", "completed", "cancelled"]} onChange={(value) => set("status", value)} /><Field label="Datum & tijd *"><input type="datetime-local" value={form.race_date} onChange={(event) => set("race_date", event.target.value)} className={inputClass} /></Field></div>{includeLobby && <div className="border-t border-white/[0.08] pt-4"><p className="mb-3 text-xs font-black uppercase tracking-wider text-gray-400">Lobby van deze losse race</p><LobbyFields form={form} set={set} /></div>}</>;
const LobbyFields = ({ form, set }: { form: RaceForm; set: <K extends keyof RaceForm>(key: K, value: RaceForm[K]) => void }) => <div className="grid gap-4 md:grid-cols-3"><Field label="Lobby naam"><input value={form.lobby_name} onChange={(event) => set("lobby_name", event.target.value)} className={inputClass} /></Field><Field label="Wachtwoord"><input value={form.lobby_password} onChange={(event) => set("lobby_password", event.target.value)} className={inputClass} /></Field><Field label="Vrijgeven (min voor start)"><input type="number" min={1} max={120} value={form.lobby_reveal_minutes} onChange={(event) => set("lobby_reveal_minutes", Number(event.target.value))} className={inputClass} /></Field></div>;
const SelectField = ({ label, value, values, onChange }: { label: string; value: string; values: string[]; onChange: (value: string) => void }) => <Field label={label}><select value={value} onChange={(event) => onChange(event.target.value)} className={inputClass}><option value="">—</option>{values.map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>;

export default SeasonRaceActionForm;
