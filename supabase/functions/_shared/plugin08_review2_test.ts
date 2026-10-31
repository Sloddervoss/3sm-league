/**
 * Plugin 0.7.2.0 — tests voor de tweede DDL-review (6.1 sol).
 *
 * Draai met:
 *   deno test --allow-env --allow-read supabase/functions/_shared/plugin08_review2_test.ts
 *
 * Wat hier bewezen wordt:
 *  - een databasefout wordt `stored:false` met reden, geen leeg succes (punt 2);
 *  - bevestigingen dragen de bevestigde record_revision (punt 2);
 *  - parser- en database-indexen beschrijven dezelfde, oorspronkelijke reeks,
 *    ook als de parser de middelste rij al had afgekeurd (punt 2).
 */
import type { NormalizedTelemetryEnvelope } from "./simhub.ts";
import { controlWriteOutcome } from "./simhubControl.ts";
import { mergeMeasurementAck, ackHasRejections } from "./simhubAggregates.ts";
import {
  parseLapSummariesReport,
  parseLapSummary,
  parseMeasurementEventsReport,
} from "./simhubExtensions.ts";

declare const Deno: {
  test(name: string, fn: () => void | Promise<void>): void;
};

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const wear = (fl = 12.5) => ({ version: 1, scale: "remaining_percent", fl, fr: fl, rl: fl, rr: fl });
const evidence = () => ({ version: 1, source: "tire_sets_used", channels: ["tire_sets_used"] });

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
  evidence: evidence(),
  confidence: 0.9,
  ...extra,
});

const report = (rows: unknown[], laps: unknown[] = []): NormalizedTelemetryEnvelope["measurementReport"] => ({
  events: parseMeasurementEventsReport(rows),
  laps: parseLapSummariesReport(laps),
}) as NonNullable<NormalizedTelemetryEnvelope["measurementReport"]>;

Deno.test("R2-1 een databasefout is stored:false met reden, geen leeg succes", () => {
  const parser = report([event(1), event(2)]);
  const ack = mergeMeasurementAck(parser, { ok: false, error: "measurement_batch_failed" }, true);
  if (ack.events.stored !== false) throw new Error("events.stored moet false zijn");
  if (ack.events.block_error !== "measurement_batch_failed") throw new Error(`block_error = ${ack.events.block_error}`);
  if (ack.events.received !== 2) throw new Error("received moet de aangeboden reeks zijn");
  if (!ackHasRejections(ack)) throw new Error("een mislukte batch moet zichtbaar zijn");
  // Dezelfde fout, maar zonder db.error: nog steeds een reden, nooit null.
  const zonderReden = mergeMeasurementAck(parser, { ok: false }, true);
  if (zonderReden.events.block_error !== "measurement_batch_failed") throw new Error("fallbackreden ontbreekt");
});

Deno.test("R2-2 bevestigingen dragen de bevestigde record_revision", () => {
  const parser = report([event(1)]);
  const ack = mergeMeasurementAck(parser, {
    ok: true,
    events: {
      received: 1,
      accepted: [{ id: uid(1), record_revision: 7 }],
      duplicates: [],
      superseded: [],
      rejected: [],
      block_error: null,
    },
    laps: { received: 0, accepted: [], duplicates: [], superseded: [], rejected: [], block_error: null },
  }, true);
  if (ack.events.accepted.length !== 1) throw new Error("geen bevestiging");
  if (ack.events.accepted[0].id !== uid(1)) throw new Error("verkeerde id");
  if (ack.events.accepted[0].recordRevision !== 7) throw new Error("revisie niet bevestigd");
  // Een oude database geeft nog kale strings: dan is de revisie onbekend (null),
  // niet "1" en niet weggelaten.
  const oud = mergeMeasurementAck(parser, {
    ok: true,
    events: { received: 1, accepted: [uid(1)], duplicates: [], superseded: [], rejected: [], block_error: null },
    laps: { received: 0, accepted: [], duplicates: [], superseded: [], rejected: [], block_error: null },
  }, true);
  if (oud.events.accepted[0].recordRevision !== null) throw new Error("revisie verzonnen");
});

Deno.test("R2-4 complete vereist echte rondedekking", () => {
  const group = (sampleCount: number, validDurationSeconds: number, maxGapSeconds: number) =>
    ({ sampleCount, validDurationSeconds, maxGapSeconds });
  const base = {
    summaryUid: uid(1000),
    summaryId: "lap-1",
    segmentId: "seg-1",
    observedSessionId: "sess-1",
    lapNumber: 1,
    startedAt: "2026-10-31T11:58:00Z",
    endedAt: "2026-10-31T12:00:00Z",
    currentDriverName: "Driver One",
    aggregationVersion: 1,
    complete: true,
    invalidReasons: [] as string[],
    pitLap: false,
    driverChanged: false,
    trackTempCMean: 32.5,
    fuelLevelIntegralLitreSeconds: 4875,
    absLatAccelIntegralGSeconds: 220,
    sampleCount: 7200,
  };
  // De probe: 1 sample en 0,001 s per groep bij een venster van twee minuten.
  const dun = parseLapSummary({
    ...base,
    coverage: { temperature: group(1, 0.001, 0), fuel: group(1, 0.001, 0), load: group(1, 0.001, 0) },
  }, 0);
  if (dun.complete !== false) throw new Error("1 sample werd als compleet gezien");
  if (!(dun.invalidReasons ?? []).includes("coverage_samples:temperature")) {
    throw new Error("de reden voor het sampleaantal ontbreekt");
  }
  if (!(dun.invalidReasons ?? []).includes("coverage_duration:window")) {
    throw new Error("de reden voor het venster ontbreekt");
  }
  // Een volledig gemeten ronde blijft compleet.
  const vol = parseLapSummary({
    ...base,
    coverage: { temperature: group(2400, 120, 0.1), fuel: group(2400, 120, 0.1), load: group(2400, 120, 0.1) },
  }, 0);
  if (vol.complete !== true) throw new Error("een volledige ronde werd niet compleet");
  if ((vol.invalidReasons ?? []).length !== 0) throw new Error("een complete ronde kreeg redenen");
  // 80% van het venster is de grens.
  const grens = parseLapSummary({
    ...base,
    coverage: { temperature: group(10, 32, 2), fuel: group(10, 32, 2), load: group(10, 32, 2) },
  }, 0);
  if (grens.complete !== true) throw new Error("exact 80% werd niet compleet");
});

Deno.test("R2-6 out_of_range is een invoerfout met reden, geen 503", () => {
  const uit = controlWriteOutcome({
    result: "out_of_range",
    config_revision: 4,
    ignored_feature_keys: [],
    rejection_detail: "sendIntervalMs:400..10000",
  });
  if (uit.status !== 400) throw new Error(`status = ${uit.status}, verwacht 400`);
  if (uit.body.error !== "out_of_range") throw new Error("foutcode niet doorgegeven");
  if (uit.body.reason !== "sendIntervalMs:400..10000") throw new Error("de reden is niet doorgegeven");
  if (uit.body.configRevision !== 4) throw new Error("de configuratierevisie ontbreekt");

  const ongeldig = controlWriteOutcome({
    result: "invalid_payload", rejection_detail: "features_not_an_object", config_revision: 4,
  });
  if (ongeldig.status !== 422 || ongeldig.body.reason !== "features_not_an_object") {
    throw new Error("invalid_payload verliest de reden");
  }
  // Een echte schrijffout blijft 503; een geslaagde schrijfactie blijft 200.
  if (controlWriteOutcome({ result: "write_failed" }).status !== 503) throw new Error("503 verdwenen");
  const ok = controlWriteOutcome({ result: "applied", config_revision: 5, ignored_feature_keys: ["x"] });
  if (ok.status !== 200 || ok.body.configRevision !== 5) throw new Error("applied niet doorgegeven");
});

Deno.test("R2-5 evidence: null is geen bewijs en wear.version is verplicht", () => {
  const zonderBewijs = parseMeasurementEventsReport([event(1, { evidence: null })]);
  if (zonderBewijs.rows.length !== 0) throw new Error("evidence null werd geaccepteerd");
  if (!/evidence/.test(zonderBewijs.rejected[0].reason)) throw new Error("de reden noemt bewijs niet");

  const zonderVersie = parseMeasurementEventsReport([
    event(1, { wearAfter: { scale: "remaining_percent", fl: 12, fr: 12, rl: 12, rr: 12 } }),
  ]);
  if (zonderVersie.rows.length !== 0) throw new Error("wear zonder version werd geaccepteerd");
  if (!/version/.test(zonderVersie.rejected[0].reason)) throw new Error("de reden noemt version niet");

  const metVersie = parseMeasurementEventsReport([event(1)]);
  if (metVersie.rows.length !== 1) throw new Error("geldige wear werd geweigerd");
});

Deno.test("R2-3 parser- en database-indexen beschrijven dezelfde reeks", () => {
  // Drie rijen, de middelste is ongeldig in de parser. De database ziet dus
  // alleen rij 0 en rij 2, en nummert die als 0 en 1.
  const parser = report([event(1), { eventUid: uid(2), kind: "wear_value_changed", wearAfter: { fl: "banana" } }, event(3)]);
  if (parser!.events.received !== 3) throw new Error("received moet 3 zijn");
  if (parser!.events.acceptedIndexes.join(",") !== "0,2") throw new Error("acceptedIndexes niet 0,2");

  const ack = mergeMeasurementAck(parser, {
    ok: true,
    events: {
      received: 2,
      accepted: [{ id: uid(1), record_revision: 1 }],
      duplicates: [],
      superseded: [],
      // Database-index 1 = de tweede goedgekeurde rij = payloadindex 2.
      rejected: [{ id: uid(3), index: 1, reason: "revision_conflict" }],
      block_error: null,
    },
    laps: { received: 0, accepted: [], duplicates: [], superseded: [], rejected: [], block_error: null },
  }, true);

  if (ack.events.received !== 3) throw new Error(`received = ${ack.events.received}, verwacht 3`);
  const indexes = ack.events.rejected.map((entry) => `${entry.stage}:${entry.index}`).join(",");
  if (indexes !== "parser:1,database:2") throw new Error(`indexruimte = ${indexes}`);
  if (ack.events.accepted[0].recordRevision !== 1) throw new Error("revisie ontbreekt");
});
