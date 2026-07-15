import { useState } from "react";
import { Car, GripVertical, Plus, Shuffle, Users } from "lucide-react";
import { useEnduranceStore } from "../core/EnduranceStore";
import { makeId } from "../core/actions";
import { canManageEvent, canManageTeam, formatLapTime, teamCoveragePercent } from "../core/selectors";
import type { EnduranceEvent } from "../core/types";
import { Field, inputClass, Panel, PrimaryButton, SecondaryButton, SectionHeading, StatusPill } from "../shared/ui";
import { proposeTeams, type ProposalMode } from "./teamProposal";

export const TeamBuilder = ({ event }: { event: EnduranceEvent }) => {
  const { state, activePersona, dispatch } = useEnduranceStore();
  const [name, setName] = useState(""); const [carId, setCarId] = useState(event.cars[0]?.id ?? ""); const [number, setNumber] = useState("");
  const teams = state.teams.filter((team) => team.eventId === event.id);
  const registeredIds = state.registrations.filter((registration) => registration.eventId === event.id && !["withdrawn", "rejected"].includes(registration.status)).map((registration) => registration.userId);
  const assigned = new Set(state.teamMembers.filter((member) => teams.some((team) => team.id === member.teamId)).map((member) => member.userId));
  const unassigned = registeredIds.filter((id) => !assigned.has(id));
  const manager = canManageEvent(event, activePersona);
  const person = (id: string) => state.personas.find((candidate) => candidate.id === id);
  const pace = (id: string) => state.paceEntries.find((entry) => entry.eventId === event.id && entry.userId === id);

  const create = (formEvent: React.FormEvent) => { formEvent.preventDefault(); if (!name || !number) return; dispatch({ type: "create_team", team: { id: makeId("team"), eventId: event.id, name, carId, carNumber: number, managerId: activePersona.id, livery: "" } }); setName(""); setNumber(""); };
  const assign = (teamId: string, userId: string) => { const team = teams.find((candidate) => candidate.id === teamId); if (!team || !canManageTeam(state, team, activePersona)) return; dispatch({ type: "assign_team_member", member: { id: makeId("team-member"), teamId, userId, role: team.managerId === userId ? "manager" : person(userId)?.role === "reserve" ? "reserve" : "driver" } }); };
  const drop = (eventDrop: React.DragEvent, teamId: string) => { eventDrop.preventDefault(); const id = eventDrop.dataTransfer.getData("text/endurance-driver"); if (id) assign(teamId, id); };
  const auto = (mode: ProposalMode) => dispatch({ type: "replace_team_members", eventId: event.id, members: proposeTeams(state, event.id, teams, mode) });

  return <div className="space-y-5"><Panel><SectionHeading eyebrow="Auto’s & coureurs" title="Team Builder" description="Maak pacegroepen of verdeel de beschikbare coureurs zo gelijk mogelijk. Sleep daarna handmatig bij." action={manager && <div className="flex flex-wrap gap-2"><SecondaryButton onClick={() => auto("balanced")} disabled={!teams.length}><Shuffle className="h-4 w-4" /> Gelijke teams</SecondaryButton><PrimaryButton onClick={() => auto("pace_groups")} disabled={!teams.length}><Users className="h-4 w-4" /> Pacegroepen</PrimaryButton></div>} />
    {manager && <form onSubmit={create} className="mb-5 grid gap-3 rounded-xl bg-black/20 p-4 sm:grid-cols-4"><Field label="Teamnaam"><input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} /></Field><Field label="Auto"><select className={inputClass} value={carId} onChange={(e) => setCarId(e.target.value)}>{event.cars.map((car) => <option key={car.id} value={car.id}>{car.className} · {car.carName}</option>)}</select></Field><Field label="Autonummer"><input className={inputClass} value={number} onChange={(e) => setNumber(e.target.value)} /></Field><div className="flex items-end"><PrimaryButton type="submit"><Plus className="h-4 w-4" /> Auto toevoegen</PrimaryButton></div></form>}
    <div className="grid gap-4 xl:grid-cols-[0.8fr_repeat(2,1fr)]">
      <div className="rounded-2xl bg-black/20 p-4 ring-1 ring-white/5"><h3 className="mb-3 font-heading font-black text-white">Nog in te delen</h3><div className="space-y-2">{unassigned.map((id) => <DriverCard key={id} id={id} name={person(id)?.name ?? id} pace={pace(id)?.averageLapSeconds} draggable={manager} />)}{!unassigned.length && <p className="text-xs text-gray-500">Iedereen is ingedeeld.</p>}</div></div>
      {teams.map((team) => { const members = state.teamMembers.filter((member) => member.teamId === team.id); const car = event.cars.find((candidate) => candidate.id === team.carId); const manageable = canManageTeam(state, team, activePersona); const averages = members.map((member) => pace(member.userId)?.averageLapSeconds).filter((value): value is number => Boolean(value)); const average = averages.length ? averages.reduce((sum, value) => sum + value, 0) / averages.length : null; return <div key={team.id} onDragOver={(e) => manageable && e.preventDefault()} onDrop={(e) => drop(e, team.id)} className="rounded-2xl bg-gradient-to-br from-orange-500/[0.08] to-black/20 p-4 ring-1 ring-orange-500/15"><div className="mb-4 flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><Car className="h-4 w-4 text-orange-400" /><h3 className="font-heading text-lg font-black text-white">{team.name} #{team.carNumber}</h3></div><p className="mt-1 text-xs text-gray-500">{car?.className} · {car?.carName}</p></div><StatusPill tone={teamCoveragePercent(state, event, team.id) >= 100 ? "green" : "orange"}>{teamCoveragePercent(state, event, team.id)}% dekking</StatusPill></div><div className="space-y-2">{members.map((member) => <DriverCard key={member.id} id={member.userId} name={person(member.userId)?.name ?? member.userId} pace={pace(member.userId)?.averageLapSeconds} role={member.role} draggable={manageable} />)}</div><div className="mt-4 flex justify-between text-xs text-gray-500"><span>{members.length}/{car?.maxDrivers ?? event.maxDriversPerCar} coureurs</span><span>{average ? `Gem. ${formatLapTime(average)}` : "Geen pace"}</span></div></div>; })}
    </div>
  </Panel></div>;
};

const DriverCard = ({ id, name, pace, role, draggable }: { id: string; name: string; pace?: number; role?: string; draggable: boolean }) => <div draggable={draggable} onDragStart={(event) => event.dataTransfer.setData("text/endurance-driver", id)} className={`flex items-center justify-between gap-2 rounded-xl bg-white/[0.045] p-3 ring-1 ring-white/5 ${draggable ? "cursor-grab active:cursor-grabbing" : ""}`}><div className="flex items-center gap-2"><GripVertical className="h-4 w-4 text-gray-600" /><div><strong className="text-sm text-gray-200">{name}</strong>{role && <p className="text-[10px] uppercase tracking-wide text-orange-400">{role}</p>}</div></div><span className="text-xs text-gray-500">{pace ? formatLapTime(pace) : "Geen data"}</span></div>;
