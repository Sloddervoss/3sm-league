import { supabase } from "@/integrations/supabase/client";
import { asPersonalPitRpcError, parsePersonalPitVisits, type PersonalPitFeed } from "./pitVisits";

/**
 * Beheerderslezer voor dezelfde gemeten pitbezoeken als Mijn Pitwall.
 *
 * De admin-pitwalltest (alleen super-admin) mag elk gekoppeld device bekijken
 * dat hij via de bestaande beheerpoort al mag beheren. Deze lezer gebruikt
 * daarom bewust niet de owner-transport uit `share.ts`: de ownerroute blijft
 * owner-only. De server-RPC `pitwall_personal_pit_visits_v1` is de bestaande,
 * smalle leespoort met `owner_user_id = auth.uid() OR can_manage_simhub()`;
 * er is geen nieuwe rol, grant of anonieme route nodig. De route zelf is al
 * gegate op super-admin, gelijk aan `can_manage_simhub()`.
 *
 * Formatteren, valideren en tonen blijven in `pitVisits.ts`/`PitDurationPanel`,
 * zodat personal en admin nooit een tweede waarheid krijgen.
 */
type Rpc = (name: string, params?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;

const adminRpc = supabase.rpc.bind(supabase) as unknown as Rpc;

export async function readAdminPitVisits(deviceId: string): Promise<PersonalPitFeed> {
  const { data, error } = await adminRpc("pitwall_personal_pit_visits_v1", {
    p_device_id: deviceId,
    p_limit: 5,
  });
  if (error) throw asPersonalPitRpcError(error);
  return parsePersonalPitVisits(data);
}
