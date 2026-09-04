import { describe, expect, it } from "vitest";
import { enduranceEventRowToAppModel } from "./mappers";
import type { EnduranceEventRow } from "./eventsRepository";

const makeRow = (overrides?: Partial<EnduranceEventRow>): EnduranceEventRow => ({
  id: "test-1",
  name: "Testrace",
  circuit: "Circuit Zandvoort",
  configuration: "Grand Prix",
  image_url: null,
  start_at: "2026-09-10T09:00:00Z",
  end_at: "2026-09-10T21:00:00Z",
  briefing_start_at: null,
  expected_end_at: null,
  registration_deadline: null,
  slots: [],
  class_ids: ["gt3"],
  selected_class_id: null,
  selected_car_id: null,
  max_drivers_per_car: 4,
  visibility: "open",
  status: "registration_open",
  source: "manual",
  invited_user_ids: [],
  manager_ids: [],
  race_id: null,
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
  ...overrides,
});

describe("enduranceEventRowToAppModel", () => {
  it("converts a normal array of slots", () => {
    const row = makeRow({
      slots: [
        { id: "slot-a", label: "Vroeg", startAt: "09:00" },
        { id: "slot-b", label: "Laat", startAt: "20:00" },
      ],
    });
    const model = enduranceEventRowToAppModel(row);
    expect(model.slots).toHaveLength(2);
    expect(model.slots[0].id).toBe("slot-a");
    expect(model.slots[0].label).toBe("Vroeg");
    expect(model.slots[0].startAt).toBe("09:00");
  });

  it("handles empty array", () => {
    const row = makeRow({ slots: [] });
    const model = enduranceEventRowToAppModel(row);
    expect(model.slots).toEqual([]);
  });

  it("handles null slots — fallback to empty array", () => {
    const row = makeRow({ slots: null as unknown as unknown[] });
    const model = enduranceEventRowToAppModel(row);
    expect(model.slots).toEqual([]);
  });

  it("handles undefined slots — fallback to empty array", () => {
    const row = makeRow({ slots: undefined as unknown as unknown[] });
    const model = enduranceEventRowToAppModel(row);
    expect(model.slots).toEqual([]);
  });

  it("handles non-array object {} — normalizes to empty array", () => {
    const row = makeRow({ slots: {} as unknown as unknown[] });
    const model = enduranceEventRowToAppModel(row);
    expect(model.slots).toEqual([]);
  });

  it("handles object with extra keys {} — normalizes to empty array", () => {
    const row = makeRow({ slots: { items: [] } as unknown as unknown[] });
    const model = enduranceEventRowToAppModel(row);
    expect(model.slots).toEqual([]);
  });

  it("handles string value — normalizes to empty array", () => {
    const row = makeRow({ slots: "oops" as unknown as unknown[] });
    const model = enduranceEventRowToAppModel(row);
    expect(model.slots).toEqual([]);
  });

  it("handles numeric value — normalizes to empty array", () => {
    const row = makeRow({ slots: 42 as unknown as unknown[] });
    const model = enduranceEventRowToAppModel(row);
    expect(model.slots).toEqual([]);
  });

  it("preserves slots without label — fallback to id", () => {
    const row = makeRow({
      slots: [{ id: "slot-x" } as { id: string; label?: string; startAt?: string }],
    });
    const model = enduranceEventRowToAppModel(row);
    expect(model.slots[0].label).toBe("slot-x");
  });

  it("preserves slots without startAt — fallback to event start_at", () => {
    const row = makeRow({
      slots: [{ id: "slot-y", label: "Middag" } as { id: string; label?: string; startAt?: string }],
    });
    const model = enduranceEventRowToAppModel(row);
    expect(model.slots[0].startAt).toBe("2026-09-10T09:00:00Z");
  });

  it("converts row-level start_at, end_at and other fields correctly", () => {
    const row = makeRow();
    const model = enduranceEventRowToAppModel(row);
    expect(model.id).toBe("test-1");
    expect(model.name).toBe("Testrace");
    expect(model.startAt).toBe("2026-09-10T09:00:00Z");
    expect(model.endAt).toBe("2026-09-10T21:00:00Z");
  });
});