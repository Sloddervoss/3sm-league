import { useAuth } from "@/contexts/AuthContext";
import { useEnduranceActor } from "../core/ActorContext";
import { useEnduranceTeamWorkspace } from "../repository/teamsRepository";
import { enduranceEventRowToAppModel } from "../repository/mappers";
import { useTeamWorkflow } from "../repository/teamWorkflowRepository";
import type { EnduranceEvent } from "../core/types";
import { Panel, SecondaryButton, SectionHeading, StatusPill } from "../shared/ui";
import { TeamBuilderView } from "./TeamBuilderView";
import { approachLabels } from "./teamProposal";

export const TeamBuilder = ({ event }: { event: EnduranceEvent }) => {
  const { user, isSuperAdmin, isEnduranceManager } = useAuth();
  const { displayName } = useEnduranceActor();
  const manager = Boolean(user && (isSuperAdmin || isEnduranceManager || event.managerIds.includes(user.id)));
  const workflow = useTeamWorkflow(event.id, manager);
  const basic = useEnduranceTeamWorkspace(event.id);
  if (!manager) return <Panel><SectionHeading eyebrow="Jouw race" title="Teams" description="De racemanager deelt teams in op basis van practice en beschikbaarheid." />
    {basic.error && <p role="alert">Teams konden niet worden geladen.</p>}
    <div className="grid gap-4 md:grid-cols-2">{basic.data?.teams.map(t => <article key={t.id} className="rounded-2xl bg-black/20 p-5 ring-1 ring-white/10"><StatusPill tone="orange">{t.team_approach === "either" ? "Gemengd" : approachLabels[t.team_approach ?? "either"]}</StatusPill><h3 className="mt-3 text-lg font-bold">{t.name}</h3><p className="mt-1 text-sm text-gray-400">Manager: {t.manager_id ? displayName(t.manager_id) : "Nog niet gekozen"}</p><ul className="mt-4 space-y-2">{basic.data.members.filter(m => m.team_id === t.id).map(m => <li key={m.id} className="text-sm text-gray-200">{displayName(m.user_id)}{m.role === "reserve" ? " · Reserve" : ""}</li>)}</ul></article>)}</div>
    {!basic.isLoading && !basic.data?.teams.length && <p className="text-sm text-gray-400">Je team verschijnt hier zodra de manager de indeling heeft opgeslagen.</p>}
  </Panel>;
  if (workflow.isLoading) return <Panel><p role="status" className="text-gray-400">Inschrijvingen, practice en teams laden…</p></Panel>;
  if (workflow.error || !workflow.data) return <Panel><p role="alert" className="text-red-200">{workflow.error?.message ?? "Teamgegevens zijn nog niet beschikbaar."}</p><SecondaryButton onClick={() => void workflow.refetch()}>Opnieuw laden</SecondaryButton></Panel>;
  return <TeamBuilderView event={workflow.data.data.event ? enduranceEventRowToAppModel(workflow.data.data.event) : event} snapshot={workflow.data} displayName={displayName} managerId={user!.id}
    onApply={(teams, revision) => workflow.apply.mutateAsync({ teams, revision })}
    onManage={(action, revision) => workflow.manage.mutateAsync({ action, revision })} />;
};
