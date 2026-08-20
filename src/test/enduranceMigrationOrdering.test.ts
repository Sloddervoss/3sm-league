import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const enduranceMigrations = readdirSync("supabase/migrations")
  .filter((name) => name.includes("endurance") && name.endsWith(".sql"))
  .sort();

const versionOf = (name: string) => name.split("_", 1)[0];

describe("endurance migration ordering", () => {
  it("gebruikt unieke Supabase-compatible timestamp-ID's", () => {
    const versions = enduranceMigrations.map(versionOf);
    for (const version of versions) expect(version).toMatch(/^\d{14}$/);
    expect(new Set(versions).size).toBe(versions.length);
  });

  it("commit enumwaarden vóór helpers en bouwt device-routing in dependencyvolgorde", () => {
    const index = (suffix: string) => enduranceMigrations.findIndex((name) => name.endsWith(suffix));
    const ordered = [
      "endurance_alpha_role_values.sql",
      "endurance_alpha_role_helpers.sql",
      "endurance_device_binding.sql",
      "endurance_auto_binding.sql",
      "endurance_role_pairing.sql",
      "endurance_ingest_routing.sql",
      "endurance_ingest_staff.sql",
      "endurance_date_aware_binding.sql",
      "endurance_rls_roles.sql",
      "endurance_realtime_publication.sql",
    ].map(index);

    expect(ordered.every((position) => position >= 0)).toBe(true);
    expect(ordered).toEqual([...ordered].sort((a, b) => a - b));
  });
});
