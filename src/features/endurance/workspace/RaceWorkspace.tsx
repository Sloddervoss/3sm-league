import { ArrowLeft, Activity, Bell, Cable, CalendarRange, Gauge, LayoutDashboard, Radio, Route, Users, TimerReset } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useEnduranceActor } from "../core/ActorContext";
import { useEnduranceRegistrations, useUpsertEnduranceRegistration } from "../repository/registrationsRepository";
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
import { PrimaryButton, SecondaryButton, StatusPill, Panel } from "../shared/ui";
import { OverviewPanel } from "./OverviewPanel";
import { PitwallTab } from "../pitwall/PitwallTab";
import { useMemo, useState } from "react";
import { useLocation } from "react-router-dom";

const tabs = [
  { id: "overview", label: "Overzicht", icon: LayoutDashboard },
  { id: "pitwall", label: "Pitwall", icon: Activity },
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

/** Banner die een openstaande uitnodiging toont vóór het inschrijvingsformulier. */
const InvitationBanner = ({ event, pending, onAccept }: { event: EnduranceEvent; pending: boolean; onAccept: () => void }) => (
  <Panel className="mx-auto max-w-2xl">
    <div className="mb-4"><StatusPill tone="orange">Uitnodiging</StatusPill></div>
    <h2 className="font-heading text-2xl font-black text-white">Je bent uitgenodigd voor {event.name}</h2>
    <p className="mt-2 text-sm text-gray-400">{event.circuit} · {event.configuration}</p>
    <p className="mt-4 rounded-xl bg-orange-500/[0.06] p-4 text-sm leading-relaxed text-gray-300 ring-1 ring-orange-500/15">
      Bevestig je deelname om het inschrijvingsformulier te openen en toegang te krijgen tot de afgeschermde raceomgeving.
    </p>
    <div className="mt-5 flex flex-wrap gap-2">
      <PrimaryButton onClick={onAccept} disabled={pending}>{pending ? "Bevestigen…" : "Accepteren"}</PrimaryButton>
    </div>
  </Panel>
);

/**
 * Raceomgeving — Fase 3 (optie A).
 * Toegang wordt bepaald op de ECHTE registratie in de databank (super-admin
 * heeft altijd toegang voor testdoeleinden). De event-id is een echt DB-event.
 */
export const RaceWorkspace = ({ event, onBack }: { event: EnduranceEvent; onBack: () => void }) => {
  const { isSuperAdmin, isEnduranceManager } = useAuth();
  const { actorId } = useEnduranceActor();
  const location = useLocation();
  const isFocus = useMemo(() => {
    try { return new URLSearchParams(location.search).get("pitwallFocus") === "1"; }
    catch { return false; }
  }, [location.search]);
  const { data: registrations = [], isLoading } = useEnduranceRegistrations(event.id);
  const accept = useUpsertEnduranceRegistration();
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("overview");
  const myRegistration = registrations.find((r) => r.user_id === actorId);
  const access = isSuperAdmin || isEnduranceManager || (myRegistration ? ACTIVE.includes(myRegistration.status) : false);

  if (isLoading) return <div><SecondaryButton onClick={onBack} className="mb-5"><ArrowLeft className="h-4 w-4" /> Terug naar races</SecondaryButton><p className="text-sm text-gray-400">Laden…</p></div>;
  if (!access) {
    // Een uitgenodigde rijder zonder (actieve) inschrijving ziet eerst de
    // uitnodiging en moet die expliciet accepteren voordat het formulier opengaat.
    const isInvited = event.visibility === "invite_only" && event.invitedUserIds.includes(actorId);
    if (isInvited) {
      return <div><SecondaryButton onClick={onBack} className="mb-5"><ArrowLeft className="h-4 w-4" /> Terug naar races</SecondaryButton>
        <InvitationBanner
          event={event}
          pending={accept.isPending}
          onAccept={async () => {
            setAcceptError(null);
            try { await accept.mutateAsync({ event_id: event.id, user_id: actorId, status: "interest" }); }
            catch { setAcceptError("Uitnodiging accepteren mislukt. Probeer opnieuw."); }
          }}
        />
        {acceptError && <p role="alert" className="mt-3 text-red-300">{acceptError}</p>}
      </div>;
    }
    return <div><SecondaryButton onClick={onBack} className="mb-5"><ArrowLeft className="h-4 w-4" /> Terug naar races</SecondaryButton><RegistrationForm event={event} /></div>;
  }

  /* Focus mode: render only PitwallTab, no event card or tab bar */
  if (isFocus) {
    return <PitwallTab event={event} />;
  }

  return <div><div className="mb-5 flex flex-col gap-4 rounded-[1.5rem] bg-card/65 p-5 ring-1 ring-white/[0.07] lg:flex-row lg:items-center lg:justify-between"><div><div className="flex flex-wrap items-center gap-2"><StatusPill tone={event.status === "live" ? "red" : "orange"}>{event.status}</StatusPill><StatusPill>{event.visibility}</StatusPill></div><h1 className="mt-3 font-heading text-2xl font-black text-white sm:text-3xl">{event.name}</h1><p className="mt-1 text-sm text-gray-400">{event.circuit} · {event.configuration}</p></div><SecondaryButton onClick={onBack}><ArrowLeft className="h-4 w-4" /> Alle races</SecondaryButton></div>
    <div className="mb-6 overflow-x-auto"><div className="flex min-w-max gap-2 rounded-2xl bg-black/20 p-2 ring-1 ring-white/5">{tabs.map((item) => <button key={item.id} type="button" onClick={() => setTab(item.id)} className={`flex min-h-10 items-center gap-2 rounded-xl px-3 text-sm font-bold transition ${tab === item.id ? "bg-orange-500 text-white shadow-lg shadow-orange-950/25" : "text-gray-400 hover:bg-white/5 hover:text-white"}`}><item.icon className="h-4 w-4" />{item.label}</button>)}</div></div>
    {tab === "overview" && <OverviewPanel event={event} />}{tab === "pitwall" && <PitwallTab event={event} />}{tab === "availability" && <AvailabilityPanel event={event} />}{tab === "pace" && <PacePanel event={event} />}{tab === "teams" && <TeamBuilder event={event} />}{tab === "stints" && <StintPlanner event={event} />}{tab === "practice" && <PracticeSessionPanel event={event} />}{tab === "devices" && <DeviceAssignmentPanel event={event} />}{tab === "race-control" && <RaceControlPanel event={event} />}{tab === "notifications" && <NotificationCenter eventId={event.id} />}
  </div>;
};
