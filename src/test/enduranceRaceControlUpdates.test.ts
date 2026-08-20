import { describe, expect, it } from "vitest";
import { delayedStintUpdates, stintRowToUpsert } from "../features/endurance/race-control/raceControlUpdates";
import type { EnduranceStintRow } from "../features/endurance/repository/stintsRepository";

const row = (id: string, start: string, end: string, status: EnduranceStintRow["status"] = "ready"): EnduranceStintRow => ({
  id,
  event_id: "event-1",
  team_id: "team-1",
  driver_id: `driver-${id}`,
  original_start_at: start,
  original_end_at: end,
  actual_start_at: start,
  actual_end_at: end,
  expected_laps: 42,
  fuel_litres: 80,
  tyre_change: true,
  double_stint: false,
  notes: "bewaren",
  status,
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
});

describe("Race Control database-updates", () => {
  it("behoudt alle bestaande stintvelden bij een gerichte correctie", () => {
    const input = stintRowToUpsert(row("a", "2026-08-09T12:00:00Z", "2026-08-09T13:00:00Z"), { status: "completed", actual_end_at: "2026-08-09T12:45:00Z" });
    expect(input).toMatchObject({ expected_laps: 42, fuel_litres: 80, tyre_change: true, notes: "bewaren", status: "completed", actual_end_at: "2026-08-09T12:45:00Z" });
  });

  it("verlengt de actieve stint en schuift toekomstige stints, maar raakt het verleden niet", () => {
    const updates = delayedStintUpdates([
      row("past", "2026-08-09T10:00:00Z", "2026-08-09T11:00:00Z", "completed"),
      row("active", "2026-08-09T11:00:00Z", "2026-08-09T12:00:00Z", "in_car"),
      row("future", "2026-08-09T12:00:00Z", "2026-08-09T13:00:00Z"),
    ], "2026-08-09T11:30:00Z", 10);

    expect(updates.map((update) => update.id)).toEqual(["active", "future"]);
    expect(updates[0]).toMatchObject({ actual_start_at: "2026-08-09T11:00:00Z", actual_end_at: "2026-08-09T12:10:00.000Z" });
    expect(updates[1]).toMatchObject({ actual_start_at: "2026-08-09T12:10:00.000Z", actual_end_at: "2026-08-09T13:10:00.000Z" });
  });
});
