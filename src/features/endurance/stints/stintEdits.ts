import type { EnduranceStintRow, UpsertEnduranceStintInput } from "../repository/stintsRepository";

/** Preserve every stored value, including nulls, for a partial planner edit. */
export function stintEditPayload(row: EnduranceStintRow, changes: Partial<UpsertEnduranceStintInput>): UpsertEnduranceStintInput {
  return { id: row.id, event_id: row.event_id, team_id: row.team_id, driver_id: row.driver_id,
    original_start_at: row.original_start_at, original_end_at: row.original_end_at,
    actual_start_at: row.actual_start_at, actual_end_at: row.actual_end_at,
    expected_laps: row.expected_laps, fuel_litres: row.fuel_litres, tyre_change: row.tyre_change,
    double_stint: row.double_stint, notes: row.notes, status: row.status, ...changes };
}
