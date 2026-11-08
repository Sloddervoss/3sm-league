import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Integratietest van de keten die eerder stil stuk was: RPC-antwoord → hook →
 * melding. De helper- en componenttests waren groen terwijl `context` nooit uit
 * de hook kwam, dus op het scherm verscheen niets. Deze test mockt alleen de
 * repository (het netwerk) en gebruikt de echte hook en de echte helper.
 */
const fetchPitwallData = vi.fn();
vi.mock("@/features/endurance/repository/pitwallRepository", () => ({
  fetchPitwallData: (...args: unknown[]) => fetchPitwallData(...args),
}));

import { pitwallContextNotice } from "@/features/endurance/pitwall/pitwallHelpers";
import { usePitwallData } from "@/features/endurance/pitwall/usePitwallData";

const Harness = () => {
  const real = usePitwallData("evt-1", "team-1", "actor-1");
  const notice = pitwallContextNotice(real.context);
  return <span data-testid="melding">{notice ? notice.message : "geen"}</span>;
};

const renderHarness = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
};

const antwoord = (context: unknown) => ({
  team: { id: "team-1", name: "Team 1" },
  telemetry: null,
  strategy: null,
  timeline: [],
  planned_stints: [],
  v3_normalized: null,
  context,
});

describe("pitwall-contextketen", () => {
  beforeEach(() => {
    fetchPitwallData.mockReset();
  });

  it("toont de melding wanneer de server geen gekoppelde race ziet", async () => {
    fetchPitwallData.mockResolvedValue(
      antwoord({ status: "unlinked_telemetry", view: "none", event_status: "completed" }),
    );
    renderHarness();
    await waitFor(() =>
      expect(screen.getByTestId("melding").textContent).toBe(
        "Dit apparaat is nog niet aan een race gekoppeld.",
      ),
    );
  });

  it("zwijgt wanneer de race wel gekoppeld en actueel is", async () => {
    fetchPitwallData.mockResolvedValue(antwoord({ status: "live", view: "live" }));
    renderHarness();
    await waitFor(() => expect(fetchPitwallData).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId("melding").textContent).toBe("geen"));
  });

  it("geeft een ontbrekend contextblok niet door als melding", async () => {
    fetchPitwallData.mockResolvedValue(antwoord(undefined));
    renderHarness();
    await waitFor(() => expect(fetchPitwallData).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId("melding").textContent).toBe("geen"));
  });
});
