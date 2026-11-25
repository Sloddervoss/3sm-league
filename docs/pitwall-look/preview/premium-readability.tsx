/**
 * Lokale, login-vrije leesbaarheidsfixture voor de premium Pitwall.
 *
 * Rendert exact dezelfde componenten, CSS en focuscontainer als
 * `PitwallDeviceTestPage`, `PersonalPitwallPage` en `PersonalPitwallSharePage`,
 * maar met synthetische data. Geen Supabase-sessie, geen writes, geen share.
 *
 * Queryparameters:
 *   variant=test|personal|shared   (standaard: test)
 *   state=live|offline             (standaard: live)
 *   focus=1                        (focusweergave aan)
 */
import { createRoot } from "react-dom/client";
import { useMemo } from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Radio, Share2 } from "lucide-react";
import { PitwallPremiumView } from "@/features/endurance/pitwall/test-premium/PitwallPremiumView";
import { PremiumDeviceDock } from "@/features/endurance/pitwall/test-premium/PremiumDeviceDock";
import { PremiumFocusBar } from "@/features/endurance/pitwall/test-premium/PremiumFocusBar";
import { usePitwallStrategy } from "@/features/endurance/pitwall/usePitwallStrategy";
import { deriveStandings } from "@/features/endurance/pitwall/standings";
import { PitDurationPanel } from "@/features/personal-pitwall/PitDurationPanel";
import type { PersonalPitFeed } from "@/features/personal-pitwall/pitVisits";
import type { useTyreModel } from "@/features/endurance/pitwall/useTyreModel";
import type { SimHubFleetRow } from "@/features/control-room/connectors/types";
import {
  fixtureDetail,
  fixturePace,
  fixturePoints,
  fixtureSessionPace,
  fixtureStrategy,
  fixtureV3,
} from "./premiumReadabilityFixture";
import "@/index.css";
import "@/pages/personalPitwall.css";

const params = new URLSearchParams(location.search);
const variant = (params.get("variant") ?? "test") as "test" | "personal" | "shared";
const offline = params.get("state") === "offline";
const focus = params.get("focus") === "1";

const pitFeed: PersonalPitFeed = {
  available: true,
  reason: null,
  sessionKey: "fixture-session-20261122",
  visits: [
    {
      visitKey: "fixture-visit-1",
      pitLaneSeconds: 68.412,
      entryObservedAt: new Date(Date.now() - 9 * 60_000).toISOString(),
      exitObservedAt: new Date(Date.now() - 8 * 60_000).toISOString(),
      entrySessionSeconds: 3120,
      exitSessionSeconds: 3188.412,
      source: "simhub",
    },
  ],
  diagnostics: { pendingEdges: 0, rejectedEdges: 0, lastRejectReason: null },
};

const fleet: SimHubFleetRow[] = [
  {
    device_id: "fixture-device-1",
    device_name: "DESKTOP-GR4NN00",
    device_status: "active_binding",
    device_role: "primary",
    revoked_at: null,
    last_seen_at: new Date().toISOString(),
    endurance_event_id: null,
    endurance_team_id: null,
    endurance_binding_source: null,
    endurance_event_name: null,
    endurance_team_name: null,
    connector_version: "0.7.6.4",
    simhub_version: "9.0",
    game_connected: !offline,
    telemetry_available: !offline,
    diagnostic_code: "ok",
    health_received_at: new Date().toISOString(),
    updater_state: "current",
    updater_current_version: "0.7.6.4",
    updater_target_version: null,
    last_update_result: "ok",
    last_update_utc: new Date().toISOString(),
    telemetry_received_at: offline ? null : new Date().toISOString(),
    telemetry_game: offline ? null : "iRacing",
    telemetry_car_name: offline ? null : "Porsche 911 GT3 R",
    telemetry_track_name: offline ? null : "Road America",
    telemetry_driver_name: offline ? null : "Vincent",
  } as unknown as SimHubFleetRow,
];

const tyreStub = {
  estimate: null,
  bron: "geen",
  v2Error: false,
  modelLoading: false,
  coverage: [],
  coverageError: null,
  coverageLoading: false,
} as unknown as ReturnType<typeof useTyreModel>;

/**
 * Kopie van de niet-actieve `ShareBar` uit PersonalPitwallPage: dezelfde
 * klassen, copy en hoogte. De echte pagina rendert deze strook óók in focus,
 * dus zonder dit blok zou de verticale meting te optimistisch zijn.
 */
function PersonalShareBar() {
  return (
    <section className="pp-share" aria-label="Race delen" data-pp-share>
      <div className="pp-share-head">
        <div>
          <p className="ptp-kicker">Meekijken</p>
          <h2>Deel deze race</h2>
          <p className="pp-share-note">
            Alleen deze sessie op dit circuit. De link is geheim en werkt zonder account; stoppen maakt hem direct ongeldig.
          </p>
        </div>
        <span className="pp-share-state">
          <Radio aria-hidden size={13} />
          niet gedeeld
        </span>
      </div>
      <div className="pp-share-actions">
        <button type="button" className="pp-share-primary" disabled>
          <Share2 aria-hidden size={15} />
          Deel deze race
        </button>
      </div>
    </section>
  );
}

/**
 * Kopie van de `.pp-viewer-strip` die PersonalPitwallSharePage boven de
 * premiumweergave rendert (ook in focus). Zonder deze strook zou de gedeelde
 * variant ~40 px te veel hoogte overhouden.
 */
function SharedViewerStrip() {
  return (
    <div className="pp-viewer-strip" role="status" data-pp-viewer-live>
      <span className="pp-viewer-dot" aria-hidden />
      Live gedeelde race · Road America
      <span>·</span>
      12s geleden
      <span>·</span>
      link verloopt 20:15
      <span>· circuitkaart</span>
      <span>· sectoren S1–S3</span>
      <button type="button" data-pitwall-focus-entry="true" className="pp-viewer-focus" disabled={focus}>
        Focus mode
      </button>
    </div>
  );
}

function Harness() {
  const v3 = useMemo(() => fixtureV3(offline), []);
  const detail = useMemo(() => fixtureDetail(offline), []);
  const strategy = useMemo(() => fixtureStrategy(v3), [v3]);
  const live = !offline;
  const advice = usePitwallStrategy({ strategy, v3, nowMs: Date.now() });
  const standings = useMemo(() => deriveStandings(v3, 40), [v3]);
  const pace = useMemo(() => fixturePace(v3), [v3]);
  const tag = variant === "personal" ? "MIJN PITWALL" : variant === "shared" ? "GEDEELD" : "PITWALL TEST";

  return (
    <div
      className="min-h-screen bg-[#07090c]"
      data-no-translate
      data-ptp-focus={focus ? "true" : undefined}
      data-pitwall-personal={variant === "personal" ? "true" : undefined}
    >
      <main
        className={focus ? "ptp-shell ptp-shell--focus" : "ptp-shell"}
        data-pitwall-test-premium="true"
      >
        <div
          className="ptp-focus-shell"
          data-ptp-focus-shell={focus ? "true" : undefined}
          role={focus ? "region" : undefined}
          aria-label={focus ? "Pitwall focusweergave" : undefined}
          tabIndex={focus ? -1 : undefined}
        >
          <PremiumFocusBar
            active={focus}
            fullscreen={false}
            message={null}
            profilesOpen={false}
            deviceCount={1}
            exitButtonRef={{ current: null }}
            onToggleProfiles={() => undefined}
            onShowArchive={() => undefined}
            onToggleFullscreen={() => undefined}
            onExit={() => undefined}
            showProfiles={variant !== "shared"}
          />

          <div className="ptp-focus-dock" id="ptp-focus-profiles" hidden={focus}>
            <PremiumDeviceDock
              rows={fleet}
              selectedId="fixture-device-1"
              onSelect={() => undefined}
              loading={false}
              error={false}
            />
          </div>

          {variant === "personal" && <PersonalShareBar />}
          {variant === "shared" && <SharedViewerStrip />}

          <PitwallPremiumView
            detail={detail}
            deviceId="fixture-device-1"
            live={live}
            online={!offline}
            v3={v3}
            trackLabel="Road America · Full Course"
            ownDriverName="Vincent"
            ownCarName="Porsche 911 GT3 R"
            linkedTeamName="3SM Endurance"
            standings={standings}
            strategy={strategy}
            strategyAdvice={advice}
            pace={pace}
            points={fixturePoints}
            sessionPace={fixtureSessionPace}
            tyre={tyreStub}
            tyreEstimate={null}
            motionEnabled={false}
            refreshing={false}
            contextKey="fixture-device-1|fixture-session-20261122|596"
            gap
            lastSeen={offline ? "12m geleden" : "nu"}
            readOnly={variant === "shared"}
            tag={tag}
            pitDuration={
              variant === "shared" ? undefined : (
                <PitDurationPanel
                  deviceId="fixture-device-1"
                  enabled={live}
                  load={async () => pitFeed}
                  contextKey="fixture-device-1|fixture-session-20261122|596"
                />
              )
            }
          />
        </div>
      </main>
    </div>
  );
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false } },
});

document.documentElement.dataset.fixtureVariant = variant;
document.documentElement.dataset.fixtureState = offline ? "offline" : "live";
document.documentElement.dataset.fixtureFocus = focus ? "focus" : "normal";

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <MemoryRouter>
      <Harness />
    </MemoryRouter>
  </QueryClientProvider>,
);
