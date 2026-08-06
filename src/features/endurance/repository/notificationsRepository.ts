import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { assertEnduranceTable, enduranceClient } from "./dataAccess";

/**
 * Endurance notifications repository — Fase 3.
 * Leest/schrijft uitsluitend `endurance_notifications` (super-admin-only RLS).
 * Geen service-role key, geen fallback.
 */
const TABLE = "endurance_notifications" as const;

export type EnduranceNotificationRow = {
  id: string;
  user_id: string;
  event_id: string | null;
  type: string;
  title: string;
  message: string | null;
  private_path: string | null;
  read: boolean;
  discord_status: string;
  created_at: string;
};

const selectColumns = "id,user_id,event_id,type,title,message,private_path,read,discord_status,created_at";

/** Plain: alle endurance-notificaties (voor de gekozen actor-zicht). */
export async function listEnduranceNotifications(): Promise<EnduranceNotificationRow[]> {
  assertEnduranceTable(TABLE);
  const { data, error } = await enduranceClient()
    .from("endurance_notifications")
    .select(selectColumns)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Endurance meldingen laden mislukt: ${error.message}`);
  return (data ?? []) as EnduranceNotificationRow[];
}

/** Plain: markeer een notificatie als gelezen (super-admin-sessie). */
export async function markEnduranceNotificationRead(id: string): Promise<void> {
  assertEnduranceTable(TABLE);
  const { error } = await enduranceClient().from("endurance_notifications").update({ read: true }).eq("id", id);
  if (error) throw new Error(`Endurance melding bijwerken mislukt: ${error.message}`);
}

/** TanStack Query: alle notificaties. */
export function useEnduranceNotifications() {
  return useQuery({
    queryKey: ["endurance", "notifications"],
    queryFn: listEnduranceNotifications,
  });
}

/** TanStack Query: markeer-gelezen mutation. */
export function useMarkEnduranceNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: markEnduranceNotificationRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["endurance", "notifications"] }),
  });
}
