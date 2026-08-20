import type { EnduranceStintRow, RaceControlDeltaOp, UpsertEnduranceStintInput } from "../repository/stintsRepository";

export const stintRowToUpsert = (
  stint: EnduranceStintRow,
  patch: Partial<UpsertEnduranceStintInput> = {},
): UpsertEnduranceStintInput => ({
  id: stint.id,
  event_id: stint.event_id,
  team_id: stint.team_id,
  driver_id: stint.driver_id,
  original_start_at: stint.original_start_at,
  original_end_at: stint.original_end_at,
  actual_start_at: stint.actual_start_at,
  actual_end_at: stint.actual_end_at,
  expected_laps: stint.expected_laps,
  fuel_litres: stint.fuel_litres,
  tyre_change: stint.tyre_change,
  double_stint: stint.double_stint,
  notes: stint.notes,
  status: stint.status,
  ...patch,
});

/**
 * Race Control — Fase 3B (optimistic, server-side deltas).
 * De client stuurt nooit meer een absolute eindtijd door; in plaats daarvan
 * stuurt hij per stint een relatieve delta (delay in minuten óf repair in
 * seconden, semantisch onderscheiden) met de expected versie (`updated_at`)
 * die hij uit zijn laatste leesbeurt heeft. De database past de shift toe en
 * weigert een stale write met een expliciete conflict-SQLSTATE.
 */
export const delayedStintDeltas = (
  stints: EnduranceStintRow[],
  currentAt: string,
  minutes: number,
): RaceControlDeltaOp[] => {
  const now = new Date(currentAt).getTime();
  if (!Number.isFinite(now) || !Number.isFinite(minutes) || minutes === 0) return [];

  return stints.flatMap((stint) => {
    const end = new Date(stint.actual_end_at ?? stint.original_end_at).getTime();
    if (end <= now || ["completed", "replaced", "expired"].includes(stint.status)) return [];
    return [{
      stintId: stint.id,
      operation: "delay",
      deltaMinutes: minutes,
      repairSeconds: null,
      replacementDriverId: null,
      effectiveAt: currentAt,
      expectedUpdatedAt: stint.updated_at,
    }];
  });
};

export const repairStintOp = (
  stint: EnduranceStintRow,
  seconds: number,
  effectiveAt: string,
): RaceControlDeltaOp => ({
  stintId: stint.id,
  operation: "repair",
  deltaMinutes: null,
  repairSeconds: seconds,
  replacementDriverId: null,
  effectiveAt,
  expectedUpdatedAt: stint.updated_at,
});

export const completeStintOp = (stint: EnduranceStintRow, effectiveAt: string): RaceControlDeltaOp => ({
  stintId: stint.id,
  operation: "complete",
  deltaMinutes: null,
  repairSeconds: null,
  replacementDriverId: null,
  effectiveAt,
  expectedUpdatedAt: stint.updated_at,
});

export const replaceDriverOp = (stint: EnduranceStintRow, driverId: string): RaceControlDeltaOp => ({
  stintId: stint.id,
  operation: "replace_driver",
  deltaMinutes: null,
  repairSeconds: null,
  replacementDriverId: driverId,
  effectiveAt: null,
  expectedUpdatedAt: stint.updated_at,
});