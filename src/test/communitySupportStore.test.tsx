import { act, render, screen, waitFor } from "@testing-library/react";
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
  const { state } = useCommunitySupport();
  return <span data-testid="ledger-count">{state.ledger.length}</span>;
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
});
