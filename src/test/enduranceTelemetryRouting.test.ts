import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260809153000_endurance_effective_telemetry_routing.sql", "utf8");
const rollback = readFileSync("supabase/rollback/20260809153000_endurance_effective_telemetry_routing.rollback.sql", "utf8");
const relay = readFileSync("src/lib/centralSimHubRelay.ts", "utf8");
const panel = readFileSync("src/features/endurance/race-control/SimHubTelemetryPanel.tsx", "utf8");

describe("effective Endurance telemetry routing", () => {
  it("uses one date-aware server resolver for active-device RLS and context checks", () => {
    expect(migration).toContain("simhub_effective_endurance_binding");
    expect(migration).toContain("endurance_binding_source = 'manual'");
    expect(migration).toContain("event.end_at > v_now");
    expect(migration).toContain("public.is_endurance_staff(device.owner_user_id)");
    expect(migration).toContain("simhub_device_matches_endurance_context(device_id, endurance_event_id, endurance_team_id)");
    expect(migration).toContain("NOT EXISTS (SELECT 1 FROM public.simhub_effective_endurance_binding(device_id))");
  });

  it("exposes least-privilege list/read RPCs with auth, fixed search paths and exact context", () => {
    expect(migration).toContain("simhub_list_effective_endurance_devices");
    expect(migration).toContain("simhub_read_effective_endurance_latest");
    expect(migration.match(/SECURITY DEFINER/g)?.length).toBeGreaterThanOrEqual(5);
    expect(migration.match(/SET search_path = pg_catalog, public, auth, pg_temp/g)?.length).toBeGreaterThanOrEqual(5);
    expect(migration).toContain("auth.uid() IS NULL OR NOT public.can_manage_simhub()");
    expect(migration).toContain("latest.endurance_event_id = p_event_id");
    expect(migration).toContain("latest.endurance_team_id = p_team_id");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.simhub_read_effective_endurance_latest");
  });

  it("never falls back to all devices and always reads with device/event/team", () => {
    expect(panel).not.toContain("listCentralSimHubDevices,");
    expect(panel).not.toContain("const fallback");
    expect(panel).toContain("setDevices(teamBound)");
    expect(panel).toContain("readCentralSimHubTelemetry(selectedDeviceId, eventId, teamId)");
    expect(relay).toContain('supabase.rpc("simhub_list_effective_endurance_devices"');
    expect(relay).toContain('supabase.rpc("simhub_read_effective_endurance_latest"');
    expect(relay).not.toContain('.from("simhub_telemetry_latest")');
  });

  it("rolls policy dependencies back before dropping the shared resolver", () => {
    const dropPolicy = rollback.indexOf('DROP POLICY IF EXISTS "Staff can read active latest SimHub telemetry"');
    const dropReader = rollback.indexOf("DROP FUNCTION IF EXISTS public.simhub_read_effective_endurance_latest");
    const dropResolver = rollback.indexOf("DROP FUNCTION IF EXISTS public.simhub_effective_endurance_binding");
    const recreatePolicy = rollback.indexOf('CREATE POLICY "Staff can read active latest SimHub telemetry"');
    expect(dropPolicy).toBeGreaterThanOrEqual(0);
    expect(dropReader).toBeGreaterThan(dropPolicy);
    expect(dropResolver).toBeGreaterThan(dropReader);
    expect(recreatePolicy).toBeGreaterThan(dropResolver);
  });
});
