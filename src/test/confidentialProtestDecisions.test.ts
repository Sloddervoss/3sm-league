import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const migrationPath = join(root, "supabase/migrations/20260711113000_confidential_protest_decisions.sql");
const compact = (text: string) => text.replace(/\s+/g, " ").toLowerCase();

describe("confidential protest decisions", () => {
  it("uses a forward migration to restrict direct reads and redact accused-driver decisions", () => {
    expect(existsSync(migrationPath), "forward confidential-protests migration must exist").toBe(true);
    const sql = compact(read("supabase/migrations/20260711113000_confidential_protest_decisions.sql"));

    expect(sql).toContain("add column if not exists public_decision text");
    expect(sql).toContain('create policy "reporters and staff can view protests"');
    expect(sql).toContain("auth.uid() = reporter_user_id");
    expect(sql).not.toContain("auth.uid() = accused_user_id or");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = pg_catalog, public");
    expect(sql).toContain("auth.uid() is not null");
    expect(sql).toContain("p.status in ('resolved', 'dismissed')");
    expect(sql).toContain("null::text as description");
    expect(sql).toContain("null::text as video_link");
    expect(sql).toContain("revoke all on function public.get_my_visible_protests() from public");
    expect(sql).toContain("revoke all on function public.get_my_visible_protests() from anon");
    expect(sql).toContain("grant execute on function public.get_my_visible_protests() to authenticated");
  });

  it("keeps participant data on the redacted RPC view model and staff data on full direct access", () => {
    const participant = read("src/features/control-room/stewarding/UserProtestWorkspace.tsx");
    const staff = read("src/features/control-room/stewarding/StewardingWorkspace.tsx");

    expect(participant).toContain('supabase.rpc("get_my_visible_protests")');
    expect(participant).not.toContain('.from("protests").select');
    expect(participant).not.toContain("Protest tegen jou");
    expect(participant).toContain('"Stewardbeslissing"');
    expect(participant).toContain("public_decision");
    expect(participant).not.toContain("steward_notes");
    expect(staff).toContain('supabase.from("protests").select("*');
    expect(staff).toContain("public_decision: action.context.publicDecision.trim() || null");
    expect(staff).toContain("Interne stewardnotitie");
    expect(staff).toContain("Publieke stewardbeslissing");
  });
});
