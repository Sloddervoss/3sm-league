import { classifyLapObservation, parseLapObservation } from "./observationV1.ts";
import { observationUpgradeMetadata } from "./observationPolicyV1.ts";
import { parseLapSummariesReport } from "./simhubExtensions.ts";

const assert = (ok: unknown, message: string): void => { if (!ok) throw new Error(message); };
const equal = (a: unknown, b: unknown): void => assert(JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const device = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const fixtures = Deno.env.get("NORMAL_OBSERVATION_FIXTURES");
if (!fixtures) throw new Error("Run the real C# subset with NORMAL_OBSERVATION_FIXTURES first");
const load = (name: string) => JSON.parse(Deno.readTextFileSync(`${fixtures}/${name}.observation.json`));

Deno.test("normal upgrade metadata is optional, policy/capability scoped and hop-free", () => {
  const allow = { captureAllowed: true, policyVersion: 1 };
  for (const mode of ["off", "unavailable"]) equal(observationUpgradeMetadata(mode, allow, true, device, "owner"), {});
  for (const policy of [undefined, { captureAllowed: false, policyVersion: null }, { captureAllowed: true, policyVersion: 2 }])
    equal(observationUpgradeMetadata("on", policy, true, device, "owner"), {});
  equal(observationUpgradeMetadata("on", allow, false, device, "owner"), { identity: { deviceId: device, ownerUserId: "owner" } });
  equal(observationUpgradeMetadata("on", allow, true, device, "owner"), { identity: { deviceId: device, ownerUserId: "owner" }, observationSchemas: [1, 2] });
});

for (const name of ["clean", "null", "gap", "driver", "context", "fuel-null", "v1"]) {
  Deno.test(`real C# serializer -> parser retains exact ${name} facts`, () => {
    const raw = load(name);
    const result = parseLapObservation(raw);
    assert(result.ok, JSON.stringify(result));
    if (!result.ok) return;
    equal(result.observation, raw);
    const classified = classifyLapObservation({ row: { observation: raw, startedAt: raw.interval.firstSampleAt, endedAt: raw.interval.lastSampleAt }, authenticatedDeviceId: device });
    assert(classified.disposition === "accept", JSON.stringify(classified));
    if (name !== "v1") assert(result.observation.fuelQuality?.resetOrTow === null, "unsupported reset must remain null and block clean qualification");
    if (name === "gap") assert(result.observation.fuelQuality?.pitRoad === null && result.observation.fuelQuality?.refuel === null, "gap != false");
  });
}

Deno.test("v2 exact nullable shape rejects malformed/unknown/version1 extra fields", () => {
  const clean = load("clean");
  for (const quality of [null, {}, { ...clean.fuelQuality, extra: false }, { ...clean.fuelQuality, pitRoad: 0 }, { ...clean.fuelQuality, refuel: "false" }, { ...clean.fuelQuality, driverId: "" }])
    assert(!parseLapObservation({ ...clean, fuelQuality: quality }).ok, JSON.stringify(quality));
  assert(!parseLapObservation({ ...clean, version: 1 }).ok, "v1 must not accept fuelQuality");
  const gap = load("gap");
  assert(!parseLapObservation({ ...gap, fuelQuality: { ...gap.fuelQuality, pitRoad: false } }).ok, "gap must not claim false");
});

Deno.test("actual sampler row captures v2; optional rejection leaves legacy neighbours accepted", () => {
  const row = JSON.parse(Deno.readTextFileSync(`${fixtures}/pipeline.row.json`));
  const options = { observationCapture: "on" as const, authenticatedDeviceId: device };
  const report = parseLapSummariesReport([row], options);
  assert(report.rows.length === 1, JSON.stringify(report));
  equal(report.rows[0].observation, row.observation);
  const legacy = { ...row, summaryUid: "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee" };
  delete legacy.observation;
  const bad = { ...row, observation: { ...row.observation, fuelQuality: { pitRoad: false } } };
  const mixed = parseLapSummariesReport([bad, legacy], options);
  assert(mixed.rows.length === 1 && mixed.rows[0].summaryUid === legacy.summaryUid, JSON.stringify(mixed));
});
