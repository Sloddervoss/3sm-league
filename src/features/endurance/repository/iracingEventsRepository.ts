import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { assertEnduranceTable, enduranceClient } from "./dataAccess";
import type { IRacingCatalogEvent, IRacingCatalogSlot } from "../calendar/iracingCatalogPresentation";

const EVENT_COLUMNS = "id,source_key,name,year,circuit,configuration,event_start_date,event_end_date,duration_minutes,class_ids,local_class_ids,team_event,official_url,poster_url,availability_status,source_updated_at,last_seen_at,active";
const SLOT_COLUMNS = "id,catalog_event_id,source_slot_key,session_start_at,practice_start_at,practice_duration_minutes,qualifying_start_at,qualifying_duration_minutes,transition_duration_minutes,estimated_race_start_at,race_duration_minutes,race_lap_limit,session_duration_minutes,session_timing_status,label,active";
const LOCAL_LINK_COLUMNS = "id,iracing_catalog_event_id,iracing_catalog_slot_id";

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
  return ((eventsResult.data ?? []) as Omit<IRacingCatalogEvent, "slots" | "selectedEventId" | "selectedSlotId">[]).map((event) => {
    const link = links.find((candidate) => candidate.iracing_catalog_event_id === event.id);
    return {
      ...event,
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

export function useIRacingEnduranceCatalog() {
  return useQuery({ queryKey: iracingCatalogQueryKey, queryFn: listIRacingEnduranceCatalog });
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
