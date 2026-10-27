import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * De pitwall-leesfuncties zijn team-scoped.
 *
 * Aanleiding: `is_endurance_staff()` kent tester. Die helper stond als poort in
 * get_pitwall_data(), pitwall_tyre_estimate_v1(), endurance_tyre_state_labels()
 * en pitwall_pit_loss_v1(), waardoor een tester met een zelfgekozen p_team_id
 * elk team kon lezen. Deze tests pinnen de nieuwe poort vast op de migratie-
 * tekst: één predicaat, geen staff-helper meer in het leespad, en een rollback
 * die de oude toestand echt terugzet.
 */

const migrationPath = "supabase/migrations/20261027210000_endurance_pitwall_team_scope.sql";
const rollbackPath = "supabase/rollback/20261027210000_endurance_pitwall_team_scope.rollback.sql";
const migration = readFileSync(migrationPath, "utf8");
const rollback = readFileSync(rollbackPath, "utf8");

/** Alleen uitvoerbare regels: een comment mag het lek wél bij naam noemen. */
const code = (value: string) =>
  value
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

const body = (value: string, start: string, end: string) => {
  const from = value.indexOf(start);
  const to = value.indexOf(end, from);
  return value.slice(from, to);
};

describe("pitwall team-scope — één poort", () => {
  it("voegt een predicaat toe dat beheer en eigen teamleden toelaat", () => {
    expect(migration).toContain("create or replace function public.endurance_pitwall_can_read(p_team_id uuid)");
    expect(migration).toContain("public.is_endurance_manager(auth.uid())");
    expect(migration).toContain("from public.endurance_team_members m");
    expect(migration).toContain("m.team_id = p_team_id");
    expect(migration).toContain("m.user_id = auth.uid()");
    expect(migration).toContain("auth.uid() is not null");
  });

  it("laat de tester-helper niet meer in het leespad toe", () => {
    // De comments noemen het lek bij naam; de code mag de helper niet aanroepen.
    expect(code(migration)).not.toContain("is_endurance_staff");
    expect(code(migration)).toContain("is_endurance_manager");
  });

  it("geeft het predicaat geen rechtstreekse grant aan authenticated", () => {
    // Alleen definitie-functies gebruiken hem; een grant zou er een publieke
    // "mag ik dit team lezen"-probe van maken.
    expect(migration).toContain(
      "revoke all on function public.endurance_pitwall_can_read(uuid) from public, anon, authenticated",
    );
    expect(migration).toContain(
      "grant execute on function public.endurance_pitwall_can_read(uuid) to service_role",
    );
  });
});

describe("pitwall team-scope — de vier leesfuncties", () => {
  it("get_pitwall_data poort op beheer of eigen teamlid", () => {
    const functie = body(migration, "CREATE OR REPLACE FUNCTION public.get_pitwall_data", "'pit_lane_seconds'");
    expect(functie).toContain("v_is_staff := public.is_endurance_manager(v_user_id);");
    expect(functie).toContain("etm.team_id = p_team_id AND etm.user_id = v_user_id");
    expect(functie).toContain("IF NOT v_is_staff AND NOT v_is_team_member THEN");
    // De client leest deze sleutel; hij moet blijven bestaan.
    expect(migration).toContain("'access', CASE WHEN v_is_staff THEN 'staff' ELSE 'team_member' END");
  });

  it("pitwall_tyre_estimate_v1 gebruikt dezelfde poort", () => {
    const functie = body(
      migration,
      "create or replace function public.pitwall_tyre_estimate_v1",
      "revoke all on function public.pitwall_tyre_estimate_v1",
    );
    expect(functie).toContain("public.endurance_pitwall_can_read(p_team_id)");
    expect(functie).toContain("RAISE EXCEPTION 'Permission denied'");
  });

  it("endurance_tyre_state_labels heeft nu zelf een auth-check", () => {
    const functie = body(
      migration,
      "create or replace function public.endurance_tyre_state_labels",
      "revoke all on function public.endurance_tyre_state_labels",
    );
    // Voorheen was dit een kale SQL-functie zonder auth.uid()-check.
    expect(functie).toContain("language plpgsql");
    expect(functie).toContain("public.endurance_pitwall_can_read(p_team_id)");
    expect(functie.toLowerCase()).toContain("raise exception 'permission denied'");
  });

  it("pitwall_pit_loss_v1 heeft nu zelf een auth-check", () => {
    const functie = body(
      migration,
      "create or replace function public.pitwall_pit_loss_v1",
      "revoke all on function public.pitwall_pit_loss_v1",
    );
    expect(functie).toContain("v_user_id := auth.uid();");
    expect(functie).toContain("public.endurance_pitwall_can_read(p_team_id)");
  });

  it("laat de vorm van de payloads ongemoeid", () => {
    // Alleen de poort verandert: de sleutels waar de UI op leunt blijven staan.
    for (const sleutel of [
      "'tyre_estimate'",
      "'pit_loss'",
      "'opponent_trends'",
      "'tyre_samples'",
      "'fuel_samples'",
      "'pace_targets'",
      "'planned_stints'",
    ]) {
      expect(migration).toContain(sleutel);
    }
    expect(migration).toContain("'sigma_pct', v_sigma");
    expect(migration).toContain("'state_labels', COALESCE(v_labels, '[]'::jsonb)");
  });
});

describe("pitwall team-scope — rollback", () => {
  it("zet de staff-poort en de ontbrekende checks terug", () => {
    expect(rollback).toContain("public.is_endurance_staff(v_user_id)");
    expect(rollback).toContain("CREATE OR REPLACE FUNCTION public.get_pitwall_data");
    expect(rollback).toContain("create or replace function public.endurance_tyre_state_labels");
    expect(rollback).toContain("create or replace function public.pitwall_pit_loss_v1");
  });

  it("draait de volgorde niet om: de poort gaat pas weg als de functies hem niet meer noemen", () => {
    const poort = rollback.indexOf("drop function if exists public.endurance_pitwall_can_read(uuid)");
    expect(poort).toBeGreaterThan(0);
    expect(rollback.indexOf("CREATE OR REPLACE FUNCTION public.get_pitwall_data")).toBeLessThan(poort);
    // De teruggezette functies gebruiken de poort niet meer; alleen de drop
    // noemt hem nog. Eén treffer dus, en die staat achteraan.
    expect(rollback.match(/endurance_pitwall_can_read/g) ?? []).toHaveLength(1);
  });
});
