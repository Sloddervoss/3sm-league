import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { User, Save, Gamepad2, TrendingUp, Shield, Info, Trophy, Flag, Car, UserPlus, X, Clock, ImagePlus, Plus } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { toast } from "sonner";
import { Navigate } from "react-router-dom";

const ProfilePage = () => {
  const { user, session, loading } = useAuth();
  const queryClient = useQueryClient();

  const { data: profile } = useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: myResults } = useQuery({
    queryKey: ["my-results", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("race_results")
        .select("*, races(name, track, race_date)")
        .eq("user_id", user!.id);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: teams } = useQuery({
    queryKey: ["teams-list"],
    queryFn: async () => {
      const { data, error } = await supabase.from("teams").select("id, name, color, logo_url");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: myCreationRequest } = useQuery({
    queryKey: ["my-creation-request", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("team_creation_requests")
        .select("*")
        .eq("user_id", user!.id)
        .eq("status", "pending");
      if (error) throw error;
      return (data || [])[0] || null;
    },
  });

  // Team states
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [showNewTeamForm, setShowNewTeamForm] = useState(false);
  const [newTeamReq, setNewTeamReq] = useState({ name: "", description: "", color: "#f97316" });
  const [newTeamLogo, setNewTeamLogo] = useState("");

  // Profile states
  const [displayName, setDisplayName] = useState("");
  const [iracingId, setIracingId] = useState("");
  const [iracingName, setIracingName] = useState("");
  const [irating, setIrating] = useState("");
  const [safetyRating, setSafetyRating] = useState("");

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.display_name || "");
      setIracingId((profile as any).iracing_id || "");
      setIracingName((profile as any).iracing_name || "");
      setIrating(String((profile as any).irating || ""));
      setSafetyRating((profile as any).safety_rating || "");
    }
  }, [profile]);

  const updateProfile = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("profiles")
        .upsert({
          user_id: user!.id,
          display_name: displayName,
          iracing_id: iracingId || null,
          iracing_name: iracingName || null,
          irating: irating ? parseInt(irating) : null,
          safety_rating: safetyRating || null,
        } as any, { onConflict: "user_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Profiel opgeslagen!");
      queryClient.invalidateQueries({ queryKey: ["profile", user?.id] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Instant join existing team (free choice, no approval)
  const joinTeam = useMutation({
    mutationFn: async (teamId: string) => {
      await supabase.from("profiles").update({ team_id: teamId } as any).eq("user_id", user!.id);
      await (supabase as any).from("team_memberships").insert({ user_id: user!.id, team_id: teamId, role: "driver" });
    },
    onSuccess: () => {
      toast.success("Team gejoint!");
      queryClient.invalidateQueries({ queryKey: ["profile", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["teams-list"] });
      setSelectedTeamId("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Leave current team
  const leaveTeam = useMutation({
    mutationFn: async () => {
      await (supabase as any).from("team_memberships").delete().eq("user_id", user!.id);
      const { error } = await supabase.from("profiles").update({ team_id: null } as any).eq("user_id", user!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Team verlaten.");
      queryClient.invalidateQueries({ queryKey: ["profile", user?.id] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Request creation of a brand-new team
  const submitCreationRequest = useMutation({
    mutationFn: async () => {
      if (!newTeamReq.name.trim()) throw new Error("Geef een teamnaam op");
      if (!session) throw new Error("Niet ingelogd");
      if (newTeamLogo && newTeamLogo.length > 100_000) throw new Error(`Logo te groot (${Math.round(newTeamLogo.length / 1024)}KB), gebruik een kleiner afbeelding`);
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/team_creation_requests`, {
        method: "POST",
        headers: {
          "apikey": import.meta.env.VITE_SUPABASE_ANON_KEY,
          "Authorization": `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
          "Prefer": "return=minimal",
        },
        body: JSON.stringify({
          user_id: user!.id,
          team_name: newTeamReq.name.trim(),
          team_description: newTeamReq.description.trim() || null,
          team_color: newTeamReq.color,
          logo_url: newTeamLogo || null,
          status: "pending",
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
    },
    onSuccess: () => {
      toast.success("Aanvraag ingediend! Een admin zal je verzoek beoordelen.");
      queryClient.invalidateQueries({ queryKey: ["my-creation-request"] });
      queryClient.invalidateQueries({ queryKey: ["team-creation-requests"] });
      setShowNewTeamForm(false);
      setNewTeamReq({ name: "", description: "", color: "#f97316" });
      setNewTeamLogo("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Cancel pending creation request
  const cancelCreationRequest = useMutation({
    mutationFn: async (reqId: string) => {
      await (supabase as any).from("team_creation_requests").delete().eq("id", reqId);
    },
    onSuccess: () => {
      toast.success("Aanvraag ingetrokken.");
      queryClient.invalidateQueries({ queryKey: ["my-creation-request"] });
      queryClient.invalidateQueries({ queryKey: ["team-creation-requests"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Stats from results
  const wins = (myResults || []).filter((r: any) => r.position === 1).length;
  const podiums = (myResults || []).filter((r: any) => r.position <= 3).length;
  const totalPoints = (myResults || []).reduce((sum: number, r: any) => sum + (r.points || 0), 0);
  const avgFinish = myResults?.length
    ? ((myResults as any[]).reduce((s: number, r: any) => s + r.position, 0) / myResults.length).toFixed(1)
    : "—";

  if (loading) return null;
  if (!user) return <Navigate to="/auth" />;

  const currentTeam = (teams || []).find((t: any) => t.id === (profile as any)?.team_id);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-16">
        <section className="py-12">
          <div className="container mx-auto px-4 max-w-3xl">
            <div className="flex items-center gap-2 mb-1">
              <User className="w-5 h-5 text-primary" />
              <span className="text-sm font-medium text-primary uppercase tracking-[0.15em]">Account</span>
            </div>
            <h1 className="font-heading text-4xl font-black mb-8">MIJN PROFIEL</h1>

            {/* Stats overview */}
            {myResults && myResults.length > 0 && (
              <div className="grid grid-cols-4 gap-3 mb-8">
                {[
                  { label: "Punten", value: totalPoints, icon: Trophy },
                  { label: "Wins",   value: wins,        icon: Flag },
                  { label: "Podiums",value: podiums,     icon: Trophy },
                  { label: "Gem. finish", value: avgFinish, icon: User },
                ].map((s) => (
                  <div key={s.label} className="bg-card border border-border rounded-lg p-3 text-center">
                    <div className="font-heading font-black text-2xl">{s.value}</div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">{s.label}</div>
                  </div>
                ))}
              </div>
            )}

            <div className="grid gap-6 md:grid-cols-2">
              {/* General info */}
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-card border border-border rounded-lg p-6 racing-stripe-left">
                <h2 className="font-heading font-bold text-lg mb-4 flex items-center gap-2">
                  <User className="w-4 h-4 text-primary" /> Algemeen
                </h2>
                <div>
                  <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Display Naam</label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                  <p className="text-xs text-muted-foreground mt-1">Naam die zichtbaar is op de website</p>
                </div>
              </motion.div>

              {/* iRacing koppeling */}
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="bg-card border border-border rounded-lg p-6 racing-stripe-left">
                <h2 className="font-heading font-bold text-lg mb-1 flex items-center gap-2">
                  <Gamepad2 className="w-4 h-4 text-accent" /> iRacing Koppeling
                </h2>
                <div className="flex items-start gap-1.5 mb-4 p-2.5 rounded-md bg-blue-500/10 border border-blue-500/20">
                  <Info className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-blue-300 leading-relaxed">
                    Je <strong>iRacing Customer ID</strong> wordt gebruikt om jouw naam automatisch te koppelen bij het importeren van race resultaten. Vind je ID op <strong>members.iracing.com</strong> → Account → Member Profile.
                  </p>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Customer ID</label>
                    <input
                      type="text"
                      value={iracingId}
                      onChange={(e) => setIracingId(e.target.value)}
                      placeholder="bv. 412301"
                      className="w-full px-4 py-2.5 rounded-md bg-secondary border border-border text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground mb-1.5 block">iRacing Naam (exact)</label>
                    <input
                      type="text"
                      value={iracingName}
                      onChange={(e) => setIracingName(e.target.value)}
                      placeholder="bv. V. de Vos"
                      className="w-full px-4 py-2.5 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                    <p className="text-xs text-muted-foreground mt-1">Naam zoals hij verschijnt in iRacing resultaten (voor CSV import matching)</p>
                  </div>
                </div>
              </motion.div>

              {/* iRating & Safety */}
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-card border border-border rounded-lg p-6 racing-stripe-left md:col-span-2">
                <h2 className="font-heading font-bold text-lg mb-4 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-blue-400" /> iRacing Rating
                </h2>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-muted-foreground mb-1.5 block flex items-center gap-1.5">
                      <TrendingUp className="w-3.5 h-3.5 text-blue-400" /> iRating
                    </label>
                    <input
                      type="number"
                      value={irating}
                      onChange={(e) => setIrating(e.target.value)}
                      placeholder="bv. 3450"
                      className="w-full px-4 py-2.5 rounded-md bg-secondary border border-border text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                    <p className="text-xs text-muted-foreground mt-1">Jouw huidige iRating van iRacing</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground mb-1.5 block flex items-center gap-1.5">
                      <Shield className="w-3.5 h-3.5 text-green-400" /> Safety Rating
                    </label>
                    <input
                      type="text"
                      value={safetyRating}
                      onChange={(e) => setSafetyRating(e.target.value)}
                      placeholder="bv. A 4.50"
                      className="w-full px-4 py-2.5 rounded-md bg-secondary border border-border text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                    <p className="text-xs text-muted-foreground mt-1">Format: letter + getal (A 4.50, B 3.20)</p>
                  </div>
                </div>
              </motion.div>
            </div>

            {/* ── TEAM SECTIE ── */}
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="bg-card border border-border rounded-lg p-6 racing-stripe-left mt-6">
              <h2 className="font-heading font-bold text-lg mb-4 flex items-center gap-2">
                <Car className="w-4 h-4 text-accent" /> Team
              </h2>

              {currentTeam ? (
                /* ── Already in a team ── */
                <div className="flex items-center justify-between p-3 rounded-md bg-secondary/50 border border-border">
                  <div className="flex items-center gap-3">
                    {currentTeam.logo_url ? (
                      <img src={currentTeam.logo_url} alt={currentTeam.name} className="w-8 h-8 object-contain rounded" />
                    ) : (
                      <div className="w-3 h-8 rounded-sm" style={{ backgroundColor: currentTeam.color }} />
                    )}
                    <div>
                      <div className="font-heading font-bold" style={{ color: currentTeam.color }}>{currentTeam.name}</div>
                      <div className="text-xs text-muted-foreground">Actief teamlid</div>
                    </div>
                  </div>
                  <button
                    onClick={() => leaveTeam.mutate()}
                    disabled={leaveTeam.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold border border-border text-muted-foreground hover:text-destructive hover:border-destructive/50 transition-colors"
                  >
                    <X className="w-3 h-3" /> Verlaten
                  </button>
                </div>
              ) : myCreationRequest ? (
                /* ── Pending new team request ── */
                <div className="flex items-center justify-between p-3 rounded-md bg-yellow-500/10 border border-yellow-500/20">
                  <div className="flex items-center gap-3">
                    {myCreationRequest.logo_url ? (
                      <img src={myCreationRequest.logo_url} alt="" className="w-8 h-8 object-contain rounded border border-border" />
                    ) : (
                      <div className="w-3 h-8 rounded-sm" style={{ backgroundColor: myCreationRequest.team_color }} />
                    )}
                    <div>
                      <div className="font-medium text-sm flex items-center gap-2">
                        <Clock className="w-3.5 h-3.5 text-yellow-400" />
                        Aanvraag ingediend: <strong>{myCreationRequest.team_name}</strong>
                      </div>
                      <div className="text-xs text-muted-foreground">Wacht op goedkeuring van een admin</div>
                    </div>
                  </div>
                  <button
                    onClick={() => cancelCreationRequest.mutate(myCreationRequest.id)}
                    disabled={cancelCreationRequest.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold border border-border text-muted-foreground hover:text-destructive hover:border-destructive/50 transition-colors"
                  >
                    <X className="w-3 h-3" /> Intrekken
                  </button>
                </div>
              ) : (
                /* ── No team yet ── */
                <div className="space-y-4">
                  {/* Join existing team */}
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-2">Bestaand team joinen</p>
                    <div className="flex gap-3">
                      <select
                        value={selectedTeamId}
                        onChange={(e) => setSelectedTeamId(e.target.value)}
                        className="flex-1 px-4 py-2.5 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                      >
                        <option value="">Kies een team...</option>
                        {(teams || []).map((t: any) => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => { if (selectedTeamId) joinTeam.mutate(selectedTeamId); }}
                        disabled={!selectedTeamId || joinTeam.isPending}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-md bg-primary/10 border border-primary/30 text-primary font-heading font-bold text-sm hover:bg-primary/20 disabled:opacity-50 transition-colors"
                      >
                        <UserPlus className="w-4 h-4" />
                        {joinTeam.isPending ? "..." : "Joinen"}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-px bg-border" />
                    <span className="text-xs text-muted-foreground uppercase tracking-wider">of</span>
                    <div className="flex-1 h-px bg-border" />
                  </div>

                  {/* Request new team */}
                  {!showNewTeamForm ? (
                    <button
                      onClick={() => setShowNewTeamForm(true)}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-md border border-dashed border-border text-sm text-muted-foreground hover:text-foreground hover:border-accent/50 transition-colors"
                    >
                      <Plus className="w-4 h-4" /> Nieuw team aanvragen
                    </button>
                  ) : (
                    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3 p-4 rounded-md bg-secondary/30 border border-border">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm font-bold uppercase tracking-wider">Nieuw team aanvragen</p>
                        <button onClick={() => { setShowNewTeamForm(false); setNewTeamLogo(""); }} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
                      </div>

                      <div>
                        <label className="text-xs font-medium text-muted-foreground mb-1 block">Team naam *</label>
                        <input
                          type="text"
                          value={newTeamReq.name}
                          onChange={(e) => setNewTeamReq({ ...newTeamReq, name: e.target.value })}
                          placeholder="bv. Lightning Racing"
                          className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                        />
                      </div>

                      <div>
                        <label className="text-xs font-medium text-muted-foreground mb-1 block">Beschrijving</label>
                        <input
                          type="text"
                          value={newTeamReq.description}
                          onChange={(e) => setNewTeamReq({ ...newTeamReq, description: e.target.value })}
                          placeholder="Korte omschrijving van het team"
                          className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs font-medium text-muted-foreground mb-1 block">Teamkleur</label>
                          <div className="flex gap-2">
                            <input type="color" value={newTeamReq.color} onChange={(e) => setNewTeamReq({ ...newTeamReq, color: e.target.value })} className="w-10 h-9 rounded-md border border-border cursor-pointer bg-secondary shrink-0" />
                            <input type="text" value={newTeamReq.color} onChange={(e) => setNewTeamReq({ ...newTeamReq, color: e.target.value })} className="flex-1 px-3 py-2 rounded-md bg-secondary border border-border text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary/50" />
                          </div>
                        </div>

                        <div>
                          <label className="text-xs font-medium text-muted-foreground mb-1 block">Team logo</label>
                          <div className="flex items-center gap-2">
                            <label className="flex items-center gap-1.5 px-3 py-2 rounded-md border border-dashed border-border hover:border-primary/50 bg-secondary/50 cursor-pointer transition-colors text-xs text-muted-foreground">
                              <ImagePlus className="w-3.5 h-3.5" />
                              {newTeamLogo ? "Gewijzigd" : "Upload..."}
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (!file) return;
                                  const img = new Image();
                                  const url = URL.createObjectURL(file);
                                  img.onload = () => {
                                    const canvas = document.createElement("canvas");
                                    const max = 128;
                                    const scale = Math.min(max / img.width, max / img.height, 1);
                                    canvas.width = Math.round(img.width * scale);
                                    canvas.height = Math.round(img.height * scale);
                                    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
                                    setNewTeamLogo(canvas.toDataURL("image/jpeg", 0.7));
                                    URL.revokeObjectURL(url);
                                  };
                                  img.src = url;
                                }}
                              />
                            </label>
                            {newTeamLogo && (
                              <div className="flex items-center gap-1">
                                <img src={newTeamLogo} alt="preview" className="w-8 h-8 object-contain rounded border border-border" />
                                <button onClick={() => setNewTeamLogo("")} className="text-muted-foreground hover:text-destructive"><X className="w-3 h-3" /></button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={() => submitCreationRequest.mutate()}
                        disabled={!newTeamReq.name.trim() || submitCreationRequest.isPending}
                        className="flex items-center gap-2 px-4 py-2 rounded-md bg-gradient-racing text-white font-heading font-bold text-sm uppercase tracking-wider hover:opacity-90 disabled:opacity-50 transition-opacity"
                      >
                        <Plus className="w-4 h-4" />
                        {submitCreationRequest.isPending ? "Indienen..." : "Aanvraag indienen"}
                      </button>
                    </motion.div>
                  )}
                </div>
              )}
            </motion.div>

            <div className="mt-6">
              <button
                onClick={() => updateProfile.mutate()}
                disabled={updateProfile.isPending}
                className="flex items-center gap-2 px-6 py-2.5 rounded-md bg-gradient-racing text-white font-heading font-bold text-sm uppercase tracking-wider hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {updateProfile.isPending ? "Opslaan..." : "Profiel Opslaan"}
              </button>
            </div>

            {/* Race history */}
            {myResults && myResults.length > 0 && (
              <div className="mt-10">
                <h2 className="font-heading text-xl font-black mb-4">RACE GESCHIEDENIS</h2>
                <div className="bg-card border border-border rounded-lg overflow-hidden">
                  <div className="grid grid-cols-[3rem_1fr_4rem_4rem] gap-2 px-4 py-2.5 bg-secondary/40 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    <span>Pos</span><span>Race</span><span className="text-center">Inc.</span><span className="text-center">Pts</span>
                  </div>
                  {[...(myResults as any[])].sort((a, b) => new Date(b.races?.race_date || 0).getTime() - new Date(a.races?.race_date || 0).getTime()).map((r: any) => (
                    <div key={r.id} className="grid grid-cols-[3rem_1fr_4rem_4rem] gap-2 px-4 py-2.5 items-center border-b border-border/40 hover:bg-secondary/20 transition-colors">
                      <span className={`font-heading font-black text-lg ${r.position === 1 ? "text-yellow-400" : r.position <= 3 ? "text-primary" : "text-muted-foreground"}`}>
                        {r.dnf ? "DNF" : r.position}
                      </span>
                      <div>
                        <div className="font-medium text-sm truncate">{r.races?.name || "Race"}</div>
                        <div className="text-xs text-muted-foreground">{r.races?.track} {r.races?.race_date && `· ${new Date(r.races.race_date).toLocaleDateString("nl-NL")}`}</div>
                      </div>
                      <span className={`text-center text-sm ${r.incidents > 4 ? "text-red-400" : "text-muted-foreground"}`}>{r.incidents ?? "—"}x</span>
                      <span className="text-center font-heading font-black">{r.points}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default ProfilePage;
