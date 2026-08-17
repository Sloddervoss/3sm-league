import { describe, expect, it } from "vitest";
import { enduranceRealtimeBindingsForEvent } from "../features/endurance/repository/useEnduranceRealtime";

describe("endurance realtime bindings", () => {
  it("mapt events/stints/teams op de juiste query keys voor een event", () => {
    const bindings = enduranceRealtimeBindingsForEvent("evt-123");

    const byTable = (table: string) =>
      bindings.find((binding) => binding.table === table);

    // events: invalidateert de lijst én het detail
    expect(byTable("endurance_events")?.queryKeys).toEqual([
      ["endurance", "events"],
      ["endurance", "events", "evt-123"],
    ]);

    // stints: invalidateert het event-scoped stints-query én het overzicht
    expect(byTable("endurance_stints")?.queryKeys).toEqual([
      ["endurance", "stints", "evt-123"],
      ["endurance", "stints", "all"],
    ]);

    // teams & leden: invalidateert de team-workspace (race control)
    expect(byTable("endurance_teams")?.queryKeys).toEqual([
      ["endurance", "teams", "evt-123"],
      ["endurance", "teams", "all"],
    ]);
    expect(byTable("endurance_team_members")?.queryKeys).toEqual([
      ["endurance", "teams", "evt-123"],
      ["endurance", "teams", "all"],
    ]);

    // stint-planner: beschikbaarheid + geplande versies (Versies & bevestiging)
    expect(byTable("endurance_availability")?.queryKeys).toEqual([
      ["endurance", "availability", "evt-123"],
    ]);
    expect(byTable("endurance_planning_versions")?.queryKeys).toEqual([
      ["endurance", "plans", "evt-123"],
    ]);
  });

  it("levert per tabel exact één binding op (geen duplicaten)", () => {
    const bindings = enduranceRealtimeBindingsForEvent("evt-123");
    const tables = bindings.map((binding) => binding.table);
    expect(new Set(tables).size).toBe(tables.length);
  });

  it("bevat alleen geldige endurance-tabellen", () => {
    const allowed = [
      "endurance_events",
      "endurance_stints",
      "endurance_availability",
      "endurance_planning_versions",
      "endurance_teams",
      "endurance_team_members",
    ];
    for (const binding of enduranceRealtimeBindingsForEvent("evt-123")) {
      expect(allowed).toContain(binding.table);
      expect(binding.queryKeys.length).toBeGreaterThan(0);
    }
  });
});
