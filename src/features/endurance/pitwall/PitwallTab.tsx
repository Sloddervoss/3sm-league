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
import { useMemo, useCallback } from "react";
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
  const plannedStints = isDemo ? demo.plannedStints : [];
  const alerts = isDemo ? demo.alerts : real.alerts;
  const loading = isDemo ? demo.loading : real.loading;
  const selectedTeamId = isDemo ? "demo-team" : real.selectedTeamId;
  const setSelectedTeamId = isDemo ? (id: string | null) => {} : real.setSelectedTeamId;

  const position: PitwallPositionData | null = isDemo ? demo.position : null;
  const pace: PitwallPaceData | null = isDemo ? demo.pace : null;
  const raceClock: PitwallRaceClock | null = isDemo ? demo.raceClock : null;

  const currentStint = plannedStints.find((s) => s.status === "in_car");
  const nextStints = plannedStints.filter((s) => s.status === "draft");
  const nextStint = nextStints[0];
  const driverName = isDemo ? (currentStint?.driver_id ?? null) : null;
  const nextDriverName = isDemo ? (nextStint?.driver_id ?? null) : null;

  return (
    /* data-pitwall enables future fullscreen CSS targeting */
    <div className="space-y-3" data-pitwall="true">
      {/* === DEMO SWITCHER === */}
      {isDemo && (
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

      {/* === TOP BAR === */}
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
          {/* ROW 1: Positie | Pit Actie (center) | Coureur */}
          <div className="grid gap-3 lg:grid-cols-3">
            <div className="space-y-3">
              {/* Future slot: Live Standings can go here above RacePositionPanel */}
              <div data-pitwall-slot="standings" className="hidden" />
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

          {/* ROW 2: Brandstof | Forecast | Pace */}
          <div className="grid gap-3 lg:grid-cols-3">
            <div className="space-y-3">
              {/* Future slot: Tyres can go here below FuelPanel */}
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
              {/* Future slot: Track map can go here below PacePanel */}
              <div data-pitwall-slot="trackmap" className="hidden" />
            </div>
          </div>

          {/* ROW 3: Alerts + Timeline — full width */}
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