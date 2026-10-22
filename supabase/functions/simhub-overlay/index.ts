import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.7";
import { assertAllowedOrigin, consumeEdgeRateLimit, jsonResponse, sha256Hex } from "../_shared/simhub.ts";

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

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return jsonResponse(request, { ok: true });
  if (request.method !== "POST") return jsonResponse(request, { error: "method_not_allowed" }, 405);

  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error("server_not_configured");
    assertAllowedOrigin(request);

    const token = deviceToken(request);
    if (!token) return jsonResponse(request, { error: "invalid_device" }, 401);
    const tokenHash = await sha256Hex(token);

    // De plugin pollt every 15 s (60 s buiten een sessie). 40/min laat ruimte
    // voor meerdere clients achter hetzelfde adres zonder de database te belasten.
    const allowed = await consumeEdgeRateLimit(`overlay:${tokenHash}`, 40, 60 * 1000);
    if (!allowed) return jsonResponse(request, { error: "rate_limited", retryAfterSeconds: 60 }, 429);

    const { data, error } = await service.rpc("simhub_overlay_snapshot", {
      p_token_hash: tokenHash,
    });
    if (error) throw error;

    if (data && typeof data === "object" && "error" in data) {
      const code = String((data as { error: unknown }).error ?? "not_bound");
      if (code === "invalid_device") return jsonResponse(request, { error: code }, 401);
      if (code === "not_bound") return jsonResponse(request, { error: code }, 409);
      return jsonResponse(request, { error: code }, 503);
    }

    return jsonResponse(request, data, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    if (message === "origin_not_allowed") return jsonResponse(request, { error: message }, 403);
    console.error("simhub-overlay internal failure", error instanceof Error ? error.name : "unknown");
    return jsonResponse(request, { error: "db_unavailable" }, 503);
  }
});
