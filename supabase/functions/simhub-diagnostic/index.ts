import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.7";
import { assertAllowedOrigin, consumeEdgeRateLimit, jsonResponse, readBoundedJson, sha256Hex } from "../_shared/simhub.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

type DiagnosticErrorCode =
  | "origin_not_allowed"
  | "server_not_configured"
  | "payload_too_large"
  | "unsupported_media_type"
  | "invalid_json"
  | "invalid_payload";

class DiagnosticRequestError extends Error {
  readonly code: DiagnosticErrorCode;

  constructor(code: DiagnosticErrorCode) {
    super();
    this.name = "DiagnosticRequestError";
    this.code = code;
  }
}

// =========== Diagnostic codes (allowlist, deny-by-default) ===========
const diagnosticCodes = new Set([
  "OK", "RAW_DATA_UNAVAILABLE", "RAW_TELEMETRY_UNAVAILABLE",
  "SESSION_TIME_READ_FAILED", "TELEMETRY_STALE",
  "INGEST_401", "INGEST_403", "INGEST_429", "INGEST_500",
  "DEVICE_UNBOUND", "DEVICE_REVOKED",
  "UPDATE_CHECK_FAILED", "UPDATE_DOWNLOAD_FAILED", "UPDATE_HASH_FAILED",
  "UPDATE_SIGNATURE_FAILED", "UPDATE_INSTALL_FAILED",
  "UPDATE_DLL_LOCKED", "UPDATE_ROLLBACK_USED",
]);

// =========== Heartbeat fields (sorted) ===========
const heartbeatKeys = [
  "clientReportedAtUtc",
  "connectorVersion",
  "deviceId",
  "diagnosticCode",
  "gameConnected",
  "lastIngestHttpStatus",
  "lastSuccessfulIngestUtc",
  "lastTelemetryAttemptUtc",
  "lastUpdateResult",
  "lastUpdateUtc",
  "rawDataAvailable",
  "rawTelemetryAvailable",
  "sequence",
  "sessionTimeReadOk",
  "sessionTimeReader",
  "sessionTimeSeconds",
  "simHubVersion",
  "telemetryAvailable",
  "type",
  "updaterCurrentVersion",
  "updaterState",
  "updaterTargetVersion",
];

// =========== Event fields (sorted) ===========
const eventKeys = [
  "atUtc",
  "code",
  "detail",
  "deviceId",
  "exceptionType",
  "occurredAfter",
  "type",
];

// =========== Helpers ===========
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

const exactKeys = (value: Record<string, unknown>, keys: string[]): void => {
  const actual = Object.keys(value).sort();
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) {
    throw new DiagnosticRequestError("invalid_payload");
  }
};

const assertString = (value: unknown, field: string, maxLen = 120): string => {
  if (typeof value !== "string" || !value.trim() || value.length > maxLen) throw new DiagnosticRequestError("invalid_payload");
  return value.trim();
};

const assertNullableString = (value: unknown, field: string, maxLen = 120): string | null => {
  if (value === null) return null;
  return assertString(value, field, maxLen);
};

const assertBoolean = (value: unknown, field: string): boolean => {
  if (typeof value !== "boolean") throw new DiagnosticRequestError("invalid_payload");
  return value;
};

const assertNumber = (
  value: unknown,
  field: string,
  options: { nullable?: boolean; integer?: boolean; min?: number; max?: number } = {},
): number | null => {
  if (options.nullable && value === null) return null;
  const min = options.min ?? 0;
  const max = options.max ?? Number.MAX_SAFE_INTEGER;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new DiagnosticRequestError("invalid_payload");
  }
  if (options.integer && !Number.isInteger(value)) throw new DiagnosticRequestError("invalid_payload");
  return value;
};

const assertTimestampOrNull = (value: unknown): string | null => {
  if (value === null) return null;
  if (typeof value !== "string" || !value.trim() || value.length > 40) throw new DiagnosticRequestError("invalid_payload");
  if (!Number.isFinite(Date.parse(value.trim()))) throw new DiagnosticRequestError("invalid_payload");
  return value.trim();
};

const assertDiagnosticCode = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim()) throw new DiagnosticRequestError("invalid_payload");
  if (!diagnosticCodes.has(value.trim())) throw new DiagnosticRequestError("invalid_payload");
  return value.trim();
};

const assertDetail = (value: unknown): string | null => {
  if (value === null) return null;
  if (typeof value !== "string") throw new DiagnosticRequestError("invalid_payload");
  if (value.length > 200) throw new DiagnosticRequestError("invalid_payload");
  // Reject common path patterns — no personal info in detail
  if (/[A-Z]:\\|\\\\Users\\\\|\\\\Windows\\\\|\/home\/|\/tmp\/|\/var\//.test(value)) {
    throw new DiagnosticRequestError("invalid_payload");
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const assertExceptionType = (value: unknown): string | null => {
  if (value === null) return null;
  if (typeof value !== "string" || !value.trim() || value.length > 200) throw new DiagnosticRequestError("invalid_payload");
  // Only valid exception type names: dot-separated identifiers
  if (!/^[A-Za-z0-9_.+`]+$/.test(value.trim())) throw new DiagnosticRequestError("invalid_payload");
  return value.trim();
};

// =========== Schema validators ===========
const validateHeartbeat = (body: Record<string, unknown>): void => {
  exactKeys(body, heartbeatKeys);
  if (body.type !== "heartbeat") throw new DiagnosticRequestError("invalid_payload");
  assertString(body.deviceId, "deviceId", 40);
  assertString(body.connectorVersion, "connectorVersion", 60);
  assertString(body.simHubVersion, "simHubVersion", 60);
  assertBoolean(body.gameConnected, "gameConnected");
  assertBoolean(body.telemetryAvailable, "telemetryAvailable");
  assertBoolean(body.rawDataAvailable, "rawDataAvailable");
  assertBoolean(body.rawTelemetryAvailable, "rawTelemetryAvailable");
  assertBoolean(body.sessionTimeReadOk, "sessionTimeReadOk");
  assertNumber(body.sessionTimeSeconds, "sessionTimeSeconds", { nullable: true, max: 604800 });
  assertString(body.sessionTimeReader, "sessionTimeReader", 60);
  assertNumber(body.sequence, "sequence", { integer: true, max: 1000000000 });
  assertTimestampOrNull(body.lastTelemetryAttemptUtc);
  assertTimestampOrNull(body.lastSuccessfulIngestUtc);
  assertNumber(body.lastIngestHttpStatus, "lastIngestHttpStatus", { nullable: true, integer: true, min: 0, max: 999 });
  assertDiagnosticCode(body.diagnosticCode);
  assertString(body.updaterState, "updaterState", 60);
  assertString(body.updaterCurrentVersion, "updaterCurrentVersion", 60);
  assertNullableString(body.updaterTargetVersion, "updaterTargetVersion", 60);
  assertNullableString(body.lastUpdateResult, "lastUpdateResult", 60);
  assertTimestampOrNull(body.lastUpdateUtc);
  if (assertTimestampOrNull(body.clientReportedAtUtc) === null) throw new DiagnosticRequestError("invalid_payload");
};

const validateEvent = (body: Record<string, unknown>): void => {
  exactKeys(body, eventKeys);
  if (body.type !== "event") throw new DiagnosticRequestError("invalid_payload");
  assertString(body.deviceId, "deviceId", 40);
  assertDiagnosticCode(body.code);
  if (assertTimestampOrNull(body.atUtc) === null) throw new DiagnosticRequestError("invalid_payload");
  assertExceptionType(body.exceptionType);
  assertDetail(body.detail);
  assertNullableString(body.occurredAfter, "occurredAfter", 60);
};

// =========== Main handler ===========
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return jsonResponse(request, { ok: true });
  if (request.method !== "POST") return jsonResponse(request, { error: "method_not_allowed" }, 405);

  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new DiagnosticRequestError("server_not_configured");
    assertAllowedOrigin(request);

    const token = deviceToken(request);
    if (!token) return jsonResponse(request, { error: "invalid_device" }, 401);

    const tokenHash = await sha256Hex(token);
    const addressAllowed = await consumeEdgeRateLimit(
      `diagnostic-address:${clientAddress(request)}`,
      600,
      60 * 1000,
    );
    if (!addressAllowed) return jsonResponse(request, { error: "rate_limited" }, 429);

    // Device lookup for deviceId cross-check
    const { data: device, error: deviceErr } = await service
      .from("simhub_devices")
      .select("id, revoked_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (deviceErr) throw deviceErr;
    if (!device) return jsonResponse(request, { error: "invalid_device" }, 401);
    if (device.revoked_at) return jsonResponse(request, { error: "invalid_device" }, 401);

    // Parse body (max 4 KiB)
    const raw = await readBoundedJson(request, 4096);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return jsonResponse(request, { error: "invalid_payload" }, 422);
    }
    const body = raw as Record<string, unknown>;

    // Type discriminator
    const type = body.type;
    if (type !== "heartbeat" && type !== "event") {
      return jsonResponse(request, { error: "invalid_payload" }, 422);
    }

    // DeviceId cross-check: body deviceId must match token device
    const bodyDeviceId = typeof body.deviceId === "string" ? body.deviceId.trim() : "";
    if (bodyDeviceId && bodyDeviceId !== device.id) {
      return jsonResponse(request, { error: "device_mismatch" }, 401);
    }

    // === Heartbeat ===
    if (type === "heartbeat") {
      validateHeartbeat(body);

      const { data, error: rpcErr } = await service.rpc("simhub_upsert_health", {
        p_token_hash: tokenHash,
        p_health: body,
      });
      if (rpcErr) throw rpcErr;

      const result = data?.result;
      if (!result) throw new Error("empty_rpc_result");
      if (result === "invalid_device") return jsonResponse(request, { error: "invalid_device" }, 401);
      if (result === "diagnostic_rate_limited") {
        return jsonResponse(request, { error: "diagnostic_rate_limited" }, 429);
      }
      if (result !== "accepted") {
        return jsonResponse(request, { error: "internal_error" }, 500);
      }
      return jsonResponse(request, { ok: true, result: "accepted" });
    }

    // === Event ===
    validateEvent(body);

    const { data, error: rpcErr } = await service.rpc("simhub_insert_diagnostic_event", {
      p_token_hash: tokenHash,
      p_event: body,
    });
    if (rpcErr) throw rpcErr;

    const result = data?.result;
    if (!result) throw new Error("empty_rpc_result");
    if (result === "invalid_device") return jsonResponse(request, { error: "invalid_device" }, 401);
    if (result === "diagnostic_event_rate_limited") {
      return jsonResponse(request, { error: "diagnostic_event_rate_limited" }, 429);
    }
    if (result !== "accepted") {
      return jsonResponse(request, { error: "internal_error" }, 500);
    }
    return jsonResponse(request, { ok: true, result: "accepted" });
  } catch (error) {
    const known: Record<DiagnosticErrorCode, number> = {
      origin_not_allowed: 403,
      server_not_configured: 500,
      payload_too_large: 413,
      unsupported_media_type: 415,
      invalid_json: 400,
      invalid_payload: 422,
    };
    const code = error instanceof DiagnosticRequestError
      ? error.code
      : error instanceof Error && Object.hasOwn(known, error.message)
      ? error.message as DiagnosticErrorCode
      : null;
    if (code) {
      return jsonResponse(request, { error: code }, known[code]);
    }
    // Privacy: no raw error.message, no stack, no body, no token
    console.error("simhub-diagnostic internal failure", error instanceof Error ? error.name : "unknown_error");
    return jsonResponse(request, { error: "internal_error" }, 500);
  }
});