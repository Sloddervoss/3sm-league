import { describe, expect, it } from "vitest";
import { completeStintOp, delayedStintDeltas, repairStintOp, replaceDriverOp, stintRowToUpsert } from "../features/endurance/race-control/raceControlUpdates";
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

  it("selecteert actieve+toekomstige stints voor een relatieve delay-delta, met expected versie per stint", () => {
    const rowUpdatedAt = "2026-08-01T00:00:00Z";
    const deltas = delayedStintDeltas([
      row("past", "2026-08-09T10:00:00Z", "2026-08-09T11:00:00Z", "completed"),
      row("replaced", "2026-08-09T11:00:00Z", "2026-08-09T12:00:00Z", "replaced"),
      row("expired", "2026-08-09T11:00:00Z", "2026-08-09T12:00:00Z", "expired"),
      row("active", "2026-08-09T11:00:00Z", "2026-08-09T12:00:00Z", "in_car"),
      row("future", "2026-08-09T12:00:00Z", "2026-08-09T13:00:00Z"),
    ], "2026-08-09T11:30:00Z", 10);

    expect(deltas.map((delta) => delta.stintId)).toEqual(["active", "future"]);
    for (const delta of deltas) {
      expect(delta).toMatchObject({ operation: "delay", deltaMinutes: 10, repairSeconds: null, effectiveAt: "2026-08-09T11:30:00Z", expectedUpdatedAt: rowUpdatedAt });
    }
  });

  it("produceert exact één repair-op met repairSeconds en de expected versie van de actieve stint", () => {
    const active = row("active", "2026-08-09T11:00:00Z", "2026-08-09T12:00:00Z", "in_car");
    const op = repairStintOp(active, 90, "2026-08-09T11:30:00Z");
    expect(op).toEqual({
      stintId: "active",
      operation: "repair",
      deltaMinutes: null,
      repairSeconds: 90,
      replacementDriverId: null,
      effectiveAt: "2026-08-09T11:30:00Z",
      expectedUpdatedAt: "2026-08-01T00:00:00Z",
    });
  });

  it("routeert beëindigen en coureur vervangen als optimistic serveroperaties", () => {
    const active = row("active", "2026-08-09T11:00:00Z", "2026-08-09T12:00:00Z", "in_car");
    expect(completeStintOp(active, "2026-08-09T11:45:00Z")).toMatchObject({
      operation: "complete", effectiveAt: "2026-08-09T11:45:00Z", expectedUpdatedAt: active.updated_at,
    });
    expect(replaceDriverOp(active, "driver-new")).toMatchObject({
      operation: "replace_driver", replacementDriverId: "driver-new", expectedUpdatedAt: active.updated_at,
    });
  });
});