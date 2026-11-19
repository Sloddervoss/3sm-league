import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PersonalPitwallPage from "@/pages/PersonalPitwallPage";
import PersonalPitwallSharePage from "@/pages/PersonalPitwallSharePage";
import type { SharedRace } from "@/features/personal-pitwall/share";

/**
 * Personal Pitwall: owner discovery/selection/share lifecycle and the public
 * read-only viewer. The shared module is mocked so these tests stay focused on
 * the browser contract (fragment URL, no persistence, fail-closed clearing).
 */

const h = vi.hoisted(() => ({
  user: { id: "user-1", email: "owner@example.test" } as { id: string; email: string } | null,
  devices: [] as Array<Record<string, unknown>>,
  detail: null as unknown,
  readSharedRace: vi.fn(),
  createPersonalShare: vi.fn(),
  revokePersonalShare: vi.fn(),
  copyText: vi.fn(async () => true),
  shareWithOs: vi.fn(async (): Promise<"shared" | "unsupported" | "cancelled"> => "shared"),
  sandboxRpc: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: h.user, loading: false, rolesLoading: false, isSuperAdmin: false }),
}));
vi.mock("@/components/Navbar", () => ({ default: () => <nav data-testid="navbar" /> }));
vi.mock("@/components/Footer", () => ({ default: () => <footer data-testid="footer" /> }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: h.sandboxRpc },
}));
vi.mock("@/features/endurance/pitwall/useTyreModel", () => ({
  useTyreModel: () => ({
    estimate: null,
    bron: "geen",
    v2Error: null,
    modelLoading: false,
    coverage: [],
    coverageError: null,
    coverageLoading: false,
  }),
}));
vi.mock("@/features/personal-pitwall/share", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/personal-pitwall/share")>();
  return {
    ...actual,
    listMyPitwallDevices: vi.fn(async () => ({ devices: h.devices })),
    loadOwnerDeviceDetail: vi.fn(async () => h.detail),
    createPersonalShare: h.createPersonalShare,
    revokePersonalShare: h.revokePersonalShare,
    readSharedRace: h.readSharedRace,
    copyText: h.copyText,
    shareWithOs: h.shareWithOs,
  };
});

const nowIso = new Date().toISOString();
const v3 = {
  capturedAt: nowIso,
  transportSessionId: "sess-owner-1",
  identity: {
    currentDriverName: "Vincent",
    carName: "Porsche 911 GT3 R",
    trackName: "Spa-Francorchamps",
    trackConfig: "Endurance",
  },
  session: { isInCar: true, sessionTimeSeconds: 1200, sessionTimeRemainingSeconds: 3600, sessionState: "racing", flags: [] },
  timing: { lastLapTimeSeconds: 102.4, bestLapTimeSeconds: 101.8, completedLaps: 18 },
  position: { position: 3, classPosition: 2, gapToLeaderSeconds: 12.3 },
  fuel: { fuelLitres: 55.4 },
  vehicle: {
    speedKph: 210,
    gear: "4",
    tyreDataMode: "last_available",
    temperatureUnit: "C",
    pressureUnit: "psi",
    frontLeft: { wearPercent: 88, temperature: 84, pressure: 26 },
    frontRight: { wearPercent: 86, temperature: 85, pressure: 26 },
    rearLeft: { wearPercent: 91, temperature: 80, pressure: 25 },
    rearRight: { wearPercent: 90, temperature: 81, pressure: 25 },
  },
  opponents: [
    { id: "o1", position: 1, classPosition: 1, driverName: "Leader", connected: true },
    { id: "o2", position: 3, classPosition: 2, driverName: "Vincent", connected: true, isPlayer: true },
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
    last_session_id: "sess-owner-1",
    last_sequence: 10,
    endurance_event_id: null,
    endurance_team_id: null,
    endurance_binding_source: null,
    paired_at: nowIso,
  },
  health: {
    connector_version: "0.8.0.0",
    simhub_version: "9.3",
    game_connected: true,
    telemetry_available: true,
    raw_data_available: true,
    raw_telemetry_available: true,
    session_time_read_ok: true,
    session_time_seconds: 1200,
    session_time_reader: "simhub",
    sequence: 10,
    client_last_telemetry_attempt_utc: nowIso,
    client_last_successful_ingest_utc: nowIso,
    client_last_ingest_http_status: 200,
    diagnostic_code: "ok",
    updater_state: "current",
    updater_current_version: "0.8.0.0",
    updater_target_version: null,
    last_update_result: "ok",
    last_update_utc: nowIso,
    client_reported_at_utc: nowIso,
    received_at: nowIso,
  },
  telemetry: {
    device_id: id,
    owner_user_id: "user-1",
    session_id: "sess-owner-1",
    sequence: 10,
    captured_at: nowIso,
    received_at: nowIso,
    connector_id: "connector-1",
    simhub_version: "9.3",
    game: "IRacing",
    telemetry: {},
    endurance_event_id: null,
    endurance_team_id: null,
    driver_id: "Vincent",
    current_driver_id: "Vincent",
    current_driver_name: "Vincent",
    car_id: "porsche",
    car_name: "Porsche 911 GT3 R",
    track_name: "Spa-Francorchamps",
    track_config: "Endurance",
    race_run_id: null,
    v3_normalized: v3,
  },
  endurance_event: null,
  endurance_team: null,
  diagnostic_events: [],
});

const device = (overrides: Record<string, unknown> = {}) => ({
  id: "dev-1",
  name: "Mijn PC",
  status: "active_binding",
  last_seen_at: nowIso,
  online: true,
  telemetry_received_at: nowIso,
  fresh: true,
  session_key: "sess-owner-1",
  track_name: "Spa-Francorchamps",
  track_config: "Endurance",
  driver_name: "Vincent",
  session_state: "racing",
  shareable: true,
  share_active: false,
  share_created_at: null,
  share_expires_at: null,
  ...overrides,
});

const token = "a".repeat(64);
const sharedRace = (overrides: Partial<SharedRace> = {}): SharedRace => ({
  ok: true,
  created_at: nowIso,
  expires_at: new Date(Date.now() + 3600_000).toISOString(),
  updated_at: nowIso,
  track: { name: "Spa-Francorchamps", config: "Endurance" },
  session: { driver: "Vincent", car: "Porsche 911 GT3 R", state: "racing" },
  v3: v3 as SharedRace["v3"],
  laps: [{ lap: 17, seconds: 102.1 }, { lap: 18, seconds: 102.4 }],
  pace: { fastest: 102.1, median: 102.3, count: 2 },
  ...overrides,
});

const renderPage = (node: React.ReactNode) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}><MemoryRouter>{node}</MemoryRouter></QueryClientProvider>);
};

beforeEach(() => {
  h.devices = [device()];
  h.detail = detailFor("dev-1", "Mijn PC");
  h.createPersonalShare.mockReset();
  h.revokePersonalShare.mockReset();
  h.readSharedRace.mockReset();
  h.copyText.mockClear();
  h.shareWithOs.mockClear();
  h.sandboxRpc.mockReset();
  h.sandboxRpc.mockResolvedValue({
    data: { lap_samples: [{ lap: 1, seconds: 103.2, driver: "Vincent" }], pace: { fastest: 103.2, median: 103.2, count: 1 } },
    error: null,
  });
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("personal Pitwall owner", () => {
  it("stuurt naar de vaste auth-return als er geen sessie is", async () => {
    h.user = null;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const LocationProbe = () => {
      const location = useLocation();
      return <div data-testid="auth-location">{location.pathname}{location.search}</div>;
    };
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/pitwall"]}>
          <Routes>
            <Route path="/pitwall" element={<PersonalPitwallPage />} />
            <Route path="/auth" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByTestId("auth-location")).toHaveTextContent("/auth?redirect=/pitwall/");
    h.user = { id: "user-1", email: "owner@example.test" };
  });

  it("toont zonder connector de koppelroute en geen premium dashboard", async () => {
    h.devices = [];
    renderPage(<PersonalPitwallPage />);
    expect(await screen.findByText("Nog geen connector gevonden")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /SimHub koppelen/i })).toHaveAttribute("href", "/simhub-koppelen");
    expect(screen.queryByText("Deel deze race")).not.toBeInTheDocument();
  });

  it("kiest één verse connector automatisch en toont dezelfde premiumweergave", async () => {
    renderPage(<PersonalPitwallPage />);
    expect(await screen.findByRole("heading", { name: "Deel deze race" })).toBeInTheDocument();
    expect(screen.getByText("MIJN PITWALL")).toBeInTheDocument();
    expect(screen.getAllByText(/Spa-Francorchamps/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Focus mode/i })).toBeInTheDocument();
    // No admin fleet/detail RPC: only the owner sandbox read is allowed here.
    expect(h.sandboxRpc).toHaveBeenCalledWith("pitwall_sandbox_v1", { p_device_id: "dev-1" });
    expect(h.sandboxRpc).not.toHaveBeenCalledWith("get_simhub_fleet", expect.anything());
    expect(h.sandboxRpc).not.toHaveBeenCalledWith("get_simhub_device_details", expect.anything());
  });

  it("laat bij meerdere verse connectors bewust kiezen", async () => {
    h.devices = [device(), device({ id: "dev-2", name: "Laptop", track_name: "Monza" })];
    h.detail = detailFor("dev-2", "Laptop");
    renderPage(<PersonalPitwallPage />);
    expect(await screen.findByText("Welke race bekijk je?")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Deel deze race" })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /Laptop/ })[0]);
    expect(await screen.findByRole("heading", { name: "Deel deze race" })).toBeInTheDocument();
    expect(screen.getByText("MIJN PITWALL")).toBeInTheDocument();
  });

  it("wacht eerlijk wanneer de gekoppelde connector offline is", async () => {
    h.devices = [device({ fresh: false, online: false, telemetry_received_at: null })];
    renderPage(<PersonalPitwallPage />);
    expect(await screen.findByText("Wachten op live telemetrie")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Deel deze race" })).not.toBeInTheDocument();
  });

  it("maakt een verse fragmentlink, kopieert die en wist hem bij stoppen", async () => {
    h.createPersonalShare.mockResolvedValue({
      ok: true,
      token,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      created_at: nowIso,
      session_key: "sess-owner-1",
      track_name: "Spa-Francorchamps",
      track_config: "Endurance",
    });
    h.revokePersonalShare.mockResolvedValue({ ok: true, revoked: 1 });
    renderPage(<PersonalPitwallPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Deel deze race/i }));
    const input = await screen.findByLabelText("Deelbare link") as HTMLInputElement;
    expect(input.value).toBe(`http://localhost:3000/pitwall/shared#t=${token}`);
    expect(window.location.hash).toBe("");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: /Kopiëren/i }));
    await waitFor(() => expect(h.copyText).toHaveBeenCalledWith(`http://localhost:3000/pitwall/shared#t=${token}`));
    expect(await screen.findByText("Gekopieerd")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Delen stoppen/i }));
    await waitFor(() => expect(h.revokePersonalShare).toHaveBeenCalledWith("dev-1"));
    await waitFor(() => expect(screen.queryByLabelText("Deelbare link")).not.toBeInTheDocument());
    expect(screen.getByText("niet gedeeld")).toBeInTheDocument();
  });

  it("valt bij OS-delen terug op kopiëren als de share-API ontbreekt", async () => {
    h.createPersonalShare.mockResolvedValue({
      ok: true, token, expires_at: new Date(Date.now() + 3600_000).toISOString(), created_at: nowIso,
      session_key: "sess-owner-1", track_name: "Spa-Francorchamps", track_config: "Endurance",
    });
    h.shareWithOs.mockResolvedValueOnce("unsupported");
    renderPage(<PersonalPitwallPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Deel deze race/i }));
    await screen.findByLabelText("Deelbare link");
    fireEvent.click(screen.getByRole("button", { name: /^Delen$/ }));
    await waitFor(() => expect(h.copyText).toHaveBeenCalled());
  });

  it("opent focus in dezelfde boom en houdt de deelbediening bereikbaar", async () => {
    renderPage(<PersonalPitwallPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Focus mode/i }));
    expect(await screen.findByText("Focus verlaten")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Deel deze race" })).toBeInTheDocument();
    expect(document.querySelector("[data-ptp-focus='true']")).not.toBeNull();
  });
});

describe("personal Pitwall public viewer", () => {
  it("leest de token uit de fragment-url en wist hem direct uit de adresbalk", async () => {
    window.history.replaceState(null, "", `/pitwall/shared#t=${token}`);
    h.readSharedRace.mockResolvedValue(sharedRace());
    renderPage(<PersonalPitwallSharePage />);
    expect(await screen.findByText("LIVE PITWALL")).toBeInTheDocument();
    expect(h.readSharedRace).toHaveBeenCalledWith(token);
    expect(window.location.hash).toBe("");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("toont dezelfde premiumpanelen zonder archief, pitmutatie of ruwe telemetrie", async () => {
    window.history.replaceState(null, "", `/pitwall/shared#t=${token}`);
    h.readSharedRace.mockResolvedValue(sharedRace());
    renderPage(<PersonalPitwallSharePage />);
    expect(await screen.findByText("LIVE PITWALL")).toBeInTheDocument();
    expect(screen.getAllByText(/Spa-Francorchamps/).length).toBeGreaterThan(0);
    expect(screen.queryByText("Meer analyse")).not.toBeInTheDocument();
    expect(screen.queryByText("Delen stoppen")).not.toBeInTheDocument();
    expect(screen.queryByText("Profielen")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Deel deze race/i })).not.toBeInTheDocument();
  });

  it("ondersteunt focus/fullscreen ook op de publieke pagina", async () => {
    window.history.replaceState(null, "", `/pitwall/shared#t=${token}`);
    h.readSharedRace.mockResolvedValue(sharedRace());
    renderPage(<PersonalPitwallSharePage />);
    fireEvent.click(await screen.findByRole("button", { name: /Focus mode/i }));
    expect(await screen.findByText("Focus verlaten")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Volledig scherm/i })).toBeInTheDocument();
    expect(screen.queryByText("Profielen")).not.toBeInTheDocument();
  });

  it("wist de race zichtbaar zodra de volgende poll zegt dat delen gestopt is", async () => {
    window.history.replaceState(null, "", `/pitwall/shared#t=${token}`);
    h.readSharedRace
      .mockResolvedValueOnce(sharedRace())
      .mockResolvedValue({ ok: false, code: "ended" });
    renderPage(<PersonalPitwallSharePage />);
    expect(await screen.findByText("LIVE PITWALL")).toBeInTheDocument();
    const callsAfterLive = h.readSharedRace.mock.calls.length;

    // A hidden tab does not fetch; returning to the tab fetches immediately.
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.readSharedRace.mock.calls.length).toBe(callsAfterLive);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(await screen.findByText("Delen gestopt")).toBeInTheDocument();
    expect(screen.queryByText(/Spa-Francorchamps/)).not.toBeInTheDocument();
    expect(screen.queryByText("LIVE PITWALL")).not.toBeInTheDocument();
  });

  it("wist data bij een netwerkfout en biedt opnieuw proberen", async () => {
    window.history.replaceState(null, "", `/pitwall/shared#t=${token}`);
    h.readSharedRace
      .mockResolvedValueOnce(sharedRace())
      .mockRejectedValue(new Error("netwerk"));
    renderPage(<PersonalPitwallSharePage />);
    expect(await screen.findByText("LIVE PITWALL")).toBeInTheDocument();
    document.dispatchEvent(new Event("visibilitychange"));
    expect(await screen.findByText("Verbinding verbroken")).toBeInTheDocument();
    expect(screen.queryByText(/Spa-Francorchamps/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Opnieuw proberen/i })).toBeInTheDocument();
  });

  it("weigert een ontbrekende of ongeldige fragmenttoken zonder RPC", () => {
    window.history.replaceState(null, "", "/pitwall/shared");
    renderPage(<PersonalPitwallSharePage />);
    expect(screen.getByText("Deze link is ongeldig")).toBeInTheDocument();
    expect(h.readSharedRace).not.toHaveBeenCalled();
  });
});
