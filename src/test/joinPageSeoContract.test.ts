import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

const filesRecursively = (directory: string): string[] => {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? filesRecursively(path) : [path];
  });
};

describe("join page redesign contracts", () => {
  it("houdt de route en shared shell intact en integreert de page-specific experience", () => {
    const app = read("src/App.tsx");
    const page = read("src/pages/JoinPage.tsx");

    expect(app).toContain('path="/meedoen"');
    expect(page).toContain("<Navbar />");
    expect(page).toContain("<StickyRaceBar />");
    expect(page).toContain("<Footer />");
    expect(page).toContain("JoinExperience");
  });

  it("houdt de nieuwe dataflow strikt read-only", () => {
    const data = read("src/features/join/data.ts");
    expect(data).toContain('.from("races")');
    expect(data).toContain('.from("race_results")');
    expect(data).toContain('.from("race_registrations")');
    expect(data).toContain('.from("season_registrations")');
    expect(data).toContain('.from("public_profiles")');
    expect(data).not.toMatch(/\.(insert|update|delete|upsert|rpc)\s*\(/);
  });

  it("gebruikt voor /meedoen één semantische root-fallback in plaats van dubbele verborgen copy", () => {
    const generator = read("scripts/generate-route-html.mjs");
    expect(generator).toContain("buildJoinRootFallback");
    expect(generator).toContain("route.path === '/meedoen'");
    expect(generator).toContain("join-page-faq-schema");
    expect(generator).toContain("FAQPage");
  });

  it("maakt de hero-kaart functioneel met echte volgende-racedata zonder nep-live interface", () => {
    const experience = read("src/features/join/JoinExperience.tsx");
    expect(experience).toContain("const HeroNextRace");
    expect(experience).toContain("race={nextRace}");
    expect(experience).toContain("track={race.track}");
    expect(experience).toContain("trackId={race.trackId}");
    expect(experience).toContain("shouldShowRegistrationCount(registrationCount)");
    expect(experience).not.toContain("3SM Race Signal");
    expect(experience).not.toContain("SECTOR 2");
    expect(experience).not.toContain('["CALENDAR", "RESULTS", "STANDINGS"]');
    expect(experience).not.toContain("min-h-[calc(100vh-108px)]");
  });

  it("bevat geen em dash in de nieuwe marketingcopy of page UI", () => {
    const files = [
      "src/pages/JoinPage.tsx",
      ...filesRecursively("src/features/join").filter((path) => /\.(ts|tsx)$/.test(path)),
    ];
    for (const file of files) expect(read(file), file).not.toContain("—");
  });
});
