import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { joinTeamRpc, leaveTeamRpc, profileWriteErrorMessage } from "./profileRpc";

/**
 * Teamtoewijzing raakt twee bronnen (profiles.team_id voor de site,
 * team_memberships voor de bot). De RPC schrijft ze samen, dus na succes of
 * fout moet alles wat daarvan afgeleid is opnieuw geladen worden.
 */
const TEAM_ASSIGNMENT_QUERY_KEYS = [
  "profile",
  "teams",
  "teams-list",
  "team-memberships-with-profiles",
  "team-memberships-full",
  "all-profiles",
  "admin-teams",
  "admin-team-count",
  "team-creation-requests",
  "control-room",
] as const;

export function invalidateTeamAssignmentQueries(queryClient: QueryClient): void {
  for (const queryKey of TEAM_ASSIGNMENT_QUERY_KEYS) {
    queryClient.invalidateQueries({ queryKey: [queryKey] });
  }
}

export function useJoinTeam(onJoined?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (teamId: string) => joinTeamRpc(teamId),
    onSuccess: () => {
      toast.success("Team gejoint!");
      invalidateTeamAssignmentQueries(queryClient);
      onJoined?.();
    },
    onError: (error: unknown) => toast.error(profileWriteErrorMessage(error, "Team joinen mislukt")),
  });
}

export function useLeaveTeam() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => leaveTeamRpc(),
    onSuccess: () => {
      toast.success("Team verlaten.");
      invalidateTeamAssignmentQueries(queryClient);
    },
    onError: (error: unknown) => toast.error(profileWriteErrorMessage(error, "Team verlaten mislukt")),
  });
}
