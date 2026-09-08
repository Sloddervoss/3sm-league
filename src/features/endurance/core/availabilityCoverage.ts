import type { AvailabilityBlock } from "./types";

/** Positive windows must cover the complete stint; explicit exclusions win. */
export function coversAvailability(blocks: AvailabilityBlock[], userId: string, startAt: string, endAt: string): boolean {
  const own = blocks.filter(b => b.userId === userId);
  if (!own.length) return true;
  const start = Date.parse(startAt), end = Date.parse(endAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return false;
  if (own.some(b => ["unavailable", "avoid", "uncertain"].includes(b.type) && Date.parse(b.startAt) < end && Date.parse(b.endAt) > start)) return false;
  const windows = own.filter(b => ["available", "preferred"].includes(b.type)).sort((a,b) => Date.parse(a.startAt)-Date.parse(b.startAt));
  let covered = start;
  for (const b of windows) {
    if (Date.parse(b.startAt) > covered) break;
    covered = Math.max(covered, Date.parse(b.endAt));
    if (covered >= end) return true;
  }
  return false;
}

/** End of the continuous usable window beginning at start; allows shorter stints. */
export function availableUntil(blocks: AvailabilityBlock[], userId: string, start: number, limit: number): number {
  const own = blocks.filter(b => b.userId === userId);
  if (!own.length) return limit;
  let covered = start;
  for (const b of own.filter(b => ["available", "preferred"].includes(b.type)).sort((a,b) => Date.parse(a.startAt)-Date.parse(b.startAt))) {
    if (Date.parse(b.startAt) > covered) break;
    covered = Math.max(covered, Date.parse(b.endAt));
  }
  for (const b of own.filter(b => ["unavailable", "avoid", "uncertain"].includes(b.type))) {
    if (Date.parse(b.endAt) > start && Date.parse(b.startAt) < covered) covered = Math.min(covered, Math.max(start, Date.parse(b.startAt)));
  }
  return Math.min(covered, limit);
}
