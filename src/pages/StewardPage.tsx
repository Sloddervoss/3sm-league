import { useState } from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { motion } from "framer-motion";
import { Shield, AlertTriangle, Clock, CheckCircle, XCircle, Plus, FileText, ChevronDown, ChevronUp, Zap } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Navigate } from "react-router-dom";

// ── Categorie systeem ─────────────────────────────────────────────────────────

const CATEGORY_PRESETS = {
  A: { penalty_type: "time_penalty",   time_penalty_seconds: 5,  grid_penalty_places: 0, race_ban_next: false, penalty_sp: 1 },
  B: { penalty_type: "time_penalty",   time_penalty_seconds: 10, grid_penalty_places: 0, race_ban_next: false, penalty_sp: 3 },
  C: { penalty_type: "grid_penalty",   time_penalty_seconds: 0,  grid_penalty_places: 3, race_ban_next: false, penalty_sp: 5 },
  D: { penalty_type: "race_ban",       time_penalty_seconds: 0,  grid_penalty_places: 0, race_ban_next: true,  penalty_sp: 10 },
} as const;

const CATEGORY_META = {
  A: { label: "A — Licht",   desc: "+5 sec · 1 SP",          color: "bg-blue-500/20 text-blue-400 border-blue-500/30",   activeColor: "bg-blue-500 text-white border-blue-500" },
  B: { label: "B — Matig",   desc: "+10 sec · 3 SP",         color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30", activeColor: "bg-yellow-500 text-white border-yellow-500" },
  C: { label: "C — Ernstig", desc: "Gridstraf · 5 SP",       color: "bg-orange-500/20 text-orange-400 border-orange-500/30", activeColor: "bg-orange-500 text-white border-orange-500" },
  D: { label: "D — Zwaar",   desc: "Race ban · 10 SP",       color: "bg-red-500/20 text-red-400 border-red-500/30",       activeColor: "bg-red-600 text-white border-red-600" },
};

const SP_THRESHOLDS = [
  { sp: 6,  label: "Officiële waarschuwing",       color: "text-yellow-400" },
  { sp: 10, label: "1 race ban",                   color: "text-orange-400" },
  { sp: 15, label: "2 race ban",                   color: "text-red-400" },
  { sp: 20, label: "Exclusie rest seizoen",        color: "text-red-600" },
];

// ── Labels ────────────────────────────────────────────────────────────────────

const statusStyles: Record<string, { color: string; label: string; icon: React.ElementType }> = {
  pending:      { color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",  label: "In behandeling", icon: Clock },
  under_review: { color: "bg-blue-500/20 text-blue-400 border-blue-500/30",        label: "Onder review",   icon: FileText },
  resolved:     { color: "bg-green-500/20 text-green-400 border-green-500/30",     label: "Afgehandeld",    icon: CheckCircle },
  dismissed:    { color: "bg-muted text-muted-foreground border-border",            label: "Afgewezen",      icon: XCircle },
};

const penaltyLabels: Record<string, string> = {
  warning:          "Waarschuwing",
  points_deduction: "Puntenaftrek",
  disqualification: "Diskwalificatie",
  time_penalty:     "Tijdstraf",
  grid_penalty:     "Gridstraf",
  race_ban:         "Race ban",
};

const PROTEST_DEADLINE_HOURS = 48;

// ── Types ─────────────────────────────────────────────────────────────────────

type Category = "A" | "B" | "C" | "D" | "";

interface DecisionState {
  status: string;
  steward_notes: string;
  penalty_category: Category;
  penalty_type: string;
  penalty_sp: number;
  time_penalty_seconds: number;
  grid_penalty_places: number;
  race_ban_next: boolean;
  points_deduction: number;
}

const EMPTY_DECISION: DecisionState = {
  status: "", steward_notes: "", penalty_category: "",
  penalty_type: "", penalty_sp: 0, time_penalty_seconds: 0,
  grid_penalty_places: 0, race_ban_next: false, points_deduction: 0,
};

interface StewardActionState {
  race_id: string;
  accused_user_id: string;
  penalty_category: Category;
  description: string;
  penalty_type: string;
  penalty_sp: number;
  time_penalty_seconds: number;
  grid_penalty_places: number;
  race_ban_next: boolean;
  points_deduction: number;
}

const EMPTY_ACTION: StewardActionState = {
  race_id: "", accused_user_id: "", penalty_category: "", description: "",
  penalty_type: "", penalty_sp: 0, time_penalty_seconds: 0,
  grid_penalty_places: 0, race_ban_next: false, points_deduction: 0,
};

// ── Helper: penalty samenvatting voor weergave ────────────────────────────────

function buildPenaltySummary(protest: any): string {
  if (protest.status === "dismissed") return "Protest afgewezen";
  if (!protest.penalty_type) return "Geen straf";
  let text = penaltyLabels[protest.penalty_type] || protest.penalty_type;
  if (protest.penalty_type === "time_penalty" && protest.time_penalty_seconds)
    text += ` (+${protest.time_penalty_seconds} sec)`;
  if (protest.penalty_type === "grid_penalty" && protest.grid_penalty_places)
    text += ` (${protest.grid_penalty_places} plaatsen)`;
  if (protest.penalty_type === "points_deduction" && protest.penalty_points > 0)
    text += ` (-${protest.penalty_points} punten)`;
  if (protest.race_ban_next) text += " (volgende race gemist)";
  return text;
}

// ── Hoofdcomponent ────────────────────────────────────────────────────────────

const StewardPage = () => {
  const { user, isAdmin, isSteward, loading } = useAuth();
  const queryClient = useQueryClient();
  const canModerate = isAdmin || isSteward;

  const [showForm, setShowForm] = useState(false);
  const [showStewardForm, setShowStewardForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [driverSpMap, setDriverSpMap] = useState<Record<string, number>>({});
  const [form, setForm] = useState({ race_id: "", accused_user_id: "", lap_number: "", description: "", video_link: "" });
  const [decisions, setDecisions] = useState<Record<string, DecisionState>>({});
  const [stewardAction, setStewardAction] = useState<StewardActionState>(EMPTY_ACTION);

  const getDecision = (id: string): DecisionState => decisions[id] || { ...EMPTY_DECISION };
  const setDecision = <K extends keyof DecisionState>(id: string, field: K, val: DecisionState[K]) =>
    setDecisions(prev => ({ ...prev, [id]: { ...getDecision(id), [field]: val } }));

  const applyCategory = (id: string, cat: Category) => {
    if (!cat) return;
    const preset = CATEGORY_PRESETS[cat];
    setDecisions(prev => ({
      ...prev,
      [id]: { ...getDecision(id), penalty_category: cat, ...preset, points_deduction: getDecision(id).points_deduction },
    }));
  };

  const applyCategoryToAction = (cat: Category) => {
    if (!cat) return;
    const preset = CATEGORY_PRESETS[cat];
    setStewardAction(prev => ({ ...prev, penalty_category: cat, ...preset, points_deduction: prev.points_deduction }));
  };

  const handleExpand = async (protest: any) => {
    const isExpanding = expandedId !== protest.id;
    setExpandedId(isExpanding ? protest.id : null);
    if (isExpanding && driverSpMap[protest.id] === undefined) {
      const leagueId = protest.races?.league_id ?? null;
      const { data } = await (supabase as any).rpc("get_driver_sp", {
        p_user_id: protest.accused_user_id,
        p_league_id: leagueId,
      });
      setDriverSpMap(prev => ({ ...prev, [protest.id]: data ?? 0 }));
    }
  };

  // ── Queries ─────────────────────────────────────────────────────────────────

  const { data: races } = useQuery({
    queryKey: ["races-for-protest"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("races")
        .select("id, name, track, race_date, league_id")
        .eq("status", "completed")
        .order("race_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: drivers } = useQuery({
    queryKey: ["drivers-for-protest"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, display_name, iracing_name")
        .order("display_name");
      if (error) throw error;
      return data;
    },
  });

  const { data: protests, isLoading } = useQuery({
    queryKey: ["my-protests", user?.id, canModerate],
    enabled: !!user,
    refetchOnMount: "always",
    queryFn: async () => {
      let query = supabase
        .from("protests")
        .select("*, races(name, track, race_date, league_id), reporter:profiles!protests_reporter_user_id_fkey(display_name, iracing_name), accused:profiles!protests_accused_user_id_fkey(display_name, iracing_name)");
      if (!canModerate) {
        query = query.or(`reporter_user_id.eq.${user!.id},accused_user_id.eq.${user!.id}`);
      }
      const { data, error } = await query.order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // ── Mutations ────────────────────────────────────────────────────────────────

  const submitProtest = useMutation({
    mutationFn: async () => {
      const race = races?.find((r: any) => r.id === form.race_id);
      if (race) {
        const hoursSince = (Date.now() - new Date((race as any).race_date).getTime()) / (1000 * 60 * 60);
        if (hoursSince > PROTEST_DEADLINE_HOURS)
          throw new Error(`Protest kan alleen binnen ${PROTEST_DEADLINE_HOURS} uur na de race worden ingediend.`);
      }
      const { error } = await supabase.from("protests").insert({
        race_id: form.race_id,
        reporter_user_id: user!.id,
        accused_user_id: form.accused_user_id,
        lap_number: form.lap_number ? parseInt(form.lap_number) : null,
        description: form.description,
        video_link: form.video_link || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Protest ingediend! Een steward bekijkt dit zo snel mogelijk.");
      queryClient.invalidateQueries({ queryKey: ["my-protests"] });
      setShowForm(false);
      setForm({ race_id: "", accused_user_id: "", lap_number: "", description: "", video_link: "" });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const resolveProtest = useMutation({
    mutationFn: async ({ protest, decision }: { protest: any; decision: DecisionState }) => {
      const penaltyType = decision.penalty_type || null;
      const leagueId = protest.races?.league_id ?? null;

      // Update protest
      const { error: protestError } = await (supabase as any).from("protests").update({
        status: decision.status,
        steward_notes: decision.steward_notes || null,
        penalty_type: penaltyType,
        penalty_points: decision.points_deduction || 0,
        penalty_category: decision.penalty_category || null,
        time_penalty_seconds: decision.time_penalty_seconds || null,
        grid_penalty_places: decision.grid_penalty_places || null,
        race_ban_next: decision.race_ban_next || false,
        decided_at: new Date().toISOString(),
      }).eq("id", protest.id);
      if (protestError) throw protestError;

      if (decision.status !== "resolved" || !penaltyType) return;

      // Pas race_results aan
      if (penaltyType === "disqualification") {
        const { error } = await supabase.from("race_results")
          .update({ dnf: true, points: 0 })
          .eq("race_id", protest.race_id)
          .eq("user_id", protest.accused_user_id);
        if (error) throw error;
        await supabase.rpc("recalculate_3sr_for_race" as any, { p_race_id: protest.race_id });
      } else if (penaltyType === "points_deduction" && decision.points_deduction > 0) {
        const { data: result, error: selectError } = await supabase.from("race_results")
          .select("points")
          .eq("race_id", protest.race_id)
          .eq("user_id", protest.accused_user_id)
          .maybeSingle();
        if (selectError) throw selectError;
        if (!result) throw new Error("Geen race resultaat gevonden voor puntenaftrek.");
        const { error } = await supabase.from("race_results")
          .update({ points: Math.max(0, (result.points || 0) - decision.points_deduction) })
          .eq("race_id", protest.race_id)
          .eq("user_id", protest.accused_user_id);
        if (error) throw error;
        await supabase.rpc("recalculate_3sr_for_race" as any, { p_race_id: protest.race_id });
      }

      // Sla penalty op
      const { error: penError } = await (supabase as any).from("penalties").insert({
        protest_id: protest.id,
        race_id: protest.race_id,
        user_id: protest.accused_user_id,
        league_id: leagueId,
        penalty_type: penaltyType,
        penalty_category: decision.penalty_category || null,
        penalty_sp: decision.penalty_sp || 0,
        time_penalty_seconds: decision.time_penalty_seconds || 0,
        grid_penalty_places: decision.grid_penalty_places || 0,
        race_ban_next: decision.race_ban_next || false,
        points_deduction: decision.points_deduction || 0,
        reason: decision.steward_notes || "",
        applied_by: user!.id,
        source: "steward",
      });
      if (penError) throw penError;
    },
    onSuccess: (_, { protest, decision }) => {
      toast.success("Uitspraak gedaan en straf toegepast!");
      queryClient.invalidateQueries({ queryKey: ["my-protests"] });
      queryClient.invalidateQueries({ queryKey: ["race-results"] });
      setDecisions(prev => { const n = { ...prev }; delete n[protest.id]; return n; });
      setDriverSpMap(prev => { const n = { ...prev }; delete n[protest.id]; return n; });
      setExpandedId(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const setUnderReview = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("protests").update({ status: "under_review" }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Protest onder review gezet."); queryClient.invalidateQueries({ queryKey: ["my-protests"] }); },
    onError: (err: Error) => toast.error(err.message),
  });

  const submitStewardAction = useMutation({
    mutationFn: async () => {
      if (!stewardAction.race_id || !stewardAction.accused_user_id || !stewardAction.description.trim())
        throw new Error("Vul alle verplichte velden in.");
      if (!stewardAction.penalty_type)
        throw new Error("Selecteer een categorie of straf type.");

      const race = (races as any[])?.find((r: any) => r.id === stewardAction.race_id);
      const leagueId = (race as any)?.league_id ?? null;

      if (stewardAction.penalty_type === "disqualification") {
        const { error } = await supabase.from("race_results")
          .update({ dnf: true, points: 0 })
          .eq("race_id", stewardAction.race_id)
          .eq("user_id", stewardAction.accused_user_id);
        if (error) throw error;
        await supabase.rpc("recalculate_3sr_for_race" as any, { p_race_id: stewardAction.race_id });
      } else if (stewardAction.penalty_type === "points_deduction" && stewardAction.points_deduction > 0) {
        const { data: result, error: selectError } = await supabase.from("race_results")
          .select("points")
          .eq("race_id", stewardAction.race_id)
          .eq("user_id", stewardAction.accused_user_id)
          .maybeSingle();
        if (selectError) throw selectError;
        if (!result) throw new Error("Geen race resultaat gevonden voor puntenaftrek.");
        const { error } = await supabase.from("race_results")
          .update({ points: Math.max(0, (result.points || 0) - stewardAction.points_deduction) })
          .eq("race_id", stewardAction.race_id)
          .eq("user_id", stewardAction.accused_user_id);
        if (error) throw error;
        await supabase.rpc("recalculate_3sr_for_race" as any, { p_race_id: stewardAction.race_id });
      }

      const { error } = await (supabase as any).from("penalties").insert({
        race_id: stewardAction.race_id,
        user_id: stewardAction.accused_user_id,
        league_id: leagueId,
        penalty_type: stewardAction.penalty_type,
        penalty_category: stewardAction.penalty_category || null,
        penalty_sp: stewardAction.penalty_sp,
        time_penalty_seconds: stewardAction.time_penalty_seconds,
        grid_penalty_places: stewardAction.grid_penalty_places,
        race_ban_next: stewardAction.race_ban_next,
        points_deduction: stewardAction.points_deduction,
        reason: stewardAction.description.trim(),
        applied_by: user!.id,
        source: "steward",
        steward_initiated: true,
        steward_description: stewardAction.description.trim(),
        notified: false,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Steward actie toegepast! Discord melding volgt.");
      setStewardAction({ ...EMPTY_ACTION });
      setShowStewardForm(false);
      queryClient.invalidateQueries({ queryKey: ["my-protests"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (loading) return null;
  if (!user) return <Navigate to="/auth" />;

  // ── Penalty velden UI (gedeeld door protest beslissing + steward actie) ──────

  const renderPenaltyFields = (
    values: { penalty_category: Category; penalty_type: string; penalty_sp: number; time_penalty_seconds: number; grid_penalty_places: number; race_ban_next: boolean; points_deduction: number },
    onChange: (field: string, val: any) => void,
    onCategorySelect: (cat: Category) => void,
    requireNotes: boolean = false,
  ) => (
    <div className="space-y-4">
      {/* Categorie knoppen */}
      <div>
        <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Categorie</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {(["A", "B", "C", "D"] as const).map(cat => {
            const meta = CATEGORY_META[cat];
            const isActive = values.penalty_category === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => onCategorySelect(cat)}
                className={`flex flex-col items-start px-3 py-2.5 rounded-md border text-left transition-colors ${isActive ? meta.activeColor : meta.color} hover:opacity-90`}
              >
                <span className="font-heading font-black text-sm">{meta.label}</span>
                <span className="text-[10px] opacity-80 mt-0.5">{meta.desc}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Straf type override */}
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Straf type</label>
          <select
            value={values.penalty_type}
            onChange={e => onChange("penalty_type", e.target.value)}
            className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:border-primary"
          >
            <option value="">Geen straf</option>
            <option value="warning">Waarschuwing</option>
            <option value="time_penalty">Tijdstraf</option>
            <option value="grid_penalty">Gridstraf</option>
            <option value="race_ban">Race ban</option>
            <option value="points_deduction">Puntenaftrek (kampioenschapspunten)</option>
            <option value="disqualification">Diskwalificatie</option>
          </select>
        </div>

        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Strafpunten (SP)</label>
          <input
            type="number" min={0} max={20}
            value={values.penalty_sp}
            onChange={e => onChange("penalty_sp", parseInt(e.target.value) || 0)}
            className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:border-primary"
          />
        </div>

        {values.penalty_type === "time_penalty" && (
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Tijdstraf (seconden)</label>
            <select
              value={values.time_penalty_seconds}
              onChange={e => onChange("time_penalty_seconds", parseInt(e.target.value))}
              className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:border-primary"
            >
              <option value={5}>+5 sec</option>
              <option value={10}>+10 sec</option>
              <option value={20}>+20 sec</option>
            </select>
          </div>
        )}

        {values.penalty_type === "grid_penalty" && (
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Gridstraf (plaatsen terug)</label>
            <input
              type="number" min={1} max={20}
              value={values.grid_penalty_places}
              onChange={e => onChange("grid_penalty_places", parseInt(e.target.value) || 0)}
              className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:border-primary"
            />
          </div>
        )}

        {values.penalty_type === "points_deduction" && (
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Puntenaftrek (kampioenschapspunten)</label>
            <input
              type="number" min={1}
              value={values.points_deduction}
              onChange={e => onChange("points_deduction", parseInt(e.target.value) || 0)}
              className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:border-primary"
            />
          </div>
        )}
      </div>

      {/* Race ban toggle */}
      {(values.penalty_type === "race_ban" || values.race_ban_next) && (
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={values.race_ban_next}
            onChange={e => onChange("race_ban_next", e.target.checked)}
            className="rounded border-border"
          />
          <span className="text-sm">Driver mist volgende race</span>
        </label>
      )}

      {/* Time penalty info */}
      {values.penalty_type === "time_penalty" && (
        <p className="text-xs text-muted-foreground bg-secondary/50 rounded-md px-3 py-2">
          ℹ️ Tijdstraf wordt handmatig verwerkt in de race uitslag. Admin past de posities aan in Uitslag Beheer.
        </p>
      )}

      {/* Grid penalty info */}
      {values.penalty_type === "grid_penalty" && (
        <p className="text-xs text-muted-foreground bg-secondary/50 rounded-md px-3 py-2">
          ℹ️ Gridstraf geldt voor de volgende race. Driver en admin worden via Discord geïnformeerd.
        </p>
      )}

      {/* Escalatie waarschuwing */}
      {requireNotes && (values.penalty_category === "C" || values.penalty_category === "D") && (
        <p className="text-xs text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 rounded-md px-3 py-2">
          ⚠️ Categorie {values.penalty_category} vereist een uitgebreide motivatie.
        </p>
      )}
    </div>
  );

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-16">
        <section className="py-12 bg-gradient-to-b from-card/50 to-transparent border-b border-border">
          <div className="container mx-auto px-4">
            <div className="flex items-center gap-2 mb-2">
              <Shield className="w-5 h-5 text-accent" />
              <span className="text-sm font-medium text-accent uppercase tracking-[0.15em]">3SM</span>
            </div>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h1 className="font-heading text-4xl md:text-5xl font-black">
                  {canModerate ? "STEWARD PANEL" : "PROTEST INDIENEN"}
                </h1>
                <p className="text-muted-foreground mt-2">
                  Dien een protest in over een race-incident (binnen 48 uur na de race)
                </p>
              </div>
              <div className="flex gap-2 flex-wrap">
                {canModerate && (
                  <button
                    onClick={() => { setShowStewardForm(!showStewardForm); setShowForm(false); }}
                    className="flex items-center gap-2 px-4 py-2 rounded-md bg-secondary border border-border text-foreground font-heading font-bold text-sm uppercase tracking-wider hover:bg-secondary/80 transition-colors"
                  >
                    <Zap className="w-4 h-4 text-accent" />
                    Steward Actie
                  </button>
                )}
                <button
                  onClick={() => { setShowForm(!showForm); setShowStewardForm(false); }}
                  className="flex items-center gap-2 px-4 py-2 rounded-md bg-gradient-racing text-white font-heading font-bold text-sm uppercase tracking-wider hover:opacity-90 transition-opacity"
                >
                  <Plus className="w-4 h-4" />
                  Nieuw Protest
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="py-12">
          <div className="container mx-auto px-4">

            {/* Protest formulier */}
            {showForm && (
              <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="bg-card border border-border rounded-lg p-6 mb-8 racing-stripe-left">
                <h2 className="font-heading text-xl font-bold mb-6">PROTEST FORMULIER</h2>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Race *</label>
                    <select value={form.race_id} onChange={e => setForm({ ...form, race_id: e.target.value })} className="w-full px-4 py-2.5 rounded-md bg-secondary border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
                      <option value="">Selecteer race...</option>
                      {(races as any[])?.map((race: any) => {
                        const hoursSince = (Date.now() - new Date(race.race_date).getTime()) / (1000 * 60 * 60);
                        const expired = hoursSince > PROTEST_DEADLINE_HOURS;
                        return (
                          <option key={race.id} value={race.id} disabled={expired}>
                            {race.name} — {race.track} ({new Date(race.race_date).toLocaleDateString("nl-NL", { timeZone: "Europe/Amsterdam" })}) {expired ? "— verlopen" : ""}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Driver onder protest *</label>
                    <select value={form.accused_user_id} onChange={e => setForm({ ...form, accused_user_id: e.target.value })} className="w-full px-4 py-2.5 rounded-md bg-secondary border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
                      <option value="">Selecteer driver...</option>
                      {(drivers as any[])?.filter((d: any) => d.user_id !== user.id).map((driver: any) => (
                        <option key={driver.user_id} value={driver.user_id}>{driver.iracing_name || driver.display_name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Rondnummer</label>
                    <input type="number" min={1} value={form.lap_number} onChange={e => setForm({ ...form, lap_number: e.target.value })} placeholder="bijv. 12" className="w-full px-4 py-2.5 rounded-md bg-secondary border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Video link</label>
                    <input type="url" value={form.video_link} onChange={e => setForm({ ...form, video_link: e.target.value })} placeholder="https://youtube.com/..." className="w-full px-4 py-2.5 rounded-md bg-secondary border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Beschrijving van het incident *</label>
                    <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Beschrijf zo duidelijk mogelijk wat er is gebeurd..." rows={4} className="w-full px-4 py-2.5 rounded-md bg-secondary border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none" />
                  </div>
                </div>
                <div className="flex gap-3 mt-6">
                  <button onClick={() => submitProtest.mutate()} disabled={!form.race_id || !form.accused_user_id || !form.description || submitProtest.isPending} className="px-6 py-2.5 rounded-md bg-gradient-racing text-white font-heading font-bold text-sm uppercase tracking-wider hover:opacity-90 transition-opacity disabled:opacity-50">
                    {submitProtest.isPending ? "Indienen..." : "Protest Indienen"}
                  </button>
                  <button onClick={() => setShowForm(false)} className="px-6 py-2.5 rounded-md border border-border text-muted-foreground font-heading font-bold text-sm uppercase tracking-wider hover:text-foreground transition-colors">
                    Annuleren
                  </button>
                </div>
              </motion.div>
            )}

            {/* Steward Actie formulier */}
            {showStewardForm && canModerate && (
              <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="bg-card border border-accent/30 rounded-lg p-6 mb-8 racing-stripe-left">
                <div className="flex items-center gap-2 mb-6">
                  <Zap className="w-5 h-5 text-accent" />
                  <h2 className="font-heading text-xl font-bold">STEWARD ACTIE</h2>
                  <span className="text-xs px-2 py-0.5 rounded bg-accent/10 text-accent border border-accent/20 font-bold uppercase">Zonder protest</span>
                </div>
                <div className="grid gap-4 md:grid-cols-2 mb-6">
                  <div>
                    <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Race *</label>
                    <select value={stewardAction.race_id} onChange={e => setStewardAction(prev => ({ ...prev, race_id: e.target.value }))} className="w-full px-4 py-2.5 rounded-md bg-secondary border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
                      <option value="">Selecteer race...</option>
                      {(races as any[])?.map((race: any) => (
                        <option key={race.id} value={race.id}>
                          {race.name} — {race.track} ({new Date(race.race_date).toLocaleDateString("nl-NL", { timeZone: "Europe/Amsterdam" })})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Driver *</label>
                    <select value={stewardAction.accused_user_id} onChange={e => setStewardAction(prev => ({ ...prev, accused_user_id: e.target.value }))} className="w-full px-4 py-2.5 rounded-md bg-secondary border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
                      <option value="">Selecteer driver...</option>
                      {(drivers as any[])?.map((driver: any) => (
                        <option key={driver.user_id} value={driver.user_id}>{driver.iracing_name || driver.display_name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Motivatie / Omschrijving *</label>
                    <textarea
                      value={stewardAction.description}
                      onChange={e => setStewardAction(prev => ({ ...prev, description: e.target.value }))}
                      placeholder="Beschrijf wat de steward heeft waargenomen en waarom deze straf gegeven wordt..."
                      rows={3}
                      className="w-full px-4 py-2.5 rounded-md bg-secondary border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                    />
                  </div>
                </div>

                {renderPenaltyFields(
                  stewardAction,
                  (field, val) => setStewardAction(prev => ({ ...prev, [field]: val })),
                  applyCategoryToAction,
                  true,
                )}

                <div className="flex gap-3 mt-6">
                  <button
                    onClick={() => submitStewardAction.mutate()}
                    disabled={!stewardAction.race_id || !stewardAction.accused_user_id || !stewardAction.description.trim() || !stewardAction.penalty_type || submitStewardAction.isPending}
                    className="px-6 py-2.5 rounded-md bg-gradient-racing text-white font-heading font-bold text-sm uppercase tracking-wider hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    {submitStewardAction.isPending ? "Toepassen..." : "Actie Toepassen"}
                  </button>
                  <button onClick={() => setShowStewardForm(false)} className="px-6 py-2.5 rounded-md border border-border text-muted-foreground font-heading font-bold text-sm uppercase tracking-wider hover:text-foreground transition-colors">
                    Annuleren
                  </button>
                </div>
              </motion.div>
            )}

            {/* Protests lijst */}
            <div className="space-y-4">
              {isLoading ? (
                [1, 2, 3].map(i => <div key={i} className="h-28 bg-card rounded-lg animate-pulse" />)
              ) : !protests?.length ? (
                <div className="text-center py-24 text-muted-foreground">
                  <Shield className="w-12 h-12 mx-auto mb-4 opacity-40" />
                  <p className="text-lg font-heading font-bold">GEEN PROTESTEN</p>
                  <p className="text-sm mt-1">Er zijn nog geen protesten ingediend.</p>
                  {!canModerate && (
                    <button onClick={() => setShowForm(true)} className="mt-4 flex items-center gap-2 px-4 py-2 rounded-md bg-gradient-racing text-white font-heading font-bold text-sm uppercase tracking-wider hover:opacity-90 transition-opacity mx-auto">
                      <Plus className="w-4 h-4" /> Protest Indienen
                    </button>
                  )}
                </div>
              ) : (
                (protests as any[]).map((protest: any, i: number) => {
                  const StatusIcon = statusStyles[protest.status]?.icon || Clock;
                  const isExpanded = expandedId === protest.id;
                  const dec = getDecision(protest.id);
                  const accusedName = protest.accused?.iracing_name || protest.accused?.display_name || "?";
                  const reporterName = protest.reporter?.iracing_name || protest.reporter?.display_name || "?";
                  const driverSp = driverSpMap[protest.id];
                  const isInvolved = protest.reporter_user_id === user?.id || protest.accused_user_id === user?.id;
                  const canDecide = canModerate && !isInvolved && protest.status !== "resolved" && protest.status !== "dismissed";

                  return (
                    <motion.div key={protest.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className="bg-card border border-border rounded-lg overflow-hidden">
                      {/* Header */}
                      <div className="p-5">
                        <div className="flex items-start justify-between gap-4 mb-3">
                          <div>
                            {canModerate ? (
                              <div className="font-heading font-bold text-base">
                                {reporterName} → <span className="text-primary">{accusedName}</span>
                              </div>
                            ) : (
                              <div className="font-heading font-bold text-base">
                                Protest — <span className="text-primary">{protest.races?.name}</span>
                              </div>
                            )}
                            <div className="text-sm text-muted-foreground mt-0.5">
                              {protest.races?.name} · {protest.races?.track}
                              {protest.lap_number && ` · Ronde ${protest.lap_number}`}
                              {" · "}{new Date(protest.created_at).toLocaleDateString("nl-NL")}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider border ${statusStyles[protest.status]?.color || statusStyles.pending.color}`}>
                              <StatusIcon className="w-3 h-3" />
                              {statusStyles[protest.status]?.label || protest.status}
                            </span>
                            <button onClick={() => handleExpand(protest)} className="p-1.5 text-muted-foreground hover:text-foreground transition-colors">
                              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            </button>
                          </div>
                        </div>
                        <p className="text-sm text-muted-foreground line-clamp-2">{protest.description}</p>
                        {protest.penalty_type && protest.status === "resolved" && (
                          <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-orange-500/10 border border-orange-500/20 text-orange-400 text-xs font-bold">
                            <AlertTriangle className="w-3 h-3" />
                            {buildPenaltySummary(protest)}
                            {protest.penalty_category && <span className="ml-1 opacity-70">· Cat. {protest.penalty_category}</span>}
                          </div>
                        )}
                      </div>

                      {/* Expanded */}
                      {isExpanded && (
                        <div className="px-5 pb-5 border-t border-border/50 pt-4 space-y-4">

                          {/* SP badge */}
                          {canModerate && driverSp !== undefined && protest.status !== "resolved" && protest.status !== "dismissed" && (
                            <div className="flex items-center gap-3 flex-wrap">
                              <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-sm font-bold ${
                                driverSp >= 15 ? "bg-red-500/20 text-red-400 border-red-500/30"
                                : driverSp >= 10 ? "bg-orange-500/20 text-orange-400 border-orange-500/30"
                                : driverSp >= 6  ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
                                : "bg-secondary text-muted-foreground border-border"
                              }`}>
                                <Shield className="w-3.5 h-3.5" />
                                {accusedName} — {driverSp} SP
                                {protest.races?.league_id ? " (dit seizoen)" : " (losse races)"}
                              </div>
                              {SP_THRESHOLDS.map(t => driverSp >= t.sp && (
                                <span key={t.sp} className={`text-xs font-bold ${t.color}`}>→ {t.label}</span>
                              )).filter(Boolean).slice(-1)}
                            </div>
                          )}

                          <p className="text-sm">{protest.description}</p>

                          {protest.video_link && (
                            <a href={protest.video_link} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">
                              Video bekijken →
                            </a>
                          )}

                          {protest.steward_notes && (
                            <div className="p-3 bg-secondary/50 rounded-md border border-border">
                              <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Steward Notitie</div>
                              <p className="text-sm">{protest.steward_notes}</p>
                            </div>
                          )}

                          {/* Betrokken steward */}
                          {canModerate && !canDecide && isInvolved && protest.status !== "resolved" && protest.status !== "dismissed" && (
                            <div className="pt-2 border-t border-border">
                              <p className="text-xs text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 rounded-md px-3 py-2">
                                Je bent betrokken bij dit protest en kan het niet zelf behandelen.
                              </p>
                            </div>
                          )}

                          {/* Steward beslissing */}
                          {canDecide && (
                            <div className="space-y-4 pt-2 border-t border-border">
                              <div className="flex items-center justify-between">
                                <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Uitspraak doen</div>
                                {protest.status === "pending" && (
                                  <button onClick={() => setUnderReview.mutate(protest.id)} disabled={setUnderReview.isPending} className="px-3 py-1.5 rounded-md bg-blue-500/20 text-blue-400 text-xs font-bold border border-blue-500/30 hover:bg-blue-500/30 transition-colors">
                                    In Review Zetten
                                  </button>
                                )}
                              </div>

                              <div>
                                <label className="text-xs text-muted-foreground mb-1 block">Uitkomst</label>
                                <select value={dec.status} onChange={e => setDecision(protest.id, "status", e.target.value)} className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:border-primary">
                                  <option value="">Kies uitkomst...</option>
                                  <option value="resolved">Protest gehonoreerd</option>
                                  <option value="dismissed">Protest afgewezen</option>
                                </select>
                              </div>

                              {dec.status === "resolved" && renderPenaltyFields(
                                dec,
                                (field, val) => setDecision(protest.id, field as keyof DecisionState, val),
                                (cat) => applyCategory(protest.id, cat),
                                true,
                              )}

                              <div>
                                <label className="text-xs text-muted-foreground mb-1 block">
                                  Motivatie / Steward notitie{(dec.penalty_category === "C" || dec.penalty_category === "D") ? " *" : ""}
                                </label>
                                <textarea
                                  value={dec.steward_notes}
                                  onChange={e => setDecision(protest.id, "steward_notes", e.target.value)}
                                  rows={3}
                                  placeholder="Uitleg van de beslissing..."
                                  className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:border-primary resize-none"
                                />
                              </div>

                              <button
                                onClick={() => resolveProtest.mutate({ protest, decision: dec })}
                                disabled={!dec.status || resolveProtest.isPending}
                                className="px-5 py-2 rounded-md bg-gradient-racing text-white font-heading font-bold text-sm uppercase tracking-wider hover:opacity-90 disabled:opacity-50 transition-opacity"
                              >
                                {resolveProtest.isPending ? "Bezig..." : "Uitspraak bevestigen"}
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </motion.div>
                  );
                })
              )}
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default StewardPage;
