import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Cable, ChevronRight, Cpu, Lock, RefreshCw } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import type { SimHubFleetRow, SimHubDeviceDetail } from "@/features/control-room/connectors/types";
import type { V3Normalized } from "@/features/endurance/pitwall/pitwallHelpers";
import {
  devicePosition,
  devicePace,
  deviceRaceClock,
  deviceStrategyRow,
  deviceTrackLabel,
  isTelemetryLive,
} from "@/features/endurance/pitwall/devicePitwallAdapters";
import { DecisionBand } from "@/features/endurance/pitwall/DecisionBand";
import { TyreModelPanel } from "@/features/endurance/pitwall/TyreModelPanel";
import { RawTelemetryDetails } from "@/features/endurance/pitwall/RawTelemetryDetails";
import type { TyreEstimate } from "@/features/endurance/pitwall/strategy/tyreGrade";
import { naarTyreEstimate, type TyreRpcClient } from "@/features/endurance/pitwall/strategy/tyreEstimateV2";
import { useTyreModel } from "@/features/endurance/pitwall/useTyreModel";
import { usePitwallStrategy } from "@/features/endurance/pitwall/usePitwallStrategy";
import { RaceTelemetryStrip } from "@/features/endurance/pitwall/RaceTelemetryStrip";
import { LiveTrackPanel } from "@/features/endurance/pitwall/LiveTrackPanel";
import { VehicleTelemetryPanel } from "@/features/endurance/pitwall/VehicleTelemetryPanel";
import { FuelPanel } from "@/features/endurance/pitwall/FuelPanel";
import { PacePanel } from "@/features/endurance/pitwall/PacePanel";
import { StandingsWidget } from "@/features/endurance/pitwall/StandingsWidget";
import { PitwallDashboard } from "@/features/endurance/pitwall/PitwallDashboard";
import { PitwallContextBar } from "@/features/endurance/pitwall/PitwallContextBar";
import { MySessionPanel } from "@/features/endurance/pitwall/MySessionPanel";
import { deriveStandings } from "@/features/endurance/pitwall/standings";
import { newestDeviceTelemetry } from "@/features/endurance/pitwall/deviceTelemetryCache";
import { devicePresence, devicePresenceLabel } from "@/features/endurance/pitwall/devicePresence";

const ONLINE_WINDOW_MS = 5 * 60_000;

const isOnline = (d?: SimHubDeviceDetail | null) =>
  Boolean(d?.health?.received_at && Date.now() - Date.parse(d.health.received_at) <= ONLINE_WINDOW_MS);

const relTime = (iso?: string | null): string => {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 5) return "nu";
  if (s < 60) return `${s}s geleden`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m geleden`;
  return `${Math.round(m / 60)}u geleden`;
};

export default function PitwallDeviceTestPage() {
  const { user, isSuperAdmin, loading, rolesLoading } = useAuth();
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const realtimeAt = useRef(0);
  useEffect(() => {
    realtimeAt.current = 0;
    if (!user || !isSuperAdmin || !deviceId) return;
    let active = true;
    const channel = supabase.channel(`pitwall-test-live-${deviceId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'simhub_telemetry_latest', filter: `device_id=eq.${deviceId}` }, change => {
        if (!active) return;
        if (change.eventType === 'DELETE') {
          realtimeAt.current = 0;
          void queryClient.invalidateQueries({ queryKey: ['pitwall-test', 'device', deviceId] });
          return;
        }
        const row = change.new as SimHubDeviceDetail['telemetry'];
        if (!row || row.device_id !== deviceId) return;
        realtimeAt.current = Date.now();
        queryClient.setQueryData<SimHubDeviceDetail>(['pitwall-test', 'device', deviceId], current => newestDeviceTelemetry(current, row, deviceId));
      }).subscribe(status => {
        if (!active) return;
        if (status !== 'SUBSCRIBED') {
          realtimeAt.current = 0;
          void queryClient.invalidateQueries({ queryKey: ['pitwall-test', 'device', deviceId] }, { cancelRefetch: false });
        }
      });
    return () => { active = false; void supabase.removeChannel(channel); };
  }, [user, isSuperAdmin, deviceId, queryClient]);

  /* Fleet: connected SimHub profiles, online-first (same read RPC as the
   * Control Room). Refreshes so new/offline devices appear without reload. */
  const fleetQuery = useQuery({
    queryKey: ["pitwall-test", "fleet"],
    enabled: Boolean(user) && Boolean(isSuperAdmin),
    queryFn: async (): Promise<SimHubFleetRow[]> => {
      const { data, error } = await (supabase.rpc as any)("get_simhub_fleet");
      if (error) throw error;
      return (data ?? []) as SimHubFleetRow[];
    },
    refetchInterval: 5_000,
  });

  /* Selected device live detail (v3 telemetry + device/health/binding). */
  const detailQuery = useQuery({
    queryKey: ["pitwall-test", "device", deviceId],
    enabled: Boolean(user) && Boolean(isSuperAdmin) && Boolean(deviceId),
    queryFn: async (): Promise<SimHubDeviceDetail> => {
      const { data, error } = await (supabase.rpc as any)("get_simhub_device_details", { p_device_id: deviceId });
      if (error) throw error;
      const result = data as SimHubDeviceDetail;
      // A slower RPC response must not replace a newer Realtime snapshot.
      const cached = queryClient.getQueryData<SimHubDeviceDetail>(['pitwall-test', 'device', deviceId]);
      return newestDeviceTelemetry(result, cached?.telemetry ?? null, deviceId!) ?? result;
    },
    refetchInterval: () => Date.now() - realtimeAt.current < 3_000 ? 5_000 : 1_000,
  });

  /* Rondes en coureurs van dit apparaat, ook zonder event. */
  const sandboxQuery = useQuery({
    queryKey: ["pitwall-test", "sandbox", deviceId],
    enabled: Boolean(user) && Boolean(isSuperAdmin) && Boolean(deviceId),
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("pitwall_sandbox_v1", { p_device_id: deviceId });
      if (error) throw error;
      return data as {
        drivers?: { name: string }[];
        lap_samples?: { lap: number; seconds: number | null; driver: string | null }[];
        pace?: { fastest: number | null; median: number | null; count: number };
      };
    },
    refetchInterval: 5_000,
  });

  const coureurs = (() => {
    const laps = sandboxQuery.data?.lap_samples ?? [];
    const perRijder = new Map<string, { ronden: number; snelste: number | null }>();
    for (const r of laps) {
      const naam = r.driver ?? "Onbekend";
      const huidig = perRijder.get(naam) ?? { ronden: 0, snelste: null };
      huidig.ronden += 1;
      if (typeof r.seconds === "number" && (huidig.snelste == null || r.seconds < huidig.snelste)) {
        huidig.snelste = r.seconds;
      }
      perRijder.set(naam, huidig);
    }
    return [...perRijder.entries()].map(([naam, w]) => ({ naam, ...w }));
  })();

  const detail = detailQuery.data ?? null;
  const online = isOnline(detail);
  const live = !detailQuery.error && isTelemetryLive(detail?.telemetry?.received_at);

  const v3: V3Normalized | null = useMemo(
    () => (detail?.telemetry?.v3_normalized as V3Normalized | null) ?? null,
    [detail],
  );
  const tele = detail?.telemetry;

  const strategy = useMemo(() => deviceStrategyRow(live ? v3 : null), [v3, live]);
  const strategyAdvice = usePitwallStrategy({ strategy, v3, nowMs: Date.now() });

  // Het bandenbeeld komt uit de servermeting (ankers), niet uit de live payload:
  // alleen de RPC weet wat er bij de laatste stop gemeten is. Sinds v2 hangt dat
  // aan het apparaat in plaats van aan een gebonden race; bestaat v2 nog niet,
  // dan valt de loader terug op v1 zodat deze dev-pagina nooit stuk gaat.
  const eventId = ((detail?.endurance_event ?? {}) as Record<string, unknown>)["id"] as string | undefined;
  const teamId = ((detail?.endurance_team ?? {}) as Record<string, unknown>)["id"] as string | undefined;
  /* Model en dekking: de twee servervragen van het bandenblok, met de sleutel op
   * het apparaat. Event en team gaan mee in de fetch (v1-terugval), niet in de
   * sleutel — die zijn immers undefined tot de detail-RPC terug is. */
  const tyre = useTyreModel({
    client: supabase as unknown as TyreRpcClient,
    deviceId,
    eventId,
    teamId,
    enabled: Boolean(user) && Boolean(isSuperAdmin),
  });
  const tyreModel = tyre.estimate;
  // Graad C gaat bewust niet naar de beslissingsband: die zegt bij C "rondes
  // onbekend" terwijl v2 juist een bereik heeft. Zie `naarTyreEstimate`.
  const tyreEstimate: TyreEstimate | null = useMemo(() => naarTyreEstimate(tyreModel), [tyreModel]);
  const position = devicePosition(v3);
  const pace = devicePace(v3);
  const raceClock = deviceRaceClock(v3);
  const standings = useMemo(() => deriveStandings(v3, 40), [v3]);

  if (loading || rolesLoading) {
    return <div className="flex min-h-screen items-center justify-center bg-background" role="status"><span className="sr-only">Toegangsrechten laden…</span></div>;
  }
  if (!user) return <Navigate to="/auth?redirect=/admin/pitwall-test" replace />;
  if (!isSuperAdmin) {
    return (
      <div className="min-h-screen bg-background" data-no-translate>
        <Navbar />
        <main className="container mx-auto flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 pt-24 text-center">
          <Lock className="h-10 w-10 text-orange-400" />
          <h1 className="font-heading text-3xl font-black text-white">GEEN TOEGANG</h1>
          <p className="max-w-md text-sm text-gray-400">
            De Pitwall Test leest live SimHub telemetrie en is beperkt tot super-admin.
          </p>
        </main>
        <Footer />
      </div>
    );
  }

  const samplePoints = (sandboxQuery.data?.lap_samples ?? [])
    .filter((r) => typeof r.seconds === "number" && Number.isFinite(r.seconds) && r.seconds > 0)
    .slice()
    .sort((a, b) => a.lap - b.lap)
    .slice(-60)
    .map((r) => ({ lap: r.lap, seconds: r.seconds as number }));

  const sessionPace = sandboxQuery.data?.pace ?? null;
  const ownDriverName = v3?.identity?.currentDriverName ?? tele?.current_driver_name ?? tele?.driver_id ?? null;
  const ownCarName = tele?.car_name ?? v3?.identity?.carName ?? null;
  const trackLabel = deviceTrackLabel(v3, tele?.track_name) || "";
  const linkedTeamName = (detail?.endurance_team as Record<string, unknown> | null)?.["name"] as string | null | undefined;

  return (
    <div className="min-h-screen bg-background" data-no-translate>
      <Navbar />
      <main className="container mx-auto max-w-[1600px] px-4 py-6">
        {/* Header */}
        <section className="mb-4 flex flex-col gap-3 rounded-xl border border-[#1D2431] bg-[#0A0C10] px-5 py-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <Cpu className="h-5 w-5 text-orange-300" />
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-400">3SM · DEV tool</p>
              <h1 className="font-heading text-xl font-black text-white">Pitwall Test — live device data</h1>
              <p className="text-xs text-gray-400">Kies een geconnecte SimHub-profiel. De track wordt automatisch herkend; strategie-velden (pit-in, fuel-to-add) tonen “—” omdat die een gebonden raceRun vereisen.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {fleetQuery.isFetching && <RefreshCw className="h-3.5 w-3.5 animate-spin text-gray-500" />}
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
          {/* ───── Device list (connected SimHub profiles) ───── */}
          <aside className="space-y-2">
            <h2 className="text-[11px] font-black uppercase tracking-widest text-gray-400">Gekoppelde SimHub profielen</h2>
            {fleetQuery.error && <p role="alert" className="text-sm text-red-300">Fleet laden mislukt.</p>}
            {!fleetQuery.error && fleetQuery.data?.length === 0 && (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-[#1D2431] bg-[#0B0D11] px-4 py-8 text-sm text-gray-500">
                <Cable className="h-7 w-7 text-gray-600" />
                <p>Geen gekoppelde apparaten</p>
              </div>
            )}
            {fleetQuery.data?.map((row) => {
              const rowOnline = row.health_received_at ? Date.now() - Date.parse(row.health_received_at) <= ONLINE_WINDOW_MS : false;
              const selected = row.device_id === deviceId;
              return (
                <button
                  key={row.device_id}
                  type="button"
                  onClick={() => setDeviceId(row.device_id)}
                  className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${
                    selected
                      ? "border-orange-500/60 bg-orange-500/[0.07] ring-1 ring-orange-500/30"
                      : "border-[#1D2431] bg-[#0B0D11] hover:bg-white/[0.04]"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${rowOnline ? "bg-emerald-400" : "bg-gray-600"}`} />
                    <span className="min-w-0 truncate font-bold text-white">{row.device_name}</span>
                    <ChevronRight className={`ml-auto h-3.5 w-3.5 shrink-0 ${selected ? "text-orange-400" : "text-gray-600"}`} />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-gray-400">
                    <span className="truncate">🏁 {rowOnline ? row.telemetry_track_name ?? "geen sessie" : "geen sessie"}</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-gray-500">
                    <span className="font-mono">{row.connector_version ?? "—"}</span>
                    <span className="h-2.5 w-px bg-white/10" />
                    <span className={rowOnline && row.game_connected ? "text-emerald-400" : ""}>
                      {devicePresenceLabel[devicePresence(rowOnline, row.game_connected)]}
                    </span>
                    {rowOnline && row.telemetry_driver_name && <span>· {row.telemetry_driver_name}</span>}
                  </div>
                </button>
              );
            })}
          </aside>

          {/* ───── Live view — hetzelfde raster als de endurance-pitwall ───── */}
          <section className="min-w-0">
            {!deviceId && (
              <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-[#1D2431] bg-[#0B0D11] px-6 py-16 text-sm text-gray-500">
                <Cpu className="h-8 w-8 text-gray-600" />
                <p>Selecteer een geconnecte SimHub-profiel links om de live pitwall te openen.</p>
              </div>
            )}

            {deviceId && detailQuery.isFetching && !detail && (
              <div className="flex items-center justify-center gap-2 py-20 text-sm text-gray-500">
                <RefreshCw className="h-4 w-4 animate-spin" /> Device laden…
              </div>
            )}

            {deviceId && detail && (
              <div className="space-y-3 bg-[#07080A]" data-pitwall-mode="test">
                <PitwallContextBar
                  eyebrow="3SM · Pitwall test"
                  title={detail.device.device_name}
                  state={live ? "live" : online ? "stale" : "offline"}
                  stateLabel={live ? "LIVE" : online ? "ONLINE — geen telemetrie" : "OFFLINE"}
                  items={[
                    { label: "Circuit", value: trackLabel || "geen sessie" },
                    { label: "Connector", value: detail.health?.connector_version ?? "—" },
                    { label: "Laatst gezien", value: relTime(detail.health?.received_at) },
                    ...(linkedTeamName ? [{ label: "Team", value: linkedTeamName, tone: "accent" as const }] : []),
                  ]}
                  note={live || online ? undefined : "Wissel naar een gebonden team-pitwall voor pit-in / fuel-to-add."}
                  actions={
                    <span className="text-[11px] text-slate-500">
                      {relTime(tele?.received_at)} · {Date.now() - realtimeAt.current < 3_000 ? "Realtime" : "1s polling"}
                    </span>
                  }
                />

                <PitwallDashboard
                  kpi={<RaceTelemetryStrip v3={v3} live={live} />}
                  decision={<DecisionBand advice={{ ...strategyAdvice, tyreEstimate }} />}
                  track={<LiveTrackPanel v3={v3} live={live} fallbackTrack={trackLabel || detail.device.device_name} />}
                  timing={
                    <StandingsWidget
                      standings={standings}
                      ownCarLabel={ownCarName ?? detail.device.device_name}
                      ownCarNumber={null}
                      live={live}
                    />
                  }
                  panels={[
                    <PacePanel key="pace" strategy={strategy} pace={pace} lapTimes={[]} points={samplePoints} />,
                    <MySessionPanel
                      key="session"
                      driverName={ownDriverName}
                      carName={ownCarName}
                      recordedLaps={sessionPace?.count ?? null}
                      fastestSeconds={sessionPace?.fastest ?? null}
                      medianSeconds={sessionPace?.median ?? null}
                    />,
                    <FuelPanel key="fuel" strategy={strategy} />,
                    <VehicleTelemetryPanel key="tyres" v3={v3} live={live} />,
                  ]}
                  extra={
                    <>
                      {/* Modelinformatie blijft: experimenteel bereik, niet beslissend. */}
                      <TyreModelPanel
                        estimate={tyreModel}
                        bron={tyre.bron}
                        coverage={tyre.coverage}
                        coverageLoading={tyre.coverageLoading}
                        coverageError={tyre.coverageError}
                        modelLoading={tyre.modelLoading}
                        v2Error={tyre.v2Error}
                      />
                      <RawTelemetryDetails value={v3} />
                      {detailQuery.isFetching && (
                        <p className="flex items-center gap-1.5 text-[10px] text-gray-500">
                          <RefreshCw className="h-3 w-3 animate-spin" /> Live telemetrie verfrist automatisch.
                        </p>
                      )}
                    </>
                  }
                />
              </div>
            )}
          </section>
        </div>

        {/* Coureurs op dit apparaat — ook zonder event, uit het rondearchief. */}
        <section className="mt-4 rounded-xl border border-[#1D2431] bg-[#0B0D11] px-5 py-4">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="text-[11px] font-black uppercase tracking-widest text-gray-400">Coureurs op dit apparaat</h2>
            <span className="text-[11px] text-gray-500">
              {sandboxQuery.data?.pace?.count ?? 0} rondes vastgelegd
              {sandboxQuery.data?.pace?.fastest != null ? ` · snelste ${sandboxQuery.data.pace.fastest.toFixed(2)} s` : ""}
            </span>
          </div>
          {coureurs.length === 0 ? (
            <p className="text-sm text-gray-500">
              Nog niemand gereden in deze sessie. Zodra er een ronde wordt afgerond, verschijnt de coureur hier.
            </p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {coureurs.map((c) => (
                <li key={c.naam} className="flex items-center justify-between rounded-xl border border-[#1D2431] bg-black/30 px-3 py-2">
                  <span className="text-sm text-white">{c.naam}</span>
                  <span className="text-xs text-gray-400">
                    {c.ronden} rondes{c.snelste != null ? ` · ${c.snelste.toFixed(2)} s` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
      <Footer />
    </div>
  );
}
