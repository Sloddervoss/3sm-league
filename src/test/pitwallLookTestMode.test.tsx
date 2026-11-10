import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import PitwallDeviceTestPage from "@/pages/PitwallDeviceTestPage";

/**
 * De pitwall-test is de tweede modus met dezelfde look. Wat hier anders is dan
 * op de endurance-pitwall: "Mijn sessie" in plaats van "Coureur & wissel", en
 * brandstof als meting zonder strategie. De indeling is dezelfde.
 */

vi.mock("@/components/Navbar", () => ({ default: () => <nav data-testid="navbar" /> }));
vi.mock("@/components/Footer", () => ({ default: () => <footer data-testid="footer" /> }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" }, isSuperAdmin: true, loading: false, rolesLoading: false }),
}));

const nowIso = new Date().toISOString();

const v3 = {
  capturedAt: nowIso,
  identity: { currentDriverName: "Vincent", carName: "Porsche 911 GT3 R", trackName: "Circuit de Spa-Francorchamps", trackConfig: "Grand Prix" },
  session: { isInCar: true, sessionTimeRemainingSeconds: 4200 },
  timing: { lastLapTimeSeconds: 102.4, bestLapTimeSeconds: 101.8, completedLaps: 18 },
  position: { position: 4, classPosition: 2, gapToLeaderSeconds: 12.3 },
  vehicle: {
    speedKph: 210,
    rpm: 7000,
    gear: "4",
    tyreDataMode: "last_available",
    temperatureUnit: "C",
    pressureUnit: "psi",
    frontLeft: { wearPercent: 88, temperature: 84, pressure: 26 },
    frontRight: { wearPercent: 86, temperature: 85, pressure: 26 },
    rearLeft: { wearPercent: 91, temperature: 80, pressure: 25 },
    rearRight: { wearPercent: 90, temperature: 81, pressure: 25 },
  },
  opponents: [],
  fuel: { fuelLitres: 55.4 },
};

const detail = {
  device: { id: "device-1", device_name: "SIM-PC Vincent", device_status: "active_binding", device_role: "primary", revoked_at: null, last_seen_at: nowIso, last_session_id: "s1", last_sequence: 9, endurance_event_id: null, endurance_team_id: null, endurance_binding_source: null, paired_at: nowIso },
  health: {
    connector_version: "0.7.2.1",
    simhub_version: "9.0",
    game_connected: true,
    telemetry_available: true,
    raw_data_available: true,
    raw_telemetry_available: true,
    session_time_read_ok: true,
    session_time_seconds: 1,
    session_time_reader: "simhub",
    sequence: 9,
    client_last_telemetry_attempt_utc: nowIso,
    client_last_successful_ingest_utc: nowIso,
    client_last_ingest_http_status: 200,
    diagnostic_code: "ok",
    updater_state: "current",
    updater_current_version: "0.7.2.1",
    updater_target_version: null,
    last_update_result: "ok",
    last_update_utc: nowIso,
    client_reported_at_utc: nowIso,
    received_at: nowIso,
  },
  telemetry: {
    device_id: "device-1",
    owner_user_id: "user-1",
    session_id: "s1",
    sequence: 9,
    captured_at: nowIso,
    received_at: nowIso,
    connector_id: "connector-1",
    simhub_version: "9.0",
    game: "iRacing",
    telemetry: {},
    endurance_event_id: null,
    endurance_team_id: null,
    driver_id: "Vincent",
    current_driver_id: "Vincent",
    current_driver_name: "Vincent",
    car_id: "porsche",
    car_name: "Porsche 911 GT3 R",
    track_name: "Circuit de Spa-Francorchamps",
    track_config: "Grand Prix",
    race_run_id: null,
    v3_normalized: v3,
  },
  endurance_event: null,
  endurance_team: null,
  diagnostic_events: [],
};

const fleetRow = {
  device_id: "device-1",
  device_name: "SIM-PC Vincent",
  device_status: "active_binding",
  device_role: "primary",
  revoked_at: null,
  last_seen_at: nowIso,
  endurance_event_id: null,
  endurance_team_id: null,
  endurance_binding_source: null,
  endurance_event_name: null,
  endurance_team_name: null,
  connector_version: "0.7.2.1",
  simhub_version: "9.0",
  game_connected: true,
  telemetry_available: true,
  diagnostic_code: "ok",
  health_received_at: nowIso,
  updater_state: "current",
  updater_current_version: "0.7.2.1",
  updater_target_version: null,
  last_update_result: "ok",
  last_update_utc: nowIso,
  telemetry_received_at: nowIso,
  telemetry_game: "iRacing",
  telemetry_car_name: "Porsche 911 GT3 R",
  telemetry_track_name: "Circuit de Spa-Francorchamps",
  telemetry_driver_name: "Vincent",
};

const rpc = vi.fn(async (fn: string) => {
  if (fn === "get_simhub_fleet") return { data: [fleetRow], error: null };
  if (fn === "get_simhub_device_details") return { data: detail, error: null };
  if (fn === "pitwall_sandbox_v1") {
    return {
      data: {
        drivers: [{ name: "Vincent" }],
        lap_samples: [
          { lap: 16, seconds: 101.8, driver: "Vincent" },
          { lap: 17, seconds: 102.1, driver: "Vincent" },
          { lap: 18, seconds: 102.4, driver: "Vincent" },
        ],
        pace: { fastest: 101.8, median: 102.1, count: 3 },
      },
      error: null,
    };
  }
  return { data: null, error: { code: "PGRST202", message: "niet beschikbaar in deze test" } };
});

const channel = { on: () => channel, subscribe: () => channel };

vi.mock("@/integrations/supabase/client", () => {
  const client = {
    rpc(this: unknown, ...args: unknown[]) {
      if (this !== client) throw new TypeError("supabase.rpc must be called with the client as receiver");
      return rpc(...(args as [string]));
    },
    channel: () => channel,
    removeChannel: () => undefined,
  };
  return { supabase: client };
});

const renderPage = async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      {/* Deze suite bewaakt de klassieke look; premium heeft eigen routetests. */}
      <MemoryRouter initialEntries={["/admin/pitwall-test?pitwallView=classic"]}>
        <PitwallDeviceTestPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const device = await screen.findByRole("button", { name: /SIM-PC Vincent/ });
  fireEvent.click(device);
  await waitFor(() => expect(view.container.querySelector('[data-pitwall-look="true"]')).not.toBeNull());
  expect(view.container.querySelector(".ptp-root")).toBeNull();
  return view;
};

describe("pitwall-test — dezelfde look, eigen tweede paneel", () => {
  it("toont mijn sessie in plaats van coureur & wissel", async () => {
    const view = await renderPage();
    await waitFor(() => expect(view.container.querySelector('[data-pitwall-slot="my-session"]')).not.toBeNull());
    expect(screen.queryByText("Coureur & wissel")).toBeNull();
    expect(screen.queryByText("Mijn sessie")).not.toBeNull();
  });

  it("gebruikt hetzelfde raster: KPI-strip, circuit links, timing rechts, vier panelen", async () => {
    const view = await renderPage();
    await waitFor(() => expect(screen.getByTestId("navbar")).toBeTruthy());
    await waitFor(() => expect(view.container.querySelector('[data-pitwall-slot="pace"]')).not.toBeNull());

    expect(view.container.querySelector("[data-pitwall-kpi]")).not.toBeNull();
    for (const slot of ["trackmap", "standings", "pace", "my-session", "fuel", "tyres"]) {
      expect(view.container.querySelector(`[data-pitwall-slot="${slot}"]`)).not.toBeNull();
    }
    const html = view.container.innerHTML;
    expect(html.indexOf('data-pitwall-col="track"')).toBeLessThan(html.indexOf('data-pitwall-col="timing"'));
  });

  it("toont de tankinhoud als meting en geen verzonnen strategie", async () => {
    const view = await renderPage();
    await waitFor(() => expect(view.container.querySelector('[data-pitwall-slot="fuel"]')).not.toBeNull());
    const fuel = view.container.querySelector('[data-pitwall-slot="fuel"]') as HTMLElement;
    expect(fuel.textContent).toContain("55.4L");
    expect(fuel.textContent).toContain("Alleen tankinhoud");
    expect(fuel.textContent).not.toContain("L/ronde");
  });

  it("toont de rondes van dit apparaat in het pace-paneel", async () => {
    const view = await renderPage();
    await waitFor(() => expect(view.container.querySelector("[data-pitwall-pace-graph]")).not.toBeNull());
    const session = view.container.querySelector('[data-pitwall-slot="my-session"]') as HTMLElement;
    expect(session.textContent).toContain("3");
  });
});
