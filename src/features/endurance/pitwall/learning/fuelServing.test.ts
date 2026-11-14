import { describe, expect, it } from "vitest";
import { resolveFuelLearning } from "./fuelServing";
import { buildStrategySnapshot } from "../strategy/snapshot";
import { advise } from "../strategy/advise";
import type { V3Normalized } from "../pitwallHelpers";
const now = Date.parse("2026-11-14T20:00:00.000Z");
const live = () => ({ capturedAt: new Date(now).toISOString(), transportSessionId: "simhub-current",
  identity: { currentDriverId: "12345", carId: "1321", trackId: 42, trackConfig: "Endurance" },
  fuel: { fuelLitres: 50, fuelPerLapLitres: 3, fuelCapacityLitres: 100 },
  timing: { completedLaps: 5 }, session: { sessionTimeRemainingSeconds: 3600 },
}) as V3Normalized;
function envelope() {
 return { knownModelVersions: ["fuel-known-v1"], scope: { driver: "12345", car: "1321", track: 42, layout: "Endurance" },
  transportSessionId: "simhub-current", contribution: { schemaVersion: 1, target: "fuel", state: "active", unit: "L/lap", corner: null,
    modelVersion: "fuel-known-v1", featureVersion: "previous-complete-lap-v1", policyVersion: "personal-fuel-v1",
    trainedThrough: new Date(now - 60000).toISOString(), sourceObservedAt: new Date(now - 1000).toISOString(),
    sourceFrameSequence: null, estimate: 3.2, lower: 3.1, upper: 3.3,
    independentSessions: 20, independentSets: null, contextMatch: true, decisive: true, reasonCodes: [] } };
}
describe("authorised fuel contribution to existing advice", () => {
 it("accepts a scoped known registry version through the real contribution parser", () => {
  expect(resolveFuelLearning(envelope(), live(), now)).toEqual({ estimate: 3.2, lower: 3.1, upper: 3.3, modelVersion: "fuel-known-v1" });
 });
 it("missing/unknown registry, denied/malformed/collecting model stay baseline", () => {
  for (const value of [null, {}, { ...envelope(), knownModelVersions: [] },
    { ...envelope(), knownModelVersions: ["different"] }, { ...envelope(), contribution: null },
    { ...envelope(), contribution: { ...envelope().contribution, decisive: false } },
    { ...envelope(), contribution: { ...envelope().contribution, state: "collecting" } }]) {
   expect(resolveFuelLearning(value, live(), now)).toBeNull();
  }
 });
 it("context and transport fences reject each changed dimension independently", () => {
  for (const scope of [{ driver: "other" }, { car: "other" }, { track: 43 }, { layout: "other" }]) {
   const e=envelope(); Object.assign(e.scope,scope); expect(resolveFuelLearning(e,live(),now)).toBeNull();
  }
  expect(resolveFuelLearning({ ...envelope(), transportSessionId: "simhub-old" },live(),now)).toBeNull();
 });
 it("expired model, old/future observation and stale/future telemetry cannot be served", () => {
  for (const patch of [{ trainedThrough: new Date(now-8*86400000).toISOString() },
    { sourceObservedAt: new Date(now-300001).toISOString() }, { sourceObservedAt: new Date(now+1).toISOString() }]) {
   const e=envelope();Object.assign(e.contribution,patch);expect(resolveFuelLearning(e,live(),now)).toBeNull();
  }
  for (const capturedAt of [new Date(now-30001).toISOString(),new Date(now+1001).toISOString()]) {
   expect(resolveFuelLearning(envelope(),{...live(),capturedAt},now)).toBeNull();
  }
 });
 it("invalid range or insufficient independent sessions cannot affect fuel", () => {
  for (const patch of [{ upper: 15.1 }, { lower: .1 }, { lower: 1 }, { independentSessions: 19 }, { upper: NaN }]) {
   const e=envelope();Object.assign(e.contribution,patch);expect(resolveFuelLearning(e,live(),now)).toBeNull();
  }
 });
 it("actually reaches existing snapshot and advice, without lowering baseline/reserve", () => {
  const input={strategy:null,v3:live(),nowMs:now,fuelPerLapSamples:[3,3,3]};
  const original=advise(buildStrategySnapshot(input));
  const selected=resolveFuelLearning(envelope(),live(),now)!;
  const learned=advise(buildStrategySnapshot({...input,learnedFuelUpper:selected.upper}));
  expect(original.fuel.perLap).toBe(3);expect(learned.fuel.perLap).toBe(3.3);
  expect(learned.lapsOnFuel).toBeLessThanOrEqual(original.lapsOnFuel!);
  expect(advise(buildStrategySnapshot({...input,learnedFuelUpper:2})).fuel.perLap).toBe(3);
 });
 it("absent and nonsensical learned input leave the old estimator exactly intact", () => {
  const input={strategy:null,v3:live(),nowMs:now,fuelPerLapSamples:[3,3,3]};
  const base=advise(buildStrategySnapshot(input));
  for(const learnedFuelUpper of [null,NaN,Infinity,-1,16]) expect(advise(buildStrategySnapshot({...input,learnedFuelUpper}))).toEqual(base);
 });
});
