import type { EnduranceStintRow, UpsertEnduranceStintInput } from "../repository/stintsRepository";

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

const shifted = (iso: string, minutes: number) =>
  new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();

/**
 * Verwerk een raceonderbreking zonder de originele planning te wijzigen:
 * - de actieve stint wordt langer/korter;
 * - alle nog niet begonnen stints schuiven volledig mee;
 * - voltooide stints blijven onaangeraakt.
 */
export const delayedStintUpdates = (
  stints: EnduranceStintRow[],
  currentAt: string,
  minutes: number,
): UpsertEnduranceStintInput[] => {
  const now = new Date(currentAt).getTime();
  if (!Number.isFinite(now) || !Number.isFinite(minutes) || minutes === 0) return [];

  return stints.flatMap((stint) => {
    const start = new Date(stint.actual_start_at ?? stint.original_start_at).getTime();
    const end = new Date(stint.actual_end_at ?? stint.original_end_at).getTime();
    if (end <= now || stint.status === "completed") return [];
    if (start <= now && end > now) {
      const adjustedEnd = shifted(new Date(end).toISOString(), minutes);
      if (new Date(adjustedEnd).getTime() <= now) return [];
      return [stintRowToUpsert(stint, { actual_end_at: adjustedEnd })];
    }
    return [stintRowToUpsert(stint, {
      actual_start_at: shifted(new Date(start).toISOString(), minutes),
      actual_end_at: shifted(new Date(end).toISOString(), minutes),
    })];
  });
};
