import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEnduranceActor } from "../core/ActorContext";
import type { EnduranceEvent } from "../core/types";
import { usePitwallData } from "./usePitwallData";
import { TopRaceBar } from "./TopRaceBar";
import { PitStrategyBlock } from "./PitStrategyBlock";
import { FuelPanel } from "./FuelPanel";
import { StintDriverPanel } from "./StintDriverPanel";
import { PacePanel } from "./PacePanel";
import { RacePositionPanel } from "./RacePositionPanel";
import { AlertZone } from "./AlertZone";
import { RaceTimeline } from "./RaceTimeline";
import { StrategyForecast } from "./StrategyForecast";

const useMemberships = (eventId: string) => {
  const { actorId } = useEnduranceActor();
  return useQuery({
    queryKey: ["pitwall", "memberships", eventId],
    enabled: Boolean(eventId),
    queryFn: async () => {
      const sb = supabase as unknown as {
        from: (t: string) => {
          select: (s: string) => {
            eq: (k: string, v: string) => {
              eq: (k2: string, v2: string) => Promise<{ data: unknown; error: unknown }>
            }
          }
        }
      };
      const { data, error } = await sb.from("endurance_team_members").select("team_id").eq("event_id", eventId).eq("user_id", actorId);
      if (error) throw error;
      return (data as Array<{ team_id: string }> ?? []) as Array<{ team_id: string }>;
    },
  });
};

export const PitwallTab = ({ event }: Props) => {
  const { actorId } = useEnduranceActor();
  const { data: memberships } = useMemberships(event.id);

  const myTeamId = memberships && memberships.length > 0 ? memberships[0].team_id : null;

  const {
    strategy,
    events,
    teams,
    alerts,
    loading,
    selectedTeamId,
    setSelectedTeamId,
  } = usePitwallData(event.id, myTeamId);

  return (
    <div className="space-y-4">
      {/* Team selector — visible when staff sees multiple teams */}
      {teams.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {teams.map((team) => (
            <button
              key={team.id}
              type="button"
              onClick={() => setSelectedTeamId(team.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                selectedTeamId === team.id
                  ? "bg-orange-500 text-white"
                  : "bg-black/20 text-gray-400 hover:text-white"
              }`}
            >
              {team.name}
            </button>
          ))}
        </div>
      )}

      {/* Top Race Bar — visible even when loading */}
      {strategy && <TopRaceBar strategy={strategy} />}

      {loading && !strategy && (
        <p className="text-sm text-gray-500">Pitwall laden…</p>
      )}

      {!loading && !strategy && (
        <p className="text-sm text-gray-500">
          Geen pitwall-data beschikbaar. {!selectedTeamId && "Selecteer een team om te beginnen."}
        </p>
      )}

      {strategy && (
        <>
          <AlertZone alerts={alerts} />

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-4">
              <PacePanel strategy={strategy} paceTargets={[]} />
              <FuelPanel strategy={strategy} />
              <StintDriverPanel
                strategy={strategy}
                plannedStints={[]}
                driverName={null}
              />
            </div>

            <div className="space-y-4">
              <PitStrategyBlock
                strategy={strategy}
                currentFuel={strategy.current_fuel_litres}
                driverName={null}
              />
              <StrategyForecast strategy={strategy} />
            </div>

            <div className="space-y-4">
              <RacePositionPanel strategy={strategy} />
              <RaceTimeline events={events} plannedStints={[]} />
            </div>
          </div>
        </>
      )}
    </div>
  );
};

interface Props {
  event: EnduranceEvent;
}