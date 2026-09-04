import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Cable,
  Car,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleX,
  Cpu,
  Fuel,
  Gauge,
  Hourglass,
  MonitorCheck,
  Radio,
  RefreshCw,
  ShieldCheck,
  Timer,
  TriangleAlert,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type {
  SimHubFleetRow,
  SimHubDeviceDetail,
  HealthStatus,
  TelemetryStatus,
  DiagnosticStatus,
  GameStatus,
  UpdaterStatus,
} from "./types";

/* ───── Human-readable diagnostic labels (Dutch) ───── */

const DIAGNOSTIC_LABELS: Record<string, string> = {
  OK: "OK",
  RAW_DATA_UNAVAILABLE: "Ruwe data niet beschikbaar",
  RAW_TELEMETRY_UNAVAILABLE: "Ruwe telemetrie niet beschikbaar",
  SESSION_TIME_READ_FAILED: "Sessietijd uitlezen mislukt",
  TELEMETRY_STALE: "Telemetrie verouderd",
  INGEST_401: "Telemetrie geweigerd: niet geautoriseerd",
  INGEST_403: "Telemetrie geweigerd",
  INGEST_429: "Te veel requests",
  INGEST_500: "Serverfout bij telemetrie",
  DEVICE_UNBOUND: "Device niet gekoppeld",
  DEVICE_REVOKED: "Device ingetrokken",
  UPDATE_CHECK_FAILED: "Updatecontrole mislukt",
  UPDATE_DOWNLOAD_FAILED: "Download update mislukt",
  UPDATE_HASH_FAILED: "Update hash ongeldig",
  UPDATE_SIGNATURE_FAILED: "Update handtekening ongeldig",
  UPDATE_INSTALL_FAILED: "Installatie update mislukt",
  UPDATE_DLL_LOCKED: "Connectorbestand in gebruik",
  UPDATE_ROLLBACK_USED: "Rollback gebruikt",
};

const diagnosticLabel = (code: string | null): string =>
  code ? DIAGNOSTIC_LABELS[code] ?? code : "—";

/* ───── Health status helpers ───── */

const healthStatus = (row: SimHubFleetRow): HealthStatus => {
  const ts = row.health_received_at ?? row.last_seen_at;
  if (!ts) return "unknown";
  const age = Date.now() - Date.parse(ts);
  if (age < 5 * 60_000) return "online";
  return "offline";
};

const telemetryStatus = (row: SimHubFleetRow): TelemetryStatus => {
  const ts = row.telemetry_received_at;
  if (!ts) return "none";
  const age = Date.now() - Date.parse(ts);
  if (age < 30_000) return "live";
  if (age < 5 * 60_000) return "stale";
  return "none";
};

const diagnosticStatus = (code: string | null): DiagnosticStatus => {
  if (!code) return "unknown";
  if (code === "OK") return "ok";
  // Missing binding is NOT a telemetry fault — it is informational/warning only.
  // Per Vincent's device-scoped ingest decision: binding controls routing, not acceptance.
  if (code === "DEVICE_UNBOUND") return "warning";
  // Transient / data-availability conditions are warnings, not errors.
  if (["RAW_DATA_UNAVAILABLE", "RAW_TELEMETRY_UNAVAILABLE", "TELEMETRY_STALE", "INGEST_429"].includes(code)) return "warning";
  // Genuine auth / revocation / ingest failures remain errors.
  if (["DEVICE_REVOKED", "INGEST_401", "INGEST_403", "INGEST_500"].includes(code)) return "error";
  // Updater install failures are errors.
  if (code.startsWith("UPDATE_")) return "error";
  return "error";
};

const gameStatus = (connected: boolean | null): GameStatus => {
  if (connected === null) return "unknown";
  return connected ? "connected" : "disconnected";
};

/**
 * Bepaal de updater status, case-insensitive.
 * "success" / "SUCCESS" / "OK" / "UP_TO_DATE" all count as success.
 */
const updaterStatus = (
  installed: string | null,
  updaterState: string | null,
  lastResult: string | null,
): UpdaterStatus => {
  if (!installed && !updaterState) return "unknown";

  const state = (updaterState ?? "").toUpperCase();
  const result = (lastResult ?? "").toUpperCase();

  if (state === "DOWNLOADING" || state === "INSTALLING" || state === "WAITING_FOR_RESTART") return "updating";
  if (state === "FAILED") return "failed";

  // Historical failed result is NOT a current failure if the installed version is healthy
  // and updater state is IDLE/SUCCESS.
  if (result && !["SUCCESS", "OK", "UP_TO_DATE", "NONE", ""].includes(result)) {
    return "failed";
  }

  return "current";
};

/* ───── Styled status badges ───── */

const StatusBadge = ({ label, color }: { label: string; color: string }) => (
  <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-bold ${color}`}>{label}</span>
);

const OnlineBadge = () => <StatusBadge label="Online" color="bg-emerald-400/15 text-emerald-300 ring-1 ring-emerald-400/25" />;
const OfflineBadge = () => <StatusBadge label="Offline" color="bg-gray-500/10 text-gray-500 ring-1 ring-gray-500/15" />;
const UnknownBadge = () => <StatusBadge label="Onbekend" color="bg-gray-500/10 text-gray-400 ring-1 ring-gray-500/15" />;
const LiveBadge = () => <StatusBadge label="Live" color="bg-emerald-400/15 text-emerald-300 ring-1 ring-emerald-400/25" />;
const StaleBadge = () => <StatusBadge label="Verouderd" color="bg-amber-400/15 text-amber-300 ring-1 ring-amber-400/25" />;
const NoneBadge = () => <StatusBadge label="Geen" color="bg-gray-500/10 text-gray-400 ring-1 ring-gray-400/15" />;
const GameOnBadge = () => <StatusBadge label="Verbonden" color="bg-emerald-400/15 text-emerald-300 ring-1 ring-emerald-400/25" />;
const GameOffBadge = () => <StatusBadge label="Niet verbonden" color="bg-gray-500/10 text-gray-400 ring-1 ring-gray-500/15" />;
const DiagOkBadge = () => <StatusBadge label="OK" color="bg-emerald-400/15 text-emerald-300 ring-1 ring-emerald-400/25" />;
const DiagWarningBadge = () => <StatusBadge label="Waarschuwing" color="bg-amber-400/15 text-amber-300 ring-1 ring-amber-400/25" />;
const DiagErrorBadge = () => <StatusBadge label="Fout" color="bg-red-400/15 text-red-300 ring-1 ring-red-400/25" />;
const DiagUnknownBadge = () => <StatusBadge label="Onbekend" color="bg-gray-500/10 text-gray-400 ring-1 ring-gray-500/15" />;
const UpToDateBadge = () => <StatusBadge label="Actueel" color="bg-emerald-400/15 text-emerald-300 ring-1 ring-emerald-400/25" />;
const UpdateAvailableBadge = () => <StatusBadge label="Update beschikbaar" color="bg-amber-400/15 text-amber-300 ring-1 ring-amber-400/25" />;
const UpdateBusyBadge = () => <StatusBadge label="Update bezig" color="bg-blue-400/15 text-blue-300 ring-1 ring-blue-400/25" />;
const UpdateFailedBadge = () => <StatusBadge label="Update mislukt" color="bg-red-400/15 text-red-300 ring-1 ring-red-400/25" />;
const PrimaryBadge = () => <StatusBadge label="Primair" color="bg-orange-400/15 text-orange-300 ring-1 ring-orange-400/25" />;
const StandbyBadge = () => <StatusBadge label="Standby" color="bg-blue-400/15 text-blue-300 ring-1 ring-blue-400/25" />;
const PracticeBadge = () => <StatusBadge label="Practice" color="bg-violet-400/15 text-violet-300 ring-1 ring-violet-400/25" />;
const BoundBadge = () => <StatusBadge label="Gekoppeld" color="bg-orange-400/15 text-orange-300 ring-1 ring-orange-400/25" />;
const UnboundBadge = () => <StatusBadge label="Niet gekoppeld" color="bg-gray-500/10 text-gray-400 ring-1 ring-gray-500/15" />;

/* ───── Helpers ───── */

const relativeTime = (iso: string | null): string => {
  if (!iso) return "—";
  const ms = Date.now() - Date.parse(iso);
  if (ms < 0) return "0s geleden";
  if (ms < 1_000) return "0s geleden";
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s geleden`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m geleden`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}u geleden`;
  const days = Math.floor(hours / 24);
  return `${days}d geleden`;
};

/** Safe numeric display: returns formatted string for finite numbers, "—" otherwise. */
const safeNum = (value: unknown, decimals = 1): string => {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(decimals) : "—";
};

const deviceRoleLabel = (role: string | null) => {
  switch (role) {
    case "primary": return <PrimaryBadge />;
    case "standby": return <StandbyBadge />;
    case "practice": return <PracticeBadge />;
    default: return <StatusBadge label="—" color="bg-gray-500/10 text-gray-400 ring-1 ring-gray-500/15" />;
  }
};

const healthBadge = (status: HealthStatus) => {
  switch (status) {
    case "online": return <OnlineBadge />;
    case "offline": return <OfflineBadge />;
    default: return <UnknownBadge />;
  }
};

const telemetryBadge = (status: TelemetryStatus) => {
  switch (status) {
    case "live": return <LiveBadge />;
    case "stale": return <StaleBadge />;
    default: return <NoneBadge />;
  }
};

const updaterBadge = (status: UpdaterStatus) => {
  switch (status) {
    case "current": return <UpToDateBadge />;
    case "update_available": return <UpdateAvailableBadge />;
    case "updating": return <UpdateBusyBadge />;
    case "failed": return <UpdateFailedBadge />;
    default: return <UnknownBadge />;
  }
};

const diagBadge = (status: DiagnosticStatus) => {
  switch (status) {
    case "ok": return <DiagOkBadge />;
    case "warning": return <DiagWarningBadge />;
    case "error": return <DiagErrorBadge />;
    default: return <DiagUnknownBadge />;
  }
};

/* ───── Fleet overview row ───── */

const FleetRow = ({ row, onClick }: { row: SimHubFleetRow; onClick: () => void }) => {
  const hStatus = healthStatus(row);
  const tStatus = telemetryStatus(row);
  const dStatus = diagnosticStatus(row.diagnostic_code);
  const gStatus = gameStatus(row.game_connected);
  const uStatus = updaterStatus(row.connector_version, row.updater_state, row.last_update_result);
  const isOnline = hStatus === "online";
  const hasBinding = !!(row.endurance_event_name || row.endurance_event_id);

  return (
    <button
      onClick={onClick}
      className="group grid w-full grid-cols-[1.35fr_.9fr_.9fr_.9fr_.75fr_.75fr_1.1fr_1fr] gap-3 border-t border-white/[0.06] px-5 py-3 text-left text-sm transition hover:bg-white/[0.02]"
    >
      {/* Device name with status dot */}
      <span className="flex items-center gap-2.5 min-w-0">
        <span className={`h-2 w-2 shrink-0 rounded-full ${isOnline ? "bg-emerald-400 shadow-sm shadow-emerald-400/30" : "bg-gray-600"}`} />
        <span className="truncate font-bold text-white">{row.device_name}</span>
      </span>

      {/* Version */}
      <span className="self-center font-mono text-xs text-gray-300">
        {row.connector_version ?? "—"}
      </span>

      {/* Last seen */}
      <span className={`self-center text-xs ${isOnline ? "text-emerald-300" : "text-gray-400"}`}>
        {relativeTime(row.health_received_at ?? row.last_seen_at)}
      </span>

      {/* Telemetry */}
      <span className="self-center">{telemetryBadge(tStatus)}</span>

      {/* Game */}
      <span className="self-center">{gStatus === "connected" ? <GameOnBadge /> : gStatus === "disconnected" ? <GameOffBadge /> : <UnknownBadge />}</span>

      {/* Role */}
      <span className="self-center">{deviceRoleLabel(row.device_role)}</span>

      {/* Binding — human-readable name */}
      <span className="self-center truncate text-xs min-w-0">
        {hasBinding ? (
          <span className="flex items-center gap-1.5">
            <BoundBadge />
            <span className="text-gray-300 truncate">{row.endurance_event_name ?? row.endurance_team_name ?? "Actief"}</span>
          </span>
        ) : (
          <UnboundBadge />
        )}
        <span className="sr-only">Binding bepaalt alleen aan welk Endurance-team/event telemetrie wordt gekoppeld; een niet-gekoppeld apparaat kan wél telemetrie sturen.</span>
      </span>

      {/* Diagnostic + updater warnings */}
      <span className="flex items-center gap-2 self-center justify-self-end">
        {diagBadge(dStatus)}
        {uStatus === "failed" && (
          <span className="shrink-0">{updaterBadge(uStatus)}</span>
        )}
      </span>
    </button>
  );
};

/* ───── Fleet overview ───── */

const FleetOverview = ({ onSelect }: { onSelect: (id: string) => void }) => {
  const { user, isAdmin, isSuperAdmin } = useAuth();
  const staff = Boolean(isAdmin || isSuperAdmin);

  const { data: fleet = [], isFetching } = useQuery({
    queryKey: ["simhub", "fleet"],
    enabled: !!user && staff,
    queryFn: async (): Promise<SimHubFleetRow[]> => {
      const { data, error } = await (supabase.rpc as any)("get_simhub_fleet");
      if (error) throw error;
      return (data ?? []) as SimHubFleetRow[];
    },
    refetchInterval: staff ? 10_000 : false,
  });

  const summary = useMemo(() => {
    const total = fleet.length;
    let online = 0;
    let offline = 0;
    let telemetryLive = 0;
    let warnings = 0;

    for (const row of fleet) {
      if (healthStatus(row) === "online") online++;
      else offline++;
      if (telemetryStatus(row) === "live") telemetryLive++;
      // Only count CURRENT warnings visible in the row
      if (diagnosticStatus(row.diagnostic_code) !== "ok" && row.diagnostic_code !== null) warnings++;
      if (updaterStatus(row.connector_version, row.updater_state, row.last_update_result) === "failed") warnings++;
    }

    return { total, online, offline, telemetryLive, warnings };
  }, [fleet]);

  return (
    <div className="space-y-4">
      {/* Header — compact */}
      <section className="flex flex-col gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.025] px-5 py-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <Cpu className="h-5 w-5 text-orange-300 shrink-0" />
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-400">SimHub connectors</p>
            <h2 className="font-heading text-xl font-black text-white">Connectoroverzicht</h2>
            <p className="text-xs text-gray-400">Realtime status van gekoppelde SimHub-apparaten</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isFetching && <RefreshCw className="h-3.5 w-3.5 animate-spin text-gray-500" />}
        </div>
      </section>

      {/* Summary metrics — compact */}
      <section className="grid gap-2.5 grid-cols-5">
        {[
          [String(summary.total), "Totaal", "text-white"],
          [String(summary.online), "Online", "text-emerald-300"],
          [String(summary.offline), "Offline", "text-gray-400"],
          [String(summary.telemetryLive), "Telemetrie live", "text-emerald-300"],
          [String(summary.warnings), "Waarschuwingen", summary.warnings > 0 ? "text-amber-300" : "text-gray-400"],
        ].map(([value, label, color]) => (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] px-4 py-3" key={label}>
            <p className={`font-heading text-xl font-black ${color}`}>{value}</p>
            <p className="text-[11px] text-gray-400/80">{label}</p>
          </div>
        ))}
      </section>

      {/* Fleet table */}
      <section className="overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.025]">
        {/* Column headers */}
        <div className="grid grid-cols-[1.35fr_.9fr_.9fr_.9fr_.75fr_.75fr_1.1fr_1fr] gap-3 bg-white/[0.035] px-5 py-2.5 text-[10px] font-black uppercase tracking-wider text-gray-400/70">
          <span>Device</span>
          <span>Versie</span>
          <span>Laatst gezien</span>
          <span>Telemetrie</span>
          <span>Game</span>
          <span>Rol</span>
          <span>Binding</span>
          <span className="text-right">Status</span>
        </div>

        {/* Rows */}
        {fleet.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-5 py-10 text-sm text-gray-500">
            <Cable className="h-8 w-8 text-gray-600" />
            <p>Geen connectoren gevonden</p>
          </div>
        )}
        {fleet.map((row) => (
          <FleetRow key={row.device_id} row={row} onClick={() => onSelect(row.device_id)} />
        ))}
      </section>
    </div>
  );
};

/* ───── Device detail view ───── */

const DeviceDetail = ({ deviceId, onBack }: { deviceId: string; onBack: () => void }) => {
  const { user, isAdmin, isSuperAdmin } = useAuth();
  const staff = Boolean(isAdmin || isSuperAdmin);
  const [showAllEvents, setShowAllEvents] = useState(false);

  const { data: detail, isFetching } = useQuery({
    queryKey: ["simhub", "device-detail", deviceId],
    enabled: !!user && staff && !!deviceId,
    queryFn: async (): Promise<SimHubDeviceDetail> => {
      const { data, error } = await (supabase.rpc as any)("get_simhub_device_details", { p_device_id: deviceId });
      if (error) throw error;
      return data as SimHubDeviceDetail;
    },
    refetchInterval: staff ? 5_000 : false,
  });

  if (isFetching && !detail) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw className="h-5 w-5 animate-spin text-gray-500" />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex flex-col items-center gap-3 py-20 text-gray-500">
        <CircleX className="h-7 w-7 text-gray-600" />
        <p className="text-sm">Device niet gevonden</p>
        <button onClick={onBack} className="text-xs font-bold text-orange-300 hover:text-orange-200">Terug naar overzicht</button>
      </div>
    );
  }

  const device = detail.device;
  const health = detail.health;
  const tele = detail.telemetry;
  const evt = detail.endurance_event as Record<string, unknown> | null;
  const team = detail.endurance_team as Record<string, unknown> | null;

  const fleetProxy: SimHubFleetRow = {
    device_id: device.id,
    device_name: device.device_name,
    device_status: device.device_status as "active_binding" | "inactive" | "revoked",
    device_role: device.device_role as "primary" | "standby" | "practice" | null,
    revoked_at: device.revoked_at,
    last_seen_at: device.last_seen_at,
    endurance_event_id: device.endurance_event_id,
    endurance_team_id: device.endurance_team_id,
    endurance_binding_source: device.endurance_binding_source,
    endurance_event_name: evt?.name as string | null ?? null,
    endurance_team_name: team?.name as string | null ?? null,
    connector_version: health?.connector_version ?? null,
    simhub_version: health?.simhub_version ?? null,
    game_connected: health?.game_connected ?? null,
    telemetry_available: health?.telemetry_available ?? null,
    diagnostic_code: health?.diagnostic_code ?? null,
    health_received_at: health?.received_at ?? null,
    updater_state: health?.updater_state ?? null,
    updater_current_version: health?.updater_current_version ?? null,
    updater_target_version: health?.updater_target_version ?? null,
    last_update_result: health?.last_update_result ?? null,
    last_update_utc: health?.last_update_utc ?? null,
    telemetry_received_at: tele?.received_at ?? null,
    telemetry_game: tele?.game ?? null,
    telemetry_car_name: tele?.car_name ?? null,
    telemetry_track_name: tele?.track_name ?? null,
    telemetry_driver_name: tele?.current_driver_name ?? null,
  };

  const hStatus = healthStatus(fleetProxy);
  const isOnline = hStatus === "online";
  const tStatus = telemetryStatus(fleetProxy);
  const gStatus = gameStatus(health?.game_connected ?? null);
  const uStatus = updaterStatus(health?.connector_version ?? null, health?.updater_state ?? null, health?.last_update_result ?? null);

  const DetailCard = ({ icon: Icon, title, subtitle, children }: { icon: typeof Activity; title: string; subtitle?: string; children: React.ReactNode }) => (
    <section className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-orange-300 shrink-0" />
        <h3 className="font-heading text-sm font-black text-white">{title}</h3>
        {subtitle && <span className="text-[10px] text-gray-500">{subtitle}</span>}
      </div>
      <div className="space-y-2.5 text-sm">{children}</div>
    </section>
  );

  const InfoRow = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-gray-400/80">{label}</span>
      <span className="text-right text-xs text-gray-200">{value}</span>
    </div>
  );

  // Parse V3 telemetry
  const v3 = tele?.v3_normalized as Record<string, unknown> | null;
  const fuel = v3?.fuel ?? (tele?.telemetry as Record<string, unknown>)?.fuel;
  const completedLaps = v3?.completedLaps ?? (tele?.telemetry as Record<string, unknown>)?.completedLaps;
  const inPit = v3?.inPit ?? (tele?.telemetry as Record<string, unknown>)?.inPit;
  const trackName = tele?.track_name ?? v3?.trackName ?? "—";
  const carName = tele?.car_name ?? v3?.carName ?? "—";
  const driverName = tele?.current_driver_name ?? v3?.driverName ?? "—";
  const eventName = evt?.name as string | null ?? null;
  const teamName = team?.name as string | null ?? null;

  return (
    <div className="space-y-4">
      {/* Back button */}
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-bold text-gray-400 hover:bg-white/5 hover:text-white"
      >
        <ChevronLeft className="h-4 w-4" />
        Terug naar overzicht
      </button>

      {/* Device header */}
      <section className="flex flex-col gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.025] px-5 py-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <span className={`flex h-3 w-3 shrink-0 rounded-full ${isOnline ? "bg-emerald-400 shadow-sm shadow-emerald-400/30" : "bg-gray-600"}`} />
          <div>
            <h2 className="font-heading text-xl font-black text-white">{device.device_name}</h2>
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-gray-400">{health?.connector_version ?? "—"}</span>
              {deviceRoleLabel(device.device_role)}
              <span className="text-[11px] text-gray-400/70">{relativeTime(device.last_seen_at)}</span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">{healthBadge(hStatus)}</div>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Connection / Health */}
        <DetailCard icon={Activity} title="Verbinding & gezondheid">
          <InfoRow label="Diagnostiek" value={diagBadge(diagnosticStatus(health?.diagnostic_code ?? null))} />
          <InfoRow label="SimHub versie" value={<span className="font-mono text-gray-300">{health?.simhub_version ?? "—"}</span>} />
          <InfoRow label="Game" value={gStatus === "connected" ? <GameOnBadge /> : gStatus === "disconnected" ? <GameOffBadge /> : <UnknownBadge />} />
          <InfoRow label="Telemetrie" value={telemetryBadge(tStatus)} />
          <InfoRow label="Laatste health" value={relativeTime(health?.received_at ?? null)} />
          <InfoRow label="Sequence" value={<span className="font-mono text-gray-300">{health?.sequence ?? "—"}</span>} />
          {health?.client_last_ingest_http_status != null && (
            <InfoRow label="Laatste HTTP" value={String(health.client_last_ingest_http_status)} />
          )}
        </DetailCard>

        {/* Telemetry */}
        <DetailCard icon={Car} title="Telemetrie">
          <InfoRow label="Game" value={tele?.game ?? "—"} />
          <InfoRow label="Auto" value={String(carName)} />
          <InfoRow label="Circuit" value={String(trackName)} />
          <InfoRow label="Coureur" value={String(driverName)} />
          <InfoRow label="Ronden" value={safeNum(completedLaps, 0) !== "—" ? safeNum(completedLaps, 0) : "—"} />
          <InfoRow label="Brandstof" value={safeNum(fuel) !== "—" ? `${safeNum(fuel)}L` : "—"} />
          <InfoRow label="In pit" value={inPit ? "Ja" : "Nee"} />
          <InfoRow label="Laatst ontvangen" value={relativeTime(tele?.received_at ?? null)} />
          {tele?.session_id && <InfoRow label="Sessie" value={<span className="font-mono text-gray-400/70 text-[10px]">{tele.session_id.slice(0, 12)}</span>} />}
        </DetailCard>

        {/* Binding / Authority */}
        <DetailCard icon={ShieldCheck} title="Binding & autoriteit">
          <InfoRow label="Status" value={
            device.device_status === "active_binding" ? <StatusBadge label="Actief" color="bg-emerald-400/15 text-emerald-300 ring-1 ring-emerald-400/25" /> :
            device.device_status === "inactive" ? <StatusBadge label="Inactief" color="bg-gray-500/10 text-gray-400 ring-1 ring-gray-500/15" /> :
            <StatusBadge label="Ingetrokken" color="bg-red-400/15 text-red-300 ring-1 ring-red-400/25" />
          } />
          <InfoRow label="Rol" value={deviceRoleLabel(device.device_role)} />
          <InfoRow label="Event" value={eventName ?? device.endurance_event_id?.slice(0, 8) ?? "—"} />
          <InfoRow label="Team" value={teamName ?? device.endurance_team_id?.slice(0, 8) ?? "—"} />
          <InfoRow label="Bron" value={device.endurance_binding_source ?? "—"} />
          {device.revoked_at && <InfoRow label="Ingetrokken op" value={new Date(device.revoked_at).toLocaleString("nl-NL")} />}
        </DetailCard>

        {/* Updates — use corrected updater logic */}
        <DetailCard icon={RefreshCw} title="Updates">
          <InfoRow label="Geïnstalleerd" value={<span className="font-mono text-gray-300">{health?.updater_current_version ?? health?.connector_version ?? "—"}</span>} />
          <InfoRow label="Updater status" value={
            uStatus === "current" ? <UpToDateBadge /> :
            uStatus === "updating" ? <UpdateBusyBadge /> :
            uStatus === "failed" ? <UpdateFailedBadge /> :
            uStatus === "update_available" ? <UpdateAvailableBadge /> :
            <UnknownBadge />
          } />
          {health?.updater_target_version && (
            <InfoRow label="Doelversie" value={<span className="font-mono text-gray-300">{health.updater_target_version}</span>} />
          )}
          <InfoRow label="Laatste resultaat" value={
            (health?.last_update_result && !["success", "SUCCESS", "OK", "UP_TO_DATE", "none"].includes(health.last_update_result.toUpperCase())) ?
              <span className="font-bold text-red-300">{health.last_update_result}</span> : <span className="text-gray-400/70">{health?.last_update_result ?? "—"}</span>
          } />
          <InfoRow label="Laatste update" value={relativeTime(health?.last_update_utc ?? null)} />
        </DetailCard>
      </div>

      {/* Diagnostic events */}
      <section className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
        <div className="mb-3 flex items-center gap-2">
          <CircleAlert className="h-4 w-4 text-orange-300 shrink-0" />
          <h3 className="font-heading text-sm font-black text-white">Diagnostiek geschiedenis</h3>
          <span className="text-[10px] text-gray-500">
            {showAllEvents ? `(max 20 recentste)` : `(laatste ${Math.min(8, detail.diagnostic_events.length)} van ${detail.diagnostic_events.length})`}
          </span>
        </div>
        {detail.diagnostic_events.length === 0 ? (
          <p className="text-sm text-gray-400/70">Geen diagnostische events gevonden.</p>
        ) : (
          <div className="space-y-1.5">
            {(showAllEvents ? detail.diagnostic_events : detail.diagnostic_events.slice(0, 8)).map((event) => (
              <div
                key={event.id}
                className="flex items-start gap-3 rounded-lg border border-white/[0.06] bg-black/10 px-4 py-2"
              >
                <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
                  event.code === "OK" ? "bg-emerald-400" : "bg-red-400"
                }`} />
                <div className="min-w-0 flex-1">
                  <span className="text-xs font-bold text-gray-200">{diagnosticLabel(event.code)}</span>
                  {event.detail && (
                    <span className="ml-2 text-[11px] text-gray-400/70">· {event.detail}</span>
                  )}
                  {event.exception_type && (
                    <span className="ml-2 text-[10px] font-mono text-gray-500">{event.exception_type}</span>
                  )}
                </div>
                <span className="shrink-0 text-[10px] text-gray-400/70">{relativeTime(event.received_at)}</span>
              </div>
            ))}
            {detail.diagnostic_events.length > 8 && (
              <button
                onClick={() => setShowAllEvents(!showAllEvents)}
                className="flex items-center gap-1.5 text-xs font-bold text-orange-300 hover:text-orange-200 pt-1"
              >
                {showAllEvents ? "Toon minder" : `Toon meer (${detail.diagnostic_events.length - 8} verborgen)`}
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
};

/* ───── Main connectors module ───── */

const SimHubConnectorsModule = () => {
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  if (selectedDeviceId) {
    return <DeviceDetail deviceId={selectedDeviceId} onBack={() => setSelectedDeviceId(null)} />;
  }

  return <FleetOverview onSelect={setSelectedDeviceId} />;
};

export default SimHubConnectorsModule;