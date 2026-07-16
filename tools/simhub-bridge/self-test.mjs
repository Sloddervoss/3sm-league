import { once } from "node:events";
import { createSimHubBridge } from "./server.mjs";

const token = "self-test-token-123";
const server = createSimHubBridge({ token, allowedOrigins: ["http://192.168.50.104:8082"] });
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
if (!address || typeof address === "string") throw new Error("testbridge heeft geen TCP-poort");
const base = `http://127.0.0.1:${address.port}`;
const payload = {
  protocolVersion: 1,
  sequence: 1,
  capturedAt: "2026-07-16T12:00:00.000Z",
  source: { connectorId: "self-test", simHubVersion: "9.11.21", game: "IRacing" },
  race: { eventId: "event-road-america-6h", teamId: "team-orange-31", sessionId: "session-test", driverId: "user-jaimy" },
  telemetry: { connected: true, sessionTimeSeconds: 10, lap: 1, completedLaps: 0, lapTimeSeconds: null, position: 7, classPosition: 3, speedKph: 210, fuelLitres: 90, fuelPerLapLitres: 3, estimatedLapsRemaining: 30, inPitLane: false, pitLimiter: false, stintElapsedSeconds: 10, incidents: 0, flag: "green" },
};
const post = (body, authorization = token) => fetch(`${base}/v1/telemetry`, { method: "POST", headers: { authorization: `Bearer ${authorization}`, "content-type": "application/json" }, body: JSON.stringify(body) });

try {
  const health = await fetch(`${base}/health`);
  if (health.status !== 200) throw new Error(`health=${health.status}`);
  const preflight = await fetch(`${base}/v1/telemetry`, { method: "OPTIONS", headers: { origin: "http://192.168.50.104:8082", "access-control-request-private-network": "true" } });
  if (preflight.status !== 204 || preflight.headers.get("access-control-allow-private-network") !== "true") throw new Error("private-network preflight mislukt");
  const rejectedOrigin = await fetch(`${base}/health`, { headers: { origin: "https://3stripemotorsport.cc" } });
  if (rejectedOrigin.status !== 403) throw new Error(`rejected-origin=${rejectedOrigin.status}`);
  const unauthorized = await post(payload, "wrong-token-value");
  if (unauthorized.status !== 401) throw new Error(`unauthorized=${unauthorized.status}`);
  const accepted = await post(payload);
  if (accepted.status !== 202) throw new Error(`accepted=${accepted.status} ${await accepted.text()}`);
  const replay = await post(payload);
  if (replay.status !== 409) throw new Error(`replay=${replay.status}`);
  const latest = await fetch(`${base}/v1/telemetry?eventId=event-road-america-6h&teamId=team-orange-31`, { headers: { authorization: `Bearer ${token}` } });
  const latestBody = await latest.json();
  if (latest.status !== 200 || latestBody.payload.sequence !== 1 || latestBody.payload.telemetry.fuelLitres !== 90) throw new Error("latest telemetry klopt niet");
  const invalid = structuredClone(payload);
  invalid.telemetry.speedKph = 900;
  invalid.sequence = 2;
  const invalidResponse = await post(invalid);
  if (invalidResponse.status !== 400) throw new Error(`invalid=${invalidResponse.status}`);
  console.log("OK: auth, validatie, replaybeveiliging en latest-teamtelemetry werken");
} finally {
  server.close();
  await once(server, "close");
}
