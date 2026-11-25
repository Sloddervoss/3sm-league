import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Deelknop voor race-pitstops.
 *
 * Staat standaard aan (beleid v2): bijdragen is anoniem en gaat alleen over baan,
 * layout en tijden. De knop stuurt één RPC en ververst daarna het geleerde
 * verlies, zodat je meteen ziet wat je eigen bijdrage doet.
 */
export interface PoolingState {
  enabled: boolean;
  source: "policy" | "default" | "unauthenticated";
}

export async function loadPoolingState(): Promise<PoolingState> {
  const { data, error } = await supabase.rpc("pitwall_pooling_state");
  if (error) return { enabled: true, source: "default" };
  const record = (data ?? {}) as Record<string, unknown>;
  return {
    enabled: record.poolingEnabled !== false,
    source: record.source === "policy" ? "policy" : record.source === "unauthenticated" ? "unauthenticated" : "default",
  };
}

export function usePoolingPreference() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["pitwall", "pooling"],
    queryFn: loadPoolingState,
    refetchInterval: 300_000,
  });
  const mutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const { error } = await supabase.rpc("pitwall_set_pooling", { p_enabled: enabled });
      if (error) throw new Error(error.message);
      return enabled;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["pitwall", "pooling"] });
      void queryClient.invalidateQueries({ queryKey: ["pitwall", "learnedPitLoss"] });
    },
  });
  return {
    enabled: query.data?.enabled ?? true,
    pending: mutation.isPending,
    failed: mutation.isError,
    toggle: () => mutation.mutate(!(query.data?.enabled ?? true)),
  };
}
