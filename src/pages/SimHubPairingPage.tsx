import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, Cable, Copy, Fuel, Gauge, Loader2, MonitorCheck, Radio, ShieldCheck, Timer, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import Footer from "@/components/Footer";
import Navbar from "@/components/Navbar";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { centralRowToBridgeResponse, createCentralSimHubPairingCode, listCentralSimHubDevices, readCentralSimHubTelemetry, revokeCentralSimHubDevice, type CentralSimHubLatestRow, type SimHubPairingCode } from "@/lib/centralSimHubRelay";
import { getSimHubTelemetryState, type SimHubBridgeResponse } from "@/lib/localSimHubBridge";

const SimHubPairingPage = () => {
  const { user, loading, rolesLoading, isSuperAdmin } = useAuth();
  const staff = isSuperAdmin;
  const [pairing, setPairing] = useState<SimHubPairingCode | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [latest, setLatest] = useState<SimHubBridgeResponse | null>(null);
  const [relayError, setRelayError] = useState("");
  const [checkedAt, setCheckedAt] = useState(Date.now());
  const createBusyRef = useRef(false);
  const revokeBusyRef = useRef<Set<string>>(new Set());
  const [revokingDeviceId, setRevokingDeviceId] = useState<string | null>(null);

  const devices = useQuery({
    queryKey: ["simhub", "pairing-page-devices", user?.id],
    enabled: Boolean(user && staff),
    queryFn: listCentralSimHubDevices,
    refetchInterval: user && staff ? 3_000 : false,
  });

  useEffect(() => {
    const available = devices.data ?? [];
    if (selectedDeviceId && available.some((device) => device.id === selectedDeviceId)) return;
    setSelectedDeviceId(available.find((device) => !device.revoked_at)?.id ?? available[0]?.id ?? "");
  }, [devices.data, selectedDeviceId]);

  useEffect(() => {
    setLatest(null);
    setRelayError("");
    if (!user || !staff || !selectedDeviceId) return;
    let active = true;
    const refreshSnapshot = () => readCentralSimHubTelemetry(selectedDeviceId).then((snapshot) => {
      if (!active) return;
      setLatest((current) => !current || (snapshot && Date.parse(snapshot.receivedAt) >= Date.parse(current.receivedAt)) ? snapshot : current);
      setCheckedAt(Date.now());
    }).catch((error) => {
      if (active) setRelayError(error instanceof Error ? error.message : "Connection-test kon niet worden geladen.");
    });
    const channel = supabase.channel(`simhub-pairing-page-${selectedDeviceId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "simhub_telemetry_latest", filter: `device_id=eq.${selectedDeviceId}` }, (change) => {
        if (!active) return;
        if (change.eventType === "DELETE") {
          setLatest(null);
          void refreshSnapshot();
          return;
        }
        const row = change.new as unknown as CentralSimHubLatestRow;
        if (!row || row.device_id !== selectedDeviceId) return;
        try {
          const incoming = centralRowToBridgeResponse(row);
          setLatest((current) => !current || Date.parse(incoming.receivedAt) >= Date.parse(current.receivedAt) ? incoming : current);
          setRelayError("");
          setCheckedAt(Date.now());
        } catch {
          setRelayError("De relay stuurde een ongeldig telemetrybericht.");
        }
      })
      .subscribe((status) => {
        if (!active) return;
        if (status === "SUBSCRIBED") void refreshSnapshot();
        if (status === "CHANNEL_ERROR") setRelayError("Realtime-kanaal kon niet worden geopend.");
      });
    const freshness = window.setInterval(() => setCheckedAt(Date.now()), 1_000);
    return () => { active = false; window.clearInterval(freshness); void supabase.removeChannel(channel); };
  }, [selectedDeviceId, staff, user]);

  const createCode = async () => {
    if (createBusyRef.current) return;
    createBusyRef.current = true;
    setBusy(true);
    setFeedback("");
    try {
      setPairing(await createCentralSimHubPairingCode());
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Pairingcode kon niet worden gemaakt.");
    } finally {
      createBusyRef.current = false;
      setBusy(false);
    }
  };

  const revoke = async (deviceId: string) => {
    if (revokeBusyRef.current.has(deviceId)) return;
    revokeBusyRef.current.add(deviceId);
    setRevokingDeviceId(deviceId);
    setFeedback("");
    try {
      await revokeCentralSimHubDevice(deviceId);
      if (deviceId === selectedDeviceId) setLatest(null);
      await devices.refetch();
      setFeedback("De SimHub-installatie is ingetrokken.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Apparaat kon niet worden ingetrokken.");
    } finally {
      revokeBusyRef.current.delete(deviceId);
      setRevokingDeviceId(null);
    }
  };

  const copyPairingCode = async () => {
    if (!pairing) return;
    try {
      await navigator.clipboard.writeText(pairing.code);
      setFeedback("Pairingcode gekopieerd.");
    } catch {
      setFeedback("Kopiëren is geblokkeerd; selecteer de code handmatig.");
    }
  };

  return <div className="flex min-h-screen flex-col bg-background text-foreground">
    <Navbar />
    <main className="container mx-auto flex-1 px-4 pb-16 pt-28">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-orange-400">3SM telemetry</p>
          <h1 className="mt-2 font-heading text-4xl font-black text-white sm:text-5xl">SimHub koppelen</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-gray-400">Verbind deze sim-pc éénmalig met je 3SM-account. Een race of team wordt pas later in de Endurance-tab toegewezen; deze pagina test alleen of de beveiligde verbinding werkt.</p>
        </div>

        {(loading || rolesLoading) ? <div className="rounded-2xl border border-border bg-card p-8 text-center"><Loader2 className="mx-auto h-7 w-7 animate-spin text-orange-400" /><p className="mt-3 text-sm text-muted-foreground">Account laden…</p></div> : !user ? <div className="rounded-2xl border border-orange-500/20 bg-orange-500/[0.07] p-8 text-center"><Cable className="mx-auto h-10 w-10 text-orange-400" /><h2 className="mt-4 text-xl font-bold text-white">Log eerst in</h2><p className="mt-2 text-sm text-gray-400">Pairingcodes zijn kort geldig en tijdens de testfase alleen beschikbaar voor Super-admin.</p><Link to="/auth?redirect=/simhub-koppelen" className="mt-6 inline-flex rounded-lg bg-orange-500 px-5 py-2.5 text-sm font-bold text-black hover:bg-orange-400">Inloggen</Link></div> : !staff ? <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.07] p-8 text-center"><ShieldCheck className="mx-auto h-10 w-10 text-amber-300" /><h2 className="mt-4 text-xl font-bold text-white">Super-admin vereist</h2><p className="mt-2 text-sm text-gray-400">Deze centrale SimHub-koppeling is tijdens de gecontroleerde testfase uitsluitend voor Super-admin zichtbaar en bruikbaar.</p></div> : <div className="space-y-5">
          {devices.error && <p className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">Gekoppelde installaties konden niet worden geladen: {devices.error instanceof Error ? devices.error.message : "onbekende fout"}</p>}

          <section className="rounded-2xl border border-border bg-card p-6 shadow-lg">
            <div className="flex items-start gap-3"><div className="rounded-xl bg-orange-500/10 p-2.5"><Cable className="h-5 w-5 text-orange-400" /></div><div><h2 className="text-xl font-bold text-white">Nieuwe installatie koppelen</h2><p className="mt-1 text-sm text-gray-400">Maak een tijdelijke code en vul die in de SimHub-plugin in. Er wordt nog geen race of team gekozen.</p></div></div>
            <button type="button" onClick={() => void createCode()} disabled={busy} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-orange-500 px-5 py-2.5 text-sm font-black text-black transition hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-40">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cable className="h-4 w-4" />}Koppeling testen</button>
            {pairing && <div className="mt-5 rounded-xl border border-orange-500/20 bg-orange-500/[0.06] p-5"><p className="text-xs font-bold uppercase tracking-wider text-orange-300">Tijdelijke code</p><div className="mt-2 flex flex-wrap items-center gap-3"><code className="text-3xl font-black tracking-[0.18em] text-white">{pairing.code}</code><button type="button" onClick={() => void copyPairingCode()} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-gray-200 hover:bg-white/5"><Copy className="h-4 w-4" />Kopiëren</button></div><p className="mt-2 text-xs text-gray-500">Geldig tot {new Date(pairing.expiresAt).toLocaleTimeString("nl-NL")}. De installatie blijft daarna gekoppeld totdat je haar intrekt.</p></div>}
          </section>

          <section className="rounded-2xl border border-border bg-card p-6"><div className="flex items-start gap-3"><MonitorCheck className="mt-0.5 h-5 w-5 text-emerald-400" /><div><h2 className="text-lg font-bold text-white">Gekoppelde installaties</h2><p className="mt-1 text-sm text-gray-400">Selecteer een installatie om de connection-test te bekijken. Een ingetrokken token kan direct niets meer publiceren.</p></div></div><div className="mt-5 space-y-2">{devices.isLoading ? <p className="text-sm text-gray-500">Laden…</p> : !devices.data?.length ? <p className="rounded-lg border border-dashed border-white/10 p-4 text-sm text-gray-500">Nog geen SimHub-installatie gekoppeld.</p> : devices.data.map((device) => <div key={device.id} className={`flex items-center justify-between gap-4 rounded-xl p-4 ring-1 ${selectedDeviceId === device.id ? "bg-orange-500/[0.07] ring-orange-500/25" : "bg-black/20 ring-white/5"}`}><button type="button" onClick={() => setSelectedDeviceId(device.id)} className="min-w-0 flex-1 text-left"><strong className="text-sm text-white">{device.device_name}</strong><p className="mt-1 text-xs font-medium text-gray-400">3SM-account gekoppeld · {device.connector_id}</p><p className="mt-1 text-xs text-gray-500">{device.last_seen_at ? `Verbinding gezien ${new Date(device.last_seen_at).toLocaleString("nl-NL")}` : "Wacht op eerste iRacing-telemetry"}{device.revoked_at ? " · ingetrokken" : device.expires_at ? ` · geldig tot ${new Date(device.expires_at).toLocaleString("nl-NL")}` : " · geldig tot intrekken"}</p></button>{!device.revoked_at && <button type="button" disabled={revokingDeviceId === device.id} onClick={() => void revoke(device.id)} className="inline-flex items-center gap-1.5 text-xs font-bold text-red-300 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-50">{revokingDeviceId === device.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}Intrekken</button>}</div>)}</div></section>

          <LiveTelemetry latest={latest} checkedAt={checkedAt} error={relayError} hasDevice={Boolean(selectedDeviceId)} />
          {feedback && <p role="status" className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-gray-300">{feedback}</p>}
          <p className="flex items-start gap-2 text-xs leading-5 text-gray-500"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />De site toont nooit het device-token. De plugin bewaart het versleuteld met Windows DPAPI; de 3SM-server bewaart alleen de hash en de laatste geldige connection-testsnapshot.</p>
        </div>}
      </div>
    </main>
    <Footer />
  </div>;
};

const LiveTelemetry = ({ latest, checkedAt, error, hasDevice }: { latest: SimHubBridgeResponse | null; checkedAt: number; error: string; hasDevice: boolean }) => {
  const state = latest ? getSimHubTelemetryState(latest.receivedAt, checkedAt) : null;
  const telemetry = latest?.payload.telemetry;
  const age = latest ? Math.max(0, Math.round((checkedAt - Date.parse(latest.receivedAt)) / 1_000)) : null;
  return <section className="rounded-2xl border border-border bg-card p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-start gap-3"><Radio className="mt-0.5 h-5 w-5 text-orange-400" /><div><h2 className="text-lg font-bold text-white">Connection-test</h2><p className="mt-1 text-sm text-gray-400">Laatste geldige snapshot van de geselecteerde SimHub-installatie, nog zonder endurance-event of team.</p></div></div><span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${state === "live" ? "bg-emerald-500/15 text-emerald-300" : state === "offline" ? "bg-red-500/15 text-red-300" : "bg-orange-500/15 text-orange-300"}`}>{state === "live" ? "Verbonden" : state === "stale" ? "Verouderd" : state === "offline" ? "Offline" : "Wacht op SimHub"}</span></div>{error && <p role="alert" className="mt-4 rounded-lg bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}{!hasDevice && !error && <p className="mt-5 rounded-lg border border-dashed border-white/10 p-5 text-center text-sm text-gray-500">Koppel eerst een SimHub-installatie.</p>}{hasDevice && !latest && !error && <p className="mt-5 rounded-lg border border-dashed border-white/10 p-5 text-center text-sm text-gray-500">Installatie gekoppeld. Start iRacing om de verbinding met een eerste telemetrysnapshot te bevestigen.</p>}{latest && telemetry && <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><LiveMetric icon={Activity} label="Heartbeat" primary={telemetry.connected ? "iRacing verbonden" : "Geen gamesignaal"} secondary={`${latest.payload.source.connectorId} · ${age ?? 0}s geleden`} /><LiveMetric icon={Gauge} label="Ronde / positie" primary={`Ronde ${telemetry.lap} · P${telemetry.position ?? "—"}`} secondary={`Klasse P${telemetry.classPosition ?? "—"} · ${Math.round(telemetry.speedKph)} km/u`} /><LiveMetric icon={Fuel} label="Brandstof" primary={`${telemetry.fuelLitres.toFixed(1)} L`} secondary={telemetry.estimatedLapsRemaining === null ? "Resterende ronden onbekend" : `${telemetry.estimatedLapsRemaining.toFixed(1)} ronden resterend`} /><LiveMetric icon={Timer} label="Stint / pits" primary={`${Math.floor(telemetry.stintElapsedSeconds / 60)} min`} secondary={telemetry.inPitLane ? `Pitlane${telemetry.pitLimiter ? " · limiter aan" : ""}` : "Op de baan"} /></div>}</section>;
};

const LiveMetric = ({ icon: Icon, label, primary, secondary }: { icon: typeof Activity; label: string; primary: string; secondary: string }) => <div className="rounded-xl bg-black/20 p-4 ring-1 ring-white/5"><div className="flex items-center gap-2 text-xs text-gray-500"><Icon className="h-4 w-4 text-orange-400" />{label}</div><strong className="mt-2 block text-lg text-white">{primary}</strong><span className="mt-1 block text-xs text-gray-500">{secondary}</span></div>;

export default SimHubPairingPage;
