/**
 * T13-S1 — integratie van het goedgekeurde observation-blok in de bestaande
 * rondeaggregaten-parser, plus de Edge-modus/probe-logica.
 *
 * Synthetische fixtures, geen netwerk, database of SDK. De goedgekeurde
 * `observationV1.test.ts` blijft ongewijzigd en draait mee: de default (`off`)
 * moet exact het oude gedrag houden.
 */

// deno-lint-ignore-file no-explicit-any -- fixtures zijn bewust mutabele JSON-objecten

import { parseLapSummariesReport } from "./simhubExtensions.ts";
import { parseTelemetryV3Envelope } from "./simhub.ts";
import {
  afterObservationProbe,
  initialObservationCapability,
  observationCaptureMode,
  probeObservationV1,
  shouldProbeObservation,
} from "../simhub-ingest-v3/observationCapability.ts";

const UUID_A = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const UUID_B = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
const ROW_START = "2026-11-12T10:00:00.000Z";
const ROW_END = "2026-11-12T10:00:20.000Z";
const encoder = new TextEncoder();

function assert(
  condition: unknown,
  message = "assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, label = ""): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${label} expected ${b} got ${a}`);
}

/** Volledig positief, consistent blok; dezelfde vorm als het goedgekeurde contract. */
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

function lap(
  uid: string,
  lapNumber: number,
  extra: Record<string, unknown> = {},
) {
  return {
    summaryUid: uid,
    lapNumber,
    startedAt: ROW_START,
    endedAt: ROW_END,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Default: exact het oude gedrag
// ---------------------------------------------------------------------------

Deno.test("T13S1-001 default off keeps the old unknown-field row rejection", () => {
  const report = parseLapSummariesReport([
    lap(UUID_A, 1),
    lap(UUID_B, 2, { observation: validObservation() }),
  ]);
  assertEqual(report.blockError, null, "block error");
  assertEqual(report.received, 2, "received");
  assertEqual(report.rows.length, 1, "accepted rows");
  assertEqual(report.rejected.length, 1, "rejected rows");
  assertEqual(report.rejected[0].index, 1, "rejected index");
  assert(
    report.rejected[0].reason.includes("contains unknown fields"),
    `old reason, got ${report.rejected[0].reason}`,
  );
  assert(!("observation" in report.rows[0]), "legacy row has no observation");
});

Deno.test("T13S1-002 default off still rejects a whole observation-only block per row", () => {
  const report = parseLapSummariesReport([
    lap(UUID_A, 1, { observation: null }),
  ]);
  assertEqual(report.rows.length, 0, "accepted rows");
  assertEqual(report.rejected.length, 1, "rejected rows");
  assertEqual(report.blockError, null, "no block error");
});

// ---------------------------------------------------------------------------
// Opt-in: on / unavailable
// ---------------------------------------------------------------------------

Deno.test("T13S1-003 unavailable rejects only the observed row, legacy goes through", () => {
  const report = parseLapSummariesReport(
    [lap(UUID_A, 1), lap(UUID_B, 2, { observation: validObservation() })],
    { observationCapture: "unavailable" },
  );
  assertEqual(report.received, 2, "received");
  assertEqual(report.rows.length, 1, "accepted rows");
  assertEqual(report.rejected.length, 1, "rejected rows");
  assert(
    report.rejected[0].reason.includes("unavailable"),
    "unavailable reason",
  );
  assertEqual(report.acceptedIndexes, [0], "accepted indexes");
  assert(!("observation" in report.rows[0]), "legacy row untouched");
});

Deno.test("T13S1-004 on accepts a valid block and preserves every raw value", () => {
  const observation = validObservation();
  // Ruwe waarden die een trim/lowercase/Date.parse zouden beschadigen.
  observation.capture.deviceId = UUID_A.toUpperCase();
  observation.interval.firstSampleAt = "2026-11-12T10:00:00.0500001Z";
  observation.interval.lastSampleAt = "2026-11-12T10:00:19.9500001Z";
  observation.refuel.observedAddedLitres = 2.4000000000000004;
  observation.context.trackName = " Circuit de Spa-Francorchamps ";

  const report = parseLapSummariesReport([lap(UUID_A, 1, { observation })], {
    observationCapture: "on",
  });
  assertEqual(report.rows.length, 1, "accepted rows");
  const parsed = report.rows[0].observation;
  assert(parsed !== undefined, "observation attached");
  assertEqual(parsed!.capture.deviceId, UUID_A.toUpperCase(), "UUID case kept");
  assertEqual(
    parsed!.interval.firstSampleAt,
    "2026-11-12T10:00:00.0500001Z",
    "7-digit time kept",
  );
  assertEqual(
    parsed!.refuel!.observedAddedLitres,
    2.4000000000000004,
    "binary double kept",
  );
  assertEqual(
    parsed!.context!.trackName,
    " Circuit de Spa-Francorchamps ",
    "no trim",
  );
  // Alleen de allowlist, geen owner/PII-veld.
  assertEqual(
    Object.keys(parsed!).sort(),
    [
      "capture",
      "context",
      "driverNameContinuity",
      "interval",
      "pitRoad",
      "refuel",
      "version",
    ],
    "root keys",
  );
  assertEqual(Object.keys(parsed!.capture), ["deviceId"], "capture keys");
});

Deno.test("T13S1-005 on omits the property entirely for a legacy row", () => {
  const report = parseLapSummariesReport([lap(UUID_A, 1)], {
    observationCapture: "on",
  });
  const row = report.rows[0];
  assert(!("observation" in row), "no observation property");
  assert(
    !JSON.stringify(row).includes("observation"),
    "no outbound null/field",
  );
});

Deno.test("T13S1-006 explicit null is a row rejection, never legacy; neighbours continue", () => {
  const report = parseLapSummariesReport(
    [
      lap(UUID_A, 1),
      lap(UUID_B, 2, { observation: null }),
      lap("c3d4e5f6-a7b8-4c9d-8e0f-1a2b3c4d5e6f", 3, {
        observation: validObservation(),
      }),
    ],
    { observationCapture: "on" },
  );
  assertEqual(report.blockError, null, "frame stays healthy");
  assertEqual(report.received, 3, "received");
  assertEqual(report.rows.length, 2, "accepted rows");
  assertEqual(report.rejected.length, 1, "rejected rows");
  assertEqual(report.rejected[0].index, 1, "rejected index");
  assert(report.rejected[0].reason.includes("observation_null"), "stable code");
  assertEqual(report.acceptedIndexes, [0, 2], "original indexes");
});

Deno.test("T13S1-007 negative facts are row rejections", () => {
  const falsePit = validObservation();
  falsePit.pitRoad.value = false;
  const zeroFuel = validObservation();
  zeroFuel.refuel.observedAddedLitres = 0;
  const report = parseLapSummariesReport(
    [
      lap(UUID_A, 1, { observation: falsePit }),
      lap(UUID_B, 2, { observation: zeroFuel }),
    ],
    { observationCapture: "on" },
  );
  assertEqual(report.rows.length, 0, "nothing accepted");
  assertEqual(report.rejected.length, 2, "both rejected");
  assert(
    report.rejected.every((r: { reason: string }) =>
      r.reason.includes("observation_negative_fact")
    ),
    "negative fact codes",
  );
});

Deno.test("T13S1-008 invalid UUID format is rejected before any case comparison", () => {
  const observation = validObservation();
  observation.capture.deviceId = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5";
  const report = parseLapSummariesReport([lap(UUID_A, 1, { observation })], {
    observationCapture: "on",
  });
  assertEqual(report.rows.length, 0, "rejected");
  assert(
    report.rejected[0].reason.includes("observation_invalid_uuid"),
    "uuid code",
  );
});

Deno.test("T13S1-009 2048-byte wire cap is inclusive and fails before the key walk", () => {
  const base = validObservation();
  // Onbekende sleutel: de key-walk zou hem daarna alsnog afkeuren. Zo bewijst
  // de uitkomst dat alleen de bytegrens de doorslag gaf.
  const probe = JSON.stringify({ ...base, pad: "" });
  const padBytes = 2048 - encoder.encode(probe).byteLength;
  assert(padBytes > 0, "fixture has room");

  const exactly = validObservation();
  (exactly as Record<string, unknown>).pad = "x".repeat(padBytes);
  assertEqual(
    encoder.encode(JSON.stringify(exactly)).byteLength,
    2048,
    "exact 2048",
  );

  const atLimit = parseLapSummariesReport([
    lap(UUID_A, 1, { observation: exactly }),
  ], {
    observationCapture: "on",
  });
  assert(
    atLimit.rejected[0].reason.includes("observation_unknown_key"),
    `2048 must pass the size gate, got ${atLimit.rejected[0].reason}`,
  );

  const over = validObservation();
  (over as Record<string, unknown>).pad = "x".repeat(padBytes + 1);
  const tooBig = parseLapSummariesReport([
    lap(UUID_A, 1, { observation: over }),
  ], {
    observationCapture: "on",
  });
  assert(
    tooBig.rejected[0].reason.includes("observation_too_large"),
    `2049 must be too large, got ${tooBig.rejected[0].reason}`,
  );
});

Deno.test("T13S1-010 multibyte padding counts as bytes, not characters", () => {
  const observation = validObservation();
  // 1200 × 3 bytes = 3600 bytes > 2048, maar 1200 tekens.
  (observation as Record<string, unknown>).pad = "é".repeat(1200);
  const report = parseLapSummariesReport([lap(UUID_A, 1, { observation })], {
    observationCapture: "on",
  });
  assert(
    report.rejected[0].reason.includes("observation_too_large"),
    `multibyte too_large, got ${report.rejected[0].reason}`,
  );
});

Deno.test("T13S1-011 one observed row never aborts the series or the frame", () => {
  const report = parseLapSummariesReport(
    [
      lap(UUID_A, 1, { observation: "not-an-object" }),
      lap(UUID_B, 2),
    ],
    { observationCapture: "on" },
  );
  assertEqual(report.blockError, null, "block error");
  assertEqual(report.rows.length, 1, "legacy survives");
  assertEqual(report.rejected.length, 1, "bad row alone");
});

// ---------------------------------------------------------------------------
// Edge-modus en probe-TTL
// ---------------------------------------------------------------------------

Deno.test("T13S1-012 env off wins over an available database", () => {
  const capability = afterObservationProbe(true, 1000);
  assertEqual(observationCaptureMode(false, capability), "off", "env off");
  assertEqual(
    observationCaptureMode(true, capability),
    "on",
    "env on + available",
  );
  assertEqual(
    observationCaptureMode(true, initialObservationCapability()),
    "unavailable",
    "env on + unproven",
  );
});

Deno.test("T13S1-013 probe is cached for the TTL and retried afterwards", () => {
  const initial = initialObservationCapability();
  assert(shouldProbeObservation(initial, 0), "first probe");
  const checked = afterObservationProbe(true, 1000);
  assert(!shouldProbeObservation(checked, 1000 + 59_999), "cached");
  assert(shouldProbeObservation(checked, 1000 + 60_000), "retry after TTL");
  assertEqual(
    afterObservationProbe(false, 2000).available,
    false,
    "failure stays closed",
  );
});

Deno.test("T13S1-014 probe treats every error shape as unavailable", async () => {
  assertEqual(
    await probeObservationV1(async () => ({ data: true, error: null })),
    true,
    "scalar true",
  );
  assertEqual(
    await probeObservationV1(async () => ({
      data: [{ available: true }],
      error: null,
    })),
    true,
    "object row",
  );
  assertEqual(
    await probeObservationV1(async () => ({
      data: null,
      error: { code: "PGRST202" },
    })),
    false,
    "missing function",
  );
  assertEqual(
    await probeObservationV1(async () => {
      throw new Error("network");
    }),
    false,
    "throw",
  );
  assertEqual(
    await probeObservationV1(async () => ({ data: "true", error: null })),
    false,
    "garbage",
  );
});

// ---------------------------------------------------------------------------
// Envelope-niveau: de opt-in bereikt de echte V3-parser
// ---------------------------------------------------------------------------

function v3Frame(extraLap: Record<string, unknown> = {}) {
  return {
    protocolVersion: 3,
    sequence: 42,
    capturedAt: "2026-11-12T10:00:00.000Z",
    transportSessionId: "sess-1",
    identity: {
      currentDriverId: "Driver One",
      currentDriverName: "Driver One",
      carId: "car",
      carName: "Car",
      trackName: "Track",
      trackConfig: "GP",
    },
    session: {
      isInCar: true,
      sessionTimeSeconds: 1000,
      sessionTimeRemainingSeconds: 100,
      sessionLapsRemaining: 5,
      flags: ["green"],
      sessionState: "racing",
    },
    timing: {
      currentLapElapsedSeconds: 40,
      lastLapTimeSeconds: 120.5,
      bestLapTimeSeconds: 120.5,
      completedLaps: 3,
    },
    position: { position: 3, classPosition: 2, gapToLeaderSeconds: 1.5 },
    track: { lapDistancePct: 0.4, trackSurface: "on_track", onPitRoad: false },
    fuel: { fuelLitres: 40.5, fuelPct: 0.5 },
    raceState: { incidents: 0 },
    pitService: {
      pitServiceFlagsRaw: 0,
      requiredRepairSeconds: 0,
      optionalRepairSeconds: 0,
    },
    lapSummaries: [{ ...lap(UUID_A, 1), ...extraLap }],
  };
}

Deno.test("T13S1-015 V3 envelope: default rejects, opt-in carries the block", () => {
  const off = parseTelemetryV3Envelope(
    v3Frame({ observation: validObservation() }),
  );
  assertEqual(off.measurementReport!.laps.rows.length, 0, "default rejects");
  assert(
    off.measurementReport!.laps.rejected[0].reason.includes(
      "contains unknown fields",
    ),
    "default keeps the old reason",
  );

  const on = parseTelemetryV3Envelope(
    v3Frame({ observation: validObservation() }),
    {
      observationCapture: "on",
    },
  );
  assertEqual(on.measurementReport!.laps.rows.length, 1, "opt-in accepts");
  assertEqual(on.lapSummaries!.length, 1, "row reaches the batch DTO");
  assertEqual(
    on.lapSummaries![0].observation!.capture.deviceId,
    UUID_A,
    "observation survives the envelope",
  );

  const unavailable = parseTelemetryV3Envelope(
    v3Frame({ observation: validObservation() }),
    {
      observationCapture: "unavailable",
    },
  );
  assertEqual(
    unavailable.measurementReport!.laps.rows.length,
    0,
    "unavailable rejects",
  );
  assert(
    unavailable.measurementReport!.laps.rejected[0].reason.includes(
      "unavailable",
    ),
    "explicit unavailable reason",
  );
});
