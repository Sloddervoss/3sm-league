import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260712090000_harden_admin_profiles_and_role_writes.sql",
);
const roleRpcPath = join(
  process.cwd(),
  "supabase/migrations/20260601090000_editor_role_and_news_access.sql",
);
const roleReadPolicyPath = join(
  process.cwd(),
  "supabase/migrations/20260522170000_tighten_public_policies.sql",
);
const roleRpcBoundaryPath = join(
  process.cwd(),
  "supabase/migrations/20260712103000_harden_role_rpc_boundary.sql",
);

const collapseSql = (sql: string) => sql.replace(/\s+/g, " ").toLowerCase();

describe("admin profile and role-write hardening migration", () => {
  it("limits the SECURITY DEFINER profile RPC to authenticated admins and super-admins", () => {
    expect(existsSync(migrationPath), "hardening migration must exist").toBe(true);

    const normalized = collapseSql(readFileSync(migrationPath, "utf8"));

    expect(normalized).toContain("drop function if exists public.admin_get_all_profiles()");
    expect(normalized).toContain("create function public.admin_get_all_profiles()");
    expect(normalized).toContain("returns setof public.profiles");
    expect(normalized).toContain("security definer");
    expect(normalized).toContain("set search_path = public, pg_temp");
    expect(normalized).toContain("if auth.uid() is null then");
    expect(normalized).toContain("public.has_role(auth.uid(), 'admin'::public.app_role)");
    expect(normalized).toContain("public.has_role(auth.uid(), 'super_admin'::public.app_role)");
    expect(normalized).toContain("revoke all on function public.admin_get_all_profiles() from public");
    expect(normalized).toContain("revoke all on function public.admin_get_all_profiles() from anon");
    expect(normalized).toContain("revoke all on function public.admin_get_all_profiles() from service_role");
    expect(normalized).toContain("grant execute on function public.admin_get_all_profiles() to authenticated");
  });

  it("removes direct role mutations and exposes one unambiguous hierarchy-enforcing RPC signature", () => {
    const normalized = collapseSql(readFileSync(migrationPath, "utf8"));
    const roleRpc = collapseSql(readFileSync(roleRpcPath, "utf8"));
    const roleReadPolicy = collapseSql(readFileSync(roleReadPolicyPath, "utf8"));
    const roleBoundary = collapseSql(readFileSync(roleRpcBoundaryPath, "utf8"));

    for (const policy of [
      "admins can manage user roles",
      "admins can insert non-super-admin roles",
      "admins can update non-super-admin roles",
      "admins can delete non-super-admin roles",
      "prevent super_admin role deletion",
    ]) {
      expect(normalized).toContain(`drop policy if exists "${policy}" on public.user_roles`);
    }
    expect(normalized).not.toMatch(/create policy.+on public\.user_roles.+for (insert|update|delete|all)/);
    expect(roleBoundary).toContain("revoke insert, update, delete on table public.user_roles from anon, authenticated");
    expect(roleBoundary).toContain("drop function if exists public.admin_grant_role(uuid, public.app_role)");
    expect(roleBoundary).toContain("drop function if exists public.admin_revoke_role(uuid, public.app_role)");
    expect(roleBoundary).toContain("set search_path = pg_catalog, public, pg_temp");
    expect(roleBoundary).toContain("revoke all on function public.admin_grant_role(uuid, text) from public, anon, service_role");
    expect(roleBoundary).toContain("grant execute on function public.admin_grant_role(uuid, text) to authenticated");

    // Keep the legacy exception: admin/super_admin may only grant or revoke editor;
    // all other grants/revocations remain super_admin-only in the RPCs.
    expect(roleRpc).toContain("if target_role = 'editor' then");
    expect(roleRpc).toContain("elsif not public.has_role(auth.uid(), 'super_admin') then");
    expect(roleReadPolicy).toContain('create policy "admins can view all user roles"');
  });
});
