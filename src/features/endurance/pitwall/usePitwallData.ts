import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { PitwallStrategyRow, PitwallTimelineEvent, TeamOption } from "./pitwallHelpers";

/* Fetch strategy_latest directly (team + staff accessible via RLS) */
const fetchStrategy = async (eventId: string, teamId: string): Promise<PitwallStrategyRow | null> => {
  const { data, error } = await supabase
    .from("endurance_strategy_latest")
    .select("*")
    .eq("event_id", eventId)
    .eq("team_id", teamId)
    .maybeSingle();
  if (error) {
    console.error("[3SM Pitwall] strategy fetch error:", error);
    return null;
  }
  if (!data) return null;
  return data as unknown as PitwallStrategyRow;
};

/* Fetch telemetry events (staff only via can_manage_simhub RLS — silently returns empty if denied) */
const fetchEvents = async (eventId: string, teamId: string): Promise<PitwallTimelineEvent[]> => {
  const { data, error } = await supabase
    .from("endurance_telemetry_events")
    .select("*")
    .eq("event_id", eventId)
    .eq("team_id", teamId)
    .order("captured_at", { ascending: false })
    .limit(50);
  if (error) return [];
  return (data ?? []) as unknown as PitwallTimelineEvent[];
};

/* Fetch teams for the event (staff only via RLS — team members see empty) */
const fetchTeams = async (eventId: string): Promise<TeamOption[]> => {
  const { data, error } = await supabase
    .from("endurance_teams")
    .select("id, name")
    .eq("event_id", eventId);
  if (error) return [];
  return (data ?? []) as TeamOption[];
};

export function usePitwallData(eventId: string, initialTeamId: string | null) {
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(initialTeamId);

  const strategyQuery = useQuery({
    queryKey: ["pitwall", "strategy", eventId, selectedTeamId],
    enabled: Boolean(eventId) && Boolean(selectedTeamId),
    refetchInterval: 3_000,
    queryFn: () => fetchStrategy(eventId, selectedTeamId!),
  });

  const eventsQuery = useQuery({
    queryKey: ["pitwall", "events", eventId, selectedTeamId],
    enabled: Boolean(eventId) && Boolean(selectedTeamId),
    refetchInterval: 5_000,
    queryFn: () => fetchEvents(eventId, selectedTeamId!),
  });

  const teamsQuery = useQuery({
    queryKey: ["pitwall", "teams", eventId],
    enabled: Boolean(eventId),
    staleTime: 30_000,
    queryFn: () => fetchTeams(eventId),
  });

  const loading = strategyQuery.isLoading || eventsQuery.isLoading || teamsQuery.isLoading;
  const error = strategyQuery.error || eventsQuery.error || teamsQuery.error;

  /* Derive alert conditions from strategy data */
  const alerts = useMemo(() => {
    const list: Array<{ severity: "high" | "medium" | "info"; message: string }> = [];
    if (!strategyQuery.data) return list;

    const strat = strategyQuery.data;
    const lapsRemaining = strat.fuel_laps_remaining;

    if (lapsRemaining != null) {
      if (lapsRemaining < 1) {
        list.push({ severity: "high", message: "PIT DEZE RONDE — brandstof kritiek" });
      } else if (lapsRemaining < 3) {
        list.push({ severity: "high", message: `PIT OVER ${Math.floor(lapsRemaining)} — brandstof` });
      } else if (lapsRemaining < 5) {
        list.push({ severity: "medium", message: `PIT OVER ${Math.floor(lapsRemaining)}` });
      }
    }

    if (strat.strategy_status === "low_sample") {
      list.push({ severity: "info", message: "Strategie: weinig data" });
    }
    if (strat.strategy_status === "insufficient_data") {
      list.push({ severity: "medium", message: "Strategie: onvoldoende data" });
    }

    return list;
  }, [strategyQuery.data]);

  return {
    strategy: strategyQuery.data,
    events: eventsQuery.data ?? [],
    teams: teamsQuery.data ?? [],
    alerts,
    loading,
    error,
    selectedTeamId,
    setSelectedTeamId,
  };
}