import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { NormalizedTelemetryEnvelope } from "../../supabase/functions/_shared/simhub.ts";
import type { V3Db, V3Query } from "../../supabase/functions/simhub-ingest-v3/persist.ts";
import {
  canonicalizeFlags,
  detectV3Transitions,
  buildV3SampleEvent,
  buildV3TransitionRow,
  buildV3LatestRow,
  persistV3Snapshot,
  v3SnapshotState,
} from "../../supabase/functions/simhub-ingest-v3/persist.ts";

const migration = readFileSync("supabase/migrations/20260902190000_endurance_v3_persistence.sql", "utf8");
const rollback = readFileSync("supabase/rollback/20260902190000_endurance_v3_persistence.rollback.sql", "utf8");
const edge = readFileSync("supabase/functions/simhub-ingest-v3/index.ts", "utf8");
const persist = readFileSync("supabase/functions/simhub-ingest-v3/persist.ts", "utf8");

const mkNormalized = (p: {
  completedLaps?: number | null;
  incidents?: number | null;
  onPitRoad?: boolean | null;
  flags?: string[] | null;
  sequence?: number;
  transportSessionId?: string;
} = {}): NormalizedTelemetryEnvelope => ({
  protocolVersion: 3,
  sequence: p.sequence ?? 1,
  capturedAt: "2026-09-02T12:00:00.000Z",
  transportSessionId: p.transportSessionId ?? "s-1",
  raceRunId: null,
  eventId: null,
  teamId: null,
  deviceId: null,
  ownerUserId: null,
  authority: null,
  deviceRole: null,
  identity: { currentDriverId: null, currentDriverName: null, carId: null, carName: null, trackName: null, trackConfig: null },
  session: { isInCar: true, sessionTimeSeconds: 10, sessionTimeRemainingSeconds: null, sessionLapsRemaining: null, flags: (p.flags ?? null) as NormalizedTelemetryEnvelope["session"]["flags"], sessionState: "racing" },
  timing: { currentLapElapsedSeconds: null, lastLapTimeSeconds: null, bestLapTimeSeconds: null, completedLaps: p.completedLaps ?? null },
  position: { position: 1, classPosition: 1, gapToLeaderSeconds: null },
  track: { lapDistancePct: null, trackSurface: "on_track", onPitRoad: p.onPitRoad ?? null },
  fuel: { fuelLitres: null, fuelPct: null },
  raceState: { incidents: p.incidents ?? null },
  pitService: { pitServiceFlagsRaw: null, requiredRepairSeconds: null, optionalRepairSeconds: null },
});

const ctx = (normalized: NormalizedTelemetryEnvelope) => ({
  device: {
    id: "d1", ownerUserId: "u1", raceId: "r1", teamId: "tm1",
    connectorId: "connector-a", deviceName: "dev-1",
  },
  eventId: "ev1",
  teamId: "te1",
  raceRunId: "a5a5a5a5-0000-0000-0000-0000000000a1",
  normalized,
});

describe("V3 transition detection (Phase E edge logic)", () => {
  it("emits lap_completed only on exact +1 advance", () => {
    const prev = v3SnapshotState(mkNormalized({ completedLaps: 10 }));
    expect(detectV3Transitions(prev, v3SnapshotState(mkNormalized({ completedLaps: 11 })), 5))
      .toEqual([{ eventType: "lap_completed", eventKey: "lap:11", completedLaps: 11 }]);
  });

  it("emits NO lap event on jump (no synthetic laps)", () => {
    const prev = v3SnapshotState(mkNormalized({ completedLaps: 10 }));
    expect(detectV3Transitions(prev, v3SnapshotState(mkNormalized({ completedLaps: 13 })), 5)).toEqual([]);
  });

  it("emits incident_count_changed only on monotone increase", () => {
    const prev = v3SnapshotState(mkNormalized({ incidents: 3 }));
    expect(detectV3Transitions(prev, v3SnapshotState(mkNormalized({ incidents: 5 })), 6))
      .toEqual([{ eventType: "incident_count_changed", eventKey: "incident:5", incidents: 5 }]);
    expect(detectV3Transitions(prev, v3SnapshotState(mkNormalized({ incidents: 3 })), 7)).toEqual([]);
  });

  it("maps a V3 flag-set change to flag_change", () => {
    const prev = v3SnapshotState(mkNormalized({ flags: ["green"] }));
    expect(detectV3Transitions(prev, v3SnapshotState(mkNormalized({ flags: ["yellow"] })), 8))
      .toEqual([{ eventType: "flag_change", eventKey: "flag:8", flag: "yellow" }]);
    // same flags (order-insensitive) -> no event
    expect(detectV3Transitions(prev, v3SnapshotState(mkNormalized({ flags: ["green", "yellow"] })), 9).filter((e) => e.eventType === "flag_change")).toHaveLength(1);
    expect(detectV3Transitions(prev, v3SnapshotState(mkNormalized({ flags: ["green"] })), 10)).toEqual([]);
  });

  it("emits pit_entry and pit_exit on the onPitRoad edge", () => {
    const off = v3SnapshotState(mkNormalized({ onPitRoad: false }));
    const on = v3SnapshotState(mkNormalized({ onPitRoad: true }));
    expect(detectV3Transitions(off, on, 11)).toEqual([{ eventType: "pit_entry", eventKey: "pit_entry:11" }]);
    expect(detectV3Transitions(on, off, 12)).toEqual([{ eventType: "pit_exit", eventKey: "pit_exit:12" }]);
  });

  it("canonicalizes flags (lowercase, unique, sorted)", () => {
    expect(canonicalizeFlags(["Yellow", "GREEN", "yellow"])).toEqual(["green", "yellow"]);
    expect(canonicalizeFlags(null)).toBeNull();
  });
});

describe("V3 row builders reuse existing event columns + Phase E additions", () => {
  const n = mkNormalized({ completedLaps: 12, incidents: 5, onPitRoad: false, flags: ["green", "yellow"], transportSessionId: "v3-session-1" });
  const c = ctx(n);

  it("builds a sample event row into the existing columns", () => {
    const row = buildV3SampleEvent(c);
    expect(row.event_type).toBe("sample");
    expect(row.event_key).toBe("seq:1");
    expect(row.event_detection_source).toBe("v3_sample");
    expect(row.race_run_id).toBe(c.raceRunId);
    expect(row.completed_laps).toBe(12);
    expect(row.incidents).toBe(5);
    expect(row.flag).toBe("green,yellow");
    expect(row.payload).toBe(n);
  });

  it("builds a flag_change transition row mapping flags to the existing type", () => {
    const row = buildV3TransitionRow(c, { eventType: "flag_change", eventKey: "flag:2", flag: "yellow" });
    expect(row.event_type).toBe("flag_change");
    expect(row.event_detection_source).toBe("v3_transition");
    expect(row.flag).toBe("yellow");
  });

  it("builds an incident_count_changed transition row", () => {
    const row = buildV3TransitionRow(c, { eventType: "incident_count_changed", eventKey: "incident:5", incidents: 5 });
    expect(row.event_type).toBe("incident_count_changed");
    expect(row.incidents).toBe(5);
  });

  it("builds the latest row carrying race_run_id + v3_normalized", () => {
    const row = buildV3LatestRow(c);
    expect(row.device_id).toBe("d1");
    expect(row.race_run_id).toBe(c.raceRunId);
    expect(row.v3_normalized).toBe(n);
    expect(row.connector_id).toBe("connector-a");
    expect(row.simhub_version).toBe("dev-1");
    expect(row.game).toBe("IRacing");
    expect(row.endurance_event_id).toBe("ev1");
    expect(row.endurance_team_id).toBe("te1");
  });
});

describe("persistV3Snapshot orchestration (fake service client)", () => {
  type PrevRow = { completed_laps?: unknown; incidents?: unknown; in_pit_lane?: unknown; flag?: unknown; payload?: { session?: { flags?: string[] | null } } | null };

  const makeDb = (prevRows: PrevRow[]) => {
    const eventUpserts: Record<string, unknown>[][] = [];
    const latestUpserts: Record<string, unknown>[][] = [];
    // Thenable query builder mimicking supabase-js select() chains: `await q` resolves rows.
    const queryObj: V3Query = {
      select: () => queryObj,
      eq: () => queryObj,
      order: () => queryObj,
      limit: () => queryObj,
      upsert: async (rows: Record<string, unknown>[]) => { eventUpserts.push(rows); return { error: null as unknown }; },
      then: <TResult,>(resolve: (v: unknown) => TResult | PromiseLike<TResult>) => Promise.resolve(prevRows).then(resolve),
    };
    const db: V3Db = {
      from: (table: string): V3Query => {
        if (table === "simhub_telemetry_latest") {
          return { upsert: async (rows: Record<string, unknown>[]) => { latestUpserts.push(rows); return { error: null }; } } as unknown as V3Query;
        }
        return queryObj;
      },
    };
    return { db, eventUpserts, latestUpserts };
  };

  it("first snapshot (baseline, no prev) writes one sample and zero transitions", async () => {
    const { db, eventUpserts, latestUpserts } = makeDb([]);
    const res = await persistV3Snapshot(db, ctx(mkNormalized()));
    expect(res.accepted).toBe(true);
    expect(res.transitions).toHaveLength(0);
    expect(eventUpserts).toHaveLength(1);
    expect(eventUpserts[0]).toHaveLength(1);
    expect(eventUpserts[0][0].event_type).toBe("sample");
    expect(latestUpserts).toHaveLength(1);
    expect(latestUpserts[0][0].v3_normalized).toBeDefined();
  });

  it("second snapshot with prev emits flag_change + incident_count_changed transitions", async () => {
    const { db, eventUpserts } = makeDb([
      { completed_laps: 10, incidents: 3, in_pit_lane: false, flag: "green", payload: { session: { flags: ["green"] } } },
    ]);
    const res = await persistV3Snapshot(db, ctx(mkNormalized({ completedLaps: 11, incidents: 5, flags: ["yellow"], onPitRoad: false })));
    const types = eventUpserts[0].map((r) => r.event_type as string);
    expect(types).toContain("sample");
    expect(types).toContain("lap_completed");
    expect(types).toContain("incident_count_changed");
    expect(types).toContain("flag_change");
    expect(res.transitions.map((t) => t.eventType)).toEqual(
      ["lap_completed", "incident_count_changed", "flag_change"],
    );
  });
});

describe("Phase E migration / rollback / edge source contract", () => {
  it("migration is additive: reuses existing columns, adds race_run_id + v3_normalized, never base tables/grants/device role", () => {
    expect(migration).toMatch(/event_type = ANY \(ARRAY\[[\s\S]*incident_count_changed/);
    expect(migration).toContain("flag_change");
    expect(migration.match(/ADD COLUMN IF NOT EXISTS race_run_id/g)?.length).toBe(2);
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS v3_normalized JSONB");
    expect(migration).not.toMatch(/CREATE TABLE (IF NOT EXISTS )?public\.endurance_telemetry_events/);
    expect(migration).not.toMatch(/CREATE TABLE (IF NOT EXISTS )?public\.simhub_telemetry_latest/);
    expect(migration).not.toMatch(/CREATE TABLE (IF NOT EXISTS )?public\.endurance_race_runs/);
    expect(migration).not.toMatch(/DROP TABLE.*endurance_telemetry_events/i);
    expect(migration).not.toMatch(/DROP TABLE.*simhub_telemetry_latest/i);
    expect(migration).toContain("REFERENCES public.endurance_race_runs(id) ON DELETE SET NULL");
  });

  it("rollback removes only Phase E additions and never drops base tables", () => {
    expect(rollback).toContain("DROP COLUMN IF EXISTS race_run_id");
    expect(rollback).toContain("DROP COLUMN IF EXISTS v3_normalized");
    expect(rollback).not.toMatch(/DROP TABLE IF EXISTS public\.endurance_telemetry_events/);
    expect(rollback).not.toMatch(/DROP TABLE IF EXISTS public\.simhub_telemetry_latest/);
    expect(rollback).not.toMatch(/DROP TABLE[^;]*endurance_race_runs/i);
    // original 10-type check restored (no incident_count_changed member)
    expect(rollback.match(/'[a-z_]+'::text/g)?.map((s) => s.replace(/::text$/, "")))
      .not.toContain("'incident_count_changed'");
    expect(rollback).toContain("'flag_change'");
  });

  it("V3 edge persists via service role and maps flags to flag_change / incidents to incident_count_changed", () => {
    expect(edge).toContain('service.rpc("simhub_persist_v3"');
    expect(edge).toContain('if (context.result === "not_authority") return jsonResponse(request, { error: context.result }, 403);');
    expect(edge).not.toContain('persistV3Snapshot(service');
    expect(persist).toContain("flag_change");
    expect(persist).toContain("incident_count_changed");
    expect(persist).toContain("ignoreDuplicates: true");
    expect(persist).toContain("v3_normalized");
    expect(persist).toContain("race_run_id");
  });
});