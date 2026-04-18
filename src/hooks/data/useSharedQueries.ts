import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type Team = Database["public"]["Tables"]["teams"]["Row"];

/**
 * Shared data hooks for de meest gebruikte queries.
 * Eén bron van waarheid voor query keys + cache.
 * Selecteert altijd alle kolommen — als dat performance kost, kan per-hook select aangepast worden.
 */

export function useDrivers() {
  return useQuery({
    queryKey: ["drivers"],
    queryFn: async () => {
      const { data } = await supabase.from("confirmed_profiles").select("*");
      return data || [];
    },
  });
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
