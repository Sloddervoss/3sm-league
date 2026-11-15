import { describe, it, expect } from "vitest";
import { qualifyFuelRevision, labelFuelForecast, FUEL_FORECAST_LAP_OFFSET, type VisibleFuelRevision, type ProspectiveFuelForecast } from "./fuelEvidence";
const owner = "a0000000-0000-4000-8000-000000000001";
const device = "d0000000-0000-4000-8000-000000000001";
const now = Date.parse("2026-11-14T18:00:00.000Z");
function source(): VisibleFuelRevision {
  return { id: "e0000000-0000-4000-8000-000000000001", owner, device,
    policyVersion: 1, knownAt: now, collectionStartedAt: now - 3600000, allowed: true, superseded: false,
    payload: { complete: true, pit_lap: false, driver_changed: false, invalid_reasons: [],
      fuel_added_litres_observed: 0, lap_number: 5,
      started_at: new Date(now - 61000).toISOString(), ended_at: new Date(now - 1000).toISOString(),
      fuel_start_litres: 50, fuel_end_litres: 47,
      observation: { version: 2, capture: { deviceId: device },
        interval: { samples: 600, maxGapSeconds: 0.2, unknownSeconds: 0, edgeBeforeSeconds: 0.1, edgeAfterSeconds: 0.1 },
        context: { carId: "1321", trackId: 42, trackConfig: "Endurance", sessionUniqueId: 99, sessionNumber: 0 },
        fuelQuality: { driverId: "12345", driverChanged: false, pitRoad: false, refuel: false, resetOrTow: false } },
    } };
}
function observation(s: VisibleFuelRevision) { return s.payload.observation as Record<string, unknown>; }
function forecast(): ProspectiveFuelForecast {
 const q = qualifyFuelRevision(source())!;
 return { id: "f0000000-0000-4000-8000-000000000001", owner, device, policyVersion: 1,
   context: q.context, session: q.session, sessionStartedAt: now - 360000,
   targetLap: 5, knownAt: now - 62000, previousLitres: 3, baselineSamples: [3, 3.1, 2.9] };
}
describe("prospective authoritative fuel evidence", () => {
 it("qualifies measured v2 only; owner/driver/device remain distinct", () => {
   const q = qualifyFuelRevision(source())!;
   expect(q.usedLitres).toBe(3); expect(q.scope.driver).toBe("12345"); expect(q.owner).toBe(owner);
   expect(q.device).toBe(device); expect(q.session).toBe("[99,0]"); expect(FUEL_FORECAST_LAP_OFFSET).toBe(2);
 });
 it.each(["pitRoad", "refuel", "resetOrTow", "driverChanged"])("unknown/true/absent %s never means false", key => {
   for (const value of [null, true, "false", 0, undefined]) {
     const s = source(); const quality = observation(s).fuelQuality as Record<string, unknown>;
     quality[key] = value; if (value === undefined) delete quality[key];
     expect(qualifyFuelRevision(s)).toBeNull();
   }
 });
 it("accepts canonical P1 projection without optional legacy columns only with conclusive v2 evidence", () => {
   const s = source();
   for (const key of ["pit_lap", "driver_changed", "invalid_reasons", "fuel_added_litres_observed"]) delete s.payload[key];
   expect(qualifyFuelRevision(s)?.usedLitres).toBe(3);
   for (const key of ["pitRoad", "refuel", "resetOrTow", "driverChanged"]) {
     const copy = structuredClone(s);
     (observation(copy).fuelQuality as Record<string, unknown>)[key] = null;
     expect(qualifyFuelRevision(copy)).toBeNull();
   }
 });
 it("v1 absence of bad observations is not negative evidence", () => {
   const s = source(); observation(s).version = 1; expect(qualifyFuelRevision(s)).toBeNull();
 });
 it("source device spoof, revocation, supersession and missing owner block", () => {
   for (const patch of [{ allowed: false }, { superseded: true }, { owner: "" }, { device: owner }, { policyVersion: 0 }]) {
     expect(qualifyFuelRevision({ ...source(), ...patch })).toBeNull();
   }
 });
 it("refuel/incomplete/invalid/pit source rows do not qualify", () => {
   for (const patch of [{ fuel_added_litres_observed: 1 }, { complete: false }, { complete: undefined },
     { invalid_reasons: ["gap"] }, { invalid_reasons: undefined }, { pit_lap: true }, { driver_changed: true }]) {
     const s = source(); Object.assign(s.payload, patch); expect(qualifyFuelRevision(s)).toBeNull();
   }
 });
 it("gaps and missing coverage reject without fabricating zero", () => {
   for (const patch of [{ samples: 1 }, { maxGapSeconds: 2 }, { unknownSeconds: 2 }, { edgeBeforeSeconds: null }, { edgeAfterSeconds: -1 }]) {
     const s = source(); Object.assign(observation(s).interval as object, patch); expect(qualifyFuelRevision(s)).toBeNull();
   }
 });
 it("history, late delivery and future labels are blocked", () => {
   for (const patch of [{ collectionStartedAt: now }, { knownAt: now - 2000 }, { knownAt: now + 300001 }]) {
     expect(qualifyFuelRevision({ ...source(), ...patch })).toBeNull();
   }
 });
 it("zero-valued session identifiers survive, missing driver/layout do not", () => {
   const s = source(); const c = observation(s).context as Record<string, unknown>; c.sessionUniqueId = 0;
   expect(qualifyFuelRevision(s)?.session).toBe("[0,0]");
   c.trackConfig = ""; expect(qualifyFuelRevision(s)).toBeNull();
   c.trackConfig = "Endurance"; (observation(s).fuelQuality as Record<string, unknown>).driverId = null;
   expect(qualifyFuelRevision(s)).toBeNull();
 });
 it("only an earlier committed forecast labels the exact future lap", () => {
   const q = qualifyFuelRevision(source())!; const f = forecast();
   const result = labelFuelForecast(f, q)!; expect(result.qualified).toBe(true);
   expect(result.previousLitres).toBe(3); expect(result.usedLitres).toBe(3);
   result.baselineSamples.push(4); expect(f.baselineSamples).toHaveLength(3);
 });
 it("never recreates earlier availability from trigger timestamps", () => {
   const q = qualifyFuelRevision(source())!;
   for (const knownAt of [q.startedAt - 1, q.startedAt, q.startedAt + 1, NaN]) {
     expect(labelFuelForecast({ ...forecast(), knownAt }, q)).toBeNull();
   }
 });
 it("cross owner/device/context/session/lap/policy labels cannot cross fences", () => {
   const q = qualifyFuelRevision(source())!;
   for (const patch of [{ owner: device }, { device: owner }, { context: "other" }, { session: "[100,0]" }, { targetLap: 6 }, { policyVersion: 2 }]) {
     expect(labelFuelForecast({ ...forecast(), ...patch }, q)).toBeNull();
   }
 });
});
