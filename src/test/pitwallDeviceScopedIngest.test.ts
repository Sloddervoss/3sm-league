import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mig = "supabase/migrations/20260904_pitwall_0403_device_scoped_ingest.sql";
const migPath = existsSync(mig) ? mig : "";

describe("device-scoped telemetry ingest (0.4.3 + device-scoped)", () => {
  it("defines the device-scoped migration at the canonical path", () => {
    expect(migPath).toBeTruthy();
    expect(existsSync(migPath)).toBe(true);
  });

  const src = readFileSync(migPath, "utf8");

  describe("authentication vs routing split", () => {
    it("accepts device-scoped when NO active binding (no not_bound / not_authority hard-reject)", () => {
      // A valid authenticated non-revoked device must be accepted even without a binding.
      expect(src).toContain("revoked_at IS NOT NULL THEN RETURN QUERY SELECT 'revoked'");
      // Routing only activates on a fully active binding condition.
      expect(src).toContain("device_status = 'active_binding'");
      expect(src).toContain("device_role = 'primary'");
      // No active binding => device-scoped NULL routing.
      expect(src).toContain("e := NULL; t := NULL; r := NULL;");
    });

    it("does not hard-reject on not_authority / not_registered for an unbound valid device", () => {
      // Old path returned before storage on missing authority/registration. New device-scoped
      // path must NOT gate acceptance on binding authority.
      expect(src).not.toContain("RETURN QUERY SELECT 'not_authority'");
      expect(src).not.toContain("RETURN QUERY SELECT 'not_registered'");
    });

    it("never invents a team/event/raceRun for unbound telemetry", () => {
      // Routing vars stay NULL; no fake assignment.
      expect(src).toContain("e := NULL; t := NULL; r := NULL;");
      // source_segments / strategy only run when a real route context exists.
      expect(src).toContain("IF e IS NOT NULL THEN");
    });

    it("keeps revoked and invalid-token rejection fail-closed", () => {
      expect(src).toContain("RETURN QUERY SELECT 'revoked'");
      expect(src).toContain("RETURN QUERY SELECT 'invalid_device'");
      expect(src).toContain("auth.role() <> 'service_role'");
    });

    it("stores the latest snapshot device-scoped when unbound (endurance_* NULL)", () => {
      expect(src).toContain("endurance_event_id=excluded.endurance_event_id");
      expect(src).toContain("endurance_team_id=excluded.endurance_team_id");
      expect(src).toContain("race_run_id=excluded.race_run_id");
    });
  });

  describe("0.4.3 interaction", () => {
    it("routes 0.4.3 sampling only through a bound race context", () => {
      // Strategy/segment writes require a non-null routing event (v_bound removed).
      expect(src).not.toContain("v_bound");
      expect(src).toContain("IF e IS NOT NULL THEN");
    });
  });
});