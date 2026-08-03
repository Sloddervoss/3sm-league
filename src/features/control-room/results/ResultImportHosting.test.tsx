import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const support = vi.hoisted(() => ({
  initializeRaceCosts: vi.fn(),
  saveRaceCost: vi.fn(),
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

const resultJson = JSON.stringify({
  subsession_id: 123456,
  session_results: [{
    simsession_type: 6,
    simsession_type_name: "Race",
    results: [{
      finish_position: 0,
      display_name: "Driver A",
      cust_id: 123,
      laps_complete: 10,
      best_lap_time: 743210,
      incidents: 0,
    }],
  }],
});

vi.mock("@/features/community-support/store", () => ({
  useCommunitySupport: () => ({
    state: support.state,
    initializeRaceCosts: support.initializeRaceCosts,
    saveRaceCost: support.saveRaceCost,
  }),
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
      if (table === "race_session_results") return {
        delete: () => ({ eq: async () => ({ error: null }) }),
        insert: async () => ({ error: null }),
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

const selectRace = async () => {
  await screen.findByRole("option", { name: /Fun Race · Spa/ });
  fireEvent.change(screen.getByLabelText("1. Kies de echte kalender-race"), { target: { value: "race-a" } });
};

const prepareJsonImport = async () => {
  const view = renderWorkspace();
  await selectRace();
  const fileInput = view.container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(fileInput, { target: { files: [new File([resultJson], "result.json", { type: "application/json" })] } });
  await screen.findByText(/result\.json · 1 race-regels/);
  await waitFor(() => expect(screen.getByText("Klaar voor de impactcontrole. Er wordt nog niets geschreven totdat je in het volgende scherm bevestigt.")).toBeInTheDocument());
};

const openConfirmation = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Bekijk definitieve live-impact" }));
  return screen.findByRole("dialog", { name: "Controleer alle live wijzigingen" });
};

describe("result-import racehosting op het uploadscherm", () => {
  beforeEach(() => {
    support.state.raceCosts = [];
    support.initializeRaceCosts.mockReset().mockResolvedValue(true);
    support.saveRaceCost.mockReset().mockResolvedValue(true);
    writes.failRaceUpdate = false;
  });

  it("toont na een JSON-upload direct bewerkbare uren, korting en de live kostenpreview", async () => {
    await prepareJsonImport();

    const hours = screen.getByRole("spinbutton", { name: "Gehoste uren" });
    const discount = screen.getByRole("radio", { name: "Ja, 25%" });
    expect(screen.getByText("3. Racehosting")).toBeInTheDocument();
    expect(screen.getByText(/Voorstel voor Fun Race op Spa: 1 uur hosting/)).toBeInTheDocument();
    expect(screen.getByText(/Het JSON-resultaat bevat geen betrouwbare factuurduur/)).toBeInTheDocument();
    expect(hours).toHaveValue(1);
    expect(discount).not.toBeChecked();
    expect(screen.getByText("$0.50")).toBeInTheDocument();
    expect(screen.getByText("€0.46")).toBeInTheDocument();
    expect(screen.getByText("€0.10")).toBeInTheDocument();
    expect(screen.getByText("€0.56")).toBeInTheDocument();

    fireEvent.change(hours, { target: { value: "25" } });
    expect(screen.getByRole("alert")).toHaveTextContent("1 t/m 24");
    expect(screen.getByRole("button", { name: "Bekijk definitieve live-impact" })).toBeDisabled();

    fireEvent.change(hours, { target: { value: "2" } });
    fireEvent.click(discount);
    expect(screen.getByText("$0.75")).toBeInTheDocument();
    expect(screen.getByText("$0.16")).toBeInTheDocument();
    expect(screen.getByText("$0.91")).toBeInTheDocument();
    expect(screen.getByText("€0.69")).toBeInTheDocument();
    expect(screen.getByText("€0.15")).toBeInTheDocument();
    expect(screen.getByText("€0.84")).toBeInTheDocument();

    const dialog = await openConfirmation();
    expect(within(dialog).queryByRole("spinbutton", { name: "Gehoste uren" })).not.toBeInTheDocument();
    expect(within(dialog).getByText(/2 uur · 25% korting · \$0\.75 \+ 21% btw \$0\.16 = \$0\.91 · daarna koers 0\.9200 · totaal €0\.84/)).toBeInTheDocument();
  });

  it("boekt een nieuwe racekost pas nadat de JSON-resultimport slaagt", async () => {
    await prepareJsonImport();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Gehoste uren" }), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("radio", { name: "Ja, 25%" }));
    await openConfirmation();
    fireEvent.click(screen.getByRole("button", { name: "Resultaten opslaan en racekosten boeken" }));

    await screen.findByText(/Resultaten geïmporteerd · racehosting gedeeld geboekt voor 2 uur met 25% korting/);
    expect(support.initializeRaceCosts).toHaveBeenCalledWith([expect.objectContaining({
      raceId: "race-a",
      hostedHours: 2,
      discountApplied: true,
      exchangeRateUsdEur: 0.92,
    })]);
    expect(support.saveRaceCost).not.toHaveBeenCalled();
  });

  it("meldt expliciet wanneer resultaten live staan maar het opslaan van racehosting faalt", async () => {
    support.initializeRaceCosts.mockResolvedValue(false);
    await prepareJsonImport();
    await openConfirmation();
    fireEvent.click(screen.getByRole("button", { name: "Resultaten opslaan en racekosten boeken" }));

    await screen.findByText("Resultaten geïmporteerd.");
    expect(screen.getByRole("alert")).toHaveTextContent("De resultaten staan live, maar de racehostingkosten konden niet worden opgeslagen");
  });

  it("laat een bestaande standaardboeking op het uploadscherm bewust corrigeren met dezelfde koerssnapshot", async () => {
    support.state.raceCosts = [{
      id: "cost-a",
      raceId: "race-a",
      raceScope: "standalone",
      raceName: "Fun Race",
      track: "Spa",
      date: "2026-08-02",
      hostedHours: 1,
      discountApplied: false,
      sourceAmountUsd: 0.5,
      exchangeRateUsdEur: 0.91,
      amount: 0.46,
      isPublic: false,
      note: "Bestaande factuurnotitie",
    }];
    await prepareJsonImport();

    const hours = screen.getByRole("spinbutton", { name: "Gehoste uren" });
    expect(hours).toHaveValue(1);
    expect(screen.getByText(/Bestaande boeking geladen/)).toBeInTheDocument();
    expect(screen.getByText("0.9100")).toBeInTheDocument();
    fireEvent.change(hours, { target: { value: "2" } });
    fireEvent.click(screen.getByRole("radio", { name: "Ja, 25%" }));
    expect(screen.getByText("€0.68")).toBeInTheDocument();

    await openConfirmation();
    expect(screen.getByText(/Racehosting wordt aangepast/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Resultaten opslaan · racekosten aanpassen" }));

    await screen.findByText(/Resultaten geïmporteerd · racehosting aangepast naar 2 uur met 25% korting/);
    expect(support.saveRaceCost).toHaveBeenCalledWith(expect.objectContaining({
      raceId: "race-a",
      hostedHours: 2,
      discountApplied: true,
      exchangeRateUsdEur: 0.91,
      isPublic: false,
      note: "Bestaande factuurnotitie",
    }));
    expect(support.initializeRaceCosts).not.toHaveBeenCalled();
  });

  it("laat een bestaande ongewijzigde boeking ongemoeid", async () => {
    support.state.raceCosts = [{
      id: "cost-a",
      raceId: "race-a",
      raceScope: "standalone",
      raceName: "Fun Race",
      track: "Spa",
      date: "2026-08-02",
      hostedHours: 1,
      discountApplied: false,
      sourceAmountUsd: 0.5,
      exchangeRateUsdEur: 0.91,
      amount: 0.46,
      isPublic: true,
    }];
    await prepareJsonImport();
    await openConfirmation();
    expect(screen.getByText(/Racehosting blijft gelijk/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Resultaten opslaan · racekosten behouden" }));

    await screen.findByText(/Resultaten geïmporteerd · bestaande racehosting ongewijzigd/);
    expect(support.initializeRaceCosts).not.toHaveBeenCalled();
    expect(support.saveRaceCost).not.toHaveBeenCalled();
  });

  it("wijzigt geen racekosten wanneer de JSON-resultimport faalt", async () => {
    support.state.raceCosts = [{
      id: "cost-a",
      raceId: "race-a",
      raceScope: "standalone",
      raceName: "Fun Race",
      track: "Spa",
      date: "2026-08-02",
      hostedHours: 1,
      discountApplied: false,
      sourceAmountUsd: 0.5,
      exchangeRateUsdEur: 0.91,
      amount: 0.46,
      isPublic: true,
    }];
    writes.failRaceUpdate = true;
    await prepareJsonImport();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Gehoste uren" }), { target: { value: "2" } });
    await openConfirmation();
    fireEvent.click(screen.getByRole("button", { name: "Resultaten opslaan · racekosten aanpassen" }));

    await screen.findByText(/Import mislukt: race update failed/);
    expect(support.initializeRaceCosts).not.toHaveBeenCalled();
    expect(support.saveRaceCost).not.toHaveBeenCalled();
  });
});
