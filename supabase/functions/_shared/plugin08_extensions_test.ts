/**
 * Plugin 0.7.2.0 — tests voor de additieve uitbreidingsblokken, het
 * meetcontract (identity, wear_v1, evidence_v1, dekking) en de begrensde
 * acceptatie van onbekende rootkeys.
 *
 * Draai met: deno test --allow-env supabase/functions/_shared/plugin08_extensions_test.ts
 *
 * Wat hier bewezen wordt:
 *  - een oud (0.7.x) frame verandert niet;
 *  - een nieuw blok wordt geaccepteerd in plaats van het frame te kosten;
 *  - een onbekend veld BINNEN een bekend blok blijft een fout;
 *  - één kapotte meetrij kost alleen die rij (reviewpunt 6);
 *  - wear_v1, evidence_v1 en dekking zijn echte contracten (reviewpunt 4 en 5);
 *  - de grenzen (aantal, diepte, omvang) zijn echt grenzen.
 */
import { parseTelemetryV3Envelope, normalizeTelemetryEnvelope } from "./simhub.ts";
import {
  MaxLapSummariesPerFrame,
  MaxMeasurementEventsPerFrame,
  coverageComplete,
  parseLapSummary,
  parseMeasurementEvent,
  parseMeasurementEventsReport,
  parseLapSummariesReport,
} from "./simhubExtensions.ts";

declare const Deno: {
  test(name: string, fn: () => void | Promise<void>): void;
};

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

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

const wear = (fl = 12.5) => ({ version: 1, scale: "remaining_percent", fl, fr: fl, rl: fl, rr: fl });
const evidence = () => ({ version: 1, source: "tire_sets_used", channels: ["tire_sets_used"] });
const setGen = () => ({ version: 1, fl: 3, fr: 3, rl: 3, rr: 3 });
const group = (sampleCount = 2400, validDurationSeconds = 120, maxGapSeconds = 0.1) =>
  ({ sampleCount, validDurationSeconds, maxGapSeconds });

const coverage = () => ({
  temperature: group(),
  fuel: group(),
  load: group(),
});

const event = (n: number, extra: Record<string, unknown> = {}) => ({
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
  setGeneration: setGen(),
  evidence: evidence(),
  confidence: 0.9,
  ...extra,
});

const lap = (n: number, extra: Record<string, unknown> = {}) => ({
  summaryUid: uid(1000 + n),
  summaryId: `lap-${n}`,
  segmentId: "seg-1",
  observedSessionId: "sess-1",
  lapNumber: n,
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
  airTempCMean: 21,
  fuelStartLitres: 42,
  fuelEndLitres: 39.5,
  fuelLevelIntegralLitreSeconds: 4875,
  absLatAccelIntegralGSeconds: 220,
  latAccelSquaredIntegralG2Seconds: 380,
  maxAbsLatAccelG: 1.85,
  absLongAccelIntegralGSeconds: 60,
  sampleCount: 7200,
  pitVisitIds: ["pit-1"],
  wearObservationIds: [`evt-1`],
  coverage: coverage(),
  ...extra,
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
  if (!parsed.measurementReport) throw new Error("het parserrapport moet er altijd zijn");
  if (parsed.measurementReport.events.rows.length !== 0) throw new Error("rapport moet leeg zijn");
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
    measurementEvents: [event(1)],
    lapSummaries: [lap(17)],
  });
  if (parsed.measurementEvents?.length !== 1) throw new Error("geen meetgebeurtenis gelezen");
  const ev = parsed.measurementEvents![0];
  if (ev.eventUid !== uid(1)) throw new Error("eventUid niet gelezen");
  if (ev.observedSessionId !== "sess-1") throw new Error("observedSessionId niet gelezen");
  if (ev.confidence !== 0.9) throw new Error("confidence niet gelezen");
  if (ev.wearAfter?.scale !== "remaining_percent") throw new Error("wear-schaal niet gelezen");
  if (ev.evidence?.channels[0] !== "tire_sets_used") throw new Error("evidence niet gelezen");
  const summary = parsed.lapSummaries![0];
  if (summary.summaryUid !== uid(1017)) throw new Error("summaryUid niet gelezen");
  if (summary.coverage?.fuel?.sampleCount !== 2400) throw new Error("dekking niet gelezen");
  if (summary.aggregationVersion !== 1) throw new Error("aggregationVersion niet gelezen");
});

Deno.test("P08-6 één kapotte meetrij kost alleen die rij", () => {
  const report = parseMeasurementEventsReport([
    event(1),
    { eventUid: uid(2), kind: "wear_value_changed", wearAfter: { fl: "banana" } },
    event(3),
  ]);
  if (report.rows.length !== 2) throw new Error(`verwachtte 2 goede rijen, kreeg ${report.rows.length}`);
  if (report.rejected.length !== 1) throw new Error("verwachtte één afgekeurde rij");
  if (report.rejected[0].id !== uid(2)) throw new Error("de afkeuring noemt niet de juiste rij");
  if (report.rejected[0].index !== 1) throw new Error("de afkeuring noemt niet de juiste positie");
  if (!/wear/i.test(report.rejected[0].reason)) throw new Error("de reden noemt wear niet");

  const laps = parseLapSummariesReport([lap(1), { summaryUid: uid(1002), lapNumber: 2.5 }, lap(3)]);
  if (laps.rows.length !== 2) throw new Error("een kapotte ronde kostte een andere ronde");
  if (laps.rejected.length !== 1) throw new Error("de kapotte ronde is niet afgekeurd");
});

Deno.test("P08-7 de grenzen zijn echte grenzen", () => {
  const teVeel: Record<string, unknown> = {};
  for (let i = 0; i < 33; i += 1) teVeel[`extraKey${i}`] = i;
  expectThrow(() => parseTelemetryV3Envelope({ ...legacyFrame(), ...teVeel }), "33 onbekende rootkeys");

  expectThrow(
    () => parseTelemetryV3Envelope(withBlock("bigBlock", { blob: "x".repeat(5000) })),
    "te grote onbekende waarde",
  );
  expectThrow(
    () => parseTelemetryV3Envelope(withBlock("deepBlock", { a: { b: { c: { d: 1 } } } })),
    "te diepe nesting",
  );

  // Te veel meetgebeurtenissen: het blok valt weg, het frame niet.
  const veel = Array.from({ length: MaxMeasurementEventsPerFrame + 1 }, (_, index) => event(index + 1));
  const parsed = parseTelemetryV3Envelope({ ...legacyFrame(), measurementEvents: veel });
  if (parsed.measurementEvents !== null) throw new Error("te lange reeks niet afgekeurd");
  if (parsed.measurementReport?.events.blockError !== "too_many") throw new Error("blockError niet gezet");

  const veelLaps = Array.from({ length: MaxLapSummariesPerFrame + 1 }, (_, index) => lap(index + 1));
  const parsedLaps = parseTelemetryV3Envelope({ ...legacyFrame(), lapSummaries: veelLaps });
  if (parsedLaps.lapSummaries !== null) throw new Error("te veel rondeaggregaten niet afgekeurd");
});

Deno.test("P08-8 wear_v1 en evidence_v1 zijn inhoudelijke contracten", () => {
  // De letterlijke probe uit de review.
  expectThrow(() => parseMeasurementEvent(event(1, { wearAfter: { fl: "banana" } }), 0), "wear banana");
  // Ontbrekende hoek, onbekende sleutel, verkeerde schaal, buiten bereik.
  expectThrow(
    () => parseMeasurementEvent(event(1, { wearAfter: { version: 1, scale: "remaining_percent", fl: 1, fr: 1, rl: 1 } }), 0),
    "wear zonder rr",
  );
  expectThrow(() => parseMeasurementEvent(event(1, { wearAfter: { ...wear(), grip: 3 } }), 0), "wear met grip");
  expectThrow(
    () => parseMeasurementEvent(event(1, { wearAfter: { ...wear(), scale: "fraction" } }), 0),
    "wear als fractie",
  );
  expectThrow(() => parseMeasurementEvent(event(1, { wearAfter: wear(101) }), 0), "wear boven 100");
  // Een wear-waarneming zonder bewijsgrond of confidence is geen waarneming.
  expectThrow(() => parseMeasurementEvent(event(1, { evidence: undefined }), 0), "wear zonder bewijs");
  expectThrow(() => parseMeasurementEvent(event(1, { confidence: null }), 0), "wear zonder confidence");
  expectThrow(
    () => parseMeasurementEvent(event(1, { evidence: { source: "tire_sets_used" } }), 0),
    "bewijs zonder kanalen",
  );
  expectThrow(() => parseMeasurementEvent(event(1, { confidence: 1.5 }), 0), "confidence boven 1");

  // En de geldige vorm komt er wel door, met de schaal expliciet.
  const ok = parseMeasurementEvent(event(1), 0);
  if (ok.wearAfter?.scale !== "remaining_percent") throw new Error("schaal niet bewaard");
  if (ok.recordRevision !== 1) throw new Error("recordRevision moet standaard 1 zijn");
});

Deno.test("P08-9 dekking: complete en integralen eisen hun eigen groep", () => {
  // complete=true zonder dekking.
  expectThrow(
    () => parseLapSummary(lap(1, { coverage: undefined }), 0),
    "complete zonder dekking",
  );
  // Een integraal zonder brandstofdekking.
  expectThrow(
    () => parseLapSummary(lap(1, { coverage: { temperature: group(), load: group() } }), 0),
    "brandstofintegraal zonder dekking",
  );
  // Temperatuur zonder temperatuurdekking.
  expectThrow(
    () => parseLapSummary(lap(1, { coverage: { fuel: group(), load: group() } }), 0),
    "temperatuur zonder dekking",
  );
  // Fractioneel aantal samples bestaat niet.
  expectThrow(() => parseLapSummary(lap(1, { sampleCount: 0.5 }), 0), "sampleCount 0.5");
  // Onbekende groep.
  expectThrow(
    () => parseLapSummary(lap(1, { coverage: { ...coverage(), brakes: group() } }), 0),
    "onbekende dekkingsgroep",
  );
  // Groepen gedekt maar het gat is te groot: niet compleet.
  expectThrow(
    () => parseLapSummary(lap(1, {
      coverage: { temperature: group(2400, 120, 12), fuel: group(), load: group() },
    }), 0),
    "complete met een te groot gat",
  );
  if (!coverageComplete(coverage())) throw new Error("een volledige dekking moet compleet zijn");
  if (coverageComplete(null)) throw new Error("zonder dekking is niets compleet");
});

Deno.test("P08-10 een oude V1/V2-payload blijft ongewijzigd", () => {
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
