import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const binding = readFileSync("supabase/migrations/20260806_endurance_device_binding.sql", "utf8");
const bindingRollback = readFileSync("supabase/rollback/20260806_endurance_device_binding.rollback.sql", "utf8");
const routing = readFileSync("supabase/migrations/20260806_endurance_ingest_routing.sql", "utf8");
const routingRollback = readFileSync("supabase/rollback/20260806_endurance_ingest_routing.rollback.sql", "utf8");
const ingest = readFileSync("supabase/functions/simhub-ingest/index.ts", "utf8");

describe("endurance device <-> entry binding + ingest routing", () => {
  it("adds nullable device→endurance binding without touching legacy pairing", () => {
    expect(binding).toContain("ADD COLUMN IF NOT EXISTS endurance_event_id UUID");
    expect(binding).toContain("ADD COLUMN IF NOT EXISTS endurance_team_id UUID");
    expect(binding).toContain("simhub_devices_binding_check");
    expect(binding).toContain("(endurance_event_id IS NULL) = (endurance_team_id IS NULL)");
    expect(binding).toContain("simhub_assign_device_to_entry");
    expect(binding).toContain("simhub_clear_device_entry");
    expect(binding).toContain("auth.role() <> 'service_role'");
    expect(binding).toContain("GRANT EXECUTE ON FUNCTION public.simhub_assign_device_to_entry");
    expect(binding).not.toContain("DROP TABLE");
    expect(binding).not.toContain("ALTER COLUMN race_id");
  });

  it("stores identity columns and service_role grants on the latest snapshot", () => {
    expect(routing).toContain("current_driver_id TEXT");
    expect(routing).toContain("current_driver_name TEXT");
    expect(routing).toContain("car_name TEXT");
    expect(routing).toContain("track_name TEXT");
    expect(routing).toContain("endurance_event_id");
    expect(routing).toContain("not_registered");
    expect(routing).toContain("endurance_practice_sessions");
    expect(routing).toContain("ended_at IS NULL");
    expect(routing).toContain("v_lap_time");
    expect(routing).toContain("GRANT EXECUTE ON FUNCTION public.simhub_ingest_snapshot");
  });

  it("keeps endpoint/edge and finish registration fail-closed and service-only", () => {
    expect(ingest).toContain("p_current_driver_id: envelope.race.currentDriverId");
    expect(ingest).toContain("p_car_id: envelope.race.carId");
    expect(ingest).toContain("p_track_name: envelope.race.trackName");
    expect(ingest).toContain("p_driver_id: envelope.race.driverId");
  });

  it("rolls back additively without destroying legacy pairing state", () => {
    expect(bindingRollback).toContain("DROP FUNCTION IF EXISTS public.simhub_assign_device_to_entry");
    expect(bindingRollback).toContain("DROP COLUMN IF EXISTS endurance_event_id");
    expect(routingRollback).toContain("DROP COLUMN IF EXISTS current_driver_id");
    expect(routingRollback).toContain("GRANT EXECUTE ON FUNCTION public.simhub_ingest_snapshot(TEXT, TEXT, BIGINT, TIMESTAMPTZ, TEXT, TEXT, TEXT, JSONB)");
    expect(routingRollback).not.toContain("endurance_event_id = EXCLUDED.endurance_event_id");
  });
});
