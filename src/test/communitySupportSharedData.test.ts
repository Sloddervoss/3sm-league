import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc, from: vi.fn() },
}));

import { deleteRaceCost, fetchPublicCommunitySupportData, upsertRaceCosts } from "@/features/community-support/supportDataApi";

describe("Community Support shared public data", () => {
  beforeEach(() => rpc.mockReset());

  it("keeps a private contribution amount out of the public ledger while retaining only its monthly aggregate for metrics", async () => {
    rpc.mockResolvedValue({
      error: null,
      data: {
        settings: { reserve: 12.5, reserveStartYear: "2026", usdEurRate: 0.92 },
        ledger: [{
          id: "entry-a", date: "2026-08-03", direction: "income", category: "contribution",
          description: "Bijdrage", amount: null, isPublic: true, supporterName: null,
          showSupporterName: false, showAmount: false,
        }],
        ledgerTotals: [{ month: "2026-08", direction: "income", category: "contribution", amount: 25 }],
        costTotals: [{ month: "2026-08", category: "race_hosting", amount: 4.6 }],
        recurringCosts: [], raceCosts: [], products: [{
          id: "product-a", name: "Shirt", description: "3SM shirt", price: 25,
          stock: 2, active: true, concept: false, imageUrls: [],
        }],
      },
    });

    const result = await fetchPublicCommunitySupportData();
    expect(rpc).toHaveBeenCalledWith("get_public_community_support_data");
    expect(result.displayState.ledger[0]).toMatchObject({ amount: null, showAmount: false });
    expect(result.displayState.ledger[0]?.supporterName).toBeUndefined();
    expect(result.metricLedger).toEqual([
      expect.objectContaining({ amount: 25, date: "2026-08-01", isPublic: false }),
      expect.objectContaining({ amount: 4.6, category: "race_hosting", direction: "expense", isPublic: false }),
    ]);
    expect(result.displayState.settings).toMatchObject({ reserve: 12.5, reserveStartYear: "2026", usdEurRate: 0.92 });
    expect(result.displayState.products[0]).toMatchObject({ price: 25, purchasePrice: 0, shippingCost: 0 });
  });

  it("fails closed when the shared RPC fails", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "forbidden" } });
    await expect(fetchPublicCommunitySupportData()).rejects.toThrow("forbidden");
  });

  it("sends only editable race inputs and leaves money and exchange-rate calculation to the server", async () => {
    rpc.mockResolvedValue({ data: 1, error: null });
    await upsertRaceCosts([{
      id: "local-id", raceId: "9dbf72ec-d1ca-4e38-bd72-6cb174cb8228", raceScope: "season",
      leagueId: "league", leagueName: "Cup", season: "2026", raceName: "Race 1", track: "Spa",
      date: "2026-08-03", raceFormat: "Sprint", hostedHours: 2, discountApplied: true,
      sourceAmountUsd: 999, exchangeRateUsdEur: 9.99, amount: 999, isPublic: true, note: "snapshot",
    }]);
    expect(rpc).toHaveBeenCalledWith("admin_upsert_community_support_race_costs", {
      p_items: [{ raceId: "9dbf72ec-d1ca-4e38-bd72-6cb174cb8228", hostedHours: 2, discountApplied: true, isPublic: true, note: "snapshot" }],
      p_initialize_only: false,
    });
  });

  it("removes race costs through the bounded server RPC instead of direct table delete", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await deleteRaceCost("9dbf72ec-d1ca-4e38-bd72-6cb174cb8228");
    expect(rpc).toHaveBeenCalledWith("admin_delete_community_support_item", {
      p_entity: "race_cost",
      p_id: "9dbf72ec-d1ca-4e38-bd72-6cb174cb8228",
    });
  });
});
