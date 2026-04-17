import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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
    queryFn: async () => {
      const { data } = await (supabase as any).from("teams").select("*").order("name");
      return (data || []) as any[];
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
