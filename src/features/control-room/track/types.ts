import type { TrackInsight, TrackIntelligenceSource } from "@/lib/trackIntelligence";
import type { ControlRoomActionId, ControlRoomPanelId, ControlRoomRole } from "../actionModel";

export type TrackRun = {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  triggered_by_admin_id: string | null;
  trigger_type: string;
  members_total: number | null;
  members_success: number | null;
  members_failed: number | null;
  created_records: number | null;
  error_summary: string | null;
};

export type LinkedTrackProfile = {
  user_id: string;
  display_name: string | null;
  iracing_name: string | null;
  iracing_id: string | null;
};

export type TrackSyncAction = {
  id: Extract<ControlRoomActionId, "track-sync">;
  impact: "write";
  allowedRoles: Array<Extract<ControlRoomRole, "admin" | "super_admin">>;
  panel: Extract<ControlRoomPanelId, "track-sync-confirm">;
  context: { linkedMemberCount: number; latestRun: TrackRun | null };
};

export type TrackLogAction = {
  id: Extract<ControlRoomActionId, "track-log">;
  impact: "read";
  allowedRoles: Array<Extract<ControlRoomRole, "admin" | "super_admin">>;
  panel: Extract<ControlRoomPanelId, "track-run-log">;
  context: { runs: TrackRun[] };
};

export type TrackExportAction = {
  id: Extract<ControlRoomActionId, "track-export">;
  impact: "read";
  allowedRoles: Array<Extract<ControlRoomRole, "admin" | "super_admin">>;
  panel: Extract<ControlRoomPanelId, "track-export">;
  context: { scope: "analysis" | "shortlist"; source: "csv"; rowCount: number };
};

export type TrackIntelligenceAction = TrackSyncAction | TrackLogAction | TrackExportAction;

export type TrackFilter = "all" | TrackIntelligenceSource;

export type TrackIntelligenceData = {
  linkedProfiles: LinkedTrackProfile[];
  insights: TrackInsight[];
  runs: TrackRun[];
  loading: boolean;
  errors: string[];
};
