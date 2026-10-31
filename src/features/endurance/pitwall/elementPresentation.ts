import type { PitwallPlannedStint } from "./pitwallHelpers";

export const finiteNonNegative = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;

/** Presentatie-afleiding met expliciete referentie; geen advieswaarde. */
export function lapDifference(last: unknown, reference: unknown): number | null {
  return finiteNonNegative(last) && last > 0 && finiteNonNegative(reference) && reference > 0 ? last - reference : null;
}

/** Deze datums zijn planning, ook wanneer ze actual_* heten. */
export function plannedProgress(stint: PitwallPlannedStint | undefined, nowMs: number) {
  if (!stint || !Number.isFinite(nowMs)) return null;
  const start = Date.parse(stint.actual_start_at ?? stint.original_start_at);
  const end = Date.parse(stint.actual_end_at ?? stint.original_end_at);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return { elapsed: Math.max(0, (nowMs - start) / 1000), remaining: Math.max(0, (end - nowMs) / 1000), percent: Math.max(0, Math.min(100, (nowMs - start) / (end - start) * 100)) };
}
