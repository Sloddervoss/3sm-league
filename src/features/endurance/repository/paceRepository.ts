import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { assertEnduranceTable, enduranceClient } from "./dataAccess";

/**
 * Endurance pace repository — Fase 3.
 * Leest/schrijft uitsluitend `endurance_pace_entries` (super-admin-only RLS).
 * user_id = auth.uid() van de sessie. Geen service-role key, geen fallback.
 */
const TABLE = "endurance_pace_entries" as const;

export type EndurancePaceRow = {
  id: string;
  event_id: string | null;
  user_id: string;
  circuit: string;
  configuration: string;
  car: string;
  conditions: string;
  average_lap_seconds: number | null;
  median_lap_seconds: number | null;
  best_lap_seconds: number | null;
  best_five_average_seconds: number | null;
  consistency_seconds: number | null;
  valid_laps: number | null;
  incidents: number | null;
  average_stint_minutes: number | null;
  recorded_at: string;
  source: string;
  notes: string | null;
};

const selectColumns = "id,event_id,user_id,circuit,configuration,car,conditions,average_lap_seconds,median_lap_seconds,best_lap_seconds,best_five_average_seconds,consistency_seconds,valid_laps,incidents,average_stint_minutes,recorded_at,source,notes";

/** Plain: alle pace-entries voor een event. */
export async function listEndurancePace(eventId: string): Promise<EndurancePaceRow[]> {
  assertEnduranceTable(TABLE);
  const { data, error } = await enduranceClient()
    .from("endurance_pace_entries")
    .select(selectColumns)
    .eq("event_id", eventId)
    .order("recorded_at", { ascending: false });
  if (error) throw new Error(`Endurance pace laden mislukt: ${error.message}`);
  return (data ?? []) as EndurancePaceRow[];
}

export type UpsertEndurancePaceInput = {
  id?: string;
  event_id: string;
  user_id: string;
  circuit: string;
  configuration: string;
  car: string;
  conditions: string;
  average_lap_seconds?: number | null;
  median_lap_seconds?: number | null;
  best_lap_seconds?: number | null;
  best_five_average_seconds?: number | null;
  consistency_seconds?: number | null;
  valid_laps?: number | null;
  incidents?: number | null;
  average_stint_minutes?: number | null;
  source?: string;
  notes?: string | null;
};

/** Plain: schrijf een pace-entry (super-admin-sessie). */
export async function upsertEndurancePace(input: UpsertEndurancePaceInput): Promise<EndurancePaceRow> {
  assertEnduranceTable(TABLE);
  const { data, error } = await enduranceClient()
    .from("endurance_pace_entries")
    .upsert({
      id: input.id,
      event_id: input.event_id,
      user_id: input.user_id,
      circuit: input.circuit,
      configuration: input.configuration,
      car: input.car,
      conditions: input.conditions,
      average_lap_seconds: input.average_lap_seconds ?? null,
      median_lap_seconds: input.median_lap_seconds ?? null,
      best_lap_seconds: input.best_lap_seconds ?? null,
      best_five_average_seconds: input.best_five_average_seconds ?? null,
      consistency_seconds: input.consistency_seconds ?? null,
      valid_laps: input.valid_laps ?? null,
      incidents: input.incidents ?? null,
      average_stint_minutes: input.average_stint_minutes ?? null,
      source: input.source ?? "manual",
      notes: input.notes ?? null,
    })
    .select(selectColumns)
    .single();
  if (error) throw new Error(`Endurance pace opslaan mislukt: ${error.message}`);
  return data as EndurancePaceRow;
}

/** Plain: verwijder een pace-entry (super-admin-sessie). */
export async function deleteEndurancePace(id: string): Promise<void> {
  assertEnduranceTable(TABLE);
  const { error } = await enduranceClient().from("endurance_pace_entries").delete().eq("id", id);
  if (error) throw new Error(`Endurance pace verwijderen mislukt: ${error.message}`);
}

/** TanStack Query: pace-entries voor een event. */
export function useEndurancePace(eventId: string) {
  return useQuery({
    queryKey: ["endurance", "pace", eventId],
    queryFn: () => listEndurancePace(eventId),
    enabled: Boolean(eventId),
  });
}

/** TanStack Query: write-hooks voor pace. */
export function useEndurancePaceMutations(eventId: string) {
  const queryClient = useQueryClient();
  const onSettled = () => queryClient.invalidateQueries({ queryKey: ["endurance", "pace", eventId] });
  const upsert = useMutation({ mutationFn: upsertEndurancePace, onSettled });
  const remove = useMutation({ mutationFn: deleteEndurancePace, onSettled });
  return { upsert, remove };
}
