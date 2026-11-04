import { isCurrentStint } from "../shared/stintTiming";
import { Radio, X } from "lucide-react";
import { RaceControlPanel } from "../race-control/RaceControlPanel";
import { useQuery } from "@tanstack/react-query";
import { listPitwallTeams } from "../repository/pitwallRepository";
import { useAuth } from "@/contexts/AuthContext";
import { useEnduranceActor } from "../core/ActorContext";
import type { EnduranceEvent } from "../core/types";
import { usePitwallData } from "./usePitwallData";
import { getDemoData, DEMO_SCENARIO_LIST, type DemoScenario, type DemoData } from "./pitwallDemoData";
import { PitwallDashboard } from "./PitwallDashboard";
import { PitwallContextBar } from "./PitwallContextBar";
import { OwnCarPanel } from "./OwnCarPanel";
import { DecisionBand } from "./DecisionBand";
import { usePitwallStrategy } from "./usePitwallStrategy";
import { PitStrategyBlock } from "./PitStrategyBlock";
import { FuelPanel } from "./FuelPanel";
import { PitStopAnchor } from "./PitStopAnchor";
import { StintDriverPanel } from "./StintDriverPanel";
import { PacePanel } from "./PacePanel";
import { AlertZone } from "./AlertZone";
import { RaceTimeline } from "./RaceTimeline";
import { StrategyForecast } from "./StrategyForecast";
import { StandingsWidget } from "./StandingsWidget";
import { mergeFuelToFinish } from "./pitwallHelpers";
import { median } from "./strategy/fuelModel";
import { VehicleTelemetryPanel } from "./VehicleTelemetryPanel";
import { LiveTrackPanel } from "./LiveTrackPanel";
import { RaceTelemetryStrip } from "./RaceTelemetryStrip";
import { deriveStandings, geldigeLaatsteRonde } from "./standings";
import { useMemo, useCallback, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { PitwallPositionData, PitwallPaceData, PitwallRaceClock } from "./pitwallHelpers";

const useTeams = (eventId: string, actorId: string, staff: boolean, enabled: boolean) => {
  return useQuery({
    queryKey: ["pitwall", "teams", eventId, actorId, staff],
    enabled: Boolean(eventId) && enabled,
    queryFn: async () => {
      return listPitwallTeams(eventId);
    },
  });
};

export const PitwallTab = ({ event }: Props) => {
  const [controlOpen, setControlOpen] = useState(false);
  const { actorId, displayName } = useEnduranceActor();
  const { isSuperAdmin, isEnduranceManager } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  /* Focus mode: from URL or button state */
  const isFocusMode = useMemo(() => {
    try {
      const params = new URLSearchParams(location.search);
      return params.get("pitwallFocus") === "1";
    } catch { return false; }
  }, [location.search]);

  const demoScenario: DemoScenario | null = useMemo(() => {
    if (!import.meta.env.DEV) return null;
    try {
      const params = new URLSearchParams(location.search);
      const value = params.get("pitwallDemo");
      if (value && ["normal", "pit", "low-data", "offline"].includes(value)) {
        return value as DemoScenario;
      }
    } catch { /* ignore */ }
    return null;
  }, [location.search]);

  const setDemoScenario = useCallback((scenario: DemoScenario) => {
    const params = new URLSearchParams(location.search);
    params.set("pitwallDemo", scenario);
    navigate({ pathname: location.pathname, search: params.toString() }, { replace: true });
  }, [location.pathname, location.search, navigate]);

  const teamQuery = useTeams(event.id, actorId, isSuperAdmin || isEnduranceManager, !demoScenario);
  const myTeamId = teamQuery.data?.[0]?.id ?? null;

  const real = usePitwallData(
    demoScenario ? "" : event.id,
    demoScenario ? null : myTeamId,
    actorId
  );

  const demo: DemoData | null = useMemo(() => {
    if (!demoScenario) return null;
    return getDemoData(demoScenario);
  }, [demoScenario]);

  const isDemo = import.meta.env.DEV && demo !== null;

  const strategyBase = isDemo ? demo.strategy : real.strategy;
  const events = isDemo ? demo.events : real.events;
  const lapTimes = events
    .map((event) => event.lap_time_from_deltas_s ?? Number(event.payload?.lastLapTimeSeconds))
    .filter((n) => Number.isFinite(n) && n > 0) as number[];

  // De server laat brandstof-tot-finish leeg bij een tijdrace; hier rekenen we
  // hem uit de resterende sessietijd. Een bestaande serverwaarde wint altijd.
  const strategy = isDemo
    ? strategyBase
    : mergeFuelToFinish(strategyBase, real.v3 ?? null, {
        averageLapSeconds: median(lapTimes.filter((n) => n < 600)),
      });

  const pitLaps = new Set(
    events.filter((event) => event.event_type === 'pit_entry').map((event) => event.completed_laps),
  );
  const pacePoints = events
    .filter((event) => event.event_type === 'lap_completed')
    .map((event) => ({
      lap: event.completed_laps ?? 0,
      seconds: event.lap_time_from_deltas_s ?? Number(event.payload?.lastLapTimeSeconds),
    }))
    .filter((point) => Number.isFinite(point.seconds) && point.seconds > 0)
    .slice(-60)
    .map((point) => ({ ...point, marker: pitLaps.has(point.lap) ? ('pit' as const) : undefined }));
  const teams = isDemo ? demo.teams : teamQuery.data ?? [];
  const plannedStints = isDemo ? demo.plannedStints : real.plannedStints;
  const alerts = isDemo ? demo.alerts : real.alerts;
  const loading = isDemo ? demo.loading : real.loading || teamQuery.isPending;
  const selectedTeamId = isDemo ? "demo-team" : real.selectedTeamId;
  const setSelectedTeamId = isDemo ? (id: string | null) => {} : real.setSelectedTeamId;

  const position: PitwallPositionData | null = isDemo ? demo.position : real.position ?? null;
  const pace: PitwallPaceData | null = isDemo ? demo.pace : real.pace ?? null;
  const raceClock: PitwallRaceClock | null = isDemo ? demo.raceClock : real.raceClock ?? null;

  /* 0.4.2/0.4.3: live standings derivation from opponent snapshot (real or demo) + trends. */
  const standings = useMemo(() => {
    if (isDemo) {
      return deriveStandings({
        position: { position: demo.position.overallPosition ?? undefined, classPosition: demo.position.classPosition ?? undefined, gapToLeaderSeconds: demo.position.gapToLeaderSeconds ?? undefined },
        opponents: demo.opponents,
      }, 40, { p5: 0.2, p7: -0.1 });
    }
    return deriveStandings(real.isLive ? real.v3 ?? null : null, 40, real.isLive ? real.trends : undefined);
  }, [isDemo, demo, real.v3, real.trends, real.isLive]);

  const currentStint = plannedStints.find((s) => isDemo ? s.status === "in_car" : isCurrentStint(s.status, s.actual_start_at ?? s.original_start_at, s.actual_end_at ?? s.original_end_at, real.now));
  const nextStints = plannedStints.filter((s) => isDemo ? s.status === "draft" : !["completed", "replaced", "expired"].includes(s.status) && Date.parse(s.actual_start_at ?? s.original_start_at) > Date.parse(real.now)).sort((a, b) => (a.actual_start_at ?? a.original_start_at).localeCompare(b.actual_start_at ?? b.original_start_at));
  const nextStint = nextStints[0];
  const driverName = isDemo ? (currentStint?.driver_id ?? null) : real.v3?.identity?.currentDriverName ?? (currentStint ? displayName(currentStint.driver_id) : null);
  const nextDriverName = isDemo ? (nextStint?.driver_id ?? null) : nextStint ? displayName(nextStint.driver_id) : null;
  const isLive = isDemo ? demoScenario !== "offline" : real.isLive;

  const enterFocus = () => {
    const params = new URLSearchParams(location.search);
    params.set("pitwallFocus", "1");
    navigate({ pathname: location.pathname, search: params.toString() });
  };
  const exitFocus = useCallback(() => {
    try {
      const params = new URLSearchParams(location.search);
      params.delete("pitwallFocus");
      const search = params.toString();
      navigate({ pathname: location.pathname, search }, { replace: true });
    } catch { /* ignore */ }
  }, [location.pathname, location.search, navigate]);

  const requestFullscreen = useCallback(() => {
    void document.documentElement.requestFullscreen?.().catch(() => { /* browser denied fullscreen */ });
  }, []);

  /* De beslissingsband rekent met dezelfde motor als het advies: één snapshot,
   * één grens. `lapsUntilPit` komt hier vandaan en wordt in de panelen niet
   * opnieuw uitgerekend — anders staan er twee getallen over dezelfde tank.
   *
   * Het aantal geplande rondes is de som van wat er gereden is en wat de server
   * nog als resterend meldt; is één van beide onbekend, dan blijft het null en
   * rekent de motor met de sessieklok. */
  const advice = usePitwallStrategy({
    strategy,
    v3: isDemo ? null : real.v3 ?? null,
    tyreEstimate: isDemo ? null : real.tyreEstimate,
    plannedLaps:
      strategy?.session_laps_remaining != null && strategy?.last_completed_laps != null
        ? strategy.session_laps_remaining + strategy.last_completed_laps
        : null,
  });

  const teamName = teams.find((t) => t.id === selectedTeamId)?.name ?? null;
  const ownDriver = (isDemo ? null : real.v3?.identity?.currentDriverName) ?? driverName ?? null;
  const ownCar = isDemo ? null : real.v3?.identity?.carName ?? null;
  const ownLastLap = geldigeLaatsteRonde(
    (isDemo ? null : real.v3?.timing?.lastLapTimeSeconds) ?? pace?.lastLapSeconds,
    (isDemo ? null : real.v3?.timing?.bestLapTimeSeconds) ?? pace?.bestLapSeconds,
  ) ?? null;
  const ownBestLap = (isDemo ? null : real.v3?.timing?.bestLapTimeSeconds) ?? pace?.bestLapSeconds ?? null;

  const connectionState = !isLive ? "offline" : strategy?.strategy_status === "low_sample" ? "stale" : "live";

  return (
    /* data-pitwall + data-pitwall-focus for CSS targeting */
    <div
      className={isFocusMode ? "w-full space-y-2 bg-[#07080A] text-slate-200" : "space-y-3 bg-[#07080A] text-slate-200"}
      data-pitwall="true"
      data-pitwall-focus={isFocusMode ? "true" : undefined}
      data-pitwall-mode="endurance"
    >
      {/* === CONTEXTREGEL — race, team, rijder, verbindingsstatus === */}
      <PitwallContextBar
        eyebrow="3SM · Endurance"
        title={event.name}
        state={connectionState}
        note={!isLive ? "Planning blijft beschikbaar" : undefined}
        items={[
          ...(teamName ? [{ label: "Team", value: teamName }] : []),
          ...(ownDriver ? [{ label: "Rijder", value: ownDriver, tone: "accent" as const }] : []),
          ...(ownCar ? [{ label: "Auto", value: ownCar }] : []),
        ]}
        actions={
          <>
            {!isDemo && (
              <button
                type="button"
                aria-expanded={controlOpen}
                aria-controls="pitwall-race-control"
                onClick={() => setControlOpen(!controlOpen)}
                className={`flex min-h-9 items-center gap-2 rounded-lg px-3 text-[12px] font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-400 ${
                  controlOpen ? "bg-white/10 text-white" : "bg-orange-500 text-white hover:bg-orange-400"
                }`}
              >
                <Radio className="h-4 w-4" />
                {controlOpen ? "Race Control sluiten" : "Stints & Race Control"}
              </button>
            )}
            {isFocusMode ? (
              <>
                <button
                  type="button"
                  onClick={requestFullscreen}
                  className="rounded-lg bg-white/[0.06] px-2.5 py-1.5 text-[11px] font-bold text-slate-300 transition ring-1 ring-white/10 hover:text-white"
                >
                  Volledig scherm
                </button>
                <button
                  type="button"
                  onClick={exitFocus}
                  className="rounded-lg bg-white/[0.06] px-2.5 py-1.5 text-[11px] font-bold text-slate-300 transition ring-1 ring-white/10 hover:text-white"
                >
                  Focus verlaten
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={enterFocus}
                className="rounded-lg bg-white/[0.06] px-2.5 py-1.5 text-[11px] font-bold text-slate-300 transition ring-1 ring-white/10 hover:text-white"
              >
                Focus mode
              </button>
            )}
          </>
        }
      />

      {/* === TEAM SELECTOR (real mode only) === */}
      {teams.length > 1 && !isDemo && (
        <div className="flex flex-wrap gap-1.5">
          {teams.map((team) => (
            <button
              key={team.id}
              type="button"
              onClick={() => setSelectedTeamId(team.id)}
              className={`rounded-lg px-3 py-1.5 text-[12px] font-bold transition ${
                selectedTeamId === team.id
                  ? "bg-orange-500 text-white"
                  : "bg-white/[0.04] text-slate-400 ring-1 ring-white/10 hover:text-white"
              }`}
            >
              {team.name}
            </button>
          ))}
        </div>
      )}

      {/* === DEMO SWITCHER === */}
      {isDemo && !isFocusMode && (
        <div className="rounded-lg border border-dashed border-orange-500/30 bg-orange-500/[0.04] px-3 py-2">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-orange-500" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-orange-400">
              DEV PITWALL DEMO — Scenario: {demoScenario === "normal" ? "Normale race" : demoScenario === "pit" ? "Pit deze ronde" : demoScenario === "low-data" ? "Weinig data" : "Telemetrie verloren"}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {DEMO_SCENARIO_LIST.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setDemoScenario(s.id)}
                className={`rounded px-2 py-0.5 text-[10px] font-bold transition ${
                  demoScenario === s.id ? "bg-orange-500 text-white" : "bg-white/10 text-gray-400 hover:text-white"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={controlOpen ? "grid items-start gap-4 2xl:grid-cols-[minmax(0,1fr)_400px]" : ""}>
        {controlOpen && (
          <aside
            id="pitwall-race-control"
            className="min-w-0 rounded-xl border border-[#1D2431] bg-[#0B0D11] p-3 2xl:sticky 2xl:top-4 2xl:col-start-2 2xl:row-start-1 2xl:max-h-[85vh] 2xl:overflow-y-auto [&_.grid]:!grid-cols-1"
          >
            <div className="mb-3 flex items-center justify-between px-2">
              <span className="text-[11px] font-black uppercase tracking-[0.16em] text-orange-300">Stints & Race Control</span>
              <button
                type="button"
                aria-label="Race Control sluiten"
                onClick={() => setControlOpen(false)}
                className="rounded-lg p-2 text-gray-400 hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <RaceControlPanel key={`${event.id}:${selectedTeamId}`} event={event} selectedTeamId={selectedTeamId ?? ""} embedded />
          </aside>
        )}

        <div className="min-w-0 space-y-3 2xl:col-start-1 2xl:row-start-1">
          <PitwallDashboard
            kpi={<RaceTelemetryStrip plannedLaps={event.plannedLaps} plannedDurationMinutes={event.plannedDurationMinutes} v3={isDemo ? null : real.v3 ?? null} live={isLive} />}
            decision={strategy ? <DecisionBand advice={advice} /> : undefined}
            notice={
              <PitStopAnchor
                source={isDemo ? null : { eventId: event.id, teamId: selectedTeamId }}
                enabled={!isDemo && isLive}
                showExample={isDemo}
              />
            }
            track={
              <>
                <LiveTrackPanel
                  v3={isDemo ? null : real.v3 ?? null}
                  live={isLive}
                  fallbackTrack={[event.circuit, event.configuration].filter(Boolean).join(" - ")}
                />
                <OwnCarPanel
                  carNumber={isLive ? real.v3?.opponents?.find(c => c.isPlayer)?.carNumber : null}
                  completedLaps={isLive ? real.v3?.timing?.completedLaps : null}
                  driverName={ownDriver}
                  carName={ownCar}
                  teamName={teamName}
                  lastLapSeconds={ownLastLap}
                  bestLapSeconds={ownBestLap}
                  gapToLeaderSeconds={position?.gapToLeaderSeconds ?? null}
                />
              </>
            }
            timing={
              <StandingsWidget v3={isDemo ? null : real.v3}
                plannedStints={plannedStints.map(s => ({ ...s, driver_id: isDemo ? s.driver_id : displayName(s.driver_id) }))}
                events={events}
                live={isLive}
                standings={standings}
                ownCarLabel={teamName ?? "Mijn auto"}
                ownCarNumber={null}
              />
            }
            panels={
              strategy
                ? [
                    <PacePanel paceSource={isDemo ? undefined : {eventId:event.id,teamId:selectedTeamId}} v3={isDemo ? null : real.v3} live={isLive} key="pace" strategy={strategy} pace={pace} lapTimes={lapTimes} points={pacePoints} />,
                    <StintDriverPanel
                      carNumber={isLive ? real.v3?.opponents?.find(c => c.isPlayer)?.carNumber : null}
                      nowMs={Date.parse(real.now)}
                      key="driver"
                      strategy={strategy}
                      plannedStints={nextStints.map((s) => ({ ...s, driver_id: isDemo ? s.driver_id : displayName(s.driver_id) }))}
                      currentStint={currentStint}
                      driverName={driverName}
                    />,
                    <FuelPanel key="fuel" strategy={strategy} window={isLive ? advice.window : null} plannedStints={[...(currentStint ? [currentStint] : []), ...nextStints].map(s => ({ ...s, driver_id: isDemo ? s.driver_id : displayName(s.driver_id) }))} />,
                    <VehicleTelemetryPanel
                      key={`tyres:${event.id}:${selectedTeamId}`}
                      v3={isDemo ? null : real.v3 ?? null}
                      live={isLive}
                      tyreEstimate={isDemo ? null : real.tyreEstimate}
                    />,
                  ]
                : []
            }
            extra={
              strategy ? (
                <>
                  {/* Aanvullende strategie: ongewijzigde componenten, nieuwe plek. */}
                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
                    <StrategyForecast
                      strategy={strategy}
                      position={position}
                      pace={pace}
                      plannedStints={plannedStints}
                      nextDriverName={nextDriverName}
                    />
                    <PitStrategyBlock
                      strategy={strategy}
                      driverName={driverName}
                      nextDriverName={nextDriverName}
                      pitLoss={isDemo ? null : real.pitStopMeasurement}
                    />
                  </div>
                  <AlertZone alerts={alerts} />
                  <RaceTimeline events={events} plannedStints={plannedStints} />
                </>
              ) : undefined
            }
          />

          {loading && !strategy && <p className="text-[12px] text-slate-500">Pitwall laden…</p>}

          {!isDemo && (teamQuery.error || real.error) && (
            <p role="alert" className="text-[12px] text-red-300">Pitwall laden mislukt. Controleer je toegang en probeer opnieuw.</p>
          )}
          {!loading && !strategy && !isDemo && !teamQuery.error && !real.error && (
            <p className="text-[12px] text-slate-500">
              Geen pitwall-data beschikbaar. {!selectedTeamId && "Er is nog geen toegankelijk team voor deze race."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

interface Props {
  event: EnduranceEvent;
}
