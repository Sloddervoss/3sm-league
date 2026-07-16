import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.7";
import { assertAllowedOrigin, consumeEdgeRateLimit, jsonResponse, parseTelemetryEnvelope, readBoundedJson, sha256Hex } from "../_shared/simhub.ts";

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

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return jsonResponse(request, { ok: true });
  if (request.method !== "POST") return jsonResponse(request, { error: "method_not_allowed" }, 405);

  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error("server_not_configured");
    assertAllowedOrigin(request);
    const token = deviceToken(request);
    if (!token) return jsonResponse(request, { error: "invalid_device" }, 401);

    const tokenHash = await sha256Hex(token);
    const addressAllowed = await consumeEdgeRateLimit(`ingest-address:${clientAddress(request)}`, 600, 60 * 1000);
    if (!addressAllowed) return jsonResponse(request, { error: "rate_limited" }, 429);

    const envelope = parseTelemetryEnvelope(await readBoundedJson(request));
    const { data, error } = await service.rpc("simhub_ingest_snapshot", {
      p_token_hash: tokenHash,
      p_session_id: envelope.race.sessionId,
      p_sequence: envelope.sequence,
      p_captured_at: envelope.capturedAt,
      p_connector_id: envelope.source.connectorId,
      p_simhub_version: envelope.source.simHubVersion,
      p_game: envelope.source.game,
      p_telemetry: envelope.telemetry,
    });
    if (error) throw error;

    const result = data?.[0];
    if (!result) throw new Error("empty_ingest_result");
    if (result.result === "invalid_device") return jsonResponse(request, { error: "invalid_device" }, 401);
    if (result.result === "rate_limited") return jsonResponse(request, { error: "rate_limited" }, 429);
    if (result.result === "session_limit") return jsonResponse(request, { error: "device_session_limit" }, 409);
    if (result.result === "replayed") return jsonResponse(request, { error: "replayed" }, 409);
    if (result.result !== "accepted") return jsonResponse(request, { error: result.result }, 400);
    return jsonResponse(request, { accepted: true, receivedAt: result.received_at }, 202);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    if (message === "origin_not_allowed") return jsonResponse(request, { error: message }, 403);
    if (message === "payload_too_large") return jsonResponse(request, { error: message }, 413);
    if (message === "unsupported_media_type") return jsonResponse(request, { error: message }, 415);
    if (message === "invalid_json") return jsonResponse(request, { error: message }, 400);
    if (/^(payload|source|race|telemetry|sequence|capturedAt|unsupported protocolVersion|only IRacing)/.test(message)) {
      return jsonResponse(request, { error: "invalid_payload" }, 422);
    }
    console.error("simhub-ingest internal failure", error instanceof Error ? error.name : "unknown");
    return jsonResponse(request, { error: "internal_error" }, 500);
  }
});
