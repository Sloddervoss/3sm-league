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
  const { state, addLedgerEntry, saveRaceCost } = useCommunitySupport();
  const baseRace = { raceId: "race-a", raceScope: "season" as const, leagueId: "league-a", leagueName: "Sprint Cup", season: "2026", raceName: "Race 1", track: "Spa", date: "2026-07-10", raceFormat: "Sprint", isPublic: true };
  return <>
    <span data-testid="ledger-count">{state.ledger.length}</span>
    <span data-testid="race-count">{state.raceCosts.length}</span>
    <span data-testid="race-amount">{state.raceCosts[0]?.amount ?? 0}</span>
    <button onClick={() => saveRaceCost({ ...baseRace, amount: 3.335 })}>save race</button>
    <button onClick={() => saveRaceCost({ ...baseRace, amount: 4.444, note: "bijgewerkt" })}>update race</button>
    <button onClick={() => saveRaceCost({ ...baseRace, raceId: "endurance", raceScope: "standalone", leagueId: undefined, raceFormat: "Endurance", amount: 100 })}>save endurance</button>
    <button onClick={() => saveRaceCost({ ...baseRace, raceId: "named-endurance", raceScope: "standalone", leagueId: undefined, raceName: "Night Endurance", raceFormat: "Feature", amount: 100 })}>save named endurance</button>
    <button onClick={() => saveRaceCost({ ...baseRace, raceId: "unknown", raceScope: "standalone", leagueId: undefined, raceFormat: "FutureFormat", amount: 100 })}>save unknown format</button>
    <button onClick={() => saveRaceCost({ ...baseRace, raceId: "zero", amount: 0 })}>save zero</button>
    <button onClick={() => addLedgerEntry({ date: "2026-07-10", direction: "expense", category: "race_hosting", description: "Duplicate", amount: 3.5, isPublic: true })}>save manual race hosting</button>
  </>;
};

const Tree = () => <CommunitySupportProvider><Probe /></CommunitySupportProvider>;

describe("Community Support session storage", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    auth.current = { user: { id: "super-admin-a" }, isSuperAdmin: true };
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
    await waitFor(() => expect(screen.getByTestId("race-amount")).toHaveTextContent("3.34"));
    fireEvent.click(screen.getByRole("button", { name: "update race" }));
    await waitFor(() => expect(screen.getByTestId("race-amount")).toHaveTextContent("4.44"));
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
      expect(persisted.raceCosts[0]).toMatchObject({ raceId: "race-a", amount: 4.44, note: "bijgewerkt" });
    });
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
