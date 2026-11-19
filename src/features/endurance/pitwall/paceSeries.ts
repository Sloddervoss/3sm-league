import type { PaceCar, PaceTrace, PaceHistory } from "../../../../supabase/functions/_shared/paceCapture";
import { validatedSectors } from "../../../../supabase/functions/_shared/paceCapture";
import type { V3Normalized } from "./pitwallHelpers";
import { sectorCountFromHistory } from "./sectorTiming";
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
/**
 * PACE-meting zonder de 5-seconden levendigheidsdrempel.
 *
 * Een afgeronde ronde wordt niet onwaar doordat de volgende poll later komt:
 * de connector stuurt maximaal vier metingen per frame in rotatie, dus een auto
 * wordt met tientallen tegenstanders maar eens per paar seconden bijgewerkt.
 * De drempel hoort bij *live* velden (laatste rondetijd, delta), niet bij een
 * opgeslagen volledige ronde. Alleen de namespace (sessie/segment/transport)
 * blijft hier een harde voorwaarde.
 */
export const persistedMetrics = (v3: V3Normalized | null | undefined, id: string) =>
  freshPaceHistory(v3)?.cars.find(c => c.id === id)?.metrics ?? null;
/**
 * Laatst opgeslagen volledige ronde van een auto.
 *
 * `rowLap` mag al verder zijn dan de ronde in de meting: de metingrotatie
 * loopt achter op de ronde teller, en de reeks blijft de laatst bekende
 * volledige ronde tot een nieuwere reeks hem vervangt. Een rij die *achter*
 * loopt op de meting is geen bewijs en levert niets.
 */
export const completedLap = (
  v3: V3Normalized | null | undefined,
  id: string,
  rowLap?: number | null,
  last?: unknown,
): { seconds: number[]; lap: number | null } | null => {
  const m = persistedMetrics(v3, id);
  if (!m || m.lapValid === false) return null;
  // Een ronde die sneller is dan de beste ronde van dezelfde auto is een
  // reset/tow-artefact, geen afgeronde ronde (zelfde grens als standings).
  if (m.lastLapSeconds != null && m.bestLapSeconds != null && m.lastLapSeconds < m.bestLapSeconds - 0.05) return null;
  // Een meting die na de sessieklok is waargenomen hoort niet bij dit frame;
  // dat is een achtergebleven blok na een sessie-terugwind, geen bewijs.
  const clock = v3?.session?.sessionTimeSeconds;
  if (typeof clock === "number" && Number.isFinite(clock) && m.observedSessionTimeSeconds > clock + 5) return null;
  if (m.sectorLap != null) {
    if (rowLap != null && Number.isInteger(rowLap) && rowLap <= m.sectorLap) return null;
  } else if (m.lastLapSeconds !== last) {
    // Oudere frames zonder ronde-identiteit: alleen exact dezelfde rondetijd.
    return null;
  }
  const seconds = validatedSectors(m.lastLapSectorSeconds, m.lastLapSeconds, m.sectorCount);
  if (!seconds) return null;
  // De ronde-identiteit komt uit de meting. Zonder sectorLap (oudere connector)
  // is de rij één ronde verder dan de afgeronde ronde die exact matcht; is ook
  // de rij onbekend, dan blijft de reeks bruikbaar zonder R-label.
  const lap = m.sectorLap ?? (rowLap != null && Number.isInteger(rowLap) && rowLap > 1 ? rowLap - 1 : null);
  return { seconds, lap };
};
export const rowSectors = (v3: V3Normalized | null | undefined, id: string, last: unknown) => {
  const m = freshMetrics(v3, id);
  const row = v3?.opponents?.find(o=>o.id===id);
  // Source-specific last-lap times can differ (SimHub vs CarIdxLastLapTime).
  // New frames carry the completed lap identity; only old frames need exact time equality.
  const sameLap = m?.sectorLap != null ? row?.lap === m.sectorLap + 1 : m?.lastLapSeconds === last;
  return m && sameLap && m.lapValid !== false ? validatedSectors(m.lastLapSectorSeconds, m.lastLapSeconds, m.sectorCount) : null;
};
/** No guessed three-sector layout. Persisted sector updates also expose their measured count without the 5s metric gate. */
export const trackSectorCount = (v3?: V3Normalized | null): number => {
  const history = freshPaceHistory(v3);
  const viewIds = new Set((v3?.opponents ?? []).map(o => o.id));
  // Alleen auto's die in deze leesweergave staan; een achtergebleven auto uit
  // een oude layout mag het huidige beeld niet van vorm laten veranderen.
  const cars = (history?.cars ?? []).filter(c => viewIds.size === 0 || viewIds.has(c.id));
  const counts = new Set<number>(cars.map(c => persistedMetrics(v3,c.id)).filter(m=>m!=null).map(m => m.sectorCount ?? validatedSectors(m.lastLapSectorSeconds,m.lastLapSeconds)?.length).filter((n): n is number => Number.isInteger(n) && n! >= 1 && n! <= 16));
  const persisted = sectorCountFromHistory(history);
  if (persisted >= 1 && persisted <= 16) counts.add(persisted);
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
