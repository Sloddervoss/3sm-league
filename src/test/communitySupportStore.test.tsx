import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  current: { user: { id: "super-admin-a" } as { id: string } | null, isSuperAdmin: true },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => auth.current,
}));

import { CommunitySupportProvider, useCommunitySupport } from "@/features/community-support/store";

const storageKey = "3sm-community-support-session-v2:super-admin-a";
const validState = {
  ledger: [{ id: "entry", date: "2026-07-01", direction: "income", category: "contribution", description: "Bijdrage", amount: 10, isPublic: true, showSupporterName: false, showAmount: false }],
  recurringCosts: [],
  products: [],
  settings: { reserve: 0, publicSupporterNamesByDefault: true, publicSupporterAmountsByDefault: false, paypalEnabled: false },
};

const Probe = () => {
  const { state, addLedgerEntry, addCreditPurchase, saveRaceCost, saveRaceCosts, initializeRaceCosts } = useCommunitySupport();
  const baseRace = { raceId: "race-a", raceScope: "season" as const, leagueId: "league-a", leagueName: "Sprint Cup", season: "2026", raceName: "Race 1", track: "Spa", date: "2026-07-10", raceFormat: "Sprint", hostedHours: 1, discountApplied: false, isPublic: true };
  return <>
    <span data-testid="ledger-count">{state.ledger.length}</span>
    <span data-testid="race-count">{state.raceCosts.length}</span>
    <span data-testid="race-amount">{state.raceCosts[0]?.creditCostUsd ?? 0}</span>
    <span data-testid="credit-purchase-count">{state.creditPurchases.length}</span>
    <span data-testid="credit-purchase-usd">{state.creditPurchases[0]?.creditsUsd ?? 0}</span>
    <span data-testid="credit-purchase-eur">{state.creditPurchases[0]?.amountEur ?? 0}</span>
    <span data-testid="race-hours">{state.raceCosts[0]?.hostedHours ?? 0}</span>
    <span data-testid="race-public">{String(state.raceCosts[0]?.isPublic ?? false)}</span>
    <span data-testid="race-note">{state.raceCosts[0]?.note ?? ""}</span>
    <span data-testid="pricing-initialized">{String(state.settings.racePricingInitialized)}</span>
    <span data-testid="recurring-frequency">{state.recurringCosts[0]?.frequency ?? ""}</span>
    <span data-testid="product-image-count">{state.products[0]?.imageUrls.length ?? 0}</span>
    <span data-testid="product-first-image">{state.products[0]?.imageUrls[0] ?? ""}</span>
    <button onClick={() => saveRaceCost(baseRace)}>save race</button>
    <button onClick={() => saveRaceCost({ ...baseRace, hostedHours: 2, discountApplied: true, note: "bijgewerkt" })}>update race</button>
    <button onClick={() => saveRaceCosts([baseRace, { ...baseRace, raceId: "race-b", raceScope: "standalone", leagueId: undefined, leagueName: undefined, raceName: "Losse race", raceFormat: "Feature" }])}>save batch</button>
    <button onClick={() => initializeRaceCosts([baseRace])}>initialize prices</button>
    <button onClick={() => initializeRaceCosts([{ ...baseRace, hostedHours: 3 }])}>initialize prices again</button>
    <button onClick={() => saveRaceCost({ ...baseRace, raceId: "endurance", raceScope: "standalone", leagueId: undefined, raceFormat: "Endurance", creditCostUsd: 100 })}>save endurance</button>
    <button onClick={() => saveRaceCost({ ...baseRace, raceId: "named-endurance", raceScope: "standalone", leagueId: undefined, raceName: "Night Endurance", raceFormat: "Feature", creditCostUsd: 100 })}>save named endurance</button>
    <button onClick={() => saveRaceCost({ ...baseRace, raceId: "unknown", raceScope: "standalone", leagueId: undefined, raceFormat: "FutureFormat", creditCostUsd: 100 })}>save unknown format</button>
    <button onClick={() => saveRaceCost({ ...baseRace, raceId: "zero", hostedHours: 0 })}>save zero</button>
    <button onClick={() => addLedgerEntry({ date: "2026-07-10", direction: "expense", category: "race_hosting", description: "Duplicate", amount: 3.5, isPublic: true })}>save manual race hosting</button>
    <button onClick={() => addCreditPurchase({ date: "2026-07-02", description: "iRacing Credits", creditsUsd: 50, amountEur: 46.2, isPublic: true, note: "factuur privé" })}>save credit purchase</button>
    <button onClick={() => addCreditPurchase({ date: "ongeldig", description: "", creditsUsd: 0, amountEur: 0, isPublic: true })}>save invalid credit purchase</button>
    <button onClick={() => addCreditPurchase({ date: "2026-07-02", description: "Te groot", creditsUsd: 1_000_001, amountEur: 1_000_001, isPublic: true })}>save oversized credit purchase</button>
  </>;
};

const Tree = () => <CommunitySupportProvider><Probe /></CommunitySupportProvider>;

describe("Community Support session storage", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    auth.current = { user: { id: "super-admin-a" }, isSuperAdmin: true };
  });

  it("creates local records on an insecure LAN origin without crypto.randomUUID", async () => {
    const originalCrypto = globalThis.crypto;
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.fill(7);
        return bytes;
      },
    } as Crypto);

    try {
      render(<Tree />);
      await waitFor(() => expect(screen.getByTestId("race-count")).toHaveTextContent("0"));
      fireEvent.click(screen.getByRole("button", { name: "save race" }));
      await waitFor(() => expect(screen.getByTestId("race-count")).toHaveTextContent("1"));
      const persisted = JSON.parse(window.sessionStorage.getItem(storageKey) ?? "{}");
      expect(persisted.raceCosts[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    } finally {
      vi.stubGlobal("crypto", originalCrypto);
    }
  });

  it("loads only the active Super-admin session and clears it on user change", async () => {
    window.sessionStorage.setItem(storageKey, JSON.stringify(validState));
    const view = render(<Tree />);
    await waitFor(() => expect(screen.getByTestId("ledger-count")).toHaveTextContent("1"));

    act(() => { auth.current = { user: null, isSuperAdmin: false }; });
    view.rerender(<Tree />);

    await waitFor(() => expect(screen.getByTestId("ledger-count")).toHaveTextContent("0"));
    expect(window.sessionStorage.getItem(storageKey)).toBeNull();
  });

  it("rejects malformed persisted entries instead of trusting a partial top-level shape", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    window.sessionStorage.setItem(storageKey, JSON.stringify({ ...validState, ledger: [{ ...validState.ledger[0], date: null, amount: "10" }] }));
    render(<Tree />);

    await waitFor(() => expect(screen.getByTestId("ledger-count")).toHaveTextContent("0"));
    expect(warn).toHaveBeenCalledWith("Community Support session data was invalid and has been cleared.");
    warn.mockRestore();
  });

  it("migrates legacy race pricing fields without clearing other valid local data", async () => {
    window.sessionStorage.setItem(storageKey, JSON.stringify({
      ...validState,
      raceCosts: [{ id: "legacy", raceId: "race-a", raceScope: "season", leagueId: "league-a", raceName: "Race 1", track: "Spa", date: "2026-07-10", raceFormat: "Sprint", amount: 3.5, isPublic: false, note: "bewaren" }],
    }));
    const view = render(<Tree />);

    await waitFor(() => expect(screen.getByTestId("race-count")).toHaveTextContent("1"));
    expect(screen.getByTestId("ledger-count")).toHaveTextContent("1");
    expect(screen.getByTestId("race-hours")).toHaveTextContent("1");
    expect(screen.getByTestId("race-amount")).toHaveTextContent("3.5");
    expect(screen.getByTestId("pricing-initialized")).toHaveTextContent("false");
    fireEvent.click(screen.getByRole("button", { name: "initialize prices" }));
    await waitFor(() => expect(screen.getByTestId("pricing-initialized")).toHaveTextContent("true"));
    expect(screen.getByTestId("race-public")).toHaveTextContent("false");
    expect(screen.getByTestId("race-note")).toHaveTextContent("bewaren");
    expect(screen.getByTestId("race-amount")).toHaveTextContent("3.5");
    await waitFor(() => {
      const persisted = JSON.parse(window.sessionStorage.getItem(storageKey) ?? "{}");
      expect(persisted.raceCosts[0]).toEqual(expect.objectContaining({ creditCostUsd: 3.5, pricingSource: "legacy_amount" }));
      expect(persisted.raceCosts[0]).not.toHaveProperty("amount");
    });
    view.unmount();
    render(<Tree />);
    await waitFor(() => expect(screen.getByTestId("race-amount")).toHaveTextContent("3.5"));
  });

  it("migrates legacy recurring frequency and product image URLs without clearing local data", async () => {
    window.sessionStorage.setItem(storageKey, JSON.stringify({
      ...validState,
      recurringCosts: [{ id: "domain", startsOn: "2026-08-01", category: "domain", description: "Domein", amount: 12, isPublic: true, active: true }],
      products: [{ id: "shirt", name: "Shirt", description: "3SM shirt", price: 25, purchasePrice: 12, shippingCost: 3, stock: 4, active: false, concept: true, imageUrl: "https://example.com/legacy-shirt.jpg" }],
    }));
    render(<Tree />);

    await waitFor(() => expect(screen.getByTestId("recurring-frequency")).toHaveTextContent("monthly"));
    expect(screen.getByTestId("ledger-count")).toHaveTextContent("1");
    expect(screen.getByTestId("product-image-count")).toHaveTextContent("1");
    expect(screen.getByTestId("product-first-image")).toHaveTextContent("https://example.com/legacy-shirt.jpg");
  });

  it("stores a Credit purchase as one validated EUR expense with USD credits", async () => {
    render(<Tree />);
    await waitFor(() => expect(screen.getByTestId("credit-purchase-count")).toHaveTextContent("0"));
    fireEvent.click(screen.getByRole("button", { name: "save credit purchase" }));

    await waitFor(() => expect(screen.getByTestId("credit-purchase-count")).toHaveTextContent("1"));
    expect(screen.getByTestId("credit-purchase-usd")).toHaveTextContent("50");
    expect(screen.getByTestId("credit-purchase-eur")).toHaveTextContent("46.2");
    const persisted = JSON.parse(window.sessionStorage.getItem(storageKey) ?? "{}");
    expect(persisted.creditPurchases).toEqual([expect.objectContaining({ creditsUsd: 50, amountEur: 46.2, isPublic: true, note: "factuur privé" })]);
    expect(persisted.ledger).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "save invalid credit purchase" }));
    expect(screen.getByTestId("credit-purchase-count")).toHaveTextContent("1");
    fireEvent.click(screen.getByRole("button", { name: "save oversized credit purchase" }));
    expect(screen.getByTestId("credit-purchase-count")).toHaveTextContent("1");
  });

  it("recalculates hydrated USD credit costs from stored hours and discount", async () => {
    window.sessionStorage.setItem(storageKey, JSON.stringify({
      ...validState,
      settings: { ...validState.settings, racePricingInitialized: true },
      raceCosts: [{ id: "priced", raceId: "race-a", raceScope: "season", leagueId: "league-a", raceName: "Race 1", track: "Spa", date: "2026-07-10", raceFormat: "Sprint", hostedHours: 2, discountApplied: true, creditCostUsd: 99, pricingSource: "calculated", isPublic: true }],
    }));
    render(<Tree />);

    await waitFor(() => expect(screen.getByTestId("race-count")).toHaveTextContent("1"));
    expect(screen.getByTestId("race-hours")).toHaveTextContent("2");
    expect(screen.getByTestId("race-amount")).toHaveTextContent("0.75");
    expect(screen.getByTestId("pricing-initialized")).toHaveTextContent("true");
  });

  it.each([
    ["zero race amount", {
      ...validState,
      raceCosts: [{ id: "cost-a", raceId: "race-a", raceScope: "season", leagueId: "league-a", raceName: "Race 1", track: "Spa", date: "2026-07-10", raceFormat: "Sprint", amount: 0, isPublic: true }],
    }],
    ["manual race_hosting ledger entry", {
      ...validState,
      ledger: [{ id: "duplicate", date: "2026-07-10", direction: "expense", category: "race_hosting", description: "Duplicate", amount: 3.5, isPublic: true }],
    }],
  ])("rejects persisted %s", async (_name, persistedState) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    window.sessionStorage.setItem(storageKey, JSON.stringify(persistedState));
    render(<Tree />);

    await waitFor(() => expect(screen.getByTestId("race-count")).toHaveTextContent("0"));
    expect(screen.getByTestId("ledger-count")).toHaveTextContent("0");
    expect(warn).toHaveBeenCalledWith("Community Support session data was invalid and has been cleared.");
    warn.mockRestore();
  });

  it("upserts one rounded cost per race and refuses unsupported or duplicate records", async () => {
    render(<Tree />);
    await waitFor(() => expect(screen.getByTestId("race-count")).toHaveTextContent("0"));

    fireEvent.click(screen.getByRole("button", { name: "save race" }));
    await waitFor(() => expect(screen.getByTestId("race-amount")).toHaveTextContent("0.5"));
    fireEvent.click(screen.getByRole("button", { name: "update race" }));
    await waitFor(() => expect(screen.getByTestId("race-amount")).toHaveTextContent("0.75"));
    expect(screen.getByTestId("race-count")).toHaveTextContent("1");

    fireEvent.click(screen.getByRole("button", { name: "save endurance" }));
    fireEvent.click(screen.getByRole("button", { name: "save named endurance" }));
    fireEvent.click(screen.getByRole("button", { name: "save unknown format" }));
    fireEvent.click(screen.getByRole("button", { name: "save zero" }));
    fireEvent.click(screen.getByRole("button", { name: "save manual race hosting" }));
    expect(screen.getByTestId("race-count")).toHaveTextContent("1");
    expect(screen.getByTestId("ledger-count")).toHaveTextContent("0");
    await waitFor(() => {
      const persisted = JSON.parse(window.sessionStorage.getItem(storageKey) ?? "{}");
      expect(persisted.raceCosts).toHaveLength(1);
      expect(persisted.raceCosts[0]).toMatchObject({ raceId: "race-a", hostedHours: 2, discountApplied: true, creditCostUsd: 0.75, note: "bijgewerkt" });
      expect(persisted.raceCosts[0]).not.toHaveProperty("amount");
    });
  });

  it("bulk-upserts races idempotently by race ID", async () => {
    render(<Tree />);
    await waitFor(() => expect(screen.getByTestId("race-count")).toHaveTextContent("0"));
    fireEvent.click(screen.getByRole("button", { name: "save batch" }));
    await waitFor(() => expect(screen.getByTestId("race-count")).toHaveTextContent("2"));
    fireEvent.click(screen.getByRole("button", { name: "save batch" }));
    expect(screen.getByTestId("race-count")).toHaveTextContent("2");
  });

  it("initializes the local $0.50 credit usage only once", async () => {
    render(<Tree />);
    await waitFor(() => expect(screen.getByTestId("pricing-initialized")).toHaveTextContent("false"));
    fireEvent.click(screen.getByRole("button", { name: "initialize prices" }));
    await waitFor(() => expect(screen.getByTestId("race-amount")).toHaveTextContent("0.5"));
    expect(screen.getByTestId("pricing-initialized")).toHaveTextContent("true");
    fireEvent.click(screen.getByRole("button", { name: "update race" }));
    await waitFor(() => expect(screen.getByTestId("race-amount")).toHaveTextContent("0.75"));
    fireEvent.click(screen.getByRole("button", { name: "initialize prices again" }));
    expect(screen.getByTestId("race-amount")).toHaveTextContent("0.75");
  });

  it("rejects duplicate persisted race costs", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const raceCost = { id: "cost-a", raceId: "race-a", raceScope: "season", leagueId: "league-a", raceName: "Race 1", track: "Spa", date: "2026-07-10", raceFormat: "Sprint", amount: 3.5, isPublic: true };
    window.sessionStorage.setItem(storageKey, JSON.stringify({ ...validState, raceCosts: [raceCost, { ...raceCost, id: "cost-b" }] }));
    render(<Tree />);

    await waitFor(() => expect(screen.getByTestId("race-count")).toHaveTextContent("0"));
    expect(warn).toHaveBeenCalledWith("Community Support session data was invalid and has been cleared.");
    warn.mockRestore();
  });
});
