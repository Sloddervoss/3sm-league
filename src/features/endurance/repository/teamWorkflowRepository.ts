import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { enduranceClient } from "./dataAccess";
import type { EnduranceTeamRow, EnduranceTeamMemberRow } from "./teamsRepository";
import type { EnduranceRegistrationRow } from "./registrationsRepository";
import type { EndurancePaceRow } from "./paceRepository";
import type { EnduranceAvailabilityRow } from "./availabilityRepository";
import type { TeamDraft, TeamApproach } from "../teams/teamProposal";
import type { EnduranceEventRow } from "./eventsRepository";
import type { Json } from "@/integrations/supabase/types";

export type TeamWorkflowSnapshot = { revision: string; data: {
  event?: EnduranceEventRow;
  teams: EnduranceTeamRow[]; members: EnduranceTeamMemberRow[]; registrations: EnduranceRegistrationRow[];
  pace: EndurancePaceRow[]; availability: EnduranceAvailabilityRow[];
} };
export type TeamAction = { kind: "move"; user_id: string; team_id: string | null; role?: "driver" | "reserve" } |
  { kind: "settings"; team_id: string; name: string; capacity: number; approach: TeamApproach; car_number: string; manager_id: string | null };

export function useTeamWorkflow(eventId: string, enabled: boolean) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["endurance", "team-workflow", eventId], enabled,
    queryFn: async () => {
      const { data, error } = await enduranceClient().rpc("endurance_team_workspace", { p_event_id: eventId });
      if (error) throw new Error(error.message);
      return data as unknown as TeamWorkflowSnapshot;
    }, refetchInterval: 30_000,
  });
  const refresh = () => client.invalidateQueries({ queryKey: ["endurance"] });
  const apply = useMutation({
    mutationFn: async ({ teams, revision }: { teams: TeamDraft[]; revision: string }) => {
      const { error } = await enduranceClient().rpc("endurance_apply_team_proposal", { p_event_id: eventId, p_revision: revision, p_teams: teams as unknown as Json });
      if (error) throw new Error(error.message);
    }, onSettled: refresh,
  });
  const manage = useMutation({
    mutationFn: async ({ action, revision }: { action: TeamAction; revision: string }) => {
      const { error } = await enduranceClient().rpc("endurance_manage_team", { p_event_id: eventId, p_revision: revision, p_action: action as unknown as Json });
      if (error) throw new Error(error.message);
    }, onSettled: refresh,
  });
  return { ...query, apply, manage };
}
