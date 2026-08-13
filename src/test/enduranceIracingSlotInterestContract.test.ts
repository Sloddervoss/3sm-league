import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  "supabase/migrations/20260813163000_endurance_iracing_slot_interest.sql",
  "utf8",
);
const rollback = readFileSync(
  "supabase/rollback/20260813163000_endurance_iracing_slot_interest.rollback.sql",
  "utf8",
);

describe("endurance iRacing timeslot-interest migration contract", () => {
  it("slaat meerdere slotkeuzes per gebruiker op maar nooit dubbel binnen hetzelfde slot", () => {
    expect(migration).toContain("CREATE TABLE public.endurance_iracing_slot_interest");
    expect(migration).toContain("catalog_event_id UUID NOT NULL");
    expect(migration).toContain("catalog_slot_id UUID NOT NULL");
    expect(migration).toContain("UNIQUE (catalog_slot_id, user_id)");
    expect(migration).not.toContain("UNIQUE (catalog_event_id, user_id)");
  });

  it("geeft leden alleen aggregaten en hun eigen keuze", () => {
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(migration).toMatch(/FOR SELECT TO authenticated\s+USING \(auth\.uid\(\) = user_id\)/);
    expect(migration).not.toMatch(/FOR (INSERT|UPDATE|DELETE|ALL) TO authenticated/);
    expect(migration).toContain("endurance_iracing_slot_interest_summary()");
    expect(migration).toContain("bool_or(interest.user_id = auth.uid())");
    expect(migration).toContain("REVOKE ALL ON public.endurance_iracing_slot_interest FROM PUBLIC, anon, authenticated");
  });

  it("laat uitsluitend de eigen gebruiker een actief, bestaand slot toggelen", () => {
    expect(migration).toContain("v_user_id UUID := auth.uid()");
    expect(migration).toMatch(/WHERE slot\.id = p_catalog_slot_id\s+AND slot\.active\s+AND event\.active/s);
    expect(migration).toContain("Onbekend of inactief iRacing-timeslot");
    expect(migration).toContain("ON CONFLICT (catalog_slot_id, user_id) DO NOTHING");
    expect(migration).not.toMatch(/endurance_set_iracing_slot_interest\([^)]*user_id/i);
  });

  it("beschermt namen server-side en exposeert alleen veilige profielvelden", () => {
    expect(migration).toContain("NOT public.is_endurance_manager(auth.uid())");
    expect(migration).toContain("LEFT JOIN public.public_profiles AS profile");
    expect(migration).toMatch(/RETURNS TABLE \(\s*catalog_slot_id UUID,\s*user_id UUID,\s*iracing_name TEXT,\s*display_name TEXT/s);
    expect(migration).not.toMatch(/discord_id|iracing_id|avatar_url/);
  });

  it("migreert legacy-interesse uitsluitend bij een gekozen of exact één actief slot", () => {
    expect(migration).toContain("local_event.iracing_catalog_slot_id");
    expect(migration).toContain("CASE WHEN count(*) = 1");
    expect(migration).toContain("WHERE catalog_slot_id IS NOT NULL");
    expect(migration).not.toMatch(/DELETE FROM public\.endurance_iracing_event_interest/);
    expect(migration).toContain("REVOKE EXECUTE ON FUNCTION public.endurance_iracing_interest_summary() FROM authenticated");
  });

  it("rollback herstelt de oude grants voordat de nieuwe objecten verdwijnen", () => {
    const restore = rollback.indexOf("GRANT EXECUTE ON FUNCTION public.endurance_iracing_interest_summary()");
    const members = rollback.indexOf("DROP FUNCTION IF EXISTS public.endurance_iracing_slot_interest_members");
    const table = rollback.indexOf("DROP TABLE IF EXISTS public.endurance_iracing_slot_interest");
    expect(restore).toBeGreaterThan(-1);
    expect(members).toBeGreaterThan(restore);
    expect(table).toBeGreaterThan(members);
  });
});
