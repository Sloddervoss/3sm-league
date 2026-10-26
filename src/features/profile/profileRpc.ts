import { supabase } from "@/integrations/supabase/client";

type RpcFailure = { message?: string | null } | null;

/**
 * PostgREST levert fouten als waarde in `error` in plaats van als exception.
 * Zonder deze controle "slaagt" een geweigerde RPC stil en blijft de UI bij de
 * oude toestand staan; daarom gooien we hier en vangt de mutation het op.
 */
function throwIfRpcFailed(error: RpcFailure, fallback: string): void {
  if (!error) return;
  const message = error.message?.trim();
  throw new Error(message && message.length > 0 ? message : fallback);
}

/** Zichtbare fouttekst voor toast.error in de mutations. */
export function profileWriteErrorMessage(error: unknown, fallback = "Opslaan mislukt"): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return fallback;
}

/** Teamtoewijzing verloopt altijd via deze RPC's; nooit via een losse tabelwrite. */
export async function joinTeamRpc(teamId: string): Promise<void> {
  const { error } = await supabase.rpc("join_team", { p_team_id: teamId });
  throwIfRpcFailed(error, "Team joinen mislukt");
}

export async function leaveTeamRpc(): Promise<void> {
  const { error } = await supabase.rpc("leave_team");
  throwIfRpcFailed(error, "Team verlaten mislukt");
}

export async function adminSetTeamRpc(userId: string, teamId: string | null): Promise<void> {
  const { error } = await supabase.rpc("admin_set_team", { p_user_id: userId, p_team_id: teamId });
  throwIfRpcFailed(error, "Team toewijzen mislukt");
}

/** iRacing-velden staan niet meer in de kolomgrant van profiles. */
export async function updateOwnRacingProfileRpc(values: {
  iracingId: string | null;
  irating: number | null;
  safetyRating: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc("update_own_racing_profile", {
    p_iracing_id: values.iracingId,
    p_irating: values.irating,
    p_safety_rating: values.safetyRating,
  });
  throwIfRpcFailed(error, "iRacing-gegevens opslaan mislukt");
}

/** Ontkoppelen mag alleen leegmaken; discord_id zetten gaat via /koppel. */
export async function unlinkOwnDiscordRpc(): Promise<void> {
  const { error } = await supabase.rpc("unlink_own_discord");
  throwIfRpcFailed(error, "Discord ontkoppelen mislukt");
}

/** Beheerderspad voor iRating-snapshots na de resultatenimport. */
export async function adminUpdateDriverRatingsRpc(
  userId: string,
  values: { irating: number | null; safetyRating: string | null },
): Promise<void> {
  const { error } = await supabase.rpc("admin_update_driver_ratings", {
    p_user_id: userId,
    p_irating: values.irating,
    p_safety_rating: values.safetyRating,
  });
  throwIfRpcFailed(error, "iRating bijwerken mislukt");
}
