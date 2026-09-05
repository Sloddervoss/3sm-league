import { supabase } from "@/integrations/supabase/client";

export async function listPitwallTeams(eventId: string) {
  // The server derives ownership and staff rights from auth.uid(), never a client flag.
  const { data, error } = await (supabase as any).rpc("get_pitwall_teams", { p_event_id: eventId });
  if (error) throw error;
  return (data ?? []) as Array<{ id: string; name: string }>;
}

export async function fetchPitwallData(eventId: string, teamId: string) {
  const { data, error } = await (supabase as any).rpc("get_pitwall_data", {
    p_event_id: eventId, p_team_id: teamId,
  });
  if (error) throw error;
  return data;
}
