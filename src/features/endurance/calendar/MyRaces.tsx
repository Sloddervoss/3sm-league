import { ChevronRight } from "lucide-react";
import { useEnduranceActor } from "../core/ActorContext";
import { useEnduranceEvents } from "../repository/eventsRepository";
import { useAllEnduranceRegistrations } from "../repository/registrationsRepository";
import { useAllEnduranceTeamWorkspace } from "../repository/teamsRepository";
import { useAllEnduranceStints } from "../repository/stintsRepository";
import { enduranceEventRowToAppModel } from "../repository/mappers";
import type { EnduranceEvent } from "../core/types";
import { Panel, PrimaryButton, SectionHeading, StatusPill } from "../shared/ui";
import { formatAmsterdam } from "../core/selectors";

/**
 * Mijn races — Fase 3 (test-als).
 * Toont de DB-events waar de geselecteerde actor een actieve registratie heeft,
 * inclusief team en toegewezen stints uit de databank.
 */
export const MyRaces = ({ onSelect }: { onSelect: (event: EnduranceEvent) => void }) => {
  const { actorId } = useEnduranceActor();
  const { data: dbEvents = [] } = useEnduranceEvents();
  const { data: registrations = [] } = useAllEnduranceRegistrations();
  const { data: teamWorkspace } = useAllEnduranceTeamWorkspace();
  const { data: stintRows = [] } = useAllEnduranceStints();

  const myRegistrations = registrations.filter((r) => r.user_id === actorId && !["rejected", "withdrawn"].includes(r.status));
  const events = dbEvents
    .filter((event) => myRegistrations.some((r) => r.event_id === event.id))
    .map(enduranceEventRowToAppModel);

  return <div><SectionHeading eyebrow="Persoonlijk" title="Mijn races" description="Alle races waarvoor je bent aangemeld." />
    <div className="grid gap-4 lg:grid-cols-2">{events.map((event) => {
      const team = teamWorkspace?.teams.find((candidate) => candidate.event_id === event.id && teamWorkspace.members.some((member) => member.team_id === candidate.id && member.user_id === actorId));
      const stints = stintRows.filter((stint) => stint.event_id === event.id && stint.driver_id === actorId);
      return <Panel key={event.id}><div className="flex items-start justify-between gap-3"><div><StatusPill tone={event.status === "live" ? "red" : "orange"}>{event.status}</StatusPill><h3 className="mt-3 font-heading text-xl font-black text-white">{event.name}</h3><p className="mt-1 text-sm text-gray-400">{formatAmsterdam(event.startAt)} · {team?.name ?? "Nog niet ingedeeld"}</p><p className="mt-3 text-xs text-gray-500">{stints.length} toegewezen stint{stints.length === 1 ? "" : "s"}</p></div><PrimaryButton onClick={() => onSelect(event)} className="shrink-0 px-3">Open <ChevronRight className="h-4 w-4" /></PrimaryButton></div></Panel>;
    })}</div>
    {events.length === 0 && <Panel><p className="text-sm text-gray-400">Deze coureur is nog niet aan een endurance-race gekoppeld.</p></Panel>}
  </div>;
};
