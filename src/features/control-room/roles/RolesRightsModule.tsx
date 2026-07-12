import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, RefreshCw, Search, ShieldCheck, UsersRound } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type Profile = Database["public"]["Functions"]["admin_get_all_profiles"]["Returns"][number];
type UserRole = Database["public"]["Functions"]["admin_get_user_roles"]["Returns"][number];
type ManagedRole = "admin" | "moderator" | "editor";

type RoleDefinition = {
  id: ManagedRole;
  label: string;
  description: string;
  activeClass: string;
};

const managedRoles: RoleDefinition[] = [
  { id: "admin", label: "Admin", description: "Volledige operationele toegang", activeClass: "border-emerald-400/35 bg-emerald-400/10 text-emerald-100" },
  { id: "moderator", label: "Steward", description: "Stewarding en uitslagbeoordeling", activeClass: "border-sky-400/35 bg-sky-400/10 text-sky-100" },
  { id: "editor", label: "Editor", description: "Nieuwsredactie beheren", activeClass: "border-violet-400/35 bg-violet-400/10 text-violet-100" },
];

const displayName = (profile: Profile) => profile.display_name || profile.iracing_name || "Onbekende coureur";

const roleBoundaryReason = ({ role, targetIsSuperAdmin, isAdmin, isSuperAdmin }: { role: ManagedRole; targetIsSuperAdmin: boolean; isAdmin: boolean; isSuperAdmin: boolean }) => {
  if (targetIsSuperAdmin) return "Super-adminaccounts zijn beschermd.";
  if (role === "editor" && (isAdmin || isSuperAdmin)) return null;
  if ((role === "admin" || role === "moderator") && isSuperAdmin) return null;
  return role === "editor"
    ? "Alleen Admin en Super-admin kunnen Editors beheren."
    : "Alleen Super-admin kan Admin- en Stewardrollen beheren.";
};

export type RolesRightsModuleProps = {
  /** Optional so the module can be embedded in Control Room shells without a legacy bridge. */
  className?: string;
};

export function RolesRightsModule({ className = "" }: RolesRightsModuleProps) {
  const { user, isAdmin, isSuperAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const canRead = Boolean(user && (isAdmin || isSuperAdmin));

  const profilesQuery = useQuery({
    queryKey: ["control-room", "roles", "profiles"],
    enabled: canRead,
    queryFn: async (): Promise<Profile[]> => {
      const { data, error } = await supabase.rpc("admin_get_all_profiles");
      if (error) throw error;
      return data || [];
    },
  });
  const rolesQuery = useQuery({
    queryKey: ["control-room", "roles", "user-roles"],
    enabled: canRead,
    queryFn: async (): Promise<UserRole[]> => {
      const { data, error } = await supabase.rpc("admin_get_user_roles");
      if (error) throw error;
      return data || [];
    },
  });

  const rolesByUser = useMemo(() => {
    const grouped = new Map<string, Set<string>>();
    for (const assignment of rolesQuery.data || []) {
      const assignments = grouped.get(assignment.user_id) || new Set<string>();
      assignments.add(assignment.role);
      grouped.set(assignment.user_id, assignments);
    }
    return grouped;
  }, [rolesQuery.data]);

  const invalidateRoleData = () => {
    [["control-room", "roles"], ["control-room", "user-roles"], ["admin-all-profiles"], ["admin-user-roles"]].forEach((queryKey) => {
      queryClient.invalidateQueries({ queryKey });
    });
  };

  const changeRole = useMutation({
    mutationFn: async ({ userId, role, grant, targetIsSuperAdmin }: { userId: string; role: ManagedRole; grant: boolean; targetIsSuperAdmin: boolean }) => {
      const boundary = roleBoundaryReason({ role, targetIsSuperAdmin, isAdmin, isSuperAdmin });
      if (boundary) throw new Error(boundary);
      const { error } = await supabase.rpc(grant ? "admin_grant_role" : "admin_revoke_role", { target_user_id: userId, target_role: role });
      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      const role = managedRoles.find((candidate) => candidate.id === variables.role)?.label || variables.role;
      setFeedback({ tone: "success", message: `${role} is ${variables.grant ? "toegekend" : "ingetrokken"}.` });
      invalidateRoleData();
    },
    onError: (error: Error) => setFeedback({ tone: "error", message: error.message || "Rolwijziging mislukt." }),
  });

  const searchTerm = search.trim().toLocaleLowerCase();
  const profiles = (profilesQuery.data || []).filter((profile) => {
    if (!searchTerm) return true;
    return [displayName(profile), profile.iracing_name, profile.iracing_id, profile.discord_id]
      .filter(Boolean)
      .some((value) => String(value).toLocaleLowerCase().includes(searchTerm));
  });
  const loading = profilesQuery.isLoading || rolesQuery.isLoading;
  const queryError = profilesQuery.error || rolesQuery.error;

  if (!canRead) {
    return <section className={`rounded-2xl border border-white/[0.07] bg-white/[0.025] p-6 text-sm text-gray-400 ${className}`}>
      <ShieldCheck className="mb-3 h-6 w-6 text-orange-300" />
      Meld je aan met een Admin- of Super-adminrol om site-rechten te beheren.
    </section>;
  }

  return <section aria-label="Rollen en rechten" className={`space-y-5 ${className}`}>
    <header className="flex flex-col gap-4 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5 lg:flex-row lg:items-start lg:justify-between">
      <div className="flex gap-3">
        <div className="rounded-xl border border-orange-400/20 bg-orange-400/[0.08] p-2.5"><ShieldCheck className="h-5 w-5 text-orange-300" /></div>
        <div><p className="text-[11px] font-black uppercase tracking-[0.16em] text-orange-300">Control Room · site-rechten</p><h2 className="mt-1 font-heading text-2xl font-black text-white">Rollen & rechten</h2><p className="mt-2 max-w-3xl text-sm leading-relaxed text-gray-400">Beheer de bestaande website-rollen via de admin-RPC&apos;s. Discord-teamrollen veranderen geen websitepermissies.</p></div>
      </div>
      <button type="button" onClick={() => { setFeedback(null); void Promise.all([profilesQuery.refetch(), rolesQuery.refetch()]); }} disabled={profilesQuery.isFetching || rolesQuery.isFetching} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-gray-300 hover:border-orange-400/35 hover:text-orange-100 disabled:cursor-not-allowed disabled:opacity-50">
        <RefreshCw className={`h-3.5 w-3.5 ${(profilesQuery.isFetching || rolesQuery.isFetching) ? "animate-spin" : ""}`} />Vernieuwen
      </button>
    </header>

    <div className="grid gap-3 md:grid-cols-3">
      {managedRoles.map((role) => <article key={role.id} className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-4"><p className="font-bold text-white">{role.label}</p><p className="mt-1 text-xs leading-relaxed text-gray-500">{role.description}</p><p className="mt-3 text-xs font-bold text-orange-200">{role.id === "editor" ? "Admin + Super-admin" : "Alleen Super-admin"}</p></article>)}
    </div>

    {feedback && <p role={feedback.tone === "error" ? "alert" : "status"} className={`flex items-center gap-2 rounded-xl border p-3 text-sm ${feedback.tone === "success" ? "border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-100" : "border-red-400/25 bg-red-500/[0.08] text-red-100"}`}><CheckCircle2 className="h-4 w-4 shrink-0" />{feedback.message}</p>}
    {queryError && <p role="alert" className="rounded-xl border border-red-400/25 bg-red-500/[0.08] p-4 text-sm text-red-100">Rollen of profielen konden niet worden geladen. Controleer je adminrechten en probeer opnieuw. {queryError instanceof Error ? queryError.message : ""}</p>}

    <section className="rounded-2xl border border-white/[0.07] bg-white/[0.025]">
      <header className="flex flex-col gap-3 border-b border-white/[0.07] p-5 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-2"><UsersRound className="h-5 w-5 text-orange-300" /><div><p className="text-xs font-black uppercase tracking-wider text-gray-500">Live roltoewijzingen</p><h3 className="font-heading text-xl font-black text-white">Coureurs</h3></div></div><label className="relative"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-500" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Zoek coureur…" className="w-full rounded-lg border border-white/10 bg-black/20 py-2 pl-9 pr-3 text-sm text-white outline-none placeholder:text-gray-600 focus:border-orange-400 sm:w-64" /></label></header>
      <div className="overflow-x-auto"><div className="min-w-[760px]"><div className="grid grid-cols-[minmax(15rem,1fr)_minmax(24rem,auto)] gap-4 bg-white/[0.035] px-5 py-3 text-[11px] font-black uppercase tracking-wider text-gray-500"><span>Coureur</span><span>Website-rollen</span></div>
        {loading && <div className="flex items-center gap-2 p-5 text-sm text-gray-400"><Loader2 className="h-4 w-4 animate-spin" />Rollen en coureurs laden…</div>}
        {!loading && profiles.map((profile) => {
          const roles = rolesByUser.get(profile.user_id) || new Set<string>();
          const targetIsSuperAdmin = roles.has("super_admin");
          return <div key={profile.user_id} className="grid grid-cols-[minmax(15rem,1fr)_minmax(24rem,auto)] items-center gap-4 border-t border-white/[0.06] px-5 py-3.5"><div><div className="flex flex-wrap items-center gap-2"><span className="font-bold text-white">{displayName(profile)}</span>{targetIsSuperAdmin && <span className="rounded-md border border-yellow-400/30 bg-yellow-400/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-yellow-100">★ Super-admin</span>}</div><p className="mt-1 text-xs text-gray-500">iRacing: {profile.iracing_id || "niet gekoppeld"} · Discord: {profile.discord_id ? "gekoppeld" : "niet gekoppeld"}</p></div><div className="flex flex-wrap gap-2">{managedRoles.map((role) => { const active = roles.has(role.id); const disabledReason = roleBoundaryReason({ role: role.id, targetIsSuperAdmin, isAdmin, isSuperAdmin }); const disabled = Boolean(disabledReason) || changeRole.isPending; return <button key={role.id} type="button" disabled={disabled} title={disabledReason || `${active ? "Trek in" : "Ken toe"}: ${role.label}`} onClick={() => { setFeedback(null); changeRole.mutate({ userId: profile.user_id, role: role.id, grant: !active, targetIsSuperAdmin }); }} className={`rounded-md border px-2.5 py-1.5 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-45 ${active ? role.activeClass : "border-white/10 bg-white/[0.035] text-gray-400 hover:border-orange-400/35 hover:text-orange-100"}`}>{active ? role.label : `+ ${role.label}`}</button>; })}</div></div>;
        })}
        {!loading && !queryError && profilesQuery.data?.length === 0 && <p className="p-6 text-center text-sm text-gray-500">Geen coureurs gevonden.</p>}
        {!loading && !queryError && (profilesQuery.data?.length || 0) > 0 && !profiles.length && <p className="p-6 text-center text-sm text-gray-500">Geen coureurs gevonden voor “{search}”.</p>}
      </div></div>
    </section>

    <p className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-4 text-sm leading-relaxed text-amber-100"><b>Beheergrenzen:</b> Admin en Super-admin beheren Editors. Alleen Super-admin beheert Admin- en Stewardrollen. Super-adminaccounts zijn beschermd en kunnen hier niet worden aangepast.</p>
  </section>;
}
