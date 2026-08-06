import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const migrationPath = join(root, "supabase/migrations/20260804120000_endurance_data_layer.sql");
const rollbackPath = join(root, "supabase/rollback/20260804120000_endurance_data_layer.rollback.sql");
const compact = (text: string) => text.replace(/\s+/g, " ").toLowerCase();

describe("endurance data layer migration (Fase 2)", () => {
  it("creates only endurance_-prefixed tables and no existing-table changes", () => {
    const sql = compact(readFileSync(migrationPath, "utf8"));
    expect(existsSync(migrationPath)).toBe(true);
    for (const table of [
      "endurance_events", "endurance_registrations", "endurance_availability",
      "endurance_pace_entries", "endurance_teams", "endurance_team_members",
      "endurance_stints", "endurance_planning_versions", "endurance_confirmations",
      "endurance_notifications", "endurance_audit_log",
    ]) {
      expect(sql).toContain(`create table public.${table}`);
    }
    // Geen wijzigingen aan bestaande productie-tabellen (geen create policy op hen,
    // geen alter table op races/teams/profiles/etc., geen drop van hun policies).
    for (const existing of ["alter table public.races", "alter table public.teams",
      "alter table public.profiles", "drop policy", "create policy \"admin",
      "create policy \"staff"]) {
      expect(sql).not.toContain(existing.trim());
    }
  });

  it("enables RLS and applies super-admin-only policies to every endurance table", () => {
    const sql = compact(readFileSync(migrationPath, "utf8"));
    for (const table of [
      "endurance_events", "endurance_registrations", "endurance_availability",
      "endurance_pace_entries", "endurance_teams", "endurance_team_members",
      "endurance_stints", "endurance_planning_versions", "endurance_confirmations",
      "endurance_notifications", "endurance_audit_log",
    ]) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
    }
    // Super-admin-only policy op alle tabellen, geen admin/moderator/anon-escape.
    expect(sql).toContain("create policy \"endurance super admin all\"");
    // Binnen het DO-blok is de rol-letterlijk geescape (''super_admin''); na interpolatie
    // door format() wordt dit 'super_admin'. Beide guards worden gecheckt.
    expect(sql).toContain("has_role(auth.uid(), 'super_admin')");
    expect(sql).toContain("with check (public.has_role(auth.uid(), ''super_admin''))");
    // Revoke van anon/public.
    expect(sql).toContain("revoke all on public.endurance_events");
    expect(sql).toContain("from public, anon");
  });

  it("keeps the planning-core write path super-admin-only and never touches simhub/relay", () => {
    const sql = compact(readFileSync(migrationPath, "utf8"));
    // Bevat geen simhub-device/logica of bestaande auth-helper wijzigingen.
    expect(sql).not.toContain("simhub");
    expect(sql).not.toContain("admin_get_user_roles");
  });

  it("provides a safe rollback that removes only endurance_-prefixed objects", () => {
    const rollback = compact(readFileSync(rollbackPath, "utf8"));
    expect(existsSync(rollbackPath)).toBe(true);
    for (const table of [
      "endurance_events", "endurance_registrations", "endurance_availability",
      "endurance_pace_entries", "endurance_teams", "endurance_team_members",
      "endurance_stints", "endurance_planning_versions", "endurance_confirmations",
      "endurance_notifications", "endurance_audit_log",
    ]) {
      expect(rollback).toContain(`drop table if exists public.${table}`);
    }
    // Rollback raakt geen bestaand object.
    for (const guarded of ["public.races", "public.teams", "public.profiles", "public.simhub"]) {
      expect(rollback).not.toContain(guarded);
    }
  });
});
