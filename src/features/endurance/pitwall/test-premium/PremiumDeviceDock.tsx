import type { ReactNode } from "react";
import type { SimHubFleetRow } from "@/features/control-room/connectors/types";
import { devicePresence, devicePresenceLabel } from "../devicePresence";

const ONLINE_WINDOW_MS = 5 * 60_000;

const isOnline = (iso?: string | null): boolean =>
  Boolean(iso && Date.now() - Date.parse(iso) <= ONLINE_WINDOW_MS);

/**
 * Premium apparaatdock: dezelfde echte `get_simhub_fleet`-rijen als de klassieke
 * zijbalk, maar horizontaal en compact. Zo houdt het dashboard op 1920px de
 * volle breedte voor timing en circuit, terwijl alle profielen bereikbaar
 * blijven. Offline profielen worden niet verstopt of verzonnen.
 */
export function PremiumDeviceDock({
  rows,
  selectedId,
  onSelect,
  loading,
  error,
  controls,
}: {
  rows: SimHubFleetRow[] | undefined;
  selectedId: string | null;
  onSelect: (deviceId: string) => void;
  loading: boolean;
  error: boolean;
  /** Testweergave en beweging horen in de dock, zodat ze geen eigen rij kosten. */
  controls?: ReactNode;
}) {
  const list = rows ?? [];
  const onlineCount = list.filter((row) => isOnline(row.health_received_at)).length;

  return (
    <section className="ptp-dock" aria-label="Gekoppelde SimHub profielen">
      <div className="ptp-dock-head">
        <div>
          <p className="ptp-kicker">SimHub devices</p>
          <h2>
            Gekoppelde profielen <span className="ptp-count">{list.length}</span>
          </h2>
        </div>
        <p className="ptp-dock-status">
          <span className={onlineCount > 0 ? "is-on" : "is-off"} aria-hidden />
          {onlineCount} online
          {loading && <span className="ptp-dock-loading">· verversen</span>}
        </p>
        {controls && <div className="ptp-dock-controls">{controls}</div>}
      </div>

      {error && <p role="alert" className="ptp-dock-empty">Fleet laden mislukt.</p>}
      {!error && !loading && list.length === 0 && (
        <p className="ptp-dock-empty">Geen gekoppelde apparaten.</p>
      )}

      {list.length > 0 && (
        <div className="ptp-dock-scroll" role="group" aria-label="Kies een SimHub-profiel">
          {list.map((row) => {
            const online = isOnline(row.health_received_at);
            const selected = row.device_id === selectedId;
            return (
              <button
                key={row.device_id}
                type="button"
                aria-pressed={selected}
                onClick={() => onSelect(row.device_id)}
                className="ptp-device"
                data-selected={selected ? "true" : undefined}
                title={`${row.device_name} · ${online ? row.telemetry_track_name ?? "geen sessie" : "geen sessie"} · ${devicePresenceLabel[devicePresence(online, row.game_connected)]}`}
              >
                <span className="ptp-device-line">
                  <span className={online ? "ptp-device-dot is-on" : "ptp-device-dot"} aria-hidden />
                  <span className="ptp-device-name">{row.device_name}</span>
                  <span className="ptp-device-version">{row.connector_version ?? "—"}</span>
                </span>
                <span className="ptp-device-meta">
                  <span className="ptp-device-track">
                    {online ? row.telemetry_track_name ?? "geen sessie" : "geen sessie"}
                  </span>
                  <span className="ptp-device-presence">
                    {devicePresenceLabel[devicePresence(online, row.game_connected)]}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
