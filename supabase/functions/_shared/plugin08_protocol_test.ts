/**
 * Plugin 0.7.2.0 — tests voor het ACK-rapport, de snapshotisolatie, de
 * herstelbare capability-detectie en de versieaanduiding.
 *
 * Draai met: deno test --allow-env --allow-read supabase/functions/_shared/plugin08_protocol_test.ts
 *
 * Bewijst de reviewpunten 3 (ACK), 7 (snapshotisolatie), 9 (herstel) en 11
 * (versie 0.7.2.0, protocolVersion blijft 3).
 */
import { normalizeTelemetryEnvelope } from "./simhub.ts";
import {
  AggregatesRetryMs,
  afterAggregatesSuccess,
  afterMissingFunction,
  aggregateBatch,
  capabilityStatus,
  initialCapability,
  mergeMeasurementAck,
  persistArguments,
  shouldAttemptAggregates,
  snapshotDto,
} from "./simhubAggregates.ts";
import { ServerProtocolVersion, ServerSchemaRevision, MaxPayloadBudgetBytes, MinSendIntervalMs } from "./simhubControl.ts";

declare const Deno: {
  test(name: string, fn: () => void | Promise<void>): void;
  readTextFile(path: string): Promise<string>;
};

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const frame = () => ({
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
  timing: { currentLapElapsedSeconds: 40, lastLapTimeSeconds: 120.5, bestLapTimeSeconds: 120.5, completedLaps: 3 },
  position: { position: 3, classPosition: 2, gapToLeaderSeconds: 1.5 },
  track: { lapDistancePct: 0.4, trackSurface: "on_track", onPitRoad: false },
  fuel: { fuelLitres: 40.5, fuelPct: 0.5 },
  raceState: { incidents: 0 },
  pitService: { pitServiceFlagsRaw: 0, requiredRepairSeconds: 0, optionalRepairSeconds: 0 },
});

const event = (n: number) => ({
  eventUid: uid(n),
  kind: "wear_refresh_confirmed",
  observedAt: "2026-10-31T12:00:00Z",
  confidence: 0.9,
  wearAfter: { version: 1, scale: "remaining_percent", fl: 0.2, fr: 0.2, rl: 0.2, rr: 0.2 },
  evidence: { version: 1, source: "tire_sets_used", channels: ["tire_sets_used"] },
});

const group = () => ({ sampleCount: 2400, validDurationSeconds: 120, maxGapSeconds: 0.1 });

const lap = (n: number) => ({
  summaryUid: uid(1000 + n),
  lapNumber: n,
  complete: true,
  trackTempCMean: 32.5,
  fuelLevelIntegralLitreSeconds: 4875,
  sampleCount: 7200,
  coverage: { temperature: group(), fuel: group(), load: group() },
});

Deno.test("P08-P1 de snapshot-DTO bevat geen meetserie", () => {
  const parsed = normalizeTelemetryEnvelope({ ...frame(), measurementEvents: [event(1)], lapSummaries: [lap(1)] });
  if (!parsed.measurementEvents || !parsed.lapSummaries) throw new Error("de parser moet de reeksen hebben");

  const dto = snapshotDto(parsed);
  for (const key of ["measurementEvents", "lapSummaries", "measurementReport"]) {
    if (key in dto) throw new Error(`${key} staat nog in de snapshot-DTO`);
  }
  // De kerntelemetrie is er wel, en het origineel is niet aangepast.
  if ((dto.timing as { completedLaps: number }).completedLaps !== 3) throw new Error("kernvelden beschadigd");
  if (!parsed.measurementEvents) throw new Error("snapshotDto heeft het origineel aangepast");
});

Deno.test("P08-P2 het ACK noemt per rij wat er gebeurde", () => {
  const parsed = normalizeTelemetryEnvelope({
    ...frame(),
    measurementEvents: [event(1), { eventUid: uid(2), kind: "x", wearAfter: { fl: "banana" } }],
  });
  const dbAck = {
    ok: true,
    events: {
      received: 1,
      accepted: [{ id: uid(1), record_revision: 4 }],
      duplicates: [],
      superseded: [],
      rejected: [{ id: uid(1), index: 0, reason: "revision_conflict" }],
      block_error: null,
    },
    laps: { received: 0, accepted: [], duplicates: [], superseded: [], rejected: [], block_error: null },
  };
  const ack = mergeMeasurementAck(parsed.measurementReport ?? null, dbAck, true);
  if (ack.events.accepted[0]?.id !== uid(1)) throw new Error("geaccepteerde rij niet gemeld");
  if (ack.events.accepted[0]?.recordRevision !== 4) throw new Error("bevestigde revisie niet gemeld");
  const reasons = ack.events.rejected.map((r) => `${r.stage}:${r.reason}`);
  if (!reasons.includes("database:revision_conflict")) throw new Error("database-afwijzing niet gemeld");
  if (!reasons.some((r) => r.startsWith("parser:"))) throw new Error("parserafkeuring niet gemeld");
  if (!ack.events.stored) throw new Error("ACK zegt niet dat het is opgeslagen");
});

Deno.test("P08-P3 zonder database-ACK is de meetserie eerlijk niet opgeslagen", () => {
  const parsed = normalizeTelemetryEnvelope({ ...frame(), measurementEvents: [event(1)] });
  const ack = mergeMeasurementAck(parsed.measurementReport ?? null, null, false);
  if (ack.events.stored) throw new Error("ACK claimt opslag zonder database-ACK");
  if (ack.events.block_error !== "aggregates_unsupported") throw new Error("reden van de degradatie ontbreekt");
  if (ack.events.received !== 1) throw new Error("het aantal aangeboden rijen ontbreekt");
});

Deno.test("P08-P4 capability herstelt zichzelf na de TTL", () => {
  let state = initialCapability(0);
  if (!shouldAttemptAggregates(state, 1000)) throw new Error("moet beginnen met proberen");

  state = afterMissingFunction(10_000);
  if (shouldAttemptAggregates(state, 10_000 + AggregatesRetryMs - 1)) {
    throw new Error("probeert opnieuw binnen de TTL");
  }
  if (!shouldAttemptAggregates(state, 10_000 + AggregatesRetryMs)) {
    throw new Error("herprobeert niet na de TTL — de fout zou permanent zijn");
  }
  const status = capabilityStatus(state, 10_000);
  if (!status.degraded || status.reason !== "missing_function") throw new Error("degradatie niet zichtbaar");
  if (status.retryInMs === null) throw new Error("geen retrytermijn in het antwoord");

  state = afterAggregatesSuccess(20_000);
  if (!shouldAttemptAggregates(state, 20_000)) throw new Error("na succes moet er weer geprobeerd worden");
  if (capabilityStatus(state, 20_000).degraded) throw new Error("na succes is er geen degradatie");
});

Deno.test("P08-P5 zonder meetserie blijven het vijf argumenten", () => {
  const parsed = normalizeTelemetryEnvelope(frame());
  const batch = aggregateBatch(parsed);
  const base = { p_token_hash: "x", p_session_id: "s", p_sequence: 1, p_captured_at: "t", p_v3_normalized: {} };
  const args = persistArguments(base, batch, true);
  if (Object.keys(args).length !== Object.keys(base).length) throw new Error("extra argumenten zonder reeksen");
});

Deno.test("P08-P6 de versie is 0.7.2.0 en protocolVersion blijft 3", async () => {
  if (ServerProtocolVersion !== 3) throw new Error("protocolVersion is niet 3");
  if (ServerSchemaRevision !== 1) throw new Error("schemaRevision is niet 1");

  const contract = await Deno.readTextFile("docs/contracts/measurement-ids-v1.md");
  if (!contract.includes("0.7.2.0")) throw new Error("het contract noemt 0.7.2.0 niet");
  if (contract.includes("0.8.0.0")) throw new Error("het contract noemt nog 0.8.0.0");

  const plan = await Deno.readTextFile("docs/plans/2026-10-31-plugin-08-server-voorstel.md");
  if (plan.includes("0.8.0.0")) throw new Error("het plan noemt nog 0.8.0.0");
  if (!plan.includes("0.7.2.0")) throw new Error("het plan noemt 0.7.2.0 niet");

  // De controlgrenzen zijn de ingestgrenzen.
  if (MinSendIntervalMs !== 400) throw new Error("ondergrens van sendIntervalMs is niet 400");
  if (MaxPayloadBudgetBytes !== 24576) throw new Error("payloadbudget is niet 24576");
});
