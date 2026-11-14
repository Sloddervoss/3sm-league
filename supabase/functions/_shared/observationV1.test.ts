/**
 * T13 capture-only observation v1 — executable contract tests.
 *
 * Synthetic fixtures only. No network, database, SDK, filesystem or Edge
 * import is exercised here. The real V3 lap-summary receiver is imported only
 * to prove that it still rejects `observation` while the new core is UNWIRED.
 */

// deno-lint-ignore-file no-explicit-any -- fixtures are deliberately mutable JSON-shaped objects

import { parseLapSummariesReport } from "./simhubExtensions.ts";
import {
  classifyLapObservation,
  type ObservationV1,
  parseLapObservation,
} from "./observationV1.ts";

const UUID_A = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const UUID_B = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
const UUID_A_UPPER = UUID_A.toUpperCase();
const ROW_START = "2026-11-12T10:00:00.000Z";
const ROW_END = "2026-11-12T10:00:20.000Z";
const SAMPLE_START = "2026-11-12T10:00:00.050Z";
const encoder = new TextEncoder();

function assert(
  condition: unknown,
  message = "assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (
    a === null || b === null || typeof a !== "object" || typeof b !== "object"
  ) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) =>
    Object.prototype.hasOwnProperty.call(b, key) &&
    deepEqual(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key],
    )
  );
}

function assertEquals(actual: unknown, expected: unknown, label = ""): void {
  if (!deepEqual(actual, expected)) {
    throw new Error(
      `${label} expected ${JSON.stringify(expected)} got ${
        JSON.stringify(actual)
      }`,
    );
  }
}

function utf8Bytes(text: string): number {
  return encoder.encode(text).byteLength;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

/** A fully positive, internally consistent 20 s lap. No null facts. */
function validObservation(): Record<string, any> {
  return {
    version: 1,
    capture: { deviceId: UUID_A },
    interval: {
      firstSampleAt: "2026-11-12T10:00:00.050Z",
      lastSampleAt: "2026-11-12T10:00:19.950Z",
      samples: 41,
      maxGapSeconds: 0.5,
      unknownSeconds: 0.1,
      edgeBeforeSeconds: 0.05,
      edgeAfterSeconds: 0.05,
    },
    pitRoad: { value: true, firstAt: "2026-11-12T10:00:05.000Z" },
    refuel: {
      observedAddedLitres: 2.4,
      firstAt: "2026-11-12T10:00:10.000Z",
      positiveSteps: 2,
      resolutionLitres: 0.01,
    },
    driverNameContinuity: { value: "unchanged" },
    context: {
      carId: "1321",
      trackId: 42,
      trackName: "Circuit de Spa-Francorchamps",
      trackConfig: "Endurance",
      sessionUniqueId: 987654,
      sessionNumber: 0,
    },
  };
}

function variant(
  change: (value: Record<string, any>) => void,
): Record<string, any> {
  const value = validObservation();
  change(value);
  return value;
}

function withInterval(patch: Record<string, unknown>): Record<string, any> {
  return variant((value) => Object.assign(value.interval, patch));
}

/** Minimal fact-free fixture, so numeric bounds are not coupled to fact times. */
function minimalObservation(
  interval: Record<string, unknown>,
): Record<string, any> {
  return {
    version: 1,
    capture: { deviceId: UUID_A },
    interval: {
      firstSampleAt: ROW_START,
      lastSampleAt: ROW_END,
      samples: 2,
      maxGapSeconds: 19.9,
      unknownSeconds: 0,
      edgeBeforeSeconds: 0,
      edgeAfterSeconds: 0,
      ...interval,
    },
    driverNameContinuity: { value: "unchanged" },
  };
}

/**
 * Adjacent IEEE-754 double for a positive finite value. Test-only input
 * generator: the expected decision still comes from the literal 1 ms/0.4975/
 * 19.9/0.1 bounds, not from copying the module's comparison formula.
 */
function nextFloat(value: number, direction: 1 | -1): number {
  assert(value > 0, "nextFloat is defined for positive test values");
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setFloat64(0, value);
  const bits = (BigInt(view.getUint32(0)) << 32n) |
    BigInt(view.getUint32(4));
  const next = direction > 0 ? bits + 1n : bits - 1n;
  view.setUint32(0, Number(next >> 32n));
  view.setUint32(4, Number(next & 0xffff_ffffn));
  return view.getFloat64(0);
}

function expectOk(value: unknown): ObservationV1 {
  const result = parseLapObservation(value);
  if (!result.ok) {
    throw new Error(`expected success, got ${result.code} at ${result.path}`);
  }
  return result.observation;
}

function expectError(value: unknown, code: string, path?: string): void {
  const result = parseLapObservation(value);
  if (result.ok) throw new Error(`expected ${code}, got success`);
  assertEquals(result.code, code, "code");
  if (path !== undefined) assertEquals(result.path, path, "path");
}

function classify(
  row: Record<string, unknown>,
  authenticatedDeviceId: unknown = UUID_A,
) {
  return classifyLapObservation({ row, authenticatedDeviceId });
}

function expectDisposition(
  row: Record<string, unknown>,
  disposition: string,
  authenticatedDeviceId: unknown = UUID_A,
  code?: string,
) {
  const result = classify(row, authenticatedDeviceId);
  assertEquals(result.disposition, disposition, "disposition");
  if (code !== undefined) assertEquals(result.code, code, "code");
  return result;
}

function paddedObservation(targetBytes: number): Record<string, any> {
  const base = validObservation();
  const baseBytes = utf8Bytes(JSON.stringify({ ...base, zz: "" }));
  assert(
    targetBytes > baseBytes,
    "target must leave room for the unknown-key payload",
  );
  const remaining = targetBytes - baseBytes;
  const multibyte = Math.floor(remaining / 2);
  const ascii = remaining - multibyte * 2;
  const candidate = {
    ...base,
    zz: "é".repeat(multibyte) + "a".repeat(ascii),
  };
  assertEquals(
    utf8Bytes(JSON.stringify(candidate)),
    targetBytes,
    "padded size",
  );
  return candidate;
}

// ---------------------------------------------------------------------------
// Root, version, required groups and allowlist
// ---------------------------------------------------------------------------

Deno.test("T13-001 parser: absent observation value is not a valid block", () => {
  expectError(undefined, "observation_not_object", "observation");
});

Deno.test("T13-002 parser: observation null is a row rejection, not legacy", () => {
  expectError(null, "observation_null", "observation");
});

for (
  const [label, value] of [
    ["string", "observation"],
    ["number", 1],
    ["boolean", true],
    ["array", []],
  ] as const
) {
  Deno.test(`T13-003 root ${label} is not an object`, () => {
    expectError(value, "observation_not_object", "observation");
  });
}

Deno.test("T13-004 parser: empty object misses version", () => {
  expectError({}, "observation_missing_key", "observation.version");
});

for (
  const [label, version] of [
    ["3", 3], // v2 now has its own additive capture contract.
    ["string", "1"],
    ["boolean", true],
    ["fraction", 1.5],
  ] as const
) {
  Deno.test(`T13-005 version ${label} is unsupported`, () => {
    expectError(
      variant((value) => (value.version = version)),
      "observation_invalid_version",
      "observation.version",
    );
  });
}

Deno.test("T13-006 version 1 is accepted with a real positive fact", () => {
  const parsed = expectOk(validObservation());
  assertEquals(parsed.version, 1, "version");
  assertEquals(parsed.pitRoad?.value, true, "pitRoad");
  assertEquals(parsed.refuel?.observedAddedLitres, 2.4, "refuel");
});

Deno.test("T13-007 capture is required", () => {
  expectError(
    variant((value) => delete value.capture),
    "observation_missing_key",
    "observation.capture",
  );
});

Deno.test("T13-008 interval is required", () => {
  expectError(
    variant((value) => delete value.interval),
    "observation_missing_key",
    "observation.interval",
  );
});

Deno.test("T13-009 capture only is not a fact block", () => {
  const value = validObservation();
  delete value.pitRoad;
  delete value.refuel;
  delete value.driverNameContinuity;
  delete value.context;
  expectError(value, "observation_no_fact", "observation");
});

Deno.test("T13-010 capture null is rejected", () => {
  expectError(
    variant((value) => (value.capture = null)),
    "observation_null",
    "observation.capture",
  );
});

Deno.test("T13-011 interval array is rejected", () => {
  expectError(
    variant((value) => (value.interval = [])),
    "observation_invalid_type",
    "observation.interval",
  );
});

Deno.test("T13-012 capture misses deviceId", () => {
  expectError(
    variant((value) => (value.capture = {})),
    "observation_missing_key",
    "observation.capture.deviceId",
  );
});

Deno.test("T13-013 deviceId must be a string", () => {
  expectError(
    variant((value) => (value.capture.deviceId = 42)),
    "observation_invalid_type",
    "observation.capture.deviceId",
  );
});

Deno.test("T13-014 capture has no owner field", () => {
  expectError(
    variant((value) => (value.capture.ownerUserId = UUID_A)),
    "observation_unknown_key",
    "observation.capture",
  );
});

for (
  const key of [
    "ownerUserId",
    "ownerBasis",
    "driverId",
    "resetOrTow",
    "driverChanged",
    "currentDriverName",
    "compound",
    "regime",
    "complete",
  ]
) {
  Deno.test(`T13-015 root rejects non-allowlisted ${key}`, () => {
    expectError(
      variant((value) => (value[key] = key === "complete" ? true : "x")),
      "observation_unknown_key",
      "observation",
    );
  });
}

Deno.test("T13-016 unknown root key is rejected before value validation", () => {
  const value = variant((v) => (v.extraRoot = { anything: true }));
  value.version = 99;
  expectError(value, "observation_unknown_key", "observation");
});

// ---------------------------------------------------------------------------
// Interval: exact fields, numbers, samples and coverage bound
// ---------------------------------------------------------------------------

for (
  const field of [
    "firstSampleAt",
    "lastSampleAt",
    "samples",
    "maxGapSeconds",
    "unknownSeconds",
    "edgeBeforeSeconds",
    "edgeAfterSeconds",
  ]
) {
  Deno.test(`T13-020 interval requires ${field}`, () => {
    expectError(
      variant((value) => delete value.interval[field]),
      "observation_missing_key",
      `observation.interval.${field}`,
    );
  });
}

for (
  const field of [
    "samples",
    "maxGapSeconds",
    "unknownSeconds",
    "edgeBeforeSeconds",
    "edgeAfterSeconds",
  ]
) {
  Deno.test(`T13-021 interval rejects null ${field}`, () => {
    expectError(
      variant((value) => (value.interval[field] = null)),
      "observation_null",
      `observation.interval.${field}`,
    );
  });
}

Deno.test("T13-022 interval rejects a duplicate per-fact coverage field", () => {
  expectError(
    variant((value) => (value.interval.edge = 0)),
    "observation_unknown_key",
    "observation.interval",
  );
});

for (
  const [label, samples, code] of [
    ["zero", 0, "observation_invalid_integer"],
    ["negative", -1, "observation_invalid_integer"],
    ["fraction", 1.5, "observation_invalid_integer"],
    ["string", "41", "observation_invalid_type"],
    ["above maximum", 1_000_001, "observation_invalid_integer"],
  ] as const
) {
  Deno.test(`T13-023 samples ${label} is rejected`, () => {
    expectError(
      variant((value) => (value.interval.samples = samples)),
      code,
      "observation.interval.samples",
    );
  });
}

for (
  const [label, samples] of [["minimum", 1], ["maximum", 1_000_000]] as const
) {
  Deno.test(`T13-024 samples ${label} is accepted when consistent`, () => {
    if (samples === 1) {
      const value = withInterval({
        samples: 1,
        firstSampleAt: "2026-11-12T10:00:10.000Z",
        lastSampleAt: "2026-11-12T10:00:10.000Z",
        maxGapSeconds: 0,
        unknownSeconds: 0.1,
      });
      value.pitRoad.firstAt = "2026-11-12T10:00:10.000Z";
      value.refuel.firstAt = "2026-11-12T10:00:10.000Z";
      expectOk(value);
      return;
    }
    const value = withInterval({
      samples: 1_000_000,
      maxGapSeconds: 0.00002,
    });
    expectOk(value);
  });
}

for (
  const [label, patch, code, path] of [
    [
      "negative maxGap",
      { maxGapSeconds: -0.1 },
      "observation_invalid_number",
      "observation.interval.maxGapSeconds",
    ],
    [
      "maxGap above day",
      { maxGapSeconds: 86_401 },
      "observation_invalid_number",
      "observation.interval.maxGapSeconds",
    ],
    [
      "negative unknown",
      { unknownSeconds: -1 },
      "observation_invalid_number",
      "observation.interval.unknownSeconds",
    ],
    [
      "negative edge",
      { edgeBeforeSeconds: -0.1 },
      "observation_invalid_number",
      "observation.interval.edgeBeforeSeconds",
    ],
    [
      "numeric string",
      { maxGapSeconds: "0.5" },
      "observation_invalid_type",
      "observation.interval.maxGapSeconds",
    ],
  ] as const
) {
  Deno.test(`T13-025 interval ${label} is rejected`, () => {
    expectError(withInterval(patch), code, path);
  });
}

Deno.test("T13-026 first sample after last sample is rejected exactly", () => {
  expectError(
    withInterval({
      firstSampleAt: "2026-11-12T10:00:19.950Z",
      lastSampleAt: "2026-11-12T10:00:00.050Z",
    }),
    "observation_time_order",
    "observation.interval.firstSampleAt",
  );
});

Deno.test("T13-027 one sample cannot span time", () => {
  expectError(
    withInterval({ samples: 1 }),
    "observation_bounds_inconsistent",
    "observation.interval.samples",
  );
});

Deno.test("T13-028 multiple samples cannot share one timestamp", () => {
  expectError(
    withInterval({
      firstSampleAt: "2026-11-12T10:00:10.000Z",
      lastSampleAt: "2026-11-12T10:00:10.000Z",
    }),
    "observation_bounds_inconsistent",
    "observation.interval.samples",
  );
});

Deno.test("T13-029 maxGap below the average gap is rejected", () => {
  expectError(
    withInterval({ maxGapSeconds: 0.49 }),
    "observation_max_gap_inconsistent",
    "observation.interval.maxGapSeconds",
  );
});

Deno.test("T13-030 maxGap above the sampled span is rejected", () => {
  expectError(
    withInterval({ maxGapSeconds: 20.5, unknownSeconds: 20.5 }),
    "observation_max_gap_inconsistent",
    "observation.interval.maxGapSeconds",
  );
});

Deno.test("T13-031 unknown below both edge offsets is rejected", () => {
  expectError(
    withInterval({ unknownSeconds: 0.09 }),
    "observation_unknown_seconds_inconsistent",
    "observation.interval.unknownSeconds",
  );
});

Deno.test("T13-032 unknown below edges plus a >1 s max gap is rejected", () => {
  const value = withInterval({
    maxGapSeconds: 1.2,
    edgeBeforeSeconds: 0.1,
    edgeAfterSeconds: 0.1,
    unknownSeconds: 1.39,
  });
  expectError(
    value,
    "observation_unknown_seconds_inconsistent",
    "observation.interval.unknownSeconds",
  );
});

Deno.test("T13-033 edges 0.2 plus maxGap 1.2 needs unknown 1.4", () => {
  const value = withInterval({
    maxGapSeconds: 1.2,
    edgeBeforeSeconds: 0.1,
    edgeAfterSeconds: 0.1,
    unknownSeconds: 1.4,
  });
  expectOk(value);
});

Deno.test("T13-034 report example maxGap 0.6 with unknown 0.2 is valid", () => {
  const value = withInterval({
    maxGapSeconds: 0.6,
    unknownSeconds: 0.2,
  });
  expectOk(value);
});

Deno.test("T13-035 report's 0.8 with maxGap 1.2 is contradictory", () => {
  const value = withInterval({
    maxGapSeconds: 1.2,
    unknownSeconds: 0.8,
  });
  expectError(
    value,
    "observation_unknown_seconds_inconsistent",
    "observation.interval.unknownSeconds",
  );
});

Deno.test("T13-036 maxGap exactly 1.0 is not counted as a full unknown gap", () => {
  const value = withInterval({
    maxGapSeconds: 1,
    unknownSeconds: 0.1,
  });
  expectOk(value);
});

Deno.test("T13-037 unknown 0 with zero edges is a legitimate counter", () => {
  const value = withInterval({
    edgeBeforeSeconds: 0,
    edgeAfterSeconds: 0,
    unknownSeconds: 0,
  });
  expectOk(value);
});

Deno.test("T13-038 unknown 0 with a nonzero edge is contradictory", () => {
  const value = withInterval({
    edgeBeforeSeconds: 0.001,
    unknownSeconds: 0,
  });
  expectError(
    value,
    "observation_unknown_seconds_inconsistent",
    "observation.interval.unknownSeconds",
  );
});

Deno.test("T13-039 unknown above the lap window is rejected", () => {
  const value = withInterval({
    firstSampleAt: "2026-11-12T10:00:00.000Z",
    lastSampleAt: "2026-11-12T10:00:01.000Z",
    samples: 2,
    maxGapSeconds: 1,
    edgeBeforeSeconds: 0,
    edgeAfterSeconds: 0,
    unknownSeconds: 2,
  });
  expectError(
    value,
    "observation_unknown_seconds_inconsistent",
    "observation.interval.unknownSeconds",
  );
});

Deno.test("T13-040 unknown exactly equals the lap window", () => {
  const value = withInterval({
    firstSampleAt: "2026-11-12T10:00:00.000Z",
    lastSampleAt: "2026-11-12T10:00:01.000Z",
    samples: 2,
    maxGapSeconds: 1,
    edgeBeforeSeconds: 0,
    edgeAfterSeconds: 0,
    unknownSeconds: 1,
  });
  value.pitRoad.firstAt = "2026-11-12T10:00:00.500Z";
  value.refuel.firstAt = "2026-11-12T10:00:00.900Z";
  expectOk(value);
});

// ---------------------------------------------------------------------------
// Timestamps: bounded exact ISO-8601 UTC, no Date.parse truncation
// ---------------------------------------------------------------------------

Deno.test("T13-050 seven fractional digits are accepted and preserved", () => {
  const first = "2026-11-12T10:00:00.0500001Z";
  const value = withInterval({
    firstSampleAt: first,
    edgeBeforeSeconds: 0.0500001,
    unknownSeconds: 0.1000001,
  });
  const parsed = expectOk(value);
  assertEquals(parsed.interval.firstSampleAt, first, "raw firstSampleAt");
});

Deno.test("T13-051 eight fractional digits are rejected", () => {
  expectError(
    withInterval({ firstSampleAt: "2026-11-12T10:00:00.05000001Z" }),
    "observation_invalid_timestamp",
    "observation.interval.firstSampleAt",
  );
});

Deno.test("T13-052 six fractional digits are accepted", () => {
  expectOk(withInterval({ firstSampleAt: "2026-11-12T10:00:00.050000Z" }));
});

Deno.test("T13-053 no fractional digits are accepted", () => {
  expectOk(
    withInterval({
      firstSampleAt: "2026-11-12T10:00:00Z",
      edgeBeforeSeconds: 0,
    }),
  );
});

Deno.test("T13-054 numeric UTC offset is rejected", () => {
  expectError(
    withInterval({ firstSampleAt: "2026-11-12T10:00:00.050+00:00" }),
    "observation_invalid_timestamp",
    "observation.interval.firstSampleAt",
  );
});

Deno.test("T13-055 lowercase z is rejected", () => {
  expectError(
    withInterval({ firstSampleAt: "2026-11-12T10:00:00.050z" }),
    "observation_invalid_timestamp",
    "observation.interval.firstSampleAt",
  );
});

Deno.test("T13-056 invalid calendar date is rejected", () => {
  expectError(
    withInterval({ firstSampleAt: "2026-02-30T10:00:00.050Z" }),
    "observation_invalid_timestamp",
    "observation.interval.firstSampleAt",
  );
});

Deno.test("T13-057 leap day 2024 is valid", () => {
  const value = withInterval({
    firstSampleAt: "2024-02-29T00:00:00.000Z",
    lastSampleAt: "2024-02-29T00:00:19.900Z",
    edgeBeforeSeconds: 0,
  });
  value.pitRoad.firstAt = "2024-02-29T00:00:10.000Z";
  value.refuel.firstAt = "2024-02-29T00:00:15.000Z";
  expectOk(value);
});

Deno.test("T13-058 non-leap day 2025 is rejected", () => {
  expectError(
    withInterval({ firstSampleAt: "2025-02-29T00:00:00.000Z" }),
    "observation_invalid_timestamp",
    "observation.interval.firstSampleAt",
  );
});

Deno.test("T13-059 hour 24 is rejected", () => {
  expectError(
    withInterval({ firstSampleAt: "2026-11-12T24:00:00.000Z" }),
    "observation_invalid_timestamp",
    "observation.interval.firstSampleAt",
  );
});

Deno.test("T13-060 leap second 60 is rejected", () => {
  expectError(
    withInterval({ firstSampleAt: "2026-11-12T10:00:60.000Z" }),
    "observation_invalid_timestamp",
    "observation.interval.firstSampleAt",
  );
});

Deno.test("T13-061 100 ns ordering is not truncated by Date.parse", () => {
  // Date.parse() maps both values to the same millisecond. The core must not.
  assert(
    Date.parse("2026-11-12T10:00:00.0000001Z") ===
      Date.parse("2026-11-12T10:00:00.0000000Z"),
  );
  expectError(
    withInterval({
      firstSampleAt: "2026-11-12T10:00:00.0000001Z",
      lastSampleAt: "2026-11-12T10:00:00.0000000Z",
    }),
    "observation_time_order",
    "observation.interval.firstSampleAt",
  );
});

Deno.test("T13-062 timestamp before 1970 is outside the bounded parser", () => {
  expectError(
    withInterval({ firstSampleAt: "1969-12-31T23:59:59.999Z" }),
    "observation_invalid_timestamp",
    "observation.interval.firstSampleAt",
  );
});

// ---------------------------------------------------------------------------
// Positive and descriptive facts: exact keys, no null, no negative fact
// ---------------------------------------------------------------------------

Deno.test("T13-070 pitRoad false is a forbidden negative fact", () => {
  expectError(
    variant((value) => (value.pitRoad.value = false)),
    "observation_negative_fact",
    "observation.pitRoad.value",
  );
});

Deno.test("T13-071 pitRoad 0 is a forbidden negative fact", () => {
  expectError(
    variant((value) => (value.pitRoad.value = 0)),
    "observation_negative_fact",
    "observation.pitRoad.value",
  );
});

Deno.test("T13-072 pitRoad string true is a type error", () => {
  expectError(
    variant((value) => (value.pitRoad.value = "true")),
    "observation_invalid_type",
    "observation.pitRoad.value",
  );
});

Deno.test("T13-073 pitRoad requires firstAt", () => {
  expectError(
    variant((value) => delete value.pitRoad.firstAt),
    "observation_missing_key",
    "observation.pitRoad.firstAt",
  );
});

Deno.test("T13-074 pitRoad firstAt before the sampled interval is rejected", () => {
  expectError(
    variant((value) => (value.pitRoad.firstAt = "2026-11-12T10:00:00.049Z")),
    "observation_fact_outside_interval",
    "observation.pitRoad.firstAt",
  );
});

Deno.test("T13-075 pitRoad firstAt at the first sample is inclusive", () => {
  const value = variant((
    v,
  ) => (v.pitRoad.firstAt = "2026-11-12T10:00:00.050Z"));
  expectOk(value);
});

Deno.test("T13-076 pitRoad firstAt at the last sample is inclusive", () => {
  const value = variant((
    v,
  ) => (v.pitRoad.firstAt = "2026-11-12T10:00:19.950Z"));
  expectOk(value);
});

Deno.test("T13-077 pitRoad duplicate coverage key is rejected", () => {
  expectError(
    variant((value) => (value.pitRoad.samples = 41)),
    "observation_unknown_key",
    "observation.pitRoad",
  );
});

Deno.test("T13-078 pitRoad null is rejected", () => {
  expectError(
    variant((value) => (value.pitRoad = null)),
    "observation_null",
    "observation.pitRoad",
  );
});

Deno.test("T13-079 refuel zero is a forbidden negative fact", () => {
  expectError(
    variant((value) => (value.refuel.observedAddedLitres = 0)),
    "observation_negative_fact",
    "observation.refuel.observedAddedLitres",
  );
});

Deno.test("T13-080 refuel negative is a forbidden negative fact", () => {
  expectError(
    variant((value) => (value.refuel.observedAddedLitres = -0.1)),
    "observation_negative_fact",
    "observation.refuel.observedAddedLitres",
  );
});

Deno.test("T13-081 refuel above 300 L is rejected", () => {
  expectError(
    variant((value) => (value.refuel.observedAddedLitres = 300.1)),
    "observation_invalid_number",
    "observation.refuel.observedAddedLitres",
  );
});

Deno.test("T13-082 refuel 300 L is accepted as an observed step", () => {
  expectOk(variant((value) => (value.refuel.observedAddedLitres = 300)));
});

for (
  const [label, steps, code] of [
    ["zero", 0, "observation_invalid_integer"],
    ["above maximum", 10_001, "observation_invalid_integer"],
    ["fraction", 1.5, "observation_invalid_integer"],
    ["string", "2", "observation_invalid_type"],
  ] as const
) {
  Deno.test(`T13-083 positiveSteps ${label} is rejected`, () => {
    expectError(
      variant((value) => (value.refuel.positiveSteps = steps)),
      code,
      "observation.refuel.positiveSteps",
    );
  });
}

for (const [label, steps] of [["minimum", 1], ["maximum", 10_000]] as const) {
  Deno.test(`T13-084 positiveSteps ${label} is accepted`, () => {
    expectOk(variant((value) => (value.refuel.positiveSteps = steps)));
  });
}

for (
  const [label, resolution, code] of [
    ["below minimum", 0.0009, "observation_invalid_number"],
    ["above maximum", 1.0001, "observation_invalid_number"],
  ] as const
) {
  Deno.test(`T13-085 resolutionLitres ${label} is rejected`, () => {
    expectError(
      variant((value) => (value.refuel.resolutionLitres = resolution)),
      code,
      "observation.refuel.resolutionLitres",
    );
  });
}

for (
  const [label, resolution] of [["minimum", 0.001], ["maximum", 1]] as const
) {
  Deno.test(`T13-086 resolutionLitres ${label} is accepted`, () => {
    expectOk(variant((value) => (value.refuel.resolutionLitres = resolution)));
  });
}

Deno.test("T13-087 maxUndetectedLitres is optional when unknown", () => {
  const parsed = expectOk(validObservation());
  assert(!("maxUndetectedLitres" in parsed.refuel!), "must stay absent");
});

Deno.test("T13-088 maxUndetectedLitres equal to resolution is accepted", () => {
  expectOk(variant((value) => (value.refuel.maxUndetectedLitres = 0.01)));
});

Deno.test("T13-089 maxUndetectedLitres below resolution is rejected", () => {
  expectError(
    variant((value) => (value.refuel.maxUndetectedLitres = 0.009)),
    "observation_invalid_number",
    "observation.refuel.maxUndetectedLitres",
  );
});

Deno.test("T13-090 maxUndetectedLitres above 300 is rejected", () => {
  expectError(
    variant((value) => (value.refuel.maxUndetectedLitres = 300.1)),
    "observation_invalid_number",
    "observation.refuel.maxUndetectedLitres",
  );
});

Deno.test("T13-091 maxUndetectedLitres null is rejected, not read as unknown", () => {
  expectError(
    variant((value) => (value.refuel.maxUndetectedLitres = null)),
    "observation_null",
    "observation.refuel.maxUndetectedLitres",
  );
});

Deno.test("T13-092 refuel firstAt outside the interval is rejected", () => {
  expectError(
    variant((value) => (value.refuel.firstAt = "2026-11-12T10:00:19.951Z")),
    "observation_fact_outside_interval",
    "observation.refuel.firstAt",
  );
});

Deno.test("T13-093 refuel with a duplicate per-fact sample count is rejected", () => {
  expectError(
    variant((value) => (value.refuel.samples = 41)),
    "observation_unknown_key",
    "observation.refuel",
  );
});

for (const value of ["unchanged", "changed"]) {
  Deno.test(`T13-094 driverNameContinuity ${value} is descriptive`, () => {
    const parsed = expectOk(
      variant((v) => (v.driverNameContinuity.value = value)),
    );
    assertEquals(parsed.driverNameContinuity?.value, value, "value");
    assert(!("driverChanged" in parsed), "must not map to driverChanged");
  });
}

Deno.test("T13-095 driverNameContinuity unknown enum is rejected", () => {
  expectError(
    variant((value) => (value.driverNameContinuity.value = "same")),
    "observation_invalid_enum",
    "observation.driverNameContinuity.value",
  );
});

Deno.test("T13-096 driverNameContinuity null is rejected", () => {
  expectError(
    variant((value) => (value.driverNameContinuity = null)),
    "observation_null",
    "observation.driverNameContinuity",
  );
});

Deno.test("T13-097 driverNameContinuity duplicate coverage key is rejected", () => {
  expectError(
    variant((value) => (value.driverNameContinuity.samples = 41)),
    "observation_unknown_key",
    "observation.driverNameContinuity",
  );
});

// ---------------------------------------------------------------------------
// Context: four required descriptors, no PII, byte caps, no trimming
// ---------------------------------------------------------------------------

for (const field of ["carId", "trackId", "trackName", "trackConfig"]) {
  Deno.test(`T13-100 context requires ${field}`, () => {
    expectError(
      variant((value) => delete value.context[field]),
      "observation_missing_key",
      `observation.context.${field}`,
    );
  });
}

Deno.test("T13-101 context empty group is rejected", () => {
  expectError(
    variant((value) => (value.context = {})),
    "observation_missing_key",
    "observation.context.carId",
  );
});

Deno.test("T13-102 context with only an optional field is rejected", () => {
  expectError(
    variant((value) => (value.context = { sessionNumber: 0 })),
    "observation_missing_key",
    "observation.context.carId",
  );
});

Deno.test("T13-103 context null is rejected", () => {
  expectError(
    variant((value) => (value.context = null)),
    "observation_null",
    "observation.context",
  );
});

Deno.test("T13-104 context has no owner field", () => {
  expectError(
    variant((value) => (value.context.ownerUserId = UUID_A)),
    "observation_unknown_key",
    "observation.context",
  );
});

Deno.test("T13-105 context has no duplicate sample count", () => {
  expectError(
    variant((value) => (value.context.samples = 41)),
    "observation_unknown_key",
    "observation.context",
  );
});

Deno.test("T13-106 carId 64 UTF-8 bytes is accepted", () => {
  expectOk(variant((value) => (value.context.carId = "a".repeat(64))));
});

Deno.test("T13-107 carId 65 UTF-8 bytes is rejected", () => {
  expectError(
    variant((value) => (value.context.carId = "a".repeat(65))),
    "observation_invalid_text",
    "observation.context.carId",
  );
});

Deno.test("T13-108 carId 64 multibyte bytes is accepted", () => {
  expectOk(variant((value) => (value.context.carId = "é".repeat(32))));
});

Deno.test("T13-109 carId 66 multibyte bytes is rejected", () => {
  expectError(
    variant((value) => (value.context.carId = "é".repeat(33))),
    "observation_invalid_text",
    "observation.context.carId",
  );
});

Deno.test("T13-110 trackName 128 UTF-8 bytes is accepted", () => {
  expectOk(variant((value) => (value.context.trackName = "a".repeat(128))));
});

Deno.test("T13-111 trackName 129 UTF-8 bytes is rejected", () => {
  expectError(
    variant((value) => (value.context.trackName = "a".repeat(129))),
    "observation_invalid_text",
    "observation.context.trackName",
  );
});

Deno.test("T13-112 trackConfig 128 UTF-8 bytes is accepted", () => {
  expectOk(variant((value) => (value.context.trackConfig = "a".repeat(128))));
});

Deno.test("T13-113 trackConfig 129 UTF-8 bytes is rejected", () => {
  expectError(
    variant((value) => (value.context.trackConfig = "a".repeat(129))),
    "observation_invalid_text",
    "observation.context.trackConfig",
  );
});

for (
  const [label, text] of [
    ["newline", "Spa\n"],
    ["C0 control", "Spa\u0001"],
    ["DEL", "Spa\u007f"],
    ["C1 control", "Spa\u0085"],
  ] as const
) {
  Deno.test(`T13-114 trackName ${label} is rejected`, () => {
    expectError(
      variant((value) => (value.context.trackName = text)),
      "observation_invalid_control",
      "observation.context.trackName",
    );
  });
}

Deno.test("T13-115 empty text is rejected", () => {
  expectError(
    variant((value) => (value.context.carId = "")),
    "observation_invalid_text",
    "observation.context.carId",
  );
});

Deno.test("T13-116 text is not trimmed", () => {
  const parsed = expectOk(
    variant((value) => (value.context.trackName = "  Spa  ")),
  );
  assertEquals(parsed.context?.trackName, "  Spa  ", "raw text");
});

for (
  const [label, trackId, code] of [
    ["zero", 0, "observation_invalid_integer"],
    ["negative", -1, "observation_invalid_integer"],
    ["fraction", 1.5, "observation_invalid_integer"],
    ["string", "42", "observation_invalid_type"],
    ["above max", 2_147_483_648, "observation_invalid_integer"],
  ] as const
) {
  Deno.test(`T13-117 trackId ${label} is rejected`, () => {
    expectError(
      variant((value) => (value.context.trackId = trackId)),
      code,
      "observation.context.trackId",
    );
  });
}

for (
  const [label, trackId] of [["minimum", 1], [
    "maximum",
    2_147_483_647,
  ]] as const
) {
  Deno.test(`T13-118 trackId ${label} is accepted`, () => {
    expectOk(variant((value) => (value.context.trackId = trackId)));
  });
}

for (
  const [label, sessionId, code] of [
    ["negative", -1, "observation_invalid_integer"],
    ["above max", 2_147_483_648, "observation_invalid_integer"],
    ["fraction", 1.5, "observation_invalid_integer"],
  ] as const
) {
  Deno.test(`T13-119 sessionUniqueId ${label} is rejected`, () => {
    expectError(
      variant((value) => (value.context.sessionUniqueId = sessionId)),
      code,
      "observation.context.sessionUniqueId",
    );
  });
}

for (
  const [label, sessionId] of [["zero", 0], ["maximum", 2_147_483_647]] as const
) {
  Deno.test(`T13-120 sessionUniqueId ${label} is accepted as a counter`, () => {
    expectOk(variant((value) => (value.context.sessionUniqueId = sessionId)));
  });
}

for (
  const [label, sessionNumber, code] of [
    ["negative", -1, "observation_invalid_integer"],
    ["above max", 1001, "observation_invalid_integer"],
    ["fraction", 1.5, "observation_invalid_integer"],
  ] as const
) {
  Deno.test(`T13-121 sessionNumber ${label} is rejected`, () => {
    expectError(
      variant((value) => (value.context.sessionNumber = sessionNumber)),
      code,
      "observation.context.sessionNumber",
    );
  });
}

for (
  const [label, sessionNumber] of [["zero", 0], ["maximum", 1000]] as const
) {
  Deno.test(`T13-122 sessionNumber ${label} is accepted as a counter`, () => {
    expectOk(variant((value) => (value.context.sessionNumber = sessionNumber)));
  });
}

Deno.test("T13-123 context with exactly four required descriptors is accepted", () => {
  const value = variant((v) => {
    delete v.context.sessionUniqueId;
    delete v.context.sessionNumber;
  });
  const parsed = expectOk(value);
  assert(!("sessionUniqueId" in parsed.context!), "optional must stay absent");
  assert(!("sessionNumber" in parsed.context!), "optional must stay absent");
});

// ---------------------------------------------------------------------------
// UUID format, raw preservation and case-equivalent comparison
// ---------------------------------------------------------------------------

Deno.test("T13-130 uppercase UUID is accepted and returned unaltered", () => {
  const parsed = expectOk(
    variant((value) => (value.capture.deviceId = UUID_A_UPPER)),
  );
  assertEquals(parsed.capture.deviceId, UUID_A_UPPER, "raw UUID");
});

for (
  const [label, token] of [
    ["braces", `{${UUID_A}}`],
    ["urn prefix", `urn:uuid:${UUID_A}`],
    ["missing character", UUID_A.slice(0, 35)],
    ["non-hex", `g${UUID_A.slice(1)}`],
    ["version 6", `${UUID_A.slice(0, 14)}6${UUID_A.slice(15)}`],
    ["version 0", `${UUID_A.slice(0, 14)}0${UUID_A.slice(15)}`],
    ["variant 7", `${UUID_A.slice(0, 19)}7${UUID_A.slice(20)}`],
    ["variant c", `${UUID_A.slice(0, 19)}c${UUID_A.slice(20)}`],
  ] as const
) {
  Deno.test(`T13-131 malformed UUID ${label} is rejected without repair`, () => {
    expectError(
      variant((value) => (value.capture.deviceId = token)),
      "observation_invalid_uuid",
      "observation.capture.deviceId",
    );
  });
}

Deno.test("T13-132 classifier accepts case-equivalent UUIDs after format validation", () => {
  const row = {
    observation: variant((value) => (value.capture.deviceId = UUID_A_UPPER)),
    startedAt: ROW_START,
    endedAt: ROW_END,
  };
  const result = expectDisposition(
    row,
    "accept",
    UUID_A,
    "observation_accepted",
  );
  assertEquals(result.disposition, "accept");
  if (result.disposition === "accept") {
    assertEquals(
      result.observation.capture.deviceId,
      UUID_A_UPPER,
      "raw UUID retained",
    );
  }
});

Deno.test("T13-133 classifier rejects a malformed capture UUID even with a valid device token", () => {
  const row = {
    observation: variant((value) => (value.capture.deviceId = `{${UUID_A}}`)),
    startedAt: ROW_START,
    endedAt: ROW_END,
  };
  expectDisposition(row, "reject", UUID_A, "observation_invalid_uuid");
});

Deno.test("T13-134 classifier quarantines a valid A observation under authenticated B", () => {
  const row = {
    observation: variant((value) => (value.capture.deviceId = UUID_A)),
    startedAt: ROW_START,
    endedAt: ROW_END,
  };
  const result = expectDisposition(
    row,
    "quarantine",
    UUID_B,
    "observation_device_mismatch",
  );
  assertEquals(
    result.observation,
    null,
    "quarantine must not expose a persistable block",
  );
});

Deno.test("T13-135 classifier does not treat an invalid auth token as a device mismatch", () => {
  const row = {
    observation: validObservation(),
    startedAt: ROW_START,
    endedAt: ROW_END,
  };
  expectDisposition(row, "reject", "not-a-uuid", "auth_device_invalid");
});

Deno.test("T13-136 classifier rejects a missing auth token for an observed row", () => {
  const row = {
    observation: validObservation(),
    startedAt: ROW_START,
    endedAt: ROW_END,
  };
  const result = classifyLapObservation({
    row,
    authenticatedDeviceId: undefined,
  });
  assertEquals(result.disposition, "reject", "disposition");
  assertEquals(result.code, "auth_device_invalid", "code");
});

// ---------------------------------------------------------------------------
// Classifier: row scope, row time bounds and explicit edge tolerance
// ---------------------------------------------------------------------------

Deno.test("T13-140 absent observation is legacy, not an upgrade or owner claim", () => {
  const result = expectDisposition(
    { startedAt: ROW_START, endedAt: ROW_END },
    "legacy",
    UUID_A,
    "observation_absent",
  );
  assertEquals(result.observation, null, "legacy has no observation");
});

Deno.test("T13-141 observation null is a closed row rejection, never legacy", () => {
  expectDisposition(
    { observation: null, startedAt: ROW_START, endedAt: ROW_END },
    "reject",
    UUID_A,
    "observation_null",
  );
});

Deno.test("T13-142 valid observation with matching device and bounds is accepted", () => {
  const result = expectDisposition(
    { observation: validObservation(), startedAt: ROW_START, endedAt: ROW_END },
    "accept",
    UUID_A,
    "observation_accepted",
  );
  assert(result.disposition === "accept");
  assertEquals(result.observation.pitRoad?.value, true, "positive pitRoad");
  assertEquals(
    result.observation.refuel?.observedAddedLitres,
    2.4,
    "positive refuel",
  );
});

Deno.test("T13-143 first sample before the raw row start is rejected", () => {
  const row = {
    observation: withInterval({ firstSampleAt: "2026-11-12T09:59:59.999Z" }),
    startedAt: ROW_START,
    endedAt: ROW_END,
  };
  expectDisposition(row, "reject", UUID_A, "observation_interval_outside_row");
});

Deno.test("T13-144 last sample after the raw row end is rejected", () => {
  const row = {
    observation: withInterval({ lastSampleAt: "2026-11-12T10:00:20.001Z" }),
    startedAt: ROW_START,
    endedAt: ROW_END,
  };
  expectDisposition(row, "reject", UUID_A, "observation_interval_outside_row");
});

Deno.test("T13-145 row start is required for an observed row", () => {
  const row = { observation: validObservation(), endedAt: ROW_END };
  expectDisposition(row, "reject", UUID_A, "row_time_invalid");
});

Deno.test("T13-146 row start must parse as bounded UTC", () => {
  const row = {
    observation: validObservation(),
    startedAt: "2026-11-12 10:00:00",
    endedAt: ROW_END,
  };
  expectDisposition(row, "reject", UUID_A, "row_time_invalid");
});

Deno.test("T13-147 row end before row start is rejected", () => {
  const row = {
    observation: validObservation(),
    startedAt: ROW_END,
    endedAt: ROW_START,
  };
  expectDisposition(row, "reject", UUID_A, "row_time_invalid");
});

Deno.test("T13-148 edgeBefore exactly at the 1 ms tolerance is accepted", () => {
  const row = {
    observation: withInterval({
      edgeBeforeSeconds: 0.051,
      unknownSeconds: 0.101,
    }),
    startedAt: ROW_START,
    endedAt: ROW_END,
  };
  expectDisposition(row, "accept", UUID_A, "observation_accepted");
});

Deno.test("T13-149 edgeBefore beyond the 1 ms tolerance is rejected", () => {
  const row = {
    observation: withInterval({
      edgeBeforeSeconds: 0.052,
      unknownSeconds: 0.102,
    }),
    startedAt: ROW_START,
    endedAt: ROW_END,
  };
  expectDisposition(row, "reject", UUID_A, "observation_edge_mismatch");
});

Deno.test("T13-150 edgeAfter beyond the 1 ms tolerance is rejected", () => {
  const row = {
    observation: withInterval({
      edgeAfterSeconds: 0.052,
      unknownSeconds: 0.102,
    }),
    startedAt: ROW_START,
    endedAt: ROW_END,
  };
  expectDisposition(row, "reject", UUID_A, "observation_edge_mismatch");
});

Deno.test("T13-151 zero edges at exact row bounds are accepted", () => {
  const observation = withInterval({
    firstSampleAt: ROW_START,
    lastSampleAt: ROW_END,
    samples: 41,
    maxGapSeconds: 0.5,
    edgeBeforeSeconds: 0,
    edgeAfterSeconds: 0,
    unknownSeconds: 0,
  });
  expectDisposition(
    { observation, startedAt: ROW_START, endedAt: ROW_END },
    "accept",
    UUID_A,
    "observation_accepted",
  );
});

Deno.test("T13-152 classifier result has no frame-level coreAccepted flag", () => {
  const result = classify({
    observation: validObservation(),
    startedAt: ROW_START,
    endedAt: ROW_END,
  });
  assert(!("coreAccepted" in result), "no coreAccepted");
  assert(!("frameAccepted" in result), "no frameAccepted");
  assertEquals(result.disposition, "accept");
});

// ---------------------------------------------------------------------------
// Stateless batch harness: one row never aborts its neighbours
// ---------------------------------------------------------------------------

Deno.test("T13-160 batch: B row quarantined while A and legacy rows proceed", () => {
  const rows = [
    {
      observation: variant((value) => (value.capture.deviceId = UUID_B)),
      startedAt: ROW_START,
      endedAt: ROW_END,
    },
    { observation: validObservation(), startedAt: ROW_START, endedAt: ROW_END },
    { startedAt: ROW_START, endedAt: ROW_END },
  ];
  const results = rows.map((row) => classify(row, UUID_A));
  assertEquals(results.map((result) => result.disposition), [
    "quarantine",
    "accept",
    "legacy",
  ], "dispositions");
});

Deno.test("T13-161 batch: malformed observation does not stop the next valid row", () => {
  const rows = [
    {
      observation: variant((value) => (value.version = 3)),
      startedAt: ROW_START,
      endedAt: ROW_END,
    },
    { observation: validObservation(), startedAt: ROW_START, endedAt: ROW_END },
  ];
  const results = rows.map((row) => classify(row, UUID_A));
  assertEquals(results.map((result) => result.disposition), [
    "reject",
    "accept",
  ], "dispositions");
});

Deno.test("T13-162 batch: null observation rejects only its own row", () => {
  const rows = [
    { observation: null, startedAt: ROW_START, endedAt: ROW_END },
    { observation: validObservation(), startedAt: ROW_START, endedAt: ROW_END },
    { startedAt: ROW_START, endedAt: ROW_END },
  ];
  const results = rows.map((row) => classify(row, UUID_A));
  assertEquals(results.map((result) => result.disposition), [
    "reject",
    "accept",
    "legacy",
  ], "dispositions");
});

// ---------------------------------------------------------------------------
// Byte cap, JSON safety, immutability and no BigInt in public results
// ---------------------------------------------------------------------------

Deno.test("T13-170 exact 2048-byte multibyte value passes the cap and hits key validation", () => {
  const value = paddedObservation(2048);
  expectError(value, "observation_unknown_key", "observation");
});

Deno.test("T13-171 2049-byte multibyte value is rejected by the cap before the walk", () => {
  const value = paddedObservation(2049);
  expectError(value, "observation_too_large", "observation");
});

Deno.test("T13-172 a normal valid block is far below the wire cap", () => {
  const size = utf8Bytes(JSON.stringify(validObservation()));
  assert(size < 2048, `valid block unexpectedly large: ${size}`);
  expectOk(validObservation());
});

Deno.test("T13-173 circular input is rejected as non-JSON without throwing", () => {
  const value: Record<string, any> = validObservation();
  value.self = value;
  expectError(value, "observation_not_json", "observation");
});

Deno.test("T13-174 BigInt input is rejected as non-JSON without throwing", () => {
  const value = variant((v) => (v.extra = 1n));
  expectError(value, "observation_not_json", "observation");
});

Deno.test("T13-175 Date object input does not crash and is not an observation", () => {
  const result = parseLapObservation(new Date());
  assert(!result.ok, "Date is not an observation");
});

Deno.test("T13-176 prototype-poison key is an unknown key and does not pollute", () => {
  const poisoned = JSON.parse(
    JSON.stringify(validObservation()).replace(
      '{"version":1,',
      '{"__proto__":{"polluted":true},"version":1,',
    ),
  );
  expectError(poisoned, "observation_unknown_key", "observation");
  assertEquals(
    ({} as Record<string, unknown>).polluted,
    undefined,
    "global prototype",
  );
});

Deno.test("T13-177 parser does not mutate or trim a frozen input", () => {
  const input = validObservation();
  input.context.trackName = "  Spa  ";
  const before = JSON.stringify(input);
  deepFreeze(input);
  const parsed = expectOk(input);
  assertEquals(JSON.stringify(input), before, "input bytes");
  assertEquals(parsed.context?.trackName, "  Spa  ", "raw text");
  assert(parsed !== input, "new root object");
  assert(parsed.context !== input.context, "new context object");
});

Deno.test("T13-178 accepted result serializes as public JSON without BigInt", () => {
  const result = parseLapObservation(validObservation());
  assert(result.ok, "must parse");
  const text = JSON.stringify(result);
  assert(typeof text === "string");
  assert(!text.includes("bigint"), "no BigInt");
});

Deno.test("T13-179 rejected result serializes as public JSON without BigInt", () => {
  const result = parseLapObservation(validObservation());
  assert(result.ok, "must parse for this fixture");
  const rejected = classify({
    observation: null,
    startedAt: ROW_START,
    endedAt: ROW_END,
  });
  const text = JSON.stringify(rejected);
  assert(typeof text === "string");
  assertEquals(rejected.observation, null);
});

Deno.test("T13-180 valid 20 s block really contains positive and descriptive facts", () => {
  const parsed = expectOk(validObservation());
  assert(parsed.interval.samples === 41, "samples");
  assert(parsed.interval.maxGapSeconds === 0.5, "maxGap");
  assert(parsed.pitRoad?.value === true, "pitRoad positive");
  assert((parsed.refuel?.observedAddedLitres ?? 0) > 0, "refuel positive");
  assert(parsed.context?.trackId === 42, "trackId");
  assert(!("complete" in parsed), "no completeness claim");
  assert(!("unknown" in parsed), "no null placeholder");
});

Deno.test("T13-181 an 80 %-like 120 s coverage never becomes a false/0 or complete claim", () => {
  const value = withInterval({
    firstSampleAt: "2026-11-12T10:00:00.050Z",
    lastSampleAt: "2026-11-12T10:01:59.950Z",
    samples: 121,
    maxGapSeconds: 2,
    unknownSeconds: 23.95,
    edgeBeforeSeconds: 0.05,
    edgeAfterSeconds: 0.05,
  });
  value.pitRoad.firstAt = "2026-11-12T10:00:30.000Z";
  value.refuel.firstAt = "2026-11-12T10:01:00.000Z";
  const parsed = expectOk(value);
  assertEquals(parsed.interval.unknownSeconds, 23.95, "unknown indicator");
  assert(!("complete" in parsed), "no complete claim");
  assert(!("pitLap" in parsed), "no false pitLap");
  assert(!("fuelAdded" in parsed), "no zero fuel fact");
  assert(!("driverChanged" in parsed), "no false driverChanged");
});

// ---------------------------------------------------------------------------
// Exact numeric bounds: literal 1 ms edges and exact scalar stats
// ---------------------------------------------------------------------------

Deno.test("T13-200 edge difference of exactly 1 ms is accepted", () => {
  const row = {
    observation: variant((value) => {
      value.interval.edgeBeforeSeconds = 0;
    }),
    startedAt: "2026-11-12T10:00:00.049Z",
    endedAt: ROW_END,
  };
  expectDisposition(row, "accept", UUID_A, "observation_accepted");
});

Deno.test("T13-201 edge 1 ms + 0.5 ns is rejected", () => {
  // Actual before-edge is 0 (row and first sample both start at .050).
  const row = {
    observation: variant((value) => {
      value.interval.edgeBeforeSeconds = 0.0010000005;
      value.interval.unknownSeconds = 0.0510000005;
    }),
    startedAt: SAMPLE_START,
    endedAt: ROW_END,
  };
  expectDisposition(
    row,
    "reject",
    UUID_A,
    "observation_edge_mismatch",
  );
});

Deno.test("T13-202 edge 1 ms + 100 ns is still rejected", () => {
  const row = {
    observation: variant((value) => {
      value.interval.edgeBeforeSeconds = 0;
    }),
    startedAt: "2026-11-12T10:00:00.0489999Z",
    endedAt: ROW_END,
  };
  expectDisposition(
    row,
    "reject",
    UUID_A,
    "observation_edge_mismatch",
  );
});

Deno.test("T13-203 edge one ULP over 1 ms rejects, one ULP under accepts", () => {
  const over = nextFloat(0.001, 1);
  const under = nextFloat(0.001, -1);
  assert(over > 0.001, "one ULP above 1 ms must be greater");
  assert(under < 0.001, "one ULP below 1 ms must be smaller");

  expectDisposition(
    {
      observation: variant((value) => {
        value.interval.edgeBeforeSeconds = over;
        value.interval.unknownSeconds = 1;
      }),
      startedAt: SAMPLE_START,
      endedAt: ROW_END,
    },
    "reject",
    UUID_A,
    "observation_edge_mismatch",
  );

  const accepted = classify({
    observation: variant((value) => {
      value.interval.edgeBeforeSeconds = under;
      value.interval.unknownSeconds = 1;
    }),
    startedAt: SAMPLE_START,
    endedAt: ROW_END,
  });
  assertEquals(accepted.disposition, "accept", "one ULP under 1 ms");
});

Deno.test("T13-204 maxGap below the exact mean is rejected", () => {
  // Original SPEC P31 literal, then the adjacent double just below 0.4975.
  expectError(
    withInterval({ maxGapSeconds: 0.4974999999 }),
    "observation_max_gap_inconsistent",
    "observation.interval.maxGapSeconds",
  );
  const below = nextFloat(0.4975, -1);
  assert(below < 0.4975, "one ULP below the mean");
  expectError(
    withInterval({ maxGapSeconds: below }),
    "observation_max_gap_inconsistent",
    "observation.interval.maxGapSeconds",
  );
});

Deno.test("T13-205 maxGap one ULP above the exact mean is accepted", () => {
  const above = nextFloat(0.4975, 1);
  assert(above > 0.4975, "one ULP above the mean");
  const parsed = expectOk(withInterval({ maxGapSeconds: above }));
  assertEquals(
    parsed.interval.maxGapSeconds,
    above,
    "accepted maxGap is not rounded",
  );
});

Deno.test("T13-206 maxGap above the exact span is rejected", () => {
  // Original SPEC P32 literal, then the adjacent double just above 19.9.
  expectError(
    withInterval({
      maxGapSeconds: 19.9000000001,
      unknownSeconds: 20.0000000002,
    }),
    "observation_max_gap_inconsistent",
    "observation.interval.maxGapSeconds",
  );
  const above = nextFloat(19.9, 1);
  assert(above > 19.9, "one ULP above the span");
  expectError(
    withInterval({ maxGapSeconds: above }),
    "observation_max_gap_inconsistent",
    "observation.interval.maxGapSeconds",
  );
});

Deno.test("T13-207 maxGap one ULP below the exact span is accepted", () => {
  const below = nextFloat(19.9, -1);
  assert(below < 19.9, "one ULP below the span");
  // maxGap > 1 means the full gap is part of the unknown lower bound; with
  // edges 0.05+0.05 the only consistent unknown is the 20.0 s lap window.
  expectOk(withInterval({ maxGapSeconds: below, unknownSeconds: 20 }));
});

Deno.test("T13-208 unknown below the edge sum is rejected", () => {
  // Original SPEC P33 literal, then the adjacent double just below 0.1.
  expectError(
    withInterval({ unknownSeconds: 0.0999999999 }),
    "observation_unknown_seconds_inconsistent",
    "observation.interval.unknownSeconds",
  );
  const below = nextFloat(0.1, -1);
  assert(below < 0.1, "one ULP below the edges");
  expectError(
    withInterval({ unknownSeconds: below }),
    "observation_unknown_seconds_inconsistent",
    "observation.interval.unknownSeconds",
  );
});

Deno.test("T13-209 unknown exactly equal to the edge sum is accepted", () => {
  const parsed = expectOk(withInterval({ unknownSeconds: 0.1 }));
  assertEquals(parsed.interval.unknownSeconds, 0.1, "exact unknown");
});

Deno.test("T13-210 0.1 + 0.2 edges need exactly 0.3, not a float artefact", () => {
  const accepted = withInterval({
    edgeBeforeSeconds: 0.1,
    edgeAfterSeconds: 0.2,
    unknownSeconds: 0.3,
  });
  expectOk(accepted);

  const rejected = withInterval({
    edgeBeforeSeconds: 0.1,
    edgeAfterSeconds: 0.2,
    unknownSeconds: 0.2999999999,
  });
  expectError(
    rejected,
    "observation_unknown_seconds_inconsistent",
    "observation.interval.unknownSeconds",
  );
});

Deno.test("T13-211 scientific 3e-7 stats close exactly in both directions", () => {
  const interval = {
    firstSampleAt: "2026-11-12T10:00:00.000Z",
    lastSampleAt: "2026-11-12T10:00:00.0000003Z",
    samples: 2,
    maxGapSeconds: 3e-7,
    unknownSeconds: 0,
    edgeBeforeSeconds: 0,
    edgeAfterSeconds: 0,
  };
  expectOk(minimalObservation(interval));

  const over = nextFloat(3e-7, 1);
  const under = nextFloat(3e-7, -1);
  expectError(
    minimalObservation({ ...interval, maxGapSeconds: over }),
    "observation_max_gap_inconsistent",
    "observation.interval.maxGapSeconds",
  );
  expectError(
    minimalObservation({ ...interval, maxGapSeconds: under }),
    "observation_max_gap_inconsistent",
    "observation.interval.maxGapSeconds",
  );
  expectError(
    minimalObservation({ ...interval, unknownSeconds: over }),
    "observation_unknown_seconds_inconsistent",
    "observation.interval.unknownSeconds",
  );
});

Deno.test("T13-212 subnormal counters are positive and overage is closed", () => {
  const subnormal = Number.MIN_VALUE;
  const interval = {
    firstSampleAt: ROW_START,
    lastSampleAt: ROW_START,
    samples: 1,
    maxGapSeconds: 0,
    unknownSeconds: subnormal,
    edgeBeforeSeconds: subnormal,
    edgeAfterSeconds: 0,
  };
  const parsed = expectOk(minimalObservation(interval));
  assertEquals(
    parsed.interval.unknownSeconds,
    subnormal,
    "subnormal unknown preserved",
  );
  assertEquals(
    parsed.interval.edgeBeforeSeconds,
    subnormal,
    "subnormal edge preserved",
  );

  expectError(
    minimalObservation({
      ...interval,
      unknownSeconds: nextFloat(subnormal, 1),
    }),
    "observation_unknown_seconds_inconsistent",
    "observation.interval.unknownSeconds",
  );
});

Deno.test("T13-213 large sample count uses the exact cross-product mean", () => {
  const interval = {
    firstSampleAt: "2026-11-12T10:00:00.000Z",
    lastSampleAt: "2026-11-12T10:00:00.999999Z",
    samples: 1_000_000,
    maxGapSeconds: 0.000001,
    unknownSeconds: 0,
    edgeBeforeSeconds: 0,
    edgeAfterSeconds: 0,
  };
  const parsed = expectOk(minimalObservation(interval));
  assertEquals(parsed.interval.samples, 1_000_000, "samples");

  // 0.999999 s over 999999 intervals is exactly 1e-6 s.
  expectError(
    minimalObservation({
      ...interval,
      maxGapSeconds: nextFloat(0.000001, -1),
    }),
    "observation_max_gap_inconsistent",
    "observation.interval.maxGapSeconds",
  );
  const above = minimalObservation({
    ...interval,
    maxGapSeconds: nextFloat(0.000001, 1),
  });
  expectOk(above);
});

// ---------------------------------------------------------------------------
// Real V3 receiver import: still rejects the block by design (UNWIRED)
// ---------------------------------------------------------------------------

Deno.test("T13-190 real parseLapSummariesReport accepts legacy and rejects observation", () => {
  const legacy = {
    summaryUid: UUID_A,
    lapNumber: 1,
    startedAt: ROW_START,
    endedAt: ROW_END,
  };
  const observed = {
    summaryUid: UUID_B,
    lapNumber: 2,
    startedAt: ROW_START,
    endedAt: ROW_END,
    observation: validObservation(),
  };
  const report = parseLapSummariesReport([legacy, observed]);
  assertEquals(report.blockError, null, "block error");
  assertEquals(report.received, 2, "received");
  assertEquals(report.rows.length, 1, "accepted rows");
  assertEquals(report.rejected.length, 1, "rejected rows");
  assertEquals(report.rejected[0].index, 1, "rejected index");
  assert(
    report.rejected[0].reason.includes("contains unknown fields"),
    "real receiver reason",
  );
  assert(!("observation" in report.rows[0]), "legacy row has no observation");
});
