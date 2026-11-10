import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PitwallDeviceTestPage from "@/pages/PitwallDeviceTestPage";

/**
 * Route-isolatie en bediening van de premium testweergave. De klassieke
 * weergave moet exact hetzelfde blijven; de nieuwe weergave is alleen op deze
 * testroute de standaard en kent een blijvende lokale keuze plus URL-noodrem.
 */

vi.mock("@/components/Navbar", () => ({ default: () => <nav data-testid="navbar" /> }));
vi.mock("@/components/Footer", () => ({ default: () => <footer data-testid="footer" /> }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" }, isSuperAdmin: true, loading: false, rolesLoading: false }),
}));

const nowIso = new Date().toISOString();

const v3 = {
  capturedAt: nowIso,
  identity: {
    currentDriverName: "Vincent",
    carName: "Porsche 911 GT3 R",
    trackName: "Fuji GP",
    trackConfig: "Grand Prix",
  },
  session: { isInCar: true, sessionTimeRemainingSeconds: 4200, sessionTimeSeconds: 1800 },
  timing: { lastLapTimeSeconds: 102.4, bestLapTimeSeconds: 101.8, completedLaps: 18 },
  position: { position: 3, classPosition: 3, gapToLeaderSeconds: 12.3 },
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
  fuel: { fuelLitres: 55.4 },
  opponents: [
    { id: "p1", position: 1, classPosition: 1, carClass: "GT3", carNumber: "11", driverName: "A. Leader", teamName: "Apex", lastLapSeconds: 101.2, bestLapSeconds: 100.9, gapToPlayerSeconds: -12.3, connected: true },
    { id: "p2", position: 2, classPosition: 2, carClass: "GT3", carNumber: "12", driverName: "B. Chase", teamName: "Chase Racing", lastLapSeconds: 101.8, bestLapSeconds: 101.4, gapToPlayerSeconds: -4.2, connected: true },
    { id: "me", position: 3, classPosition: 3, carClass: "GT3", carNumber: "17", driverName: "Vincent", teamName: "3SM Endurance", lastLapSeconds: 102.4, bestLapSeconds: 101.8, gapToPlayerSeconds: 0, connected: true, isPlayer: true },
  ],
};

const detailFor = (id: string, name: string) => ({
  device: {
    id,
    device_name: name,
    device_status: "active_binding",
    device_role: "primary",
    revoked_at: null,
    last_seen_at: nowIso,
    last_session_id: "s1",
    last_sequence: 9,
    endurance_event_id: null,
    endurance_team_id: null,
    endurance_binding_source: null,
    paired_at: nowIso,
  },
  health: {
    connector_version: "0.7.6.1",
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
    updater_current_version: "0.7.6.1",
    updater_target_version: null,
    last_update_result: "ok",
    last_update_utc: nowIso,
    client_reported_at_utc: nowIso,
    received_at: nowIso,
  },
  telemetry: {
    device_id: id,
    owner_user_id: "user-1",
    session_id: `session-${id}`,
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
    track_name: "Fuji GP",
    track_config: "Grand Prix",
    race_run_id: null,
    v3_normalized: v3,
  },
  endurance_event: null,
  endurance_team: null,
  diagnostic_events: [],
});

const fleetRow = (id: string, name: string, online = true) => ({
  device_id: id,
  device_name: name,
  device_status: "active_binding",
  device_role: "primary",
  revoked_at: null,
  last_seen_at: nowIso,
  endurance_event_id: null,
  endurance_team_id: null,
  endurance_binding_source: null,
  endurance_event_name: null,
  endurance_team_name: null,
  connector_version: "0.7.6.1",
  simhub_version: "9.0",
  game_connected: online,
  telemetry_available: online,
  diagnostic_code: "ok",
  health_received_at: online ? nowIso : "2026-01-01T00:00:00.000Z",
  updater_state: "current",
  updater_current_version: "0.7.6.1",
  updater_target_version: null,
  last_update_result: "ok",
  last_update_utc: nowIso,
  telemetry_received_at: online ? nowIso : null,
  telemetry_game: online ? "iRacing" : null,
  telemetry_car_name: online ? "Porsche 911 GT3 R" : null,
  telemetry_track_name: online ? "Fuji GP" : null,
  telemetry_driver_name: online ? "Vincent" : null,
});

const fleet = [fleetRow("device-1", "DESKTOP-GR4NN00"), fleetRow("device-2", "BEEST", false)];
const details: Record<string, ReturnType<typeof detailFor>> = {
  "device-1": detailFor("device-1", "DESKTOP-GR4NN00"),
  "device-2": detailFor("device-2", "BEEST"),
};

const calls = vi.fn();
const rpc = vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
  calls(fn, args);
  if (fn === "get_simhub_fleet") return { data: fleet, error: null };
  if (fn === "get_simhub_device_details") {
    const id = String(args.p_device_id ?? "");
    return { data: details[id] ?? details["device-1"], error: null };
  }
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
  if (fn === "get_pitwall_tyre_stops") {
    return { data: { sessionKey: "session-device-1", stops: [] }, error: null };
  }
  if (fn === "tyre_coverage") return { data: [], error: null };
  if (fn === "pitwall_tyre_estimate_v2") return { data: null, error: { code: "PGRST202", message: "niet beschikbaar" } };
  if (fn === "pitwall_tyre_estimate_v1") return { data: null, error: { code: "PGRST202", message: "niet beschikbaar" } };
  return { data: null, error: { code: "PGRST202", message: "niet beschikbaar in deze test" } };
});

const channel = { on: () => channel, subscribe: () => channel };

vi.mock("@/integrations/supabase/client", () => {
  const client = {
    // Echte Supabase-clientmethoden leven op het prototype en verliezen `this`
    // zodra je ze losknipt. Deze mock doet hetzelfde, zodat de route-tests een
    // gedetacheerde `rpc` hard laten falen in plaats van hem te verbergen.
    rpc(this: unknown, ...args: unknown[]) {
      if (this !== client) throw new TypeError("supabase.rpc must be called with the client as receiver");
      return rpc(...(args as [string, Record<string, unknown>]));
    },
    channel: () => channel,
    removeChannel: () => undefined,
  };
  return { supabase: client };
});

const renderPage = async (entry = "/admin/pitwall-test") => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <PitwallDeviceTestPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const device = await screen.findByRole("button", { name: /DESKTOP-GR4NN00/ });
  fireEvent.click(device);
  return { view, client };
};

const chooseClassic = async (view: ReturnType<typeof render>) => {
  const device = await screen.findByRole("button", { name: /DESKTOP-GR4NN00/ });
  fireEvent.click(device);
  await waitFor(() => expect(view.container.querySelector('[data-pitwall-look="true"]')).not.toBeNull());
};

const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  localStorage.clear();
  calls.mockClear();
  window.matchMedia = originalMatchMedia;
});

afterEach(() => {
  localStorage.clear();
  window.matchMedia = originalMatchMedia;
  vi.clearAllMocks();
});

const premiumShell = (view: ReturnType<typeof render>) => view.container.querySelector(".ptp-root");

describe("pitwall-test premium — alleen op de testroute, klassiek blijft klassiek", () => {
  it("opent standaard de nieuwe weergave met dock, timing, vier panelen, pitstops en bandenmodel", async () => {
    const { view } = await renderPage();

    await waitFor(() => expect(premiumShell(view)).not.toBeNull());
    expect(screen.queryByText("Pitwall Test — live device data")).toBeNull();
    expect(screen.getByText(/Gekoppelde profielen/)).toBeTruthy();
    expect(view.container.querySelector(".ptp-dock")?.textContent).toContain("BEEST");
    expect(view.container.querySelector("[data-premium-timing]")).not.toBeNull();
    expect(view.container.querySelectorAll("[data-premium-timing] tbody tr[data-timing-row-id]").length).toBe(3);

    const slots = ["standings", "pace", "my-session", "fuel", "tyres", "trackmap", "tyrestop"];
    expect(slots.filter((slot) => !view.container.querySelector(`[data-pitwall-slot="${slot}"]`))).toEqual([]);
    expect(view.container.querySelector("[data-pitwall-tyre-model]")).not.toBeNull();
    expect(view.container.querySelector("[data-pitwall-tyre-range]")).not.toBeNull();
    expect(view.container.textContent).toContain("Zo ziet de vraag eruit");
    expect(screen.getByText("Mijn sessie")).toBeTruthy();
    // De pitbevestiging schrijft echte antwoorden; "read-only" zou liegen.
    expect(view.container.textContent).toContain("LIVE TELEMETRIE · 1s polling");
    expect(view.container.textContent).not.toContain("READ-ONLY");
    expect(view.container.textContent).not.toContain("niets opgeslagen");
  });

  it("haalt fleet, device-detail en sandbox met de gebonden client op", async () => {
    await renderPage();

    await waitFor(() => {
      expect(calls.mock.calls.some(([fn]) => fn === "get_simhub_fleet")).toBe(true);
      expect(calls).toHaveBeenCalledWith("get_simhub_device_details", { p_device_id: "device-1" });
      expect(calls).toHaveBeenCalledWith("pitwall_sandbox_v1", { p_device_id: "device-1" });
    });
  });

  it("blijft showExample in de pitbevestiging echt bedienbaar", async () => {
    await renderPage();
    const button = await screen.findByRole("button", { name: "Banden gewisseld" });
    fireEvent.click(button);
    expect(await screen.findByText(/Voorbeeld — “Banden gewisseld” is niet opgeslagen/)).toBeTruthy();
  });

  it("blijft via ?pitwallView=classic exact de klassieke weergave tonen", async () => {
    const { view } = await renderPage("/admin/pitwall-test?pitwallView=classic");
    await chooseClassic(view);

    expect(premiumShell(view)).toBeNull();
    expect(view.container.querySelector('[data-pitwall-look="true"]')).not.toBeNull();
    expect(view.container.querySelector("[data-premium-timing]")).toBeNull();
    expect(screen.getByText("Pitwall Test — live device data")).toBeTruthy();
    // De terugschakelaar moet onder de vaste 64px-navbar bereikbaar blijven.
    expect(view.container.querySelector("[data-pitwall-test-controls]")).toHaveStyle({ marginTop: "64px" });
    expect(screen.getByText("Gekoppelde SimHub profielen")).toBeTruthy();
    expect(view.container.querySelector("[data-pitwall-slot='standings']")).not.toBeNull();
  });

  it("wisselt met de knoppen en onthoudt de keuze lokaal", async () => {
    const first = await renderPage();
    await waitFor(() => expect(premiumShell(first.view)).not.toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Klassiek" }));
    await waitFor(() => expect(premiumShell(first.view)).toBeNull());
    expect(first.view.container.querySelector('[data-pitwall-look="true"]')).not.toBeNull();
    expect(localStorage.getItem("3sm.pitwall-test.view.v1")).toBe("classic");

    first.view.unmount();

    const second = await renderPage();
    await chooseClassic(second.view);
    expect(premiumShell(second.view)).toBeNull();
    expect(screen.getByText("Pitwall Test — live device data")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Nieuw" }));
    await waitFor(() => expect(premiumShell(second.view)).not.toBeNull());
    expect(localStorage.getItem("3sm.pitwall-test.view.v1")).toBe("premium");
  });

  it("laat een URL-override zien en heft hem op bij een bewuste klik", async () => {
    localStorage.setItem("3sm.pitwall-test.view.v1", "premium");
    const { view } = await renderPage("/admin/pitwall-test?pitwallView=classic");
    await chooseClassic(view);
    expect(screen.getByText(/URL-override actief/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Nieuw" }));
    await waitFor(() => expect(premiumShell(view)).not.toBeNull());
    expect(screen.queryByText(/URL-override actief/)).toBeNull();
    expect(localStorage.getItem("3sm.pitwall-test.view.v1")).toBe("premium");
  });

  it("houdt de bewegingkeuze lokaal en respecteert prefers-reduced-motion", async () => {
    const first = await renderPage();
    await waitFor(() => expect(premiumShell(first.view)).not.toBeNull());
    const motion = screen.getByRole("button", { name: "Beweging" });
    expect(motion).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(motion);
    await waitFor(() => expect(motion).toHaveAttribute("aria-pressed", "false"));
    expect(localStorage.getItem("3sm.pitwall-test.motion.v1")).toBe("off");
    expect(premiumShell(first.view)?.getAttribute("data-motion")).toBe("off");
    first.view.unmount();

    localStorage.removeItem("3sm.pitwall-test.motion.v1");

    window.matchMedia = ((query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;

    const reduced = await renderPage();
    await waitFor(() => expect(premiumShell(reduced.view)).not.toBeNull());
    const reducedMotion = screen.getByRole("button", { name: "Beweging" });
    expect(reducedMotion).toHaveAttribute("aria-pressed", "false");
    expect(reducedMotion).toBeDisabled();
    expect(premiumShell(reduced.view)?.getAttribute("data-motion")).toBe("off");
  });

  it("laat de apparaatdock een ander echt profiel kiezen", async () => {
    const { view } = await renderPage();
    await waitFor(() => expect(premiumShell(view)).not.toBeNull());
    expect(view.container.querySelector(".ptp-mast-title h1")?.textContent).toBe("DESKTOP-GR4NN00");

    fireEvent.click(within(view.container.querySelector(".ptp-dock") as HTMLElement).getByRole("button", { name: /BEEST/ }));
    await waitFor(() => expect(view.container.querySelector(".ptp-mast-title h1")?.textContent).toBe("BEEST"));
    expect(calls).toHaveBeenCalledWith("get_simhub_device_details", { p_device_id: "device-2" });
  });
});

describe("pitwall-test — geen klassieke regressie in dezelfde run", () => {
  it("houdt de klassieke DOM en dezelfde autorisatie/queries beschikbaar", async () => {
    const { view } = await renderPage("/admin/pitwall-test?pitwallView=classic");
    await chooseClassic(view);
    expect(view.container.querySelector("[data-pitwall-test-premium]")).toBeNull();
    expect(view.container.querySelector('[data-pitwall-slot="trackmap"]')).not.toBeNull();
    expect(view.container.querySelector('[data-pitwall-slot="my-session"]')).not.toBeNull();
    expect(calls.mock.calls.some(([fn]) => fn === "get_simhub_fleet")).toBe(true);
    expect(calls).toHaveBeenCalledWith("get_simhub_device_details", { p_device_id: "device-1" });
    expect(calls).toHaveBeenCalledWith("pitwall_sandbox_v1", { p_device_id: "device-1" });
  });
});
