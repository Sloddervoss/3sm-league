/** Pure T12 qualification. Adapter facts are NOT a wire contract or historical coverage. */
import {
  bindObservedContextToObservation, buildCanonicalContext, compareCanonicalContexts,
  isInstant, parseSourceRecordEnvelope,
  type CanonicalContext, type SourceRecordEnvelope,
} from "./context";
import { assessRecordQuality, QUALITY_MAX_WINDOW_FUTURE_SKEW_SECONDS } from "./quality";

export const PIT_SEGMENT_VERSION = "pitwall-learning-pit-segments-v1" as const;
export const PIT_SEGMENT_BATCH_LIMIT = 100;
type Row = Record<string, unknown>;
const object = (v: unknown): Row | null => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Row : null;
const id = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 128 && v.trim().length > 0 && [...v].every(c => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127);
const reasons = (v: string[]) => [...new Set(v)].sort();
// Object key order is not evidence of a conflicting revision or retry.
const signature = (v: unknown): string => JSON.stringify(v, (_key, value) => {
  const row = object(value);
  return row ? Object.fromEntries(Object.keys(row).sort().map(k => [k, row[k]])) : value;
});

/** Parse ONLY the whole ISO second, then add the exact .NET/PG fraction. */
function ticks(v: unknown): bigint | null {
  if (!isInstant(v)) return null;
  const match = /^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(v)!;
  return BigInt(Date.parse(match[1] + match[3])) * 10000n + BigInt((match[2] ?? "").padEnd(7, "0"));
}
function duration(a: unknown, b: unknown): number | null {
  const start = ticks(a), end = ticks(b);
  return start === null || end === null || end < start ? null : Number(end - start) / 1e7;
}
function before(a: unknown, b: unknown): boolean {
  const x = ticks(a), y = ticks(b);
  return x !== null && y !== null && x <= y;
}

export interface PitSegmentAnchors {
  basis: "distance_metres" | "sector_boundary";
  layoutId: string;
  originId: string;
  orientation: "forward";
  lapWrap: 0 | 1;
  start: number;
  end: number;
}
export interface PitSpanFacts {
  startAt: string;
  endAt: string;
  anchors: PitSegmentAnchors | null;
  flags: { damage: boolean | null; tow: boolean | null; reset: boolean | null; gap: boolean | null };
  physicalCarId: string | null;
  physicalSessionId: string | null;
  evidence: { source: SourceRecordEnvelope; payload: unknown; contextEvidence: unknown } | null;
  /** Verified availability of these exact reference facts/revision, not receipt alone. */
  knownAt?: string | null;
  /** Reference only: verified ordinary on-track traversal, not merely no pit flag. */
  normalTrack?: boolean | null;
}
export interface PitSegmentInput {
  asOf: string;
  predictorCutoff: string;
  /** Whole seconds, at most one year; no implicit wall clock. */
  maxReferenceAgeSeconds: number;
  pitEntryAt: string | null;
  pitExitAt: string | null;
  outcome: PitSpanFacts | null;
  reference: PitSpanFacts | null;
  services?: unknown;
}

export interface PitSegmentAssessment {
  version: typeof PIT_SEGMENT_VERSION;
  timing: { asOf: string; predictorCutoff: string; pitEntryAt: string | null; pitExitAt: string | null;
    outcomeStartAt: string | null; outcomeEndAt: string | null; referenceStartAt: string | null; referenceEndAt: string | null; referenceKnownAt: string | null };
  anchors: { outcome: PitSegmentAnchors | null; reference: PitSegmentAnchors | null };
  grossPitLaneSeconds: number | null;
  segmentSeconds: number | null;
  normalSeconds: number | null;
  netDeltaSeconds: number | null;
  pitLossLabelEligible: boolean;
  predictorReferenceEligible: boolean;
  serviceUnionSeconds: number | null;
  serviceCoverage: "complete" | "partial" | "unknown";
  serviceLabelEligible: boolean;
  predictedServiceSeconds: number | null;
  reasons: string[];
  predictorReasons: string[];
  serviceReasons: string[];
  provenance: SourceRecordEnvelope[];
}

interface QualifiedSpan {
  row: Row;
  context: CanonicalContext | null;
  source: SourceRecordEnvelope | null;
  seconds: number | null;
  reasons: string[];
}
function span(value: unknown, asOf: unknown): QualifiedSpan {
  const row = object(value) ?? {};
  const evidence = object(row.evidence) ?? {};
  const source = parseSourceRecordEnvelope(evidence.source);
  const payload = object(evidence.payload);
  const context = buildCanonicalContext(evidence.contextEvidence);
  const binding = source && payload ? bindObservedContextToObservation(context, {
    source, observedSessionId: id(payload.observed_session_id) ? payload.observed_session_id : null,
    segmentId: id(payload.segment_id) ? payload.segment_id : null,
  }) : null;
  const r: string[] = [];
  const seconds = duration(row.startAt, row.endAt);
  if (seconds === null) r.push("span_time_invalid_or_missing");
  else if (seconds === 0) r.push("span_zero");
  if (!before(row.endAt, asOf)) r.push("span_after_as_of");
  if (!source || !payload) r.push("source_evidence_missing");
  else {
    if (!before(source.sourceReceivedAt, asOf)) r.push("source_after_as_of");
    if (!before(source.observedAt, asOf)) r.push("source_observation_after_as_of");
    if (!id(payload.observed_session_id) || !id(payload.segment_id)) r.push("source_continuity_unknown");
    r.push(...(binding?.reasons ?? []));
    // T10's pit_loss target intentionally has no stop label. Reuse its source
    // diagnostics, not its unavailable label, nor unrelated fuel/wear gates.
    const quality = assessRecordQuality({ source, payload, annotations: { resetOrTow: object(row.flags)?.reset } }, {
      observedContext: binding?.context ?? null,
    });
    if (!quality) r.push("source_quality_invalid");
    else {
      if (quality.reported.invalidReasonsStatus === "invalid" || quality.reported.invalidReasons.length) r.push("source_invalid_reasons");
      if (quality.reported.gap.status === "invalid" || quality.reported.gap.exceedsPolicy === true) r.push("source_gap");
      if (quality.reported.driverChanged.value === true || quality.reported.driverChanged.status === "invalid") r.push("source_driver_handoff");
      if (quality.reported.pitLap.status === "invalid") r.push("source_pit_flag_invalid");
      if (source.sourceKind === "lap_summary" && quality.coverage.status !== "certified") r.push("source_coverage_unqualified");
      if (source.sourceKind === "lap_summary" && [payload.started_at, payload.ended_at].some(v => {
        const time = ticks(v);
        return time !== null && time > ticks(source.sourceReceivedAt)! + BigInt(QUALITY_MAX_WINDOW_FUTURE_SKEW_SECONDS) * 10000000n;
      })) r.push("source_window_future");
    }
  }
  const flags = object(row.flags) ?? {};
  for (const key of ["damage", "tow", "reset", "gap"] as const) {
    if (flags[key] === true) r.push(`${key}_observed`);
    else if (flags[key] !== false) r.push(`${key}_unknown`);
  }
  if (!id(row.physicalCarId) || !id(row.physicalSessionId)) r.push("physical_identity_unknown");
  return { row, context: binding?.bound ? binding.context : null, source, seconds, reasons: r };
}

/** Absolute locations in one explicitly identified surveyed basis, not display labels. */
function anchor(value: unknown): PitSegmentAnchors | null {
  const a = object(value);
  if (!a || !["distance_metres", "sector_boundary"].includes(a.basis as string) ||
      !id(a.originId) || !id(a.layoutId) || a.orientation !== "forward" ||
      !Number.isSafeInteger(a.lapWrap) || (a.lapWrap as number) < 0 || (a.lapWrap as number) > 1 ||
      typeof a.start !== "number" || !Number.isFinite(a.start) || a.start < 0 ||
      typeof a.end !== "number" || !Number.isFinite(a.end) || a.end < 0) return null;
  if (a.basis === "sector_boundary" && (!Number.isSafeInteger(a.start) || !Number.isSafeInteger(a.end))) return null;
  if (a.lapWrap === 0 ? a.end <= a.start : a.end > a.start) return null;
  return { basis: a.basis as PitSegmentAnchors["basis"], originId: a.originId, layoutId: a.layoutId,
    orientation: "forward", lapWrap: a.lapWrap as 0 | 1, start: a.start, end: a.end };
}

function services(value: unknown, start: unknown, end: unknown, clean: boolean, session: unknown, layout: unknown) {
  const row = object(value) ?? {};
  const r: string[] = [];
  const intervals = row.intervals;
  if (!clean) r.push("service_source_unqualified");
  let union: number | null = null;
  let complete = false;
  if (Array.isArray(intervals) && intervals.length <= 32) {
    const valid: [bigint, bigint][] = [];
    let invalid = false;
    for (const item of intervals) {
      const i = object(item);
      const a = ticks(i?.startAt), b = ticks(i?.endAt);
      if (!i || i.performed !== true || !id(i.component) || a === null || b === null || b < a ||
          !before(start, i.startAt) || !before(i.endAt, end)) { invalid = true; continue; }
      valid.push([a, b]);
      if (["repair", "tow"].includes(i.component)) r.push("nonstandard_service");
      if (!["fuel", "tyres", "repair", "tow", "stationary"].includes(i.component)) {
        invalid = true; r.push("service_component_unknown");
      }
    }
    if (invalid) r.push("service_interval_invalid_or_unperformed");
    if (valid.length || (intervals.length === 0 && row.complete === true)) {
      valid.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
      let total = 0n, right: bigint | null = null;
      for (const [a, b] of valid) {
        const left = right === null || a > right ? a : right;
        if (b > left) total += b - left;
        if (right === null || b > right) right = b;
      }
      union = Number(total) / 1e7;
      complete = row.complete === true && !invalid;
    }
  } else r.push("service_intervals_missing_or_invalid");
  if (!complete) r.push("service_coverage_incomplete");
  const rules = object(row.ruleset);
  let predicted: number | null = null;
  // Prediction composition is deliberately separate from measured interval union.
  const components = Array.isArray(row.components) && row.components.length <= 16 ? row.components.map(object) : [];
  if (rules?.verified === true && id(rules.id) && id(session) && id(layout) && rules.physicalSessionId === session && rules.layoutId === layout &&
      ["parallel", "sequential"].includes(rules.mode as string) && components.length > 0 &&
      components.every(x => x && ["fuel", "tyres"].includes(x.component as string) && typeof x.seconds === "number" && Number.isFinite(x.seconds) && x.seconds >= 0) &&
      new Set(components.map(x => x!.component)).size === components.length && row.componentsComplete === true) {
    const values = components.map(x => x!.seconds as number);
    predicted = rules.mode === "parallel" ? Math.max(...values) : values.reduce((a, b) => a + b, 0);
    if (!Number.isFinite(predicted)) { predicted = null; r.push("service_composition_overflow"); }
  } else r.push("service_ruleset_or_components_unknown");
  return { union, coverage: complete ? "complete" as const : union === null ? "unknown" as const : "partial" as const,
    eligible: clean && complete && !r.includes("nonstandard_service") && predicted !== null, predicted, reasons: reasons(r) };
}

/**
 * Trusted adapter input: outcome/reference spans, source-bound contextEvidence,
 * physical identities, surveyed anchors and explicit continuity flags. All facts
 * are optional: their absence blocks labels, never fabricates evidence.
 */
export function assessPitSegment(input: unknown): PitSegmentAssessment | null {
  const row = object(input);
  if (!row || !isInstant(row.asOf) || !isInstant(row.predictorCutoff) || !before(row.predictorCutoff, row.asOf)) return null;
  const outcome = span(row.outcome, row.asOf), reference = span(row.reference, row.asOf);
  const r = [...outcome.reasons, ...reference.reasons.map(x => `reference_${x}`)];
  if (reference.row.normalTrack !== true || object(object(reference.row.evidence)?.payload)?.pit_lap === true) r.push("reference_normal_track_unproven");
  const gross = before(row.pitExitAt, row.asOf) ? duration(row.pitEntryAt, row.pitExitAt) : null;
  if (gross === null) r.push("pit_entry_exit_incomplete_or_invalid");
  else if (gross === 0) r.push("pitlane_zero");
  if (!before(outcome.row.startAt, row.pitEntryAt) || !before(row.pitExitAt, outcome.row.endAt)) r.push("pit_outside_segment");
  r.push(...compareCanonicalContexts(outcome.context, reference.context, "pit_loss").blockingReasons);
  if (outcome.row.physicalCarId !== reference.row.physicalCarId || outcome.row.physicalSessionId !== reference.row.physicalSessionId) r.push("reference_physical_identity_mismatch");
  if (!outcome.context?.source.observedSessionId || outcome.context.source.observedSessionId !== reference.context?.source.observedSessionId) r.push("reference_observed_session_mismatch");
  const a = anchor(outcome.row.anchors), b = anchor(reference.row.anchors);
  if (!a || !b) r.push("anchors_unknown_or_ambiguous");
  else {
    if (["basis", "originId", "layoutId", "orientation", "lapWrap", "start", "end"].some(k => a[k] !== b[k])) r.push("anchor_locations_mismatch");
    if (a.layoutId !== outcome.context?.layout.value || b.layoutId !== reference.context?.layout.value) r.push("anchor_layout_mismatch");
  }
  const net = r.length === 0 && outcome.seconds !== null && reference.seconds !== null
    ? Number((ticks(outcome.row.endAt)! - ticks(outcome.row.startAt)!) - (ticks(reference.row.endAt)! - ticks(reference.row.startAt)!)) / 1e7 : null;
  const p: string[] = [];
  if (!before(row.predictorCutoff, outcome.row.startAt)) p.push("cutoff_after_outcome_start");
  if (!before(reference.row.endAt, row.predictorCutoff)) p.push("reference_after_cutoff");
  if (!before(reference.row.knownAt, row.predictorCutoff) || !before(reference.row.endAt, reference.row.knownAt) || !before(reference.source?.observedAt, reference.row.knownAt)) p.push("reference_known_at_unproven");
  if (!before(reference.source?.sourceReceivedAt, row.predictorCutoff)) p.push("reference_revision_after_cutoff");
  const referenceEnd = ticks(reference.row.endAt), cutoff = ticks(row.predictorCutoff)!;
  if (typeof row.maxReferenceAgeSeconds !== "number" || !Number.isSafeInteger(row.maxReferenceAgeSeconds) || row.maxReferenceAgeSeconds < 0 || row.maxReferenceAgeSeconds > 31536000) p.push("reference_age_policy_invalid");
  else if (referenceEnd !== null && cutoff - referenceEnd > BigInt(row.maxReferenceAgeSeconds) * 10000000n) p.push("reference_stale");
  if (net === null) p.push("reference_unqualified");
  const service = services(row.services, row.pitEntryAt, row.pitExitAt,
    outcome.reasons.length === 0 && outcome.context !== null && compareCanonicalContexts(outcome.context, outcome.context, "pit_loss").contextMatch && gross !== null && gross > 0 &&
      before(outcome.row.startAt, row.pitEntryAt) && before(row.pitExitAt, outcome.row.endAt),
    outcome.row.physicalSessionId, outcome.context?.layout.value);
  if (service.reasons.includes("nonstandard_service")) r.push("nonstandard_service_not_pit_loss_label");
  if (net !== null && net < 0) r.push("negative_delta_not_pit_loss_label");
  const instant = (v: unknown) => isInstant(v) ? v : null;
  return { version: PIT_SEGMENT_VERSION,
    timing: { asOf: row.asOf, predictorCutoff: row.predictorCutoff, pitEntryAt: instant(row.pitEntryAt), pitExitAt: instant(row.pitExitAt),
      outcomeStartAt: instant(outcome.row.startAt), outcomeEndAt: instant(outcome.row.endAt), referenceStartAt: instant(reference.row.startAt), referenceEndAt: instant(reference.row.endAt), referenceKnownAt: instant(reference.row.knownAt) },
    anchors: { outcome: a, reference: b }, grossPitLaneSeconds: gross, segmentSeconds: outcome.seconds,
    normalSeconds: reference.seconds, netDeltaSeconds: net, pitLossLabelEligible: net !== null && net >= 0 && !service.reasons.includes("nonstandard_service"),
    predictorReferenceEligible: p.length === 0, serviceUnionSeconds: service.union, serviceCoverage: service.coverage,
    serviceLabelEligible: service.eligible, predictedServiceSeconds: service.predicted,
    reasons: reasons(r), predictorReasons: reasons(p), serviceReasons: service.reasons,
    provenance: [outcome.source, reference.source].filter((x): x is SourceRecordEnvelope => x !== null) };
}

/** Filter receipt first, then dedupe/correct same outcome UID; never create extra stops. */
export function derivePitSegments(input: unknown): PitSegmentAssessment[] | null {
  const batch = object(input);
  if (!batch || !isInstant(batch.asOf) || !Array.isArray(batch.segments) || batch.segments.length > PIT_SEGMENT_BATCH_LIMIT) return null;
  const groups = new Map<string, Row[]>();
  for (const raw of batch.segments) {
    const row = object(raw), outcome = object(row?.outcome), evidence = object(outcome?.evidence);
    const source = parseSourceRecordEnvelope(evidence?.source);
    if (!row || !source || !before(source.sourceReceivedAt, batch.asOf)) continue;
    const key = JSON.stringify([source.sourceKind, source.deviceId, source.sourceUid]);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).flatMap(([, rows]) => {
    const source = (r: Row) => parseSourceRecordEnvelope(object(object(r.outcome)?.evidence)?.source)!;
    const revision = Math.max(...rows.map(r => source(r).recordRevision));
    let latest = rows.filter(r => source(r).recordRevision === revision);
    const refSource = (r: Row) => parseSourceRecordEnvelope(object(object(r.reference)?.evidence)?.source);
    const available = latest.filter(r => !refSource(r) || before(refSource(r)!.sourceReceivedAt, batch.asOf));
    if (available.length) latest = available;
    const referenceKeys = new Set(latest.map(r => {
      const s = refSource(r); return s ? JSON.stringify([s.sourceKind, s.deviceId, s.sourceUid]) : null;
    }));
    if (referenceKeys.size === 1 && refSource(latest[0])) {
      const referenceRevision = Math.max(...latest.map(r => refSource(r)!.recordRevision));
      latest = latest.filter(r => refSource(r)!.recordRevision === referenceRevision);
    }
    const variants = [...new Set(latest.map(signature))].sort();
    const result = assessPitSegment({ ...JSON.parse(variants[0]), asOf: batch.asOf });
    if (!result) return [];
    // Adapter facts that disagree for the SAME revision are conflicts too.
    if (variants.length > 1) {
      result.netDeltaSeconds = null; result.pitLossLabelEligible = false;
      result.predictorReferenceEligible = false; result.serviceLabelEligible = false;
      result.reasons = reasons([...result.reasons, "revision_or_adapter_conflict"]);
    }
    return [result];
  });
}

export interface LegacyPitStopDiagnostic {
  table: "endurance_pit_stops";
  identifiers: { id: unknown; event_id: unknown; team_id: unknown; race_run_id: unknown; device_id: unknown; session_id: unknown };
  pitEntryAt: string | null;
  pitExitAt: string | null;
  grossPitLaneSeconds: number | null;
  netDeltaSeconds: null;
  reasons: string[];
}

/** Real legacy columns. No manufactured P1 sourceKind/revision/hash/context. */
export function describeLegacyPitStop(input: unknown): LegacyPitStopDiagnostic | null {
  const row = object(input);
  if (!row) return null;
  const measured = typeof row.pit_lane_seconds === "number" && Number.isFinite(row.pit_lane_seconds) && row.pit_lane_seconds >= 0 ? row.pit_lane_seconds : null;
  const elapsed = duration(row.pit_entry_at, row.pit_exit_at);
  return { table: "endurance_pit_stops", identifiers: { id: row.id ?? null, event_id: row.event_id ?? null, team_id: row.team_id ?? null, race_run_id: row.race_run_id ?? null, device_id: row.device_id ?? null, session_id: row.session_id ?? null },
    pitEntryAt: isInstant(row.pit_entry_at) ? row.pit_entry_at : null, pitExitAt: isInstant(row.pit_exit_at) ? row.pit_exit_at : null,
    grossPitLaneSeconds: elapsed ?? measured, netDeltaSeconds: null,
    reasons: ["legacy_revision_hash_anchors_unknown", ...(elapsed === null ? ["legacy_entry_exit_incomplete_or_invalid"] : []), ...(elapsed !== null && measured !== null && Math.abs(elapsed - measured) > 0.001 ? ["legacy_duration_disagrees"] : [])] };
}

export interface PairedPitEdges {
  entry: Row | null;
  exit: Row | null;
  grossPitLaneSeconds: number | null;
  reasons: string[];
}

/** Local adapter input, NOT DB columns: {asOf, events:[{row, availableAt, continuity}]}. */
export function pairPitTelemetryEvents(input: unknown): PairedPitEdges[] | null {
  const batch = object(input);
  if (!batch || !isInstant(batch.asOf) || !Array.isArray(batch.events) || batch.events.length > PIT_SEGMENT_BATCH_LIMIT) return null;
  const groups = new Map<string, Row[]>();
  for (const value of batch.events) {
    const item = object(value), row = object(item?.row);
    if (!item || !isInstant(item.availableAt)) return null;
    if (!before(item.availableAt, batch.asOf)) continue;
    if (!row) return null;
    // An available but unorderable event is not a silently skipped barrier.
    if (!isInstant(row.captured_at)) return null;
    if (!before(row.captured_at, batch.asOf)) continue;
    const keys = [row.event_id, row.team_id, row.race_run_id, row.device_id, row.session_id];
    const key = keys.every(id) ? JSON.stringify(["bound", keys]) : JSON.stringify(["unbound", groups.size]);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const result: PairedPitEdges[] = [];
  const orphan = (row: Row, reason: string) => {
    if (row.event_type === "pit_entry" || row.event_type === "pit_exit") result.push({
      entry: row.event_type === "pit_entry" ? row : null, exit: row.event_type === "pit_exit" ? row : null,
      grossPitLaneSeconds: null, reasons: [reason],
    });
  };
  for (const [, items] of [...groups].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const sorted = items.sort((a, b) => {
      const x = ticks(object(a.row)?.captured_at)!, y = ticks(object(b.row)?.captured_at)!;
      const sa = signature(a), sb = signature(b);
      return x < y ? -1 : x > y ? 1 : sa < sb ? -1 : sa > sb ? 1 : 0;
    });
    const seen = new Map<string, string>();
    const conflicts = new Set<string>();
    const identity = (row: Row) => JSON.stringify([row.event_key, row.sequence]);
    for (const item of sorted) {
      const row = object(item.row)!;
      const key = identity(row), content = signature(item);
      if (seen.has(key) && seen.get(key) !== content) conflicts.add(key);
      seen.set(key, content);
    }
    let open: { row: Row; link: string } | null = null;
    let lastLap: number | null = null;
    const emitted = new Set<string>();
    for (const item of sorted) {
      const row = object(item.row)!;
      const key = identity(row);
      if (emitted.has(key)) continue;
      emitted.add(key);
      const c = object(item.continuity) ?? {}, f = object(c.flags) ?? {};
      const dimensions = [c.ownerUserId, c.observedSessionId, c.layoutId, c.physicalCarId, c.physicalSessionId, c.continuityId];
      const lap = typeof row.completed_laps === "number" && Number.isSafeInteger(row.completed_laps) && row.completed_laps >= 0 ? row.completed_laps : null;
      const lapReset = lap !== null && lastLap !== null && lap < lastLap;
      lastLap = lap;
      const qualified = lap !== null && !lapReset && [row.event_id, row.team_id, row.race_run_id, row.device_id, row.session_id, row.event_key].every(id) &&
        Number.isSafeInteger(row.sequence) && dimensions.every(id) &&
        ["damage", "tow", "reset", "gap"].every(k => f[k] === false) && !conflicts.has(key);
      const link = JSON.stringify(dimensions);
      if (!qualified || (open && open.link !== link)) {
        if (open) orphan(open.row, "continuity_broken");
        open = null;
        if (!qualified) { orphan(row, "continuity_unknown_or_conflict"); continue; }
      }
      if (row.event_type === "pit_entry" && row.in_pit_lane === true) {
        if (open) orphan(open.row, "entry_without_exit");
        open = { row, link };
      } else if (row.event_type === "pit_exit" && row.in_pit_lane === false) {
        if (!open) orphan(row, "exit_without_entry");
        else {
          const gross = duration(open.row.captured_at, row.captured_at);
          result.push({ entry: open.row, exit: row, grossPitLaneSeconds: gross,
            reasons: gross === 0 ? ["pitlane_zero"] : gross === null ? ["pitlane_time_invalid"] : [] });
        }
        open = null;
      } else if (row.event_type === "pit_entry" || row.event_type === "pit_exit") {
        if (open) orphan(open.row, "continuity_broken");
        open = null; orphan(row, "edge_flag_invalid");
      }
    }
    if (open) orphan(open.row, "entry_without_exit");
  }
  return result;
}
