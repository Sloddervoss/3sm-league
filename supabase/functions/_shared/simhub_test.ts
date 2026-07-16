import { consumeEdgeRateLimit, normalizePairCode, parseTelemetryEnvelope, randomDeviceToken, randomPairCode, readBoundedJson, sha256Hex } from "./simhub.ts";

declare const Deno: {
  test(name: string, test: () => void | Promise<void>): void;
};

const validEnvelope = () => ({
  protocolVersion: 1,
  sequence: 12,
  capturedAt: "2026-07-16T16:00:00.000Z",
  source: { connectorId: "SIM-PC", simHubVersion: "9.11.21.0", game: "IRacing" },
  race: {
    eventId: "33333333-3333-4333-8333-333333333333",
    teamId: "44444444-4444-4444-8444-444444444444",
    sessionId: "simhub-session",
    driverId: "22222222-2222-4222-8222-222222222222",
  },
  telemetry: {
    connected: true,
    sessionTimeSeconds: 3600,
    lap: 18,
    completedLaps: 17,
    lapTimeSeconds: 121.25,
    position: 4,
    classPosition: 2,
    speedKph: 247.1,
    fuelLitres: 44.8,
    fuelPerLapLitres: 3.2,
    estimatedLapsRemaining: 14,
    inPitLane: false,
    pitLimiter: false,
    stintElapsedSeconds: 2700,
    incidents: 2,
    flag: "green",
  },
});

Deno.test("strict telemetry parser accepts protocol v1", () => {
  const parsed = parseTelemetryEnvelope(validEnvelope());
  if (parsed.sequence !== 12 || parsed.telemetry.fuelLitres !== 44.8) throw new Error("valid payload changed");
});

Deno.test("strict telemetry parser rejects unknown fields", () => {
  const candidate = validEnvelope();
  const withUnknown = { ...candidate, telemetry: { ...candidate.telemetry, raw: "forbidden" } };
  let rejected = false;
  try { parseTelemetryEnvelope(withUnknown); } catch { rejected = true; }
  if (!rejected) throw new Error("unknown field was accepted");
});

Deno.test("strict telemetry parser rejects whitespace-only identifiers", () => {
  const candidate = validEnvelope();
  candidate.race.driverId = "   ";
  let rejected = false;
  try { parseTelemetryEnvelope(candidate); } catch { rejected = true; }
  if (!rejected) throw new Error("whitespace-only driverId was accepted");
});

Deno.test("pairing codes normalize and secrets are random-sized", async () => {
  const code = randomPairCode();
  if (!/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code)) throw new Error("invalid pairing code");
  if (normalizePairCode(code).length !== 8) throw new Error("normalization failed");
  const tokenA = randomDeviceToken();
  const tokenB = randomDeviceToken();
  if (tokenA.length < 40 || tokenA === tokenB) throw new Error("device token entropy failed");
  if (!/^[0-9a-f]{64}$/.test(await sha256Hex(tokenA))) throw new Error("hash failed");
});

Deno.test("bounded JSON rejects oversized bodies", async () => {
  const request = new Request("https://example.test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ value: "x".repeat(200) }) });
  let rejected = false;
  try { await readBoundedJson(request, 32); } catch (error) { rejected = error instanceof Error && error.message === "payload_too_large"; }
  if (!rejected) throw new Error("oversized body was accepted");
});

Deno.test("bounded JSON rejects non-JSON content", async () => {
  const request = new Request("https://example.test", { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" });
  let rejected = false;
  try { await readBoundedJson(request); } catch (error) { rejected = error instanceof Error && error.message === "unsupported_media_type"; }
  if (!rejected) throw new Error("non-JSON body was accepted");
});

Deno.test("bounded edge limiter rejects requests after the shard limit without database state", async () => {
  const identifier = `test-${crypto.randomUUID()}`;
  if (!await consumeEdgeRateLimit(identifier, 2, 60_000)) throw new Error("first request should pass");
  if (!await consumeEdgeRateLimit(identifier, 2, 60_000)) throw new Error("second request should pass");
  if (await consumeEdgeRateLimit(identifier, 2, 60_000)) throw new Error("third request should be limited");
});
