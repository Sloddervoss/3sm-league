import { ChevronRight } from "lucide-react";
import { useEnduranceStore } from "../core/EnduranceStore";
import { canAccessWorkspace, canManageEvent, formatAmsterdam } from "../core/selectors";
import type { EnduranceEvent } from "../core/types";
import { Panel, PrimaryButton, SectionHeading, StatusPill } from "../shared/ui";

export const MyRaces = ({ onSelect }: { onSelect: (event: EnduranceEvent) => void }) => {
  const { state, activePersona } = useEnduranceStore();
  const events = state.events.filter((event) => canAccessWorkspace(state, event, activePersona));
  return <div><SectionHeading eyebrow="Persoonlijk" title="Mijn races" description="Alle races waarvoor je bent aangemeld of waarvoor je manager bent." />
    <div className="grid gap-4 lg:grid-cols-2">{events.map((event) => {
      const team = state.teams.find((candidate) => candidate.eventId === event.id && state.teamMembers.some((member) => member.teamId === candidate.id && member.userId === activePersona.id));
      const stints = state.stints.filter((stint) => stint.eventId === event.id && stint.driverId === activePersona.id);
      return <Panel key={event.id}><div className="flex items-start justify-between gap-3"><div><StatusPill tone={event.status === "live" ? "red" : "orange"}>{event.status}</StatusPill><h3 className="mt-3 font-heading text-xl font-black text-white">{event.name}</h3><p className="mt-1 text-sm text-gray-400">{formatAmsterdam(event.startAt)} · {team?.name ?? (canManageEvent(event, activePersona) ? "Racebeheer" : "Nog niet ingedeeld")}</p><p className="mt-3 text-xs text-gray-500">{stints.length} toegewezen stint{stints.length === 1 ? "" : "s"}</p></div><PrimaryButton onClick={() => onSelect(event)} className="shrink-0 px-3">Open <ChevronRight className="h-4 w-4" /></PrimaryButton></div></Panel>;
    })}</div>
    {events.length === 0 && <Panel><p className="text-sm text-gray-400">Je bent nog niet aan een endurance-race gekoppeld.</p></Panel>}
  </div>;
};
