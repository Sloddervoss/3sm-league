import { useQuery } from "@tanstack/react-query";
import { assertEnduranceTable, enduranceClient } from "./dataAccess";

/**
 * Autospecificatie uit `endurance_car_specs`: tankinhoud en het verbruik per
 * ronde dat uit de iRacing-SDK is vastgelegd. De stintplanner gebruikt dit om
 * de tankduur uit te rekenen in plaats van hem te laten raden.
 */
const TABLE = "endurance_car_specs" as const;

export type EnduranceCarSpecRow = {
  car_id: string;
  display_name: string | null;
  tank_capacity_litres: number | null;
  fuel_per_lap_prior_litres: number | null;
};

export const useEnduranceCarSpecs = () =>
  useQuery({
    queryKey: ["endurance", "car-specs"],
    queryFn: async (): Promise<EnduranceCarSpecRow[]> => {
      assertEnduranceTable(TABLE);
      const { data, error } = await enduranceClient()
        .from(TABLE)
        .select("car_id,display_name,tank_capacity_litres,fuel_per_lap_prior_litres")
        .limit(500);
      if (error) throw new Error(error.message);
      return (data ?? []) as EnduranceCarSpecRow[];
    },
    staleTime: 5 * 60_000,
  });
