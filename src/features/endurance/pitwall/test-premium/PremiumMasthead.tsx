import type { PitwallConnectionState } from "../PitwallContextBar";

const statusCopy: Record<PitwallConnectionState, { label: string; tone: string; detail: string }> = {
  live: { label: "LIVE", tone: "is-live", detail: "LIVE TELEMETRIE · 1s polling" },
  stale: { label: "ONLINE · GEEN TELEMETRIE", tone: "is-stale", detail: "wacht op telemetrie · 1s polling" },
  offline: { label: "OFFLINE", tone: "is-offline", detail: "geen verbinding · 1s polling" },
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
  telemetryAge,
  state,
  sectorCount,
  refreshing,
  tag = "PITWALL TEST",
}: {
  deviceName: string;
  trackLabel: string;
  driverName: string | null;
  carName: string | null;
  teamName: string | null;
  connector: string | null;
  lastSeen: string;
  /** Leeftijd van de laatste échte telemetrie, niet van het gezondheidssignaal. */
  telemetryAge?: string | null;
  state: PitwallConnectionState;
  sectorCount: number;
  refreshing: boolean;
  /** Productietag; de testroute houdt de bestaande aanduiding. */
  tag?: string;
}) {
  const copy = statusCopy[state];
  const telemetryDetail = state === "live"
    ? "telemetrie nu"
    : telemetryAge && telemetryAge !== "—"
      ? `laatste telemetrie ${telemetryAge}`
      : "nog geen telemetrie ontvangen";
  return (
    <header className="ptp-masthead" data-pitwall-connection={state}>
      <div className="ptp-brandline">
        <span className="ptp-brand">3SM</span>
        <span className="ptp-brand-sub">RACE OPERATIONS</span>
        <span className="ptp-brand-rule" aria-hidden />
        <span className="ptp-brand-tag">{tag}</span>
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
          <span className="ptp-readonly" data-ptp-polling={state}>{copy.detail}</span>
          {state !== "live" && (
            <span className="ptp-readonly" data-ptp-telemetry-age={telemetryAge ?? "unknown"}>
              {telemetryDetail}
            </span>
          )}
        </div>
      </div>

      <dl className="ptp-meta">
        <div>
          <dt>Circuit</dt>
          <dd>{trackLabel || "—"}</dd>
        </div>
        <div>
          <dt>Team</dt>
          <dd>{teamName || "—"}</dd>
        </div>
        <div>
          <dt>Connector</dt>
          <dd>{connector ?? "—"}</dd>
        </div>
        <div>
          <dt>Apparaat gezien</dt>
          <dd>{lastSeen}</dd>
        </div>
        <div>
          <dt>Sectoren</dt>
          <dd className={sectorCount > 0 ? undefined : "is-muted"}>
            {sectorCount > 0 ? `${sectorCount} beschikbaar` : "niet beschikbaar"}
          </dd>
        </div>
          <div className="ptp-meta-refresh" aria-hidden={!refreshing} style={{ visibility: refreshing ? 'visible' : 'hidden' }}>
            <dt>Update</dt>
            <dd>telemetrie verversen…</dd>
          </div>
      </dl>
    </header>
  );
}
