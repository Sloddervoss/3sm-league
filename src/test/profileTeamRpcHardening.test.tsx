import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: mocks.rpc },
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

import {
  adminSetTeamRpc,
  joinTeamRpc,
  leaveTeamRpc,
  unlinkOwnDiscordRpc,
  updateOwnRacingProfileRpc,
} from "@/features/profile/profileRpc";
import { useJoinTeam } from "@/features/profile/useTeamAssignment";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const collapse = (value: string) => value.replace(/\s+/g, " ").toLowerCase();

const MIGRATION = "supabase/migrations/20261027090000_profile_team_assignment_rpc.sql";
const ROLLBACK = "supabase/rollback/20261027090000_profile_team_assignment_rpc.rollback.sql";

describe("teamtoewijzing via transactie-RPC", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.toastError.mockReset();
    mocks.toastSuccess.mockReset();
    mocks.rpc.mockResolvedValue({ data: null, error: null });
  });

  it("roept join_team, leave_team en admin_set_team aan met de juiste argumenten", async () => {
    await joinTeamRpc("team-1");
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "join_team", { p_team_id: "team-1" });

    await leaveTeamRpc();
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "leave_team");

    await adminSetTeamRpc("user-1", "team-2");
    expect(mocks.rpc).toHaveBeenNthCalledWith(3, "admin_set_team", { p_user_id: "user-1", p_team_id: "team-2" });

    // null betekent: uit het team halen, niet "geen argument".
    await adminSetTeamRpc("user-1", null);
    expect(mocks.rpc).toHaveBeenNthCalledWith(4, "admin_set_team", { p_user_id: "user-1", p_team_id: null });
  });

  it("stuurt de overige zelfservice-velden via hun eigen RPC", async () => {
    await updateOwnRacingProfileRpc({ iracingId: "412301", irating: 3450, safetyRating: "A 4.50" });
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "update_own_racing_profile", {
      p_iracing_id: "412301",
      p_irating: 3450,
      p_safety_rating: "A 4.50",
    });

    await unlinkOwnDiscordRpc();
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "unlink_own_discord");
  });

  it("gooit door als de RPC een fout teruggeeft in plaats van stil door te gaan", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "Team bestaat niet", code: "23503" } });

    await expect(joinTeamRpc("team-x")).rejects.toThrow("Team bestaat niet");
    await expect(leaveTeamRpc()).rejects.toThrow("Team bestaat niet");
    await expect(adminSetTeamRpc("user-1", "team-x")).rejects.toThrow("Team bestaat niet");
  });

  it("toont de RPC-fout zichtbaar in de UI", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "Alleen beheerders mogen teamtoewijzingen wijzigen", code: "42501" },
    });

    function JoinButton() {
      const joinTeam = useJoinTeam();
      return <button onClick={() => joinTeam.mutate("team-1")}>join</button>;
    }

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <JoinButton />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByText("join"));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith("Alleen beheerders mogen teamtoewijzingen wijzigen"),
    );
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });
});

describe("profiel- en teamschrijfacties in de frontend", () => {
  it("laat de drie dual-write plekken via de RPC's lopen", () => {
    const profilePage = source("src/pages/ProfilePage.tsx");
    expect(profilePage).toContain("useJoinTeam(");
    expect(profilePage).toContain("useLeaveTeam()");
    expect(profilePage).toContain("updateOwnRacingProfileRpc(");
    expect(profilePage).toContain("unlinkOwnDiscordRpc(");
    expect(profilePage).not.toContain('from("team_memberships")');
    expect(profilePage).not.toContain("team_id: teamId");
    expect(profilePage).not.toContain("discord_id: null");

    for (const path of ["src/pages/admin/TeamsAdmin.tsx", "src/features/control-room/community/CommunityModule.tsx"]) {
      const file = source(path);
      expect(file).toContain("adminSetTeamRpc(");
      expect(file).not.toContain('from("team_memberships")');
      expect(file).not.toContain(".update({ team_id:");
      expect(file).toContain("profileWriteErrorMessage(");
    }
  });

  it("beperkt de profiles-grant tot de zelfservice-kolommen", () => {
    const sql = collapse(source(MIGRATION));

    expect(sql).toContain("revoke update on table public.profiles from anon, authenticated");
    expect(sql).toContain("grant update (display_name, iracing_name, avatar_url) on table public.profiles to authenticated");
    expect(sql).toContain("revoke insert on table public.profiles from anon, authenticated");
    expect(sql).not.toContain("grant update on table public.profiles to authenticated");
    expect(sql).toContain("revoke insert, update, delete on table public.team_memberships from anon, authenticated");

    // discord_id en team_id mogen in geen enkele grant meer voorkomen.
    expect(sql).not.toMatch(/grant update \([^)]*discord_id/);
    expect(sql).not.toMatch(/grant update \([^)]*team_id/);
    // De migratie sluit zelf af met COMMIT, net als de andere migraties in de
    // repo, zodat `psql -f` hem in één keer uitvoert.
    expect(sql).toContain("begin;");
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
  });

  it("schrijft team_id en team_memberships in één SECURITY DEFINER-functie", () => {
    const sql = collapse(source(MIGRATION));

    expect(sql).toContain("create or replace function public.join_team(p_team_id uuid)");
    expect(sql).toContain("create or replace function public.leave_team()");
    expect(sql).toContain("create or replace function public.admin_set_team(p_user_id uuid, p_team_id uuid)");
    expect(sql).toContain("Security definer".toLowerCase());
    expect(sql).toContain("insert into public.team_memberships (user_id, team_id, role)");
    expect(sql).toContain("delete from public.team_memberships where user_id =");
    expect(sql).toContain("update public.profiles set team_id =");
    expect(sql).toContain("public.has_role(v_actor, 'admin'::public.app_role)");
    expect(sql).toContain("public.has_role(v_actor, 'super_admin'::public.app_role)");
    expect(sql).toContain("revoke all on function public.join_team(uuid) from public, anon");
    expect(sql).toContain("grant execute on function public.join_team(uuid) to authenticated");
  });

  it("valideert de bestaande toewijzingen voordat de migratie klaar is", () => {
    const sql = collapse(source(MIGRATION));

    expect(sql).toContain("do $$");
    expect(sql).toContain("select count(*) into v_memberships from public.team_memberships");
    expect(sql).toContain("ontbrekende memberships");
    expect(sql).toContain("errcode = '23514'");
  });

  it("heeft een rollback die de RPC's en de kolomgrants terugdraait", () => {
    const sql = collapse(source(ROLLBACK));

    expect(sql).toContain("drop function if exists public.admin_set_team(uuid, uuid)");
    expect(sql).toContain("drop function if exists public.join_team(uuid)");
    expect(sql).toContain("drop function if exists public.leave_team()");
    expect(sql).toContain("grant update on table public.profiles to authenticated");
    expect(sql).toContain("grant insert on table public.profiles to authenticated");
    expect(sql).toContain("grant insert, update, delete on table public.team_memberships to anon, authenticated");
    // Alles wat de migratie aanmaakt gaat mee terug, in één transactie.
    expect(sql).toContain("drop index if exists public.profiles_iracing_id_uniq");
    expect(sql).toContain("drop constraint if exists profiles_rating_source_check");
    expect(sql).toContain("drop column if exists rating_updated_at");
    expect(sql).toContain("drop column if exists rating_source");
    expect(sql).toContain("begin;");
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
  });
});

describe("één team per gebruiker", () => {
  it("ruimt in join_team en admin_set_team de memberships van andere teams op", () => {
    const sql = collapse(source(MIGRATION));

    expect(sql).toContain(
      "delete from public.team_memberships where user_id = v_user_id and team_id <> p_team_id",
    );
    expect(sql).toContain(
      "delete from public.team_memberships where user_id = p_user_id and team_id <> p_team_id",
    );

    // De delete staat vóór de insert, zodat profiles.team_id nooit naar een
    // membership wijst die in dezelfde transactie verdwijnt.
    const joinBody = sql.slice(
      sql.indexOf("create or replace function public.join_team(p_team_id uuid)"),
      sql.indexOf("create or replace function public.leave_team()"),
    );
    expect(joinBody.indexOf("team_id <> p_team_id")).toBeLessThan(
      joinBody.indexOf("insert into public.team_memberships"),
    );
  });

  it("wist bij admin_set_team(..., null) alle memberships van die gebruiker", () => {
    const sql = collapse(source(MIGRATION));
    const adminBody = sql.slice(
      sql.indexOf("create or replace function public.admin_set_team(p_user_id uuid, p_team_id uuid)"),
      sql.indexOf("-- 4. overige zelfservice"),
    );

    expect(adminBody).toContain("if p_team_id is null then");
    expect(adminBody).toContain("delete from public.team_memberships where user_id = p_user_id;");
    expect(adminBody).toContain("set team_id = null");
  });
});

describe("migratie: rapportage in plaats van backfill", () => {
  it("schrijft geen memberships bij vanuit profiles.team_id", () => {
    const sql = collapse(source(MIGRATION));

    expect(sql).not.toContain("select profile.user_id, profile.team_id");
    expect(sql).not.toMatch(/insert into public\.team_memberships \(user_id, team_id, role\)\s*select/);
  });

  it("rapporteert de aantallen en de user_id's die een membership zouden krijgen", () => {
    const sql = collapse(source(MIGRATION));

    expect(sql).toContain("string_agg(missing.user_id::text");
    expect(sql).toContain("profielen zonder membership (user_id:");
    expect(sql).toContain("gebruikers met meer dan één membership");
    // De harde validatie blijft: afwijkingen laten de migratie falen.
    expect(sql).toContain("if v_missing > 0 or v_orphans > 0 then");
    expect(sql).toContain("errcode = '23514'");
  });
});

describe("iracing_id en rating-herkomst", () => {
  it("legt een partiële unieke index op iracing_id", () => {
    const sql = collapse(source(MIGRATION));

    expect(sql).toContain(
      "create unique index if not exists profiles_iracing_id_uniq on public.profiles (iracing_id) where iracing_id is not null",
    );
    // Bestaande dubbele waarden geven een leesbare fout in plaats van een
    // onduidelijke index-foutmelding.
    expect(sql).toContain("iracing_id moet uniek zijn, maar deze waarden staan op meerdere profielen");
  });

  it("claimt een customer ID alleen als een ander hem nog niet heeft, en staat NULL toe", () => {
    const sql = collapse(source(MIGRATION));
    const fnBody = sql.slice(
      sql.indexOf("create or replace function public.update_own_racing_profile"),
      sql.indexOf("create or replace function public.unlink_own_discord()"),
    );

    // Leeg betekent ontkoppelen: NULLIF + de EXISTS-check slaan alleen aan als
    // er een waarde is.
    expect(fnBody).toContain("nullif(btrim(p_iracing_id), '')");
    expect(fnBody).toContain("where profile.iracing_id = v_iracing_id and profile.user_id <> v_user_id");
    // Conflict: duidelijke melding plus de unique_violation-afhandeling voor
    // twee gelijktijdige claims.
    expect(fnBody).toContain("iracing_id_in_use");
    expect(fnBody).toContain("when unique_violation then");
    expect(fnBody).toContain("errcode = '23505'");
  });

  it("voegt rating_source en rating_updated_at toe met een begrensd domein", () => {
    const sql = collapse(source(MIGRATION));

    expect(sql).toContain("add column if not exists rating_source text not null default 'self'");
    expect(sql).toContain("add column if not exists rating_updated_at timestamptz");
    expect(sql).toContain("check (rating_source in ('self', 'imported'))");
  });

  it("laat self-service ratings alleen zetten als de import ze niet bezit", () => {
    const sql = collapse(source(MIGRATION));
    const fnBody = sql.slice(
      sql.indexOf("create or replace function public.update_own_racing_profile"),
      sql.indexOf("create or replace function public.unlink_own_discord()"),
    );

    expect(fnBody).toContain("if v_rating_source <> 'imported' then");
    expect(fnBody).toContain(
      "case when v_rating_source = 'imported' then profile.irating else p_irating end",
    );
    expect(fnBody).toContain(
      "case when v_rating_source = 'imported' then profile.safety_rating else v_safety_rating end",
    );
    // Grenzen van een beginwaarde.
    expect(fnBody).toContain("p_irating > 5000");
    expect(fnBody).toContain("> 5.00");
  });

  it("zet de herkomst op 'imported' bij de import", () => {
    const sql = collapse(source(MIGRATION));
    const fnBody = sql.slice(sql.indexOf("create or replace function public.admin_update_driver_ratings"));

    expect(fnBody).toContain("rating_source = 'imported'");
    expect(fnBody).toContain("rating_updated_at = now()");

    // De iRacing-sync schrijft met de service role en moet de herkomst zelf
    // zetten, anders mag self-service de waarde daarna overschrijven.
    const sync = collapse(source("supabase/functions/sync-irating/index.ts"));
    expect(sync).toContain('rating_source: "imported"');
    expect(sync).toContain("rating_updated_at:");
  });

  it("toont het iRating-veld alleen-lezen zodra de import eigenaar is", () => {
    const profilePage = source("src/pages/ProfilePage.tsx");

    expect(profilePage).toContain("canEditRatingsFromSource(profile?.rating_source)");
    expect(profilePage).toContain("readOnly={ratingsFromImport}");
    expect(profilePage).toContain("ratingsFromImport ?");
    expect(profilePage).toContain("ownRacingProfilePayload(");
    expect(profilePage).toContain("ratingSourceLabel(profile?.rating_source)");
  });
});
