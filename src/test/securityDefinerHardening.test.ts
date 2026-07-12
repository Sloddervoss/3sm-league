import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260712110000_comprehensive_security_definer_hardening.sql",
);
const artifactMigrationPath = join(
  process.cwd(),
  "supabase/migrations/20260712111500_harden_discord_link_artifacts.sql",
);

const collapseSql = (sql: string) => sql.replace(/\s+/g, " ").toLowerCase();

describe("comprehensive SECURITY DEFINER hardening migration", () => {
  it("pins safe paths and closes PUBLIC/anon execution across the definer surface", () => {
    expect(existsSync(migrationPath), "hardening migration must exist").toBe(true);
    const sql = readFileSync(migrationPath, "utf8");
    const normalized = collapseSql(sql);

    expect(normalized).not.toContain("current_role = 'service_role'");
    expect(normalized).toContain("auth.role() = 'service_role'");

    for (const fn of [
      "discord_link_account(text, text)",
      "discord_claim_token(text)",
      "admin_delete_user(uuid)",
      "admin_get_user_roles()",
      "get_driver_sp(uuid, uuid)",
      "enqueue_discord_sync(uuid, text)",
      "enqueue_discord_sync_from_profile()",
      "enqueue_discord_sync_from_membership()",
      "enqueue_discord_sync_from_user_role()",
      "handle_new_user()",
      "recalculate_3sr_for_race(uuid)",
      "recalculate_3sr_all()",
    ]) {
      expect(normalized).toContain(`revoke all on function public.${fn} from public`);
      expect(normalized).toContain(`revoke all on function public.${fn} from public, anon`);
    }

    const safeSearchPaths = normalized.match(/set search_path = pg_catalog, public/g) ?? [];
    expect(safeSearchPaths.length).toBeGreaterThanOrEqual(12);
    expect(normalized).not.toMatch(/set search_path = public(?:,|\s|$)/);

    expect(normalized).toContain("grant execute on function public.has_role(uuid, public.app_role) to anon, authenticated, service_role");
    expect(normalized).toContain("grant execute on function public.discord_register_race(text, uuid, text) to service_role");
    expect(normalized).toContain("grant execute on function public.discord_link_account(text, text) to service_role");
  });

  it("removes browser access to Discord bearer-code tables", () => {
    expect(existsSync(artifactMigrationPath)).toBe(true);
    const sql = collapseSql(readFileSync(artifactMigrationPath, "utf8"));
    expect(sql).toContain('drop policy if exists "users manage own link codes" on public.discord_link_codes');
    expect(sql).toContain("revoke all on table public.discord_link_codes from anon, authenticated");
    expect(sql).toContain("revoke all on table public.discord_link_tokens from anon, authenticated");
  });

  it("enforces caller identity, scoped access, and atomic Discord claims", () => {
    const normalized = collapseSql(readFileSync(migrationPath, "utf8"));

    expect(normalized).toContain("delete from public.discord_link_codes as code");
    expect(normalized).toContain("returning code.user_id into v_user_id");
    expect(normalized).toContain("update public.discord_link_tokens as token set used = true");
    expect(normalized).toContain("token.used = false");
    expect(normalized).toContain("returning token.discord_id into v_discord_id");
    expect(normalized).not.toContain("select * into v_token");

    for (const guardedFunction of [
      "create or replace function public.discord_claim_token",
      "create or replace function public.admin_delete_user",
      "create or replace function public.admin_get_user_roles",
      "create or replace function public.get_driver_sp",
    ]) {
      const start = normalized.indexOf(guardedFunction);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(normalized.slice(start, start + 1800)).toContain("if auth.uid() is null then");
    }

    expect(normalized).toContain("if p_user_id <> auth.uid() and not (");
    expect(normalized).toContain("revoke all on function public.enqueue_discord_sync(uuid, text) from public, anon, authenticated, service_role");
    expect(normalized).toContain("revoke all on function public.handle_new_user() from public, anon, authenticated, service_role");
  });
});
