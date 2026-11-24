import type { QualifiedFuelObservation } from "./fuelEvidence";

/**
 * Server-derived fuel facts for one stored lap aggregate.
 *
 * The restricted SQL worker function (`fuel_worker_server_source`) resolves
 * these from the same lap row the connector delivered, plus the identity that
 * `simhub_persist_v3` wrote for the same transport session. It returns NULL the
 * moment a fact is missing, so this mapping only has to refuse anything a
 * tampered or partial answer could still contain.
 */
export interface ServerFuelFacts {
  id: unknown;
  owner: unknown;
  device: unknown;
  policyVersion: unknown;
  knownAt: unknown;
  collectionStartedAt: unknown;
  allowed: unknown;
  superseded: unknown;
  driver: unknown;
  car: unknown;
  track: unknown;
  layout: unknown;
  sessionKey: unknown;
  lap: unknown;
  startedAt: unknown;
  endedAt: unknown;
  samples: unknown;
  maxGapSeconds: unknown;
  validDurationSeconds: unknown;
  lapDurationSeconds: unknown;
  fuelStartLitres: unknown;
  fuelEndLitres: unknown;
}

const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const integral = (v: unknown): v is number => finite(v) && Number.isInteger(v);
const label = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= 120 && v.trim() === v;
const key = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= 200 && v.trim() === v;

/**
 * Same upper bound as the client qualifier: a lap can never be longer than 30
 * minutes and its label may never arrive more than five minutes late.
 */
const MAX_LAP_MILLISECONDS = 30 * 60 * 1000;
const MAX_LABEL_DELAY_MILLISECONDS = 5 * 60 * 1000;
const MIN_COVERAGE_FRACTION = 0.98;

export function qualifyServerFacts(facts: ServerFuelFacts | null): QualifiedFuelObservation | null {
  if (facts === null || typeof facts !== "object") return null;
  if (facts.allowed !== true || facts.superseded !== false) return null;
  if (!uuid(facts.id) || !uuid(facts.owner)) return null;
  // A device id is a connector string (hostname or uuid) in the existing contract.
  if (typeof facts.device !== "string" || facts.device.length === 0 || facts.device.length > 120) return null;
  if (!integral(facts.policyVersion) || (facts.policyVersion as number) < 1) return null;
  if (!finite(facts.knownAt) || !finite(facts.collectionStartedAt)) return null;
  if (!label(facts.driver) || !label(facts.car) || !label(facts.layout)) return null;
  if (!integral(facts.track) || (facts.track as number) < 0) return null;
  if (!key(facts.sessionKey)) return null;
  if (!integral(facts.lap) || (facts.lap as number) < 1) return null;
  if (!finite(facts.startedAt) || !finite(facts.endedAt)) return null;
  if (!finite(facts.samples) || !integral(facts.samples) || (facts.samples as number) < 2) return null;
  if (!finite(facts.maxGapSeconds) || facts.maxGapSeconds < 0 || facts.maxGapSeconds > 1) return null;
  if (!finite(facts.validDurationSeconds) || facts.validDurationSeconds <= 0) return null;
  if (!finite(facts.lapDurationSeconds) || facts.lapDurationSeconds <= 0) return null;
  if (!finite(facts.fuelStartLitres) || !finite(facts.fuelEndLitres)) return null;

  const startedAt = facts.startedAt;
  const endedAt = facts.endedAt;
  const duration = endedAt - startedAt;
  if (duration <= 0 || duration > MAX_LAP_MILLISECONDS) return null;
  if (Math.abs(duration / 1000 - facts.lapDurationSeconds) > 1) return null;
  // Sampled coverage must span the lap; a gap-riddled train is not a measurement.
  if (facts.validDurationSeconds < MIN_COVERAGE_FRACTION * facts.lapDurationSeconds) return null;
  if (startedAt < facts.collectionStartedAt + 1) return null;
  if (endedAt > facts.knownAt) return null;
  if (facts.knownAt - endedAt > MAX_LABEL_DELAY_MILLISECONDS) return null;

  const used = facts.fuelStartLitres - facts.fuelEndLitres;
  if (!Number.isFinite(used) || used < 0.2 || used > 15) return null;

  const scope = {
    driver: facts.driver,
    car: facts.car,
    track: facts.track as number,
    layout: facts.layout,
  };
  return {
    revision: facts.id,
    owner: facts.owner,
    device: facts.device,
    policyVersion: facts.policyVersion as number,
    // Identical shape to the client qualifier so both sources share one window.
    context: JSON.stringify([facts.owner, facts.device, scope.driver, scope.car, scope.track, scope.layout]),
    scope,
    session: JSON.stringify([facts.sessionKey]),
    lap: facts.lap as number,
    startedAt,
    endedAt,
    knownAt: facts.knownAt,
    usedLitres: used,
  };
}
