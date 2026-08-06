import type { EnduranceEventRow } from "./eventsRepository";
import type { EnduranceStintRow } from "./stintsRepository";
import type { EnduranceEvent, EnduranceStint } from "../core/types";

/**
 * Fase 3 — mapper DB-row → app-model.
 *
 * De bestaande UI werkt met het `EnduranceEvent`-app-model (camelCase). Deze
 * mapper vormt een DB-row (snake_case, echte UUID) om naar dat model, zodat de
 * rest van de componenten identiek blijven werken maar met het ECHTE DB-id
 * (nodig voor FK-correcte writes naar endurance_registrations/teams/stints).
 */
export function enduranceEventRowToAppModel(row: EnduranceEventRow): EnduranceEvent {
  const slots = (row.slots ?? []) as Array<{ id: string; label?: string; startAt?: string }>;
  return {
    id: row.id,
    name: row.name,
    circuit: row.circuit,
    configuration: row.configuration ?? "",
    imageUrl: row.image_url,
    startAt: row.start_at,
    endAt: row.end_at,
    briefingStartAt: row.briefing_start_at ?? row.start_at,
    expectedEndAt: row.expected_end_at ?? row.end_at,
    registrationDeadline: row.registration_deadline ?? "",
    slots: slots.map((slot) => ({ id: slot.id, startAt: slot.startAt ?? row.start_at, label: slot.label ?? slot.id })),
    classIds: row.class_ids as EnduranceEvent["classIds"],
    selectedClassId: row.selected_class_id as EnduranceEvent["selectedClassId"],
    selectedCarId: row.selected_car_id,
    maxDriversPerCar: row.max_drivers_per_car,
    visibility: row.visibility,
    status: row.status,
    source: (row.source ?? "manual") as EnduranceEvent["source"],
    invitedUserIds: row.invited_user_ids,
    managerIds: row.manager_ids,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function enduranceEventRowsToAppModels(rows: EnduranceEventRow[]): EnduranceEvent[] {
  return rows.map(enduranceEventRowToAppModel);
}

// ============================ STINT-MAPPER ==================================

/** DB stint-row (snake_case) → app-model (camelCase). */
export function enduranceStintRowToAppModel(row: EnduranceStintRow): EnduranceStint {
  return {
    id: row.id,
    eventId: row.event_id,
    teamId: row.team_id,
    driverId: row.driver_id ?? "",
    originalStartAt: row.original_start_at,
    originalEndAt: row.original_end_at,
    actualStartAt: row.actual_start_at ?? row.original_start_at,
    actualEndAt: row.actual_end_at ?? row.original_end_at,
    expectedLaps: row.expected_laps ?? 0,
    fuelLitres: row.fuel_litres ?? 0,
    tyreChange: row.tyre_change,
    doubleStint: row.double_stint,
    notes: row.notes ?? "",
    status: row.status,
  };
}

export function enduranceStintRowsToAppModels(rows: EnduranceStintRow[]): EnduranceStint[] {
  return rows.map(enduranceStintRowToAppModel);
}
