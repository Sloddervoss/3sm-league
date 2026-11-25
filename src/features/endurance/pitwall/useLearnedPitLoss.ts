import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { loadLearnedPitLoss, type LearnedPitLoss, type PitLossScope } from "./strategy/learnedPitLoss";

/**
 * Haalt het geleerde pitverlies op voor de auto/baan van dit frame.
 *
 * De sleutel hangt aan de context en niet aan de sessie: het geleerde verlies is
 * een eigenschap van auto plus baan, niet van deze stint. Zonder volledige
 * identiteit wordt er niets gevraagd — dan is er ook niets te leren.
 */
export function useLearnedPitLoss(scope: PitLossScope): LearnedPitLoss | null {
  const enabled = Boolean(scope.car && scope.track);
  const query = useQuery({
    queryKey: ["pitwall", "learnedPitLoss", scope.car, scope.track, scope.config],
    queryFn: () => loadLearnedPitLoss(supabase, scope),
    enabled,
    refetchInterval: 60_000,
    staleTime: 55_000,
  });
  return query.data ?? null;
}
