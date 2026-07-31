import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import RaceCostsOverview from "@/features/community-support/public/RaceCostsOverview";
import type { PublicSupportRaceCost } from "@/features/community-support/types";
import { isSupportedCommunitySupportRace } from "@/features/community-support/raceEligibility";

const costs: PublicSupportRaceCost[] = [
  { raceScope: "season", leagueName: "Sprint Cup", season: "2026", raceName: "Race 1", track: "Spa", date: "2026-07-10", amount: 3.5, isPublic: true },
  { raceScope: "standalone", raceName: "Losse race", track: "Zandvoort", date: "2026-08-10", amount: 2.5, isPublic: true },
];

describe("Community Support race cost UI", () => {
  it("renders a year total, average and the actual public races", () => {
    render(<RaceCostsOverview language="nl" selectedYear="2026" costs={costs} />);

    expect(screen.getByRole("heading", { name: "Wat kost een race? · 2026" })).toBeInTheDocument();
    expect(screen.getByText("Race 1")).toBeInTheDocument();
    expect(screen.getByText("Losse race", { selector: "h3" })).toBeInTheDocument();
    expect(screen.getByText(/€\s*6,00/)).toBeInTheDocument();
    expect(screen.getByText(/€\s*3,00/)).toBeInTheDocument();
  });

  it("shows an honest empty state without sample races", () => {
    render(<RaceCostsOverview language="en" selectedYear="2027" costs={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent("No public race costs for this season yet");
    expect(screen.queryByText("Spa")).not.toBeInTheDocument();
  });

  it("allows only Sprint, Feature and explicit legacy standalone races", () => {
    expect(isSupportedCommunitySupportRace({ raceScope: "season", leagueId: "league", raceName: "Race 1", raceFormat: "Feature" })).toBe(true);
    expect(isSupportedCommunitySupportRace({ raceScope: "season", leagueId: "league", raceName: "Race 2", raceFormat: "Sprint" })).toBe(true);
    expect(isSupportedCommunitySupportRace({ raceScope: "standalone", raceName: "Legacy fun race", raceFormat: null })).toBe(true);
    expect(isSupportedCommunitySupportRace({ raceScope: "season", leagueId: "league", raceName: "Unknown", raceFormat: "FutureFormat" })).toBe(false);
    expect(isSupportedCommunitySupportRace({ raceScope: "standalone", raceName: "Night Endurance", raceFormat: "Feature" })).toBe(false);
    expect(isSupportedCommunitySupportRace({ raceScope: "season", leagueId: "league", raceName: "Untyped season race", raceFormat: null })).toBe(false);
  });

  it("keeps race lookup read-only and wires management into the Control Room", () => {
    const adminSection = readFileSync("src/features/control-room/support/RaceCostsSection.tsx", "utf8");
    const managementPage = readFileSync("src/features/control-room/support/CommunitySupportModule.tsx", "utf8");
    const controlRoom = readFileSync("src/pages/AdminWorkspacePrototype.tsx", "utf8");
    const app = readFileSync("src/App.tsx", "utf8");
    const publicPage = readFileSync("src/features/community-support/public/CommunitySupportPage.tsx", "utf8");

    expect(adminSection).toContain('.from("races")');
    expect(adminSection).toContain("leagues(name,season)");
    expect(adminSection).toContain("isSupportedCommunitySupportRace");
    expect(adminSection).not.toContain(".insert(");
    expect(adminSection).not.toContain(".update(");
    expect(adminSection).not.toContain(".delete(");
    expect(managementPage).toContain("<RaceCostsSection");
    expect(controlRoom).toContain("<CommunitySupportModule />");
    expect(app).not.toContain('path="/support-beheer"');
    expect(publicPage).toContain("<RaceCostsOverview");
  });
});
