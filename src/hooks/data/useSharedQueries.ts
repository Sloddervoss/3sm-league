import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type Team = Database["public"]["Tables"]["teams"]["Row"];

/**
 * Shared data hooks for de meest gebruikte queries.
 * Eén bron van waarheid voor query keys + cache.
 */

export function useDrivers() {
  return useQuery({
    queryKey: ["drivers"],
    queryFn: async () => {
      const { data } = await supabase.from("public_profiles").select("*");
      return data || [];
    },
  });
}

/**
 * Publieke driver-id → naam map (iRacing-naam primair, anders profielnaam).
 * Gebruikt door de Endurance-naamresolutie om echte namen te tonen in plaats
 * van kale user-id-nummers. Leest alleen public_profiles.
 */
export function useDriverNameMap(): ReadonlyMap<string, string> {
  return useQuery({
    queryKey: ["driver-name-map"],
    queryFn: async () => {
      const { data } = await supabase
        .from("public_profiles")
        .select("user_id, display_name, iracing_name");
      const map = new Map<string, string>();
      (data ?? []).forEach((row) => {
        const name = (row.iracing_name ?? "").trim() || (row.display_name ?? "").trim();
        if (row.user_id && name) map.set(row.user_id, name);
      });
      return map;
    },
    placeholderData: new Map<string, string>(),
  }).data ?? new Map();
}

export function useTeams() {
  return useQuery({
    queryKey: ["teams"],
    queryFn: async (): Promise<Team[]> => {
      const { data } = await supabase.from("teams").select("*").order("name");
      return data || [];
    },
  });
}

export function useLeagues() {
  return useQuery({
    queryKey: ["leagues-for-standings"],
    queryFn: async () => {
      const { data } = await supabase
        .from("leagues")
        .select("id, name, season, car_class")
        .order("created_at", { ascending: false });
      return data || [];
    },
  });
}
