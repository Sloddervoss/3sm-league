import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";

const refetch = vi.fn(async () => undefined);
const channel = {
  on: vi.fn(),
  subscribe: vi.fn(),
};
channel.on.mockReturnValue(channel);
channel.subscribe.mockImplementation((handler: (status: string) => void) => {
  handler("SUBSCRIBED");
  return channel;
});

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: [{
      id: "11111111-1111-4111-8111-111111111111",
      device_name: "SIM-PC",
      connector_id: "SIM-PC",
      paired_at: "2026-07-16T19:00:00.000Z",
      expires_at: null,
      last_seen_at: null,
      revoked_at: null,
    }],
    error: null,
    isLoading: false,
    refetch,
  }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "super-admin-test" },
    loading: false,
    rolesLoading: false,
    isSuperAdmin: true,
  }),
}));

vi.mock("@/components/Navbar", () => ({ default: () => <div>Navbar</div> }));
vi.mock("@/components/Footer", () => ({ default: () => <div>Footer</div> }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: vi.fn(() => channel),
    removeChannel: vi.fn(async () => undefined),
  },
}));

vi.mock("@/lib/centralSimHubRelay", () => ({
  createCentralSimHubPairingCode: vi.fn(),
  listCentralSimHubDevices: vi.fn(),
  readCentralSimHubTelemetry: vi.fn(async () => null),
  revokeCentralSimHubDevice: vi.fn(),
  centralRowToBridgeResponse: vi.fn(),
}));

import SimHubPairingPage from "@/pages/SimHubPairingPage";

describe("SimHub device-only pairing page", () => {
  it("renders the Super-admin connection-test flow without race or team selectors", async () => {
    render(<MemoryRouter><SimHubPairingPage /></MemoryRouter>);

    expect(screen.getByRole("heading", { name: "Nieuwe installatie koppelen" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Koppeling testen" })).toBeInTheDocument();
    expect(screen.getByText(/Er wordt nog geen race of team gekozen/)).toBeInTheDocument();
    expect(screen.getByText(/pas later in de Endurance-tab toegewezen/)).toBeInTheDocument();
    expect(screen.getByText("SIM-PC")).toBeInTheDocument();
    expect(screen.getByText(/geldig tot intrekken/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Connection-test" })).toBeInTheDocument();
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /race kiezen/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /team kiezen/i })).not.toBeInTheDocument();

    await waitFor(() => expect(channel.subscribe).toHaveBeenCalled());
  });
});
