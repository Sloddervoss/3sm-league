/**
 * Meet de wire-omvang van een meetbatch (review 2, punt 7).
 *
 * Doel: aantallenbegrenzing is geen bytesbegrenzing. Deze meting laat zien
 * hoeveel bytes de bestaande 50/5-fixtures kosten en welk maximum daaruit volgt.
 *
 * Draai: deno run --allow-read supabase/tests/plugin08_payload_measure.ts
 */
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const wear = (fl = 12.5) => ({ version: 1, scale: "remaining_percent", fl, fr: fl, rl: fl, rr: fl });
const evidence = () => ({
  version: 1,
  source: "tire_sets_used",
  channels: ["tire_sets_used", "tyre_temp"],
});
const group = () => ({ sampleCount: 2400, validDurationSeconds: 120, maxGapSeconds: 0.1 });

const core = () => ({
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

const eventFixture = (n: number) => ({
  eventUid: uid(n),
  eventId: `evt-${n}`,
  kind: "wear_refresh_confirmed",
  segmentId: "seg-1",
  observedSessionId: "sess-1",
  observedAt: "2026-10-31T12:00:00Z",
  sessionTimeSeconds: 1000,
  sdkTick: 12345,
  wearBefore: wear(),
  wearAfter: wear(0.2),
  evidence: evidence(),
  confidence: 0.9,
  recordRevision: 1,
  setGeneration: { version: 1, fl: 3, fr: 3, rl: 3, rr: 3 },
});

const lapFixture = (n: number) => ({
  summaryUid: uid(1000 + n),
  summaryId: `lap-${n}`,
  segmentId: "seg-1",
  observedSessionId: "sess-1",
  lapNumber: n,
  startedAt: "2026-10-31T11:58:00Z",
  endedAt: "2026-10-31T12:00:00Z",
  currentDriverName: "Driver One",
  aggregationVersion: 1,
  complete: true,
  invalidReasons: [],
  pitLap: false,
  driverChanged: false,
  trackTempCMean: 32.5,
  trackTempCMin: 31,
  trackTempCMax: 34,
  airTempCMean: 21,
  fuelStartLitres: 42,
  fuelEndLitres: 39.5,
  fuelLevelIntegralLitreSeconds: 4875,
  fuelAddedLitresObserved: 0,
  absLatAccelIntegralGSeconds: 220,
  latAccelSquaredIntegralG2Seconds: 380,
  maxAbsLatAccelG: 1.85,
  absLongAccelIntegralGSeconds: 60,
  absLongAccelIntegralG30Seconds: 60,
  sampleCount: 7200,
  pitVisitIds: ["pit-1"],
  wearObservationIds: ["evt-1"],
  coverage: { temperature: group(), fuel: group(), load: group() },
});

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

const frame = (events: number, laps: number) => ({
  ...core(),
  measurementEvents: Array.from({ length: events }, (_, i) => eventFixture(i + 1)),
  lapSummaries: Array.from({ length: laps }, (_, i) => lapFixture(i + 1)),
});

const coreBytes = bytes(core());
const oneEvent = bytes(eventFixture(1));
const oneLap = bytes(lapFixture(1));
const perEvent = bytes(Array.from({ length: 50 }, (_, i) => eventFixture(i + 1)));
const perLap = bytes(Array.from({ length: 5 }, (_, i) => lapFixture(i + 1)));

console.log(JSON.stringify({
  coreBytes,
  oneEvent,
  oneLap,
  "50/5 full frame bytes": bytes(frame(50, 5)),
  "50/5 batch only bytes": perEvent + perLap,
}, null, 2));

// Grootste combinatie die met een vaste kernreserve onder 24576 blijft.
const budget = 24576;
for (const [events, laps] of [[24, 3], [20, 3], [20, 2], [16, 2], [12, 2], [10, 1]]) {
  const total = bytes(frame(events, laps));
  const batch = bytes({
    measurementEvents: Array.from({ length: events }, (_, i) => eventFixture(i + 1)),
    lapSummaries: Array.from({ length: laps }, (_, i) => lapFixture(i + 1)),
  });
  console.log(`${events}/${laps}: frame ${total} bytes, batch ${batch} bytes, ${total <= budget ? "PAST" : "TE GROOT"}`);
}
