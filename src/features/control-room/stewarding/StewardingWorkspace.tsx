import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, ChevronUp, ClipboardCheck, Shield, Users } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { CATEGORY_META, CATEGORY_PRESETS, penaltyLabels, SP_THRESHOLDS, statusStyles } from "@/lib/stewardConstants";
import type { Category } from "@/lib/stewardConstants";
import { calculateActiveSpOverview } from "./activeSpOverview";
import type { SpPenalty, SpProfile, SpRaceHistory } from "./activeSpOverview";

export type StewardPenaltyInput = {
  penaltyCategory: Category | "";
  penaltyType: string;
  penaltySp: number;
  timePenaltySeconds: number;
  gridPenaltyPlaces: number;
  raceBanNext: boolean;
  pointsDeduction: number;
  notes: string;
};

export type StewardingAction =
  | { id: "protest-review"; impact: "write"; allowedRoles: Array<"moderator" | "admin" | "super_admin">; context: { protestId: string; raceId: string; accusedUserId: string; status: "resolved" | "dismissed"; penalty: StewardPenaltyInput; publicDecision: string } }
  | { id: "protest-under-review"; impact: "write"; allowedRoles: Array<"moderator" | "admin" | "super_admin">; context: { protestId: string } }
  | { id: "steward-action"; impact: "write"; allowedRoles: Array<"moderator" | "admin" | "super_admin">; context: { raceId: string; accusedUserId: string; penalty: StewardPenaltyInput } }
  | { id: "dnf-review"; impact: "write"; allowedRoles: Array<"moderator" | "admin" | "super_admin">; context: { resultId: string; raceId: string; userId: string; outcome: "normal_dnf" | "abandon"; pointsDeduction?: number } }
  | { id: "dnf-revoke"; impact: "destructive"; allowedRoles: Array<"moderator" | "admin" | "super_admin">; context: { resultId: string; penaltyId: string; raceId: string; userId: string; source: "abandon" | "normal_dnf" } };

export type StewardingWorkspaceProps = {
  /** @deprecated Native mutations are owned by this workspace. Kept only for source compatibility. */
  onAction?: (action: StewardingAction) => void | Promise<void>;
};

type Profile = { display_name: string | null; iracing_name: string | null };
type Protest = { id: string; race_id: string; reporter_user_id: string; accused_user_id: string; status: string; description: string; video_link: string | null; lap_number: number | null; created_at: string; steward_notes: string | null; races: { name: string; track: string; race_date: string; league_id: string | null } | null; reporter: Profile | null; accused: Profile | null };
type Race = { id: string; name: string; track: string; race_date: string; league_id: string | null };
type Driver = { user_id: string; display_name: string | null; iracing_name: string | null };
type DnfResult = { id: string; race_id: string; user_id: string; position: number; points: number; dnf: boolean | null; laps: number | null; profiles: Profile | null };
type DnfPenalty = { id: string; race_id: string; user_id: string; source: "abandon" | "normal_dnf"; points_deduction: number; notified: boolean; revoked: boolean };
type Confirmation = { action: StewardingAction; label: string; detail: string };

const roles = ["moderator", "admin", "super_admin"] as const;
const emptyPenalty = (): StewardPenaltyInput => ({ penaltyCategory: "", penaltyType: "", penaltySp: 0, timePenaltySeconds: 0, gridPenaltyPlaces: 0, raceBanNext: false, pointsDeduction: 0, notes: "" });
const categoryPreset = (category: Category): Partial<StewardPenaltyInput> => {
  const preset = CATEGORY_PRESETS[category];
  return { penaltyType: preset.penalty_type, penaltySp: preset.penalty_sp, timePenaltySeconds: preset.time_penalty_seconds, gridPenaltyPlaces: preset.grid_penalty_places, raceBanNext: preset.race_ban_next };
};
const nameOf = (profile: Profile | null | undefined) => profile?.iracing_name || profile?.display_name || "Onbekend";
const formatDate = (value: string) => new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Amsterdam" }).format(new Date(value));
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Onbekende fout";

export function StewardingWorkspace(_: StewardingWorkspaceProps) {
  const { user, isAdmin, isSuperAdmin, isSteward } = useAuth();
  const queryClient = useQueryClient();
  const canModerate = Boolean(user && (isAdmin || isSuperAdmin || isSteward));
  const [tab, setTab] = useState<"protests" | "drivers" | "dnf">("protests");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, { status: "resolved" | "dismissed" | ""; penalty: StewardPenaltyInput; publicDecision: string }>>({});
  const [directAction, setDirectAction] = useState({ raceId: "", driverId: "", penalty: emptyPenalty() });
  const [showDirectAction, setShowDirectAction] = useState(false);
  const [dnfPoints, setDnfPoints] = useState<Record<string, number>>({});
  const [showHandledDnfs, setShowHandledDnfs] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  const protestsQuery = useQuery({ queryKey: ["control-room", "stewarding", "protests"], enabled: canModerate, queryFn: async (): Promise<Protest[]> => {
    const { data, error } = await supabase.from("protests").select("*, races(name,track,race_date,league_id), reporter:profiles!protests_reporter_user_id_fkey(display_name,iracing_name), accused:profiles!protests_accused_user_id_fkey(display_name,iracing_name)").order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []) as Protest[];
  }});
  const racesQuery = useQuery({ queryKey: ["control-room", "stewarding", "races"], enabled: canModerate, queryFn: async (): Promise<Race[]> => {
    const { data, error } = await supabase.from("races").select("id,name,track,race_date,league_id").eq("status", "completed").order("race_date", { ascending: false });
    if (error) throw error;
    return data || [];
  }});
  const driversQuery = useQuery({ queryKey: ["control-room", "stewarding", "drivers"], enabled: canModerate, queryFn: async (): Promise<Driver[]> => {
    const { data, error } = await supabase.from("public_profiles").select("user_id,display_name,iracing_name").order("display_name");
    if (error) throw error;
    return data || [];
  }});
  const dnfQuery = useQuery({ queryKey: ["control-room", "stewarding", "dnf-results"], enabled: canModerate && tab === "dnf", queryFn: async (): Promise<DnfResult[]> => {
    const { data, error } = await supabase.from("race_results").select("id,race_id,user_id,position,points,dnf,laps,profiles(display_name,iracing_name)").eq("dnf", true);
    if (error) throw error;
    return (data || []) as DnfResult[];
  }});
  const dnfPenaltiesQuery = useQuery({ queryKey: ["control-room", "stewarding", "dnf-penalties"], enabled: canModerate && tab === "dnf", queryFn: async (): Promise<DnfPenalty[]> => {
    const { data, error } = await supabase.from("penalties").select("id,race_id,user_id,source,points_deduction,notified,revoked").in("source", ["abandon", "normal_dnf"]);
    if (error) throw error;
    return (data || []) as DnfPenalty[];
  }});
  const spPenaltiesQuery = useQuery({ queryKey: ["steward-sp-penalties"], enabled: canModerate && tab === "drivers", queryFn: async (): Promise<SpPenalty[]> => {
    const { data, error } = await supabase.from("penalties").select("id,user_id,race_id,league_id,penalty_sp,penalty_type,penalty_category,reason,created_at,races(id,name,race_date,league_id,leagues(name,season))").eq("revoked", false).not("penalty_category", "is", null).order("created_at", { ascending: false });
    if (error) throw error;
    const penaltyRows = (data || []) as Omit<SpPenalty, "profile">[];
    if (!penaltyRows.length) return [];
    const userIds = [...new Set(penaltyRows.map((penalty) => penalty.user_id))];
    const { data: profileRows, error: profileError } = await supabase.from("public_profiles").select("user_id,display_name,iracing_name").in("user_id", userIds);
    if (profileError) throw profileError;
    const profileMap = new Map<string, SpProfile>((profileRows || []).map((profile) => [profile.user_id, profile as SpProfile]));
    return penaltyRows.map((penalty) => ({ ...penalty, profile: profileMap.get(penalty.user_id) || null }));
  }});
  const spRaceHistoryQuery = useQuery({ queryKey: ["steward-race-history"], enabled: canModerate && tab === "drivers" && Boolean(spPenaltiesQuery.data?.length), queryFn: async (): Promise<SpRaceHistory[]> => {
    const userIds = [...new Set((spPenaltiesQuery.data || []).map((penalty) => penalty.user_id))];
    const { data, error } = await supabase.from("race_results").select("user_id,race_id,races(id,race_date,league_id)").in("user_id", userIds);
    if (error) throw error;
    return (data || []) as SpRaceHistory[];
  }});

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["control-room", "stewarding"] }),
      queryClient.invalidateQueries({ queryKey: ["my-protests"] }),
      queryClient.invalidateQueries({ queryKey: ["race-results"] }),
      queryClient.invalidateQueries({ queryKey: ["all-results-dnf"] }),
      queryClient.invalidateQueries({ queryKey: ["abandon-penalties"] }),
      queryClient.invalidateQueries({ queryKey: ["steward-sp-penalties"] }),
    ]);
  };

  const mutation = useMutation({
    mutationFn: async (action: StewardingAction) => {
      if (!user) throw new Error("Je sessie is verlopen. Meld je opnieuw aan.");
      if (action.id === "protest-under-review") {
        const { error } = await supabase.from("protests").update({ status: "under_review" }).eq("id", action.context.protestId);
        if (error) throw error;
        return;
      }
      if (action.id === "protest-review") {
        const protest = (protestsQuery.data || []).find((item) => item.id === action.context.protestId);
        if (!protest) throw new Error("Dit protest is niet meer beschikbaar. Vernieuw de lijst.");
        const { penalty, status } = action.context;
        const penaltyType = penalty.penaltyType || null;
        const { error: protestError } = await supabase.from("protests").update({ status, steward_notes: penalty.notes || null, public_decision: action.context.publicDecision.trim() || null, penalty_type: penaltyType, penalty_points: penalty.pointsDeduction || 0, penalty_category: penalty.penaltyCategory || null, time_penalty_seconds: penalty.timePenaltySeconds || null, grid_penalty_places: penalty.gridPenaltyPlaces || null, race_ban_next: penalty.raceBanNext || false, decided_at: new Date().toISOString() }).eq("id", protest.id);
        if (protestError) throw protestError;
        if (status !== "resolved" || !penaltyType) return;
        await applyResultPenalty(protest.race_id, protest.accused_user_id, penaltyType, penalty.pointsDeduction);
        const { error } = await supabase.from("penalties").insert({ protest_id: protest.id, race_id: protest.race_id, user_id: protest.accused_user_id, league_id: protest.races?.league_id ?? null, penalty_type: penaltyType, penalty_category: penalty.penaltyCategory || null, penalty_sp: penalty.penaltySp || 0, time_penalty_seconds: penalty.timePenaltySeconds || 0, grid_penalty_places: penalty.gridPenaltyPlaces || 0, race_ban_next: penalty.raceBanNext || false, points_deduction: penalty.pointsDeduction || 0, reason: penalty.notes || "", applied_by: user.id, source: "steward" });
        if (error) throw error;
        return;
      }
      if (action.id === "steward-action") {
        const { raceId, accusedUserId, penalty } = action.context;
        if (!raceId || !accusedUserId || !penalty.notes.trim() || !penalty.penaltyType) throw new Error("Vul race, driver, straf en motivatie in.");
        await applyResultPenalty(raceId, accusedUserId, penalty.penaltyType, penalty.pointsDeduction);
        const race = (racesQuery.data || []).find((item) => item.id === raceId);
        const { error } = await supabase.from("penalties").insert({ race_id: raceId, user_id: accusedUserId, league_id: race?.league_id ?? null, penalty_type: penalty.penaltyType, penalty_category: penalty.penaltyCategory || null, penalty_sp: penalty.penaltySp, time_penalty_seconds: penalty.timePenaltySeconds, grid_penalty_places: penalty.gridPenaltyPlaces, race_ban_next: penalty.raceBanNext, points_deduction: penalty.pointsDeduction, reason: penalty.notes.trim(), applied_by: user.id, source: "steward", steward_initiated: true, steward_description: penalty.notes.trim(), notified: false });
        if (error) throw error;
        return;
      }
      const result = (dnfQuery.data || []).find((item) => item.id === action.context.resultId);
      if (!result) throw new Error("Dit DNF-resultaat is niet meer beschikbaar. Vernieuw de lijst.");
      if (action.id === "dnf-review") {
        if (action.context.outcome === "normal_dnf") {
          const { error } = await supabase.from("penalties").insert({ race_id: result.race_id, user_id: result.user_id, penalty_type: "warning", points_deduction: 0, reason: "Normale DNF — geen straf.", applied_by: user.id, source: "normal_dnf", notified: true });
          if (error) throw error;
          return;
        }
        const deduction = action.context.pointsDeduction ?? 5;
        const { error: resultError } = await supabase.from("race_results").update({ points: (result.points || 0) - deduction }).eq("id", result.id);
        if (resultError) throw resultError;
        const { error: rpcError } = await supabase.rpc("recalculate_3sr_for_race", { p_race_id: result.race_id });
        if (rpcError) throw rpcError;
        const race = (racesQuery.data || []).find((item) => item.id === result.race_id);
        const { error } = await supabase.from("penalties").insert({ race_id: result.race_id, user_id: result.user_id, league_id: race?.league_id ?? null, penalty_type: "points_deduction", penalty_category: "B", penalty_sp: 3, points_deduction: deduction, reason: "Race vroegtijdig verlaten zonder geldige reden.", applied_by: user.id, source: "abandon", notified: false });
        if (error) throw error;
        return;
      }
      const penalty = (dnfPenaltiesQuery.data || []).find((item) => item.id === action.context.penaltyId);
      if (!penalty) throw new Error("Deze DNF-beoordeling is niet meer beschikbaar. Vernieuw de lijst.");
      if (penalty.source === "normal_dnf") {
        const { error } = await supabase.from("penalties").delete().eq("id", penalty.id);
        if (error) throw error;
        return;
      }
      if (penalty.points_deduction > 0) {
        const { data: latestResult, error: selectError } = await supabase.from("race_results").select("points").eq("id", result.id).maybeSingle();
        if (selectError) throw selectError;
        if (latestResult) {
          const { error } = await supabase.from("race_results").update({ points: latestResult.points + penalty.points_deduction }).eq("id", result.id);
          if (error) throw error;
          const { error: rpcError } = await supabase.rpc("recalculate_3sr_for_race", { p_race_id: result.race_id });
          if (rpcError) throw rpcError;
        }
      }
      const { error } = penalty.notified ? await supabase.from("penalties").update({ revoked: true }).eq("id", penalty.id) : await supabase.from("penalties").delete().eq("id", penalty.id);
      if (error) throw error;
    },
    onSuccess: async (_data, action) => {
      await invalidate();
      setFeedback({ kind: "success", message: action.id === "dnf-revoke" ? "DNF-beoordeling ongedaan gemaakt." : action.id === "protest-under-review" ? "Protest onder review gezet." : "Stewardactie succesvol verwerkt." });
      if (action.id === "protest-review") { setDecisions((current) => { const next = { ...current }; delete next[action.context.protestId]; return next; }); setExpandedId(null); }
      if (action.id === "steward-action") { setDirectAction({ raceId: "", driverId: "", penalty: emptyPenalty() }); setShowDirectAction(false); }
      setConfirmation(null);
    },
    onError: (error) => setFeedback({ kind: "error", message: errorMessage(error) }),
  });

  async function applyResultPenalty(raceId: string, userId: string, penaltyType: string, pointsDeduction: number) {
    if (penaltyType === "disqualification") {
      const { error } = await supabase.from("race_results").update({ dnf: true, points: 0 }).eq("race_id", raceId).eq("user_id", userId);
      if (error) throw error;
      const { error: rpcError } = await supabase.rpc("recalculate_3sr_for_race", { p_race_id: raceId });
      if (rpcError) throw rpcError;
    } else if (penaltyType === "points_deduction" && pointsDeduction > 0) {
      const { data: result, error: selectError } = await supabase.from("race_results").select("points").eq("race_id", raceId).eq("user_id", userId).maybeSingle();
      if (selectError) throw selectError;
      if (!result) throw new Error("Geen race resultaat gevonden voor puntenaftrek.");
      const { error } = await supabase.from("race_results").update({ points: Math.max(0, (result.points || 0) - pointsDeduction) }).eq("race_id", raceId).eq("user_id", userId);
      if (error) throw error;
      const { error: rpcError } = await supabase.rpc("recalculate_3sr_for_race", { p_race_id: raceId });
      if (rpcError) throw rpcError;
    }
  }

  const races = racesQuery.data || [];
  const drivers = driversQuery.data || [];
  const driverSpOverview = useMemo(() => calculateActiveSpOverview(spPenaltiesQuery.data || [], spRaceHistoryQuery.data || []), [spPenaltiesQuery.data, spRaceHistoryQuery.data]);
  const dnfReviewGroups = useMemo(() => {
    const activePenaltyKeys = new Set(
      (dnfPenaltiesQuery.data || [])
        .filter((penalty) => !penalty.revoked)
        .map((penalty) => `${penalty.race_id}:${penalty.user_id}`),
    );
    const pending = new Map<string, DnfResult[]>();
    const handled = new Map<string, DnfResult[]>();
    for (const result of dnfQuery.data || []) {
      const target = activePenaltyKeys.has(`${result.race_id}:${result.user_id}`) ? handled : pending;
      target.set(result.race_id, [...(target.get(result.race_id) || []), result]);
    }
    return { pending, handled };
  }, [dnfQuery.data, dnfPenaltiesQuery.data]);
  const decisionFor = (id: string) => decisions[id] || { status: "" as const, penalty: emptyPenalty(), publicDecision: "" };
  const setPenalty = (id: string, update: Partial<StewardPenaltyInput>) => setDecisions((current) => ({ ...current, [id]: { ...decisionFor(id), penalty: { ...decisionFor(id).penalty, ...update } } }));
  const setPublicDecision = (id: string, publicDecision: string) => setDecisions((current) => ({ ...current, [id]: { ...decisionFor(id), publicDecision } }));
  const chooseCategory = (id: string, category: Category) => setPenalty(id, { penaltyCategory: category, ...categoryPreset(category) });
  const ask = (action: StewardingAction, label: string, detail: string) => { setFeedback(null); setConfirmation({ action, label, detail }); };

  if (!canModerate) return <section className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-6 text-sm text-gray-400"><Shield className="mb-2 h-5 w-5 text-orange-300" />Meld je aan met een steward-, admin- of super-adminrol om zaken te behandelen.</section>;
  const isLoading = protestsQuery.isLoading || racesQuery.isLoading || driversQuery.isLoading;
  const queryError = protestsQuery.error || racesQuery.error || driversQuery.error || (tab === "dnf" ? dnfQuery.error || dnfPenaltiesQuery.error : tab === "drivers" ? spPenaltiesQuery.error || spRaceHistoryQuery.error : null);

  return <section aria-label="Stewarding" className="space-y-5 text-gray-100">
    <header className="flex flex-col gap-4 border-b border-white/[0.08] pb-5 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-orange-300">Control Room</p><h2 className="mt-1 font-heading text-2xl font-black">STEWARDING</h2><p className="mt-1 text-sm text-gray-400">Protesten, directe stewardacties en DNF-beoordelingen.</p></div><button type="button" onClick={() => setShowDirectAction((visible) => !visible)} className="rounded-lg border border-orange-400/40 bg-orange-500/15 px-4 py-2 text-sm font-black text-orange-100">Directe actie</button></header>
    <div className="flex gap-1 border-b border-white/[0.08] pb-1" role="tablist"><button type="button" role="tab" aria-selected={tab === "protests"} onClick={() => setTab("protests")} className={`rounded-md px-3 py-2 text-sm font-semibold ${tab === "protests" ? "bg-orange-500/15 text-white" : "text-gray-400"}`}>Protesten</button><button type="button" role="tab" aria-selected={tab === "drivers"} onClick={() => setTab("drivers")} className={`rounded-md px-3 py-2 text-sm font-semibold ${tab === "drivers" ? "bg-orange-500/15 text-white" : "text-gray-400"}`}>Rijders{driverSpOverview.length > 0 && <span className="ml-1.5 rounded-full border border-orange-400/30 bg-orange-500/15 px-1.5 py-0.5 text-[10px] font-black text-orange-200">{driverSpOverview.length}</span>}</button><button type="button" role="tab" aria-selected={tab === "dnf"} onClick={() => setTab("dnf")} className={`rounded-md px-3 py-2 text-sm font-semibold ${tab === "dnf" ? "bg-orange-500/15 text-white" : "text-gray-400"}`}>DNF-check</button></div>
    {feedback && <p role="status" className={`rounded-lg border p-3 text-sm ${feedback.kind === "error" ? "border-red-400/30 bg-red-400/10 text-red-200" : "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"}`}>{feedback.message}</p>}
    {queryError && <p role="alert" className="rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">Stewardingdata kon niet geladen worden: {errorMessage(queryError)}</p>}
    {showDirectAction && <DirectAction races={races} drivers={drivers} value={directAction} onChange={setDirectAction} onSubmit={() => ask({ id: "steward-action", impact: "write", allowedRoles: [...roles], context: { raceId: directAction.raceId, accusedUserId: directAction.driverId, penalty: directAction.penalty } }, "Directe stewardactie toepassen?", "De straf wordt opgeslagen en kan resultaten/3SR opnieuw berekenen.")} pending={mutation.isPending} />}
    {isLoading && <p className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-6 text-sm text-gray-400">Stewardingdata laden…</p>}
    {!isLoading && !queryError && tab === "protests" && <div className="space-y-3">{(protestsQuery.data || []).length === 0 ? <Empty icon={ClipboardCheck} text="Geen protesten gevonden." /> : (protestsQuery.data || []).map((protest) => { const expanded = expandedId === protest.id; const decision = decisionFor(protest.id); const involved = protest.reporter_user_id === user?.id || protest.accused_user_id === user?.id; const closed = protest.status === "resolved" || protest.status === "dismissed"; return <article key={protest.id} className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-4"><div className="flex gap-4"><button type="button" onClick={() => setExpandedId(expanded ? null : protest.id)} className="min-w-0 flex-1 text-left"><div className="flex flex-wrap items-center gap-2"><span className="font-heading font-bold">{nameOf(protest.reporter)} <span className="text-orange-300">→</span> {nameOf(protest.accused)}</span><span className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase ${statusStyles[protest.status]?.color || "border-white/10 text-gray-400"}`}>{statusStyles[protest.status]?.label || protest.status}</span></div><p className="mt-1 text-xs text-gray-400">{protest.races?.name || "Onbekende race"} · {protest.races?.track} · {formatDate(protest.created_at)}{protest.lap_number ? ` · ronde ${protest.lap_number}` : ""}</p><p className="mt-2 line-clamp-2 text-sm text-gray-300">{protest.description}</p></button>{expanded ? <ChevronUp className="mt-1 h-4 w-4 text-gray-500" /> : <ChevronDown className="mt-1 h-4 w-4 text-gray-500" />}</div>{expanded && <div className="mt-4 border-t border-white/[0.08] pt-4"><p className="whitespace-pre-wrap text-sm text-gray-200">{protest.description}</p>{protest.video_link && <a className="mt-2 inline-block text-xs font-bold text-orange-300 hover:underline" href={protest.video_link} target="_blank" rel="noreferrer">Video openen</a>}{protest.steward_notes && <p className="mt-3 rounded-lg bg-black/15 p-3 text-sm text-gray-300">{protest.steward_notes}</p>}{!closed && !involved && <DecisionForm decision={decision} setStatus={(status) => setDecisions((current) => ({ ...current, [protest.id]: { ...decisionFor(protest.id), status } }))} setPenalty={(update) => setPenalty(protest.id, update)} setPublicDecision={(value) => setPublicDecision(protest.id, value)} chooseCategory={(category) => chooseCategory(protest.id, category)} onReview={() => ask({ id: "protest-under-review", impact: "write", allowedRoles: [...roles], context: { protestId: protest.id } }, "Protest onder review zetten?", "De status wordt direct zichtbaar voor betrokkenen.")} onSubmit={() => ask({ id: "protest-review", impact: "write", allowedRoles: [...roles], context: { protestId: protest.id, raceId: protest.race_id, accusedUserId: protest.accused_user_id, status: decision.status as "resolved" | "dismissed", penalty: decision.penalty, publicDecision: decision.publicDecision } }, "Uitspraak bevestigen?", decision.status === "resolved" ? "De uitspraak en eventuele straf worden definitief verwerkt." : "Het protest wordt afgewezen en gesloten.")} underReview={protest.status === "pending"} pending={mutation.isPending} />}{!closed && involved && <p className="mt-4 rounded-lg border border-yellow-400/25 bg-yellow-400/10 p-3 text-sm text-yellow-100">Je bent betrokken bij dit protest en kunt het niet zelf behandelen.</p>}</div>}</article>; })}</div>}
    {!isLoading && !queryError && tab === "drivers" && <DriverSpOverview overview={driverSpOverview} expandedId={expandedId} onToggle={(id) => setExpandedId(expandedId === id ? null : id)} />}
    {!isLoading && !queryError && tab === "dnf" && <div className="space-y-5">
      <section aria-labelledby="pending-dnf-heading" className="space-y-3">
        <div className="flex items-center justify-between gap-3"><div><h3 id="pending-dnf-heading" className="font-heading text-lg font-black">Te beoordelen</h3><p className="mt-0.5 text-xs text-gray-400">Alle DNF's waarvoor nog geen beslissing is opgeslagen.</p></div><span className="rounded-full border border-orange-400/30 bg-orange-500/10 px-2.5 py-1 text-xs font-black text-orange-200">{[...dnfReviewGroups.pending.values()].reduce((total, results) => total + results.length, 0)}</span></div>
        <DnfRaceGroups groups={dnfReviewGroups.pending} races={races} penalties={dnfPenaltiesQuery.data || []} dnfPoints={dnfPoints} setDnfPoints={setDnfPoints} pending={mutation.isPending} ask={ask} emptyText="Geen openstaande DNF-beoordelingen." />
      </section>
      <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.015]">
        <button type="button" aria-expanded={showHandledDnfs} onClick={() => setShowHandledDnfs((visible) => !visible)} className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-white/[0.025]"><span><b className="font-heading">Afgehandeld</b><small className="ml-2 text-gray-500">Normale DNF's en toegepaste abandonstraffen</small></span><span className="flex items-center gap-2"><span className="rounded-full border border-white/10 px-2 py-0.5 text-xs font-black text-gray-300">{[...dnfReviewGroups.handled.values()].reduce((total, results) => total + results.length, 0)}</span>{showHandledDnfs ? <ChevronUp className="h-4 w-4 text-gray-500" /> : <ChevronDown className="h-4 w-4 text-gray-500" />}</span></button>
        {showHandledDnfs && <div className="space-y-3 border-t border-white/[0.08] p-3"><DnfRaceGroups groups={dnfReviewGroups.handled} races={races} penalties={dnfPenaltiesQuery.data || []} dnfPoints={dnfPoints} setDnfPoints={setDnfPoints} pending={mutation.isPending} ask={ask} emptyText="Nog geen afgehandelde DNF-beoordelingen." /></div>}
      </section>
    </div>}
    {confirmation && <div role="dialog" aria-modal="true" aria-label={confirmation.label} className="rounded-xl border border-orange-400/30 bg-[#151820] p-4 shadow-2xl"><h3 className="font-heading text-lg font-black">{confirmation.label}</h3><p className="mt-2 text-sm text-gray-300">{confirmation.detail}</p>{mutation.isError && <p className="mt-3 rounded bg-red-500/10 p-2 text-sm text-red-200">{errorMessage(mutation.error)}</p>}<div className="mt-4 flex gap-2"><button type="button" disabled={mutation.isPending} onClick={() => mutation.mutate(confirmation.action)} className="rounded-md bg-gradient-racing px-4 py-2 text-sm font-black text-white disabled:opacity-50">{mutation.isPending ? "Verwerken…" : "Bevestigen"}</button><button type="button" disabled={mutation.isPending} onClick={() => setConfirmation(null)} className="rounded-md border border-white/15 px-4 py-2 text-sm font-bold text-gray-300 disabled:opacity-50">Annuleren</button></div></div>}
  </section>;
}

function DecisionForm({ decision, setStatus, setPenalty, setPublicDecision, chooseCategory, onReview, onSubmit, underReview, pending }: { decision: { status: "resolved" | "dismissed" | ""; penalty: StewardPenaltyInput; publicDecision: string }; setStatus: (status: "resolved" | "dismissed") => void; setPenalty: (value: Partial<StewardPenaltyInput>) => void; setPublicDecision: (value: string) => void; chooseCategory: (category: Category) => void; onReview: () => void; onSubmit: () => void; underReview: boolean; pending: boolean }) { return <div className="mt-4 space-y-3 rounded-lg border border-white/[0.08] bg-black/10 p-4"><div className="flex flex-wrap gap-2">{underReview && <button type="button" disabled={pending} onClick={onReview} className="rounded-md border border-blue-400/30 px-3 py-1.5 text-xs font-bold text-blue-200 disabled:opacity-45">In review zetten</button>}<select value={decision.status} disabled={pending} onChange={(event) => setStatus(event.target.value as "resolved" | "dismissed")} className="rounded-md border border-white/10 bg-[#151820] px-3 py-1.5 text-sm text-white"><option value="">Kies uitkomst</option><option value="resolved">Protest honoreren</option><option value="dismissed">Protest afwijzen</option></select></div>{decision.status === "resolved" && <PenaltyFields value={decision.penalty} onChange={setPenalty} onCategory={chooseCategory} disabled={pending} />}<textarea value={decision.penalty.notes} disabled={pending} onChange={(event) => setPenalty({ notes: event.target.value })} rows={3} placeholder="Interne stewardnotitie (niet zichtbaar voor drivers)" className="w-full rounded-md border border-white/10 bg-[#151820] px-3 py-2 text-sm text-white"/><textarea value={decision.publicDecision} disabled={pending} onChange={(event) => setPublicDecision(event.target.value)} rows={3} placeholder="Publieke stewardbeslissing (zichtbaar na definitieve uitspraak)" className="w-full rounded-md border border-orange-400/30 bg-[#151820] px-3 py-2 text-sm text-white"/><button type="button" disabled={pending || !decision.status} onClick={onSubmit} className="rounded-md bg-gradient-racing px-4 py-2 text-sm font-black text-white disabled:opacity-45">Uitspraak bevestigen</button></div>; }
function PenaltyFields({ value, onChange, onCategory, disabled = false }: { value: StewardPenaltyInput; onChange: (value: Partial<StewardPenaltyInput>) => void; onCategory: (category: Category) => void; disabled?: boolean }) { return <div className="space-y-3"><div className="grid grid-cols-2 gap-2 md:grid-cols-4">{(["A", "B", "C", "D"] as Category[]).map((category) => <button type="button" disabled={disabled} key={category} onClick={() => onCategory(category)} className={`rounded-md border p-2 text-left text-xs disabled:opacity-45 ${value.penaltyCategory === category ? CATEGORY_META[category].activeColor : CATEGORY_META[category].color}`}><b>{CATEGORY_META[category].label}</b><span className="block opacity-75">{CATEGORY_META[category].desc}</span></button>)}</div><div className="grid gap-2 md:grid-cols-3"><select value={value.penaltyType} disabled={disabled} onChange={(event) => onChange({ penaltyType: event.target.value })} className="rounded-md border border-white/10 bg-[#151820] px-3 py-2 text-sm text-white"><option value="">Geen straf</option><option value="warning">Waarschuwing</option><option value="time_penalty">Tijdstraf</option><option value="grid_penalty">Gridstraf</option><option value="race_ban">Raceban</option><option value="pit_lane_start">Pitlane start</option><option value="points_deduction">Puntenaftrek</option><option value="disqualification">Diskwalificatie</option></select><input type="number" min={0} max={20} disabled={disabled} value={value.penaltySp} onChange={(event) => onChange({ penaltySp: Number(event.target.value) || 0 })} placeholder="SP" className="rounded-md border border-white/10 bg-[#151820] px-3 py-2 text-sm text-white"/>{value.penaltyType === "time_penalty" && <select disabled={disabled} value={value.timePenaltySeconds} onChange={(event) => onChange({ timePenaltySeconds: Number(event.target.value) || 0 })} className="rounded-md border border-white/10 bg-[#151820] px-3 py-2 text-sm text-white"><option value={5}>+5 sec</option><option value={10}>+10 sec</option><option value={20}>+20 sec</option></select>}{value.penaltyType === "grid_penalty" && <input type="number" min={1} max={20} disabled={disabled} value={value.gridPenaltyPlaces} onChange={(event) => onChange({ gridPenaltyPlaces: Number(event.target.value) || 0 })} placeholder="Gridplaatsen" className="rounded-md border border-white/10 bg-[#151820] px-3 py-2 text-sm text-white"/>}{value.penaltyType === "points_deduction" && <input type="number" min={1} disabled={disabled} value={value.pointsDeduction} onChange={(event) => onChange({ pointsDeduction: Number(event.target.value) || 0 })} placeholder="Puntenaftrek" className="rounded-md border border-white/10 bg-[#151820] px-3 py-2 text-sm text-white"/>}</div>{(value.penaltyType === "race_ban" || value.raceBanNext) && <label className="flex items-center gap-2 text-sm text-gray-300"><input type="checkbox" disabled={disabled} checked={value.raceBanNext} onChange={(event) => onChange({ raceBanNext: event.target.checked })}/>Driver mist volgende race</label>}</div>; }
function DirectAction({ races, drivers, value, onChange, onSubmit, pending }: { races: Race[]; drivers: Driver[]; value: { raceId: string; driverId: string; penalty: StewardPenaltyInput }; onChange: (value: { raceId: string; driverId: string; penalty: StewardPenaltyInput }) => void; onSubmit: () => void; pending: boolean }) { return <div className="rounded-xl border border-orange-400/20 bg-orange-500/[0.05] p-4"><h3 className="font-heading font-black">Directe stewardactie</h3><div className="mt-3 grid gap-3 md:grid-cols-2"><select disabled={pending} value={value.raceId} onChange={(event) => onChange({ ...value, raceId: event.target.value })} className="rounded-md border border-white/10 bg-[#151820] px-3 py-2 text-sm text-white"><option value="">Selecteer race</option>{races.map((race) => <option key={race.id} value={race.id}>{race.name} · {race.track}</option>)}</select><select disabled={pending} value={value.driverId} onChange={(event) => onChange({ ...value, driverId: event.target.value })} className="rounded-md border border-white/10 bg-[#151820] px-3 py-2 text-sm text-white"><option value="">Selecteer driver</option>{drivers.map((driver) => <option key={driver.user_id} value={driver.user_id}>{driver.iracing_name || driver.display_name}</option>)}</select></div><div className="mt-3"><PenaltyFields value={value.penalty} disabled={pending} onChange={(update) => onChange({ ...value, penalty: { ...value.penalty, ...update } })} onCategory={(category) => onChange({ ...value, penalty: { ...value.penalty, penaltyCategory: category, ...categoryPreset(category) } })}/><textarea disabled={pending} value={value.penalty.notes} onChange={(event) => onChange({ ...value, penalty: { ...value.penalty, notes: event.target.value } })} placeholder="Motivatie" rows={3} className="mt-3 w-full rounded-md border border-white/10 bg-[#151820] px-3 py-2 text-sm text-white"/></div><button type="button" disabled={pending || !value.raceId || !value.driverId || !value.penalty.penaltyType || !value.penalty.notes.trim()} onClick={onSubmit} className="mt-3 rounded-md bg-gradient-racing px-4 py-2 text-sm font-black text-white disabled:opacity-45">Actie toepassen</button></div>; }
function DnfRaceGroups({ groups, races, penalties, dnfPoints, setDnfPoints, pending, ask, emptyText }: { groups: Map<string, DnfResult[]>; races: Race[]; penalties: DnfPenalty[]; dnfPoints: Record<string, number>; setDnfPoints: React.Dispatch<React.SetStateAction<Record<string, number>>>; pending: boolean; ask: (action: StewardingAction, label: string, detail: string) => void; emptyText: string }) {
  if (groups.size === 0) return <Empty icon={AlertTriangle} text={emptyText} />;
  return <div className="space-y-3">{[...groups.entries()].map(([raceId, results]) => { const race = races.find((item) => item.id === raceId); return <article key={raceId} className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-4"><h3 className="font-heading font-bold">{race?.name || "Onbekende race"}</h3><p className="mt-1 text-xs text-gray-400">{race?.track} {race ? `· ${formatDate(race.race_date)}` : ""}</p><div className="mt-4 divide-y divide-white/[0.06]">{results.map((result) => { const reviewed = penalties.find((penalty) => !penalty.revoked && penalty.race_id === result.race_id && penalty.user_id === result.user_id); const deduction = dnfPoints[result.id] ?? 5; return <div key={result.id} className="flex flex-wrap items-center gap-3 py-3"><AlertTriangle className={`h-4 w-4 ${reviewed ? "text-gray-500" : "text-red-300"}`} /><div className="min-w-[10rem] flex-1"><p className="text-sm font-bold">{nameOf(result.profiles)}</p><p className="text-xs text-gray-500">{result.points} punten · {result.laps ?? 0} ronden</p></div>{reviewed ? <><span className="rounded-full border border-white/10 px-2 py-1 text-xs text-gray-300">{reviewed.source === "abandon" ? `Abandon · −${reviewed.points_deduction}` : "Normale DNF"}</span><button type="button" disabled={pending} onClick={() => ask({ id: "dnf-revoke", impact: "destructive", allowedRoles: [...roles], context: { resultId: result.id, penaltyId: reviewed.id, raceId: result.race_id, userId: result.user_id, source: reviewed.source } }, "DNF-beoordeling ongedaan maken?", "Punten worden hersteld voor een abandon; de penalty wordt verwijderd of ingetrokken.")} className="rounded-md border border-red-400/30 px-3 py-1.5 text-xs font-bold text-red-200 disabled:opacity-45">Ongedaan</button></> : <><button type="button" disabled={pending} onClick={() => ask({ id: "dnf-review", impact: "write", allowedRoles: [...roles], context: { resultId: result.id, raceId: result.race_id, userId: result.user_id, outcome: "normal_dnf" } }, "Markeren als normale DNF?", "Er wordt een normale DNF-registratie zonder straf opgeslagen.")} className="rounded-md border border-emerald-400/30 px-3 py-1.5 text-xs font-bold text-emerald-100 disabled:opacity-45">Normale DNF</button><label className="flex items-center gap-1 text-xs text-gray-400">−<input type="number" min={1} max={50} value={deduction} onChange={(event) => setDnfPoints((current) => ({ ...current, [result.id]: Number(event.target.value) || 5 }))} className="w-14 rounded border border-white/10 bg-[#151820] px-2 py-1 text-center text-white"/> pt</label><button type="button" disabled={pending} onClick={() => ask({ id: "dnf-review", impact: "write", allowedRoles: [...roles], context: { resultId: result.id, raceId: result.race_id, userId: result.user_id, outcome: "abandon", pointsDeduction: deduction } }, "Abandon-straf toepassen?", `${deduction} punten worden afgetrokken, 3SR wordt herberekend en een Cat. B penalty wordt opgeslagen.`)} className="rounded-md border border-orange-400/30 px-3 py-1.5 text-xs font-bold text-orange-100 disabled:opacity-45">Abandon</button></>}</div>; })}</div></article>; })}</div>;
}

function DriverSpOverview({ overview, expandedId, onToggle }: { overview: ReturnType<typeof calculateActiveSpOverview>; expandedId: string | null; onToggle: (id: string) => void }) {
  if (!overview.length) return <Empty icon={Users} text="Geen actieve straffen. Alle drivers hebben 0 strafpunten." />;
  return <div className="space-y-3">{overview.map((entry) => {
    const id = `driver_${entry.userId}_${entry.leagueId}`;
    const expanded = expandedId === id;
    const name = entry.profile?.iracing_name || entry.profile?.display_name || "Onbekend";
    const threshold = SP_THRESHOLDS.slice().reverse().find((item) => entry.totalSp >= item.sp);
    const spColor = entry.totalSp >= 15 ? "border-red-400/30 bg-red-400/10 text-red-200" : entry.totalSp >= 10 ? "border-orange-400/30 bg-orange-400/10 text-orange-100" : entry.totalSp >= 6 ? "border-yellow-400/30 bg-yellow-400/10 text-yellow-100" : "border-white/10 bg-white/[0.04] text-gray-200";
    return <article key={id} className="overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.025]"><button type="button" onClick={() => onToggle(id)} className="flex w-full flex-wrap items-center justify-between gap-4 p-4 text-left hover:bg-white/[0.025]"><div className="flex min-w-0 items-center gap-3"><span className={`rounded-md border px-2.5 py-1 text-sm font-black tabular-nums ${spColor}`}>{entry.totalSp} SP</span><span className="min-w-0"><b className="block truncate font-heading">{name}</b><small className="text-gray-400">{entry.leagueName || "Losse races"}</small></span>{threshold && <span className={`hidden rounded border px-2 py-0.5 text-xs font-bold sm:inline ${spColor}`}>{threshold.label}</span>}</div><span className="flex items-center gap-4 text-right text-xs text-gray-400"><span><b className="block text-sm text-gray-100">{entry.racesUntilExpiry} race{entry.racesUntilExpiry === 1 ? "" : "s"}</b>Vervalt na</span><span className="hidden sm:inline"><b className="block text-sm text-gray-100">{entry.activePenalties.length}x</b>Straffen</span>{expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</span></button>{expanded && <div className="space-y-2 border-t border-white/[0.08] px-4 pb-4 pt-3"><p className="text-xs font-black uppercase tracking-wider text-gray-400">Actieve straffen</p>{entry.activePenalties.map((penalty) => <div key={penalty.id} className="flex items-start justify-between gap-3 border-b border-white/[0.06] py-2 last:border-0"><div><p className="text-sm font-semibold">{penalty.races?.name || "Onbekende race"}</p><p className="text-xs text-gray-400">{penaltyLabels[penalty.penalty_type || ""] || penalty.penalty_type}{penalty.penalty_category ? ` · Cat. ${penalty.penalty_category}` : ""} · {formatDate(penalty.created_at)}</p>{penalty.reason && <p className="mt-0.5 text-xs italic text-gray-400">“{penalty.reason}”</p>}</div><b className={penalty.penalty_sp && penalty.penalty_sp >= 5 ? "text-sm text-orange-200" : "text-sm text-gray-200"}>+{penalty.penalty_sp || 0} SP</b></div>)}</div>}</article>;
  })}</div>;
}

function Empty({ icon: Icon, text }: { icon: typeof ClipboardCheck; text: string }) { return <div className="rounded-xl border border-dashed border-white/[0.12] bg-white/[0.02] p-10 text-center"><Icon className="mx-auto h-6 w-6 text-gray-600"/><p className="mt-3 text-sm text-gray-500">{text}</p></div>; }

export default StewardingWorkspace;
