import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.7";
import {
  assertAllowedOrigin,
  consumeEdgeRateLimit,
  jsonResponse,
  parseTelemetryEnvelope,
  readBoundedJson,
  sha256Hex,
} from "../_shared/simhub.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const deviceToken = (request: Request): string => {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.toLowerCase().startsWith("bearer ")) return "";
  const token = authorization.slice(7).trim();
  return token.length >= 32 && token.length <= 160 ? token : "";
};

const clientAddress = (request: Request): string => (
  request.headers.get("cf-connecting-ip")
  || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  || "unknown"
);

// Haal de statistieken van de *laatst voltooide* ronde uit het telemetry-envelope.
// SimHub stuurt per ronde een snapshot; lapTimeSeconds is de tijd van de ronde
// die net gereden is, fuelPerLapLitres het verbruik. We slaan alleen een ronde
// op als er een geldige rondetijd aanwezig is (een nieuwe ronde is voltooid).
const lapFromEnvelope = (envelope: ReturnType<typeof parseTelemetryEnvelope>) => {
  const t = envelope.telemetry;
  if (t.lapTimeSeconds === null || t.lapTimeSeconds <= 0) return null;
  return {
    lapSeconds: t.lapTimeSeconds,
    fuelUsedLitres: t.fuelPerLapLitres ?? null,
    fuelPerLapLitres: t.fuelPerLapLitres ?? null,
    incidents: t.incidents ?? 0,
    carId: null,
    circuit: null,
  };
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return jsonResponse(request, { ok: true });
  if (request.method !== "POST") return jsonResponse(request, { error: "method_not_allowed" }, 405);

  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error("server_not_configured");
    assertAllowedOrigin(request);
    const token = deviceToken(request);
    if (!token) return jsonResponse(request, { error: "invalid_device" }, 401);

    const tokenHash = await sha256Hex(token);
    const addressAllowed = await consumeEdgeRateLimit(`practice-address:${clientAddress(request)}`, 600, 60 * 1000);
    if (!addressAllowed) return jsonResponse(request, { error: "rate_limited" }, 429);

    const raw = await readBoundedJson(request) as { session_id?: unknown } & Record<string, unknown>;
    const sessionId = typeof raw?.session_id === "string" && /^[0-9a-f-]{36}$/i.test(raw.session_id) ? raw.session_id : "";
    if (!sessionId) return jsonResponse(request, { error: "invalid_request: session_id vereist" }, 400);

    // parseTelemetryEnvelope verwacht exact de envelope-keys (geen extra velden);
    // haal session_id er eerst uit en parse de rest als envelope.
    const { session_id: _sessionId, ...envelopeOnly } = raw;
    const envelope = parseTelemetryEnvelope(envelopeOnly);
    const lap = lapFromEnvelope(envelope);
    if (!lap) return jsonResponse(request, { accepted: true, recorded: false, reason: "geen voltooide ronde" }, 202);

    const { data, error } = await service.rpc("endurance_record_practice_lap", {
      p_session_id: sessionId,
      p_device_token_hash: tokenHash,
      p_lap_seconds: lap.lapSeconds,
      p_fuel_used_litres: lap.fuelUsedLitres,
      p_fuel_per_lap_litres: lap.fuelPerLapLitres,
      p_incident_count: lap.incidents,
      p_car_id: lap.carId,
      p_circuit: lap.circuit,
      p_recorded_at: envelope.capturedAt,
    });
    if (error) throw error;
    const result = data?.[0];
    if (!result) return jsonResponse(request, { error: "empty_rpc_result" }, 500);

    if (result.result === "not_registered") return jsonResponse(request, { accepted: true, recorded: false, reason: "niet ingeschreven" }, 202);
    if (result.result !== "accepted") {
      const status = result.result === "invalid_device" ? 401 : result.result === "no_active_session" ? 409 : 400;
      return jsonResponse(request, { error: result.result }, status);
    }
    return jsonResponse(request, { accepted: true, recorded: true, user_id: result.user_id, lap_id: result.lap_id }, 202);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    if (message === "origin_not_allowed") return jsonResponse(request, { error: message }, 403);
    if (message === "payload_too_large") return jsonResponse(request, { error: message }, 413);
    if (message === "invalid_json") return jsonResponse(request, { error: message }, 400);
    if (/^(payload|source|race|telemetry|sequence|capturedAt|unsupported|only IRacing)/.test(message)) {
      return jsonResponse(request, { error: "invalid_payload" }, 422);
    }
    console.error("simhub-practice internal failure", message);
    return jsonResponse(request, { error: "internal_error" }, 500);
  }
});
