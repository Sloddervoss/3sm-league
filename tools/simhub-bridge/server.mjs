import { createServer as createHttpServer } from "node:http";
import { pathToFileURL } from "node:url";
import { telemetryStreamKey, validateTelemetryEnvelope } from "./contract.mjs";

const json = (response, status, body, origin) => {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...(origin ? { "access-control-allow-origin": origin, vary: "Origin" } : {}),
  });
  response.end(JSON.stringify(body));
};

const readJson = async (request, limit = 32_768) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error("payload is groter dan 32 KB");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};

export const createSimHubBridge = ({ token, allowedOrigins = [], now = () => Date.now() }) => {
  if (!token || token.length < 12) throw new Error("SIMHUB_BRIDGE_TOKEN moet minimaal 12 tekens bevatten");
  const latestByTeam = new Map();
  const lastSequenceByStream = new Map();
  const allowed = new Set(allowedOrigins);

  return createHttpServer(async (request, response) => {
    const origin = request.headers.origin;
    const corsOrigin = origin && allowed.has(origin) ? origin : undefined;
    if (origin && !corsOrigin) return json(response, 403, { error: "origin niet toegestaan" });
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        ...(corsOrigin ? { "access-control-allow-origin": corsOrigin, vary: "Origin" } : {}),
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "authorization,content-type",
        ...(request.headers["access-control-request-private-network"] === "true" ? { "access-control-allow-private-network": "true" } : {}),
        "access-control-max-age": "600",
      });
      return response.end();
    }

    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/health") return json(response, 200, { ok: true, service: "3sm-simhub-bridge", protocolVersion: 1 }, corsOrigin);
    if (request.headers.authorization !== `Bearer ${token}`) return json(response, 401, { error: "ongeldig pairingtoken" }, corsOrigin);

    try {
      if (request.method === "POST" && url.pathname === "/v1/telemetry") {
        const payload = validateTelemetryEnvelope(await readJson(request));
        const streamKey = telemetryStreamKey(payload);
        const previousSequence = lastSequenceByStream.get(streamKey);
        if (previousSequence !== undefined && payload.sequence <= previousSequence) return json(response, 409, { error: "sequence is niet oplopend" }, corsOrigin);
        const receivedAt = new Date(now()).toISOString();
        lastSequenceByStream.set(streamKey, payload.sequence);
        latestByTeam.set(`${payload.race.eventId}:${payload.race.teamId}`, { payload, receivedAt });
        return json(response, 202, { accepted: true, sequence: payload.sequence, receivedAt }, corsOrigin);
      }
      if (request.method === "GET" && url.pathname === "/v1/telemetry") {
        const eventId = url.searchParams.get("eventId");
        const teamId = url.searchParams.get("teamId");
        if (!eventId || !teamId) return json(response, 400, { error: "eventId en teamId zijn verplicht" }, corsOrigin);
        const latest = latestByTeam.get(`${eventId}:${teamId}`);
        return latest ? json(response, 200, latest, corsOrigin) : json(response, 404, { error: "nog geen telemetry voor dit team" }, corsOrigin);
      }
      return json(response, 404, { error: "route niet gevonden" }, corsOrigin);
    } catch (error) {
      return json(response, 400, { error: error instanceof Error ? error.message : "ongeldige aanvraag" }, corsOrigin);
    }
  });
};

export const startBridge = ({
  port = Number(process.env.SIMHUB_BRIDGE_PORT ?? 8787),
  host = process.env.SIMHUB_BRIDGE_HOST ?? "127.0.0.1",
  token = process.env.SIMHUB_BRIDGE_TOKEN ?? "local-3sm-simhub-spike",
  allowedOrigins = (process.env.SIMHUB_ALLOWED_ORIGINS ?? "http://127.0.0.1:8082,http://localhost:8082,http://192.168.50.104:8082").split(",").filter(Boolean),
} = {}) => {
  const server = createSimHubBridge({ token, allowedOrigins });
  server.listen(port, host, () => console.log(`3SM SimHub bridge luistert op http://${host}:${port}`));
  return server;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startBridge();
