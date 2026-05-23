import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260523080000_harden_3sr_recalculation_rpc.sql",
);

const collapseSql = (sql: string) => sql.replace(/\s+/g, " ").toLowerCase();

describe("3SR recalculation RPC hardening migration", () => {
  it("keeps authenticated execute for steward/admin UI but adds an explicit role guard inside SECURITY DEFINER RPCs", () => {
    expect(existsSync(migrationPath), "hardening migration must exist").toBe(true);

    const sql = readFileSync(migrationPath, "utf8");
    const normalized = collapseSql(sql);

    expect(normalized).toContain("create or replace function public.recalculate_3sr_for_race(p_race_id uuid)");
    expect(normalized).toContain("create or replace function public.recalculate_3sr_all()");

    for (const role of ["admin", "super_admin", "moderator"]) {
      expect(normalized).toContain(`public.has_role(auth.uid(), '${role}')`);
    }

    expect(normalized).toContain("current_role = 'service_role'");
    expect(normalized).toContain("raise exception 'not allowed to recalculate 3sr'");
    expect(normalized).toContain("revoke all on function public.recalculate_3sr_for_race(uuid) from public");
    expect(normalized).toContain("revoke all on function public.recalculate_3sr_all() from public");
    expect(normalized).toContain("grant execute on function public.recalculate_3sr_for_race(uuid) to authenticated, service_role");
    expect(normalized).toContain("grant execute on function public.recalculate_3sr_all() to authenticated, service_role");
  });
});
