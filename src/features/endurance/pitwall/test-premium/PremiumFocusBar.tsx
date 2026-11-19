import { Archive, Expand, PanelTop, X } from "lucide-react";
import type { RefObject } from "react";

/**
 * Bedieningsstrook van de premium focusweergave.
 *
 * Alles is een echte knop met een zichtbare focusring. "Profielen" opent de
 * bestaande apparaatdock (dezelfde profielkeuze als normaal), "Archief" brengt
 * de bestaande brok "Coureurs op dit apparaat" in beeld en "Focus verlaten" is
 * de expliciete uitgang. Native fullscreen is een laag bovenop de focusweergave:
 * als de browser het weigert, blijft de focusweergave gewoon bruikbaar.
 */
export function PremiumFocusBar({
  active,
  fullscreen,
  message,
  profilesOpen,
  deviceCount,
  exitButtonRef,
  onToggleProfiles,
  onShowArchive,
  onToggleFullscreen,
  onExit,
}: {
  active: boolean;
  fullscreen: boolean;
  message: string | null;
  profilesOpen: boolean;
  deviceCount: number;
  exitButtonRef: RefObject<HTMLButtonElement>;
  onToggleProfiles: () => void;
  onShowArchive: () => void;
  onToggleFullscreen: () => void;
  onExit: () => void;
}) {
  return (
    <div
      className="ptp-focus-bar"
      data-ptp-focus-bar={active ? "true" : undefined}
      role="group"
      aria-label="Pitwall focusbediening"
      hidden={!active}
    >
      <span className="ptp-focus-brand" aria-hidden>
        3SM <b>FOCUS</b>
      </span>

      <span
        className={`ptp-focus-state${message ? " is-alert" : ""}`}
        role="status"
        aria-live="polite"
        data-ptp-focus-status={message ? "fallback" : fullscreen ? "fullscreen" : "focus"}
      >
        {message ?? (fullscreen ? "Volledig scherm actief" : "Focusweergave actief")}
      </span>

      <div className="ptp-focus-actions">
        <button
          type="button"
          className="ptp-focus-btn"
          onClick={onToggleProfiles}
          aria-expanded={profilesOpen}
          aria-controls="ptp-focus-profiles"
        >
          <PanelTop aria-hidden size={13} />
          Profielen
          <span className="ptp-focus-count">{deviceCount}</span>
        </button>
        <button type="button" className="ptp-focus-btn" onClick={onShowArchive}>
          <Archive aria-hidden size={13} />
          Archief
        </button>
        <button
          type="button"
          className="ptp-focus-btn"
          onClick={onToggleFullscreen}
          aria-pressed={fullscreen}
          title={fullscreen ? "Native volledig scherm verlaten" : "Native volledig scherm openen"}
        >
          <Expand aria-hidden size={13} />
          Volledig scherm
        </button>
        <button type="button" ref={exitButtonRef} className="ptp-focus-btn ptp-focus-exit" onClick={onExit}>
          <X aria-hidden size={13} />
          Focus verlaten
        </button>
      </div>
    </div>
  );
}
