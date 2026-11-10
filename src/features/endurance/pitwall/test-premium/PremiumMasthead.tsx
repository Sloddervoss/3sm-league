import type { PitwallConnectionState } from "../PitwallContextBar";

const statusCopy: Record<PitwallConnectionState, { label: string; tone: string }> = {
  live: { label: "LIVE", tone: "is-live" },
  stale: { label: "ONLINE · GEEN TELEMETRIE", tone: "is-stale" },
  offline: { label: "OFFLINE", tone: "is-offline" },
};

/**
 * Compacte contextkop. Geen grote lege hero: één titel, één identiteitsregel en
 * een korte metarij met uitsluitend bronwaarden. De verbindingsstatus is de
 * enige plek met LIVE/VERTRAAGD/OFFLINE.
 */
export function PremiumMasthead({
  deviceName,
  trackLabel,
  driverName,
  carName,
  teamName,
  connector,
  lastSeen,
  state,
  sectorCount,
  refreshing,
}: {
  deviceName: string;
  trackLabel: string;
  driverName: string | null;
  carName: string | null;
  teamName: string | null;
  connector: string | null;
  lastSeen: string;
  state: PitwallConnectionState;
  sectorCount: number;
  refreshing: boolean;
}) {
  const copy = statusCopy[state];
  return (
    <header className="ptp-masthead" data-pitwall-connection={state}>
      <div className="ptp-brandline">
        <span className="ptp-brand">3SM</span>
        <span className="ptp-brand-sub">RACE OPERATIONS</span>
        <span className="ptp-brand-rule" aria-hidden />
        <span className="ptp-brand-tag">PITWALL TEST</span>
      </div>

      <div className="ptp-mast-main">
        <div className="ptp-mast-title">
          <p className="ptp-kicker">Live device</p>
          <h1>{deviceName}</h1>
          <p className="ptp-mast-sub">
            {trackLabel || "Geen sessie"}
            {driverName ? ` · ${driverName}` : ""}
            {carName ? ` · ${carName}` : ""}
          </p>
        </div>

        <div className="ptp-status-block">
          <span className={`ptp-status ${copy.tone}`}>
            <span aria-hidden className="ptp-status-dot" />
            {copy.label}
          </span>
          <span className="ptp-readonly">LIVE TELEMETRIE · 1s polling</span>
        </div>
      </div>

      <dl className="ptp-meta">
        <div>
          <dt>Circuit</dt>
          <dd>{trackLabel || "—"}</dd>
        </div>
        {teamName && (
          <div>
            <dt>Team</dt>
            <dd>{teamName}</dd>
          </div>
        )}
        <div>
          <dt>Connector</dt>
          <dd>{connector ?? "—"}</dd>
        </div>
        <div>
          <dt>Laatst gezien</dt>
          <dd>{lastSeen}</dd>
        </div>
        <div>
          <dt>Sectoren</dt>
          <dd className={sectorCount > 0 ? undefined : "is-muted"}>
            {sectorCount > 0 ? `${sectorCount} beschikbaar` : "niet beschikbaar"}
          </dd>
        </div>
        {refreshing && (
          <div className="ptp-meta-refresh">
            <dt>Update</dt>
            <dd>telemetrie verversen…</dd>
          </div>
        )}
      </dl>
    </header>
  );
}
