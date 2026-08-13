import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, LockKeyhole } from "lucide-react";
import { useEnduranceActor } from "../core/ActorContext";
import { useEnduranceRegistrations, useUpsertEnduranceRegistration } from "../repository/registrationsRepository";
import type { EnduranceEvent } from "../core/types";
import { allowedEnduranceCarsForClass, type EnduranceClassId } from "../core/carCatalog";
import { Field, inputClass, Panel, PrimaryButton, SectionHeading } from "../shared/ui";

/**
 * Inschrijving — Fase 3 (test-als).
 * Schrijft de registratie naar `endurance_registrations`. De `user_id` is de
 * geselecteerde actor (Test-als) — de sessie blijft super-admin (RLS checkt
 * alleen de sessie). Zo kunnen meerdere coureurs in dezelfde canary worden
 * getest zonder echte accounts.
 */
export const RegistrationForm = ({ event, onRegistered }: { event: EnduranceEvent; onRegistered?: () => void }) => {
  const { actorId, displayName } = useEnduranceActor();
  const { data: registrations = [] } = useEnduranceRegistrations(event.id);
  const upsert = useUpsertEnduranceRegistration();
  const existing = registrations.find((r) => r.user_id === actorId);
  const [status, setStatus] = useState<string>(existing?.status ?? "provisional");
  const initialClass = (existing?.class_preference ?? event.classIds[0] ?? "GT3") as EnduranceClassId;
  const [classPreference, setClassPreference] = useState<EnduranceClassId>(initialClass);
  const cars = useMemo(() => allowedEnduranceCarsForClass(classPreference, event.allowedCarIds), [classPreference, event.allowedCarIds]);
  const [preferredCarId, setPreferredCarId] = useState(existing?.preferred_car_id ?? cars[0]?.id ?? "");
  const selectedSlot = (event.slots as { id: string; label: string }[])[0] ?? null;
  const [maxStints, setMaxStints] = useState(existing?.max_stints ?? 3);
  const [maxStintMinutes, setMaxStintMinutes] = useState<number | null>(existing?.max_stint_minutes ?? null);
  const [maxTotalMinutes, setMaxTotalMinutes] = useState<number | null>(existing?.max_total_minutes ?? null);
  const [maxConsecutiveStints, setMaxConsecutiveStints] = useState<number | null>(existing?.max_consecutive_stints ?? null);
  const [minRestMinutes, setMinRestMinutes] = useState<number | null>(existing?.min_rest_minutes ?? null);
  const [nightDriving, setNightDriving] = useState(existing?.night_driving ?? false);
  const [willingToStart, setWillingToStart] = useState(existing?.willing_to_start ?? false);
  const [willingToFinish, setWillingToFinish] = useState(existing?.willing_to_finish ?? false);
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  // Reset het formulier wanneer er van actor gewisseld wordt.
  useEffect(() => {
    setStatus(existing?.status ?? "provisional");
    setClassPreference((existing?.class_preference ?? event.classIds[0] ?? "GT3") as EnduranceClassId);
    setPreferredCarId(existing?.preferred_car_id ?? "");

    setMaxStints(existing?.max_stints ?? 3);
    setMaxStintMinutes(existing?.max_stint_minutes ?? null);
    setMaxTotalMinutes(existing?.max_total_minutes ?? null);
    setMaxConsecutiveStints(existing?.max_consecutive_stints ?? null);
    setMinRestMinutes(existing?.min_rest_minutes ?? null);
    setNightDriving(existing?.night_driving ?? false);
    setWillingToStart(existing?.willing_to_start ?? false);
    setWillingToFinish(existing?.willing_to_finish ?? false);
    setNotes(existing?.notes ?? "");
    setSaved(false);
    setError("");
  }, [actorId, existing, event.classIds, event.slots]);

  const submit = async (formEvent: React.FormEvent) => {
    formEvent.preventDefault();
    if (!actorId) { setError("Geen actieve test-coureur. Kies eerst een coureur in de Test-alsschuif."); return; }
    setError("");
    setSaved(false);
    try {
      await upsert.mutateAsync({
        event_id: event.id,
        user_id: actorId,
        status: status as "interest" | "provisional" | "confirmed" | "reserve" | "rejected" | "withdrawn",
        class_preference: classPreference,
        preferred_car_id: preferredCarId || null,
        // Bij officiële events bevat de lokale race exact één geactiveerd slot.
        // De database valideert/forceert dit opnieuw; de browser biedt geen andere keuze.
        slot_id: selectedSlot?.id ?? null,
        max_stints: maxStints,
        max_stint_minutes: maxStintMinutes,
        max_total_minutes: maxTotalMinutes,
        max_consecutive_stints: maxConsecutiveStints,
        min_rest_minutes: minRestMinutes,
        night_driving: nightDriving,
        willing_to_start: willingToStart,
        willing_to_finish: willingToFinish,
        notes: notes || null,
      });
      setSaved(true);
      onRegistered?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Opslaan mislukt.");
    }
  };

  return (
    <Panel className="mx-auto max-w-4xl">
      <SectionHeading eyebrow="Inschrijving" title={`Aanmelden voor ${event.name}`} description={`Je meldt nu aan als ${displayName(actorId)}. Na opslaan krijg je direct toegang tot de privé-raceomgeving.`} />
      <form onSubmit={submit} className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Aanmeldstatus"><select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value)}><option value="interest">Interesse</option><option value="provisional">Voorlopig aangemeld</option><option value="reserve">Alleen reserve</option></select></Field>
          <Field label="Klasvoorkeur (stem)"><select className={inputClass} value={classPreference} onChange={(e) => { const nextClass = e.target.value as EnduranceClassId; setClassPreference(nextClass); setPreferredCarId(allowedEnduranceCarsForClass(nextClass, event.allowedCarIds)[0]?.id ?? ""); }}>{event.classIds.map((value) => <option key={value}>{value}</option>)}</select></Field>
          <Field label="Autovoorkeur (stem)"><select className={inputClass} value={preferredCarId} onChange={(e) => setPreferredCarId(e.target.value)}>{cars.map((car) => <option key={car.id} value={car.id}>{car.name}</option>)}</select></Field>
          <Field label="3SM-timeslot" hint="Dit slot is door de Endurance Manager gekozen en staat vast voor alle inschrijvingen."><div className={`${inputClass} flex items-center text-gray-300`}>{selectedSlot?.label ?? "Handmatige race zonder apart timeslot"}</div></Field>
          <Field label="Maximaal aantal stints"><input className={inputClass} type="number" min={1} max={12} value={maxStints} onChange={(e) => setMaxStints(Number(e.target.value))} /></Field>
          <Field label="Max. stintduur (min)"><input className={inputClass} type="number" min={0} max={480} placeholder="optioneel" value={maxStintMinutes ?? ""} onChange={(e) => setMaxStintMinutes(e.target.value === "" ? null : Number(e.target.value))} /></Field>
          <Field label="Max. totale rijtijd (min)"><input className={inputClass} type="number" min={0} max={1440} placeholder="optioneel" value={maxTotalMinutes ?? ""} onChange={(e) => setMaxTotalMinutes(e.target.value === "" ? null : Number(e.target.value))} /></Field>
          <Field label="Max. opeenvolgende stints"><input className={inputClass} type="number" min={1} max={12} placeholder="optioneel" value={maxConsecutiveStints ?? ""} onChange={(e) => setMaxConsecutiveStints(e.target.value === "" ? null : Number(e.target.value))} /></Field>
          <Field label="Min. rusttijd tussen stints (min)"><input className={inputClass} type="number" min={0} max={1440} placeholder="optioneel" value={minRestMinutes ?? ""} onChange={(e) => setMinRestMinutes(e.target.value === "" ? null : Number(e.target.value))} /></Field>
        </div>
        <p className="rounded-xl bg-sky-500/[0.06] p-3 text-xs leading-relaxed text-sky-100 ring-1 ring-sky-500/15">Je klasse- en autokeuze zijn stemmen, geen definitieve racekeuze. De meeste stemmen vormen het advies; bij een gelijke stand of praktische reden beslist de racemanager. Na bevestiging rijdt ieder 3SM-team in deze race met die auto.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {[{ label: "Bereid om ’s nachts te rijden", value: nightDriving, set: setNightDriving }, { label: "Bereid om te starten", value: willingToStart, set: setWillingToStart }, { label: "Bereid om te finishen", value: willingToFinish, set: setWillingToFinish }].map((item) => <label key={item.label} className="flex cursor-pointer items-center gap-3 rounded-xl bg-black/20 p-3 text-sm text-gray-300 ring-1 ring-white/5"><input type="checkbox" checked={item.value} onChange={(e) => item.set(e.target.checked)} className="h-4 w-4 accent-orange-500" />{item.label}</label>)}
        </div>
        <Field label="Opmerkingen"><textarea className={`${inputClass} min-h-24`} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ervaring, voorkeuren of praktische afspraken" /></Field>
        {error && <p role="alert" className="rounded-xl bg-red-500/10 p-3 text-sm text-red-200 ring-1 ring-red-500/20">{error}</p>}
        {saved && <p role="status" className="rounded-xl bg-emerald-500/[0.07] p-3 text-sm text-emerald-200 ring-1 ring-emerald-500/15">Inschrijving opgeslagen. Je hebt nu toegang tot de raceomgeving.</p>}
        <div className="flex flex-col gap-3 rounded-xl bg-orange-500/[0.06] p-4 text-sm text-gray-300 ring-1 ring-orange-500/15 sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-center gap-2"><LockKeyhole className="h-4 w-4 text-orange-400" /> Teams, pace, bestanden en stintplanning blijven privé voor deelnemers en managers.</span>
          <PrimaryButton type="submit" disabled={upsert.isPending || !actorId}>{saved ? <CheckCircle2 className="h-4 w-4" /> : null}{existing ? "Inschrijving bijwerken" : "Aanmelding opslaan"}</PrimaryButton>
        </div>
      </form>
    </Panel>
  );
};
