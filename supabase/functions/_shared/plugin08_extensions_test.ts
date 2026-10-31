/**
 * Plugin 0.8 — tests voor de additieve uitbreidingsblokken en de begrensde
 * acceptatie van onbekende rootkeys.
 *
 * Draai met: deno test --allow-env supabase/functions/_shared/plugin08_extensions_test.ts
 *
 * Wat hier bewezen wordt:
 *  - een oud (0.7.x) frame verandert niet;
 *  - een nieuw blok wordt geaccepteerd in plaats van het frame te kosten;
 *  - een onbekend veld BINNEN een bekend blok blijft een fout;
 *  - de grenzen (aantal, diepte, omvang) zijn echt grenzen.
 */
import { parseTelemetryV3Envelope, normalizeTelemetryEnvelope } from "./simhub.ts";
import {
  MaxLapSummariesPerFrame,
  MaxMeasurementEventsPerFrame,
} from "./simhubExtensions.ts";

declare const Deno: {
  test(name: string, fn: () => void | Promise<void>): void;
};

/** Exact het frame dat de 0.7.x-connector vandaag stuurt. */
const legacyFrame = () => ({
  protocolVersion: 3,
  sequence: 42,
  capturedAt: "2026-10-31T12:00:00.000Z",
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
  pitService: { pitServiceFlagsRaw: 0, requiredRepairSeconds: 0, optionalRepairSeconds: 0 },
});

const withBlock = (key: string, value: unknown) => ({ ...legacyFrame(), [key]: value });

const expectThrow = (fn: () => unknown, label: string) => {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(`${label}: verwachtte een fout, kreeg een geldig resultaat`);
};

Deno.test("P08-1 een oud V3-frame parseert ongewijzigd", () => {
  const parsed = parseTelemetryV3Envelope(legacyFrame());
  if (parsed.protocolVersion !== 3) throw new Error("protocolVersion veranderd");
  if (parsed.sequence !== 42) throw new Error("sequence veranderd");
  if (parsed.timing.completedLaps !== 3) throw new Error("completedLaps veranderd");
  if (parsed.schemaRevision !== null) throw new Error("schemaRevision moet null zijn zonder blok");
  if (parsed.measurementEvents !== null) throw new Error("measurementEvents moet null zijn");
  if (parsed.lapSummaries !== null) throw new Error("lapSummaries moet null zijn");
  if (parsed.capabilities !== null) throw new Error("capabilities moet null zijn");
  if (parsed.environment !== null) throw new Error("environment moet null zijn");
});

Deno.test("P08-2 onbekende rootkey wordt geaccepteerd en niet doorgegeven", () => {
  const parsed = parseTelemetryV3Envelope(withBlock("futureBlock", { anything: [1, 2, 3] }));
  if (parsed.timing.completedLaps !== 3) throw new Error("kernvelden beschadigd");
  if ("futureBlock" in parsed) throw new Error("onbekende rootkey mag niet in het DTO staan");
});

Deno.test("P08-3 onbekend veld in een bekend blok blijft een fout", () => {
  expectThrow(
    () => parseTelemetryV3Envelope({ ...legacyFrame(), track: { ...legacyFrame().track, extra: 1 } }),
    "track.extra",
  );
  expectThrow(
    () => parseTelemetryV3Envelope({
      ...legacyFrame(),
      session: { ...legacyFrame().session, extra: true },
    }),
    "session.extra",
  );
});

Deno.test("P08-4 schemaRevision, capabilities en environment worden gelezen", () => {
  const parsed = parseTelemetryV3Envelope({
    ...legacyFrame(),
    schemaRevision: 1,
    capabilities: {
      revision: 1,
      supported: { pitService: 1, wearObservation: 1, lapSummary: 1, directIrSdk: 1 },
    },
    environment: { trackTempC: 32.5, airTempC: 21, rubberState: "Moderate" },
  });
  if (parsed.schemaRevision !== 1) throw new Error("schemaRevision niet gelezen");
  if (parsed.capabilities?.supported.lapSummary !== 1) throw new Error("capabilities niet gelezen");
  if (parsed.environment?.trackTempC !== 32.5) throw new Error("environment.trackTempC niet gelezen");
  if (parsed.environment?.rubberState !== "Moderate") throw new Error("rubberState niet gelezen");
});

Deno.test("P08-5 measurementEvents en lapSummaries worden volledig gelezen", () => {
  const parsed = parseTelemetryV3Envelope({
    ...legacyFrame(),
    measurementEvents: [{
      eventId: "evt-1",
      kind: "wear_refresh_confirmed",
      segmentId: "seg-1",
      observedAt: "2026-10-31T12:00:00Z",
      sessionTimeSeconds: 1000,
      sdkTick: 12345,
      wearBefore: { fl: 12.5 },
      wearAfter: { fl: 0.2 },
      setGeneration: { fl: 3 },
      evidence: { source: "tire_sets_used" },
      confidence: 0.9,
    }],
    lapSummaries: [{
      summaryId: "lap-17",
      segmentId: "seg-1",
      lapNumber: 17,
      startedAt: "2026-10-31T11:58:00Z",
      endedAt: "2026-10-31T12:00:00Z",
      currentDriverId: "44444444-4444-4444-8444-444444444444",
      aggregationVersion: 1,
      complete: true,
      invalidReasons: [],
      pitLap: false,
      driverChanged: false,
      trackTempCMean: 32.5,
      trackTempCMin: 31,
      trackTempCMax: 34,
      fuelLevelIntegralLitreSeconds: 4875,
      validDurationSeconds: 120.5,
      sampleCount: 2410,
      maxGapSeconds: 0.08,
      pitVisitIds: ["pit-1"],
      wearObservationIds: ["evt-1"],
    }],
  });
  if (parsed.measurementEvents?.length !== 1) throw new Error("geen meetgebeurtenis gelezen");
  if (parsed.measurementEvents[0].confidence !== 0.9) throw new Error("confidence niet gelezen");
  if (parsed.lapSummaries?.length !== 1) throw new Error("geen rondeaggregaat gelezen");
  if (parsed.lapSummaries[0].validDurationSeconds !== 120.5) throw new Error("dekking niet gelezen");
  if (parsed.lapSummaries[0].aggregationVersion !== 1) throw new Error("aggregationVersion niet gelezen");
});

Deno.test("P08-6 een ongeldig meetblok kost alleen dat blok", () => {
  const parsed = parseTelemetryV3Envelope({
    ...legacyFrame(),
    // onbekend veld binnen een bekend blok: de reeks wordt afgekeurd
    measurementEvents: [{ eventId: "evt-1", kind: "wear_value_changed", deviceId: "client-lie" }],
    // verplicht veld ontbreekt
    lapSummaries: [{ summaryId: "lap-1" }],
  });
  if (parsed.measurementEvents !== null) throw new Error("ongeldige meetgebeurtenissen niet afgekeurd");
  if (parsed.lapSummaries !== null) throw new Error("ongeldig rondeaggregaat niet afgekeurd");
  // en de kerntelemetrie is er gewoon nog
  if (parsed.timing.completedLaps !== 3) throw new Error("frame beschadigd door een ongeldig blok");
});

Deno.test("P08-7 de grenzen zijn echte grenzen", () => {
  // Te veel onbekende rootkeys.
  const teVeel: Record<string, unknown> = {};
  for (let i = 0; i < 33; i += 1) teVeel[`extraKey${i}`] = i;
  expectThrow(() => parseTelemetryV3Envelope({ ...legacyFrame(), ...teVeel }), "33 onbekende rootkeys");

  // Te grote onbekende waarde.
  expectThrow(
    () => parseTelemetryV3Envelope(withBlock("bigBlock", { blob: "x".repeat(5000) })),
    "te grote onbekende waarde",
  );

  // Te diepe nesting.
  expectThrow(
    () => parseTelemetryV3Envelope(withBlock("deepBlock", { a: { b: { c: { d: 1 } } } })),
    "te diepe nesting",
  );

  // Te veel meetgebeurtenissen: het blok valt weg, het frame niet.
  const veel = Array.from({ length: MaxMeasurementEventsPerFrame + 1 }, (_, index) => ({
    eventId: `evt-${index}`,
    kind: "wear_value_changed",
  }));
  const parsed = parseTelemetryV3Envelope({ ...legacyFrame(), measurementEvents: veel });
  if (parsed.measurementEvents !== null) throw new Error("te lange reeks niet afgekeurd");

  const veelLaps = Array.from({ length: MaxLapSummariesPerFrame + 1 }, (_, index) => ({
    summaryId: `lap-${index}`,
    lapNumber: index,
  }));
  const parsedLaps = parseTelemetryV3Envelope({ ...legacyFrame(), lapSummaries: veelLaps });
  if (parsedLaps.lapSummaries !== null) throw new Error("te veel rondeaggregaten niet afgekeurd");
});

Deno.test("P08-8 een oude V1/V2-payload blijft ongewijzigd", () => {
  const v1 = {
    protocolVersion: 1,
    sequence: 7,
    capturedAt: "2026-10-31T12:00:00.000Z",
    source: { connectorId: "SIM-PC", simHubVersion: "9.11.21.0", game: "IRacing" },
    race: {
      eventId: "33333333-3333-4333-8333-333333333333",
      teamId: "44444444-4444-4444-8444-444444444444",
      sessionId: "simhub-session",
      driverId: null,
    },
    telemetry: {
      connected: true,
      sessionTimeSeconds: 3600,
      lap: 18,
      completedLaps: 17,
      lapTimeSeconds: 121.25,
      position: 4,
      classPosition: 2,
      speedKph: 247.1,
      fuelLitres: 44.8,
      fuelPerLapLitres: 3.2,
      estimatedLapsRemaining: 14,
      inPitLane: false,
      pitLimiter: false,
      stintElapsedSeconds: 2700,
      incidents: 2,
      flag: "green",
    },
  };
  const parsed = normalizeTelemetryEnvelope(v1);
  if (parsed.protocolVersion !== 1) throw new Error("protocolVersion veranderd");
  if (parsed.timing.completedLaps !== 17) throw new Error("completedLaps veranderd");
  if (parsed.measurementEvents) throw new Error("V1 mag geen meetreeksen hebben");
});
