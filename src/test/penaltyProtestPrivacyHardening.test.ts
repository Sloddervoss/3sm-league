import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const migration = "supabase/migrations/20260711120000_harden_penalty_privacy.sql";
const read = (path: string) => readFileSync(join(root, path), "utf8");
const compact = (text: string) => text.replace(/\s+/g, " ").toLowerCase();

describe("penalty-derived protest privacy", () => {
  it("uses a forward migration to remove public penalty reads and restrict full details to staff", () => {
    expect(existsSync(join(root, migration)), "forward penalty privacy migration must exist").toBe(true);
    const sql = compact(read(migration));

    expect(sql).toContain('drop policy if exists "penalties viewable by everyone" on public.penalties');
    expect(sql).toContain('create policy "staff can view penalties" on public.penalties for select');
    expect(sql).toContain("public.has_role(auth.uid(), 'moderator')");
    expect(sql).toContain("public.has_role(auth.uid(), 'admin')");
    expect(sql).toContain("public.has_role(auth.uid(), 'super_admin')");
    expect(sql).not.toMatch(/on public\.penalties\s+for select\s+using\s*\(\s*true\s*\)/);
  });

  it("keeps public result pages independent of confidential penalty rows", () => {
    for (const path of ["src/pages/ResultsPage.tsx", "src/pages/RaceDetailPage.tsx"]) {
      const page = read(path);
      expect(page).not.toContain('.from("penalties")');
      expect(page).not.toContain("race-penalties-detail");
    }
  });

  it("limits direct penalty reads to staff workflows, importers, and the service-role bot", () => {
    const sources = [
      "src/pages/admin/ResultsImportAdmin.tsx",
      "src/features/control-room/results/ResultImportWorkspace.tsx",
      "src/features/control-room/stewarding/StewardingWorkspace.tsx",
      "bot/index.js",
    ];

    for (const path of sources) expect(read(path)).toContain("penalties");
  });
});