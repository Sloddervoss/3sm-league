import type { V3Normalized } from '../pitwallHelpers';
import { LiveTrackPanel } from '../LiveTrackPanel';
import './PremiumCircuitPanel.css';

export interface PremiumCircuitPanelProps {
  v3: V3Normalized | null;
  live: boolean;
  fallbackTrack: string;
}

/**
 * Test-only premium circuitkaart.
 *
 * Dit component verandert niets aan de projectie: `LiveTrackPanel` en
 * `TrackProjection` krijgen alleen de expliciete `premium`-presentatie. De
 * officiële geometrie, lapdistance-projectie, pitmarkering en popups blijven
 * dus exact de bestaande code volgen. De eigen CSS regelt uitsluitend schaal,
 * verhouding en de leesbare rondebalk.
 */
export function PremiumCircuitPanel({ v3, live, fallbackTrack }: PremiumCircuitPanelProps) {
  return (
    <div className="ptp-circuit" data-ptp-circuit="true">
      <LiveTrackPanel
        v3={v3}
        live={live}
        fallbackTrack={fallbackTrack}
        presentation="premium"
      />
    </div>
  );
}
