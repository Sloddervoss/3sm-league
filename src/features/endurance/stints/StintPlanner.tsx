import { stintEditPayload } from "./stintEdits";
import { validatePlan } from "./planValidation";
import { useEndurancePace } from "../repository/paceRepository";
import { useMemo, useState, useRef } from "react";
import { AlertTriangle, CheckCircle2, History, Play, WandSparkles } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useEnduranceActor } from "../core/ActorContext";
import { useEnduranceTeamWorkspace } from "../repository/teamsRepository";
import { useEnduranceRegistrations } from "../repository/registrationsRepository";
import { useEnduranceAvailability } from "../repository/availabilityRepository";
import { useEnduranceStints, useEnduranceStintMutations } from "../repository/stintsRepository";
import { useEndurancePlanWorkspace, useEndurancePlanMutations } from "../repository/planRepository";
import { enduranceStintRowsToAppModels } from "../repository/mappers";
import { planningWarnings } from "../core/selectors";
import type { AvailabilityType, EnduranceEvent, EnduranceRole, EnduranceStint, StintPlanningState } from "../core/types";
import { Field, inputClass, Panel, PrimaryButton, SecondaryButton, SectionHeading, StatusPill } from "../shared/ui";
import { generateStints, type StintMode } from "./stintGenerator";
import { runOptimize, type OptimizerFetcher } from "./jresOptimizer";
import { defaultOptimizerFetcher } from "../repository/optimizerRepository";
import { StintTimeline } from "./StintTimeline";

const shift = (iso: string, minutes: number) => new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();

/**
 * Stintplanner — Fase 3 (test-als).
 * Stints + planning-versies + bevestigingen via de DB-repositories. De
 * "coureur" in bevestigingen is de geselecteerde actor; beheer (genereren/
 * publiceren) is voor de super-admin-manager.
 */
export const StintPlanner = ({ event, optimizerFetcher = defaultOptimizerFetcher }: { event: EnduranceEvent; optimizerFetcher?: OptimizerFetcher }) => {
  const { user, isSuperAdmin, isEnduranceManager } = useAuth();
  const { actorId, displayName } = useEnduranceActor();
  const { data: teamWorkspace, isLoading: teamsLoading, error: teamsError } = useEnduranceTeamWorkspace(event.id);
  const { data: stintRows = [], isLoading: stintsLoading, error: stintsError } = useEnduranceStints(event.id);
  const { data: paceRows = [] } = useEndurancePace(event.id);
  const { upsert, remove, replaceDraft } = useEnduranceStintMutations(event.id);
  const { data: registrations = [], isLoading: registrationsLoading, error: registrationsError } = useEnduranceRegistrations(event.id);
  const { data: availabilityRows = [], isLoading: availabilityLoading, error: availabilityError } = useEnduranceAvailability(event.id);
  const stintsApp = useMemo(() => enduranceStintRowsToAppModels(stintRows), [stintRows]);

  // Per-coureur rijlimieten uit de inschrijvingen (comfort-modus gebruikt die).
  const driverLimits = useMemo(() => {
    const map: Record<string, { maxStints?: number | null; maxStintMinutes?: number | null; maxTotalMinutes?: number | null; maxConsecutiveStints?: number | null; minRestMinutes?: number | null; willingToStart?: boolean }> = {};
    for (const reg of registrations) {
      map[reg.user_id] = {
        maxStints: reg.max_stints,
        maxStintMinutes: reg.max_stint_minutes,
        maxTotalMinutes: reg.max_total_minutes,
        maxConsecutiveStints: reg.max_consecutive_stints,
        minRestMinutes: reg.min_rest_minutes,
        willingToStart: reg.willing_to_start,
      };
    }
    return map;
  }, [registrations]);

  // Manager-override "max stints achter elkaar" per coureur. De manager kan in de
  // planner per rijder bepalen dat hij/zij 1, 2 of 3 stints achter elkaar rijdt
  // (double/triple stint), los van de coureur-inschrijving. Dit overschrijft de
  // maxConsecutiveStints van de registratie vóór genereren/berekenen.
  const [consecutiveOverride, setConsecutiveOverride] = useState<Record<string, number>>({});
  const overrideLimits = useMemo(() => {
    if (!Object.keys(consecutiveOverride).length) return driverLimits;
    const merged: Record<string, { maxStints?: number | null; maxStintMinutes?: number | null; maxTotalMinutes?: number | null; maxConsecutiveStints?: number | null; minRestMinutes?: number | null; willingToStart?: boolean }> = { ...driverLimits };
    for (const [userId, maxConsecutive] of Object.entries(consecutiveOverride)) {
      merged[userId] = { ...(merged[userId] ?? {}), maxConsecutiveStints: Math.min(maxConsecutive, driverLimits[userId]?.maxConsecutiveStints ?? maxConsecutive) };
    }
    return merged;
  }, [driverLimits, consecutiveOverride]);

  const teams = teamWorkspace?.teams ?? [];
  const members = useMemo(() => teamWorkspace?.members ?? [], [teamWorkspace?.members]);
  const accessibleTeams = teams.filter((team) => team.event_id === event.id && (isSuperAdmin || isEnduranceManager || event.managerIds?.includes(user?.id ?? "") || team.manager_id === user?.id || members.some((m) => m.team_id === team.id && m.user_id === user?.id)));

  const [selectedTeamId, setTeamId] = useState("");
  const teamId = accessibleTeams.some(t => t.id === selectedTeamId) ? selectedTeamId : accessibleTeams[0]?.id ?? "";
  const [tankMinutes, setTankMinutes] = useState(90);
  const [snap, setSnap] = useState(15);

  // Echte coureur-labels voor de tijdlijn: toon hun profielnaam (i.p.v. kale
  // user-id-nummers) via displayName uit de profiel-lookup.
  const personas = useMemo(
    () => members
      .filter((m) => m.team_id === teamId)
      .map((m) => ({ id: m.user_id, name: displayName(m.user_id), role: (m.role !== "reserve" ? "driver" : "reserve") as EnduranceRole, timezone: "Europe/Amsterdam" })),
    [members, teamId, displayName]
  );
  const mode: StintMode = "comfort";
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const actionLock = useRef(false);
  const perform = async (action: () => Promise<unknown>, success: string) => {
    if (actionLock.current) return;
    actionLock.current = true; setBusy(true); setMessage("Bezig met opslaan…");
    try { await action(); setMessage(success); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Opslaan mislukt. Probeer opnieuw."); }
    finally { actionLock.current = false; setBusy(false); }
  };

  // Eerste willingToStart-coureur voor deze auto (vanaf dit team).
  const firstStintDriver = useMemo(() => {
    const ids = new Set(members.filter((m) => m.team_id === teamId && m.role !== "reserve").map((m) => m.user_id));
    return registrations.find((reg) => ids.has(reg.user_id) && reg.willing_to_start)?.user_id ?? null;
  }, [registrations, members, teamId]);

  const team = accessibleTeams.find((candidate) => candidate.id === teamId);
  const stints = stintsApp.filter((stint) => stint.eventId === event.id && stint.teamId === teamId);
  const canManage = Boolean(team && (isSuperAdmin || isEnduranceManager || event.managerIds?.includes(user?.id ?? "") || team.manager_id === user?.id));
  const inputsLoading = teamsLoading || registrationsLoading || availabilityLoading || stintsLoading;
  const inputsError = teamsError || registrationsError || availabilityError || stintsError;
  const editable = canManage && !busy && !inputsLoading && !inputsError && stints.every(s => s.status === "draft");

  const { data: planWorkspace, isLoading: plansLoading, error: plansError } = useEndurancePlanWorkspace(event.id, teamId);
  const { publish, confirm } = useEndurancePlanMutations(event.id, teamId);
  const versions = planWorkspace?.versions ?? [];
  const latest = versions.find(v => v.published) ?? null;
  const confirmation = latest && planWorkspace?.confirmations.find((c) => c.version_id === latest.id && c.user_id === actorId);

  const publishPlan = () => {
    if (!editable || plansLoading || plansError || !stints.length) return;
    const errors = validatePlan(plannerState, event, stints, members.filter(m => m.team_id === teamId && m.role !== "reserve" && (!canManage || registrations.some(r => r.user_id===m.user_id && ["provisional","confirmed"].includes(r.status)))).map(m => m.user_id), overrideLimits, tankMinutes);
    if (errors.length) { setMessage(errors.join(" ")); return; }
    const users = [...new Set(stints.map(s => s.driverId))];
    void perform(() => publish.mutateAsync({ label: `Versie ${versions.length + 1}`, created_by: user?.id ?? null, stints,
      confirmations: users.map(user_id => ({ user_id, status: "unseen" as const })) }), "Planning gepubliceerd en bevestigingen aangevraagd.");
  };

  // Echte beschikbaarheid uit de DB voor deze auto's event, omgezet naar het
  // app-model. Zo respecteren BÉIDE planningsknoppen de door coureurs opgegeven
  // tijden: 'leeg invullen = altijd beschikbaar' wordt per coureur afgehandeld
  // in de generator en de optimizer.
  const availability = useMemo(
    () =>
      availabilityRows.map((row) => ({
        id: row.id,
        eventId: event.id,
        userId: row.user_id,
        startAt: row.start_at,
        endAt: row.end_at,
        type: row.type as AvailabilityType,
        note: row.note ?? "",
      })),
    [availabilityRows, event.id]
  );

  // Beperkte planner-state-slice voor de puur-functies (generator, waarschuwingen,
  // optimizer): uitsluitend de velden die die functies consumeren, netjes getypeerd
  // via StintPlanningState — géén `as never`-escape.
  const plannerState: StintPlanningState = {
    events: [event],
    availability,
    teamMembers: members.map((m) => ({ teamId: m.team_id, userId: m.user_id, role: m.role, id: m.id })),
    stints: stintsApp,
    paceEntries: paceRows.map(p => ({ id: p.id, eventId: event.id, userId: p.user_id, circuit: p.circuit, configuration: p.configuration, car: p.car, conditions: p.conditions as "dry" | "wet", averageLapSeconds: p.average_lap_seconds ?? 0, medianLapSeconds: p.median_lap_seconds ?? 0, bestLapSeconds: p.best_lap_seconds ?? 0, bestFiveAverageSeconds: p.best_five_average_seconds ?? 0, consistencySeconds: p.consistency_seconds ?? 0, validLaps: p.valid_laps ?? 0, incidents: p.incidents ?? 0, averageStintMinutes: p.average_stint_minutes ?? 0, recordedAt: p.recorded_at, source: p.source as "manual" | "practice", notes: p.notes ?? "" })),
  };
  const warnings = planningWarnings(plannerState, event.id, teamId);
  const validationErrors = validatePlan(plannerState, event, stints, members.filter(m => m.team_id === teamId && m.role !== "reserve" && (!canManage || registrations.some(r => r.user_id===m.user_id && ["provisional","confirmed"].includes(r.status)))).map(m => m.user_id), overrideLimits, tankMinutes);

  if (stints.some(s => !availability.some(a => a.userId===s.driverId))) validationErrors.push("Laat iedere geplande coureur eerst beschikbaarheid invullen.");

  // Vervang het volledige conceptvoorstel in één database-transactie. Bevestigde
  // stints worden door de RPC geweigerd en blijven onaangeraakt.
  const replaceDraftStints = async (next: EnduranceStint[]) => {
    if (!team || !editable) throw new Error("Deze planning kan nu niet worden bewerkt.");
    const errors = validatePlan(plannerState, event, next, members.filter(m => m.team_id === teamId && m.role !== "reserve" && (!canManage || registrations.some(r => r.user_id===m.user_id && ["provisional","confirmed"].includes(r.status)))).map(m => m.user_id), overrideLimits, tankMinutes);
    if (errors.length) throw new Error(errors.join(" "));
    await replaceDraft.mutateAsync({
      teamId: team.id,
      stints: next.map((stint) => ({
        event_id: event.id,
        team_id: team.id,
        driver_id: stint.driverId || null,
        original_start_at: stint.originalStartAt,
        original_end_at: stint.originalEndAt,
        actual_start_at: stint.actualStartAt,
        actual_end_at: stint.actualEndAt,
        expected_laps: stint.expectedLaps || null,
        fuel_litres: stint.fuelLitres || null,
        tyre_change: stint.tyreChange,
        double_stint: stint.doubleStint,
        notes: stint.notes || null,
        status: "draft",
      })),
    });
  };

  const generate = () => {
    if (!team || !editable) return;
    void perform(async () => {
      const next = generateStints(plannerState, event, team.id, tankMinutes, { mode, driverLimits: overrideLimits, firstStintDriver });
      if (!next.length) throw new Error("Voeg eerst coureurs toe aan deze auto.");
      await replaceDraftStints(next);
    }, "Nieuw automatisch voorstel opgeslagen.");
  };

  const optimize = () => {
    if (!team || !editable) return;
    void perform(async () => {
      const memberIds = members.filter(m => m.team_id === team.id && m.role !== "reserve").map(m => m.user_id);
      const result = await runOptimize(plannerState, event, memberIds, team.id, { tankMinutes, driverOpts: overrideLimits, firstStintDriver }, optimizerFetcher);
      if (!result.ok) throw new Error(result.message);
      const enriched = result.stints.map(s => {
        const pace = plannerState.paceEntries.find(p => p.userId === s.driverId)?.averageLapSeconds ?? 0;
        return { ...s, expectedLaps: pace > 0 ? Math.floor((Date.parse(s.actualEndAt)-Date.parse(s.actualStartAt))/1000/pace) : 0 };
      });
      await replaceDraftStints(enriched);
    }, "Berekend voorstel opgeslagen. Controleer de verdeling voor publicatie.");
  };

  const editStint = (stint: EnduranceStint, changes: Parameters<typeof stintEditPayload>[1]) => {
    if (!editable || stint.status !== "draft") return;
    const row = stintRows.find(r => r.id === stint.id && r.team_id === teamId);
    if (!row) return;
    const payload = stintEditPayload(row, changes);
    const startAt = payload.actual_start_at ?? payload.original_start_at, endAt = payload.actual_end_at ?? payload.original_end_at;
    const start = Date.parse(startAt), end = Date.parse(endAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || start < Date.parse(event.startAt) || end > Date.parse(event.endAt)) { setMessage("De stint moet volledig binnen de race vallen en een positieve duur hebben."); return; }
    if (overlapsExisting(startAt, endAt, stint.id)) { setMessage("Deze wijziging overlapt een andere stint van de auto."); return; }
    void perform(() => upsert.mutateAsync(payload), "Stint opgeslagen.");
  };
  const assign = (stint: EnduranceStint, driverId: string) => editStint(stint, { driver_id: driverId });
  const move = (stint: EnduranceStint, startAt: string, driverId = stint.driverId) => {
    const duration = Date.parse(stint.actualEndAt) - Date.parse(stint.actualStartAt);
    editStint(stint, { driver_id: driverId, actual_start_at: startAt, actual_end_at: new Date(Date.parse(startAt)+duration).toISOString() });
  };
  const resize = (stint: EnduranceStint, delta: number) => {
    const endAt = shift(stint.actualEndAt, delta);
    if (Date.parse(endAt) - Date.parse(stint.actualStartAt) < 5*60000) { setMessage("Een stint duurt minimaal 5 minuten."); return; }
    editStint(stint, { actual_end_at: endAt });
  };
  const resizeEdge = (stint: EnduranceStint, startAt: string, endAt: string) => {
    if (Date.parse(endAt)-Date.parse(startAt) < 5*60000) return;
    editStint(stint, { actual_start_at: startAt, actual_end_at: endAt });
  };

  // Overlap-check: mag dit [startAt,endAt]-venster op deze rij?", zonder botsing
  // met een andere stint (bevinding 3). Het uitgangspunt dat gekopieerd/verlengd
  // wordt telt niet mee.
  const overlapsExisting = (startAt: string, endAt: string, excludeId?: string): boolean =>
    stints.some(
      (other) =>
        other.id !== excludeId &&
        new Date(startAt).getTime() < new Date(other.actualEndAt).getTime() &&
        new Date(endAt).getTime() > new Date(other.actualStartAt).getTime()
    );

  const copy = (stint: EnduranceStint) => {
    if (!editable) return;
    const duration = (new Date(stint.actualEndAt).getTime() - new Date(stint.actualStartAt).getTime()) / 60_000;
    const startAt = stint.actualEndAt;
    const endAt = shift(startAt, duration);
    if (new Date(endAt) > new Date(event.endAt)) { setMessage("Er is na deze stint niet genoeg ruimte voor een kopie."); return; }
    if (overlapsExisting(startAt, endAt)) { setMessage("De kopie overlap een andere stint. Maak eerst ruimte vrij."); return; }
    void perform(() => upsert.mutateAsync({ event_id: event.id, team_id: teamId, driver_id: stint.driverId, original_start_at: startAt, original_end_at: endAt, actual_start_at: startAt, actual_end_at: endAt, status: "draft", notes: `${stint.notes} · kopie`, expected_laps: stint.expectedLaps || null, fuel_litres: stint.fuelLitres || null, tyre_change: stint.tyreChange, double_stint: stint.doubleStint }), "Stint gekopieerd.");
  };

  // Verlengen: dezelfde coureur nog een volle stint (tankduur) direct na de
  // huidige, zodat de manager een double/triple stint met één klik kan toevoegen
  // zonder opnieuw te genereren.
  const extend = (stint: EnduranceStint) => {
    if (!editable) return;
    const startAt = stint.actualEndAt;
    const endAt = shift(startAt, tankMinutes);
    if (new Date(endAt) > new Date(event.endAt)) { setMessage("Er is na deze stint niet genoeg ruimte voor een extra stint."); return; }
    if (overlapsExisting(startAt, endAt)) { setMessage("Verlengen overlap een andere stint. Maak eerst ruimte vrij."); return; }
    void perform(() => upsert.mutateAsync({ event_id: event.id, team_id: teamId, driver_id: stint.driverId, original_start_at: startAt, original_end_at: endAt, actual_start_at: startAt, actual_end_at: endAt, status: "draft", notes: "Verlengd (zelfde coureur)", double_stint: true }), "Extra stint toegevoegd.");
  };

  if (teamsLoading) return <Panel><p role="status" className="text-sm text-gray-400">Teams laden…</p></Panel>;
  if (teamsError) return <Panel><p role="alert" className="text-sm text-red-300">Teams laden mislukt. Vernieuw de pagina.</p></Panel>;
  if (!accessibleTeams.length) return <Panel><SectionHeading title="Stintplanner" description="Je bent nog niet aan een auto gekoppeld. Een manager kan je via Team Builder indelen." /></Panel>;
  return <div className="space-y-5"><Panel><SectionHeading eyebrow="Centrale planning" title="Stintplanner" description="Sleep, vergroot, verklein en publiceer stints. Originele en actuele tijden blijven afzonderlijk bewaard." action={canManage && <div className="flex flex-wrap gap-2"><PrimaryButton onClick={generate} disabled={!editable}><WandSparkles className="h-4 w-4" /> Voorstel genereren</PrimaryButton><PrimaryButton onClick={() => void optimize()} disabled={!editable}><WandSparkles className="h-4 w-4" /> Optimaal berekenen</PrimaryButton><SecondaryButton onClick={publishPlan} disabled={!editable || plansLoading || Boolean(plansError) || validationErrors.length > 0}><Play className="h-4 w-4" /> Publiceren</SecondaryButton></div>} />
    <div className="mb-4 grid gap-3 sm:grid-cols-3"><Field label="Auto / team"><select className={inputClass} value={teamId} disabled={busy} onChange={(e) => { setTeamId(e.target.value); setMessage(""); }}>{accessibleTeams.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name} #{candidate.car_number}</option>)}</select></Field>{editable && <><Field label="Tankduur"><select className={inputClass} value={tankMinutes} onChange={(e) => setTankMinutes(Number(e.target.value))}><option value={45}>45 minuten</option><option value={60}>60 minuten</option><option value={90}>90 minuten</option></select></Field><Field label="Tijdstap"><select className={inputClass} value={snap} onChange={(e) => setSnap(Number(e.target.value))}><option value={5}>5 minuten</option><option value={10}>10 minuten</option><option value={15}>15 minuten</option></select></Field></>}</div>
    {editable && <div className="mb-4 rounded-2xl bg-black/20 p-4 ring-1 ring-white/5"><Field label="Stints achter elkaar per coureur"><div className="flex flex-wrap gap-2">{personas.map((persona) => <label key={persona.id} className="flex items-center gap-2 rounded-xl bg-white/[0.045] px-3 py-2 text-sm text-gray-200 ring-1 ring-white/10"><span className="font-bold">{persona.name}</span><select className={`${inputClass} max-w-20`} value={consecutiveOverride[persona.id] ?? registrations.find((r) => r.user_id === persona.id)?.max_consecutive_stints ?? 1} onChange={(e) => setConsecutiveOverride((prev) => ({ ...prev, [persona.id]: Number(e.target.value) }))}><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option></select></label>)}</div><p className="mt-2 text-xs text-gray-500">De planner houdt een coureur vast tot dit aantal stints achter elkaar. Wijzigt alleen het voorstel, niet de inschrijving.</p></Field></div>}
    {inputsLoading && <p role="status" className="mb-4 text-sm text-gray-400">Planning laden…</p>}
    {inputsError && <p role="alert" className="mb-4 text-sm text-red-300">Planning of coureursgegevens laden mislukt. Vernieuw de pagina.</p>}
    {canManage && stints.some(s => s.status !== "draft") && <p className="mb-4 rounded-xl bg-orange-500/10 p-3 text-sm text-orange-200">Deze planning bevat actieve of bevestigde stints. Gebruik Pitwall → Race Control voor correcties.</p>}
    {validationErrors.length > 0 && stints.length > 0 && <div role="status" className="mb-4 rounded-xl bg-red-500/10 p-3 text-sm text-red-200"><strong>Publiceren kan na het oplossen van:</strong><ul className="mt-2 list-disc pl-5">{validationErrors.map(error => <li key={error}>{error}</li>)}</ul></div>}
    {team?.plan_needs_review && <p role="status" className="mb-4 rounded-xl bg-amber-500/10 p-4 text-sm text-amber-200">Teamindeling of rijafspraken zijn gewijzigd. Controleer de stints en publiceer een nieuwe versie; eerdere bevestigingen horen bij de oude planning.</p>}
    <StintTimeline key={`${event.id}:${teamId}`} event={event} stints={stints} personas={personas} availability={availability} editable={editable} snapMinutes={snap} onMove={move} onResize={resize} onResizeEdge={resizeEdge} onDelete={(id) => { if (editable) void perform(() => remove.mutateAsync(id), "Stint verwijderd."); }} onCopy={copy} onExtend={extend} onAssign={assign} />
    {message && <p role="status" className="mt-3 text-sm text-orange-200">{message}</p>}
  </Panel>
  <div className="grid gap-5 lg:grid-cols-2"><Panel><SectionHeading title="Waarschuwingen" description="Harde conflicten moeten vóór publicatie worden opgelost." />{warnings.length ? <div className="space-y-2">{warnings.map((warning) => <div key={warning.id} className={`flex gap-2 rounded-xl p-3 text-sm ring-1 ${warning.level === "hard" ? "bg-red-500/10 text-red-200 ring-red-500/20" : "bg-amber-500/10 text-amber-200 ring-amber-500/20"}`}><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{warning.message}</div>)}</div> : stints.length && !validationErrors.length ? <div className="flex items-center gap-2 text-sm text-emerald-300"><CheckCircle2 className="h-4 w-4" /> Geen planningsconflicten.</div> : <p className="text-sm text-gray-400">{stints.length ? "Los de aangegeven rijlimieten op voordat je publiceert." : "Nog geen planning. Racedekking is nog niet gecontroleerd."}</p>}</Panel>
  <Panel><SectionHeading title="Versies & bevestiging" description="Coureurs bevestigen de laatst gepubliceerde versie. Eerdere versies blijven bewaard." />{plansError && <p role="alert" className="mb-3 text-sm text-red-300">Gepubliceerde versies laden mislukt. Vernieuw de pagina.</p>}{latest && <div className="mb-4 rounded-xl bg-black/20 p-3 text-sm"><div className="flex items-center justify-between"><strong className="text-white">{latest.label}</strong><StatusPill tone="green">{latest.published ? "Gepubliceerd" : "Concept"}</StatusPill></div>{confirmation && <div className="mt-3 flex flex-wrap items-center gap-2"><span className="text-gray-400">Jouw status: {confirmation.status}</span><PrimaryButton disabled={busy || team?.plan_needs_review} onClick={() => void perform(() => confirm.mutateAsync({ versionId: latest.id, userId: actorId, status: "accepted" }), "Je hebt de planning bevestigd.")} className="min-h-8 px-3 py-1 text-xs">Akkoord</PrimaryButton><SecondaryButton disabled={busy} onClick={() => void perform(() => confirm.mutateAsync({ versionId: latest.id, userId: actorId, status: "change_requested", note: "Neem contact op over mijn planning." }), "Je wijzigingsverzoek is opgeslagen.")} className="min-h-8 px-3 py-1 text-xs">Wijziging vragen</SecondaryButton></div>}</div>}<div className="space-y-2">{versions.map((version) => <div key={version.id} className="flex items-center justify-between rounded-xl bg-white/[0.035] p-3 text-sm"><div><strong className="text-gray-200">{version.label}</strong><p className="text-xs text-gray-500">{new Date(version.created_at).toLocaleString("nl-NL")}</p></div></div>)}</div>{!versions.length && <p className="text-sm text-gray-500">Nog geen gepubliceerde versies. Voeg stints toe en publiceer.</p>}</Panel></div></div>;
};
