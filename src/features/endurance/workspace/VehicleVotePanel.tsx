import { useEffect, useMemo, useState } from "react";
import { BarChart3, CheckCircle2, Vote } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useEnduranceRegistrations } from "../repository/registrationsRepository";
import { useUpdateEnduranceEventFields } from "../repository/eventsRepository";
import type { EnduranceEvent } from "../core/types";
import { allowedEnduranceCarsForClass, getEnduranceCar, type EnduranceClassId } from "../core/carCatalog";
import { getEventVehicleVotes, recommendedVehicle, winningCarIdsForClass, winningClassIds } from "../core/vehicleVoting";
import { Field, inputClass, Panel, PrimaryButton, SectionHeading, StatusPill } from "../shared/ui";

/**
 * Stemuitslag & definitieve auto — Fase 3.
 * Stemmen komen nu uit de ECHTE DB-registraties (preferred_car_id /
 * class_preference). De bevestiging van de definitieve auto is voor de
 * super-admin en endurance-managers (beide met RLS-toegang in de canary).
 */
export const VehicleVotePanel = ({ event }: { event: EnduranceEvent }) => {
  const { isSuperAdmin, isEnduranceManager } = useAuth();
  const { data: registrations = [] } = useEnduranceRegistrations(event.id);
  const upsert = useUpdateEnduranceEventFields();

  // Map DB-rows → het stemming-model (cpu-mock-type shape).
  const voteRegistrations = useMemo(() => registrations.map((r) => ({
    id: r.id,
    eventId: r.event_id,
    userId: r.user_id,
    status: r.status,
    classPreference: (r.class_preference ?? "GT3") as EnduranceClassId,
    preferredCarId: r.preferred_car_id ?? "",
    slotId: r.slot_id ?? "",
    maxStints: r.max_stints ?? 1,
    maxStintMinutes: r.max_stint_minutes,
    maxTotalMinutes: r.max_total_minutes,
    nightDriving: r.night_driving,
    willingToStart: r.willing_to_start,
    willingToFinish: r.willing_to_finish,
    notes: r.notes ?? "",
    registeredAt: r.registered_at,
  })), [registrations]);

  const votes = useMemo(() => getEventVehicleVotes(voteRegistrations, event.id), [voteRegistrations, event.id]);
  const recommendation = useMemo(() => recommendedVehicle(voteRegistrations, event.id), [voteRegistrations, event.id]);
  // Bevestiging van de definitieve auto is voor super-admin én endurance-managers.
  const manager = Boolean(isSuperAdmin || isEnduranceManager);
  const classWinners = useMemo(() => winningClassIds(voteRegistrations, event.id), [voteRegistrations, event.id]);
  const selectableClasses = classWinners.length ? event.classIds.filter((classId) => classWinners.includes(classId)) : event.classIds;
  const initialClass = recommendation.classId ?? selectableClasses[0] ?? event.selectedClassId ?? "GT3";
  const [classId, setClassId] = useState<EnduranceClassId>(initialClass);
  const carWinnerIds = useMemo(() => winningCarIdsForClass(voteRegistrations, event.id, classId), [voteRegistrations, event.id, classId]);
  const cars = useMemo(() => {
    const classCars = allowedEnduranceCarsForClass(classId, event.allowedCarIds);
    return carWinnerIds.length ? classCars.filter((car) => carWinnerIds.includes(car.id)) : classCars;
  }, [classId, carWinnerIds, event.allowedCarIds]);
  const [carId, setCarId] = useState(event.selectedCarId ?? (recommendation.classId === classId ? recommendation.carId : null) ?? cars[0]?.id ?? "");
  const finalCar = getEnduranceCar(event.selectedCarId);
  const recommendedCar = getEnduranceCar(recommendation.carId);

  useEffect(() => {
    const valid = cars.some((car) => car.id === carId);
    if (!valid) setCarId(recommendation.classId === classId && recommendation.carId ? recommendation.carId : cars[0]?.id ?? "");
  }, [carId, cars, classId, recommendation]);

  const changeClass = (next: EnduranceClassId) => {
    setClassId(next);
    const winners = winningCarIdsForClass(voteRegistrations, event.id, next);
    const options = allowedEnduranceCarsForClass(next, event.allowedCarIds).filter((car) => !winners.length || winners.includes(car.id));
    setCarId(recommendation.classId === next && recommendation.carId ? recommendation.carId : options[0]?.id ?? "");
  };
  const confirm = () => {
    if (!carId || upsert.isPending) return;
    void upsert.mutateAsync({ id: event.id, selected_class_id: classId, selected_car_id: carId });
  };
  const carVotes = votes.carVotes.filter((vote) => getEnduranceCar(vote.id)?.classId === classId);

  return <Panel>
    <SectionHeading eyebrow="Autokeuze" title="Stemuitslag & definitieve auto" description="Voorkeuren geven het advies. De racemanager bevestigt één auto vóór de teamindeling; bij een gelijke stand is altijd een managerbesluit nodig." action={<div className="flex items-center gap-2"><Vote className="h-4 w-4 text-orange-400" /><span className="text-sm font-bold text-gray-300">{votes.totalVoters} stemmen</span></div>} />
    <div className="grid gap-5 lg:grid-cols-[1fr_1fr_0.9fr]">
      <VoteList title="Klasse" votes={votes.classVotes.map((vote) => ({ ...vote, label: vote.id }))} />
      <VoteList title={`Auto · ${classId}`} votes={carVotes.map((vote) => ({ ...vote, label: getEnduranceCar(vote.id)?.name ?? vote.id }))} />
      <div className="space-y-4 rounded-2xl bg-black/20 p-4 ring-1 ring-white/5">
        <div><span className="text-xs font-bold uppercase tracking-wide text-gray-500">Stemadvies</span><p className="mt-1 font-bold text-white">{recommendation.classId && recommendedCar ? `${recommendation.classId} · ${recommendedCar.name}` : recommendation.tied ? "Gelijke stand — manager beslist" : "Nog onvoldoende stemmen"}</p></div>
        <div><span className="text-xs font-bold uppercase tracking-wide text-gray-500">Definitief bevestigd</span><div className="mt-2">{event.selectedClassId && finalCar ? <StatusPill tone="green">{event.selectedClassId} · {finalCar.name}</StatusPill> : <StatusPill tone="orange">Nog niet gekozen</StatusPill>}</div></div>
        {manager && <div className="space-y-3 border-t border-white/5 pt-4">
          <Field label="Definitieve klasse"><select className={inputClass} value={classId} onChange={(e) => changeClass(e.target.value as EnduranceClassId)}>{selectableClasses.map((value) => <option key={value}>{value}</option>)}</select></Field>
          <Field label="Definitieve auto"><select className={inputClass} value={carId} onChange={(e) => setCarId(e.target.value)}>{cars.map((car) => <option key={car.id} value={car.id}>{car.name}</option>)}</select></Field>
          <PrimaryButton onClick={confirm} disabled={!carId || upsert.isPending}>{upsert.isPending ? "Opslaan…" : "Meerderheidskeuze bevestigen"}</PrimaryButton>
        </div>}
      </div>
    </div>
  </Panel>;
};

const VoteList = ({ title, votes }: { title: string; votes: Array<{ id: string; label: string; votes: number; percentage: number }> }) => <div className="rounded-2xl bg-black/20 p-4 ring-1 ring-white/5"><div className="mb-3 flex items-center gap-2"><BarChart3 className="h-4 w-4 text-orange-400" /><h3 className="font-heading font-black text-white">{title}</h3></div><div className="space-y-3">{votes.map((vote) => <div key={vote.id}><div className="mb-1 flex justify-between gap-3 text-xs"><span className="truncate text-gray-300">{vote.label}</span><strong className="shrink-0 text-white">{vote.votes} · {vote.percentage}%</strong></div><div className="h-1.5 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-orange-500" style={{ width: `${vote.percentage}%` }} /></div></div>)}{!votes.length && <p className="text-xs text-gray-500">Nog geen stemmen.</p>}</div></div>;
