import type { ReactNode } from "react";
import { ChevronDown, FlaskConical } from "lucide-react";
import type { SimHubDeviceDetail } from "@/features/control-room/connectors/types";
import type { V3Normalized, PitwallPaceData, PitwallStrategyRow } from "../pitwallHelpers";
import type { StandingsDerivation } from "../standings";
import type { Advice } from "../strategy/types";
import type { TyreEstimate } from "../strategy/tyreGrade";
import type { useTyreModel } from "../useTyreModel";
import { RaceTelemetryStrip } from "../RaceTelemetryStrip";
import { DecisionBand } from "../DecisionBand";
import { LiveTrackPanel } from "../LiveTrackPanel";
import { OwnCarPanel } from "../OwnCarPanel";
import { PacePanel } from "../PacePanel";
import { MySessionPanel } from "../MySessionPanel";
import { FuelPanel } from "../FuelPanel";
import { VehicleTelemetryPanel } from "../VehicleTelemetryPanel";
import { TyreModelPanel } from "../TyreModelPanel";
import { RawTelemetryDetails } from "../RawTelemetryDetails";
import { PitStopAnchor } from "../PitStopAnchor";
import type { PacePoint } from "../PaceGraph";
import { trackSectorCount } from "../paceSeries";
import { PremiumMasthead } from "./PremiumMasthead";
import { PremiumTimingPanel } from "./PremiumTimingPanel";
import "./testPremium.css";

type TyreState = ReturnType<typeof useTyreModel>;

export interface PitwallPremiumViewProps {
  detail: SimHubDeviceDetail;
  deviceId: string;
  live: boolean;
  online: boolean;
  v3: V3Normalized | null;
  trackLabel: string;
  ownDriverName: string | null;
  ownCarName: string | null;
  linkedTeamName: string | null;
  standings: StandingsDerivation;
  strategy: PitwallStrategyRow | null;
  strategyAdvice: Advice;
  pace: PitwallPaceData | null;
  points: PacePoint[];
  sessionPace: { fastest: number | null; median: number | null; count: number } | null;
  tyre: TyreState;
  tyreEstimate: TyreEstimate | null;
  motionEnabled: boolean;
  refreshing?: boolean;
  contextKey: string;
  gap: boolean;
  lastSeen: string;
}

/**
 * Test-only premium schil. De pagina levert uitsluitend bestaande, echte data;
 * dit component verandert geen query, sortering, autorisatie of berekening.
 *
 * De indeling is opzettelijk anders dan de klassieke testweergave: apparaatkeuze
 * staat als compacte dock boven het dashboard, de contextkop is één strook, de
 * timing krijgt de breedte en de pitbevestiging staat naast de baan in plaats
 * van als lege volle breedte eronder.
 */
export function PitwallPremiumView({
  detail,
  deviceId,
  live,
  online,
  v3,
  trackLabel,
  ownDriverName,
  ownCarName,
  linkedTeamName,
  standings,
  strategy,
  strategyAdvice,
  pace,
  points,
  sessionPace,
  tyre,
  tyreEstimate,
  motionEnabled,
  refreshing = false,
  contextKey,
  gap,
  lastSeen,
}: PitwallPremiumViewProps) {
  const sectorCount = live ? trackSectorCount(v3) : 0;
  const state = live ? "live" : online ? "stale" : "offline";

  const panel = (slot: string, body: ReactNode) => (
    <div className="ptp-panel-wrap" data-ptp-panel={slot}>
      {body}
    </div>
  );

  return (
    <div className="ptp-root" data-pitwall-test-premium="true" data-motion={motionEnabled ? "on" : "off"}>
      <PremiumMasthead
        deviceName={detail.device.device_name}
        trackLabel={trackLabel}
        driverName={ownDriverName}
        carName={ownCarName}
        teamName={linkedTeamName}
        connector={detail.health?.connector_version ?? null}
        lastSeen={lastSeen}
        state={state}
        sectorCount={sectorCount}
        refreshing={refreshing}
      />

      <div className="ptp-kpi" data-ptp-sectors={sectorCount > 0 ? "known" : "unknown"}>
        <RaceTelemetryStrip v3={v3} live={live} />
      </div>

      <DecisionBand advice={{ ...strategyAdvice, tyreEstimate }} />

      <div className="ptp-main" data-pitwall-row="track-timing">
        <div className="ptp-track-col" data-pitwall-col="track">
          <LiveTrackPanel v3={v3} live={live} fallbackTrack={trackLabel || detail.device.device_name} />
          <OwnCarPanel
            driverName={ownDriverName}
            carName={ownCarName}
            teamName={null}
            carNumber={live ? v3?.opponents?.find((c) => c.isPlayer)?.carNumber ?? null : null}
            completedLaps={live ? v3?.timing?.completedLaps ?? null : null}
            lastLapSeconds={live ? v3?.timing?.lastLapTimeSeconds ?? null : null}
            bestLapSeconds={live ? v3?.timing?.bestLapTimeSeconds ?? null : null}
            gapToLeaderSeconds={live ? v3?.position?.gapToLeaderSeconds ?? null : null}
          />
        </div>

        <div className="ptp-timing-col" data-pitwall-col="timing">
          <PremiumTimingPanel
            v3={v3}
            standings={standings}
            ownCarLabel={ownCarName ?? detail.device.device_name}
            ownCarNumber={live ? v3?.opponents?.find((c) => c.isPlayer)?.carNumber ?? null : null}
            live={live}
            contextKey={contextKey}
            gap={gap}
            motionEnabled={motionEnabled}
          />
        </div>
      </div>

      <div className="ptp-panels" data-pitwall-row="panels">
        {panel(
          "pace",
          <PacePanel
            paceSource={{ deviceId }}
            v3={v3}
            live={live}
            strategy={strategy}
            pace={pace}
            lapTimes={[]}
            points={points}
          />,
        )}
        {panel(
          "my-session",
          <MySessionPanel
            driverName={ownDriverName}
            carName={ownCarName}
            recordedLaps={sessionPace?.count ?? null}
            fastestSeconds={sessionPace?.fastest ?? null}
            medianSeconds={sessionPace?.median ?? null}
          />,
        )}
        {panel("fuel", <FuelPanel strategy={strategy} />)}
        {panel(
          "tyres",
          <VehicleTelemetryPanel v3={v3} live={live} tyreEstimate={tyreEstimate} tyreModel={tyre.estimate} />,
        )}
        {panel("pitstop", <PitStopAnchor source={{ deviceId }} enabled showExample />)}
      </div>

      <details className="ptp-more" data-pitwall-more="true">
        <summary>
          <span>
            <FlaskConical aria-hidden size={14} /> Meer analyse
          </span>
          <ChevronDown aria-hidden size={15} />
        </summary>
        <div className="ptp-more-body">
          <TyreModelPanel
            estimate={tyre.estimate}
            bron={tyre.bron}
            coverage={tyre.coverage}
            coverageLoading={tyre.coverageLoading}
            coverageError={tyre.coverageError}
            modelLoading={tyre.modelLoading}
            v2Error={tyre.v2Error}
          />
          <RawTelemetryDetails value={v3} />
          <p className="ptp-footnote">Live telemetrie verfrist automatisch.</p>
        </div>
      </details>
    </div>
  );
}
