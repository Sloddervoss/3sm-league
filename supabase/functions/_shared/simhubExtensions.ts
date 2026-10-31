/**
 * Plugin 0.8 — additieve uitbreidingsblokken voor het V3-frame.
 *
 * Waarom dit een eigen bestand is: `simhub.ts` is de bevroren wire-validator en
 * die moet leesbaar blijven. Alles wat 0.8 toevoegt — `schemaRevision`,
 * `capabilities`, `environment`, `measurementEvents`, `lapSummaries` en de
 * begrensde acceptatie van onbekende rootkeys — staat hier, met dezelfde
 * afspraken:
 *
 *  - onbekende velden BINNEN een bekend blok zijn een fout (strikt);
 *  - onbekende rootkeys zijn toegestaan maar begrensd en worden nooit
 *    doorgegeven aan persistente verwerking;
 *  - een ongeldig optioneel blok kost alleen dat blok, nooit het frame;
 *  - niets hier verandert de betekenis of eenheid van een bestaand veld.
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

const rootKeyPattern = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

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

/** Alleen objecten: wear-before/after, evidence en setGeneration zijn structuren. */
const optBoundedObject = (value: unknown, path: string, maxChars: number): Record<string, unknown> | null => {
  if (value === undefined || value === null) return null;
  const record = asObject(value, path);
  if (JSON.stringify(record).length > maxChars) throw new Error(`${path} is too large`);
  return record;
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
 * Waarom niet gewoon weigeren: een 0.9-connector die één nieuw blok meestuurt
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
// measurementEvents
// ---------------------------------------------------------------------------

/**
 * Eén meetgebeurtenis. `eventId` en `kind` zijn verplicht; al het andere is
 * optioneel en `null` betekent onbekend. `confidence` is 0..1 en null betekent
 * "de connector noemt geen getal" — dat is iets anders dan 0.
 *
 * `deviceId` en `transportSessionId` staan hier NIET in: de server bepaalt bij
 * welke apparaat en sessie een gebeurtenis hoort, nooit de payload. Een
 * connector die ze toch meestuurt, krijgt een fout — dat is duidelijker dan ze
 * stil laten verdwijnen.
 */
export type MeasurementEvent = {
  eventId: string;
  kind: string;
  segmentId: string | null;
  pitVisitId: string | null;
  observedAt: string | null;
  sessionTimeSeconds: number | null;
  sdkTick: number | null;
  wearBefore: Record<string, unknown> | null;
  wearAfter: Record<string, unknown> | null;
  setGeneration: Record<string, unknown> | null;
  evidence: Record<string, unknown> | null;
  confidence: number | null;
};

const eventKeys = [
  "eventId", "kind", "segmentId", "pitVisitId", "observedAt", "sessionTimeSeconds",
  "sdkTick", "wearBefore", "wearAfter", "setGeneration", "evidence", "confidence",
];

const idPattern = /^[A-Za-z0-9._:-]{1,64}$/;

export const parseMeasurementEvent = (value: unknown, index: number): MeasurementEvent => {
  const path = `payload.measurementEvents[${index}]`;
  const record = asObject(value, path);
  allowKeys(record, eventKeys, path);

  const eventId = optText(record.eventId, `${path}.eventId`, 64);
  if (eventId === null || !idPattern.test(eventId)) throw new Error(`${path}.eventId is invalid`);
  const kind = optText(record.kind, `${path}.kind`, 64);
  if (kind === null || !/^[a-z0-9._-]{1,64}$/.test(kind)) throw new Error(`${path}.kind is invalid`);

  const segmentId = optText(record.segmentId, `${path}.segmentId`, 64);
  if (segmentId !== null && !idPattern.test(segmentId)) throw new Error(`${path}.segmentId is invalid`);
  const pitVisitId = optText(record.pitVisitId, `${path}.pitVisitId`, 64);
  if (pitVisitId !== null && !idPattern.test(pitVisitId)) throw new Error(`${path}.pitVisitId is invalid`);

  return {
    eventId,
    kind,
    segmentId,
    pitVisitId,
    observedAt: optTimestamp(record.observedAt, `${path}.observedAt`),
    sessionTimeSeconds: optNumber(record.sessionTimeSeconds, `${path}.sessionTimeSeconds`, 0, 604800),
    sdkTick: optInteger(record.sdkTick, `${path}.sdkTick`, 0, Number.MAX_SAFE_INTEGER),
    wearBefore: optBoundedObject(record.wearBefore, `${path}.wearBefore`, 2048),
    wearAfter: optBoundedObject(record.wearAfter, `${path}.wearAfter`, 2048),
    setGeneration: optBoundedObject(record.setGeneration, `${path}.setGeneration`, 2048),
    evidence: optBoundedObject(record.evidence, `${path}.evidence`, 4096),
    // 0..1, of null. Geen 0 als vervanging van onbekend.
    confidence: optNumber(record.confidence, `${path}.confidence`, 0, 1),
  };
};

export const parseMeasurementEvents = (value: unknown): MeasurementEvent[] | null => {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) throw new Error("payload.measurementEvents must be an array");
  if (value.length > MaxMeasurementEventsPerFrame) {
    throw new Error(`payload.measurementEvents has more than ${MaxMeasurementEventsPerFrame} entries`);
  }
  return value.map((entry, index) => parseMeasurementEvent(entry, index));
};

// ---------------------------------------------------------------------------
// lapSummaries
// ---------------------------------------------------------------------------

export type LapSummary = {
  summaryId: string;
  segmentId: string | null;
  lapNumber: number;
  startedAt: string | null;
  endedAt: string | null;
  currentDriverId: string | null;
  aggregationVersion: number;
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
  validDurationSeconds: number | null;
  sampleCount: number | null;
  maxGapSeconds: number | null;
  pitVisitIds: string[] | null;
  wearObservationIds: string[] | null;
};

const lapKeys = [
  "summaryId", "segmentId", "lapNumber", "startedAt", "endedAt", "currentDriverId",
  "aggregationVersion", "complete", "invalidReasons", "pitLap", "driverChanged",
  "trackTempCMean", "trackTempCMin", "trackTempCMax", "airTempCMean",
  "fuelStartLitres", "fuelEndLitres", "fuelLevelIntegralLitreSeconds", "fuelAddedLitresObserved",
  "absLatAccelIntegralGSeconds", "latAccelSquaredIntegralG2Seconds", "maxAbsLatAccelG",
  "absLongAccelIntegralGSeconds", "validDurationSeconds", "sampleCount", "maxGapSeconds",
  "pitVisitIds", "wearObservationIds",
];

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

  const summaryId = optText(record.summaryId, `${path}.summaryId`, 64);
  if (summaryId === null || !idPattern.test(summaryId)) throw new Error(`${path}.summaryId is invalid`);
  const lapNumber = optInteger(record.lapNumber, `${path}.lapNumber`, 0, 100000);
  if (lapNumber === null) throw new Error(`${path}.lapNumber is required`);

  const segmentId = optText(record.segmentId, `${path}.segmentId`, 64);
  if (segmentId !== null && !idPattern.test(segmentId)) throw new Error(`${path}.segmentId is invalid`);

  const currentDriverId = optText(record.currentDriverId, `${path}.currentDriverId`, 64);
  if (currentDriverId !== null && !uuidPattern.test(currentDriverId)) {
    throw new Error(`${path}.currentDriverId must be a uuid or null`);
  }

  const startedAt = optTimestamp(record.startedAt, `${path}.startedAt`);
  const endedAt = optTimestamp(record.endedAt, `${path}.endedAt`);
  if (startedAt !== null && endedAt !== null && Date.parse(endedAt) < Date.parse(startedAt)) {
    throw new Error(`${path}.endedAt is before startedAt`);
  }

  const trackTempCMin = optNumber(record.trackTempCMin, `${path}.trackTempCMin`, -40, 100);
  const trackTempCMax = optNumber(record.trackTempCMax, `${path}.trackTempCMax`, -40, 100);
  if (trackTempCMin !== null && trackTempCMax !== null && trackTempCMax < trackTempCMin) {
    throw new Error(`${path}.trackTempCMax is below trackTempCMin`);
  }

  return {
    summaryId,
    segmentId,
    lapNumber,
    startedAt,
    endedAt,
    currentDriverId,
    // Versie van het aggregatie-algoritme; zonder dit getal zijn oude en nieuwe
    // berekeningen later niet uit elkaar te houden.
    aggregationVersion: optInteger(record.aggregationVersion, `${path}.aggregationVersion`, 1, 1000) ?? 1,
    complete: optBoolean(record.complete, `${path}.complete`),
    invalidReasons: optReasonArray(record.invalidReasons, `${path}.invalidReasons`, 16),
    pitLap: optBoolean(record.pitLap, `${path}.pitLap`),
    driverChanged: optBoolean(record.driverChanged, `${path}.driverChanged`),
    trackTempCMean: optNumber(record.trackTempCMean, `${path}.trackTempCMean`, -40, 100),
    trackTempCMin,
    trackTempCMax,
    airTempCMean: optNumber(record.airTempCMean, `${path}.airTempCMean`, -40, 100),
    fuelStartLitres: optNumber(record.fuelStartLitres, `${path}.fuelStartLitres`, 0, 300),
    fuelEndLitres: optNumber(record.fuelEndLitres, `${path}.fuelEndLitres`, 0, 300),
    fuelLevelIntegralLitreSeconds: optNumber(record.fuelLevelIntegralLitreSeconds, `${path}.fuelLevelIntegralLitreSeconds`, 0, 200000),
    fuelAddedLitresObserved: optNumber(record.fuelAddedLitresObserved, `${path}.fuelAddedLitresObserved`, 0, 300),
    absLatAccelIntegralGSeconds: optNumber(record.absLatAccelIntegralGSeconds, `${path}.absLatAccelIntegralGSeconds`, 0, 100000),
    latAccelSquaredIntegralG2Seconds: optNumber(record.latAccelSquaredIntegralG2Seconds, `${path}.latAccelSquaredIntegralG2Seconds`, 0, 100000),
    maxAbsLatAccelG: optNumber(record.maxAbsLatAccelG, `${path}.maxAbsLatAccelG`, 0, 10),
    absLongAccelIntegralGSeconds: optNumber(record.absLongAccelIntegralGSeconds, `${path}.absLongAccelIntegralGSeconds`, 0, 100000),
    // Dekking: zonder deze drie is geen enkele integraal hierboven te
    // verantwoorden. Ze zijn daarom verplicht-nullable, niet weggelaten.
    validDurationSeconds: optNumber(record.validDurationSeconds, `${path}.validDurationSeconds`, 0, 86400),
    sampleCount: optNumber(record.sampleCount, `${path}.sampleCount`, 0, 100000000),
    maxGapSeconds: optNumber(record.maxGapSeconds, `${path}.maxGapSeconds`, 0, 86400),
    pitVisitIds: optIdArray(record.pitVisitIds, `${path}.pitVisitIds`, 32),
    wearObservationIds: optIdArray(record.wearObservationIds, `${path}.wearObservationIds`, 64),
  };
};

export const parseLapSummaries = (value: unknown): LapSummary[] | null => {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) throw new Error("payload.lapSummaries must be an array");
  if (value.length > MaxLapSummariesPerFrame) {
    throw new Error(`payload.lapSummaries has more than ${MaxLapSummariesPerFrame} entries`);
  }
  return value.map((entry, index) => parseLapSummary(entry, index));
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
