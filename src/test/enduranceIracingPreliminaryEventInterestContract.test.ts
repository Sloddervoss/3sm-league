import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const migration = readFileSync("supabase/migrations/20260813173000_endurance_iracing_preliminary_event_interest.sql", "utf8");
const rollback = readFileSync("supabase/rollback/20260813173000_endurance_iracing_preliminary_event_interest.rollback.sql", "utf8");

describe("voorlopige iRacing-eventinteresse en manageranimo", () => {
  it("staat eventinteresse alleen toe zolang geen actief tijdslot bekend is", () => {
    expect(migration).toContain("endurance_set_iracing_interest");
    expect(migration).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM public\.endurance_iracing_event_slots AS slot[\s\S]*slot\.active/);
    expect(migration).toContain("Voorlopige eventinteresse is alleen mogelijk voordat tijdsloten bekend zijn");
  });

  it("telt voor managers unieke coureurs over event- en tijdslotinteresse", () => {
    expect(migration).toContain("endurance_iracing_manager_interest_overview");
    expect(migration).toContain("count(DISTINCT combined.user_id)::BIGINT");
    expect(migration).toContain("UNION ALL");
    expect(migration).toContain("public.endurance_iracing_slot_interest");
  });

  it("beschermt manageranimo server-side en retourneert geen identiteiten", () => {
    expect(migration).toContain("NOT public.is_endurance_manager(auth.uid())");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.endurance_iracing_manager_interest_overview() TO authenticated");
    const overview = migration.slice(migration.indexOf("CREATE OR REPLACE FUNCTION public.endurance_iracing_manager_interest_overview"));
    expect(overview).not.toContain("iracing_name");
    expect(overview).not.toContain("display_name");
  });

  it("herstelt bij rollback de inerte eventinteressecontracten", () => {
    expect(rollback).toContain("DROP FUNCTION IF EXISTS public.endurance_iracing_manager_interest_overview()");
    expect(rollback).toContain("REVOKE ALL ON FUNCTION public.endurance_iracing_interest_summary() FROM PUBLIC, anon, authenticated");
    expect(rollback).toContain("REVOKE ALL ON FUNCTION public.endurance_set_iracing_interest(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated");
  });
});
