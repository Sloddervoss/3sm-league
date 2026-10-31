/**
 * Plugin 0.7.2.0 — additieve uitbreidingsblokken voor het V3-frame.
 *
 * Waarom dit een eigen bestand is: `simhub.ts` is de bevroren wire-validator en
 * die moet leesbaar blijven. Alles wat 0.7.2.0 toevoegt — `schemaRevision`,
 * `capabilities`, `environment`, `measurementEvents`, `lapSummaries` en de
 * begrensde acceptatie van onbekende rootkeys — staat hier, met dezelfde
 * afspraken:
 *
 *  - onbekende velden BINNEN een bekend blok zijn een fout (strikt);
 *  - onbekende rootkeys zijn toegestaan maar begrensd en worden nooit
 *    doorgegeven aan persistente verwerking;
 *  - een ongeldig optioneel blok kost alleen dat blok, nooit het frame — en
 *    binnen een meetreeks alleen die rij;
 *  - niets hier verandert de betekenis of eenheid van een bestaand veld.
 *
 * Het inhoudelijke contract staat in docs/contracts/measurement-ids-v1.md.
 *
 * Geen Deno- of npm-imports: dit bestand is met vitest en met `deno test` te
 * draaien.
 */

/** Bovengrens aan het aantal onbekende rootkeys in één frame. */
export const MaxUnknownRootKeys = 32;
/** Bovengrens aan de totale omvang van de onbekende rootkeys (JSON-tekst). */
export const MaxUnknownPayloadChars = 16384;
/** Bovengrens per onbekende waarde, zodat één veld het budget niet vult. */
export const MaxUnknownValueChars = 4096;
/** Maximale nestingdiepte van een onbekende waarde. */
export const MaxUnknownDepth = 3;
/** Meetgebeurtenissen per frame; de rest hoort in de volgende batch (outbox). */
export const MaxMeasurementEventsPerFrame = 50;
/** Rondeaggregaten per frame. */
export const MaxLapSummariesPerFrame = 5;

/** De drie metriekgroepen waarvoor dekking verplicht is bij `complete`. */
export const CoverageGroups = ["temperature", "fuel", "load"] as const;

const rootKeyPattern = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
/** Duurzame client-ID's: UUID's. Versie- en variantbits worden niet getest. */
const uidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idPattern = /^[A-Za-z0-9._:-]{1,64}$/;

const asObject = (value: unknown, path: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be an object`);
  return value as Record<string, unknown>;
};

const allowKeys = (value: Record<string, unknown>, allowed: string[], path: string) => {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length) throw new Error(`${path} contains unknown fields`);
};

const optNumber = (value: unknown, path: string, min: number, max: number): number | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${path} is invalid`);
  }
  return value;
};

const optInteger = (value: unknown, path: string, min: number, max: number): number | null => {
  const n = optNumber(value, path, min, max);
  if (n !== null && !Number.isInteger(n)) throw new Error(`${path} must be an integer`);
  return n;
};

const optBoolean = (value: unknown, path: string): boolean | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== "boolean") throw new Error(`${path} is invalid`);
  return value;
};

const optText = (value: unknown, path: string, max: number): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new Error(`${path} is invalid`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) throw new Error(`${path} is invalid`);
  return trimmed;
};

/** ISO-8601 met zone. Een tijd zonder zone is geen tijd. */
const optTimestamp = (value: unknown, path: string): string | null => {
  const text = optText(value, path, 40);
  if (text === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.test(text)) {
    throw new Error(`${path} is invalid`);
  }
  if (!Number.isFinite(Date.parse(text))) throw new Error(`${path} is invalid`);
  return text;
};

const optUid = (value: unknown, path: string): string | null => {
  const text = optText(value, path, 36);
  if (text === null) return null;
  if (!uidPattern.test(text)) throw new Error(`${path} must be a uuid`);
  return text.toLowerCase();
};

// ---------------------------------------------------------------------------
// Onbekende rootkeys
// ---------------------------------------------------------------------------

const depthOf = (value: unknown, current = 1): number => {
  if (Array.isArray(value)) return value.length ? Math.max(...value.map((entry) => depthOf(entry, current + 1))) : current;
  if (value && typeof value === "object") {
    const entries = Object.values(value as Record<string, unknown>);
    return entries.length ? Math.max(...entries.map((entry) => depthOf(entry, current + 1))) : current;
  }
  return current;
};

export type UnknownRootKeys = {
  /** De geaccepteerde namen. Ze worden gelogd, niet doorgegeven. */
  accepted: string[];
  /** Geschatte omvang in tekens van de geaccepteerde waarden samen. */
  chars: number;
};

/**
 * Begrensde acceptatie van rootkeys die deze Edge nog niet kent.
 *
 * Waarom niet gewoon weigeren: een 0.8-connector die één nieuw blok meestuurt
 * zou anders al zijn hele frame kwijt zijn — inclusief ronde, brandstof en
 * positie. Waarom niet gewoon alles negeren: dan kan één client het frame
 * opblazen en is er geen enkele rem op wat er door de parser gaat.
 *
 * De grens is hard: te veel sleutels, een ongeldige naam, te diepe nesting of
 * een te grote waarde is een frame-fout (422). Binnen de grens wordt de sleutel
 * geteld en genegeerd; hij komt nooit in het genormaliseerde DTO en dus nooit in
 * de database.
 */
export const acceptUnknownRootKeys = (
  root: Record<string, unknown>,
  known: string[],
): UnknownRootKeys => {
  const unknown = Object.keys(root).filter((key) => !known.includes(key));
  if (unknown.length === 0) return { accepted: [], chars: 0 };
  if (unknown.length > MaxUnknownRootKeys) {
    throw new Error(`payload contains more than ${MaxUnknownRootKeys} unknown fields`);
  }
  let chars = 0;
  for (const key of unknown) {
    if (!rootKeyPattern.test(key)) throw new Error(`payload contains an invalid field name`);
    const value = root[key];
    const serialized = JSON.stringify(value ?? null) ?? "";
    if (serialized.length > MaxUnknownValueChars) {
      throw new Error(`payload.${key} is too large`);
    }
    if (depthOf(value) > MaxUnknownDepth) throw new Error(`payload.${key} is nested too deeply`);
    chars += serialized.length + key.length;
  }
  if (chars > MaxUnknownPayloadChars) throw new Error("payload contains too much unknown data");
  return { accepted: unknown, chars };
};

// ---------------------------------------------------------------------------
// schemaRevision
// ---------------------------------------------------------------------------

/** De schemarevisie die deze Edge kent. Additief; protocolVersion blijft 3. */
export const CurrentSchemaRevision = 1;

/**
 * `schemaRevision` is een losse teller naast `protocolVersion: 3`. Een oudere
 * server kent hem niet en negeert hem; een nieuwere client mag hem sturen zonder
 * dat de framing verandert. Hoger dan wat deze Edge kent is geen fout: de
 * onbekende blokken vallen onder de begrensde acceptatie hierboven.
 */
export const parseSchemaRevision = (value: unknown): number | null =>
  optInteger(value, "payload.schemaRevision", 0, 1000);

// ---------------------------------------------------------------------------
// capabilities
// ---------------------------------------------------------------------------

export type SimHubCapabilities = {
  revision: number;
  /**
   * Geïmplementeerd per feature, met eigen versie. Een ontbrekende sleutel
   * betekent "deze connector kan het niet", niet "uit". Of een feature
   * momenteel beschikbaar is (kanaal aanwezig, niet stale) staat in de
   * kwaliteitsmetadata van het frame, niet hier.
   */
  supported: Record<string, number>;
};

const MaxCapabilityKeys = 32;

export const parseCapabilities = (value: unknown): SimHubCapabilities | null => {
  if (value === undefined || value === null) return null;
  const path = "payload.capabilities";
  const record = asObject(value, path);
  allowKeys(record, ["revision", "supported"], path);
  const revision = optInteger(record.revision, `${path}.revision`, 1, 1000);
  if (revision === null) throw new Error(`${path}.revision is required`);
  const supportedRecord = asObject(record.supported ?? {}, `${path}.supported`);
  const keys = Object.keys(supportedRecord);
  if (keys.length > MaxCapabilityKeys) throw new Error(`${path}.supported has too many entries`);
  const supported: Record<string, number> = {};
  for (const key of keys) {
    if (!rootKeyPattern.test(key)) throw new Error(`${path}.supported contains an invalid name`);
    const version = optInteger(supportedRecord[key], `${path}.supported.${key}`, 0, 1000);
    if (version === null) throw new Error(`${path}.supported.${key} is invalid`);
    supported[key] = version;
  }
  return { revision, supported };
};

// ---------------------------------------------------------------------------
// environment
// ---------------------------------------------------------------------------

/**
 * Zelfstandig omgevingsblok, los van `tyres`. Zelfde namen en eenheden als
 * `tyres.environment`, zodat een lezer er geen tweede tabel bij hoeft te nemen.
 * `null` betekent "niet geleverd"; een ontbrekend blok betekent hetzelfde.
 */
export type SimHubEnvironment = {
  trackTempC: number | null;
  airTempC: number | null;
  rubberState: string | null;
  /** Additief: luchtdruk in hPa, dezelfde eenheid als `weather.airPressureHpa`. */
  airPressureHpa: number | null;
  /** Additief: baanvocht in procenten, dezelfde schaal als `weather.trackWetnessPct`. */
  trackWetnessPct: number | null;
};

const environmentKeys = ["trackTempC", "airTempC", "rubberState", "airPressureHpa", "trackWetnessPct"];

export const parseEnvironment = (value: unknown): SimHubEnvironment | null => {
  if (value === undefined || value === null) return null;
  const path = "payload.environment";
  const record = asObject(value, path);
  if (Object.keys(record).length === 0) throw new Error(`${path} must contain at least one field`);
  allowKeys(record, environmentKeys, path);
  const rubberRaw = record.rubberState;
  let rubberState: string | null = null;
  if (rubberRaw !== undefined && rubberRaw !== null) {
    // Geen enum: de sim levert vrije tekst. Lengte en tekenset zijn genoeg
    // begrenzing, en een verkeerde enum zou het frame onnodig laten vallen.
    if (typeof rubberRaw !== "string" || rubberRaw.length < 1 || rubberRaw.length > 24 || !/^[A-Za-z ]+$/.test(rubberRaw)) {
      throw new Error(`${path}.rubberState is invalid`);
    }
    rubberState = rubberRaw;
  }
  return {
    trackTempC: optNumber(record.trackTempC, `${path}.trackTempC`, -40, 100),
    airTempC: optNumber(record.airTempC, `${path}.airTempC`, -40, 100),
    rubberState,
    airPressureHpa: optNumber(record.airPressureHpa, `${path}.airPressureHpa`, 800, 1100),
    trackWetnessPct: optNumber(record.trackWetnessPct, `${path}.trackWetnessPct`, 0, 100),
  };
};

// ---------------------------------------------------------------------------
// wear_v1, setGeneration en evidence_v1 — het inhoudelijke contract
// ---------------------------------------------------------------------------

export const WearScale = "remaining_percent";
export const WearVersion = 1;

/**
 * `wear_v1`: het percentage band dat NOG OVER IS, 0..100, met verplichte hoeken
 * en een expliciete schaal. Zonder die schaal is "12" niet te onderscheiden van
 * "12 procent versleten", en dan is een analyse achteraf niet te repareren.
 */
export type WearV1 = {
  version: number;
  scale: typeof WearScale;
  fl: number;
  fr: number;
  rl: number;
  rr: number;
};

const wearKeys = ["version", "scale", "fl", "fr", "rl", "rr"];
const corners = ["fl", "fr", "rl", "rr"] as const;

export const parseWearV1 = (value: unknown, path: string): WearV1 | null => {
  if (value === undefined || value === null) return null;
  const record = asObject(value, path);
  allowKeys(record, wearKeys, path);
  const version = optInteger(record.version, `${path}.version`, 1, 1);
  if (version === null) throw new Error(`${path}.version is required`);
  if (record.scale !== WearScale) throw new Error(`${path}.scale must be ${WearScale}`);
  const out: Record<string, number> = {};
  for (const corner of corners) {
    if (record[corner] === undefined || record[corner] === null) {
      throw new Error(`${path}.${corner} is required`);
    }
    const n = optNumber(record[corner], `${path}.${corner}`, 0, 100);
    if (n === null) throw new Error(`${path}.${corner} is required`);
    out[corner] = n;
  }
  return {
    version,
    scale: WearScale,
    fl: out.fl,
    fr: out.fr,
    rl: out.rl,
    rr: out.rr,
  };
};

/** Setgeneratie per hoek: vier integers, geen halve set en geen vrije vorm. */
export type SetGenerationV1 = {
  version: number;
  fl: number;
  fr: number;
  rl: number;
  rr: number;
};

export const parseSetGeneration = (value: unknown, path: string): SetGenerationV1 | null => {
  if (value === undefined || value === null) return null;
  const record = asObject(value, path);
  allowKeys(record, ["version", ...corners], path);
  const version = record.version === undefined || record.version === null
    ? WearVersion
    : optInteger(record.version, `${path}.version`, 1, 1);
  if (version === null) throw new Error(`${path}.version is invalid`);
  const out: Record<string, number> = {};
  for (const corner of corners) {
    if (record[corner] === undefined || record[corner] === null) {
      throw new Error(`${path}.${corner} is required`);
    }
    const n = optInteger(record[corner], `${path}.${corner}`, 0, 1000);
    if (n === null) throw new Error(`${path}.${corner} is required`);
    out[corner] = n;
  }
  return { version, fl: out.fl, fr: out.fr, rl: out.rl, rr: out.rr };
};

/**
 * `evidence_v1`: waar komt dit getal vandaan? Zonder bron en kanalen is een
 * confidence-getal niet te controleren en dus geen bewijs.
 */
export type EvidenceV1 = {
  version: number;
  source: string;
  channels: string[];
  note?: string;
};

export const parseEvidenceV1 = (value: unknown, path: string): EvidenceV1 | null => {
  if (value === undefined || value === null) return null;
  const record = asObject(value, path);
  allowKeys(record, ["version", "source", "channels", "note"], path);
  const version = record.version === undefined || record.version === null
    ? WearVersion
    : optInteger(record.version, `${path}.version`, 1, 1);
  if (version === null) throw new Error(`${path}.version is invalid`);
  const source = optText(record.source, `${path}.source`, 64);
  if (source === null || !idPattern.test(source)) throw new Error(`${path}.source is invalid`);
  if (!Array.isArray(record.channels) || record.channels.length < 1 || record.channels.length > 8) {
    throw new Error(`${path}.channels must be a non-empty array of at most 8 names`);
  }
  const channels = record.channels.map((entry, index) => {
    if (typeof entry !== "string" || !idPattern.test(entry)) {
      throw new Error(`${path}.channels[${index}] is invalid`);
    }
    return entry;
  });
  const note = optText(record.note, `${path}.note`, 200);
  return { version, source, channels, ...(note === null ? {} : { note }) };
};

// ---------------------------------------------------------------------------
// measurementEvents
// ---------------------------------------------------------------------------

/**
 * Eén meetgebeurtenis. `eventUid` en `kind` zijn verplicht; al het andere is
 * optioneel en `null` betekent onbekend.
 *
 * `eventUid` is de duurzame identiteit: de client maakt hem één keer, bewaart
 * hem in de outbox en hergebruikt hem bij every herverzending. `eventId` is
 * alleen een leesbaar label en doet niet mee aan de deduplicatie.
 *
 * `observedSessionId` is de sessie waarin de client de waarneming deed;
 * `deviceId` en de afleversessie staan hier NIET in, want die bepaalt de
 * server. Een connector die ze toch meestuurt, krijgt een fout — dat is
 * duidelijker dan ze stil laten verdwijnen.
 */
export type MeasurementEvent = {
  eventUid: string;
  eventId: string | null;
  kind: string;
  segmentId: string | null;
  pitVisitId: string | null;
  observedSessionId: string | null;
  observedAt: string | null;
  sessionTimeSeconds: number | null;
  sdkTick: number | null;
  wearBefore: WearV1 | null;
  wearAfter: WearV1 | null;
  setGeneration: SetGenerationV1 | null;
  evidence: EvidenceV1 | null;
  confidence: number | null;
  recordRevision: number;
  supersedesEventUid: string | null;
};

const eventKeys = [
  "eventUid", "eventId", "kind", "segmentId", "pitVisitId", "observedSessionId", "observedAt",
  "sessionTimeSeconds", "sdkTick", "wearBefore", "wearAfter", "setGeneration", "evidence",
  "confidence", "recordRevision", "supersedesEventUid",
];

export const parseMeasurementEvent = (value: unknown, index: number): MeasurementEvent => {
  const path = `payload.measurementEvents[${index}]`;
  const record = asObject(value, path);
  allowKeys(record, eventKeys, path);

  const eventUid = optUid(record.eventUid, `${path}.eventUid`);
  if (eventUid === null) throw new Error(`${path}.eventUid is required`);

  const kind = optText(record.kind, `${path}.kind`, 64);
  if (kind === null || !/^[a-z0-9._-]{1,64}$/.test(kind)) throw new Error(`${path}.kind is invalid`);

  const eventId = optText(record.eventId, `${path}.eventId`, 64);
  if (eventId !== null && !idPattern.test(eventId)) throw new Error(`${path}.eventId is invalid`);
  const segmentId = optText(record.segmentId, `${path}.segmentId`, 64);
  if (segmentId !== null && !idPattern.test(segmentId)) throw new Error(`${path}.segmentId is invalid`);
  const pitVisitId = optText(record.pitVisitId, `${path}.pitVisitId`, 64);
  if (pitVisitId !== null && !idPattern.test(pitVisitId)) throw new Error(`${path}.pitVisitId is invalid`);
  const observedSessionId = optText(record.observedSessionId, `${path}.observedSessionId`, 120);
  if (observedSessionId !== null && !/^[A-Za-z0-9._:-]{1,120}$/.test(observedSessionId)) {
    throw new Error(`${path}.observedSessionId is invalid`);
  }

  const confidence = optNumber(record.confidence, `${path}.confidence`, 0, 1);
  const wearBefore = parseWearV1(record.wearBefore, `${path}.wearBefore`);
  const wearAfter = parseWearV1(record.wearAfter, `${path}.wearAfter`);

  // Een wear-waarneming zonder bewijsgrond of zonder confidence is geen
  // waarneming. De database weigert hem ook; hier gebeurt het met een reden.
  if ((wearBefore !== null || wearAfter !== null) && record.evidence === undefined) {
    throw new Error(`${path}.evidence is required when wear is present`);
  }
  if ((wearBefore !== null || wearAfter !== null) && confidence === null) {
    throw new Error(`${path}.confidence is required when wear is present`);
  }

  return {
    eventUid,
    eventId,
    kind,
    segmentId,
    pitVisitId,
    observedSessionId,
    observedAt: optTimestamp(record.observedAt, `${path}.observedAt`),
    sessionTimeSeconds: optNumber(record.sessionTimeSeconds, `${path}.sessionTimeSeconds`, 0, 604800),
    sdkTick: optInteger(record.sdkTick, `${path}.sdkTick`, 0, Number.MAX_SAFE_INTEGER),
    wearBefore,
    wearAfter,
    setGeneration: parseSetGeneration(record.setGeneration, `${path}.setGeneration`),
    evidence: parseEvidenceV1(record.evidence, `${path}.evidence`),
    confidence,
    recordRevision: optInteger(record.recordRevision, `${path}.recordRevision`, 1, 100000) ?? 1,
    supersedesEventUid: optUid(record.supersedesEventUid, `${path}.supersedesEventUid`),
  };
};

// ---------------------------------------------------------------------------
// lapSummaries
// ---------------------------------------------------------------------------

/** Dekking van één metriekgroep. */
export type CoverageGroup = {
  validDurationSeconds: number;
  sampleCount: number;
  maxGapSeconds: number;
};

export type LapCoverage = {
  temperature?: CoverageGroup;
  fuel?: CoverageGroup;
  load?: CoverageGroup;
};

const coverageGroupKeys = ["validDurationSeconds", "sampleCount", "maxGapSeconds"];

export const parseCoverageGroup = (value: unknown, path: string): CoverageGroup => {
  const record = asObject(value, path);
  allowKeys(record, coverageGroupKeys, path);
  const validDurationSeconds = optNumber(record.validDurationSeconds, `${path}.validDurationSeconds`, 0, 86400);
  const sampleCount = optInteger(record.sampleCount, `${path}.sampleCount`, 0, 100000000);
  const maxGapSeconds = optNumber(record.maxGapSeconds, `${path}.maxGapSeconds`, 0, 86400);
  if (validDurationSeconds === null || sampleCount === null || maxGapSeconds === null) {
    throw new Error(`${path} must contain validDurationSeconds, sampleCount and maxGapSeconds`);
  }
  return { validDurationSeconds, sampleCount, maxGapSeconds };
};

export const parseLapCoverage = (value: unknown, path: string): LapCoverage | null => {
  if (value === undefined || value === null) return null;
  const record = asObject(value, path);
  const keys = Object.keys(record);
  if (keys.length === 0) throw new Error(`${path} must contain at least one group`);
  allowKeys(record, [...CoverageGroups], path);
  const out: LapCoverage = {};
  for (const group of CoverageGroups) {
    if (record[group] === undefined || record[group] === null) continue;
    out[group] = parseCoverageGroup(record[group], `${path}.${group}`);
  }
  return out;
};

/** Is deze groep gedekt? Dat wil zeggen: samples én een positieve meetduur. */
export const coverageHas = (coverage: LapCoverage | null, group: (typeof CoverageGroups)[number]): boolean => {
  const entry = coverage?.[group];
  return Boolean(entry && entry.sampleCount > 0 && entry.validDurationSeconds > 0);
};

/**
 * Eisen waarmee `complete` iets betekent (review 2, punt 4). Zonder deze
 * drempels was één sample van 0,001 s genoeg om een ronde van twee minuten
 * "compleet" te noemen.
 */
export const MinSamplesPerGroup = 10;
/** Grootste toegestane gat binnen een groep. */
export const MaxCoverageGapSeconds = 2;
/** Minimaal gemeten deel van het rondevenster. */
export const MinCoveredFraction = 0.8;

export type CoverageVerdict = {
  complete: boolean;
  /** Stabiele redencodes; leeg als de ronde aantoonbaar volledig is. */
  reasons: string[];
};

/**
 * Beoordeelt of de dekking een volledige ronde aantoont.
 *
 * Nodig: alle drie de groepen, per groep minimaal 10 samples en een gat van
 * hoogstens 2 s, en samen minstens 80% van het opgegeven rondevenster. Zonder
 * `startedAt`/`endedAt` is er geen venster en dus geen bewijs: dan is de ronde
 * niet compleet. Dat is strenger dan "de groepen zijn aanwezig" en dat is
 * precies de bedoeling.
 */
export const coverageVerdict = (
  coverage: LapCoverage | null,
  startedAt: string | null,
  endedAt: string | null,
): CoverageVerdict => {
  const reasons: string[] = [];
  const windowStart = startedAt === null ? NaN : Date.parse(startedAt);
  const windowEnd = endedAt === null ? NaN : Date.parse(endedAt);
  const windowSeconds = (windowEnd - windowStart) / 1000;
  if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) {
    reasons.push("coverage_window_missing");
  }
  let covered = 0;
  for (const group of CoverageGroups) {
    const entry = coverage?.[group];
    if (!entry) {
      reasons.push(`coverage_missing:${group}`);
      continue;
    }
    if (entry.sampleCount < MinSamplesPerGroup) reasons.push(`coverage_samples:${group}`);
    if (entry.maxGapSeconds > MaxCoverageGapSeconds) reasons.push(`coverage_gap:${group}`);
    if (entry.validDurationSeconds <= 0) reasons.push(`coverage_duration:${group}`);
    covered += entry.validDurationSeconds;
  }
  if (Number.isFinite(windowSeconds) && windowSeconds > 0
      && covered < windowSeconds * MinCoveredFraction - 1e-6) {
    reasons.push("coverage_duration:window");
  }
  return { complete: reasons.length === 0, reasons: [...new Set(reasons)] };
};

/** `complete` mag alleen als de dekking de hele ronde aantoont. */
export const coverageComplete = (
  coverage: LapCoverage | null,
  startedAt: string | null = null,
  endedAt: string | null = null,
): boolean => coverageVerdict(coverage, startedAt, endedAt).complete;

export type LapSummary = {
  summaryUid: string;
  summaryId: string | null;
  segmentId: string | null;
  observedSessionId: string | null;
  lapNumber: number;
  startedAt: string | null;
  endedAt: string | null;
  /**
   * SimHub-naam van de rijder. Dit is wat de connector werkelijk kent; de
   * user_id wordt server-side geresolveerd en is geen wire-veld.
   */
  currentDriverName: string | null;
  aggregationVersion: number;
  recordRevision: number;
  supersedesSummaryUid: string | null;
  complete: boolean | null;
  invalidReasons: string[] | null;
  pitLap: boolean | null;
  driverChanged: boolean | null;
  trackTempCMean: number | null;
  trackTempCMin: number | null;
  trackTempCMax: number | null;
  airTempCMean: number | null;
  fuelStartLitres: number | null;
  fuelEndLitres: number | null;
  fuelLevelIntegralLitreSeconds: number | null;
  fuelAddedLitresObserved: number | null;
  absLatAccelIntegralGSeconds: number | null;
  latAccelSquaredIntegralG2Seconds: number | null;
  maxAbsLatAccelG: number | null;
  absLongAccelIntegralGSeconds: number | null;
  coverage: LapCoverage | null;
  sampleCount: number | null;
  maxGapSeconds: number | null;
  validDurationSeconds: number | null;
  pitVisitIds: string[] | null;
  wearObservationIds: string[] | null;
};

const lapKeys = [
  "summaryUid", "summaryId", "segmentId", "observedSessionId", "lapNumber", "startedAt", "endedAt",
  "currentDriverName", "currentDriverId", "aggregationVersion", "recordRevision", "supersedesSummaryUid",
  "complete", "invalidReasons", "pitLap", "driverChanged",
  "trackTempCMean", "trackTempCMin", "trackTempCMax", "airTempCMean",
  "fuelStartLitres", "fuelEndLitres", "fuelLevelIntegralLitreSeconds", "fuelAddedLitresObserved",
  "absLatAccelIntegralGSeconds", "latAccelSquaredIntegralG2Seconds", "maxAbsLatAccelG",
  "absLongAccelIntegralGSeconds", "coverage", "sampleCount", "maxGapSeconds",
  "validDurationSeconds", "pitVisitIds", "wearObservationIds",
];

const optIdArray = (value: unknown, path: string, max: number): string[] | null => {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  if (value.length > max) throw new Error(`${path} has too many entries`);
  return value.map((entry, index) => {
    if (typeof entry !== "string" || !idPattern.test(entry)) throw new Error(`${path}[${index}] is invalid`);
    return entry;
  });
};

const optReasonArray = (value: unknown, path: string, max: number): string[] | null => {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  if (value.length > max) throw new Error(`${path} has too many entries`);
  return value.map((entry, index) => {
    if (typeof entry !== "string" || entry.length < 1 || entry.length > 64) throw new Error(`${path}[${index}] is invalid`);
    return entry;
  });
};

export const parseLapSummary = (value: unknown, index: number): LapSummary => {
  const path = `payload.lapSummaries[${index}]`;
  const record = asObject(value, path);
  allowKeys(record, lapKeys, path);

  const summaryUid = optUid(record.summaryUid, `${path}.summaryUid`);
  if (summaryUid === null) throw new Error(`${path}.summaryUid is required`);
  const summaryId = optText(record.summaryId, `${path}.summaryId`, 64);
  if (summaryId !== null && !idPattern.test(summaryId)) throw new Error(`${path}.summaryId is invalid`);

  const lapNumber = optInteger(record.lapNumber, `${path}.lapNumber`, 0, 100000);
  if (lapNumber === null) throw new Error(`${path}.lapNumber is required`);

  const segmentId = optText(record.segmentId, `${path}.segmentId`, 64);
  if (segmentId !== null && !idPattern.test(segmentId)) throw new Error(`${path}.segmentId is invalid`);
  const observedSessionId = optText(record.observedSessionId, `${path}.observedSessionId`, 120);
  if (observedSessionId !== null && !/^[A-Za-z0-9._:-]{1,120}$/.test(observedSessionId)) {
    throw new Error(`${path}.observedSessionId is invalid`);
  }

  // Een UUID is geen clientgegeven. Het kernframe behandelt currentDriverId als
  // een SimHub-naam en resolveert die server-side; een ronde doet hetzelfde. Een
  // client die hier tóch een UUID zet, krijgt een afwijzing met reden in plaats
  // van een stil genegeerd veld.
  if (record.currentDriverId !== undefined && record.currentDriverId !== null) {
    throw new Error(`${path}.currentDriverId is not allowed; send currentDriverName`);
  }
  const currentDriverName = optText(record.currentDriverName, `${path}.currentDriverName`, 64);
  if (currentDriverName !== null && !/^[A-Za-z0-9 .,'_-]{1,64}$/.test(currentDriverName)) {
    throw new Error(`${path}.currentDriverName is invalid`);
  }

  const startedAt = optTimestamp(record.startedAt, `${path}.startedAt`);
  const endedAt = optTimestamp(record.endedAt, `${path}.endedAt`);
  if (startedAt !== null && endedAt !== null && Date.parse(endedAt) < Date.parse(startedAt)) {
    throw new Error(`${path}.endedAt is before startedAt`);
  }

  // Een rijderwissel binnen de ronde en tóch één naam is tegenstrijdig. Welke
  // van de twee zou het zijn? Niet normaliseren, maar weigeren.
  const driverChanged = optBoolean(record.driverChanged, `${path}.driverChanged`);
  if (driverChanged === true && currentDriverName !== null) {
    throw new Error(`${path}.driverChanged cannot be combined with currentDriverName`);
  }

  const trackTempCMin = optNumber(record.trackTempCMin, `${path}.trackTempCMin`, -60, 120);
  const trackTempCMax = optNumber(record.trackTempCMax, `${path}.trackTempCMax`, -60, 120);
  if (trackTempCMin !== null && trackTempCMax !== null && trackTempCMax < trackTempCMin) {
    throw new Error(`${path}.trackTempCMax is below trackTempCMin`);
  }

  // Dekking: een waarde zonder de dekking van haar eigen groep is geen meting.
  const coverage = parseLapCoverage(record.coverage, `${path}.coverage`);
  const values = {
    trackTempCMean: optNumber(record.trackTempCMean, `${path}.trackTempCMean`, -60, 120),
    trackTempCMin,
    trackTempCMax,
    airTempCMean: optNumber(record.airTempCMean, `${path}.airTempCMean`, -60, 120),
    fuelLevelIntegralLitreSeconds: optNumber(record.fuelLevelIntegralLitreSeconds, `${path}.fuelLevelIntegralLitreSeconds`, 0, 1200000),
    fuelAddedLitresObserved: optNumber(record.fuelAddedLitresObserved, `${path}.fuelAddedLitresObserved`, 0, 300),
    absLatAccelIntegralGSeconds: optNumber(record.absLatAccelIntegralGSeconds, `${path}.absLatAccelIntegralGSeconds`, 0, 600000),
    latAccelSquaredIntegralG2Seconds: optNumber(record.latAccelSquaredIntegralG2Seconds, `${path}.latAccelSquaredIntegralG2Seconds`, 0, 6000000),
    maxAbsLatAccelG: optNumber(record.maxAbsLatAccelG, `${path}.maxAbsLatAccelG`, 0, 10),
    absLongAccelIntegralGSeconds: optNumber(record.absLongAccelIntegralGSeconds, `${path}.absLongAccelIntegralGSeconds`, 0, 600000),
  };

  if ((values.trackTempCMean !== null || values.trackTempCMin !== null
       || values.trackTempCMax !== null || values.airTempCMean !== null)
      && !coverageHas(coverage, "temperature")) {
    throw new Error(`${path}.coverage.temperature is required for temperature values`);
  }
  if ((values.fuelLevelIntegralLitreSeconds !== null || values.fuelAddedLitresObserved !== null)
      && !coverageHas(coverage, "fuel")) {
    throw new Error(`${path}.coverage.fuel is required for the fuel integral`);
  }
  if ((values.absLatAccelIntegralGSeconds !== null || values.latAccelSquaredIntegralG2Seconds !== null
       || values.maxAbsLatAccelG !== null || values.absLongAccelIntegralGSeconds !== null)
      && !coverageHas(coverage, "load")) {
    throw new Error(`${path}.coverage.load is required for load values`);
  }
  // "Compleet" is een kwaliteitsclaim over de hele ronde. Onvoldoende dekking
  // is geen framefout: de ronde blijft geldig, maar de claim gaat naar false en
  // de reden staat in invalidReasons. Zo is achteraf te zien waarom.
  const verdict = coverageVerdict(coverage, startedAt, endedAt);
  const requestedComplete = optBoolean(record.complete, `${path}.complete`);
  // Alleen een claim van de client wordt getoetst; `null` blijft "geen uitspraak".
  const complete = requestedComplete === true ? verdict.complete : requestedComplete;
  let invalidReasons = optReasonArray(record.invalidReasons, `${path}.invalidReasons`, 16);
  if (requestedComplete === true && !verdict.complete) {
    invalidReasons = [...new Set([...(invalidReasons ?? []), ...verdict.reasons])].slice(0, 16);
  }

  return {
    summaryUid,
    summaryId,
    segmentId,
    observedSessionId,
    lapNumber,
    startedAt,
    endedAt,
    currentDriverName,
    // Versie van het aggregatie-algoritme; zonder dit getal zijn oude en nieuwe
    // berekeningen later niet uit elkaar te houden.
    aggregationVersion: optInteger(record.aggregationVersion, `${path}.aggregationVersion`, 1, 1000) ?? 1,
    recordRevision: optInteger(record.recordRevision, `${path}.recordRevision`, 1, 100000) ?? 1,
    supersedesSummaryUid: optUid(record.supersedesSummaryUid, `${path}.supersedesSummaryUid`),
    complete,
    invalidReasons,
    pitLap: optBoolean(record.pitLap, `${path}.pitLap`),
    driverChanged,
    ...values,
    fuelStartLitres: optNumber(record.fuelStartLitres, `${path}.fuelStartLitres`, 0, 300),
    fuelEndLitres: optNumber(record.fuelEndLitres, `${path}.fuelEndLitres`, 0, 300),
    coverage,
    sampleCount: optInteger(record.sampleCount, `${path}.sampleCount`, 0, 100000000),
    maxGapSeconds: optNumber(record.maxGapSeconds, `${path}.maxGapSeconds`, 0, 86400),
    validDurationSeconds: optNumber(record.validDurationSeconds, `${path}.validDurationSeconds`, 0, 86400),
    pitVisitIds: optIdArray(record.pitVisitIds, `${path}.pitVisitIds`, 32),
    wearObservationIds: optIdArray(record.wearObservationIds, `${path}.wearObservationIds`, 64),
  };
};

// ---------------------------------------------------------------------------
// Reeksen met een uitslag per rij
// ---------------------------------------------------------------------------

export type SeriesRejection = {
  id: string | null;
  index: number;
  reason: string;
};

export type SeriesReport<T> = {
  rows: T[];
  rejected: SeriesRejection[];
  /** Gezet als de reeks als geheel onbruikbaar was (geen array, te lang). */
  blockError: string | null;
  /** Aantal aangeboden rijen in de oorspronkelijke payload (ook afgekeurde). */
  received: number;
  /**
   * Voor elke goedgekeurde rij de positie in de oorspronkelijke reeks. Hiermee
   * kan een databaseafwijzing (die alleen de ingekorte reeks ziet) naar de
   * juiste payloadindex worden vertaald.
   */
  acceptedIndexes: number[];
};

const emptyReport = <T>(blockError: string | null = null, received = 0): SeriesReport<T> =>
  ({ rows: [], rejected: [], blockError, received, acceptedIndexes: [] });

/**
 * Leest een reeks rij voor rij. Eén kapotte rij kost alleen die rij: de goede
 * rijen gaan door naar de database en de afgekeurde komen met reden in het
 * ACK-antwoord dat de connector terugkrijgt. Dat is de reden dat dit geen
 * `map` over de hele reeks is.
 */
const parseSeries = <T>(
  label: string,
  value: unknown,
  max: number,
  parseOne: (entry: unknown, index: number) => T,
  identify: (entry: unknown) => string | null,
): SeriesReport<T> => {
  if (value === undefined || value === null) return emptyReport<T>();
  if (!Array.isArray(value)) return emptyReport<T>("not_an_array");
  if (value.length > max) return emptyReport<T>("too_many", value.length);
  const report: SeriesReport<T> = { rows: [], rejected: [], blockError: null, received: value.length, acceptedIndexes: [] };
  value.forEach((entry, index) => {
    try {
      report.rows.push(parseOne(entry, index));
      report.acceptedIndexes.push(index);
    } catch (error) {
      const reason = (error as Error).message ?? "invalid_row";
      report.rejected.push({ id: identify(entry), index, reason });
      console.warn(`${label}[${index}] rejected:`, reason);
    }
  });
  return report;
};

const identifyEntry = (entry: unknown): string | null => {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const record = entry as Record<string, unknown>;
  for (const key of ["eventUid", "summaryUid", "eventId", "summaryId"]) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0 && value.length <= 64) return value;
  }
  return null;
};

export const parseMeasurementEventsReport = (value: unknown): SeriesReport<MeasurementEvent> =>
  parseSeries("payload.measurementEvents", value, MaxMeasurementEventsPerFrame, parseMeasurementEvent, identifyEntry);

export const parseLapSummariesReport = (value: unknown): SeriesReport<LapSummary> =>
  parseSeries("payload.lapSummaries", value, MaxLapSummariesPerFrame, parseLapSummary, identifyEntry);

/**
 * Compatibiliteitsvorm voor aanroepers die alleen de goedgekeurde rijen willen:
 * null als er niets is, anders de rijen. Een reeks die als geheel onbruikbaar
 * was, geeft een lege lijst — de afwijzing staat in het rapport.
 */
export const parseMeasurementEvents = (value: unknown): MeasurementEvent[] | null => {
  const report = parseMeasurementEventsReport(value);
  return value === undefined || value === null ? null : report.rows;
};

export const parseLapSummaries = (value: unknown): LapSummary[] | null => {
  const report = parseLapSummariesReport(value);
  return value === undefined || value === null ? null : report.rows;
};

// ---------------------------------------------------------------------------
// Nooit fataal
// ---------------------------------------------------------------------------

/**
 * Zelfde afspraak als in simhub.ts voor `tyres`, `brakes` en `weather`: een
 * ongeldig optioneel blok kost alleen dat blok. De fout wordt gelogd, zodat de
 * vorm bij te stellen is, en de gezonde kerntelemetrie blijft staan.
 */
export const neverFatal = <T>(label: string, parse: (value: unknown) => T | null, onReject?: (message: string) => void) =>
  (value: unknown): T | null => {
    if (value === undefined || value === null) return null;
    try {
      return parse(value);
    } catch (error) {
      const message = (error as Error).message;
      console.warn(`${label} block rejected:`, message);
      onReject?.(message);
      return null;
    }
  };
