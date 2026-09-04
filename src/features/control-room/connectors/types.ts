export interface SimHubFleetRow {
  device_id: string;
  device_name: string;
  device_status: "active_binding" | "inactive" | "revoked";
  device_role: "primary" | "standby" | "practice" | null;
  revoked_at: string | null;
  last_seen_at: string | null;
  endurance_event_id: string | null;
  endurance_team_id: string | null;
  endurance_binding_source: string | null;
  endurance_event_name: string | null;
  endurance_team_name: string | null;
  connector_version: string | null;
  simhub_version: string | null;
  game_connected: boolean | null;
  telemetry_available: boolean | null;
  diagnostic_code: string | null;
  health_received_at: string | null;
  updater_state: string | null;
  updater_current_version: string | null;
  updater_target_version: string | null;
  last_update_result: string | null;
  last_update_utc: string | null;
  telemetry_received_at: string | null;
  telemetry_game: string | null;
  telemetry_car_name: string | null;
  telemetry_track_name: string | null;
  telemetry_driver_name: string | null;
}

export interface SimHubDeviceDetail {
  device: {
    id: string;
    device_name: string;
    device_status: string;
    device_role: string | null;
    revoked_at: string | null;
    last_seen_at: string | null;
    last_session_id: string | null;
    last_sequence: number;
    endurance_event_id: string | null;
    endurance_team_id: string | null;
    endurance_binding_source: string | null;
    paired_at: string | null;
  };
  health: {
    connector_version: string;
    simhub_version: string;
    game_connected: boolean;
    telemetry_available: boolean;
    raw_data_available: boolean;
    raw_telemetry_available: boolean;
    session_time_read_ok: boolean;
    session_time_seconds: number | null;
    session_time_reader: string;
    sequence: number;
    client_last_telemetry_attempt_utc: string | null;
    client_last_successful_ingest_utc: string | null;
    client_last_ingest_http_status: number | null;
    diagnostic_code: string;
    updater_state: string;
    updater_current_version: string;
    updater_target_version: string | null;
    last_update_result: string | null;
    last_update_utc: string | null;
    client_reported_at_utc: string | null;
    received_at: string;
  } | null;
  telemetry: {
    device_id: string;
    owner_user_id: string;
    session_id: string;
    sequence: number;
    captured_at: string;
    received_at: string;
    connector_id: string;
    simhub_version: string;
    game: string;
    telemetry: Record<string, unknown>;
    endurance_event_id: string | null;
    endurance_team_id: string | null;
    driver_id: string | null;
    current_driver_id: string | null;
    current_driver_name: string | null;
    car_id: string | null;
    car_name: string | null;
    track_name: string | null;
    track_config: string | null;
    race_run_id: string | null;
    v3_normalized: Record<string, unknown> | null;
  } | null;
  endurance_event: Record<string, unknown> | null;
  endurance_team: Record<string, unknown> | null;
  diagnostic_events: Array<{
    id: number;
    code: string;
    exception_type: string | null;
    detail: string | null;
    reported_at_utc: string | null;
    received_at: string;
  }>;
}

export type HealthStatus = "online" | "offline" | "unknown";
export type TelemetryStatus = "live" | "stale" | "none" | "unknown";
export type DiagnosticStatus = "ok" | "warning" | "error" | "unknown";
export type GameStatus = "connected" | "disconnected" | "unknown";
export type UpdaterStatus = "current" | "update_available" | "updating" | "failed" | "unknown";