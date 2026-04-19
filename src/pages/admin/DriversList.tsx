import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";

type AdminProfile = {
  user_id: string;
  display_name: string | null;
  iracing_name: string | null;
  iracing_id: number | null;
  irating: number | null;
  safety_rating: string | null;
};

type AdminUserRole = {
  user_id: string;
  role: string;
};

const DriversList = () => {
  const queryClient = useQueryClient();
  const { user: currentUser, isSuperAdmin: currentIsSuperAdmin } = useAuth();

  const { data: profiles, isLoading } = useQuery({
    queryKey: ["admin-all-profiles"],
    queryFn: async (): Promise<AdminProfile[]> => {
      const { data, error } = await supabase.rpc("admin_get_all_profiles");
      if (error) throw error;
      return (data || []) as AdminProfile[];
    },
  });

  const { data: userRoles } = useQuery({
    queryKey: ["admin-user-roles"],
    queryFn: async (): Promise<AdminUserRole[]> => {
      const { data, error } = await supabase.rpc("admin_get_user_roles");
      if (error) throw error;
      return (data || []) as AdminUserRole[];
    },
  });

  const isAdmin = (userId: string) =>
    (userRoles || []).some((r) => r.user_id === userId && r.role === "admin");
  const isSuperAdmin = (userId: string) =>
    (userRoles || []).some((r) => r.user_id === userId && r.role === "super_admin");
  const isStewardRole = (userId: string) =>
    (userRoles || []).some((r) => r.user_id === userId && r.role === "moderator");

  const toggleAdmin = useMutation({
    mutationFn: async ({ userId, grant }: { userId: string; grant: boolean }) => {
      const fn = grant ? "admin_grant_role" : "admin_revoke_role";
      const { error } = await supabase.rpc(fn, { target_user_id: userId, target_role: "admin" });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-user-roles"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleSteward = useMutation({
    mutationFn: async ({ userId, grant }: { userId: string; grant: boolean }) => {
      const fn = grant ? "admin_grant_role" : "admin_revoke_role";
      const { error } = await supabase.rpc(fn, { target_user_id: userId, target_role: "moderator" });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-user-roles"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteDriver = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.rpc("admin_delete_user", { target_user_id: userId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Driver verwijderd");
      queryClient.invalidateQueries({ queryKey: ["admin-all-profiles"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) return <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-14 bg-card rounded-lg animate-pulse" />)}</div>;

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="grid grid-cols-[1fr_8rem_6rem_5rem_6rem_6rem_3rem] gap-3 px-4 py-2.5 bg-secondary/40 text-xs font-bold uppercase tracking-wider text-muted-foreground">
        <span>Driver</span>
        <span>iRacing ID</span>
        <span>iRating</span>
        <span>Safety</span>
        <span>Admin</span>
        <span>Steward</span>
        <span></span>
      </div>
      {profiles?.map((p) => {
        const admin = isAdmin(p.user_id);
        const superAdmin = isSuperAdmin(p.user_id);
        const steward = isStewardRole(p.user_id);
        const isMe = p.user_id === currentUser?.id;
        return (
          <div key={p.user_id} className="grid grid-cols-[1fr_8rem_6rem_5rem_6rem_6rem_3rem] gap-3 px-4 py-3 items-center border-b border-border/40 hover:bg-secondary/20 transition-colors">
            <div>
              <div className="font-heading font-bold text-sm flex items-center gap-2">
                {p.display_name || p.iracing_name || "—"}
                {superAdmin && (
                  <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded" style={{ background: "rgba(250,204,21,0.12)", color: "#facc15", border: "1px solid rgba(250,204,21,0.3)" }}>
                    ★ Super Admin
                  </span>
                )}
              </div>
              {p.iracing_name && p.display_name !== p.iracing_name && (
                <div className="text-xs text-muted-foreground">{p.iracing_name}</div>
              )}
            </div>
            <span className="text-xs font-mono text-muted-foreground">{p.iracing_id || "—"}</span>
            <span className="text-sm font-heading font-bold">{p.irating ? p.irating.toLocaleString() : "—"}</span>
            <span className="text-sm text-muted-foreground">{p.safety_rating || "—"}</span>
            {/* Admin rol */}
            {superAdmin ? (
              <span className="text-xs px-2 py-1 rounded font-bold" style={{ background: "rgba(250,204,21,0.12)", color: "#facc15", border: "1px solid rgba(250,204,21,0.3)" }}>
                Super Admin
              </span>
            ) : currentIsSuperAdmin ? (
              <button
                onClick={() => toggleAdmin.mutate({ userId: p.user_id, grant: !admin })}
                disabled={toggleAdmin.isPending}
                className={`text-xs px-2 py-1 rounded font-bold transition-colors ${admin ? "bg-accent/20 text-accent border border-accent/30 hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/30" : "bg-secondary text-muted-foreground border border-border hover:bg-accent/10 hover:text-accent"}`}
              >
                {admin ? "Admin" : "—"}
              </button>
            ) : (
              <span className={`text-xs px-2 py-1 rounded font-bold ${admin ? "bg-accent/20 text-accent border border-accent/30" : "text-muted-foreground"}`}>
                {admin ? "Admin" : "—"}
              </span>
            )}
            {/* Steward rol */}
            {superAdmin || admin ? (
              <span className="text-xs text-muted-foreground">—</span>
            ) : currentIsSuperAdmin ? (
              <button
                onClick={() => toggleSteward.mutate({ userId: p.user_id, grant: !steward })}
                disabled={toggleSteward.isPending}
                className={`text-xs px-2 py-1 rounded font-bold transition-colors ${steward ? "bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/30" : "bg-secondary text-muted-foreground border border-border hover:bg-blue-500/10 hover:text-blue-400"}`}
              >
                {steward ? "Steward" : "—"}
              </button>
            ) : (
              <span className={`text-xs px-2 py-1 rounded font-bold ${steward ? "bg-blue-500/20 text-blue-400 border border-blue-500/30" : "text-muted-foreground"}`}>
                {steward ? "Steward" : "—"}
              </span>
            )}
            <button
              onClick={() => {
                if (confirm(`Weet je zeker dat je ${p.display_name || p.iracing_name} wilt verwijderen?`)) {
                  deleteDriver.mutate(p.user_id);
                }
              }}
              disabled={deleteDriver.isPending || superAdmin || isMe}
              className="p-1.5 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        );
      })}
      {!profiles?.length && (
        <div className="py-12 text-center text-muted-foreground text-sm">Geen drivers gevonden.</div>
      )}
    </div>
  );
};

export default DriversList;
