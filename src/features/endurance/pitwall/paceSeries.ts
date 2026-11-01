import type { PaceCar, PaceTrace, PaceHistory } from "../../../../supabase/functions/_shared/paceCapture";
import { validatedSectors } from "../../../../supabase/functions/_shared/paceCapture";
import type { V3Normalized } from "./pitwallHelpers";
export type SeriesPoint = {x: number; y: number; marker?: "pit" | "swap"};
export type StoredTrace = PaceTrace;
export const freshPaceHistory = (v3?: V3Normalized | null, history = v3?.paceHistory): PaceHistory | null => {
  if (!history || history.schemaRevision !== 1 || !Array.isArray(history.cars) || history.cars.length > 40 || history.cars.some(c => !c || typeof c.id !== "string" || c.id.length > 64 || c.laps != null && (!Array.isArray(c.laps) || c.laps.length > 20) || c.traces != null && (!Array.isArray(c.traces) || c.traces.length > 3 || c.traces.some(t => !t || !Array.isArray(t.points) || t.points.length > 128 || t.points.some(p => !Array.isArray(p) || p.length !== 3 || !Number.isInteger(p[0]) || p[0] < 0 || p[0] > 127))))) return null;
  if (history.transportSessionId !== v3?.transportSessionId || !Number.isFinite(Date.parse(history.updatedAt)) || Date.now() - Date.parse(history.updatedAt) > 86400000 || Date.parse(history.updatedAt) > Date.now() + 10000) return null;
  return history;
};
export const freshMetrics = (v3: V3Normalized | null | undefined, id: string) => {
  const metric = freshPaceHistory(v3)?.cars.find(c => c.id === id)?.metrics;
  const time = v3?.session?.sessionTimeSeconds;
  return metric && typeof time === "number" && time >= metric.observedSessionTimeSeconds && time - metric.observedSessionTimeSeconds <= 5 ? metric : null;
};
export const rowSectors = (v3: V3Normalized | null | undefined, id: string, last: unknown) => {
  const m = freshMetrics(v3, id);
  const row = v3?.opponents?.find(o=>o.id===id);
  // Source-specific last-lap times can differ (SimHub vs CarIdxLastLapTime).
  // New frames carry the completed lap identity; only old frames need exact time equality.
  const sameLap = m?.sectorLap != null ? row?.lap === m.sectorLap + 1 : m?.lastLapSeconds === last;
  return m && sameLap && m.lapValid !== false ? validatedSectors(m.lastLapSectorSeconds, m.lastLapSeconds, m.sectorCount) : null;
};
/** No guessed three-sector layout. Legacy validated arrays can identify their own count. */
export const trackSectorCount = (v3?: V3Normalized | null): number => {
  const counts = new Set((freshPaceHistory(v3)?.cars ?? []).map(c => freshMetrics(v3,c.id)).filter(m=>m!=null).map(m => m.sectorCount ?? validatedSectors(m.lastLapSectorSeconds,m.lastLapSeconds)?.length).filter((n): n is number => Number.isInteger(n) && n! >= 1 && n! <= 16));
  return counts.size === 1 ? [...counts][0] : 0;
};
export const newestTrace = (car?: PaceCar): StoredTrace | null => {
  const traces = (car?.traces ?? []).filter((t: StoredTrace) => !t.conflict && t.points.length <= 128);
  return [...traces].sort((a,b) => b.lap-a.lap)[0] ?? null;
};
export const completeReference = (car?: PaceCar): StoredTrace | null => {
  return [...(car?.traces ?? [])].filter((t: StoredTrace) => t.complete && !t.conflict && t.points.length === 128 && t.anchorSessionTimeMs != null && t.anchorUncertaintyMs != null && t.anchorUncertaintyMs <= 250)
    .sort((a,b) => b.lap-a.lap)[0] ?? null;
};
export const lapSeries = (car?: PaceCar): SeriesPoint[] => (car?.laps ?? []).slice(-20).filter(l => Number.isFinite(l.seconds) && l.seconds > 0).map(l => ({x: l.lap, y: l.seconds}));
export const speedSeries = (trace: StoredTrace | null): SeriesPoint[] => !trace || trace.conflict || trace.speedUnit !== "km/h" ? [] : trace.points.filter(p => p[2] != null).map(p => ({x: p[0], y: p[2]! / 10}));
/** Same distance bins only. No interpolation over missing bins or guessed anchors. */
export const deltaSeries = (own: StoredTrace | null, reference: StoredTrace | null): [SeriesPoint[], SeriesPoint[]] => {
  if (!own || !reference || own.conflict || reference.conflict || !reference.complete || own.anchorSessionTimeMs == null || reference.anchorSessionTimeMs == null || own.anchorUncertaintyMs == null || own.anchorUncertaintyMs > 250 || reference.anchorUncertaintyMs == null || reference.anchorUncertaintyMs > 250) return [[], []];
  const times = new Map(reference.points.map(p => [p[0], p[1]]));
  const a = own.points.filter(p => p[1] != null && times.get(p[0]) != null).map(p => ({x:p[0], y: ((p[1]! - own.anchorSessionTimeMs!) - (times.get(p[0])! - reference.anchorSessionTimeMs!)) / 1000}));
  return [a, a.map(p => ({x:p.x,y:0}))];
};

export const linePath = (points: SeriesPoint[], x: (v:number)=>number, y: (v:number)=>number, maxGap = Infinity) => {
  let previous: number | null = null;
  return points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y)).map(p => {
    const command = previous == null || p.x - previous > maxGap || p.x <= previous ? "M" : "L";
    previous = p.x;
    return `${command}${x(p.x).toFixed(2)},${y(p.y).toFixed(2)}`;
  }).join(" ");
};
