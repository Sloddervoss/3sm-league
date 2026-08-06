import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { buildStandings, type StandingLine } from "./classification";
import { fetchLiveTeams, subscribeLiveStandings } from "../repository/standingsRepository";
import { readLatestTelemetryForEvent } from "@/lib/centralSimHubRelay";

/**
 * Wacht op de live-stand van een endurance-event.
 * Herbruikbaar + nog NIET op een route geplaatst. Alle data loopt via de
 * repository (standingsRepository) — deze kern-bestand raakt het datapatform
 * niet direct. (Bij publieke plaatsing later moet enkel de DB-policy voor
 * anon-lezen van endurance_teams/simhub_telemetry_latest nog worden
 * opengesteld — dat hoort bij het aanplanten, niet hier.)
 */
export const useLiveStandings = (eventId: string | null) => {
  const queryClient = useQueryClient();
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["endurance", "standings", eventId] });
  };

  const teamsQuery = useQuery({
    queryKey: ["endurance", "standings", eventId, "teams"],
    enabled: Boolean(eventId),
    refetchInterval: 5_000,
    queryFn: async () => {
      if (!eventId) return [];
      const teams = await fetchLiveTeams(eventId);
      setUpdatedAt(Date.now());
      return teams;
    },
  });

  const telemetryQuery = useQuery({
    queryKey: ["endurance", "standings", eventId, "latest"],
    enabled: Boolean(eventId),
    refetchInterval: 5_000,
    queryFn: async () => {
      if (!eventId) return [];
      const latest = await readLatestTelemetryForEvent(eventId);
      setUpdatedAt(Date.now());
      return latest;
    },
  });

  // Realtime: een nieuwe snapshot → stand herverfrissen.
  useEffect(() => {
    if (!eventId) return;
    const { unsubscribe } = subscribeLiveStandings(eventId, invalidate);
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const standings = useMemo<StandingLine[]>(
    () => (teamsQuery.data ? buildStandings(teamsQuery.data, telemetryQuery.data ?? []) : []),
    [teamsQuery.data, telemetryQuery.data],
  );

  return {
    standings,
    loading: teamsQuery.isLoading || telemetryQuery.isLoading,
    error: teamsQuery.error || telemetryQuery.error,
    updatedAt,
  };
};