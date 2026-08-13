import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  "supabase/migrations/20260813170000_harden_endurance_iracing_slot_interest.sql",
  "utf8",
);
const rollback = readFileSync(
  "supabase/rollback/20260813170000_harden_endurance_iracing_slot_interest.rollback.sql",
  "utf8",
);

describe("endurance iRacing slot-interest hardening", () => {
  it("weigert een event-slotpaar dat niet bij elkaar hoort", () => {
    expect(migration).toContain("endurance_validate_iracing_slot_interest_link");
    expect(migration).toContain("slot.catalog_event_id = NEW.catalog_event_id");
    expect(migration).toContain("BEFORE INSERT OR UPDATE OF catalog_event_id, catalog_slot_id");
    expect(migration).toContain("ERRCODE = '23514'");
  });

  it("filtert summary en managernamen identiek op actieve eventbronwaarheid", () => {
    expect(migration.match(/JOIN public\.endurance_iracing_event_slots AS slot/g)).toHaveLength(2);
    expect(migration.match(/JOIN public\.endurance_iracing_events AS event/g)).toHaveLength(2);
    expect(migration.match(/AND slot\.active/g)).toHaveLength(2);
    expect(migration.match(/AND event\.active/g)).toHaveLength(2);
    expect(migration).toContain("slot.catalog_event_id = interest.catalog_event_id");
  });

  it("behoudt de privacy- en grantgrenzen", () => {
    expect(migration).toContain("NOT public.is_endurance_manager(auth.uid())");
    expect(migration).toContain("LEFT JOIN public.public_profiles AS profile");
    expect(migration).not.toMatch(/discord_id|iracing_id|avatar_url/);
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.endurance_validate_iracing_slot_interest_link() FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.endurance_iracing_slot_interest_summary() TO authenticated");
  });

  it("rollback verwijdert eerst de trigger en herstelt daarna de eerdere RPC-definities", () => {
    const trigger = rollback.indexOf("DROP TRIGGER IF EXISTS endurance_validate_iracing_slot_interest_link");
    const validator = rollback.indexOf("DROP FUNCTION IF EXISTS public.endurance_validate_iracing_slot_interest_link()");
    const summary = rollback.indexOf("CREATE OR REPLACE FUNCTION public.endurance_iracing_slot_interest_summary()");
    expect(trigger).toBeGreaterThan(-1);
    expect(validator).toBeGreaterThan(trigger);
    expect(summary).toBeGreaterThan(validator);
    expect(rollback).not.toContain("DROP TABLE");
  });
});
