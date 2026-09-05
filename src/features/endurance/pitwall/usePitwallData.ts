import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchPitwallData } from "../repository/pitwallRepository";
import type {
  PitwallStrategyRow, PitwallTimelineEvent, TeamOption,
  PitwallPositionData, PitwallPaceData, PitwallRaceClock,
  V3Normalized, PitwallPlannedStint, V3Opponent,
} from "./pitwallHelpers";
import { extractRaceClock } from "./pitwallHelpers";
import { OpponentHistory } from "./opponentHistory";

/* ==========================================================================
 * REAL MODE: uses get_pitwall_data() RPC.
 *
 * This RPC is SECURITY DEFINER — it checks own-team membership (via
 * endurance_team_members) or is_endurance_staff. It returns a combined
 * jsonb payload with telemetry, strategy, timeline, planned stints,
 * pace targets, and team info.
 *
 * The RPC was created by migration 20260904110000_pitwall_v1_read_rpc.sql.
 * ========================================================================== */

interface PitwallRpcResponse {
  team: {
    id: string;
    name: string | null;
    car_id: string | null;
    car_number: string | null;
  } | null;
  telemetry: Record<string, unknown> | null;
  v3_normalized: V3Normalized | null;
  opponent_trends?: Record<string, { closing_rate_s_per_min: number | null; sample_count: number; window_seconds: number }> | null;
  strategy: PitwallStrategyRow | null;
  timeline: PitwallTimelineEvent[];
  planned_stints: PitwallPlannedStint[];
  pace_targets: Array<{
    user_id: string;
    average_lap_seconds: number;
    best_lap_seconds: number;
    valid_laps: number;
    source: string;
  }>;
  access: "staff" | "team_member";
}


/** Extract PitwallPositionData from V3 normalized telemetry */
function extractPosition(v3?: V3Normalized | null): PitwallPositionData | null {
  if (!v3?.position) return null;
  const p = v3.position;
  if (p.position == null && p.classPosition == null && p.gapToLeaderSeconds == null) return null;
  return {
    overallPosition: p.position ?? null,
    classPosition: p.classPosition ?? null,
    gapToLeaderSeconds: p.gapToLeaderSeconds ?? null,
  };
}

/** Extract PitwallPaceData from V3 normalized telemetry */
function extractPace(v3?: V3Normalized | null): PitwallPaceData | null {
  if (!v3?.timing) return null;
  const t = v3.timing;
  if (t.lastLapTimeSeconds == null && t.bestLapTimeSeconds == null) return null;
  return {
    lastLapSeconds: t.lastLapTimeSeconds ?? null,
    bestLapSeconds: t.bestLapTimeSeconds ?? null,
    stintAvgSeconds: null, /* Not available from V3 raw — requires calc */
    targetSeconds: null,   /* Requires pace target data from planner */
  };
}

/** Extract team list from RPC response */
function extractTeams(rpc: PitwallRpcResponse): TeamOption[] {
  const list: TeamOption[] = [];
  if (rpc.team) {
    list.push({ id: rpc.team.id, name: rpc.team.name ?? "Onbekend team" });
  }
  return list;
}

export function usePitwallData(eventId: string, initialTeamId: string | null, actorId = "") {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 3_000);
    return () => window.clearInterval(timer);
  }, []);
  const contextKey = `${eventId}:${actorId}`;
  const [selection, setSelection] = useState<{ contextKey: string; teamId: string | null } | null>(null);
  const selectedTeamId = selection?.contextKey === contextKey ? selection.teamId : initialTeamId;
  const setSelectedTeamId = (teamId: string | null) => setSelection({ contextKey, teamId });

  const rpcQuery = useQuery({
    queryKey: ["pitwall", "rpc", eventId, selectedTeamId, actorId],
    enabled: Boolean(eventId) && Boolean(selectedTeamId),
    refetchInterval: 3_000,
    queryFn: async () => await fetchPitwallData(eventId, selectedTeamId!) as PitwallRpcResponse,
  });

  const rpcData = rpcQuery.data;
  const receivedAt = rpcData?.telemetry?.received_at;
  const isLive = !rpcQuery.error && typeof receivedAt === "string" && now - Date.parse(receivedAt) < 30_000;
  const loading = rpcQuery.isLoading;
  const error = rpcQuery.error;

  /* Extract data from RPC response */
  const strategy = rpcData?.strategy ?? null;
  const events = rpcData?.timeline ?? [];
  const teams = rpcData ? extractTeams(rpcData) : [];
  const v3 = rpcData?.v3_normalized ?? null;
  const position = extractPosition(v3);
  const pace = extractPace(v3);
  const raceClock = extractRaceClock(v3);
  const plannedStints = rpcData?.planned_stints ?? [];

  /** 0.4.2: opponents from the V3 normalized snapshot (connected + player rows). */
  const opponents: V3Opponent[] = useMemo(() => {
    const list = v3?.opponents;
    return Array.isArray(list) ? list : [];
  }, [v3]);

  /** 0.4.3: server-derived opponent trends (production source of truth).
 *  get_pitwall_data.opponent_trends comes from the server-side sampled history.
 *  Client-side OpponentHistory is retained DEV-only for diagnostics (never the
 *  production authority). Two competing live trend sources are avoided. */
  const historyRef = useRef<OpponentHistory | null>(null);
  const trends: Record<string, number | null> = useMemo(() => {
    // Production: consume server-derived trends when present.
    const server = rpcData?.opponent_trends;
    if (server && Object.keys(server).length > 0) {
      const map: Record<string, number | null> = {};
      for (const id of Object.keys(server)) map[id] = server[id]?.closing_rate_s_per_min ?? null;
      return map;
    }
    // DEV-only: browser-local sampled history as a diagnostics fallback.
    if (import.meta.env.DEV) {
      if (!historyRef.current) historyRef.current = new OpponentHistory();
      const now = Date.now() / 1000;
      historyRef.current.record(opponents, now);
      const map: Record<string, number | null> = {};
      for (const o of opponents) if (o.id) map[o.id] = historyRef.current.trendFor(o.id);
      return map;
    }
    // Production without server trends yet => no trend (null).
    return {};
  }, [rpcData, opponents]);

  /* Derive alert conditions from strategy data */
  const alerts = useMemo(() => {
    const list: Array<{ severity: "high" | "medium" | "info"; message: string }> = [];
    if (!isLive) return [{ severity: "medium" as const, message: "Geen actuele telemetrie — controleer de verbinding; eerdere waarden kunnen verouderd zijn." }];
    if (!strategy) return list;

    const lapsRemaining = strategy.fuel_laps_remaining;

    if (lapsRemaining != null) {
      if (lapsRemaining < 1) {
        list.push({ severity: "high", message: "PIT DEZE RONDE — brandstof kritiek" });
      } else if (lapsRemaining < 3) {
        list.push({ severity: "high", message: `PIT OVER ${Math.floor(lapsRemaining)} — brandstof` });
      } else if (lapsRemaining < 5) {
        list.push({ severity: "medium", message: `PIT OVER ${Math.floor(lapsRemaining)}` });
      }
    }

    if (strategy.strategy_status === "low_sample") {
      list.push({ severity: "info", message: "Strategie: weinig data" });
    }
    if (strategy.strategy_status === "insufficient_data") {
      list.push({ severity: "medium", message: "Strategie: onvoldoende data" });
    }

    return list;
  }, [strategy, isLive]);

  return {
    strategy,
    events,
    teams,
    alerts,
    loading,
    error,
    selectedTeamId,
    setSelectedTeamId,
    position,
    pace,
    raceClock,
    plannedStints,
    opponents,
    trends,
    v3,
    isLive,
  };
}
