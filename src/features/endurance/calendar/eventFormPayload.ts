import type { EnduranceEventRow } from "../repository/eventsRepository";

/** Slot-vorm die door de kalender wordt gebruikt (eventManagedFields default). */
export type EnduranceSlotSeed = { id: string; startAt?: string; label?: string };

export const eventManagedFields = (existing: EnduranceEventRow | undefined, defaultSlot?: EnduranceSlotSeed) => ({
  image_url: existing?.image_url ?? null,
  slots: (existing?.slots as EnduranceSlotSeed[] | undefined) ?? (defaultSlot ? [defaultSlot] : []),
  selected_class_id: existing?.selected_class_id ?? null,
  selected_car_id: existing?.selected_car_id ?? null,
  status: existing?.status ?? "registration_open" as const,
  source: existing?.source ?? "manual",
  manager_ids: existing?.manager_ids ?? [],
  race_id: existing?.race_id ?? null,
});
