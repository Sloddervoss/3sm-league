import { useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, Check, Flag, Gauge, Plus, Settings2, Sparkles, Users, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { TeamWorkflowSnapshot, TeamAction } from "../repository/teamWorkflowRepository";
import { formatLapTime } from "../core/selectors";
import type { EnduranceEvent } from "../core/types";
import { Field, inputClass, Panel, PrimaryButton, SecondaryButton, SectionHeading, StatusPill } from "../shared/ui";
import { getEnduranceCar } from "../core/carCatalog";
import { approachLabels, assessTeam, comparablePace, proposeTeams, type TeamApproach, type TeamDraft } from "./teamProposal";

export function TeamBuilderView({ event, snapshot, displayName, managerId, onApply, onManage }: {
  event: EnduranceEvent; snapshot: TeamWorkflowSnapshot; displayName: (id: string) => string; managerId: string;
  onApply: (teams: TeamDraft[], revision: string) => Promise<unknown>; onManage: (action: TeamAction, revision: string) => Promise<unknown>;
}) {
  const { teams, members, registrations, pace: paceRows, availability: availabilityRows } = snapshot.data;
  const [editingRoster, setEditingRoster] = useState<string | null>(null);
  const [conditions, setConditions] = useState("dry");
  const [size, setSize] = useState(Math.min(4,event.maxDriversPerCar));
  const [preview, setPreview] = useState<{ teams: TeamDraft[]; revision: string } | null>(null);
  const [settings, setSettings] = useState<TeamAction & { kind: "settings" } | null>(null);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const frozen = ["live", "completed"].includes(event.status);
  const pace = useMemo(() => comparablePace(event, paceRows, conditions), [event, paceRows, conditions]);
  const availability = useMemo(() => availabilityRows.map(a => ({ id:a.id,eventId:a.event_id,userId:a.user_id,startAt:a.start_at,endAt:a.end_at,type:a.type,note:a.note ?? "" })), [availabilityRows]);
  const assigned = new Set(members.map(m => m.user_id));
  const candidates = registrations.filter(r => ["provisional","confirmed"].includes(r.status));
  const unassigned = candidates.filter(r => !assigned.has(r.user_id));
  const remaining = preview ? unassigned.filter(r => !preview.teams.some(t => t.userIds.includes(r.user_id))) : unassigned;
  const stale = preview && preview.revision !== snapshot.revision;
  const run = async (action: () => Promise<unknown>, success: string) => {
    if (lock.current) return;
    lock.current=true;setBusy(true);setMessage("");setFailed(false);
    try { await action();setMessage(success);setPreview(null);setSettings(null); }
    catch(e) { setFailed(true);setMessage(e instanceof Error ? e.message : "Opslaan mislukt. Probeer opnieuw."); }
    finally {lock.current=false;setBusy(false);}
  };
  const move = (id: string, destination: string) => void run(() => onManage({kind:"move",user_id:id,team_id:destination || null},snapshot.revision),"Teamindeling opgeslagen. Controleer de betrokken stintplanningen opnieuw.");
  const proposal = () => {
    const result = proposeTeams(event, registrations, pace, assigned, size, availability);
    setPreview({ teams:result.teams.map((t,i) => ({...t,name:`Team ${teams.length+i+1}`})),revision:snapshot.revision });setMessage("");
  };
  const updateDraft = (index:number, change:Partial<TeamDraft>) => setPreview(p => p && ({...p,teams:p.teams.map((t,i) => i===index ? {...t,...change} : t)}));
  const previewMove = (id:string, destination:string) => setPreview(p => p && ({...p,teams:p.teams.map((t,i) => ({...t,userIds:[...t.userIds.filter(u => u!==id),...(String(i)===destination ? [id] : [])]}))}));
  const driver = (id:string, destination:string, draft=false, reserve=false) => <div key={id} className="rounded-xl bg-white/[0.035] p-3 ring-1 ring-white/[0.06]">
    <div className="flex items-center justify-between gap-3"><span className="truncate text-sm font-semibold text-gray-100">{displayName(id)}</span><span className={`shrink-0 text-xs tabular-nums ${pace.has(id) ? "text-orange-300" : "text-gray-400"}`}>{pace.has(id) ? formatLapTime(pace.get(id)!.seconds) : "Pace onbekend"}</span></div>
    {reserve && <p className="mt-1 text-xs text-gray-400">Reserve · telt niet als vaste coureur</p>}
    {!frozen && (destination === "" || editingRoster === (draft ? "preview" : destination)) && <select aria-label={`Team voor ${displayName(id)}`} className="mt-2 min-h-11 w-full rounded-lg border border-white/10 bg-black/25 px-2 text-xs text-gray-300 focus:outline-orange-400" value={destination} disabled={busy || (!draft && Boolean(preview))} onChange={e => draft ? previewMove(id,e.target.value) : move(id,e.target.value)}>
      <option value="">Nog in te delen</option>{draft ? preview?.teams.map((t,i) => <option key={i} value={i} disabled={t.userIds.length>=t.capacity && String(i)!==destination}>{t.name} · {t.userIds.length}/{t.capacity}</option>) : teams.map(t => <option key={t.id} value={t.id} disabled={members.filter(m => m.team_id===t.id && m.role!=="reserve").length >= (t.target_size ?? event.maxDriversPerCar) && t.id!==destination}>{t.name}</option>)}
    </select>}
  </div>;
  const health = (ids:string[]) => {
    const result = assessTeam(event,ids,registrations,availability);
    return <div className={`mt-4 rounded-xl p-3 text-xs leading-relaxed ${result.ready ? "bg-emerald-500/10 text-emerald-200" : "bg-amber-500/[0.07] text-amber-100"}`}>
      <p className="flex items-center gap-2 font-semibold">{result.ready ? <Check className="h-4 w-4"/> : <AlertTriangle className="h-4 w-4"/>}{result.ready ? "Stintvoorstel haalbaar bij tankduur 90 min" : "Nog aandacht nodig"}</p>
      {!!result.issues.length && <ul className="mt-2 space-y-1">{result.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
    </div>;
  };
  const spread = (ids:string[]) => { const values = ids.flatMap(id => pace.has(id) ? [pace.get(id)!.seconds] : []);return values.length>1 ? `${(Math.max(...values)-Math.min(...values)).toFixed(2)}s verschil` : "Pace nog vergelijken"; };
  return <div className="space-y-5">
    <Panel className="overflow-hidden border-t border-orange-400/30 bg-gradient-to-br from-orange-500/[0.08] via-card to-card">
      <SectionHeading eyebrow="Practice → teams → race" title="Samen op hetzelfde tempo" description="Groepeer vergelijkbare pace. Houd ruimte voor ieders rijtijd en beschikbaarheid." />
      <div className="grid grid-cols-3 gap-2 sm:gap-4">{[{label:"Deelnemers",value:candidates.length,icon:Users},{label:"Pace gereed",value:candidates.filter(r => pace.has(r.user_id)).length,icon:Gauge},{label:"Teams",value:teams.length,icon:Flag}].map(({label,value,icon:Icon}) => <div key={label} className="rounded-2xl bg-black/20 p-3 ring-1 ring-white/5 sm:p-4"><Icon className="mb-3 h-4 w-4 text-orange-400"/><p className="text-2xl font-black text-white sm:text-3xl">{value}</p><p className="mt-1 text-xs text-gray-400">{label}</p></div>)}</div>
      <p className="mt-4 text-xs leading-relaxed text-gray-400">{getEnduranceCar(event.selectedCarId)?.name ?? "Raceauto nog te bevestigen"} · Maximaal {event.maxDriversPerCar} coureurs per auto. De gewenste grootte kies je per team.</p>
    </Panel>
    {message && <p role={failed ? "alert" : "status"} className={`rounded-xl p-4 text-sm ${failed ? "bg-red-500/10 text-red-200" : "bg-emerald-500/10 text-emerald-200"}`}>{message}</p>}
    {frozen ? <Panel><p className="text-sm text-gray-300">De teamindeling is vergrendeld omdat deze race is gestart of afgerond.</p></Panel> : <Panel>
      <SectionHeading title="Een passende indeling" description="Minimaal 10 geldige ronden, dezelfde auto, baan en omstandigheden. Bestaande teams blijven staan. Persoonlijke voorkeuren krijgen voorrang." />
      <div className="grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto_auto]">
        <Field label="Standaard teamgrootte"><input type="number" className={inputClass} min={1} max={event.maxDriversPerCar} value={size} disabled={busy} onChange={e => {setSize(Number(e.target.value));setPreview(null);}}/></Field>
        <Field label="Vergelijk practice in"><select className={inputClass} value={conditions} disabled={busy} onChange={e => {setConditions(e.target.value);setPreview(null);}}><option value="dry">Droge omstandigheden</option><option value="wet">Natte omstandigheden</option></select></Field>
        <PrimaryButton className="min-h-11" disabled={busy || !event.selectedCarId || !unassigned.some(r => pace.has(r.user_id)) || !Number.isInteger(size) || size<1 || size>event.maxDriversPerCar} onClick={proposal}><Sparkles className="h-4 w-4"/>Teams voorstellen</PrimaryButton>
        <SecondaryButton className="min-h-11" disabled={busy || !event.selectedCarId} onClick={() => setPreview({revision:snapshot.revision,teams:[{name:`Team ${teams.length+1}`,capacity:Math.max(1,Math.min(event.maxDriversPerCar,size || 4)),approach:"either",userIds:[]}]})}><Plus className="h-4 w-4"/>Zelf team maken</SecondaryButton>
      </div>
      {!event.selectedCarId && <p className="mt-4 text-sm text-amber-200">Bevestig de raceauto in Overzicht om teams te kunnen maken en pace te vergelijken.</p>}
    </Panel>}
    {preview && <Panel className="ring-orange-400/40">
      <SectionHeading eyebrow="Voorstel · nog niet opgeslagen" title={`${preview.teams.length} nieuwe teams`} description="Pas namen, groottes en coureurs aan. Teams opslaan publiceert nog geen stintplanning." action={<SecondaryButton disabled={busy} onClick={() => setPreview(null)}><X className="h-4 w-4"/>Sluiten</SecondaryButton>}/>
      {stale && <p role="alert" className="mb-4 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-200">Gegevens zijn veranderd. Maak een nieuw voorstel voordat je opslaat.</p>}
      <SecondaryButton className="mb-4" disabled={busy} onClick={() => setEditingRoster(editingRoster === "preview" ? null : "preview")}>{editingRoster === "preview" ? "Verplaatsen sluiten" : "Coureurs verplaatsen"}</SecondaryButton>
      <div className="grid items-start gap-4 lg:grid-cols-2 xl:grid-cols-3">{preview.teams.map((t,i) => <article key={i} className="min-w-0 rounded-2xl bg-black/20 p-4 ring-1 ring-orange-500/15">
        <Field label={`Naam team ${i+1}`}><input className={inputClass} value={t.name} maxLength={100} disabled={busy} onChange={e => updateDraft(i,{name:e.target.value})}/></Field>
        <div className="mt-3 grid grid-cols-2 gap-3"><Field label="Coureurs per auto"><input className={inputClass} type="number" min={1} max={event.maxDriversPerCar} disabled={busy} value={t.capacity} onChange={e => updateDraft(i,{capacity:Number(e.target.value)})}/></Field><Field label="Aanpak"><select className={inputClass} value={t.approach} disabled={busy} onChange={e => updateDraft(i,{approach:e.target.value as TeamApproach})}>{Object.entries(approachLabels).map(([v,l]) => <option key={v} value={v}>{v==="either" ? "Gemengd" : l}</option>)}</select></Field></div>
        <p className="my-4 text-xs text-gray-400">{t.userIds.length}/{t.capacity} coureurs · {spread(t.userIds)}</p>
        <div className="space-y-2">{t.userIds.map(id => driver(id,String(i),true))}</div>{health(t.userIds)}
      </article>)}</div>
      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-gray-400">Onbekende pace blijft apart. Je kunt deze coureurs zelf indelen.</p><PrimaryButton className="min-h-11" disabled={busy || Boolean(stale) || !preview.teams.length || preview.teams.some(t => !t.name.trim() || !Number.isInteger(t.capacity) || t.capacity<1 || t.capacity>event.maxDriversPerCar || t.userIds.length>t.capacity)} onClick={() => void run(() => onApply(preview.teams,preview.revision),"Teams opgeslagen. Open Stintplanner om de planning per team te maken.")}><Check className="h-4 w-4"/>{busy ? "Opslaan…" : "Deze teams opslaan"}</PrimaryButton></div>
    </Panel>}
    <div className="grid items-start gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
      <Panel><SectionHeading title="Nog in te delen" description={`${remaining.length} deelnemers wachten op een team.`}/><div className="space-y-3">{remaining.map(r => <div key={r.id}>{driver(r.user_id,"",Boolean(preview))}<p className="mt-1 px-1 text-xs text-gray-500">{approachLabels[r.team_approach ?? "either"]}{r.preferred_team_size ? ` · voorkeur ${r.preferred_team_size} coureurs` : ""}{r.max_total_minutes ? ` · max. ${r.max_total_minutes/60} uur` : ""}</p></div>)}</div>{!remaining.length && <p className="text-sm text-gray-400">Iedere actieve deelnemer heeft een plek{preview ? " in de huidige indeling of het voorstel" : ""}.</p>}
        {!!registrations.filter(r => ["interest","reserve"].includes(r.status) && !assigned.has(r.user_id)).length && <details className="mt-5 border-t border-white/10 pt-4 text-sm text-gray-400"><summary className="cursor-pointer">Interesse & reserves</summary><ul className="mt-3 space-y-2">{registrations.filter(r => ["interest","reserve"].includes(r.status) && !assigned.has(r.user_id)).map(r => <li key={r.id}>{displayName(r.user_id)} · {r.status==="reserve" ? "reserve" : "interesse"}</li>)}</ul><p className="mt-3 text-xs">Deze deelnemers worden niet automatisch als vaste coureur ingedeeld.</p></details>}
      </Panel>
      <div className="grid items-start gap-4 md:grid-cols-2">{teams.map(t => { const roster=members.filter(m => m.team_id===t.id),ids=roster.filter(m => m.role!=="reserve").map(m => m.user_id);return <Panel key={t.id} className="min-w-0">
        <div className="flex items-start justify-between gap-2"><StatusPill tone="orange">{t.team_approach && t.team_approach!=="either" ? approachLabels[t.team_approach] : "Gemengd"}</StatusPill>{!frozen && <button aria-label={`Instellingen ${t.name}`} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-gray-400 hover:bg-white/5 hover:text-white" onClick={() => setSettings({kind:"settings",team_id:t.id,name:t.name,capacity:t.target_size ?? event.maxDriversPerCar,approach:t.team_approach ?? "either",car_number:t.car_number ?? "",manager_id:t.manager_id ?? managerId})}><Settings2 className="h-4 w-4"/></button>}</div>
        <h3 className="mt-2 break-words text-xl font-black text-white">{t.name}{t.car_number ? ` #${t.car_number}` : ""}</h3><p className="mt-1 text-xs text-gray-400">{ids.length}/{t.target_size ?? event.maxDriversPerCar} coureurs · {spread(ids)}</p><p className="mt-2 text-xs text-gray-500">Manager: {t.manager_id ? displayName(t.manager_id) : "Nog niet gekozen"}</p>
        {!frozen && <button className="mt-3 min-h-11 text-xs font-semibold text-orange-300" onClick={() => setEditingRoster(editingRoster === t.id ? null : t.id)}>{editingRoster === t.id ? "Verplaatsen sluiten" : "Coureurs verplaatsen"}</button>}
        <div className="mt-4 space-y-2">{roster.map(m => driver(m.user_id,t.id,false,m.role==="reserve"))}</div>{health(ids)}{t.plan_needs_review && <p className="mt-3 flex items-center gap-2 text-xs text-orange-300"><ArrowRight className="h-4 w-4"/>Stintplanning opnieuw controleren</p>}
      </Panel>;})}{!teams.length && <Panel className="md:col-span-2"><Users className="mb-4 h-7 w-7 text-orange-400"/><h3 className="font-bold text-white">De eerste teams beginnen bij practice</h3><p className="mt-2 max-w-lg text-sm leading-relaxed text-gray-400">Zodra deelnemers voldoende rondes hebben gereden, kun je een indeling voorstellen. Of maak alvast zelf een team.</p></Panel>}</div>
    </div>
    <Dialog open={Boolean(settings)} onOpenChange={open => {if(!open && !busy)setSettings(null);}}><DialogContent className="max-h-[90dvh] overflow-auto rounded-3xl border-white/10 bg-[#12151b] sm:max-w-lg"><DialogHeader><DialogTitle>Team instellen</DialogTitle><DialogDescription>Eigen teamgrootte en manager binnen dezelfde race.</DialogDescription></DialogHeader>{settings && <form className="space-y-4" onSubmit={e => {e.preventDefault();void run(() => onManage(settings,snapshot.revision),"Teaminstellingen opgeslagen.");}}>
      <Field label="Teamnaam"><input required maxLength={100} className={inputClass} value={settings.name} onChange={e => setSettings({...settings,name:e.target.value})}/></Field><div className="grid grid-cols-2 gap-3"><Field label="Teamgrootte"><input required type="number" min={1} max={event.maxDriversPerCar} className={inputClass} value={settings.capacity} onChange={e => setSettings({...settings,capacity:Number(e.target.value)})}/></Field><Field label="Autonummer"><input maxLength={12} className={inputClass} value={settings.car_number} onChange={e => setSettings({...settings,car_number:e.target.value})}/></Field></div>
      <Field label="Aanpak"><select className={inputClass} value={settings.approach} onChange={e => setSettings({...settings,approach:e.target.value as TeamApproach})}>{Object.entries(approachLabels).map(([v,l]) => <option key={v} value={v}>{v==="either" ? "Gemengd" : l}</option>)}</select></Field><Field label="Teammanager"><select className={inputClass} value={settings.manager_id ?? managerId} onChange={e => setSettings({...settings,manager_id:e.target.value})}>{[...new Set([managerId,settings.manager_id,...members.filter(m => m.team_id===settings.team_id).map(m => m.user_id)])].filter((id):id is string => Boolean(id)).map(id => <option key={id} value={id}>{displayName(id)}</option>)}</select></Field>
      {failed && message && <p role="alert" className="text-sm text-red-200">{message}</p>}<div className="flex justify-end gap-3 pt-2"><SecondaryButton type="button" disabled={busy} onClick={() => setSettings(null)}>Annuleren</SecondaryButton><PrimaryButton type="submit" disabled={busy}>Opslaan</PrimaryButton></div>
    </form>}</DialogContent></Dialog>
  </div>;
}
