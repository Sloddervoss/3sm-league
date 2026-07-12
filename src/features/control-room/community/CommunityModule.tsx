import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ImagePlus, Pencil, Plus, Save, ShieldCheck, Trash2, Users, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Team = Database["public"]["Tables"]["teams"]["Row"];
type TeamRequest = Database["public"]["Tables"]["team_creation_requests"]["Row"];
type Driver = Database["public"]["Functions"]["admin_get_all_profiles"]["Returns"][number];
type UserRole = Database["public"]["Functions"]["admin_get_user_roles"]["Returns"][number];
type ManagedRole = "admin" | "moderator" | "editor";

type RequestWithProfile = TeamRequest & { profiles: { display_name: string | null; iracing_name: string | null } | null };
type TeamWithMembers = Team & { team_memberships: Array<{ id: string; user_id: string; role: string }> };
type TeamDraft = { name: string; color: string; description: string; logoUrl: string };

/** Kept optional for existing callers; the native module now owns all production mutations. */
export type CommunityModuleProps = {
  onReviewTeamRequest?: (request: TeamRequest) => void;
  onManageTeam?: (team: Team) => void;
  onManageDriver?: (driver: Driver) => void;
};

const blankTeam = (): TeamDraft => ({ name: "", color: "#f97316", description: "", logoUrl: "" });
const displayName = (profile: { display_name: string | null; iracing_name: string | null }) => profile.display_name || profile.iracing_name || "Onbekende coureur";
const roleLabel = (role: string) => ({ moderator: "Steward", super_admin: "Super-admin", admin: "Admin", editor: "Editor" }[role] || role);
const roleClass = (role: ManagedRole, active: boolean) => active
  ? role === "admin" ? "border-emerald-400/35 bg-emerald-400/10 text-emerald-200" : role === "moderator" ? "border-sky-400/35 bg-sky-400/10 text-sky-200" : "border-violet-400/35 bg-violet-400/10 text-violet-200"
  : "border-white/10 bg-white/[0.035] text-gray-400";

const resizeImageToDataUrl = (file: File, max = 256): Promise<string> => new Promise((resolve, reject) => {
  const image = new Image();
  const objectUrl = URL.createObjectURL(file);
  image.onload = () => {
    const canvas = document.createElement("canvas");
    const scale = Math.min(max / image.width, max / image.height, 1);
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(objectUrl);
    resolve(canvas.toDataURL("image/png"));
  };
  image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("Afbeelding kon niet geladen worden.")); };
  image.src = objectUrl;
});

export function CommunityModule(_: CommunityModuleProps) {
  const queryClient = useQueryClient();
  const { user, isAdmin, isSuperAdmin } = useAuth();
  const [showCreate, setShowCreate] = useState(false);
  const [newTeam, setNewTeam] = useState<TeamDraft>(blankTeam);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [teamDraft, setTeamDraft] = useState<TeamDraft>(blankTeam);
  const [deleteTeam, setDeleteTeam] = useState<TeamWithMembers | null>(null);
  const [deleteDriver, setDeleteDriver] = useState<Driver | null>(null);

  const requestsQuery = useQuery({
    queryKey: ["control-room", "team-creation-requests", "pending"],
    queryFn: async (): Promise<RequestWithProfile[]> => {
      const { data, error } = await supabase.from("team_creation_requests").select("*, profiles(display_name, iracing_name)").eq("status", "pending").order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as RequestWithProfile[];
    },
  });
  const teamsQuery = useQuery({
    queryKey: ["control-room", "teams", "discord-sync"],
    queryFn: async (): Promise<TeamWithMembers[]> => {
      const { data, error } = await supabase.from("teams").select("*, team_memberships(id, user_id, role)").order("name");
      if (error) throw error;
      return (data || []) as TeamWithMembers[];
    },
  });
  const driversQuery = useQuery({
    queryKey: ["control-room", "drivers"],
    queryFn: async (): Promise<Driver[]> => {
      const { data, error } = await supabase.rpc("admin_get_all_profiles");
      if (error) throw error;
      return data || [];
    },
  });
  const rolesQuery = useQuery({
    queryKey: ["control-room", "user-roles"],
    queryFn: async (): Promise<UserRole[]> => {
      const { data, error } = await supabase.rpc("admin_get_user_roles");
      if (error) throw error;
      return data || [];
    },
  });

  const invalidateCommunity = () => {
    [["control-room"], ["teams"], ["admin-teams"], ["team-creation-requests"], ["all-profiles"], ["admin-all-profiles"], ["admin-user-roles"]].forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
  };
  const approveRequest = useMutation({
    mutationFn: async (request: RequestWithProfile) => {
      const { data: team, error: teamError } = await supabase.from("teams").insert({ name: request.team_name, description: request.team_description || null, color: request.team_color || "#f97316", logo_url: request.logo_url || null }).select().single();
      if (teamError) throw teamError;
      const { error: profileError } = await supabase.from("profiles").update({ team_id: team.id }).eq("user_id", request.user_id);
      if (profileError) throw profileError;
      const { error: membershipError } = await supabase.from("team_memberships").insert({ user_id: request.user_id, team_id: team.id, role: "driver" });
      if (membershipError) throw membershipError;
      const { error: requestError } = await supabase.from("team_creation_requests").delete().eq("id", request.id);
      if (requestError) throw requestError;
    },
    onSuccess: () => { toast.success("Team aangemaakt en aanvraag goedgekeurd."); invalidateCommunity(); },
    onError: (error: Error) => toast.error(error.message),
  });
  const denyRequest = useMutation({
    mutationFn: async (requestId: string) => { const { error } = await supabase.from("team_creation_requests").delete().eq("id", requestId); if (error) throw error; },
    onSuccess: () => { toast.success("Teamaanvraag afgewezen."); invalidateCommunity(); },
    onError: (error: Error) => toast.error(error.message),
  });
  const saveTeam = useMutation({
    mutationFn: async ({ id, draft }: { id?: string; draft: TeamDraft }) => {
      const values = { name: draft.name.trim(), color: draft.color || "#f97316", description: draft.description.trim() || null, logo_url: draft.logoUrl || null };
      const result = id ? await supabase.from("teams").update(values).eq("id", id) : await supabase.from("teams").insert(values);
      if (result.error) throw result.error;
    },
    onSuccess: (_, variables) => { toast.success(variables.id ? "Team bijgewerkt." : "Team aangemaakt."); invalidateCommunity(); setEditingTeam(null); setTeamDraft(blankTeam()); setShowCreate(false); setNewTeam(blankTeam()); },
    onError: (error: Error) => toast.error(error.message),
  });
  const removeTeam = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("teams").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { toast.success("Team verwijderd."); invalidateCommunity(); setDeleteTeam(null); },
    onError: (error: Error) => toast.error(error.message),
  });
  const changeRole = useMutation({
    mutationFn: async ({ userId, role, grant }: { userId: string; role: ManagedRole; grant: boolean }) => {
      const { error } = await supabase.rpc(grant ? "admin_grant_role" : "admin_revoke_role", { target_user_id: userId, target_role: role });
      if (error) throw error;
    },
    onSuccess: (_, variables) => { toast.success(`${roleLabel(variables.role)} ${variables.grant ? "toegekend" : "ingetrokken"}.`); invalidateCommunity(); },
    onError: (error: Error) => toast.error(error.message),
  });
  const removeDriver = useMutation({
    mutationFn: async (userId: string) => { const { error } = await supabase.rpc("admin_delete_user", { target_user_id: userId }); if (error) throw error; },
    onSuccess: () => { toast.success("Coureur verwijderd."); invalidateCommunity(); setDeleteDriver(null); },
    onError: (error: Error) => toast.error(error.message),
  });

  const rolesByUser = useMemo(() => {
    const grouped = new Map<string, string[]>();
    for (const role of rolesQuery.data || []) grouped.set(role.user_id, [...(grouped.get(role.user_id) || []), role.role]);
    return grouped;
  }, [rolesQuery.data]);
  const pendingRequests = requestsQuery.data || [];
  const teams = teamsQuery.data || [];
  const drivers = driversQuery.data || [];
  const unsyncedTeams = teams.filter((team) => !team.discord_role_id || !team.discord_category_id);
  const isBusy = approveRequest.isPending || denyRequest.isPending || saveTeam.isPending || removeTeam.isPending || changeRole.isPending || removeDriver.isPending;
  const startEdit = (team: Team) => { setEditingTeam(team); setTeamDraft({ name: team.name, color: team.color || "#f97316", description: team.description || "", logoUrl: team.logo_url || "" }); setShowCreate(false); };
  const loadLogo = async (file?: File, destination: "new" | "edit" = "edit") => {
    if (!file) return;
    try {
      const logoUrl = await resizeImageToDataUrl(file);
      if (destination === "new") setNewTeam((draft) => ({ ...draft, logoUrl })); else setTeamDraft((draft) => ({ ...draft, logoUrl }));
    } catch (error) { toast.error(error instanceof Error ? error.message : "Logo laden mislukt."); }
  };

  return <div className="space-y-6">
    <section className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[11px] font-black uppercase tracking-[0.16em] text-orange-300">Communitybeheer</p><h2 className="mt-1 font-heading text-2xl font-black text-white">Teams, coureurs en rechten</h2><p className="mt-2 max-w-3xl text-sm leading-relaxed text-gray-400">Alle acties hieronder schrijven direct naar de bestaande admin-RPC&apos;s en teamtabellen.</p></div><span className="rounded-full border border-white/10 bg-black/15 px-3 py-1.5 text-xs font-bold text-gray-300">{drivers.length} coureurs · {teams.length} teams</span></div>
      {(requestsQuery.isError || teamsQuery.isError || driversQuery.isError || rolesQuery.isError) && <p className="mt-4 rounded-lg border border-red-400/25 bg-red-400/[0.07] p-3 text-sm text-red-200">Communitydata kon niet volledig worden geladen. Vernieuw de pagina of controleer je adminrechten.</p>}
    </section>

    <section className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] p-5"><div className="flex items-start justify-between gap-4"><div className="flex gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" /><div><p className="font-bold text-amber-100">{pendingRequests.length} openstaande teamaanvraag{pendingRequests.length === 1 ? "" : "en"}</p><p className="mt-1 text-sm leading-relaxed text-amber-100/70">Goedkeuren maakt het team, koppelt de aanvrager aan het profiel en voegt een teamlidmaatschap toe.</p></div></div></div><div className="mt-4 space-y-2">{requestsQuery.isLoading && <p className="text-sm text-amber-100/65">Aanvragen laden…</p>}{pendingRequests.map((request) => <div key={request.id} className="grid gap-3 rounded-xl border border-amber-300/15 bg-black/10 p-3 sm:grid-cols-[1fr_auto] sm:items-center"><span><span className="block font-bold text-white">{request.team_name}</span><span className="mt-1 block text-xs text-gray-400">Aangevraagd door {displayName(request.profiles || { display_name: null, iracing_name: null })} · kleur {request.team_color}</span></span><span className="flex gap-2"><button onClick={() => approveRequest.mutate(request)} disabled={isBusy} className="inline-flex items-center gap-1 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs font-bold text-emerald-200 disabled:opacity-50"><Check className="h-3.5 w-3.5" />Goedkeuren</button><button onClick={() => denyRequest.mutate(request.id)} disabled={isBusy} className="inline-flex items-center gap-1 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs font-bold text-red-200 disabled:opacity-50"><X className="h-3.5 w-3.5" />Afwijzen</button></span></div>)}{!requestsQuery.isLoading && !pendingRequests.length && <p className="text-sm text-amber-100/65">Geen teamaanvragen wachten op beoordeling.</p>}</div></section>

    <section className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><Users className="h-5 w-5 text-orange-300" /><div><p className="text-xs font-black uppercase tracking-wider text-gray-500">Teams & Discord automation</p><h3 className="font-heading text-xl font-black text-white">Teambeheer</h3></div></div><button onClick={() => { setShowCreate((value) => !value); setEditingTeam(null); }} className="inline-flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-2 text-xs font-black text-white hover:bg-orange-400"><Plus className="h-3.5 w-3.5" />Nieuw team</button></div>
      {showCreate && <TeamForm title="Nieuw team" draft={newTeam} setDraft={setNewTeam} onLogo={(file) => loadLogo(file, "new")} onCancel={() => { setShowCreate(false); setNewTeam(blankTeam()); }} onSave={() => saveTeam.mutate({ draft: newTeam })} saving={saveTeam.isPending} />}
      {editingTeam && <TeamForm title={`Team bewerken · ${editingTeam.name}`} draft={teamDraft} setDraft={setTeamDraft} onLogo={(file) => loadLogo(file)} onCancel={() => { setEditingTeam(null); setTeamDraft(blankTeam()); }} onSave={() => saveTeam.mutate({ id: editingTeam.id, draft: teamDraft })} saving={saveTeam.isPending} />}
      <div className="mt-4 space-y-2">{teamsQuery.isLoading && <p className="text-sm text-gray-500">Teams laden…</p>}{teams.map((team) => { const synced = Boolean(team.discord_role_id && team.discord_category_id); return <div key={team.id} className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-black/10 p-3"><span className="h-9 w-1 rounded-full" style={{ backgroundColor: team.color }} />{team.logo_url && <img src={team.logo_url} alt="" className="h-9 w-9 rounded bg-white/5 object-contain" />}<span className="min-w-0 flex-1"><span className="block truncate font-bold text-white">{team.name}</span><span className="text-xs text-gray-500">{team.team_memberships.length} leden · {synced ? "rol + categorie gekoppeld" : "Discord-sync onvolledig"}</span></span><span className={synced ? "text-xs font-bold text-emerald-300" : "text-xs font-bold text-amber-300"}>{synced ? "Gesynchroniseerd" : "Controle nodig"}</span><button onClick={() => startEdit(team)} className="rounded-lg p-2 text-gray-400 hover:bg-white/5 hover:text-orange-200" aria-label={`${team.name} bewerken`}><Pencil className="h-4 w-4" /></button><button onClick={() => setDeleteTeam(team)} className="rounded-lg p-2 text-gray-400 hover:bg-red-400/10 hover:text-red-300" aria-label={`${team.name} verwijderen`}><Trash2 className="h-4 w-4" /></button></div>; })}{!teamsQuery.isLoading && !teams.length && <p className="text-sm text-gray-500">Nog geen teams gevonden.</p>}</div>
      {unsyncedTeams.length > 0 && <p className="mt-4 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] p-3 text-xs text-amber-100">{unsyncedTeams.length} team{unsyncedTeams.length === 1 ? " heeft" : "s hebben"} geen complete Discord rol/categorie-koppeling.</p>}
    </section>

    <section className="overflow-x-auto rounded-2xl border border-white/[0.07] bg-white/[0.025]"><div className="min-w-[560px] grid grid-cols-[minmax(13rem,1fr)_minmax(15rem,auto)_auto] gap-3 bg-white/[0.035] px-5 py-3 text-[11px] font-black uppercase tracking-wider text-gray-500"><span>Coureur</span><span>Site-rollen</span><span>Beheer</span></div>{driversQuery.isLoading && <p className="p-5 text-sm text-gray-500">Coureurs laden…</p>}{drivers.map((driver) => { const roles = rolesByUser.get(driver.user_id) || []; const targetSuperAdmin = roles.includes("super_admin"); const isMe = driver.user_id === user?.id; const canDelete = isAdmin && !targetSuperAdmin && !isMe; const canToggle = (role: ManagedRole) => !targetSuperAdmin && ((role === "editor" && (isAdmin || isSuperAdmin)) || ((role === "admin" || role === "moderator") && isSuperAdmin)); return <div key={driver.user_id} className="grid grid-cols-[minmax(13rem,1fr)_minmax(15rem,auto)_auto] gap-3 border-t border-white/[0.06] px-5 py-3.5 text-sm"><span><span className="block font-bold text-white">{displayName(driver)}</span><span className="text-xs text-gray-500">iRacing: {driver.iracing_id || "niet gekoppeld"} · Discord: {driver.discord_id ? "gekoppeld" : "niet gekoppeld"}</span></span><span className="flex flex-wrap items-center gap-1.5">{targetSuperAdmin ? <span className="rounded-md border border-yellow-400/30 bg-yellow-400/10 px-2 py-1 text-xs font-bold text-yellow-200">★ Super-admin</span> : (["admin", "moderator", "editor"] as ManagedRole[]).map((role) => { const active = roles.includes(role); return <button key={role} onClick={() => canToggle(role) && changeRole.mutate({ userId: driver.user_id, role, grant: !active })} disabled={!canToggle(role) || changeRole.isPending} title={canToggle(role) ? `${active ? "Trek in" : "Ken toe"}: ${roleLabel(role)}` : "Onvoldoende rechten voor deze rol"} className={`rounded-md border px-2 py-1 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-45 ${roleClass(role, active)}`}>{active ? roleLabel(role) : `+ ${roleLabel(role)}`}</button>; })}</span><span className="flex items-center"><button onClick={() => setDeleteDriver(driver)} disabled={!canDelete || removeDriver.isPending} title={canDelete ? "Coureur definitief verwijderen" : "Super-admins en je eigen account kunnen hier niet worden verwijderd"} className="rounded-lg p-2 text-gray-400 hover:bg-red-400/10 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-25"><Trash2 className="h-4 w-4" /></button></span></div>; })}{!driversQuery.isLoading && !drivers.length && <p className="p-5 text-sm text-gray-500">Geen coureurs gevonden.</p>}</section>

    <section className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5"><div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-orange-300" /><div><p className="text-xs font-black uppercase tracking-wider text-gray-500">Rollen zijn site-rechten</p><h3 className="font-heading text-xl font-black text-white">Beheergrenzen</h3></div></div><p className="mt-3 text-sm leading-relaxed text-gray-400">Admin en Super-admin kunnen Editors beheren. Alleen Super-admin kan Admin- en Stewardrollen beheren. Super-adminaccounts zijn beschermd. Discord-teamrollen zijn geen website-permissies.</p></section>

    <AlertDialog open={Boolean(deleteTeam)} onOpenChange={(open) => !open && setDeleteTeam(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Team verwijderen?</AlertDialogTitle><AlertDialogDescription>{deleteTeam && <>Je verwijdert <strong>{deleteTeam.name}</strong>. Dit team heeft momenteel <strong>{deleteTeam.team_memberships.length}</strong> lid{deleteTeam.team_memberships.length === 1 ? "" : "den"}. Controleer de impact op lidmaatschappen en Discord-koppelingen voordat je doorgaat.</>}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Annuleren</AlertDialogCancel><AlertDialogAction onClick={(event) => { event.preventDefault(); if (deleteTeam) removeTeam.mutate(deleteTeam.id); }} disabled={removeTeam.isPending} className="bg-red-600 hover:bg-red-500">{removeTeam.isPending ? "Verwijderen…" : "Team verwijderen"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <AlertDialog open={Boolean(deleteDriver)} onOpenChange={(open) => !open && setDeleteDriver(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Coureur verwijderen?</AlertDialogTitle><AlertDialogDescription>{deleteDriver && <>Dit verwijdert <strong>{displayName(deleteDriver)}</strong> via de bestaande admin-RPC. Deze actie kan niet ongedaan worden gemaakt.</>}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Annuleren</AlertDialogCancel><AlertDialogAction onClick={(event) => { event.preventDefault(); if (deleteDriver) removeDriver.mutate(deleteDriver.user_id); }} disabled={removeDriver.isPending} className="bg-red-600 hover:bg-red-500">{removeDriver.isPending ? "Verwijderen…" : "Coureur verwijderen"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}

function TeamForm({ title, draft, setDraft, onLogo, onCancel, onSave, saving }: { title: string; draft: TeamDraft; setDraft: React.Dispatch<React.SetStateAction<TeamDraft>>; onLogo: (file?: File) => void; onCancel: () => void; onSave: () => void; saving: boolean }) {
  return <div className="mt-4 rounded-xl border border-orange-400/20 bg-black/15 p-4"><p className="font-bold text-white">{title}</p><div className="mt-3 grid gap-3 md:grid-cols-2"><label className="text-xs text-gray-400">Naam<input value={draft.name} onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))} className="mt-1 block w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-orange-400/50" /></label><label className="text-xs text-gray-400">Kleur<div className="mt-1 flex gap-2"><input type="color" value={draft.color} onChange={(event) => setDraft((value) => ({ ...value, color: event.target.value }))} className="h-9 w-10 rounded border border-white/10 bg-transparent" /><input value={draft.color} onChange={(event) => setDraft((value) => ({ ...value, color: event.target.value }))} className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 font-mono text-sm text-white outline-none focus:border-orange-400/50" /></div></label><label className="text-xs text-gray-400 md:col-span-2">Beschrijving<input value={draft.description} onChange={(event) => setDraft((value) => ({ ...value, description: event.target.value }))} className="mt-1 block w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-orange-400/50" /></label><div className="flex items-center gap-3 md:col-span-2"><label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-white/20 px-3 py-2 text-xs font-bold text-gray-300 hover:border-orange-400/50"><ImagePlus className="h-3.5 w-3.5" />{draft.logoUrl ? "Logo vervangen" : "Logo uploaden"}<input type="file" accept="image/*" className="hidden" onChange={(event) => onLogo(event.target.files?.[0])} /></label>{draft.logoUrl && <><img src={draft.logoUrl} alt="Logo preview" className="h-10 w-10 rounded bg-white/5 object-contain" /><button onClick={() => setDraft((value) => ({ ...value, logoUrl: "" }))} className="text-xs text-red-300">Logo wissen</button></>}</div></div><div className="mt-4 flex gap-2"><button onClick={onSave} disabled={!draft.name.trim() || saving} className="inline-flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-2 text-xs font-black text-white disabled:opacity-50"><Save className="h-3.5 w-3.5" />{saving ? "Opslaan…" : "Opslaan"}</button><button onClick={onCancel} disabled={saving} className="rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-gray-300">Annuleren</button></div></div>;
}
