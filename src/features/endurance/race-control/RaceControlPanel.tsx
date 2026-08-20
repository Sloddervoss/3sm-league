import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Clock3, FastForward, Flag, Wrench } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useEnduranceActor } from "../core/ActorContext";
import { useEnduranceTeamWorkspace } from "../repository/teamsRepository";
import { useEnduranceStints, useEnduranceStintMutations, useRaceControlAudit, RaceControlConflictError } from "../repository/stintsRepository";
import { enduranceStintRowsToAppModels } from "../repository/mappers";
import { formatAmsterdam } from "../core/selectors";
import { utcToZonedInput, zonedInputToUtc } from "../core/time";
import type { EnduranceEvent } from "../core/types";
import { Field, inputClass, Panel, PrimaryButton, SecondaryButton, SectionHeading, StatusPill } from "../shared/ui";
import { SimHubTelemetryPanel } from "./SimHubTelemetryPanel";
import { completeStintOp, delayedStintDeltas, repairStintOp, replaceDriverOp } from "./raceControlUpdates";

/**
 * Race Control — Fase 3B (optimistic, append-only).
 * Correcties loopen door `endurance_race_control_apply` en sturen NOOIT een
 * absolute eindtijd: delay/repair wordt in DBR als server-side delta toegepast.
 * Een stale write (LOST UPDATE from een tweede manager) wordt expliciet als
 * conflict gesurfacde — er wordt nooit stilen retried/overwritten. Iedere
 * correctie schrijft een immutable before/after rij in de auditlog.
 */
export const RaceControlPanel = ({ event }: { event: EnduranceEvent }) => {
  const { user, isSuperAdmin, isEnduranceManager } = useAuth();
  const { displayName } = useEnduranceActor();
  const { data: teamWorkspace } = useEnduranceTeamWorkspace(event.id);
  const teams = useMemo(() => teamWorkspace?.teams ?? [], [teamWorkspace?.teams]);
  const members = useMemo(() => teamWorkspace?.members ?? [], [teamWorkspace?.members]);
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const { data: stintRows = [] } = useEnduranceStints(event.id, teamId);
  const { data: auditRows = [] } = useRaceControlAudit(event.id);
  const { raceControlApply } = useEnduranceStintMutations(event.id);
  const [currentAt, setCurrentAt] = useState(utcToZonedInput(event.startAt));
  const [customDelay, setCustomDelay] = useState(5);
  const [repairSeconds, setRepairSeconds] = useState(30);
  const [replacement, setReplacement] = useState("");
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    if (!teamId || !teams.some((candidate) => candidate.id === teamId)) {
      setTeamId(teams[0]?.id ?? "");
    }
  }, [teams, teamId]);

  const team = teams.find((candidate) => candidate.id === teamId);
  const editable = Boolean(team && (isSuperAdmin || isEnduranceManager || team.manager_id === user?.id));
  const nowIso = (() => { try { return zonedInputToUtc(currentAt); } catch { return event.startAt; } })();
  const stints = useMemo(() => enduranceStintRowsToAppModels(stintRows).filter((stint) => stint.eventId === event.id && stint.teamId === teamId).sort((a, b) => a.actualStartAt.localeCompare(b.actualStartAt)), [stintRows, event.id, teamId]);
  const activeIndex = stints.findIndex((stint) => new Date(stint.actualStartAt) <= new Date(nowIso) && new Date(stint.actualEndAt) > new Date(nowIso));
  const current = activeIndex >= 0 ? stints[activeIndex] : undefined;
  const upcoming = stints.filter((stint) => new Date(stint.actualStartAt) > new Date(nowIso)).slice(0, 3);
  const currentRow = current ? stintRows.find((row) => row.id === current.id) : undefined;
  const driver = (id?: string) => (id ? displayName(id) : "Nog niet gepland");
  const auditLabel = (entry: (typeof auditRows)[number]) => entry.operation === "delay"
    ? `Delay ${entry.delta_minutes} min`
    : entry.operation === "repair"
      ? `Repair ${entry.repair_seconds}s`
      : entry.operation === "complete"
        ? "Stint beëindigd"
        : `Coureur vervangen door ${driver(entry.after_driver_id ?? undefined)}`;
  const teamDrivers = members.filter((m) => m.team_id === teamId);
  const deltaMinutes = current ? Math.round((new Date(current.actualStartAt).getTime() - new Date(current.originalStartAt).getTime()) / 60_000) : 0;

  /** Server-side delay for alle actieve+toekomstige stints, per stint optimistic. */
  const delay = async (minutes: number) => {
    const deltas = delayedStintDeltas(stintRows.filter((row) => row.team_id === teamId), nowIso, minutes);
    if (!deltas.length) { setFeedback("Geen actieve of toekomstige stints om te verschuiven."); return; }
    setFeedback("");
    let applied = 0;
    const conflicts: string[] = [];
    for (const delta of deltas) {
      try {
        await raceControlApply.mutateAsync({ teamId, delta });
        applied += 1;
      } catch (error) {
        if (error instanceof RaceControlConflictError) {
          conflicts.push(delta.stintId.slice(0, 8));
        } else {
          setFeedback(`Vertraging opslaan mislukt: ${(error as Error)?.message ?? String(error)}`);
          return;
        }
      }
    }
    if (conflicts.length) {
      setFeedback(`⚠️ Conflict: ${conflicts.length} stint(s) (${conflicts.join(", ")}) zijn inmiddels door iemand ${applied ? "anders gewijzigd; de rest is verzonden. " : ""}Ververst — controleer en probeer opnieuw.`);
    } else {
      setFeedback(`${deltas.length} actieve/toekomstige stint(s) ${minutes} minuten gecorrigeerd via server-side delta. Originele planning is bewaard.`);
    }
  };
  const repair = async (seconds: number) => {
    if (!currentRow || seconds <= 0) { setFeedback(seconds <= 0 ? "Repairtijd moet groter als 0 seconden zijn." : "Geen actieve stint om repairtijd aan toe te voegen."); return; }
    setFeedback("");
    try {
      await raceControlApply.mutateAsync({ teamId, delta: repairStintOp(currentRow, seconds, nowIso) });
      setFeedback(`${seconds} seconden repairtijd toegevoegd aan de actieve stint.`);
    } catch (error) {
      if (error instanceof RaceControlConflictError) {
        setFeedback("⚠️ Conflict: de actieve stint is verwerkt door iemand anders — herlaad en probeer opnieuw.");
      } else {
        setFeedback(`Repairtijd opslaan mislukt: ${(error as Error)?.message ?? String(error)}`);
      }
    }
  };
  const complete = async () => {
    if (!currentRow) return;
    try {
      await raceControlApply.mutateAsync({ teamId, delta: completeStintOp(currentRow, nowIso) });
      setFeedback("Huidige stint voltooid; de actuele eindtijd is opgeslagen.");
    } catch (error) {
      setFeedback(error instanceof RaceControlConflictError ? "⚠️ Conflict: de actieve stint is gewijzigd — herlaad en probeer opnieuw." : `Stint beëindigen mislukt: ${(error as Error)?.message ?? String(error)}`);
    }
  };
  const replace = async () => {
    if (!currentRow || !replacement) return;
    try {
      await raceControlApply.mutateAsync({ teamId, delta: replaceDriverOp(currentRow, replacement) });
      setFeedback(`Coureur vervangen door ${driver(replacement)}.`);
    } catch (error) {
      setFeedback(error instanceof RaceControlConflictError ? "⚠️ Conflict: de actieve stint is gewijzigd — herlaad en probeer opnieuw." : `Coureur vervangen mislukt: ${(error as Error)?.message ?? String(error)}`);
    }
  };

  if (!teams.length) return <div className="space-y-5"><Panel><p className="text-sm text-gray-400">Race Control wordt beschikbaar zodra je aan een auto bent gekoppeld.</p></Panel><SimHubTelemetryPanel eventId={event.id} teamId={teamId} plannedDriverId={undefined} /></div>;
  return <div className="space-y-5"><Panel className="overflow-hidden"><SectionHeading eyebrow="Live handmatige besturing" title="Race Control" description="Geen telemetrie nodig: corrigeer de actuele planning terwijl de oorspronkelijke planning intact blijft. Iedere correctie komt in het append-only auditlog." action={<StatusPill tone={event.status === "live" ? "red" : "orange"}>{event.status === "live" ? "Race live" : "Oefenmodus"}</StatusPill>} />
    <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Field label="Team"><select className={inputClass} value={teamId} onChange={(e) => setTeamId(e.target.value)}>{teams.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name} #{candidate.car_number}</option>)}</select></Field><Field label="Actuele racetijd (Nederland)"><input type="datetime-local" className={inputClass} value={currentAt} onChange={(e) => setCurrentAt(e.target.value)} /></Field><div className="rounded-xl bg-black/20 p-3"><span className="text-xs text-gray-500">Verschil met origineel</span><strong className={`mt-1 block text-2xl ${deltaMinutes ? "text-orange-300" : "text-emerald-300"}`}>{deltaMinutes > 0 ? "+" : ""}{deltaMinutes} min</strong></div><div className="rounded-xl bg-black/20 p-3"><span className="text-xs text-gray-500">Resterende racetijd</span><strong className="mt-1 block text-2xl text-white">{Math.max(0, Math.ceil((new Date(event.endAt).getTime() - new Date(nowIso).getTime()) / 3_600_000))} uur</strong></div></div>
    <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
      <div className="rounded-2xl bg-gradient-to-br from-orange-500/15 to-black/30 p-5 ring-1 ring-orange-500/25"><p className="text-[11px] font-black uppercase tracking-[0.2em] text-orange-300">Nu in der auto</p><h3 className="mt-2 font-heading text-3xl font-black text-white">{driver(current?.driverId)}</h3>{current ? <><p className="mt-2 text-sm text-gray-300">Actueel: {formatAmsterdam(current.actualStartAt)} – {formatAmsterdam(current.actualEndAt)}</p><p className="mt-1 text-xs text-gray-500">Origineel: {formatAmsterdam(current.originalStartAt)} – {formatAmsterdam(current.originalEndAt)}</p><div className="mt-5 flex flex-wrap gap-2">{editable && <><PrimaryButton onClick={() => void complete()} disabled={raceControlApply.isPending}><Flag className="h-4 w-4" /> Stint beëindigen</PrimaryButton><SecondaryButton onClick={() => void delay(5)} disabled={raceControlApply.isPending}><FastForward className="h-4 w-4" /> +5 min</SecondaryButton><SecondaryButton onClick={() => void delay(10)} disabled={raceControlApply.isPending}>+10 min</SecondaryButton></>}</div></> : <p className="mt-3 text-sm text-gray-400">Geen stint op dit tijdstip.</p>}</div>
      <div className="rounded-2xl bg-black/20 p-5 ring-1 ring-white/5"><h3 className="font-heading text-lg font-black text-white">Hierna</h3><div className="mt-3 space-y-3">{upcoming.map((stint, index) => <div key={stint.id} className="flex items-center justify-between rounded-xl bg-white/[0.035] p-3"><div><span className="text-[10px] uppercase tracking-wider text-gray-500">{index === 0 ? "Volgende" : `Daarna ${index}`}</span><strong className="block text-sm text-gray-200">{driver(stint.driverId)}</strong></div><span className="text-xs text-gray-500">{formatAmsterdam(stint.actualStartAt)}</span></div>)}</div></div>
    </div>
  </Panel>
  <SimHubTelemetryPanel eventId={event.id} teamId={teamId} plannedDriverId={current?.driverId} />
  {editable && <Panel><SectionHeading title="Handmatige correcties" description="Een positieve minutencorrectie vertraagt; een negatieve vervroegt. Repairtijd voegt seconden aan de actieve stint toe. Iedere write is optimistic en komt in het auditlog." /><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><Field label="Aangepaste vertraging (minuten)"><div className="flex gap-2"><input type="number" min={-60} max={180} className={inputClass} value={customDelay} onChange={(e) => setCustomDelay(Number(e.target.value))} /><SecondaryButton onClick={() => void delay(customDelay)} disabled={raceControlApply.isPending}><Clock3 className="h-4 w-4" /> Toepassen</SecondaryButton></div></Field><Field label="Extra repairtijd (seconden)"><div className="flex gap-2"><input type="number" min={1} max={1800} className={inputClass} value={repairSeconds} onChange={(e) => setRepairSeconds(Number(e.target.value))} /><SecondaryButton onClick={() => void repair(repairSeconds)} disabled={!currentRow || raceControlApply.isPending}><Wrench className="h-4 w-4" /> Toevoegen</SecondaryButton></div></Field><Field label="Coureur vervangen"><div className="flex gap-2"><select className={inputClass} value={replacement} onChange={(e) => setReplacement(e.target.value)}><option value="">Selecteer</option>{teamDrivers.map((m) => <option key={m.user_id} value={m.user_id}>{displayName(m.user_id)}</option>)}</select><SecondaryButton onClick={() => void replace()} disabled={!replacement || raceControlApply.isPending}>Vervangen</SecondaryButton></div></Field></div>
    {feedback && <p role="status" className={`mt-4 flex items-center gap-2 text-sm ${feedback.startsWith("⚠️") ? "text-red-300" : "text-orange-200"}`}><AlertTriangle className="h-4 w-4" />{feedback}</p>}
    {auditRows.length > 0 && <div className="mt-4"><h4 className="text-xs font-black uppercase tracking-wider text-gray-500">Auditlog (append-only)</h4><ul className="mt-2 space-y-1.5">{auditRows.slice(0, 5).map((entry) => <li key={entry.id} className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-1.5"><span className="text-xs text-gray-300">{auditLabel(entry)} → {entry.after_status}</span><span className="text-[11px] text-gray-500">{formatAmsterdam(entry.created_at)}</span></li>)}</ul></div>}
  </Panel>}
  </div>;
};