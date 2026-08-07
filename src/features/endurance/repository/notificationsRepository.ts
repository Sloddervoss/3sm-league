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

export type EnduranceNotificationType =
  | "invitation"
  | "deadline"
  | "availability_missing"
  | "team_assigned"
  | "plan_published"
  | "plan_changed"
  | "confirmation_needed"
  | "stint_soon";

export type CreateEnduranceNotificationInput = {
  user_id: string;
  event_id: string;
  type: EnduranceNotificationType;
  title: string;
  message?: string | null;
  private_path?: string | null;
};

/** Plain: maak één of meer endurance-notificaties aan (bijv. uitnodigingen). */
export async function createEnduranceNotifications(rows: CreateEnduranceNotificationInput[]): Promise<void> {
  assertEnduranceTable(TABLE);
  if (!rows.length) return;
  const { error } = await enduranceClient().from("endurance_notifications").insert(
    rows.map((r) => ({
      user_id: r.user_id,
      event_id: r.event_id,
      type: r.type,
      title: r.title,
      message: r.message ?? null,
      private_path: r.private_path ?? null,
      read: false,
      discord_status: "disabled",
    }))
  );
  if (error) throw new Error(`Endurance uitnodigingen versturen mislukt: ${error.message}`);
}

/** TanStack Query: maak uitnodigingen/notificaties aan. */
export function useCreateEnduranceNotifications() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createEnduranceNotifications,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["endurance", "notifications"] }),
  });
}
