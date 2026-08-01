import { readFileSync } from "node:fs";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import RaceCostsOverview from "@/features/community-support/public/RaceCostsOverview";
import RaceCostsSection from "@/features/control-room/support/RaceCostsSection";
import type { PublicSupportRaceCost, SupportRaceCost } from "@/features/community-support/types";
import { isSupportedCommunitySupportRace } from "@/features/community-support/raceEligibility";
import { calculateRaceHostingAmountUsd, configuredRaceHours, convertUsdToEur } from "@/features/community-support/raceHostingPricing";

const raceRows = vi.hoisted(() => [
  { id: "season-a", league_id: "league-a", name: "Race 1", track: "Spa", race_date: "2026-07-10T18:00:00Z", race_type: "Sprint", race_duration: "60 min", practice_duration: "15 min", qualifying_duration: "10 min", round: 1, status: "completed", leagues: { name: "Sprint Cup", season: "2026" } },
  { id: "season-b", league_id: "league-a", name: "Race 2", track: "Monza", race_date: "2026-07-17T18:00:00Z", race_type: "Feature", race_duration: "120 min", practice_duration: "15 min", qualifying_duration: "10 min", round: 2, status: "completed", leagues: { name: "Sprint Cup", season: "2026" } },
  { id: "standalone", league_id: null, name: "Fun Race", track: "Zandvoort", race_date: "2026-08-10T18:00:00Z", race_type: null, race_duration: "60 min", practice_duration: null, qualifying_duration: null, round: null, status: "completed", leagues: null },
  { id: "endurance", league_id: null, name: "Night Endurance", track: "Le Mans", race_date: "2026-08-20T18:00:00Z", race_type: "Feature", race_duration: "3 hours", practice_duration: null, qualifying_duration: null, round: null, status: "completed", leagues: null },
]);

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ select: () => ({ order: async () => ({ data: raceRows, error: null }) }) }) },
}));

const costs: PublicSupportRaceCost[] = [
  { raceScope: "season", leagueName: "Sprint Cup", season: "2026", raceName: "Race 1", track: "Spa", date: "2026-07-10", hostedHours: 2, discountApplied: true, sourceAmountUsd: 0.75, exchangeRateUsdEur: 0.92, amount: 0.69, isPublic: true },
  { raceScope: "standalone", raceName: "Losse race", track: "Zandvoort", date: "2026-08-10", hostedHours: 1, discountApplied: false, sourceAmountUsd: 0.5, exchangeRateUsdEur: 0.92, amount: 0.46, isPublic: true },
];

describe("Community Support race cost UI", () => {
  it("renders a year total, average and the actual public races", () => {
    render(<RaceCostsOverview language="nl" selectedYear="2026" costs={costs} totalCount={2} totalAmountEur={1.15} />);

    expect(screen.getByRole("heading", { name: "Racehosting in het open boek · 2026" })).toBeInTheDocument();
    expect(screen.getByText("Race 1")).toBeInTheDocument();
    expect(screen.getByText("Losse race", { selector: "h3" })).toBeInTheDocument();
    expect(screen.getByText(/€\s*1,15/)).toBeInTheDocument();
    expect(screen.getByText(/€\s*0,58/)).toBeInTheDocument();
    expect(screen.getByText("25% toegepast", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getAllByText("1 USD = 0.9200 EUR")).toHaveLength(2);
  });

  it("keeps private race amounts in aggregate totals without rendering private details", () => {
    render(<RaceCostsOverview language="nl" selectedYear="2026" costs={[costs[0]]} totalCount={2} totalAmountEur={1.15} />);
    const recordedCard = screen.getByText("Races met kosten").closest("article");
    expect(recordedCard).toHaveTextContent("2");
    expect(screen.getByText(/€\s*1,15/)).toBeInTheDocument();
    expect(screen.getByText("Race 1")).toBeInTheDocument();
    expect(screen.queryByText("Losse race")).not.toBeInTheDocument();
  });

  it("calculates the $0.50 hourly source price and converts it to EUR", () => {
    expect(calculateRaceHostingAmountUsd(1, false)).toBe(0.5);
    expect(calculateRaceHostingAmountUsd(1, true)).toBe(0.38);
    expect(calculateRaceHostingAmountUsd(2, true)).toBe(0.75);
    expect(calculateRaceHostingAmountUsd(3, false)).toBe(1.5);
    expect(convertUsdToEur(0.75, 0.92)).toBe(0.69);
    expect(configuredRaceHours("60 min")).toBe(1);
    expect(configuredRaceHours("2 hours")).toBe(2);
    expect(configuredRaceHours("180")).toBe(3);
  });

  it("shows an honest empty state without sample races", () => {
    render(<RaceCostsOverview language="en" selectedYear="2027" costs={[]} totalCount={0} totalAmountEur={0} />);
    expect(screen.getByRole("status")).toHaveTextContent("No public race costs for this season yet");
    expect(screen.queryByText("Spa")).not.toBeInTheDocument();
  });

  it("keeps 35 per-race entries compact and individually expandable", () => {
    const manyCosts = Array.from({ length: 35 }, (_, index): PublicSupportRaceCost => ({
      raceScope: "standalone",
      raceName: `Race ${index + 1}`,
      track: "Spa",
      date: `2026-${String((index % 12) + 1).padStart(2, "0")}-10`,
      hostedHours: 1,
      discountApplied: false,
      sourceAmountUsd: 0.5,
      exchangeRateUsdEur: 0.92,
      amount: 0.46,
      isPublic: true,
    }));
    const view = render(<RaceCostsOverview language="nl" selectedYear="2026" costs={manyCosts} totalCount={35} totalAmountEur={16.1} />);
    expect(view.container.querySelectorAll("details")).toHaveLength(35);
    expect(view.container.querySelectorAll("article")).toHaveLength(3);
    expect(screen.getByText("Race 35")).toBeInTheDocument();
  });

  it("allows only Sprint, Feature and explicit legacy standalone races", () => {
    expect(isSupportedCommunitySupportRace({ raceScope: "season", leagueId: "league", raceName: "Race 1", raceFormat: "Feature" })).toBe(true);
    expect(isSupportedCommunitySupportRace({ raceScope: "season", leagueId: "league", raceName: "Race 2", raceFormat: "Sprint" })).toBe(true);
    expect(isSupportedCommunitySupportRace({ raceScope: "standalone", raceName: "Legacy fun race", raceFormat: null })).toBe(true);
    expect(isSupportedCommunitySupportRace({ raceScope: "season", leagueId: "league", raceName: "Unknown", raceFormat: "FutureFormat" })).toBe(false);
    expect(isSupportedCommunitySupportRace({ raceScope: "standalone", raceName: "Night Endurance", raceFormat: "Feature" })).toBe(false);
    expect(isSupportedCommunitySupportRace({ raceScope: "season", leagueId: "league", raceName: "Untyped season race", raceFormat: null })).toBe(false);
  });

  it("initializes completed races and applies discount per season or per race", async () => {
    const onInitialize = vi.fn();
    const onSaveMany = vi.fn();
    const onSave = vi.fn();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const renderSection = (raceCosts: SupportRaceCost[]) => <QueryClientProvider client={queryClient}>
      <RaceCostsSection language="nl" selectedYear="2026" onSelectedYearChange={vi.fn()} raceCosts={raceCosts} defaultUsdEurRate={0.92} hasRecurringServerCost={false} onSave={onSave} onSaveMany={onSaveMany} onInitialize={onInitialize} onRemove={vi.fn()} />
    </QueryClientProvider>;
    const view = render(renderSection([]));

    await waitFor(() => expect(onInitialize).toHaveBeenCalledTimes(1));
    const initializedDrafts = onInitialize.mock.calls[0][0];
    expect(initializedDrafts).toHaveLength(3);
    expect(initializedDrafts).toEqual(expect.arrayContaining([
      expect.objectContaining({ raceId: "season-a", hostedHours: 1, discountApplied: false }),
      expect.objectContaining({ raceId: "season-b", hostedHours: 1, discountApplied: false }),
      expect.objectContaining({ raceId: "standalone", hostedHours: 1, discountApplied: false }),
    ]));
    expect(initializedDrafts).not.toEqual(expect.arrayContaining([expect.objectContaining({ raceId: "endurance" })]));

    const storedCosts = initializedDrafts.map((draft: Omit<SupportRaceCost, "id" | "amount" | "sourceAmountUsd" | "exchangeRateUsdEur">, index: number): SupportRaceCost => ({
      ...draft,
      id: `cost-${index}`,
      sourceAmountUsd: calculateRaceHostingAmountUsd(draft.hostedHours, draft.discountApplied),
      exchangeRateUsdEur: 0.92,
      amount: convertUsdToEur(calculateRaceHostingAmountUsd(draft.hostedHours, draft.discountApplied), 0.92),
    }));
    storedCosts[0] = { ...storedCosts[0], isPublic: false, note: "bewaren" };
    view.rerender(renderSection(storedCosts));

    const bulkPanel = screen.getByRole("heading", { name: "Seizoenen in één keer aanpassen" }).closest("section");
    expect(bulkPanel).not.toBeNull();
    const seasonCard = within(bulkPanel as HTMLElement).getByText("Sprint Cup", { selector: "p" }).closest("article");
    expect(seasonCard).not.toBeNull();
    fireEvent.click(within(seasonCard as HTMLElement).getByRole("checkbox", { name: "25% korting toegepast" }));
    fireEvent.click(within(seasonCard as HTMLElement).getByRole("button", { name: "Toepassen op heel seizoen" }));
    expect(onSaveMany).toHaveBeenCalledWith([
      expect.objectContaining({ raceId: "season-b", discountApplied: true, hostedHours: 1 }),
      expect.objectContaining({ raceId: "season-a", discountApplied: true, hostedHours: 1, isPublic: false, note: "bewaren" }),
    ]);

    const raceCard = screen.getByText("Race 1", { selector: "h3" }).closest("article");
    expect(raceCard).not.toBeNull();
    fireEvent.click(within(raceCard as HTMLElement).getByRole("switch", { name: "Geen korting" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ raceId: "season-a", discountApplied: true, hostedHours: 1 }));
  });

  it("offers newly completed races to the initializer after a same-mount refetch", async () => {
    const onInitialize = vi.fn();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}>
      <RaceCostsSection language="nl" selectedYear="2026" onSelectedYearChange={vi.fn()} raceCosts={[]} defaultUsdEurRate={0.92} hasRecurringServerCost={false} onSave={vi.fn()} onSaveMany={vi.fn()} onInitialize={onInitialize} onRemove={vi.fn()} />
    </QueryClientProvider>);

    await waitFor(() => expect(onInitialize).toHaveBeenCalledTimes(1));
    queryClient.setQueryData(["community-support", "race-cost-options"], [...raceRows, {
      id: "future-completed",
      league_id: null,
      name: "Nieuwe afgeronde race",
      track: "Monza",
      race_date: "2026-10-01T19:00:00.000Z",
      race_type: "Sprint",
      race_duration: 3600,
      practice_duration: 0,
      qualifying_duration: 0,
      round: null,
      status: "completed",
      leagues: null,
    }]);

    await waitFor(() => expect(onInitialize).toHaveBeenCalledTimes(2));
    expect(onInitialize.mock.calls[1][0]).toEqual(expect.arrayContaining([expect.objectContaining({ raceId: "future-completed" })]));
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
    expect(adminSection).toContain("onInitialize(completed.map");
    expect(adminSection).toContain("applySeason");
    expect(adminSection).toContain("discountApplied");
    expect(adminSection).not.toContain(".insert(");
    expect(adminSection).not.toContain(".update(");
    expect(adminSection).not.toContain(".delete(");
    expect(managementPage).toContain("<RaceCostsSection");
    expect(controlRoom).toContain("<CommunitySupportModule />");
    expect(app).not.toContain('path="/support-beheer"');
    expect(publicPage).toContain("<RaceCostsOverview");
  });
});
