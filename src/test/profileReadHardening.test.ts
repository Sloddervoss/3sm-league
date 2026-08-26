import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const migrationPath = join(root, "supabase/migrations/20260712100000_harden_profile_reads.sql");
const source = (path: string) => readFileSync(join(root, path), "utf8");
const normalize = (value: string) => value.replace(/\s+/g, " ").toLowerCase();

const publicProfileConsumers = [
  "src/hooks/data/useSharedQueries.ts",
  "src/pages/HomepagePrototype.tsx",
  "src/pages/NewsPage.tsx",
  "src/pages/NewsAuthorPage.tsx",
  "src/pages/NewsDetailPage.tsx",
  "src/pages/ResultsPage.tsx",
  "src/pages/RaceDetailPage.tsx",
  "src/pages/SeasonsPage.tsx",
  "src/pages/StandingsPage.tsx",
  "src/pages/TeamsPage.tsx",
  "src/components/StandingsStrip.tsx",
  "src/components/RaceRecapPanel.tsx",
  "src/components/preview/RaceModal.tsx",
  "src/features/control-room/season/SeasonCarLockManager.tsx",
  "src/features/control-room/stewarding/UserProtestWorkspace.tsx",
  "src/features/control-room/stewarding/StewardingWorkspace.tsx",
];

describe("profile read hardening", () => {
  it("denies raw profile enumeration to anon and normal authenticated callers", () => {
    expect(existsSync(migrationPath), "forward profile hardening migration must exist").toBe(true);
    const sql = normalize(readFileSync(migrationPath, "utf8"));

    expect(sql).toContain('drop policy if exists "profiles viewable by everyone" on public.profiles');
    expect(sql).toContain('create policy "users can view own profile" on public.profiles for select using (auth.uid() = user_id)');
    expect(sql).toContain("revoke all on table public.profiles from anon, authenticated");
    expect(sql).toContain("grant select, insert, update on table public.profiles to authenticated");
    expect(sql).not.toMatch(/create policy "profiles viewable by everyone"[\s\S]*using \(true\)/);
    expect(sql).not.toMatch(/create policy "users can view own profile"[\s\S]*using \(true\)/);

    // Direct all-row access remains explicitly staff-only, never a normal-user
    // policy. This preserves current operational admin/steward paths.
    expect(sql).toContain('create policy "staff can view all profiles"');
    expect(sql).toContain("'admin'::public.app_role");
    expect(sql).toContain("'super_admin'::public.app_role");
    expect(sql).toContain("'moderator'::public.app_role");
  });

  it("publishes only a fixed safe projection and closes the prior view bypass", () => {
    const sql = normalize(readFileSync(migrationPath, "utf8"));
    const viewStart = sql.indexOf("create or replace view public.public_profiles");
    const viewEnd = sql.indexOf("revoke all on table public.public_profiles", viewStart);
    const view = sql.slice(viewStart, viewEnd);

    for (const field of ["p.user_id", "p.display_name", "p.iracing_name", "p.avatar_url", "p.irating", "p.safety_rating", "p.team_id"]) {
      expect(view).toContain(field);
    }
    for (const privateField of ["discord_id", "iracing_id", "p.id", "created_at", "updated_at"]) {
      expect(view).not.toContain(privateField);
    }
    expect(sql).toContain("grant select on table public.public_profiles to anon, authenticated");
    expect(sql).toContain("revoke all on table public.confirmed_profiles from public, anon, authenticated");
    expect(source("src/integrations/supabase/types.ts")).toContain("public_profiles:");
  });

  it("moves every public display query to the safe source", () => {
    for (const path of publicProfileConsumers) {
      const content = source(path);
      expect(content, path).toContain('from("public_profiles")');
      expect(content, path).not.toMatch(/\.from\("profiles"\)/);
    }
  });

  it("loads all public result names through the safe view instead of RLS-blocked nested profile joins", () => {
    for (const path of [
      "src/pages/ResultsPage.tsx",
      "src/pages/RaceDetailPage.tsx",
      "src/pages/HomepagePrototype.tsx",
      "src/components/RaceRecapPanel.tsx",
      "src/pages/SeasonsPage.tsx",
      "src/pages/TeamsPage.tsx",
      "src/components/preview/RaceModal.tsx",
    ]) {
      const page = source(path);
      expect(page, path).toContain('from("public_profiles")');
      expect(page, path).toContain('.select("user_id, display_name, iracing_name');
      expect(page, path).not.toMatch(/profiles\s*\(/);
    }
  });

  it("keeps the sitemap generator on public profiles after raw profile hardening", () => {
    const generator = source("scripts/generate-route-html.mjs");
    expect(generator).toContain(".from('public_profiles')");
    expect(generator).toContain(".select('user_id,display_name,iracing_name')");
    expect(generator).toContain("race_results(position,laps,points,fastest_lap,user_id)");
    expect(generator).not.toContain("race_results(position,laps,points,fastest_lap,profiles(");
  });

  it("retains the editable self-profile path and audited admin raw path", () => {
    const profilePage = source("src/pages/ProfilePage.tsx");
    expect(profilePage).toContain('.from("profiles")');
    expect(profilePage).toContain('.eq("user_id", user!.id)');
    expect(profilePage).toContain(".upsert(({");

    const adminImport = source("src/pages/admin/ResultsImportAdmin.tsx");
    expect(adminImport).toContain('.from("profiles")');
    expect(adminImport).toContain(".update({ irating:");
  });

  it("keeps a source-controlled classification for every remaining raw profile call", () => {
    const audit = source("docs/security/profile-data-access-audit.md");
    for (const path of [
      "src/lib/useRegistration.ts",
      "src/pages/ProfilePage.tsx",
      "src/pages/admin/ResultsImportAdmin.tsx",
      "src/features/control-room/track/useTrackIntelligence.ts",
      "supabase/functions/sync-irating/index.ts",
      "supabase/functions/track-intelligence-upload/index.ts",
      "scripts/sync-irating.js",
      "bot/index.js",
    ]) {
      expect(audit, path).toContain(`\`${path}\``);
    }
  });
});
