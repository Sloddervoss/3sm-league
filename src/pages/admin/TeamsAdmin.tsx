import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Plus, Car, Trash2, Check, X, ImagePlus, Pencil, Save, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type TeamMember = {
  id: string;
  user_id: string;
  profiles: { display_name: string | null; iracing_name: string | null } | null;
};

type AdminTeam = {
  id: string;
  name: string;
  color: string;
  logo_url: string | null;
  description: string | null;
  created_at: string;
  team_memberships: TeamMember[];
};

type CreationRequest = {
  id: string;
  team_name: string;
  team_description: string | null;
  team_color: string | null;
  logo_url: string | null;
  user_id: string;
  profiles: { display_name: string | null; iracing_name: string | null } | null;
};

const resizeImageToDataUrl = (file: File, max = 256): Promise<string> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const scale = Math.min(max / img.width, max / img.height, 1);
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Afbeelding kon niet geladen worden."));
    };
    img.src = url;
  });

const TeamsAdmin = () => {
  const queryClient = useQueryClient();

  const [newTeam, setNewTeam] = useState({ name: "", description: "", color: "#f97316", logo_url: "" });
  const [newTeamLogoPreview, setNewTeamLogoPreview] = useState("");
  const [showTeamForm, setShowTeamForm] = useState(false);
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [editingTeamLogo, setEditingTeamLogo] = useState("");
  const [editingTeamCurrentLogo, setEditingTeamCurrentLogo] = useState("");
  const [editingTeamNameId, setEditingTeamNameId] = useState<string | null>(null);
  const [editingTeamName, setEditingTeamName] = useState("");

  const { data: teams } = useQuery({
    queryKey: ["admin-teams"],
    queryFn: async (): Promise<AdminTeam[]> => {
      const { data, error } = await supabase
        .from("teams")
        .select("id, name, description, color, logo_url, created_at, team_memberships(id, user_id, profiles(display_name, iracing_name))");
      if (error) throw error;
      return (data as AdminTeam[]) || [];
    },
  });

  const { data: creationRequests } = useQuery({
    queryKey: ["team-creation-requests"],
    refetchOnMount: "always",
    staleTime: 0,
    queryFn: async (): Promise<CreationRequest[]> => {
      const { data, error } = await supabase
        .from("team_creation_requests")
        .select("*, profiles(display_name, iracing_name)")
        .eq("status", "pending");
      if (error) throw error;
      return (data as CreationRequest[]) || [];
    },
  });

  const invalidateTeams = () => {
    queryClient.invalidateQueries({ queryKey: ["admin-teams"] });
    queryClient.invalidateQueries({ queryKey: ["teams"] });
  };

  const createTeam = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("teams").insert({
        name: newTeam.name,
        description: newTeam.description || null,
        color: newTeam.color,
        logo_url: newTeamLogoPreview || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Team aangemaakt!");
      invalidateTeams();
      setShowTeamForm(false);
      setNewTeam({ name: "", description: "", color: "#f97316", logo_url: "" });
      setNewTeamLogoPreview("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteTeam = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("teams").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Team verwijderd"); invalidateTeams(); },
  });

  const approveCreationRequest = useMutation({
    mutationFn: async (req: CreationRequest) => {
      const { data: team, error: teamErr } = await supabase.from("teams").insert({
        name: req.team_name,
        description: req.team_description || null,
        color: req.team_color || "#f97316",
        logo_url: req.logo_url || null,
      }).select().single();
      if (teamErr) throw teamErr;
      const { error: profileErr } = await supabase.from("profiles").update({ team_id: team.id }).eq("user_id", req.user_id);
      if (profileErr) throw profileErr;
      const { error: memberErr } = await supabase.from("team_memberships").insert({ user_id: req.user_id, team_id: team.id, role: "driver" });
      if (memberErr) throw memberErr;
      const { error: deleteErr } = await supabase.from("team_creation_requests").delete().eq("id", req.id);
      if (deleteErr) throw deleteErr;
    },
    onSuccess: () => {
      toast.success("Team aangemaakt en goedgekeurd!");
      queryClient.invalidateQueries({ queryKey: ["team-creation-requests"] });
      invalidateTeams();
      queryClient.invalidateQueries({ queryKey: ["all-profiles"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const denyCreationRequest = useMutation({
    mutationFn: async (reqId: string) => {
      await supabase.from("team_creation_requests").delete().eq("id", reqId);
    },
    onSuccess: () => {
      toast.success("Aanvraag afgewezen.");
      queryClient.invalidateQueries({ queryKey: ["team-creation-requests"] });
    },
  });

  const updateTeamLogo = useMutation({
    mutationFn: async ({ teamId, logoUrl }: { teamId: string; logoUrl: string }) => {
      const { error } = await supabase.from("teams").update({ logo_url: logoUrl || null }).eq("id", teamId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Logo bijgewerkt!");
      invalidateTeams();
      setEditingTeamId(null);
      setEditingTeamLogo("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateTeamName = useMutation({
    mutationFn: async ({ teamId, name }: { teamId: string; name: string }) => {
      const { error } = await supabase.from("teams").update({ name }).eq("id", teamId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Teamnaam bijgewerkt!");
      invalidateTeams();
      setEditingTeamNameId(null);
      setEditingTeamName("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div>
      {/* Team creation requests */}
      {creationRequests && creationRequests.length > 0 && (
        <div className="mb-8">
          <h2 className="font-heading text-xl font-black mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5 text-yellow-400" />
            NIEUWE TEAM AANVRAGEN
            <span className="ml-1 px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 text-sm font-bold">{creationRequests.length}</span>
          </h2>
          <div className="space-y-3">
            {creationRequests.map((req) => (
              <div key={req.id} className="bg-card border border-yellow-500/20 rounded-lg p-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  {req.logo_url ? (
                    <img src={req.logo_url} alt={req.team_name} className="w-10 h-10 object-contain rounded-md border border-border bg-secondary/50" />
                  ) : (
                    <div className="w-3 h-10 rounded-sm shrink-0" style={{ backgroundColor: req.team_color || "#f97316" }} />
                  )}
                  <div>
                    <div className="font-heading font-bold text-base" style={{ color: req.team_color || "#f97316" }}>{req.team_name}</div>
                    {req.team_description && <div className="text-xs text-muted-foreground">{req.team_description}</div>}
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Aangevraagd door <span className="font-medium text-foreground">{req.profiles?.display_name || req.profiles?.iracing_name || "Onbekend"}</span>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => approveCreationRequest.mutate(req)}
                    disabled={approveCreationRequest.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold bg-green-500/10 text-green-400 border border-green-500/30 hover:bg-green-500/20 transition-colors"
                  >
                    <Check className="w-3.5 h-3.5" /> Goedkeuren
                  </button>
                  <button
                    onClick={() => denyCreationRequest.mutate(req.id)}
                    disabled={denyCreationRequest.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" /> Afwijzen
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <h2 className="font-heading text-2xl font-black">TEAMS</h2>
        <button onClick={() => setShowTeamForm(!showTeamForm)} className="flex items-center gap-2 px-4 py-2 rounded-md bg-gradient-racing text-white font-heading font-bold text-sm uppercase tracking-wider hover:opacity-90 transition-opacity">
          <Plus className="w-4 h-4" />Nieuw Team
        </button>
      </div>

      {showTeamForm && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="bg-card border border-border rounded-lg p-6 mb-6 racing-stripe-left">
          <h3 className="font-heading text-lg font-bold mb-4">NIEUW TEAM</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Team Naam *</label>
              <input type="text" value={newTeam.name} onChange={(e) => setNewTeam({ ...newTeam, name: e.target.value })} placeholder="Red Bull Racing" className="w-full px-4 py-2.5 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Team Kleur</label>
              <div className="flex gap-2">
                <input type="color" value={newTeam.color} onChange={(e) => setNewTeam({ ...newTeam, color: e.target.value })} className="w-12 h-10 rounded-md border border-border cursor-pointer bg-secondary" />
                <input type="text" value={newTeam.color} onChange={(e) => setNewTeam({ ...newTeam, color: e.target.value })} className="flex-1 px-4 py-2.5 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Team Logo</label>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 px-4 py-2.5 rounded-md border border-dashed border-border hover:border-primary/50 bg-secondary/50 cursor-pointer transition-colors">
                  <ImagePlus className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">{newTeamLogoPreview ? "Logo geladen" : "Logo uploaden..."}</span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (file) setNewTeamLogoPreview(await resizeImageToDataUrl(file));
                    }}
                  />
                </label>
                {newTeamLogoPreview && (
                  <div className="flex items-center gap-2">
                    <img src={newTeamLogoPreview} alt="preview" className="w-10 h-10 object-contain rounded-md border border-border bg-secondary/50" />
                    <button onClick={() => setNewTeamLogoPreview("")} className="text-muted-foreground hover:text-destructive transition-colors"><X className="w-4 h-4" /></button>
                  </div>
                )}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Beschrijving</label>
              <input type="text" value={newTeam.description} onChange={(e) => setNewTeam({ ...newTeam, description: e.target.value })} className="w-full px-4 py-2.5 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={() => createTeam.mutate()} disabled={!newTeam.name || createTeam.isPending} className="px-6 py-2.5 rounded-md bg-gradient-racing text-white font-heading font-bold text-sm disabled:opacity-50 hover:opacity-90 transition-opacity">{createTeam.isPending ? "Aanmaken..." : "Team Aanmaken"}</button>
            <button onClick={() => { setShowTeamForm(false); setNewTeamLogoPreview(""); }} className="px-6 py-2.5 rounded-md border border-border text-muted-foreground font-heading font-bold text-sm hover:text-foreground transition-colors">Annuleren</button>
          </div>
        </motion.div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {teams?.map((team) => (
          <div key={team.id} className="bg-card border border-border rounded-lg p-5" style={{ borderTopColor: team.color, borderTopWidth: 3 }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-md border border-border bg-secondary/50 flex items-center justify-center overflow-hidden" style={{ backgroundColor: team.color + "33" }}>
                  {team.logo_url ? (
                    <img src={team.logo_url} alt={team.name} className="w-full h-full object-contain" />
                  ) : (
                    <Car className="w-5 h-5 text-muted-foreground/50" />
                  )}
                </div>
                <div>
                  <h3 className="font-heading font-bold text-lg">{team.name}</h3>
                  <p className="text-xs text-muted-foreground">{team.team_memberships?.length || 0} drivers</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    if (editingTeamNameId === team.id) {
                      setEditingTeamNameId(null); setEditingTeamName("");
                    } else {
                      setEditingTeamNameId(team.id); setEditingTeamName(team.name); setEditingTeamId(null);
                    }
                  }}
                  className="p-2 text-muted-foreground hover:text-primary transition-colors"
                  title="Naam wijzigen"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    if (editingTeamId === team.id) {
                      setEditingTeamId(null); setEditingTeamLogo(""); setEditingTeamCurrentLogo("");
                    } else {
                      setEditingTeamId(team.id); setEditingTeamLogo(""); setEditingTeamCurrentLogo(""); setEditingTeamNameId(null);
                      supabase.from("teams").select("logo_url").eq("id", team.id).single()
                        .then(({ data }) => setEditingTeamCurrentLogo((data as { logo_url: string | null })?.logo_url || ""));
                    }
                  }}
                  className="p-2 text-muted-foreground hover:text-primary transition-colors"
                  title="Logo wijzigen"
                >
                  <ImagePlus className="w-4 h-4" />
                </button>
                <button onClick={() => deleteTeam.mutate(team.id)} className="p-2 text-muted-foreground hover:text-destructive transition-colors"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>

            {/* Inline naam editor */}
            {editingTeamNameId === team.id && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mb-3 p-3 rounded-md bg-secondary/40 border border-border space-y-2">
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Naam wijzigen</p>
                <input
                  type="text"
                  value={editingTeamName}
                  onChange={(e) => setEditingTeamName(e.target.value)}
                  className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:border-primary"
                  placeholder="Teamnaam..."
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => updateTeamName.mutate({ teamId: team.id, name: editingTeamName.trim() })}
                    disabled={!editingTeamName.trim() || editingTeamName.trim() === team.name || updateTeamName.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold bg-gradient-racing text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
                  >
                    <Save className="w-3 h-3" /> Opslaan
                  </button>
                  <button onClick={() => { setEditingTeamNameId(null); setEditingTeamName(""); }} className="px-3 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground transition-colors">Annuleren</button>
                </div>
              </motion.div>
            )}

            {/* Inline logo editor */}
            {editingTeamId === team.id && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mb-3 p-3 rounded-md bg-secondary/40 border border-border space-y-2">
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Logo wijzigen</p>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 px-3 py-2 rounded-md border border-dashed border-border hover:border-primary/50 bg-secondary/50 cursor-pointer transition-colors text-xs text-muted-foreground">
                    <ImagePlus className="w-3.5 h-3.5" />
                    {editingTeamLogo ? "Ander bestand" : "Kies afbeelding..."}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (file) setEditingTeamLogo(await resizeImageToDataUrl(file));
                      }}
                    />
                  </label>
                  {(editingTeamLogo || editingTeamCurrentLogo) && (
                    <img
                      src={editingTeamLogo || editingTeamCurrentLogo}
                      alt="preview"
                      className="w-10 h-10 object-contain rounded-md border border-border bg-secondary/50"
                    />
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => updateTeamLogo.mutate({ teamId: team.id, logoUrl: editingTeamLogo })}
                    disabled={!editingTeamLogo || updateTeamLogo.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold bg-gradient-racing text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
                  >
                    <Save className="w-3 h-3" /> Opslaan
                  </button>
                  {editingTeamCurrentLogo && (
                    <button
                      onClick={() => { updateTeamLogo.mutate({ teamId: team.id, logoUrl: "" }); setEditingTeamCurrentLogo(""); }}
                      disabled={updateTeamLogo.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold border border-border text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <X className="w-3 h-3" /> Verwijderen
                    </button>
                  )}
                  <button onClick={() => { setEditingTeamId(null); setEditingTeamLogo(""); setEditingTeamCurrentLogo(""); }} className="px-3 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground transition-colors">Annuleren</button>
                </div>
              </motion.div>
            )}

            {team.team_memberships?.length > 0 && (
              <div className="mt-2 space-y-1 border-t border-border/50 pt-2">
                {team.team_memberships.map((m) => (
                  <div key={m.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: team.color }} />
                    {m.profiles?.display_name || m.profiles?.iracing_name || "Unknown"}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {!teams?.length && (
          <div className="col-span-2 text-center py-16 text-muted-foreground">
            <Car className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p>Nog geen teams.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default TeamsAdmin;
