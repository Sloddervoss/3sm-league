import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
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
import { TopRaceBar } from "@/features/endurance/pitwall/TopRaceBar";
import { RaceTelemetryStrip } from "@/features/endurance/pitwall/RaceTelemetryStrip";
import { LiveTrackPanel } from "@/features/endurance/pitwall/LiveTrackPanel";
import { VehicleTelemetryPanel } from "@/features/endurance/pitwall/VehicleTelemetryPanel";
import { FuelPanel } from "@/features/endurance/pitwall/FuelPanel";
import { RacePositionPanel } from "@/features/endurance/pitwall/RacePositionPanel";
import { PacePanel } from "@/features/endurance/pitwall/PacePanel";
import { StandingsWidget } from "@/features/endurance/pitwall/StandingsWidget";
import { deriveStandings } from "@/features/endurance/pitwall/standings";

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
  const [showRaw, setShowRaw] = useState(false);

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
      return data as SimHubDeviceDetail;
    },
    refetchInterval: 2_000,
  });

  const detail = detailQuery.data ?? null;
  const online = isOnline(detail);
  const live = isTelemetryLive(detail?.telemetry?.received_at);

  const v3: V3Normalized | null = useMemo(
    () => (detail?.telemetry?.v3_normalized as V3Normalized | null) ?? null,
    [detail],
  );
  const tele = detail?.telemetry;

  const strategy = useMemo(() => deviceStrategyRow(live ? v3 : null), [v3, live]);
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

  return (
    <div className="min-h-screen bg-background" data-no-translate>
      <Navbar />
      <main className="container mx-auto max-w-[1600px] px-4 py-6">
        {/* Header */}
        <section className="mb-4 flex flex-col gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.025] px-5 py-4 md:flex-row md:items-center md:justify-between">
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
              <div className="flex flex-col items-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-8 text-sm text-gray-500">
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
                      : "border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.04]"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${rowOnline ? "bg-emerald-400" : "bg-gray-600"}`} />
                    <span className="min-w-0 truncate font-bold text-white">{row.device_name}</span>
                    <ChevronRight className={`ml-auto h-3.5 w-3.5 shrink-0 ${selected ? "text-orange-400" : "text-gray-600"}`} />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-gray-400">
                    <span className="truncate">🏁 {row.telemetry_track_name ?? "geen sessie"}</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-gray-500">
                    <span className="font-mono">{row.connector_version ?? "—"}</span>
                    <span className="h-2.5 w-px bg-white/10" />
                    <span className={row.game_connected ? "text-emerald-400" : ""}>{row.game_connected ? "Game aan" : "Game uit"}</span>
                    {row.telemetry_driver_name && <span>· {row.telemetry_driver_name}</span>}
                  </div>
                </button>
              );
            })}
          </aside>

          {/* ───── Live view ───── */}
          <section className="min-w-0">
            {!deviceId && (
              <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-16 text-sm text-gray-500">
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
              <div className="space-y-3">
                {/* Device header strip */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-black/50 px-4 py-2 text-xs ring-1 ring-white/8">
                  <span className={`inline-flex items-center gap-1.5 font-bold ${live ? "text-emerald-400" : "text-gray-400"}`}>
                    <span className={`inline-block h-1.5 w-1.5 rounded-full bg-current`} />
                    {live ? "LIVE" : online ? "ONLINE — geen telemetrie" : "OFFLINE"}
                  </span>
                  <span className="h-4 w-px bg-white/10" />
                  <span className="font-bold text-white">{detail.device.device_name}</span>
                  <span className="font-mono text-gray-400">{detail.health?.connector_version ?? "—"}</span>
                  <span className="h-4 w-px bg-white/10" />
                  <span className="text-gray-400">Laatst gezien: <span className="text-gray-200">{relTime(detail.health?.received_at)}</span></span>
                  {detail.endurance_team ? (
                    <span className="rounded bg-orange-500/15 px-2 py-0.5 font-bold text-orange-300 ring-1 ring-orange-500/20">
                      Gekoppeld · {((detail.endurance_event ?? {}).name as string | null) ?? "team"}
                    </span>
                  ) : (
                    <span className="rounded bg-white/8 px-2 py-0.5 font-bold text-gray-400 ring-1 ring-white/10">Niet gekoppeld</span>
                  )}
                  {(detail.endurance_team as Record<string, unknown> | null)?.["name"]
                    ? null
                    : (
                      <span className="ml-auto text-gray-500 text-[10px]">
                        Wissel naar een gebonden team-pitwall voor pit-in / fuel-to-add.
                      </span>
                    )}
                </div>

                {/* Track auto-detect + telemetry strip */}
                <TopRaceBar strategy={strategy} position={position} raceClock={raceClock} offlineMode={!live} />
                <RaceTelemetryStrip v3={v3} live={live} />

                <div className="grid gap-3 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.6fr)]">
                  <div className="min-w-0 space-y-3">
                    <LiveTrackPanel v3={v3} live={live} fallbackTrack={deviceTrackLabel(v3, tele?.track_name) || detail.device.device_name} />
                    <VehicleTelemetryPanel v3={v3} live={live} />
                  </div>
                  <div className="min-w-0 space-y-3">
                    <StandingsWidget standings={standings} ownCarLabel={tele?.car_name ?? detail.device.device_name} ownCarNumber={null} />
                    <div className="grid gap-3 md:grid-cols-3">
                      <FuelPanel strategy={strategy} />
                      <RacePositionPanel strategy={strategy} position={position} />
                      <PacePanel strategy={strategy} pace={pace} />
                    </div>
                  </div>
                </div>

                {/* Raw telemetry toggle for debugging */}
                <details className="rounded-lg border border-white/10 bg-white/[0.02]">
                  <summary
                    className="cursor-pointer px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-gray-400 select-none"
                    onClick={(e) => { e.preventDefault(); setShowRaw((s) => !s); }}
                  >
                    {showRaw ? "Verberg" : "Toon"} raw telemetrie (JSON)
                  </summary>
                  {showRaw && (
                    <pre className="max-h-[420px] overflow-auto border-t border-white/10 px-4 py-3 text-[10px] leading-relaxed text-gray-300">
                      {JSON.stringify(v3, null, 2)}
                    </pre>
                  )}
                </details>

                {detailQuery.isFetching && (
                  <p className="flex items-center gap-1.5 text-[10px] text-gray-500">
                    <RefreshCw className="h-3 w-3 animate-spin" /> Live telemetrie verfrist automatisch.
                  </p>
                )}
              </div>
            )}
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}