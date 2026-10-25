import { useQuery } from "@tanstack/react-query";
import { enduranceClient } from "./dataAccess";

/**
 * Tankduur en stintlengte uit het archief (punt 8).
 *
 * `endurance_learning_summary` leert per auto én baan uit de gearchiveerde
 * rondes: gemiddeld verbruik per ronde, gemiddelde rondetijd en daaruit de
 * tankduur in minuten. Dat is de gemeten werkelijkheid van deze auto op deze
 * baan (24-10: 2,94 liter en 95,67 s per ronde met 104 liter → 56,4 minuten),
 * in plaats van één getal uit de autospecificatie.
 *
 * De functie geeft altijd één rij terug, ook als er te weinig rondes zijn. Dan
 * zijn `tank_minutes` en de bron "unknown"/"spec_prior"; de aanroeper valt dan
 * terug op `tankMinutesFromSpec` in `stints/tankDuration.ts`.
 */
export type EnduranceLearningSummary = {
  car_id: string | null;
  track_id: string | null;
  tank_capacity_litres: number | null;
  sample_laps: number;
  avg_fuel_per_lap_litres: number | null;
  avg_lap_seconds: number | null;
  laps_per_tank: number | null;
  tank_minutes: number | null;
  fuel_per_lap_source: string;
  lap_seconds_source: string;
  first_lap_at: string | null;
  last_lap_at: string | null;
};

const toNumber = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const toText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};

/**
 * PostgREST stuurt `numeric` als JSON-getal, maar bij een tussenlaag of een
 * cast kan er een string binnenkomen. Wat geen getal is wordt null — nooit nul,
 * want nul liter per ronde zou de tankduur oneindig maken.
 */
export const normaliseLearningSummaryRow = (row: Record<string, unknown>): EnduranceLearningSummary => ({
  car_id: toText(row.car_id),
  track_id: toText(row.track_id),
  tank_capacity_litres: toNumber(row.tank_capacity_litres),
  sample_laps: toNumber(row.sample_laps) ?? 0,
  avg_fuel_per_lap_litres: toNumber(row.avg_fuel_per_lap_litres),
  avg_lap_seconds: toNumber(row.avg_lap_seconds),
  laps_per_tank: toNumber(row.laps_per_tank),
  tank_minutes: toNumber(row.tank_minutes),
  fuel_per_lap_source: toText(row.fuel_per_lap_source) ?? "unknown",
  lap_seconds_source: toText(row.lap_seconds_source) ?? "unknown",
  first_lap_at: toText(row.first_lap_at),
  last_lap_at: toText(row.last_lap_at),
});

/** Leest de leerwaarde voor deze auto op deze baan. `null` als de functie niets teruggaf. */
export const fetchEnduranceLearningSummary = async (
  carId: string,
  trackId?: string | null,
): Promise<EnduranceLearningSummary | null> => {
  const { data, error } = await enduranceClient().rpc("endurance_learning_summary", {
    p_car_id: carId,
    p_track_id: trackId ?? null,
  });
  if (error) throw new Error(error.message);
  const rows = (Array.isArray(data) ? data : data ? [data] : []) as Array<Record<string, unknown>>;
  const [row] = rows;
  return row ? normaliseLearningSummaryRow(row) : null;
};

/**
 * `trackId` mag de iRacing track-id zijn of de circuitnaam van het event; de
 * databaselaag zoekt een naam op via de catalogus. Zonder auto geen vraag.
 */
export const useEnduranceLearningSummary = (
  carId: string | null | undefined,
  trackId: string | null | undefined,
) =>
  useQuery({
    queryKey: ["endurance", "learning-summary", carId, trackId ?? null],
    queryFn: () => fetchEnduranceLearningSummary(carId as string, trackId ?? null),
    enabled: Boolean(carId),
    staleTime: 10 * 60_000,
    retry: 1,
  });
