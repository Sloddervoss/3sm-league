import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COMMUNITY_SUPPORT_PUBLIC, canManageCommunitySupport, canViewCommunitySupport, publicLedgerForMonth, publicLedgerForYear, supportMetrics, supportMetricsForYear } from "@/features/community-support/model";
import type { CommunitySupportState } from "@/features/community-support/types";

const emptyState = (): CommunitySupportState => ({
  ledger: [],
  recurringCosts: [],
  products: [],
  settings: {
    reserve: 0,
    publicSupporterNamesByDefault: true,
    publicSupporterAmountsByDefault: false,
    paypalEnabled: false,
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

  it("keeps reserve separate from the monthly coverage bar", () => {
    const state = emptyState();
    state.settings.reserve = 100;
    state.recurringCosts = [{ id: "server", startsOn: "2026-06-01", category: "server", description: "Server", amount: 80, isPublic: true, active: true }];

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
      { id: "active", startsOn: "2026-07-01", category: "hosting", description: "Hosting", amount: 20, isPublic: true, active: true },
      { id: "future", startsOn: "2026-08-01", category: "domain", description: "Domein", amount: 12, isPublic: true, active: true },
      { id: "inactive", startsOn: "2026-01-01", category: "software", description: "Software", amount: 9, isPublic: true, active: false },
    ];

    expect(supportMetrics(state, "2026-07").operationalExpenses).toBe(20);
    expect(supportMetrics(state, "2026-08").operationalExpenses).toBe(32);
  });

  it("aggregates the season by year while keeping other years out", () => {
    const state = emptyState();
    state.ledger = [
      { id: "cost", date: "2026-02-10", direction: "expense", category: "event", description: "Raceavond", amount: 30, isPublic: true },
      { id: "support", date: "2026-11-10", direction: "income", category: "contribution", description: "Bijdrage", amount: 50, isPublic: true },
      { id: "old", date: "2025-12-10", direction: "expense", category: "hosting", description: "Vorig jaar", amount: 999, isPublic: true },
    ];
    state.recurringCosts = [{ id: "server", startsOn: "2026-07-01", category: "server", description: "Raceserver", amount: 20, isPublic: true, active: true }];

    const metrics = supportMetricsForYear(state, "2026");
    expect(metrics.operationalExpenses).toBe(150);
    expect(metrics.communityCovered).toBe(50);
    expect(metrics.selfFunded).toBe(100);
    expect(metrics.coveragePercent).toBe(33);
    expect(publicLedgerForYear(state, "2026")).toHaveLength(8);
  });

  it("publishes only explicitly public ledger and recurring rows", () => {
    const state = emptyState();
    state.ledger = [
      { id: "public", date: "2026-07-10", direction: "expense", category: "hosting", description: "Openbaar", amount: 20, isPublic: true },
      { id: "private", date: "2026-07-11", direction: "expense", category: "other", description: "Privé", amount: 30, isPublic: false },
    ];
    state.recurringCosts = [
      { id: "recurring", startsOn: "2026-07-01", category: "server", description: "Server", amount: 40, isPublic: true, active: true },
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
  it("keeps public visibility behind one flag while management stays Super-admin-only", () => {
    expect(COMMUNITY_SUPPORT_PUBLIC).toBe(false);
    expect(canViewCommunitySupport(false)).toBe(false);
    expect(canViewCommunitySupport(true)).toBe(true);
    expect(canManageCommunitySupport(false)).toBe(false);
    expect(canManageCommunitySupport(true)).toBe(true);
  });

  it("wires real routes and a flag-controlled footer link without touching the main nav", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    const footer = readFileSync("src/components/Footer.tsx", "utf8");
    const navbar = readFileSync("src/components/Navbar.tsx", "utf8");
    const accessGate = readFileSync("src/features/community-support/CommunitySupportAccessGate.tsx", "utf8");
    const routeClassification = readFileSync("scripts/route-classification.mjs", "utf8");
    const routeGenerator = readFileSync("scripts/generate-route-html.mjs", "utf8");
    expect(app).toContain('path="/support"');
    expect(app).toContain('path="/support-beheer"');
    expect(app).toContain("CommunitySupportAccessGate management");
    expect(footer).toContain("canViewCommunitySupport(isSuperAdmin)");
    expect(footer).toContain('to="/support/"');
    expect(navbar).not.toContain('to="/support/"');
    expect(accessGate).toContain("if (!management && COMMUNITY_SUPPORT_PUBLIC) return children");
    expect(routeClassification).toContain("createPrivateSeoRoutes");
    expect(routeClassification).toContain("...(!communitySupportPublic ? ['/support'] : [])");
    expect(routeClassification).toContain("'/support-beheer'");
    expect(routeGenerator).toContain("createPrivateSeoRoutes(communitySupportPublic)");
    expect(routeGenerator).toContain("Community Support cannot be public while dataSource is not supabase");
    expect(routeGenerator).toContain("path: '/support'");
  });
});
