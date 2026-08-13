import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { assertEnduranceTable, enduranceClient } from "./dataAccess";
import type { IRacingCatalogCar, IRacingCatalogEvent, IRacingCatalogSlot, IRacingSlotInterestMember, IRacingSlotInterestSummaryRow } from "../calendar/iracingCatalogPresentation";

const EVENT_COLUMNS = "id,source_key,name,year,circuit,configuration,event_start_date,event_end_date,duration_minutes,class_ids,local_class_ids,local_car_ids,cars,team_event,official_url,poster_url,availability_status,source_updated_at,last_seen_at,active";
const SLOT_COLUMNS = "id,catalog_event_id,source_slot_key,session_start_at,practice_start_at,practice_duration_minutes,qualifying_start_at,qualifying_duration_minutes,transition_duration_minutes,estimated_race_start_at,race_duration_minutes,race_lap_limit,session_duration_minutes,session_timing_status,label,active";
const LOCAL_LINK_COLUMNS = "id,iracing_catalog_event_id,iracing_catalog_slot_id";

/** Normaliseer het `cars` JSONB-veld (Json) naar een array van IRacingCatalogCar. */
const normalizeCars = (raw: unknown): IRacingCatalogCar[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry): IRacingCatalogCar | null => {
      if (entry === null || typeof entry !== "object") return null;
      const row = entry as Record<string, unknown>;
      const name = typeof row.name === "string" ? row.name : null;
      if (!name) return null;
      const car: IRacingCatalogCar = {
        id: typeof row.id === "string" ? row.id : undefined,
        sourceKey: typeof row.sourceKey === "string" ? row.sourceKey : typeof row.source_key === "string" ? row.source_key : undefined,
        name,
        imageUrl: typeof row.imageUrl === "string" ? row.imageUrl : typeof row.image_url === "string" ? row.image_url : null,
        officialClassId: typeof row.officialClassId === "string" ? row.officialClassId : typeof row.official_class_id === "string" ? row.official_class_id : null,
        localCarId: typeof row.localCarId === "string" ? row.localCarId : typeof row.local_car_id === "string" ? row.local_car_id : null,
      };
      return car;
    })
    .filter((entry): entry is IRacingCatalogCar => entry !== null);
};

export type ActivateIRacingSlotInput = {
  catalogEventId: string;
  catalogSlotId: string;
  registrationDeadline: string | null;
  visibility: "open" | "invite_only" | "hidden";
  maxDriversPerCar: number;
  invitedUserIds: string[];
};

export async function listIRacingEnduranceCatalog(): Promise<IRacingCatalogEvent[]> {
  assertEnduranceTable("endurance_iracing_events");
  assertEnduranceTable("endurance_iracing_event_slots");
  const [eventsResult, slotsResult, linksResult] = await Promise.all([
    enduranceClient().from("endurance_iracing_events").select(EVENT_COLUMNS).eq("active", true).order("event_start_date", { ascending: true }),
    enduranceClient().from("endurance_iracing_event_slots").select(SLOT_COLUMNS).eq("active", true).order("session_start_at", { ascending: true }),
    enduranceClient().from("endurance_events").select(LOCAL_LINK_COLUMNS).not("iracing_catalog_event_id", "is", null),
  ]);
  if (eventsResult.error) throw new Error(`iRacing endurancecatalogus laden mislukt: ${eventsResult.error.message}`);
  if (slotsResult.error) throw new Error(`iRacing endurance-timeslots laden mislukt: ${slotsResult.error.message}`);
  if (linksResult.error) throw new Error(`3SM-slotselecties laden mislukt: ${linksResult.error.message}`);

  const slots = (slotsResult.data ?? []) as IRacingCatalogSlot[];
  const links = (linksResult.data ?? []) as Array<{ id: string; iracing_catalog_event_id: string; iracing_catalog_slot_id: string }>;
  return ((eventsResult.data ?? []) as {
    id: string;
    source_key: string;
    name: string;
    year: number;
    circuit: string | null;
    configuration: string | null;
    event_start_date: string | null;
    event_end_date: string | null;
    duration_minutes: number | null;
    class_ids: string[];
    local_class_ids: string[];
    local_car_ids: string[];
    cars: unknown;
    team_event: boolean;
    official_url: string | null;
    poster_url: string | null;
    availability_status: "exact_slots" | "date_only" | "tbd";
    source_updated_at: string | null;
    last_seen_at: string;
    active: boolean;
  }[]).map((event) => {
    const link = links.find((candidate) => candidate.iracing_catalog_event_id === event.id);
    return {
      id: event.id,
      source_key: event.source_key,
      name: event.name,
      year: event.year,
      circuit: event.circuit,
      configuration: event.configuration,
      event_start_date: event.event_start_date,
      event_end_date: event.event_end_date,
      duration_minutes: event.duration_minutes,
      class_ids: event.class_ids,
      local_class_ids: event.local_class_ids,
      local_car_ids: event.local_car_ids,
      cars: normalizeCars(event.cars),
      team_event: event.team_event,
      official_url: event.official_url,
      poster_url: event.poster_url,
      availability_status: event.availability_status,
      source_updated_at: event.source_updated_at,
      last_seen_at: event.last_seen_at,
      active: event.active,
      slots: slots.filter((slot) => slot.catalog_event_id === event.id),
      selectedEventId: link?.id ?? null,
      selectedSlotId: link?.iracing_catalog_slot_id ?? null,
    };
  });
}

export async function activateIRacingEnduranceSlot(input: ActivateIRacingSlotInput): Promise<string> {
  const { data, error } = await enduranceClient().rpc("endurance_activate_iracing_slot", {
    p_catalog_event_id: input.catalogEventId,
    p_catalog_slot_id: input.catalogSlotId,
    p_registration_deadline: input.registrationDeadline,
    p_visibility: input.visibility,
    p_max_drivers_per_car: input.maxDriversPerCar,
    p_invited_user_ids: input.invitedUserIds,
  });
  if (error) throw new Error(`iRacing-timeslot activeren mislukt: ${error.message}`);
  if (typeof data !== "string") throw new Error("iRacing-timeslot is geactiveerd zonder geldige 3SM-race-ID.");
  return data;
}

export const iracingCatalogQueryKey = ["endurance", "iracing-catalog"] as const;
export const iracingSlotInterestSummaryQueryKey = ["endurance", "iracing-slot-interest-summary"] as const;

export function useIRacingEnduranceCatalog() {
  return useQuery({ queryKey: iracingCatalogQueryKey, queryFn: listIRacingEnduranceCatalog });
}

/** Laadt per timeslot uitsluitend het aggregaat en de keuze van de huidige gebruiker. */
export async function listIRacingSlotInterestSummary(): Promise<IRacingSlotInterestSummaryRow[]> {
  assertEnduranceTable("endurance_iracing_event_slots");
  const { data, error } = await enduranceClient().rpc("endurance_iracing_slot_interest_summary");
  if (error) throw new Error(`iRacing-animo laden mislukt: ${error.message}`);
  return ((data ?? []) as Array<IRacingSlotInterestSummaryRow & { interested_count: number | string }>).map((row) => ({
    ...row,
    // PostgreSQL BIGINT wordt door PostgREST als string geserialiseerd.
    interested_count: Number(row.interested_count),
  }));
}

export function useIRacingSlotInterestSummary() {
  return useQuery({ queryKey: iracingSlotInterestSummaryQueryKey, queryFn: listIRacingSlotInterestSummary });
}

/** Zet de eigen beschikbaarheid voor exact één officieel timeslot aan/uit. */
export async function setIRacingSlotInterest(catalogSlotId: string, interested: boolean): Promise<void> {
  assertEnduranceTable("endurance_iracing_event_slots");
  const { error } = await enduranceClient().rpc("endurance_set_iracing_slot_interest", {
    p_catalog_slot_id: catalogSlotId,
    p_interested: interested,
  });
  if (error) throw new Error(`Interesse bijwerken mislukt: ${error.message}`);
}

export function useSetIRacingSlotInterest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ catalogSlotId, interested }: { catalogSlotId: string; interested: boolean }) =>
      setIRacingSlotInterest(catalogSlotId, interested),
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: iracingSlotInterestSummaryQueryKey }),
      queryClient.invalidateQueries({ queryKey: ["endurance", "iracing-slot-interest-members"] }),
    ]),
  });
}

/** Manager-only veilige naamprojectie per slot. De RPC handhaaft de rol server-side. */
export async function listIRacingSlotInterestMembers(catalogEventId: string): Promise<IRacingSlotInterestMember[]> {
  const { data, error } = await enduranceClient().rpc("endurance_iracing_slot_interest_members", {
    p_catalog_event_id: catalogEventId,
  });
  if (error) throw new Error(`Timeslotbeschikbaarheid laden mislukt: ${error.message}`);
  return (data ?? []) as IRacingSlotInterestMember[];
}

export function useIRacingSlotInterestMembers(catalogEventId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["endurance", "iracing-slot-interest-members", catalogEventId],
    queryFn: () => listIRacingSlotInterestMembers(catalogEventId!),
    enabled: enabled && Boolean(catalogEventId),
  });
}

export function useActivateIRacingEnduranceSlot() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: activateIRacingEnduranceSlot,
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: iracingCatalogQueryKey }),
      queryClient.invalidateQueries({ queryKey: ["endurance", "events"] }),
    ]),
  });
}
