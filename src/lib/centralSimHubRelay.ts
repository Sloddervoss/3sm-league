import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { parseSimHubBridgeResponse, type SimHubBridgeResponse } from "./localSimHubBridge";

export type CentralSimHubLatestRow = Database["public"]["Tables"]["simhub_telemetry_latest"]["Row"];
export interface CentralSimHubDevice {
  id: string;
  device_name: string;
  connector_id: string;
  paired_at: string;
  expires_at: string | null;
  last_seen_at: string | null;
  revoked_at: string | null;
  endurance_event_id: string | null;
  endurance_team_id: string | null;
}

export interface SimHubPairingCode {
  code: string;
  expiresAt: string;
}

const functionError = async (error: unknown, fallback: string) => {
  if (error && typeof error === "object" && "context" in error && error.context instanceof Response) {
    try {
      const body = await error.context.clone().json() as { error?: unknown };
      if (typeof body.error === "string" && body.error) return body.error;
    } catch { /* SDK-context bevatte geen JSON-body. */ }
  }
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return fallback;
};

export const createCentralSimHubPairingCode = async (): Promise<SimHubPairingCode> => {
  const { data, error } = await supabase.functions.invoke<SimHubPairingCode & { error?: string }>("simhub-pair", {
    body: { action: "create" },
  });
  if (error || !data?.code) throw new Error(data?.error || await functionError(error, "Pairingcode kon niet worden gemaakt."));
  return data;
};

export const listCentralSimHubDevices = async (): Promise<CentralSimHubDevice[]> => {
  const { data, error } = await supabase.functions.invoke<{ devices?: CentralSimHubDevice[]; error?: string }>("simhub-pair", {
    body: { action: "list" },
  });
  if (error) throw new Error(await functionError(error, "Gekoppelde SimHub-apparaten konden niet worden geladen."));
  if (data?.error) throw new Error(data.error);
  return data?.devices ?? [];
};

export const revokeCentralSimHubDevice = async (deviceId: string) => {
  const { data, error } = await supabase.functions.invoke<{ revoked?: boolean; error?: string }>("simhub-pair", {
    body: { action: "revoke", deviceId },
  });
  if (error || !data?.revoked) throw new Error(data?.error || await functionError(error, "SimHub-apparaat kon niet worden ingetrokken."));
};

export const centralRowToBridgeResponse = (row: CentralSimHubLatestRow): SimHubBridgeResponse => {
  const isV2 = Boolean(row.telemetry && typeof row.telemetry === "object" && "isInCar" in row.telemetry);
  return parseSimHubBridgeResponse({
    receivedAt: row.received_at,
    payload: {
      protocolVersion: isV2 ? 2 : 1,
      sequence: row.sequence,
      capturedAt: row.captured_at,
      source: {
        connectorId: row.connector_id,
        simHubVersion: row.simhub_version,
        game: row.game,
      },
      race: {
        eventId: row.endurance_event_id ?? row.race_id ?? "connection-test",
        teamId: row.endurance_team_id ?? row.team_id ?? "unassigned",
        sessionId: row.session_id,
        driverId: row.driver_id ?? null,
        ...(isV2 ? {
          currentDriverId: row.current_driver_id ?? null,
          currentDriverName: row.current_driver_name ?? null,
          carId: row.car_id ?? null,
          carName: row.car_name ?? null,
          trackName: row.track_name ?? null,
          trackConfig: row.track_config ?? null,
        } : {}),
      },
      telemetry: row.telemetry,
    },
  });
};

/** Alle niet-ingetrokken devices die aan een bepaald endurance team zijn gekoppeld. */
export const listCentralSimHubDevicesForTeam = async (eventId: string, teamId: string): Promise<CentralSimHubDevice[]> => {
  const devices = await listCentralSimHubDevices();
  return devices.filter((device) => !device.revoked_at && device.endurance_event_id === eventId && device.endurance_team_id === teamId);
};

export const readCentralSimHubTelemetry = async (deviceId: string): Promise<SimHubBridgeResponse | null> => {
  const { data, error } = await supabase
    .from("simhub_telemetry_latest")
    .select("*")
    .eq("device_id", deviceId)
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? centralRowToBridgeResponse(data) : null;
};
