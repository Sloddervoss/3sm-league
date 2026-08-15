import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, History, Play, WandSparkles } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useEnduranceActor } from "../core/ActorContext";
import { useEnduranceTeamWorkspace } from "../repository/teamsRepository";
import { useEnduranceRegistrations } from "../repository/registrationsRepository";
import { useEnduranceStints, useEnduranceStintMutations } from "../repository/stintsRepository";
import { useEndurancePlanWorkspace, useEndurancePlanMutations } from "../repository/planRepository";
import { enduranceStintRowsToAppModels } from "../repository/mappers";
import { planningWarnings } from "../core/selectors";
import type { EnduranceEvent, EnduranceRole, EnduranceStint } from "../core/types";
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
  const { user, isSuperAdmin } = useAuth();
  const { actorId, displayName } = useEnduranceActor();
  const { data: teamWorkspace } = useEnduranceTeamWorkspace(event.id);
  const { data: stintRows = [] } = useEnduranceStints(event.id);
  const { upsert, remove } = useEnduranceStintMutations(event.id);
  const { data: registrations = [] } = useEnduranceRegistrations(event.id);
  const stintsApp = useMemo(() => enduranceStintRowsToAppModels(stintRows), [stintRows]);

  // Per-coureur rijlimieten uit de inschrijvingen (comfort-modus gebruikt die).
  const driverLimits = useMemo(() => {
    const map: Record<string, { maxStintMinutes?: number | null; maxTotalMinutes?: number | null; maxConsecutiveStints?: number | null; minRestMinutes?: number | null; willingToStart?: boolean }> = {};
    for (const reg of registrations) {
      map[reg.user_id] = {
        maxStintMinutes: reg.max_stint_minutes,
        maxTotalMinutes: reg.max_total_minutes,
        maxConsecutiveStints: reg.max_consecutive_stints,
        minRestMinutes: reg.min_rest_minutes,
        willingToStart: reg.willing_to_start,
      };
    }
    return map;
  }, [registrations]);

  const teams = teamWorkspace?.teams ?? [];
  const members = teamWorkspace?.members ?? [];
  const accessibleTeams = teams.filter((team) => team.event_id === event.id && (isSuperAdmin || team.manager_id === user?.id || members.some((m) => m.team_id === team.id && m.user_id === user?.id)));

  const [teamId, setTeamId] = useState(accessibleTeams[0]?.id ?? "");
  const [tankMinutes, setTankMinutes] = useState(90);
  const [snap, setSnap] = useState(15);

  // Echte coureur-labels voor de tijdlijn: toon hun profielnaam (i.p.v. kale
  // user-id-nummers) via displayName uit de profiel-lookup.
  const personas = useMemo(
    () => members
      .filter((m) => m.team_id === teamId)
      .map((m) => ({ id: m.user_id, name: displayName(m.user_id), role: (m.role === "driver" ? "driver" : "reserve") as EnduranceRole, timezone: "Europe/Amsterdam" })),
    [members, teamId, displayName]
  );
  const [mode, setMode] = useState<StintMode>("race");
  const [message, setMessage] = useState("");

  // Eerste willingToStart-coureur voor deze auto (vanaf dit team).
  const firstStintDriver = useMemo(() => {
    const ids = new Set(members.filter((m) => m.team_id === teamId && m.role === "driver").map((m) => m.user_id));
    return registrations.find((reg) => ids.has(reg.user_id) && reg.willing_to_start)?.user_id ?? null;
  }, [registrations, members, teamId]);

  const team = accessibleTeams.find((candidate) => candidate.id === teamId);
  const stints = stintsApp.filter((stint) => stint.eventId === event.id && stint.teamId === teamId);
  const editable = Boolean(team && (isSuperAdmin || team.manager_id === user?.id));

  const { data: planWorkspace } = useEndurancePlanWorkspace(event.id, teamId);
  const { publish, confirm } = useEndurancePlanMutations(event.id, teamId);
  const versions = planWorkspace?.versions ?? [];
  const latest = versions[0] ?? null;
  const confirmation = latest && planWorkspace?.confirmations.find((c) => c.version_id === latest.id && c.user_id === actorId);

  const publishPlan = () => {
    if (!stints.length) { setMessage("Er zijn geen stints om te publiceren."); return; }
    const createdAt = new Date().toISOString();
    const users = [...new Set(stints.map((s) => s.driverId).filter(Boolean))];
    void publish.mutateAsync({
      label: `Versie ${versions.filter((v) => v.team_id === teamId).length + 1}`,
      created_by: user?.id ?? null,
      stints: stints,
      confirmations: users.map((userId) => ({ user_id: userId, status: "unseen" as const })),
    });
    setMessage("Planning gepubliceerd en bevestigingen aangevraagd.");
  };

  // Beperkte app-level state voor de (mock) planner-hulpfuncties: events/teams/
  // members/stints uit de databank; availability/personas nog leeg (volgt).
  const plannerState = {
    events: [event],
    teams: teams.map((t) => ({ id: t.id, eventId: t.event_id, name: t.name, carId: t.car_id ?? "", carNumber: t.car_number ?? "", managerId: t.manager_id ?? "", livery: t.livery ?? "" })),
    teamMembers: members.map((m) => ({ id: m.id, teamId: m.team_id, userId: m.user_id, role: m.role })),
    stints: stintsApp,
    availability: [],
    paceEntries: [],
  } as never;
  const warnings = planningWarnings(plannerState, event.id, teamId);

  // Vervang een voorstel volledig: verwijder eerst de bestaande DRAFT-stints van
  // dit team, daarna de nieuwe. Zo hoopt een her-aanklik van "Voorstel genereren"
  // / "Optimaal berekenen" geen stints op en overlappen coureurs nooit dubbel.
  // Bevestigde (confirmed/ready/etc.) stints worden nooit aangeraakt.
  const replaceDraftStints = async (next: EnduranceStint[]) => {
    const existingDrafts = stintRows.filter((s) => s.team_id === team?.id && s.status === "draft");
    for (const draft of existingDrafts) {
      await remove.mutateAsync(draft.id);
    }
    for (const stint of next) {
      await upsert.mutateAsync({
        event_id: event.id,
        team_id: team!.id,
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
      });
    }
  };

  const generate = async () => {
    if (!team) return;
    const next = generateStints(plannerState, event, team.id, tankMinutes, { mode, driverLimits, firstStintDriver });
    if (!next.length) { setMessage("Voeg eerst coureurs toe aan deze auto."); return; }
    try {
      await replaceDraftStints(next);
      setMessage("Nieuw automatisch voorstel gemaakt.");
    } catch {
      setMessage("Voorstel opslaan mislukt.");
    }
  };

  const optimize = async () => {
    if (!team) return;
    setMessage("Optimale planning berekenen...");
    try {
      const memberIds = members.filter((m) => m.team_id === team.id && m.role !== "reserve").map((m) => m.user_id);
      const result = await runOptimize(plannerState, event, memberIds, team.id, { tankMinutes, driverOpts: driverLimits, firstStintDriver }, optimizerFetcher);
      if (!result.ok) { setMessage(result.message); return; }
      try {
        await replaceDraftStints(result.stints);
        setMessage(result.message);
      } catch {
        setMessage("Optimalisatie opslaan mislukt.");
      }
    } catch (err) {
      setMessage(`Optimalisatie mislukt: ${(err as Error)?.message ?? String(err)}`);
    }
  };

  const move = (stint: EnduranceStint, startAt: string) => {
    const duration = new Date(stint.actualEndAt).getTime() - new Date(stint.actualStartAt).getTime();
    const endAt = new Date(new Date(startAt).getTime() + duration).toISOString();
    void upsert.mutateAsync({ id: stint.id, event_id: event.id, team_id: teamId, driver_id: stint.driverId, original_start_at: startAt, original_end_at: endAt, actual_start_at: startAt, actual_end_at: endAt, status: "draft" });
  };
  const resize = (stint: EnduranceStint, delta: number) => {
    const endAt = shift(stint.actualEndAt, delta);
    if (new Date(endAt).getTime() - new Date(stint.actualStartAt).getTime() < 5 * 60_000 || new Date(endAt) > new Date(event.endAt)) return;
    void upsert.mutateAsync({ id: stint.id, event_id: event.id, team_id: teamId, driver_id: stint.driverId, original_start_at: stint.originalStartAt, original_end_at: endAt, actual_start_at: stint.actualStartAt, actual_end_at: endAt, status: "draft" });
  };
  const copy = (stint: EnduranceStint) => {
    const duration = (new Date(stint.actualEndAt).getTime() - new Date(stint.actualStartAt).getTime()) / 60_000;
    const startAt = stint.actualEndAt;
    const endAt = shift(startAt, duration);
    if (new Date(endAt) > new Date(event.endAt)) { setMessage("Er is na deze stint niet genoeg ruimte voor een kopie."); return; }
    void upsert.mutateAsync({ event_id: event.id, team_id: teamId, driver_id: stint.driverId, original_start_at: startAt, original_end_at: endAt, actual_start_at: startAt, actual_end_at: endAt, status: "draft", notes: `${stint.notes} · kopie` });
  };

  if (!accessibleTeams.length) return <Panel><SectionHeading title="Stintplanner" description="Je bent nog niet aan een auto gekoppeld. Een manager kan je via Team Builder indelen." /></Panel>;
  return <div className="space-y-5"><Panel><SectionHeading eyebrow="Centrale planning" title="Stintplanner" description="Sleep, vergroot, verklein en publiceer stints. Originele en actuele tijden blijven afzonderlijk bewaard." action={editable && <div className="flex gap-2"><PrimaryButton onClick={generate}><WandSparkles className="h-4 w-4" /> Voorstel genereren</PrimaryButton><PrimaryButton onClick={() => void optimize()}><WandSparkles className="h-4 w-4" /> Optimaal berekenen</PrimaryButton><SecondaryButton onClick={publishPlan} disabled={!stints.length}><Play className="h-4 w-4" /> Publiceren</SecondaryButton></div>} />
    <div className="mb-4 grid gap-3 sm:grid-cols-4"><Field label="Auto / team"><select className={inputClass} value={teamId} onChange={(e) => setTeamId(e.target.value)}>{accessibleTeams.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name} #{candidate.car_number}</option>)}</select></Field>{editable && <><Field label="Reeksmodus"><select className={inputClass} value={mode} onChange={(e) => setMode(e.target.value as StintMode)}><option value="race">Race (minimaliseren pitstops)</option><option value="comfort">Eer/comfort (respecteer rijlimieten)</option></select></Field><Field label="Tankduur"><select className={inputClass} value={tankMinutes} onChange={(e) => setTankMinutes(Number(e.target.value))}><option value={45}>45 minuten</option><option value={60}>60 minuten</option><option value={90}>90 minuten</option></select></Field><Field label="Snap"><select className={inputClass} value={snap} onChange={(e) => setSnap(Number(e.target.value))}><option value={5}>5 minuten</option><option value={10}>10 minuten</option><option value={15}>15 minuten</option></select></Field></>}</div>
    <StintTimeline event={event} stints={stints} personas={personas} availability={[]} editable={editable} snapMinutes={snap} onMove={move} onResize={resize} onDelete={(id) => void remove.mutateAsync(id)} onCopy={copy} />
    {message && <p role="status" className="mt-3 text-sm text-orange-200">{message}</p>}
  </Panel>
  <div className="grid gap-5 lg:grid-cols-2"><Panel><SectionHeading title="Waarschuwingen" description="Harde conflicten moeten vóór publicatie worden opgelost." />{warnings.length ? <div className="space-y-2">{warnings.map((warning) => <div key={warning.id} className={`flex gap-2 rounded-xl p-3 text-sm ring-1 ${warning.level === "hard" ? "bg-red-500/10 text-red-200 ring-red-500/20" : "bg-amber-500/10 text-amber-200 ring-amber-500/20"}`}><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{warning.message}</div>)}</div> : <div className="flex items-center gap-2 text-sm text-emerald-300"><CheckCircle2 className="h-4 w-4" /> Geen planningsconflicten.</div>}</Panel>
  <Panel><SectionHeading title="Versies & bevestiging" description="Iedere publicatie is herstelbaar. Coureurs bevestigen alleen de nieuwste versie." />{latest && <div className="mb-4 rounded-xl bg-black/20 p-3 text-sm"><div className="flex items-center justify-between"><strong className="text-white">{latest.label}</strong><StatusPill tone="green">{latest.published ? "Gepubliceerd" : "Concept"}</StatusPill></div>{confirmation && <div className="mt-3 flex flex-wrap items-center gap-2"><span className="text-gray-400">Jouw status: {confirmation.status}</span><PrimaryButton onClick={() => void confirm.mutateAsync({ versionId: latest.id, userId: actorId, status: "accepted" })} className="min-h-8 px-3 py-1 text-xs">Akkoord</PrimaryButton><SecondaryButton onClick={() => void confirm.mutateAsync({ versionId: latest.id, userId: actorId, status: "change_requested", note: "Neem contact op over mijn planning." })} className="min-h-8 px-3 py-1 text-xs">Wijziging vragen</SecondaryButton></div>}</div>}<div className="space-y-2">{versions.map((version) => <div key={version.id} className="flex items-center justify-between rounded-xl bg-white/[0.035] p-3 text-sm"><div><strong className="text-gray-200">{version.label}</strong><p className="text-xs text-gray-500">{new Date(version.created_at).toLocaleString("nl-NL")}</p></div></div>)}</div>{!versions.length && <p className="text-sm text-gray-500">Nog geen gepubliceerde versies. Voeg stints toe en publiceer.</p>}</Panel></div></div>;
};
