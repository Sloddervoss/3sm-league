import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const support = vi.hoisted(() => ({
  initializeRaceCosts: vi.fn(),
  state: {
    raceCosts: [] as Array<Record<string, unknown>>,
    settings: { usdEurRate: 0.92 },
  },
}));
const writes = vi.hoisted(() => ({ failRaceUpdate: false }));

const race = {
  id: "race-a",
  name: "Fun Race",
  track: "Spa",
  race_date: "2026-08-02T18:00:00.000Z",
  league_id: null,
  status: "scheduled",
  race_type: null,
  leagues: null,
};

vi.mock("@/features/community-support/store", () => ({
  useCommunitySupport: () => ({ state: support.state, initializeRaceCosts: support.initializeRaceCosts }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "races") return {
        select: () => ({ order: async () => ({ data: [race], error: null }) }),
        update: () => ({ eq: async () => ({ error: writes.failRaceUpdate ? new Error("race update failed") : null }) }),
      };
      if (table === "profiles") return { select: async () => ({ data: [{ user_id: "driver-a", display_name: "Driver A", iracing_name: "Driver A", iracing_id: "123" }], error: null }) };
      if (table === "race_results") return {
        select: () => ({ eq: async () => ({ data: [], error: null }) }),
        upsert: async () => ({ error: null }),
      };
      if (table === "penalties") return { select: () => ({ eq: () => ({ eq: async () => ({ data: [], error: null }) }) }) };
      throw new Error(`Unexpected table in result-import hosting test: ${table}`);
    },
    rpc: async () => ({ data: null, error: null }),
  },
}));

import ResultImportWorkspace from "./ResultImportWorkspace";

const renderWorkspace = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><ResultImportWorkspace /></QueryClientProvider>);
};

const openConfirmation = async () => {
  renderWorkspace();
  fireEvent.click(screen.getByRole("button", { name: "Handmatige correctie" }));
  await screen.findByRole("option", { name: /Fun Race · Spa/ });
  const raceSelect = screen.getByLabelText("1. Kies de echte kalender-race");
  fireEvent.change(raceSelect, { target: { value: "race-a" } });
  expect(raceSelect).toHaveValue("race-a");
  fireEvent.change(screen.getByPlaceholderText("Coureurnaam"), { target: { value: "Driver A" } });
  const reviewButton = screen.getByRole("button", { name: "Bekijk definitieve live-impact" });
  await waitFor(() => expect(document.getElementById("result-import-confirmation-blocker")).toHaveTextContent("Klaar voor de impactcontrole"));
  expect(reviewButton).toBeEnabled();
  fireEvent.click(reviewButton);
  return screen.findByRole("dialog", { name: "Controleer alle live wijzigingen" });
};

describe("result-import hosting confirmation", () => {
  beforeEach(() => {
    support.state.raceCosts = [];
    support.initializeRaceCosts.mockReset();
    writes.failRaceUpdate = false;
  });

  it("shows hours, discount and a live USD/EUR preview in the final confirmation", async () => {
    await openConfirmation();

    const hours = screen.getByRole("spinbutton", { name: "Gehoste uren" });
    const discount = screen.getByRole("checkbox", { name: "25% korting toegepast" });
    const confirm = screen.getByRole("button", { name: "Resultaten opslaan en racekosten boeken" });

    expect(hours).toHaveValue(1);
    expect(discount).not.toBeChecked();
    expect(screen.getByText("$0.50")).toBeInTheDocument();
    expect(screen.getByText("€0.46")).toBeInTheDocument();
    expect(screen.getByText("0.9200")).toBeInTheDocument();

    fireEvent.change(hours, { target: { value: "2" } });
    fireEvent.click(discount);
    expect(screen.getByText("$0.75")).toBeInTheDocument();
    expect(screen.getByText("€0.69")).toBeInTheDocument();

    fireEvent.change(hours, { target: { value: "1.5" } });
    expect(screen.getByRole("alert", { name: "" })).toHaveTextContent("Vul een heel aantal uren van 1 t/m 24 in");
    expect(confirm).toBeDisabled();
  });

  it("creates one snapshotted hosting draft only after the result import succeeds", async () => {
    await openConfirmation();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Gehoste uren" }), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "25% korting toegepast" }));
    fireEvent.click(screen.getByRole("button", { name: "Resultaten opslaan en racekosten boeken" }));

    await screen.findByText(/Resultaten geïmporteerd · racehosting lokaal geboekt voor 2 uur met 25% korting/);
    expect(support.initializeRaceCosts).toHaveBeenCalledTimes(1);
    expect(support.initializeRaceCosts).toHaveBeenCalledWith([expect.objectContaining({
      raceId: "race-a",
      hostedHours: 2,
      discountApplied: true,
      exchangeRateUsdEur: 0.92,
    })]);
  });

  it("does not create race costs when the result import fails", async () => {
    writes.failRaceUpdate = true;
    await openConfirmation();
    fireEvent.click(screen.getByRole("button", { name: "Resultaten opslaan en racekosten boeken" }));

    await screen.findByText(/Import mislukt: race update failed/);
    expect(support.initializeRaceCosts).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Controleer alle live wijzigingen" })).toBeInTheDocument();
  });

  it("shows an existing immutable booking instead of editable fields on a re-import", async () => {
    support.state.raceCosts = [{
      id: "cost-a",
      raceId: "race-a",
      hostedHours: 2,
      discountApplied: true,
      sourceAmountUsd: 0.75,
      exchangeRateUsdEur: 0.91,
      amount: 0.68,
    }];

    await openConfirmation();

    expect(screen.getByText("Racehosting is al geboekt en blijft ongewijzigd.")).toBeInTheDocument();
    expect(screen.getByText(/2 uur · 25% korting · \$0\.75 · €0\.68 · koers 0\.9100/)).toBeInTheDocument();
    expect(screen.queryByRole("spinbutton", { name: "Gehoste uren" })).not.toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "Resultaten opslaan · racekosten behouden" });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await screen.findByText(/Resultaten geïmporteerd · bestaande racehosting ongewijzigd/);
    expect(support.initializeRaceCosts).not.toHaveBeenCalled();
  });
});
