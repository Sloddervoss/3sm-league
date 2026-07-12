import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { PointsConfigRow, PointsConfigDraftEntry } from "./types";
import { DEFAULT_POINTS_PRESET } from "./types";

/**
 * Normalise an unordered set of points_config rows into a deterministic
 * 15-element draft array. Missing positions are filled with 0 points.
 */
function rowsToDraft(rows: PointsConfigRow[]): PointsConfigDraftEntry[] {
  const map = new Map<number, number>();
  for (const row of rows) {
    map.set(row.position, row.points);
  }

  const draft: PointsConfigDraftEntry[] = [];
  for (let position = 1; position <= 15; position++) {
    draft.push({ position, points: map.get(position) ?? 0 });
  }
  return draft;
}

export interface UsePointsConfigResult {
  /** All leagues the user can manage (for the league picker). */
  leagues: Array<{ id: string; name: string; season: string | null }>;
  /** Currently selected league id. */
  leagueId: string | null;
  /** Set league to edit. */
  setLeagueId: (id: string | null) => void;
  /** True while initial points data is loading. */
  loading: boolean;
  /** Top-level read error string, if any. */
  error: string | null;
  /** The current 15-position editable draft. */
  draft: PointsConfigDraftEntry[];
  /** Update a single position's points value. */
  updatePosition: (position: number, points: number) => void;
  /** Reset the draft to the DEFAULT_POINTS_PRESET locally. */
  resetToDefault: () => void;
  /** True if the draft differs from the last server snapshot. */
  dirty: boolean;
  /** Persist the complete draft using points_config's league_id,position upsert key. */
  save: () => void;
  /** True while the production points_config upsert is in flight. */
  saving: boolean;
  /** Error from the most recent save attempt, if any. */
  saveError: string | null;
  /** True after a successful save until the user edits or changes league. */
  saveSuccess: boolean;
}

export function usePointsConfig(): UsePointsConfigResult {
  const { user, isAdmin, isSuperAdmin } = useAuth();
  const canRead = Boolean(user && (isAdmin || isSuperAdmin));
  const queryClient = useQueryClient();

  const [leagueId, setLeagueId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PointsConfigDraftEntry[]>([]);
  const serverSnapshot = useRef<PointsConfigDraftEntry[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const { data: leagues = [], isLoading: leaguesLoading, error: leaguesError } = useQuery({
    queryKey: ["control-room", "leagues"],
    enabled: canRead,
    queryFn: async (): Promise<Array<{ id: string; name: string; season: string | null }>> => {
      const { data, error } = await supabase
        .from("leagues")
        .select("id,name,season")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; name: string; season: string | null }>;
    },
  });

  useEffect(() => {
    if (!leagueId && leagues.length > 0) {
      setLeagueId(leagues[0].id);
    }
  }, [leagueId, leagues]);

  const {
    data: configRows = [],
    isLoading: configLoading,
    error: configError,
  } = useQuery({
    queryKey: ["control-room", "points-config", leagueId],
    enabled: canRead && Boolean(leagueId),
    queryFn: async (): Promise<PointsConfigRow[]> => {
      if (!leagueId) return [];
      const { data, error } = await supabase
        .from("points_config")
        .select("id,league_id,position,points")
        .eq("league_id", leagueId)
        .order("position", { ascending: true });
      if (error) throw error;
      return (data ?? []) as PointsConfigRow[];
    },
  });

  useEffect(() => {
    if (configRows.length > 0) {
      const nextDraft = rowsToDraft(configRows);
      setDraft(nextDraft);
      serverSnapshot.current = nextDraft;
      setDirty(false);
    } else if (leagueId) {
      setDraft(DEFAULT_POINTS_PRESET);
      serverSnapshot.current = DEFAULT_POINTS_PRESET;
      setDirty(false);
    }
  }, [configRows, leagueId]);

  useEffect(() => {
    if (serverSnapshot.current.length === 0 && draft.length === 0) {
      setDirty(false);
      return;
    }

    const snapshot = serverSnapshot.current;
    setDirty(
      snapshot.length !== draft.length ||
        draft.some((entry, index) => {
          const saved = snapshot[index];
          return !saved || saved.position !== entry.position || saved.points !== entry.points;
        }),
    );
  }, [draft]);

  useEffect(() => {
    setSaveSuccess(false);
  }, [leagueId]);

  const updatePosition = useCallback((position: number, points: number) => {
    setSaveSuccess(false);
    setDraft((previous) =>
      previous.map((entry) => (entry.position === position ? { ...entry, points } : entry)),
    );
  }, []);

  const resetToDefault = useCallback(() => {
    setSaveSuccess(false);
    setDraft(DEFAULT_POINTS_PRESET);
  }, []);

  const savePointsConfig = useMutation({
    mutationFn: async () => {
      if (!leagueId) throw new Error("Kies eerst een seizoen.");

      const rows = draft.map(({ position, points }) => ({
        league_id: leagueId,
        position,
        points,
      }));
      const { error } = await supabase
        .from("points_config")
        .upsert(rows, { onConflict: "league_id,position" });
      if (error) throw error;
      return leagueId;
    },
    onSuccess: async (savedLeagueId) => {
      const queryKey = ["control-room", "points-config", savedLeagueId];
      await queryClient.invalidateQueries({ queryKey });
      await queryClient.refetchQueries({ queryKey, type: "active" });
      setSaveSuccess(true);
      toast.success("Punten systeem opgeslagen!");
    },
    onError: (saveError: Error) => {
      setSaveSuccess(false);
      toast.error(saveError.message);
    },
  });

  const loading = leaguesLoading || (Boolean(leagueId) && configLoading);
  const error = leaguesError?.message ?? configError?.message ?? null;

  return {
    leagues,
    leagueId,
    setLeagueId,
    loading: canRead && loading,
    error,
    draft,
    updatePosition,
    resetToDefault,
    dirty,
    save: savePointsConfig.mutate,
    saving: savePointsConfig.isPending,
    saveError: savePointsConfig.error?.message ?? null,
    saveSuccess,
  };
}
