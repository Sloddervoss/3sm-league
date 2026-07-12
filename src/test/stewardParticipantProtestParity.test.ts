import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("steward participant protest parity", () => {
  const page = read("src/pages/StewardPage.tsx");
  const participantWorkspace = read("src/features/control-room/stewarding/UserProtestWorkspace.tsx");
  const staffWorkspace = read("src/features/control-room/stewarding/StewardingWorkspace.tsx");

  it("redirects unauthenticated visitors and never mounts staff controls for regular users", () => {
    expect(page).toContain("if (loading || rolesLoading) return <div");
    expect(page).toContain('if (!user) return <Navigate to="/auth" />;');
    expect(page).toContain("const canModerate = Boolean(user && (isAdmin || isSuperAdmin || isSteward));");
    expect(page).toContain("<UserProtestWorkspace />");
    expect(page).toContain("{canModerate && <StewardingWorkspace />}");
    expect(participantWorkspace).not.toContain("Directe stewardactie");
    expect(participantWorkspace).not.toContain("DNF-check");
  });

  it("keeps the participant submission contract while reading the redacted RPC view", () => {
    expect(participantWorkspace).toContain('queryKey: ["races-for-protest"]');
    expect(participantWorkspace).toContain('.eq("status", "completed")');
    expect(participantWorkspace).toContain('queryKey: ["drivers-for-protest"]');
    expect(participantWorkspace).toContain("drivers.filter((driver) => driver.user_id !== user.id)");
    expect(participantWorkspace).toContain('queryKey: ["my-protests", user?.id]');
    expect(participantWorkspace).toContain('supabase.rpc("get_my_visible_protests")');
    expect(participantWorkspace).not.toContain('.from("protests").select');
    expect(participantWorkspace).toContain("PROTEST_DEADLINE_HOURS");
    expect(participantWorkspace).toContain("race_id: form.race_id");
    expect(participantWorkspace).toContain("reporter_user_id: user!.id");
    expect(participantWorkspace).toContain("accused_user_id: form.accused_user_id");
    expect(participantWorkspace).toContain("lap_number: form.lap_number ? parseInt(form.lap_number) : null");
    expect(participantWorkspace).toContain("video_link: form.video_link || null");
    expect(participantWorkspace).toContain("Protest ingediend! Een steward bekijkt dit zo snel mogelijk.");
    expect(participantWorkspace).toContain('queryClient.invalidateQueries({ queryKey: ["my-protests"] })');
  });

  it("retains the existing independently guarded staff workspace and native mutation ownership", () => {
    expect(staffWorkspace).toContain("const canModerate = Boolean(user && (isAdmin || isSuperAdmin || isSteward));");
    expect(staffWorkspace).toContain("if (!canModerate) return");
    expect(staffWorkspace).toContain('const roles = ["moderator", "admin", "super_admin"] as const;');
    expect(staffWorkspace).toContain("allowedRoles: [...roles]");
    expect(staffWorkspace).toContain('supabase.from("protests").update');
    expect(staffWorkspace).toContain('supabase.from("penalties").insert');
    expect(staffWorkspace).toContain('tab === "drivers"');
    expect(staffWorkspace).toContain('queryKey: ["steward-sp-penalties"]');
    expect(staffWorkspace).toContain("<DriverSpOverview");
  });
});
