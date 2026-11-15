import { describe, expect, it } from "vitest";

import { buildCanonicalContext, type CanonicalContext } from "./context";
import {
  TYRE_INTERVAL_MAX_OBSERVATIONS,
  buildTyreIntervals,
  type TyreCornerInterval,
  type TyreDistanceEvidenceInput,
  type TyreIntervalObservationInput,
  type TyreIntervalResult,
  type TyreServiceEvidenceInput,
} from "./tyreIntervals";

/**
 * SYNTHETISCHE POSITIEVE FIXTURES.
 *
 * Deze waarden bewijzen de domeinregels en de binding, niet dat de historische
 * P1-populatie deze velden al levert en niet dat een model nauwkeurig is.
 * Alle getallen zijn verzonnen testgevallen.
 */

type Json = Record<string, unknown>;

const OWNER = "22222222-2222-4222-8222-222222222222";
const OTHER_OWNER = "44444444-4444-4444-8444-444444444444";
const CAR = "car-gt3-1";
const TRACK = "track-spa";
const LAYOUT = "layout-endurance";
const SESSION = "obs-session-1";
const OTHER_SESSION = "obs-session-2";
const SEGMENT = "seg-1";
const DEVICE = "device-a";

function uid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function hash(n: number): string {
  return n.toString(16).padStart(32, "0");
}

function two(value: number): string {
  return String(value).padStart(2, "0");
}

function at(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `2026-11-11T10:${two(minutes)}:${two(rest)}.000Z`;
}

function wear(value: number | readonly [number, number, number, number]): Json {
  if (typeof value === "number") {
    return { version: 1, scale: "remaining_percent", fl: value, fr: value, rl: value, rr: value };
  }
  return {
    version: 1,
    scale: "remaining_percent",
    fl: value[0],
    fr: value[1],
    rl: value[2],
    rr: value[3],
  };
}

function generation(value: number | readonly [number, number, number, number]): Json {
  if (typeof value === "number") {
    return { version: 1, fl: value, fr: value, rl: value, rr: value };
  }
  return { version: 1, fl: value[0], fr: value[1], rl: value[2], rr: value[3] };
}

function defaultEvidenceSource(kind: string): string {
  return kind === "wear_refresh_confirmed" ? "tire_sets_used" : "wear_channels";
}

interface EventSpec {
  readonly n: number;
  readonly kind: string;
  readonly at: string;
  readonly before?: number | readonly [number, number, number, number] | null;
  readonly after?: number | readonly [number, number, number, number] | null;
  readonly gen?: number | readonly [number, number, number, number] | null;
  readonly evidenceSource?: string | null;
  readonly confidence?: number;
  readonly resultHash?: string;
  readonly session?: string;
  readonly segment?: string;
  readonly device?: string;
  readonly uid?: string;
  readonly revision?: number;
  readonly receivedAt?: string;
  readonly driverChanged?: boolean;
  readonly observedContext?: CanonicalContext | null;
  readonly annotations?: { readonly resetOrTow?: boolean | null } | null;
  readonly serviceEvidence?: TyreServiceEvidenceInput | null;
  readonly distanceEvidence?: TyreDistanceEvidenceInput | null;
}

interface BuiltEvent extends TyreIntervalObservationInput {
  readonly source: Json;
  readonly payload: Json;
}

function event(spec: EventSpec): BuiltEvent {
  const source: Json = {
    sourceKind: "measurement_event",
    deviceId: spec.device ?? DEVICE,
    sourceUid: spec.uid ?? uid(spec.n),
    recordRevision: spec.revision ?? 1,
    contentHash: spec.resultHash ?? hash(spec.n),
    observedAt: spec.at,
    sourceReceivedAt: spec.receivedAt ?? spec.at,
  };
  const payload: Json = {
    kind: spec.kind,
    observed_session_id: spec.session ?? SESSION,
    delivered_session_id: "delivery-1",
    segment_id: spec.segment ?? SEGMENT,
    observed_at: spec.at,
    session_time_seconds: spec.n * 10,
  };
  if (spec.before !== undefined) {
    payload.wear_before = spec.before === null ? null : wear(spec.before);
  }
  if (spec.after !== undefined) {
    payload.wear_after = spec.after === null ? null : wear(spec.after);
  }
  if (spec.gen !== undefined) {
    payload.set_generation = spec.gen === null ? null : generation(spec.gen);
  }
  if (spec.evidenceSource !== null) {
    payload.evidence = {
      version: 1,
      source: spec.evidenceSource ?? defaultEvidenceSource(spec.kind),
      channels: [],
    };
  }
  if (spec.confidence !== undefined) payload.confidence = spec.confidence;
  if (spec.driverChanged !== undefined) payload.driver_changed = spec.driverChanged;

  const built: BuiltEvent = {
    source,
    payload,
    ...(spec.observedContext !== undefined ? { observedContext: spec.observedContext } : {}),
    ...(spec.annotations !== undefined ? { annotations: spec.annotations } : {}),
    ...(spec.serviceEvidence !== undefined ? { serviceEvidence: spec.serviceEvidence } : {}),
    ...(spec.distanceEvidence !== undefined ? { distanceEvidence: spec.distanceEvidence } : {}),
  };
  return built;
}

function contextFor(value: BuiltEvent, overrides: Json = {}): CanonicalContext {
  const context = buildCanonicalContext({
    source: value.source,
    payload: value.payload,
    claims: {
      provenance: "inline_observed",
      ownerUserId: OWNER,
      driverId: "driver-1",
      carId: CAR,
      trackId: TRACK,
      layoutId: LAYOUT,
      compoundId: 3,
      regime: "dry",
      ...overrides,
    },
  });
  if (context === null) throw new Error("expected canonical context");
  return context;
}

function contextWith(value: BuiltEvent, overrides: Json = {}): BuiltEvent {
  return { ...value, observedContext: contextFor(value, overrides) };
}

function bindingFor(value: BuiltEvent): TyreServiceEvidenceInput["binding"] {
  const payload = value.payload;
  return {
    sourceKind: "measurement_event",
    deviceId: value.source.deviceId as string,
    sourceUid: value.source.sourceUid as string,
    recordRevision: value.source.recordRevision as number,
    contentHash: value.source.contentHash as string,
    observedSessionId: payload.observed_session_id as string,
    observedAt: value.source.observedAt as string,
    sessionTimeSeconds: payload.session_time_seconds as number,
  };
}

function withService(value: BuiltEvent, performedCorners: readonly ("fl" | "fr" | "rl" | "rr")[]): BuiltEvent {
  return {
    ...value,
    serviceEvidence: {
      binding: bindingFor(value),
      basis: "executed_service_confirmation",
      performedCorners,
    },
  };
}

function withDistance(
  value: BuiltEvent,
  odometerMetres: number,
  basis = "session_odometer_metres",
): BuiltEvent {
  return {
    ...value,
    distanceEvidence: { binding: bindingFor(value), basis, odometerMetres },
  };
}

function build(
  input: readonly unknown[],
  options?: { readonly referenceContext?: CanonicalContext | null; readonly sourceReceivedBefore?: string | null },
): TyreIntervalResult {
  const result = buildTyreIntervals(input, options);
  if (result === null) throw new Error("expected an interval result");
  return result;
}

function cornerIntervals(result: TyreIntervalResult, corner: "fl" | "fr" | "rl" | "rr"): TyreCornerInterval[] {
  return result.intervals.filter((interval) => interval.corner === corner);
}

function firstCorner(result: TyreIntervalResult, corner: "fl" | "fr" | "rl" | "rr"): TyreCornerInterval {
  const intervals = cornerIntervals(result, corner);
  if (intervals.length === 0) throw new Error(`expected ${corner} interval`);
  return intervals[0];
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value as Json)) deepFreeze(child);
  }
  return value;
}

function uidsOf(interval: TyreCornerInterval): string[] {
  return interval.provenance.observationRefs.map((ref) => ref.sourceUid);
}

describe("fysieke bandintervallen (T11)", () => {
  describe("brandstof-only en partiële service", () => {
    it("houdt de fysieke set over een fuel-only pitstop", () => {
      const start = event({ n: 1, kind: "session_start", at: at(0), before: null, after: 100, gen: 0 });
      const worn = event({ n: 2, kind: "wear_value_changed", at: at(10), before: 100, after: 98, gen: 0 });
      const fuelOnly = event({
        n: 3,
        kind: "pit_service_completed",
        at: at(20),
        before: 98,
        after: 98,
        gen: 0,
      });

      const result = build([start, worn, fuelOnly]);
      const intervals = cornerIntervals(result, "fl");
      expect(intervals).toHaveLength(1);
      expect(intervals[0].status).toBe("censored");
      expect(intervals[0].usable).toBe(false);
      expect(intervals[0].start?.wearPercent).toBe(100);
      expect(intervals[0].lastObserved?.wearPercent).toBe(98);
      expect(intervals[0].observedLossPercent).toBeNull();
      expect(intervals[0].physical.generation.sequence).toBe(0);
      expect(intervals[0].physical.selectedServiceObserved).toBe(true);
      expect(intervals[0].counts.performedNewTyre).toBe(0);
      expect(intervals[0].counts.refreshConfirmed).toBe(0);
    });

    it("sluit alleen het vervangen wiel en houdt de andere drie generaties", () => {
      const start = event({ n: 1, kind: "session_start", at: at(0), before: null, after: 100, gen: 0 });
      const worn = event({ n: 2, kind: "wear_value_changed", at: at(10), before: 100, after: 94, gen: 0 });
      const partial = event({
        n: 3,
        kind: "wear_refresh_confirmed",
        at: at(20),
        before: 94,
        after: [100, 94, 94, 94],
        gen: [1, 0, 0, 0],
        evidenceSource: "tire_sets_used",
      });

      const result = build([start, worn, partial]);
      const fl = cornerIntervals(result, "fl");
      expect(fl).toHaveLength(2);
      expect(fl[0].status).toBe("closed");
      expect(fl[0].usable).toBe(true);
      expect(fl[0].observedLossPercent).toBe(6);
      expect(fl[0].physical.endPerformedNewTyreConfirmed).toBe(true);
      expect(fl[1].start?.wearPercent).toBe(100);
      expect(fl[1].physical.generation.sequence).toBe(1);
      expect(fl[1].physical.generation.newTyreConfirmedAtStart).toBe(true);
      expect(fl[1].physical.generation.startSourceUid).toBe(uid(3));

      for (const corner of ["fr", "rl", "rr"] as const) {
        const intervals = cornerIntervals(result, corner);
        expect(intervals).toHaveLength(2);
        expect(intervals[0].observedLossPercent).toBe(6);
        expect(intervals[0].physical.endPerformedNewTyreConfirmed).toBe(false);
        expect(intervals[1].start?.wearPercent).toBe(94);
        expect(intervals[1].physical.generation.sequence).toBe(0);
        expect(intervals[1].physical.generation.newTyreConfirmedAtStart).toBe(false);
        expect(intervals[1].physical.generation.startSourceUid).toBe(uid(1));
      }
    });
  });

  describe("refresh, teller en waardesprongen", () => {
    it("telt een bevestigde refresh met dezelfde wear als echte anker, niet als nieuwe set", () => {
      const start = event({ n: 1, kind: "session_start", at: at(0), before: null, after: 90, gen: 0 });
      const refresh = event({
        n: 2,
        kind: "wear_refresh_confirmed",
        at: at(10),
        before: 90,
        after: 90,
        gen: 0,
        evidenceSource: "tire_sets_used",
      });

      const result = build([start, refresh]);
      const intervals = cornerIntervals(result, "fl");
      expect(intervals).toHaveLength(2);
      expect(intervals[0].status).toBe("closed");
      expect(intervals[0].observedLossPercent).toBe(0);
      expect(intervals[1].startContinuity).toBe("confirmed_refresh");
      expect(intervals[1].physical.generation.sequence).toBe(0);
      expect(intervals[1].physical.generation.newTyreConfirmedAtStart).toBe(false);

      const observation = result.observations[1];
      expect(observation.facts.realRefreshConfirmed).toBe(true);
      expect(observation.facts.corners.fl.performedNewTyreConfirmed).toBe(false);
      expect(observation.facts.corners.fl.performedNewTyreBasis).toBeNull();
    });

    it("laat een vastgelopen set-teller een wear-sprong niet als vervanging gelden", () => {
      const start = event({ n: 1, kind: "session_start", at: at(0), before: null, after: 100, gen: 1 });
      const jump = event({
        n: 2,
        kind: "wear_refresh_confirmed",
        at: at(10),
        before: 94,
        after: [100, 94, 94, 94],
        gen: 1,
        evidenceSource: "tire_sets_used",
      });
      const close = event({
        n: 3,
        kind: "wear_refresh_confirmed",
        at: at(20),
        before: [100, 94, 94, 94],
        after: [100, 94, 94, 94],
        gen: 1,
        evidenceSource: "tire_sets_used",
      });

      const result = build([start, jump, close]);
      const fl = cornerIntervals(result, "fl");
      expect(fl).toHaveLength(3);
      expect(fl[1].startContinuity).toBe("refresh_after_unconfirmed_increase");
      expect(fl[1].status).toBe("unknown");
      expect(fl[1].usable).toBe(false);
      expect(fl[1].physical.generation.sequence).toBe(0);
      expect(fl[1].physical.generation.newTyreConfirmedAtStart).toBe(false);
      expect(fl[1].reasons).toContain("start_continuity_unproven");
      expect(fl[2].startContinuity).toBe("confirmed_refresh");

      const observation = result.observations[1];
      expect(observation.facts.corners.fl.valueIncreased).toBe(true);
      expect(observation.facts.corners.fl.performedNewTyreConfirmed).toBe(false);
      expect(observation.facts.corners.fl.setGeneration).toBe(1);
    });

    it("breekt bij een tegengestelde wear-sprong alleen de geraakte hoek", () => {
      const start = event({ n: 1, kind: "session_start", at: at(0), before: null, after: 100, gen: 0 });
      const jump = event({
        n: 2,
        kind: "wear_value_changed",
        at: at(10),
        before: 98,
        after: [99, 96, 96, 96],
        gen: 0,
        confidence: 0.9,
      });
      const close = event({
        n: 3,
        kind: "wear_refresh_confirmed",
        at: at(20),
        before: [96, 96, 96, 96],
        after: [96, 96, 96, 96],
        gen: 0,
        evidenceSource: "tire_sets_used",
      });

      const result = build([start, jump, close]);
      const fl = cornerIntervals(result, "fl");
      expect(fl[0].status).toBe("unknown");
      expect(fl[0].usable).toBe(false);
      expect(fl[0].observedLossPercent).toBeNull();
      expect(fl[0].reasons).toContain("wear_increase_unconfirmed");
      expect(result.observations[1].facts.realRefreshConfirmed).toBe(false);
      expect(result.observations[1].facts.corners.fl.performedNewTyreConfirmed).toBe(false);
      expect(result.observations[1].facts.corners.fl.valueIncreased).toBe(true);

      for (const corner of ["fr", "rl", "rr"] as const) {
        const intervals = cornerIntervals(result, corner);
        expect(intervals[0].status).toBe("closed");
        expect(intervals[0].observedLossPercent).toBe(4);
        expect(intervals[0].physical.generation.sequence).toBe(0);
        expect(intervals[0].physical.generation.startSourceUid).toBe(uid(1));
      }
      // Eén hoeksprong reset nooit alle vier generaties.
      expect(result.intervals.filter((interval) => interval.corner !== "fl").every((interval) => interval.start)).toBe(true);
    });

    it("maakt van wear_value_changed nooit een refresh of vervanging", () => {
      const start = event({ n: 1, kind: "session_start", at: at(0), before: null, after: 100, gen: 0 });
      const changed = event({
        n: 2,
        kind: "wear_value_changed",
        at: at(10),
        before: 96,
        after: [100, 96, 96, 96],
        gen: [1, 0, 0, 0],
        evidenceSource: "tire_sets_used",
        confidence: 0.9,
      });

      const result = build([start, changed]);
      const observation = result.observations[1];
      expect(observation.facts.realRefreshConfirmed).toBe(false);
      expect(observation.facts.refreshBasis).toBeNull();
      expect(observation.facts.corners.fl.performedNewTyreConfirmed).toBe(false);
      expect(cornerIntervals(result, "fl")[0].status).toBe("unknown");
      expect(cornerIntervals(result, "fl")[0].reasons).toContain("wear_increase_unconfirmed");
    });

    it("herhaalt een gelijke last_available-waarde zonder nieuwe set of extra interval", () => {
      const events = [
        event({ n: 1, kind: "session_start", at: at(0), before: null, after: 100, gen: 0 }),
        event({ n: 2, kind: "wear_value_changed", at: at(10), before: 100, after: 99, gen: 0 }),
        event({ n: 3, kind: "wear_value_changed", at: at(20), before: 99, after: 99, gen: 0 }),
        event({ n: 4, kind: "wear_value_changed", at: at(30), before: 99, after: 99, gen: 0 }),
      ];

      const result = build(events);
      const intervals = cornerIntervals(result, "fl");
      expect(intervals).toHaveLength(1);
      expect(intervals[0].counts.observations).toBe(4);
      expect(intervals[0].counts.valueChanged).toBe(1);
      expect(intervals[0].physical.generation.sequence).toBe(0);
      expect(result.observations[2].facts.corners.fl.valueChanged).toBe(false);
      expect(result.observations[3].facts.corners.fl.valueChanged).toBe(false);
    });
  });

  describe("start, einde en reset", () => {
    it("verzint zonder startanker geen interval en nooit 100 procent", () => {
      const orphan = event({
        n: 1,
        kind: "wear_value_changed",
        at: at(0),
        before: 100,
        after: 98,
        gen: 0,
      });

      const result = build([orphan]);
      expect(result.intervals).toHaveLength(0);
      expect(result.observations).toHaveLength(1);
      expect(result.observations[0].reasons).toContain("awaiting_physical_anchor");
      expect(JSON.stringify(result)).not.toMatch(/"wearPercent":100/);
    });

    it("houdt een interval zonder eind gescheiden als censored", () => {
      const start = event({ n: 1, kind: "session_start", at: at(0), before: null, after: 87, gen: 0 });
      const result = build([start]);
      const interval = firstCorner(result, "fl");
      expect(interval.status).toBe("censored");
      expect(interval.usable).toBe(false);
      expect(interval.end).toBeNull();
      expect(interval.observedLossPercent).toBeNull();
      expect(interval.lastObserved?.wearPercent).toBe(87);
    });

    it("bewaart een echte nul als waarde en niet als ontbrekend", () => {
      const start = event({ n: 1, kind: "session_start", at: at(0), before: null, after: 0, gen: 0 });
      const refresh = event({
        n: 2,
        kind: "wear_refresh_confirmed",
        at: at(10),
        before: 0,
        after: 0,
        gen: 0,
        evidenceSource: "tire_sets_used",
      });

      const result = build([start, refresh]);
      const interval = firstCorner(result, "fl");
      expect(interval.start?.wearPercent).toBe(0);
      expect(interval.end?.wearPercent).toBe(0);
      expect(interval.observedLossPercent).toBe(0);
      expect(interval.status).toBe("closed");
      expect(result.observations[0].facts.corners.fl.valueReceived).toBe(true);
      expect(result.observations[0].facts.corners.fl.valuePercent).toBe(0);
    });

    it("breekt bij een expliciete reset/tow zonder een nieuwe set te verzinnen", () => {
      const start = event({ n: 1, kind: "session_start", at: at(0), before: null, after: 100, gen: 0 });
      const reset = event({
        n: 2,
        kind: "wear_value_changed",
        at: at(10),
        before: 98,
        after: 96,
        gen: 0,
        annotations: { resetOrTow: true },
      });
      const reStart = event({ n: 3, kind: "session_start", at: at(20), before: null, after: 80, gen: 0 });

      const result = build([start, reset, reStart]);
      const intervals = cornerIntervals(result, "fl");
      expect(intervals).toHaveLength(2);
      expect(intervals[0].status).toBe("unknown");
      expect(intervals[0].reasons).toContain("reset_or_tow_observed");
      expect(intervals[1].start?.wearPercent).toBe(80);
      expect(intervals[1].physical.generation.newTyreConfirmedAtStart).toBe(false);
    });

    it("verwerpt een ongeldige weareenheid zonder er een getal van te maken", () => {
      const badScale = event({
        n: 1,
        kind: "session_start",
        at: at(0),
        before: null,
        after: 90,
        gen: 0,
      });
      badScale.payload.wear_after = {
        version: 1,
        scale: "worn_percent",
        fl: 10,
        fr: 10,
        rl: 10,
        rr: 10,
      };
      const result = build([badScale]);
      expect(result.intervals).toHaveLength(0);
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0].reasons).toContain("wear_values_unusable");
      expect(result.rejected[0].reasons).toContain("wear_scale_unsupported");

      const badVersion = event({
        n: 2,
        kind: "session_start",
        at: at(0),
        before: null,
        after: 90,
        gen: 0,
      });
      badVersion.payload.wear_after = {
        version: 2,
        scale: "remaining_percent",
        fl: 90,
        fr: 90,
        rl: 90,
        rr: 90,
      };
      const versionResult = build([badVersion]);
      expect(versionResult.intervals).toHaveLength(0);
      expect(versionResult.rejected[0].reasons).toContain("wear_version_unsupported");
    });
  });

  describe("context, handoff en identiteit", () => {
    it("laat een driverwissel met sterke car/session-link dezelfde hoek continueren", () => {
      const start = event({ n: 1, kind: "session_start", at: at(0), before: null, after: 100, gen: 0 });
      const handoff = event({
        n: 2,
        kind: "wear_value_changed",
        at: at(10),
        before: 100,
        after: 96,
        gen: 0,
        driverChanged: true,
      });
      const withContexts = [contextWith(start), contextWith(handoff)];

      const result = build(withContexts);
      const intervals = cornerIntervals(result, "fl");
      expect(intervals).toHaveLength(1);
      expect(intervals[0].counts.observations).toBe(2);
      expect(intervals[0].warnings).toContain("driver_handoff_strong_link");
      expect(intervals[0].counts.performedNewTyre).toBe(0);
    });

    it("breekt een driverwissel zonder bewezen car/session-link", () => {
      const start = event({ n: 1, kind: "session_start", at: at(0), before: null, after: 100, gen: 0 });
      const handoff = event({
        n: 2,
        kind: "wear_value_changed",
        at: at(10),
        before: 100,
        after: 96,
        gen: 0,
        driverChanged: true,
      });
      const reStart = event({ n: 3, kind: "session_start", at: at(20), before: null, after: 90, gen: 0 });

      const result = build([start, handoff, reStart]);
      const intervals = cornerIntervals(result, "fl");
      expect(intervals[0].status).toBe("unknown");
      expect(intervals[0].reasons).toContain("driver_handoff_unproven");
      expect(intervals[1].start?.wearPercent).toBe(90);
    });

    it("scheidt een ander account altijd als aparte persoonlijke reeks", () => {
      const first = event({ n: 1, kind: "session_start", at: at(0), before: null, after: 100, gen: 0 });
      const second = event({ n: 2, kind: "session_start", at: at(10), before: null, after: 80, gen: 0 });

      const result = build([
        contextWith(first, { ownerUserId: OWNER }),
        contextWith(second, { ownerUserId: OTHER_OWNER }),
      ]);
      const intervals = cornerIntervals(result, "fl");
      expect(intervals).toHaveLength(2);
      expect(intervals[0].start?.sourceRef.sourceUid).toBe(uid(1));
      expect(intervals[1].start?.sourceRef.sourceUid).toBe(uid(2));
      expect(JSON.stringify(result)).not.toContain(OWNER);
      expect(JSON.stringify(result)).not.toContain(OTHER_OWNER);
    });

    it("continueert een device-handoff alleen met sterke car/session-link", () => {
      const first = event({ n: 1, kind: "session_start", at: at(0), before: null, after: 100, gen: 0 });
      const worn = event({ n: 2, kind: "wear_value_changed", at: at(10), before: 100, after: 96, gen: 0 });
      const secondStart = event({
        n: 3,
        kind: "session_start",
        at: at(20),
        before: null,
        after: 92,
        gen: 0,
        device: "device-b",
        segment: "seg-b",
      });
      const secondWorn = event({
        n: 4,
        kind: "wear_value_changed",
        at: at(30),
        before: 92,
        after: 90,
        gen: 0,
        device: "device-b",
        segment: "seg-b",
      });

      const result = build([
        contextWith(first),
        contextWith(worn),
        contextWith(secondStart),
        contextWith(secondWorn),
      ]);
      const intervals = cornerIntervals(result, "fl");
      expect(intervals).toHaveLength(1);
      expect(intervals[0].lastObserved?.wearPercent).toBe(90);
      expect(new Set(intervals[0].provenance.observationRefs.map((ref) => ref.deviceId))).toEqual(
        new Set(["device-a", "device-b"]),
      );
      expect(intervals[0].warnings).toContain("device_handoff_strong_link");
    });

    it("breekt een device-handoff zonder sterke link als unknown", () => {
      const first = event({ n: 1, kind: "session_start", at: at(0), before: null, after: 100, gen: 0 });
      const worn = event({ n: 2, kind: "wear_value_changed", at: at(10), before: 100, after: 96, gen: 0 });
      const otherDevice = event({
        n: 3,
        kind: "session_start",
        at: at(20),
        before: null,
        after: 92,
        gen: 0,
        device: "device-b",
      });

      // Zelfde account en sessie, maar zonder bewezen auto: geen sterke
      // car/session-link. De oude reeks moet onbekend breken.
      const result = build([
        contextWith(first, { carId: null }),
        contextWith(worn, { carId: null }),
        contextWith(otherDevice, { carId: null }),
      ]);
      const intervals = cornerIntervals(result, "fl");
      expect(intervals).toHaveLength(2);
      expect(intervals[0].status).toBe("unknown");
      expect(intervals[0].reasons).toContain("device_handoff_unproven");
      expect(intervals[1].start?.wearPercent).toBe(92);
      expect(intervals[1].physical.generation.newTyreConfirmedAtStart).toBe(false);
    });

    it("voegt zonder sterke link geen waarnemingen van twee devices samen", () => {
      const first = event({ n: 1, kind: "session_start", at: at(0), before: null, after: 100, gen: 0 });
      const worn = event({ n: 2, kind: "wear_value_changed", at: at(10), before: 100, after: 96, gen: 0 });
      const secondStart = event({
        n: 3,
        kind: "session_start",
        at: at(20),
        before: null,
        after: 92,
        gen: 0,
        device: "device-b",
      });
      const secondWorn = event({
        n: 4,
        kind: "wear_value_changed",
        at: at(30),
        before: 92,
        after: 90,
        gen: 0,
        device: "device-b",
      });

      const result = build([first, worn, secondStart, secondWorn]);
      const intervals = cornerIntervals(result, "fl");
      expect(intervals).toHaveLength(2);
      expect(new Set(intervals[0].provenance.observationRefs.map((ref) => ref.deviceId))).toEqual(
        new Set(["device-a"]),
      );
      expect(new Set(intervals[1].provenance.observationRefs.map((ref) => ref.deviceId))).toEqual(
        new Set(["device-b"]),
      );
      expect(intervals.every((interval) => interval.physical.generation.newTyreConfirmedAtStart === false)).toBe(true);
    });

    it("houdt een sessiegrens gescheiden en verzint daar geen nieuwe set", () => {
      const first = event({ n: 1, kind: "session_start", at: at(0), before: null, after: 100, gen: 0 });
      const worn = event({ n: 2, kind: "wear_value_changed", at: at(10), before: 100, after: 96, gen: 0 });
      const otherStart = event({
        n: 3,
        kind: "session_start",
        at: at(20),
        before: null,
        after: 80,
        gen: 0,
        session: OTHER_SESSION,
      });

      const result = build([first, worn, otherStart]);
      const intervals = cornerIntervals(result, "fl");
      expect(intervals).toHaveLength(2);
      expect(intervals[0].lastObserved?.wearPercent).toBe(96);
      expect(intervals[1].start?.wearPercent).toBe(80);
      expect(intervals.every((interval) => interval.physical.generation.newTyreConfirmedAtStart === false)).toBe(true);
    });

    it("maakt van een segmentbreuk geen nieuwe fysieke set", () => {
      const first = event({ n: 1, kind: "session_start", at: at(0), before: null, after: 100, gen: 0 });
      const worn = event({ n: 2, kind: "wear_value_changed", at: at(10), before: 100, after: 96, gen: 0 });
      const reStart = event({
        n: 3,
        kind: "session_start",
        at: at(20),
        before: null,
        after: 92,
        gen: 0,
        segment: "seg-2",
      });

      const result = build([first, worn, reStart]);
      const intervals = cornerIntervals(result, "fl");
      expect(intervals).toHaveLength(2);
      expect(intervals[0].status).toBe("unknown");
      expect(intervals[0].reasons).toContain("segment_boundary");
      expect(intervals[1].startContinuity).toBe("reanchored_after_break");
      expect(intervals[1].physical.generation.sequence).toBe(0);
      expect(intervals[1].physical.generation.startSourceUid).toBe(uid(1));
      expect(intervals[1].physical.generation.newTyreConfirmedAtStart).toBe(false);
    });

    it("bindt een aangeleverde context aan precies deze bron en device", () => {
      const other = event({ n: 1, kind: "session_start", at: at(0), before: null, after: 100, gen: 0 });
      const wrongDevice = event({
        n: 2,
        kind: "session_start",
        at: at(10),
        before: null,
        after: 90,
        gen: 0,
        device: "device-b",
        observedContext: contextFor(other),
      });

      const rejected = build([wrongDevice]);
      expect(rejected.intervals).toHaveLength(0);
      expect(rejected.rejected[0].reasons).toContain("observed_context_binding_failed");
      expect(rejected.rejected[0].reasons).toContain("observed_context_device_mismatch");

      const valid = event({
        n: 3,
        kind: "session_start",
        at: at(20),
        before: null,
        after: 88,
        gen: 0,
        device: "device-b",
      });
      const accepted = build([{ ...valid, observedContext: contextFor(valid) }]);
      expect(accepted.observations).toHaveLength(1);
      expect(accepted.intervals).toHaveLength(4);
    });

    it("matcht onbekende context nooit en verzint geen compound of regime", () => {
      const observed = event({ n: 1, kind: "session_start", at: at(0), before: null, after: 100, gen: 0 });
      const reference = event({ n: 2, kind: "session_start", at: at(10), before: null, after: 90, gen: 0 });
      const noCompound = {
        compoundId: null,
        regime: null,
      };

      const result = build([contextWith(observed, noCompound)], {
        referenceContext: contextFor(reference, noCompound),
      });
      expect(result.observations[0].context.match).toBe(false);
      expect(result.observations[0].context.blockingReasons).toContain("context_compound_unknown");
      expect(result.observations[0].context.blockingReasons).toContain("context_regime_unknown");
      expect(result.intervals).toHaveLength(4);
    });

    it("gebruikt een historische referentie met een andere bron-UID", () => {
      const observed = event({ n: 1, kind: "session_start", at: at(0), before: null, after: 100, gen: 0 });
      const reference = event({ n: 2, kind: "session_start", at: at(10), before: null, after: 90, gen: 0 });
      const result = build([contextWith(observed)], {
        referenceContext: contextFor(reference),
      });
      expect(result.observations[0].context.match).toBe(true);
      expect(result.observations[0].observationRef.sourceUid).not.toBe(
        reference.source.sourceUid as string,
      );
    });
  });

  describe("ordening, correcties en as-of", () => {
    it("sorteert een late oude waarneming op observatietijd, niet op ontvangsttijd", () => {
      const start = event({ n: 1, kind: "session_start", at: at(0), before: null, after: 100, gen: 0 });
      const newest = event({
        n: 3,
        kind: "wear_value_changed",
        at: at(20),
        before: 96,
        after: 94,
        gen: 0,
        receivedAt: at(21),
      });
      const lateOld = event({
        n: 2,
        kind: "wear_value_changed",
        at: at(10),
        before: 100,
        after: 96,
        gen: 0,
        receivedAt: at(30),
      });

      const result = build([start, newest, lateOld]);
      const interval = firstCorner(result, "fl");
      expect(interval.lastObserved?.wearPercent).toBe(94);
      expect(uidsOf(interval)).toEqual([uid(1), uid(2), uid(3)]);
      expect(result.observations.map((observation) => observation.observationRef.sourceUid)).toEqual([
        uid(1),
        uid(2),
        uid(3),
      ]);
    });

    it("houdt de generatie stabiel door een broncorrectie en actualiseert alleen snapshotrefs", () => {
      const original = event({
        n: 1,
        kind: "session_start",
        at: at(0),
        before: null,
        after: 100,
        gen: 0,
        revision: 1,
        resultHash: hash(101),
      });
      const corrected = event({
        n: 1,
        kind: "session_start",
        at: at(0),
        before: null,
        after: 98,
        gen: 0,
        revision: 2,
        resultHash: hash(102),
      });
      const worn = event({ n: 2, kind: "wear_value_changed", at: at(10), before: 98, after: 96, gen: 0 });

      const withCorrection = build([original, corrected, worn]);
      const onlyCorrected = build([corrected, worn]);
      expect(withCorrection.intervals).toEqual(onlyCorrected.intervals);
      expect(withCorrection.observations).toHaveLength(2);

      const interval = firstCorner(withCorrection, "fl");
      expect(interval.start?.wearPercent).toBe(98);
      expect(interval.start?.sourceRef.recordRevision).toBe(2);
      expect(interval.start?.sourceRef.contentHash).toBe(hash(102));
      expect(interval.physical.generation.startSourceUid).toBe(uid(1));
      expect(interval.physical.generation.sequence).toBe(0);
    });

    it("actualiseert het eind-snapshot bij een correctie van de grensgebeurtenis", () => {
      const start = event({ n: 1, kind: "session_start", at: at(0), before: null, after: 100, gen: 0 });
      const endOriginal = event({
        n: 2,
        kind: "wear_refresh_confirmed",
        at: at(10),
        before: 90,
        after: 90,
        gen: 0,
        revision: 1,
        resultHash: hash(201),
      });
      const endCorrected = event({
        n: 2,
        kind: "wear_refresh_confirmed",
        at: at(10),
        before: 88,
        after: 88,
        gen: 0,
        revision: 2,
        resultHash: hash(202),
      });

      const result = build([start, endOriginal, endCorrected]);
      const interval = firstCorner(result, "fl");
      expect(interval.status).toBe("closed");
      expect(interval.observedLossPercent).toBe(12);
      expect(interval.end?.sourceRef.recordRevision).toBe(2);
      expect(interval.end?.sourceRef.contentHash).toBe(hash(202));
      expect(uidsOf(interval)).toEqual([uid(1), uid(2)]);
    });

    it("is idempotent voor een exact duplicaat met dezelfde UID en hash", () => {
      const start = event({ n: 1, kind: "session_start", at: at(0), before: null, after: 100, gen: 0 });
      const worn = event({ n: 2, kind: "wear_value_changed", at: at(10), before: 100, after: 96, gen: 0 });
      const once = build([start, worn]);
      const twice = build([start, start, worn, worn]);
      expect(twice.intervals).toEqual(once.intervals);
      expect(twice.observations.map((observation) => ({ ...observation, index: 0 }))).toEqual(
        once.observations.map((observation) => ({ ...observation, index: 0 })),
      );
    });

    it("weigert eenzelfde revisie met een andere hash als bronconflict", () => {
      const first = event({
        n: 1,
        kind: "session_start",
        at: at(0),
        before: null,
        after: 100,
        gen: 0,
        revision: 1,
        resultHash: hash(301),
      });
      const second = event({
        n: 1,
        kind: "session_start",
        at: at(0),
        before: null,
        after: 90,
        gen: 0,
        revision: 1,
        resultHash: hash(302),
      });
      const result = build([first, second]);
      expect(result.intervals).toHaveLength(0);
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0].reasons).toContain("source_revision_conflict");
    });

    it("gebruikt een expliciete ontvangstgrens en claimt nooit een geverifieerde as-of", () => {
      const original = event({
        n: 1,
        kind: "session_start",
        at: at(0),
        before: null,
        after: 100,
        gen: 0,
        revision: 1,
        resultHash: hash(401),
        receivedAt: "2026-11-11T10:00:00.000Z",
      });
      const correction = event({
        n: 1,
        kind: "session_start",
        at: at(0),
        before: null,
        after: 98,
        gen: 0,
        revision: 2,
        resultHash: hash(402),
        receivedAt: "2026-11-11T12:00:00.000Z",
      });
      const worn = event({
        n: 2,
        kind: "wear_value_changed",
        at: at(10),
        before: 98,
        after: 96,
        gen: 0,
        receivedAt: "2026-11-11T12:10:00.000Z",
      });

      const result = build([original, correction, worn], {
        sourceReceivedBefore: "2026-11-11T11:00:00.000Z",
      });
      expect(result.cutoff.provided).toBe(true);
      expect(result.cutoff.basis).toBe("source_received_at_only");
      expect(result.cutoff.asOfVerified).toBe(false);
      expect(result.knownAtStatus).toBe("unavailable");
      expect(result.asOfVerified).toBe(false);
      expect(result.cutoff.futureRevisionsExcluded).toBe(true);
      expect(firstCorner(result, "fl").start?.wearPercent).toBe(100);
      expect(firstCorner(result, "fl").start?.sourceRef.recordRevision).toBe(1);
      expect(firstCorner(result, "fl").warnings).toContain("future_source_revision_excluded");

      const withoutCutoff = build([original, correction, worn]);
      expect(firstCorner(withoutCutoff, "fl").start?.wearPercent).toBe(98);

      const onlyFuture = build([correction, worn], {
        sourceReceivedBefore: "2026-11-11T11:00:00.000Z",
      });
      expect(onlyFuture.intervals).toHaveLength(0);
      expect(onlyFuture.rejected[0].reasons).toContain("observation_after_cutoff");
    });
  });

  describe("afstand, servicebewijs en robuustheid", () => {
    function distancePair(startMetres: number, endMetres: number, endBasis = "session_odometer_metres") {
      const start = withDistance(
        event({ n: 1, kind: "session_start", at: at(0), before: null, after: 100, gen: 0 }),
        startMetres,
      );
      const end = withDistance(
        event({
          n: 2,
          kind: "wear_refresh_confirmed",
          at: at(10),
          before: 96,
          after: 96,
          gen: 0,
          evidenceSource: "tire_sets_used",
        }),
        endMetres,
        endBasis,
      );
      return build([start, end]);
    }

    it("geeft alleen een numerieke afstand bij dezelfde doorlopende basis", () => {
      const eligible = distancePair(1000, 3000);
      expect(firstCorner(eligible, "fl").distance).toMatchObject({
        status: "eligible",
        startMetres: 1000,
        endMetres: 3000,
        metresDelta: 2000,
        basis: "session_odometer_metres",
        lapSpan: null,
      });

      const changedBasis = distancePair(1000, 3000, "lap_distance_metres");
      expect(firstCorner(changedBasis, "fl").distance.status).toBe("ineligible");
      expect(firstCorner(changedBasis, "fl").distance.metresDelta).toBeNull();
      expect(firstCorner(changedBasis, "fl").distance.reasons).toContain("distance_basis_changed");
    });

    it("weigert negatieve, nul- en wrap-afstanden als plausibel", () => {
      const wrap = distancePair(3000, 1000);
      expect(firstCorner(wrap, "fl").distance.reasons).toContain("distance_wrap");

      const zero = distancePair(1000, 1000);
      expect(firstCorner(zero, "fl").distance.reasons).toContain("distance_zero");

      const negative = distancePair(-1, 1000);
      expect(firstCorner(negative, "fl").distance.reasons).toContain("distance_value_invalid");
    });

    it("laat ontbrekende afstand expliciet onbekend", () => {
      const start = event({ n: 1, kind: "session_start", at: at(0), before: null, after: 100, gen: 0 });
      const end = event({
        n: 2,
        kind: "wear_refresh_confirmed",
        at: at(10),
        before: 96,
        after: 96,
        gen: 0,
        evidenceSource: "tire_sets_used",
      });
      const result = build([start, end]);
      expect(firstCorner(result, "fl").distance).toMatchObject({
        status: "unknown",
        metresDelta: null,
        lapSpan: null,
      });
      expect(firstCorner(result, "fl").distance.reasons).toContain("distance_source_unavailable");
    });

    it("accepteert alleen een brongebonden uitgevoerd servicebewijs", () => {
      const start = event({ n: 1, kind: "session_start", at: at(0), before: null, after: 100, gen: 0 });
      const refresh = withService(
        event({
          n: 2,
          kind: "wear_refresh_confirmed",
          at: at(10),
          before: 94,
          after: [100, 94, 94, 94],
          gen: 0,
          evidenceSource: "tire_sets_used",
        }),
        ["fl"],
      );

      const result = build([start, refresh]);
      expect(result.observations[1].facts.corners.fl.performedNewTyreConfirmed).toBe(true);
      expect(result.observations[1].facts.corners.fl.performedNewTyreBasis).toBe(
        "trusted_executed_service",
      );
      expect(cornerIntervals(result, "fl")[1].physical.generation.sequence).toBe(1);
      expect(cornerIntervals(result, "fr")[1].physical.generation.sequence).toBe(0);
    });

    it("negeert servicebewijs dat niet aan deze bronrevisie gebonden is", () => {
      const start = event({ n: 1, kind: "session_start", at: at(0), before: null, after: 100, gen: 0 });
      const refresh = event({
        n: 2,
        kind: "wear_refresh_confirmed",
        at: at(10),
        before: 94,
        after: [100, 94, 94, 94],
        gen: 0,
        evidenceSource: "tire_sets_used",
      });
      const mismatched: BuiltEvent = {
        ...refresh,
        serviceEvidence: {
          binding: { ...bindingFor(refresh), deviceId: "device-z" },
          basis: "executed_service_confirmation",
          performedCorners: ["fl"],
        },
      };

      const result = build([start, mismatched]);
      expect(result.observations[1].facts.corners.fl.performedNewTyreConfirmed).toBe(false);
      expect(result.observations[1].warnings).toContain("service_evidence_binding_failed");
      expect(result.observations[1].warnings).toContain("service_evidence_device_mismatch");
    });

    it("laat servicebewijs een wear_value_changed nooit tot vervanging promoveren", () => {
      const start = event({ n: 1, kind: "session_start", at: at(0), before: null, after: 100, gen: 0 });
      const changed = withService(
        event({
          n: 2,
          kind: "wear_value_changed",
          at: at(10),
          before: 94,
          after: 100,
          gen: 0,
        }),
        ["fl"],
      );
      const result = build([start, changed]);
      expect(result.observations[1].facts.corners.fl.performedNewTyreConfirmed).toBe(false);
      expect(result.observations[1].warnings).toContain("wear_value_changed_cannot_prove_service");
    });

    it("maakt een bevestigd nieuw beginanker plus latere refresh een interval zonder twee stops", () => {
      const newStart = withService(
        event({
          n: 1,
          kind: "wear_refresh_confirmed",
          at: at(0),
          before: null,
          after: 100,
          gen: 1,
          evidenceSource: "tire_sets_used",
        }),
        ["fl", "fr", "rl", "rr"],
      );
      const worn = event({ n: 2, kind: "wear_value_changed", at: at(10), before: 100, after: 98, gen: 1 });
      const laterRefresh = event({
        n: 3,
        kind: "wear_refresh_confirmed",
        at: at(20),
        before: 96,
        after: 96,
        gen: 1,
        evidenceSource: "tire_sets_used",
      });

      const result = build([newStart, worn, laterRefresh]);
      const interval = firstCorner(result, "fl");
      expect(interval.status).toBe("closed");
      expect(interval.usable).toBe(true);
      expect(interval.observedLossPercent).toBe(4);
      expect(interval.startContinuity).toBe("confirmed_new_tyre");
      expect(interval.physical.generation.newTyreConfirmedAtStart).toBe(true);
      expect(interval.physical.endRealRefreshConfirmed).toBe(true);
      expect(interval.physical.endPerformedNewTyreConfirmed).toBe(false);
      expect(result.observations.some((observation) => observation.observationRef.kind === "pit_service_completed")).toBe(false);
    });

    it("levert per ongelijke hoek een eigen interval zonder scalar of rate te fitten", () => {
      const start = event({
        n: 1,
        kind: "session_start",
        at: at(0),
        before: null,
        after: [90, 80, 70, 60],
        gen: 0,
      });
      const worn = event({
        n: 2,
        kind: "wear_value_changed",
        at: at(10),
        before: [90, 80, 70, 60],
        after: [88, 78, 68, 58],
        gen: 0,
      });
      const close = event({
        n: 3,
        kind: "wear_refresh_confirmed",
        at: at(20),
        before: [88, 78, 68, 58],
        after: [88, 78, 68, 58],
        gen: 0,
        evidenceSource: "tire_sets_used",
      });

      const result = build([start, worn, close]);
      expect(result.intervals).toHaveLength(8);
      expect(result.observations[0].quality.scalarAggregateReason).toBe("wear_corner_ambiguous");
      expect(result.observations[0].quality.t10TargetEligible).toBe(false);
      expect(firstCorner(result, "fl").observedLossPercent).toBe(2);
      expect(firstCorner(result, "fr").observedLossPercent).toBe(2);
      expect(firstCorner(result, "rl").observedLossPercent).toBe(2);
      expect(firstCorner(result, "rr").observedLossPercent).toBe(2);
      expect(firstCorner(result, "fl").t10.scalarAggregateAmbiguity).toBe(true);
      expect(JSON.stringify(result)).not.toMatch(/"rate"/i);
    });

    it("muteert de invoer niet en geeft deterministische uitvoer", () => {
      const events = [
        event({ n: 1, kind: "session_start", at: at(0), before: null, after: 100, gen: 0 }),
        event({ n: 2, kind: "wear_value_changed", at: at(10), before: 100, after: 96, gen: 0 }),
        event({
          n: 3,
          kind: "wear_refresh_confirmed",
          at: at(20),
          before: 96,
          after: [100, 96, 96, 96],
          gen: [1, 0, 0, 0],
          evidenceSource: "tire_sets_used",
        }),
      ];
      deepFreeze(events);
      const first = build(events);
      const second = build(events);
      expect(second).toEqual(first);
    });

    it("begrenst een te grote batch deterministisch", () => {
      const oversized = new Array(TYRE_INTERVAL_MAX_OBSERVATIONS + 1).fill(null);
      const result = build(oversized);
      expect(result.intervals).toHaveLength(0);
      expect(result.reasons).toContain("batch_too_large");
      expect(buildTyreIntervals({ not: "an array" })).toBeNull();
    });
  });

  describe("SPEC-blokkers T11 (discriminante regressies)", () => {
    it("B1: een wear_refresh_confirmed zonder tire_sets_used-bewijs is geen grens", () => {
      const start = event({ n: 1, kind: "session_start", at: at(0), before: null, after: 100, gen: 0 });
      const unconfirmed = event({
        n: 2,
        kind: "wear_refresh_confirmed",
        at: at(10),
        before: 96,
        after: 96,
        gen: 0,
        evidenceSource: null,
      });

      const result = build([start, unconfirmed]);
      expect(result.observations[1].facts.realRefreshConfirmed).toBe(false);
      expect(result.observations[1].warnings).toContain("refresh_evidence_missing");
      const intervals = cornerIntervals(result, "fl");
      expect(intervals).toHaveLength(1);
      expect(intervals[0].status).toBe("censored");
      expect(intervals[0].usable).toBe(false);
      expect(intervals[0].end).toBeNull();
      expect(intervals[0].lastObserved?.wearPercent).toBe(96);
      expect(intervals[0].physical.endRealRefreshConfirmed).toBe(false);
      expect(intervals[0].physical.endPerformedNewTyreConfirmed).toBe(false);
      expect(JSON.stringify(result)).not.toContain("confirmed_refresh");
    });

    it("B1b: een onbevestigde refresh met wearstijging breekt alleen de geraakte hoek", () => {
      const start = event({ n: 1, kind: "session_start", at: at(0), before: null, after: 100, gen: 0 });
      const worn = event({ n: 2, kind: "wear_value_changed", at: at(10), before: 100, after: 96, gen: 0 });
      const unconfirmed = event({
        n: 3,
        kind: "wear_refresh_confirmed",
        at: at(20),
        before: [96, 96, 96, 96],
        after: [100, 96, 96, 96],
        gen: [1, 0, 0, 0],
        evidenceSource: null,
      });

      const result = build([start, worn, unconfirmed]);
      const fl = cornerIntervals(result, "fl");
      expect(fl).toHaveLength(1);
      expect(fl[0].status).toBe("unknown");
      expect(fl[0].reasons).toContain("wear_increase_unconfirmed");
      expect(fl[0].physical.endRealRefreshConfirmed).toBe(false);
      expect(fl[0].physical.generation.sequence).toBe(0);
      expect(result.observations[2].facts.corners.fl.performedNewTyreConfirmed).toBe(false);
      for (const corner of ["fr", "rl", "rr"] as const) {
        const intervals = cornerIntervals(result, corner);
        expect(intervals).toHaveLength(1);
        expect(intervals[0].status).toBe("censored");
        expect(intervals[0].lastObserved?.wearPercent).toBe(96);
      }
    });

    it("B2: ontbrekende identity in observedContext wordt afgewezen, niet geworpen", () => {
      const e = event({ n: 1, kind: "session_start", at: at(0), before: null, after: 100, gen: 0 });
      const context = JSON.parse(JSON.stringify(contextFor(e))) as Json;
      delete context.identity;

      expect(() => build([{ ...e, observedContext: context }])).not.toThrow();
      const result = build([{ ...e, observedContext: context }]);
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0].reasons).toContain("observed_context_invalid");
      expect(result.intervals).toHaveLength(0);
    });

    it("B2b: ontbrekende ownerAtReceipt in observedContext wordt afgewezen, niet geworpen", () => {
      const e = event({ n: 1, kind: "session_start", at: at(0), before: null, after: 100, gen: 0 });
      const context = JSON.parse(JSON.stringify(contextFor(e))) as Json;
      delete context.ownerAtReceipt;
      (context.identity as Json).owner = {
        status: "unknown",
        value: null,
        reason: "owner_unknown",
        provenance: "none",
      };

      expect(() => build([{ ...e, observedContext: context }])).not.toThrow();
      const result = build([{ ...e, observedContext: context }]);
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0].reasons).toContain("observed_context_invalid");
      expect(result.intervals).toHaveLength(0);
    });

    it("B2c: verkeerd gevormde geneste contextwaarden worden per geval afgewezen", () => {
      const e = event({ n: 1, kind: "session_start", at: at(0), before: null, after: 100, gen: 0 });
      const valid = JSON.parse(JSON.stringify(contextFor(e))) as Json;
      const mutate = (change: (context: Json) => void): Json => {
        const copy = JSON.parse(JSON.stringify(valid)) as Json;
        change(copy);
        return copy;
      };
      const cases: Array<[string, Json]> = [
        ["identity scalar", mutate((context) => { context.identity = 5; })],
        ["identity array", mutate((context) => { context.identity = []; })],
        ["identity empty object", mutate((context) => { context.identity = {}; })],
        ["owner scalar", mutate((context) => { (context.identity as Json).owner = "owner"; })],
        ["owner empty object", mutate((context) => { (context.identity as Json).owner = {}; })],
        [
          "device unknown with non-null value",
          mutate((context) => {
            (context.identity as Json).device = {
              status: "unknown",
              value: "device-a",
              provenance: null,
              reasons: [],
            };
          }),
        ],
        ["ownerAtReceipt array", mutate((context) => { context.ownerAtReceipt = []; })],
        ["source scalar", mutate((context) => { context.source = "source"; })],
        ["compound string value", mutate((context) => { (context.compound as Json).value = "3"; })],
        ["contextStatus invalid", mutate((context) => { context.contextStatus = "certified"; })],
        ["reasons scalar", mutate((context) => { context.reasons = "none"; })],
      ];

      for (const [label, context] of cases) {
        expect(() => build([{ ...e, observedContext: context }]), label).not.toThrow();
        const result = build([{ ...e, observedContext: context }]);
        expect(result.rejected, label).toHaveLength(1);
        expect(result.rejected[0].reasons, label).toContain("observed_context_invalid");
        expect(result.intervals, label).toHaveLength(0);
      }
    });

    it("B2d: een verkeerd gevormde historische referenceContext levert null", () => {
      const e = event({ n: 1, kind: "session_start", at: at(0), before: null, after: 100, gen: 0 });
      const reference = JSON.parse(JSON.stringify(contextFor(e))) as Json;
      delete reference.identity;
      expect(
        buildTyreIntervals([e], {
          referenceContext: reference as unknown as CanonicalContext,
        }),
      ).toBeNull();
    });

    it("B3: identity.device moet met de bron-envelope overeenkomen", () => {
      const e = event({ n: 1, kind: "session_start", at: at(0), before: null, after: 100, gen: 0, device: "device-b" });
      const context = JSON.parse(JSON.stringify(contextFor(e))) as CanonicalContext;
      (context.identity.device as { status: string; value: unknown }).value = "device-a";

      const result = build([{ ...e, observedContext: context }]);
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0].reasons).toContain("observed_context_device_mismatch");
      expect(result.intervals).toHaveLength(0);
    });

    it("B4: een session_start na een onbevestigde stijging start een nieuwe meetband", () => {
      const start = event({ n: 1, kind: "session_start", at: at(0), before: null, after: 100, gen: 0 });
      const worn = event({ n: 2, kind: "wear_value_changed", at: at(10), before: 100, after: 96, gen: 0 });
      const rejoin = event({ n: 3, kind: "session_start", at: at(20), before: 96, after: 100, gen: 0 });
      const later = event({ n: 4, kind: "wear_value_changed", at: at(30), before: 100, after: 98, gen: 0 });

      const result = build([start, worn, rejoin, later]);
      const intervals = cornerIntervals(result, "fl");
      expect(intervals).toHaveLength(2);
      expect(intervals[0].status).toBe("unknown");
      expect(intervals[0].reasons).toContain("wear_increase_unconfirmed");
      expect(intervals[1].start?.wearPercent).toBe(100);
      expect(intervals[1].lastObserved?.wearPercent).toBe(98);
      expect(intervals[1].startContinuity).toBe("reanchored_after_break");
      expect(intervals[1].physical.generation.sequence).toBe(0);
      expect(intervals[1].physical.generation.newTyreConfirmedAtStart).toBe(false);
    });

    it("B4b: een latere echte refresh sluit de meetband zonder de generatie te verzinnen", () => {
      const start = event({ n: 1, kind: "session_start", at: at(0), before: null, after: 100, gen: 0 });
      const worn = event({ n: 2, kind: "wear_value_changed", at: at(10), before: 100, after: 96, gen: 0 });
      const rejoin = event({ n: 3, kind: "session_start", at: at(20), before: 96, after: 100, gen: 0 });
      const later = event({ n: 4, kind: "wear_value_changed", at: at(30), before: 100, after: 98, gen: 0 });
      const refresh = event({
        n: 5,
        kind: "wear_refresh_confirmed",
        at: at(40),
        before: 98,
        after: 98,
        gen: 0,
        evidenceSource: "tire_sets_used",
      });

      const result = build([start, worn, rejoin, later, refresh]);
      const intervals = cornerIntervals(result, "fl");
      expect(intervals).toHaveLength(3);
      expect(intervals[1].status).toBe("closed");
      expect(intervals[1].usable).toBe(true);
      expect(intervals[1].observedLossPercent).toBe(2);
      expect(intervals[1].physical.generation.sequence).toBe(0);
      expect(intervals[1].physical.endRealRefreshConfirmed).toBe(true);
      expect(intervals[2].start?.wearPercent).toBe(98);
      expect(intervals[2].startContinuity).toBe("confirmed_refresh");
    });

    it("B5: een sessiegrens sluit de oude band als unknown/session_boundary", () => {
      const first = event({ n: 1, kind: "session_start", at: at(0), before: null, after: 100, gen: 0 });
      const worn = event({ n: 2, kind: "wear_value_changed", at: at(10), before: 100, after: 96, gen: 0 });
      const other = event({
        n: 3,
        kind: "session_start",
        at: at(20),
        before: null,
        after: 80,
        gen: 0,
        session: OTHER_SESSION,
      });

      const result = build([first, worn, other]);
      const intervals = cornerIntervals(result, "fl");
      expect(intervals).toHaveLength(2);
      expect(intervals[0].status).toBe("unknown");
      expect(intervals[0].reasons).toContain("session_boundary");
      expect(intervals[0].physical.generation.sequence).toBe(0);
      expect(intervals[1].start?.wearPercent).toBe(80);
      expect(intervals[1].startContinuity).toBe("reanchored_after_break");
    });

    it("B5b: ook met bekende owner/car blijft de sessiebreuk een expliciete grens", () => {
      const first = event({ n: 1, kind: "session_start", at: at(0), before: null, after: 100, gen: 0 });
      const worn = event({ n: 2, kind: "wear_value_changed", at: at(10), before: 100, after: 96, gen: 0 });
      const other = event({
        n: 3,
        kind: "session_start",
        at: at(20),
        before: null,
        after: 80,
        gen: 0,
        session: OTHER_SESSION,
      });

      const result = build([contextWith(first), contextWith(worn), contextWith(other)]);
      const intervals = cornerIntervals(result, "fl");
      expect(intervals).toHaveLength(2);
      expect(intervals[0].status).toBe("unknown");
      expect(intervals[0].reasons).toContain("session_boundary");
      expect(intervals[1].start?.wearPercent).toBe(80);
      expect(intervals[1].physical.generation.sequence).toBe(0);
    });

    it("B5c: een echte batch-einde blijft censored zonder sessiebreuk", () => {
      const first = event({ n: 1, kind: "session_start", at: at(0), before: null, after: 100, gen: 0 });
      const worn = event({ n: 2, kind: "wear_value_changed", at: at(10), before: 100, after: 96, gen: 0 });
      const result = build([first, worn]);
      const interval = firstCorner(result, "fl");
      expect(interval.status).toBe("censored");
      expect(interval.reasons).toContain("interval_open_at_input_end");
      expect(interval.reasons).not.toContain("session_boundary");
    });

    it("B6: een conflict ná de cutoff vergiftigt de pre-cutoff snapshot niet", () => {
      const current = event({
        n: 1,
        kind: "session_start",
        at: at(0),
        before: null,
        after: 100,
        gen: 0,
        revision: 1,
        resultHash: hash(21),
        receivedAt: "2026-11-11T10:00:00.000Z",
      });
      const futureConflict = event({
        n: 1,
        kind: "session_start",
        at: at(0),
        before: null,
        after: 90,
        gen: 0,
        revision: 1,
        resultHash: hash(22),
        receivedAt: "2026-11-11T12:00:00.000Z",
      });

      const result = build([current, futureConflict], {
        sourceReceivedBefore: "2026-11-11T11:00:00.000Z",
      });
      expect(result.rejected).toHaveLength(0);
      expect(result.cutoff.futureRevisionsExcluded).toBe(true);
      expect(result.intervals).toHaveLength(4);
      expect(firstCorner(result, "fl").start?.wearPercent).toBe(100);
      expect(JSON.stringify(result.intervals)).not.toContain(hash(22));
    });

    it("B6b: zonder cutoff blijft eenzelfde revisie met andere hash een conflict", () => {
      const left = event({
        n: 1,
        kind: "session_start",
        at: at(0),
        before: null,
        after: 100,
        gen: 0,
        resultHash: hash(31),
      });
      const right = event({
        n: 1,
        kind: "session_start",
        at: at(0),
        before: null,
        after: 90,
        gen: 0,
        resultHash: hash(32),
      });
      const result = build([left, right]);
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0].reasons).toContain("source_revision_conflict");
      expect(result.intervals).toHaveLength(0);
    });

    it("B6c: een conflict binnen de cutoff blijft ook quarantaine", () => {
      const left = event({
        n: 1,
        kind: "session_start",
        at: at(0),
        before: null,
        after: 100,
        gen: 0,
        resultHash: hash(41),
        receivedAt: "2026-11-11T10:00:00.000Z",
      });
      const right = event({
        n: 1,
        kind: "session_start",
        at: at(0),
        before: null,
        after: 90,
        gen: 0,
        resultHash: hash(42),
        receivedAt: "2026-11-11T10:30:00.000Z",
      });
      const result = build([left, right], {
        sourceReceivedBefore: "2026-11-11T11:00:00.000Z",
      });
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0].reasons).toContain("source_revision_conflict");
      expect(result.intervals).toHaveLength(0);
    });

    it("B6d: een ongeldige hoogste revisie valt niet terug op een oudere geldige revisie", () => {
      const valid = event({
        n: 1,
        kind: "session_start",
        at: at(0),
        before: null,
        after: 100,
        gen: 0,
        revision: 1,
        resultHash: hash(51),
      });
      const invalidHighest = event({
        n: 1,
        kind: "not_a_tyre_kind",
        at: at(10),
        before: null,
        after: 90,
        gen: 0,
        revision: 2,
        resultHash: hash(52),
      });
      const result = build([valid, invalidHighest]);
      expect(result.intervals).toHaveLength(0);
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0].reasons).toContain("unsupported_measurement_kind");
    });

    it("B6e: een ongeldige hoogste revisie ná de cutoff kan de pre-cutoff revisie niet vergiftigen", () => {
      const valid = event({
        n: 1,
        kind: "session_start",
        at: at(0),
        before: null,
        after: 100,
        gen: 0,
        revision: 1,
        resultHash: hash(61),
        receivedAt: "2026-11-11T10:00:00.000Z",
      });
      const futureInvalid = event({
        n: 1,
        kind: "not_a_tyre_kind",
        at: at(10),
        before: null,
        after: 90,
        gen: 0,
        revision: 5,
        resultHash: hash(62),
        receivedAt: "2026-11-11T12:00:00.000Z",
      });
      const result = build([valid, futureInvalid], {
        sourceReceivedBefore: "2026-11-11T11:00:00.000Z",
      });
      expect(result.rejected).toHaveLength(0);
      expect(result.cutoff.futureRevisionsExcluded).toBe(true);
      expect(result.intervals).toHaveLength(4);
      expect(firstCorner(result, "fl").start?.wearPercent).toBe(100);
    });

    it("API-label: composietgeneratie heet geen uitgevoerde service en t10 is ALL-semantiek", () => {
      const start = event({
        n: 1,
        kind: "session_start",
        at: at(0),
        before: null,
        after: 100,
        gen: 0,
        driverChanged: true,
      });
      const second = event({ n: 2, kind: "wear_value_changed", at: at(10), before: 100, after: 96, gen: 0 });
      const close = event({
        n: 3,
        kind: "wear_refresh_confirmed",
        at: at(20),
        before: 96,
        after: [100, 96, 96, 96],
        gen: [1, 0, 0, 0],
        evidenceSource: "tire_sets_used",
      });

      const result = build([contextWith(start), contextWith(second), contextWith(close)], {
        referenceContext: contextFor(second),
      });
      const interval = firstCorner(result, "fl");
      expect(result.observations[0].quality.t10TargetEligible).toBe(false);
      expect(result.observations[1].quality.t10TargetEligible).toBe(true);
      expect(interval.t10.targetEligibleAll).toBe(false);
      expect(interval.t10.blockingReasons).toContain("driver_changed_in_lap");
      expect(result.observations[2].facts.corners.fl.performedNewTyreBasis).toBe(
        "refresh_with_set_generation_increment",
      );
      expect(interval.physical.endPerformedNewTyreConfirmed).toBe(true);
      expect(interval.physical.selectedServiceObserved).toBe(false);
    });

    it("provenance: begrenst refs maar behoudt altijd start- en eindgrens", () => {
      const events: Array<TyreIntervalObservationInput & { source: Json; payload: Json }> = [
        event({ n: 1, kind: "session_start", at: at(0), before: null, after: 100, gen: 0 }),
      ];
      for (let n = 2; n <= 65; n += 1) {
        events.push(
          event({
            n,
            kind: "wear_value_changed",
            at: at(n * 10),
            before: 100,
            after: 100,
            gen: 0,
          }),
        );
      }
      events.push(
        event({
          n: 66,
          kind: "wear_refresh_confirmed",
          at: at(660),
          before: 100,
          after: 100,
          gen: 0,
          evidenceSource: "tire_sets_used",
        }),
      );

      const interval = firstCorner(build(events), "fl");
      expect(interval.status).toBe("closed");
      expect(interval.provenance.observationRefs).toHaveLength(64);
      expect(interval.provenance.observationRefsTruncated).toBe(true);
      expect(interval.provenance.observationRefs[0].sourceUid).toBe(uid(1));
      expect(interval.provenance.observationRefs[63].sourceUid).toBe(uid(66));
    });
  });

  describe("bronprecisie en streamidentiteit", () => {
    it.each(["", ".1", ".12", ".123", ".1234", ".12345", ".123456", ".1234567"])(
      "vergelijkt cutoff en bewaart bronstrings met fractie %s",
      (fraction) => {
        const cutoff = `2026-11-11T10:00:00${fraction}Z`;
        const receivedAt = `2026-11-11T04:30:00${fraction}-05:30`;
        const ticks = (fraction.slice(1) || "0").padEnd(7, "0");
        const nextTicks = String(Number(ticks) + 1).padStart(7, "0");
        const current = event({
          n: 1001, kind: "session_start", at: receivedAt, after: 100, gen: 0,
          receivedAt,
        });
        const future = event({
          n: 1001, kind: "session_start", at: receivedAt, after: 90, gen: 0,
          revision: 2, resultHash: hash(1002),
          receivedAt: `2026-11-11T10:00:00.${nextTicks}Z`,
        });
        const result = build([future, current], { sourceReceivedBefore: cutoff });
        expect(result.rejected).toEqual([]);
        expect(result.cutoff.futureRevisionsExcluded).toBe(true);
        expect(result.cutoff.sourceReceivedBefore).toBe(cutoff);
        const start = firstCorner(result, "fl").start;
        expect(start?.wearPercent).toBe(100);
        expect(start?.observedAt).toBe(receivedAt);
        expect(start?.sourceRef.sourceReceivedAt).toBe(receivedAt);
        // BigInt is uitsluitend intern; de complete publieke uitvoer blijft JSON.
        expect(JSON.parse(JSON.stringify(result))).toEqual(result);
      },
    );

    it.each([
      ["0000-02-29T23:59:59.9999999Z", "0000-03-01T00:00:00Z"],
      ["0099-12-31T23:59:59.9999999Z", "0100-01-01T00:00:00Z"],
      ["1968-02-29T23:59:59.9999999Z", "1968-03-01T00:00:00Z"],
      ["2000-02-29T23:59:59.9999999Z", "2000-03-01T00:00:00Z"],
      ["1900-02-28T23:59:59.9999999Z", "1900-03-01T00:00:00Z"],
    ])("ordent kalendergrens %s vóór %s", (early, late) => {
      const start = event({ n: 1102, kind: "session_start", at: early, after: 100, gen: 0 });
      const worn = event({
        n: 1101, kind: "wear_value_changed", at: late, before: 100, after: 90, gen: 0,
      });
      const result = build([worn, start]);
      expect(result.rejected).toEqual([]);
      expect(firstCorner(result, "fl").lastObserved?.wearPercent).toBe(90);
      expect(uidsOf(firstCorner(result, "fl"))).toEqual([uid(1102), uid(1101)]);
      const snapshot = build([start, worn], { sourceReceivedBefore: early });
      expect(snapshot.cutoff.futureRevisionsExcluded).toBe(true);
      expect(snapshot.observations).toHaveLength(1);
      expect(snapshot.observations[0].observationRef.sourceUid).toBe(uid(1102));
    });

    it.each([
      "2026-11-11", "2026-11-11T10:00:00", "2026-02-29T00:00:00Z",
      "1900-02-29T00:00:00Z", "0099-02-29T00:00:00Z", "2026-04-31T00:00:00Z",
      "2026-11-11T10:00:00+14:01", "2026-11-11T10:00:00.12345678Z",
    ])("weigert ongeldige instant %s als cutoff én bron", (invalid) => {
      const value = event({ n: 1201, kind: "session_start", at: invalid, after: 100, gen: 0 });
      expect(buildTyreIntervals([], { sourceReceivedBefore: invalid })).toBeNull();
      expect(build([value]).rejected[0].reasons).toContain("source_envelope_invalid");
      const invalidReceipt = event({
        n: 1202, kind: "session_start", at: at(0), after: 100, gen: 0, receivedAt: invalid,
      });
      expect(build([invalidReceipt]).rejected[0].reasons).toContain("source_envelope_invalid");
    });

    it("ordent intervalstarts exact en behoudt publieke generatierefs bij streamencoding", () => {
      const early = contextWith(event({
        n: 1302, kind: "session_start", at: "2026-11-11T10:00:00.0000001Z", after: 100, gen: 0,
      }));
      const late = contextWith(event({
        n: 1301, kind: "session_start", at: "2026-11-11T10:00:00.0000002Z", after: 100, gen: 0,
      }), { carId: "car-other" });
      const result = build([late, early]);
      expect(cornerIntervals(result, "fl").map((interval) => interval.start?.sourceRef.sourceUid))
        .toEqual([uid(1302), uid(1301)]);
      const generation = firstCorner(result, "fl").physical.generation;
      expect(generation).toEqual({
        sequence: 0, startSourceUid: uid(1302), startKind: "session_start",
        newTyreConfirmedAtStart: false, newTyreConfirmationBasis: null,
      });
      expect(firstCorner(build([early]), "fl").physical.generation).toEqual(generation);
    });

    it("behandelt gelijke observed-instants met andere notatie als gelijk vóór session-time", () => {
      const start = event({
        n: 1401, kind: "session_start", at: "2026-11-11T10:00:00.1234567Z", after: 100, gen: 0,
      });
      const worn = event({
        n: 1402, kind: "wear_value_changed", at: "2026-11-11T11:00:00.1234567+01:00",
        before: 100, after: 90, gen: 0,
      });
      const result = build([worn, start]);
      expect(uidsOf(firstCorner(result, "fl"))).toEqual([uid(1401), uid(1402)]);
      expect(firstCorner(result, "fl").lastObserved?.observedAt)
        .toBe("2026-11-11T11:00:00.1234567+01:00");
    });

    it("sluit een revisie 900 microseconden na een whole-ms cutoff uit", () => {
      const current = event({
        n: 1,
        kind: "session_start",
        at: "2026-11-11T10:00:00.000Z",
        before: null,
        after: 100,
        gen: 0,
        revision: 1,
        resultHash: hash(701),
        receivedAt: "2026-11-11T10:00:01.000000Z",
      });
      const future = event({
        n: 1,
        kind: "session_start",
        at: "2026-11-11T10:00:00.000Z",
        before: null,
        after: 90,
        gen: 0,
        revision: 2,
        resultHash: hash(702),
        receivedAt: "2026-11-11T10:00:01.000900Z",
      });

      const result = build([current, future], {
        sourceReceivedBefore: "2026-11-11T10:00:01.000Z",
      });
      expect(result.cutoff.futureRevisionsExcluded).toBe(true);
      expect(result.cutoff.asOfVerified).toBe(false);
      expect(result.rejected).toHaveLength(0);
      expect(firstCorner(result, "fl").start?.wearPercent).toBe(100);
      expect(firstCorner(result, "fl").start?.sourceRef.recordRevision).toBe(1);
      expect(firstCorner(result, "fl").start?.sourceRef.contentHash).toBe(hash(701));
      expect(firstCorner(result, "fl").warnings).toContain("future_source_revision_excluded");
    });

    it("laat een zelfde-revisie hashconflict 900 microseconden na de cutoff niet quarantainen", () => {
      const current = event({
        n: 2,
        kind: "session_start",
        at: "2026-11-11T10:00:00.000Z",
        before: null,
        after: 100,
        gen: 0,
        revision: 1,
        resultHash: hash(703),
        receivedAt: "2026-11-11T10:00:02.000000Z",
      });
      const future = event({
        n: 2,
        kind: "session_start",
        at: "2026-11-11T10:00:00.000Z",
        before: null,
        after: 90,
        gen: 0,
        revision: 1,
        resultHash: hash(704),
        receivedAt: "2026-11-11T10:00:02.000900Z",
      });

      const result = build([current, future], {
        sourceReceivedBefore: "2026-11-11T10:00:02.000Z",
      });
      expect(result.cutoff.futureRevisionsExcluded).toBe(true);
      expect(result.rejected).toHaveLength(0);
      expect(cornerIntervals(result, "fl")).toHaveLength(1);
      expect(firstCorner(result, "fl").start?.wearPercent).toBe(100);
      expect(JSON.stringify(result.intervals)).not.toContain(hash(704));
    });

    it("includeert de cutoff op 100ns en sluit één tick later uit, ook met offset", () => {
      const equal = event({
        n: 3,
        kind: "session_start",
        at: "2026-11-11T10:00:00.000Z",
        before: null,
        after: 100,
        gen: 0,
        revision: 1,
        resultHash: hash(705),
        // Zelfde instant als de cutoff, maar met offset en 6 fractiecijfers.
        receivedAt: "2026-11-11T12:00:02.000000+02:00",
      });
      const oneTickLater = event({
        n: 3,
        kind: "session_start",
        at: "2026-11-11T10:00:00.000Z",
        before: null,
        after: 90,
        gen: 0,
        revision: 2,
        resultHash: hash(706),
        receivedAt: "2026-11-11T10:00:02.0000001Z",
      });

      const result = build([equal, oneTickLater], {
        sourceReceivedBefore: "2026-11-11T10:00:02.0000000-00:00",
      });
      expect(result.cutoff.futureRevisionsExcluded).toBe(true);
      expect(firstCorner(result, "fl").start?.wearPercent).toBe(100);
      expect(firstCorner(result, "fl").start?.sourceRef.recordRevision).toBe(1);
    });

    it("includeert een rij één tick vóór de cutoff en verkiest die revisie", () => {
      const current = event({
        n: 4,
        kind: "session_start",
        at: "2026-11-11T10:00:00.000Z",
        before: null,
        after: 100,
        gen: 0,
        revision: 1,
        resultHash: hash(707),
        receivedAt: "2026-11-11T10:00:00.000000Z",
      });
      const lastBefore = event({
        n: 4,
        kind: "session_start",
        at: "2026-11-11T10:00:00.000Z",
        before: null,
        after: 90,
        gen: 0,
        revision: 2,
        resultHash: hash(708),
        receivedAt: "2026-11-11T10:00:03.9999999Z",
      });

      const result = build([current, lastBefore], {
        sourceReceivedBefore: "2026-11-11T10:00:04.0000000Z",
      });
      expect(result.cutoff.futureRevisionsExcluded).toBe(false);
      expect(firstCorner(result, "fl").start?.wearPercent).toBe(90);
      expect(firstCorner(result, "fl").start?.sourceRef.recordRevision).toBe(2);
    });

    it("vergelijkt fracties exact over de negatieve epochgrens", () => {
      const current = event({
        n: 5,
        kind: "session_start",
        at: "1969-12-31T23:59:59.000Z",
        before: null,
        after: 100,
        gen: 0,
        revision: 1,
        resultHash: hash(709),
        receivedAt: "1969-12-31T23:59:59.9999999Z",
      });
      const future = event({
        n: 5,
        kind: "session_start",
        at: "1969-12-31T23:59:59.000Z",
        before: null,
        after: 90,
        gen: 0,
        revision: 2,
        resultHash: hash(710),
        receivedAt: "1970-01-01T00:00:00.0000000Z",
      });

      const result = build([current, future], {
        sourceReceivedBefore: "1969-12-31T23:59:59.9999999Z",
      });
      expect(result.cutoff.futureRevisionsExcluded).toBe(true);
      expect(firstCorner(result, "fl").start?.wearPercent).toBe(100);

      const earlier = build([current], {
        sourceReceivedBefore: "1969-12-31T23:59:59.5000000Z",
      });
      expect(earlier.rejected).toHaveLength(1);
      expect(earlier.rejected[0].reasons).toContain("observation_after_cutoff");
      expect(earlier.intervals).toHaveLength(0);
    });

    it("behandelt jaren 0000 en 0099 zonder Date.UTC-eeuwverschuiving", () => {
      for (const day of ["0000-01-01", "0099-01-01"]) {
        const current = event({
          n: 6,
          kind: "session_start",
          at: `${day}T00:00:00.0000000Z`,
          before: null,
          after: 100,
          gen: 0,
          revision: 1,
          resultHash: hash(711),
          receivedAt: `${day}T00:00:00.0000000Z`,
        });
        const future = event({
          n: 6,
          kind: "session_start",
          at: `${day}T00:00:00.0000000Z`,
          before: null,
          after: 90,
          gen: 0,
          revision: 2,
          resultHash: hash(712),
          receivedAt: `${day}T00:00:00.0000001Z`,
        });

        const result = build([current, future], {
          sourceReceivedBefore: `${day}T00:00:00.0000000Z`,
        });
        expect(result.cutoff.futureRevisionsExcluded).toBe(true);
        expect(firstCorner(result, "fl").start?.wearPercent).toBe(100);
      }
    });

    it("weigert datum-zonder-tijd en tijd-zonder-zone als cutoff", () => {
      const start = event({
        n: 7,
        kind: "session_start",
        at: at(0),
        before: null,
        after: 100,
        gen: 0,
      });
      expect(buildTyreIntervals([start], { sourceReceivedBefore: "2026-11-11" })).toBeNull();
      expect(
        buildTyreIntervals([start], { sourceReceivedBefore: "2026-11-11T10:00:00" }),
      ).toBeNull();
      expect(
        buildTyreIntervals([start], {
          sourceReceivedBefore: "2026-11-11T10:00:00.00000000Z",
        }),
      ).toBeNull();
    });

    it("ordent waarnemingen binnen één milliseconde op 100ns ondanks omgekeerde UID", () => {
      const start = event({
        n: 1,
        kind: "session_start",
        at: "2026-11-11T10:00:00.000000Z",
        before: null,
        after: 100,
        gen: 0,
      });
      const early = event({
        n: 3,
        kind: "wear_value_changed",
        at: "2026-11-11T10:00:10.000100Z",
        before: 100,
        after: 94,
        gen: 0,
      });
      const late = event({
        n: 2,
        kind: "wear_value_changed",
        at: "2026-11-11T10:00:10.000900Z",
        before: 94,
        after: 92,
        gen: 0,
      });

      // Invoervolgorde en UID-volgorde zijn tegengesteld aan de chronologie.
      const result = build([start, late, early]);
      expect(firstCorner(result, "fl").lastObserved?.wearPercent).toBe(92);
      expect(uidsOf(firstCorner(result, "fl"))).toEqual([uid(1), uid(3), uid(2)]);
      expect(result.observations.map((observation) => observation.observationRef.sourceUid)).toEqual([
        uid(1),
        uid(3),
        uid(2),
      ]);
    });

    it("ordent een sessiegrens 100ns later ook wanneer de UID lager is", () => {
      const startA = event({
        n: 10,
        kind: "session_start",
        at: "2026-11-11T10:00:00.000000Z",
        after: 100,
        before: null,
        gen: 0,
        session: "obs-session-1",
      });
      const earlyA = event({
        n: 11,
        kind: "wear_value_changed",
        at: "2026-11-11T10:01:00.0000001Z",
        before: 100,
        after: 96,
        gen: 0,
        session: "obs-session-1",
      });
      const lateB = event({
        n: 9,
        kind: "session_start",
        at: "2026-11-11T10:01:00.0000002Z",
        before: null,
        after: 100,
        gen: 0,
        session: "obs-session-2",
      });

      const result = build([startA, lateB, earlyA]);
      const intervals = cornerIntervals(result, "fl");
      expect(intervals).toHaveLength(2);
      expect(intervals[0].start?.wearPercent).toBe(100);
      expect(intervals[0].lastObserved?.wearPercent).toBe(96);
      expect(intervals[0].reasons).toContain("session_boundary");
      expect(intervals[1].start?.wearPercent).toBe(100);
    });

    it("houdt dezelfde bekende auto in één fysieke stream", () => {
      const start = contextWith(
        event({ n: 801, kind: "session_start", at: at(0), before: null, after: 100, gen: 0 }),
      );
      const worn = contextWith(
        event({ n: 802, kind: "wear_value_changed", at: at(10), before: 100, after: 90, gen: 0 }),
      );
      const result = build([start, worn]);
      expect(cornerIntervals(result, "fl")).toHaveLength(1);
      expect(firstCorner(result, "fl").start?.wearPercent).toBe(100);
      expect(firstCorner(result, "fl").start?.sourceRef.sourceUid).toBe(uid(801));
    });

    it("scheidt een onbekende auto van een geldige car-ID die letterlijk car_unknown is", () => {
      const unknown = contextWith(
        event({ n: 901, kind: "session_start", at: at(0), before: null, after: 100, gen: 0 }),
        { carId: null },
      );
      const literal = contextWith(
        event({ n: 902, kind: "session_start", at: at(10), before: null, after: 100, gen: 0 }),
        { carId: "car_unknown" },
      );
      const result = build([unknown, literal]);
      const intervals = cornerIntervals(result, "fl");
      expect(intervals).toHaveLength(2);
      expect(intervals.map((interval) => interval.start?.sourceRef.sourceUid)).toEqual([
        uid(901),
        uid(902),
      ]);
      expect(intervals.map((interval) => interval.start?.wearPercent)).toEqual([100, 100]);
    });
  });
});
