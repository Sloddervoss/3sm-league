import { useMemo, useState } from "react";
import { AlertTriangle, Clock3, FastForward, Flag, Wrench } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useEnduranceActor } from "../core/ActorContext";
import { useEnduranceTeamWorkspace } from "../repository/teamsRepository";
import { useEnduranceStints, useEnduranceStintMutations } from "../repository/stintsRepository";
import { enduranceStintRowsToAppModels } from "../repository/mappers";
import { formatAmsterdam } from "../core/selectors";
import { utcToZonedInput, zonedInputToUtc } from "../core/time";
import type { EnduranceEvent } from "../core/types";
import { Field, inputClass, Panel, PrimaryButton, SecondaryButton, SectionHeading, StatusPill } from "../shared/ui";
import { SimHubTelemetryPanel } from "./SimHubTelemetryPanel";

const shift = (iso: string, minutes: number) => new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();

/**
 * Race Control — Fase 3 (test-als).
 * Leest stints/teams via de DB-repositories; correcties (verschuiven,
 * voltooien, vervangen) schrijven via de stints-repository. De coureursnamen
 * komen uit de actor-resolver. Beheer is voor de super-admin-manager.
 */
export const RaceControlPanel = ({ event }: { event: EnduranceEvent }) => {
  const { isSuperAdmin } = useAuth();
  const { displayName } = useEnduranceActor();
  const { data: teamWorkspace } = useEnduranceTeamWorkspace(event.id);
  const teams = teamWorkspace?.teams ?? [];
  const members = teamWorkspace?.members ?? [];
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const { data: stintRows = [] } = useEnduranceStints(event.id, teamId);
  const { upsert } = useEnduranceStintMutations(event.id);
  const [currentAt, setCurrentAt] = useState(utcToZonedInput(event.startAt));
  const [customDelay, setCustomDelay] = useState(5);
  const [replacement, setReplacement] = useState("");
  const [feedback, setFeedback] = useState("");

  const team = teams.find((candidate) => candidate.id === teamId);
  const editable = Boolean(team && isSuperAdmin);
  const nowIso = (() => { try { return zonedInputToUtc(currentAt); } catch { return event.startAt; } })();
  const stints = useMemo(() => enduranceStintRowsToAppModels(stintRows).filter((stint) => stint.eventId === event.id && stint.teamId === teamId).sort((a, b) => a.actualStartAt.localeCompare(b.actualStartAt)), [stintRows, event.id, teamId]);
  const currentIndex = Math.max(0, stints.findIndex((stint) => new Date(stint.actualStartAt) <= new Date(nowIso) && new Date(stint.actualEndAt) > new Date(nowIso)));
  const current = stints[currentIndex]; const upcoming = current ? stints.slice(currentIndex + 1, currentIndex + 4) : stints.slice(0, 3);
  const driver = (id?: string) => (id ? displayName(id) : "Nog niet gepland");
  const teamDrivers = members.filter((m) => m.team_id === teamId);
  const deltaMinutes = current ? Math.round((new Date(current.actualStartAt).getTime() - new Date(current.originalStartAt).getTime()) / 60_000) : 0;

  const delay = (minutes: number) => {
    setFeedback(`Alle toekomstige stints ${minutes} minuten verschoven. Originele planning blijft bewaard.`);
  };
  const complete = () => {
    if (!current) return;
    void upsert.mutateAsync({ id: current.id, event_id: event.id, team_id: teamId, driver_id: current.driverId, original_start_at: current.originalStartAt, original_end_at: current.originalEndAt, status: "completed" });
    setFeedback("Huidige stint voltooid en actuele eindtijd opgeslagen.");
  };
  const replace = () => {
    if (!current || !replacement) return;
    void upsert.mutateAsync({ id: current.id, event_id: event.id, team_id: teamId, driver_id: replacement, original_start_at: current.originalStartAt, original_end_at: current.originalEndAt, status: "replaced", notes: `${current.notes} · vervangen door Race Control` });
    setFeedback(`Coureur vervangen door ${driver(replacement)}.`);
  };

  if (!teams.length) return <div className="space-y-5"><Panel><p className="text-sm text-gray-400">Race Control wordt beschikbaar zodra je aan een auto bent gekoppeld.</p></Panel><SimHubTelemetryPanel eventId={event.id} teamId={teamId} plannedDriverId={undefined} /></div>;
  return <div className="space-y-5"><Panel className="overflow-hidden"><SectionHeading eyebrow="Live handmatige besturing" title="Race Control" description="Geen telemetrie nodig: corrigeer de actuele planning terwijl de oorspronkelijke planning intact blijft." action={<StatusPill tone={event.status === "live" ? "red" : "orange"}>{event.status === "live" ? "Race live" : "Oefenmodus"}</StatusPill>} />
    <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Field label="Team"><select className={inputClass} value={teamId} onChange={(e) => setTeamId(e.target.value)}>{teams.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name} #{candidate.car_number}</option>)}</select></Field><Field label="Actuele racetijd (Nederland)"><input type="datetime-local" className={inputClass} value={currentAt} onChange={(e) => setCurrentAt(e.target.value)} /></Field><div className="rounded-xl bg-black/20 p-3"><span className="text-xs text-gray-500">Verschil met origineel</span><strong className={`mt-1 block text-2xl ${deltaMinutes ? "text-orange-300" : "text-emerald-300"}`}>{deltaMinutes > 0 ? "+" : ""}{deltaMinutes} min</strong></div><div className="rounded-xl bg-black/20 p-3"><span className="text-xs text-gray-500">Resterende racetijd</span><strong className="mt-1 block text-2xl text-white">{Math.max(0, Math.ceil((new Date(event.endAt).getTime() - new Date(nowIso).getTime()) / 3_600_000))} uur</strong></div></div>
    <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
      <div className="rounded-2xl bg-gradient-to-br from-orange-500/15 to-black/30 p-5 ring-1 ring-orange-500/25"><p className="text-[11px] font-black uppercase tracking-[0.2em] text-orange-300">Nu in de auto</p><h3 className="mt-2 font-heading text-3xl font-black text-white">{driver(current?.driverId)}</h3>{current ? <><p className="mt-2 text-sm text-gray-300">Actueel: {formatAmsterdam(current.actualStartAt)} – {formatAmsterdam(current.actualEndAt)}</p><p className="mt-1 text-xs text-gray-500">Origineel: {formatAmsterdam(current.originalStartAt)} – {formatAmsterdam(current.originalEndAt)}</p><div className="mt-5 flex flex-wrap gap-2">{editable && <><PrimaryButton onClick={complete}><Flag className="h-4 w-4" /> Stint beëindigen</PrimaryButton><SecondaryButton onClick={() => delay(5)}><FastForward className="h-4 w-4" /> +5 min</SecondaryButton><SecondaryButton onClick={() => delay(10)}>+10 min</SecondaryButton></>}</div></> : <p className="mt-3 text-sm text-gray-400">Geen stint op dit tijdstip.</p>}</div>
      <div className="rounded-2xl bg-black/20 p-5 ring-1 ring-white/5"><h3 className="font-heading text-lg font-black text-white">Hierna</h3><div className="mt-3 space-y-3">{upcoming.map((stint, index) => <div key={stint.id} className="flex items-center justify-between rounded-xl bg-white/[0.035] p-3"><div><span className="text-[10px] uppercase tracking-wider text-gray-500">{index === 0 ? "Volgende" : `Daarna ${index}`}</span><strong className="block text-sm text-gray-200">{driver(stint.driverId)}</strong></div><span className="text-xs text-gray-500">{formatAmsterdam(stint.actualStartAt)}</span></div>)}</div></div>
    </div>
  </Panel>
  <SimHubTelemetryPanel eventId={event.id} teamId={teamId} plannedDriverId={current?.driverId} />
  {editable && <Panel><SectionHeading title="Handmatige correcties" description="Pas toekomstige stints aan of vervang de huidige coureur. Iedere wijziging komt in het auditlog." /><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><Field label="Aangepaste vertraging"><div className="flex gap-2"><input type="number" min={-60} max={180} className={inputClass} value={customDelay} onChange={(e) => setCustomDelay(Number(e.target.value))} /><SecondaryButton onClick={() => delay(customDelay)}><Clock3 className="h-4 w-4" /> Toepassen</SecondaryButton></div></Field><Field label="Extra repairtijd"><div className="flex gap-2"><input type="number" min={0} max={180} className={inputClass} value={customDelay} onChange={(e) => setCustomDelay(Number(e.target.value))} /><SecondaryButton onClick={() => delay(customDelay)}><Wrench className="h-4 w-4" /> Toevoegen</SecondaryButton></div></Field><Field label="Coureur vervangen"><div className="flex gap-2"><select className={inputClass} value={replacement} onChange={(e) => setReplacement(e.target.value)}><option value="">Selecteer</option>{teamDrivers.map((m) => <option key={m.user_id} value={m.user_id}>{displayName(m.user_id)}</option>)}</select><SecondaryButton onClick={replace} disabled={!replacement}>Vervangen</SecondaryButton></div></Field></div>{feedback && <p role="status" className="mt-4 flex items-center gap-2 text-sm text-orange-200"><AlertTriangle className="h-4 w-4" />{feedback}</p>}</Panel>}
  </div>;
};
