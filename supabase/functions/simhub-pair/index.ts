import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.7";
import { assertAllowedOrigin, consumeEdgeRateLimit, jsonResponse, normalizePairCode, randomDeviceToken, randomPairCode, readBoundedJson, sha256Hex, uuidPattern } from "../_shared/simhub.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const bearer = (request: Request): string => {
  const header = request.headers.get("authorization") || "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
};

const clientAddress = (request: Request): string => (
  request.headers.get("cf-connecting-ip")
  || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  || "unknown"
);

const authenticatedUser = async (request: Request) => {
  const token = bearer(request);
  if (!token) throw new Error("not_authenticated");
  const authClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) throw new Error("not_authenticated");
  return { user: data.user, authClient };
};

type EnduranceCapabilities = {
  can_access: boolean;
  can_pair_own_device: boolean;
  can_ingest_own_device: boolean;
  can_manage_events: boolean;
  can_manage_devices: boolean;
  multi_user_realtime_enabled: boolean;
  simhub_ingest_enabled: boolean;
};

const capabilityRpcUnavailable = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error && typeof error.code === "string" ? error.code : "";
  const message = "message" in error && typeof error.message === "string" ? error.message.toLowerCase() : "";
  return code === "PGRST202" || (message.includes("schema cache") && message.includes("endurance_"));
};

const isSuperAdmin = async (userId: string): Promise<boolean> => {
  const { data, error } = await service.from("user_roles").select("role").eq("user_id", userId);
  if (error) throw error;
  return (data || []).some((row: { role: string }) => row.role === "super_admin");
};

// Endurance-ster: super_admin, endurance_manager of tester. Testers mogen hun
// EIGEN device koppelen (paar-code aanmaken), maar niet beheren/intrekken.
const isEnduranceStaff = async (userId: string): Promise<boolean> => {
  const { data, error } = await service.from("user_roles").select("role").eq("user_id", userId);
  if (error) throw error;
  return (data || []).some((row: { role: string }) => ["super_admin", "endurance_manager", "tester"].includes(row.role));
};

// Device->race/-team-binding (assign/clear) is beheer: super_admin of
// endurance_manager. Testers kunnen hun eigen device wel koppelen op de
// SimHub-pagina, maar géén apparaten aan event/team toewijzen.
const isEnduranceManager = async (userId: string): Promise<boolean> => {
  const { data, error } = await service.from("user_roles").select("role").eq("user_id", userId);
  if (error) throw error;
  return (data || []).some((row: { role: string }) => ["super_admin", "endurance_manager"].includes(row.role));
};

const enduranceCapabilities = async (
  authClient: ReturnType<typeof createClient>,
  userId: string,
): Promise<EnduranceCapabilities> => {
  const { data, error } = await authClient.rpc("endurance_current_capabilities");
  const row = Array.isArray(data) ? data[0] : data;
  if (!error && row) return row as EnduranceCapabilities;
  if (error && !capabilityRpcUnavailable(error)) throw error;

  // Zero-downtime fallback while the additive migration is not available yet:
  // preserve alpha staff access and never grant an ordinary user new access.
  const [staff, manager] = await Promise.all([
    isEnduranceStaff(userId),
    isEnduranceManager(userId),
  ]);
  return {
    can_access: staff,
    can_pair_own_device: staff,
    can_ingest_own_device: staff,
    can_manage_events: manager,
    can_manage_devices: manager,
    multi_user_realtime_enabled: false,
    simhub_ingest_enabled: true,
  };
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return jsonResponse(request, { ok: true });
  if (request.method !== "POST") return jsonResponse(request, { error: "method_not_allowed" }, 405);

  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) throw new Error("server_not_configured");
    assertAllowedOrigin(request);
    const body = await readBoundedJson(request, 8192) as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "";

    if (action === "exchange") {
      const code = normalizePairCode(body.code);
      const connectorId = typeof body.connectorId === "string" ? body.connectorId.trim() : "";
      const deviceName = typeof body.deviceName === "string" ? body.deviceName.trim() : "";
      if (code.length !== 8 || !connectorId || connectorId.length > 120 || !deviceName || deviceName.length > 120) {
        return jsonResponse(request, { error: "invalid_request" }, 400);
      }

      const allowed = await consumeEdgeRateLimit(`pair:${clientAddress(request)}`, 30, 10 * 60 * 1000);
      if (!allowed) return jsonResponse(request, { error: "rate_limited" }, 429);

      const codeHash = await sha256Hex(code);
      const { data: pendingCode, error: pendingError } = await service
        .from("simhub_pairing_codes")
        .select("owner_user_id")
        .eq("code_hash", codeHash)
        .is("consumed_at", null)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();
      if (pendingError) throw pendingError;
      if (pendingCode?.owner_user_id) {
        const { data: capabilityRows, error: capabilityError } = await service.rpc("endurance_capabilities_for_user", {
          _user_id: pendingCode.owner_user_id,
        });
        let canPair = !capabilityError && Boolean(capabilityRows?.[0]?.can_pair_own_device);
        if (capabilityError && capabilityRpcUnavailable(capabilityError)) canPair = await isEnduranceStaff(pendingCode.owner_user_id);
        else if (capabilityError) throw capabilityError;
        if (!canPair) return jsonResponse(request, { error: "pairing_not_allowed" }, 403);
      }

      const deviceToken = randomDeviceToken();
      const { data, error } = await service.rpc("simhub_exchange_pairing_code", {
        p_code_hash: codeHash,
        p_token_hash: await sha256Hex(deviceToken),
        p_connector_id: connectorId,
        p_device_name: deviceName,
      });
      if (error) throw error;
      const result = data?.[0];
      if (!result || result.result !== "paired") return jsonResponse(request, { error: "invalid_or_expired_code" }, 401);
      return jsonResponse(request, {
        paired: true,
        deviceToken,
        deviceId: result.device_id,
        ownerUserId: result.owner_user_id,
        ...(result.race_id && result.team_id ? { raceId: result.race_id, teamId: result.team_id } : {}),
      });
    }

    const { user, authClient } = await authenticatedUser(request);
    const [superAdmin, capabilities] = await Promise.all([
      isSuperAdmin(user.id),
      enduranceCapabilities(authClient, user.id),
    ]);

    // Capability regime:
    //  - create: current user may pair their own device when capability allows;
    //  - list-own/revoke: any authenticated owner can see/revoke only own rows;
    //  - list/assign/clear: endurance manager or super-admin;
    //  - legacy race/team-bound pairing: super-admin only.
    const adminSuperOnly = !["list", "list-own", "revoke", "create", "assign", "clear"].includes(action);
    if (adminSuperOnly && !superAdmin) {
      return jsonResponse(request, { error: "super_admin_required" }, 403);
    }
    if (["list", "assign", "clear"].includes(action) && !capabilities.can_manage_devices) {
      return jsonResponse(request, { error: "super_admin_required" }, 403);
    }

    if (action === "create") {
      if (!capabilities.can_pair_own_device) return jsonResponse(request, { error: "pairing_not_allowed" }, 403);

      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const raceId = typeof body.raceId === "string" ? body.raceId.trim() : "";
      const teamId = typeof body.teamId === "string" ? body.teamId.trim() : "";
      const legacyBoundPairing = Boolean(raceId || teamId);
      // Legacy race/team-binding is een beheeractie -> alleen super_admin.
      if (legacyBoundPairing && !superAdmin) {
        return jsonResponse(request, { error: "super_admin_required" }, 403);
      }
      if (legacyBoundPairing && (!uuidPattern.test(raceId) || !uuidPattern.test(teamId))) {
        return jsonResponse(request, { error: "invalid_binding" }, 400);
      }
      let code = "";
      let insertError: unknown = null;
      let created = false;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        code = randomPairCode();
        const codeHash = await sha256Hex(normalizePairCode(code));
        const result = legacyBoundPairing
          ? await service.rpc("simhub_create_pairing_code", {
            p_code_hash: codeHash,
            p_owner_user_id: user.id,
            p_race_id: raceId,
            p_team_id: teamId,
            p_expires_at: expiresAt,
          })
          : await service.rpc("simhub_create_device_pairing_code", {
            p_code_hash: codeHash,
            p_owner_user_id: user.id,
            p_expires_at: expiresAt,
          });
        insertError = result.error;
        created = !insertError && result.data === true;
        if (created) break;
      }
      if (insertError) throw insertError;
      if (!created) return jsonResponse(request, { error: "pairing_not_allowed" }, 403);
      await service.from("simhub_pairing_codes").delete().lt("expires_at", new Date(Date.now() - 86400000).toISOString());
      return jsonResponse(request, { code, expiresAt });
    }

    if (action === "list" || action === "list-own") {
      let query = service.from("simhub_devices")
        .select("id,owner_user_id,device_name,connector_id,race_id,team_id,endurance_event_id,endurance_team_id,paired_at,expires_at,last_seen_at,revoked_at,race:races(name),team:teams(name)");
      if (action === "list-own") query = query.eq("owner_user_id", user.id);
      const { data, error } = await query.order("paired_at", { ascending: false });
      if (error) throw error;
      return jsonResponse(request, { devices: data || [] });
    }

    if (action === "revoke") {
      const deviceId = typeof body.deviceId === "string" ? body.deviceId : "";
      if (!uuidPattern.test(deviceId)) return jsonResponse(request, { error: "invalid_device" }, 400);
      // Endurance-ster mag alleen hun EIGEN device intrekken.
      if (!superAdmin) {
        const { data: owned, error: ownedError } = await service
          .from("simhub_devices").select("id").eq("id", deviceId).eq("owner_user_id", user.id).maybeSingle();
        if (ownedError) throw ownedError;
        if (!owned) return jsonResponse(request, { error: "super_admin_required" }, 403);
      }
      const { data, error } = await service.rpc("simhub_revoke_device", {
        p_device_id: deviceId,
        p_revoked_by: user.id,
      });
      if (error) throw error;
      if (!data) return jsonResponse(request, { error: "device_not_found" }, 404);
      return jsonResponse(request, { revoked: true, deviceId });
    }

    if (action === "assign") {
      const deviceId = typeof body.deviceId === "string" ? body.deviceId : "";
      const eventId = typeof body.eventId === "string" ? body.eventId : "";
      const teamId = typeof body.teamId === "string" ? body.teamId : "";
      if (!uuidPattern.test(deviceId) || !uuidPattern.test(eventId) || !uuidPattern.test(teamId)) {
        return jsonResponse(request, { error: "invalid_binding" }, 400);
      }
      const { data, error } = await service.rpc("simhub_assign_device_to_entry", {
        p_device_id: deviceId,
        p_endurance_event_id: eventId,
        p_endurance_team_id: teamId,
        p_assigned_by: user.id,
      });
      if (error) throw error;
      if (!data) return jsonResponse(request, { error: "assignment_failed" }, 400);
      return jsonResponse(request, { assigned: true, deviceId, eventId, teamId });
    }

    if (action === "clear") {
      const deviceId = typeof body.deviceId === "string" ? body.deviceId : "";
      if (!uuidPattern.test(deviceId)) return jsonResponse(request, { error: "invalid_device" }, 400);
      const { data, error } = await service.rpc("simhub_clear_device_entry", {
        p_device_id: deviceId,
        p_assigned_by: user.id,
      });
      if (error) throw error;
      if (!data) return jsonResponse(request, { error: "device_not_found" }, 404);
      return jsonResponse(request, { cleared: true, deviceId });
    }

    return jsonResponse(request, { error: "unknown_action" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    const known: Record<string, number> = {
      origin_not_allowed: 403,
      not_authenticated: 401,
      payload_too_large: 413,
      unsupported_media_type: 415,
      invalid_json: 400,
    };
    if (known[message]) return jsonResponse(request, { error: message }, known[message]);
    console.error("simhub-pair internal failure", error instanceof Error ? error.name : "unknown");
    return jsonResponse(request, { error: "internal_error" }, 500);
  }
});
