import { supabase } from "@/integrations/supabase/client";
import type { PaceHistory } from "../../supabase/functions/_shared/paceCapture";
export type PaceSource = {deviceId?: string | null; eventId?: string | null; teamId?: string | null};
export async function readPitwallPace(source: PaceSource, referenceId: string | null): Promise<PaceHistory | null> {
  const args = {p_device_id: source.deviceId ?? null, p_reference_id: referenceId, p_event_id: source.eventId ?? null, p_team_id: source.teamId ?? null};
  const {data,error} = await (supabase.rpc as unknown as (name:string,parameters:typeof args)=>Promise<{data:unknown;error:unknown}>)("get_pitwall_pace",args);
  if(error) throw error;
  return data as PaceHistory | null;
}
