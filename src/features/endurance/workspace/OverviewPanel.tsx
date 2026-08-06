import { CalendarClock, Car, CheckCircle2, Clock3, ShieldCheck } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useEnduranceActor } from "../core/ActorContext";
import { useEnduranceRegistrations, useUpsertEnduranceRegistration } from "../repository/registrationsRepository";
import { useEnduranceTeamWorkspace } from "../repository/teamsRepository";
import { useEnduranceStints } from "../repository/stintsRepository";
import type { EnduranceEvent, RegistrationStatus } from "../core/types";
import { Panel, SectionHeading, StatusPill } from "../shared/ui";
import { getEnduranceCar } from "../core/carCatalog";
import { RegistrationForm } from "../registration/RegistrationForm";
import { VehicleVotePanel } from "./VehicleVotePanel";

const fieldClass = "min-h-8 w-44 rounded-lg bg-black/35 px-3 py-1 text-sm text-white ring-1 ring-white/10";

function formatAmsterdamTime(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("nl-NL", { timeZone: "Europe/Amsterdam", dateStyle: "medium", timeStyle: "short" }).format(date);
}

/**
 * Overzicht — Fase 3 (test-als).
 * "Jouw status" is de geselecteerde actor. Als die actor nog niet is
 * ingeschreven, toont dit blok het inschrijfformulier. Deelnemersbeheer
 * (status aanpassen) is voor de super-admin-manager.
 */
export const OverviewPanel = ({ event }: { event: EnduranceEvent }) => {
  const { isSuperAdmin } = useAuth();
  const { actorId, displayName } = useEnduranceActor();
  const { data: registrations = [] } = useEnduranceRegistrations(event.id);
  const upsert = useUpsertEnduranceRegistration();
  const { data: teamWorkspace } = useEnduranceTeamWorkspace(event.id);
  const { data: stintRows = [] } = useEnduranceStints(event.id);

  const registration = registrations.find((r) => r.user_id === actorId);
  const team = teamWorkspace?.teams.find((candidate) => candidate.event_id === event.id && teamWorkspace.members.some((m) => m.team_id === candidate.id && m.user_id === actorId));
  const myStints = stintRows
    .filter((s) => s.event_id === event.id && s.driver_id === actorId && s.status !== "completed")
    .sort((a, b) => a.actual_start_at.localeCompare(b.actual_start_at));
  const nextStint = myStints[0];
  const manager = Boolean(isSuperAdmin);
  const participants = registrations.filter((candidate) => candidate.event_id === event.id && candidate.status !== "withdrawn");
  const showForm = manager && !registration;

  return <div className="space-y-5"><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
    <Panel><CalendarClock className="h-5 w-5 text-orange-400" /><span className="mt-3 block text-xs text-gray-500">Race start</span><strong className="mt-1 block text-lg text-white">{formatAmsterdamTime(event.startAt)}</strong></Panel>
    <Panel><Clock3 className="h-5 w-5 text-orange-400" /><span className="mt-3 block text-xs text-gray-500">Briefing</span><strong className="mt-1 block text-lg text-white">{formatAmsterdamTime(event.briefingStartAt)}</strong></Panel>
    <Panel><Car className="h-5 w-5 text-orange-400" /><span className="mt-3 block text-xs text-gray-500">Jouw team</span><strong className="mt-1 block text-lg text-white">{team?.name ?? "Nog niet ingedeeld"}</strong></Panel>
    <Panel><CheckCircle2 className="h-5 w-5 text-orange-400" /><span className="mt-3 block text-xs text-gray-500">Volgende actie</span><strong className="mt-1 block text-lg text-white">{nextStint ? "Stints bevestigen" : registration ? "Beschikbaarheid controleren" : "Aanmelden"}</strong></Panel>
  </div>
  <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]"><Panel><SectionHeading eyebrow="Racebrief" title={event.name} description={`${event.circuit} · ${event.configuration}`} /><div className="grid gap-3 sm:grid-cols-2"><div className="rounded-xl bg-black/20 p-4"><span className="text-xs text-gray-500">Startslots</span><p className="mt-1 font-bold text-gray-200">{event.slots.map((slot) => slot.label).join(", ")}</p></div><div className="rounded-xl bg-black/20 p-4"><span className="text-xs text-gray-500">Klassen waarop gestemd kan worden</span><p className="mt-1 font-bold text-gray-200">{event.classIds.join(" · ")}</p></div><div className="rounded-xl bg-black/20 p-4"><span className="text-xs text-gray-500">Definitieve auto</span><p className="mt-1 font-bold text-gray-200">{event.selectedClassId && getEnduranceCar(event.selectedCarId) ? `${event.selectedClassId} · ${getEnduranceCar(event.selectedCarId)?.name}` : "Nog niet bevestigd"}</p></div></div><div className="mt-4 flex items-center gap-2 rounded-xl bg-emerald-500/[0.06] p-3 text-sm text-emerald-200 ring-1 ring-emerald-500/15"><ShieldCheck className="h-4 w-4" /> Deze raceomgeving is alleen zichtbaar voor deelnemers en aangewezen managers.</div></Panel>
  <Panel><SectionHeading title={`Jouw status · ${displayName(actorId)}`} />{registration ? <div className="space-y-3"><StatusPill tone={registration.status === "confirmed" ? "green" : "orange"}>{registration.status}</StatusPill><div className="text-sm text-gray-400"><p>Klasse: <strong className="text-gray-200">{registration.class_preference}</strong></p><p>Autostem: <strong className="text-gray-200">{getEnduranceCar(registration.preferred_car_id ?? "")?.name ?? "Onbekend"}</strong></p><p>Max. stints: <strong className="text-gray-200">{registration.max_stints}</strong></p></div></div> : <p className="text-sm text-gray-500">Deze coureur is nog niet ingeschreven.</p>}</Panel></div>
  {showForm && <RegistrationForm event={event} />}
  {!showForm && <VehicleVotePanel event={event} />}
  {manager && participants.length > 0 && <Panel><SectionHeading eyebrow="Privé" title="Deelnemersbeheer" description="Status aanpassen geeft/of trekt toegang tot de raceomgeving. Alleen super-admin kan dit." /><div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="text-xs uppercase text-gray-500"><tr><th className="pb-3">Coureur</th><th>Status</th><th>Klasse</th><th>Auto</th><th>Start/finish</th></tr></thead><tbody className="divide-y divide-white/5">{participants.map((participant) => <tr key={participant.id}><td className="py-3 font-bold text-white">{displayName(participant.user_id)}</td><td><select className={fieldClass} value={participant.status} onChange={(e) => void upsert.mutateAsync({ id: participant.id, event_id: event.id, user_id: participant.user_id, status: e.target.value as RegistrationStatus, class_preference: participant.class_preference ?? null, preferred_car_id: participant.preferred_car_id ?? null, slot_id: participant.slot_id ?? null, max_stints: participant.max_stints ?? 1, night_driving: participant.night_driving, willing_to_start: participant.willing_to_start, willing_to_finish: participant.willing_to_finish, notes: participant.notes ?? null })}><option value="interest">Interesse</option><option value="provisional">Voorlopig</option><option value="confirmed">Definitief</option><option value="reserve">Reserve</option><option value="rejected">Afgewezen</option><option value="withdrawn">Teruggetrokken</option></select></td><td className="text-gray-400">{participant.class_preference}</td><td className="text-gray-400">{getEnduranceCar(participant.preferred_car_id ?? "")?.name ?? participant.preferred_car_id}</td><td className="text-gray-500">{participant.willing_to_start ? "Start" : "—"} / {participant.willing_to_finish ? "Finish" : "—"}</td></tr>)}</tbody></table></div></Panel>}
  </div>;
};
