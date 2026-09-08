/** Shared plan clock for the live dashboard and manual race operations. */
export const isCurrentStint = (status: string, start: string, end: string, now: string) =>
  !["completed", "replaced", "expired"].includes(status) &&
  Date.parse(start) <= Date.parse(now) && Date.parse(end) > Date.parse(now);
