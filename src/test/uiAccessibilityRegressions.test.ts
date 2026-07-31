import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("UI accessibility regressions", () => {
  it("distinguishes unauthenticated registration from an incomplete iRacing profile", () => {
    const modal = read("src/components/preview/RaceModal.tsx");
    const seasonBanner = read("src/components/preview/SeasonBanner.tsx");
    const calendar = read("src/pages/CalendarPage.tsx");

    expect(modal).toContain("isAuthenticated: boolean");
    expect(modal).toContain("!registration.isAuthenticated");
    expect(modal).toContain("Log eerst in om je in te schrijven");
    expect(calendar).toContain("isAuthenticated: Boolean(reg.user)");
    expect(seasonBanner).toContain("isAuthenticated: boolean");
    expect(seasonBanner).toContain("!isAuthenticated");
    expect(seasonBanner).toContain('to="/auth"');
    expect(seasonBanner).toContain("Log in om je in te schrijven");
    expect(seasonBanner).toContain('to="/profile"');
    expect(seasonBanner).toContain("Maak je profiel compleet");
    expect(calendar).toContain("isAuthenticated={Boolean(reg.user)}");
  });

  it("gives PreviewModal dialog semantics, an accessible close control, and focus management", () => {
    const modal = read("src/components/preview/PreviewModal.tsx");

    expect(modal).toContain('role="dialog"');
    expect(modal).toContain('aria-modal="true"');
    expect(modal).toContain('aria-label="Sluit venster"');
    expect(modal).toContain("previouslyFocusedRef");
    expect(modal).toContain('e.key !== "Tab"');
  });

  it("keeps fixed-width administration grids reachable on narrow screens", () => {
    const roles = read("src/features/control-room/roles/RolesRightsModule.tsx");
    const community = read("src/features/control-room/community/CommunityModule.tsx");

    expect(roles).toContain('className="overflow-x-auto"');
    expect(roles).toContain('className="min-w-[760px]"');
    expect(community).toContain('className="overflow-x-auto rounded-2xl');
    expect(community).toContain('min-w-[560px] grid');
  });

  it("keeps Community Support management forms within the mobile viewport", () => {
    const supportManagement = read("src/features/control-room/support/CommunitySupportModule.tsx");

    expect(supportManagement).toContain("grid-cols-[minmax(0,1fr)]");
    expect(supportManagement).toContain('className="min-w-0 max-w-full lg:sticky');
    expect(supportManagement).toContain("flex w-full max-w-full gap-2 overflow-x-auto");
    expect(supportManagement).not.toContain("<Navbar");
    expect(supportManagement).not.toContain("<Footer");
  });

  it("waits visibly for role resolution before evaluating protected routes", () => {
    for (const path of [
      "src/pages/AdminPage.tsx",
      "src/pages/TrackIntelligenceTestPage.tsx",
      "src/pages/NewsEditorPage.tsx",
      "src/pages/StewardPage.tsx",
      "src/pages/AdminWorkspacePrototype.tsx",
    ]) {
      const page = read(path);
      expect(page).toContain("loading || rolesLoading");
      expect(page).toContain('role="status"');
      expect(page).toContain("Toegangsrechten laden");
    }
  });
});
