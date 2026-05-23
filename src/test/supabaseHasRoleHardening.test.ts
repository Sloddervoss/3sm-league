import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260523120000_harden_has_role_rpc.sql",
);

const collapseSql = (sql: string) => sql.replace(/\s+/g, " ").toLowerCase();

describe("has_role RPC hardening migration", () => {
  it("prevents authenticated users from using has_role as a cross-user role oracle", () => {
    expect(existsSync(migrationPath), "hardening migration must exist").toBe(true);

    const sql = readFileSync(migrationPath, "utf8");
    const normalized = collapseSql(sql);

    expect(normalized).toContain("create or replace function public.has_role(_user_id uuid, _role public.app_role)");
    expect(normalized).toContain("security definer");
    expect(normalized).toContain("set search_path = public, auth");
    expect(normalized).toContain("auth.role() = 'service_role'");
    expect(normalized).toContain("_user_id = auth.uid()");
    expect(normalized).toContain("role in ('admin'::public.app_role, 'super_admin'::public.app_role)");
    expect(normalized).toContain("revoke all on function public.has_role(uuid, public.app_role) from public");
    expect(normalized).toContain("grant execute on function public.has_role(uuid, public.app_role) to authenticated, service_role");
  });
});
