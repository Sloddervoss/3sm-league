import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Lock, Radio } from "lucide-react";
import type { SimHubDeviceDetail } from "@/features/control-room/connectors/types";
import type { V3Normalized } from "@/features/endurance/pitwall/pitwallHelpers";
import {
  devicePace,
  deviceStrategyRow,
  deviceTrackLabel,
  isTelemetryLive,
} from "@/features/endurance/pitwall/devicePitwallAdapters";
import { deriveStandings } from "@/features/endurance/pitwall/standings";
import { usePitwallStrategy } from "@/features/endurance/pitwall/usePitwallStrategy";
import { withoutLiveTelemetry } from "@/features/endurance/pitwall/strategy";
import type { TyreModelState } from "@/features/endurance/pitwall/useTyreModel";
import { PitwallPremiumView } from "@/features/endurance/pitwall/test-premium/PitwallPremiumView";
import { PremiumFocusBar } from "@/features/endurance/pitwall/test-premium/PremiumFocusBar";
import { usePitwallFocus } from "@/features/endurance/pitwall/test-premium/usePitwallFocus";
import {
  readSharedRace,
  sharedViewerV3,
  takeShareTokenForPage,
  type SharedRace,
} from "@/features/personal-pitwall/share";
import "./personalPitwall.css";

const POLL_MS = 2_000;

const EMPTY_TYRE: TyreModelState = {
  estimate: null,
  bron: "geen",
  v2Error: null,
  modelLoading: false,
  coverage: [],
  coverageError: null,
  coverageLoading: false,
};

type ShareState = "loading" | "live" | "waiting" | "stale" | "ended" | "invalid" | "error" | "no-token";

const relTime = (iso: string): string => {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 5) return "nu";
  if (s < 60) return `${s}s geleden`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m geleden`;
  return `${Math.round(m / 60)}u geleden`;
};

const sharedDetail = (snapshot: SharedRace): SimHubDeviceDetail => ({
  device: {
    id: "shared-race",
    device_name: "Live race",
    device_status: "active_binding",
    device_role: null,
    revoked_at: null,
    last_seen_at: snapshot.updated_at,
    last_session_id: "shared",
    last_sequence: 0,
    endurance_event_id: null,
    endurance_team_id: null,
    endurance_binding_source: null,
    paired_at: snapshot.created_at,
  },
  health: {
    connector_version: "—",
    simhub_version: "—",
    game_connected: true,
    telemetry_available: true,
    raw_data_available: false,
    raw_telemetry_available: false,
    session_time_read_ok: true,
    session_time_seconds: null,
    session_time_reader: "shared",
    sequence: 0,
    client_last_telemetry_attempt_utc: snapshot.updated_at,
    client_last_successful_ingest_utc: snapshot.updated_at,
    client_last_ingest_http_status: 200,
    diagnostic_code: "ok",
    updater_state: "current",
    updater_current_version: "—",
    updater_target_version: null,
    last_update_result: null,
    last_update_utc: null,
    client_reported_at_utc: snapshot.updated_at,
    received_at: snapshot.updated_at,
  },
  telemetry: {
    device_id: "shared-race",
    owner_user_id: "",
    session_id: "shared",
    sequence: 0,
    captured_at: snapshot.updated_at,
    received_at: snapshot.updated_at,
    connector_id: "shared",
    simhub_version: "—",
    game: "IRacing",
    telemetry: {},
    endurance_event_id: null,
    endurance_team_id: null,
    driver_id: null,
    current_driver_id: null,
    current_driver_name: snapshot.session.driver,
    car_id: null,
    car_name: snapshot.session.car,
    track_name: snapshot.track.name,
    track_config: snapshot.track.config,
    race_run_id: null,
    v3_normalized: snapshot.v3 as Record<string, unknown>,
  },
  endurance_event: null,
  endurance_team: null,
  diagnostic_events: [],
});

const StatusPanel = ({
  title,
  body,
  icon,
  action,
}: {
  title: string;
  body: string;
  icon: React.ReactNode;
  action?: React.ReactNode;
}) => (
  <section className="pp-waiting" role="status" data-pp-viewer-state>
    <span className="pp-state-icon">{icon}</span>
    <p className="ptp-kicker">Gedeelde Pitwall</p>
    <h1>{title}</h1>
    <p>{body}</p>
    {action}
  </section>
);

export default function PersonalPitwallSharePage() {
  const [token] = useState<string | null>(() => takeShareTokenForPage());
  const [state, setState] = useState<ShareState>(token ? "loading" : "no-token");
  const [snapshot, setSnapshot] = useState<SharedRace | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [dockOpen] = useState(false);
  const focus = usePitwallFocus();
  const exitFocus = focus.exit;
  const focusActive = focus.active;

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    let timer: number | undefined;
    let stopped = false;

    const poll = async () => {
      try {
        const result = await readSharedRace(token);
        if (cancelled) return;
        if (!("code" in result)) {
          setSnapshot(result);
          setState("live");
        } else {
          // Fail closed: no stale race frame stays on screen after an error,
          // revoke, expiry or session change.
          setSnapshot(null);
          if (result.code === "ended") {
            setState("ended");
            stopped = true;
          } else if (result.code === "invalid") {
            setState("invalid");
            stopped = true;
          } else if (result.code === "stale") {
            setState("stale");
          } else if (result.code === "waiting") {
            setState("waiting");
          } else {
            setState("error");
          }
        }
      } catch {
        if (cancelled) return;
        setSnapshot(null);
        setState("error");
      } finally {
        if (!cancelled && !stopped) timer = window.setTimeout(poll, POLL_MS);
      }
    };

    const wake = () => {
      if (cancelled || stopped || document.visibilityState !== "visible") return;
      window.clearTimeout(timer);
      void poll();
    };

    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    window.addEventListener("pageshow", wake);
    void poll();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      window.removeEventListener("pageshow", wake);
    };
  }, [token, reloadKey]);

  const v3 = useMemo(() => (snapshot ? sharedViewerV3(snapshot) : null) as V3Normalized | null, [snapshot]);
  const detail = useMemo(() => (snapshot ? sharedDetail(snapshot) : null), [snapshot]);
  const live = Boolean(snapshot) && isTelemetryLive(snapshot!.updated_at);
  const strategy = useMemo(() => deviceStrategyRow(live ? v3 : null), [v3, live]);
  const advice = usePitwallStrategy({ strategy, v3, nowMs: Date.now(), learnedFuelUpper: null });
  const effectiveAdvice = live ? advice : withoutLiveTelemetry(advice);
  const standings = useMemo(() => deriveStandings(v3, 40), [v3]);
  const pace = devicePace(v3);
  const points = (snapshot?.laps ?? []).map((lap) => ({ lap: lap.lap, seconds: lap.seconds }));
  const ownDriverName = v3?.identity?.currentDriverName ?? snapshot?.session.driver ?? null;
  const ownCarName = v3?.identity?.carName ?? snapshot?.session.car ?? null;
  const trackLabel = deviceTrackLabel(v3, snapshot?.track.name ?? null);
  const contextKey = snapshot ? `${snapshot.created_at}|${snapshot.track.name}|${snapshot.track.config ?? ""}` : "shared";

  const retry = useCallback(() => {
    setState("loading");
    setReloadKey((value) => value + 1);
  }, []);

  useEffect(() => {
    if (state === "ended" || state === "invalid" || state === "error") exitFocus();
  }, [state, exitFocus]);

  const shellState = !token
    ? "no-token"
    : state === "live" && !snapshot
      ? "loading"
      : state;

  return (
    <div
      className="min-h-screen bg-[#07090c]"
      data-no-translate
      data-pitwall-personal="true"
      data-ptp-focus={focusActive ? "true" : undefined}
    >
      <main className={`ptp-shell${focusActive ? " ptp-shell--focus" : ""}`} data-pitwall-test-premium="true">
        <div
          ref={focus.shellRef}
          className="ptp-focus-shell"
          data-ptp-focus-shell={focusActive ? "true" : undefined}
          role={focusActive ? "region" : undefined}
          aria-label={focusActive ? "Gedeelde Pitwall focusweergave" : undefined}
          tabIndex={focusActive ? -1 : undefined}
        >
          <PremiumFocusBar
            active={focusActive}
            fullscreen={focus.fullscreen}
            message={focus.message}
            profilesOpen={dockOpen}
            deviceCount={0}
            exitButtonRef={focus.exitButtonRef}
            onToggleProfiles={() => {}}
            onShowArchive={() => {}}
            onToggleFullscreen={() => void focus.toggleFullscreen()}
            onExit={focus.exit}
            showProfiles={false}
            showArchive={false}
          />

          {!token && (
            <StatusPanel
              title="Deze link is ongeldig"
              body="Er ontbreekt een geldige deelcode. Vraag de eigenaar om een nieuwe link."
              icon={<Lock aria-hidden size={24} />}
              action={<Link to="/" className="pp-state-cta">Naar 3SM</Link>}
            />
          )}

          {token && (state === "loading" || shellState === "loading") && (
            <div className="pp-waiting" role="status">
              <Loader2 className="animate-spin" aria-hidden size={26} />
              <p className="ptp-kicker">Gedeelde Pitwall</p>
              <h1>Race laden</h1>
            </div>
          )}

          {token && state === "ended" && (
            <StatusPanel
              title="Delen gestopt"
              body="De eigenaar heeft deze race niet meer gedeeld. De oude link is definitief ongeldig."
              icon={<Lock aria-hidden size={24} />}
              action={<Link to="/" className="pp-state-cta">Naar 3SM</Link>}
            />
          )}

          {token && state === "invalid" && (
            <StatusPanel
              title="Deze link is ongeldig"
              body="De deelcode bestaat niet of is verlopen. Vraag de eigenaar om een nieuwe link."
              icon={<Lock aria-hidden size={24} />}
              action={<Link to="/" className="pp-state-cta">Naar 3SM</Link>}
            />
          )}

          {token && state === "stale" && (
            <StatusPanel
              title="Wachten op nieuwe data"
              body="De race is even niet actueel. Zodra er weer een vers frame binnenkomt, verschijnt de Pitwall opnieuw."
              icon={<Radio aria-hidden size={24} />}
            />
          )}

          {token && state === "waiting" && (
            <StatusPanel
              title="Wachten op telemetrie"
              body="De connector is gekoppeld, maar er is nog geen live frame voor deze sessie."
              icon={<Radio aria-hidden size={24} />}
            />
          )}

          {token && state === "error" && (
            <StatusPanel
              title="Verbinding verbroken"
              body="De gedeelde race kon niet worden opgehaald. De getoonde data is gewist; probeer het opnieuw."
              icon={<Lock aria-hidden size={24} />}
              action={<button type="button" className="pp-state-cta" onClick={retry}>Opnieuw proberen</button>}
            />
          )}

          {token && state === "live" && snapshot && detail && (
            <>
              <div className="pp-viewer-strip" role="status" data-pp-viewer-live>
                <span className="pp-viewer-dot" aria-hidden />
                Live gedeelde race · {snapshot.track.name}
                <span>·</span>
                {relTime(snapshot.updated_at)}
                <span>·</span>
                link verloopt {new Date(snapshot.expires_at).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}
                <span
                  data-ptp-circuit-status={snapshot.circuit?.trackId != null ? "available" : "unavailable"}
                  title={snapshot.circuit?.trackId != null ? "Officiële circuitgeometrie beschikbaar" : "Officiële circuitgeometrie niet beschikbaar"}
                >
                  · {snapshot.circuit?.trackId != null ? "circuitkaart" : "circuitkaart niet beschikbaar"}
                </span>
                <span
                  data-ptp-sectors-status={snapshot.sectors?.available ? "available" : "unavailable"}
                  title={
                    snapshot.sectors?.available
                      ? "Sectortijden uit de gedeelde sessie"
                      : "Geen gecontroleerde sectortijden voor deze sessie"
                  }
                >
                  · {snapshot.sectors?.available
                    ? `sectoren S1–S${snapshot.sectors.sectorCount}`
                    : "sectortijden niet beschikbaar"}
                </span>
                <button
                  type="button"
                  data-pitwall-focus-entry="true"
                  className="pp-viewer-focus"
                  onClick={(event) => focus.enter(event.currentTarget)}
                  disabled={focusActive}
                >
                  Focus mode
                </button>
              </div>
              <PitwallPremiumView
                detail={detail}
                deviceId="shared-race"
                live={live}
                online
                v3={v3}
                trackLabel={trackLabel}
                ownDriverName={ownDriverName}
                ownCarName={ownCarName}
                linkedTeamName={null}
                standings={standings}
                strategy={strategy}
                strategyAdvice={effectiveAdvice}
                pace={pace}
                points={points}
                sessionPace={snapshot.pace}
                tyre={EMPTY_TYRE}
                tyreEstimate={null}
                motionEnabled={!window.matchMedia("(prefers-reduced-motion: reduce)").matches}
                refreshing={false}
                contextKey={contextKey}
                gap={false}
                lastSeen={relTime(snapshot.updated_at)}
                readOnly
                tag="LIVE PITWALL"
              />
            </>
          )}
        </div>
      </main>
    </div>
  );
}
