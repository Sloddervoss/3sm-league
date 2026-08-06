import { useEffect, useMemo, useState } from "react";
import { Activity, Cable, Crown, Fuel, Gauge, Loader2, Radio, RefreshCw, Timer } from "lucide-react";
import { centralRowToBridgeResponse, listCentralSimHubDevices, readCentralSimHubTelemetry, type CentralSimHubLatestRow } from "@/lib/centralSimHubRelay";
import { getSimHubTelemetryState, type SimHubBridgeResponse } from "@/lib/localSimHubBridge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useEnduranceActor } from "../core/ActorContext";
import { Field, inputClass, Panel, PrimaryButton, SecondaryButton, SectionHeading, StatusPill } from "../shared/ui";

const formatDuration = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  return `${Math.floor(minutes / 60)}u ${minutes % 60}m`;
};
const value = (number: number | null, suffix = "") => number === null ? "—" : `${number.toFixed(1)}${suffix}`;

export const SimHubTelemetryPanel = ({ eventId, teamId, plannedDriverId }: { eventId: string; teamId: string; plannedDriverId?: string }) => {
  const { displayName } = useEnduranceActor();
  const { user, isSuperAdmin, loading } = useAuth();
  // Centrale relay: leest een gekoppeld SimHub-device (proof of work), alleen super-admin tijdens de canary.
  const staff = Boolean(user && isSuperAdmin);
  const [devices, setDevices] = useState<{ id: string; device_name: string; connector_id: string; revoked_at: string | null }[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [latest, setLatest] = useState<SimHubBridgeResponse | null>(null);
  const [status, setStatus] = useState("Niet gekoppeld");
  const [error, setError] = useState("");
  const [checkedAt, setCheckedAt] = useState(0);

  const loadDevices = async () => {
    if (!staff) { setDevices([]); setEnabled(false); return; }
    try {
      const list = await listCentralSimHubDevices();
      setDevices(list.filter((device) => !device.revoked_at));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Gekoppelde SimHub-apparaten konden niet worden geladen.");
    }
  };

  useEffect(() => { void loadDevices(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [staff, user?.id]);

  useEffect(() => {
    if (devices.length && !devices.some((device) => device.id === selectedDeviceId)) setSelectedDeviceId(devices[0].id);
  }, [devices, selectedDeviceId]);

  // Centrale relay + Realtime: abonneert op live snapshots van het geselecteerde device.
  useEffect(() => {
    setLatest(null); setError(""); setStatus(devices.length ? "Wacht op telemetry" : "Geen device geselecteerd");
    if (!enabled || !selectedDeviceId) return;
    let active = true;
    const refreshSnapshot = () => readCentralSimHubTelemetry(selectedDeviceId).then((snapshot) => {
      if (!active) return;
      setLatest((current) => !current || (snapshot && Date.parse(snapshot.receivedAt) >= Date.parse(current.receivedAt)) ? snapshot : current);
      setCheckedAt(Date.now());
    }).catch((pollError) => { if (active) setError(pollError instanceof Error ? pollError.message : "Connection-test kon niet worden geladen."); });
    void refreshSnapshot();
    const interval = window.setInterval(() => void refreshSnapshot(), 3_000);
    const channel = supabase.channel(`race-control-simhub-${selectedDeviceId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "simhub_telemetry_latest", filter: `device_id=eq.${selectedDeviceId}` }, (change) => {
        if (!active) return;
        if (change.eventType === "DELETE") { setLatest(null); void refreshSnapshot(); return; }
        const row = change.new as unknown as CentralSimHubLatestRow;
        if (!row || row.device_id !== selectedDeviceId) return;
        try { setLatest((current) => (current && Date.parse(current.receivedAt) > Date.parse(row.received_at)) ? current : centralRowToBridgeResponse(row)); setError(""); setCheckedAt(Date.now()); }
        catch { setError("De relay stuurde een ongeldig telemetrybericht."); }
      })
      .subscribe((channelStatus) => {
        if (!active) return;
        if (channelStatus === "SUBSCRIBED") void refreshSnapshot();
        if (channelStatus === "CHANNEL_ERROR") setError("Realtime-kanaal kon niet worden geopend.");
      });
    const freshness = window.setInterval(() => setCheckedAt(Date.now()), 1_000);
    return () => { active = false; window.clearInterval(interval); window.clearInterval(freshness); void supabase.removeChannel(channel); };
  }, [enabled, selectedDeviceId]);

  const refreshDeviceList = async () => { setRefreshing(true); try { await loadDevices(); } finally { setRefreshing(false); } };

  const telemetry = latest?.payload.telemetry;
  const reportedDriver = latest?.payload.race.driverId ? displayName(latest.payload.race.driverId) : undefined;
  const plannedDriver = plannedDriverId ? displayName(plannedDriverId) : undefined;
  const ageSeconds = latest ? Math.max(0, Math.round((checkedAt - Date.parse(latest.receivedAt)) / 1_000)) : null;
  const telemetryState = latest ? getSimHubTelemetryState(latest.receivedAt, checkedAt) : null;
  const fresh = telemetryState === "live";
  const pitWindowMinutes = useMemo(() => telemetry?.estimatedLapsRemaining && telemetry.lapTimeSeconds ? telemetry.estimatedLapsRemaining * telemetry.lapTimeSeconds / 60 : null, [telemetry]);
  const mismatch = Boolean(latest?.payload.race.driverId && plannedDriverId && latest.payload.race.driverId !== plannedDriverId);

  return <Panel>
    <SectionHeading eyebrow="Bewezen centrale relay" title="SimHub live telemetry" description="Leest adviserend vanaf de gekoppelde SimHub-installatie via de centrale 3SM-relay. Handmatige Race Control blijft beschikbaar en telemetry wijzigt de planning niet automatisch." action={<StatusPill tone={telemetryState === "live" ? "green" : telemetryState === "offline" ? "red" : enabled ? "orange" : "neutral"}>{telemetryState === "live" ? "Live" : telemetryState === "stale" ? "Telemetry verouderd" : telemetryState === "offline" ? "Offline" : status}</StatusPill>} />
    {loading ? <div className="mt-4 flex items-center gap-2 text-sm text-gray-400"><Loader2 className="h-4 w-4 animate-spin" />Account laden…</div> : !staff ? <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/[0.07] p-4 text-sm text-amber-100"><Crown className="mr-2 inline h-4 w-4" />Centrale relay-lezing is tijdens de canary uitsluitend beschikbaar voor super-admin.</div> : <div className="grid gap-3 lg:grid-cols-[1fr_1fr_auto]">
      <Field label="Gekoppelde SimHub-installatie"><select className={inputClass} value={selectedDeviceId} onChange={(event) => setSelectedDeviceId(event.target.value)} disabled={!enabled || refreshing}>{devices.length ? devices.map((device) => <option key={device.id} value={device.id}>{device.device_name} · {device.connector_id}</option>) : <option value="">Geen gekoppelde installatie</option>}</select></Field>
      <Field label="Device-token instellingen"><input className={inputClass} readOnly value="DPAPI-beveiligd; server bewaart alleen hash" /></Field>
      <div className="flex items-end gap-2">{enabled ? <SecondaryButton onClick={() => { setEnabled(false); setLatest(null); setStatus("Ontkoppeld"); }}><RefreshCw className="h-4 w-4" /> Stop</SecondaryButton> : <PrimaryButton onClick={() => setEnabled(true)} disabled={!selectedDeviceId}><Cable className="h-4 w-4" /> Verbind relay</PrimaryButton>}<SecondaryButton onClick={() => void refreshDeviceList()} disabled={refreshing}><Loader2 className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} /> Verversen</SecondaryButton></div>
    </div>}
    {error && <p role="alert" className="mt-3 rounded-xl bg-red-500/10 p-3 text-sm text-red-200 ring-1 ring-red-500/20">{error}</p>}
    {enabled && !latest && !error && <div className="mt-4 rounded-xl border border-dashed border-white/10 p-5 text-center text-sm text-gray-400"><Radio className="mx-auto mb-2 h-5 w-5 text-orange-400" />Relay verbonden; Race Control wacht op het eerste geldige datapakket van dit device.</div>}
    {latest && telemetry && <>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric icon={Activity} label="Bron / heartbeat" primary={telemetry.connected ? "iRacing verbonden" : "Geen gamesignaal"} secondary={`${latest.payload.source.connectorId} · ${ageSeconds ?? 0}s geleden`} />
        <Metric icon={Gauge} label="Ronde / positie" primary={`Ronde ${telemetry.lap} · P${telemetry.position ?? "—"}`} secondary={`Klasse P${telemetry.classPosition ?? "—"} · ${Math.round(telemetry.speedKph)} km/u`} />
        <Metric icon={Fuel} label="Brandstof" primary={`${telemetry.fuelLitres.toFixed(1)} L`} secondary={`${value(telemetry.estimatedLapsRemaining, " ronden")} · pit ±${pitWindowMinutes ? Math.round(pitWindowMinutes) : "—"} min`} />
        <Metric icon={Timer} label="Actuele stint" primary={formatDuration(telemetry.stintElapsedSeconds)} secondary={telemetry.inPitLane ? `Pitlane${telemetry.pitLimiter ? " · limiter" : ""}` : `${telemetry.incidents ?? "—"} incidenten · ${telemetry.flag}`} />
      </div>
      <div className={`mt-4 rounded-xl p-4 ring-1 ${mismatch ? "bg-amber-500/10 text-amber-100 ring-amber-500/25" : "bg-emerald-500/[0.07] text-emerald-100 ring-emerald-500/20"}`}>
        <strong className="text-sm">Gemelde coureur: {reportedDriver ?? latest.payload.race.driverId ?? "Onbekend"}</strong>
        <p className="mt-1 text-xs opacity-75">Gepland: {plannedDriver ?? "Geen actuele stint"}{mismatch ? " · Afwijking gedetecteerd; Race Control moet dit handmatig beoordelen." : " · Komt overeen met de planning."}</p>
      </div>
    </>}
  </Panel>;
};

const Metric = ({ icon: Icon, label, primary, secondary }: { icon: typeof Activity; label: string; primary: string; secondary: string }) => <div className="rounded-xl bg-black/20 p-4 ring-1 ring-white/5"><div className="flex items-center gap-2 text-xs text-gray-500"><Icon className="h-4 w-4 text-orange-400" />{label}</div><strong className="mt-2 block text-lg text-white">{primary}</strong><span className="mt-1 block text-xs text-gray-500">{secondary}</span></div>;
