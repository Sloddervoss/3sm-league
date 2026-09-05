import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import SimHubConnectorsModule from "@/features/control-room/connectors/SimHubConnectorsModule";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "admin" }, isSuperAdmin: true }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn(async () => ({ error: null, data: [{
  device_id: "device", device_name: "BEEST", device_status: "inactive", revoked_at: null,
  health_received_at: new Date().toISOString(), last_seen_at: null, telemetry_received_at: null,
  endurance_event_id: null, endurance_event_name: null, diagnostic_code: "OK", game_connected: false,
  connector_version: "0.4.1.0", updater_state: "IDLE", last_update_result: "none",
}] })) } }));

it("shows account pairing separately from an absent race assignment", async () => {
  const client = new QueryClient();
  const view = render(<QueryClientProvider client={client}><SimHubConnectorsModule /></QueryClientProvider>);
  await screen.findByText("BEEST");
  expect(screen.getByText("Site gekoppeld")).toBeVisible();
  expect(screen.getByText("Geen racetoewijzing")).toBeVisible();
  expect(screen.queryByText("Niet gekoppeld", { exact: true })).not.toBeInTheDocument();
  view.unmount(); client.clear();
});
