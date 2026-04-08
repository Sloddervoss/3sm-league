import { useState } from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { motion } from "framer-motion";
import { Shield, AlertTriangle, Clock, CheckCircle, XCircle, Plus, FileText, ChevronDown, ChevronUp } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Navigate } from "react-router-dom";

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
};

const PROTEST_DEADLINE_HOURS = 48;

const StewardPage = () => {
  const { user, isAdmin, isSteward, loading } = useAuth();
  const queryClient = useQueryClient();
  const canModerate = isAdmin || isSteward;

  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [form, setForm] = useState({
    race_id: "",
    accused_user_id: "",
    lap_number: "",
    description: "",
    video_link: "",
  });

  // Per-protest steward decision state
  const [decisions, setDecisions] = useState<Record<string, {
    status: string;
    steward_notes: string;
    penalty_type: string;
    penalty_points: string;
  }>>({});

  const getDecision = (id: string) => decisions[id] || { status: "", steward_notes: "", penalty_type: "", penalty_points: "" };
  const setDecision = (id: string, field: string, val: string) =>
    setDecisions(prev => ({ ...prev, [id]: { ...getDecision(id), [field]: val } }));

  const { data: races } = useQuery({
    queryKey: ["races-for-protest"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("races")
        .select("id, name, track, race_date")
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
        .select("*, races(name, track, race_date), reporter:profiles!protests_reporter_user_id_fkey(display_name, iracing_name), accused:profiles!protests_accused_user_id_fkey(display_name, iracing_name)");

      if (!canModerate) {
        query = query.or(`reporter_user_id.eq.${user!.id},accused_user_id.eq.${user!.id}`);
      }

      const { data, error } = await query.order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const submitProtest = useMutation({
    mutationFn: async () => {
      // Check 48u limiet
      const race = races?.find((r: any) => r.id === form.race_id);
      if (race) {
        const raceDate = new Date(race.race_date);
        const hoursSince = (Date.now() - raceDate.getTime()) / (1000 * 60 * 60);
        if (hoursSince > PROTEST_DEADLINE_HOURS) {
          throw new Error(`Protest kan alleen binnen ${PROTEST_DEADLINE_HOURS} uur na de race worden ingediend.`);
        }
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
    mutationFn: async ({ protest, decision }: { protest: any; decision: any }) => {
      const penaltyType = decision.penalty_type || null;
      const penaltyPoints = parseInt(decision.penalty_points) || 0;

      // Update protest
      const { error: protestError } = await (supabase as any).from("protests").update({
        status: decision.status,
        steward_notes: decision.steward_notes || null,
        penalty_type: penaltyType,
        penalty_points: penaltyPoints,
        decided_at: new Date().toISOString(),
      }).eq("id", protest.id);
      if (protestError) throw protestError;

      // Pas straf toe op race_results
      if (decision.status === "resolved" && penaltyType && penaltyType !== "warning") {
        if (penaltyType === "disqualification") {
          const { error } = await supabase.from("race_results")
            .update({ dnf: true, points: 0 })
            .eq("race_id", protest.race_id)
            .eq("user_id", protest.accused_user_id);
          if (error) throw error;
        } else if (penaltyType === "points_deduction" && penaltyPoints > 0) {
          const { data: result, error: selectError } = await supabase.from("race_results")
            .select("points")
            .eq("race_id", protest.race_id)
            .eq("user_id", protest.accused_user_id)
            .maybeSingle();
          if (selectError) throw selectError;
          if (!result) throw new Error("Geen race resultaat gevonden voor deze driver in deze race. Puntenaftrek niet toegepast.");
          const newPoints = Math.max(0, (result.points || 0) - penaltyPoints);
          const { error } = await supabase.from("race_results")
            .update({ points: newPoints })
            .eq("race_id", protest.race_id)
            .eq("user_id", protest.accused_user_id);
          if (error) throw error;
        }

        // Sla penalty op
        await (supabase as any).from("penalties").insert({
          protest_id: protest.id,
          race_id: protest.race_id,
          user_id: protest.accused_user_id,
          penalty_type: penaltyType,
          points_deduction: penaltyPoints,
          reason: decision.steward_notes || "",
          applied_by: user!.id,
        });

        // Herbereken 3SR standings voor deze race
        await supabase.rpc("recalculate_3sr_for_race" as any, { p_race_id: protest.race_id });
      }
    },
    onSuccess: (_, { protest, decision }) => {
      toast.success("Uitspraak gedaan en straf toegepast!");
      queryClient.invalidateQueries({ queryKey: ["my-protests"] });
      queryClient.invalidateQueries({ queryKey: ["race-results"] });
      setDecisions(prev => { const n = { ...prev }; delete n[protest.id]; return n; });
      setExpandedId(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const setUnderReview = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("protests").update({ status: "under_review" }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Protest onder review gezet.");
      queryClient.invalidateQueries({ queryKey: ["my-protests"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (loading) return null;
  if (!user) return <Navigate to="/auth" />;

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
            <div className="flex items-start justify-between">
              <div>
                <h1 className="font-heading text-4xl md:text-5xl font-black">
                  {canModerate ? "STEWARD PANEL" : "PROTEST INDIENEN"}
                </h1>
                <p className="text-muted-foreground mt-2">
                  Dien een protest in over een race-incident (binnen 48 uur na de race)
                </p>
              </div>
              <button
                onClick={() => setShowForm(!showForm)}
                className="flex items-center gap-2 px-4 py-2 rounded-md bg-gradient-racing text-white font-heading font-bold text-sm uppercase tracking-wider hover:opacity-90 transition-opacity"
              >
                <Plus className="w-4 h-4" />
                Nieuw Protest
              </button>
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
                      {races?.map((race: any) => {
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
                      {drivers?.filter((d: any) => d.user_id !== user.id).map((driver: any) => (
                        <option key={driver.user_id} value={driver.user_id}>
                          {driver.iracing_name || driver.display_name}
                        </option>
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
                protests.map((protest: any, i: number) => {
                  const StatusIcon = statusStyles[protest.status]?.icon || Clock;
                  const isExpanded = expandedId === protest.id;
                  const dec = getDecision(protest.id);
                  const accusedName = protest.accused?.iracing_name || protest.accused?.display_name || "?";
                  const reporterName = protest.reporter?.iracing_name || protest.reporter?.display_name || "?";

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
                            <button onClick={() => setExpandedId(isExpanded ? null : protest.id)} className="p-1.5 text-muted-foreground hover:text-foreground transition-colors">
                              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            </button>
                          </div>
                        </div>
                        <p className="text-sm text-muted-foreground line-clamp-2">{protest.description}</p>
                        {protest.penalty_type && protest.status === "resolved" && (
                          <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-orange-500/10 border border-orange-500/20 text-orange-400 text-xs font-bold">
                            <AlertTriangle className="w-3 h-3" />
                            {penaltyLabels[protest.penalty_type] || protest.penalty_type}
                            {protest.penalty_type === "points_deduction" && protest.penalty_points > 0 && ` (-${protest.penalty_points} pts)`}
                          </div>
                        )}
                      </div>

                      {/* Expanded */}
                      {isExpanded && (
                        <div className="px-5 pb-5 border-t border-border/50 pt-4 space-y-4">
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

                          {/* Steward acties */}
                          {canModerate && protest.status !== "resolved" && protest.status !== "dismissed" && (protest.reporter_user_id === user?.id || protest.accused_user_id === user?.id) && (
                            <div className="pt-2 border-t border-border">
                              <p className="text-xs text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 rounded-md px-3 py-2">
                                Je bent betrokken bij dit protest en kan het niet zelf behandelen.
                              </p>
                            </div>
                          )}
                          {canModerate && protest.status !== "resolved" && protest.status !== "dismissed" && protest.reporter_user_id !== user?.id && protest.accused_user_id !== user?.id && (
                            <div className="space-y-3 pt-2 border-t border-border">
                              <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Uitspraak doen</div>

                              {protest.status === "pending" && (
                                <button onClick={() => setUnderReview.mutate(protest.id)} disabled={setUnderReview.isPending} className="px-3 py-1.5 rounded-md bg-blue-500/20 text-blue-400 text-xs font-bold border border-blue-500/30 hover:bg-blue-500/30 transition-colors">
                                  In Review Zetten
                                </button>
                              )}

                              <div className="grid gap-3 md:grid-cols-2">
                                <div>
                                  <label className="text-xs text-muted-foreground mb-1 block">Uitkomst</label>
                                  <select value={dec.status} onChange={e => setDecision(protest.id, "status", e.target.value)} className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:border-primary">
                                    <option value="">Kies uitkomst...</option>
                                    <option value="resolved">Protest gehonoreerd</option>
                                    <option value="dismissed">Protest afgewezen</option>
                                  </select>
                                </div>

                                {dec.status === "resolved" && (
                                  <div>
                                    <label className="text-xs text-muted-foreground mb-1 block">Straf</label>
                                    <select value={dec.penalty_type} onChange={e => setDecision(protest.id, "penalty_type", e.target.value)} className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:border-primary">
                                      <option value="">Geen straf</option>
                                      <option value="warning">Waarschuwing</option>
                                      <option value="points_deduction">Puntenaftrek</option>
                                      <option value="disqualification">Diskwalificatie</option>
                                    </select>
                                  </div>
                                )}

                                {dec.status === "resolved" && dec.penalty_type === "points_deduction" && (
                                  <div>
                                    <label className="text-xs text-muted-foreground mb-1 block">Aantal punten aftrek</label>
                                    <input type="number" min={1} value={dec.penalty_points} onChange={e => setDecision(protest.id, "penalty_points", e.target.value)} placeholder="bijv. 5" className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:border-primary" />
                                  </div>
                                )}
                              </div>

                              <div>
                                <label className="text-xs text-muted-foreground mb-1 block">Motivatie / Steward notitie</label>
                                <textarea value={dec.steward_notes} onChange={e => setDecision(protest.id, "steward_notes", e.target.value)} rows={3} placeholder="Uitleg van de beslissing..." className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:border-primary resize-none" />
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
