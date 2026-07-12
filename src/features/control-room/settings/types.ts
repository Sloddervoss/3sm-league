import type { ControlRoomActionId, ControlRoomPanelId } from "../actionModel";
import type { Database } from "@/integrations/supabase/types";

/** Raw row shape from the points_config table, as returned by Supabase. */
export type PointsConfigRow = Database["public"]["Tables"]["points_config"]["Row"];

/** A single position-points entry in the local draft array. */
export interface PointsConfigDraftEntry {
  position: number; // 1-indexed (1–15)
  points: number;
}

/** Typed action emitted via the onSave callback for the parent action router. */
export type PointsManagerAction = {
  id: Extract<ControlRoomActionId, "points-config">;
  impact: "write";
  allowedRoles: Array<"admin" | "super_admin">;
  panel: Extract<ControlRoomPanelId, "points-manager">;
  context: {
    leagueId: string;
    /** The complete 15-entry draft array the parent should persist. */
    entries: PointsConfigDraftEntry[];
  };
};

/** Default 15-point F1-style preset. */
export const DEFAULT_POINTS_PRESET: PointsConfigDraftEntry[] = [
  { position: 1, points: 25 },
  { position: 2, points: 20 },
  { position: 3, points: 16 },
  { position: 4, points: 13 },
  { position: 5, points: 11 },
  { position: 6, points: 10 },
  { position: 7, points: 9 },
  { position: 8, points: 8 },
  { position: 9, points: 7 },
  { position: 10, points: 6 },
  { position: 11, points: 5 },
  { position: 12, points: 4 },
  { position: 13, points: 3 },
  { position: 14, points: 2 },
  { position: 15, points: 1 },
];