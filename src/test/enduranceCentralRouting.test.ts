import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationDir = "supabase/migrations";
const rollbackDir = "supabase/rollback";
const migrationFile = "20260820190000_endurance_central_simhub_routing.sql";
const rollbackFile = "20260820190000_endurance_central_simhub_routing.rollback.sql";
const migrationPath = `${migrationDir}/${migrationFile}`;
const rollbackPath = `${rollbackDir}/${rollbackFile}`;

const sql = (path: string) => readFileSync(path, "utf8");
const compact = (value: string) => value.replace(/\s+/g, " ").toLowerCase();
const ingestBodyOf = (text: string) => {
  const start = text.indexOf("public.simhub_ingest_snapshot(");
  const end = text.indexOf("'accepted'::TEXT, v_now");
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return text.slice(start, end);
};

describe("phase5: central effective SimHub routing + stale-latest reconciliation", () => {
  beforeAll(() => {
    expect(existsSync(migrationPath), "RED: central-routing migration must exist").toBe(true);
    expect(existsSync(rollbackPath), "RED: central-routing rollback must exist").toBe(true);
  });

  it("is an additive successor after the server-gate baseline, with a matching rollback", () => {
    const names = readdirSync(migrationDir).filter((n) => /^2026082018.*_endurance.*\.sql$/.test(n) || n === migrationFile);
    expect(names).toContain(migrationFile);
    expect(rollbackFile.replace(/\.rollback\.sql$/, ".sql")).toBe(migrationFile);
    expect(migrationFile > "20260820180000_endurance_realtime_server_gate.sql").toBe(true);
  });

  it("defines exactly ONE server resolver and routes ingest through it, not inline joins", () => {
    const migration = sql(migrationPath);
    // Single authoritative resolver definition.
    expect(migration.match(/CREATE OR REPLACE FUNCTION public\.simhub_effective_endurance_binding/g)).toHaveLength(1);
    // Combines manual-override AND auto team-membership precedence in that one resolver.
    expect(migration).toContain("endurance_binding_source = 'manual'");
    expect(migration).toContain("FROM public.endurance_team_members AS member");
    expect(migration).toContain("JOIN public.endurance_teams AS team ON team.id = member.team_id");
    // Ingest delegates to the resolver (single call), no local routing copy.
    const ingest = ingestBodyOf(migration);
    expect(ingest).toContain("FROM public.simhub_effective_endurance_binding(v_device.id)");
    expect(ingest).not.toContain("JOIN public.endurance_teams");
    expect(ingest).not.toContain("endurance_binding_source = 'manual'");
  });

  it("is fail-closed: revoked/missing device yields no effective context", () => {
    const migration = sql(migrationPath);
    const resolver = migration.slice(
      migration.indexOf("public.simhub_effective_endurance_binding"),
      migration.indexOf("simhub_reconcile_device_latest"),
    );
    expect(resolver).toContain("device.revoked_at IS NULL");
    expect(resolver).toContain("IF NOT FOUND THEN RETURN; END IF;");
  });

  it("reconciles simhub_telemetry_latest in assign, clear and revoke'', so stale rows can't stay visible", () => {
    const migration = sql(migrationPath);
    expect(migration).toContain("simhub_reconcile_device_latest");
    const reconcile = compact(migration.slice(migration.indexOf("public.simhub_reconcile_device_latest"), migration.indexOf("simhub_reconcile_device_latest") + 900));
    expect(reconcile).toContain("delete from public.simhub_telemetry_latest where device_id");
    // All three lifecycle RPCs must call the reconciler inside their transaction.
    for (const fn of [
      "simhub_assign_device_to_entry(",
      "simhub_clear_device_entry(",
      "simhub_revoke_device(",
    ]) {
      const body = migration.slice(migration.indexOf(fn));
      expect(body).toContain("simhub_reconcile_device_latest");
    }
  });

  it("preserves killswitch: a runtime-disabled ingest returns ingest_disabled and never revokes/deletes the device", () => {
    const migration = sql(migrationPath);
    const ingest = ingestBodyOf(migration);
    expect(ingest).toContain("'ingest_disabled'::TEXT");
    // The ingest_disabled branch must reject with no revoke/delete side effect.
    const afterCapability = ingest.slice(ingest.indexOf("can_ingest_own_device"));
    expect(afterCapability).toContain("ingest_disabled");
    expect(ingest).not.toMatch(/SELECT caps\.can_ingest_own_device[\s\S]{0,200}UPDATE public\.simhub_devices/);
  });

  it("keeps Edge auth matrix + owner list scope and delegates reconciliation to RPCs (no client service key)", () => {
    const edge = sql("supabase/functions/simhub-pair/index.ts");
    // delegating DB mutations to the RPCs (device assignment etc)
    expect(edge).toContain("simhub_assign_device_to_entry");
    expect(edge).toContain('action === "assign"');
    expect(edge).toContain("can_manage_devices");
    // owner-read/list stays scoped to own rows only.
    expect(edge).toContain('action === "list-own"');
    expect(edge).toContain('eq("owner_user_id", user.id)');
    // No client-side service key anywhere.
    const relay = sql("src/lib/centralSimHubRelay.ts");
    expect(relay).not.toContain("SERVICE_ROLE_KEY");
  });

  it("rollback restores replaced resolvers/RPCs and drops the new helper without touching device state", () => {
    const rollback = compact(sql(rollbackPath));
    expect(rollback).toMatch(/\b(create or replace function|drop function if exists)\b/);
    expect(rollback).toContain("simhub_effective_endurance_binding");
    expect(rollback).toContain("simhub_reconcile_device_latest");
    expect(rollback).not.toContain("alter column endurance_");
  });
});