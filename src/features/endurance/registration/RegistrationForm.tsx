import { useMemo, useState } from "react";
import { CheckCircle2, LockKeyhole } from "lucide-react";
import { useEnduranceStore } from "../core/EnduranceStore";
import { makeId } from "../core/actions";
import { getRegistration } from "../core/selectors";
import type { EnduranceEvent, RegistrationStatus } from "../core/types";
import { Field, inputClass, Panel, PrimaryButton, SectionHeading } from "../shared/ui";

export const RegistrationForm = ({ event, onRegistered }: { event: EnduranceEvent; onRegistered?: () => void }) => {
  const { state, activePersona, dispatch } = useEnduranceStore();
  const existing = getRegistration(state, event.id, activePersona.id);
  const [status, setStatus] = useState<RegistrationStatus>(existing?.status ?? "provisional");
  const [classPreference, setClassPreference] = useState(existing?.classPreference ?? event.cars[0]?.className ?? "");
  const cars = useMemo(() => event.cars.filter((car) => !classPreference || car.className === classPreference), [event.cars, classPreference]);
  const [preferredCar, setPreferredCar] = useState(existing?.preferredCar ?? cars[0]?.carName ?? "");
  const [slotId, setSlotId] = useState(existing?.slotId ?? event.slots[0]?.id ?? "");
  const [maxStints, setMaxStints] = useState(existing?.maxStints ?? 3);
  const [nightDriving, setNightDriving] = useState(existing?.nightDriving ?? false);
  const [willingToStart, setWillingToStart] = useState(existing?.willingToStart ?? false);
  const [willingToFinish, setWillingToFinish] = useState(existing?.willingToFinish ?? false);
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [saved, setSaved] = useState(false);

  const submit = (formEvent: React.FormEvent) => {
    formEvent.preventDefault();
    const selectedCars = cars.map((car) => car.carName);
    dispatch({ type: "upsert_registration", registration: {
      id: existing?.id ?? makeId("registration"), eventId: event.id, userId: activePersona.id, status,
      classPreference, availableCars: selectedCars, preferredCar, slotId, maxStints, nightDriving,
      willingToStart, willingToFinish, notes, registeredAt: existing?.registeredAt ?? new Date().toISOString(),
    } });
    setSaved(true);
    onRegistered?.();
  };

  return (
    <Panel className="mx-auto max-w-4xl">
      <SectionHeading eyebrow="Inschrijving" title={`Aanmelden voor ${event.name}`} description="Na opslaan krijg je direct toegang tot de privé-raceomgeving. Managers kunnen je status later definitief maken." />
      <form onSubmit={submit} className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Aanmeldstatus"><select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value as RegistrationStatus)}><option value="interest">Interesse</option><option value="provisional">Voorlopig aangemeld</option><option value="reserve">Alleen reserve</option></select></Field>
          <Field label="Gewenste klasse"><select className={inputClass} value={classPreference} onChange={(e) => { setClassPreference(e.target.value); const first = event.cars.find((car) => car.className === e.target.value); setPreferredCar(first?.carName ?? ""); }}>{[...new Set(event.cars.map((car) => car.className))].map((value) => <option key={value}>{value}</option>)}</select></Field>
          <Field label="Voorkeursauto"><select className={inputClass} value={preferredCar} onChange={(e) => setPreferredCar(e.target.value)}>{cars.map((car) => <option key={car.id}>{car.carName}</option>)}</select></Field>
          <Field label="Startslotvoorkeur"><select className={inputClass} value={slotId} onChange={(e) => setSlotId(e.target.value)}>{event.slots.map((slot) => <option key={slot.id} value={slot.id}>{slot.label}</option>)}</select></Field>
          <Field label="Maximaal aantal stints"><input className={inputClass} type="number" min={1} max={12} value={maxStints} onChange={(e) => setMaxStints(Number(e.target.value))} /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {[{ label: "Bereid om ’s nachts te rijden", value: nightDriving, set: setNightDriving }, { label: "Bereid om te starten", value: willingToStart, set: setWillingToStart }, { label: "Bereid om te finishen", value: willingToFinish, set: setWillingToFinish }].map((item) => <label key={item.label} className="flex cursor-pointer items-center gap-3 rounded-xl bg-black/20 p-3 text-sm text-gray-300 ring-1 ring-white/5"><input type="checkbox" checked={item.value} onChange={(e) => item.set(e.target.checked)} className="h-4 w-4 accent-orange-500" />{item.label}</label>)}
        </div>
        <Field label="Opmerkingen"><textarea className={`${inputClass} min-h-24`} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ervaring, voorkeuren of praktische afspraken" /></Field>
        <div className="flex flex-col gap-3 rounded-xl bg-orange-500/[0.06] p-4 text-sm text-gray-300 ring-1 ring-orange-500/15 sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-center gap-2"><LockKeyhole className="h-4 w-4 text-orange-400" /> Teams, pace, bestanden en stintplanning blijven privé voor deelnemers en managers.</span>
          <PrimaryButton type="submit">{saved ? <CheckCircle2 className="h-4 w-4" /> : null}{existing ? "Inschrijving bijwerken" : "Aanmelding opslaan"}</PrimaryButton>
        </div>
      </form>
    </Panel>
  );
};
