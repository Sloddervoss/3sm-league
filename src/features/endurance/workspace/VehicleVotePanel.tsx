import { useEffect, useMemo, useState } from "react";
import { BarChart3, CheckCircle2, Vote } from "lucide-react";
import { useEnduranceStore } from "../core/EnduranceStore";
import type { EnduranceEvent } from "../core/types";
import { enduranceCarsForClass, getEnduranceCar, type EnduranceClassId } from "../core/carCatalog";
import { getEventVehicleVotes, recommendedVehicle, winningCarIdsForClass, winningClassIds } from "../core/vehicleVoting";
import { canManageEvent } from "../core/selectors";
import { Field, inputClass, Panel, PrimaryButton, SectionHeading, StatusPill } from "../shared/ui";

export const VehicleVotePanel = ({ event }: { event: EnduranceEvent }) => {
  const { state, activePersona, dispatch } = useEnduranceStore();
  const votes = useMemo(() => getEventVehicleVotes(state.registrations, event.id), [state.registrations, event.id]);
  const recommendation = useMemo(() => recommendedVehicle(state.registrations, event.id), [state.registrations, event.id]);
  const manager = canManageEvent(event, activePersona);
  const classWinners = useMemo(() => winningClassIds(state.registrations, event.id), [state.registrations, event.id]);
  const selectableClasses = classWinners.length ? event.classIds.filter((classId) => classWinners.includes(classId)) : event.classIds;
  const initialClass = recommendation.classId ?? selectableClasses[0] ?? event.selectedClassId ?? "GT3";
  const [classId, setClassId] = useState<EnduranceClassId>(initialClass);
  const carWinnerIds = useMemo(() => winningCarIdsForClass(state.registrations, event.id, classId), [state.registrations, event.id, classId]);
  const cars = useMemo(() => {
    const classCars = enduranceCarsForClass(classId);
    return carWinnerIds.length ? classCars.filter((car) => carWinnerIds.includes(car.id)) : classCars;
  }, [classId, carWinnerIds]);
  const [carId, setCarId] = useState(event.selectedCarId ?? (recommendation.classId === classId ? recommendation.carId : null) ?? cars[0]?.id ?? "");
  const finalCar = getEnduranceCar(event.selectedCarId);
  const recommendedCar = getEnduranceCar(recommendation.carId);

  useEffect(() => {
    const valid = cars.some((car) => car.id === carId);
    if (!valid) setCarId(recommendation.classId === classId && recommendation.carId ? recommendation.carId : cars[0]?.id ?? "");
  }, [carId, cars, classId, recommendation]);

  const changeClass = (next: EnduranceClassId) => {
    setClassId(next);
    const winners = winningCarIdsForClass(state.registrations, event.id, next);
    const options = enduranceCarsForClass(next).filter((car) => !winners.length || winners.includes(car.id));
    setCarId(recommendation.classId === next && recommendation.carId ? recommendation.carId : options[0]?.id ?? "");
  };
  const confirm = () => carId && dispatch({ type: "select_event_vehicle", eventId: event.id, classId, carId });
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
          <PrimaryButton onClick={confirm} disabled={!carId}><CheckCircle2 className="h-4 w-4" /> Meerderheidskeuze bevestigen</PrimaryButton>
        </div>}
      </div>
    </div>
  </Panel>;
};

const VoteList = ({ title, votes }: { title: string; votes: Array<{ id: string; label: string; votes: number; percentage: number }> }) => <div className="rounded-2xl bg-black/20 p-4 ring-1 ring-white/5"><div className="mb-3 flex items-center gap-2"><BarChart3 className="h-4 w-4 text-orange-400" /><h3 className="font-heading font-black text-white">{title}</h3></div><div className="space-y-3">{votes.map((vote) => <div key={vote.id}><div className="mb-1 flex justify-between gap-3 text-xs"><span className="truncate text-gray-300">{vote.label}</span><strong className="shrink-0 text-white">{vote.votes} · {vote.percentage}%</strong></div><div className="h-1.5 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-orange-500" style={{ width: `${vote.percentage}%` }} /></div></div>)}{!votes.length && <p className="text-xs text-gray-500">Nog geen stemmen.</p>}</div></div>;
