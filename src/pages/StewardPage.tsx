import { useState } from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { motion } from "framer-motion";
import { Shield, AlertTriangle, Clock, CheckCircle, XCircle, Plus, FileText, ChevronDown, ChevronUp, Zap, Users } from "lucide-react";
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
  pit_lane_start:   "Pitlane start",
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

  const [activeTab, setActiveTab] = useState<"protesten" | "rijders" | "dnf_check">("protesten");
  const [showForm, setShowForm] = useState(false);
  const [showStewardForm, setShowStewardForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [driverSpMap, setDriverSpMap] = useState<Record<string, number>>({});
  const [form, setForm] = useState({ race_id: "", accused_user_id: "", lap_number: "", description: "", video_link: "" });
  const [decisions, setDecisions] = useState<Record<string, DecisionState>>({});
  const [stewardAction, setStewardAction] = useState<StewardActionState>(EMPTY_ACTION);
  const [abandonPoints, setAbandonPoints] = useState<Record<string, number>>({});
  const [showAllDnf, setShowAllDnf] = useState(false);
  const [expandedDnfRace, setExpandedDnfRace] = useState<string | null>(null);

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

  // ── Rijders SP overzicht queries (alleen voor stewards) ─────────────────────

  const { data: spPenalties } = useQuery({
    queryKey: ["steward-sp-penalties"],
    enabled: canModerate && activeTab === "rijders",
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("penalties")
        .select("id, user_id, race_id, league_id, penalty_sp, penalty_type, penalty_category, reason, created_at, races(id, name, race_date, league_id, leagues(name, season))")
        .eq("revoked", false)
        .not("penalty_category", "is", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      if (!data?.length) return [];
      // Haal profielen apart op (penalties heeft geen directe FK naar profiles)
      const userIds = [...new Set(data.map((p: any) => p.user_id))];
      const { data: profileRows } = await supabase
        .from("profiles")
        .select("user_id, display_name, iracing_name")
        .in("user_id", userIds);
      const profileMap = Object.fromEntries((profileRows || []).map((p: any) => [p.user_id, p]));
      return data.map((p: any) => ({ ...p, profiles: profileMap[p.user_id] ?? null }));
    },
  });

  const { data: spRaceHistory } = useQuery({
    queryKey: ["steward-race-history"],
    enabled: canModerate && activeTab === "rijders" && !!spPenalties?.length,
    queryFn: async () => {
      const userIds = [...new Set((spPenalties || []).map((p: any) => p.user_id))];
      const { data, error } = await supabase
        .from("race_results")
        .select("user_id, race_id, races(id, race_date, league_id)")
        .in("user_id", userIds);
      if (error) throw error;
      return data || [];
    },
  });

  // ── DNF Check queries ────────────────────────────────────────────────────────

  const { data: completedRacesForDnf } = useQuery({
    queryKey: ["completed-races-dnf"],
    enabled: canModerate && activeTab === "dnf_check",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("races")
        .select("id, name, track, race_date")
        .eq("status", "completed")
        .order("race_date", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: allResultsForDnf } = useQuery({
    queryKey: ["all-results-dnf"],
    enabled: canModerate && activeTab === "dnf_check",
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("race_results")
        .select("id, race_id, user_id, position, points, dnf, laps, profiles(display_name, iracing_name)");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: existingAbandonPenalties, refetch: refetchAbandon } = useQuery({
    queryKey: ["abandon-penalties"],
    enabled: canModerate,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("penalties")
        .select("id, race_id, user_id, source, points_deduction, notified, revoked")
        .in("source", ["abandon", "normal_dnf"]);
      return (data || []) as { id: string; race_id: string; user_id: string; source: string; points_deduction: number; notified: boolean; revoked: boolean }[];
    },
  });

  // ── DNF mutations ─────────────────────────────────────────────────────────────

  const markNormalDnf = useMutation({
    mutationFn: async ({ result }: { result: any }) => {
      const { error } = await (supabase as any).from("penalties").insert({
        race_id: result.race_id,
        user_id: result.user_id,
        penalty_type: "warning",
        points_deduction: 0,
        reason: "Normale DNF — geen straf.",
        applied_by: user!.id,
        source: "normal_dnf",
        notified: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("DNF gemarkeerd als normaal.");
      queryClient.invalidateQueries({ queryKey: ["abandon-penalties"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const markAbandon = useMutation({
    mutationFn: async ({ result }: { result: any }) => {
      const deduction = abandonPoints[result.id] ?? 5;
      const newPoints = (result.points || 0) - deduction;
      const { error: raceErr } = await supabase
        .from("race_results")
        .update({ points: newPoints })
        .eq("id", result.id);
      if (raceErr) throw raceErr;
      await supabase.rpc("recalculate_3sr_for_race" as any, { p_race_id: result.race_id });
      const raceInfo = (races as any[])?.find((r: any) => r.id === result.race_id);
      const { error: penErr } = await (supabase as any).from("penalties").insert({
        race_id: result.race_id,
        user_id: result.user_id,
        league_id: (raceInfo as any)?.league_id ?? null,
        penalty_type: "points_deduction",
        penalty_category: "B",
        penalty_sp: 3,
        points_deduction: deduction,
        reason: "Race vroegtijdig verlaten zonder geldige reden.",
        applied_by: user!.id,
        source: "abandon",
        notified: false,
      });
      if (penErr) throw penErr;
    },
    onSuccess: () => {
      toast.success("Abandon straf toegepast, Discord melding volgt.");
      queryClient.invalidateQueries({ queryKey: ["abandon-penalties"] });
      queryClient.invalidateQueries({ queryKey: ["all-results-dnf"] });
      queryClient.invalidateQueries({ queryKey: ["steward-sp-penalties"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const removeDnfPenalty = useMutation({
    mutationFn: async ({ result, penalty }: { result: any; penalty: any }) => {
      if (penalty.source === "abandon" && penalty.points_deduction > 0) {
        const { data: rr } = await supabase.from("race_results").select("points").eq("id", result.id).maybeSingle();
        if (rr) {
          const { error: rErr } = await supabase.from("race_results").update({ points: rr.points + penalty.points_deduction }).eq("id", result.id);
          if (rErr) throw rErr;
          await supabase.rpc("recalculate_3sr_for_race" as any, { p_race_id: result.race_id });
        }
      }
      if (penalty.notified) {
        const { error } = await (supabase as any).from("penalties").update({ revoked: true }).eq("id", penalty.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from("penalties").delete().eq("id", penalty.id);
        if (error) throw error;
      }
    },
    onSuccess: (_, { penalty }) => {
      toast.success(penalty.notified ? "Penalty ingetrokken — correctiebericht volgt in Discord." : "Penalty verwijderd.");
      queryClient.invalidateQueries({ queryKey: ["abandon-penalties"] });
      queryClient.invalidateQueries({ queryKey: ["all-results-dnf"] });
      queryClient.invalidateQueries({ queryKey: ["steward-sp-penalties"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Bereken SP overzicht per driver per context
  const driverSpOverview = (() => {
    if (!spPenalties?.length) return [];

    // Bouw race history map: user_id → league_key → races gesorteerd op datum desc
    const racesByContext = new Map<string, { race_id: string; race_date: string }[]>();
    for (const rr of (spRaceHistory || []) as any[]) {
      const leagueId = (rr.races as any)?.league_id ?? null;
      const key = `${rr.user_id}__${leagueId}`;
      if (!racesByContext.has(key)) racesByContext.set(key, []);
      racesByContext.get(key)!.push({ race_id: rr.race_id, race_date: (rr.races as any)?.race_date });
    }
    // Sorteer per context op datum desc
    racesByContext.forEach(arr => arr.sort((a, b) => new Date(b.race_date).getTime() - new Date(a.race_date).getTime()));

    // Groepeer penalties per driver per context
    const grouped = new Map<string, { userId: string; leagueId: string | null; leagueName: string | null; penalties: any[]; profile: any }>();
    for (const pen of spPenalties as any[]) {
      const leagueId = (pen.races as any)?.league_id ?? null;
      const league = (pen.races as any)?.leagues;
      const leagueName = league ? `${league.name}${league.season ? ` S${league.season}` : ""}` : null;
      const key = `${pen.user_id}__${leagueId}`;
      if (!grouped.has(key)) grouped.set(key, { userId: pen.user_id, leagueId, leagueName, penalties: [], profile: pen.profiles });
      grouped.get(key)!.penalties.push(pen);
    }

    const result: { userId: string; leagueId: string | null; leagueName: string | null; profile: any; totalSp: number; activePenalties: any[]; racesUntilExpiry: number }[] = [];

    for (const [key, { userId, leagueId, leagueName, penalties, profile }] of grouped) {
      const last6 = (racesByContext.get(key) || []).slice(0, 6);
      const contextRaceIds = last6.map(r => r.race_id);
      // Cutoff: als driver minder dan 6 races heeft, alle penalties actief
      // Als driver >= 6 races heeft, alleen penalties waarvan race_id in last 6 zit
      // OF waarvan we geen race-history kennen (race nog niet in results → geef benefit of doubt)
      const active = penalties.filter((p: any) => {
        if (contextRaceIds.length === 0) return true; // nog geen race history, altijd actief
        if (contextRaceIds.includes(p.race_id)) return true;
        // Penalty-race niet in race_results van driver → check op datum
        const penDate = (p.races as any)?.race_date;
        if (!penDate) return true; // geen datum info, neem mee
        const cutoffDate = last6.length === 6 ? last6[5].race_date : null;
        if (!cutoffDate) return true; // minder dan 6 races, altijd actief
        return penDate >= cutoffDate;
      });
      const totalSp = active.reduce((sum: number, p: any) => sum + (p.penalty_sp || 0), 0);
      if (totalSp <= 0) continue;

      // Hoeveel races tot oudste actieve SP vervalt
      const oldestPenaltyRaceId = active[active.length - 1]?.race_id;
      const oldestIndex = contextRaceIds.indexOf(oldestPenaltyRaceId);
      const racesUntilExpiry = oldestIndex >= 0 ? oldestIndex + 1 : 1;

      result.push({ userId, leagueId, leagueName, profile, totalSp, activePenalties: active, racesUntilExpiry });
    }

    return result.sort((a, b) => b.totalSp - a.totalSp);
  })();

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
            <option value="pit_lane_start">Pitlane start</option>
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
                {canModerate && activeTab === "protesten" && (
                  <button
                    onClick={() => { setShowStewardForm(!showStewardForm); setShowForm(false); }}
                    className="flex items-center gap-2 px-4 py-2 rounded-md bg-secondary border border-border text-foreground font-heading font-bold text-sm uppercase tracking-wider hover:bg-secondary/80 transition-colors"
                  >
                    <Zap className="w-4 h-4 text-accent" />
                    Steward Actie
                  </button>
                )}
                {activeTab === "protesten" && <button
                  onClick={() => { setShowForm(!showForm); setShowStewardForm(false); }}
                  className="flex items-center gap-2 px-4 py-2 rounded-md bg-gradient-racing text-white font-heading font-bold text-sm uppercase tracking-wider hover:opacity-90 transition-opacity"
                >
                  <Plus className="w-4 h-4" />
                  Nieuw Protest
                </button>}
              </div>
            </div>
          </div>
        </section>

        {/* Tab bar — alleen voor stewards */}
        {canModerate && (
          <div className="border-b border-border bg-card/30 sticky top-16 z-40">
            <div className="container mx-auto px-4">
              <div className="flex gap-1 py-2">
                {([
                  { id: "protesten",  label: "Protesten",  icon: Shield },
                  { id: "rijders",    label: "Rijders",    icon: Users },
                  { id: "dnf_check",  label: "DNF Check",  icon: AlertTriangle },
                ] as const).map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                      activeTab === tab.id ? "bg-gradient-racing text-white" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                    }`}
                  >
                    <tab.icon className="w-4 h-4" />
                    {tab.label}
                    {tab.id === "rijders" && driverSpOverview.length > 0 && (
                      <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-black bg-orange-500/20 text-orange-400 border border-orange-500/30">
                        {driverSpOverview.length}
                      </span>
                    )}
                    {tab.id === "dnf_check" && (() => {
                      const open = (completedRacesForDnf || []).reduce((n, race: any) => {
                        const dnfs = (allResultsForDnf || []).filter((r: any) => r.race_id === race.id && r.dnf);
                        return n + dnfs.filter((r: any) => !(existingAbandonPenalties || []).some((p: any) => p.race_id === r.race_id && p.user_id === r.user_id)).length;
                      }, 0);
                      return open > 0 ? (
                        <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-black bg-red-500/20 text-red-400 border border-red-500/30">{open}</span>
                      ) : null;
                    })()}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <section className="py-12">
          <div className="container mx-auto px-4">

            {/* Rijders SP overzicht tab */}
            {activeTab === "rijders" && canModerate && (
              <div className="space-y-3">
                {!driverSpOverview.length ? (
                  <div className="text-center py-24 text-muted-foreground">
                    <Users className="w-12 h-12 mx-auto mb-4 opacity-40" />
                    <p className="text-lg font-heading font-bold">GEEN ACTIEVE STRAFFEN</p>
                    <p className="text-sm mt-1">Alle drivers hebben 0 strafpunten.</p>
                  </div>
                ) : driverSpOverview.map((entry, i) => {
                  const name = entry.profile?.iracing_name || entry.profile?.display_name || "Onbekend";
                  const context = entry.leagueName ?? "Losse races";
                  const isExpanded = expandedId === `driver_${entry.userId}_${entry.leagueId}`;
                  const spColor = entry.totalSp >= 15 ? "text-red-400 border-red-500/30 bg-red-500/10"
                    : entry.totalSp >= 10 ? "text-orange-400 border-orange-500/30 bg-orange-500/10"
                    : entry.totalSp >= 6  ? "text-yellow-400 border-yellow-500/30 bg-yellow-500/10"
                    : "text-muted-foreground border-border bg-secondary";
                  const threshold = SP_THRESHOLDS.slice().reverse().find(t => entry.totalSp >= t.sp);

                  return (
                    <motion.div key={`${entry.userId}_${entry.leagueId}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }} className="bg-card border border-border rounded-lg overflow-hidden">
                      <div
                        className="flex items-center justify-between gap-4 p-4 cursor-pointer hover:bg-secondary/20 transition-colors"
                        onClick={() => setExpandedId(isExpanded ? null : `driver_${entry.userId}_${entry.leagueId}`)}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`px-2.5 py-1 rounded-md border text-sm font-black tabular-nums shrink-0 ${spColor}`}>
                            {entry.totalSp} SP
                          </div>
                          <div className="min-w-0">
                            <div className="font-heading font-bold truncate">{name}</div>
                            <div className="text-xs text-muted-foreground">{context}</div>
                          </div>
                          {threshold && (
                            <span className={`hidden sm:inline text-xs font-bold px-2 py-0.5 rounded border ${spColor}`}>
                              {threshold.label}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-4 shrink-0">
                          <div className="text-right hidden sm:block">
                            <div className="text-xs text-muted-foreground">Vervalt na</div>
                            <div className="text-sm font-bold">{entry.racesUntilExpiry} race{entry.racesUntilExpiry !== 1 ? "s" : ""}</div>
                          </div>
                          <div className="text-right hidden sm:block">
                            <div className="text-xs text-muted-foreground">Straffen</div>
                            <div className="text-sm font-bold">{entry.activePenalties.length}x</div>
                          </div>
                          {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="border-t border-border/50 px-4 pb-4 pt-3 space-y-2">
                          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Actieve straffen</div>
                          {entry.activePenalties.map((pen: any) => (
                            <div key={pen.id} className="flex items-start justify-between gap-3 py-2 border-b border-border/30 last:border-0">
                              <div className="min-w-0">
                                <div className="text-sm font-medium">{pen.races?.name || "Onbekende race"}</div>
                                <div className="text-xs text-muted-foreground mt-0.5">
                                  {penaltyLabels[pen.penalty_type] || pen.penalty_type}
                                  {pen.penalty_category && ` · Cat. ${pen.penalty_category}`}
                                  {" · "}{new Date(pen.created_at).toLocaleDateString("nl-NL")}
                                </div>
                                {pen.reason && <div className="text-xs text-muted-foreground mt-0.5 italic">"{pen.reason}"</div>}
                              </div>
                              <div className="shrink-0 text-right">
                                <div className={`text-sm font-black ${pen.penalty_sp >= 5 ? "text-orange-400" : "text-muted-foreground"}`}>+{pen.penalty_sp} SP</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </div>
            )}

            {/* Protest formulier */}
            {activeTab === "protesten" && <>
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
            </>}

            {/* DNF Check tab */}
            {activeTab === "dnf_check" && canModerate && (() => {
              const racesWithDnf = (completedRacesForDnf || []).map((race: any) => {
                const raceResults = (allResultsForDnf || []).filter((r: any) => r.race_id === race.id).sort((a: any, b: any) => a.position - b.position);
                const dnfResults = raceResults.filter((r: any) => r.dnf === true);
                const openCount = dnfResults.filter((r: any) => !(existingAbandonPenalties || []).some((p: any) => p.race_id === r.race_id && p.user_id === r.user_id)).length;
                return { race, dnfResults, openCount };
              }).filter(({ dnfResults }) => dnfResults.length > 0);

              const visibleRaces = showAllDnf ? racesWithDnf : racesWithDnf.filter(({ openCount }) => openCount > 0);

              return (
                <div>
                  <div className="flex items-center justify-between mb-6">
                    <div>
                      <h2 className="font-heading text-2xl font-black">DNF CHECK</h2>
                      <p className="text-sm text-muted-foreground mt-1">Markeer DNF drivers als abandon (cat. B · 3 SP) of normale DNF.</p>
                    </div>
                    <button
                      onClick={() => setShowAllDnf(v => !v)}
                      className="text-xs px-3 py-1.5 rounded border border-border text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showAllDnf ? "Alleen open" : `Toon alles (${racesWithDnf.length})`}
                    </button>
                  </div>

                  {visibleRaces.length === 0 ? (
                    <div className="text-center py-16 text-muted-foreground">
                      <AlertTriangle className="w-10 h-10 mx-auto mb-3 opacity-30" />
                      <p className="font-heading font-bold">ALLES AFGEHANDELD</p>
                      <p className="text-sm mt-1">Geen openstaande DNF's om te beoordelen.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {visibleRaces.map(({ race, dnfResults, openCount }) => {
                        const isExpanded = expandedDnfRace === race.id;
                        return (
                          <div key={race.id} className="bg-card border border-border rounded-lg overflow-hidden">
                            <button
                              onClick={() => setExpandedDnfRace(isExpanded ? null : race.id)}
                              className="w-full px-5 py-3 flex items-center gap-3 hover:bg-secondary/30 transition-colors text-left"
                            >
                              <div className="flex-1 min-w-0">
                                <span className="font-heading font-bold">{race.name}</span>
                                <span className="text-xs text-muted-foreground ml-3">{race.track} · {new Date(race.race_date).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" })}</span>
                              </div>
                              {openCount > 0
                                ? <span className="text-xs px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-400 border border-orange-500/30 font-bold shrink-0">{openCount} open</span>
                                : <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 border border-green-500/30 font-bold shrink-0">✓ afgehandeld</span>
                              }
                              <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform shrink-0 ${isExpanded ? "rotate-180" : ""}`} />
                            </button>

                            {isExpanded && (
                              <div className="border-t border-border divide-y divide-border/40">
                                {dnfResults.map((result: any) => {
                                  const reviewed = (existingAbandonPenalties || []).find((p: any) => p.race_id === result.race_id && p.user_id === result.user_id);
                                  const driverName = result.profiles?.display_name || result.profiles?.iracing_name || "Onbekend";
                                  return (
                                    <div key={result.id} className="px-5 py-3 flex items-center gap-4 flex-wrap">
                                      <span className="font-heading font-black text-red-400 w-12">DNF</span>
                                      <span className="flex-1 font-heading font-bold text-sm">{driverName}</span>
                                      <span className="text-sm text-muted-foreground">{result.points} pts · {result.laps} ronden</span>
                                      {reviewed ? (
                                        <div className="flex items-center gap-2">
                                          {reviewed.revoked
                                            ? <span className="text-xs px-2 py-1 rounded bg-secondary text-muted-foreground border border-border font-bold">↩ Ingetrokken</span>
                                            : reviewed.source === "abandon"
                                              ? <span className="text-xs px-2 py-1 rounded bg-orange-500/20 text-orange-400 border border-orange-500/30 font-bold flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Abandon</span>
                                              : <span className="text-xs px-2 py-1 rounded bg-green-500/20 text-green-400 border border-green-500/30 font-bold">✓ Normale DNF</span>
                                          }
                                          {!reviewed.revoked && (
                                            <button
                                              onClick={() => removeDnfPenalty.mutate({ result, penalty: reviewed })}
                                              disabled={removeDnfPenalty.isPending}
                                              className="text-xs px-2 py-1 rounded bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 font-bold transition-colors"
                                            >
                                              ✕ Ongedaan
                                            </button>
                                          )}
                                        </div>
                                      ) : (
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <button
                                            onClick={() => markNormalDnf.mutate({ result })}
                                            disabled={markNormalDnf.isPending}
                                            className="px-3 py-1.5 rounded bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30 text-xs font-bold transition-colors"
                                          >
                                            ✓ Normale DNF
                                          </button>
                                          <div className="flex items-center gap-1">
                                            <span className="text-xs text-muted-foreground">straf:</span>
                                            <input
                                              type="number"
                                              min={1}
                                              max={50}
                                              value={abandonPoints[result.id] ?? 5}
                                              onChange={e => setAbandonPoints(prev => ({ ...prev, [result.id]: parseInt(e.target.value) || 5 }))}
                                              className="w-14 px-2 py-1 rounded border border-border bg-background text-sm text-center"
                                            />
                                            <span className="text-xs text-muted-foreground">→ wordt</span>
                                            <span className="text-sm font-heading font-black text-orange-400">
                                              {(result.points || 0) - (abandonPoints[result.id] ?? 5)} pts
                                            </span>
                                          </div>
                                          <button
                                            onClick={() => markAbandon.mutate({ result })}
                                            disabled={markAbandon.isPending}
                                            className="px-3 py-1.5 rounded bg-orange-500/20 text-orange-400 border border-orange-500/30 hover:bg-orange-500/30 text-xs font-bold transition-colors flex items-center gap-1"
                                          >
                                            <AlertTriangle className="w-3 h-3" /> Abandon
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default StewardPage;
