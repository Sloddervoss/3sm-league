export type SimHubFlag = "green" | "yellow" | "red" | "white" | "checkered" | "unknown";
export interface SimHubTelemetryEnvelope {
  protocolVersion: 1; sequence: number; capturedAt: string;
  source: { connectorId: string; simHubVersion: string; game: "IRacing" };
  race: { eventId: string; teamId: string; sessionId: string; driverId: string | null };
  telemetry: {
    connected: boolean; sessionTimeSeconds: number; lap: number; completedLaps: number; lapTimeSeconds: number | null;
    position: number | null; classPosition: number | null; speedKph: number; fuelLitres: number; fuelPerLapLitres: number | null;
    estimatedLapsRemaining: number | null; inPitLane: boolean; pitLimiter: boolean; stintElapsedSeconds: number; incidents: number | null; flag: SimHubFlag;
  };
}
export interface SimHubBridgeResponse { payload: SimHubTelemetryEnvelope; receivedAt: string }

const flags = new Set<SimHubFlag>(["green", "yellow", "red", "white", "checkered", "unknown"]);
const record = (value: unknown, path: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} moet een object zijn`);
  return value as Record<string, unknown>;
};
const exact = (value: Record<string, unknown>, expected: string[], path: string) => {
  const keys = Object.keys(value).sort(); const wanted = [...expected].sort();
  if (keys.length !== wanted.length || keys.some((key, index) => key !== wanted[index])) throw new Error(`${path} bevat onbekende of ontbrekende velden`);
};
const text = (value: unknown, path: string, nullable = false, max = 120) => {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${path} is ongeldig`);
  return value.trim();
};
function numeric(value: unknown, path: string, options: { nullable: true; integer?: boolean; min?: number; max?: number }): number | null;
function numeric(value: unknown, path: string, options?: { nullable?: false; integer?: boolean; min?: number; max?: number }): number;
function numeric(value: unknown, path: string, options: { nullable?: boolean; integer?: boolean; min?: number; max?: number } = {}) {
  if (options.nullable && value === null) return null;
  const min = options.min ?? 0; const max = options.max ?? Number.MAX_SAFE_INTEGER;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (options.integer && !Number.isInteger(value))) throw new Error(`${path} is ongeldig`);
  return value;
}
const bool = (value: unknown, path: string) => { if (typeof value !== "boolean") throw new Error(`${path} is ongeldig`); return value; };

export const parseSimHubBridgeResponse = (input: unknown): SimHubBridgeResponse => {
  const root = record(input, "response"); exact(root, ["payload", "receivedAt"], "response");
  const receivedAt = text(root.receivedAt, "receivedAt")!; if (!Number.isFinite(Date.parse(receivedAt))) throw new Error("receivedAt is geen ISO-datum");
  const payload = record(root.payload, "payload"); exact(payload, ["protocolVersion", "sequence", "capturedAt", "source", "race", "telemetry"], "payload");
  if (payload.protocolVersion !== 1) throw new Error("protocolVersion wordt niet ondersteund");
  const capturedAt = text(payload.capturedAt, "capturedAt")!; if (!Number.isFinite(Date.parse(capturedAt))) throw new Error("capturedAt is geen ISO-datum");
  const source = record(payload.source, "source"); exact(source, ["connectorId", "simHubVersion", "game"], "source");
  if (source.game !== "IRacing") throw new Error("alleen iRacing wordt ondersteund");
  const race = record(payload.race, "race"); exact(race, ["eventId", "teamId", "sessionId", "driverId"], "race");
  const telemetry = record(payload.telemetry, "telemetry");
  exact(telemetry, ["connected", "sessionTimeSeconds", "lap", "completedLaps", "lapTimeSeconds", "position", "classPosition", "speedKph", "fuelLitres", "fuelPerLapLitres", "estimatedLapsRemaining", "inPitLane", "pitLimiter", "stintElapsedSeconds", "incidents", "flag"], "telemetry");
  if (typeof telemetry.flag !== "string" || !flags.has(telemetry.flag as SimHubFlag)) throw new Error("telemetry.flag is ongeldig");
  return {
    receivedAt,
    payload: {
      protocolVersion: 1, sequence: numeric(payload.sequence, "sequence", { integer: true }), capturedAt,
      source: { connectorId: text(source.connectorId, "source.connectorId")!, simHubVersion: text(source.simHubVersion, "source.simHubVersion", false, 60)!, game: "IRacing" },
      race: { eventId: text(race.eventId, "race.eventId")!, teamId: text(race.teamId, "race.teamId")!, sessionId: text(race.sessionId, "race.sessionId")!, driverId: text(race.driverId, "race.driverId", true) },
      telemetry: {
        connected: bool(telemetry.connected, "telemetry.connected"), sessionTimeSeconds: numeric(telemetry.sessionTimeSeconds, "telemetry.sessionTimeSeconds", { max: 604800 }), lap: numeric(telemetry.lap, "telemetry.lap", { integer: true, max: 100000 }), completedLaps: numeric(telemetry.completedLaps, "telemetry.completedLaps", { integer: true, max: 100000 }),
        lapTimeSeconds: numeric(telemetry.lapTimeSeconds, "telemetry.lapTimeSeconds", { nullable: true, min: Number.EPSILON, max: 86400 }), position: numeric(telemetry.position, "telemetry.position", { nullable: true, integer: true, min: 1, max: 1000 }), classPosition: numeric(telemetry.classPosition, "telemetry.classPosition", { nullable: true, integer: true, min: 1, max: 1000 }),
        speedKph: numeric(telemetry.speedKph, "telemetry.speedKph", { max: 500 }), fuelLitres: numeric(telemetry.fuelLitres, "telemetry.fuelLitres", { max: 250 }), fuelPerLapLitres: numeric(telemetry.fuelPerLapLitres, "telemetry.fuelPerLapLitres", { nullable: true, min: Number.EPSILON, max: 50 }), estimatedLapsRemaining: numeric(telemetry.estimatedLapsRemaining, "telemetry.estimatedLapsRemaining", { nullable: true, max: 10000 }),
        inPitLane: bool(telemetry.inPitLane, "telemetry.inPitLane"), pitLimiter: bool(telemetry.pitLimiter, "telemetry.pitLimiter"), stintElapsedSeconds: numeric(telemetry.stintElapsedSeconds, "telemetry.stintElapsedSeconds", { max: 604800 }), incidents: numeric(telemetry.incidents, "telemetry.incidents", { nullable: true, integer: true, max: 100000 }), flag: telemetry.flag as SimHubFlag,
      },
    },
  };
};

export const getSimHubTelemetryState = (receivedAt: string, now = Date.now()): "live" | "stale" | "offline" => {
  const age = now - Date.parse(receivedAt);
  if (!Number.isFinite(age) || age > 30_000) return "offline";
  return age <= 5_000 ? "live" : "stale";
};

export const normalizeLocalBridgeUrl = (value: string) => {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("De lokale bridge-URL moet http://127.0.0.1 of http://localhost gebruiken.");
  return url.origin;
};

export const readLocalSimHubTelemetry = async ({ baseUrl, token, eventId, teamId, signal }: { baseUrl: string; token: string; eventId: string; teamId: string; signal?: AbortSignal }): Promise<SimHubBridgeResponse | null> => {
  if (token.length < 12) throw new Error("Het pairingtoken moet minimaal 12 tekens bevatten.");
  const origin = normalizeLocalBridgeUrl(baseUrl);
  const query = new URLSearchParams({ eventId, teamId });
  const response = await fetch(`${origin}/v1/telemetry?${query}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store", signal });
  if (response.status === 404) return null;
  if (response.status === 401) throw new Error("Pairingtoken geweigerd door de lokale bridge.");
  if (!response.ok) throw new Error(`Lokale SimHub-bridge antwoordde met HTTP ${response.status}.`);
  return parseSimHubBridgeResponse(await response.json());
};
