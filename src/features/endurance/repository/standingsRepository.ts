import { supabase } from "@/integrations/supabase/client";
import type { LiveStandingsTeamSource } from "../standings/classification";

/**
 * standingsRepository — de enige Supabase-toegang voor de live-standings.
 * Volgt de endurance data-access-dicipline: feature/kern-bestanden mogen het
 * datapatform niet direct aanraken; al het netwerkverkeer loopt via deze repo.
 */
export const fetchLiveTeams = async (eventId: string): Promise<LiveStandingsTeamSource[]> => {
  const { data, error } = await supabase
    .from("endurance_teams")
    .select("id,name,car_number,car_id,livery")
    .eq("event_id", eventId);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    carNumber: row.car_number,
    carId: row.car_id,
    livery: row.livery,
  }));
};

export type LiveStandingsRealtime = { unsubscribe: () => void };

/**
 * Realtime-abonnement op nieuwe snapshots van een event (invalideert de stand).
 * Geeft een unsubscribe terug; de repo blijft het enige supabase-touchpoint.
 */
export const subscribeLiveStandings = (eventId: string, onChange: () => void): LiveStandingsRealtime => {
  const channel = supabase
    .channel(`live-standings-${eventId}`)
    .on("postgres_changes",
      { event: "INSERT", schema: "public", table: "simhub_telemetry_latest", filter: `endurance_event_id=eq.${eventId}` },
      () => onChange())
    .subscribe();
  return {
    unsubscribe: () => { void supabase.removeChannel(channel); },
  };
};