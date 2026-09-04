import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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
import { deriveStandings } from "./standings";
import { useMemo, useCallback, useState } from "react";
import { useLocation } from "react-router-dom";
import type { PitwallPositionData, PitwallPaceData, PitwallRaceClock } from "./pitwallHelpers";

const useMemberships = (eventId: string, actorId: string, enabled: boolean) => {
  return useQuery({
    queryKey: ["pitwall", "memberships", eventId],
    enabled: Boolean(eventId) && enabled,
    queryFn: async () => {
      const sb = supabase as unknown as {
        from: (t: string) => { select: (s: string) => { eq: (k: string, v: string) => { eq: (k2: string, v2: string) => Promise<{ data: unknown; error: unknown }> } } }
      };
      const { data, error } = await sb.from("endurance_team_members").select("team_id").eq("event_id", eventId).eq("user_id", actorId);
      if (error) throw error;
      return (data as Array<{ team_id: string }> ?? []) as Array<{ team_id: string }>;
    },
  });
};

export const PitwallTab = ({ event }: Props) => {
  const { actorId } = useEnduranceActor();
  const location = useLocation();
  const [focusButtonMode, setFocusButtonMode] = useState(false);

  /* Focus mode: from URL or button state */
  const isFocusMode = useMemo(() => {
    try {
      const params = new URLSearchParams(location.search);
      return params.get("pitwallFocus") === "1" || focusButtonMode;
    } catch { return focusButtonMode; }
  }, [location.search, focusButtonMode]);

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
    window.history.replaceState(null, "", `${location.pathname}?${params.toString()}`);
  }, [location.pathname, location.search]);

  const { data: memberships } = useMemberships(event.id, actorId, !demoScenario);
  const myTeamId = memberships && memberships.length > 0 ? memberships[0].team_id : null;

  const real = usePitwallData(
    demoScenario ? "" : event.id,
    demoScenario ? null : myTeamId
  );

  const demo: DemoData | null = useMemo(() => {
    if (!demoScenario) return null;
    return getDemoData(demoScenario);
  }, [demoScenario]);

  const isDemo = import.meta.env.DEV && demo !== null;

  const strategy = isDemo ? demo.strategy : real.strategy;
  const events = isDemo ? demo.events : real.events;
  const teams = isDemo ? demo.teams : real.teams;
  const plannedStints = isDemo ? demo.plannedStints : real.plannedStints;
  const alerts = isDemo ? demo.alerts : real.alerts;
  const loading = isDemo ? demo.loading : real.loading;
  const selectedTeamId = isDemo ? "demo-team" : real.selectedTeamId;
  const setSelectedTeamId = isDemo ? (id: string | null) => {} : real.setSelectedTeamId;

  const position: PitwallPositionData | null = isDemo ? demo.position : real.position ?? null;
  const pace: PitwallPaceData | null = isDemo ? demo.pace : real.pace ?? null;
  const raceClock: PitwallRaceClock | null = isDemo ? demo.raceClock : real.raceClock ?? null;

  /* 0.4.2: live standings derivation from opponent snapshot (real or demo). */
  const standings = useMemo(() => {
    if (isDemo) {
      return deriveStandings({
        position: { position: demo.position.overallPosition ?? undefined, classPosition: demo.position.classPosition ?? undefined, gapToLeaderSeconds: demo.position.gapToLeaderSeconds ?? undefined },
        opponents: demo.opponents,
      });
    }
    return deriveStandings(real.v3 ?? null);
  }, [isDemo, demo, real.v3]);

  const currentStint = plannedStints.find((s) => s.status === "in_car");
  const nextStints = plannedStints.filter((s) => s.status === "draft");
  const nextStint = nextStints[0];
  const driverName = isDemo ? (currentStint?.driver_id ?? null) : null;
  const nextDriverName = isDemo ? (nextStint?.driver_id ?? null) : null;

  const enterFocus = useCallback(() => setFocusButtonMode(true), []);
  const exitFocus = useCallback(() => {
    setFocusButtonMode(false);
    try {
      const params = new URLSearchParams(location.search);
      params.delete("pitwallFocus");
      const search = params.toString();
      window.history.replaceState(null, "", `${location.pathname}${search ? `?${search}` : ""}`);
    } catch { /* ignore */ }
  }, [location.pathname, location.search]);

  const requestFullscreen = useCallback(() => {
    try { document.documentElement.requestFullscreen?.(); } catch { /* not available */ }
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
            strategy?.strategy_status === "insufficient_data" || strategy?.strategy_status === "low_sample"
              ? "text-yellow-400" : "text-emerald-400"
          }`}>
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
            {strategy?.strategy_status === "insufficient_data" ? "OFFLINE" : "LIVE"}
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
      {teams.length > 1 && !isDemo && !isFocusMode && (
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
          offlineMode={strategy.strategy_status === "insufficient_data"}
        />
      )}

      {loading && !strategy && (
        <p className="text-sm text-gray-500">Pitwall laden…</p>
      )}

      {!loading && !strategy && !isDemo && (
        <p className="text-sm text-gray-500">
          Geen pitwall-data beschikbaar. {!selectedTeamId && "Selecteer een team om te beginnen."}
        </p>
      )}

      {strategy && (
        <>
          {/* === MAIN GRID: 3 ROWS === */}
          <div className="grid gap-3 lg:grid-cols-3">
            <div className="space-y-3">
              <StandingsWidget
                standings={standings}
                ownCarLabel={teams.find((t) => t.id === selectedTeamId)?.name ?? "Mijn auto"}
                ownCarNumber={null}
              />
              <RacePositionPanel strategy={strategy} position={position} />
            </div>
            <div className="space-y-3">
              <PitStrategyBlock
                strategy={strategy}
                currentFuel={strategy.current_fuel_litres}
                driverName={driverName}
                nextDriverName={nextDriverName}
              />
            </div>
            <div className="space-y-3">
              <StintDriverPanel
                strategy={strategy}
                plannedStints={plannedStints}
                driverName={driverName}
              />
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <div className="space-y-3">
              <FuelPanel strategy={strategy} />
              <div data-pitwall-slot="tyres" className="hidden" />
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
              <div data-pitwall-slot="trackmap" className="hidden" />
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