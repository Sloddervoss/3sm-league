import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { parseSimHubBridgeResponse, type SimHubBridgeResponse } from "./localSimHubBridge";

export type CentralSimHubLatestRow = Database["public"]["Tables"]["simhub_telemetry_latest"]["Row"];
export interface CentralSimHubDevice {
  id: string;
  device_name: string;
  connector_id: string;
  race_id: string;
  team_id: string;
  paired_at: string;
  expires_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
  race: { name: string } | null;
  team: { name: string } | null;
}

export interface SimHubPairingCode {
  code: string;
  expiresAt: string;
  raceId: string;
  teamId: string;
  teamName: string;
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

export const createCentralSimHubPairingCode = async (raceId: string, teamId: string): Promise<SimHubPairingCode> => {
  const { data, error } = await supabase.functions.invoke<SimHubPairingCode & { error?: string }>("simhub-pair", {
    body: { action: "create", raceId, teamId },
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

export const centralRowToBridgeResponse = (row: CentralSimHubLatestRow): SimHubBridgeResponse => parseSimHubBridgeResponse({
  receivedAt: row.received_at,
  payload: {
    protocolVersion: 1,
    sequence: row.sequence,
    capturedAt: row.captured_at,
    source: {
      connectorId: row.connector_id,
      simHubVersion: row.simhub_version,
      game: row.game,
    },
    race: {
      eventId: row.race_id,
      teamId: row.team_id,
      sessionId: row.session_id,
      driverId: null,
    },
    telemetry: row.telemetry,
  },
});

export const readCentralSimHubTelemetry = async (raceId: string, teamId: string): Promise<SimHubBridgeResponse | null> => {
  const { data, error } = await supabase
    .from("simhub_telemetry_latest")
    .select("*")
    .eq("race_id", raceId)
    .eq("team_id", teamId)
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? centralRowToBridgeResponse(data) : null;
};
