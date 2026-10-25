import { describe, expect, it, vi } from "vitest";
import {
  fetchEnduranceLearningSummary,
  normaliseLearningSummaryRow,
} from "./learningRepository";

const spies = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: spies.rpc },
}));

// De rij zoals PostgREST hem teruggeeft voor de race van 24-10: 104 liter,
// 2,94 liter per ronde, 95,67 s per ronde → 35,4 rondes en 56,4 minuten.
const archivedRow = {
  car_id: "lamborghinievogt3",
  track_id: "18",
  tank_capacity_litres: "104.00",
  sample_laps: 35,
  avg_fuel_per_lap_litres: "2.940",
  avg_lap_seconds: "95.670",
  laps_per_tank: "35.4",
  tank_minutes: "56.4",
  fuel_per_lap_source: "archive",
  lap_seconds_source: "archive",
  first_lap_at: "2026-10-24T11:05:00+00:00",
  last_lap_at: "2026-10-24T12:02:00+00:00",
};

describe("endurance learning repository", () => {
  it("vraagt de leerwaarde op voor deze auto en deze baan", async () => {
    spies.rpc.mockResolvedValue({ data: [archivedRow], error: null });

    const summary = await fetchEnduranceLearningSummary("lamborghinievogt3", "18");

    expect(spies.rpc).toHaveBeenCalledWith("endurance_learning_summary", {
      p_car_id: "lamborghinievogt3",
      p_track_id: "18",
    });
    expect(summary?.tank_minutes).toBe(56.4);
    expect(summary?.avg_fuel_per_lap_litres).toBe(2.94);
    expect(summary?.avg_lap_seconds).toBe(95.67);
    expect(summary?.sample_laps).toBe(35);
    expect(summary?.fuel_per_lap_source).toBe("archive");
  });

  it("stuurt null als baan mee wanneer er geen baan bekend is", async () => {
    spies.rpc.mockResolvedValue({ data: [], error: null });

    await fetchEnduranceLearningSummary("lamborghinievogt3");

    expect(spies.rpc).toHaveBeenCalledWith("endurance_learning_summary", {
      p_car_id: "lamborghinievogt3",
      p_track_id: null,
    });
  });

  it("geeft null terug als de functie geen rij heeft", async () => {
    spies.rpc.mockResolvedValue({ data: [], error: null });

    await expect(fetchEnduranceLearningSummary("lamborghinievogt3", "18")).resolves.toBeNull();
  });

  it("gooit de databasefout door in plaats van hem te verbergen", async () => {
    spies.rpc.mockResolvedValue({ data: null, error: { message: "permission denied" } });

    await expect(fetchEnduranceLearningSummary("lamborghinievogt3", "18")).rejects.toThrow(
      "permission denied",
    );
  });

  it("maakt van een lege of onbruikbare rij eerlijke nullen, geen verzonnen getal", () => {
    const summary = normaliseLearningSummaryRow({
      car_id: null,
      track_id: "18",
      tank_capacity_litres: null,
      sample_laps: null,
      avg_fuel_per_lap_litres: "",
      avg_lap_seconds: "geen getal",
      laps_per_tank: null,
      tank_minutes: null,
      fuel_per_lap_source: "unknown",
      lap_seconds_source: "unknown",
      first_lap_at: null,
      last_lap_at: null,
    });

    expect(summary.sample_laps).toBe(0);
    expect(summary.avg_fuel_per_lap_litres).toBeNull();
    expect(summary.avg_lap_seconds).toBeNull();
    expect(summary.tank_minutes).toBeNull();
    expect(summary.car_id).toBeNull();
    expect(summary.fuel_per_lap_source).toBe("unknown");
  });

  it("valt zonder bronkolom terug op unknown in plaats van op archive", () => {
    const summary = normaliseLearningSummaryRow({ sample_laps: 3 });

    expect(summary.sample_laps).toBe(3);
    expect(summary.fuel_per_lap_source).toBe("unknown");
    expect(summary.lap_seconds_source).toBe("unknown");
  });
});
