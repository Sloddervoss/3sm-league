import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationDir = "supabase/migrations";
const rollbackDir = "supabase/rollback";
const migrations = readdirSync(migrationDir)
  .filter((name) => /^\d{14}_endurance.*\.sql$/.test(name))
  .sort();
const rollbackFor = (migration: string) =>
  `${rollbackDir}/${migration.replace(/\.sql$/, ".rollback.sql")}`;
const sql = (path: string) => readFileSync(path, "utf8");
const compact = (value: string) => value.replace(/\s+/g, " ").toLowerCase();

const ingest15 =
  "text, text, bigint, timestamptz, text, text, text, jsonb, text, text, text, text, text, text, text";

describe("Endurance rollback source contract", () => {
  it("has one timestamp-matched rollback for every uniquely-versioned forward migration", () => {
    const versions = migrations.map((name) => name.slice(0, 14));
    expect(new Set(versions).size).toBe(versions.length);
    expect(migrations.length).toBeGreaterThan(0);
    for (const migration of migrations) expect(existsSync(rollbackFor(migration))).toBe(true);

    const rollbackNames = readdirSync(rollbackDir)
      .filter((name) => /^\d{14}_endurance.*\.rollback\.sql$/.test(name));
    expect(rollbackNames).toHaveLength(migrations.length);
  });

  it("rejects empty/no-op rollbacks except the explicit enum irreversibility", () => {
    for (const migration of migrations) {
      const rollback = compact(sql(rollbackFor(migration)));
      if (migration.includes("alpha_role_values")) {
        expect(rollback).toContain("cannot remove individual enum values");
        expect(rollback).toContain("non-destructive");
        expect(rollback).toContain("if exists");
        continue;
      }
      expect(rollback).toMatch(/\b(drop|alter|create or replace|revoke)\b/);
      expect(rollback).not.toContain("doe geen wijziging");
      expect(rollback).not.toContain("cannot reconstruct");
    }
  });

  it("restores each ingest predecessor and removes only the exact 15-arg overload", () => {
    const routing = compact(sql(`${rollbackDir}/20260806105000_endurance_ingest_routing.rollback.sql`));
    const staff = compact(sql(`${rollbackDir}/20260806110000_endurance_ingest_staff.rollback.sql`));
    const dateAware = compact(sql(`${rollbackDir}/20260806111000_endurance_date_aware_binding.rollback.sql`));

    expect(routing).toContain(`drop function if exists public.simhub_ingest_snapshot( ${ingest15} )`);
    expect(routing).toContain("create or replace function public.simhub_ingest_snapshot( p_token_hash text");
    expect(routing).toContain("p_telemetry jsonb )");
    expect(staff).toContain("role_record.role = 'super_admin'::public.app_role");
    expect(staff).not.toContain("not public.is_endurance_staff(v_device.owner_user_id)");
    expect(dateAware).toContain("not public.is_endurance_staff(v_device.owner_user_id)");
    expect(dateAware).toContain("v_device.endurance_event_id");
    expect(dateAware).not.toContain("v_eff_event");
  });

  it("orders destructive dependency changes safely", () => {
    const auto = compact(sql(`${rollbackDir}/20260806103000_endurance_auto_binding.rollback.sql`));
    expect(auto.indexOf("create or replace function public.simhub_assign_device_to_entry")).toBeLessThan(
      auto.indexOf("drop column if exists endurance_binding_source"),
    );

    const practice = compact(sql(`${rollbackDir}/20260805120000_endurance_driver_limits_and_practice.rollback.sql`));
    expect(practice.indexOf("drop table if exists public.endurance_practice_laps")).toBeLessThan(
      practice.indexOf("drop table if exists public.endurance_practice_sessions"),
    );

    const schema = compact(sql(`${rollbackDir}/20260804120000_endurance_data_layer.rollback.sql`));
    expect(schema.indexOf("drop table if exists public.endurance_confirmations")).toBeLessThan(
      schema.indexOf("drop table if exists public.endurance_planning_versions"),
    );
    expect(schema.indexOf("drop table if exists public.endurance_team_members")).toBeLessThan(
      schema.indexOf("drop table if exists public.endurance_teams"),
    );
  });
});
