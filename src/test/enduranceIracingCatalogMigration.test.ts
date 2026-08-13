import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migrationPath = `${root}/supabase/migrations/20260813120000_endurance_iracing_event_catalog.sql`;
const rollbackPath = `${root}/supabase/rollback/20260813120000_endurance_iracing_event_catalog.rollback.sql`;
const migration = readFileSync(migrationPath, "utf8").toLowerCase();
const rollback = readFileSync(rollbackPath, "utf8").toLowerCase();
const compact = (text: string) => text.replace(/\s+/g, " ").toLowerCase();

describe("endurance iRacing event catalog migration", () => {
  it("creates only NEW endurance_iracing_* tables and does not touch existing tables/RLS", () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(existsSync(rollbackPath)).toBe(true);

    for (const table of [
      "endurance_iracing_events",
      "endurance_iracing_event_slots",
      "endurance_iracing_sync_runs",
    ]) {
      expect(migration).toContain(`create table public.${table}`);
    }

    // Geen wijziging aan bestaande productie-tabellen als nieuwe schema-objecten.
    const c = compact(migration);
    for (const guarded of ["alter table public.races", "alter table public.teams",
      "alter table public.profiles", "create table public.races", "create table public.teams"]) {
      expect(c).not.toContain(guarded);
    }
  });

  it("adds only the six additive source columns to endurance_events", () => {
    for (const col of [
      "iracing_catalog_event_id", "iracing_catalog_slot_id", "iracing_source_key",
      "iracing_source_hash", "iracing_slot_key", "iracing_imported_at",
    ]) {
      expect(compact(migration)).toContain(`add column ${col}`);
    }
  });

  it("enforces hard uniqueness: one activated event per catalog event and per slot", () => {
    expect(migration).toContain("create unique index endurance_events_one_per_catalog_event");
    expect(migration).toContain("where iracing_catalog_event_id is not null");
    expect(migration).toContain("create unique index endurance_events_one_per_catalog_slot");
    expect(migration).toContain("where iracing_catalog_slot_id is not null");

    // Slot mag per event maar één keer bestaan (idempotente wekelijkse sync).
    expect(migration).toContain(`unique (catalog_event_id, source_slot_key)`);
    expect(migration).toContain(`source_key text not null unique`);
  });

  it("guards the manual/import pairing invariant (both-null or both-filled)", () => {
    expect(migration).toContain("endurance_events_iracing_link_check");
    expect(migration).toContain("both null) óf iracing-import (beide gevuld");
  });

  it("validates the chosen slot belongs to the chosen catalog event", () => {
    expect(migration).toContain("endurance_validate_iracing_link");
    expect(migration).toContain("slot.catalog_event_id = new.iracing_catalog_event_id");
  });

  it("makes activation atomic, manager-only and idempotent (no duplicate local race)", () => {
    // SECURITY DEFINER, vast search_path, geen service-role key in functie.
    expect(migration).toContain("endurance_activate_iracing_slot");
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = pg_catalog, public, auth, pg_temp");
    expect(migration).toContain("is_endurance_manager(v_user_id)");

    // Manager-only + unknown/inactive guards + idempotente hergebruik.
    expect(migration).toContain("alleen endurance_manager of super_admin");
    expect(migration).toContain("onbekend of inactief iracing catalogusevent");
    expect(migration).toContain("where iracing_catalog_slot_id = p_catalog_slot_id");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("where iracing_catalog_event_id = p_catalog_event_id");
    expect(migration).toContain("al een ander timeslot gekozen");

    // Idempotentie: bestaande teruggeven + unique_violation-catch voor parallel.
    expect(migration.indexOf("unique_violation")).toBeGreaterThan(-1);

    // Officiële source-data wordt gelezen uit catalogus, beginwaarheid = sessiestart.
    expect(migration).toContain("v_slot.session_start_at");
    expect(migration).not.toContain("coalesce(v_slot.race_duration_minutes, v_event.duration_minutes, 180)");
    expect(migration).toContain("officiële race-/sessieduur ontbreekt");
    // Primaire bron niet uit browserinput overgenomen.
    expect(migration.indexOf("v_event.name")).toBeGreaterThan(-1);
  });

  it("locks the registration slot server-side for iRacing-import events", () => {
    expect(migration).toContain("endurance_guard_iracing_registration_slot");
    expect(migration).toContain("before insert or update of event_id, slot_id");
    expect(migration).toContain("new.slot_id := v_locked_slot_id");
    expect(migration).toContain("new.slot_id is distinct from v_locked_slot_id");
    expect(migration).toContain("registratie-slot is server-side vergrendeld");
    expect(migration).toContain("inschrijving voor dit officiële iracing-event is gesloten");
    expect(migration).toContain("ondersteunde lokale 3sm-klassemapping");
    expect(migration).toContain("de aanmelddeadline voor dit officiële iracing-event is verstreken");
    expect(migration).toContain("iracing_catalog_slot_id::text");
    expect(migration).toContain("'registration_open'::public.endurance_event_status");
    expect(migration).toContain("'iracing_catalog'");
  });

  it("keeps the browser read-only: SELECT-only staff policies, never INSERT/UPDATE/DELETE", () => {
    // Alleen VIEW-policies op catalogus + syncruns voor geauthenticeerde staff.
    for (const policy of [
      "endurance member catalog event view",
      "endurance member catalog slot view",
      "endurance staff sync run view",
    ]) {
      expect(migration).toContain(`for select to authenticated`);
      expect(migration).toContain(policy.includes("sync run")
        ? `using (public.is_endurance_staff(auth.uid()))`
        : `using (auth.uid() is not null)`);
    }

    // Geen write-policy's aan de browser op de catalogustabellen.
    const c = compact(migration);
    expect(c).not.toContain(`for all to authenticated`);
    expect(c).not.toContain(`for insert to authenticated`);
    expect(c).not.toContain(`for update to authenticated`);
    expect(c).not.toContain(`for delete to authenticated`);

    // Read-rechten expliciet aan authenticated vrijgeven, schrijven niet.
    expect(c).toContain("grant select on public.endurance_iracing_events");
    expect(c).toContain("revoke all on public.endurance_iracing_events");
    expect(c).toContain("from public, anon");
  });

  it("enables RLS on all three new catalog tables", () => {
    for (const table of [
      "endurance_iracing_events", "endurance_iracing_event_slots", "endurance_iracing_sync_runs",
    ]) {
      expect(migration).toContain(`alter table public.${table} enable row level security`);
    }
  });

  it("never exposes secrets/sync-token/service-role keys", () => {
    for (const secret of ["service_role", "endurance_iracing_sync_token", "password",
      "cookie", "members-ng"]) {
      expect(compact(migration)).not.toContain(secret);
    }
  });

  it("rollback removes everything in safe dependency order and touches no existing table", () => {
    const r = compact(rollback);

    // Guard-trigger + activatie-RPC eerst.
    expect(r.indexOf("drop trigger if exists endurance_guard_iracing_registration_slot"))
      .toBeLessThan(r.indexOf("drop table if exists public.endurance_iracing_events"));
    expect(r.indexOf("drop function if exists public.endurance_activate_iracing_slot"))
      .toBeLessThan(r.indexOf("drop table if exists public.endurance_iracing_events"));

    // Additieve kolommen eerst uit endurance_events droppen vóór de tabellen.
    expect(r.indexOf("drop column if exists iracing_catalog_event_id"))
      .toBeLessThan(r.indexOf("drop table if exists public.endurance_iracing_events"));

    // Alleen onze objecten.
    for (const guarded of ["public.races", "public.teams", "public.profiles",
      "endurance_registrations", "endurance_events", "endurance_stints"]) {
      const literal = guarded === "endurance_registrations" || guarded === "endurance_events" || guarded === "endurance_stints"
        ? `drop table if exists public.${guarded}`
        : `public.${guarded}`;
      expect(r).not.toContain(literal);
    }
  });
});
