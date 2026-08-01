import { readFileSync } from "node:fs";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import RaceCostsOverview from "@/features/community-support/public/RaceCostsOverview";
import RaceCostsSection from "@/features/control-room/support/RaceCostsSection";
import CreditPurchasesSection from "@/features/control-room/support/CreditPurchasesSection";
import type { PublicSupportRaceCost, SupportRaceCost } from "@/features/community-support/types";
import { isSupportedCommunitySupportRace } from "@/features/community-support/raceEligibility";
import { calculateRaceHostingCreditCostUsd, configuredRaceHours } from "@/features/community-support/raceHostingPricing";

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
  { raceScope: "season", leagueName: "Sprint Cup", season: "2026", raceName: "Race 1", track: "Spa", date: "2026-07-10", hostedHours: 2, discountApplied: true, creditCostUsd: 0.75, isPublic: true },
  { raceScope: "standalone", raceName: "Losse race", track: "Zandvoort", date: "2026-08-10", hostedHours: 1, discountApplied: false, creditCostUsd: 0.5, isPublic: true },
];
const summary = { raceCount: 3, consumedUsd: 1.75, purchasedUsd: 10, paidEur: 9.2 };

describe("Community Support race cost UI", () => {
  it("renders compact monthly USD usage and actual EUR Credit purchases", () => {
    render(<RaceCostsOverview language="nl" selectedYear="2026" costs={costs} summary={summary} />);

    expect(screen.getByRole("heading", { name: "Credits gekocht en verbruikt · 2026" })).toBeInTheDocument();
    expect(screen.getByText("Race 1")).toBeInTheDocument();
    expect(screen.getByText("Losse race", { selector: "h4" })).toBeInTheDocument();
    expect(screen.getByText("3", { selector: "p" })).toBeInTheDocument();
    expect(screen.getAllByText(/US\$\s*1,75|\$\s*1,75/).length).toBeGreaterThan(0);
    expect(screen.queryByText("Verborgen race")).not.toBeInTheDocument();
    expect(screen.getByText(/€\s*9,20/)).toBeInTheDocument();
    expect(screen.getByText("25% korting")).toBeInTheDocument();
    expect(document.querySelectorAll("details")).toHaveLength(2);
    expect(document.querySelectorAll("details[open]")).toHaveLength(0);
  });

  it("keeps a 35-race catalog collapsed into month summaries", () => {
    const manyCosts: PublicSupportRaceCost[] = Array.from({ length: 35 }, (_, index) => ({
      raceScope: "standalone",
      raceName: `Catalogusrace ${index + 1}`,
      track: "Spa",
      date: `2026-${String((index % 12) + 1).padStart(2, "0")}-${String((index % 20) + 1).padStart(2, "0")}`,
      hostedHours: 1,
      discountApplied: false,
      creditCostUsd: 0.5,
      isPublic: true,
    }));

    render(<RaceCostsOverview language="nl" selectedYear="2026" costs={manyCosts} summary={{ ...summary, raceCount: 35, consumedUsd: 17.5 }} />);

    expect(screen.getByText("35", { selector: "p" })).toBeInTheDocument();
    expect(document.querySelectorAll("details")).toHaveLength(12);
    expect(document.querySelectorAll("details[open]")).toHaveLength(0);
    expect(document.querySelectorAll("section[aria-labelledby='race-costs-title'] > div.grid > article")).toHaveLength(4);
  });

  it("calculates the $0.50 hourly credit baseline and 25% discount consistently", () => {
    expect(calculateRaceHostingCreditCostUsd(1, false)).toBe(0.5);
    expect(calculateRaceHostingCreditCostUsd(1, true)).toBe(0.38);
    expect(calculateRaceHostingCreditCostUsd(2, true)).toBe(0.75);
    expect(calculateRaceHostingCreditCostUsd(3, false)).toBe(1.5);
    expect(configuredRaceHours("60 min")).toBe(1);
    expect(configuredRaceHours("2 hours")).toBe(2);
    expect(configuredRaceHours("180")).toBe(3);
  });

  it("defaults a Credit purchase date inside the selected year", () => {
    const onAdd = vi.fn();
    const view = render(<CreditPurchasesSection language="nl" selectedYear="2030" purchases={[]} raceCosts={[]} onAdd={onAdd} onRemove={vi.fn()} />);
    expect(screen.getByLabelText("Aankoopdatum")).toHaveValue("2030-01-01");
    fireEvent.change(screen.getByLabelText("Gekochte USD-credits"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Werkelijk betaald in EUR"), { target: { value: "9.20" } });
    fireEvent.click(screen.getByRole("button", { name: "Credit-aankoop opslaan" }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ date: "2030-01-01", creditsUsd: 10, amountEur: 9.2 }));
    expect(screen.getByLabelText("Aankoopdatum")).toHaveValue("2030-01-01");
    view.rerender(<CreditPurchasesSection language="nl" selectedYear="2031" purchases={[]} raceCosts={[]} onAdd={onAdd} onRemove={vi.fn()} />);
    expect(screen.getByLabelText("Aankoopdatum")).toHaveValue("2031-01-01");
  });

  it("shows an honest empty state without sample races", () => {
    render(<RaceCostsOverview language="en" selectedYear="2027" costs={[]} summary={{ raceCount: 0, consumedUsd: 0, purchasedUsd: 0, paidEur: 0 }} />);
    expect(screen.getByRole("status")).toHaveTextContent("No public race hosting for this season yet");
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

  it("initializes completed races and applies discount per season or per race", async () => {
    const onInitialize = vi.fn();
    const onSaveMany = vi.fn();
    const onSave = vi.fn();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const renderSection = (raceCosts: SupportRaceCost[], pricingInitialized: boolean, selectedYear = "2026") => <QueryClientProvider client={queryClient}>
      <RaceCostsSection language="nl" selectedYear={selectedYear} onSelectedYearChange={vi.fn()} raceCosts={raceCosts} hasRecurringServerCost={false} onSave={onSave} onSaveMany={onSaveMany} onInitialize={onInitialize} pricingInitialized={pricingInitialized} onRemove={vi.fn()} />
    </QueryClientProvider>;
    const purchaseOnlyYear = render(renderSection([], true, "2030"));
    expect(screen.getByRole("combobox", { name: "Seizoen" })).toHaveValue("2030");
    purchaseOnlyYear.unmount();
    const view = render(renderSection([], false));

    await waitFor(() => expect(onInitialize).toHaveBeenCalledTimes(1));
    const initializedDrafts = onInitialize.mock.calls[0][0];
    expect(initializedDrafts).toHaveLength(3);
    expect(initializedDrafts).toEqual(expect.arrayContaining([
      expect.objectContaining({ raceId: "season-a", hostedHours: 1, discountApplied: false }),
      expect.objectContaining({ raceId: "season-b", hostedHours: 1, discountApplied: false }),
      expect.objectContaining({ raceId: "standalone", hostedHours: 1, discountApplied: false }),
    ]));
    expect(initializedDrafts).not.toEqual(expect.arrayContaining([expect.objectContaining({ raceId: "endurance" })]));

    const storedCosts = initializedDrafts.map((draft: Omit<SupportRaceCost, "id" | "creditCostUsd">, index: number): SupportRaceCost => ({
      ...draft,
      id: `cost-${index}`,
      creditCostUsd: calculateRaceHostingCreditCostUsd(draft.hostedHours, draft.discountApplied),
    }));
    storedCosts[0] = { ...storedCosts[0], isPublic: false, note: "bewaren" };
    view.rerender(renderSection(storedCosts, true));

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

    const raceCard = screen.getByText("Race 1", { selector: "h4" }).closest("article");
    expect(raceCard).not.toBeNull();
    fireEvent.click(within(raceCard as HTMLElement).getByRole("switch", { name: "Geen korting" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ raceId: "season-a", discountApplied: true, hostedHours: 1 }));
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
