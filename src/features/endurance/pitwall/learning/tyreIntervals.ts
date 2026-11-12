/**
 * Fysieke bandintervallen per wiel (P2/T11).
 *
 * Deze module kwalificeert alleen meetreeksen: welke waarde is ontvangen, of
 * die veranderde, of een refresh door de echte producer is bevestigd, en of een
 * uitgevoerde bandenservice per hoek is bewezen. Zij voorspelt geen rate, kiest
 * geen band en vraagt nooit om een handmatige stopbevestiging.
 *
 * De module is puur en deterministisch: geen React, I/O, database, klok of
 * mutatie van invoer. Bron- en contextpoorten komen uit T09/T10.
 */

import { TYRE_CORNERS, type TyreCorner } from "./contracts";
import {
  bindObservedContextToObservation,
  buildCanonicalContext,
  compareCanonicalContexts,
  isInstant,
  parseSourceRecordEnvelope,
  type CanonicalContext,
  type SourceRecordEnvelope,
} from "./context";
import { assessRecordQuality, type RecordQualityAssessment } from "./quality";

export const TYRE_INTERVAL_SCHEMA_VERSION = "pitwall-learning-tyre-intervals-v1" as const;
export const TYRE_INTERVAL_POLICY_VERSION = "pitwall-learning-tyre-interval-policy-v1" as const;
export const TYRE_INTERVAL_MAX_OBSERVATIONS = 4096;
export const TYRE_INTERVAL_MAX_REASONS = 32;
/** Zelfde drempel als de connector gebruikt voor een wearwijziging. */
export const TYRE_INTERVAL_WEAR_CHANGE_PERCENT = 0.05;

export const TYRE_INTERVAL_WEAR_ANCHOR_KINDS = [
  "session_start",
  "wear_value_changed",
  "pit_service_completed",
  "wear_refresh_confirmed",
] as const;

export interface TyreEvidenceSourceBinding {
  readonly sourceKind: "measurement_event";
  readonly deviceId: string;
  readonly sourceUid: string;
  readonly recordRevision: number;
  readonly contentHash: string;
  readonly observedSessionId: string;
  readonly observedAt: string;
  readonly sessionTimeSeconds?: number | null;
}

export interface TyreServiceEvidenceInput {
  readonly binding: TyreEvidenceSourceBinding;
  /** Alleen een daadwerkelijk uitgevoerde service, nooit een verzoek/vinkje. */
  readonly basis: "executed_service_confirmation";
  readonly performedCorners: readonly TyreCorner[];
}

export interface TyreDistanceEvidenceInput {
  readonly binding: TyreEvidenceSourceBinding;
  /** Stabiele, bron-eigen afstandsbasis; nooit een verzonnen eenheid. */
  readonly basis: string;
  readonly odometerMetres: number;
}

export interface TyreIntervalObservationInput {
  readonly source: unknown;
  readonly payload: unknown;
  readonly observedContext?: CanonicalContext | null;
  readonly annotations?: { readonly resetOrTow?: boolean | null } | null;
  readonly serviceEvidence?: TyreServiceEvidenceInput | null;
  readonly distanceEvidence?: TyreDistanceEvidenceInput | null;
}

export interface TyreIntervalOptions {
  /** Historische referentiecontext; mag een andere bron-UID hebben. */
  readonly referenceContext?: CanonicalContext | null;
  /**
   * Expliciete, door de caller gekozen ontvangstgrens. Dit is géén knownAt en
   * levert nooit een geverifieerde as-of; zie het resultaatveld `cutoff`.
   */
  readonly sourceReceivedBefore?: string | null;
}

export type TyreIntervalStatus = "closed" | "censored" | "unknown";

export type TyreStartContinuity =
  | "session_start"
  | "confirmed_refresh"
  | "confirmed_new_tyre"
  | "refresh_after_unconfirmed_increase"
  | "reanchored_after_break";

export type TyreNewTyreBasis =
  | "connector_confirmed_set_generation"
  | "trusted_executed_service"
  | null;

export interface TyreIntervalSourceRef {
  readonly sourceKind: "measurement_event";
  readonly deviceId: string;
  readonly sourceUid: string;
  readonly recordRevision: number;
  readonly contentHash: string;
  readonly observedAt: string;
  readonly sourceReceivedAt: string;
  readonly observedSessionId: string | null;
  readonly segmentId: string | null;
  readonly kind: string;
}

export interface TyreCornerObservationFacts {
  readonly valueReceived: boolean;
  readonly valuePercent: number | null;
  readonly valueChanged: boolean | null;
  readonly valueIncreased: boolean | null;
  readonly performedNewTyreConfirmed: boolean;
  readonly performedNewTyreBasis: TyreNewTyreBasis;
  readonly setGeneration: number | null;
}

export interface TyreObservationFacts {
  readonly corners: Readonly<Record<TyreCorner, TyreCornerObservationFacts>>;
  readonly realRefreshConfirmed: boolean;
  readonly refreshBasis: "producer_wear_refresh_confirmed" | null;
  readonly selectedServiceObserved: boolean;
}

export interface TyreObservationQualitySummary {
  readonly t10TargetEligible: boolean;
  readonly blockingReasons: readonly string[];
  readonly warningReasons: readonly string[];
  readonly scalarAggregateReason: string | null;
}

export interface TyreObservationContextSummary {
  readonly status: "complete" | "partial" | "unknown";
  readonly match: boolean;
  readonly blockingReasons: readonly string[];
  readonly warningReasons: readonly string[];
}

export interface TyreObservationRecord {
  readonly index: number;
  readonly observationRef: TyreIntervalSourceRef;
  readonly facts: TyreObservationFacts;
  readonly quality: TyreObservationQualitySummary;
  readonly context: TyreObservationContextSummary;
  readonly reasons: readonly string[];
  readonly warnings: readonly string[];
}

export interface TyreIntervalRejection {
  readonly index: number;
  readonly sourceUid: string | null;
  readonly reasons: readonly string[];
}

export interface TyreIntervalDistance {
  readonly status: "eligible" | "ineligible" | "unknown";
  readonly startMetres: number | null;
  readonly endMetres: number | null;
  readonly metresDelta: number | null;
  readonly basis: string | null;
  /** Measurement-events dragen geen rondes; expliciet null, nooit een gok. */
  readonly lapSpan: null;
  readonly reasons: readonly string[];
}

export interface TyreIntervalEndpoint {
  readonly wearPercent: number;
  readonly observedAt: string;
  readonly kind: string;
  readonly sourceRef: TyreIntervalSourceRef;
}

export interface TyreIntervalGenerationRef {
  /** Aantal bewezen nieuwe fysieke sets in deze stream, per hoek. */
  readonly sequence: number;
  readonly startSourceUid: string;
  readonly startKind: string;
  readonly newTyreConfirmedAtStart: boolean;
  readonly newTyreConfirmationBasis: TyreNewTyreBasis;
}

export interface TyreIntervalProvenance {
  readonly start: TyreIntervalEndpoint;
  readonly end: TyreIntervalEndpoint | null;
  readonly observationRefs: readonly TyreIntervalSourceRef[];
  readonly observationRefsTruncated: boolean;
  readonly startQuality: TyreObservationQualitySummary | null;
  readonly endQuality: TyreObservationQualitySummary | null;
}

export interface TyreIntervalCounts {
  readonly observations: number;
  readonly valueReceived: number;
  readonly valueChanged: number;
  readonly refreshConfirmed: number;
  readonly performedNewTyre: number;
}

export interface TyreCornerInterval {
  readonly intervalRef: {
    readonly corner: TyreCorner;
    readonly sequence: number;
    readonly startSourceUid: string;
    readonly endSourceUid: string | null;
  };
  readonly corner: TyreCorner;
  readonly status: TyreIntervalStatus;
  readonly usable: boolean;
  readonly startContinuity: TyreStartContinuity;
  readonly start: TyreIntervalEndpoint | null;
  readonly end: TyreIntervalEndpoint | null;
  readonly lastObserved: TyreIntervalEndpoint | null;
  readonly observedLossPercent: number | null;
  readonly lossStatus: "observed" | "unavailable";
  readonly distance: TyreIntervalDistance;
  readonly physical: {
    readonly generation: TyreIntervalGenerationRef;
    readonly endConfirmedService: boolean;
    readonly endRealRefreshConfirmed: boolean;
    readonly selectedServiceObserved: boolean;
  };
  readonly counts: TyreIntervalCounts;
  readonly provenance: TyreIntervalProvenance;
  readonly t10: {
    readonly scalarAggregateAmbiguity: boolean;
    readonly targetEligible: boolean;
    readonly blockingReasons: readonly string[];
    readonly warningReasons: readonly string[];
  };
  readonly reasons: readonly string[];
  readonly warnings: readonly string[];
}

export interface TyreIntervalCutoffInfo {
  readonly provided: boolean;
  readonly sourceReceivedBefore: string | null;
  readonly basis: "source_received_at_only" | null;
  readonly asOfVerified: false;
  readonly futureRevisionsExcluded: boolean;
}

export interface TyreIntervalResult {
  readonly schemaVersion: typeof TYRE_INTERVAL_SCHEMA_VERSION;
  readonly policyVersion: typeof TYRE_INTERVAL_POLICY_VERSION;
  readonly intervals: readonly TyreCornerInterval[];
  readonly observations: readonly TyreObservationRecord[];
  readonly rejected: readonly TyreIntervalRejection[];
  readonly cutoff: TyreIntervalCutoffInfo;
  readonly knownAtStatus: "unavailable";
  readonly asOfVerified: false;
  readonly inputCount: number;
  readonly reasons: readonly string[];
}

const EPSILON = TYRE_INTERVAL_WEAR_CHANGE_PERCENT;
const MAX_OBSERVATION_REFS = 64;

const HARD_SOURCE_REASONS = new Set([
  "observed_context_binding_failed",
  "observed_context_version_mismatch",
  "source_invalid_reasons",
  "invalid_reasons_malformed",
  "invalid_reason_global",
  "invalid_reason_unrecognized",
  "max_gap_seconds_contradicts_coverage_gap",
  "reported_gap_invalid",
  "reported_max_gap_exceeds_policy",
  "coverage_window_order",
  "coverage_window_future",
  "wear_source_kind_unknown",
]);

interface PlainRecord {
  [key: string]: unknown;
}

interface CornerWearRead {
  readonly values: Record<TyreCorner, number | null>;
  readonly reasons: readonly string[];
  readonly any: boolean;
}

interface GenerationRead {
  readonly values: Record<TyreCorner, number | null>;
  readonly reasons: readonly string[];
}

interface WearEvidence {
  readonly source: string | null;
  readonly reason: string | null;
}

interface RawRecord {
  readonly index: number;
  readonly input: PlainRecord;
  readonly source: SourceRecordEnvelope;
}

interface DistanceSample {
  readonly metres: number;
  readonly basis: string;
}

interface PreparedObservation {
  readonly index: number;
  readonly source: SourceRecordEnvelope;
  readonly payload: PlainRecord;
  readonly assessment: RecordQualityAssessment;
  readonly kind: string;
  readonly observedAtMs: number;
  readonly sessionId: string | null;
  readonly segmentId: string | null;
  readonly sessionTimeSeconds: number | null;
  readonly wearBefore: CornerWearRead;
  readonly wearAfter: CornerWearRead;
  readonly generation: GenerationRead;
  readonly realRefreshConfirmed: boolean;
  readonly servicePerformed: ReadonlySet<TyreCorner>;
  readonly distance: DistanceSample | null;
  readonly resetOrTow: boolean | null;
  readonly driverChanged: boolean | null;
  readonly context: CanonicalContext | null;
  readonly quality: TyreObservationQualitySummary;
  readonly contextSummary: TyreObservationContextSummary;
  readonly warnings: readonly string[];
  readonly futureSourceRevisionExcluded: boolean;
}

interface OpenCounts {
  observations: number;
  valueReceived: number;
  valueChanged: number;
  refreshConfirmed: number;
  performedNewTyre: number;
}

interface OpenInterval {
  readonly start: TyreIntervalEndpoint;
  readonly startContinuity: TyreStartContinuity;
  readonly generation: TyreIntervalGenerationRef;
  readonly bandSequence: number;
  readonly refs: TyreIntervalSourceRef[];
  readonly counts: OpenCounts;
  readonly distanceStart: DistanceSample | null;
  readonly distanceSamples: DistanceSample[];
  readonly startQuality: TyreObservationQualitySummary;
  readonly t10Blocking: Set<string>;
  readonly t10Warning: Set<string>;
  scalarAggregateAmbiguity: boolean;
  targetEligible: boolean;
  readonly warnings: Set<string>;
  readonly reasons: Set<string>;
  lastObserved: TyreIntervalEndpoint;
  selectedServiceObserved: boolean;
}

interface CornerState {
  generation: TyreIntervalGenerationRef;
  started: boolean;
  bandSequence: number;
  open: OpenInterval | null;
  awaitingAnchor: boolean;
  pendingAfterRefresh: boolean;
  pendingStartContinuity: TyreStartContinuity;
  lastWear: number | null;
  lastGeneration: number | null;
  lastObserved: TyreIntervalEndpoint | null;
}

interface StreamState {
  previous: PreparedObservation | null;
  corners: Record<TyreCorner, CornerState>;
}

interface ContinuityVerdict {
  readonly breaks: readonly string[];
  readonly warnings: readonly string[];
}

function hasOwn(record: PlainRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function isPlainRecord(value: unknown): value is PlainRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function shortIdentifier(value: unknown, maxLength = 128): string | null {
  if (typeof value !== "string") return null;
  if (value.length === 0 || value.length > maxLength) return null;
  if (value.trim().length === 0 || hasControlCharacters(value)) return null;
  return value;
}

function cornerRecord<T>(factory: () => T): Record<TyreCorner, T> {
  return {
    fl: factory(),
    fr: factory(),
    rl: factory(),
    rr: factory(),
  };
}

function limitReasons(values: readonly string[]): string[] {
  return [...new Set(values)].sort().slice(0, TYRE_INTERVAL_MAX_REASONS);
}

function readWear(raw: unknown): CornerWearRead {
  const empty = cornerRecord<number | null>(() => null);
  if (raw === undefined || raw === null) return { values: empty, reasons: [], any: false };
  if (!isPlainRecord(raw)) {
    return { values: empty, reasons: ["wear_shape_unsupported"], any: false };
  }
  if (raw.version !== 1) {
    return { values: empty, reasons: ["wear_version_unsupported"], any: false };
  }
  if (raw.scale !== "remaining_percent") {
    return { values: empty, reasons: ["wear_scale_unsupported"], any: false };
  }

  const reasons: string[] = [];
  const values = cornerRecord<number | null>(() => null);
  for (const corner of TYRE_CORNERS) {
    if (!hasOwn(raw, corner) || raw[corner] === null) {
      reasons.push(`wear_corner_missing:${corner}`);
      continue;
    }
    const value = raw[corner];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
      reasons.push(`wear_corner_invalid:${corner}`);
      continue;
    }
    values[corner] = value;
  }
  return {
    values,
    reasons,
    any: TYRE_CORNERS.some((corner) => values[corner] !== null),
  };
}

function readGeneration(raw: unknown): GenerationRead {
  const empty = cornerRecord<number | null>(() => null);
  if (raw === undefined || raw === null) return { values: empty, reasons: [] };
  if (!isPlainRecord(raw)) {
    return { values: empty, reasons: ["set_generation_shape_unsupported"] };
  }
  if (raw.version !== 1) {
    return { values: empty, reasons: ["set_generation_version_unsupported"] };
  }

  const reasons: string[] = [];
  const values = cornerRecord<number | null>(() => null);
  for (const corner of TYRE_CORNERS) {
    if (!hasOwn(raw, corner) || raw[corner] === null) {
      reasons.push(`set_generation_missing:${corner}`);
      continue;
    }
    const value = raw[corner];
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value < 0 ||
      value > 1000
    ) {
      reasons.push(`set_generation_invalid:${corner}`);
      continue;
    }
    values[corner] = value;
  }
  return { values, reasons };
}

function readEvidence(raw: unknown): WearEvidence {
  if (raw === undefined || raw === null) return { source: null, reason: null };
  if (!isPlainRecord(raw)) return { source: null, reason: "refresh_evidence_invalid" };
  if (raw.version !== 1) return { source: null, reason: "refresh_evidence_invalid" };
  const source = shortIdentifier(raw.source, 64);
  if (source === null) return { source: null, reason: "refresh_evidence_invalid" };
  return { source, reason: null };
}

function readOptionalIdentifier(payload: PlainRecord, key: string): string | null {
  if (!hasOwn(payload, key) || payload[key] === null) return null;
  return shortIdentifier(payload[key]);
}

function readSessionTime(payload: PlainRecord): number | null {
  if (!hasOwn(payload, "session_time_seconds") || payload["session_time_seconds"] === null) {
    return null;
  }
  const value = payload["session_time_seconds"];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readBooleanValue(payload: PlainRecord, key: string): boolean | null {
  if (!hasOwn(payload, key) || payload[key] === null) return null;
  return typeof payload[key] === "boolean" ? payload[key] : null;
}

function readResetOrTow(assessment: RecordQualityAssessment): boolean | null {
  return assessment.reported.resetOrTow.status === "observed"
    ? assessment.reported.resetOrTow.value
    : null;
}

function qualitySummary(assessment: RecordQualityAssessment): TyreObservationQualitySummary {
  const target = assessment.targets.tyre_wear;
  const scalarAggregateReason =
    assessment.wear.before.reason === "wear_corner_ambiguous" ||
    assessment.wear.after.reason === "wear_corner_ambiguous"
      ? "wear_corner_ambiguous"
      : null;
  return {
    t10TargetEligible: target.eligible,
    blockingReasons: limitReasons(target.blockingReasons),
    warningReasons: limitReasons(target.warningReasons),
    scalarAggregateReason,
  };
}

function contextSummary(
  context: CanonicalContext | null,
  reference: CanonicalContext | null,
): TyreObservationContextSummary {
  const comparison = compareCanonicalContexts(context, reference, "tyre_wear");
  return {
    status: context === null ? "unknown" : context.contextStatus,
    match: comparison.contextMatch,
    blockingReasons: limitReasons(comparison.blockingReasons),
    warningReasons: limitReasons(comparison.warningReasons),
  };
}

function hardQualityReasons(reasons: readonly string[]): string[] {
  return reasons.filter(
    (reason) =>
      HARD_SOURCE_REASONS.has(reason) ||
      reason.startsWith("observed_context_") ||
      reason.startsWith("anchor_") ||
      reason.startsWith("invalid_reason:"),
  );
}

function checkEvidenceBinding(
  binding: unknown,
  source: SourceRecordEnvelope,
  payload: PlainRecord,
  sessionId: string | null,
  sessionTimeSeconds: number | null,
  prefix: string,
  warnings: string[],
): boolean {
  if (!isPlainRecord(binding)) {
    warnings.push(`${prefix}_binding_invalid`);
    return false;
  }
  let ok = true;
  const mismatch = (field: string, matches: boolean): void => {
    if (!matches) {
      ok = false;
      warnings.push(`${prefix}_${field}_mismatch`);
    }
  };

  mismatch("source_kind", binding.sourceKind === "measurement_event");
  mismatch("device", binding.deviceId === source.deviceId);
  mismatch("source_uid", binding.sourceUid === source.sourceUid);
  mismatch("revision", binding.recordRevision === source.recordRevision);
  mismatch("hash", binding.contentHash === source.contentHash);
  mismatch("observed_at", binding.observedAt === source.observedAt);
  mismatch("session", sessionId !== null && binding.observedSessionId === sessionId);
  if (binding.sessionTimeSeconds !== undefined && binding.sessionTimeSeconds !== null) {
    mismatch(
      "session_time",
      typeof binding.sessionTimeSeconds === "number" &&
        Number.isFinite(binding.sessionTimeSeconds) &&
        sessionTimeSeconds !== null &&
        binding.sessionTimeSeconds === sessionTimeSeconds,
    );
  }
  return ok;
}

function readServiceEvidence(
  raw: unknown,
  kind: string,
  source: SourceRecordEnvelope,
  payload: PlainRecord,
  sessionId: string | null,
  sessionTimeSeconds: number | null,
): { performed: ReadonlySet<TyreCorner>; warnings: string[] } {
  const warnings: string[] = [];
  if (raw === undefined || raw === null) return { performed: new Set(), warnings };

  if (kind === "wear_value_changed") {
    // Een waargenomen waardeverschil is nooit een uitgevoerde service.
    warnings.push("wear_value_changed_cannot_prove_service");
    return { performed: new Set(), warnings };
  }
  if (!isPlainRecord(raw)) {
    warnings.push("service_evidence_invalid");
    return { performed: new Set(), warnings };
  }
  if (raw.basis !== "executed_service_confirmation") {
    warnings.push("service_evidence_basis_invalid");
    return { performed: new Set(), warnings };
  }
  if (
    !checkEvidenceBinding(
      raw.binding,
      source,
      payload,
      sessionId,
      sessionTimeSeconds,
      "service_evidence",
      warnings,
    )
  ) {
    warnings.push("service_evidence_binding_failed");
    return { performed: new Set(), warnings };
  }
  const corners = raw.performedCorners;
  if (!Array.isArray(corners) || corners.length === 0 || corners.length > TYRE_CORNERS.length) {
    warnings.push("service_evidence_corners_invalid");
    return { performed: new Set(), warnings };
  }

  const performed = new Set<TyreCorner>();
  for (const corner of corners) {
    if (typeof corner !== "string" || !(TYRE_CORNERS as readonly string[]).includes(corner)) {
      warnings.push("service_evidence_corners_invalid");
      return { performed: new Set(), warnings };
    }
    performed.add(corner as TyreCorner);
  }
  return { performed, warnings };
}

function readDistanceEvidence(
  raw: unknown,
  source: SourceRecordEnvelope,
  payload: PlainRecord,
  sessionId: string | null,
  sessionTimeSeconds: number | null,
): { distance: DistanceSample | null; warnings: string[] } {
  const warnings: string[] = [];
  if (raw === undefined || raw === null) return { distance: null, warnings };
  if (!isPlainRecord(raw)) {
    warnings.push("distance_evidence_invalid");
    return { distance: null, warnings };
  }
  if (
    !checkEvidenceBinding(
      raw.binding,
      source,
      payload,
      sessionId,
      sessionTimeSeconds,
      "distance_evidence",
      warnings,
    )
  ) {
    warnings.push("distance_evidence_binding_failed");
    return { distance: null, warnings };
  }
  const basis = shortIdentifier(raw.basis, 128);
  if (basis === null) {
    warnings.push("distance_evidence_basis_invalid");
    return { distance: null, warnings };
  }
  if (typeof raw.odometerMetres !== "number" || !Number.isFinite(raw.odometerMetres)) {
    warnings.push("distance_evidence_value_invalid");
    return { distance: null, warnings };
  }
  return { distance: { metres: raw.odometerMetres, basis }, warnings };
}

function knownString(value: { readonly status: string; readonly value: unknown } | undefined): string | null {
  return value !== undefined && value.status === "known" && typeof value.value === "string"
    ? value.value
    : null;
}

function streamKey(prepared: PreparedObservation): string {
  const context = prepared.context;
  const owner = context === null ? null : knownString(context.identity.owner);
  if (owner !== null) {
    // Binnen één account mogen devices/sessies elkaar alleen via een
    // gecontroleerde continuity-check raken. De stream blijft daarom bij het
    // account (en de sessie) en niet bij het afleverende device.
    const link =
      prepared.sessionId !== null
        ? ["session", prepared.sessionId]
        : ["device", prepared.source.deviceId];
    return JSON.stringify(["tyre-stream-v1", ["owner", owner], link]);
  }
  const receiptOwner = context?.ownerAtReceipt.userId ?? null;
  const partition =
    receiptOwner !== null
      ? ["receipt", receiptOwner, "device", prepared.source.deviceId]
      : ["device", prepared.source.deviceId];
  return JSON.stringify([
    "tyre-stream-v1",
    partition,
    ["session", prepared.sessionId ?? ""],
  ]);
}

function strongCarSessionLink(left: PreparedObservation, right: PreparedObservation): boolean {
  const leftCar = left.context === null ? null : knownString(left.context.car);
  const rightCar = right.context === null ? null : knownString(right.context.car);
  if (leftCar === null || rightCar === null || leftCar !== rightCar) return false;
  return left.sessionId !== null && right.sessionId !== null && left.sessionId === right.sessionId;
}

function continuityVerdict(
  previous: PreparedObservation,
  current: PreparedObservation,
): ContinuityVerdict {
  const breaks: string[] = [];
  const warnings: string[] = [];
  const strong = strongCarSessionLink(previous, current);

  if (previous.source.deviceId !== current.source.deviceId) {
    if (strong) warnings.push("device_handoff_strong_link");
    else breaks.push("device_handoff_unproven");
  }

  if (
    previous.sessionId !== null &&
    current.sessionId !== null &&
    previous.sessionId !== current.sessionId
  ) {
    breaks.push("session_boundary");
  } else if (
    (previous.sessionId === null) !== (current.sessionId === null)
  ) {
    breaks.push("observed_session_link_missing");
  }

  if (
    previous.segmentId !== null &&
    current.segmentId !== null &&
    previous.segmentId !== current.segmentId
  ) {
    // Een apparaatwissel met een sterke car/session-link mag een lokaal
    // segment laten verspringen; een gewone segmentbreuk doet dat niet.
    const strongDeviceHandoff =
      previous.source.deviceId !== current.source.deviceId && strong;
    if (!strongDeviceHandoff) breaks.push("segment_boundary");
  }

  const dimensionMismatch = (
    left: { readonly status: string; readonly value: unknown } | undefined,
    right: { readonly status: string; readonly value: unknown } | undefined,
    reason: string,
  ): void => {
    const leftKnown = left?.status === "known" ? left.value : null;
    const rightKnown = right?.status === "known" ? right.value : null;
    if (leftKnown !== null && rightKnown !== null && leftKnown !== rightKnown) {
      breaks.push(reason);
    }
  };

  dimensionMismatch(previous.context?.car, current.context?.car, "context_car_mismatch");
  dimensionMismatch(previous.context?.track, current.context?.track, "context_track_mismatch");
  dimensionMismatch(previous.context?.layout, current.context?.layout, "context_layout_mismatch");
  dimensionMismatch(previous.context?.compound, current.context?.compound, "context_compound_mismatch");
  dimensionMismatch(previous.context?.regime, current.context?.regime, "context_regime_mismatch");

  const previousDriver = previous.context === null ? null : knownString(previous.context.identity.driver);
  const currentDriver = current.context === null ? null : knownString(current.context.identity.driver);
  if (previousDriver !== null && currentDriver !== null && previousDriver !== currentDriver) {
    if (strong) warnings.push("driver_handoff_strong_link");
    else breaks.push("driver_handoff_unproven");
  }
  if (current.driverChanged === true) {
    if (strong) warnings.push("driver_handoff_strong_link");
    else breaks.push("driver_handoff_unproven");
  }
  if (current.resetOrTow === true) {
    breaks.push("reset_or_tow_observed");
  }
  if (previous.sessionId === null || current.sessionId === null) {
    warnings.push("observed_session_link_unknown");
  }

  return { breaks: limitReasons(breaks), warnings: limitReasons(warnings) };
}

function sourceRef(prepared: PreparedObservation): TyreIntervalSourceRef {
  return {
    sourceKind: "measurement_event",
    deviceId: prepared.source.deviceId,
    sourceUid: prepared.source.sourceUid,
    recordRevision: prepared.source.recordRevision,
    contentHash: prepared.source.contentHash,
    observedAt: prepared.source.observedAt as string,
    sourceReceivedAt: prepared.source.sourceReceivedAt,
    observedSessionId: prepared.sessionId,
    segmentId: prepared.segmentId,
    kind: prepared.kind,
  };
}

function endpoint(
  prepared: PreparedObservation,
  wearPercent: number,
): TyreIntervalEndpoint {
  return {
    wearPercent,
    observedAt: prepared.source.observedAt as string,
    kind: prepared.kind,
    sourceRef: sourceRef(prepared),
  };
}

function generationCopy(generation: TyreIntervalGenerationRef): TyreIntervalGenerationRef {
  return { ...generation };
}

function emptyGeneration(): TyreIntervalGenerationRef {
  return {
    sequence: 0,
    startSourceUid: "",
    startKind: "",
    newTyreConfirmedAtStart: false,
    newTyreConfirmationBasis: null,
  };
}

function createCornerState(): CornerState {
  return {
    generation: emptyGeneration(),
    started: false,
    bandSequence: 0,
    open: null,
    awaitingAnchor: false,
    pendingAfterRefresh: false,
    pendingStartContinuity: "confirmed_refresh",
    lastWear: null,
    lastGeneration: null,
    lastObserved: null,
  };
}

function createStreamState(): StreamState {
  return {
    previous: null,
    corners: cornerRecord(createCornerState),
  };
}

function pushRef(open: OpenInterval, ref: TyreIntervalSourceRef): void {
  const exists = open.refs.some(
    (candidate) =>
      candidate.sourceUid === ref.sourceUid &&
      candidate.recordRevision === ref.recordRevision &&
      candidate.contentHash === ref.contentHash,
  );
  if (!exists) open.refs.push(ref);
}

function addT10(open: OpenInterval, summary: TyreObservationQualitySummary): void {
  for (const reason of summary.blockingReasons) open.t10Blocking.add(reason);
  for (const reason of summary.warningReasons) open.t10Warning.add(reason);
  if (summary.scalarAggregateReason !== null) open.scalarAggregateAmbiguity = true;
  open.targetEligible = summary.t10TargetEligible;
}

function startInterval(
  state: CornerState,
  corner: TyreCorner,
  prepared: PreparedObservation,
  wearPercent: number,
  continuity: TyreStartContinuity,
  performedNewTyre: boolean,
): void {
  const start = endpoint(prepared, wearPercent);
  state.bandSequence += 1;
  const open: OpenInterval = {
    start,
    startContinuity: continuity,
    generation: generationCopy(state.generation),
    bandSequence: state.bandSequence,
    refs: [start.sourceRef],
    counts: {
      observations: 1,
      valueReceived: 1,
      valueChanged: 0,
      refreshConfirmed: prepared.realRefreshConfirmed ? 1 : 0,
      performedNewTyre: performedNewTyre ? 1 : 0,
    },
    distanceStart: prepared.distance,
    distanceSamples: prepared.distance === null ? [] : [prepared.distance],
    startQuality: prepared.quality,
    t10Blocking: new Set(prepared.quality.blockingReasons),
    t10Warning: new Set(prepared.quality.warningReasons),
    scalarAggregateAmbiguity: prepared.quality.scalarAggregateReason !== null,
    targetEligible: prepared.quality.t10TargetEligible,
    warnings: new Set(prepared.warnings),
    reasons: new Set(),
    lastObserved: start,
    selectedServiceObserved: prepared.kind === "pit_service_completed",
  };
  state.open = open;
  state.awaitingAnchor = false;
  state.pendingAfterRefresh = false;
  state.lastWear = wearPercent;
  state.lastObserved = start;
  void corner;
}

function addObservation(
  state: CornerState,
  prepared: PreparedObservation,
  fact: TyreCornerObservationFacts,
  wearPercent: number,
): void {
  const open = state.open;
  if (open === null) return;
  const end = endpoint(prepared, wearPercent);
  open.counts.observations += 1;
  open.counts.valueReceived += 1;
  if (fact.valueChanged === true) open.counts.valueChanged += 1;
  if (prepared.realRefreshConfirmed) open.counts.refreshConfirmed += 1;
  if (fact.performedNewTyreConfirmed) open.counts.performedNewTyre += 1;
  if (prepared.kind === "pit_service_completed") open.selectedServiceObserved = true;
  pushRef(open, end.sourceRef);
  addT10(open, prepared.quality);
  for (const warning of prepared.warnings) open.warnings.add(warning);
  if (prepared.distance !== null) open.distanceSamples.push(prepared.distance);
  open.lastObserved = end;
  state.lastObserved = end;
}

function distanceResult(
  open: OpenInterval,
  end: DistanceSample | null,
  hasEndBoundary: boolean,
): TyreIntervalDistance {
  const start = open.distanceStart;
  if (!hasEndBoundary) {
    return {
      status: "unknown",
      startMetres: start?.metres ?? null,
      endMetres: null,
      metresDelta: null,
      basis: null,
      lapSpan: null,
      reasons: ["distance_interval_open"],
    };
  }
  if (start === null && end === null) {
    return {
      status: "unknown",
      startMetres: null,
      endMetres: null,
      metresDelta: null,
      basis: null,
      lapSpan: null,
      reasons: ["distance_source_unavailable"],
    };
  }
  if (start === null || end === null) {
    return {
      status: "unknown",
      startMetres: start?.metres ?? null,
      endMetres: end?.metres ?? null,
      metresDelta: null,
      basis: null,
      lapSpan: null,
      reasons: ["distance_endpoint_missing"],
    };
  }

  const reasons: string[] = [];
  if (!Number.isFinite(start.metres) || !Number.isFinite(end.metres)) {
    reasons.push("distance_value_invalid");
  }
  if (start.metres < 0 || end.metres < 0) reasons.push("distance_value_invalid");
  if (start.basis !== end.basis) reasons.push("distance_basis_changed");
  if (open.distanceSamples.some((sample) => sample.basis !== start.basis)) {
    reasons.push("distance_basis_changed");
  }
  let previous = start.metres;
  for (const sample of open.distanceSamples) {
    if (sample.metres < previous - 1e-9) {
      reasons.push("distance_gap");
      break;
    }
    previous = sample.metres;
  }
  if (end.metres < previous - 1e-9) reasons.push("distance_gap");
  if (end.metres < start.metres) reasons.push("distance_wrap");
  if (end.metres === start.metres) reasons.push("distance_zero");
  if (reasons.length > 0) {
    return {
      status: "ineligible",
      startMetres: start.metres,
      endMetres: end.metres,
      metresDelta: null,
      basis: start.basis,
      lapSpan: null,
      reasons: limitReasons(reasons),
    };
  }
  return {
    status: "eligible",
    startMetres: start.metres,
    endMetres: end.metres,
    metresDelta: end.metres - start.metres,
    basis: start.basis,
    lapSpan: null,
    reasons: [],
  };
}

function buildInterval(
  corner: TyreCorner,
  open: OpenInterval,
  status: TyreIntervalStatus,
  end: TyreIntervalEndpoint | null,
  lastObserved: TyreIntervalEndpoint | null,
  observedLossPercent: number | null,
  distance: TyreIntervalDistance,
  physical: {
    readonly endConfirmedService: boolean;
    readonly endRealRefreshConfirmed: boolean;
  },
  extraReasons: readonly string[],
  extraWarnings: readonly string[],
): TyreCornerInterval {
  const reasons = limitReasons([...open.reasons, ...extraReasons]);
  const warnings = limitReasons([...open.warnings, ...extraWarnings]);
  const usable = status === "closed" && observedLossPercent !== null;
  return {
    intervalRef: {
      corner,
      sequence: open.bandSequence,
      startSourceUid: open.start.sourceRef.sourceUid,
      endSourceUid: end?.sourceRef.sourceUid ?? null,
    },
    corner,
    status,
    usable,
    startContinuity: open.startContinuity,
    start: open.start,
    end,
    lastObserved,
    observedLossPercent,
    lossStatus: observedLossPercent === null ? "unavailable" : "observed",
    distance,
    physical: {
      generation: open.generation,
      endConfirmedService: physical.endConfirmedService,
      endRealRefreshConfirmed: physical.endRealRefreshConfirmed,
      selectedServiceObserved: open.selectedServiceObserved,
    },
    counts: { ...open.counts },
    provenance: {
      start: open.start,
      end,
      observationRefs: open.refs.slice(0, MAX_OBSERVATION_REFS),
      observationRefsTruncated: open.refs.length > MAX_OBSERVATION_REFS,
      startQuality: open.startQuality,
      endQuality: null,
    },
    t10: {
      scalarAggregateAmbiguity: open.scalarAggregateAmbiguity,
      targetEligible: open.targetEligible,
      blockingReasons: limitReasons([...open.t10Blocking]),
      warningReasons: limitReasons([...open.t10Warning]),
    },
    reasons,
    warnings,
  };
}

function closeIntervalAtBoundary(
  state: CornerState,
  corner: TyreCorner,
  endObs: PreparedObservation,
  endWearPercent: number | null,
  performedNewTyre: boolean,
  realRefreshConfirmed: boolean,
): TyreCornerInterval | null {
  const open = state.open;
  if (open === null) return null;

  const end = endWearPercent === null ? null : endpoint(endObs, endWearPercent);
  open.counts.observations += 1;
  if (endWearPercent !== null) open.counts.valueReceived += 1;
  if (realRefreshConfirmed) open.counts.refreshConfirmed += 1;
  if (performedNewTyre) open.counts.performedNewTyre += 1;
  if (endObs.kind === "pit_service_completed") open.selectedServiceObserved = true;
  pushRef(open, sourceRef(endObs));
  addT10(open, endObs.quality);
  for (const warning of endObs.warnings) open.warnings.add(warning);

  const endQuality = endObs.quality;
  const reasons: string[] = [];
  let status: TyreIntervalStatus = "closed";
  let observedLossPercent: number | null = null;
  const startContinuityUnproven =
    open.startContinuity === "refresh_after_unconfirmed_increase";
  if (startContinuityUnproven) reasons.push("start_continuity_unproven");

  if (endWearPercent === null) {
    status = "unknown";
    reasons.push("end_wear_missing");
  } else if (startContinuityUnproven) {
    status = "unknown";
    if (endWearPercent > open.start.wearPercent + EPSILON) {
      reasons.push("wear_increase_within_interval");
    } else {
      observedLossPercent = Math.max(0, open.start.wearPercent - endWearPercent);
    }
  } else if (endWearPercent > open.start.wearPercent + EPSILON) {
    status = "unknown";
    reasons.push("wear_increase_within_interval");
  } else {
    observedLossPercent = Math.max(0, open.start.wearPercent - endWearPercent);
  }

  const distance = distanceResult(open, endObs.distance, true);
  const lastObserved = end ?? open.lastObserved;
  const interval = buildInterval(
    corner,
    open,
    status,
    end,
    lastObserved,
    observedLossPercent,
    distance,
    { endConfirmedService: performedNewTyre, endRealRefreshConfirmed: realRefreshConfirmed },
    reasons,
    [],
  );
  state.open = null;
  return {
    ...interval,
    provenance: { ...interval.provenance, endQuality },
  };
}

function finalizeCensored(state: CornerState, corner: TyreCorner): TyreCornerInterval | null {
  const open = state.open;
  if (open === null) return null;
  const distance: TyreIntervalDistance = {
    status: "unknown",
    startMetres: open.distanceStart?.metres ?? null,
    endMetres: null,
    metresDelta: null,
    basis: null,
    lapSpan: null,
    reasons: ["distance_interval_open"],
  };
  const interval = buildInterval(
    corner,
    open,
    "censored",
    null,
    open.lastObserved,
    null,
    distance,
    { endConfirmedService: false, endRealRefreshConfirmed: false },
    ["interval_open_at_input_end"],
    [],
  );
  state.open = null;
  return interval;
}

function finalizeBroken(
  state: CornerState,
  corner: TyreCorner,
  reason: string,
): TyreCornerInterval | null {
  const open = state.open;
  if (open === null) return null;
  const distance: TyreIntervalDistance = {
    status: "unknown",
    startMetres: open.distanceStart?.metres ?? null,
    endMetres: null,
    metresDelta: null,
    basis: null,
    lapSpan: null,
    reasons: ["distance_interval_open"],
  };
  const interval = buildInterval(
    corner,
    open,
    "unknown",
    null,
    open.lastObserved,
    null,
    distance,
    { endConfirmedService: false, endRealRefreshConfirmed: false },
    [reason],
    [],
  );
  state.open = null;
  return interval;
}

function breakAll(
  state: StreamState,
  reasons: readonly string[],
  intervals: TyreCornerInterval[],
): void {
  for (const corner of TYRE_CORNERS) {
    const cornerState = state.corners[corner];
    if (cornerState.open !== null) {
      for (const reason of reasons) cornerState.open.reasons.add(reason);
      const interval = finalizeBroken(cornerState, corner, reasons[0] ?? "continuity_boundary");
      if (interval !== null) intervals.push(interval);
    }
    cornerState.awaitingAnchor = true;
    cornerState.pendingAfterRefresh = false;
  }
}

function breakCorner(
  state: CornerState,
  corner: TyreCorner,
  reason: string,
  intervals: TyreCornerInterval[],
): void {
  if (state.open !== null) {
    const interval = finalizeBroken(state, corner, reason);
    if (interval !== null) intervals.push(interval);
  }
  state.awaitingAnchor = true;
  state.pendingAfterRefresh = false;
}

function ensureGeneration(state: CornerState, prepared: PreparedObservation): void {
  if (!state.started) {
    state.generation = {
      sequence: 0,
      startSourceUid: prepared.source.sourceUid,
      startKind: prepared.kind,
      newTyreConfirmedAtStart: false,
      newTyreConfirmationBasis: null,
    };
    state.started = true;
  }
}

function bumpGeneration(
  state: CornerState,
  prepared: PreparedObservation,
  basis: TyreNewTyreBasis,
): void {
  state.generation = {
    sequence: state.started ? state.generation.sequence + 1 : 1,
    startSourceUid: prepared.source.sourceUid,
    startKind: prepared.kind,
    newTyreConfirmedAtStart: true,
    newTyreConfirmationBasis: basis,
  };
  state.started = true;
}

function factsForCorner(
  state: StreamState,
  prepared: PreparedObservation,
  corner: TyreCorner,
): TyreCornerObservationFacts {
  const cornerState = state.corners[corner];
  const before = prepared.wearBefore.values[corner];
  const after = prepared.wearAfter.values[corner];
  const baseline = before ?? cornerState.lastWear;
  const valueChanged =
    after !== null && baseline !== null ? Math.abs(after - baseline) > EPSILON : null;
  const valueIncreased =
    after !== null && baseline !== null ? after > baseline + EPSILON : null;
  const trusted = prepared.servicePerformed.has(corner);
  const currentGeneration = prepared.generation.values[corner];
  const previousGeneration = cornerState.lastGeneration;
  const derived =
    !trusted &&
    prepared.realRefreshConfirmed &&
    before !== null &&
    after !== null &&
    after > before + EPSILON &&
    currentGeneration !== null &&
    previousGeneration !== null &&
    currentGeneration > previousGeneration;
  const performed = trusted || derived;
  const basis: TyreNewTyreBasis = trusted
    ? "trusted_executed_service"
    : derived
      ? "connector_confirmed_set_generation"
      : null;

  return {
    valueReceived: after !== null,
    valuePercent: after,
    valueChanged,
    valueIncreased,
    performedNewTyreConfirmed: performed,
    performedNewTyreBasis: basis,
    setGeneration: currentGeneration,
  };
}

function prepareObservation(
  raw: RawRecord,
  referenceContext: CanonicalContext | null,
  futureSourceRevisionExcluded: boolean,
): PreparedObservation | TyreIntervalRejection {
  const input = raw.input;
  if (raw.source.sourceKind !== "measurement_event") {
    return { index: raw.index, sourceUid: raw.source.sourceUid, reasons: ["interval_source_class_unsupported"] };
  }
  if (raw.source.observedAt === null) {
    return { index: raw.index, sourceUid: raw.source.sourceUid, reasons: ["observed_at_missing"] };
  }
  const payload = input.payload;
  if (!isPlainRecord(payload)) {
    return { index: raw.index, sourceUid: raw.source.sourceUid, reasons: ["payload_invalid"] };
  }
  const kind = shortIdentifier(payload.kind, 64);
  if (
    kind === null ||
    !(TYRE_INTERVAL_WEAR_ANCHOR_KINDS as readonly string[]).includes(kind)
  ) {
    return {
      index: raw.index,
      sourceUid: raw.source.sourceUid,
      reasons: ["unsupported_measurement_kind"],
    };
  }

  const observedSessionId = readOptionalIdentifier(payload, "observed_session_id");
  const segmentId = readOptionalIdentifier(payload, "segment_id");
  const sessionTimeSeconds = readSessionTime(payload);

  const annotations = isPlainRecord(input.annotations) ? input.annotations : undefined;
  const assessment = assessRecordQuality(
    {
      source: raw.source,
      payload,
      ...(annotations === undefined ? {} : { annotations }),
    },
    {
      ...(input.observedContext === undefined
        ? {}
        : { observedContext: input.observedContext as CanonicalContext | null }),
      referenceContext,
    },
  );
  if (assessment === null) {
    return { index: raw.index, sourceUid: raw.source.sourceUid, reasons: ["record_quality_invalid"] };
  }

  const hard = hardQualityReasons(assessment.targets.tyre_wear.blockingReasons);
  if (hard.length > 0) {
    return {
      index: raw.index,
      sourceUid: raw.source.sourceUid,
      reasons: limitReasons(["source_quality_blocked", ...hard]),
    };
  }

  const wearBefore = readWear(payload.wear_before);
  const wearAfter = readWear(payload.wear_after);
  if (!wearBefore.any && !wearAfter.any) {
    return {
      index: raw.index,
      sourceUid: raw.source.sourceUid,
      reasons: limitReasons([
        "wear_values_unusable",
        ...wearBefore.reasons,
        ...wearAfter.reasons,
      ]),
    };
  }

  const warnings: string[] = [
    ...wearBefore.reasons,
    ...wearAfter.reasons,
  ];
  if (!wearAfter.any) warnings.push("wear_after_missing");
  const generation = readGeneration(payload.set_generation);
  warnings.push(...generation.reasons);

  const evidence = readEvidence(payload.evidence);
  if (evidence.reason !== null) warnings.push(evidence.reason);

  let realRefreshConfirmed = false;
  if (kind === "wear_refresh_confirmed") {
    if (evidence.source === "tire_sets_used") {
      realRefreshConfirmed = true;
    } else {
      warnings.push(
        evidence.source === null ? "refresh_evidence_missing" : "refresh_evidence_source_mismatch",
      );
    }
  }

  const service = readServiceEvidence(
    input.serviceEvidence,
    kind,
    raw.source,
    payload,
    observedSessionId,
    sessionTimeSeconds,
  );
  warnings.push(...service.warnings);

  const distance = readDistanceEvidence(
    input.distanceEvidence,
    raw.source,
    payload,
    observedSessionId,
    sessionTimeSeconds,
  );
  warnings.push(...distance.warnings);

  const observedAt = raw.source.observedAt as string;
  if (
    hasOwn(payload, "observed_at") &&
    payload["observed_at"] !== null &&
    payload["observed_at"] !== observedAt
  ) {
    warnings.push("payload_observed_at_mismatch");
  }
  if (observedSessionId === null) warnings.push("observed_session_missing");
  for (const reason of ["observed_session_id_invalid", "segment_id_invalid", "annotations_invalid"]) {
    if (assessment.reasons.includes(reason)) warnings.push(reason);
  }
  if (futureSourceRevisionExcluded) warnings.push("future_source_revision_excluded");

  let context: CanonicalContext | null = null;
  if (input.observedContext === undefined) {
    context = buildCanonicalContext({ source: raw.source, payload });
  } else if (input.observedContext !== null) {
    const binding = bindObservedContextToObservation(input.observedContext as CanonicalContext, {
      source: raw.source,
      observedSessionId,
      segmentId,
    });
    context = binding.bound ? binding.context : null;
  }

  const resetOrTow = readResetOrTow(assessment);

  return {
    index: raw.index,
    source: raw.source,
    payload,
    assessment,
    kind,
    observedAtMs: Date.parse(observedAt),
    sessionId: observedSessionId,
    segmentId,
    sessionTimeSeconds,
    wearBefore,
    wearAfter,
    generation,
    realRefreshConfirmed,
    servicePerformed: service.performed,
    distance: distance.distance,
    resetOrTow,
    driverChanged:
      assessment.reported.driverChanged.status === "observed"
        ? assessment.reported.driverChanged.value
        : readBooleanValue(payload, "driver_changed"),
    context,
    quality: qualitySummary(assessment),
    contextSummary: contextSummary(context, referenceContext),
    warnings: limitReasons(warnings),
    futureSourceRevisionExcluded,
  };
}

function processObservation(
  state: StreamState,
  prepared: PreparedObservation,
  intervals: TyreCornerInterval[],
  observations: TyreObservationRecord[],
): void {
  const observationWarnings = new Set(prepared.warnings);
  const observationReasons = new Set<string>();

  if (state.previous !== null) {
    const verdict = continuityVerdict(state.previous, prepared);
    for (const warning of verdict.warnings) {
      observationWarnings.add(warning);
      for (const corner of TYRE_CORNERS) {
        const open = state.corners[corner].open;
        if (open !== null) open.warnings.add(warning);
      }
    }
    if (verdict.breaks.length > 0) {
      breakAll(state, verdict.breaks, intervals);
    }
  }

  const facts = {} as Record<TyreCorner, TyreCornerObservationFacts>;
  for (const corner of TYRE_CORNERS) {
    facts[corner] = factsForCorner(state, prepared, corner);
  }

  let contributed = false;

  for (const corner of TYRE_CORNERS) {
    const cornerState = state.corners[corner];
    const fact = facts[corner];
    const before = prepared.wearBefore.values[corner];
    const after = prepared.wearAfter.values[corner];
    const performed = fact.performedNewTyreConfirmed;

    if (prepared.kind === "wear_refresh_confirmed") {
      if (cornerState.open !== null) {
        const closed = closeIntervalAtBoundary(
          cornerState,
          corner,
          prepared,
          before,
          performed,
          true,
        );
        if (closed !== null) intervals.push(closed);
        contributed = true;
      }
      if (performed) {
        bumpGeneration(cornerState, prepared, fact.performedNewTyreBasis);
      } else {
        ensureGeneration(cornerState, prepared);
      }
      if (after !== null) {
        const continuity: TyreStartContinuity = performed
          ? "confirmed_new_tyre"
          : before !== null && after > before + EPSILON
            ? "refresh_after_unconfirmed_increase"
            : "confirmed_refresh";
        startInterval(cornerState, corner, prepared, after, continuity, performed);
        contributed = true;
      } else {
        cornerState.awaitingAnchor = true;
        cornerState.pendingAfterRefresh = true;
        cornerState.pendingStartContinuity = performed
          ? "confirmed_new_tyre"
          : "confirmed_refresh";
      }
      continue;
    }

    if (performed) {
      if (cornerState.open !== null) {
        const closed = closeIntervalAtBoundary(
          cornerState,
          corner,
          prepared,
          before,
          true,
          prepared.realRefreshConfirmed,
        );
        if (closed !== null) intervals.push(closed);
        contributed = true;
      }
      bumpGeneration(cornerState, prepared, fact.performedNewTyreBasis);
      if (after !== null) {
        startInterval(cornerState, corner, prepared, after, "confirmed_new_tyre", true);
        contributed = true;
      } else {
        cornerState.awaitingAnchor = true;
        cornerState.pendingAfterRefresh = true;
        cornerState.pendingStartContinuity = "confirmed_new_tyre";
      }
      continue;
    }

    if (cornerState.open !== null) {
      if (after === null) {
        continue;
      }
      if (fact.valueIncreased === true) {
        breakCorner(cornerState, corner, "wear_increase_unconfirmed", intervals);
        contributed = true;
        continue;
      }
      if (prepared.kind === "session_start") {
        observationWarnings.add("repeated_session_start");
      }
      addObservation(cornerState, prepared, fact, after);
      contributed = true;
      continue;
    }

    if (after !== null) {
      if (cornerState.pendingAfterRefresh) {
        ensureGeneration(cornerState, prepared);
        startInterval(
          cornerState,
          corner,
          prepared,
          after,
          cornerState.pendingStartContinuity,
          cornerState.pendingStartContinuity === "confirmed_new_tyre",
        );
        contributed = true;
      } else if (prepared.kind === "session_start") {
        const wasStarted = cornerState.started;
        ensureGeneration(cornerState, prepared);
        startInterval(
          cornerState,
          corner,
          prepared,
          after,
          wasStarted ? "reanchored_after_break" : "session_start",
          false,
        );
        contributed = true;
      }
    }
  }

  if (!contributed) observationReasons.add("awaiting_physical_anchor");

  for (const corner of TYRE_CORNERS) {
    const cornerState = state.corners[corner];
    const after = prepared.wearAfter.values[corner];
    if (after !== null) cornerState.lastWear = after;
    cornerState.lastGeneration = prepared.generation.values[corner];
  }

  observations.push({
    index: prepared.index,
    observationRef: sourceRef(prepared),
    facts: {
      corners: facts,
      realRefreshConfirmed: prepared.realRefreshConfirmed,
      refreshBasis: prepared.realRefreshConfirmed
        ? "producer_wear_refresh_confirmed"
        : null,
      selectedServiceObserved: prepared.kind === "pit_service_completed",
    },
    quality: prepared.quality,
    context: prepared.contextSummary,
    reasons: limitReasons([...observationReasons]),
    warnings: limitReasons([...observationWarnings]),
  });

  state.previous = prepared;
}

/**
 * Bouwt per hoek fysieke intervallen uit onbewerkte P1-bronrevisies.
 *
 * Ongeldige top-level invoer of een ongeldige expliciete cutoff levert null.
 * Individuele records sluiten met een reden; de rest van de batch blijft
 * bruikbaar. Er wordt nooit een ontbrekende start als 100% ingevuld.
 */
export function buildTyreIntervals(
  input: unknown,
  options?: TyreIntervalOptions,
): TyreIntervalResult | null {
  if (!Array.isArray(input)) return null;

  const cutoffValue = options?.sourceReceivedBefore ?? null;
  if (cutoffValue !== null && !isInstant(cutoffValue)) return null;
  const cutoffMs = cutoffValue === null ? null : Date.parse(cutoffValue);
  const referenceContext = options?.referenceContext ?? null;

  const emptyCutoff = (): TyreIntervalCutoffInfo => ({
    provided: cutoffValue !== null,
    sourceReceivedBefore: cutoffValue,
    basis: cutoffValue === null ? null : "source_received_at_only",
    asOfVerified: false,
    futureRevisionsExcluded: false,
  });

  if (input.length > TYRE_INTERVAL_MAX_OBSERVATIONS) {
    return {
      schemaVersion: TYRE_INTERVAL_SCHEMA_VERSION,
      policyVersion: TYRE_INTERVAL_POLICY_VERSION,
      intervals: [],
      observations: [],
      rejected: [],
      cutoff: emptyCutoff(),
      knownAtStatus: "unavailable",
      asOfVerified: false,
      inputCount: input.length,
      reasons: ["batch_too_large"],
    };
  }

  const rejected: TyreIntervalRejection[] = [];
  const rawRecords: RawRecord[] = [];

  for (let index = 0; index < input.length; index += 1) {
    const item = input[index];
    if (!isPlainRecord(item)) {
      rejected.push({ index, sourceUid: null, reasons: ["source_envelope_invalid"] });
      continue;
    }
    const source = parseSourceRecordEnvelope(item.source);
    if (source === null) {
      rejected.push({ index, sourceUid: null, reasons: ["source_envelope_invalid"] });
      continue;
    }
    rawRecords.push({ index, input: item, source });
  }

  const groups = new Map<string, RawRecord[]>();
  for (const record of rawRecords) {
    const key = JSON.stringify([
      "source",
      record.source.sourceKind,
      record.source.deviceId,
      record.source.sourceUid,
    ]);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [record]);
    else group.push(record);
  }

  const selected: Array<{ record: RawRecord; futureExcluded: boolean }> = [];
  let futureRevisionsExcluded = false;

  for (const group of groups.values()) {
    const first = group[0];
    const hashesByRevision = new Map<number, Set<string>>();
    for (const record of group) {
      const hashes = hashesByRevision.get(record.source.recordRevision) ?? new Set<string>();
      hashes.add(record.source.contentHash);
      hashesByRevision.set(record.source.recordRevision, hashes);
    }
    const conflict = [...hashesByRevision.values()].some((hashes) => hashes.size > 1);
    if (conflict) {
      rejected.push({
        index: Math.min(...group.map((record) => record.index)),
        sourceUid: first.source.sourceUid,
        reasons: ["source_revision_conflict"],
      });
      continue;
    }

    const withinCutoff =
      cutoffMs === null
        ? group
        : group.filter((record) => Date.parse(record.source.sourceReceivedAt) <= cutoffMs);
    if (withinCutoff.length === 0) {
      futureRevisionsExcluded = true;
      rejected.push({
        index: Math.min(...group.map((record) => record.index)),
        sourceUid: first.source.sourceUid,
        reasons: ["observation_after_cutoff"],
      });
      continue;
    }

    const maxRevision = Math.max(...group.map((record) => record.source.recordRevision));
    const maxWithin = Math.max(...withinCutoff.map((record) => record.source.recordRevision));
    const chosen = withinCutoff
      .filter((record) => record.source.recordRevision === maxWithin)
      .sort((left, right) => left.index - right.index)[0];
    const futureExcluded = maxWithin < maxRevision;
    if (futureExcluded) futureRevisionsExcluded = true;
    selected.push({ record: chosen, futureExcluded });
  }

  const prepared: PreparedObservation[] = [];
  for (const entry of selected) {
    const value = prepareObservation(
      entry.record,
      referenceContext,
      entry.futureExcluded,
    );
    if ("reasons" in value) {
      rejected.push(value);
    } else {
      prepared.push(value);
    }
  }

  const sorted = [...prepared].sort((left, right) => {
    if (left.observedAtMs !== right.observedAtMs) return left.observedAtMs - right.observedAtMs;
    const leftTime = left.sessionTimeSeconds ?? Number.POSITIVE_INFINITY;
    const rightTime = right.sessionTimeSeconds ?? Number.POSITIVE_INFINITY;
    if (leftTime !== rightTime) return leftTime - rightTime;
    return left.source.sourceUid.localeCompare(right.source.sourceUid);
  });

  const streams = new Map<string, PreparedObservation[]>();
  for (const observation of sorted) {
    const key = streamKey(observation);
    const stream = streams.get(key);
    if (stream === undefined) streams.set(key, [observation]);
    else stream.push(observation);
  }

  const intervals: TyreCornerInterval[] = [];
  const observations: TyreObservationRecord[] = [];

  for (const stream of streams.values()) {
    const state = createStreamState();
    for (const observation of stream) {
      processObservation(state, observation, intervals, observations);
    }
    for (const corner of TYRE_CORNERS) {
      const cornerState = state.corners[corner];
      const interval = finalizeCensored(cornerState, corner);
      if (interval !== null) intervals.push(interval);
    }
  }

  const cornerOrder = new Map<TyreCorner, number>(
    TYRE_CORNERS.map((corner, index) => [corner, index]),
  );
  intervals.sort((left, right) => {
    const leftStart = left.start === null ? 0 : Date.parse(left.start.observedAt);
    const rightStart = right.start === null ? 0 : Date.parse(right.start.observedAt);
    if (leftStart !== rightStart) return leftStart - rightStart;
    const cornerDifference =
      (cornerOrder.get(left.corner) ?? 0) - (cornerOrder.get(right.corner) ?? 0);
    if (cornerDifference !== 0) return cornerDifference;
    if (left.intervalRef.sequence !== right.intervalRef.sequence) {
      return left.intervalRef.sequence - right.intervalRef.sequence;
    }
    return left.intervalRef.startSourceUid.localeCompare(right.intervalRef.startSourceUid);
  });

  observations.sort((left, right) => {
    const leftTime = Date.parse(left.observationRef.observedAt);
    const rightTime = Date.parse(right.observationRef.observedAt);
    if (leftTime !== rightTime) return leftTime - rightTime;
    return left.observationRef.sourceUid.localeCompare(right.observationRef.sourceUid);
  });

  rejected.sort((left, right) => left.index - right.index);

  return {
    schemaVersion: TYRE_INTERVAL_SCHEMA_VERSION,
    policyVersion: TYRE_INTERVAL_POLICY_VERSION,
    intervals,
    observations,
    rejected,
    cutoff: {
      provided: cutoffValue !== null,
      sourceReceivedBefore: cutoffValue,
      basis: cutoffValue === null ? null : "source_received_at_only",
      asOfVerified: false,
      futureRevisionsExcluded,
    },
    knownAtStatus: "unavailable",
    asOfVerified: false,
    inputCount: input.length,
    reasons: [],
  };
}
