import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EnduranceOnlyTableName } from "./dataAccess";
import { assertEnduranceTable, enduranceClient } from "./dataAccess";

/**
 * Endurance events repository — Fase 3.
 * Leest uitsluitend uit `endurance_events` (super-admin-only RLS). De RLS
 * weigert elke niet-super-admin; er is GEEN fallback naar seed. Alle functies
 * lopen door assertEnduranceTable, dus een niet-endurance-tabelnaam compileert
 * niet (Typescript) én wordt defensief geweigerd (runtime).
 */
const EVENT_TABLE: EnduranceOnlyTableName = "endurance_events";

export type EnduranceEventRow = {
  id: string;
  name: string;
  circuit: string;
  configuration: string;
  image_url: string | null;
  start_at: string;
  end_at: string;
  briefing_start_at: string | null;
  expected_end_at: string | null;
  registration_deadline: string | null;
  slots: unknown;
  class_ids: string[];
  allowed_car_ids: string[] | null;
  selected_class_id: string | null;
  selected_car_id: string | null;
  max_drivers_per_car: number;
  visibility: "open" | "invite_only" | "hidden";
  status: "draft" | "registration_open" | "registration_closed" | "planning" | "live" | "completed";
  source: string;
  invited_user_ids: string[];
  manager_ids: string[];
  race_id: string | null;
  created_at: string;
  updated_at: string;
};

const selectEventColumns = "id,name,circuit,configuration,image_url,start_at,end_at,briefing_start_at,expected_end_at,registration_deadline,slots,class_ids,allowed_car_ids,selected_class_id,selected_car_id,max_drivers_per_car,visibility,status,source,invited_user_ids,manager_ids,race_id,created_at,updated_at";

/** Plain: lijst alle endurance events. */
export async function listEnduranceEvents(): Promise<EnduranceEventRow[]> {
  assertEnduranceTable(EVENT_TABLE);
  const { data, error } = await enduranceClient()
    .from("endurance_events")
    .select(selectEventColumns)
    .order("start_at", { ascending: true });
  if (error) {
    throw new Error(`Endurance events laden mislukt: ${error.message}`);
  }
  return (data ?? []) as EnduranceEventRow[];
}

/** Plain: haal één endurance event op via id. */
export async function getEnduranceEventById(id: string): Promise<EnduranceEventRow | null> {
  assertEnduranceTable(EVENT_TABLE);
  const { data, error } = await enduranceClient()
    .from("endurance_events")
    .select(selectEventColumns)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    throw new Error(`Endurance event laden mislukt: ${error.message}`);
  }
  return (data as EnduranceEventRow | null) ?? null;
}

const eventQueryKey = (id?: string) => (id ? ["endurance", "events", id] : ["endurance", "events"]);

/** TanStack Query hook: lijst alle endurance events (super-admin-sessie). */
export function useEnduranceEvents() {
  return useQuery({
    queryKey: eventQueryKey(),
    queryFn: listEnduranceEvents,
  });
}

/** TanStack Query hook: één endurance event. */
export function useEnduranceEvent(id?: string) {
  return useQuery({
    queryKey: eventQueryKey(id),
    queryFn: () => getEnduranceEventById(id as string),
    enabled: Boolean(id),
  });
}

// ============================ WRITE-PAD =====================================
// Schrijven loopt uitsluitend door de super-admin-sessie (RLS weigert elke andere
// rol). Er is geen service-role key in de frontend en geen fallback naar seed.

export type CreateEnduranceEventInput = {
  name: string;
  circuit: string;
  configuration: string;
  image_url?: string | null;
  start_at: string;
  end_at: string;
  briefing_start_at?: string | null;
  expected_end_at?: string | null;
  registration_deadline?: string | null;
  slots?: unknown;
  class_ids: string[];
  allowed_car_ids?: string[] | null;
  selected_class_id?: string | null;
  selected_car_id?: string | null;
  max_drivers_per_car?: number;
  visibility: "open" | "invite_only" | "hidden";
  status: "draft" | "registration_open" | "registration_closed" | "planning" | "live" | "completed";
  source?: string;
  invited_user_ids?: string[];
  manager_ids?: string[];
  race_id?: string | null;
};

/** Plain: maak een nieuw endurance event aan (super-admin-sessie). */
export async function createEnduranceEvent(
  input: Omit<CreateEnduranceEventInput, "class_ids_confirmation">
): Promise<EnduranceEventRow> {
  assertEnduranceTable(EVENT_TABLE);
  const { data, error } = await enduranceClient()
    .from("endurance_events")
    .insert({
      name: input.name,
      circuit: input.circuit,
      configuration: input.configuration,
      image_url: input.image_url ?? null,
      start_at: input.start_at,
      end_at: input.end_at,
      briefing_start_at: input.briefing_start_at ?? null,
      expected_end_at: input.expected_end_at ?? null,
      registration_deadline: input.registration_deadline ?? null,
      slots: input.slots ?? [],
      class_ids: input.class_ids,
      // NULL betekent: handmatig event gebruikt de volledige catalogus.
      // Alleen iRacing-activatie schrijft een concrete fail-closed whitelist.
      allowed_car_ids: input.allowed_car_ids ?? null,
      selected_class_id: input.selected_class_id ?? null,
      selected_car_id: input.selected_car_id ?? null,
      max_drivers_per_car: input.max_drivers_per_car ?? 4,
      visibility: input.visibility,
      status: input.status,
      invited_user_ids: input.invited_user_ids ?? [],
    })
    .select(selectEventColumns)
    .single();
  if (error) {
    throw new Error(`Endurance event aanmaken mislukt: ${error.message}`);
  }
  return data as EnduranceEventRow;
}

/** Plain: werk een bestaand endurance event bij (super-admin-sessie). */
export async function updateEnduranceEvent(
  id: string,
  patch: Partial<Omit<CreateEnduranceEventInput, "class_ids_confirmation">>
): Promise<EnduranceEventRow> {
  assertEnduranceTable(EVENT_TABLE);
  const { data, error } = await enduranceClient()
    .from("endurance_events")
    .update({
      name: patch.name,
      circuit: patch.circuit,
      configuration: patch.configuration,
      image_url: patch.image_url,
      start_at: patch.start_at,
      end_at: patch.end_at,
      briefing_start_at: patch.briefing_start_at,
      expected_end_at: patch.expected_end_at,
      registration_deadline: patch.registration_deadline,
      slots: patch.slots,
      class_ids: patch.class_ids,
      allowed_car_ids: patch.allowed_car_ids,
      selected_class_id: patch.selected_class_id,
      selected_car_id: patch.selected_car_id,
      max_drivers_per_car: patch.max_drivers_per_car,
      visibility: patch.visibility,
      status: patch.status,
      invited_user_ids: patch.invited_user_ids,
    })
    .eq("id", id)
    .select(selectEventColumns)
    .single();
  if (error) {
    throw new Error(`Endurance event bijwerken mislukt: ${error.message}`);
  }
  return data as EnduranceEventRow;
}

/** TanStack Query hook: maak of werk een endurance event bij via de super-admin-sessie. */
export function useUpsertEnduranceEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { id?: string } & Omit<CreateEnduranceEventInput, "class_ids_confirmation">) =>
      args.id
        ? updateEnduranceEvent(args.id, args)
        : createEnduranceEvent(args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["endurance", "events"] });
    },
  });
}

/** Plain: verwijder een endurance event (super-admin-sessie). */
export async function deleteEnduranceEvent(id: string): Promise<void> {
  assertEnduranceTable(EVENT_TABLE);
  const { error } = await enduranceClient().from("endurance_events").delete().eq("id", id);
  if (error) {
    throw new Error(`Endurance event verwijderen mislukt: ${error.message}`);
  }
}

/** TanStack Query hook: verwijder een endurance event. */
export function useDeleteEnduranceEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteEnduranceEvent,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["endurance", "events"] });
    },
  });
}
