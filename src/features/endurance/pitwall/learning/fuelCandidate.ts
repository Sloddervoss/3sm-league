import { estimateFuelPerLap, median } from "../strategy/fuelModel";

/** Registered before scoring; these limits are not fitted to a dataset. */
export const FUEL_CANDIDATE_POLICY = Object.freeze({
  version: "personal-fuel-v1",
  featureVersion: "previous-complete-lap-v1",
  minimumLaps: 100,
  minimumSessions: 20,
  trainSessions: 10,
  calibrationSessions: 5,
  testSessions: 5,
  minimumImprovement: 0.10,
  nominalCoverage: 0.90,
  maximumRelativeWidth: 0.20,
  maximumRelativeDrift: 0.10,
  maximumAgeMs: 7 * 24 * 60 * 60 * 1000,
});

/** Only a trusted evidence adapter may construct qualified examples. No identity inference here. */
export interface FuelExample {
  id: string;
  owner: string;
  context: string;
  session: string;
  sessionStartedAt: number;
  featureKnownAt: number;
  targetStartedAt: number;
  labelKnownAt: number;
  previousLitres: number;
  usedLitres: number;
  /** Pinned baseline's inputs, frozen before the target, never the target's consumption. */
  baselineSamples: number[];
  qualified: boolean;
}

export interface FuelCandidate {
  policyVersion: string;
  featureVersion: string;
  owner: string;
  context: string;
  trainedThrough: number;
  ratio: number;
  radius: number;
  sessions: number;
  exampleIds: string[];
  split: { train: string[]; calibration: string[]; test: string[] };
  metrics: {
    mae: number;
    baselineMae: number;
    underprediction: number;
    baselineUnderprediction: number;
    coverage: number;
    relativeWidth: number;
    relativeDrift: number;
    sessionMae: number[];
  };
  eligible: boolean;
}

function quantile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((sorted.length + 1) * fraction) - 1)];
}
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const plausible = (value: number) => Number.isFinite(value) && value >= 0.2 && value <= 15;

/** Deterministic lag-ratio model. Entire sessions are held out in chronological order.
 * Unknown, duplicate, mixed-owner/context or causally inconsistent input fails closed.
 * This function does not authorize promotion and does not assert production accuracy.
 */
export function fitFuelCandidate(examples: readonly FuelExample[], asOf: number): FuelCandidate | null {
  if (!Number.isFinite(asOf) || examples.length < FUEL_CANDIDATE_POLICY.minimumLaps || examples.length > 1000) return null;
  const first = examples[0];
  const ids = new Set<string>();
  const groups = new Map<string, FuelExample[]>();
  for (const row of examples) {
    if (!row.id || !row.owner || !row.context || !row.session || !row.qualified || ids.has(row.id)
      || row.owner !== first.owner || row.context !== first.context
      || !plausible(row.previousLitres) || !plausible(row.usedLitres)
      || ![row.sessionStartedAt, row.featureKnownAt, row.targetStartedAt, row.labelKnownAt].every(Number.isFinite)
      || row.sessionStartedAt > row.featureKnownAt || row.featureKnownAt >= row.targetStartedAt
      || row.targetStartedAt >= row.labelKnownAt || row.labelKnownAt > asOf
      || row.baselineSamples.length > 1000 || row.baselineSamples.length < 3
      || !row.baselineSamples.every(plausible)) return null;
    ids.add(row.id);
    const group = groups.get(row.session) ?? [];
    if (group.some((other) => other.sessionStartedAt !== row.sessionStartedAt)) return null;
    group.push(row);
    groups.set(row.session, group);
  }
  const sessions = [...groups.keys()].sort((a, b) => groups.get(a)![0].sessionStartedAt - groups.get(b)![0].sessionStartedAt || a.localeCompare(b));
  if (sessions.length < FUEL_CANDIDATE_POLICY.minimumSessions) return null;
  // Overlapping sessions cannot be treated as independent chronological groups.
  for (let i = 1; i < sessions.length; i++) {
    if (Math.max(...groups.get(sessions[i - 1])!.map((row) => row.labelKnownAt)) >= groups.get(sessions[i])![0].sessionStartedAt) return null;
  }
  const split = { train: sessions.slice(0, -10), calibration: sessions.slice(-10, -5), test: sessions.slice(-5) };
  const rows = (keys: string[]) => keys.flatMap((key) => groups.get(key)!);
  const train = rows(split.train);
  const calibration = rows(split.calibration);
  const test = rows(split.test);
  const ratio = median(train.map((row) => row.usedLitres / row.previousLitres))!;
  const radius = quantile(calibration.map((row) => Math.abs(row.usedLitres - row.previousLitres * ratio)), 0.9);
  const predictions = test.map((row) => row.previousLitres * ratio);
  const baselines = test.map((row) => estimateFuelPerLap(row.baselineSamples).perLap!);
  const errors = predictions.map((value, i) => Math.abs(value - test[i].usedLitres));
  const metrics = {
    mae: mean(errors),
    baselineMae: mean(baselines.map((value, i) => Math.abs(value - test[i].usedLitres))),
    underprediction: mean(predictions.map((value, i) => Math.max(0, test[i].usedLitres - value))),
    baselineUnderprediction: mean(baselines.map((value, i) => Math.max(0, test[i].usedLitres - value))),
    coverage: mean(errors.map((error) => error <= radius ? 1 : 0)),
    relativeWidth: 2 * radius / median(predictions)!,
    relativeDrift: Math.abs(median(test.map((row) => row.usedLitres / row.previousLitres))! / ratio - 1),
    sessionMae: split.test.map((session) => mean(test.flatMap((row, i) => row.session === session ? [errors[i]] : []))),
  };
  const p = FUEL_CANDIDATE_POLICY;
  return {
    policyVersion: p.version, featureVersion: p.featureVersion,
    owner: first.owner, context: first.context, trainedThrough: Math.max(...examples.map((row) => row.labelKnownAt)),
    ratio, radius, sessions: sessions.length, exampleIds: [...ids].sort(), split, metrics,
    eligible: metrics.baselineMae > 0 && metrics.mae <= metrics.baselineMae * (1 - p.minimumImprovement)
      && metrics.underprediction <= metrics.baselineUnderprediction
      && metrics.coverage >= p.nominalCoverage && metrics.relativeWidth <= p.maximumRelativeWidth
      && metrics.relativeDrift <= p.maximumRelativeDrift
      && predictions.every(plausible),
  };
}
