import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

const parityMigration = "supabase/migrations/20260711110000_control_room_super_admin_parity.sql";

describe("Control Room super-admin parity", () => {
  it("keeps the /admin route and canonical action model explicit about independent admin and super-admin access", () => {
    const app = read("src/App.tsx");
    const workspace = read("src/pages/AdminWorkspacePrototype.tsx");
    const legacyAdminPage = read("src/pages/AdminPage.tsx");
    const actions = read("src/features/control-room/actionModel.ts");

    expect(app).toContain('path="/admin"');
    expect(workspace).toContain("if (!isAdmin && !isSuperAdmin)");
    expect(legacyAdminPage).toContain("const { user, isAdmin, isSuperAdmin, loading, rolesLoading } = useAuth();");
    expect(legacyAdminPage).toContain("if (!isAdmin && !isSuperAdmin)");
    expect(actions).toContain('allowedRoles: ["admin", "super_admin"]');
    expect(actions).toContain('allowedRoles: ["super_admin"]');
  });

  it("lets a super-admin use both native and legacy Track Intelligence guards", () => {
    const nativeSync = read("src/features/control-room/track/useTrackIntelligence.ts");
    const legacyPage = read("src/pages/TrackIntelligenceTestPage.tsx");

    expect(nativeSync).toContain("const { user, isAdmin, isSuperAdmin } = useAuth();");
    expect(nativeSync).toContain("const canManageTrackIntelligence = Boolean(user && (isAdmin || isSuperAdmin));");
    expect(nativeSync).toContain("canSync: canManageTrackIntelligence");
    expect(legacyPage).toContain("const { user, isAdmin, isSuperAdmin, loading, rolesLoading } = useAuth();");
    expect(legacyPage).toContain("const canManageTrackIntelligence = Boolean(user && (isAdmin || isSuperAdmin));");
    expect(legacyPage).toContain("enabled: canManageTrackIntelligence");
    expect(legacyPage).toContain("if (!canManageTrackIntelligence)");
  });

  it("extends only Control Room direct-write policies, while preserving moderator and protected-role boundaries", () => {
    const migration = read(parityMigration);

    for (const table of [
      "public.leagues",
      "public.races",
      "public.race_results",
      "public.race_session_results",
      "public.protests",
      "public.penalties",
      "public.points_config",
      "public.teams",
      "public.team_memberships",
      "public.team_creation_requests",
      "public.announcements",
      "storage.objects",
    ]) {
      expect(migration).toContain(table);
    }
    expect(migration).toContain("public.has_role(auth.uid(), 'super_admin')");
    expect(migration).toContain("public.has_role(auth.uid(), 'moderator')");
    expect(migration).not.toContain("ON public.user_roles");
    expect(migration).not.toContain("target_role");
  });
});
