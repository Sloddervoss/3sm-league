import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.7";
import { assertAllowedOrigin, consumeEdgeRateLimit, jsonResponse, readBoundedJson, sha256Hex } from "../_shared/simhub.ts";
import { resolveTelemetryContext } from "./context.ts";

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

    // Auth gate: Bearer token
    const token = deviceToken(request);
    if (!token) return jsonResponse(request, { error: "invalid_device" }, 401);

    // Rate limit by client address
    const addressAllowed = await consumeEdgeRateLimit(`ingest-v3-address:${clientAddress(request)}`, 600, 60 * 1000);
    if (!addressAllowed) return jsonResponse(request, { error: "rate_limited" }, 429);

    // Read and parse raw body
    const rawBody = await readBoundedJson(request);
    const root = rawBody as Record<string, unknown>;
    const version = root?.protocolVersion;

    // V1/V2 dispatch to existing production handler path
    if (version === 1 || version === 2) {
      // Reuse the existing simhub-ingest handler's 15-param RPC
      const envelope = (await import("../_shared/simhub.ts")).parseTelemetryEnvelope(rawBody);
      const { data, error } = await service.rpc("simhub_ingest_snapshot", {
        p_token_hash: await sha256Hex(token),
        p_session_id: envelope.race.sessionId,
        p_sequence: envelope.sequence,
        p_captured_at: envelope.capturedAt,
        p_connector_id: envelope.source.connectorId,
        p_simhub_version: envelope.source.simHubVersion,
        p_game: envelope.source.game,
        p_telemetry: envelope.telemetry,
        p_driver_id: envelope.race.driverId,
        p_current_driver_id: envelope.race.currentDriverId,
        p_current_driver_name: envelope.race.currentDriverName,
        p_car_id: envelope.race.carId,
        p_car_name: envelope.race.carName,
        p_track_name: envelope.race.trackName,
        p_track_config: envelope.race.trackConfig,
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
    }

    // V3 dispatch via context resolution + Phase E persistence
    if (version === 3) {
      const context = await resolveTelemetryContext(token, rawBody, service, sha256Hex);

      if (context.result === "invalid_device") return jsonResponse(request, { error: "invalid_device" }, 401);
      if (context.result === "revoked") return jsonResponse(request, { error: "invalid_device" }, 401);
      if (context.result === "unsupported_version") return jsonResponse(request, { error: "invalid_payload" }, 422);
      if (context.result === "invalid_payload") return jsonResponse(request, { error: "invalid_payload" }, 422);
      if (context.result === "not_bound") return jsonResponse(request, { error: context.result }, 403);
      if (context.result === "not_authority") return jsonResponse(request, { error: context.result }, 403);

      // Transactionality, write-time authority, source baselines and all event
      // writes live in the service-role-only database RPC; Edge makes one call.
      const { data, error } = await service.rpc("simhub_persist_v3", {
        p_token_hash: await sha256Hex(token),
        p_session_id: context.normalized!.transportSessionId,
        p_sequence: context.normalized!.sequence,
        p_captured_at: context.normalized!.capturedAt,
        p_v3_normalized: context.normalized,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      const result = row?.result;
      if (result === "not_authority" || result === "not_bound" || result === "not_registered") return jsonResponse(request, { error: result }, 403);
      if (result === "invalid_device" || result === "revoked") return jsonResponse(request, { error: "invalid_device" }, 401);
      if (result === "replayed") return jsonResponse(request, { error: "replayed" }, 409);
      if (result === "invalid_payload") return jsonResponse(request, { error: result }, 422);
      if (result !== "accepted") return jsonResponse(request, { error: "internal_error" }, 500);

      // 0.4.3: server-side opponent sampled history (UI-independent). Best-effort:
      // sampling failure must NOT break core telemetry ingest (option B). Only when
      // opponents exist and a race run is active.
      try {
        const opponents = context.normalized?.opponents ?? null;
        if (
          Array.isArray(opponents) && opponents.length > 0 &&
          context.raceRunId && context.eventId && context.teamId && context.deviceId
        ) {
          await service.rpc("record_opponent_gap_samples", {
            p_race_run_id: context.raceRunId,
            p_event_id: context.eventId,
            p_team_id: context.teamId,
            p_device_id: context.deviceId,
            p_session_id: context.normalized!.transportSessionId,
            p_seq: context.normalized!.sequence,
            p_captured_at: context.normalized!.capturedAt,
            p_opponents: opponents,
          });
        }
      } catch (sampleErr) {
        // Option B (documented): sampling failure is non-fatal; core ingest already done.
        console.error("simhub-ingest-v3 opponent sampling non-fatal", (sampleErr as Error).message ?? "unknown");
      }

      return jsonResponse(request, { accepted: true, receivedAt: row.received_at }, 202);
    }

    // Unknown protocol version
    return jsonResponse(request, { error: "invalid_payload" }, 422);

  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    if (message === "origin_not_allowed") return jsonResponse(request, { error: message }, 403);
    if (message === "payload_too_large") return jsonResponse(request, { error: message }, 413);
    if (message === "unsupported_media_type") return jsonResponse(request, { error: message }, 415);
    if (message === "invalid_json") return jsonResponse(request, { error: message }, 400);
    if (/^(payload|source|race|telemetry|sequence|capturedAt|unsupported protocolVersion)/.test(message)) {
      return jsonResponse(request, { error: "invalid_payload" }, 422);
    }
    console.error("simhub-ingest-v3 internal failure", error instanceof Error ? error.name : "unknown");
    return jsonResponse(request, { error: "internal_error" }, 500);
  }
});