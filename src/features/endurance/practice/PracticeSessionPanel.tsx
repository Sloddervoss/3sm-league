import { useMemo, useState } from "react";
import { Flag, Gauge, Play, Square, Timer, UserRound } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useEnduranceActor } from "../core/ActorContext";
import { useEnduranceRegistrations } from "../repository/registrationsRepository";
import { useEndurancePracticeWorkspace, useEndurancePracticeMutations, syncPracticeSessionToPace } from "../repository/practiceRepository";
import { formatAmsterdam } from "../core/selectors";
import type { EnduranceEvent } from "../core/types";
import { Panel, PrimaryButton, SecondaryButton, SectionHeading, StatusPill } from "../shared/ui";
import { getEnduranceCar } from "../core/carCatalog";

/**
 * Practice-sessie — Fase 3.5 (raamwerk).
 * De manager kan een practice-sessie starten en beëindigen; alleen coureurs die
 * zijn ingeschreven tellen mee (requires_registered). Tijdens een actieve sessie
 * koppelt de SimHub-opname-laag later ronden/verbruik aan deze sessie. Tot die
 * laag er is, toont het paneel start/stop + de aangemaakte sessies.
 */
export const PracticeSessionPanel = ({ event }: { event: EnduranceEvent }) => {
  const { user, isSuperAdmin, isEnduranceManager } = useAuth();
  const { displayName } = useEnduranceActor();
  const { data: registrations = [] } = useEnduranceRegistrations(event.id);
  const { data } = useEndurancePracticeWorkspace(event.id);
  const { start, close } = useEndurancePracticeMutations(event.id);
  const [label, setLabel] = useState("Practice");
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState("");

  const selectedCar = getEnduranceCar(event.selectedCarId);
  const pushToPace = async (sessionId: string) => {
    if (!sessionId) return;
    setSyncing(sessionId);
    setSyncMessage("");
    try {
      const written = await syncPracticeSessionToPace(sessionId, {
        event_id: event.id,
        circuit: event.circuit,
        configuration: event.configuration,
        car: selectedCar ? selectedCar.name : "Onbekend",
      });
      setSyncMessage(written > 0 ? `Pace berekend voor ${written} coureur(s) uit practice.` : "Geen ronden gevonden om door te voeren naar pace.");
    } catch (caught) {
      setSyncMessage(caught instanceof Error ? `Pace doorvoeren mislukt: ${caught.message}` : "Pace doorvoeren mislukt.");
    } finally {
      setSyncing(null);
    }
  };

  const sessions = data?.sessions ?? [];
  const lapsBySession = useMemo(() => data?.lapsBySession ?? {}, [data?.lapsBySession]);
  const active = sessions.find((session) => !session.ended_at) ?? null;
  const manager = Boolean(user?.id && (isSuperAdmin || isEnduranceManager));
  const registeredCount = registrations.filter((r) => !["rejected", "withdrawn"].includes(r.status)).length;

  // Per-sessie: snelste rondetijd per coureur (als de opname-laag later laps levert).
  const fastestPerDriver = useMemo(() => {
    if (!active) return new Map<string, number>();
    const laps = lapsBySession[active.id] ?? [];
    const map = new Map<string, number>();
    for (const lap of laps) {
      if (!lap.user_id) continue;
      const best = map.get(lap.user_id) ?? Number.POSITIVE_INFINITY;
      if (lap.lap_seconds < best) map.set(lap.user_id, lap.lap_seconds);
    }
    return map;
  }, [active, lapsBySession]);

  const startSession = () => {
    setError("");
    if (!manager) return;
    if (active) { setError("Er is al een actieve practice-sessie. Beëindig die eerst."); return; }
    void start.mutateAsync({ label: label || "Practice", requires_registered: true, created_by: user?.id ?? null })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Practice-sessie kon niet worden gestart."));
  };
  const closeSession = () => {
    setError("");
    if (!active) return;
    void close.mutateAsync(active.id)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Practice-sessie kon niet worden beëindigd."));
  };

  return <div className="space-y-5">
    <Panel>
      <SectionHeading eyebrow="Practice" title="Practice-sessie" description="De manager start een sessie; alleen ingeschreven coureurs worden meegenomen. Tijdens een actieve sessie worden ronden en brandstofverbruik opgenomen (SimHub-koppeling)." action={<StatusPill tone={active ? "red" : "neutral"}>{active ? "Sessie actief" : "Geen actieve sessie"}</StatusPill>} />
      {error && <p role="alert" className="mb-4 rounded-xl bg-red-500/10 p-3 text-sm text-red-200 ring-1 ring-red-500/20">{error}</p>}
      {manager && !active && <form onSubmit={(e) => { e.preventDefault(); startSession(); }} className="mb-5 grid gap-3 sm:grid-cols-[1fr_auto]">
        <label className="flex flex-col gap-1 text-xs font-bold uppercase tracking-wide text-gray-500">Sessienaam <input className="rounded-xl bg-black/20 px-3 py-2 text-sm text-white ring-1 ring-white/10" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Training 1" /></label>
        <div className="flex items-end"><PrimaryButton type="submit" disabled={start.isPending}><Play className="h-4 w-4" /> Sessie starten</PrimaryButton></div>
      </form>}
      {active && <div className="mb-5 flex flex-wrap items-center gap-2">
        <StatusPill tone="red"><Timer className="mr-1 inline h-3 w-3" /> Gestart {formatAmsterdam(active.started_at)}</StatusPill>
        <StatusPill tone="orange"><UserRound className="mr-1 inline h-3 w-3" /> {registeredCount} ingeschreven coureurs volgen</StatusPill>
        {manager && <SecondaryButton onClick={closeSession} disabled={close.isPending}><Flag className="h-4 w-4" /> Sessie beëindigen</SecondaryButton>}
      </div>}
      {fastestPerDriver.size > 0 && <div className="mb-5"><h3 className="mb-2 font-heading font-black text-white">Snelste rondetijd per coureur</h3><div className="space-y-1">{[...fastestPerDriver.entries()].sort((a, b) => a[1] - b[1]).map(([userId, seconds]) => <div key={userId} className="flex items-center justify-between rounded-xl bg-black/20 px-3 py-2 text-sm"><span className="text-gray-200">{displayName(userId)}</span><strong className="text-white">{seconds.toFixed(3)}s</strong></div>)}</div></div>}
      {!active && !fastestPerDriver.size && <p className="text-sm text-gray-400">Start een sessie om te beginnen met het opnemen van rondetijden.</p>}
    </Panel>

    <Panel>
      <SectionHeading title="Eerdere sessies" description="Opgenomen trainingsmomenten blijven per race bewaard." />
      {syncMessage && <p className="mb-3 rounded-xl bg-white/[0.04] p-3 text-sm text-gray-200">{syncMessage}</p>}
      {sessions.length ? <div className="space-y-2">{sessions.map((session) => { const laps = lapsBySession[session.id] ?? []; return <div key={session.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/[0.035] p-3 text-sm"><div><strong className="text-gray-200">{session.label}</strong><p className="text-xs text-gray-500">{formatAmsterdam(session.started_at)}{session.ended_at ? ` – ${formatAmsterdam(session.ended_at)}` : " · open"}</p></div><div className="flex items-center gap-2"><span className="text-xs text-gray-500">{laps.length} ronden</span>{manager && session.ended_at && laps.length > 0 && <SecondaryButton onClick={() => void pushToPace(session.id)} disabled={syncing === session.id}><Gauge className="h-3.5 w-3.5" /> {syncing === session.id ? "Doorvoeren..." : "Doorvoeren naar pace"}</SecondaryButton>}</div></div>; })}</div> : <p className="text-sm text-gray-500">Nog geen practice-sessies voor deze race.</p>}
    </Panel>
  </div>;
};
