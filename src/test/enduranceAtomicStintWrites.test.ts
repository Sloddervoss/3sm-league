import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260809152000_endurance_atomic_stint_replace.sql", "utf8");
const rollback = readFileSync("supabase/rollback/20260809152000_endurance_atomic_stint_replace.rollback.sql", "utf8");
const repository = readFileSync("src/features/endurance/repository/stintsRepository.ts", "utf8");
const planner = readFileSync("src/features/endurance/stints/StintPlanner.tsx", "utf8");
const raceControl = readFileSync("src/features/endurance/race-control/RaceControlPanel.tsx", "utf8");

describe("atomic Endurance stint writes", () => {
  it("defines authenticated SECURITY DEFINER RPCs with a fixed search path", () => {
    expect(migration).toContain("endurance_replace_draft_stints");
    expect(migration).toContain("endurance_apply_stint_updates");
    expect(migration.match(/SECURITY DEFINER/g)).toHaveLength(2);
    expect(migration.match(/SET search_path = pg_catalog, public, auth, pg_temp/g)).toHaveLength(2);
    expect(migration).toContain("public.is_endurance_manager(v_user_id)");
    expect(migration).toContain("v_team.manager_id IS DISTINCT FROM v_user_id");
  });

  it("protects non-draft plans and validates every batch id before writes", () => {
    expect(migration).toContain("status <> 'draft'");
    expect(migration).toContain("A non-draft plan already exists");
    expect(migration).toContain("count(DISTINCT item.id)");
    expect(migration).toContain("Unknown or duplicate stint id");
    expect(migration).toContain("Invalid or overlapping stint payload");
    expect(migration).toContain("tstzrange");
    expect(migration.indexOf("Unknown or duplicate stint id")).toBeLessThan(migration.indexOf("UPDATE public.endurance_stints AS stint"));
  });

  it("routes planner replacement and Race Control delay through awaited RPC mutations", () => {
    expect(repository).toContain('.rpc("endurance_replace_draft_stints"');
    expect(repository).toContain('.rpc("endurance_apply_stint_updates"');
    expect(planner).toContain("await replaceDraft.mutateAsync");
    expect(planner).not.toContain("Promise.all(stints.map");
    expect(raceControl).toContain("await applyBatch.mutateAsync({ teamId, stints: updates })");
    expect(raceControl).not.toContain("Promise.all(updates.map");
  });

  it("has a rollback for both RPCs", () => {
    expect(rollback).toContain("DROP FUNCTION IF EXISTS public.endurance_apply_stint_updates");
    expect(rollback).toContain("DROP FUNCTION IF EXISTS public.endurance_replace_draft_stints");
  });
});
