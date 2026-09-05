import { useQuery } from "@tanstack/react-query";
import { listPitwallTeams } from "../repository/pitwallRepository";
import { useAuth } from "@/contexts/AuthContext";
import { useEnduranceActor } from "../core/ActorContext";
import type { EnduranceEvent } from "../core/types";
import { usePitwallData } from "./usePitwallData";
import { getDemoData, DEMO_SCENARIO_LIST, type DemoScenario, type DemoData } from "./pitwallDemoData";
import { TopRaceBar } from "./TopRaceBar";
import { PitStrategyBlock } from "./PitStrategyBlock";
import { FuelPanel } from "./FuelPanel";
import { StintDriverPanel } from "./StintDriverPanel";
import { PacePanel } from "./PacePanel";
import { RacePositionPanel } from "./RacePositionPanel";
import { AlertZone } from "./AlertZone";
import { RaceTimeline } from "./RaceTimeline";
import { StrategyForecast } from "./StrategyForecast";
import { StandingsWidget } from "./StandingsWidget";
import { VehicleTelemetryPanel } from "./VehicleTelemetryPanel";
import { LiveTrackPanel } from "./LiveTrackPanel";
import { RaceTelemetryStrip } from "./RaceTelemetryStrip";
import { deriveStandings } from "./standings";
import { useMemo, useCallback } from "react";
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
  const { actorId, displayName } = useEnduranceActor();
  const { isSuperAdmin, isEnduranceManager, isTester } = useAuth();
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

  const teamQuery = useTeams(event.id, actorId, isSuperAdmin || isEnduranceManager || isTester, !demoScenario);
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

  const strategy = isDemo ? demo.strategy : real.strategy;
  const events = isDemo ? demo.events : real.events;
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

  const currentStint = plannedStints.find((s) => s.status === "in_car");
  const nextStints = plannedStints.filter((s) => s.status === "draft");
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

  return (
    /* data-pitwall + data-pitwall-focus for CSS targeting */
    <div className={isFocusMode ? "space-y-2 w-full" : "space-y-3"} data-pitwall="true" data-pitwall-focus={isFocusMode ? "true" : undefined}>
      {/* FOCUS MODE TOP STRIP */}
      {isFocusMode && (
        <div className="flex items-center gap-3 rounded-lg bg-black/60 px-4 py-2 text-xs ring-1 ring-white/5">
          <span className="font-black text-orange-400 tracking-wider text-[10px]">3SM</span>
          <span className="h-4 w-px bg-white/10" />
          <span className="font-bold text-white">{event.name}</span>
          <span className="h-4 w-px bg-white/10" />
          {selectedTeamId && (
            <>
              <span className="text-gray-400">Team: <span className="font-bold text-white">
                {teams.find((t) => t.id === selectedTeamId)?.name ?? selectedTeamId}
              </span></span>
              <span className="h-4 w-px bg-white/10" />
            </>
          )}
          <span className={`inline-flex items-center gap-1 font-bold ${
            !isLive || strategy?.strategy_status === "low_sample"
              ? "text-yellow-400" : "text-emerald-400"
          }`}>
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
            {isLive ? "LIVE" : "OFFLINE"}
          </span>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={requestFullscreen}
              className="rounded bg-white/10 px-2 py-1 font-bold text-gray-400 hover:text-white text-[10px] transition"
            >
              Volledig scherm
            </button>
            <button
              type="button"
              onClick={exitFocus}
              className="rounded bg-white/10 px-2 py-1 font-bold text-gray-400 hover:text-white text-[10px] transition"
            >
              Focus verlaten
            </button>
          </div>
        </div>
      )}

      {/* === DEMO SWITCHER === */}
      {isDemo && !isFocusMode && (
        <div className="rounded-lg border border-dashed border-orange-500/30 bg-orange-500/[0.04] px-3 py-2">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-orange-500" />
            <span className="text-[9px] font-bold uppercase tracking-wider text-orange-400">
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

      {/* Focus toggle button — only in non-focus embedded mode */}
      {!isFocusMode && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={enterFocus}
            className="rounded bg-white/8 px-3 py-1 text-xs font-bold text-gray-400 hover:text-white transition ring-1 ring-white/10"
          >
            Focus mode
          </button>
        </div>
      )}

      {/* === TEAM SELECTOR (real mode only) === */}
      {teams.length > 1 && !isDemo && (
        <div className="flex flex-wrap gap-2">
          {teams.map((team) => (
            <button
              key={team.id}
              type="button"
              onClick={() => setSelectedTeamId(team.id)}
              className={`rounded px-3 py-1.5 text-xs font-bold transition ${
                selectedTeamId === team.id ? "bg-orange-500 text-white" : "bg-black/20 text-gray-400 hover:text-white"
              }`}
            >
              {team.name}
            </button>
          ))}
        </div>
      )}

      {/* === TOP BAR — sticky in focus mode === */}
      {strategy && (
        <TopRaceBar
          strategy={strategy}
          position={position}
          raceClock={raceClock}
          offlineMode={!isLive}
        />
      )}

      {loading && !strategy && (
        <p className="text-sm text-gray-500">Pitwall laden…</p>
      )}

      {!isDemo && (teamQuery.error || real.error) && <p role="alert" className="text-sm text-red-300">Pitwall laden mislukt. Controleer je toegang en probeer opnieuw.</p>}
      {!loading && !strategy && !isDemo && !teamQuery.error && !real.error && (
        <p className="text-sm text-gray-500">
          Geen pitwall-data beschikbaar. {!selectedTeamId && "Er is nog geen toegankelijk team voor deze race."}
        </p>
      )}

      <RaceTelemetryStrip v3={isDemo ? null : real.v3 ?? null} live={isLive} />
      <div className="grid gap-3 xl:grid-cols-[minmax(0,.9fr)_minmax(0,1.6fr)]">
        <div className="min-w-0 space-y-3">
            <LiveTrackPanel v3={isDemo ? null : real.v3 ?? null} live={isLive} fallbackTrack={[event.circuit, event.configuration].filter(Boolean).join(' - ')} />
            <VehicleTelemetryPanel key={`${event.id}:${selectedTeamId}`} v3={isDemo ? null : real.v3 ?? null} live={isLive} />
        </div>
        <div className="min-w-0 space-y-3">
              <StandingsWidget
                standings={standings}
                ownCarLabel={teams.find((t) => t.id === selectedTeamId)?.name ?? "Mijn auto"}
                ownCarNumber={null}
              />
          {strategy && <div className="grid gap-3 md:grid-cols-2">
            <FuelPanel strategy={strategy} />
              <PitStrategyBlock
                strategy={strategy}
                currentFuel={strategy.current_fuel_litres}
                driverName={driverName}
                nextDriverName={nextDriverName}
              />
          </div>}
          {strategy && <RacePositionPanel strategy={strategy} position={position} />}
        </div>
      </div>
      {strategy && (
        <>
          <div className="grid gap-3 lg:grid-cols-3">
            <div className="space-y-3">
              <StintDriverPanel strategy={strategy} plannedStints={plannedStints} driverName={driverName} />
            </div>
            <div className="space-y-3">
              <StrategyForecast
                strategy={strategy}
                position={position}
                pace={pace}
                plannedStints={plannedStints}
                nextDriverName={nextDriverName}
              />
            </div>
            <div className="space-y-3">
              <PacePanel strategy={strategy} pace={pace} />
            </div>
          </div>

          <AlertZone alerts={alerts} />
          <RaceTimeline events={events} plannedStints={plannedStints} />
        </>
      )}
    </div>
  );
};

interface Props {
  event: EnduranceEvent;
}
