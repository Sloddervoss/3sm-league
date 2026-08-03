import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COMMUNITY_SUPPORT_PUBLIC, canManageCommunitySupport, canViewCommunitySupport, publicLedgerForMonth, publicLedgerForYear, publicRaceCostsForYear, supportMetrics, supportMetricsForYear } from "@/features/community-support/model";
import { mapPaymentTotalsToMetricEntries } from "@/features/community-support/paymentApi";
import type { CommunitySupportState } from "@/features/community-support/types";

const emptyState = (): CommunitySupportState => ({
  ledger: [],
  recurringCosts: [],
  raceCosts: [],
  products: [],
  paymentIntents: [],
  settings: {
    reserve: 0,
    racePricingInitialized: false,
    usdEurRate: 0.92,
    publicSupporterNamesByDefault: true,
    publicSupporterAmountsByDefault: false,
    paypalEnabled: false,
    paypalCheckoutEnabled: false,
    paypalCheckoutEnvironment: "sandbox",
    paypalMeUrl: "",
    paypalSuggestedAmounts: [5, 10, 25],
    paymentAdminDiscordId: "",
    iracingReferralEnabled: false,
    iracingReferralUrl: "",
  },
});

describe("Community Support financial model", () => {
  it("counts merchandise net proceeds instead of gross turnover", () => {
    const state = emptyState();
    state.ledger = [
      { id: "sale", date: "2026-07-10", direction: "income", category: "merchandise_income", description: "Shirt", amount: 35, isPublic: true },
      { id: "purchase", date: "2026-07-10", direction: "expense", category: "merchandise_purchase", description: "Inkoop", amount: 18, isPublic: true },
      { id: "fee", date: "2026-07-10", direction: "expense", category: "payment_fee", description: "PayPal", amount: 2, isPublic: true },
      { id: "hosting", date: "2026-07-01", direction: "expense", category: "hosting", description: "Hosting", amount: 50, isPublic: true },
    ];

    const metrics = supportMetrics(state, "2026-07");
    expect(metrics.supportIncome).toBe(35);
    expect(metrics.commercialCosts).toBe(20);
    expect(metrics.netCommunitySupport).toBe(15);
    expect(metrics.communityCovered).toBe(15);
    expect(metrics.selfFunded).toBe(35);
    expect(metrics.coveragePercent).toBe(30);
  });

  it("shows a confirmed PayPal capture net of fees in admin financial metrics", () => {
    const state = emptyState();
    state.settings.reserveStartYear = "2026";
    state.ledger = mapPaymentTotalsToMetricEntries([
      { month: "2026-08", contribution_total_eur: 1, fee_total_eur: 0.38 },
    ]);

    const metrics = supportMetricsForYear(state, "2026");
    expect(metrics.totalIncome).toBe(1);
    expect(metrics.totalExpenses).toBe(0.38);
    expect(metrics.netCommunitySupport).toBe(0.62);
    expect(metrics.closingReserve).toBe(0.62);
  });

  it("subtracts a later-month refund from season community funds instead of dropping it", () => {
    const state = emptyState();
    state.settings.reserveStartYear = "2026";
    state.ledger = mapPaymentTotalsToMetricEntries([
      { month: "2026-01", contribution_total_eur: 25, fee_total_eur: 0 },
      { month: "2026-02", contribution_total_eur: -25, fee_total_eur: 0 },
    ]);

    const metrics = supportMetricsForYear(state, "2026");
    expect(state.ledger).toContainEqual(expect.objectContaining({ date: "2026-02-01", direction: "expense", category: "payment_refund", amount: 25 }));
    expect(metrics.supportIncome).toBe(25);
    expect(metrics.commercialCosts).toBe(25);
    expect(metrics.netCommunitySupport).toBe(0);
    expect(metrics.closingReserve).toBe(0);
  });

  it("uses carried reserve when a contribution is refunded in the next year", () => {
    const state = emptyState();
    state.settings.reserveStartYear = "2026";
    state.ledger = mapPaymentTotalsToMetricEntries([
      { month: "2026-12", contribution_total_eur: 25, fee_total_eur: 0.69 },
      { month: "2027-01", contribution_total_eur: -25, fee_total_eur: 0 },
    ]);

    const beforeRefund = supportMetricsForYear(state, "2026");
    const afterRefund = supportMetricsForYear(state, "2027");
    expect(beforeRefund.closingReserve).toBe(24.31);
    expect(afterRefund.openingReserve).toBe(24.31);
    expect(afterRefund.netCommunitySupport).toBe(-25);
    expect(afterRefund.reserveUsed).toBe(24.31);
    expect(afterRefund.selfFunded).toBe(0.69);
    expect(afterRefund.closingReserve).toBe(0);
  });

  it("keeps reserve separate from the monthly coverage bar", () => {
    const state = emptyState();
    state.settings.reserve = 100;
    state.recurringCosts = [{ id: "server", startsOn: "2026-06-01", category: "server", description: "Server", amount: 80, frequency: "monthly", isPublic: true, active: true }];

    const metrics = supportMetrics(state, "2026-07");
    expect(metrics.operationalExpenses).toBe(80);
    expect(metrics.communityCovered).toBe(0);
    expect(metrics.selfFunded).toBe(80);
    expect(metrics.coveragePercent).toBe(0);
    expect(metrics.reserve).toBe(100);
  });

  it("includes active recurring costs from their start month onward", () => {
    const state = emptyState();
    state.recurringCosts = [
      { id: "active", startsOn: "2026-07-01", category: "hosting", description: "Hosting", amount: 20, frequency: "monthly", isPublic: true, active: true },
      { id: "future", startsOn: "2026-08-01", category: "domain", description: "Domein", amount: 12, frequency: "monthly", isPublic: true, active: true },
      { id: "inactive", startsOn: "2026-01-01", category: "software", description: "Software", amount: 9, frequency: "monthly", isPublic: true, active: false },
    ];

    expect(supportMetrics(state, "2026-07").operationalExpenses).toBe(20);
    expect(supportMetrics(state, "2026-08").operationalExpenses).toBe(32);
  });

  it("counts yearly recurring costs once per year in their start month", () => {
    const state = emptyState();
    state.recurringCosts = [{ id: "domain", startsOn: "2026-08-15", category: "domain", description: "Domein", amount: 120, frequency: "yearly", isPublic: true, active: true }];

    expect(supportMetrics(state, "2026-07").operationalExpenses).toBe(0);
    expect(supportMetrics(state, "2026-08").operationalExpenses).toBe(120);
    expect(supportMetrics(state, "2026-09").operationalExpenses).toBe(0);
    expect(supportMetrics(state, "2027-08").operationalExpenses).toBe(120);
    expect(supportMetricsForYear(state, "2026").operationalExpenses).toBe(120);
    expect(publicLedgerForYear(state, "2026")).toHaveLength(1);
  });

  it("aggregates the season by year while keeping other years out", () => {
    const state = emptyState();
    state.ledger = [
      { id: "cost", date: "2026-02-10", direction: "expense", category: "event", description: "Raceavond", amount: 30, isPublic: true },
      { id: "support", date: "2026-11-10", direction: "income", category: "contribution", description: "Bijdrage", amount: 50, isPublic: true },
      { id: "old", date: "2025-12-10", direction: "expense", category: "hosting", description: "Vorig jaar", amount: 999, isPublic: true },
    ];
    state.recurringCosts = [{ id: "server", startsOn: "2026-07-01", category: "server", description: "Raceserver", amount: 20, frequency: "monthly", isPublic: true, active: true }];

    const metrics = supportMetricsForYear(state, "2026");
    expect(metrics.operationalExpenses).toBe(150);
    expect(metrics.communityCovered).toBe(50);
    expect(metrics.selfFunded).toBe(100);
    expect(metrics.coveragePercent).toBe(33);
    expect(publicLedgerForYear(state, "2026")).toHaveLength(8);
  });

  it("carries only the remaining community surplus into later seasons", () => {
    const state = emptyState();
    state.settings.reserveStartYear = "2026";
    state.ledger = [
      { id: "cost-2026", date: "2026-06-01", direction: "expense", category: "event", description: "Seizoen 2026", amount: 100, isPublic: true },
      { id: "support-2026", date: "2026-07-01", direction: "income", category: "contribution", description: "Support 2026", amount: 130, isPublic: true },
      { id: "cost-2027", date: "2027-06-01", direction: "expense", category: "event", description: "Seizoen 2027", amount: 20, isPublic: true },
      { id: "cost-2028", date: "2028-06-01", direction: "expense", category: "event", description: "Seizoen 2028", amount: 20, isPublic: true },
    ];

    const season2026 = supportMetricsForYear(state, "2026");
    expect(season2026.openingReserve).toBe(0);
    expect(season2026.closingReserve).toBe(30);

    const season2027 = supportMetricsForYear(state, "2027");
    expect(season2027.openingReserve).toBe(30);
    expect(season2027.reserveUsed).toBe(20);
    expect(season2027.communityCovered).toBe(20);
    expect(season2027.selfFunded).toBe(0);
    expect(season2027.closingReserve).toBe(10);

    const season2028 = supportMetricsForYear(state, "2028");
    expect(season2028.openingReserve).toBe(10);
    expect(season2028.reserveUsed).toBe(10);
    expect(season2028.communityCovered).toBe(10);
    expect(season2028.selfFunded).toBe(10);
    expect(season2028.closingReserve).toBe(0);
  });

  it("does not carry a 3SM-funded deficit forward as community debt", () => {
    const state = emptyState();
    state.settings.reserveStartYear = "2025";
    state.ledger = [
      { id: "cost-2025", date: "2025-06-01", direction: "expense", category: "event", description: "Door 3SM gedragen", amount: 100, isPublic: true },
      { id: "support-2026", date: "2026-06-01", direction: "income", category: "contribution", description: "Support 2026", amount: 50, isPublic: true },
    ];

    expect(supportMetricsForYear(state, "2025").closingReserve).toBe(0);
    const season2026 = supportMetricsForYear(state, "2026");
    expect(season2026.openingReserve).toBe(0);
    expect(season2026.closingReserve).toBe(50);
  });

  it("publishes only explicitly public ledger and recurring rows", () => {
    const state = emptyState();
    state.ledger = [
      { id: "public", date: "2026-07-10", direction: "expense", category: "hosting", description: "Openbaar", amount: 20, isPublic: true },
      { id: "private", date: "2026-07-11", direction: "expense", category: "other", description: "Privé", amount: 30, isPublic: false },
    ];
    state.recurringCosts = [
      { id: "recurring", startsOn: "2026-07-01", category: "server", description: "Server", amount: 40, frequency: "monthly", isPublic: true, active: true },
    ];

    expect(publicLedgerForMonth(state, "2026-07").map((entry) => entry.description)).toEqual(["Openbaar", "Server"]);
  });

  it("redacts supporter name and amount from the public read model", () => {
    const state = emptyState();
    state.ledger = [
      { id: "hidden", date: "2026-07-10", direction: "income", category: "contribution", description: "Bijdrage", amount: 25, isPublic: true, supporterName: "Private Person", showSupporterName: false, showAmount: false },
      { id: "named", date: "2026-07-11", direction: "income", category: "contribution", description: "Bijdrage", amount: 15, isPublic: true, supporterName: "Visible Name", showSupporterName: true, showAmount: false },
    ];

    const entries = publicLedgerForMonth(state, "2026-07");
    expect(entries[0]).toMatchObject({ id: "named", supporterName: "Visible Name", amount: null });
    expect(entries[1]).toMatchObject({ id: "hidden", amount: null });
    expect(entries[1]).not.toHaveProperty("supporterName");
    expect(entries[1]).not.toHaveProperty("showSupporterName");
    expect(entries[1]).not.toHaveProperty("showAmount");
  });

  it("counts each supported race once while keeping private and endurance details out of the public model", () => {
    const state = emptyState();
    state.settings.reserveStartYear = "2026";
    state.ledger = [
      { id: "support", date: "2026-07-01", direction: "income", category: "contribution", description: "Support", amount: 4, isPublic: true },
    ];
    state.raceCosts = [
      { id: "public-race", raceId: "race-a", raceScope: "season", leagueId: "league-a", leagueName: "Sprint Cup", season: "2026", raceName: "Race 1", track: "Spa", date: "2026-07-10", raceFormat: "Sprint", hostedHours: 7, discountApplied: false, sourceAmountUsd: 3.5, exchangeRateUsdEur: 1, vatRate: 0.21, netAmount: 3.5, vatAmount: 0.74, amount: 4.24, isPublic: true, note: "interne notitie" },
      { id: "private-race", raceId: "race-b", raceScope: "standalone", raceName: "Losse race", track: "Zandvoort", date: "2026-08-10", raceFormat: "Feature", hostedHours: 6, discountApplied: true, sourceAmountUsd: 2.25, exchangeRateUsdEur: 1, vatRate: 0.21, netAmount: 2.25, vatAmount: 0.47, amount: 2.72, isPublic: false, note: "niet openbaar" },
      { id: "endurance-race", raceId: "race-c", raceScope: "standalone", raceName: "Endurance", track: "Le Mans", date: "2026-09-10", raceFormat: "Endurance", hostedHours: 24, discountApplied: false, sourceAmountUsd: 100, exchangeRateUsdEur: 1, vatRate: 0.21, netAmount: 100, vatAmount: 21, amount: 121, isPublic: true },
      { id: "unknown-race", raceId: "race-d", raceScope: "standalone", raceName: "Future", track: "Unknown", date: "2026-09-11", raceFormat: "FutureFormat", hostedHours: 24, discountApplied: false, sourceAmountUsd: 100, exchangeRateUsdEur: 1, vatRate: 0.21, netAmount: 100, vatAmount: 21, amount: 121, isPublic: true },
      { id: "named-endurance", raceId: "race-e", raceScope: "standalone", raceName: "Night Endurance", track: "Le Mans", date: "2026-09-12", raceFormat: "Feature", hostedHours: 24, discountApplied: false, sourceAmountUsd: 100, exchangeRateUsdEur: 1, vatRate: 0.21, netAmount: 100, vatAmount: 21, amount: 121, isPublic: true },
    ];

    const season = supportMetricsForYear(state, "2026");
    expect(season.raceCostTotal).toBe(6.96);
    expect(season.operationalExpenses).toBe(6.96);
    expect(season.communityCovered).toBe(4);
    expect(season.selfFunded).toBe(2.96);
    expect(supportMetrics(state, "2026-07").raceCostTotal).toBe(4.24);
    expect(supportMetrics(state, "2026-08").raceCostTotal).toBe(2.72);

    const publicCosts = publicRaceCostsForYear(state, "2026");
    expect(publicCosts).toEqual([
      expect.objectContaining({ raceName: "Race 1", hostedHours: 7, discountApplied: false, sourceAmountUsd: 3.5, exchangeRateUsdEur: 1, vatRate: 0.21, netAmount: 3.5, vatAmount: 0.74, amount: 4.24, isPublic: true }),
    ]);
    expect(publicCosts[0]).not.toHaveProperty("id");
    expect(publicCosts[0]).not.toHaveProperty("raceId");
    expect(publicCosts[0]).not.toHaveProperty("note");
    expect(publicCosts[0]).not.toHaveProperty("leagueId");
    expect(publicLedgerForYear(state, "2026")).toContainEqual(expect.objectContaining({ category: "race_hosting", sourceAmountUsd: 3.5, exchangeRateUsdEur: 1, vatRate: 0.21, netAmount: 3.5, vatAmount: 0.74, amount: 4.24 }));
  });

  it("rounds accumulated money to cents", () => {
    const state = emptyState();
    state.ledger = [
      { id: "a", date: "2026-07-01", direction: "income", category: "contribution", description: "A", amount: 0.1, isPublic: true },
      { id: "b", date: "2026-07-01", direction: "income", category: "contribution", description: "B", amount: 0.2, isPublic: true },
      { id: "cost", date: "2026-07-01", direction: "expense", category: "hosting", description: "Cost", amount: 0.3, isPublic: true },
    ];
    const metrics = supportMetrics(state, "2026-07");
    expect(metrics.supportIncome).toBe(0.3);
    expect(metrics.operationalExpenses).toBe(0.3);
    expect(metrics.selfFunded).toBe(0);
  });
});

describe("Community Support release boundary", () => {
  it("publishes visibility through one flag while management stays limited to admins and Super-admins", () => {
    expect(COMMUNITY_SUPPORT_PUBLIC).toBe(true);
    expect(canViewCommunitySupport(false, false)).toBe(true);
    expect(canViewCommunitySupport(true, false)).toBe(true);
    expect(canViewCommunitySupport(false, true)).toBe(true);
    expect(canManageCommunitySupport(false, false)).toBe(false);
    expect(canManageCommunitySupport(true, false)).toBe(true);
    expect(canManageCommunitySupport(false, true)).toBe(true);
  });

  it("keeps the public route in the footer and management inside the native Control Room", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    const controlRoom = readFileSync("src/pages/AdminWorkspacePrototype.tsx", "utf8");
    const supportModule = readFileSync("src/features/control-room/support/CommunitySupportModule.tsx", "utf8");
    const footer = readFileSync("src/components/Footer.tsx", "utf8");
    const navbar = readFileSync("src/components/Navbar.tsx", "utf8");
    const accessGate = readFileSync("src/features/community-support/CommunitySupportAccessGate.tsx", "utf8");
    const routeClassification = readFileSync("scripts/route-classification.mjs", "utf8");
    const routeGenerator = readFileSync("scripts/generate-route-html.mjs", "utf8");
    expect(app).toContain('path="/support"');
    expect(app).not.toContain('path="/support-beheer"');
    expect(controlRoom).toContain('support: <CommunitySupportModule />');
    expect(controlRoom).toContain('item.id !== "support" || isAdmin || isSuperAdmin');
    expect(supportModule).not.toContain("<Navbar");
    expect(supportModule).not.toContain("<Footer");
    expect(footer).toContain("canViewCommunitySupport(isAdmin, isSuperAdmin)");
    expect(footer).toContain('to="/support/"');
    expect(navbar).not.toContain('to="/support/"');
    expect(accessGate).toContain("if (COMMUNITY_SUPPORT_PUBLIC) return children");
    expect(routeClassification).toContain("createPrivateSeoRoutes");
    expect(routeClassification).toContain("...(!communitySupportPublic ? ['/support'] : [])");
    expect(routeClassification).not.toContain("'/support-beheer'");
    expect(routeGenerator).toContain("createPrivateSeoRoutes(communitySupportPublic)");
    expect(routeGenerator).toContain("Community Support cannot be public while dataSource is not supabase");
    expect(routeGenerator).toContain("path: '/support'");
  });

  it("merges confirmed PayPal totals into the admin dashboard and read-only transaction list", () => {
    const supportModule = readFileSync("src/features/control-room/support/CommunitySupportModule.tsx", "utf8");
    expect(supportModule).toContain("queryFn: fetchSharedPaymentLedger");
    expect(supportModule).toContain("...(sharedPaymentLedger?.metricEntries ?? [])");
    expect(supportModule).toContain("supportMetricsForYear(adminFinancialState, selectedYear)");
    expect(supportModule).toContain('entry.id.startsWith("paypal-total-")');
    expect(supportModule).toContain("Betaaldata niet beschikbaar");
  });
});
