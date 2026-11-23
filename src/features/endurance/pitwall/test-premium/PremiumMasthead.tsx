import { Monitor } from "lucide-react";
import type { PitwallConnectionState } from "../PitwallContextBar";

const statusCopy: Record<PitwallConnectionState, { label: string; tone: string; detail: string }> = {
  live: { label: "LIVE", tone: "is-live", detail: "LIVE TELEMETRIE · 1s polling" },
  stale: { label: "ONLINE · GEEN TELEMETRIE", tone: "is-stale", detail: "wacht op telemetrie · 1s polling" },
  offline: { label: "OFFLINE", tone: "is-offline", detail: "geen verbinding · 1s polling" },
};

/**
 * Compacte contextkop, race-eerst.
 *
 * De circuitnaam is de titel; coureur, nummer, auto en team staan er direct
 * onder. De apparaatnaam is context, geen hoofdonderwerp. Alleen bronvelden
 * blijven zichtbaar: connector, laatst gezien en telemetrieleeftijd. De
 * circuit- en teammeta blijven in de DOM voor bestaande contracten, maar zijn
 * visueel dubbel met de titel/regel erboven en worden niet nog eens getoond.
 *
 * De technische pollregel blijft als schermlezerdetail bestaan; hij is geen
 * tweede zichtbare status naast LIVE/OFFLINE.
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
  carNumber = null,
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
  carNumber?: string | null;
}) {
  const copy = statusCopy[state];
  const telemetryDetail = state === "live"
    ? "nu"
    : telemetryAge && telemetryAge !== "—"
      ? `laatste telemetrie ${telemetryAge}`
      : "nog geen telemetrie ontvangen";
  const identity = [
    driverName?.trim() || null,
    carNumber ? `#${carNumber.trim().replace(/^#/, "")}` : null,
    carName?.trim() || null,
    teamName?.trim() || null,
  ].filter(Boolean).join(" · ");

  return (
    <header
      className="ptp-masthead"
      data-pitwall-connection={state}
      data-ptp-sectors={sectorCount > 0 ? "known" : "unknown"}
    >
      <div className="ptp-mast-brand">
        <span className="ptp-brand">3SM</span>
        <span className="ptp-brand-sub">RACE OPERATIONS</span>
        <span className="ptp-brand-tag">{tag}</span>
      </div>

      <div className="ptp-mast-title">
        <h1 className="ptp-mast-device">
          <Monitor aria-hidden size={13} />
          {deviceName}
        </h1>
        <p className="ptp-mast-track">{trackLabel || "Geen sessie"}</p>
        <p className="ptp-mast-sub">{identity || "Coureur en auto onbekend"}</p>
      </div>

      <div className="ptp-mast-side">
        <span className={`ptp-status ${copy.tone}`}>
          <span aria-hidden className="ptp-status-dot" />
          {copy.label}
        </span>
        <span className="ptp-sr-only" data-ptp-polling={state}>{copy.detail}</span>
        <dl className="ptp-meta">
          {/* Bestaande contractvelden. Circuit en team staan al in de titel en
              identiteitsregel; daarom hier niet nog een keer zichtbaar. */}
          <div className="ptp-meta-legacy">
            <dt>Circuit</dt>
            <dd>{trackLabel || "—"}</dd>
          </div>
          <div className="ptp-meta-legacy">
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
            <dt>Telemetrie</dt>
            <dd data-ptp-telemetry-age={telemetryAge ?? "unknown"}>{telemetryDetail}</dd>
          </div>
          <div
            className="ptp-meta-refresh"
            aria-hidden={!refreshing}
            style={{ visibility: refreshing ? "visible" : "hidden" }}
          >
            <dt>Update</dt>
            <dd>telemetrie verversen…</dd>
          </div>
        </dl>
      </div>
    </header>
  );
}
