import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Cijfers per team voor een afgeronde race, uit get_endurance_archive_summary. */
export type EnduranceArchiveTeam = {
  team_id: string;
  team_name: string;
  car_number: string | null;
  laps: number;
  best_lap_seconds: number | null;
  stops: number;
  drivers: string[] | null;
};

const getArchiveSummary = async (eventId: string): Promise<EnduranceArchiveTeam[]> => {
  const { data, error } = await supabase.rpc("get_endurance_archive_summary", { p_event_id: eventId });
  if (error) throw error;
  return (data ?? []) as EnduranceArchiveTeam[];
};

export const useEnduranceArchiveSummary = (eventId: string | null | undefined) =>
  useQuery({
    queryKey: ["endurance", "archive-summary", eventId],
    queryFn: () => getArchiveSummary(eventId as string),
    enabled: Boolean(eventId),
    staleTime: 5 * 60_000,
    retry: 1,
  });
