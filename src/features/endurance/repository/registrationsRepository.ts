import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { assertEnduranceTable, enduranceClient } from "./dataAccess";

/**
 * Endurance registrations repository — Fase 3.
 * Leest/schrijft uitsluitend `endurance_registrations` (super-admin-only RLS).
 * user_id wordt ingesteld op auth.uid() van de browser-sessie; de RLS weigert
 * elke niet-super-admin. Geen service-role key, geen fallback.
 */
const TABLE = "endurance_registrations" as const;

export type EnduranceRegistrationRow = {
  id: string;
  event_id: string;
  user_id: string;
  status: "interest" | "provisional" | "confirmed" | "reserve" | "rejected" | "withdrawn";
  class_preference: string | null;
  preferred_car_id: string | null;
  slot_id: string | null;
  max_stints: number | null;
  max_stint_minutes: number | null;
  max_total_minutes: number | null;
  max_consecutive_stints: number | null;
  min_rest_minutes: number | null;
  night_driving: boolean;
  willing_to_start: boolean;
  willing_to_finish: boolean;
  notes: string | null;
  registered_at: string;
};

const selectColumns = "id,event_id,user_id,status,class_preference,preferred_car_id,slot_id,max_stints,max_stint_minutes,max_total_minutes,max_consecutive_stints,min_rest_minutes,night_driving,willing_to_start,willing_to_finish,notes,registered_at";

/** Plain: alle endurance-registraties voor een event. */
export async function listEnduranceRegistrations(eventId: string): Promise<EnduranceRegistrationRow[]> {
  assertEnduranceTable(TABLE);
  const { data, error } = await enduranceClient()
    .from("endurance_registrations")
    .select(selectColumns)
    .eq("event_id", eventId);
  if (error) throw new Error(`Endurance registraties laden mislukt: ${error.message}`);
  return (data ?? []) as EnduranceRegistrationRow[];
}

/** Plain: alle endurance-registraties (voor overzichts-tabs). */
export async function listAllEnduranceRegistrations(): Promise<EnduranceRegistrationRow[]> {
  assertEnduranceTable(TABLE);
  const { data, error } = await enduranceClient().from("endurance_registrations").select(selectColumns);
  if (error) throw new Error(`Endurance registraties laden mislukt: ${error.message}`);
  return (data ?? []) as EnduranceRegistrationRow[];
}

export type UpsertEnduranceRegistrationInput = {
  id?: string;
  event_id: string;
  user_id: string;
  status: EnduranceRegistrationRow["status"];
  class_preference?: string | null;
  preferred_car_id?: string | null;
  slot_id?: string | null;
  max_stints?: number | null;
  max_stint_minutes?: number | null;
  max_total_minutes?: number | null;
  max_consecutive_stints?: number | null;
  min_rest_minutes?: number | null;
  night_driving?: boolean;
  willing_to_start?: boolean;
  willing_to_finish?: boolean;
  notes?: string | null;
};

/** Plain: maak of werk een endurance-registratie bij (super-admin-sessie). */
export async function upsertEnduranceRegistration(
  input: UpsertEnduranceRegistrationInput
): Promise<EnduranceRegistrationRow> {
  assertEnduranceTable(TABLE);
  const { data, error } = await enduranceClient()
    .from("endurance_registrations")
    .upsert({
      id: input.id,
      event_id: input.event_id,
      user_id: input.user_id,
      status: input.status,
      class_preference: input.class_preference ?? null,
      preferred_car_id: input.preferred_car_id ?? null,
      slot_id: input.slot_id ?? null,
      max_stints: input.max_stints ?? null,
      max_stint_minutes: input.max_stint_minutes ?? null,
      max_total_minutes: input.max_total_minutes ?? null,
      max_consecutive_stints: input.max_consecutive_stints ?? null,
      min_rest_minutes: input.min_rest_minutes ?? null,
      night_driving: input.night_driving ?? false,
      willing_to_start: input.willing_to_start ?? false,
      willing_to_finish: input.willing_to_finish ?? false,
      notes: input.notes ?? null,
    }, { onConflict: "event_id,user_id" })
    .select(selectColumns)
    .single();
  if (error) throw new Error(`Endurance registratie opslaan mislukt: ${error.message}`);
  return data as EnduranceRegistrationRow;
}

/** TanStack Query: lijst registraties voor een event. */
export function useEnduranceRegistrations(eventId: string) {
  return useQuery({
    queryKey: ["endurance", "registrations", eventId],
    queryFn: () => listEnduranceRegistrations(eventId),
    enabled: Boolean(eventId),
  });
}

/** TanStack Query: alle endurance-registraties (overzichts-tabs). */
export function useAllEnduranceRegistrations() {
  return useQuery({
    queryKey: ["endurance", "registrations", "all"],
    queryFn: listAllEnduranceRegistrations,
  });
}

/** TanStack Query: schrijf een registratie-upsert. */
export function useUpsertEnduranceRegistration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: upsertEnduranceRegistration,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["endurance", "registrations", data.event_id] });
    },
  });
}
