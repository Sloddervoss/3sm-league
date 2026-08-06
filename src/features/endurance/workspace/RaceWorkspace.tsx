import { useState } from "react";
import { ArrowLeft, Bell, Cable, CalendarRange, Gauge, LayoutDashboard, Radio, Route, Users, TimerReset } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useEnduranceActor } from "../core/ActorContext";
import { useEnduranceRegistrations } from "../repository/registrationsRepository";
import type { EnduranceEvent } from "../core/types";
import { RegistrationForm } from "../registration/RegistrationForm";
import { AvailabilityPanel } from "../availability/AvailabilityPanel";
import { PacePanel } from "../pace/PacePanel";
import { TeamBuilder } from "../teams/TeamBuilder";
import { StintPlanner } from "../stints/StintPlanner";
import { RaceControlPanel } from "../race-control/RaceControlPanel";
import { NotificationCenter } from "../notifications/NotificationCenter";
import { PracticeSessionPanel } from "../practice/PracticeSessionPanel";
import { DeviceAssignmentPanel } from "../devices/DeviceAssignmentPanel";
import { SecondaryButton, StatusPill } from "../shared/ui";
import { OverviewPanel } from "./OverviewPanel";

const tabs = [
  { id: "overview", label: "Overzicht", icon: LayoutDashboard },
  { id: "availability", label: "Beschikbaarheid", icon: CalendarRange },
  { id: "pace", label: "Pace", icon: Gauge },
  { id: "teams", label: "Teams", icon: Users },
  { id: "stints", label: "Stintplanner", icon: Route },
  { id: "practice", label: "Practice", icon: TimerReset },
  { id: "devices", label: "Apparaten", icon: Cable },
  { id: "race-control", label: "Race Control", icon: Radio },
  { id: "notifications", label: "Meldingen", icon: Bell },
] as const;
type TabId = typeof tabs[number]["id"];

const ACTIVE = ["interest", "provisional", "confirmed", "reserve"];

/**
 * Raceomgeving — Fase 3 (optie A).
 * Toegang wordt bepaald op de ECHTE registratie in de databank (super-admin
 * heeft altijd toegang voor testdoeleinden). De event-id is een echt DB-event.
 */
export const RaceWorkspace = ({ event, onBack }: { event: EnduranceEvent; onBack: () => void }) => {
  const { isSuperAdmin } = useAuth();
  const { actorId } = useEnduranceActor();
  const { data: registrations = [], isLoading } = useEnduranceRegistrations(event.id);
  const [tab, setTab] = useState<TabId>("overview");
  const myRegistration = registrations.find((r) => r.user_id === actorId);
  const access = isSuperAdmin || (myRegistration ? ACTIVE.includes(myRegistration.status) : false);

  if (isLoading) return <div><SecondaryButton onClick={onBack} className="mb-5"><ArrowLeft className="h-4 w-4" /> Terug naar races</SecondaryButton><p className="text-sm text-gray-400">Laden…</p></div>;
  if (!access) return <div><SecondaryButton onClick={onBack} className="mb-5"><ArrowLeft className="h-4 w-4" /> Terug naar races</SecondaryButton><RegistrationForm event={event} /></div>;
  return <div><div className="mb-5 flex flex-col gap-4 rounded-[1.5rem] bg-card/65 p-5 ring-1 ring-white/[0.07] lg:flex-row lg:items-center lg:justify-between"><div><div className="flex flex-wrap items-center gap-2"><StatusPill tone={event.status === "live" ? "red" : "orange"}>{event.status}</StatusPill><StatusPill>{event.visibility}</StatusPill></div><h1 className="mt-3 font-heading text-2xl font-black text-white sm:text-3xl">{event.name}</h1><p className="mt-1 text-sm text-gray-400">{event.circuit} · {event.configuration}</p></div><SecondaryButton onClick={onBack}><ArrowLeft className="h-4 w-4" /> Alle races</SecondaryButton></div>
    <div className="mb-6 overflow-x-auto"><div className="flex min-w-max gap-2 rounded-2xl bg-black/20 p-2 ring-1 ring-white/5">{tabs.map((item) => <button key={item.id} type="button" onClick={() => setTab(item.id)} className={`flex min-h-10 items-center gap-2 rounded-xl px-3 text-sm font-bold transition ${tab === item.id ? "bg-orange-500 text-white shadow-lg shadow-orange-950/25" : "text-gray-400 hover:bg-white/5 hover:text-white"}`}><item.icon className="h-4 w-4" />{item.label}</button>)}</div></div>
    {tab === "overview" && <OverviewPanel event={event} />}{tab === "availability" && <AvailabilityPanel event={event} />}{tab === "pace" && <PacePanel event={event} />}{tab === "teams" && <TeamBuilder event={event} />}{tab === "stints" && <StintPlanner event={event} />}{tab === "practice" && <PracticeSessionPanel event={event} />}{tab === "devices" && <DeviceAssignmentPanel event={event} />}{tab === "race-control" && <RaceControlPanel event={event} />}{tab === "notifications" && <NotificationCenter eventId={event.id} />}
  </div>;
};
