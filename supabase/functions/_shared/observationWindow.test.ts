/**
 * T13-S1 B1 — venster- en edgecontrole op de ECHTE V3-envelope
 * (`parseTelemetryV3Envelope`), niet alleen op de pure classifier.
 *
 * De fixture levert de ruwe 7-cijferige tijdstrings. De bedrading moet de
 * RAUWE rij vóór enige Date.parse/PG-cast aan de classifier geven, anders
 * verdwijnen 100 ns en wordt een grensgeval onterecht geaccepteerd.
 */

// deno-lint-ignore-file no-explicit-any -- mutabele JSON-fixtures

import { parseTelemetryV3Envelope } from "./simhub.ts";

const DEVICE = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const OTHER = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";

function assert(condition: unknown, message = "assertion failed"): asserts condition {
  if (!condition) throw new Error(message);
}

function observation(): Record<string, any> {
  return {
    version: 1,
    capture: { deviceId: DEVICE },
    interval: {
      firstSampleAt: "2026-11-12T10:00:00.0500001Z",
      lastSampleAt: "2026-11-12T10:00:19.9500001Z",
      samples: 41,
      maxGapSeconds: 0.5,
      unknownSeconds: 0.1,
      edgeBeforeSeconds: 0.05,
      edgeAfterSeconds: 0.05,
    },
    pitRoad: { value: true, firstAt: "2026-11-12T10:00:05.0000001Z" },
    context: {
      carId: "1321",
      trackId: 42,
      trackName: "Spa",
      trackConfig: "Endurance",
    },
  };
}

function row(uid: string, lapNumber: number, extra: Record<string, unknown> = {}) {
  return {
    summaryUid: uid,
    lapNumber,
    startedAt: "2026-11-12T10:00:00.000Z",
    endedAt: "2026-11-12T10:00:20.000Z",
    observation: observation(),
    ...extra,
  };
}

function frame(laps: unknown[]) {
  return {
    protocolVersion: 3,
    sequence: 42,
    capturedAt: "2026-11-12T10:00:20.0000000Z",
    transportSessionId: "sess-b1",
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
    pitService: { pitServiceFlagsRaw: 0, requiredRepairSeconds: 0, optionalRepairSeconds: 0 },
    lapSummaries: laps,
  };
}

function parse(laps: unknown[]) {
  return parseTelemetryV3Envelope(frame(laps), {
    observationCapture: "on",
    authenticatedDeviceId: DEVICE,
  });
}

Deno.test("T13S1-101 outside-window observation is rejected per row, legacy sibling continues", () => {
  const outside = row(DEVICE, 1, {
    startedAt: "2026-11-12T09:59:00.000Z",
    endedAt: "2026-11-12T09:59:20.000Z",
  });
  const legacy = {
    summaryUid: OTHER,
    lapNumber: 2,
    startedAt: "2026-11-12T09:59:00.000Z",
    endedAt: "2026-11-12T09:59:20.000Z",
  };
  const report = parse([outside, legacy]).measurementReport!.laps;
  assert(report.blockError === null, "series must not become a block error");
  assert(report.rows.length === 1, `one legacy row expected, got ${report.rows.length}`);
  assert(!("observation" in report.rows[0]), "legacy sibling carries no observation");
  assert(report.rejected.length === 1, "outside row rejected alone");
  assert(report.rejected[0].index === 0, "outside row index");
  assert(
    report.rejected[0].reason.includes("observation_interval_outside_row"),
    `outside reason, got ${report.rejected[0].reason}`,
  );
});

Deno.test("T13S1-102 wrong edge is rejected on the real envelope", () => {
  const wrong = row(DEVICE, 3);
  wrong.observation.interval.edgeBeforeSeconds = 0;
  const report = parse([wrong]).measurementReport!.laps;
  assert(report.rows.length === 0, "wrong edge must not be accepted");
  assert(report.rejected.length === 1, "wrong edge rejected");
  assert(
    report.rejected[0].reason.includes("observation_edge_mismatch"),
    `edge reason, got ${report.rejected[0].reason}`,
  );
});

Deno.test("T13S1-103 100 ns outside the row is rejected (no millisecond collapse)", () => {
  const after = row(DEVICE, 4);
  after.observation.interval.lastSampleAt = "2026-11-12T10:00:20.0000001Z";
  after.observation.interval.edgeAfterSeconds = 0;
  const afterReport = parse([after]).measurementReport!.laps;
  assert(afterReport.rejected.length === 1, "100 ns after end rejected");
  assert(
    afterReport.rejected[0].reason.includes("observation_interval_outside_row"),
    `after reason, got ${afterReport.rejected[0].reason}`,
  );

  const before = row(DEVICE, 5);
  before.observation.interval.firstSampleAt = "2026-11-12T09:59:59.9999999Z";
  before.observation.interval.edgeBeforeSeconds = 0;
  const beforeReport = parse([before]).measurementReport!.laps;
  assert(beforeReport.rejected.length === 1, "100 ns before start rejected");
  assert(
    beforeReport.rejected[0].reason.includes("observation_interval_outside_row"),
    `before reason, got ${beforeReport.rejected[0].reason}`,
  );
});

Deno.test("T13S1-104 positive control keeps raw values and actual 7-digit bounds", () => {
  const report = parse([row(DEVICE, 6)]).measurementReport!.laps;
  assert(report.rows.length === 1, "positive row accepted");
  assert(report.rejected.length === 0, "no positive rejections");
  const parsed = report.rows[0].observation!;
  assert(parsed.interval.firstSampleAt === "2026-11-12T10:00:00.0500001Z", "raw first kept");
  assert(parsed.interval.lastSampleAt === "2026-11-12T10:00:19.9500001Z", "raw last kept");
  assert(parsed.capture.deviceId === DEVICE, "raw device kept");
});

Deno.test("T13S1-105 capture device != authenticated device is quarantined per row", () => {
  const mismatched = row(DEVICE, 7);
  mismatched.observation.capture.deviceId = OTHER;
  const legacy = {
    summaryUid: "c3d4e5f6-a7b8-4c9d-8e0f-1a2b3c4d5e6f",
    lapNumber: 8,
    startedAt: "2026-11-12T10:00:00.000Z",
    endedAt: "2026-11-12T10:00:20.000Z",
  };
  const report = parse([mismatched, legacy]).measurementReport!.laps;
  assert(report.rows.length === 1, "legacy row survives");
  assert(report.rejected.length === 1, "mismatched row alone rejected");
  assert(
    report.rejected[0].reason.includes("observation_device_mismatch"),
    `mismatch reason, got ${report.rejected[0].reason}`,
  );
});

Deno.test("T13S1-106 authenticated device is required for observed rows, not for legacy", () => {
  const observed = parseTelemetryV3Envelope(frame([row(DEVICE, 9)]), {
    observationCapture: "on",
  }).measurementReport!.laps;
  assert(observed.rows.length === 0, "observed row without auth rejected");
  assert(
    observed.rejected[0].reason.includes("auth_device_invalid"),
    `auth reason, got ${observed.rejected[0].reason}`,
  );

  const legacyRow = {
    summaryUid: OTHER,
    lapNumber: 10,
    startedAt: "2026-11-12T10:00:00.000Z",
    endedAt: "2026-11-12T10:00:20.000Z",
  };
  const legacy = parseTelemetryV3Envelope(frame([legacyRow]), {
    observationCapture: "on",
  }).measurementReport!.laps;
  assert(legacy.rows.length === 1, "legacy row does not require auth");
  assert(legacy.rejected.length === 0, "legacy row not rejected");
});
