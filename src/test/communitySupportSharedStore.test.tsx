import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  fetchAdmin: vi.fn(),
  insertLedger: vi.fn(),
  setProductVisibility: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "admin-a" }, isAdmin: true, isSuperAdmin: false }),
}));
vi.mock("@/features/community-support/model", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/community-support/model")>()),
  COMMUNITY_SUPPORT_HAS_SHARED_DATA: true,
}));
vi.mock("@/features/community-support/supportDataApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/community-support/supportDataApi")>()),
  fetchAdminCommunitySupportState: api.fetchAdmin,
  insertLedgerEntry: api.insertLedger,
  setProductVisibility: api.setProductVisibility,
}));

import { CommunitySupportProvider, useCommunitySupport } from "@/features/community-support/store";
import type { CommunitySupportState } from "@/features/community-support/types";

const emptyState = (): CommunitySupportState => ({
  ledger: [], recurringCosts: [], raceCosts: [], products: [], paymentIntents: [],
  settings: {
    reserve: 0, reserveStartYear: "2026", racePricingInitialized: false, usdEurRate: 0.92,
    publicSupporterNamesByDefault: true, publicSupporterAmountsByDefault: false,
    paypalEnabled: false, paypalCheckoutEnabled: false, paypalCheckoutEnvironment: "sandbox",
    paypalMeUrl: "", paypalSuggestedAmounts: [5, 10, 25], paymentAdminDiscordId: "",
    iracingReferralEnabled: false, iracingReferralUrl: "",
  },
});

const Harness = () => {
  const { state, loading, persistenceError, addLedgerEntry, toggleProductPublication } = useCommunitySupport();
  return <>
    <span>{loading ? "loading" : `ledger:${state.ledger.map((entry) => entry.id).join(",")}`}</span>
    {persistenceError && <span role="alert">{persistenceError}</span>}
    <span>{state.products[0] ? `product:${state.products[0].active}:${state.products[0].concept}` : "product:none"}</span>
    <button onClick={() => void addLedgerEntry({
      date: "2026-08-03", direction: "income", category: "contribution", description: "Bijdrage",
      amount: 10, isPublic: true, showSupporterName: false, showAmount: false,
    })}>add</button>
    <button onClick={() => state.products[0] && void toggleProductPublication(state.products[0].id)}>publish</button>
  </>;
};

const renderHarness = () => render(<CommunitySupportProvider><Harness /></CommunitySupportProvider>);

describe("Community Support shared store", () => {
  beforeEach(() => {
    api.fetchAdmin.mockReset();
    api.insertLedger.mockReset();
    api.setProductVisibility.mockReset();
  });

  it("refetches canonical shared state after a successful optimistic mutation", async () => {
    const canonical = emptyState();
    canonical.ledger = [{ id: "server-id", date: "2026-08-03", direction: "income", category: "contribution", description: "Bijdrage", amount: 10, isPublic: true, showSupporterName: false, showAmount: false }];
    api.fetchAdmin.mockResolvedValueOnce(emptyState()).mockResolvedValueOnce(canonical);
    api.insertLedger.mockResolvedValue(undefined);
    renderHarness();
    await screen.findByText("ledger:");
    fireEvent.click(screen.getByRole("button", { name: "add" }));
    await screen.findByText("ledger:server-id");
    expect(api.insertLedger).toHaveBeenCalledTimes(1);
  });

  it("removes failed optimistic data and exposes a persistence error", async () => {
    api.fetchAdmin.mockResolvedValue(emptyState());
    api.insertLedger.mockRejectedValue(new Error("write denied"));
    renderHarness();
    await screen.findByText("ledger:");
    fireEvent.click(screen.getByRole("button", { name: "add" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("write denied"));
    expect(screen.getByText("ledger:")).toBeInTheDocument();
  });

  it("publishes an existing concept product atomically as active and non-concept", async () => {
    const concept = emptyState();
    concept.products = [{
      id: "product-a", name: "Test", description: "Testproduct", price: 20, purchasePrice: 0,
      shippingCost: 0, fulfillmentMode: "digital", stock: 1, active: true, concept: true, imageUrls: [],
    }];
    const published = emptyState();
    published.products = [{ ...concept.products[0], active: true, concept: false }];
    api.fetchAdmin.mockResolvedValueOnce(concept).mockResolvedValueOnce(published);
    api.setProductVisibility.mockResolvedValue(undefined);

    renderHarness();
    await screen.findByText("product:true:true");
    fireEvent.click(screen.getByRole("button", { name: "publish" }));

    await screen.findByText("product:true:false");
    expect(api.setProductVisibility).toHaveBeenCalledWith("product-a", true, false);
  });
});
