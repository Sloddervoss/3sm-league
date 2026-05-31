import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("editor role workflow", () => {
  it("adds editor as an independent Supabase role and allows admins to grant only that role", () => {
    const migration = read("supabase/migrations/20260601090000_editor_role_and_news_access.sql").toLowerCase();

    expect(migration).toContain("alter type public.app_role add value if not exists 'editor'");
    expect(migration).toContain("target_role = 'editor'");
    expect(migration).toContain("public.has_role(auth.uid(), 'admin')");
    expect(migration).toContain("public.has_role(auth.uid(), 'super_admin')");
    expect(migration).toContain("news-images");
  });

  it("loads editor capability separately from admin and steward roles", () => {
    const authContext = read("src/contexts/AuthContext.tsx");

    expect(authContext).toContain("isEditor: boolean");
    expect(authContext).toContain('.from("user_roles")');
    expect(authContext).toContain('roles.has("editor")');
    expect(authContext).toContain('roles.has("super_admin")');
    expect(authContext).toContain("setIsEditor");
  });

  it("shows the news editor as a gated account-menu item, not as profile page content", () => {
    const navbar = read("src/components/Navbar.tsx");
    const profilePage = read("src/pages/ProfilePage.tsx");
    const newsEditorPage = read("src/pages/NewsEditorPage.tsx");
    const app = read("src/App.tsx");

    const desktopAccountMenu = navbar.slice(navbar.indexOf("{showAdmin &&"), navbar.indexOf("<button", navbar.indexOf("{showAdmin &&")));

    expect(navbar).toContain("const canEditNews = isAdmin || isSuperAdmin || isEditor");
    expect(navbar).toContain('to="/news-editor"');
    expect(desktopAccountMenu.indexOf("Admin")).toBeLessThan(desktopAccountMenu.indexOf("Nieuws redactie"));
    expect(desktopAccountMenu.indexOf("Nieuws redactie")).toBeLessThan(desktopAccountMenu.indexOf("Stewards"));
    expect(profilePage).not.toContain("Nieuws redactie");
    expect(newsEditorPage).toContain("const canEditNews = isAdmin || isSuperAdmin || isEditor");
    expect(newsEditorPage).not.toContain("isSteward");
    expect(app).toContain('path="/news-editor"');
  });

  it("lets admins manage editor separately from steward/admin in the drivers admin table", () => {
    const driversList = read("src/pages/admin/DriversList.tsx");

    expect(driversList).toContain("isEditorRole");
    expect(driversList).toContain('target_role: "editor"');
    expect(driversList).toContain("toggleEditor");
    expect(driversList).toContain("Editor");
  });
});
