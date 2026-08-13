import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

// De forward-only migratie en de rollback zijn het te toetsen contract: ze
// leggen de DB-kant van pre-activatie-interesse + event-specifieke toegestane
// auto's vast. Deze test leest de SQL-bestanden en bewaakt de veiligheids- en
// consistentie-eisen zodat een latere wijziging ze niet stilletjes verzwakt.
const MIGRATION_NAME = "20260813143000_endurance_iracing_event_interest_and_allowed_cars.sql";
const ROLLBACK_NAME = "20260813143000_endurance_iracing_event_interest_and_allowed_cars.rollback.sql";
const migrationFiles = readdirSync("supabase/migrations");
const rollbackFiles = readdirSync("supabase/rollback");
const migration = readFileSync(`supabase/migrations/${MIGRATION_NAME}`, "utf8");
const rollback = readFileSync(
  "supabase/rollback/20260813143000_endurance_iracing_event_interest_and_allowed_cars.rollback.sql",
  "utf8",
);

describe("endurance iRacing interest + allowed cars migration contract", () => {
  it("loopt na 20260813120000 en is forward-only (timestamp >= 20260813143000)", () => {
    expect(migrationFiles).toContain(MIGRATION_NAME);
    expect(rollbackFiles).toContain(ROLLBACK_NAME);
    expect(MIGRATION_NAME).toBeTruthy();
    // Lexicografische sortering van bestandsnamen = de migratievolgorde; deze
    // migratie volgt direct op de basis-migratie 20260813120000.
    expect(MIGRATION_NAME.localeCompare("20260813120000_endurance_iracing_event_catalog.sql")).toBeGreaterThan(0);
    const sortedSinceBase = migrationFiles
      .filter((name) => name >= "20260813120000")
      .sort();
    const baseIdx = sortedSinceBase.findIndex((name) => name === "20260813120000_endurance_iracing_event_catalog.sql");
    const thisIdx = sortedSinceBase.findIndex((name) => name === MIGRATION_NAME);
    expect(baseIdx).toBeGreaterThanOrEqual(0);
    expect(thisIdx).toBeGreaterThan(baseIdx);
    // Forward-only: géén destructieve DDL op bestaande objecten; de enige DROP
    // is `DROP TRIGGER IF EXISTS` als idempotente trigger-creatie.
    expect(migration).not.toMatch(/DROP TABLE|DROP COLUMN|DROP FUNCTION|DROP TYPE/);
    expect(migration).not.toMatch(/ALTER TABLE[^;]*\bDROP\b/s);
  });

  it("interesse-tabel is uniek per event+user en exposeert geen identiteiten", () => {
    expect(migration).toMatch(/CREATE TABLE public\.endurance_iracing_event_interest\s*\(/);
    expect(migration).toContain("catalog_event_id UUID NOT NULL");
    expect(migration).toContain("user_id UUID NOT NULL");
    expect(migration).toContain("UNIQUE (catalog_event_id, user_id)");
    // RLS ingeschakeld + alleen eigen-rij SELECT; géén INSERT/UPDATE/DELETE-policy.
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(migration).toMatch(/FOR SELECT TO authenticated\s+USING \(auth\.uid\(\) = user_id\)/);
    expect(migration).not.toMatch(/FOR (INSERT|UPDATE|DELETE|ALL) TO authenticated/);
    // Browser krijgt géén directe grant op de tabel (alles via RPC's).
    expect(migration).toMatch(/REVOKE ALL ON public\.endurance_iracing_event_interest FROM PUBLIC, anon, authenticated/);
  });

  it("geaggregeerde summary retourneert counts + self-flag, nooit identiteiten", () => {
    expect(migration).toMatch(/FUNCTION public\.endurance_iracing_interest_summary\(\)/);
    expect(migration).toMatch(/RETURNS TABLE \(\s*catalog_event_id UUID,\s*interested_count BIGINT,\s*is_current_user_interested BOOLEAN\s*\)/s);
    expect(migration).toMatch(/SECURITY DEFINER/);
    expect(migration).toMatch(/SET search_path = pg_catalog, public, auth, pg_temp/);
    // Gebruikt auth.uid() voor de self-flag; exposeert nooit user_id naar buiten.
    expect(migration).toContain("bool_or(interest.user_id = auth.uid())");
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.endurance_iracing_interest_summary\(\) FROM PUBLIC, anon;/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.endurance_iracing_interest_summary\(\) TO authenticated/);
  });

  it("set-interest RPC gebruikt uitsluitend auth.uid() en is authenticated SECURITY DEFINER", () => {
    expect(migration).toMatch(/FUNCTION public\.endurance_set_iracing_interest\(\s*p_catalog_event_id UUID,\s*p_interested BOOLEAN\s*\)/s);
    expect(migration).toMatch(/SECURITY DEFINER/);
    expect(migration).toMatch(/SET search_path = pg_catalog, public, auth, pg_temp/);
    // Geen user_id-parameter: de client kan nooit een ander profiel interesseren.
    expect(migration).not.toMatch(/endurance_set_iracing_interest\([^)]*user_id/i);
    expect(migration).toContain("v_user_id UUID := auth.uid()");
    expect(migration).toContain("ON CONFLICT (catalog_event_id, user_id) DO NOTHING");
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.endurance_set_iracing_interest\(UUID, BOOLEAN\) TO authenticated/);
  });

  it("voegt local_car_ids en allowed_car_ids toe en kopieert de toegestane auto's bij activatie", () => {
    expect(migration).toMatch(/ALTER TABLE public\.endurance_iracing_events\s+ADD COLUMN local_car_ids TEXT\[\] NOT NULL DEFAULT '\{\}'/);
    expect(migration).toMatch(/ALTER TABLE public\.endurance_events\s+ADD COLUMN allowed_car_ids TEXT\[\];/);
    // Activatie vereist niet-lege geldige lokale automapping...
    expect(migration).toContain("cardinality(v_event.local_car_ids)");
    expect(migration).toContain("v_event.local_car_ids <@ ARRAY[");
    expect(migration).toContain("Lokale 3SM-auto- en klassemapping zijn onderling niet consistent");
    expect(migration).toContain("Niet iedere lokale 3SM-klasse heeft een toegestane auto");
    expect(migration).toContain("Niet iedere officieel beschikbare auto heeft een gecontroleerde lokale 3SM-mapping");
    expect(migration).toContain("jsonb_array_elements(COALESCE(v_event.cars, '[]'::JSONB))");
    // ...inclusief legacy Portimão HPD/GT1/GT2 auto-IDs.
    for (const id of ["hpd-arx-01c", "chevrolet-corvette-c6r", "aston-martin-dbr9-gt1", "ford-gt-gt2-gt3"]) {
      expect(migration).toContain(id);
    }
    // ...en kopieert de lokale automapping naar allowed_car_ids op het event.
    expect(migration).toContain("allowed_car_ids");
    expect(migration).toContain("v_event.local_car_ids");
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.endurance_activate_iracing_slot\(/);
    expect(migration).toMatch(/RETURNS UUID\s+LANGUAGE plpgsql\s+SECURITY DEFINER/s);
  });

  it("guard-trigger weigert preferred_car_id buiten allowed_car_ids enkel voor iRacing events", () => {
    expect(migration).toMatch(/FUNCTION public\.endurance_guard_iracing_registration_car\(\)/);
    expect(migration).toMatch(/RETURNS TRIGGER/);
    expect(migration).toMatch(/CREATE TRIGGER endurance_guard_iracing_registration_car\s+BEFORE INSERT OR UPDATE OF event_id, class_preference, preferred_car_id\s+ON public\.endurance_registrations/s);
    // Alleen iRacing-importevents bewaakt; handmatige events ongemoeid.
    expect(migration).toContain("e.iracing_catalog_event_id IS NOT NULL");
    expect(migration).toContain("COALESCE(v_allowed_car_ids, '{}') @> ARRAY[NEW.preferred_car_id]");
    // NULL preferred_car_id blijft toegestaan (bestaande flow).
    expect(migration).toContain("NEW.preferred_car_id IS NOT NULL");
    expect(migration).toContain("Gekozen auto hoort niet bij de gekozen klasse");
  });

  it("rollback verwijdert in omgekeerde afhankelijkheidsvolgorde", () => {
    // Anchor op de feitelijke DROP-statements (niet op de kop-commentaar die
    // ook de bestandsnamen noemt).
    const triggerPos = rollback.indexOf("DROP FUNCTION IF EXISTS public.endurance_guard_iracing_registration_car()");
    const summaryPos = rollback.indexOf("DROP FUNCTION IF EXISTS public.endurance_iracing_interest_summary()");
    const setPos = rollback.indexOf("DROP FUNCTION IF EXISTS public.endurance_set_iracing_interest");
    const tablePos = rollback.indexOf("DROP TABLE IF EXISTS public.endurance_iracing_event_interest");
    const allowedPos = rollback.indexOf("DROP COLUMN IF EXISTS allowed_car_ids");
    const localPos = rollback.indexOf("DROP COLUMN IF EXISTS local_car_ids");
    expect(triggerPos).toBeGreaterThan(-1);
    expect(summaryPos).toBeGreaterThan(-1);
    expect(setPos).toBeGreaterThan(-1);
    expect(tablePos).toBeGreaterThan(-1);
    expect(allowedPos).toBeGreaterThan(-1);
    expect(localPos).toBeGreaterThan(-1);
    // Guard-trigger/functie + RPC's voor de interesse-tabel; kolomdrops als laatste.
    expect(triggerPos).toBeLessThan(summaryPos);
    expect(summaryPos).toBeLessThan(setPos);
    expect(setPos).toBeLessThan(tablePos);
    expect(tablePos).toBeLessThan(allowedPos);
    expect(allowedPos).toBeLessThan(localPos);
    // Rollback herstelt de activatie-RPC naar de vorm zonder allowed_car_ids-kopie.
    expect(rollback).toMatch(/CREATE OR REPLACE FUNCTION public\.endurance_activate_iracing_slot\(/);
    expect(rollback).toMatch(/DROP TABLE IF EXISTS public\.endurance_iracing_event_interest/);
  });
});
