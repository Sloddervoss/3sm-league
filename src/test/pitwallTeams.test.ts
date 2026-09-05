import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { listPitwallTeams } from "@/features/endurance/repository/pitwallRepository";
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
describe("Pitwall teams", () => {
  it("uses server authorization instead of client-supplied actor/role", async () => {
    rpc.mockResolvedValue({ data: [{ id: "b", name: "B" }], error: null });
    expect(await listPitwallTeams("event")).toEqual([{ id: "b", name: "B" }]);
    expect(rpc).toHaveBeenCalledWith("get_pitwall_teams", { p_event_id: "event" });
  });
  it("surfaces discovery failures rather than returning an empty team list", async () => {
    rpc.mockResolvedValue({ data: null, error: new Error("unavailable") });
    await expect(listPitwallTeams("event")).rejects.toThrow("unavailable");
  });
  it("bounds discovery to authenticated own-team or staff access in one event", () => {
    const sql = readFileSync("supabase/migrations/20260905110000_pitwall_team_discovery.sql", "utf8");
    expect(sql).toContain("v_user_id uuid := auth.uid()");
    expect(sql).toContain("IF v_user_id IS NULL");
    expect(sql).toContain("t.event_id = p_event_id");
    expect(sql).toContain("public.is_endurance_staff(v_user_id) OR EXISTS");
    expect(sql).toContain("m.team_id = t.id AND m.user_id = v_user_id");
    expect(sql).toContain("LIMIT 200");
    expect(sql).toContain("FROM PUBLIC, anon");
  });
});
