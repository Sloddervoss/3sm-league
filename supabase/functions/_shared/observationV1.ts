/**
 * T13 capture-only observation v1 — pure parser and row-scope classifier.
 *
 * This module is deliberately standalone:
 *
 *  - no Deno/npm imports, no SDK, no runtime I/O, no logging, no clock;
 *  - never throws for ordinary JSON input;
 *  - returns a discriminated result with a stable code and path;
 *  - does not mutate its input and preserves validated raw values (including
 *    UUID case) for a future raw hash;
 *  - a bad observation closes only its own measurement row. The current V3
 *    frame and its other rows are outside this function's result shape.
 *
 * It is not wired into `simhub-ingest-v3`, the outbox, the producer or the
 * database. The existing receiver still rejects `observation` by design.
 */

export const OBSERVATION_V1_VERSION = 1 as const;

/** Compact `JSON.stringify` + UTF-8 cap for the observation value on the wire. */
export const OBSERVATION_V1_MAX_BYTES = 2048;

/** Upper bounds copied from the prior proposal; raw SDK sources are UNVERIFIED. */
export const OBSERVATION_V1_MAX_SAMPLES = 1_000_000;
export const OBSERVATION_V1_MAX_SECONDS = 86_400;

/**
 * Explicit tolerance between `firstSampleAt`/`lastSampleAt` and the raw row
 * bounds. The producer serialises milliseconds, so 1 ms is the only allowance;
 * there is no broader epsilon and no rounding.
 */
export const OBSERVATION_EDGE_TOLERANCE_SECONDS = 0.001;

const NUMERIC_EPSILON = 1e-9;
const TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,7}))?Z$/;
// Existing receiver contract: canonical RFC 4122 text, version 1..5 and
// variant 8/9/a/b. Format is checked before any semantic comparison.
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL_PATTERN = /\p{Cc}/u;

export type ObservationV1 = {
  version: 1;
  capture: { deviceId: string };
  interval: {
    firstSampleAt: string;
    lastSampleAt: string;
    samples: number;
    maxGapSeconds: number;
    unknownSeconds: number;
    edgeBeforeSeconds: number;
    edgeAfterSeconds: number;
  };
  pitRoad?: { value: true; firstAt: string };
  refuel?: {
    observedAddedLitres: number;
    firstAt: string;
    positiveSteps: number;
    resolutionLitres: number;
    maxUndetectedLitres?: number;
  };
  driverNameContinuity?: { value: "unchanged" | "changed" };
  context?: {
    carId: string;
    trackId: number;
    trackName: string;
    trackConfig: string;
    sessionUniqueId?: number;
    sessionNumber?: number;
  };
};

export type ObservationErrorCode =
  | "observation_not_object"
  | "observation_null"
  | "observation_not_json"
  | "observation_too_large"
  | "observation_unknown_key"
  | "observation_missing_key"
  | "observation_invalid_version"
  | "observation_invalid_type"
  | "observation_invalid_integer"
  | "observation_invalid_number"
  | "observation_invalid_timestamp"
  | "observation_invalid_uuid"
  | "observation_invalid_text"
  | "observation_invalid_control"
  | "observation_invalid_enum"
  | "observation_negative_fact"
  | "observation_no_fact"
  | "observation_time_order"
  | "observation_bounds_inconsistent"
  | "observation_max_gap_inconsistent"
  | "observation_unknown_seconds_inconsistent"
  | "observation_fact_outside_interval";

export type ParseLapObservationResult =
  | { ok: true; observation: ObservationV1 }
  | { ok: false; code: ObservationErrorCode; path: string };

export type ClassifyLapObservationInput = {
  /** Raw lap-summary row, or at least its observation and raw row bounds. */
  row: {
    observation?: unknown;
    startedAt?: unknown;
    endedAt?: unknown;
  };
  /** Independently authenticated device UUID from the source envelope. */
  authenticatedDeviceId: unknown;
};

export type ClassifierErrorCode =
  | "row_invalid"
  | "auth_device_invalid"
  | "row_time_invalid"
  | "observation_interval_outside_row"
  | "observation_edge_mismatch";

export type ClassifyLapObservationResult =
  | {
    disposition: "accept";
    code: "observation_accepted";
    path: "observation";
    observation: ObservationV1;
  }
  | {
    disposition: "legacy";
    code: "observation_absent";
    path: "observation";
    observation: null;
  }
  | {
    disposition: "quarantine";
    code: "observation_device_mismatch";
    path: "observation.capture.deviceId";
    observation: null;
  }
  | {
    disposition: "reject";
    code: ObservationErrorCode | ClassifierErrorCode;
    path: string;
    observation: null;
  };

type Failure = { ok: false; code: ObservationErrorCode; path: string };
type ValueResult = { ok: true; value: unknown } | Failure;

const fail = (code: ObservationErrorCode, path: string): Failure => ({
  ok: false,
  code,
  path,
});
const isFailure = (value: unknown): value is Failure =>
  typeof value === "object" && value !== null &&
  (value as { ok?: unknown }).ok === false;

const hasOwn = (record: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const unknownKey = (
  record: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): Failure | null => {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) return fail("observation_unknown_key", path);
  }
  return null;
};

const requiredValue = (
  record: Record<string, unknown>,
  key: string,
  path: string,
): ValueResult => {
  if (!hasOwn(record, key)) return fail("observation_missing_key", path);
  const value = record[key];
  if (value === null) return fail("observation_null", path);
  return { ok: true, value };
};

const optionalValue = (
  record: Record<string, unknown>,
  key: string,
  path: string,
): ValueResult => {
  if (!hasOwn(record, key)) return { ok: true, value: undefined };
  const value = record[key];
  if (value === null) return fail("observation_null", path);
  return { ok: true, value };
};

const numberIn = (
  value: unknown,
  path: string,
  min: number,
  max: number,
): { ok: true; value: number } | Failure => {
  if (typeof value !== "number") return fail("observation_invalid_type", path);
  if (!Number.isFinite(value) || value < min || value > max) {
    return fail("observation_invalid_number", path);
  }
  return { ok: true, value };
};

const integerIn = (
  value: unknown,
  path: string,
  min: number,
  max: number,
): { ok: true; value: number } | Failure => {
  if (typeof value !== "number") return fail("observation_invalid_type", path);
  if (!Number.isFinite(value)) return fail("observation_invalid_number", path);
  if (!Number.isInteger(value) || value < min || value > max) {
    return fail("observation_invalid_integer", path);
  }
  return { ok: true, value };
};

const textIn = (
  value: unknown,
  path: string,
  maxBytes: number,
): { ok: true; value: string } | Failure => {
  if (typeof value !== "string") return fail("observation_invalid_type", path);
  const bytes = new TextEncoder().encode(value).byteLength;
  if (bytes < 1 || bytes > maxBytes) {
    return fail("observation_invalid_text", path);
  }
  if (CONTROL_PATTERN.test(value)) {
    return fail("observation_invalid_control", path);
  }
  return { ok: true, value };
};

const uuidIn = (
  value: unknown,
  path: string,
): { ok: true; value: string } | Failure => {
  if (typeof value !== "string") return fail("observation_invalid_type", path);
  if (!UUID_PATTERN.test(value)) return fail("observation_invalid_uuid", path);
  return { ok: true, value };
};

const isLeapYear = (year: number): boolean =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

const daysInMonth = (year: number, month: number): number => {
  switch (month) {
    case 2:
      return isLeapYear(year) ? 29 : 28;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    default:
      return 31;
  }
};

/** Days since 1970-01-01, Howard Hinnant's civil-date algorithm. */
const daysFromCivil = (year: number, month: number, day: number): bigint => {
  const y = BigInt(month <= 2 ? year - 1 : year);
  const era = (y >= 0n ? y : y - 399n) / 400n;
  const yoe = y - era * 400n;
  const mp = BigInt(month + (month > 2 ? -3 : 9));
  const doy = (153n * mp + 2n) / 5n + BigInt(day) - 1n;
  const doe = yoe * 365n + yoe / 4n - yoe / 100n + doy;
  return era * 146097n + doe - 719468n;
};

/**
 * Exact UTC nanoseconds since 1970-01-01T00:00:00Z.
 *
 * No `Date.parse`: it truncates to milliseconds and would collapse a 100 ns
 * ordering change. Fraction digits 0..7 are accepted and preserved on the raw
 * output; years are bounded to 1970..9999 and only `Z` is UTC.
 */
const parseTimestampNs = (value: string): bigint | null => {
  const match = TIMESTAMP_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (year < 1970 || year > 9999 || month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  const fraction = match[7] ?? "";
  const fractionNs = fraction.length === 0
    ? 0n
    : BigInt(fraction.padEnd(9, "0"));
  const days = daysFromCivil(year, month, day);
  const seconds = ((days * 24n + BigInt(hour)) * 60n + BigInt(minute)) * 60n +
    BigInt(second);
  return seconds * 1_000_000_000n + fractionNs;
};

const timestampIn = (
  value: unknown,
  path: string,
): { ok: true; value: bigint } | Failure => {
  if (typeof value !== "string") return fail("observation_invalid_type", path);
  const parsed = parseTimestampNs(value);
  if (parsed === null) return fail("observation_invalid_timestamp", path);
  return { ok: true, value: parsed };
};

const secondsBetween = (later: bigint, earlier: bigint): number =>
  Number(later - earlier) / 1_000_000_000;

const parseCapture = (value: unknown): ObservationV1["capture"] | Failure => {
  if (!isRecord(value)) {
    return fail("observation_invalid_type", "observation.capture");
  }
  const extra = unknownKey(value, ["deviceId"], "observation.capture");
  if (extra) return extra;
  const device = requiredValue(
    value,
    "deviceId",
    "observation.capture.deviceId",
  );
  if (!device.ok) return device;
  const uuid = uuidIn(device.value, "observation.capture.deviceId");
  if (!uuid.ok) return uuid;
  return { deviceId: uuid.value };
};

const parseInterval = (value: unknown): ObservationV1["interval"] | Failure => {
  if (!isRecord(value)) {
    return fail("observation_invalid_type", "observation.interval");
  }
  const extra = unknownKey(value, [
    "firstSampleAt",
    "lastSampleAt",
    "samples",
    "maxGapSeconds",
    "unknownSeconds",
    "edgeBeforeSeconds",
    "edgeAfterSeconds",
  ], "observation.interval");
  if (extra) return extra;

  const first = requiredValue(
    value,
    "firstSampleAt",
    "observation.interval.firstSampleAt",
  );
  if (!first.ok) return first;
  const firstAt = timestampIn(
    first.value,
    "observation.interval.firstSampleAt",
  );
  if (!firstAt.ok) return firstAt;

  const last = requiredValue(
    value,
    "lastSampleAt",
    "observation.interval.lastSampleAt",
  );
  if (!last.ok) return last;
  const lastAt = timestampIn(last.value, "observation.interval.lastSampleAt");
  if (!lastAt.ok) return lastAt;

  const samples = requiredValue(
    value,
    "samples",
    "observation.interval.samples",
  );
  if (!samples.ok) return samples;
  const sampleCount = integerIn(
    samples.value,
    "observation.interval.samples",
    1,
    OBSERVATION_V1_MAX_SAMPLES,
  );
  if (!sampleCount.ok) return sampleCount;

  const maxGap = requiredValue(
    value,
    "maxGapSeconds",
    "observation.interval.maxGapSeconds",
  );
  if (!maxGap.ok) return maxGap;
  const maxGapValue = numberIn(
    maxGap.value,
    "observation.interval.maxGapSeconds",
    0,
    OBSERVATION_V1_MAX_SECONDS,
  );
  if (!maxGapValue.ok) return maxGapValue;

  const unknown = requiredValue(
    value,
    "unknownSeconds",
    "observation.interval.unknownSeconds",
  );
  if (!unknown.ok) return unknown;
  const unknownValue = numberIn(
    unknown.value,
    "observation.interval.unknownSeconds",
    0,
    OBSERVATION_V1_MAX_SECONDS,
  );
  if (!unknownValue.ok) return unknownValue;

  const edgeBefore = requiredValue(
    value,
    "edgeBeforeSeconds",
    "observation.interval.edgeBeforeSeconds",
  );
  if (!edgeBefore.ok) return edgeBefore;
  const edgeBeforeValue = numberIn(
    edgeBefore.value,
    "observation.interval.edgeBeforeSeconds",
    0,
    OBSERVATION_V1_MAX_SECONDS,
  );
  if (!edgeBeforeValue.ok) return edgeBeforeValue;

  const edgeAfter = requiredValue(
    value,
    "edgeAfterSeconds",
    "observation.interval.edgeAfterSeconds",
  );
  if (!edgeAfter.ok) return edgeAfter;
  const edgeAfterValue = numberIn(
    edgeAfter.value,
    "observation.interval.edgeAfterSeconds",
    0,
    OBSERVATION_V1_MAX_SECONDS,
  );
  if (!edgeAfterValue.ok) return edgeAfterValue;

  if (lastAt.value < firstAt.value) {
    return fail("observation_time_order", "observation.interval.firstSampleAt");
  }

  const span = secondsBetween(lastAt.value, firstAt.value);
  const count = sampleCount.value;
  if (count === 1) {
    if (span !== 0) {
      return fail(
        "observation_bounds_inconsistent",
        "observation.interval.samples",
      );
    }
    if (maxGapValue.value !== 0) {
      return fail(
        "observation_max_gap_inconsistent",
        "observation.interval.maxGapSeconds",
      );
    }
  } else {
    if (span <= 0) {
      return fail(
        "observation_bounds_inconsistent",
        "observation.interval.samples",
      );
    }
    const averageGap = span / (count - 1);
    if (
      maxGapValue.value + NUMERIC_EPSILON < averageGap ||
      maxGapValue.value > span + NUMERIC_EPSILON
    ) {
      return fail(
        "observation_max_gap_inconsistent",
        "observation.interval.maxGapSeconds",
      );
    }
  }

  const edgeSum = edgeBeforeValue.value + edgeAfterValue.value;
  const lowerUnknown = edgeSum +
    (maxGapValue.value > 1 ? maxGapValue.value : 0);
  if (unknownValue.value + NUMERIC_EPSILON < lowerUnknown) {
    return fail(
      "observation_unknown_seconds_inconsistent",
      "observation.interval.unknownSeconds",
    );
  }
  if (unknownValue.value > span + edgeSum + NUMERIC_EPSILON) {
    return fail(
      "observation_unknown_seconds_inconsistent",
      "observation.interval.unknownSeconds",
    );
  }

  return {
    firstSampleAt: first.value as string,
    lastSampleAt: last.value as string,
    samples: count,
    maxGapSeconds: maxGapValue.value,
    unknownSeconds: unknownValue.value,
    edgeBeforeSeconds: edgeBeforeValue.value,
    edgeAfterSeconds: edgeAfterValue.value,
  };
};

const factTimestamp = (
  value: unknown,
  path: string,
  firstNs: bigint,
  lastNs: bigint,
): { ok: true; value: string } | Failure => {
  if (typeof value !== "string") return fail("observation_invalid_type", path);
  const parsed = parseTimestampNs(value);
  if (parsed === null) return fail("observation_invalid_timestamp", path);
  if (parsed < firstNs || parsed > lastNs) {
    return fail("observation_fact_outside_interval", path);
  }
  return { ok: true, value };
};

const parsePitRoad = (
  value: unknown,
  firstNs: bigint,
  lastNs: bigint,
): ObservationV1["pitRoad"] | Failure => {
  if (!isRecord(value)) {
    return fail("observation_invalid_type", "observation.pitRoad");
  }
  const extra = unknownKey(value, ["value", "firstAt"], "observation.pitRoad");
  if (extra) return extra;

  const flag = requiredValue(value, "value", "observation.pitRoad.value");
  if (!flag.ok) return flag;
  if (flag.value === false || flag.value === 0) {
    return fail("observation_negative_fact", "observation.pitRoad.value");
  }
  if (flag.value !== true) {
    return fail("observation_invalid_type", "observation.pitRoad.value");
  }

  const first = requiredValue(value, "firstAt", "observation.pitRoad.firstAt");
  if (!first.ok) return first;
  const firstAt = factTimestamp(
    first.value,
    "observation.pitRoad.firstAt",
    firstNs,
    lastNs,
  );
  if (!firstAt.ok) return firstAt;
  return { value: true, firstAt: firstAt.value };
};

const parseRefuel = (
  value: unknown,
  firstNs: bigint,
  lastNs: bigint,
): ObservationV1["refuel"] | Failure => {
  if (!isRecord(value)) {
    return fail("observation_invalid_type", "observation.refuel");
  }
  const extra = unknownKey(
    value,
    [
      "observedAddedLitres",
      "firstAt",
      "positiveSteps",
      "resolutionLitres",
      "maxUndetectedLitres",
    ],
    "observation.refuel",
  );
  if (extra) return extra;

  const litres = requiredValue(
    value,
    "observedAddedLitres",
    "observation.refuel.observedAddedLitres",
  );
  if (!litres.ok) return litres;
  if (typeof litres.value !== "number") {
    return fail(
      "observation_invalid_type",
      "observation.refuel.observedAddedLitres",
    );
  }
  if (!Number.isFinite(litres.value)) {
    return fail(
      "observation_invalid_number",
      "observation.refuel.observedAddedLitres",
    );
  }
  if (litres.value <= 0) {
    return fail(
      "observation_negative_fact",
      "observation.refuel.observedAddedLitres",
    );
  }
  if (litres.value > 300) {
    return fail(
      "observation_invalid_number",
      "observation.refuel.observedAddedLitres",
    );
  }

  const first = requiredValue(value, "firstAt", "observation.refuel.firstAt");
  if (!first.ok) return first;
  const firstAt = factTimestamp(
    first.value,
    "observation.refuel.firstAt",
    firstNs,
    lastNs,
  );
  if (!firstAt.ok) return firstAt;

  const steps = requiredValue(
    value,
    "positiveSteps",
    "observation.refuel.positiveSteps",
  );
  if (!steps.ok) return steps;
  const stepCount = integerIn(
    steps.value,
    "observation.refuel.positiveSteps",
    1,
    10_000,
  );
  if (!stepCount.ok) return stepCount;

  const resolution = requiredValue(
    value,
    "resolutionLitres",
    "observation.refuel.resolutionLitres",
  );
  if (!resolution.ok) return resolution;
  const resolutionValue = numberIn(
    resolution.value,
    "observation.refuel.resolutionLitres",
    0.001,
    1,
  );
  if (!resolutionValue.ok) return resolutionValue;

  const refuel: NonNullable<ObservationV1["refuel"]> = {
    observedAddedLitres: litres.value,
    firstAt: firstAt.value,
    positiveSteps: stepCount.value,
    resolutionLitres: resolutionValue.value,
  };

  const maxUndetected = optionalValue(
    value,
    "maxUndetectedLitres",
    "observation.refuel.maxUndetectedLitres",
  );
  if (!maxUndetected.ok) return maxUndetected;
  if (maxUndetected.value !== undefined) {
    const bound = numberIn(
      maxUndetected.value,
      "observation.refuel.maxUndetectedLitres",
      resolutionValue.value,
      300,
    );
    if (!bound.ok) return bound;
    refuel.maxUndetectedLitres = bound.value;
  }
  return refuel;
};

const parseDriverNameContinuity = (
  value: unknown,
): ObservationV1["driverNameContinuity"] | Failure => {
  if (!isRecord(value)) {
    return fail("observation_invalid_type", "observation.driverNameContinuity");
  }
  const extra = unknownKey(
    value,
    ["value"],
    "observation.driverNameContinuity",
  );
  if (extra) return extra;

  const continuity = requiredValue(
    value,
    "value",
    "observation.driverNameContinuity.value",
  );
  if (!continuity.ok) return continuity;
  if (continuity.value !== "unchanged" && continuity.value !== "changed") {
    return fail(
      "observation_invalid_enum",
      "observation.driverNameContinuity.value",
    );
  }
  return { value: continuity.value };
};

const parseContext = (value: unknown): ObservationV1["context"] | Failure => {
  if (!isRecord(value)) {
    return fail("observation_invalid_type", "observation.context");
  }
  const extra = unknownKey(
    value,
    [
      "carId",
      "trackId",
      "trackName",
      "trackConfig",
      "sessionUniqueId",
      "sessionNumber",
    ],
    "observation.context",
  );
  if (extra) return extra;

  const car = requiredValue(value, "carId", "observation.context.carId");
  if (!car.ok) return car;
  const carId = textIn(car.value, "observation.context.carId", 64);
  if (!carId.ok) return carId;

  const track = requiredValue(value, "trackId", "observation.context.trackId");
  if (!track.ok) return track;
  const trackId = integerIn(
    track.value,
    "observation.context.trackId",
    1,
    2_147_483_647,
  );
  if (!trackId.ok) return trackId;

  const name = requiredValue(
    value,
    "trackName",
    "observation.context.trackName",
  );
  if (!name.ok) return name;
  const trackName = textIn(name.value, "observation.context.trackName", 128);
  if (!trackName.ok) return trackName;

  const config = requiredValue(
    value,
    "trackConfig",
    "observation.context.trackConfig",
  );
  if (!config.ok) return config;
  const trackConfig = textIn(
    config.value,
    "observation.context.trackConfig",
    128,
  );
  if (!trackConfig.ok) return trackConfig;

  const context: NonNullable<ObservationV1["context"]> = {
    carId: carId.value,
    trackId: trackId.value,
    trackName: trackName.value,
    trackConfig: trackConfig.value,
  };

  const sessionUniqueId = optionalValue(
    value,
    "sessionUniqueId",
    "observation.context.sessionUniqueId",
  );
  if (!sessionUniqueId.ok) return sessionUniqueId;
  if (sessionUniqueId.value !== undefined) {
    const parsed = integerIn(
      sessionUniqueId.value,
      "observation.context.sessionUniqueId",
      0,
      2_147_483_647,
    );
    if (!parsed.ok) return parsed;
    context.sessionUniqueId = parsed.value;
  }

  const sessionNumber = optionalValue(
    value,
    "sessionNumber",
    "observation.context.sessionNumber",
  );
  if (!sessionNumber.ok) return sessionNumber;
  if (sessionNumber.value !== undefined) {
    const parsed = integerIn(
      sessionNumber.value,
      "observation.context.sessionNumber",
      0,
      1000,
    );
    if (!parsed.ok) return parsed;
    context.sessionNumber = parsed.value;
  }

  return context;
};

/**
 * Parse one `payload.lapSummaries[i].observation` value.
 *
 * The returned object is a fresh allowlisted copy. Original strings, including
 * UUID case and timestamp precision, are preserved. `undefined` is not an
 * observation; the classifier treats an absent row property as legacy.
 */
export function parseLapObservation(value: unknown): ParseLapObservationResult {
  if (value === undefined) return fail("observation_not_object", "observation");
  if (value === null) return fail("observation_null", "observation");
  if (!isRecord(value)) return fail("observation_not_object", "observation");

  let json: string | undefined;
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== "string") {
      return fail("observation_not_json", "observation");
    }
    json = serialized;
  } catch {
    return fail("observation_not_json", "observation");
  }
  if (new TextEncoder().encode(json).byteLength > OBSERVATION_V1_MAX_BYTES) {
    return fail("observation_too_large", "observation");
  }

  const extra = unknownKey(
    value,
    [
      "version",
      "capture",
      "interval",
      "pitRoad",
      "refuel",
      "driverNameContinuity",
      "context",
    ],
    "observation",
  );
  if (extra) return extra;

  const version = requiredValue(value, "version", "observation.version");
  if (!version.ok) return version;
  if (version.value !== OBSERVATION_V1_VERSION) {
    return fail("observation_invalid_version", "observation.version");
  }

  const capture = requiredValue(value, "capture", "observation.capture");
  if (!capture.ok) return capture;
  const parsedCapture = parseCapture(capture.value);
  if (isFailure(parsedCapture)) return parsedCapture;

  const interval = requiredValue(value, "interval", "observation.interval");
  if (!interval.ok) return interval;
  const parsedInterval = parseInterval(interval.value);
  if (isFailure(parsedInterval)) return parsedInterval;

  const factKeys = [
    "pitRoad",
    "refuel",
    "driverNameContinuity",
    "context",
  ] as const;
  if (!factKeys.some((key) => hasOwn(value, key))) {
    return fail("observation_no_fact", "observation");
  }

  const firstNs = parseTimestampNs(parsedInterval.firstSampleAt);
  const lastNs = parseTimestampNs(parsedInterval.lastSampleAt);
  if (firstNs === null || lastNs === null) {
    return fail("observation_invalid_timestamp", "observation.interval");
  }

  const observation: ObservationV1 = {
    version: OBSERVATION_V1_VERSION,
    capture: parsedCapture,
    interval: parsedInterval,
  };

  if (hasOwn(value, "pitRoad")) {
    const pitRoad = requiredValue(value, "pitRoad", "observation.pitRoad");
    if (!pitRoad.ok) return pitRoad;
    const parsed = parsePitRoad(pitRoad.value, firstNs, lastNs);
    if (isFailure(parsed)) return parsed;
    observation.pitRoad = parsed;
  }

  if (hasOwn(value, "refuel")) {
    const refuel = requiredValue(value, "refuel", "observation.refuel");
    if (!refuel.ok) return refuel;
    const parsed = parseRefuel(refuel.value, firstNs, lastNs);
    if (isFailure(parsed)) return parsed;
    observation.refuel = parsed;
  }

  if (hasOwn(value, "driverNameContinuity")) {
    const continuity = requiredValue(
      value,
      "driverNameContinuity",
      "observation.driverNameContinuity",
    );
    if (!continuity.ok) return continuity;
    const parsed = parseDriverNameContinuity(continuity.value);
    if (isFailure(parsed)) return parsed;
    observation.driverNameContinuity = parsed;
  }

  if (hasOwn(value, "context")) {
    const context = requiredValue(value, "context", "observation.context");
    if (!context.ok) return context;
    const parsed = parseContext(context.value);
    if (isFailure(parsed)) return parsed;
    observation.context = parsed;
  }

  return { ok: true, observation };
}

const reject = (
  code: ObservationErrorCode | ClassifierErrorCode,
  path: string,
): ClassifyLapObservationResult => ({
  disposition: "reject",
  code,
  path,
  observation: null,
});

/**
 * Decide one measurement row. The result is row-scoped: it contains no
 * `coreAccepted` or frame-level boolean. A future caller may keep processing
 * the V3 core frame and its other rows after a `quarantine` or `reject`.
 *
 * Precedence:
 *  1. absent observation property -> legacy (no auth/owner/history claim);
 *  2. malformed observation -> reject, never legacy;
 *  3. observed row with malformed/missing authenticated device -> reject;
 *  4. valid device mismatch -> quarantine (no insert/update/P1 for this row);
 *  5. valid match + valid raw row bounds/edges -> accept.
 */
export function classifyLapObservation(
  input: ClassifyLapObservationInput,
): ClassifyLapObservationResult {
  const inputRecord = isRecord(input) ? input : null;
  const row = inputRecord && isRecord(inputRecord.row) ? inputRecord.row : null;
  if (row === null) return reject("row_invalid", "row");

  if (!hasOwn(row, "observation")) {
    return {
      disposition: "legacy",
      code: "observation_absent",
      path: "observation",
      observation: null,
    };
  }

  const parsed = parseLapObservation(row.observation);
  if (!parsed.ok) return reject(parsed.code, parsed.path);

  const auth = inputRecord?.authenticatedDeviceId;
  if (typeof auth !== "string" || !UUID_PATTERN.test(auth)) {
    return reject("auth_device_invalid", "authenticatedDeviceId");
  }

  if (
    parsed.observation.capture.deviceId.toLowerCase() !== auth.toLowerCase()
  ) {
    return {
      disposition: "quarantine",
      code: "observation_device_mismatch",
      path: "observation.capture.deviceId",
      observation: null,
    };
  }

  const startedValue = row.startedAt;
  const endedValue = row.endedAt;
  if (typeof startedValue !== "string") {
    return reject("row_time_invalid", "row.startedAt");
  }
  if (typeof endedValue !== "string") {
    return reject("row_time_invalid", "row.endedAt");
  }
  const startedNs = parseTimestampNs(startedValue);
  if (startedNs === null) return reject("row_time_invalid", "row.startedAt");
  const endedNs = parseTimestampNs(endedValue);
  if (endedNs === null) return reject("row_time_invalid", "row.endedAt");
  if (endedNs < startedNs) return reject("row_time_invalid", "row.endedAt");

  const firstNs = parseTimestampNs(parsed.observation.interval.firstSampleAt);
  const lastNs = parseTimestampNs(parsed.observation.interval.lastSampleAt);
  if (firstNs === null) {
    return reject(
      "observation_invalid_timestamp",
      "observation.interval.firstSampleAt",
    );
  }
  if (lastNs === null) {
    return reject(
      "observation_invalid_timestamp",
      "observation.interval.lastSampleAt",
    );
  }
  if (firstNs < startedNs) {
    return reject(
      "observation_interval_outside_row",
      "observation.interval.firstSampleAt",
    );
  }
  if (lastNs > endedNs) {
    return reject(
      "observation_interval_outside_row",
      "observation.interval.lastSampleAt",
    );
  }

  const actualBefore = secondsBetween(firstNs, startedNs);
  const actualAfter = secondsBetween(endedNs, lastNs);
  if (
    Math.abs(actualBefore - parsed.observation.interval.edgeBeforeSeconds) >
      OBSERVATION_EDGE_TOLERANCE_SECONDS + NUMERIC_EPSILON
  ) {
    return reject(
      "observation_edge_mismatch",
      "observation.interval.edgeBeforeSeconds",
    );
  }
  if (
    Math.abs(actualAfter - parsed.observation.interval.edgeAfterSeconds) >
      OBSERVATION_EDGE_TOLERANCE_SECONDS + NUMERIC_EPSILON
  ) {
    return reject(
      "observation_edge_mismatch",
      "observation.interval.edgeAfterSeconds",
    );
  }

  return {
    disposition: "accept",
    code: "observation_accepted",
    path: "observation",
    observation: parsed.observation,
  };
}
