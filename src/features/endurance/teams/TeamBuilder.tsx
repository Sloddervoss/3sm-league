import { useState } from "react";
import { Car, GripVertical, Plus, Users } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useEnduranceActor } from "../core/ActorContext";
import { useEnduranceTeamWorkspace, useEnduranceTeamMutations } from "../repository/teamsRepository";
import { useEnduranceRegistrations } from "../repository/registrationsRepository";
import { formatLapTime } from "../core/selectors";
import type { EnduranceEvent } from "../core/types";
import { Field, inputClass, Panel, PrimaryButton, SecondaryButton, SectionHeading, StatusPill } from "../shared/ui";
import { getEnduranceCar } from "../core/carCatalog";

/**
 * Team Builder — Fase 3 (test-als).
 * Teams/leden via de DB-repository. Beheer (aanmaken/indelen) is voor de
 * super-admin-manager; de geregistreerde acteurs worden getoond met hun label.
 */
export const TeamBuilder = ({ event }: { event: EnduranceEvent }) => {
  const { user } = useAuth();
  const { actorId, displayName } = useEnduranceActor();
  const { data, isLoading } = useEnduranceTeamWorkspace(event.id);
  const { createTeam, assignMember, removeMember } = useEnduranceTeamMutations(event.id);
  const { data: registrations = [] } = useEnduranceRegistrations(event.id);
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [unassignedDragOver, setUnassignedDragOver] = useState(false);

  const teams = data?.teams ?? [];
  const members = data?.members ?? [];
  const registeredIds = registrations
    .filter((r) => !["withdrawn", "rejected"].includes(r.status))
    .map((r) => r.user_id);
  const assigned = new Set(members.filter((m) => teams.some((t) => t.id === m.team_id)).map((m) => m.user_id));
  const unassigned = registeredIds.filter((id) => !assigned.has(id));

  const manager = Boolean(user?.id);
  const selectedCar = getEnduranceCar(event.selectedCarId);

  const create = (formEvent: React.FormEvent) => {
    formEvent.preventDefault();
    if (!name || !number || !event.selectedCarId || !user?.id) return;
    void createTeam.mutateAsync({
      event_id: event.id,
      name,
      car_id: event.selectedCarId,
      car_number: number,
      manager_id: user.id,
      livery: "",
    });
    setName(""); setNumber("");
  };
  const assign = (teamId: string, userId: string) => {
    const role = members.find((m) => m.team_id === teamId && m.user_id === userId)?.role
      ?? (teamId && userId ? "driver" : "driver");
    void assignMember.mutateAsync({ team_id: teamId, user_id: userId, role });
  };
  const drop = (eventDrop: React.DragEvent, teamId: string) => {
    eventDrop.preventDefault();
    const id = eventDrop.dataTransfer.getData("text/endurance-driver");
    if (id) assign(teamId, id);
  };
  const unassign = (userId: string) => {
    const membership = members.find((m) => m.user_id === userId && teams.some((t) => t.id === m.team_id));
    if (!membership) return;
    void removeMember.mutateAsync({ teamId: membership.team_id, userId });
  };
  const dropUnassigned = (eventDrop: React.DragEvent) => {
    eventDrop.preventDefault();
    setUnassignedDragOver(false);
    const id = eventDrop.dataTransfer.getData("text/endurance-driver");
    if (id) unassign(id);
  };

  const personName = (id: string) => displayName(id);

  return <div className="space-y-5"><Panel><SectionHeading eyebrow="Auto’s & coureurs" title="Team Builder" description="Maak teams en verdeel de beschikbare coureurs. Sleep daarna handmatig bij." />
    {isLoading && <p className="text-sm text-gray-400">Laden…</p>}
    {manager && !selectedCar && <div className="mb-5 rounded-xl bg-amber-500/[0.08] p-4 text-sm text-amber-100 ring-1 ring-amber-500/20">Bevestig eerst de definitieve auto in het overzicht. Daarna kunnen teams worden aangemaakt.</div>}
    {manager && selectedCar && <form onSubmit={create} className="mb-5 grid gap-3 rounded-xl bg-black/20 p-4 sm:grid-cols-3"><Field label="Teamnaam"><input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} /></Field><Field label="Vaste auto"><div className={`${inputClass} flex items-center text-gray-300`}>{event.selectedClassId} · {selectedCar.name}</div></Field><Field label="Autonummer"><input className={inputClass} value={number} onChange={(e) => setNumber(e.target.value)} /></Field><div className="sm:col-span-3"><PrimaryButton type="submit"><Plus className="h-4 w-4" /> Team toevoegen</PrimaryButton></div></form>}
    <div className="grid gap-4 xl:grid-cols-[0.8fr_repeat(2,1fr)]">
      <div onDragOver={(dragEvent) => { if (manager) { dragEvent.preventDefault(); setUnassignedDragOver(true); } }} onDragLeave={() => setUnassignedDragOver(false)} onDrop={dropUnassigned} className={`rounded-2xl p-4 ring-1 transition ${unassignedDragOver ? "bg-orange-500/[0.12] ring-orange-400/40" : "bg-black/20 ring-white/5"}`}>
        <h3 className="font-heading font-black text-white">Nog in te delen</h3>
        {manager && <p className="mb-3 mt-1 text-xs text-gray-500">Sleep een coureur hierheen om die uit een team te halen.</p>}
        <div className="space-y-2">{unassigned.map((id) => <DriverCard key={id} id={id} name={personName(id)} draggable={manager} />)}{!unassigned.length && <p className="rounded-xl border border-dashed border-white/10 p-4 text-center text-xs text-gray-500">Iedereen is ingedeeld. Sleep een coureur hierheen om de indeling ongedaan te maken.</p>}</div>
      </div>
      {teams.map((team) => {
        const teamMembers = members.filter((m) => m.team_id === team.id);
        const car = getEnduranceCar(team.car_id);
        return <div key={team.id} onDragOver={(e) => manager && e.preventDefault()} onDrop={(e) => drop(e, team.id)} className="rounded-2xl bg-gradient-to-br from-orange-500/[0.08] to-black/20 p-4 ring-1 ring-orange-500/15"><div className="mb-4 flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><Car className="h-4 w-4 text-orange-400" /><h3 className="font-heading text-lg font-black text-white">{team.name} #{team.car_number}</h3></div><p className="mt-1 text-xs text-gray-500">{car?.classId} · {car?.name}</p></div><StatusPill tone="orange">{teamMembers.length}/{event.maxDriversPerCar ?? car?.maxDrivers} coureurs</StatusPill></div><div className="space-y-2">{teamMembers.map((m) => <DriverCard key={m.id} id={m.user_id} name={personName(m.user_id)} role={m.role} draggable={manager} />)}</div></div>;
      })}
    </div>
  </Panel></div>;
};

const DriverCard = ({ id, name, role, draggable }: { id: string; name: string; role?: string; draggable: boolean }) => <div draggable={draggable} onDragStart={(event) => event.dataTransfer.setData("text/endurance-driver", id)} className={`flex items-center justify-between gap-2 rounded-xl bg-white/[0.045] p-3 ring-1 ring-white/5 ${draggable ? "cursor-grab active:cursor-grabbing" : ""}`}><div className="flex items-center gap-2"><GripVertical className="h-4 w-4 text-gray-600" /><div><strong className="text-sm text-gray-200">{name}</strong>{role && <p className="text-[10px] uppercase tracking-wide text-orange-400">{role}</p>}</div></div></div>;
