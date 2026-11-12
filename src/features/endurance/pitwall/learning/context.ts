/**
 * Canonieke observatiecontext voor de pitwall-learninglaag (P2/T09).
 *
 * Deze module is puur: geen React, netwerk, database, klok of mutatie. De
 * adapter levert een compacte bronrevisie plus eventueel een reeds
 * gecontroleerde contextclaim aan; deze module valideert vorm en binding en
 * maakt onbekend expliciet. Zij authenticeert niets en kent geen historie toe
 * die niet aantoonbaar aan dezelfde bronrevisie gebonden is.
 *
 * Drie identiteitsdomeinen blijven gescheiden:
 * - owner_user_id = account
 * - driver = simrijder
 * - device = afleverend apparaat
 *
 * `observed_session_id` (client/SDK) en `delivered_session_id` (transport)
 * worden nooit met elkaar vergeleken. Ongelijkheid bewijst geen late levering.
 */

import type { LearningTarget } from "./contracts";

export const CONTEXT_SCHEMA_VERSION = "pitwall-learning-context-v1" as const;
export const CONTEXT_POLICY_VERSION = "pitwall-learning-context-policy-v1" as const;

export const CONTEXT_DIMENSIONS = [
  "owner",
  "driver",
  "device",
  "car",
  "track",
  "layout",
  "compound",
  "regime",
] as const;
export type ContextDimensionName = (typeof CONTEXT_DIMENSIONS)[number];

export type ContextDimensionStatus = "known" | "unknown";
export type ContextMatchStatus = "match" | "mismatch" | "unknown";
export type ContextProvenance = "inline_observed" | "verified_historical_anchor";
export type ContextRegime = "dry" | "wet";
export type ContextSourceKind = "measurement_event" | "lap_summary";

export interface SourceRecordEnvelope {
  readonly sourceKind: ContextSourceKind;
  readonly deviceId: string;
  readonly sourceUid: string;
  readonly recordRevision: number;
  readonly contentHash: string;
  /** Onbewerkte, gezoneerde ISO-instant of null. Wordt nooit genormaliseerd. */
  readonly observedAt: string | null;
  readonly sourceReceivedAt: string;
}

export interface ContextDimension<T> {
  readonly status: ContextDimensionStatus;
  readonly value: T | null;
  readonly provenance: ContextProvenance | null;
  readonly reasons: readonly string[];
}

export interface CanonicalContextSource extends SourceRecordEnvelope {
  readonly observedSessionId: string | null;
  readonly deliveredSessionId: string | null;
  readonly segmentId: string | null;
}

export interface CanonicalContext {
  readonly schemaVersion: typeof CONTEXT_SCHEMA_VERSION;
  readonly policyVersion: typeof CONTEXT_POLICY_VERSION;
  readonly source: CanonicalContextSource;
  readonly identity: {
    readonly owner: ContextDimension<string>;
    readonly driver: ContextDimension<string>;
    readonly device: ContextDimension<string>;
  };
  readonly car: ContextDimension<string>;
  readonly track: ContextDimension<string>;
  readonly layout: ContextDimension<string>;
  readonly compound: ContextDimension<number>;
  readonly regime: ContextDimension<ContextRegime>;
  /** Alleen administratief bewijs op ontvangstmoment, nooit observatie-eigendom. */
  readonly ownerAtReceipt: {
    readonly userId: string | null;
    readonly basis: "at_receipt_only" | "none";
  };
  readonly contextStatus: "complete" | "partial" | "unknown";
  readonly reasons: readonly string[];
}

export interface ContextDimensionComparison {
  readonly status: ContextMatchStatus;
  /** Null bij match; anders een stabiele redencode. */
  readonly reason: string | null;
}

export interface ContextComparison {
  readonly target: LearningTarget;
  readonly dimensions: Readonly<Record<ContextDimensionName, ContextDimensionComparison>>;
  readonly blockingReasons: readonly string[];
  readonly warningReasons: readonly string[];
  /**
   * Alleen "alle blokkerende dimensies zijn bewezen gelijk". Dit is geen
   * privacytoestemming, geen holdoutbewijs en geen modeleigenschap.
   */
  readonly contextMatch: boolean;
}

export interface ContextRequirement {
  readonly dimension: ContextDimensionName;
  readonly severity: "blocking" | "warning";
}

/**
 * Targetgerichte dimensie-eisen. Een onbekende waarde matcht nooit. Fuel hoeft
 * niet op compound of nat/droog te wachten; tyre_wear doet dat wel. Dit is een
 * kwalificatie-eis, geen pooling- of fittingbeleid.
 */
export const CONTEXT_TARGET_REQUIREMENTS: Readonly<
  Record<LearningTarget, readonly ContextRequirement[]>
> = {
  fuel: [
    { dimension: "owner", severity: "blocking" },
    { dimension: "driver", severity: "blocking" },
    { dimension: "device", severity: "blocking" },
    { dimension: "car", severity: "blocking" },
    { dimension: "track", severity: "blocking" },
    { dimension: "layout", severity: "blocking" },
    { dimension: "compound", severity: "warning" },
    { dimension: "regime", severity: "warning" },
  ],
  pit_loss: [
    { dimension: "owner", severity: "blocking" },
    { dimension: "driver", severity: "blocking" },
    { dimension: "device", severity: "blocking" },
    { dimension: "car", severity: "blocking" },
    { dimension: "track", severity: "blocking" },
    { dimension: "layout", severity: "blocking" },
    { dimension: "compound", severity: "warning" },
    { dimension: "regime", severity: "warning" },
  ],
  tyre_wear: [
    { dimension: "owner", severity: "blocking" },
    { dimension: "driver", severity: "blocking" },
    { dimension: "device", severity: "blocking" },
    { dimension: "car", severity: "blocking" },
    { dimension: "track", severity: "blocking" },
    { dimension: "layout", severity: "blocking" },
    { dimension: "compound", severity: "blocking" },
    { dimension: "regime", severity: "blocking" },
  ],
  tyre_pace: [
    { dimension: "owner", severity: "blocking" },
    { dimension: "driver", severity: "blocking" },
    { dimension: "device", severity: "blocking" },
    { dimension: "car", severity: "blocking" },
    { dimension: "track", severity: "blocking" },
    { dimension: "layout", severity: "blocking" },
    { dimension: "compound", severity: "blocking" },
    { dimension: "regime", severity: "blocking" },
  ],
};

const MAX_IDENTIFIER_LENGTH = 128;
const MAX_DEVICE_LENGTH = 120;
const MIN_RECORD_REVISION = 1;
const MAX_RECORD_REVISION = 100000;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[0-9a-f]{32}$/;
/**
 * Gezoneerde ISO-instant. 1–7 fractiecijfers worden geaccepteerd en ruw
 * bewaard: PostgreSQL levert vaak 6, .NET-round-trip 7. Dat is een
 * invoerafspraak, geen bewijs dat bestaande lezers al uitwisselbaar zijn.
 * Datum-zonder-tijd en tijd-zonder-zone worden nooit aangevuld.
 */
const INSTANT_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,7}))?(Z|[+-]\d{2}:\d{2})$/;

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

function isIdentifier(value: unknown, maxLength = MAX_IDENTIFIER_LENGTH): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value.trim().length > 0 &&
    !hasControlCharacters(value)
  );
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function isInstant(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 64) return false;
  const match = INSTANT_PATTERN.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (day < 1 || day > daysInMonth) return false;

  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (hour > 23 || minute > 59 || second > 59) return false;

  if (match[8] !== "Z") {
    const zoneHour = Number(match[8].slice(1, 3));
    const zoneMinute = Number(match[8].slice(4, 6));
    if (zoneHour > 14 || zoneMinute > 59) return false;
    if (zoneHour === 14 && zoneMinute !== 0) return false;
  }

  return Number.isFinite(Date.parse(value));
}

function readOptionalSessionId(
  payload: Record<string, unknown>,
  key: string,
  reasons: string[],
): string | null {
  if (!hasOwn(payload, key)) return null;
  const value = payload[key];
  if (value === null) return null;
  if (!isIdentifier(value)) {
    reasons.push(`${key}_invalid`);
    return null;
  }
  return value;
}

function sortedUnique(reasons: readonly string[]): string[] {
  return [...new Set(reasons)].sort();
}

function known<T>(value: T, provenance: ContextProvenance): ContextDimension<T> {
  return { status: "known", value, provenance, reasons: [] };
}

function unknown<T>(reason: string, provenance: ContextProvenance | null = null): ContextDimension<T> {
  return { status: "unknown", value: null, provenance, reasons: [reason] };
}

interface ParsedClaims {
  readonly provenance: ContextProvenance;
  readonly ownerUserId: string | null;
  readonly driverId: string | null;
  readonly carId: string | null;
  readonly trackId: string | null;
  readonly layoutId: string | null;
  readonly compoundId: number | null;
  readonly regime: ContextRegime | null;
}

interface ClaimParseResult {
  readonly claims: ParsedClaims | null;
  readonly reasons: readonly string[];
}

function claimBindingMatches(
  binding: Record<string, unknown>,
  source: SourceRecordEnvelope,
  observedSessionId: string | null,
): { matches: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (binding.deviceId !== source.deviceId) reasons.push("anchor_device_mismatch");
  if (observedSessionId === null || binding.observedSessionId !== observedSessionId) {
    reasons.push("anchor_session_mismatch");
  }
  if (binding.sourceUid !== source.sourceUid) reasons.push("anchor_source_uid_mismatch");
  if (binding.recordRevision !== source.recordRevision) reasons.push("anchor_revision_mismatch");
  if (binding.contentHash !== source.contentHash) reasons.push("anchor_hash_mismatch");
  if (source.observedAt === null) {
    // null === null bewijst geen waarnemingsmoment; een historisch anker zonder
    // tijd is geen volledige binding.
    reasons.push("anchor_observed_at_missing");
  } else if (binding.observedAt !== source.observedAt) {
    reasons.push("anchor_observed_at_mismatch");
  }
  return { matches: reasons.length === 0, reasons };
}

function parseClaims(
  raw: unknown,
  source: SourceRecordEnvelope,
  observedSessionId: string | null,
): ClaimParseResult {
  if (raw === null || raw === undefined) return { claims: null, reasons: [] };
  if (!isPlainRecord(raw)) return { claims: null, reasons: ["context_claims_invalid"] };

  const provenance = raw.provenance;
  if (provenance !== "inline_observed" && provenance !== "verified_historical_anchor") {
    return { claims: null, reasons: ["anchor_invalid_provenance"] };
  }

  const reasons: string[] = [];
  if (provenance === "verified_historical_anchor") {
    if (!isPlainRecord(raw.binding)) {
      return { claims: null, reasons: ["anchor_binding_missing"] };
    }
    const bound = claimBindingMatches(raw.binding, source, observedSessionId);
    if (!bound.matches) return { claims: null, reasons: bound.reasons };
  }

  const ownerUserId = raw.ownerUserId;
  const driverId = raw.driverId;
  const carId = raw.carId;
  const trackId = raw.trackId;
  const layoutId = raw.layoutId;
  const compoundId = raw.compoundId;
  const regime = raw.regime;

  if (ownerUserId !== undefined && ownerUserId !== null && !isUuid(ownerUserId)) {
    reasons.push("owner_identity_invalid");
  }
  for (const [key, value] of [
    ["driver", driverId],
    ["car", carId],
    ["track", trackId],
    ["layout", layoutId],
  ] as const) {
    if (value !== undefined && value !== null && !isIdentifier(value)) {
      reasons.push(`${key}_identity_invalid`);
    }
  }
  if (
    compoundId !== undefined &&
    compoundId !== null &&
    (typeof compoundId !== "number" ||
      !Number.isSafeInteger(compoundId) ||
      compoundId < 0 ||
      compoundId > 255)
  ) {
    reasons.push("compound_identity_invalid");
  }
  if (regime !== undefined && regime !== null && regime !== "dry" && regime !== "wet") {
    reasons.push("regime_identity_invalid");
  }

  return {
    claims: {
      provenance,
      ownerUserId: ownerUserId === undefined || !isUuid(ownerUserId) ? null : ownerUserId,
      driverId: isIdentifier(driverId) ? driverId : null,
      carId: isIdentifier(carId) ? carId : null,
      trackId: isIdentifier(trackId) ? trackId : null,
      layoutId: isIdentifier(layoutId) ? layoutId : null,
      compoundId:
        typeof compoundId === "number" &&
        Number.isSafeInteger(compoundId) &&
        compoundId >= 0 &&
        compoundId <= 255
          ? compoundId
          : null,
      regime: regime === "dry" || regime === "wet" ? regime : null,
    },
    reasons,
  };
}

/** Leest alleen de bron-envelope; een ongeldige identiteit levert null. */
export function parseSourceRecordEnvelope(input: unknown): SourceRecordEnvelope | null {
  if (!isPlainRecord(input)) return null;

  const sourceKind = input.sourceKind;
  if (sourceKind !== "measurement_event" && sourceKind !== "lap_summary") return null;

  const deviceId = input.deviceId;
  if (!isIdentifier(deviceId, MAX_DEVICE_LENGTH)) return null;

  const sourceUid = input.sourceUid;
  if (!isUuid(sourceUid)) return null;

  const recordRevision = input.recordRevision;
  if (
    typeof recordRevision !== "number" ||
    !Number.isSafeInteger(recordRevision) ||
    recordRevision < MIN_RECORD_REVISION ||
    recordRevision > MAX_RECORD_REVISION
  ) {
    return null;
  }

  const contentHash = input.contentHash;
  if (typeof contentHash !== "string" || !HASH_PATTERN.test(contentHash)) return null;

  if (!hasOwn(input, "observedAt")) return null;
  let observedAt: string | null = null;
  if (input.observedAt !== null) {
    const rawObservedAt = input.observedAt;
    if (!isInstant(rawObservedAt)) return null;
    observedAt = rawObservedAt;
  }

  const sourceReceivedAt = input.sourceReceivedAt;
  if (!isInstant(sourceReceivedAt)) return null;

  return {
    sourceKind,
    deviceId,
    sourceUid,
    recordRevision,
    contentHash,
    observedAt,
    sourceReceivedAt,
  };
}

/**
 * Bouwt een canonieke context uit een bronrevisie en een optionele claim.
 * Onbekende context is een geldige uitkomst; alleen een ongeldige
 * bron-envelope of niet-object payload levert null.
 */
export function buildCanonicalContext(input: unknown): CanonicalContext | null {
  if (!isPlainRecord(input)) return null;
  const source = parseSourceRecordEnvelope(input.source);
  if (source === null) return null;

  const payload = input.payload;
  if (!isPlainRecord(payload)) return null;

  const reasons: string[] = [];
  const observedSessionId = readOptionalSessionId(payload, "observed_session_id", reasons);
  const deliveredSessionId = readOptionalSessionId(payload, "delivered_session_id", reasons);
  const segmentId = readOptionalSessionId(payload, "segment_id", reasons);
  if (observedSessionId === null) reasons.push("observed_session_missing");

  if (hasOwn(input, "currentSnapshot") && input.currentSnapshot !== null) {
    reasons.push("current_snapshot_ignored");
  }

  const parsedClaims = parseClaims(
    hasOwn(input, "claims") ? input.claims : null,
    source,
    observedSessionId,
  );
  reasons.push(...parsedClaims.reasons);
  const claims = parsedClaims.claims;

  let ownerAtReceiptUserId: string | null = null;
  if (hasOwn(input, "ownerAtReceiptUserId") && input.ownerAtReceiptUserId !== null) {
    const receiptOwner = input.ownerAtReceiptUserId;
    if (isUuid(receiptOwner)) ownerAtReceiptUserId = receiptOwner;
    else reasons.push("owner_at_receipt_invalid");
  }

  const owner =
    claims?.ownerUserId != null
      ? known(claims.ownerUserId, claims.provenance)
      : unknown<string>(ownerAtReceiptUserId === null ? "owner_history_unknown" : "owner_at_receipt_only");

  const driverChanged = payload.driver_changed;
  const driverChangeInvalid =
    driverChanged !== undefined && driverChanged !== null && typeof driverChanged !== "boolean";
  const driver =
    driverChanged === true
      ? unknown<string>("driver_handoff_unproven")
      : driverChangeInvalid
        ? unknown<string>("driver_changed_invalid")
        : claims?.driverId != null
          ? known(claims.driverId, claims.provenance)
          : unknown<string>("driver_identity_unknown");

  const device = known(source.deviceId, "inline_observed");
  const car =
    claims?.carId != null ? known(claims.carId, claims.provenance) : unknown<string>("car_unknown");
  const track =
    claims?.trackId != null ? known(claims.trackId, claims.provenance) : unknown<string>("track_unknown");
  const layout =
    claims?.layoutId != null
      ? known(claims.layoutId, claims.provenance)
      : unknown<string>("layout_unknown");
  const compound =
    claims?.compoundId != null
      ? known(claims.compoundId, claims.provenance)
      : unknown<number>("compound_unknown");
  const regime =
    claims?.regime != null
      ? known(claims.regime, claims.provenance)
      : unknown<ContextRegime>("regime_unknown");

  const dimensionStatuses = [
    owner.status,
    driver.status,
    device.status,
    car.status,
    track.status,
    layout.status,
    compound.status,
    regime.status,
  ];
  for (const dimension of [owner, driver, device, car, track, layout, compound, regime]) {
    reasons.push(...dimension.reasons);
  }
  const knownCount = dimensionStatuses.filter((status) => status === "known").length;
  const contextStatus =
    knownCount === dimensionStatuses.length ? "complete" : knownCount <= 1 ? "unknown" : "partial";

  return {
    schemaVersion: CONTEXT_SCHEMA_VERSION,
    policyVersion: CONTEXT_POLICY_VERSION,
    source: { ...source, observedSessionId, deliveredSessionId, segmentId },
    identity: { owner, driver, device },
    car,
    track,
    layout,
    compound,
    regime,
    ownerAtReceipt: {
      userId: ownerAtReceiptUserId,
      basis: ownerAtReceiptUserId === null ? "none" : "at_receipt_only",
    },
    contextStatus,
    reasons: sortedUnique(reasons),
  };
}

function comparisonValue(
  context: CanonicalContext,
  dimension: ContextDimensionName,
): string | number | null {
  if (dimension === "owner") return context.identity.owner.status === "known" ? context.identity.owner.value : null;
  if (dimension === "driver") return context.identity.driver.status === "known" ? context.identity.driver.value : null;
  if (dimension === "device") return context.identity.device.status === "known" ? context.identity.device.value : null;
  if (dimension === "car") return context.car.status === "known" ? context.car.value : null;
  if (dimension === "track") return context.track.status === "known" ? context.track.value : null;
  if (dimension === "layout") return context.layout.status === "known" ? context.layout.value : null;
  if (dimension === "compound") return context.compound.status === "known" ? context.compound.value : null;
  return context.regime.status === "known" ? context.regime.value : null;
}

function compareDimension(
  observed: CanonicalContext | null,
  reference: CanonicalContext | null,
  dimension: ContextDimensionName,
): ContextDimensionComparison {
  if (observed === null || reference === null) {
    return { status: "unknown", reason: `context_${dimension}_unknown` };
  }
  const left = comparisonValue(observed, dimension);
  const right = comparisonValue(reference, dimension);
  // null == null is geen match: onbekend blijft onbekend.
  if (left === null || right === null) {
    return { status: "unknown", reason: `context_${dimension}_unknown` };
  }
  return left === right
    ? { status: "match", reason: null }
    : { status: "mismatch", reason: `context_${dimension}_mismatch` };
}

export interface ObservedContextBindingInput {
  readonly source: SourceRecordEnvelope;
  readonly observedSessionId: string | null;
  readonly segmentId: string | null;
}

export interface ObservedContextBinding {
  /** Null betekent: gebruik geen context. Bij een mislukte binding nooit een halve context. */
  readonly context: CanonicalContext | null;
  readonly bound: boolean;
  readonly reasons: readonly string[];
}

/**
 * Bindt een aangeleverde observatiecontext aan precies de invoerobservatie.
 *
 * Een CanonicalContext is een waarde, geen bewijs. Zonder deze controle zou een
 * context van record A een record B kwalificeren zodra hij toevallig op de
 * referentie lijkt. Daarom moeten alle onveranderlijke bronvelden exact gelijk
 * zijn; observed_session_id en segment_id mogen niet tegenspreken wanneer beide
 * kanten ze kennen. De transport-sessie wordt hier nooit vergeleken: dat is een
 * ander domein.
 *
 * `null` is een geldige onbekende context. Een mislukte binding levert
 * `context: null`, `bound: false` en stabiele redenen; de caller moet die
 * redenen als blokkade gebruiken en mag de identiteit niet opnieuw verzinnen.
 */
export function bindObservedContextToObservation(
  observed: CanonicalContext | null,
  observation: ObservedContextBindingInput,
): ObservedContextBinding {
  if (observed === null) return { context: null, bound: true, reasons: [] };
  if (!isPlainRecord(observed) || !isPlainRecord(observed.source)) {
    return { context: null, bound: false, reasons: ["observed_context_invalid"] };
  }

  const context = observed as CanonicalContext;
  const reasons: string[] = [];
  let sourceMismatch = false;
  if (
    context.schemaVersion !== CONTEXT_SCHEMA_VERSION ||
    context.policyVersion !== CONTEXT_POLICY_VERSION
  ) {
    reasons.push("observed_context_version_mismatch");
    sourceMismatch = true;
  }

  const source = observation.source;
  for (const [label, left, right] of [
    ["source_kind", context.source.sourceKind, source.sourceKind],
    ["device", context.source.deviceId, source.deviceId],
    ["source_uid", context.source.sourceUid, source.sourceUid],
    ["revision", context.source.recordRevision, source.recordRevision],
    ["content_hash", context.source.contentHash, source.contentHash],
    ["observed_at", context.source.observedAt, source.observedAt],
    ["source_received_at", context.source.sourceReceivedAt, source.sourceReceivedAt],
  ] as const) {
    if (left !== right) {
      reasons.push(`observed_context_${label}_mismatch`);
      sourceMismatch = true;
    }
  }

  if (context.source.observedSessionId !== observation.observedSessionId) {
    reasons.push("observed_context_session_mismatch");
    sourceMismatch = true;
  }
  if (context.source.segmentId !== observation.segmentId) {
    reasons.push("observed_context_segment_mismatch");
    sourceMismatch = true;
  }

  if (reasons.length > 0) {
    if (sourceMismatch) reasons.push("context_source_mismatch");
    return { context: null, bound: false, reasons: sortedUnique(reasons) };
  }
  return { context, bound: true, reasons: [] };
}

/** Vergelijkt twee contexten per dimensie voor precies één target. */
export function compareCanonicalContexts(
  observed: CanonicalContext | null,
  reference: CanonicalContext | null,
  target: LearningTarget,
): ContextComparison {
  const dimensions = Object.fromEntries(
    CONTEXT_DIMENSIONS.map((dimension) => [dimension, compareDimension(observed, reference, dimension)]),
  ) as Record<ContextDimensionName, ContextDimensionComparison>;

  const blockingReasons: string[] = [];
  const warningReasons: string[] = [];
  for (const requirement of CONTEXT_TARGET_REQUIREMENTS[target]) {
    const comparison = dimensions[requirement.dimension];
    if (comparison.reason === null) continue;
    if (requirement.severity === "blocking") blockingReasons.push(comparison.reason);
    else warningReasons.push(comparison.reason);
  }

  return {
    target,
    dimensions,
    blockingReasons: sortedUnique(blockingReasons),
    warningReasons: sortedUnique(warningReasons),
    contextMatch: blockingReasons.length === 0,
  };
}
