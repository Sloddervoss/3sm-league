import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { assertEnduranceTable, enduranceClient } from "./dataAccess";

/**
 * Endurance teams + team_members repository — Fase 3.
 * Leest/schrijft uitsluitend `endurance_teams` en `endurance_team_members`
 * (super-admin-only RLS). Geen service-role key, geen fallback.
 */
const TEAM_TABLE = "endurance_teams" as const;
const MEMBER_TABLE = "endurance_team_members" as const;

export type EnduranceTeamRow = {
  id: string;
  event_id: string;
  name: string;
  car_id: string | null;
  car_number: string | null;
  manager_id: string | null;
  livery: string | null;
  created_at: string;
  updated_at: string;
};

export type EnduranceTeamMemberRow = {
  id: string;
  team_id: string;
  user_id: string;
  role: "manager" | "driver" | "reserve";
};

const teamColumns = "id,event_id,name,car_id,car_number,manager_id,livery,created_at,updated_at";
const memberColumns = "id,team_id,user_id,role";

/** Plain: alle teams voor een event. */
export async function listEnduranceTeams(eventId: string): Promise<EnduranceTeamRow[]> {
  assertEnduranceTable(TEAM_TABLE);
  const { data, error } = await enduranceClient()
    .from("endurance_teams")
    .select(teamColumns)
    .eq("event_id", eventId);
  if (error) throw new Error(`Endurance teams laden mislukt: ${error.message}`);
  return (data ?? []) as EnduranceTeamRow[];
}

/** Plain: alle endurance-teams (overzichts-tabs). */
export async function listAllEnduranceTeams(): Promise<EnduranceTeamRow[]> {
  assertEnduranceTable(TEAM_TABLE);
  const { data, error } = await enduranceClient().from("endurance_teams").select(teamColumns);
  if (error) throw new Error(`Endurance teams laden mislukt: ${error.message}`);
  return (data ?? []) as EnduranceTeamRow[];
}

/** Plain: alle team-leden. */
export async function listEnduranceTeamMembers(): Promise<EnduranceTeamMemberRow[]> {
  assertEnduranceTable(MEMBER_TABLE);
  const { data, error } = await enduranceClient()
    .from("endurance_team_members")
    .select(memberColumns);
  if (error) throw new Error(`Endurance team-leden laden mislukt: ${error.message}`);
  return (data ?? []) as EnduranceTeamMemberRow[];
}

export type CreateEnduranceTeamInput = {
  event_id: string;
  name: string;
  car_id?: string | null;
  car_number?: string | null;
  manager_id?: string | null;
  livery?: string | null;
};

/** Plain: maak een endurance team aan (super-admin-sessie). */
export async function createEnduranceTeam(input: CreateEnduranceTeamInput): Promise<EnduranceTeamRow> {
  assertEnduranceTable(TEAM_TABLE);
  const { data, error } = await enduranceClient()
    .from("endurance_teams")
    .insert({
      event_id: input.event_id,
      name: input.name,
      car_id: input.car_id ?? null,
      car_number: input.car_number ?? null,
      manager_id: input.manager_id ?? null,
      livery: input.livery ?? null,
    })
    .select(teamColumns)
    .single();
  if (error) throw new Error(`Endurance team aanmaken mislukt: ${error.message}`);
  return data as EnduranceTeamRow;
}

export type AssignEnduranceMemberInput = {
  team_id: string;
  user_id: string;
  role: "manager" | "driver" | "reserve";
};

/** Plain: koppel een lid aan een endurance team (super-admin-sessie). */
export async function assignEnduranceMember(input: AssignEnduranceMemberInput): Promise<EnduranceTeamMemberRow> {
  assertEnduranceTable(MEMBER_TABLE);
  const { data, error } = await enduranceClient()
    .from("endurance_team_members")
    .upsert({
      team_id: input.team_id,
      user_id: input.user_id,
      role: input.role,
    }, { onConflict: "team_id,user_id" })
    .select(memberColumns)
    .single();
  if (error) throw new Error(`Endurance lid koppelen mislukt: ${error.message}`);
  return data as EnduranceTeamMemberRow;
}

/** Plain: verwijder een lid uit een endurance team (super-admin-sessie). */
export async function removeEnduranceMember(teamId: string, userId: string): Promise<void> {
  assertEnduranceTable(MEMBER_TABLE);
  const { error } = await enduranceClient()
    .from("endurance_team_members")
    .delete()
    .eq("team_id", teamId)
    .eq("user_id", userId);
  if (error) throw new Error(`Endurance lid verwijderen mislukt: ${error.message}`);
}

/** TanStack Query: teams + leden voor een event (query-fn compositie). */
export async function loadEnduranceTeamWorkspace(eventId: string) {
  const [teams, members] = await Promise.all([
    listEnduranceTeams(eventId),
    listEnduranceTeamMembers(),
  ]);
  return { teams, members };
}

export function useEnduranceTeamWorkspace(eventId: string) {
  return useQuery({
    queryKey: ["endurance", "teams", eventId],
    queryFn: () => loadEnduranceTeamWorkspace(eventId),
    enabled: Boolean(eventId),
  });
}

/** Plain: alle endurance-teams + leden (overzichts-tabs). */
export async function loadAllEnduranceTeamWorkspace() {
  const [teams, members] = await Promise.all([
    listAllEnduranceTeams(),
    listEnduranceTeamMembers(),
  ]);
  return { teams, members };
}

/** TanStack Query: alle teams + leden. */
export function useAllEnduranceTeamWorkspace() {
  return useQuery({
    queryKey: ["endurance", "teams", "all"],
    queryFn: loadAllEnduranceTeamWorkspace,
  });
}

/** TanStack Query: alle write-hooks voor teams. */
export function useEnduranceTeamMutations(eventId: string) {
  const queryClient = useQueryClient();
  const onSettled = () => queryClient.invalidateQueries({ queryKey: ["endurance", "teams", eventId] });
  const createTeam = useMutation({ mutationFn: createEnduranceTeam, onSettled });
  const assignMember = useMutation({ mutationFn: assignEnduranceMember, onSettled });
  const removeMember = useMutation({
    mutationFn: ({ teamId, userId }: { teamId: string; userId: string }) => removeEnduranceMember(teamId, userId),
    onSettled,
  });
  return { createTeam, assignMember, removeMember };
}
