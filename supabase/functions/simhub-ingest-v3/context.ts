import { parseTelemetryV3Envelope, normalizeTelemetryEnvelope } from "../_shared/simhub.ts";
import type { NormalizedTelemetryEnvelope } from "../_shared/simhub.ts";

export type ResolvedTelemetryContext = {
  deviceId: string | null;
  eventId: string | null;
  teamId: string | null;
  isAuthority: boolean;
  raceRunId: string | null;
  runKind: string | null;
  hasActiveRaceRun: boolean;
  result:
    | "accepted_context"
    | "accepted_context_no_race_run"
    | "invalid_device"
    | "revoked"
    | "not_bound"
    | "not_authority"
    | "invalid_payload"
    | "unsupported_version";
  normalized: NormalizedTelemetryEnvelope | null;
};

/**
 * Resolve telemetry context from an authenticated device token and raw payload body.
 *
 * Flow:
 *  1. Hash token, look up device from simhub_devices table
 *  2. Parse body via version dispatch (normalizeTelemetryEnvelope handles V1/V2/V3)
 *  3. Resolve device binding (event/team) from device endurance columns
 *  4. Check primary authority (device_role = 'primary', device_status = 'active_binding')
 *  5. Resolve active raceRun via simhub_get_active_race_run (Phase B) if bound + primary
 *
 * No-active-run is NOT a rejection — returns accepted_context_no_race_run.
 */
export const resolveTelemetryContext = async (
  token: string,
  rawBody: unknown,
  supabase: {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, val: unknown) => {
          maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
        };
      };
    };
    rpc: (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  },
  sha256: (s: string) => Promise<string>,
): Promise<ResolvedTelemetryContext> => {
  // 1. Hash token and look up device
  const tokenHash = await sha256(token);
  const { data: device, error: deviceError } = await supabase
    .from("simhub_devices")
    .select("id, owner_user_id, endurance_event_id, endurance_team_id, device_status, device_role, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (deviceError || !device) {
    return mkResult("invalid_device", null);
  }
  const dev = device as unknown as {
    id: string; endurance_event_id: string | null; endurance_team_id: string | null;
    device_status: string | null; device_role: string | null; revoked_at: string | null;
  };
  if (dev.revoked_at) {
    return mkResult("revoked", null, dev.id);
  }

  // 2. Parse body via version dispatch
  let normalized: NormalizedTelemetryEnvelope;
  try {
    const root = rawBody as Record<string, unknown>;
    const version = root?.protocolVersion;
    if (version === 3) {
      normalized = parseTelemetryV3Envelope(rawBody);
    } else if (version === 1 || version === 2) {
      normalized = normalizeTelemetryEnvelope(rawBody);
    } else {
      return mkResult("unsupported_version", null, dev.id);
    }
  } catch {
    return mkResult("invalid_payload", null, dev.id);
  }

  // 3-4. Resolve binding + check authority
  const eventId: string | null = dev.endurance_event_id ?? null;
  const teamId: string | null = dev.endurance_team_id ?? null;
  const isBound = eventId && teamId;

  if (!isBound) {
    return mkResult("not_bound", normalized, dev.id);
  }

  const isPrimary = dev.device_role === "primary" && dev.device_status === "active_binding";
  if (!isPrimary) {
    return mkResult("not_authority", normalized, dev.id, eventId, teamId);
  }

  // 5. Resolve active race run (Phase B)
  let raceRunId: string | null = null;
  const { data: rrData } = await supabase.rpc("simhub_get_active_race_run", {
    p_event_id: eventId,
    p_team_id: teamId,
    p_run_kind: "race",
  });
  if (rrData) {
    const raw = Array.isArray(rrData) ? rrData[0] : rrData;
    raceRunId = (raw && typeof raw === "object" ? String((raw as Record<string, unknown>)["simhub_get_active_race_run"] ?? raw) : String(raw)) || null;
  }

  return {
    deviceId: device.id,
    eventId, teamId,
    isAuthority: true,
    raceRunId,
    runKind: raceRunId ? "race" : null,
    hasActiveRaceRun: raceRunId !== null,
    result: raceRunId ? "accepted_context" : "accepted_context_no_race_run",
    normalized,
  };
};

const mkResult = (
  result: ResolvedTelemetryContext["result"],
  normalized: NormalizedTelemetryEnvelope | null,
  deviceId?: string,
  eventId?: string | null,
  teamId?: string | null,
): ResolvedTelemetryContext => ({
  deviceId: deviceId ?? null,
  eventId: eventId ?? null,
  teamId: teamId ?? null,
  isAuthority: false,
  raceRunId: null,
  runKind: null,
  hasActiveRaceRun: false,
  result,
  normalized,
});