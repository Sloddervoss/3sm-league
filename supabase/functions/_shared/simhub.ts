export type SimHubFlag = "green" | "yellow" | "red" | "white" | "checkered" | "unknown";

export type SimHubTelemetryEnvelope = {
  protocolVersion: 1 | 2;
  sequence: number;
  capturedAt: string;
  source: { connectorId: string; simHubVersion: string; game: "IRacing" };
  race: {
    eventId: string; teamId: string; sessionId: string; driverId: string | null;
    currentDriverId: string | null; currentDriverName: string | null;
    carId: string | null; carName: string | null; trackName: string | null; trackConfig: string | null;
  };
  telemetry: {
    connected: boolean;
    sessionTimeSeconds: number;
    lap: number;
    completedLaps: number;
    lapTimeSeconds: number | null;
    position: number | null;
    classPosition: number | null;
    speedKph: number;
    fuelLitres: number;
    fuelPerLapLitres: number | null;
    estimatedLapsRemaining: number | null;
    inPitLane: boolean;
    pitLimiter: boolean;
    stintElapsedSeconds: number;
    incidents: number | null;
    flag: SimHubFlag;
    isInCar: boolean;
  };
};

const flagValues = new Set<SimHubFlag>(["green", "yellow", "red", "white", "checkered", "unknown"]);
const encoder = new TextEncoder();

export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const asRecord = (value: unknown, path: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be an object`);
  return value as Record<string, unknown>;
};

const exactKeys = (value: Record<string, unknown>, keys: string[], path: string) => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${path} contains unknown or missing fields`);
  }
};

const text = (value: unknown, path: string, max = 120): string => {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${path} is invalid`);
  return value.trim();
};

const nullableText = (value: unknown, path: string): string | null => value === null ? null : text(value, path);

const numberValue = (value: unknown, path: string, options: { nullable?: boolean; integer?: boolean; min?: number; max?: number } = {}): number | null => {
  if (options.nullable && value === null) return null;
  const min = options.min ?? 0;
  const max = options.max ?? Number.MAX_SAFE_INTEGER;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (options.integer && !Number.isInteger(value))) {
    throw new Error(`${path} is invalid`);
  }
  return value;
};

const booleanValue = (value: unknown, path: string): boolean => {
  if (typeof value !== "boolean") throw new Error(`${path} is invalid`);
  return value;
};

export const parseTelemetryEnvelope = (input: unknown): SimHubTelemetryEnvelope => {
  const root = asRecord(input, "payload");
  exactKeys(root, ["protocolVersion", "sequence", "capturedAt", "source", "race", "telemetry"], "payload");
  const version = root.protocolVersion;
  if (version !== 1 && version !== 2) throw new Error("unsupported protocolVersion");
  const sequence = numberValue(root.sequence, "sequence", { integer: true }) as number;
  const capturedAt = text(root.capturedAt, "capturedAt", 40);
  if (!Number.isFinite(Date.parse(capturedAt))) throw new Error("capturedAt is invalid");

  const source = asRecord(root.source, "source");
  exactKeys(source, ["connectorId", "simHubVersion", "game"], "source");
  if (source.game !== "IRacing") throw new Error("only IRacing is supported");

  const race = asRecord(root.race, "race");
  const raceKeys = version === 2
    ? ["eventId", "teamId", "sessionId", "driverId", "currentDriverId", "currentDriverName", "carId", "carName", "trackName", "trackConfig"]
    : ["eventId", "teamId", "sessionId", "driverId"];
  exactKeys(race, raceKeys, "race");

  const telemetry = asRecord(root.telemetry, "telemetry");
  const telemetryKeys = version === 2
    ? ["connected", "sessionTimeSeconds", "lap", "completedLaps", "lapTimeSeconds", "position", "classPosition", "speedKph", "fuelLitres", "fuelPerLapLitres", "estimatedLapsRemaining", "inPitLane", "pitLimiter", "stintElapsedSeconds", "incidents", "flag", "isInCar"]
    : ["connected", "sessionTimeSeconds", "lap", "completedLaps", "lapTimeSeconds", "position", "classPosition", "speedKph", "fuelLitres", "fuelPerLapLitres", "estimatedLapsRemaining", "inPitLane", "pitLimiter", "stintElapsedSeconds", "incidents", "flag"];
  exactKeys(telemetry, telemetryKeys, "telemetry");
  if (typeof telemetry.flag !== "string" || !flagValues.has(telemetry.flag as SimHubFlag)) throw new Error("telemetry.flag is invalid");

  return {
    protocolVersion: version,
    sequence,
    capturedAt,
    source: {
      connectorId: text(source.connectorId, "source.connectorId"),
      simHubVersion: text(source.simHubVersion, "source.simHubVersion", 60),
      game: "IRacing",
    },
    race: {
      eventId: text(race.eventId, "race.eventId"),
      teamId: text(race.teamId, "race.teamId"),
      sessionId: text(race.sessionId, "race.sessionId"),
      driverId: nullableText(race.driverId, "race.driverId"),
      currentDriverId: version === 2 ? nullableText(race.currentDriverId, "race.currentDriverId") : null,
      currentDriverName: version === 2 ? nullableText(race.currentDriverName, "race.currentDriverName") : null,
      carId: version === 2 ? nullableText(race.carId, "race.carId") : null,
      carName: version === 2 ? nullableText(race.carName, "race.carName") : null,
      trackName: version === 2 ? nullableText(race.trackName, "race.trackName") : null,
      trackConfig: version === 2 ? nullableText(race.trackConfig, "race.trackConfig") : null,
    },
    telemetry: {
      connected: booleanValue(telemetry.connected, "telemetry.connected"),
      sessionTimeSeconds: numberValue(telemetry.sessionTimeSeconds, "telemetry.sessionTimeSeconds", { max: 604800 }) as number,
      lap: numberValue(telemetry.lap, "telemetry.lap", { integer: true, max: 100000 }) as number,
      completedLaps: numberValue(telemetry.completedLaps, "telemetry.completedLaps", { integer: true, max: 100000 }) as number,
      lapTimeSeconds: numberValue(telemetry.lapTimeSeconds, "telemetry.lapTimeSeconds", { nullable: true, min: Number.EPSILON, max: 86400 }),
      position: numberValue(telemetry.position, "telemetry.position", { nullable: true, integer: true, min: 1, max: 1000 }),
      classPosition: numberValue(telemetry.classPosition, "telemetry.classPosition", { nullable: true, integer: true, min: 1, max: 1000 }),
      speedKph: numberValue(telemetry.speedKph, "telemetry.speedKph", { max: 500 }) as number,
      fuelLitres: numberValue(telemetry.fuelLitres, "telemetry.fuelLitres", { max: 250 }) as number,
      fuelPerLapLitres: numberValue(telemetry.fuelPerLapLitres, "telemetry.fuelPerLapLitres", { nullable: true, min: Number.EPSILON, max: 50 }),
      estimatedLapsRemaining: numberValue(telemetry.estimatedLapsRemaining, "telemetry.estimatedLapsRemaining", { nullable: true, max: 10000 }),
      inPitLane: booleanValue(telemetry.inPitLane, "telemetry.inPitLane"),
      pitLimiter: booleanValue(telemetry.pitLimiter, "telemetry.pitLimiter"),
      stintElapsedSeconds: numberValue(telemetry.stintElapsedSeconds, "telemetry.stintElapsedSeconds", { max: 604800 }) as number,
      incidents: numberValue(telemetry.incidents, "telemetry.incidents", { nullable: true, integer: true, max: 100000 }),
      flag: telemetry.flag as SimHubFlag,
      isInCar: version === 2 ? booleanValue(telemetry.isInCar, "telemetry.isInCar") : true,
    },
  };
};

// ---------------------------------------------------------------------------
// Telemetry V3 (Phase A) — strict wire contract + one normalized internal DTO.
// V1/V2 parsing above is preserved untouched for existing callers; V3 adds its
// own exact per-version allowlist and normalizes all three versions into the
// same DTO via normalizeTelemetryEnvelope(). Client-independent server fields
// (raceRunId, eventId, teamId, deviceId, ownerUserId, authority, deviceRole)
// are left null at parser stage — they are derived server-side.
// ---------------------------------------------------------------------------

export type SimHubRaceFlag =
  | "green" | "yellow" | "red" | "white" | "checkered"
  | "blue" | "black" | "meatball" | "disqualify";

export type SimHubSessionState =
  | "not_in_world" | "warmup" | "parade_laps" | "racing" | "checkered" | "cool_down" | "unknown";

export type SimHubTrackSurface =
  | "on_track" | "off_track" | "in_pit_stall" | "approaching_pits" | "not_in_world" | "unknown";

export type NormalizedTelemetryEnvelope = {
  protocolVersion: 1 | 2 | 3;
  sequence: number;
  capturedAt: string;
  transportSessionId: string;
  raceRunId: null;
  eventId: null;
  teamId: null;
  deviceId: null;
  ownerUserId: null;
  authority: null;
  deviceRole: null;
  identity: {
    currentDriverId: string | null;
    currentDriverName: string | null;
    carId: string | null;
    carName: string | null;
    trackName: string | null;
    trackConfig: string | null;
  };
  session: {
    isInCar: boolean;
    sessionTimeSeconds: number | null;
    sessionTimeRemainingSeconds: number | null;
    sessionLapsRemaining: number | null;
    flags: SimHubRaceFlag[] | null;
    sessionState: SimHubSessionState;
  };
  timing: {
    currentLapElapsedSeconds: number | null;
    lastLapTimeSeconds: number | null;
    bestLapTimeSeconds: number | null;
  };
  position: {
    position: number | null;
    classPosition: number | null;
    gapToLeaderSeconds: number | null;
  };
  track: {
    lapDistancePct: number | null;
    trackSurface: SimHubTrackSurface;
    onPitRoad: boolean | null;
  };
  fuel: {
    fuelLitres: number | null;
    fuelPct: number | null;
  };
  raceState: {
    incidents: number | null;
  };
  pitService: {
    pitServiceFlagsRaw: number | null;
    requiredRepairSeconds: number | null;
    optionalRepairSeconds: number | null;
  };
};

const raceFlagValues = new Set<SimHubRaceFlag>(["green", "yellow", "red", "white", "checkered", "blue", "black", "meatball", "disqualify"]);
const sessionStateValues = new Set<SimHubSessionState>(["not_in_world", "warmup", "parade_laps", "racing", "checkered", "cool_down", "unknown"]);
const trackSurfaceValues = new Set<SimHubTrackSurface>(["on_track", "off_track", "in_pit_stall", "approaching_pits", "not_in_world", "unknown"]);

type V3NumberRule = {
  nullable?: boolean;
  integer?: boolean;
  min?: number;
  max?: number;
  /** Wire values that normalize to null instead of passing through (SDK sentinels). */
  sentinels?: number[];
};

const v3Number = (value: unknown, path: string, rule: V3NumberRule = {}): number | null => {
  if (rule.nullable && value === null) return null;
  const min = rule.min ?? 0;
  const max = rule.max ?? Number.MAX_SAFE_INTEGER;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path} is invalid`);
  if (rule.integer && !Number.isInteger(value)) throw new Error(`${path} must be an integer`);
  if (rule.sentinels?.includes(value as number)) return null;
  if (value < min || value > max) throw new Error(`${path} is invalid`);
  return value;
};

const v3Enum = <T extends string>(value: unknown, allowed: Set<T>, path: string): T => {
  if (typeof value !== "string" || !allowed.has(value as T)) throw new Error(`${path} is invalid`);
  return value as T;
};

const v3Flags = (value: unknown, path: string): SimHubRaceFlag[] | null => {
  if (value === null) return null;
  if (!Array.isArray(value)) throw new Error(`${path} must be an array or null`);
  return value.map((flag, index) => v3Enum(flag, raceFlagValues, `${path}[${index}]`));
};

const v3Boolean = (value: unknown, path: string): boolean | null => {
  if (value === null) return null;
  if (typeof value !== "boolean") throw new Error(`${path} is invalid`);
  return value;
};

export const parseTelemetryV3Envelope = (input: unknown): NormalizedTelemetryEnvelope => {
  const root = asRecord(input, "payload");
  exactKeys(root, ["protocolVersion", "sequence", "capturedAt", "transportSessionId", "identity", "session", "timing", "position", "track", "fuel", "raceState", "pitService"], "payload");
  if (root.protocolVersion !== 3) throw new Error("unsupported protocolVersion");
  const sequence = v3Number(root.sequence, "payload.sequence", { integer: true, min: 0 }) as number;
  const capturedAt = text(root.capturedAt, "payload.capturedAt", 40);
  if (!Number.isFinite(Date.parse(capturedAt))) throw new Error("payload.capturedAt is invalid");
  const transportSessionId = text(root.transportSessionId, "payload.transportSessionId", 120);

  const identity = asRecord(root.identity, "identity");
  exactKeys(identity, ["currentDriverId", "currentDriverName", "carId", "carName", "trackName", "trackConfig"], "identity");
  const session = asRecord(root.session, "session");
  exactKeys(session, ["isInCar", "sessionTimeSeconds", "sessionTimeRemainingSeconds", "sessionLapsRemaining", "flags", "sessionState"], "session");
  const timing = asRecord(root.timing, "timing");
  exactKeys(timing, ["currentLapElapsedSeconds", "lastLapTimeSeconds", "bestLapTimeSeconds"], "timing");
  const position = asRecord(root.position, "position");
  exactKeys(position, ["position", "classPosition", "gapToLeaderSeconds"], "position");
  const track = asRecord(root.track, "track");
  exactKeys(track, ["lapDistancePct", "trackSurface", "onPitRoad"], "track");
  const fuel = asRecord(root.fuel, "fuel");
  exactKeys(fuel, ["fuelLitres", "fuelPct"], "fuel");
  const raceState = asRecord(root.raceState, "raceState");
  exactKeys(raceState, ["incidents"], "raceState");
  const pitService = asRecord(root.pitService, "pitService");
  exactKeys(pitService, ["pitServiceFlagsRaw", "requiredRepairSeconds", "optionalRepairSeconds"], "pitService");

  return {
    protocolVersion: 3,
    sequence,
    capturedAt,
    transportSessionId,
    raceRunId: null,
    eventId: null,
    teamId: null,
    deviceId: null,
    ownerUserId: null,
    authority: null,
    deviceRole: null,
    identity: {
      currentDriverId: nullableText(identity.currentDriverId, "identity.currentDriverId"),
      currentDriverName: nullableText(identity.currentDriverName, "identity.currentDriverName"),
      carId: nullableText(identity.carId, "identity.carId"),
      carName: nullableText(identity.carName, "identity.carName"),
      trackName: nullableText(identity.trackName, "identity.trackName"),
      trackConfig: nullableText(identity.trackConfig, "identity.trackConfig"),
    },
    session: {
      isInCar: booleanValue(session.isInCar, "session.isInCar"),
      sessionTimeSeconds: v3Number(session.sessionTimeSeconds, "session.sessionTimeSeconds", { nullable: true, min: 0, max: 604800, sentinels: [-1] }),
      sessionTimeRemainingSeconds: v3Number(session.sessionTimeRemainingSeconds, "session.sessionTimeRemainingSeconds", { nullable: true, min: 0, max: 604800, sentinels: [-1, 604800] }),
      sessionLapsRemaining: v3Number(session.sessionLapsRemaining, "session.sessionLapsRemaining", { nullable: true, integer: true, min: 0, max: 100000, sentinels: [-1, 32767] }),
      flags: v3Flags(session.flags, "session.flags"),
      sessionState: v3Enum(session.sessionState, sessionStateValues, "session.sessionState"),
    },
    timing: {
      currentLapElapsedSeconds: v3Number(timing.currentLapElapsedSeconds, "timing.currentLapElapsedSeconds", { nullable: true, min: Number.EPSILON, max: 86400, sentinels: [0, -1] }),
      lastLapTimeSeconds: v3Number(timing.lastLapTimeSeconds, "timing.lastLapTimeSeconds", { nullable: true, min: Number.EPSILON, max: 86400, sentinels: [0, -1] }),
      bestLapTimeSeconds: v3Number(timing.bestLapTimeSeconds, "timing.bestLapTimeSeconds", { nullable: true, min: Number.EPSILON, max: 86400, sentinels: [0, -1] }),
    },
    position: {
      position: v3Number(position.position, "position.position", { nullable: true, integer: true, min: 1, max: 1000, sentinels: [0, -1] }),
      classPosition: v3Number(position.classPosition, "position.classPosition", { nullable: true, integer: true, min: 1, max: 1000, sentinels: [0, -1] }),
      gapToLeaderSeconds: v3Number(position.gapToLeaderSeconds, "position.gapToLeaderSeconds", { nullable: true, min: 0, max: 86400, sentinels: [-1] }),
    },
    track: {
      lapDistancePct: v3Number(track.lapDistancePct, "track.lapDistancePct", { nullable: true, min: 0, max: 1, sentinels: [-1] }),
      trackSurface: v3Enum(track.trackSurface, trackSurfaceValues, "track.trackSurface"),
      onPitRoad: v3Boolean(track.onPitRoad, "track.onPitRoad"),
    },
    fuel: {
      fuelLitres: v3Number(fuel.fuelLitres, "fuel.fuelLitres", { nullable: true, min: 0, max: 250, sentinels: [-1] }),
      fuelPct: v3Number(fuel.fuelPct, "fuel.fuelPct", { nullable: true, min: 0, max: 1, sentinels: [-1] }),
    },
    raceState: {
      incidents: v3Number(raceState.incidents, "raceState.incidents", { nullable: true, integer: true, min: 0, max: 100000, sentinels: [-1] }),
    },
    pitService: {
      pitServiceFlagsRaw: v3Number(pitService.pitServiceFlagsRaw, "pitService.pitServiceFlagsRaw", { nullable: true, integer: true, min: 0, max: 2147483647, sentinels: [-1] }),
      requiredRepairSeconds: v3Number(pitService.requiredRepairSeconds, "pitService.requiredRepairSeconds", { nullable: true, min: 0, max: 86400, sentinels: [-1] }),
      optionalRepairSeconds: v3Number(pitService.optionalRepairSeconds, "pitService.optionalRepairSeconds", { nullable: true, min: 0, max: 86400, sentinels: [-1] }),
    },
  };
};

const v12FlagToFlags = (flag: SimHubFlag, path: string): SimHubRaceFlag[] | null => {
  if (flag === "unknown") return null;
  if (!raceFlagValues.has(flag as SimHubRaceFlag)) throw new Error(`${path} is invalid`);
  return [flag as SimHubRaceFlag];
};

const normalizeV12Envelope = (env: SimHubTelemetryEnvelope): NormalizedTelemetryEnvelope => {
  const sessionLapsRemaining = env.telemetry.estimatedLapsRemaining !== null && Number.isInteger(env.telemetry.estimatedLapsRemaining)
    ? env.telemetry.estimatedLapsRemaining
    : null;
  return {
    protocolVersion: env.protocolVersion,
    sequence: env.sequence,
    capturedAt: env.capturedAt,
    transportSessionId: env.race.sessionId,
    raceRunId: null,
    eventId: null,
    teamId: null,
    deviceId: null,
    ownerUserId: null,
    authority: null,
    deviceRole: null,
    identity: {
      currentDriverId: env.race.currentDriverId,
      currentDriverName: env.race.currentDriverName,
      carId: env.race.carId,
      carName: env.race.carName,
      trackName: env.race.trackName,
      trackConfig: env.race.trackConfig,
    },
    session: {
      isInCar: env.telemetry.isInCar,
      sessionTimeSeconds: env.telemetry.sessionTimeSeconds,
      sessionTimeRemainingSeconds: null,
      sessionLapsRemaining,
      flags: v12FlagToFlags(env.telemetry.flag, "telemetry.flag"),
      sessionState: "unknown",
    },
    timing: {
      currentLapElapsedSeconds: null,
      lastLapTimeSeconds: env.telemetry.lapTimeSeconds,
      bestLapTimeSeconds: null,
    },
    position: {
      position: env.telemetry.position,
      classPosition: env.telemetry.classPosition,
      gapToLeaderSeconds: null,
    },
    track: {
      lapDistancePct: null,
      trackSurface: "unknown",
      onPitRoad: env.telemetry.inPitLane,
    },
    fuel: {
      fuelLitres: env.telemetry.fuelLitres,
      fuelPct: null,
    },
    raceState: { incidents: env.telemetry.incidents },
    pitService: {
      pitServiceFlagsRaw: null,
      requiredRepairSeconds: null,
      optionalRepairSeconds: null,
    },
  };
};

export const normalizeTelemetryEnvelope = (input: unknown): NormalizedTelemetryEnvelope => {
  const root = asRecord(input, "payload");
  const version = root.protocolVersion;
  if (version === 3) return parseTelemetryV3Envelope(input);
  if (version === 1 || version === 2) return normalizeV12Envelope(parseTelemetryEnvelope(input));
  throw new Error("unsupported protocolVersion");
};

export const normalizePairCode = (value: unknown): string => {
  if (typeof value !== "string") return "";
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
};

export const randomPairCode = (): string => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const raw = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
};

export const randomDeviceToken = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

export const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const edgeRateWindowStarted = new Float64Array(4096);
const edgeRateCounts = new Uint32Array(4096);
export const consumeEdgeRateLimit = async (identifier: string, limit: number, windowMs: number): Promise<boolean> => {
  const digest = await sha256Hex(identifier);
  const shard = Number.parseInt(digest.slice(0, 3), 16);
  const now = Date.now();
  if (!edgeRateWindowStarted[shard] || now - edgeRateWindowStarted[shard] >= windowMs) {
    edgeRateWindowStarted[shard] = now;
    edgeRateCounts[shard] = 0;
  }
  if (edgeRateCounts[shard] >= limit) return false;
  edgeRateCounts[shard] += 1;
  return true;
};

export const allowedOrigins = (): Set<string> => new Set(
  (globalThis as { Deno?: { env: { get(name: string): string | undefined } } }).Deno?.env.get("SIMHUB_ALLOWED_ORIGINS")
    ?.split(",").map((origin) => origin.trim()).filter(Boolean)
  ?? ["https://3stripemotorsport.cc", "https://www.3stripemotorsport.cc", "http://localhost:8080", "http://127.0.0.1:8080"]
);

export const corsHeadersFor = (request: Request): Record<string, string> => {
  const origin = request.headers.get("origin");
  const allowed = allowedOrigins();
  return {
    "Access-Control-Allow-Origin": origin && allowed.has(origin) ? origin : "https://3stripemotorsport.cc",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
};

export const assertAllowedOrigin = (request: Request) => {
  const origin = request.headers.get("origin");
  if (origin && !allowedOrigins().has(origin)) throw new Error("origin_not_allowed");
};

export const jsonResponse = (request: Request, body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeadersFor(request), "Content-Type": "application/json", "Cache-Control": "no-store" },
});

export const readBoundedJson = async (request: Request, maxBytes = 24576): Promise<unknown> => {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) throw new Error("unsupported_media_type");
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new Error("payload_too_large");
  const raw = await request.text();
  if (encoder.encode(raw).byteLength > maxBytes) throw new Error("payload_too_large");
  try { return JSON.parse(raw); } catch { throw new Error("invalid_json"); }
};
