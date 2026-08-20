import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260809150000_endurance_participant_access.sql", "utf8");
const page = readFileSync("src/features/endurance/shell/EndurancePage.tsx", "utf8");
const navbar = readFileSync("src/components/Navbar.tsx", "utf8");
const workspace = readFileSync("src/features/endurance/workspace/RaceWorkspace.tsx", "utf8");

describe("Endurance participant access hardening", () => {
  it("separates discoverable events from private participant data", () => {
    expect(migration).toContain("endurance_can_discover_event");
    expect(migration).toContain("endurance_is_participant");
    expect(migration).toContain("event.visibility = 'open'");
    expect(migration).toContain("event.invited_user_ids");
    expect(migration).toContain('DROP POLICY IF EXISTS "endurance staff view"');
    expect(migration).toContain('CREATE POLICY "endurance participant teams select"');
  });

  it("keeps registration status and notification contents server-protected", () => {
    expect(migration).toContain("trg_endurance_guard_own_registration_update");
    expect(migration).toContain("Registration status transition is manager-only");
    expect(migration).toContain("trg_endurance_guard_own_notification_update");
    expect(migration).toContain("Only notification read state may be changed");
    expect(migration.match(/SECURITY DEFINER/g)?.length).toBeGreaterThanOrEqual(4);
    expect(migration.match(/SET search_path = pg_catalog, public, auth, pg_temp/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("allows authenticated invitees into the route without exposing management", () => {
    expect(page).toContain('if (!user) return <Navigate to="/auth?redirect=/endurance" replace />');
    expect(page).toContain("isSuperAdmin || isEnduranceManager");
    expect(navbar).toContain("const canUseEndurance = Boolean(user)");
    expect(workspace).toContain("await accept.mutateAsync");
    expect(workspace).toContain('role="alert"');
  });
});
