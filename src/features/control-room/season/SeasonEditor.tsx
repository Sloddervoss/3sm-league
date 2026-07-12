import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  CalendarDays,
  ChevronDown,
  Flag,
  KeyRound,
  Pencil,
  Plus,
  Save,
  Trash2,
  Trophy,
  Users,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { amsToUTC, utcToAmsLocal } from "@/lib/dateHelpers";
import { TrackSelect } from "@/components/admin/TrackSelect";
import { toast } from "sonner";

/* ──────────────────────────────────────────────
   Shared types (mirrors SeasonsAdmin types)
   ────────────────────────────────────────────── */

export type SeasonEditorLeague = {
  id: string;
  name: string;
  description: string | null;
  season: string | null;
  car_class: string | null;
  races: SeasonEditorRace[];
};

export type SeasonEditorRace = {
  id: string;
  name: string;
  track: string;
  race_date: string | null;
  round: number | null;
  status: string | null;
  race_type: string | null;
  race_duration: string | null;
  practice_duration: string | null;
  qualifying_duration: string | null;
  start_type: string | null;
  weather: string | null;
  setup: string | null;
  lobby_name: string | null;
  lobby_password: string | null;
  lobby_reveal_minutes: number | null;
};

export type SeasonEditorSoloRace = {
  id: string;
  league_id: string | null;
  name: string;
  track: string;
  race_date: string | null;
  status: string | null;
  race_type: string | null;
  race_duration: string | null;
  practice_duration: string | null;
  qualifying_duration: string | null;
  start_type: string | null;
  weather: string | null;
  setup: string | null;
  lobby_name: string | null;
  lobby_password: string | null;
  lobby_reveal_minutes: number | null;
  leagues: { name: string; season: string | null } | null;
};

/** Data shape for a single race slot when creating a new league with races. */
type RaceSlot = {
  name: string; track: string; date: string; time: string;
  race_type: string; race_duration: string; practice_duration: string;
  qualifying_duration: string; start_type: string; weather: string; setup: string;
  lobby_name: string; lobby_password: string; lobby_reveal_minutes: number;
};

const SOLO_RACE_DEFAULTS: RaceSlot = {
  name: "", track: "", date: "", time: "20:00", race_type: "Feature",
  race_duration: "60 min", practice_duration: "15 min", qualifying_duration: "10 min",
  start_type: "Standing", weather: "Fixed", setup: "Fixed",
  lobby_name: "", lobby_password: "", lobby_reveal_minutes: 15,
};

/* ──────────────────────────────────────────────
   Mutations – typed callbacks (no production writes)
   ────────────────────────────────────────────── */

export type SeasonEditorAction =
  | { type: "create-league"; data: { name: string; description: string; season: string; car_class: string; races: RaceSlot[] } }
  | { type: "update-league"; id: string; data: { name: string; description: string; season: string; car_class: string } }
  | { type: "delete-league"; id: string }
  | { type: "create-race"; leagueId: string; data: RaceSlot }
  | { type: "update-race"; id: string; data: SeasonEditorRaceUpdate }
  | { type: "delete-race"; id: string }
  | { type: "create-solo-race"; data: RaceSlot }
  | { type: "update-solo-race"; id: string; data: SeasonEditorRaceUpdate }
  | { type: "delete-solo-race"; id: string };

export type SeasonEditorRaceUpdate = {
  name?: string | null;
  track?: string | null;
  race_date?: string | null;
  race_type?: string | null;
  race_duration?: string | null;
  practice_duration?: string | null;
  qualifying_duration?: string | null;
  start_type?: string | null;
  weather?: string | null;
  setup?: string | null;
  status?: string | null;
  round?: number | null;
  lobby_name?: string | null;
  lobby_password?: string | null;
  lobby_reveal_minutes?: number | null;
};

export type SeasonEditorFocus = { seasonId?: string; raceId?: string; action?: "create-season" | "create-race" | "edit-season" | "edit-race" | "edit-lobby" | "edit-solo-race" };

export type SeasonEditorProps = {
  onAction?: (action: SeasonEditorAction) => void;
  /** Opens the exact season/race selected in the Control Room list. */
  focus?: SeasonEditorFocus | null;
};

/* ──────────────────────────────────────────────
   SeasonEditor component
   ────────────────────────────────────────────── */

export const SeasonEditor = ({ onAction, focus }: SeasonEditorProps) => {
  const { user, isAdmin, isSuperAdmin } = useAuth();
  const queryClient = useQueryClient();
  const canWrite = Boolean(user && (isAdmin || isSuperAdmin));

  /* ── League creation state ── */
  const [showLeagueForm, setShowLeagueForm] = useState(false);
  const [newLeague, setNewLeague] = useState({ name: "", description: "", season: "", car_class: "", raceCount: 6 });
  const [races, setRaces] = useState<RaceSlot[]>([]);

  /* ── League editing state ── */
  const [editingLeagueId, setEditingLeagueId] = useState<string | null>(null);
  const [selectedLeagueId, setSelectedLeagueId] = useState<string | null>(null);
  const [focusedRaceId, setFocusedRaceId] = useState<string | null>(null);
  const [startRaceCreation, setStartRaceCreation] = useState(false);
  const [editingLeagueData, setEditingLeagueData] = useState({ name: "", description: "", season: "", car_class: "" });
  const [editingRaces, setEditingRaces] = useState<Record<string, SeasonEditorRaceUpdate>>({});

  /* ── Solo race state ── */
  const [showSoloRaceForm, setShowSoloRaceForm] = useState(false);
  const [newSoloRace, setNewSoloRace] = useState<RaceSlot>({ ...SOLO_RACE_DEFAULTS });
  const [editingSoloRaceId, setEditingSoloRaceId] = useState<string | null>(null);
  const [editingSoloRaceData, setEditingSoloRaceData] = useState<SeasonEditorRaceUpdate>({});
  const [showCompletedSoloRaces, setShowCompletedSoloRaces] = useState(false);

  /* ── Read queries ── */
  const { data: leagues } = useQuery({
    queryKey: ["admin-leagues"],
    queryFn: async (): Promise<SeasonEditorLeague[]> => {
      const { data, error } = await supabase.from("leagues").select("*, races(*)");
      if (error) throw error;
      return (data || []) as SeasonEditorLeague[];
    },
  });

  const { data: allRaces } = useQuery({
    queryKey: ["all-races-admin"],
    queryFn: async (): Promise<SeasonEditorSoloRace[]> => {
      const { data, error } = await supabase
        .from("races")
        .select("id, name, track, race_date, league_id, status, practice_duration, qualifying_duration, race_duration, start_type, weather, setup, lobby_name, lobby_password, lobby_reveal_minutes, leagues(name, season)")
        .order("race_date", { ascending: true });
      if (error) throw error;
      return (data || []) as SeasonEditorSoloRace[];
    },
  });

  useEffect(() => {
    if (!focus || !leagues || !allRaces) return;

    if (focus.action === "create-season") { setShowLeagueForm(true); return; }

    const leagueId = focus.seasonId || allRaces.find((race) => race.id === focus.raceId)?.league_id || null;
    if (leagueId) {
      const league = leagues.find((candidate) => candidate.id === leagueId);
      if (league) {
        setSelectedLeagueId(league.id);
        setEditingLeagueId(league.id);
        setEditingLeagueData({ name: league.name, description: league.description || "", season: league.season || "", car_class: league.car_class || "" });
        const raceMap: Record<string, SeasonEditorRaceUpdate> = {};
        league.races?.forEach((race) => { raceMap[race.id] = { ...race }; });
        setEditingRaces(raceMap);
        setFocusedRaceId(focus.raceId || null);
        setStartRaceCreation(focus.action === "create-race");
        return;
      }
    }

    if (focus.raceId) {
      const soloRace = allRaces.find((race) => race.id === focus.raceId && !race.league_id);
      if (soloRace) {
        setEditingSoloRaceId(soloRace.id);
        setEditingSoloRaceData({ ...soloRace });
      }
    }
  }, [allRaces, focus, leagues]);

  useEffect(() => {
    if (!selectedLeagueId && leagues?.[0]) {
      const league = leagues[0];
      setSelectedLeagueId(league.id);
      setEditingLeagueId(league.id);
      setEditingLeagueData({ name: league.name, description: league.description || "", season: league.season || "", car_class: league.car_class || "" });
      setEditingRaces(Object.fromEntries((league.races || []).map((race) => [race.id, { ...race }])));
    }
  }, [leagues, selectedLeagueId]);

  /* ── Helpers ── */
  const generateRaceSlots = () => {
    setRaces(Array.from({ length: newLeague.raceCount }, (_, i) => ({
      name: `Race ${i + 1}`, track: "", date: "", time: "20:00", race_type: "Feature",
      race_duration: "60 min", practice_duration: "15 min", qualifying_duration: "10 min",
      start_type: "Standing", weather: "Fixed", setup: "Fixed",
      lobby_name: "", lobby_password: "", lobby_reveal_minutes: 15,
    })));
  };

  /* ── Live mutations: kept field-for-field aligned with SeasonsAdmin. ── */
  const invalidateSeasonQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["admin-leagues"] });
    queryClient.invalidateQueries({ queryKey: ["all-races-admin"] });
    queryClient.invalidateQueries({ queryKey: ["races-with-leagues"] });
  };
  const notify = (action: SeasonEditorAction) => onAction?.(action);
  const mutationError = (error: Error) => toast.error(error.message);
  const raceUpdatePayload = (data: SeasonEditorRaceUpdate) => {
    const localDate = data.race_date
      ? (data.race_date.length > 16 ? utcToAmsLocal(data.race_date) : data.race_date)
      : null;
    return {
      name: data.name, track: data.track,
      race_date: localDate ? amsToUTC(localDate) : null,
      race_type: data.race_type || null, race_duration: data.race_duration || null,
      practice_duration: data.practice_duration || null, qualifying_duration: data.qualifying_duration || null,
      start_type: data.start_type || null, weather: data.weather || null, setup: data.setup || null,
      status: data.status || "upcoming",
      lobby_name: data.lobby_name || null, lobby_password: data.lobby_password || null,
      lobby_reveal_minutes: data.lobby_reveal_minutes ?? 15,
    };
  };
  const raceInsertPayload = (slot: RaceSlot, leagueId: string | null, round?: number) => ({
    league_id: leagueId, ...(round ? { round } : {}), name: slot.name, track: slot.track,
    race_date: amsToUTC(`${slot.date}T${slot.time}`), status: "upcoming" as const,
    race_type: slot.race_type || null, race_duration: slot.race_duration || null,
    practice_duration: slot.practice_duration || null, qualifying_duration: slot.qualifying_duration || null,
    start_type: slot.start_type || null, weather: slot.weather || null, setup: slot.setup || null,
    lobby_name: slot.lobby_name || null, lobby_password: slot.lobby_password || null,
    lobby_reveal_minutes: slot.lobby_reveal_minutes ?? 15,
  });

  const createLeague = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Je moet ingelogd zijn om een seizoen aan te maken.");
      const { data: league, error } = await supabase.from("leagues")
        .insert({ name: newLeague.name, description: newLeague.description, season: newLeague.season, car_class: newLeague.car_class, created_by: user.id })
        .select().single();
      if (error) throw error;
      if (races.length) {
        const { error: racesError } = await supabase.from("races").insert(races.map((race, index) => raceInsertPayload(race, league.id, index + 1)));
        if (racesError) throw racesError;
      }
      return league;
    },
    onSuccess: () => { toast.success("Seizoen aangemaakt!"); invalidateSeasonQueries(); setShowLeagueForm(false); setNewLeague({ name: "", description: "", season: "", car_class: "", raceCount: 6 }); setRaces([]); },
    onError: mutationError,
  });
  const updateLeague = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof editingLeagueData }) => {
      const { error } = await supabase.from("leagues").update({ name: data.name, description: data.description || null, season: data.season || null, car_class: data.car_class || null }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Seizoen bijgewerkt!"); queryClient.invalidateQueries({ queryKey: ["admin-leagues"] }); setEditingLeagueId(null); setEditingRaces({}); },
    onError: mutationError,
  });
  const deleteLeague = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("leagues").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { toast.success("Verwijderd"); invalidateSeasonQueries(); }, onError: mutationError,
  });
  const createSeasonRace = useMutation({
    mutationFn: async ({ leagueId, slot, round }: { leagueId: string; slot: RaceSlot; round: number }) => {
      const { error } = await supabase.from("races").insert(raceInsertPayload(slot, leagueId, round)); if (error) throw error;
    },
    onSuccess: () => { toast.success("Race aangemaakt!"); invalidateSeasonQueries(); }, onError: mutationError,
  });
  const updateRace = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: SeasonEditorRaceUpdate }) => {
      const { error } = await supabase.from("races").update(raceUpdatePayload(data)).eq("id", id); if (error) throw error;
    },
    onSuccess: () => { toast.success("Race opgeslagen!"); invalidateSeasonQueries(); }, onError: mutationError,
  });
  const deleteRace = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("races").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { toast.success("Race verwijderd"); invalidateSeasonQueries(); }, onError: mutationError,
  });
  const createSoloRace = useMutation({
    mutationFn: async () => { const { error } = await supabase.from("races").insert(raceInsertPayload(newSoloRace, null)); if (error) throw error; },
    onSuccess: () => { toast.success("Losse race aangemaakt!"); queryClient.invalidateQueries({ queryKey: ["all-races-admin"] }); setShowSoloRaceForm(false); setNewSoloRace({ ...SOLO_RACE_DEFAULTS }); }, onError: mutationError,
  });

  const handleCreateLeague = () => { notify({ type: "create-league", data: { name: newLeague.name, description: newLeague.description, season: newLeague.season, car_class: newLeague.car_class, races } }); createLeague.mutate(); };
  const handleUpdateLeague = () => { if (!editingLeagueId) return; notify({ type: "update-league", id: editingLeagueId, data: editingLeagueData }); updateLeague.mutate({ id: editingLeagueId, data: editingLeagueData }); };
  const requestDelete = (label: string, remove: () => void) => {
    if (window.confirm(`${label} verwijderen? Deze actie kan niet ongedaan worden gemaakt.`)) remove();
  };
  const handleDeleteLeague = (id: string) => requestDelete("Dit seizoen", () => { notify({ type: "delete-league", id }); deleteLeague.mutate(id); });
  const handleCreateSoloRace = () => { notify({ type: "create-solo-race", data: newSoloRace }); createSoloRace.mutate(); };
  const handleUpdateSoloRace = () => { if (!editingSoloRaceId) return; notify({ type: "update-solo-race", id: editingSoloRaceId, data: editingSoloRaceData }); updateRace.mutate({ id: editingSoloRaceId, data: editingSoloRaceData }, { onSuccess: () => { setEditingSoloRaceId(null); setEditingSoloRaceData({}); } }); };
  const handleDeleteSoloRace = (id: string) => requestDelete("Deze losse race", () => { notify({ type: "delete-solo-race", id }); deleteRace.mutate(id); });


  /* ── Solo race data ── */
  const soloRaces = useMemo(() => (allRaces || []).filter((r) => !r.leagues && !r.league_id), [allRaces]);
  const upcomingRaces = useMemo(() => soloRaces.filter((r) => r.status !== "completed"), [soloRaces]);
  const completedRaces = useMemo(() => soloRaces.filter((r) => r.status === "completed"), [soloRaces]);

  /* ── Render ── */
  const selectedLeague = leagues?.find((league) => league.id === selectedLeagueId) || null;
  return (
    <section aria-label="Seizoen- en race-editor" className="space-y-6 text-gray-100">
      <header className="flex flex-col gap-4 border-b border-white/[0.08] pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-300">Control Room · kalender</p>
          <h2 className="mt-1 font-heading text-2xl font-black">{selectedLeague ? selectedLeague.name : "Seizoensplanning"}</h2>
          <p className="mt-1 text-sm text-gray-400">{selectedLeague ? `${selectedLeague.season || "Seizoen"}${selectedLeague.car_class ? ` · ${selectedLeague.car_class}` : ""} · ${selectedLeague.races?.length || 0} races` : "Kies een seizoen om de kalender direct te bewerken."}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => { setShowLeagueForm(!showLeagueForm); if (!showLeagueForm) generateRaceSlots(); }}
            disabled={!canWrite || createLeague.isPending}
            className="flex items-center gap-2 rounded-lg bg-gradient-racing px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-orange-950/25 transition hover:opacity-90 disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />Nieuw Seizoen
          </button>
          <button
            onClick={() => setShowSoloRaceForm(!showSoloRaceForm)}
            disabled={!canWrite || createSoloRace.isPending}
            className="flex items-center gap-2 rounded-lg border border-white/[0.10] bg-white/[0.035] px-4 py-2.5 text-sm font-bold text-gray-200 transition hover:border-orange-400/40 hover:text-white disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />Losse Race
          </button>
        </div>
      </header>

      {/* ── NEW LEAGUE FORM ── */}
      {showLeagueForm && (
        <LeagueCreateForm
          newLeague={newLeague}
          setNewLeague={setNewLeague}
          races={races}
          setRaces={setRaces}
          generateRaceSlots={generateRaceSlots}
          onCreate={handleCreateLeague}
          isPending={createLeague.isPending}
          onCancel={() => setShowLeagueForm(false)}
        />
      )}

      <div className="grid gap-5 xl:grid-cols-[14rem_minmax(0,1fr)]">
        <nav aria-label="Seizoenskeuze" className="flex gap-2 overflow-x-auto xl:block xl:space-y-2 xl:overflow-visible">
          {(leagues || []).map((league) => (
            <button key={league.id} type="button" onClick={() => { setSelectedLeagueId(league.id); setEditingLeagueId(league.id); setFocusedRaceId(null); setStartRaceCreation(false); setEditingLeagueData({ name: league.name, description: league.description || "", season: league.season || "", car_class: league.car_class || "" }); setEditingRaces(Object.fromEntries((league.races || []).map((race) => [race.id, { ...race }]))); }} className={`min-w-[11rem] rounded-xl border p-3 text-left transition xl:block xl:w-full ${selectedLeagueId === league.id ? "border-orange-400/35 bg-orange-500/[0.10] shadow-lg shadow-orange-950/15" : "border-white/[0.07] bg-white/[0.025] hover:border-white/[0.14] hover:bg-white/[0.045]"}`}>
              <span className="block truncate text-sm font-bold text-white">{league.name}</span>
              <span className="mt-1 block text-xs text-gray-500">{league.season || "Naamloos seizoen"} · {league.races?.length || 0} races</span>
            </button>
          ))}
        </nav>
        <div>
          {selectedLeague ? <LeagueCard
            key={selectedLeague.id}
            league={selectedLeague}
            isEditing={editingLeagueId === selectedLeague.id}
            editingLeagueData={editingLeagueData}
            setEditingLeagueData={setEditingLeagueData}
            editingRaces={editingRaces}
            setEditingRaces={setEditingRaces}
            onEdit={() => { setEditingLeagueId(selectedLeague.id); setEditingLeagueData({ name: selectedLeague.name, description: selectedLeague.description || "", season: selectedLeague.season || "", car_class: selectedLeague.car_class || "" }); setEditingRaces(Object.fromEntries((selectedLeague.races || []).map((race) => [race.id, { ...race }]))); }}
            onCancelEdit={() => { setEditingLeagueId(null); setEditingRaces({}); setFocusedRaceId(null); }}
            onUpdateLeague={handleUpdateLeague}
            onDeleteLeague={handleDeleteLeague}
            onCreateRace={(slot) => { notify({ type: "create-race", leagueId: selectedLeague.id, data: slot }); createSeasonRace.mutate({ leagueId: selectedLeague.id, slot, round: (selectedLeague.races?.length || 0) + 1 }); }}
            onUpdateRace={(id, data) => { notify({ type: "update-race", id, data }); updateRace.mutate({ id, data }); }}
            onDeleteRace={(id) => requestDelete("Deze race", () => { notify({ type: "delete-race", id }); deleteRace.mutate(id); })}
            canWrite={canWrite}
            isSaving={createSeasonRace.isPending || updateRace.isPending || deleteRace.isPending || updateLeague.isPending || deleteLeague.isPending}
            focusedRaceId={focusedRaceId}
            startRaceCreation={startRaceCreation}
            onRaceCreationStarted={() => setStartRaceCreation(false)}
          /> : <div className="rounded-xl border border-dashed border-white/[0.12] bg-white/[0.02] py-16 text-center text-gray-500"><Trophy className="mx-auto mb-3 h-10 w-10 opacity-40" /><p>Nog geen seizoenen.</p></div>}
        </div>
      </div>

      {/* ── SOLO RACES ── */}
      <div className="mt-10">
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-heading text-2xl font-black">LOSSE RACES</h2>
        </div>

        {showSoloRaceForm && (
          <SoloRaceCreateForm
            newSoloRace={newSoloRace}
            setNewSoloRace={setNewSoloRace}
            onCreate={handleCreateSoloRace}
            isPending={createSoloRace.isPending}
            onCancel={() => setShowSoloRaceForm(false)}
          />
        )}

        <div className="space-y-3">
          {upcomingRaces.map((race) => (
            <SoloRaceCard
              key={race.id}
              race={race}
              isEditing={editingSoloRaceId === race.id}
              editingData={editingSoloRaceData}
              setEditingData={setEditingSoloRaceData}
              onEdit={() => {
                setEditingSoloRaceId(race.id);
                setEditingSoloRaceData({ ...race, race_date: race.race_date ? utcToAmsLocal(race.race_date) : "" });
              }}
              onCancelEdit={() => { setEditingSoloRaceId(null); setEditingSoloRaceData({}); }}
              onUpdate={handleUpdateSoloRace}
              onDelete={handleDeleteSoloRace}
              canWrite={canWrite}
              isSaving={updateRace.isPending || deleteRace.isPending}
            />
          ))}
          {upcomingRaces.length === 0 && completedRaces.length === 0 && (
            <div className="text-center py-10 text-muted-foreground text-sm">Geen losse races aangemaakt.</div>
          )}
        </div>

        {completedRaces.length > 0 && (
          <div className="mt-4">
            <button
              onClick={() => setShowCompletedSoloRaces(v => !v)}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3"
            >
              <ChevronDown className={`w-4 h-4 transition-transform ${showCompletedSoloRaces ? "rotate-180" : ""}`} />
              {showCompletedSoloRaces ? "Verberg" : "Toon"} afgelopen races ({completedRaces.length})
            </button>
            {showCompletedSoloRaces && (
              <div className="space-y-3">
                {completedRaces.map((race) => (
                  <SoloRaceCard
                    key={race.id}
                    race={race}
                    isEditing={editingSoloRaceId === race.id}
                    editingData={editingSoloRaceData}
                    setEditingData={setEditingSoloRaceData}
                    onEdit={() => {
                      setEditingSoloRaceId(race.id);
                      setEditingSoloRaceData({ ...race, race_date: race.race_date ? utcToAmsLocal(race.race_date) : "" });
                    }}
                    onCancelEdit={() => { setEditingSoloRaceId(null); setEditingSoloRaceData({}); }}
                    onUpdate={handleUpdateSoloRace}
                    onDelete={handleDeleteSoloRace}
                    canWrite={canWrite}
                    isSaving={updateRace.isPending || deleteRace.isPending}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
};

export default SeasonEditor;

/* ══════════════════════════════════════════════
   LEAGUE CREATE FORM
   ══════════════════════════════════════════════ */

type LeagueCreateFormProps = {
  newLeague: { name: string; description: string; season: string; car_class: string; raceCount: number };
  setNewLeague: React.Dispatch<React.SetStateAction<{ name: string; description: string; season: string; car_class: string; raceCount: number }>>;
  races: RaceSlot[];
  setRaces: React.Dispatch<React.SetStateAction<RaceSlot[]>>;
  generateRaceSlots: () => void;
  onCreate: () => void;
  isPending: boolean;
  onCancel: () => void;
};

const LeagueCreateForm = ({
  newLeague, setNewLeague, races, setRaces, generateRaceSlots, onCreate, isPending, onCancel,
}: LeagueCreateFormProps) => (
  <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-6 rounded-[1.35rem] border border-orange-400/20 bg-gradient-to-br from-orange-500/[0.09] via-white/[0.035] to-white/[0.02] p-6 shadow-2xl shadow-black/20">
    <h3 className="font-heading text-lg font-bold mb-4">NIEUW SEIZOEN</h3>
    <div className="grid gap-4 md:grid-cols-2 mb-4">
      <div>
        <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Naam *</label>
        <input type="text" value={newLeague.name} onChange={(e) => setNewLeague({ ...newLeague, name: e.target.value })} placeholder="GT3 Championship" className="w-full px-4 py-2.5 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
      </div>
      <div>
        <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Seizoen</label>
        <input type="text" value={newLeague.season} onChange={(e) => setNewLeague({ ...newLeague, season: e.target.value })} placeholder="2026 S1" className="w-full px-4 py-2.5 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
      </div>
      <div>
        <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Auto Klasse</label>
        <input type="text" value={newLeague.car_class} onChange={(e) => setNewLeague({ ...newLeague, car_class: e.target.value })} placeholder="GT3" className="w-full px-4 py-2.5 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
      </div>
      <div>
        <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Aantal Races</label>
        <input type="number" min={1} max={24} value={newLeague.raceCount} onChange={(e) => setNewLeague({ ...newLeague, raceCount: parseInt(e.target.value) || 1 })} className="w-full px-4 py-2.5 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
      </div>
      <div className="md:col-span-2">
        <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Beschrijving</label>
        <textarea value={newLeague.description} onChange={(e) => setNewLeague({ ...newLeague, description: e.target.value })} rows={2} className="w-full px-4 py-2.5 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none" />
      </div>
    </div>
    <button onClick={generateRaceSlots} className="mb-4 px-3 py-1.5 rounded-md border border-border text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">Genereer {newLeague.raceCount} race slots</button>

    {races.length > 0 && (
      <div className="space-y-3 mb-4">
        {races.map((race, i) => {
          const upd = (key: keyof RaceSlot, val: string) => {
            const u = [...races]; u[i] = { ...u[i], [key]: val }; setRaces(u);
          };
          return (
            <div key={i} className="p-3 bg-secondary/50 rounded-md border border-border/50 space-y-2">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <input type="text" value={race.name} onChange={(e) => upd("name", e.target.value)} placeholder={`Race ${i + 1}`} className="px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                <TrackSelect value={race.track} onChange={(v) => upd("track", v)} />
                <input type="date" value={race.date} onChange={(e) => upd("date", e.target.value)} className="px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                <input type="time" value={race.time} onChange={(e) => upd("time", e.target.value)} className="px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
              </div>
            </div>
          );
        })}
      </div>
    )}

    <div className="flex gap-3">
      <button onClick={onCreate} disabled={!newLeague.name || isPending} className="px-6 py-2.5 rounded-md bg-gradient-racing text-white font-heading font-bold text-sm disabled:opacity-50 hover:opacity-90 transition-opacity">{isPending ? "Aanmaken..." : "Aanmaken"}</button>
      <button onClick={onCancel} disabled={isPending} className="px-6 py-2.5 rounded-md border border-border text-muted-foreground font-heading font-bold text-sm hover:text-foreground transition-colors disabled:opacity-50">Annuleren</button>
    </div>
  </motion.div>
);

/* ══════════════════════════════════════════════
   LEAGUE CARD
   ══════════════════════════════════════════════ */

type LeagueCardProps = {
  league: SeasonEditorLeague;
  isEditing: boolean;
  editingLeagueData: { name: string; description: string; season: string; car_class: string };
  setEditingLeagueData: React.Dispatch<React.SetStateAction<{ name: string; description: string; season: string; car_class: string }>>;
  editingRaces: Record<string, SeasonEditorRaceUpdate>;
  setEditingRaces: React.Dispatch<React.SetStateAction<Record<string, SeasonEditorRaceUpdate>>>;
  onEdit: () => void;
  onCancelEdit: () => void;
  onUpdateLeague: () => void;
  onDeleteLeague: (id: string) => void;
  onCreateRace: (slot: RaceSlot) => void;
  onUpdateRace: (id: string, data: SeasonEditorRaceUpdate) => void;
  onDeleteRace: (id: string) => void;
  canWrite: boolean;
  isSaving: boolean;
  /** Control Room context opens this exact race instead of a generic list. */
  focusedRaceId?: string | null;
  startRaceCreation?: boolean;
  onRaceCreationStarted?: () => void;
};

const LeagueCard = ({
  league, isEditing, editingLeagueData, setEditingLeagueData,
  editingRaces, setEditingRaces, onEdit, onCancelEdit,
  onUpdateLeague, onDeleteLeague, onCreateRace, onUpdateRace, onDeleteRace, canWrite, isSaving,
  focusedRaceId, startRaceCreation, onRaceCreationStarted,
}: LeagueCardProps) => {
  const [addingRace, setAddingRace] = useState(false);
  const [newRace, setNewRace] = useState<RaceSlot>({ ...SOLO_RACE_DEFAULTS, name: `Race ${(league.races?.length || 0) + 1}` });
  useEffect(() => {
    if (startRaceCreation) {
      setAddingRace(true);
      onRaceCreationStarted?.();
    }
  }, [onRaceCreationStarted, startRaceCreation]);
  const setRd = (raceId: string, field: keyof SeasonEditorRaceUpdate, val: string | number) =>
    setEditingRaces((prev) => ({ ...prev, [raceId]: { ...prev[raceId], [field]: val } }));

  return (
    <div className="rounded-[1.35rem] border border-white/[0.08] bg-white/[0.025] p-5 shadow-2xl shadow-black/18">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-heading font-bold text-lg">{league.name}</h3>
          <div className="flex gap-3 text-sm text-muted-foreground mt-1">
            {league.season && <span>{league.season}</span>}
            {league.car_class && <span>• {league.car_class}</span>}
            <span>• {league.races?.length || 0} races</span>
          </div>
          {league.description && <p className="text-sm text-muted-foreground mt-1 max-w-xl">{league.description}</p>}
        </div>
        <div className="flex items-center gap-1">
          {canWrite && (
            <>
              <button onClick={onEdit} className="p-2 text-muted-foreground hover:text-primary transition-colors" title="Bewerken">
                <Pencil className="w-4 h-4" />
              </button>
              <button onClick={() => onDeleteLeague(league.id)} className="p-2 text-muted-foreground hover:text-destructive transition-colors" title="Verwijderen">
                <Trash2 className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {isEditing && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mt-4 pt-4 border-t border-border space-y-4">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Seizoen bewerken</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {([["Naam", "name", "GT3 Championship"], ["Seizoen", "season", "2026 S1"], ["Auto klasse", "car_class", "GT3"], ["Beschrijving", "description", ""]] as const).map(([label, key, ph]) => (
              <div key={key}>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">{label}</label>
                <input type="text" value={editingLeagueData[key]} onChange={(e) => setEditingLeagueData({ ...editingLeagueData, [key]: e.target.value })} placeholder={ph} className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={onUpdateLeague} disabled={isSaving} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold bg-gradient-racing text-white hover:opacity-90 disabled:opacity-50">
              <Save className="w-3 h-3" /> {isSaving ? "Opslaan..." : "Opslaan"}
            </button>
            <button onClick={onCancelEdit} disabled={isSaving} className="px-3 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground border border-border disabled:opacity-50">Annuleren</button>
          </div>

          {canWrite && <div className="rounded-md border border-border/50 bg-secondary/30 p-3">
            {!addingRace ? <button type="button" onClick={() => setAddingRace(true)} disabled={isSaving} className="flex items-center gap-1.5 text-xs font-bold text-primary disabled:opacity-50"><Plus className="h-3.5 w-3.5" /> Race toevoegen</button> : <div className="space-y-2"><p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Nieuwe seizoensrace</p><div className="grid grid-cols-2 gap-2 md:grid-cols-4"><input value={newRace.name} onChange={(event) => setNewRace({ ...newRace, name: event.target.value })} placeholder="Naam *" className="px-2 py-1.5 rounded-md bg-secondary border border-border text-xs" /><TrackSelect value={newRace.track} onChange={(track) => setNewRace({ ...newRace, track })} className="px-2 py-1.5 text-xs" /><input type="date" value={newRace.date} onChange={(event) => setNewRace({ ...newRace, date: event.target.value })} className="px-2 py-1.5 rounded-md bg-secondary border border-border text-xs" /><input type="time" value={newRace.time} onChange={(event) => setNewRace({ ...newRace, time: event.target.value })} className="px-2 py-1.5 rounded-md bg-secondary border border-border text-xs" /></div><div className="flex gap-2"><button type="button" onClick={() => { onCreateRace(newRace); setAddingRace(false); }} disabled={!newRace.name || !newRace.track || !newRace.date || isSaving} className="px-3 py-1.5 rounded-md bg-gradient-racing text-xs font-bold text-white disabled:opacity-50">{isSaving ? "Aanmaken..." : "Race aanmaken"}</button><button type="button" onClick={() => setAddingRace(false)} disabled={isSaving} className="px-3 py-1.5 rounded-md border border-border text-xs text-muted-foreground">Annuleren</button></div></div>}
          </div>}

          {league.races?.length > 0 && (
            <div className="pt-3 border-t border-border/50 space-y-3">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Races bewerken</p>
              {(focusedRaceId ? league.races.filter((race) => race.id === focusedRaceId) : [...league.races]).sort((a, b) => {
                const completedDifference = Number(a.status === "completed") - Number(b.status === "completed");
                return completedDifference || (a.round ?? 0) - (b.round ?? 0);
              }).map((race) => {
                const rd = editingRaces[race.id] || race;
                return (
                  <div key={race.id} className="p-3 rounded-md bg-secondary/30 border border-border/50 space-y-2">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-heading font-black text-sm text-muted-foreground">R{String(race.round).padStart(2, "0")}</span>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      <RaceEditField label="Naam">
                        <input type="text" value={rd.name || ""} onChange={(e) => setRd(race.id, "name", e.target.value)} className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50" />
                      </RaceEditField>
                      <RaceEditField label="Circuit">
                        <TrackSelect value={rd.track || ""} onChange={(v) => setRd(race.id, "track", v)} className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50" />
                      </RaceEditField>
                      <RaceEditField label="Datum & tijd">
                        <input type="datetime-local" value={rd.race_date ? (rd.race_date.length > 16 ? utcToAmsLocal(rd.race_date) : rd.race_date) : ""} onChange={(e) => setRd(race.id, "race_date", e.target.value)} className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50" />
                      </RaceEditField>
                      <RaceEditField label="Race type">
                        <select value={rd.race_type || ""} onChange={(e) => setRd(race.id, "race_type", e.target.value)} className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50">
                          <option value="">—</option>
                          {["Sprint", "Feature", "Endurance"].map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </RaceEditField>
                      <RaceEditField label="Race duur">
                        <input type="text" value={rd.race_duration || ""} onChange={(e) => setRd(race.id, "race_duration", e.target.value)} placeholder="bv. 45 min" className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50" />
                      </RaceEditField>
                      <RaceEditField label="Practice">
                        <input type="text" value={rd.practice_duration || ""} onChange={(e) => setRd(race.id, "practice_duration", e.target.value)} placeholder="bv. 15 min" className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50" />
                      </RaceEditField>
                      <RaceEditField label="Qualifying">
                        <input type="text" value={rd.qualifying_duration || ""} onChange={(e) => setRd(race.id, "qualifying_duration", e.target.value)} placeholder="bv. 10 min" className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50" />
                      </RaceEditField>
                      <RaceEditField label="Start type">
                        <select value={rd.start_type || ""} onChange={(e) => setRd(race.id, "start_type", e.target.value)} className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50">
                          <option value="">—</option>
                          {["Rolling", "Standing"].map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </RaceEditField>
                      <RaceEditField label="Weather">
                        <select value={rd.weather || ""} onChange={(e) => setRd(race.id, "weather", e.target.value)} className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50">
                          <option value="">—</option>
                          {["Clear", "Partly Cloudy", "Overcast", "Rain", "Dynamic"].map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </RaceEditField>
                      <RaceEditField label="Setup">
                        <select value={rd.setup || ""} onChange={(e) => setRd(race.id, "setup", e.target.value)} className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50">
                          <option value="">—</option>
                          {["Fixed", "Open"].map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </RaceEditField>
                      <RaceEditField label="Status">
                        <select value={rd.status || "upcoming"} onChange={(e) => setRd(race.id, "status", e.target.value)} className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50">
                          {["upcoming", "live", "completed", "cancelled"].map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </RaceEditField>
                      <RaceEditField label="Lobby naam">
                        <input type="text" value={rd.lobby_name || ""} onChange={(e) => setRd(race.id, "lobby_name", e.target.value)} placeholder="bv. 3SM Race 1" className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50" />
                      </RaceEditField>
                      <RaceEditField label="Wachtwoord">
                        <input type="text" value={rd.lobby_password || ""} onChange={(e) => setRd(race.id, "lobby_password", e.target.value)} placeholder="bv. 3SMracing" className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50" />
                      </RaceEditField>
                      <RaceEditField label="Vrijgeven (min)">
                        <input type="number" value={rd.lobby_reveal_minutes ?? 15} onChange={(e) => setRd(race.id, "lobby_reveal_minutes", Number(e.target.value))} min={1} max={120} className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50" />
                      </RaceEditField>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => onUpdateRace(race.id, rd)}
                        disabled={isSaving}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold bg-secondary border border-border hover:border-primary/50 hover:text-primary transition-colors disabled:opacity-50"
                      >
                        <Save className="w-3 h-3" /> {isSaving ? "Opslaan..." : "Race opslaan"}
                      </button>
                      <button type="button" onClick={() => onDeleteRace(race.id)} disabled={isSaving} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-destructive/30 text-xs font-bold text-destructive hover:bg-destructive/10 disabled:opacity-50"><Trash2 className="h-3 w-3" /> Verwijderen</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
};

/* ══════════════════════════════════════════════
   SOLO RACE CREATE FORM
   ══════════════════════════════════════════════ */

type SoloRaceCreateFormProps = {
  newSoloRace: RaceSlot;
  setNewSoloRace: React.Dispatch<React.SetStateAction<RaceSlot>>;
  onCreate: () => void;
  isPending: boolean;
  onCancel: () => void;
};

const SoloRaceCreateForm = ({ newSoloRace, setNewSoloRace, onCreate, isPending, onCancel }: SoloRaceCreateFormProps) => (
  <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="bg-card border border-border rounded-lg p-6 mb-6">
    <h3 className="font-heading text-lg font-bold mb-4">NIEUWE LOSSE RACE</h3>
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <input type="text" value={newSoloRace.name} onChange={(e) => setNewSoloRace({ ...newSoloRace, name: e.target.value })} placeholder="Race naam *" className="px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
        <TrackSelect value={newSoloRace.track} onChange={(v) => setNewSoloRace({ ...newSoloRace, track: v })} />
        <input type="date" value={newSoloRace.date} onChange={(e) => setNewSoloRace({ ...newSoloRace, date: e.target.value })} className="px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
        <input type="time" value={newSoloRace.time} onChange={(e) => setNewSoloRace({ ...newSoloRace, time: e.target.value })} className="px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Race type</label>
          <select value={newSoloRace.race_type} onChange={(e) => setNewSoloRace({ ...newSoloRace, race_type: e.target.value })} className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
            {["Sprint", "Feature", "Endurance"].map((v) => <option key={v}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Duur race</label>
          <input type="text" value={newSoloRace.race_duration} onChange={(e) => setNewSoloRace({ ...newSoloRace, race_duration: e.target.value })} placeholder="60 min / 30 laps" className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Start type</label>
          <select value={newSoloRace.start_type} onChange={(e) => setNewSoloRace({ ...newSoloRace, start_type: e.target.value })} className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
            {["Standing", "Rolling"].map((v) => <option key={v}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Practice</label>
          <input type="text" value={newSoloRace.practice_duration} onChange={(e) => setNewSoloRace({ ...newSoloRace, practice_duration: e.target.value })} placeholder="15 min" className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Qualifying</label>
          <input type="text" value={newSoloRace.qualifying_duration} onChange={(e) => setNewSoloRace({ ...newSoloRace, qualifying_duration: e.target.value })} placeholder="10 min" className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Weather</label>
          <select value={newSoloRace.weather} onChange={(e) => setNewSoloRace({ ...newSoloRace, weather: e.target.value })} className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
            {["Fixed", "Dynamic"].map((v) => <option key={v}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Setup</label>
          <select value={newSoloRace.setup} onChange={(e) => setNewSoloRace({ ...newSoloRace, setup: e.target.value })} className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
            {["Fixed", "Open"].map((v) => <option key={v}>{v}</option>)}
          </select>
        </div>
      </div>

      {/* ── Lobby ── */}
      <div className="pt-2">
        <div className="flex items-center gap-2 mb-3">
          <KeyRound className="w-4 h-4 text-orange-500" />
          <span className="text-xs font-black text-orange-500 uppercase tracking-widest">Lobby</span>
          <span className="text-[10px] text-muted-foreground">(alleen voor ingeschreven deelnemers)</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Lobby naam</label>
            <input type="text" value={newSoloRace.lobby_name} onChange={(e) => setNewSoloRace({ ...newSoloRace, lobby_name: e.target.value })} placeholder="bv. 3SM Race 1" className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Wachtwoord</label>
            <input type="text" value={newSoloRace.lobby_password} onChange={(e) => setNewSoloRace({ ...newSoloRace, lobby_password: e.target.value })} placeholder="bv. 3SMracing2024" className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Vrijgeven (min voor start)</label>
            <input type="number" value={newSoloRace.lobby_reveal_minutes} onChange={(e) => setNewSoloRace({ ...newSoloRace, lobby_reveal_minutes: Number(e.target.value) })} min={1} max={120} className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
          </div>
        </div>
      </div>
    </div>
    <div className="flex gap-3 mt-4">
      <button onClick={onCreate} disabled={!newSoloRace.name || !newSoloRace.track || !newSoloRace.date || isPending} className="px-6 py-2.5 rounded-md bg-gradient-racing text-white font-heading font-bold text-sm disabled:opacity-50 hover:opacity-90 transition-opacity">{isPending ? "Aanmaken..." : "Aanmaken"}</button>
      <button onClick={onCancel} disabled={isPending} className="px-6 py-2.5 rounded-md border border-border text-muted-foreground font-heading font-bold text-sm hover:text-foreground transition-colors disabled:opacity-50">Annuleren</button>
    </div>
  </motion.div>
);

/* ══════════════════════════════════════════════
   SOLO RACE CARD
   ══════════════════════════════════════════════ */

type SoloRaceCardProps = {
  race: SeasonEditorSoloRace;
  isEditing: boolean;
  editingData: SeasonEditorRaceUpdate;
  setEditingData: React.Dispatch<React.SetStateAction<SeasonEditorRaceUpdate>>;
  onEdit: () => void;
  onCancelEdit: () => void;
  onUpdate: () => void;
  onDelete: (id: string) => void;
  canWrite: boolean;
  isSaving: boolean;
};

const SoloRaceCard = ({
  race, isEditing, editingData, setEditingData,
  onEdit, onCancelEdit, onUpdate, onDelete, canWrite, isSaving,
}: SoloRaceCardProps) => {
  const setSrd = (field: keyof SeasonEditorRaceUpdate, val: string | number) =>
    setEditingData((prev) => ({ ...prev, [field]: val }));

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="font-heading font-bold">{race.name}</div>
          <div className="text-sm text-muted-foreground flex gap-3 mt-0.5 flex-wrap">
            <span>{race.track}</span>
            <span>•</span>
            <span>{new Date(race.race_date).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" })}</span>
            {race.status && <><span>•</span><span className="italic">{race.status}</span></>}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {canWrite && <>
            <button onClick={onEdit} disabled={isSaving} className="p-2 text-muted-foreground hover:text-primary transition-colors disabled:opacity-50" title="Bewerken">
              <Pencil className="w-4 h-4" />
            </button>
            <button onClick={() => onDelete(race.id)} disabled={isSaving} className="p-2 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50" title="Verwijderen">
              <Trash2 className="w-4 h-4" />
            </button>
          </>}
        </div>
      </div>

      {isEditing && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mt-3 pt-3 border-t border-border/50 space-y-3">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Race bewerken</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            <RaceEditField label="Naam">
              <input type="text" value={editingData.name || ""} onChange={(e) => setSrd("name", e.target.value)} className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </RaceEditField>
            <RaceEditField label="Circuit">
              <TrackSelect value={editingData.track || ""} onChange={(v) => setSrd("track", v)} className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </RaceEditField>
            <RaceEditField label="Datum & tijd">
              <input type="datetime-local" value={editingData.race_date || ""} onChange={(e) => setSrd("race_date", e.target.value)} className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </RaceEditField>
            <RaceEditField label="Race duur">
              <input type="text" value={editingData.race_duration || ""} onChange={(e) => setSrd("race_duration", e.target.value)} placeholder="bv. 60 min" className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </RaceEditField>
            <RaceEditField label="Practice">
              <input type="text" value={editingData.practice_duration || ""} onChange={(e) => setSrd("practice_duration", e.target.value)} placeholder="bv. 15 min" className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </RaceEditField>
            <RaceEditField label="Qualifying">
              <input type="text" value={editingData.qualifying_duration || ""} onChange={(e) => setSrd("qualifying_duration", e.target.value)} placeholder="bv. 10 min" className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </RaceEditField>
            <RaceEditField label="Weather">
              <select value={editingData.weather || ""} onChange={(e) => setSrd("weather", e.target.value)} className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50">
                <option value="">—</option>
                {["Clear", "Partly Cloudy", "Overcast", "Rain", "Dynamic"].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </RaceEditField>
            <RaceEditField label="Setup">
              <select value={editingData.setup || ""} onChange={(e) => setSrd("setup", e.target.value)} className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50">
                <option value="">—</option>
                {["Fixed", "Open"].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </RaceEditField>
            <RaceEditField label="Status">
              <select value={editingData.status || ""} onChange={(e) => setSrd("status", e.target.value)} className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50">
                {["upcoming", "live", "completed", "cancelled"].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </RaceEditField>
          </div>
          {/* Lobby fields */}
          <div className="pt-2">
            <div className="flex items-center gap-2 mb-2">
              <KeyRound className="w-3.5 h-3.5 text-orange-500" />
              <span className="text-[10px] font-bold text-orange-500 uppercase tracking-widest">Lobby</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              <RaceEditField label="Lobby naam">
                <input type="text" value={editingData.lobby_name || ""} onChange={(e) => setSrd("lobby_name", e.target.value)} placeholder="bv. 3SM Race 1" className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50" />
              </RaceEditField>
              <RaceEditField label="Wachtwoord">
                <input type="text" value={editingData.lobby_password || ""} onChange={(e) => setSrd("lobby_password", e.target.value)} placeholder="bv. 3SMracing2024" className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50" />
              </RaceEditField>
              <RaceEditField label="Vrijgeven (min)">
                <input type="number" value={editingData.lobby_reveal_minutes ?? 15} onChange={(e) => setSrd("lobby_reveal_minutes", Number(e.target.value))} min={1} max={120} className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50" />
              </RaceEditField>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onUpdate}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold bg-gradient-racing text-white hover:opacity-90 disabled:opacity-50"
            >
              <Save className="w-3 h-3" /> {isSaving ? "Opslaan..." : "Opslaan"}
            </button>
            <button onClick={onCancelEdit} disabled={isSaving} className="px-3 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground border border-border disabled:opacity-50">Annuleren</button>
          </div>
        </motion.div>
      )}
    </div>
  );
};

/* ══════════════════════════════════════════════
   SHARED MINI COMPONENTS
   ══════════════════════════════════════════════ */

const RaceEditField = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">{label}</label>
    {children}
  </div>
);