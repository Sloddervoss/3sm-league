import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationDir = "supabase/migrations";
const forwardName = "20260820150000_endurance_invariants_atomic_publish.sql";
const forwardPath = `${migrationDir}/${forwardName}`;
const rollbackPath = `supabase/rollback/${forwardName.replace(/\.sql$/, ".rollback.sql")}`;
const sql = (path: string) => readFileSync(path, "utf8");

describe("Endurance invariants + atomic plan publication", () => {
  it("ships one new additive forward/rollback pair after the runtime-capabilities baseline", () => {
    const files = readdirSync(migrationDir).sort();
    expect(files).toContain("20260820140000_endurance_runtime_capabilities.sql");
    expect(files).toContain(forwardName);
    expect(files.indexOf(forwardName)).toBeGreaterThan(
      files.indexOf("20260820140000_endurance_runtime_capabilities.sql"),
    );
    expect(existsSync(rollbackPath)).toBe(true);
  });

  it("adds a backward-compatible nullable event_id on endurance_team_members, derived from the owning team", () => {
    const f = sql(forwardPath);
    expect(f).toContain("endurance_team_members");
    expect(f).toContain("event_id");
    expect(f).toMatch(/REFERENCES\s+public\.endurance_events/);
    // legacy inserts that omit event_id stay allowed: the column must be nullable.
    expect(f).toMatch(/event_id\s+uuid/);
    // backfill from the owning endurance team in the same file
    expect(f).toMatch(
      /UPDATE[\s\S]+endurance_team_members[\s\S]+SET\s+event_id\s*=\s*[a-z]+\.event_id[\s\S]+endurance_teams/i,
    );
  });

  it("enforces at most one effective team membership per user/event with a partial unique index", () => {
    const m = sql(forwardPath);
    expect(m).toMatch(/CREATE\s+UNIQUE\s+INDEX/i);
    expect(m).toMatch(/endurance_team_members\s*\(event_id,\s*user_id\)/i);
    expect(m).toMatch(/WHERE\s+event_id\s+IS\s+NOT\s+NULL/i);
  });

  it("enforces exactly one open practice session per event/team with a partial unique index + preflight note", () => {
    const m = sql(forwardPath);
    expect(m).toMatch(/endurance_practice_sessions/i);
    expect(m).toMatch(/CREATE\s+UNIQUE\s+INDEX/i);
    expect(m).toMatch(/ended_at\s+IS\s+NULL/i);
    expect(m.toLowerCase()).toMatch(/preflight/i);
    expect(m).toContain("multiple open practices per event/team");
  });

  it("fails preflight non-destructively for every existing-data invariant", () => {
    const m = sql(forwardPath);
    expect(m).toContain("duplicate team membership per user/event");
    expect(m).toContain("multiple open practices per event/team");
    expect(m).toContain("multiple published plans per event/team");
    expect(m).not.toMatch(/DELETE\s+FROM\s+public\.endurance_(team_members|practice_sessions|planning_versions)/i);
  });

  it("ships one SECURITY DEFINER RPC that atomically creates the version plus all confirmations", () => {
    const m = sql(forwardPath);
    const idx = m.toLowerCase().indexOf("endurance_publish_plan");
    expect(idx).toBeGreaterThan(-1);
    const fn = m.slice(idx);
    expect(fn).toMatch(/SECURITY\s+DEFINER/i);
    expect(fn).toMatch(/SET\s+search_path\s*=[^;]*pg_temp/i);
    expect(fn).toMatch(/auth\.uid\(\)/i);
    expect(fn).toMatch(/is_endurance_manager/i);
    expect(fn).toMatch(/v_team\.manager_id\s+IS\s+DISTINCT\s+FROM\s+v_user_id/i);
    expect(fn).toMatch(/pg_advisory_xact_lock/i);
    expect(fn).toMatch(/endurance_teams/i);
    expect(fn).toMatch(/endurance_team_members[\s\S]+member\.user_id\s*=\s*v_confirm\.user_id/i);
    expect(fn).toContain("Duplicate confirmation user_id");
    expect(fn).toMatch(/INSERT INTO\s+public\.endurance_planning_versions/i);
    expect(fn).toMatch(/INSERT INTO\s+public\.endurance_confirmations/i);
    expect(fn).toMatch(/REVOKE\s+ALL/i);
    expect(fn).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION[\s\S]+FROM\s+PUBLIC,\s*anon/);
    expect(fn).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION[\s\S]+TO\s+authenticated/);
    expect(fn).not.toMatch(/TO\s+anon/);
  });
});