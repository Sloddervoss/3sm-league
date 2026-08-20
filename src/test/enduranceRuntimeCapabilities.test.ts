import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationPath = "supabase/migrations/20260820140000_endurance_runtime_capabilities.sql";
const rollbackPath = "supabase/rollback/20260820140000_endurance_runtime_capabilities.rollback.sql";
const pairing = () => readFileSync("supabase/functions/simhub-pair/index.ts", "utf8");

describe("Endurance runtime capabilities", () => {
  it("ships a new additive forward/rollback pair with alpha-safe defaults", () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(existsSync(rollbackPath)).toBe(true);
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toContain("endurance_runtime_settings");
    expect(sql).toContain("member_access_enabled");
    expect(sql).toContain("member_pairing_enabled");
    expect(sql).toContain("member_ingest_enabled");
    expect(sql).toContain("multi_user_realtime_enabled");
    expect(sql).toContain("simhub_ingest_enabled");
    expect(sql).toContain("DEFAULT false");
    expect(sql).toContain("DEFAULT true");
  });

  it("exposes fail-closed current-user and service-side capability helpers", () => {
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toContain("endurance_current_capabilities");
    expect(sql).toContain("endurance_capabilities_for_user");
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("SET search_path = public, pg_temp");
    expect(sql).toContain("REVOKE ALL ON FUNCTION");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.endurance_current_capabilities() TO authenticated");
    expect(sql).not.toContain("TO anon");
    expect(sql).toContain("'ingest_disabled'::TEXT");
    expect(sql).toContain("endurance_capabilities_for_user(v_device.owner_user_id)");
    expect(sql).not.toContain("OR NOT public.is_endurance_staff(v_device.owner_user_id) THEN");
    expect(sql).toContain("Owners can read own latest SimHub telemetry");
    expect(sql.match(/can_pair_own_device/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps alpha staff behavior and separates owner from manager device actions", () => {
    const source = pairing();
    expect(source).toContain('action === "list-own"');
    expect(source).toContain("endurance_current_capabilities");
    expect(source).toContain("can_pair_own_device");
    expect(source).toContain("can_manage_devices");
    expect(source).toContain("capabilityRpcUnavailable");
    expect(source).toContain('code === "PGRST202"');
    expect(source).toContain("else if (capabilityError) throw capabilityError");
    expect(source).toContain("owner_user_id");
    expect(source).toContain("super_admin_required");
  });

  it("keeps the existing SimHub device, pairing-code and token-hash architecture", () => {
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).not.toContain("CREATE TABLE public.endurance_devices");
    expect(sql).not.toContain("CREATE TABLE public.app_settings");
    const source = pairing();
    expect(source).toContain("simhub_pairing_codes");
    expect(source).toContain("token_hash");
  });

  it("waits for a future member capability before redirecting the route", () => {
    const page = readFileSync("src/features/endurance/shell/EndurancePage.tsx", "utf8");
    expect(page).toContain("capabilitiesPending");
    expect(page).toContain("!legacyStaff && capabilitiesPending");
    expect(page.indexOf("!legacyStaff && capabilitiesPending")).toBeLessThan(page.indexOf("if (!canUseEndurance)"));
  });
});
