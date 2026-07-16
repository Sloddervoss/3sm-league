import { useEffect, useMemo, useState } from "react";
import { Activity, Cable, Fuel, Gauge, Radio, Timer, Unplug } from "lucide-react";
import { getSimHubTelemetryState, readLocalSimHubTelemetry, type SimHubBridgeResponse } from "@/lib/localSimHubBridge";
import { useEnduranceStore } from "../core/EnduranceStore";
import { Field, inputClass, Panel, PrimaryButton, SecondaryButton, SectionHeading, StatusPill } from "../shared/ui";

const formatDuration = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  return `${Math.floor(minutes / 60)}u ${minutes % 60}m`;
};
const value = (number: number | null, suffix = "") => number === null ? "—" : `${number.toFixed(1)}${suffix}`;

export const SimHubTelemetryPanel = ({ eventId, teamId, plannedDriverId }: { eventId: string; teamId: string; plannedDriverId?: string }) => {
  const { state } = useEnduranceStore();
  const [baseUrl, setBaseUrl] = useState("http://127.0.0.1:8787");
  const [token, setToken] = useState("local-3sm-simhub-spike");
  const [enabled, setEnabled] = useState(false);
  const [latest, setLatest] = useState<SimHubBridgeResponse | null>(null);
  const [status, setStatus] = useState("Niet gekoppeld");
  const [error, setError] = useState("");
  const [checkedAt, setCheckedAt] = useState(0);

  useEffect(() => {
    setLatest(null);
    if (!enabled || !teamId) return;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const response = await readLocalSimHubTelemetry({ baseUrl, token, eventId, teamId, signal: controller.signal });
        setCheckedAt(Date.now());
        setLatest(response);
        setStatus(response ? "Telemetry ontvangen" : "Bridge gekoppeld · wacht op SimHub");
        setError("");
      } catch (pollError) {
        if (controller.signal.aborted) return;
        setCheckedAt(Date.now());
        setStatus("Verbinding mislukt");
        setError(pollError instanceof Error ? pollError.message : "Onbekende bridgefout");
      }
    };
    void poll();
    const interval = window.setInterval(() => void poll(), 1_000);
    return () => { controller.abort(); window.clearInterval(interval); };
  }, [baseUrl, enabled, eventId, teamId, token]);

  const telemetry = latest?.payload.telemetry;
  const reportedDriver = state.personas.find((persona) => persona.id === latest?.payload.race.driverId);
  const plannedDriver = state.personas.find((persona) => persona.id === plannedDriverId);
  const ageSeconds = latest ? Math.max(0, Math.round((checkedAt - Date.parse(latest.receivedAt)) / 1_000)) : null;
  const telemetryState = latest ? getSimHubTelemetryState(latest.receivedAt, checkedAt) : null;
  const fresh = telemetryState === "live";
  const pitWindowMinutes = useMemo(() => telemetry?.estimatedLapsRemaining && telemetry.lapTimeSeconds ? telemetry.estimatedLapsRemaining * telemetry.lapTimeSeconds / 60 : null, [telemetry]);
  const mismatch = Boolean(latest?.payload.race.driverId && plannedDriverId && latest.payload.race.driverId !== plannedDriverId);

  return <Panel>
    <SectionHeading eyebrow="Lokale technische spike" title="SimHub live telemetry" description="Leest adviserend vanaf de 3SM-bridge op dezelfde pc. Handmatige Race Control blijft beschikbaar en telemetry wijzigt de planning niet automatisch." action={<StatusPill tone={telemetryState === "live" ? "green" : telemetryState === "offline" ? "red" : enabled ? "orange" : "neutral"}>{telemetryState === "live" ? "Live" : telemetryState === "stale" ? "Telemetry verouderd" : telemetryState === "offline" ? "Offline" : status}</StatusPill>} />
    <div className="grid gap-3 lg:grid-cols-[1fr_1fr_auto]">
      <Field label="Lokale bridge"><input className={inputClass} value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} disabled={enabled} /></Field>
      <Field label="Pairingtoken"><input type="password" className={inputClass} value={token} onChange={(event) => setToken(event.target.value)} disabled={enabled} /></Field>
      <div className="flex items-end">{enabled ? <SecondaryButton onClick={() => { setEnabled(false); setLatest(null); setStatus("Niet gekoppeld"); }}><Unplug className="h-4 w-4" /> Ontkoppelen</SecondaryButton> : <PrimaryButton onClick={() => setEnabled(true)}><Cable className="h-4 w-4" /> Lokale bridge koppelen</PrimaryButton>}</div>
    </div>
    {error && <p role="alert" className="mt-3 rounded-xl bg-red-500/10 p-3 text-sm text-red-200 ring-1 ring-red-500/20">{error}</p>}
    {enabled && !latest && !error && <div className="mt-4 rounded-xl border border-dashed border-white/10 p-5 text-center text-sm text-gray-400"><Radio className="mx-auto mb-2 h-5 w-5 text-orange-400" />Start SimHub of de lokale simulator; Race Control wacht op het eerste geldige datapakket.</div>}
    {latest && telemetry && <>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric icon={Activity} label="Bron / heartbeat" primary={telemetry.connected ? "iRacing verbonden" : "Geen gamesignaal"} secondary={`${latest.payload.source.connectorId} · ${ageSeconds ?? 0}s geleden`} />
        <Metric icon={Gauge} label="Ronde / positie" primary={`Ronde ${telemetry.lap} · P${telemetry.position ?? "—"}`} secondary={`Klasse P${telemetry.classPosition ?? "—"} · ${Math.round(telemetry.speedKph)} km/u`} />
        <Metric icon={Fuel} label="Brandstof" primary={`${telemetry.fuelLitres.toFixed(1)} L`} secondary={`${value(telemetry.estimatedLapsRemaining, " ronden")} · pit ±${pitWindowMinutes ? Math.round(pitWindowMinutes) : "—"} min`} />
        <Metric icon={Timer} label="Actuele stint" primary={formatDuration(telemetry.stintElapsedSeconds)} secondary={telemetry.inPitLane ? `Pitlane${telemetry.pitLimiter ? " · limiter" : ""}` : `${telemetry.incidents ?? "—"} incidenten · ${telemetry.flag}`} />
      </div>
      <div className={`mt-4 rounded-xl p-4 ring-1 ${mismatch ? "bg-amber-500/10 text-amber-100 ring-amber-500/25" : "bg-emerald-500/[0.07] text-emerald-100 ring-emerald-500/20"}`}>
        <strong className="text-sm">Gemelde coureur: {reportedDriver?.name ?? latest.payload.race.driverId ?? "Onbekend"}</strong>
        <p className="mt-1 text-xs opacity-75">Gepland: {plannedDriver?.name ?? "Geen actuele stint"}{mismatch ? " · Afwijking gedetecteerd; Race Control moet dit handmatig beoordelen." : " · Komt overeen met de planning."}</p>
      </div>
    </>}
  </Panel>;
};

const Metric = ({ icon: Icon, label, primary, secondary }: { icon: typeof Activity; label: string; primary: string; secondary: string }) => <div className="rounded-xl bg-black/20 p-4 ring-1 ring-white/5"><div className="flex items-center gap-2 text-xs text-gray-500"><Icon className="h-4 w-4 text-orange-400" />{label}</div><strong className="mt-2 block text-lg text-white">{primary}</strong><span className="mt-1 block text-xs text-gray-500">{secondary}</span></div>;
