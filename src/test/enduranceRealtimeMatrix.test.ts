import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  ENDURANCE_REALTIME_MAX_BACKOFF_MS,
  ENDURANCE_REALTIME_MAX_RECONNECT_ATTEMPTS,
  enduranceRealtimeChannelName,
  enduranceReconnectAttemptAllowsRetry,
  enduranceReconnectDelayMs,
} from "../features/endurance/repository/enduranceRealtimeClient";
import {
  enduranceRealtimeBindingsForEvent,
  enduranceRealtimeUserBindings,
  enduranceRealtimeWorkspaceTables,
} from "../features/endurance/repository/enduranceRealtimeMatrix";

/**
 * Fase 4 — centralized Realtime invalidation matrix.
 *
 * RED / unit tests that pin the declarative contract:
 *   1. every event binding is narrow (an explicit single-column filter — never a
 *      broad unfiltered subscription);
 *   2. the complete per-table → query-key matrix maps every workspace table to
 *      exactly the keys its repositories read;
 *   3. user-scoped bindings narrow to the actor's own rows;
 *   4. reconnection backoff is bounded/exponential and capped by max attempts;
 *   5. channel names are unique per event+/instance and idempotent for the
 *      same identity.
 */
describe("endurance realtime binding matrix", () => {
  const EVENT = "evt-123";
  const USER = "usr-456";

  const bindingFor = (table: string) =>
    enduranceRealtimeBindingsForEvent(EVENT, { userId: USER }).find((b) => b.table === table);

  it("covers the complete workspace table set exactly once (no duplicates)", () => {
    const bindings = enduranceRealtimeBindingsForEvent(EVENT, { userId: USER });
    const tables = bindings.map((b) => b.table);
    expect(new Set(tables).size).toBe(tables.length);
    expect(new Set(tables)).toEqual(new Set(enduranceRealtimeWorkspaceTables()));
  });

  it("never emits an unfiltered (broad) subscription for an event workspace", () => {
    for (const binding of enduranceRealtimeBindingsForEvent(EVENT, { userId: USER })) {
      expect(binding.subscriptionTable).toBe("endurance_realtime_stream");
      expect(binding.filter).toBeDefined();
      expect(binding.filter.column.length).toBeGreaterThan(0);
      expect(binding.filter.value).toBeTruthy();
    }
  });

  it("maps every table to the exact query keys its repositories consume (complete matrix)", () => {
    const by = (table: string) => bindingFor(table)?.queryKeys;
    expect(by("endurance_events")).toEqual([
      ["endurance", "events"],
      ["endurance", "events", EVENT],
    ]);
    expect(by("endurance_registrations")).toEqual([
      ["endurance", "registrations", EVENT],
      ["endurance", "registrations", "all"],
    ]);
    expect(by("endurance_availability")).toEqual([["endurance", "availability", EVENT]]);
    expect(by("endurance_pace_entries")).toEqual([["endurance", "pace", EVENT]]);
    expect(by("endurance_practice_sessions")).toEqual([["endurance", "practice", EVENT]]);
    expect(by("endurance_practice_laps")).toEqual([["endurance", "practice", EVENT]]);
    expect(by("endurance_teams")).toEqual([
      ["endurance", "teams", EVENT],
      ["endurance", "teams", "all"],
    ]);
    expect(by("endurance_team_members")).toEqual([
      ["endurance", "teams", EVENT],
      ["endurance", "teams", "all"],
    ]);
    expect(by("endurance_stints")).toEqual([
      ["endurance", "stints", EVENT],
      ["endurance", "stints", "all"],
    ]);
    expect(by("endurance_planning_versions")).toEqual([["endurance", "plans", EVENT]]);
    expect(by("endurance_confirmations")).toEqual([
      ["endurance", "plans", EVENT],
      ["endurance", "confirmations", EVENT],
    ]);
    expect(by("endurance_notifications")).toEqual([["endurance", "notifications"]]);
    expect(by("endurance_race_control_audit")).toEqual([["endurance", "race-control-audit", EVENT]]);
  });

  it("uses the narrow pairing column each table supports (event_id / id / user_id)", () => {
    const filterFor = (table: string) => bindingFor(table)?.filter;
    // Alle subscriptions richten zich op de carrier; ook event-wijzigingen
    // staan daar onder event_id (de trigger leidt dit af uit events.id).
    expect(filterFor("endurance_events")).toEqual({ column: "event_id", value: EVENT });
    // descendants are filtered by event_id.
    for (const table of ["endurance_registrations", "endurance_availability", "endurance_pace_entries",
      "endurance_practice_sessions", "endurance_practice_laps", "endurance_teams",
      "endurance_stints", "endurance_planning_versions", "endurance_confirmations",
      "endurance_race_control_audit"]) {
      expect(filterFor(table)?.column, table).toBe("event_id");
      expect(filterFor(table)?.value, table).toBe(EVENT);
    }
    // team_members is sinds fase 3A eventgebonden; notifications blijven actor-scoped.
    expect(filterFor("endurance_team_members")).toEqual({ column: "event_id", value: EVENT });
    expect(filterFor("endurance_notifications")).toEqual({ column: "user_id", value: USER });
  });

  it("skips only actor-scoped notifications without a user id", () => {
    const tables = enduranceRealtimeBindingsForEvent(EVENT, {}).map((b) => b.table);
    expect(tables).toContain("endurance_team_members");
    expect(tables).not.toContain("endurance_notifications");
  });

  it("exposes user-scoped bindings narrowed to the actor's own rows", () => {
    const bindings = enduranceRealtimeUserBindings(USER);
    const by = (table: string) => bindings.find((b) => b.table === table);
    expect(by("endurance_notifications")?.filter).toEqual({ column: "user_id", value: USER });
    expect(by("endurance_notifications")?.queryKeys).toEqual([["endurance", "notifications"]]);
    expect(by("endurance_availability")?.filter).toEqual({ column: "user_id", value: USER });
  });
});

describe("endurance realtime channel identity + backoff", () => {
  it("generates a unique channel name per event-user-instance", () => {
    const a = enduranceRealtimeChannelName({ kind: "event", id: "evt-123", instanceId: "i1" });
    const b = enduranceRealtimeChannelName({ kind: "event", id: "evt-123", instanceId: "i2" });
    const c = enduranceRealtimeChannelName({ kind: "event", id: "evt-999", instanceId: "i1" });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(a).toBe(enduranceRealtimeChannelName({ kind: "event", id: "evt-123", instanceId: "i1" }));
  });

  it("scopes channel names across kinds so a user channel never collides with an event channel", () => {
    const event = enduranceRealtimeChannelName({ kind: "event", id: "evt-123", instanceId: "x" });
    const user = enduranceRealtimeChannelName({ kind: "user", id: "evt-123", instanceId: "x" });
    expect(event).not.toBe(user);
  });

  it("backoff is bounded and exponential", () => {
    expect(enduranceReconnectDelayMs(1)).toBe(500);
    expect(enduranceReconnectDelayMs(2)).toBe(1000);
    expect(enduranceReconnectDelayMs(3)).toBe(2000);
    // hard cap — never unbounded backoff.
    expect(enduranceReconnectDelayMs(100)).toBeLessThanOrEqual(ENDURANCE_REALTIME_MAX_BACKOFF_MS);
    expect(enduranceReconnectDelayMs(100)).toBe(ENDURANCE_REALTIME_MAX_BACKOFF_MS);
  });

  it("stops reconnecting after the bounded attempt cap", () => {
    let attempts = 0;
    for (let attempt = 0; attempt < ENDURANCE_REALTIME_MAX_RECONNECT_ATTEMPTS + 5; attempt += 1) {
      if (enduranceReconnectAttemptAllowsRetry(attempt)) attempts += 1;
    }
    expect(attempts).toBe(ENDURANCE_REALTIME_MAX_RECONNECT_ATTEMPTS);
  });
});

describe("endurance realtime publication delta", () => {
  it("publishes every newly-bound table and rolls it back with manager-scoped audit RLS", () => {
    const forward = readFileSync("supabase/migrations/20260820170000_endurance_realtime_matrix_publication.sql", "utf8");
    const rollback = readFileSync("supabase/rollback/20260820170000_endurance_realtime_matrix_publication.rollback.sql", "utf8");
    for (const table of ["endurance_registrations", "endurance_pace_entries", "endurance_practice_sessions",
      "endurance_practice_laps", "endurance_confirmations", "endurance_race_control_audit"]) {
      expect(forward).toContain(`ADD TABLE public.${table}`);
      expect(rollback).toContain(`DROP TABLE public.${table}`);
    }
    expect(forward).toContain("endurance race control audit managers select");
    expect(forward).toContain("team.manager_id = auth.uid()");
    expect(rollback).toContain('DROP POLICY IF EXISTS "endurance race control audit managers select"');
  });

  it("moves streaming off every domain table onto a server-gated carrier", () => {
    const forward = readFileSync("supabase/migrations/20260820180000_endurance_realtime_server_gate.sql", "utf8");
    const rollback = readFileSync("supabase/rollback/20260820180000_endurance_realtime_server_gate.rollback.sql", "utf8");
    expect(forward).toContain("CREATE TABLE public.endurance_realtime_stream");
    expect(forward).toContain("capability.multi_user_realtime_enabled");
    expect(forward).toContain("public.is_endurance_staff(auth.uid())");
    expect(forward).toContain("public.is_endurance_manager(auth.uid())");
    expect(forward).toMatch(/is_endurance_staff\(auth\.uid\(\)\)[\s\S]+AND CASE/);
    expect(forward).toContain("ALTER PUBLICATION supabase_realtime ADD TABLE public.endurance_realtime_stream");
    expect(forward.match(/ALTER PUBLICATION supabase_realtime DROP TABLE public\.endurance_/g)).toHaveLength(13);
    expect(forward).toContain("CREATE TRIGGER endurance_realtime_enqueue_trg AFTER INSERT OR UPDATE OR DELETE");
    expect(rollback).toContain("DROP TABLE public.endurance_realtime_stream");
    expect(rollback.match(/ALTER PUBLICATION supabase_realtime ADD TABLE public\.endurance_/g)).toHaveLength(13);
    const invariants = readFileSync("supabase/migrations/20260820150000_endurance_invariants_atomic_publish.sql", "utf8");
    expect(invariants).toMatch(/endurance_team_members[\s\S]+ADD COLUMN IF NOT EXISTS event_id/);
  });
});