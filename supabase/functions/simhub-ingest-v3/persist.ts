// Telemetry V3 Phase E — latest + event persistence (service_role direct writes).
//
// The V3 Edge writes V3 snapshots into the EXISTING production base tables
// (endurance_telemetry_events, simhub_telemetry_latest) using their existing
// columns plus the Phase E additive columns (race_run_id on event+latest,
// v3_normalized on latest). No new RPC, no schema object reachable from here is
// created by this module, and no policy/grant is touched: service_role already
// holds ALL on both base tables and bypasses RLS in Supabase.
//
// This module is intentionally free of Deno/esm.sh imports so its pure
// transition/detection logic is unit-testable under vitest.
import type { NormalizedTelemetryEnvelope } from "../_shared/simhub.ts";

export type V3DeviceSource = {
  id: string;
  ownerUserId: string | null;
  raceId: string | null;
  teamId: string | null;
  connectorId: string | null;
  deviceName: string | null;
};

export type V3SnapshotInput = {
  device: V3DeviceSource;
  eventId: string;
  teamId: string;
  raceRunId: string | null;
  normalized: NormalizedTelemetryEnvelope;
  receivedAt?: string;
};

export type V3PrevState = {
  completedLaps: number | null;
  incidents: number | null;
  onPitRoad: boolean | null;
  flags: string[] | null;
};

export type V3TransitionEvent =
  | { eventType: "lap_completed"; eventKey: string; completedLaps: number }
  | { eventType: "incident_count_changed"; eventKey: string; incidents: number }
  | { eventType: "flag_change"; eventKey: string; flag: string | null }
  | { eventType: "pit_entry"; eventKey: string }
  | { eventType: "pit_exit"; eventKey: string };

// A deliberately loose query-builder interface so the orchestration stays
// testable without importing @supabase/supabase-js (the V3 Edge passes its real
// service client here; tests pass a small fake).
export type V3Query = {
  select(columns: string): V3Query;
  eq(column: string, value: unknown): V3Query;
  order(column: string, options: { ascending: boolean }): V3Query;
  limit(count: number): V3Query;
  upsert(rows: Record<string, unknown>[], options?: { onConflict?: string; ignoreDuplicates?: boolean }): Promise<{ error: unknown | null }>;
  then<TResult>(resolve: (value: unknown) => TResult | PromiseLike<TResult>): Promise<TResult>;
};
export type V3Db = {
  from(table: string): V3Query;
};

export const canonicalizeFlags = (flags: string[] | null): string[] | null => {
  if (flags === null) return null;
  return Array.from(new Set(flags.map((f) => f.toLowerCase()).filter(Boolean))).sort();
};

export const sameFlags = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) return false;
  return a.every((flag, index) => flag === b[index]);
};

export const v3SnapshotState = (n: NormalizedTelemetryEnvelope): V3PrevState => ({
  completedLaps: n.timing.completedLaps,
  incidents: n.raceState.incidents,
  onPitRoad: n.track.onPitRoad,
  flags: canonicalizeFlags(n.session.flags),
});

/**
 * Detect V3 transitions against the previous snapshot state.
 * - lap_completed only on an exact +1 advance (no synthetic laps on jumps).
 * - incident_count_changed only on a monotone incident increase.
 * - flag_change on any canonical flag-set change.
 * - pit_entry / pit_exit on the onPitRoad boolean edge.
 * previous==null (a "baseline" first snapshot) yields NO transitions, matching
 * the handoff-baseline rule: a fresh source segment must not fabricate a
 * cross-source transition.
 */
export const detectV3Transitions = (
  prev: V3PrevState,
  next: V3PrevState,
  sequence: number,
): V3TransitionEvent[] => {
  const events: V3TransitionEvent[] = [];
  if (prev.completedLaps !== null && next.completedLaps !== null
    && next.completedLaps === prev.completedLaps + 1) {
    events.push({ eventType: "lap_completed", eventKey: `lap:${next.completedLaps}`, completedLaps: next.completedLaps });
  }
  if (prev.incidents !== null && next.incidents !== null
    && next.incidents > prev.incidents) {
    events.push({ eventType: "incident_count_changed", eventKey: `incident:${next.incidents}`, incidents: next.incidents });
  }
  if (prev.flags !== null && next.flags !== null && !sameFlags(prev.flags, next.flags)) {
    events.push({ eventType: "flag_change", eventKey: `flag:${sequence}`, flag: next.flags.join(",") || null });
  }
  if (prev.onPitRoad !== null && next.onPitRoad !== null
    && prev.onPitRoad === false && next.onPitRoad === true) {
    events.push({ eventType: "pit_entry", eventKey: `pit_entry:${sequence}` });
  }
  if (prev.onPitRoad !== null && next.onPitRoad !== null
    && prev.onPitRoad === true && next.onPitRoad === false) {
    events.push({ eventType: "pit_exit", eventKey: `pit_exit:${sequence}` });
  }
  return events;
};

const buildV3TelemetryJso = (n: NormalizedTelemetryEnvelope): Record<string, unknown> => ({
  protocolVersion: 3,
  sessionTimeSeconds: n.session.sessionTimeSeconds,
  completedLaps: n.timing.completedLaps,
  position: n.position.position,
  incidents: n.raceState.incidents,
  flag: canonicalizeFlags(n.session.flags)?.join(",") ?? null,
  inPitLane: n.track.onPitRoad,
  isInCar: n.session.isInCar,
});

const baseRow = (ctx: V3SnapshotInput) => {
  const n = ctx.normalized;
  return {
    device_id: ctx.device.id,
    event_id: ctx.eventId,
    team_id: ctx.teamId,
    session_id: n.transportSessionId,
    sequence: n.sequence,
    captured_at: n.capturedAt,
    received_at: ctx.receivedAt ?? new Date().toISOString(),
    race_run_id: ctx.raceRunId,
  };
};

/** A per-snapshot V3 sample event, reusing the existing scalar event columns. */
export const buildV3SampleEvent = (ctx: V3SnapshotInput): Record<string, unknown> => {
  const n = ctx.normalized;
  return {
    ...baseRow(ctx),
    event_type: "sample",
    event_key: `seq:${n.sequence}`,
    completed_laps: n.timing.completedLaps,
    incidents: n.raceState.incidents,
    in_pit_lane: n.track.onPitRoad,
    flag: canonicalizeFlags(n.session.flags)?.join(",") ?? null,
    is_in_car: n.session.isInCar,
    event_detection_source: "v3_sample",
    payload: n,
  };
};

/** A V3 transition event row reused from the existing event columns. */
export const buildV3TransitionRow = (
  ctx: V3SnapshotInput,
  ev: V3TransitionEvent,
): Record<string, unknown> => ({ ...baseRow(ctx),
  event_type: ev.eventType,
  event_key: ev.eventKey,
  event_detection_source: "v3_transition",
  payload: ctx.normalized,
  ...(ev.eventType === "lap_completed" ? { completed_laps: ev.completedLaps } : {}),
  ...(ev.eventType === "incident_count_changed" ? { incidents: ev.incidents } : {}),
  ...(ev.eventType === "flag_change" ? { flag: ev.flag } : {}),
  ...(ev.eventType === "pit_entry" || ev.eventType === "pit_exit"
    ? { in_pit_lane: ev.eventType === "pit_entry" } : {}),
});

/** Latest snapshot row: v3_normalized + race_run_id plus existing columns. */
export const buildV3LatestRow = (ctx: V3SnapshotInput): Record<string, unknown> => {
  const n = ctx.normalized;
  const id = n.identity;
  return {
    device_id: ctx.device.id,
    owner_user_id: ctx.device.ownerUserId,
    race_id: ctx.device.raceId,
    team_id: ctx.device.teamId,
    endurance_event_id: ctx.eventId,
    endurance_team_id: ctx.teamId,
    session_id: n.transportSessionId,
    sequence: n.sequence,
    captured_at: n.capturedAt,
    received_at: ctx.receivedAt ?? new Date().toISOString(),
    connector_id: ctx.device.connectorId,
    simhub_version: ctx.device.deviceName,
    game: "IRacing",
    race_run_id: ctx.raceRunId,
    v3_normalized: n,
    driver_id: id.currentDriverId,
    current_driver_id: id.currentDriverId,
    current_driver_name: id.currentDriverName,
    car_id: id.carId,
    car_name: id.carName,
    track_name: id.trackName,
    track_config: id.trackConfig,
    telemetry: buildV3TelemetryJso(n),
  };
};

const prevFromRow = (row: Record<string, unknown>): V3PrevState | null => {
  if (!row) return null;
  const payload = row.payload as { session?: { flags?: string[] | null } } | null;
  const flagCol = row.flag ? String(row.flag) : null;
  const flags = payload?.session?.flags ?? (flagCol ? flagCol.split(",").filter(Boolean) : null);
  return {
    completedLaps: row.completed_laps == null ? null : Number(row.completed_laps),
    incidents: row.incidents == null ? null : Number(row.incidents),
    onPitRoad: row.in_pit_lane == null ? null : Boolean(row.in_pit_lane),
    flags: canonicalizeFlags(flags),
  };
};

export type V3PersistResult = {
  accepted: boolean;
  receivedAt: string;
  transitions: V3TransitionEvent[];
};

/**
 * Persist one V3 snapshot: upsert latest, write a sample event, and write any
 * detected transition events (reusing the existing (device_id, session_id,
 * event_key) UNIQUE dedupe via ON CONFLICT DO NOTHING).
 */
export const persistV3Snapshot = async (
  db: V3Db,
  ctx: V3SnapshotInput,
): Promise<V3PersistResult> => {
  const n = ctx.normalized;
  const forward = { ...ctx, receivedAt: ctx.receivedAt ?? new Date().toISOString() };

  // Read the previous snapshot's scalar state for this device+transport session.
  const prevQuery = db.from("endurance_telemetry_events")
    .select("completed_laps, incidents, in_pit_lane, flag, payload")
    .eq("device_id", ctx.device.id)
    .eq("session_id", n.transportSessionId)
    .order("received_at", { ascending: false })
    .limit(1);
  const prevRows = await prevQuery as { data?: Record<string, unknown>[] } | Record<string, unknown>[];
  const prevRow = Array.isArray(prevRows) ? prevRows[0] : prevRows.data?.[0];
  const prev = prevFromRow(prevRow);

  // Baseline (no previous state, e.g. first snapshot / B-first handoff) emits no
  // synthetic transitions.
  const transitions = prev ? detectV3Transitions(prev, v3SnapshotState(n), n.sequence) : [];

  const rows = [
    buildV3SampleEvent(forward),
    ...transitions.map((ev) => buildV3TransitionRow(forward, ev)),
  ];

  const evRes = await db.from("endurance_telemetry_events")
    .upsert(rows, { onConflict: "device_id,session_id,event_key", ignoreDuplicates: true });
  if (evRes?.error) throw evRes.error;

  const ltRes = await db.from("simhub_telemetry_latest")
    .upsert([buildV3LatestRow(forward)], { onConflict: "device_id" });
  if (ltRes?.error) throw ltRes.error;

  return { accepted: true, receivedAt: forward.receivedAt!, transitions };
};