import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { assertEnduranceTable, enduranceClient } from "./dataAccess";

/**
 * Endurance availability repository — Fase 3.
 * Leest/schrijft uitsluitend `endurance_availability` (super-admin-only RLS).
 * user_id = auth.uid() van de sessie. Geen service-role key, geen fallback.
 */
const TABLE = "endurance_availability" as const;

export type EnduranceAvailabilityRow = {
  id: string;
  event_id: string;
  user_id: string;
  start_at: string;
  end_at: string;
  type: "available" | "preferred" | "avoid" | "unavailable" | "uncertain";
  note: string | null;
};

const selectColumns = "id,event_id,user_id,start_at,end_at,type,note";

/** Plain: alle availability-blokken voor een event. */
export async function listEnduranceAvailability(eventId: string): Promise<EnduranceAvailabilityRow[]> {
  assertEnduranceTable(TABLE);
  const { data, error } = await enduranceClient()
    .from("endurance_availability")
    .select(selectColumns)
    .eq("event_id", eventId)
    .order("start_at", { ascending: true });
  if (error) throw new Error(`Endurance beschikbaarheid laden mislukt: ${error.message}`);
  return (data ?? []) as EnduranceAvailabilityRow[];
}

export type CreateEnduranceAvailabilityInput = {
  id?: string;
  event_id: string;
  user_id: string;
  start_at: string;
  end_at: string;
  type: EnduranceAvailabilityRow["type"];
  note?: string | null;
};

/** Plain: voeg een availability-blok toe of werk bij (super-admin-sessie). */
export async function upsertEnduranceAvailability(input: CreateEnduranceAvailabilityInput): Promise<EnduranceAvailabilityRow> {
  assertEnduranceTable(TABLE);
  const { data, error } = await enduranceClient()
    .from("endurance_availability")
    .upsert({
      id: input.id,
      event_id: input.event_id,
      user_id: input.user_id,
      start_at: input.start_at,
      end_at: input.end_at,
      type: input.type,
      note: input.note ?? null,
    })
    .select(selectColumns)
    .single();
  if (error) throw new Error(`Endurance beschikbaarheid opslaan mislukt: ${error.message}`);
  return data as EnduranceAvailabilityRow;
}

/** Plain: verwijder een availability-blok (super-admin-sessie). */
export async function deleteEnduranceAvailability(id: string): Promise<void> {
  assertEnduranceTable(TABLE);
  const { error } = await enduranceClient().from("endurance_availability").delete().eq("id", id);
  if (error) throw new Error(`Endurance beschikbaarheid verwijderen mislukt: ${error.message}`);
}

/** TanStack Query: availability-blokken voor een event. */
export function useEnduranceAvailability(eventId: string) {
  return useQuery({
    queryKey: ["endurance", "availability", eventId],
    queryFn: () => listEnduranceAvailability(eventId),
    enabled: Boolean(eventId),
  });
}

/** TanStack Query: write-hooks voor availability. */
export function useEnduranceAvailabilityMutations(eventId: string) {
  const queryClient = useQueryClient();
  const onSettled = () => queryClient.invalidateQueries({ queryKey: ["endurance", "availability", eventId] });
  const upsert = useMutation({ mutationFn: upsertEnduranceAvailability, onSettled });
  const remove = useMutation({ mutationFn: deleteEnduranceAvailability, onSettled });
  return { upsert, remove };
}
