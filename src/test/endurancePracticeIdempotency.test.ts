import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260809151000_endurance_practice_lap_identity.sql", "utf8");
const rollback = readFileSync("supabase/rollback/20260809151000_endurance_practice_lap_identity.rollback.sql", "utf8");
const parser = readFileSync("supabase/functions/_shared/simhub.ts", "utf8");

describe("Endurance practice lap idempotency", () => {
  it("uses event/session/device/completedLaps as a monotone source identity", () => {
    expect(migration).toContain("source_session_id text");
    expect(migration).toContain("source_device_id uuid");
    expect(migration).toContain("completed_laps integer");
    expect(migration).toContain("endurance_practice_laps_source_identity_uidx");
    expect(migration).toContain("ON CONFLICT (event_id, source_session_id, source_device_id, completed_laps)");
    expect(migration).toContain("DO NOTHING");
    expect(parser).toContain("completedLaps: numberValue");
  });

  it("checks replay ordering before attempting the practice insert", () => {
    const replayCheck = migration.indexOf("p_sequence <= v_session_sequence");
    const practiceInsert = migration.indexOf("INSERT INTO public.endurance_practice_laps");
    expect(replayCheck).toBeGreaterThan(0);
    expect(practiceInsert).toBeGreaterThan(replayCheck);
  });

  it("restores the preceding ingest function before dropping identity columns", () => {
    const restoreFunction = rollback.indexOf("CREATE OR REPLACE FUNCTION public.simhub_ingest_snapshot");
    const dropColumns = rollback.indexOf("DROP COLUMN IF EXISTS completed_laps");
    expect(restoreFunction).toBeGreaterThan(0);
    expect(dropColumns).toBeGreaterThan(restoreFunction);
    expect(rollback).toContain("DROP INDEX IF EXISTS public.endurance_practice_laps_source_identity_uidx");
  });
});
