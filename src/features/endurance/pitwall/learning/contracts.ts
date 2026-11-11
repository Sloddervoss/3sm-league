/**
 * Pure contractlaag voor één learningbijdrage.
 *
 * Deze module doet niets anders dan een onbekende payload valideren en
 * normaliseren. Er zit geen database, klok, fetch of modelselectie in. Alles wat
 * niet exact klopt levert `null`: de parser gooit nooit en probeert nooit een
 * ontbrekend veld met een default te redden.
 */

export const LEARNING_TARGETS = ["fuel", "pit_loss", "tyre_wear", "tyre_pace"] as const;
export type LearningTarget = (typeof LEARNING_TARGETS)[number];

export const LEARNING_STATES = ["collecting", "shadow", "active", "blocked"] as const;
export type LearningState = (typeof LEARNING_STATES)[number];

export const TYRE_CORNERS = ["fl", "fr", "rl", "rr"] as const;
export type TyreCorner = (typeof TYRE_CORNERS)[number];

export type LearningUnit = "L/lap" | "s" | "percent_remaining" | "s/lap";

/** Elke target heeft precies één eenheid; een verkeerde eenheid is een fout, geen hint. */
export const LEARNING_UNITS_BY_TARGET: Readonly<Record<LearningTarget, LearningUnit>> = {
  fuel: "L/lap",
  pit_loss: "s",
  tyre_wear: "percent_remaining",
  tyre_pace: "s/lap",
};

/** Bovengrens voor de volledige JSON-payload, inclusief onbekende velden. */
export const MAX_LEARNING_PAYLOAD_BYTES = 8 * 1024;
export const MAX_REASON_CODES = 16;
export const MAX_REASON_CODE_LENGTH = 64;

const MAX_VERSION_LENGTH = 128;
const MAX_TIMESTAMP_LENGTH = 32;
const MAX_FRAME_SEQUENCE_LENGTH = 128;
const MAX_JSON_DEPTH = 8;
const MAX_JSON_NODES = 512;

export interface LearningContributionBase {
  schemaVersion: 1;
  target: LearningTarget;
  state: LearningState;
  modelVersion: string | null;
  featureVersion: string;
  policyVersion: string;
  trainedThrough: string | null;
  sourceFrameSequence: string | null;
  sourceObservedAt: string | null;
  contextMatch: boolean;
  decisive: boolean;
  reasonCodes: string[];
  estimate: number | null;
  lower: number | null;
  upper: number | null;
  unit: LearningUnit;
  independentSessions: number;
  independentSets: number | null;
  /** Alleen tyre_wear draagt een hoek; de andere targets hebben expliciet `null`. */
  corner: TyreCorner | null;
}

export interface FuelLearningContribution extends LearningContributionBase {
  target: "fuel";
  unit: "L/lap";
  corner: null;
}

export interface PitLossLearningContribution extends LearningContributionBase {
  target: "pit_loss";
  unit: "s";
  corner: null;
}

export interface TyreWearLearningContribution extends LearningContributionBase {
  target: "tyre_wear";
  unit: "percent_remaining";
  corner: TyreCorner;
}

export interface TyrePaceLearningContribution extends LearningContributionBase {
  target: "tyre_pace";
  unit: "s/lap";
  corner: null;
}

export type LearningContribution =
  | FuelLearningContribution
  | PitLossLearningContribution
  | TyreWearLearningContribution
  | TyrePaceLearningContribution;

export interface LearningContributionParseOptions {
  /**
   * Modelversies die de caller expliciet als bekend beschouwt. Zonder deze
   * allowlist wordt geen enkele niet-null modelVersion geaccepteerd.
   */
  readonly knownModelVersions?: readonly string[];
}

class InvalidContribution extends Error {}

function fail(): never {
  throw new InvalidContribution("invalid learning contribution");
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function isNonBlankString(value: unknown, maxLength: number): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > maxLength) return false;
  if (value.trim().length === 0) return false;
  // Geen controle- of regelovergangstekens in versies, codes of metadata.
  return !hasControlCharacters(value);
}

function readRequiredString(
  record: Record<string, unknown>,
  key: string,
  maxLength: number,
): string {
  if (!hasOwn(record, key)) fail();
  const value = record[key];
  if (!isNonBlankString(value, maxLength)) fail();
  return value;
}

function readNullableString(
  record: Record<string, unknown>,
  key: string,
  maxLength: number,
): string | null {
  if (!hasOwn(record, key)) return null;
  const value = record[key];
  if (value === null) return null;
  if (!isNonBlankString(value, maxLength)) fail();
  return value;
}

function readRequiredBoolean(record: Record<string, unknown>, key: string): boolean {
  if (!hasOwn(record, key)) fail();
  const value = record[key];
  if (typeof value !== "boolean") fail();
  return value;
}

function readEnum<T extends string>(
  record: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T {
  if (!hasOwn(record, key)) fail();
  const value = record[key];
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) fail();
  return value as T;
}

function readNullableNumber(record: Record<string, unknown>, key: string): number | null {
  if (!hasOwn(record, key)) return null;
  const value = record[key];
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) fail();
  return value;
}

function readCount(record: Record<string, unknown>, key: string): number {
  if (!hasOwn(record, key)) fail();
  const value = record[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function readNullableCount(record: Record<string, unknown>, key: string): number | null {
  if (!hasOwn(record, key)) return null;
  const value = record[key];
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

/**
 * ISO-8601 met verplichte zone zodra er een tijd is. `trainedThrough` mag een
 * datum zonder tijd zijn (vaak daggebrek); `sourceObservedAt` is een werkelijk
 * observatie-instant en eist daarom altijd tijd én expliciete zone. Zonder tijd
 * of zone zou de parser middernacht of een tijdzone moeten verzinnen, en dat is
 * geen observatie.
 */
const ISO_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2}))?$/;

type TimestampShape = "date-or-instant" | "instant";

function isValidTimestamp(value: string, shape: TimestampShape): boolean {
  if (value.length > MAX_TIMESTAMP_LENGTH) return false;
  const match = ISO_TIMESTAMP.exec(value);
  if (!match) return false;

  const hasTime = match[4] !== undefined;
  if (shape === "instant" && !hasTime) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;

  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (day < 1 || day > daysInMonth) return false;

  if (hasTime) {
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = Number(match[6]);
    if (hour > 23 || minute > 59 || second > 59) return false;

    const zone = match[8];
    if (zone !== "Z") {
      const zoneHour = Number(zone.slice(1, 3));
      const zoneMinute = Number(zone.slice(4, 6));
      if (zoneHour > 14 || zoneMinute > 59) return false;
      if (zoneHour === 14 && zoneMinute !== 0) return false;
    }
  }

  return Number.isFinite(Date.parse(value));
}

/** trainedThrough: datum zonder tijd blijft toegestaan. */
function readNullableTrainedThrough(record: Record<string, unknown>): string | null {
  const value = readNullableString(record, "trainedThrough", MAX_TIMESTAMP_LENGTH);
  if (value === null) return null;
  if (!isValidTimestamp(value, "date-or-instant")) fail();
  return value;
}

/** sourceObservedAt: alleen een volledig gezoneerd observatie-instant. */
function readNullableSourceObservedAt(record: Record<string, unknown>): string | null {
  const value = readNullableString(record, "sourceObservedAt", MAX_TIMESTAMP_LENGTH);
  if (value === null) return null;
  if (!isValidTimestamp(value, "instant")) fail();
  return value;
}

function readReasonCodes(record: Record<string, unknown>): string[] {
  if (!hasOwn(record, "reasonCodes")) fail();
  const raw = record.reasonCodes;
  if (!Array.isArray(raw)) fail();
  if (raw.length > MAX_REASON_CODES) fail();

  return raw.map((code) => {
    if (!isNonBlankString(code, MAX_REASON_CODE_LENGTH)) fail();
    return code;
  });
}

function checkTargetRange(
  target: LearningTarget,
  estimate: number | null,
  lower: number | null,
  upper: number | null,
): void {
  if (estimate === null || lower === null || upper === null) return;
  if (lower > estimate || estimate > upper) fail();

  if (target === "fuel" || target === "pit_loss") {
    if (lower < 0) fail();
  }
  if (target === "tyre_wear" && (lower < 0 || upper > 100)) fail();
}

/* ------------------------------------------------------------------ */
/* Begrensde JSON-kopie                                                */
/* ------------------------------------------------------------------ */

type PlainJson = string | number | boolean | null | PlainJson[] | { [key: string]: PlainJson };

const REJECT = Symbol("reject");
const UTF8 = new TextEncoder();

interface SanitizeState {
  bytes: number;
  nodes: number;
}

function utf8Length(value: string): number {
  return UTF8.encode(value).byteLength;
}

function addBytes(state: SanitizeState, amount: number): boolean {
  state.bytes += amount;
  return state.bytes <= MAX_LEARNING_PAYLOAD_BYTES;
}

/**
 * Maakt een eigen, diep gekopieerde JSON-waarde. Accessors, class-instances,
 * undefined, functies, symbolen en BigInt worden geweigerd: de parser leest dus
 * nooit een getter of een `toJSON` van de aanroeper. Tegelijk begrenst deze walk
 * de bytes, diepte en het aantal knopen vóór er iets met de payload gebeurt.
 */
function sanitizeJson(value: unknown, state: SanitizeState, depth: number): PlainJson | typeof REJECT {
  if (state.nodes >= MAX_JSON_NODES) return REJECT;
  state.nodes += 1;

  if (value === null) {
    return addBytes(state, 4) ? null : REJECT;
  }

  if (typeof value === "boolean") {
    return addBytes(state, value ? 4 : 5) ? value : REJECT;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return REJECT;
    return addBytes(state, String(value).length) ? value : REJECT;
  }

  if (typeof value === "string") {
    if (value.length > MAX_LEARNING_PAYLOAD_BYTES) return REJECT;
    const bytes = utf8Length(JSON.stringify(value));
    return addBytes(state, bytes) ? value : REJECT;
  }

  if (typeof value !== "object") return REJECT;
  if (depth >= MAX_JSON_DEPTH) return REJECT;

  if (Array.isArray(value)) {
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (!lengthDescriptor || !("value" in lengthDescriptor)) return REJECT;
    if (typeof lengthDescriptor.value !== "number") return REJECT;
    if (!Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value > MAX_JSON_NODES) {
      return REJECT;
    }

    const length = lengthDescriptor.value;
    if (!addBytes(state, 2)) return REJECT;
    const out: PlainJson[] = [];

    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor)) return REJECT;
      if (index > 0 && !addBytes(state, 1)) return REJECT;

      const item = sanitizeJson(descriptor.value, state, depth + 1);
      if (item === REJECT) return REJECT;
      out.push(item);
    }

    return out;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return REJECT;

  const keys = Object.keys(value);
  if (keys.length > MAX_JSON_NODES) return REJECT;
  if (!addBytes(state, 2)) return REJECT;

  const out: { [key: string]: PlainJson } = Object.create(null);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (key.length > MAX_LEARNING_PAYLOAD_BYTES) return REJECT;
    if (index > 0 && !addBytes(state, 1)) return REJECT;

    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) return REJECT;

    if (!addBytes(state, utf8Length(JSON.stringify(key)) + 1)) return REJECT;
    const item = sanitizeJson(descriptor.value, state, depth + 1);
    if (item === REJECT) return REJECT;
    out[key] = item;
  }

  return out;
}

function sanitizePayload(input: unknown): PlainJson {
  if (input === null || typeof input !== "object" || Array.isArray(input)) fail();
  if (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) {
    fail();
  }

  const state: SanitizeState = { bytes: 0, nodes: 0 };
  const sanitized = sanitizeJson(input, state, 0);
  if (sanitized === REJECT) fail();

  // De walker rekent exact, maar deze tweede grens meet de echte serialisatie.
  if (utf8Length(JSON.stringify(sanitized)) > MAX_LEARNING_PAYLOAD_BYTES) fail();
  return sanitized;
}

function asRecord(value: PlainJson): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail();
  return value as Record<string, unknown>;
}

function parseInternal(input: unknown, options?: LearningContributionParseOptions): LearningContribution {
  const record = asRecord(sanitizePayload(input));

  if (!hasOwn(record, "schemaVersion") || record.schemaVersion !== 1) fail();

  const target = readEnum(record, "target", LEARNING_TARGETS);
  const state = readEnum(record, "state", LEARNING_STATES);

  const unit = readRequiredString(record, "unit", MAX_VERSION_LENGTH);
  if (unit !== LEARNING_UNITS_BY_TARGET[target]) fail();

  const modelVersion = readNullableString(record, "modelVersion", MAX_VERSION_LENGTH);
  const featureVersion = readRequiredString(record, "featureVersion", MAX_VERSION_LENGTH);
  const policyVersion = readRequiredString(record, "policyVersion", MAX_VERSION_LENGTH);
  const trainedThrough = readNullableTrainedThrough(record);
  const sourceFrameSequence = readNullableString(
    record,
    "sourceFrameSequence",
    MAX_FRAME_SEQUENCE_LENGTH,
  );
  const sourceObservedAt = readNullableSourceObservedAt(record);

  const contextMatch = readRequiredBoolean(record, "contextMatch");
  const decisive = readRequiredBoolean(record, "decisive");
  const reasonCodes = readReasonCodes(record);

  const estimate = readNullableNumber(record, "estimate");
  const lower = readNullableNumber(record, "lower");
  const upper = readNullableNumber(record, "upper");
  const estimateParts = [estimate, lower, upper].filter((value) => value !== null).length;
  if (estimateParts !== 0 && estimateParts !== 3) fail();
  checkTargetRange(target, estimate, lower, upper);

  const independentSessions = readCount(record, "independentSessions");
  const independentSets = readNullableCount(record, "independentSets");

  let corner: TyreCorner | null = null;
  if (target === "tyre_wear") {
    if (!hasOwn(record, "corner")) fail();
    const cornerValue = record.corner;
    if (
      typeof cornerValue !== "string" ||
      !(TYRE_CORNERS as readonly string[]).includes(cornerValue)
    ) {
      fail();
    }
    corner = cornerValue as TyreCorner;
  } else if (hasOwn(record, "corner") && record.corner !== null) {
    fail();
  }

  /**
   * Een actieve bijdrage en elke decisive bijdrage moeten een expliciet
   * bekende modelversie, contextMatch=true en bron-/trainedtijd hebben. Zonder
   * allowlist is er geen bekende versie, dus dan is `active` ongeldig.
   */
  if (state === "active" || decisive) {
    if (modelVersion === null) fail();
    if (!contextMatch) fail();
    if (trainedThrough === null) fail();
    if (sourceObservedAt === null) fail();
    if (decisive && estimateParts !== 3) fail();
  }

  // collecting, shadow en blocked zijn per definitie niet decisief.
  if (state !== "active" && decisive) fail();

  if (modelVersion !== null) {
    const configured = options?.knownModelVersions;
    const known = Array.isArray(configured)
      ? new Set(configured.filter((entry): entry is string => typeof entry === "string"))
      : new Set<string>();
    if (!known.has(modelVersion)) fail();
  }

  const shared = {
    schemaVersion: 1 as const,
    state,
    modelVersion,
    featureVersion,
    policyVersion,
    trainedThrough,
    sourceFrameSequence,
    sourceObservedAt,
    contextMatch,
    decisive,
    reasonCodes: [...reasonCodes],
    estimate,
    lower,
    upper,
    independentSessions,
    independentSets,
  };

  switch (target) {
    case "fuel":
      return { ...shared, target, unit: "L/lap", corner: null };
    case "pit_loss":
      return { ...shared, target, unit: "s", corner: null };
    case "tyre_wear":
      return { ...shared, target, unit: "percent_remaining", corner };
    case "tyre_pace":
      return { ...shared, target, unit: "s/lap", corner: null };
  }
}

/**
 * Valideert en normaliseert één learningbijdrage.
 *
 * @returns de genormaliseerde bijdrage, of `null` als de payload op enig punt
 * niet bewijsbaar aan het contract voldoet. Deze functie gooit nooit.
 */
export function parseLearningContribution(
  input: unknown,
  options?: LearningContributionParseOptions,
): LearningContribution | null {
  try {
    return parseInternal(input, options);
  } catch {
    return null;
  }
}
