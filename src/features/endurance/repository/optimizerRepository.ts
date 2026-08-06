import { supabase } from "@/integrations/supabase/client";
import type { OptimizerFetcher } from "../stints/jresOptimizer";

/**
 * Optimizer-microservice-fetcher — woont in de repository-laag (het toegestane
 * Supabase-touchpoint van Fase 3). De planning-kern zelf blijft netwerk-vrij;
 * deze module koppelt de kern aan de Supabase edge function "endurance-optimize"
 * die als schone proxy naar de JRES/HiGHS microservice gaat.
 */
export const defaultOptimizerFetcher: OptimizerFetcher = async (input, options) => {
  const { data, error } = await supabase.functions.invoke("endurance-optimize", { body: { input, options } });
  if (error) throw new Error(`Optimizer-aanroep mislukt: ${error.message}`);
  return data as { status: string; output?: unknown };
};
