import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  current: { user: { id: "super-admin-a" } as { id: string } | null, isAdmin: false, isSuperAdmin: true },
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
  const { state, addLedgerEntry, saveRaceCost, saveRaceCosts, initializeRaceCosts, updateSettings } = useCommunitySupport();
  const baseRace = { raceId: "race-a", raceScope: "season" as const, leagueId: "league-a", leagueName: "Sprint Cup", season: "2026", raceName: "Race 1", track: "Spa", date: "2026-07-10", raceFormat: "Sprint", hostedHours: 1, discountApplied: false, isPublic: true };
  return <>
    <span data-testid="ledger-count">{state.ledger.length}</span>
    <span data-testid="race-count">{state.raceCosts.length}</span>
    <span data-testid="race-amount">{state.raceCosts[0]?.amount ?? 0}</span>
    <span data-testid="race-source-usd">{state.raceCosts[0]?.sourceAmountUsd ?? 0}</span>
    <span data-testid="race-rate">{state.raceCosts[0]?.exchangeRateUsdEur ?? 0}</span>
    <span data-testid="default-rate">{state.settings.usdEurRate}</span>
    <span data-testid="race-a-amount">{state.raceCosts.find((cost) => cost.raceId === "race-a")?.amount ?? 0}</span>
    <span data-testid="race-a-rate">{state.raceCosts.find((cost) => cost.raceId === "race-a")?.exchangeRateUsdEur ?? 0}</span>
    <span data-testid="race-b-amount">{state.raceCosts.find((cost) => cost.raceId === "race-b")?.amount ?? 0}</span>
    <span data-testid="race-b-rate">{state.raceCosts.find((cost) => cost.raceId === "race-b")?.exchangeRateUsdEur ?? 0}</span>
    <span data-testid="race-hours">{state.raceCosts[0]?.hostedHours ?? 0}</span>
    <span data-testid="race-public">{String(state.raceCosts[0]?.isPublic ?? false)}</span>
    <span data-testid="race-note">{state.raceCosts[0]?.note ?? ""}</span>
    <span data-testid="pricing-initialized">{String(state.settings.racePricingInitialized)}</span>
    <span data-testid="recurring-frequency">{state.recurringCosts[0]?.frequency ?? ""}</span>
    <span data-testid="product-image-count">{state.products[0]?.imageUrls.length ?? 0}</span>
    <span data-testid="product-first-image">{state.products[0]?.imageUrls[0] ?? ""}</span>
    <button onClick={() => saveRaceCost(baseRace)}>save race</button>
    <button onClick={() => updateSettings({ usdEurRate: 0.8 })}>change rate</button>
    <button onClick={() => saveRaceCost({ ...baseRace, raceId: "race-b", raceName: "Race 2" })}>save future race</button>
    <button onClick={() => saveRaceCost({ ...baseRace, hostedHours: 2, discountApplied: true, note: "bijgewerkt" })}>update race</button>
    <button onClick={() => saveRaceCosts([baseRace, { ...baseRace, raceId: "race-b", raceScope: "standalone", leagueId: undefined, leagueName: undefined, raceName: "Losse race", raceFormat: "Feature" }])}>save batch</button>
    <button onClick={() => initializeRaceCosts([baseRace])}>initialize prices</button>
    <button onClick={() => initializeRaceCosts([{ ...baseRace, hostedHours: 3 }])}>initialize prices again</button>
    <button onClick={() => saveRaceCost({ ...baseRace, raceId: "endurance", raceScope: "standalone", leagueId: undefined, raceFormat: "Endurance", amount: 100 })}>save endurance</button>
    <button onClick={() => saveRaceCost({ ...baseRace, raceId: "named-endurance", raceScope: "standalone", leagueId: undefined, raceName: "Night Endurance", raceFormat: "Feature", amount: 100 })}>save named endurance</button>
    <button onClick={() => saveRaceCost({ ...baseRace, raceId: "unknown", raceScope: "standalone", leagueId: undefined, raceFormat: "FutureFormat", amount: 100 })}>save unknown format</button>
    <button onClick={() => saveRaceCost({ ...baseRace, raceId: "zero", hostedHours: 0 })}>save zero</button>
    <button onClick={() => addLedgerEntry({ date: "2026-07-10", direction: "expense", category: "race_hosting", description: "Duplicate", amount: 3.5, isPublic: true })}>save manual race hosting</button>
  </>;
};

const Tree = () => <CommunitySupportProvider><Probe /></CommunitySupportProvider>;

describe("Community Support session storage", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    auth.current = { user: { id: "super-admin-a" }, isAdmin: false, isSuperAdmin: true };
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

  it("persists a separate local review session for a regular admin", async () => {
    auth.current = { user: { id: "regular-admin-a" }, isAdmin: true, isSuperAdmin: false };
    render(<Tree />);
    fireEvent.click(screen.getByRole("button", { name: "save race" }));
    await waitFor(() => expect(screen.getByTestId("race-count")).toHaveTextContent("1"));
    expect(window.sessionStorage.getItem("3sm-community-support-session-v2:regular-admin-a")).not.toBeNull();
  });

  it("loads only the active admin session and clears it on user change", async () => {
    window.sessionStorage.setItem(storageKey, JSON.stringify(validState));
    const view = render(<Tree />);
    await waitFor(() => expect(screen.getByTestId("ledger-count")).toHaveTextContent("1"));

    act(() => { auth.current = { user: null, isAdmin: false, isSuperAdmin: false }; });
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
    render(<Tree />);

    await waitFor(() => expect(screen.getByTestId("race-count")).toHaveTextContent("1"));
    expect(screen.getByTestId("ledger-count")).toHaveTextContent("1");
    expect(screen.getByTestId("race-hours")).toHaveTextContent("1");
    expect(screen.getByTestId("race-source-usd")).toHaveTextContent("0.5");
    expect(screen.getByTestId("race-rate")).toHaveTextContent("0.92");
    expect(screen.getByTestId("race-amount")).toHaveTextContent("0.46");
    expect(screen.getByTestId("pricing-initialized")).toHaveTextContent("false");
    fireEvent.click(screen.getByRole("button", { name: "initialize prices" }));
    await waitFor(() => expect(screen.getByTestId("pricing-initialized")).toHaveTextContent("true"));
    expect(screen.getByTestId("race-public")).toHaveTextContent("false");
    expect(screen.getByTestId("race-note")).toHaveTextContent("bewaren");
    expect(screen.getByTestId("race-amount")).toHaveTextContent("0.46");
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

  it("migrates an unsnapshotted race from hours and discount into EUR", async () => {
    window.sessionStorage.setItem(storageKey, JSON.stringify({
      ...validState,
      settings: { ...validState.settings, racePricingInitialized: true },
      raceCosts: [{ id: "priced", raceId: "race-a", raceScope: "season", leagueId: "league-a", raceName: "Race 1", track: "Spa", date: "2026-07-10", raceFormat: "Sprint", hostedHours: 2, discountApplied: true, amount: 99, isPublic: true }],
    }));
    render(<Tree />);

    await waitFor(() => expect(screen.getByTestId("race-count")).toHaveTextContent("1"));
    expect(screen.getByTestId("race-hours")).toHaveTextContent("2");
    expect(screen.getByTestId("race-source-usd")).toHaveTextContent("0.75");
    expect(screen.getByTestId("race-amount")).toHaveTextContent("0.69");
    expect(screen.getByTestId("pricing-initialized")).toHaveTextContent("true");
  });

  it.each([
    ["zero race amount", {
      ...validState,
      raceCosts: [{ id: "cost-a", raceId: "race-a", raceScope: "season", leagueId: "league-a", raceName: "Race 1", track: "Spa", date: "2026-07-10", raceFormat: "Sprint", hostedHours: 1, discountApplied: false, sourceAmountUsd: 0, exchangeRateUsdEur: 0.92, amount: 0, isPublic: true }],
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
    await waitFor(() => expect(screen.getByTestId("race-amount")).toHaveTextContent("0.46"));
    fireEvent.click(screen.getByRole("button", { name: "update race" }));
    await waitFor(() => expect(screen.getByTestId("race-amount")).toHaveTextContent("0.69"));
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
      expect(persisted.raceCosts[0]).toMatchObject({ raceId: "race-a", hostedHours: 2, discountApplied: true, sourceAmountUsd: 0.75, exchangeRateUsdEur: 0.92, amount: 0.69, note: "bijgewerkt" });
    });
  });

  it("applies a changed USD/EUR rate only to future race entries", async () => {
    render(<Tree />);
    await waitFor(() => expect(screen.getByTestId("default-rate")).toHaveTextContent("0.92"));

    fireEvent.click(screen.getByRole("button", { name: "save race" }));
    await waitFor(() => expect(screen.getByTestId("race-a-amount")).toHaveTextContent("0.46"));
    expect(screen.getByTestId("race-a-rate")).toHaveTextContent("0.92");

    fireEvent.click(screen.getByRole("button", { name: "change rate" }));
    await waitFor(() => expect(screen.getByTestId("default-rate")).toHaveTextContent("0.8"));
    expect(screen.getByTestId("race-a-amount")).toHaveTextContent("0.46");
    expect(screen.getByTestId("race-a-rate")).toHaveTextContent("0.92");

    fireEvent.click(screen.getByRole("button", { name: "update race" }));
    await waitFor(() => expect(screen.getByTestId("race-a-amount")).toHaveTextContent("0.69"));
    expect(screen.getByTestId("race-a-rate")).toHaveTextContent("0.92");

    fireEvent.click(screen.getByRole("button", { name: "save future race" }));
    await waitFor(() => expect(screen.getByTestId("race-b-amount")).toHaveTextContent("0.4"));
    expect(screen.getByTestId("race-b-rate")).toHaveTextContent("0.8");
    expect(screen.getByTestId("race-a-amount")).toHaveTextContent("0.69");
  });

  it("bulk-upserts races idempotently by race ID", async () => {
    render(<Tree />);
    await waitFor(() => expect(screen.getByTestId("race-count")).toHaveTextContent("0"));
    fireEvent.click(screen.getByRole("button", { name: "save batch" }));
    await waitFor(() => expect(screen.getByTestId("race-count")).toHaveTextContent("2"));
    fireEvent.click(screen.getByRole("button", { name: "save batch" }));
    expect(screen.getByTestId("race-count")).toHaveTextContent("2");
  });

  it("initializes converted $0.50 review prices only once", async () => {
    render(<Tree />);
    await waitFor(() => expect(screen.getByTestId("pricing-initialized")).toHaveTextContent("false"));
    fireEvent.click(screen.getByRole("button", { name: "initialize prices" }));
    await waitFor(() => expect(screen.getByTestId("race-amount")).toHaveTextContent("0.46"));
    expect(screen.getByTestId("pricing-initialized")).toHaveTextContent("true");
    fireEvent.click(screen.getByRole("button", { name: "update race" }));
    await waitFor(() => expect(screen.getByTestId("race-amount")).toHaveTextContent("0.69"));
    fireEvent.click(screen.getByRole("button", { name: "initialize prices again" }));
    expect(screen.getByTestId("race-amount")).toHaveTextContent("0.69");
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
