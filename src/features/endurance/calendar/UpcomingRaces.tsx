import { CalendarClock, Car, ChevronRight, Clock3, Flag, Users } from "lucide-react";
import { useEnduranceActor } from "../core/ActorContext";
import { formatAmsterdam } from "../core/selectors";
import type { EnduranceEvent } from "../core/types";
import { Panel, PrimaryButton, SectionHeading, StatusPill } from "../shared/ui";
import { getEnduranceCar } from "../core/carCatalog";
import { useEnduranceEvents } from "../repository/eventsRepository";
import { useAllEnduranceRegistrations } from "../repository/registrationsRepository";
import { enduranceEventRowsToAppModels } from "../repository/mappers";
import { LiveDatabaseEvents } from "../workspace/LiveDatabaseEvents";

const statusLabel = { draft: "Concept", registration_open: "Inschrijving open", registration_closed: "Inschrijving gesloten", planning: "Planning", live: "Live", completed: "Afgerond" } as const;

/**
 * Aankomende races — Fase 3 (test-als).
 * Toont ECHTE endurance-events uit de databank. Registratie-telling en "jij
 * staat ingeschreven" komen uit de DB-registraties (actor-gefilterd). De knop
 * opent altijd de raceomgeving (super-admin heeft toegang; binnenin verschijnt
 * het inschrijfformulier zolang de actor nog niet is ingeschreven).
 */
export const UpcomingRaces = ({ onSelect }: { onSelect: (event: EnduranceEvent) => void }) => {
  const { actorId } = useEnduranceActor();
  const { data: dbEvents = [], isLoading, isError } = useEnduranceEvents();
  const { data: registrations = [] } = useAllEnduranceRegistrations();
  const events: EnduranceEvent[] = isError ? [] : enduranceEventRowsToAppModels(dbEvents)
    .filter((event) => event.status !== "completed")
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  return (
    <div>
      <SectionHeading eyebrow="Endurance kalender" title="Aankomende races" description="Kies een evenement, meld je aan en werk daarna samen in de afgeschermde raceomgeving." />
      <div className="mb-6"><LiveDatabaseEvents /></div>
      <div className="grid gap-5 xl:grid-cols-2">
        {events.map((event) => {
          const myReg = registrations.find((r) => r.event_id === event.id && r.user_id === actorId);
          const interested = registrations.filter((candidate) => candidate.event_id === event.id && !["withdrawn", "rejected"].includes(candidate.status)).length;
          const durationHours = (new Date(event.endAt).getTime() - new Date(event.startAt).getTime()) / 3_600_000;
          return (
            <Panel key={event.id} className="group relative overflow-hidden">
              <div className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-orange-500/10 blur-3xl" />
              <div className="relative">
                <div className="mb-4 flex flex-wrap items-center gap-2"><StatusPill tone={event.status === "live" ? "red" : "orange"}>{statusLabel[event.status]}</StatusPill>{myReg && <StatusPill tone="green">{myReg.status}</StatusPill>}<StatusPill>{event.visibility === "open" ? "Open voor leden" : event.visibility === "invite_only" ? "Op uitnodiging" : "Verborgen"}</StatusPill></div>
                <h3 className="font-heading text-2xl font-black text-white">{event.name}</h3>
                <p className="mt-1 flex items-center gap-2 text-sm text-gray-400"><Flag className="h-4 w-4 text-orange-400" /> {event.circuit} · {event.configuration}</p>
                <div className="my-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <div className="rounded-xl bg-black/20 p-3"><CalendarClock className="mb-2 h-4 w-4 text-orange-400" /><span className="block text-xs text-gray-500">Start</span><strong className="text-gray-200">{formatAmsterdam(event.startAt)}</strong></div>
                  <div className="rounded-xl bg-black/20 p-3"><Clock3 className="mb-2 h-4 w-4 text-orange-400" /><span className="block text-xs text-gray-500">Duur</span><strong className="text-gray-200">{durationHours} uur</strong></div>
                  <div className="rounded-xl bg-black/20 p-3"><Car className="mb-2 h-4 w-4 text-orange-400" /><span className="block text-xs text-gray-500">Definitieve auto</span><strong className="text-gray-200">{getEnduranceCar(event.selectedCarId)?.name ?? "Stemming open"}</strong></div>
                  <div className="rounded-xl bg-black/20 p-3"><Users className="mb-2 h-4 w-4 text-orange-400" /><span className="block text-xs text-gray-500">Interesse</span><strong className="text-gray-200">{interested} coureurs</strong></div>
                </div>
                <div className="mb-5 text-xs text-gray-400"><span className="text-gray-500">Startslots:</span> {event.slots.map((slot) => slot.label).join(", ") || "—"} · <span className="text-gray-500">Deadline:</span> {event.registrationDeadline ? formatAmsterdam(event.registrationDeadline) : "—"}</div>
                <PrimaryButton onClick={() => onSelect(event)}>{myReg ? "Open raceomgeving" : "Open / aanmelden"}<ChevronRight className="h-4 w-4" /></PrimaryButton>
              </div>
            </Panel>
          );
        })}
      </div>
      {isLoading && <Panel><p className="text-sm text-gray-400">Laden…</p></Panel>}
      {!isLoading && events.length === 0 && !isError && <Panel><p className="text-sm text-gray-400">Er zijn geen aankomende races in de databank.</p></Panel>}
    </div>
  );
};

