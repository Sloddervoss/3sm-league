import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Praktijkrondes zijn van het eigen team.
 *
 * De policy op endurance_practice_laps keek naar deelname aan het event, dus
 * elke deelnemer las de rondetijden van elke andere deelnemer. Deze tests pinnen
 * vast dat de deelnemerspolicy weg is, dat de nieuwe policy een teampredicaat
 * gebruikt, en dat de rollback de oude (brede) policy terugzet.
 */

const migration = readFileSync(
  "supabase/migrations/20261027211000_endurance_practice_lap_scope.sql",
  "utf8",
);
const rollback = readFileSync(
  "supabase/rollback/20261027211000_endurance_practice_lap_scope.rollback.sql",
  "utf8",
);

const code = (value: string) =>
  value
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

describe("praktijkrondes — eigen team of beheer", () => {
  it("haalt de deelnemerspolicy weg", () => {
    expect(migration).toContain(
      'drop policy if exists "endurance participant practice laps select" on public.endurance_practice_laps',
    );
    // Deelname aan het event is geen grond meer om iemands rondes te lezen.
    expect(code(migration)).not.toContain("endurance_is_participant");
  });

  it("zet er een policy neer die het predicaat gebruikt", () => {
    expect(migration).toContain(
      'create policy "endurance team practice laps select" on public.endurance_practice_laps',
    );
    expect(migration).toContain(
      "using (public.endurance_practice_lap_visible(event_id, session_id, user_id))",
    );
  });

  it("laat het predicaat precies drie groepen toe: eigen ronde, beheer, teamgenoot", () => {
    expect(migration).toContain("p_lap_user_id = auth.uid()");
    expect(migration).toContain("public.is_endurance_manager(auth.uid())");
    expect(migration).toContain("public.endurance_can_manage_roster(p_event_id)");
    // De laprij heeft geen team_id; de sessie weet welk team er reed.
    expect(migration).toContain("join public.endurance_teams t on t.id = ps.team_id");
    expect(migration).toContain("join public.endurance_team_members m on m.team_id = t.id");
    // En een teamgenoot in hetzelfde event.
    expect(migration).toContain("join public.endurance_team_members theirs on theirs.team_id = mine.team_id");
    expect(migration).toContain("theirs.user_id = p_lap_user_id");
    expect(migration).toContain("t.event_id = p_event_id");
  });

  it("laat de beheer-policies staan", () => {
    // Dit versmalt de deelnemerspolicy; het haalt geen beheer weg.
    expect(migration).not.toContain('drop policy if exists "endurance practice laps super admin all"');
    expect(migration).not.toContain('drop policy if exists "endurance event manager laps"');
  });

  it("geeft het predicaat alleen execute aan authenticated", () => {
    expect(migration).toContain(
      "revoke all on function public.endurance_practice_lap_visible(uuid, uuid, uuid) from public, anon",
    );
    expect(migration).toContain(
      "grant execute on function public.endurance_practice_lap_visible(uuid, uuid, uuid) to authenticated",
    );
  });
});

describe("praktijkrondes — rollback", () => {
  it("zet de deelnemerspolicy terug en ruimt het predicaat op", () => {
    expect(rollback).toContain(
      'drop policy if exists "endurance team practice laps select" on public.endurance_practice_laps',
    );
    expect(rollback).toContain(
      'create policy "endurance participant practice laps select" on public.endurance_practice_laps',
    );
    expect(rollback).toContain("public.endurance_is_participant(event_id, auth.uid())");
    expect(rollback).toContain("drop function if exists public.endurance_practice_lap_visible(uuid, uuid, uuid)");
  });
});
