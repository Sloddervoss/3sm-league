import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { PitwallTab } from "@/features/endurance/pitwall/PitwallTab";
import { fetchPitwallData } from "@/features/endurance/repository/pitwallRepository";
import type { EnduranceEvent } from "@/features/endurance/core/types";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isSuperAdmin: true }) }));
vi.mock("@/features/endurance/core/ActorContext", () => ({ useEnduranceActor: () => ({ actorId: "admin", displayName: (id: string) => id }) }));
vi.mock("@/features/endurance/repository/pitwallRepository", () => ({
  listPitwallTeams: vi.fn(async () => [{ id: "a", name: "Team A" }, { id: "b", name: "Team B" }]),
  fetchPitwallData: vi.fn(async () => ({ telemetry: null, strategy: null })),
}));
const Location = () => <output data-testid="location">{useLocation().search}</output>;

it("loads staff teams, switches team and keeps focus navigation in the router", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/endurance/races/race"]}>
    <Location /><PitwallTab event={{ id: "race", name: "Race" } as EnduranceEvent} />
  </MemoryRouter></QueryClientProvider>);
  await screen.findByRole("button", { name: "Team B" });
  await waitFor(() => expect(fetchPitwallData).toHaveBeenCalledWith("race", "a"));
  fireEvent.click(screen.getByRole("button", { name: "Team B" }));
  await waitFor(() => expect(fetchPitwallData).toHaveBeenCalledWith("race", "b"));
  fireEvent.click(screen.getByRole("button", { name: "Focus mode" }));
  expect(screen.getByTestId("location")).toHaveTextContent("pitwallFocus=1");
  expect(screen.getAllByText("OFFLINE").length).toBeGreaterThan(0);
  expect(screen.queryByText("LIVE", { exact: true })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Focus verlaten" }));
  expect(screen.getByTestId("location").textContent).toBe("");
  view.unmount(); client.clear();
});
