import { describe, expect, it } from "vitest";
import { eventManagedFields } from "../features/endurance/calendar/eventFormPayload";
import type { EnduranceEventRow } from "../features/endurance/repository/eventsRepository";

const existing = {
  image_url: "https://example.invalid/race.webp",
  slots: [{ id: "slot-existing", startAt: "2026-09-01T12:00:00Z", label: "14:00" }],
  selected_class_id: "GT3",
  selected_car_id: "ferrari-296-gt3",
  status: "planning",
  source: "season",
  manager_ids: ["manager-1"],
  race_id: "race-1",
} as unknown as EnduranceEventRow;

describe("endurance event edit payload", () => {
  it("behoudt server-managed eventvelden bij bewerken", () => {
    expect(eventManagedFields(existing, { id: "replacement" })).toEqual({
      image_url: existing.image_url,
      slots: existing.slots,
      selected_class_id: "GT3",
      selected_car_id: "ferrari-296-gt3",
      status: "planning",
      source: "season",
      manager_ids: ["manager-1"],
      race_id: "race-1",
    });
  });

  it("gebruikt veilige defaults uitsluitend bij een nieuw event", () => {
    const slot = { id: "new-slot" };
    expect(eventManagedFields(undefined, slot)).toEqual({
      image_url: null,
      slots: [slot],
      selected_class_id: null,
      selected_car_id: null,
      status: "registration_open",
      source: "manual",
      manager_ids: [],
      race_id: null,
    });
  });
});
