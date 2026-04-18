import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Plus, Trophy, Trash2, Users, Save, Pencil, ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { amsToUTC, utcToAmsLocal } from "@/lib/dateHelpers";
import { TrackSelect } from "@/components/admin/TrackSelect";

type RaceSlot = {
  name: string; track: string; date: string; time: string;
  race_type: string; race_duration: string; practice_duration: string;
  qualifying_duration: string; start_type: string; weather: string; setup: string;
};

const SOLO_RACE_DEFAULTS: RaceSlot = {
  name: "", track: "", date: "", time: "20:00", race_type: "Feature",
  race_duration: "60 min", practice_duration: "15 min", qualifying_duration: "10 min",
  start_type: "Standing", weather: "Fixed", setup: "Fixed",
};

const SeasonsAdmin = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [newLeague, setNewLeague] = useState({ name: "", description: "", season: "", car_class: "", raceCount: 6 });
  const [races, setRaces] = useState<RaceSlot[]>([]);
  const [showLeagueForm, setShowLeagueForm] = useState(false);
  const [editingLeagueId, setEditingLeagueId] = useState<string | null>(null);
  const [editingLeagueData, setEditingLeagueData] = useState({ name: "", description: "", season: "", car_class: "" });
  const [editingRaces, setEditingRaces] = useState<Record<string, any>>({});

  const [showSoloRaceForm, setShowSoloRaceForm] = useState(false);
  const [newSoloRace, setNewSoloRace] = useState<RaceSlot>({ ...SOLO_RACE_DEFAULTS });
  const [editingSoloRaceId, setEditingSoloRaceId] = useState<string | null>(null);
  const [editingSoloRaceData, setEditingSoloRaceData] = useState<any>({});
  const [showCompletedSoloRaces, setShowCompletedSoloRaces] = useState(false);

  const { data: leagues } = useQuery({
    queryKey: ["admin-leagues"],
    queryFn: async () => {
      const { data, error } = await supabase.from("leagues").select("*, races(*)");
      if (error) throw error;
      return data;
    },
  });

  const { data: allRaces } = useQuery({
    queryKey: ["all-races-admin"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("races")
        .select("id, name, track, race_date, league_id, status, practice_duration, qualifying_duration, race_duration, start_type, weather, setup, leagues(name, season)")
        .order("race_date", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const { data: seasonRegistrations } = useQuery({
    queryKey: ["admin-season-registrations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("season_registrations")
        .select("league_id, user_id, status, created_at, car_choice, car_locked");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: raceRegistrations } = useQuery({
    queryKey: ["admin-race-registrations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("race_registrations")
        .select("race_id, user_id, status, created_at, car_choice, car_locked");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: profiles } = useQuery({
    queryKey: ["all-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, display_name, iracing_name, iracing_id");
      if (error) throw error;
      return data;
    },
  });

  const generateRaceSlots = () => {
    setRaces(Array.from({ length: newLeague.raceCount }, (_, i) => ({
      name: `Race ${i + 1}`, track: "", date: "", time: "20:00", race_type: "Feature",
      race_duration: "60 min", practice_duration: "15 min", qualifying_duration: "10 min",
      start_type: "Standing", weather: "Fixed", setup: "Fixed",
    })));
  };

  const createLeague = useMutation({
    mutationFn: async () => {
      const { data: league, error } = await supabase
        .from("leagues")
        .insert({ name: newLeague.name, description: newLeague.description, season: newLeague.season, car_class: newLeague.car_class, created_by: user!.id })
        .select().single();
      if (error) throw error;
      if (races.length > 0) {
        const { error: re } = await supabase.from("races").insert(
          races.map((r, i) => ({
            league_id: league.id, round: i + 1, name: r.name, track: r.track,
            race_date: amsToUTC(`${r.date}T${r.time}`), status: "upcoming" as const,
            race_type: r.race_type || null, race_duration: r.race_duration || null,
            practice_duration: r.practice_duration || null, qualifying_duration: r.qualifying_duration || null,
            start_type: r.start_type || null, weather: r.weather || null, setup: r.setup || null,
          } as any))
        );
        if (re) throw re;
      }
      return league;
    },
    onSuccess: () => {
      toast.success("Seizoen aangemaakt!");
      queryClient.invalidateQueries({ queryKey: ["admin-leagues"] });
      queryClient.invalidateQueries({ queryKey: ["all-races-admin"] });
      setShowLeagueForm(false);
      setNewLeague({ name: "", description: "", season: "", car_class: "", raceCount: 6 });
      setRaces([]);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteLeague = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("leagues").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Verwijderd");
      queryClient.invalidateQueries({ queryKey: ["admin-leagues"] });
    },
  });

  const updateLeague = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof editingLeagueData }) => {
      const { error } = await supabase.from("leagues").update({
        name: data.name, description: data.description || null,
        season: data.season || null, car_class: data.car_class || null,
      }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Seizoen bijgewerkt!");
      queryClient.invalidateQueries({ queryKey: ["admin-leagues"] });
      setEditingLeagueId(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const createSoloRace = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("races").insert({
        league_id: null, name: newSoloRace.name, track: newSoloRace.track,
        race_date: amsToUTC(`${newSoloRace.date}T${newSoloRace.time}`),
        status: "upcoming",
        race_type: newSoloRace.race_type || null, race_duration: newSoloRace.race_duration || null,
        practice_duration: newSoloRace.practice_duration || null, qualifying_duration: newSoloRace.qualifying_duration || null,
        start_type: newSoloRace.start_type || null, weather: newSoloRace.weather || null, setup: newSoloRace.setup || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Losse race aangemaakt!");
      queryClient.invalidateQueries({ queryKey: ["all-races-admin"] });
      setShowSoloRaceForm(false);
      setNewSoloRace({ ...SOLO_RACE_DEFAULTS });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteSoloRace = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("races").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Race verwijderd");
      queryClient.invalidateQueries({ queryKey: ["all-races-admin"] });
    },
  });

  const updateRace = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const normalizedDate = data.race_date
        ? (data.race_date.length > 16 ? utcToAmsLocal(data.race_date) : data.race_date)
        : null;
      const { error } = await supabase.from("races").update({
        name: data.name, track: data.track,
        race_date: normalizedDate ? amsToUTC(normalizedDate) : null,
        race_type: data.race_type || null, race_duration: data.race_duration || null,
        practice_duration: data.practice_duration || null, qualifying_duration: data.qualifying_duration || null,
        start_type: data.start_type || null, weather: data.weather || null, setup: data.setup || null,
        status: data.status || "upcoming",
      }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Race opgeslagen!");
      queryClient.invalidateQueries({ queryKey: ["admin-leagues"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-heading text-2xl font-black">SEIZOENEN</h2>
        <button
          onClick={() => { setShowLeagueForm(!showLeagueForm); if (!showLeagueForm) generateRaceSlots(); }}
          className="flex items-center gap-2 px-4 py-2 rounded-md bg-gradient-racing text-white font-heading font-bold text-sm uppercase tracking-wider hover:opacity-90 transition-opacity"
        >
          <Plus className="w-4 h-4" />Nieuw Seizoen
        </button>
      </div>

      {showLeagueForm && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="bg-card border border-border rounded-lg p-6 mb-6 racing-stripe-left">
          <h3 className="font-heading text-lg font-bold mb-4">NIEUW SEIZOEN</h3>
          <div className="grid gap-4 md:grid-cols-2 mb-4">
            {[
              { label: "Naam *", key: "name", placeholder: "GT3 Championship" },
              { label: "Seizoen", key: "season", placeholder: "2026 S1" },
              { label: "Auto Klasse", key: "car_class", placeholder: "GT3" },
            ].map(({ label, key, placeholder }) => (
              <div key={key}>
                <label className="text-sm font-medium text-muted-foreground mb-1.5 block">{label}</label>
                <input type="text" value={(newLeague as any)[key]} onChange={(e) => setNewLeague({ ...newLeague, [key]: e.target.value })} placeholder={placeholder} className="w-full px-4 py-2.5 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
              </div>
            ))}
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
                const upd = (key: string, val: string) => { const u = [...races]; (u[i] as any)[key] = val; setRaces(u); };
                return (
                  <div key={i} className="p-3 bg-secondary/50 rounded-md border border-border/50 space-y-2">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      <input type="text" value={race.name} onChange={(e) => upd("name", e.target.value)} placeholder={`Race ${i + 1}`} className="px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                      <TrackSelect value={race.track} onChange={v => upd("track", v)} />
                      <input type="date" value={race.date} onChange={(e) => upd("date", e.target.value)} className="px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                      <input type="time" value={race.time} onChange={(e) => upd("time", e.target.value)} className="px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      <div>
                        <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Race type</label>
                        <select value={race.race_type} onChange={(e) => upd("race_type", e.target.value)} className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
                          {["Sprint", "Feature", "Endurance"].map((v) => <option key={v}>{v}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Duur race</label>
                        <input type="text" value={race.race_duration} onChange={(e) => upd("race_duration", e.target.value)} placeholder="60 min / 30 laps" className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Start type</label>
                        <select value={race.start_type} onChange={(e) => upd("start_type", e.target.value)} className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
                          {["Standing", "Rolling"].map((v) => <option key={v}>{v}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Practice</label>
                        <input type="text" value={race.practice_duration} onChange={(e) => upd("practice_duration", e.target.value)} placeholder="15 min" className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Qualifying</label>
                        <input type="text" value={race.qualifying_duration} onChange={(e) => upd("qualifying_duration", e.target.value)} placeholder="10 min" className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Weather</label>
                        <select value={race.weather} onChange={(e) => upd("weather", e.target.value)} className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
                          {["Fixed", "Dynamic"].map((v) => <option key={v}>{v}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Setup</label>
                        <select value={race.setup} onChange={(e) => upd("setup", e.target.value)} className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
                          {["Fixed", "Open"].map((v) => <option key={v}>{v}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex gap-3">
            <button onClick={() => createLeague.mutate()} disabled={!newLeague.name || createLeague.isPending} className="px-6 py-2.5 rounded-md bg-gradient-racing text-white font-heading font-bold text-sm disabled:opacity-50 hover:opacity-90 transition-opacity">{createLeague.isPending ? "Aanmaken..." : "Aanmaken"}</button>
            <button onClick={() => setShowLeagueForm(false)} className="px-6 py-2.5 rounded-md border border-border text-muted-foreground font-heading font-bold text-sm hover:text-foreground transition-colors">Annuleren</button>
          </div>
        </motion.div>
      )}

      <div className="space-y-3">
        {leagues?.map((league: any) => {
          const regs = (seasonRegistrations || []).filter((r: any) => r.league_id === league.id);
          const isEditing = editingLeagueId === league.id;
          return (
            <div key={league.id} className="bg-card border border-border rounded-lg p-5 racing-stripe-left">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-heading font-bold text-lg">{league.name}</h3>
                  <div className="flex gap-3 text-sm text-muted-foreground mt-1">
                    {league.season && <span>{league.season}</span>}
                    {league.car_class && <span>• {league.car_class}</span>}
                    <span>• {(league as any).races?.length || 0} races</span>
                    <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{regs.length} ingeschreven</span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      if (isEditing) { setEditingLeagueId(null); setEditingRaces({}); return; }
                      setEditingLeagueId(league.id);
                      setEditingLeagueData({ name: league.name, description: league.description || "", season: league.season || "", car_class: league.car_class || "" });
                      const raceMap: Record<string, any> = {};
                      (league as any).races?.forEach((r: any) => { raceMap[r.id] = { ...r }; });
                      setEditingRaces(raceMap);
                    }}
                    className="p-2 text-muted-foreground hover:text-primary transition-colors"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button onClick={() => deleteLeague.mutate(league.id)} className="p-2 text-muted-foreground hover:text-destructive transition-colors"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>

              {isEditing && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mt-4 pt-4 border-t border-border space-y-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Seizoen bewerken</p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {([["Naam", "name", "GT3 Championship"], ["Seizoen", "season", "2026 S1"], ["Auto klasse", "car_class", "GT3"], ["Beschrijving", "description", ""]] as const).map(([label, key, ph]) => (
                      <div key={key}>
                        <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">{label}</label>
                        <input type="text" value={(editingLeagueData as any)[key]} onChange={(e) => setEditingLeagueData({ ...editingLeagueData, [key]: e.target.value })} placeholder={ph} className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => updateLeague.mutate({ id: league.id, data: editingLeagueData })} disabled={updateLeague.isPending} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold bg-gradient-racing text-white hover:opacity-90 disabled:opacity-50">
                      <Save className="w-3 h-3" /> Opslaan
                    </button>
                    <button onClick={() => { setEditingLeagueId(null); setEditingRaces({}); }} className="px-3 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground border border-border">Annuleren</button>
                  </div>

                  {(league as any).races?.length > 0 && (
                    <div className="pt-3 border-t border-border/50 space-y-3">
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Races bewerken</p>
                      {[...(league as any).races].sort((a: any, b: any) => a.round - b.round).map((race: any) => {
                        const rd = editingRaces[race.id] || race;
                        const setRd = (field: string, val: string) => setEditingRaces(prev => ({ ...prev, [race.id]: { ...prev[race.id], [field]: val } }));
                        return (
                          <div key={race.id} className="p-3 rounded-md bg-secondary/30 border border-border/50 space-y-2">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-heading font-black text-sm text-muted-foreground">R{String(race.round).padStart(2, "0")}</span>
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                              <div>
                                <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Naam</label>
                                <input type="text" value={rd.name || ""} onChange={e => setRd("name", e.target.value)} className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50" />
                              </div>
                              <div>
                                <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Circuit</label>
                                <TrackSelect value={rd.track || ""} onChange={v => setRd("track", v)} className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50" />
                              </div>
                              <div>
                                <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Datum & tijd</label>
                                <input type="datetime-local" value={rd.race_date ? (rd.race_date.length > 16 ? utcToAmsLocal(rd.race_date) : rd.race_date) : ""} onChange={e => setRd("race_date", e.target.value)} className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50" />
                              </div>
                              <div>
                                <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Race type</label>
                                <select value={rd.race_type || ""} onChange={e => setRd("race_type", e.target.value)} className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50">
                                  <option value="">—</option>
                                  {["Laps", "Timed", "Laps + Timed"].map(t => <option key={t} value={t}>{t}</option>)}
                                </select>
                              </div>
                              <div>
                                <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Race duur</label>
                                <input type="text" value={rd.race_duration || ""} onChange={e => setRd("race_duration", e.target.value)} placeholder="bv. 45 min" className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50" />
                              </div>
                              <div>
                                <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Practice</label>
                                <input type="text" value={rd.practice_duration || ""} onChange={e => setRd("practice_duration", e.target.value)} placeholder="bv. 15 min" className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50" />
                              </div>
                              <div>
                                <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Qualifying</label>
                                <input type="text" value={rd.qualifying_duration || ""} onChange={e => setRd("qualifying_duration", e.target.value)} placeholder="bv. 10 min" className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50" />
                              </div>
                              <div>
                                <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Start type</label>
                                <select value={rd.start_type || ""} onChange={e => setRd("start_type", e.target.value)} className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50">
                                  <option value="">—</option>
                                  {["Rolling", "Standing"].map(t => <option key={t} value={t}>{t}</option>)}
                                </select>
                              </div>
                              <div>
                                <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Weather</label>
                                <select value={rd.weather || ""} onChange={e => setRd("weather", e.target.value)} className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50">
                                  <option value="">—</option>
                                  {["Clear", "Partly Cloudy", "Overcast", "Rain", "Dynamic"].map(t => <option key={t} value={t}>{t}</option>)}
                                </select>
                              </div>
                              <div>
                                <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Setup</label>
                                <select value={rd.setup || ""} onChange={e => setRd("setup", e.target.value)} className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50">
                                  <option value="">—</option>
                                  {["Fixed", "Open"].map(t => <option key={t} value={t}>{t}</option>)}
                                </select>
                              </div>
                              <div>
                                <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Status</label>
                                <select value={rd.status || "upcoming"} onChange={e => setRd("status", e.target.value)} className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50">
                                  {["upcoming", "live", "completed", "cancelled"].map(t => <option key={t} value={t}>{t}</option>)}
                                </select>
                              </div>
                            </div>
                            <button
                              onClick={() => updateRace.mutate({ id: race.id, data: rd })}
                              disabled={updateRace.isPending}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold bg-secondary border border-border hover:border-primary/50 hover:text-primary transition-colors disabled:opacity-50"
                            >
                              <Save className="w-3 h-3" /> Race opslaan
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </motion.div>
              )}

              {(() => {
                const seasonRegs = regs;
                const seasonUserIds = new Set(seasonRegs.map((r: any) => r.user_id));
                const leagueRaceIds = new Set(((league as any).races || []).map((r: any) => r.id));
                const raceRegsForLeague = (raceRegistrations || []).filter(
                  (r: any) => leagueRaceIds.has(r.race_id) && !seasonUserIds.has(r.user_id)
                );
                const raceRegsByUser: Record<string, { userId: string; raceIds: string[] }> = {};
                raceRegsForLeague.forEach((r: any) => {
                  if (!raceRegsByUser[r.user_id]) raceRegsByUser[r.user_id] = { userId: r.user_id, raceIds: [] };
                  raceRegsByUser[r.user_id].raceIds.push(r.race_id);
                });
                const raceRegUsers = Object.values(raceRegsByUser);

                if (seasonRegs.length === 0 && raceRegUsers.length === 0) return null;

                return (
                  <div className="mt-3 pt-3 border-t border-border/50 space-y-3">
                    {seasonRegs.length > 0 && (
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-accent inline-block" />
                          Heel seizoen ({seasonRegs.length})
                        </p>
                        <div className="space-y-1.5">
                          {seasonRegs.map((r: any) => {
                            const p = (profiles || []).find((p: any) => p.user_id === r.user_id);
                            return (
                              <div key={r.user_id} className="flex items-center gap-2">
                                <span className="w-28 shrink-0 px-2.5 py-1 rounded-full bg-accent/15 text-accent text-xs font-medium border border-accent/30 truncate">
                                  {p?.display_name || p?.iracing_name || r.user_id.slice(0, 8)}
                                </span>
                                <input
                                  type="text"
                                  defaultValue={r.car_choice || ""}
                                  disabled={r.car_locked}
                                  placeholder="Auto..."
                                  className="flex-1 px-2 py-1 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50 disabled:cursor-not-allowed"
                                  onBlur={async (e) => {
                                    const val = e.target.value.trim();
                                    if (val === (r.car_choice || "")) return;
                                    await supabase.from("season_registrations")
                                      .update({ car_choice: val || null })
                                      .eq("league_id", r.league_id).eq("user_id", r.user_id);
                                    queryClient.invalidateQueries({ queryKey: ["admin-season-registrations"] });
                                  }}
                                />
                                <button
                                  title={r.car_locked ? "Klik om te unlocken" : "Klik om te locken"}
                                  onClick={async () => {
                                    await supabase.from("season_registrations")
                                      .update({ car_locked: !r.car_locked })
                                      .eq("league_id", r.league_id).eq("user_id", r.user_id);
                                    queryClient.invalidateQueries({ queryKey: ["admin-season-registrations"] });
                                  }}
                                  className="text-base leading-none hover:scale-110 transition-transform"
                                >
                                  {r.car_locked ? "🔒" : "🔓"}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {raceRegUsers.length > 0 && (
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-primary inline-block" />
                          Los per race ({raceRegUsers.length})
                        </p>
                        <div className="space-y-1.5">
                          {raceRegUsers.map(({ userId, raceIds }) => {
                            const p = (profiles || []).find((p: any) => p.user_id === userId);
                            const raceNames = raceIds.map(rid => {
                              const race = ((league as any).races || []).find((r: any) => r.id === rid);
                              return race ? `R${String(race.round).padStart(2, "0")}` : rid.slice(0, 6);
                            }).sort().join(", ");
                            const firstReg = (raceRegistrations || []).find((r: any) => r.user_id === userId && raceIds.includes(r.race_id));
                            return (
                              <div key={userId} className="flex items-center gap-2">
                                <span className="w-28 shrink-0 px-2.5 py-1 rounded-full bg-secondary text-foreground text-xs font-medium border border-border truncate">
                                  {p?.display_name || p?.iracing_name || userId.slice(0, 8)}
                                </span>
                                <span className="text-muted-foreground text-xs w-12 shrink-0">{raceNames}</span>
                                <input
                                  type="text"
                                  defaultValue={firstReg?.car_choice || ""}
                                  disabled={firstReg?.car_locked}
                                  placeholder="Auto..."
                                  className="flex-1 px-2 py-1 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50 disabled:cursor-not-allowed"
                                  onBlur={async (e) => {
                                    const val = e.target.value.trim();
                                    if (val === (firstReg?.car_choice || "")) return;
                                    for (const rid of raceIds) {
                                      await supabase.from("race_registrations")
                                        .update({ car_choice: val || null })
                                        .eq("race_id", rid).eq("user_id", userId).eq("car_locked", false);
                                    }
                                    queryClient.invalidateQueries({ queryKey: ["admin-race-registrations"] });
                                  }}
                                />
                                <button
                                  title={firstReg?.car_locked ? "Klik om te unlocken" : "Klik om te locken"}
                                  onClick={async () => {
                                    for (const rid of raceIds) {
                                      await supabase.from("race_registrations")
                                        .update({ car_locked: !firstReg?.car_locked })
                                        .eq("race_id", rid).eq("user_id", userId);
                                    }
                                    queryClient.invalidateQueries({ queryKey: ["admin-race-registrations"] });
                                  }}
                                  className="text-base leading-none hover:scale-110 transition-transform"
                                >
                                  {firstReg?.car_locked ? "🔒" : "🔓"}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          );
        })}
        {!leagues?.length && (
          <div className="text-center py-16 text-muted-foreground">
            <Trophy className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p>Nog geen seizoenen.</p>
          </div>
        )}
      </div>

      {/* ── Losse Races ── */}
      <div className="mt-10">
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-heading text-2xl font-black">LOSSE RACES</h2>
          <button onClick={() => setShowSoloRaceForm(!showSoloRaceForm)} className="flex items-center gap-2 px-4 py-2 rounded-md bg-secondary border border-border text-white font-heading font-bold text-sm uppercase tracking-wider hover:opacity-90 transition-opacity">
            <Plus className="w-4 h-4" />Losse Race
          </button>
        </div>

        {showSoloRaceForm && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="bg-card border border-border rounded-lg p-6 mb-6">
            <h3 className="font-heading text-lg font-bold mb-4">NIEUWE LOSSE RACE</h3>
            <div className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <input type="text" value={newSoloRace.name} onChange={(e) => setNewSoloRace({ ...newSoloRace, name: e.target.value })} placeholder="Race naam *" className="px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                <TrackSelect value={newSoloRace.track} onChange={v => setNewSoloRace({ ...newSoloRace, track: v })} />
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
            </div>
            <div className="flex gap-3 mt-4">
              <button onClick={() => createSoloRace.mutate()} disabled={!newSoloRace.name || !newSoloRace.track || !newSoloRace.date || createSoloRace.isPending} className="px-6 py-2.5 rounded-md bg-gradient-racing text-white font-heading font-bold text-sm disabled:opacity-50 hover:opacity-90 transition-opacity">{createSoloRace.isPending ? "Aanmaken..." : "Aanmaken"}</button>
              <button onClick={() => setShowSoloRaceForm(false)} className="px-6 py-2.5 rounded-md border border-border text-muted-foreground font-heading font-bold text-sm hover:text-foreground transition-colors">Annuleren</button>
            </div>
          </motion.div>
        )}

        {(() => {
          const soloRaces = (allRaces || []).filter((r: any) => !r.league_id);
          const upcomingRaces = soloRaces.filter((r: any) => r.status !== "completed");
          const completedRaces = soloRaces.filter((r: any) => r.status === "completed");

          const renderRace = (race: any) => {
            const raceRegs = (raceRegistrations || []).filter((r: any) => r.race_id === race.id);
            const isEditingSolo = editingSoloRaceId === race.id;
            const srd = editingSoloRaceData;
            const setSrd = (field: string, val: string) => setEditingSoloRaceData((prev: any) => ({ ...prev, [field]: val }));
            return (
              <div key={race.id} className="bg-card border border-border rounded-lg p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="font-heading font-bold">{race.name}</div>
                    <div className="text-sm text-muted-foreground flex gap-3 mt-0.5 flex-wrap">
                      <span>{race.track}</span>
                      <span>•</span>
                      <span>{new Date(race.race_date).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" })}</span>
                      <span>•</span>
                      <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{raceRegs.length} ingeschreven</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => {
                        if (isEditingSolo) { setEditingSoloRaceId(null); setEditingSoloRaceData({}); }
                        else { setEditingSoloRaceId(race.id); setEditingSoloRaceData({ ...race, race_date: race.race_date ? utcToAmsLocal(race.race_date) : "" }); }
                      }}
                      className="p-2 text-muted-foreground hover:text-primary transition-colors"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => deleteSoloRace.mutate(race.id)} className="p-2 text-muted-foreground hover:text-destructive transition-colors"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>

                {raceRegs.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-border/50">
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-violet-500 inline-block" />
                      Ingeschreven ({raceRegs.length})
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {raceRegs.map((reg: any) => {
                        const p = (profiles || []).find((p: any) => p.user_id === reg.user_id);
                        return (
                          <span key={reg.user_id} className="px-2.5 py-1 rounded-full bg-violet-500/15 text-violet-400 text-xs font-medium border border-violet-500/30">
                            {p?.display_name || p?.iracing_name || reg.user_id.slice(0, 8)}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}

                {isEditingSolo && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mt-3 pt-3 border-t border-border/50 space-y-3">
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Race bewerken</p>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      <div>
                        <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Naam</label>
                        <input type="text" value={srd.name || ""} onChange={e => setSrd("name", e.target.value)} className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50" />
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Circuit</label>
                        <TrackSelect value={srd.track || ""} onChange={v => setSrd("track", v)} className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50" />
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Datum & tijd</label>
                        <input type="datetime-local" value={srd.race_date || ""} onChange={e => setSrd("race_date", e.target.value)} className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50" />
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Race duur</label>
                        <input type="text" value={srd.race_duration || ""} onChange={e => setSrd("race_duration", e.target.value)} placeholder="bv. 60 min" className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50" />
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Practice</label>
                        <input type="text" value={srd.practice_duration || ""} onChange={e => setSrd("practice_duration", e.target.value)} placeholder="bv. 15 min" className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50" />
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Qualifying</label>
                        <input type="text" value={srd.qualifying_duration || ""} onChange={e => setSrd("qualifying_duration", e.target.value)} placeholder="bv. 10 min" className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50" />
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Weather</label>
                        <select value={srd.weather || ""} onChange={e => setSrd("weather", e.target.value)} className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50">
                          <option value="">—</option>
                          {["Clear", "Partly Cloudy", "Overcast", "Rain", "Dynamic"].map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Setup</label>
                        <select value={srd.setup || ""} onChange={e => setSrd("setup", e.target.value)} className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50">
                          <option value="">—</option>
                          {["Fixed", "Open"].map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Status</label>
                        <select value={srd.status || ""} onChange={e => setSrd("status", e.target.value)} className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50">
                          {["upcoming", "live", "completed", "cancelled"].map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => updateRace.mutate({ id: race.id, data: srd }, { onSuccess: () => { setEditingSoloRaceId(null); setEditingSoloRaceData({}); } })}
                        disabled={updateRace.isPending}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold bg-gradient-racing text-white hover:opacity-90 disabled:opacity-50"
                      >
                        <Save className="w-3 h-3" /> Opslaan
                      </button>
                      <button onClick={() => { setEditingSoloRaceId(null); setEditingSoloRaceData({}); }} className="px-3 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground border border-border">Annuleren</button>
                    </div>
                  </motion.div>
                )}
              </div>
            );
          };

          return (
            <>
              <div className="space-y-3">
                {upcomingRaces.map(renderRace)}
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
                      {completedRaces.map(renderRace)}
                    </div>
                  )}
                </div>
              )}
            </>
          );
        })()}
      </div>
    </div>
  );
};

export default SeasonsAdmin;
