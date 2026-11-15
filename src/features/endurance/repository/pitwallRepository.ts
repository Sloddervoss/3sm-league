import { supabase } from "@/integrations/supabase/client";

type PitwallRead = "get_pitwall_teams" | "get_pitwall_data" | "pitwall_fuel_learning_for_team_v1";
const readRpc = supabase.rpc as unknown as (
  name: PitwallRead, args: Record<string, string>,
) => Promise<{ data: unknown; error: unknown }>;

export async function listPitwallTeams(eventId: string) {
  // The server derives ownership and staff rights from auth.uid(), never a client flag.
  const { data, error } = await readRpc("get_pitwall_teams", { p_event_id: eventId });
  if (error) throw error;
  return (data ?? []) as Array<{ id: string; name: string }>;
}

export async function fetchPitwallData(eventId: string, teamId: string) {
  const { data, error } = await readRpc("get_pitwall_data", {
    p_event_id: eventId, p_team_id: teamId,
  });
  if (error) throw error;
  return data;
}

export async function fetchPersonalFuelLearning(eventId: string, teamId: string): Promise<unknown> {
  const { data, error } = await readRpc("pitwall_fuel_learning_for_team_v1", {
    p_event_id: eventId, p_team_id: teamId,
  });
  if (error) throw error;
  return data ?? null;
}
