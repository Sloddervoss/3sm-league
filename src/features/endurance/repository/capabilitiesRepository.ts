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
  isTester: boolean;
};

export const alphaSafeCapabilities = (roles: LegacyRoles): EnduranceCapabilities => {
  const staff = roles.isSuperAdmin || roles.isEnduranceManager || roles.isTester;
  const manager = roles.isSuperAdmin || roles.isEnduranceManager;
  return {
    can_access: staff,
    can_pair_own_device: staff,
    can_ingest_own_device: staff,
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
  const fallback = alphaSafeCapabilities(roles);
  const query = useQuery({
    queryKey: ["endurance", "capabilities", userId],
    queryFn: getEnduranceCapabilities,
    enabled: Boolean(userId),
    staleTime: 60_000,
    retry: 1,
  });
  return { ...query, capabilities: query.data ?? fallback };
};
