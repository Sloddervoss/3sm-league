import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type EnduranceCapabilities = {
  can_access: boolean;
  can_pair_own_device: boolean;
  can_ingest_own_device: boolean;
  can_manage_events: boolean;
  can_manage_devices: boolean;
  multi_user_realtime_enabled: boolean;
  simhub_ingest_enabled: boolean;
};

type LegacyRoles = {
  isSuperAdmin: boolean;
  isEnduranceManager: boolean;
};

/**
 * Noodfallback wanneer de capabilities-RPC ontbreekt of faalt.
 *
 * Deze fallback is met opzet FAIL-CLOSED voor gewone leden. De server (RLS en
 * de SECURITY DEFINER-functies) handhaaft de echte toegang; de frontend mag
 * daar nooit ruimer over doen dan de server toestaat.
 *
 * Beheerders houden toegang, omdat `is_endurance_manager` server-side dezelfde
 * rechten geeft. Een gewoon lid krijgt hier niets: de ledenvlaggen staan alleen
 * in `endurance_runtime_settings` en zijn niet client-leesbaar, dus we kunnen
 * ze hier niet betrouwbaar afleiden. Bij een storing liever geen toegang dan
 * toegang op een gok.
 *
 * LET OP: hier stond voorheen `staff = super_admin || endurance_manager || tester`
 * met volledige toegang. Dat gaf bij een kapotte RPC volledige toegang aan
 * testers en sloot tegelijk elk gewoon lid buiten — precies omgekeerd aan het
 * doel van de open beta.
 */
export const staffFallbackCapabilities = (roles: LegacyRoles): EnduranceCapabilities => {
  const manager = roles.isSuperAdmin || roles.isEnduranceManager;
  return {
    can_access: manager,
    can_pair_own_device: manager,
    can_ingest_own_device: manager,
    can_manage_events: manager,
    can_manage_devices: manager,
    multi_user_realtime_enabled: false,
    simhub_ingest_enabled: true,
  };
};

export const getEnduranceCapabilities = async (): Promise<EnduranceCapabilities> => {
  const { data, error } = await supabase.rpc("endurance_current_capabilities");
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw new Error("Endurance-capabilities ontbreken.");
  return row;
};

export const useEnduranceCapabilities = (userId: string | undefined, roles: LegacyRoles) => {
  const fallback = staffFallbackCapabilities(roles);
  const query = useQuery({
    queryKey: ["endurance", "capabilities", userId],
    queryFn: getEnduranceCapabilities,
    enabled: Boolean(userId),
    staleTime: 60_000,
    retry: 1,
  });
  return {
    ...query,
    capabilities: query.data ?? fallback,
    // Waar: de RPC gaf geen antwoord en we vallen terug op de noodfallback.
    // Callers kunnen dit gebruiken om "kon niet laden" te tonen in plaats van
    // een misleidende "besloten omgeving".
    usingFallback: !query.data,
  };
};
