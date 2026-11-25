import type { FuelExample } from "./fuelCandidate";

/** This envelope is created by the restricted SQL worker RPC, never by a browser. */
export interface VisibleFuelRevision {
  id: string;
  owner: string;
  device: string;
  policyVersion: number;
  knownAt: number;
  /** Release-time boundary, not a timestamp supplied by the device. */
  collectionStartedAt: number;
  allowed: boolean;
  superseded: boolean;
  payload: Record<string, unknown>;
}
export interface QualifiedFuelObservation {
  revision: string;
  owner: string;
  device: string;
  policyVersion: number;
  context: string;
  scope: { driver: string; car: string; track: number; layout: string };
  session: string;
  lap: number;
  startedAt: number;
  endedAt: number;
  knownAt: number;
  usedLitres: number;
  /** Sessiesoort zoals de connector hem meldde; leeg als de bron hem niet kent. */
  sessionType?: string;
}
export interface ProspectiveFuelForecast {
  id: string;
  owner: string;
  device: string;
  policyVersion: number;
  context: string;
  session: string;
  sessionStartedAt: number;
  targetLap: number;
  knownAt: number;
  previousLitres: number;
  baselineSamples: number[];
}
const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 120 && v.trim() === v;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
function instant(v: unknown): number {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v) ? Date.parse(v) : NaN;
}

/** Old P1 revisions stay immutable/non-training. This is a separate prospective qualification. */
export function qualifyFuelRevision(source: VisibleFuelRevision): QualifiedFuelObservation | null {
  if (!source.allowed || source.superseded || !uuid(source.id) || !uuid(source.owner) || !uuid(source.device)
    || !Number.isSafeInteger(source.policyVersion) || source.policyVersion < 1
    || !Number.isFinite(source.knownAt) || !Number.isFinite(source.collectionStartedAt)) return null;
  const p = source.payload;
  const o = p.observation;
  if (!object(o) || o.version !== 2 || !object(o.capture) || !object(o.interval)
    || !object(o.context) || !object(o.fuelQuality)) return null;
  const q = o.fuelQuality, c = o.context, cov = o.interval;
  if (o.capture.deviceId !== source.device || q.pitRoad !== false || q.refuel !== false
    || q.resetOrTow !== false || q.driverChanged !== false || !text(q.driverId)
    || p.complete !== true) return null;
  // v2 fuelQuality is the required sampled evidence. The legacy optional
  // bookkeeping columns can be NULL/omitted in a legitimate serialized lap
  // (P1 strips SQL NULLs); their absence is not a negative observation.
  // If supplied, they may never contradict the explicit v2 evidence.
  if (("pit_lap" in p && p.pit_lap !== false)
    || ("driver_changed" in p && p.driver_changed !== false)
    || ("invalid_reasons" in p && (!Array.isArray(p.invalid_reasons) || p.invalid_reasons.length !== 0))
    || ("fuel_added_litres_observed" in p && p.fuel_added_litres_observed !== 0)) return null;
  if (!finite(cov.samples) || !Number.isSafeInteger(cov.samples) || cov.samples < 2
    || !finite(cov.maxGapSeconds) || cov.maxGapSeconds < 0 || cov.maxGapSeconds > 1
    || !finite(cov.unknownSeconds) || cov.unknownSeconds < 0 || cov.unknownSeconds > 1
    || !finite(cov.edgeBeforeSeconds) || cov.edgeBeforeSeconds < 0 || cov.edgeBeforeSeconds > 1
    || !finite(cov.edgeAfterSeconds) || cov.edgeAfterSeconds < 0 || cov.edgeAfterSeconds > 1) return null;
  if (!text(c.carId) || !finite(c.trackId) || !Number.isSafeInteger(c.trackId) || c.trackId < 0
    || !text(c.trackConfig) || !finite(c.sessionUniqueId) || !Number.isSafeInteger(c.sessionUniqueId)
    || c.sessionUniqueId < 0 || !finite(c.sessionNumber) || !Number.isSafeInteger(c.sessionNumber) || c.sessionNumber < 0
    || !finite(p.lap_number) || !Number.isSafeInteger(p.lap_number) || p.lap_number < 1) return null;
  const start = instant(p.started_at), end = instant(p.ended_at);
  // Millisecond conversion is deliberately conservative; no sub-ms causal boundary is certified.
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < source.collectionStartedAt + 1
    || end <= start || end - start > 30 * 60 * 1000 || end > source.knownAt
    || source.knownAt - end > 5 * 60 * 1000) return null;
  if (!finite(p.fuel_start_litres) || !finite(p.fuel_end_litres)) return null;
  const used = p.fuel_start_litres - p.fuel_end_litres;
  if (used < 0.2 || used > 15) return null;
  const scope = { driver: q.driverId, car: c.carId, track: c.trackId, layout: c.trackConfig };
  return {
    revision: source.id, owner: source.owner, device: source.device, policyVersion: source.policyVersion,
    context: JSON.stringify([source.owner, source.device, scope.driver, scope.car, scope.track, scope.layout]),
    scope, session: JSON.stringify([c.sessionUniqueId, c.sessionNumber]), lap: p.lap_number,
    startedAt: start, endedAt: end, knownAt: source.knownAt, usedLitres: used,
  };
}

/** A completed lap arrives after the next has begun: target the following FULL lap, not that in-progress lap. */
export const FUEL_FORECAST_LAP_OFFSET = 2;

/** Label only an already committed forecast for the exact future lap/context/owner. */
export function labelFuelForecast(forecast: ProspectiveFuelForecast, label: QualifiedFuelObservation): FuelExample | null {
  if (!uuid(forecast.id) || forecast.owner !== label.owner || forecast.device !== label.device
    || forecast.policyVersion !== label.policyVersion || forecast.context !== label.context
    || forecast.session !== label.session || forecast.targetLap !== label.lap
    || !Number.isFinite(forecast.sessionStartedAt) || !Number.isFinite(forecast.knownAt)
    || forecast.sessionStartedAt > forecast.knownAt || forecast.knownAt + 1 >= label.startedAt
    || !finite(forecast.previousLitres) || forecast.previousLitres < 0.2 || forecast.previousLitres > 15
    || !Array.isArray(forecast.baselineSamples) || forecast.baselineSamples.length < 3
    || forecast.baselineSamples.length > 20 || !forecast.baselineSamples.every(v => finite(v) && v >= 0.2 && v <= 15)) return null;
  return {
    id: forecast.id, owner: label.owner, context: label.context, session: label.session,
    sessionStartedAt: forecast.sessionStartedAt, featureKnownAt: forecast.knownAt,
    targetStartedAt: label.startedAt, labelKnownAt: label.knownAt,
    previousLitres: forecast.previousLitres, usedLitres: label.usedLitres,
    baselineSamples: [...forecast.baselineSamples], qualified: true,
  };
}
