export type SimHubFlag = "green" | "yellow" | "red" | "white" | "checkered" | "unknown";

export type SimHubTelemetryEnvelope = {
  protocolVersion: 1;
  sequence: number;
  capturedAt: string;
  source: { connectorId: string; simHubVersion: string; game: "IRacing" };
  race: { eventId: string; teamId: string; sessionId: string; driverId: string | null };
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
  if (root.protocolVersion !== 1) throw new Error("unsupported protocolVersion");
  const sequence = numberValue(root.sequence, "sequence", { integer: true }) as number;
  const capturedAt = text(root.capturedAt, "capturedAt", 40);
  if (!Number.isFinite(Date.parse(capturedAt))) throw new Error("capturedAt is invalid");

  const source = asRecord(root.source, "source");
  exactKeys(source, ["connectorId", "simHubVersion", "game"], "source");
  if (source.game !== "IRacing") throw new Error("only IRacing is supported");

  const race = asRecord(root.race, "race");
  exactKeys(race, ["eventId", "teamId", "sessionId", "driverId"], "race");

  const telemetry = asRecord(root.telemetry, "telemetry");
  exactKeys(telemetry, ["connected", "sessionTimeSeconds", "lap", "completedLaps", "lapTimeSeconds", "position", "classPosition", "speedKph", "fuelLitres", "fuelPerLapLitres", "estimatedLapsRemaining", "inPitLane", "pitLimiter", "stintElapsedSeconds", "incidents", "flag"], "telemetry");
  if (typeof telemetry.flag !== "string" || !flagValues.has(telemetry.flag as SimHubFlag)) throw new Error("telemetry.flag is invalid");

  return {
    protocolVersion: 1,
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
    },
  };
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
