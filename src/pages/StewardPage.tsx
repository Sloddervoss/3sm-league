import { useState } from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { motion } from "framer-motion";
import { Shield, AlertTriangle, Clock, CheckCircle, XCircle, Plus, FileText } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Navigate, Link } from "react-router-dom";

const statusStyles: Record<string, { color: string; label: string; icon: React.ElementType }> = {
  pending: { color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30", label: "In behandeling", icon: Clock },
  under_review: { color: "bg-blue-500/20 text-blue-400 border-blue-500/30", label: "Onder review", icon: FileText },
  resolved: { color: "bg-green-500/20 text-green-400 border-green-500/30", label: "Afgehandeld", icon: CheckCircle },
  dismissed: { color: "bg-muted text-muted-foreground border-border", label: "Afgewezen", icon: XCircle },
};

const StewardPage = () => {
  const { user, isAdmin, loading } = useAuth();
  const queryClient = useQueryClient();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    race_id: "",
    accused_user_id: "",
    lap_number: "",
    description: "",
    video_link: "",
  });

  const { data: races } = useQuery({
    queryKey: ["races-for-protest"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("races")
        .select("id, name, track, race_date")
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
    queryKey: ["my-protests", user?.id, isAdmin],
    enabled: !!user,
    queryFn: async () => {
      let query = supabase
        .from("protests")
        .select("*, races(name, track), reporter:profiles!protests_reporter_user_id_fkey(display_name, iracing_name), accused:profiles!protests_accused_user_id_fkey(display_name, iracing_name)");

      if (!isAdmin) {
        query = query.or(`reporter_user_id.eq.${user!.id},accused_user_id.eq.${user!.id}`);
      }

      const { data, error } = await query.order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const submitProtest = useMutation({
    mutationFn: async () => {
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
      toast.success("Protest ingediend!");
      queryClient.invalidateQueries({ queryKey: ["my-protests"] });
      setShowForm(false);
      setForm({ race_id: "", accused_user_id: "", lap_number: "", description: "", video_link: "" });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateProtestStatus = useMutation({
    mutationFn: async ({ id, status, steward_notes }: { id: string; status: string; steward_notes?: string }) => {
      const { error } = await supabase.from("protests").update({ status, steward_notes }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Status bijgewerkt!");
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
        {/* Header */}
        <section className="py-12 bg-gradient-to-b from-card/50 to-transparent border-b border-border">
          <div className="container mx-auto px-4">
            <div className="flex items-center gap-2 mb-2">
              <Shield className="w-5 h-5 text-accent" />
              <span className="text-sm font-medium text-accent uppercase tracking-[0.15em]">3SM</span>
            </div>
            <div className="flex items-start justify-between">
              <div>
                <h1 className="font-heading text-4xl md:text-5xl font-black">
                  {isAdmin ? "STEWARD PANEL" : "PROTEST INDIENEN"}
                </h1>
                <p className="text-muted-foreground mt-2">
                  {isAdmin ? "Beheer en beoordeel ingediende protesten" : "Dien een protest in over een race-incident"}
                </p>
              </div>
              {!isAdmin && (
                <button
                  onClick={() => setShowForm(!showForm)}
                  className="flex items-center gap-2 px-4 py-2 rounded-md bg-gradient-racing text-white font-heading font-bold text-sm uppercase tracking-wider hover:opacity-90 transition-opacity"
                >
                  <Plus className="w-4 h-4" />
                  Nieuw Protest
                </button>
              )}
            </div>
          </div>
        </section>

        <section className="py-12">
          <div className="container mx-auto px-4">
            {/* Protest form */}
            {(showForm || (isAdmin && showForm)) && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-card border border-border rounded-lg p-6 mb-8 racing-stripe-left"
              >
                <h2 className="font-heading text-xl font-bold mb-6">PROTEST FORMULIER</h2>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Race *</label>
                    <select
                      value={form.race_id}
                      onChange={(e) => setForm({ ...form, race_id: e.target.value })}
                      className="w-full px-4 py-2.5 rounded-md bg-secondary border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                      required
                    >
                      <option value="">Selecteer race...</option>
                      {races?.map((race: any) => (
                        <option key={race.id} value={race.id}>
                          {race.name} — {race.track} ({new Date(race.race_date).toLocaleDateString("nl-NL")})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Driver onder protest *</label>
                    <select
                      value={form.accused_user_id}
                      onChange={(e) => setForm({ ...form, accused_user_id: e.target.value })}
                      className="w-full px-4 py-2.5 rounded-md bg-secondary border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                      required
                    >
                      <option value="">Selecteer driver...</option>
                      {drivers?.filter((d: any) => d.user_id !== user.id).map((driver: any) => (
                        <option key={driver.user_id} value={driver.user_id}>
                          {driver.display_name || driver.iracing_name || driver.user_id}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Rondnummer</label>
                    <input
                      type="number"
                      min={1}
                      value={form.lap_number}
                      onChange={(e) => setForm({ ...form, lap_number: e.target.value })}
                      placeholder="bijv. 12"
                      className="w-full px-4 py-2.5 rounded-md bg-secondary border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Video link</label>
                    <input
                      type="url"
                      value={form.video_link}
                      onChange={(e) => setForm({ ...form, video_link: e.target.value })}
                      placeholder="https://youtube.com/..."
                      className="w-full px-4 py-2.5 rounded-md bg-secondary border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Beschrijving van het incident *</label>
                    <textarea
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                      placeholder="Beschrijf zo duidelijk mogelijk wat er is gebeurd..."
                      rows={4}
                      className="w-full px-4 py-2.5 rounded-md bg-secondary border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                      required
                    />
                  </div>
                </div>
                <div className="flex gap-3 mt-6">
                  <button
                    onClick={() => submitProtest.mutate()}
                    disabled={!form.race_id || !form.accused_user_id || !form.description || submitProtest.isPending}
                    className="px-6 py-2.5 rounded-md bg-gradient-racing text-white font-heading font-bold text-sm uppercase tracking-wider hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    {submitProtest.isPending ? "Indienen..." : "Protest Indienen"}
                  </button>
                  <button
                    onClick={() => setShowForm(false)}
                    className="px-6 py-2.5 rounded-md border border-border text-muted-foreground font-heading font-bold text-sm uppercase tracking-wider hover:text-foreground transition-colors"
                  >
                    Annuleren
                  </button>
                </div>
              </motion.div>
            )}

            {/* Add protest button for admin */}
            {isAdmin && !showForm && (
              <div className="mb-6">
                <button
                  onClick={() => setShowForm(true)}
                  className="flex items-center gap-2 px-4 py-2 rounded-md border border-border text-muted-foreground font-heading font-bold text-sm uppercase tracking-wider hover:text-foreground hover:border-primary/50 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Nieuw Protest Toevoegen
                </button>
              </div>
            )}

            {/* Protests list */}
            <div className="space-y-4">
              {isLoading ? (
                [1, 2, 3].map((i) => <div key={i} className="h-28 bg-card rounded-lg animate-pulse" />)
              ) : !protests?.length ? (
                <div className="text-center py-24 text-muted-foreground">
                  <Shield className="w-12 h-12 mx-auto mb-4 opacity-40" />
                  <p className="text-lg font-heading font-bold">GEEN PROTESTEN</p>
                  <p className="text-sm mt-1">Er zijn nog geen protesten ingediend.</p>
                  {!isAdmin && (
                    <button
                      onClick={() => setShowForm(true)}
                      className="mt-4 flex items-center gap-2 px-4 py-2 rounded-md bg-gradient-racing text-white font-heading font-bold text-sm uppercase tracking-wider hover:opacity-90 transition-opacity mx-auto"
                    >
                      <Plus className="w-4 h-4" />
                      Protest Indienen
                    </button>
                  )}
                </div>
              ) : (
                protests.map((protest: any, i: number) => {
                  const StatusIcon = statusStyles[protest.status]?.icon || Clock;
                  return (
                    <motion.div
                      key={protest.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04 }}
                      className="bg-card border border-border rounded-lg p-5 racing-stripe-left"
                    >
                      <div className="flex items-start justify-between gap-4 mb-3">
                        <div>
                          <div className="font-heading font-bold text-base">
                            {protest.reporter?.display_name || protest.reporter?.iracing_name || "?"} →{" "}
                            <span className="text-primary">{protest.accused?.display_name || protest.accused?.iracing_name || "?"}</span>
                          </div>
                          <div className="text-sm text-muted-foreground mt-0.5">
                            {protest.races?.name}
                            {protest.lap_number && ` • Ronde ${protest.lap_number}`}
                            {" • "}{new Date(protest.created_at).toLocaleDateString("nl-NL")}
                          </div>
                        </div>
                        <span className={`shrink-0 flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider border ${statusStyles[protest.status]?.color || statusStyles.pending.color}`}>
                          <StatusIcon className="w-3 h-3" />
                          {statusStyles[protest.status]?.label || protest.status}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{protest.description}</p>
                      {protest.video_link && (
                        <a href={protest.video_link} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">
                          Video bekijken →
                        </a>
                      )}
                      {protest.steward_notes && (
                        <div className="mt-3 p-3 bg-secondary/50 rounded-md border border-border">
                          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Steward Notitie</div>
                          <p className="text-sm">{protest.steward_notes}</p>
                        </div>
                      )}

                      {/* Admin actions */}
                      {isAdmin && protest.status === "pending" && (
                        <div className="flex gap-2 mt-4 pt-4 border-t border-border">
                          <button
                            onClick={() => updateProtestStatus.mutate({ id: protest.id, status: "under_review" })}
                            className="px-3 py-1.5 rounded-md bg-blue-500/20 text-blue-400 text-xs font-bold border border-blue-500/30 hover:bg-blue-500/30 transition-colors"
                          >
                            In Review Zetten
                          </button>
                          <button
                            onClick={() => updateProtestStatus.mutate({ id: protest.id, status: "resolved" })}
                            className="px-3 py-1.5 rounded-md bg-green-500/20 text-green-400 text-xs font-bold border border-green-500/30 hover:bg-green-500/30 transition-colors"
                          >
                            Afhandelen
                          </button>
                          <button
                            onClick={() => updateProtestStatus.mutate({ id: protest.id, status: "dismissed" })}
                            className="px-3 py-1.5 rounded-md bg-muted text-muted-foreground text-xs font-bold border border-border hover:text-foreground transition-colors"
                          >
                            Afwijzen
                          </button>
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
