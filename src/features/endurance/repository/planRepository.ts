import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { assertEnduranceTable, enduranceClient } from "./dataAccess";

/**
 * Endurance planning-versions + confirmations repository — Fase 3.
 * Leest/schrijft uitsluitend `endurance_planning_versions` en
 * `endurance_confirmations` (super-admin-only RLS). Geen service key, geen fallback.
 */
const VERSION_TABLE = "endurance_planning_versions" as const;
const CONFIRMATION_TABLE = "endurance_confirmations" as const;

export type EndurancePlanningVersionRow = {
  id: string;
  event_id: string;
  team_id: string;
  label: string;
  created_by: string | null;
  published: boolean;
  created_at: string;
  stints: unknown;
};

export type EnduranceConfirmationRow = {
  id: string;
  event_id: string;
  version_id: string;
  user_id: string;
  status: "unseen" | "viewed" | "accepted" | "change_requested";
  note: string | null;
  updated_at: string;
};

const versionColumns = "id,event_id,team_id,label,created_by,published,created_at,stints";
const confirmationColumns = "id,event_id,version_id,user_id,status,note,updated_at";

/** Plain: alle planning-versions voor een team. */
export async function listEndurancePlanningVersions(eventId: string, teamId: string): Promise<EndurancePlanningVersionRow[]> {
  assertEnduranceTable(VERSION_TABLE);
  const { data, error } = await enduranceClient()
    .from("endurance_planning_versions")
    .select(versionColumns)
    .eq("event_id", eventId)
    .eq("team_id", teamId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Endurance planning-versies laden mislukt: ${error.message}`);
  return (data ?? []) as EndurancePlanningVersionRow[];
}

/** Plain: alle confirmations voor een versie. */
export async function listEnduranceConfirmations(versionId: string): Promise<EnduranceConfirmationRow[]> {
  assertEnduranceTable(CONFIRMATION_TABLE);
  const { data, error } = await enduranceClient()
    .from("endurance_confirmations")
    .select(confirmationColumns)
    .eq("version_id", versionId);
  if (error) throw new Error(`Endurance bevestigingen laden mislukt: ${error.message}`);
  return (data ?? []) as EnduranceConfirmationRow[];
}

export type PublishPlanInput = {
  event_id: string;
  team_id: string;
  label: string;
  created_by: string | null;
  stints: unknown;
  confirmations: Array<{ user_id: string; status: EnduranceConfirmationRow["status"]; note?: string | null }>;
};

/**
 * Publiceren = één versie aanmaken + bevestigingen voor deelnemers.
 * Atomair via de SECURITY DEFINER RPC `endurance_publish_plan`: versie +
 * alle confirmations in één transactie, met server-side manager/event/team
 * autorisatie (super_admin/endurance_manager-sessie).
 */
export async function publishEndurancePlan(input: PublishPlanInput): Promise<EndurancePlanningVersionRow> {
  const { data, error } = await enduranceClient().rpc("endurance_publish_plan", {
    p_event_id: input.event_id,
    p_team_id: input.team_id,
    p_label: input.label,
    p_stints: input.stints as never,
    p_confirmations: input.confirmations.map((c) => ({
      user_id: c.user_id,
      status: c.status,
      note: c.note ?? null,
    })),
  });
  if (error) throw new Error(`Endurance planning publiceren mislukt: ${error.message}`);
  return (data as unknown) as EndurancePlanningVersionRow;
}

/** Plain: werk een confirmatie bij (super-admin-sessie). */
export async function updateEnduranceConfirmation(
  versionId: string,
  userId: string,
  status: EnduranceConfirmationRow["status"],
  note?: string
): Promise<void> {
  assertEnduranceTable(CONFIRMATION_TABLE);
  const { error } = await enduranceClient()
    .from("endurance_confirmations")
    .update({ status, note: note ?? null, updated_at: new Date().toISOString() })
    .eq("version_id", versionId)
    .eq("user_id", userId);
  if (error) throw new Error(`Endurance bevestiging bijwerken mislukt: ${error.message}`);
}

/** TanStack Query: planning-versies + confirmations voor een team. */
export function useEndurancePlanWorkspace(eventId: string, teamId: string) {
  return useQuery({
    queryKey: ["endurance", "plans", eventId, teamId],
    queryFn: async () => {
      const versions = await listEndurancePlanningVersions(eventId, teamId);
      const confirmations = versions.length
        ? await listEnduranceConfirmations(versions[0].id)
        : ([] as EnduranceConfirmationRow[]);
      return { versions: versions.map((v) => ({ ...v, stints: Array.isArray(v.stints) ? v.stints : [] })), latestVersionId: versions[0]?.id ?? null, confirmations };
    },
    enabled: Boolean(eventId && teamId),
  });
}

/** TanStack Query: publiceren + confirmeren. */
export function useEndurancePlanMutations(eventId: string, teamId: string) {
  const queryClient = useQueryClient();
  const onSettled = () => queryClient.invalidateQueries({ queryKey: ["endurance", "plans", eventId, teamId] });
  const publish = useMutation({
    mutationFn: (input: Omit<PublishPlanInput, "event_id" | "team_id">) => publishEndurancePlan({ ...input, event_id: eventId, team_id: teamId }),
    onSettled,
  });
  const confirm = useMutation({
    mutationFn: ({ versionId, userId, status, note }: { versionId: string; userId: string; status: EnduranceConfirmationRow["status"]; note?: string }) => updateEnduranceConfirmation(versionId, userId, status, note),
    onSettled,
  });
  return { publish, confirm };
}
