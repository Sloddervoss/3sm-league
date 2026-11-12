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
      expect(fl[0].physical.endConfirmedService).toBe(true);
      expect(fl[1].start?.wearPercent).toBe(100);
      expect(fl[1].physical.generation.sequence).toBe(1);
      expect(fl[1].physical.generation.newTyreConfirmedAtStart).toBe(true);
      expect(fl[1].physical.generation.startSourceUid).toBe(uid(3));

      for (const corner of ["fr", "rl", "rr"] as const) {
        const intervals = cornerIntervals(result, corner);
        expect(intervals).toHaveLength(2);
        expect(intervals[0].observedLossPercent).toBe(6);
        expect(intervals[0].physical.endConfirmedService).toBe(false);
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
      expect(interval.physical.endConfirmedService).toBe(false);
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
});
