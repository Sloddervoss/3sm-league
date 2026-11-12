/**
 * Expliciete recordkwalificatie voor de pitwall-learninglaag (P2/T10).
 *
 * De module scheidt afwezigheid, een echte nul, onvolledige dekking, pitrondes,
 * reset/tow, datagaten en onbekende context. Zij leidt alleen begrensde
 * structurele labels en target-eligible-vlaggen af; geen training, score,
 * promotie of modeladvies. Alles is puur en deterministisch.
 *
 * Bronbeleid (versie in QUALITY_POLICY_VERSION):
 * - per coveragegroep minimaal 10 samples, maxGap 2 s en minimaal 80% van het
 *   rondevenster; groepen worden nooit bij elkaar opgeteld;
 * - `complete` alleen is geen bewijs: bronwaarheid en dekking moeten beide
 *   kloppen;
 * - NULL blijft onbekend. De connector schrijft `pit_lap`/`driver_changed`
 *   alleen true of NULL, dus NULL is nooit een bewezen false;
 * - `resetOrTow` bestaat niet in de P1-payload en moet expliciet als
 *   annotatie worden aangeleverd; afwezig blijft onbekend.
 */

import { LEARNING_TARGETS, type LearningTarget, type LearningUnit } from "./contracts";
import {
  bindObservedContextToObservation,
  buildCanonicalContext,
  compareCanonicalContexts,
  isInstant,
  parseSourceRecordEnvelope,
  type CanonicalContext,
  type ContextComparison,
  type SourceRecordEnvelope,
} from "./context";

export const QUALITY_SCHEMA_VERSION = "pitwall-learning-record-quality-v1" as const;
export const QUALITY_POLICY_VERSION = "pitwall-learning-quality-policy-v1" as const;

export const QUALITY_COVERAGE_GROUPS = ["fuel", "temperature", "load"] as const;
export type QualityCoverageGroup = (typeof QUALITY_COVERAGE_GROUPS)[number];

/** Spiegelt het bestaande broncontract (simhubExtensions.ts), hier versioned. */
export const QUALITY_MIN_SAMPLES_PER_GROUP = 10;
export const QUALITY_MAX_GAP_SECONDS = 2;
export const QUALITY_MIN_COVERED_FRACTION = 0.8;
/**
 * Toegestane klokspeling tussen het rondeinde en `source_received_at`.
 * Expliciet en versiegebonden; er wordt nooit `Date.now` gebruikt. Een Venster
 * dat verder in de toekomst ligt dan deze marge is geen bewezen verleden.
 */
export const QUALITY_MAX_WINDOW_FUTURE_SKEW_SECONDS = 300;

/**
 * Redenen die de connector werkelijk schrijft. Bron:
 * - CoverageRules.Evaluate in MeasurementEvent.cs;
 * - TelemetrySampler.CloseCurrent (session_changed, session_time_reset,
 *   lap_boundary_gap);
 * - MeasurementPipeline.End / EnduranceConnectorPlugin (session_end,
 *   plugin_stop);
 * - SimHubExtensions.coverageVerdict (dezelfde coverage-codes).
 *
 * Een onbekende code is geen excuus om hem te negeren: die faalt gesloten.
 * `reset_detected` bestaat niet in deze bron; een echte reset heet
 * `session_time_reset`.
 */
const GLOBAL_INVALID_REASONS = new Set([
  "coverage_window_missing",
  "coverage_duration:window",
  "session_changed",
  "session_time_reset",
  "lap_boundary_gap",
  "session_end",
  "plugin_stop",
  "lap_closed",
]);
const COVERAGE_GROUP_REASON_PATTERN =
  /^coverage_(missing|samples|gap|duration):(fuel|temperature|load)$/;

/** Ankertypes uit TyreAnchorTracker.cs; een ander `kind` is geen wear-anker. */
const WEAR_ANCHOR_KINDS = new Set([
  "session_start",
  "wear_value_changed",
  "pit_service_completed",
  "wear_refresh_confirmed",
]);

export interface ObservedValue<T> {
  readonly status: "observed" | "absent" | "invalid";
  readonly value: T | null;
  readonly reason: string | null;
}

export interface CoverageGroupQuality {
  readonly group: QualityCoverageGroup;
  readonly status: "present" | "absent" | "invalid";
  readonly sampleCount: number | null;
  readonly validDurationSeconds: number | null;
  readonly maxGapSeconds: number | null;
  readonly coveredFraction: number | null;
  readonly meetsPolicy: boolean | null;
  readonly reasons: readonly string[];
}

export interface CoverageQuality {
  readonly status: "certified" | "rejected" | "incomplete" | "unknown";
  readonly windowSeconds: number | null;
  readonly groups: readonly CoverageGroupQuality[];
  readonly reasons: readonly string[];
}

export interface TargetLabel {
  readonly status: "available" | "missing" | "invalid";
  readonly value: number | null;
  readonly unit: LearningUnit | null;
  readonly sourceClass: "lap" | "event" | null;
  readonly reasons: readonly string[];
}

export interface TargetQuality {
  readonly target: LearningTarget;
  readonly eligible: boolean;
  readonly blockingReasons: readonly string[];
  readonly warningReasons: readonly string[];
  readonly label: TargetLabel;
}

/** Echte P1-vorm: wear is per hoek een object, geen scalar. */
export interface WearCorners {
  readonly fl: number;
  readonly fr: number;
  readonly rl: number;
  readonly rr: number;
}

export interface WearValueQuality {
  readonly status: "observed" | "absent" | "invalid";
  readonly corners: WearCorners | null;
  /** Alleen ingevuld als alle vier hoeken gelijk zijn; anders is een scalar label ambigu. */
  readonly value: number | null;
  readonly reason: string | null;
}

export interface WearQuality {
  readonly before: WearValueQuality;
  readonly after: WearValueQuality;
  readonly beforePercent: ObservedValue<number>;
  readonly afterPercent: ObservedValue<number>;
}

export interface RecordQualityAssessment {
  readonly schemaVersion: typeof QUALITY_SCHEMA_VERSION;
  readonly policyVersion: typeof QUALITY_POLICY_VERSION;
  readonly source: SourceRecordEnvelope & {
    readonly observedSessionId: string | null;
    readonly deliveredSessionId: string | null;
    readonly segmentId: string | null;
  };
  readonly reported: {
    readonly complete: ObservedValue<boolean>;
    readonly pitLap: ObservedValue<boolean>;
    readonly driverChanged: ObservedValue<boolean>;
    readonly resetOrTow: ObservedValue<boolean>;
    readonly kind: string | null;
    readonly lapNumber: ObservedValue<number>;
    readonly invalidReasons: readonly string[];
    readonly invalidReasonsStatus: "absent" | "observed" | "invalid";
    readonly gap: ObservedValue<number> & { readonly exceedsPolicy: boolean | null };
  };
  readonly coverage: CoverageQuality;
  readonly fuel: {
    readonly startLitres: ObservedValue<number>;
    readonly endLitres: ObservedValue<number>;
    readonly usedLitres: ObservedValue<number>;
    readonly addedLitres: ObservedValue<number>;
  };
  readonly wear: WearQuality;
  readonly reasons: readonly string[];
  readonly targets: Readonly<Record<LearningTarget, TargetQuality>>;
}

export interface RecordQualityInputAnnotations {
  /** Alleen een expliciete, gecontroleerde bron mag dit zetten. */
  readonly resetOrTow?: boolean | null;
}

export interface RecordQualityOptions {
  /** Context van de waarneming; zonder claim blijft die expliciet onbekend. */
  readonly observedContext?: CanonicalContext | null;
  /** Context van de referentie-/trainingsset; null betekent onbekend, niet match. */
  readonly referenceContext?: CanonicalContext | null;
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
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

function isShortString(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value.trim().length > 0 &&
    !hasControlCharacters(value)
  );
}

function sortedUnique(reasons: readonly string[]): string[] {
  return [...new Set(reasons)].sort();
}

function observed<T>(value: T): ObservedValue<T> {
  return { status: "observed", value, reason: null };
}

function absent<T>(): ObservedValue<T> {
  return { status: "absent", value: null, reason: null };
}

function invalid<T>(reason: string): ObservedValue<T> {
  return { status: "invalid", value: null, reason };
}

function readBoolean(
  record: Record<string, unknown>,
  key: string,
  label: string,
): ObservedValue<boolean> {
  if (!hasOwn(record, key) || record[key] === null) return absent();
  const value = record[key];
  if (typeof value !== "boolean") return invalid(`${label}_invalid`);
  return observed(value);
}

interface NumberRule {
  readonly min: number;
  readonly max?: number;
  readonly integer?: boolean;
}

function readNumber(
  record: Record<string, unknown>,
  key: string,
  label: string,
  rule: NumberRule,
): ObservedValue<number> {
  if (!hasOwn(record, key) || record[key] === null) return absent();
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) return invalid(`${label}_not_finite`);
  if (rule.integer && !Number.isSafeInteger(value)) return invalid(`${label}_not_integer`);
  if (value < rule.min) {
    return invalid(rule.min === 0 ? `${label}_negative` : `${label}_out_of_range`);
  }
  if (rule.max !== undefined && value > rule.max) return invalid(`${label}_out_of_range`);
  return observed(value);
}

function readOptionalPayloadId(
  payload: Record<string, unknown>,
  key: string,
  reasons: string[],
): string | null {
  if (!hasOwn(payload, key) || payload[key] === null) return null;
  const value = payload[key];
  if (!isShortString(value, 128)) {
    reasons.push(`${key}_invalid`);
    return null;
  }
  return value;
}

interface InvalidReasonsRead {
  readonly values: readonly string[];
  readonly status: "absent" | "observed" | "invalid";
  readonly reasons: readonly string[];
}

function readInvalidReasons(
  payload: Record<string, unknown>,
  reasons: string[],
): InvalidReasonsRead {
  if (!hasOwn(payload, "invalid_reasons") || payload["invalid_reasons"] === null) {
    return { values: [], status: "absent", reasons: [] };
  }
  const raw = payload["invalid_reasons"];
  if (!Array.isArray(raw) || raw.length > 16) {
    reasons.push("invalid_reasons_malformed");
    return { values: [], status: "invalid", reasons: ["invalid_reasons_malformed"] };
  }
  const out: string[] = [];
  for (const value of raw) {
    if (!isShortString(value, 64)) {
      reasons.push("invalid_reasons_malformed");
      return { values: [], status: "invalid", reasons: ["invalid_reasons_malformed"] };
    }
    out.push(value);
  }
  return { values: out, status: "observed", reasons: [] };
}

interface InvalidReasonDiagnosis {
  /** Redenen die elk target raken. */
  readonly global: readonly string[];
  /** Redenen die de fuelgroep raken. */
  readonly fuel: readonly string[];
  /** Redenen die de eigen coveragecijfers tegenspreken. */
  readonly contradictions: readonly string[];
  /** Redenen die deze module niet uit de bron kan herleiden. */
  readonly unknown: readonly string[];
}

function diagnoseInvalidReasons(
  values: readonly string[],
  coverage: CoverageQuality,
): InvalidReasonDiagnosis {
  const global: string[] = [];
  const fuel: string[] = [];
  const contradictions: string[] = [];
  const unknown: string[] = [];

  for (const code of values) {
    if (GLOBAL_INVALID_REASONS.has(code)) {
      global.push(code);
      continue;
    }
    const match = COVERAGE_GROUP_REASON_PATTERN.exec(code);
    if (match !== null) {
      const group = match[2] as QualityCoverageGroup;
      const entry = coverage.groups.find((candidate) => candidate.group === group);
      if (entry?.meetsPolicy === true) contradictions.push(code);
      if (group === "fuel") fuel.push(code);
      continue;
    }
    unknown.push(code);
  }

  return { global, fuel, contradictions, unknown };
}

function readAnnotations(raw: unknown, reasons: string[]): ObservedValue<boolean> {
  if (raw === undefined || raw === null) return absent();
  if (!isPlainRecord(raw)) {
    reasons.push("annotations_invalid");
    return absent();
  }
  return readBoolean(raw, "resetOrTow", "reset_or_tow");
}

function readLapNumber(payload: Record<string, unknown>): ObservedValue<number> {
  if (!hasOwn(payload, "lap_number") || payload["lap_number"] === null) return absent();
  const value = payload["lap_number"];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    return invalid("lap_number_invalid");
  }
  return observed(value);
}

interface WindowResult {
  readonly seconds: number | null;
  readonly reasons: readonly string[];
}

function readWindow(
  payload: Record<string, unknown>,
  sourceReceivedAt: string,
): WindowResult {
  const startedAt = payload["started_at"];
  const endedAt = payload["ended_at"];
  if (!isInstant(startedAt) || !isInstant(endedAt)) {
    return { seconds: null, reasons: ["coverage_window_missing"] };
  }
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  const seconds = (end - start) / 1000;
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return { seconds: null, reasons: ["coverage_window_order"] };
  }

  // Een ronde kan niet aantoonbaar in de toekomst van het ontvangstmoment
  // liggen. De marge is expliciet; er is geen impliciete `now`.
  const received = Date.parse(sourceReceivedAt);
  const allowedFutureMs = QUALITY_MAX_WINDOW_FUTURE_SKEW_SECONDS * 1000;
  if (start > received + allowedFutureMs || end > received + allowedFutureMs) {
    return { seconds: null, reasons: ["coverage_window_future"] };
  }
  return { seconds, reasons: [] };
}

interface GapDiagnosis {
  /** Blokkades die voor elk target gelden. */
  readonly reasons: readonly string[];
  /** True als het rootgat de coveragegroepen tegenspreekt. */
  readonly contradictsCoverage: boolean;
}

/**
 * Het root-`max_gap_seconds` in P1 is een afgeleide: CoverageRules.MaxGap neemt
 * het maximum van de drie groepsgaten. Een rootwaarde die groter is dan elk
 * groepspunt kan dus niet uit dezelfde meting komen. In dat geval vertrouwen we
 * geen van beide en blokkeren we alle targets; een consistente rootwaarde wijst
 * naar de groep(en) en laat target-scoping intact.
 */
function diagnoseReportedGap(
  gap: ObservedValue<number>,
  coverage: CoverageQuality,
): GapDiagnosis {
  if (gap.status === "invalid") {
    return {
      reasons: ["reported_gap_invalid", ...(gap.reason === null ? [] : [gap.reason])],
      contradictsCoverage: false,
    };
  }
  if (gap.status === "absent") return { reasons: [], contradictsCoverage: false };

  const groupGaps = coverage.groups
    .map((group) => group.maxGapSeconds)
    .filter((value): value is number => value !== null);
  const exceedsPolicy = gap.value > QUALITY_MAX_GAP_SECONDS;

  if (groupGaps.length === 0) {
    return {
      reasons: exceedsPolicy ? ["reported_max_gap_exceeds_policy"] : [],
      contradictsCoverage: false,
    };
  }

  const maximumGroupGap = Math.max(...groupGaps);
  if (Math.abs(gap.value - maximumGroupGap) > 1e-6) {
    return {
      // Alleen de tegenspraak is hier de blokkade. Het rootgetal zelf is geen
      // targetautoriteit; de groepsscores blijven leidend.
      reasons: ["max_gap_seconds_contradicts_coverage_gap"],
      contradictsCoverage: true,
    };
  }
  return { reasons: [], contradictsCoverage: false };
}

function parseCoverageGroup(
  raw: unknown,
  group: QualityCoverageGroup,
  windowSeconds: number | null,
): CoverageGroupQuality {
  const prefix = `coverage_${group}`;
  if (raw === undefined || raw === null) {
    return {
      group,
      status: "absent",
      sampleCount: null,
      validDurationSeconds: null,
      maxGapSeconds: null,
      coveredFraction: null,
      meetsPolicy: null,
      reasons: [`${prefix}_missing`],
    };
  }
  if (!isPlainRecord(raw)) {
    return {
      group,
      status: "invalid",
      sampleCount: null,
      validDurationSeconds: null,
      maxGapSeconds: null,
      coveredFraction: null,
      meetsPolicy: null,
      reasons: [`${prefix}_invalid`],
    };
  }

  const samples = readNumber(raw, "sampleCount", `${prefix}_sample_count`, {
    min: 0,
    integer: true,
  });
  const duration = readNumber(raw, "validDurationSeconds", `${prefix}_valid_duration`, { min: 0 });
  const gap = readNumber(raw, "maxGapSeconds", `${prefix}_max_gap`, { min: 0 });

  const reasons: string[] = [];
  for (const value of [samples, duration, gap]) {
    if (value.status === "invalid" && value.reason !== null) reasons.push(value.reason);
  }
  const anyInvalid = samples.status === "invalid" || duration.status === "invalid" || gap.status === "invalid";
  if (anyInvalid) reasons.push(`${prefix}_invalid`);

  if (samples.status === "absent") reasons.push(`${prefix}_samples_unknown`);
  if (duration.status === "absent") reasons.push(`${prefix}_duration_unknown`);
  if (gap.status === "absent") reasons.push(`${prefix}_gap_unknown`);
  if (windowSeconds === null) reasons.push(`${prefix}_window_missing`);

  if (samples.status === "observed" && samples.value < QUALITY_MIN_SAMPLES_PER_GROUP) {
    reasons.push(`${prefix}_samples`);
  }
  if (gap.status === "observed" && gap.value > QUALITY_MAX_GAP_SECONDS) {
    reasons.push(`${prefix}_gap`);
  }

  let coveredFraction: number | null = null;
  if (windowSeconds !== null && duration.status === "observed") {
    coveredFraction = duration.value / windowSeconds;
    if (duration.value > windowSeconds + 1e-6) {
      reasons.push(`${prefix}_duration_exceeds_window`);
    } else if (
      duration.value <= 0 ||
      duration.value < windowSeconds * QUALITY_MIN_COVERED_FRACTION - 1e-6
    ) {
      reasons.push(`${prefix}_duration`);
    }
  }

  const allObserved =
    samples.status === "observed" && duration.status === "observed" && gap.status === "observed";
  const meetsPolicy =
    allObserved &&
    windowSeconds !== null &&
    samples.value >= QUALITY_MIN_SAMPLES_PER_GROUP &&
    gap.value <= QUALITY_MAX_GAP_SECONDS &&
    duration.value > 0 &&
    duration.value <= windowSeconds + 1e-6 &&
    duration.value >= windowSeconds * QUALITY_MIN_COVERED_FRACTION - 1e-6;

  return {
    group,
    status: anyInvalid ? "invalid" : "present",
    sampleCount: samples.value,
    validDurationSeconds: duration.value,
    maxGapSeconds: gap.value,
    coveredFraction,
    meetsPolicy,
    reasons: sortedUnique(reasons),
  };
}

function parseCoverage(
  payload: Record<string, unknown>,
  window: WindowResult,
  reportedComplete: ObservedValue<boolean>,
): CoverageQuality {
  const raw = payload["coverage"];
  const reasons: string[] = [...window.reasons];
  const groups: CoverageGroupQuality[] = [];

  for (const group of QUALITY_COVERAGE_GROUPS) {
    const groupRaw = isPlainRecord(raw) ? raw[group] : undefined;
    groups.push(parseCoverageGroup(groupRaw, group, window.seconds));
  }
  for (const group of groups) reasons.push(...group.reasons);

  let status: CoverageQuality["status"];
  if (reportedComplete.status === "observed" && reportedComplete.value === true) {
    const allMeet = groups.every((group) => group.meetsPolicy === true);
    if (allMeet) {
      status = "certified";
    } else {
      status = "rejected";
      reasons.push("coverage_complete_rejected");
    }
  } else if (reportedComplete.status === "observed" && reportedComplete.value === false) {
    status = "incomplete";
    reasons.push("coverage_source_complete_false");
  } else {
    status = "unknown";
    reasons.push("coverage_reported_complete_unknown");
  }

  return { status, windowSeconds: window.seconds, groups, reasons: sortedUnique(reasons) };
}

function readFuel(
  payload: Record<string, unknown>,
): RecordQualityAssessment["fuel"] {
  const start = readNumber(payload, "fuel_start_litres", "fuel_start_litres", { min: 0 });
  const end = readNumber(payload, "fuel_end_litres", "fuel_end_litres", { min: 0 });
  const added = readNumber(payload, "fuel_added_litres_observed", "fuel_added_litres_observed", {
    min: 0,
  });

  let used: ObservedValue<number>;
  if (start.status === "invalid" || end.status === "invalid") {
    used = invalid("fuel_used_litres_invalid");
  } else if (start.status === "absent" || end.status === "absent") {
    used = absent();
  } else if (end.value > start.value) {
    used = invalid("fuel_used_litres_negative");
  } else {
    used = observed(start.value - end.value);
  }

  return { startLitres: start, endLitres: end, usedLitres: used, addedLitres: added };
}

function readWearValue(
  payload: Record<string, unknown>,
  key: string,
): WearValueQuality {
  if (!hasOwn(payload, key) || payload[key] === null) {
    return { status: "absent", corners: null, value: null, reason: null };
  }
  const raw = payload[key];
  if (!isPlainRecord(raw)) {
    return {
      status: "invalid",
      corners: null,
      value: null,
      reason: "wear_shape_unsupported",
    };
  }
  if (raw.version !== 1) {
    return {
      status: "invalid",
      corners: null,
      value: null,
      reason: "wear_version_unsupported",
    };
  }
  if (raw.scale !== "remaining_percent") {
    return {
      status: "invalid",
      corners: null,
      value: null,
      reason: "wear_scale_unsupported",
    };
  }

  const readCorner = (corner: "fl" | "fr" | "rl" | "rr"): number | null => {
    const value = raw[corner];
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > 100
    ) {
      return null;
    }
    return value;
  };
  const fl = readCorner("fl");
  const fr = readCorner("fr");
  const rl = readCorner("rl");
  const rr = readCorner("rr");
  if (fl === null || fr === null || rl === null || rr === null) {
    return {
      status: "invalid",
      corners: null,
      value: null,
      reason: "wear_corner_invalid",
    };
  }

  const corners: WearCorners = { fl, fr, rl, rr };
  if (fl !== fr || fl !== rl || fl !== rr) {
    // Een scalar label zonder hoek zou vier echte waarden tot één verzinnen.
    // De hoeken blijven bewaard; T11 mag later per-hoek kwalificeren.
    return {
      status: "invalid",
      corners,
      value: null,
      reason: "wear_corner_ambiguous",
    };
  }
  return { status: "observed", corners, value: fl, reason: null };
}

function readWear(payload: Record<string, unknown>): WearQuality {
  const before = readWearValue(payload, "wear_before");
  const after = readWearValue(payload, "wear_after");
  const asObserved = (value: WearValueQuality): ObservedValue<number> =>
    value.status === "observed"
      ? observed(value.value as number)
      : value.status === "absent"
        ? absent()
        : invalid(value.reason ?? "wear_invalid");
  return {
    before,
    after,
    beforePercent: asObserved(before),
    afterPercent: asObserved(after),
  };
}

function targetContextReasons(
  comparison: ContextComparison,
  blocking: string[],
  warning: string[],
): void {
  blocking.push(...comparison.blockingReasons);
  warning.push(...comparison.warningReasons);
}

function finishTarget(
  target: LearningTarget,
  label: TargetLabel,
  blocking: readonly string[],
  warning: readonly string[],
): TargetQuality {
  const blockingReasons = sortedUnique(blocking);
  const warningReasons = sortedUnique(warning);
  return {
    target,
    eligible:
      blockingReasons.length === 0 && label.status === "available" && label.value !== null,
    blockingReasons,
    warningReasons,
    label: { ...label, reasons: sortedUnique(label.reasons) },
  };
}

function coverageTargetReasons(
  coverage: CoverageQuality,
  reportedComplete: ObservedValue<boolean>,
  groups: readonly QualityCoverageGroup[],
): string[] {
  const reasons: string[] = [];
  if (reportedComplete.status !== "observed" || reportedComplete.value !== true) {
    reasons.push("coverage_complete_unproven");
  }
  for (const group of groups) {
    const entry = coverage.groups.find((candidate) => candidate.group === group);
    if (!entry || entry.meetsPolicy !== true) {
      reasons.push(...(entry?.reasons ?? [`coverage_${group}_missing`]));
    }
  }
  return reasons;
}

function buildTargets(
  source: SourceRecordEnvelope,
  reported: RecordQualityAssessment["reported"],
  coverage: CoverageQuality,
  fuel: RecordQualityAssessment["fuel"],
  wear: RecordQualityAssessment["wear"],
  contexts: Readonly<Record<LearningTarget, ContextComparison>>,
  sharedBlocking: readonly string[],
  lapBlocking: readonly string[],
  fuelInvalidReasonBlocking: readonly string[],
  observedSessionId: string | null,
  segmentId: string | null,
): Readonly<Record<LearningTarget, TargetQuality>> {
  const sourceClass = source.sourceKind === "lap_summary" ? "lap" : "event";
  const lap = sourceClass === "lap";

  const fuelBlocking: string[] = [
    ...sharedBlocking,
    ...lapBlocking,
    ...fuelInvalidReasonBlocking,
  ];
  const fuelWarning: string[] = [];
  targetContextReasons(contexts.fuel, fuelBlocking, fuelWarning);
  let fuelLabel: TargetLabel;
  if (!lap) {
    fuelBlocking.push("fuel_source_class_event");
    fuelLabel = {
      status: "missing",
      value: null,
      unit: null,
      sourceClass,
      reasons: ["fuel_source_class_event"],
    };
  } else {
    fuelBlocking.push(...coverageTargetReasons(coverage, reported.complete, ["fuel"]));
    if (reported.lapNumber.status === "absent") {
      fuelBlocking.push("lap_number_missing");
    } else if (reported.lapNumber.status === "invalid") {
      fuelBlocking.push("lap_number_invalid");
      if (reported.lapNumber.reason !== null) fuelBlocking.push(reported.lapNumber.reason);
    }
    // P1's conservatieve audit eist beide velden non-null voor een
    // lap-identiteit/groepering; onbekend is geen bewijs van continuïteit.
    if (observedSessionId === null) fuelBlocking.push("observed_session_missing");
    if (segmentId === null) fuelBlocking.push("segment_id_missing");
    if (reported.pitLap.status !== "observed") {
      fuelBlocking.push("pit_lap_unknown");
      if (reported.pitLap.reason !== null) fuelBlocking.push(reported.pitLap.reason);
    } else if (reported.pitLap.value === true) {
      fuelBlocking.push("pit_lap_true");
    }
    if (reported.resetOrTow.status !== "observed") {
      fuelBlocking.push("reset_or_tow_unknown");
      if (reported.resetOrTow.reason !== null) fuelBlocking.push(reported.resetOrTow.reason);
    } else if (reported.resetOrTow.value === true) {
      fuelBlocking.push("reset_or_tow_observed");
    }
    // NULL betekent niet "geen wissel": zonder bewezen false is niet
    // aantoonbaar dat dezelfde rijder de hele ronde reed.
    if (reported.driverChanged.status !== "observed") {
      fuelBlocking.push("driver_changed_unknown");
      if (reported.driverChanged.reason !== null) fuelBlocking.push(reported.driverChanged.reason);
    } else if (reported.driverChanged.value === true) {
      fuelBlocking.push("driver_changed_in_lap");
    }

    if (fuel.startLitres.status === "invalid" || fuel.endLitres.status === "invalid") {
      fuelBlocking.push("fuel_level_invalid");
      if (fuel.startLitres.reason !== null) fuelBlocking.push(fuel.startLitres.reason);
      if (fuel.endLitres.reason !== null) fuelBlocking.push(fuel.endLitres.reason);
    }
    if (fuel.startLitres.status === "absent") fuelBlocking.push("fuel_start_missing");
    if (fuel.endLitres.status === "absent") fuelBlocking.push("fuel_end_missing");
    if (fuel.usedLitres.status === "invalid" && fuel.usedLitres.reason !== null) {
      fuelBlocking.push(fuel.usedLitres.reason);
    }
    // De P1-audit vereist een expliciete 0. Ontbreken of "0" is geen bewijs
    // van niet-tanken; alleen een echte numerieke 0 is dat.
    if (fuel.addedLitres.status === "absent") {
      fuelBlocking.push("refuel_unknown");
    } else if (fuel.addedLitres.status === "invalid") {
      fuelBlocking.push("fuel_added_litres_observed_invalid");
      if (fuel.addedLitres.reason !== null) fuelBlocking.push(fuel.addedLitres.reason);
    } else if (fuel.addedLitres.value > 0) {
      fuelBlocking.push("refuel_in_lap_observed");
    }
    if (fuel.usedLitres.status === "observed" && fuel.usedLitres.value === 0) {
      // De waarde blijft een echte 0, maar een nulverbruik is geen bruikbare
      // fuelrate. De target wordt apart ongeschikt; het getal wordt niet gewist.
      fuelBlocking.push("fuel_zero_rate");
    }

    if (fuel.usedLitres.status === "observed" && fuel.usedLitres.reason === null) {
      fuelLabel = {
        status: "available",
        value: fuel.usedLitres.value,
        unit: "L/lap",
        sourceClass,
        reasons: [],
      };
    } else {
      const reasons = [
        ...(fuel.startLitres.status === "absent" ? ["fuel_start_missing"] : []),
        ...(fuel.endLitres.status === "absent" ? ["fuel_end_missing"] : []),
        ...(fuel.usedLitres.reason !== null ? [fuel.usedLitres.reason] : []),
        ...(fuel.addedLitres.status === "observed" && fuel.addedLitres.value > 0
          ? ["refuel_in_lap_observed"]
          : []),
      ];
      fuelLabel = {
        status: fuel.usedLitres.status === "invalid" ? "invalid" : "missing",
        value: null,
        unit: null,
        sourceClass,
        reasons,
      };
    }
  }

  const pitBlocking = [
    ...sharedBlocking,
    ...lapBlocking,
    "label_source_missing",
    "pit_stop_duration_missing",
  ];
  const pitWarning: string[] = [];
  targetContextReasons(contexts.pit_loss, pitBlocking, pitWarning);
  const pitLabel: TargetLabel = {
    status: "missing",
    value: null,
    unit: null,
    sourceClass,
    reasons: ["label_source_missing", "pit_stop_duration_missing"],
  };

  const paceBlocking = [
    ...sharedBlocking,
    ...lapBlocking,
    "label_source_missing",
    "lap_time_seconds_missing",
  ];
  const paceWarning: string[] = [];
  targetContextReasons(contexts.tyre_pace, paceBlocking, paceWarning);
  const paceLabel: TargetLabel = {
    status: "missing",
    value: null,
    unit: null,
    sourceClass,
    reasons: ["label_source_missing", "lap_time_seconds_missing"],
  };

  const wearBlocking: string[] = [...sharedBlocking];
  const wearWarning: string[] = [];
  targetContextReasons(contexts.tyre_wear, wearBlocking, wearWarning);
  const kind = reported.kind;
  if (!lap && (kind === null || !WEAR_ANCHOR_KINDS.has(kind))) {
    wearBlocking.push("wear_source_kind_unknown");
  }
  if (reported.resetOrTow.status !== "observed") {
    wearWarning.push("reset_or_tow_unknown");
    if (reported.resetOrTow.reason !== null) wearWarning.push(reported.resetOrTow.reason);
  } else if (reported.resetOrTow.value === true) {
    wearBlocking.push("reset_or_tow_observed");
  }
  if (reported.pitLap.status === "observed" && reported.pitLap.value === true) {
    wearWarning.push("pit_lap_true");
  } else if (reported.pitLap.status !== "observed") {
    wearWarning.push("pit_lap_unknown");
  }
  if (reported.driverChanged.status === "observed" && reported.driverChanged.value === true) {
    wearBlocking.push("driver_changed_in_lap");
  } else if (reported.driverChanged.status !== "observed") {
    wearWarning.push("driver_changed_unknown");
  }

  let wearLabel: TargetLabel;
  if (!lap && wear.afterPercent.status === "observed") {
    wearLabel = {
      status: "available",
      value: wear.afterPercent.value,
      unit: "percent_remaining",
      sourceClass,
      reasons: [],
    };
  } else if (wear.afterPercent.status === "invalid") {
    wearBlocking.push("wear_after_invalid");
    if (wear.afterPercent.reason !== null) wearBlocking.push(wear.afterPercent.reason);
    wearLabel = {
      status: "invalid",
      value: null,
      unit: null,
      sourceClass,
      reasons: [wear.afterPercent.reason ?? "wear_after_invalid"],
    };
  } else {
    const reason = lap ? "wear_value_missing" : "wear_after_missing";
    wearBlocking.push(reason);
    wearLabel = {
      status: "missing",
      value: null,
      unit: null,
      sourceClass,
      reasons: [reason],
    };
  }

  return {
    fuel: finishTarget("fuel", fuelLabel, fuelBlocking, fuelWarning),
    pit_loss: finishTarget("pit_loss", pitLabel, pitBlocking, pitWarning),
    tyre_wear: finishTarget("tyre_wear", wearLabel, wearBlocking, wearWarning),
    tyre_pace: finishTarget("tyre_pace", paceLabel, paceBlocking, paceWarning),
  };
}

/**
 * Beoordeelt één bronrecord. Ongeldige JSON-vorm of een ongeldige
 * bron-envelope levert null; gewone veldfouten worden als reden bewaard.
 */
export function assessRecordQuality(
  input: unknown,
  options?: RecordQualityOptions,
): RecordQualityAssessment | null {
  try {
    if (!isPlainRecord(input)) return null;
    const source = parseSourceRecordEnvelope(input.source);
    if (source === null) return null;
    const payload = input.payload;
    if (!isPlainRecord(payload)) return null;

    const sharedReasons: string[] = [];
    const observedSessionId = readOptionalPayloadId(payload, "observed_session_id", sharedReasons);
    const deliveredSessionId = readOptionalPayloadId(payload, "delivered_session_id", sharedReasons);
    const segmentId = readOptionalPayloadId(payload, "segment_id", sharedReasons);

    const reportedComplete = readBoolean(payload, "complete", "complete");
    const reportedPitLap = readBoolean(payload, "pit_lap", "pit_lap");
    const reportedDriverChanged = readBoolean(payload, "driver_changed", "driver_changed");
    const resetOrTow = readAnnotations(input.annotations, sharedReasons);
    const invalidReasonsRead = readInvalidReasons(payload, sharedReasons);
    const kind =
      source.sourceKind === "measurement_event" && isShortString(payload.kind, 64)
        ? payload.kind
        : null;
    const reportedGapValue = readNumber(payload, "max_gap_seconds", "max_gap_seconds", { min: 0 });
    const reportedLapNumber = readLapNumber(payload);
    const reportedGap = {
      ...reportedGapValue,
      exceedsPolicy:
        reportedGapValue.status === "observed"
          ? reportedGapValue.value > QUALITY_MAX_GAP_SECONDS
          : null,
    };

    const window = readWindow(payload, source.sourceReceivedAt);
    const baseCoverage = parseCoverage(payload, window, reportedComplete);
    const invalidReasonDiagnosis = diagnoseInvalidReasons(
      invalidReasonsRead.values,
      baseCoverage,
    );
    const gapDiagnosis = diagnoseReportedGap(reportedGapValue, baseCoverage);

    let coverage: CoverageQuality = baseCoverage;
    const coverageOverrides: string[] = [];
    if (invalidReasonsRead.status === "invalid") {
      coverageOverrides.push("invalid_reasons_malformed");
    }
    for (const code of invalidReasonDiagnosis.contradictions) {
      coverageOverrides.push(`invalid_reason_contradicts_coverage:${code}`);
    }
    if (gapDiagnosis.contradictsCoverage) {
      coverageOverrides.push("max_gap_seconds_contradicts_coverage_gap");
    }
    if (coverageOverrides.length > 0) {
      // De cijfers kunnen nog kloppen, maar de bronclaims spreken elkaar tegen.
      // Dan is "certified" te sterk; het targetlabel wordt apart gescoord.
      coverage = {
        ...coverage,
        status: "unknown",
        reasons: sortedUnique([...coverage.reasons, ...coverageOverrides]),
      };
    }
    sharedReasons.push(...coverage.reasons);

    const reportedInvalidReasons = invalidReasonsRead.values;
    const lapBlocking: string[] = [...window.reasons];
    const sharedBlocking: string[] = [...gapDiagnosis.reasons];
    // P1 audit-sources.sql eist `array_length(invalid_reasons,1)=0` voor een
    // structurele fuelkandidaat. Elke niet-lege lijst, ook een onbekende token,
    // sluit de lap-targets; de specifieke codes hieronder geven de detailreden.
    if (reportedInvalidReasons.length > 0 || invalidReasonsRead.status === "invalid") {
      sharedBlocking.push("source_invalid_reasons");
    }
    for (const code of invalidReasonDiagnosis.global) {
      sharedBlocking.push("invalid_reason_global", `invalid_reason:${code}`);
    }
    for (const code of invalidReasonDiagnosis.unknown) {
      sharedBlocking.push("invalid_reason_unrecognized", `invalid_reason:${code}`);
    }
    if (invalidReasonsRead.status === "invalid") {
      sharedBlocking.push("invalid_reasons_malformed");
    }

    const fuelInvalidReasonBlocking: string[] = [];
    for (const code of invalidReasonDiagnosis.fuel) {
      fuelInvalidReasonBlocking.push(
        invalidReasonDiagnosis.contradictions.includes(code)
          ? "invalid_reason_contradicts_coverage"
          : "invalid_reason_group",
        `invalid_reason:${code}`,
      );
    }

    const fuel = readFuel(payload);
    const wear = readWear(payload);

    for (const value of [
      reportedGapValue,
      reportedLapNumber,
      fuel.startLitres,
      fuel.endLitres,
      fuel.usedLitres,
      fuel.addedLitres,
      wear.beforePercent,
      wear.afterPercent,
    ]) {
      if (value.status === "invalid" && value.reason !== null) sharedReasons.push(value.reason);
    }

    let observedContext: CanonicalContext | null;
    if (options?.observedContext !== undefined) {
      const binding = bindObservedContextToObservation(options.observedContext, {
        source,
        observedSessionId,
        segmentId,
      });
      observedContext = binding.context;
      if (!binding.bound) {
        sharedBlocking.push("observed_context_binding_failed", ...binding.reasons);
      }
    } else {
      // Geen claim aangeleverd: bouw een expliciet onbekende context uit precies
      // deze invoer. Dat is geen herstel van een mislukte externe claim.
      observedContext = buildCanonicalContext({ source, payload });
    }
    const referenceContext = options?.referenceContext ?? null;
    const contexts = Object.fromEntries(
      LEARNING_TARGETS.map((target) => [
        target,
        compareCanonicalContexts(observedContext, referenceContext, target),
      ]),
    ) as Record<LearningTarget, ContextComparison>;

    sharedReasons.push(...sharedBlocking, ...fuelInvalidReasonBlocking);

    const reported: RecordQualityAssessment["reported"] = {
      complete: reportedComplete,
      pitLap: reportedPitLap,
      driverChanged: reportedDriverChanged,
      resetOrTow,
      kind,
      lapNumber: reportedLapNumber,
      invalidReasons: reportedInvalidReasons,
      invalidReasonsStatus: invalidReasonsRead.status,
      gap: reportedGap,
    };

    const targets = buildTargets(
      source,
      reported,
      coverage,
      fuel,
      wear,
      contexts,
      sharedBlocking,
      lapBlocking,
      fuelInvalidReasonBlocking,
      observedSessionId,
      segmentId,
    );

    return {
      schemaVersion: QUALITY_SCHEMA_VERSION,
      policyVersion: QUALITY_POLICY_VERSION,
      source: { ...source, observedSessionId, deliveredSessionId, segmentId },
      reported,
      coverage,
      fuel,
      wear,
      reasons: sortedUnique(sharedReasons),
      targets,
    };
  } catch {
    return null;
  }
}
