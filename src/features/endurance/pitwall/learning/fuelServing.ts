import { parseLearningContribution } from "./contracts";
import type { V3Normalized } from "../pitwallHelpers";

export interface FuelLearningEstimate { estimate: number; lower: number; upper: number; modelVersion: string }
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
/** Only the authenticated read-RPC envelope is an input; never infer registry membership from the contribution itself. */
export function resolveFuelLearning(value: unknown, live: V3Normalized | null, nowMs: number): FuelLearningEstimate | null {
  if (!record(value) || !record(value.scope) || !Array.isArray(value.knownModelVersions)
    || !value.knownModelVersions.length || value.knownModelVersions.length > 8
    || !value.knownModelVersions.every(v => typeof v === "string" && v.length <= 64)
    || !live?.identity || !live.transportSessionId || value.transportSessionId !== live.transportSessionId
    || !Number.isFinite(nowMs)) return null;
  const scope = value.scope, identity = live.identity;
  if (!scope.driver || !scope.car || !scope.layout || scope.driver !== identity.currentDriverId
    || scope.car !== identity.carId || scope.track !== identity.trackId || scope.layout !== identity.trackConfig) return null;
  const result = parseLearningContribution(value.contribution, { knownModelVersions: value.knownModelVersions as string[] });
  if (!result || result.target !== "fuel" || result.state !== "active" || !result.decisive || !result.contextMatch
    || result.policyVersion !== "personal-fuel-v1" || result.featureVersion !== "previous-complete-lap-v1"
    || result.estimate == null || result.lower == null || result.upper == null || !result.modelVersion
    || result.independentSessions < 20 || result.lower < 0.2 || result.upper > 15
    || result.upper - result.lower > result.estimate * 0.2) return null;
  const observed = Date.parse(result.sourceObservedAt ?? ""), trained = Date.parse(result.trainedThrough ?? "");
  const captured = Date.parse(live.capturedAt ?? "");
  if (![observed, trained, captured].every(Number.isFinite) || observed > nowMs || trained > nowMs
    || nowMs - observed > 300000 || nowMs - trained > 7 * 86400000
    || captured > nowMs + 1000 || nowMs - captured > 30000) return null;
  return { estimate: result.estimate, lower: result.lower, upper: result.upper, modelVersion: result.modelVersion };
}
