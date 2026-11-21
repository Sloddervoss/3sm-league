import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PersonalPitwallPage from "@/pages/PersonalPitwallPage";
import PitwallDeviceTestPage from "@/pages/PitwallDeviceTestPage";
import type { PersonalPitFeed } from "@/features/personal-pitwall/pitVisits";

/**
 * Blijvende pariteit tussen Mijn Pitwall en /admin/pitwall-test voor de
 * laatste stop.
 *
 * Beide routes gebruiken hetzelfde `PitDurationPanel`, dezelfde copy en
 * dezelfde server-RPC. Het verschil is uitsluitend de lezer: owner op de
 * persoonlijke pagina, beheerder op een niet-eigen device in de testpagina.
 * Deze test vergelijkt de echte route-uitvoer, niet een losse componenteigen
 * kopie. Hij dekt: geselecteerd niet-eigen device als admin, lege sessie,
 * devicewissel zonder oude stop en de expliciete foutmelding.
 */

const h = vi.hoisted(() => ({
  user: { id: "user-1", email: "owner@example.test" },
  ownerDevice: null as Record<string, unknown> | null,
  ownerDetail: null as unknown,
  adminDevices: [] as Array<Record<string, unknown>>,
  adminDetails: {} as Record<string, unknown>,
  feeds: {} as Record<string, PersonalPitFeed | Promise<PersonalPitFeed> | { error: string }>,
  rpc: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: h.user, isSuperAdmin: true, loading: false, rolesLoading: false }),
}));
vi.mock("@/components/Navbar", () => ({ default: () => <nav data-testid="navbar" /> }));
vi.mock("@/components/Footer", () => ({ default: () => <footer data-testid="footer" /> }));
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
    listMyPitwallDevices: vi.fn(async () => ({ devices: h.ownerDevice ? [h.ownerDevice] : [] })),
    loadOwnerDeviceDetail: vi.fn(async () => h.ownerDetail),
  };
});

const channel = { on: () => channel, subscribe: () => channel };
vi.mock("@/integrations/supabase/client", () => {
  const client = {
    rpc(this: unknown, ...args: unknown[]) {
      if (this !== client) throw new TypeError("supabase.rpc must be called with the client as receiver");
      return h.rpc(...(args as [string, Record<string, unknown>]));
    },
    channel: () => channel,
    removeChannel: () => undefined,
  };
  return { supabase: client };
});

const nowIso = new Date().toISOString();

const v3 = {
  capturedAt: nowIso,
  transportSessionId: "sim-owner-1",
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

const detailFor = (id: string, name: string, owner = "user-1") => ({
  device: {
    id,
    device_name: name,
    device_status: "active_binding",
    device_role: "primary",
    revoked_at: null,
    last_seen_at: nowIso,
    last_session_id: `session-${id}`,
    last_sequence: 10,
    endurance_event_id: null,
    endurance_team_id: null,
    endurance_binding_source: null,
    paired_at: nowIso,
  },
  health: {
    connector_version: "0.7.6.5",
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
    updater_current_version: "0.7.6.5",
    updater_target_version: null,
    last_update_result: "ok",
    last_update_utc: nowIso,
    client_reported_at_utc: nowIso,
    received_at: nowIso,
  },
  telemetry: {
    device_id: id,
    owner_user_id: owner,
    session_id: `session-${id}`,
    sequence: 10,
    captured_at: nowIso,
    received_at: nowIso,
    connector_id: "connector-1",
    simhub_version: "9.3",
    game: "iRacing",
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

const ownerDevice = () => ({
  id: "device-owner",
  name: "MIJN-PC",
  status: "active_binding",
  last_seen_at: nowIso,
  online: true,
  telemetry_received_at: nowIso,
  fresh: true,
  session_key: "sim-owner-1",
  track_name: "Spa-Francorchamps",
  track_config: "Endurance",
  driver_name: "Vincent",
  session_state: "racing",
  shareable: true,
  share_active: false,
  share_created_at: null,
  share_expires_at: null,
});

const adminDevice = (id: string, name: string) => ({
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
  connector_version: "0.7.6.5",
  simhub_version: "9.3",
  game_connected: true,
  telemetry_available: true,
  diagnostic_code: "ok",
  health_received_at: nowIso,
  updater_state: "current",
  updater_current_version: "0.7.6.5",
  updater_target_version: null,
  last_update_result: "ok",
  last_update_utc: nowIso,
  telemetry_received_at: nowIso,
  telemetry_game: "iRacing",
  telemetry_car_name: "Porsche 911 GT3 R",
  telemetry_track_name: "Spa-Francorchamps",
  telemetry_driver_name: "Vincent",
});

const visitFeed = (seconds: number, visitKey: string): PersonalPitFeed => ({
  available: true,
  reason: null,
  sessionKey: "sim-42-s1",
  diagnostics: { pendingEdges: 0, rejectedEdges: 0, lastRejectReason: null },
  visits: [
    {
      visitKey,
      pitLaneSeconds: seconds,
      entryObservedAt: "2026-11-21T12:00:00.000Z",
      exitObservedAt: `2026-11-21T12:00:${seconds.toFixed(3).padStart(6, "0")}Z`,
      entrySessionSeconds: 1000,
      exitSessionSeconds: 1000 + seconds,
      source: "measurement_event_pit_edges",
    },
  ],
});

const emptyFeed = (reason = "no_completed_visit"): PersonalPitFeed => ({
  available: false,
  reason,
  sessionKey: "sim-42-s1",
  visits: [],
  diagnostics: { pendingEdges: 2, rejectedEdges: 1, lastRejectReason: "clock_telemetry_gap" },
});

const feedFor = (deviceId: string) => h.feeds[deviceId];

const rpc = () => {
  h.rpc.mockImplementation(async (fn: string, args: Record<string, unknown> = {}) => {
    if (fn === "pitwall_personal_pit_visits_v1") {
      const feed = feedFor(String(args.p_device_id));
      if (feed && typeof feed === "object" && !Array.isArray(feed) && !("visits" in feed) && "error" in feed) {
        return { data: null, error: { message: (feed as { error: string }).error } };
      }
      return { data: await feed, error: null };
    }
    if (fn === "get_simhub_fleet") return { data: h.adminDevices, error: null };
    if (fn === "get_simhub_device_details") {
      const id = String(args.p_device_id ?? "");
      return { data: h.adminDetails[id] ?? h.adminDetails["device-admin-a"], error: null };
    }
    if (fn === "pitwall_sandbox_v1") {
      return {
        data: {
          drivers: [{ name: "Vincent" }],
          lap_samples: [{ lap: 18, seconds: 102.4, driver: "Vincent" }],
          pace: { fastest: 102.4, median: 102.4, count: 1 },
        },
        error: null,
      };
    }
    if (fn === "get_pitwall_tyre_stops") return { data: { sessionKey: null, stops: [] }, error: null };
    return { data: null, error: { code: "PGRST202", message: "niet beschikbaar in deze test" } };
  });
};

const renderWith = (node: React.ReactNode) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
};

const renderPersonal = () => renderWith(<PersonalPitwallPage />);

const renderAdmin = async (name: RegExp) => {
  const view = renderWith(<PitwallDeviceTestPage />);
  const button = await screen.findByRole("button", { name });
  fireEvent.click(button);
  return view;
};

const snapshot = (view: ReturnType<typeof render>) => {
  const card = view.container.querySelector("[data-pit-visit]");
  const empty = view.container.querySelector("[data-pit-benchmark-empty]");
  return {
    duration: card?.querySelector("[data-pit-duration]")?.getAttribute("data-pit-duration") ?? null,
    source: card?.getAttribute("data-pit-source") ?? null,
    benchmark: card?.getAttribute("data-pit-benchmark") ?? null,
    empty: Boolean(empty),
    text: (card ?? empty)?.textContent?.replace(/\s+/g, " ").trim() ?? "",
  };
};

const waitForStop = async (view: ReturnType<typeof render>, seconds: string) => {
  await waitFor(() => {
    const node = view.container.querySelector("[data-pit-duration]");
    expect(node?.getAttribute("data-pit-duration")).toBe(seconds);
  });
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  h.ownerDevice = ownerDevice();
  h.ownerDetail = detailFor("device-owner", "MIJN-PC");
  h.adminDevices = [adminDevice("device-admin-a", "ADMIN-A"), adminDevice("device-admin-b", "ADMIN-B")];
  h.adminDetails = {
    "device-admin-a": detailFor("device-admin-a", "ADMIN-A", "someone-else"),
    "device-admin-b": detailFor("device-admin-b", "ADMIN-B", "someone-else"),
  };
  h.feeds = {
    "device-owner": visitFeed(38.125, "pit-owner-1"),
    "device-admin-a": visitFeed(38.125, "pit-admin-1"),
  };
  h.rpc.mockReset();
  rpc();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("laatste stop — Mijn Pitwall en admin-pitwalltest zijn gelijk", () => {
  it("toont op een geselecteerd niet-eigen device exact dezelfde gemeten stop als de ownerpagina", async () => {
    const personal = renderPersonal();
    await waitForStop(personal, "38.125");
    const personalSnapshot = snapshot(personal);
    personal.unmount();

    const admin = await renderAdmin(/ADMIN-A/);
    await waitForStop(admin, "38.125");

    expect(snapshot(admin)).toEqual(personalSnapshot);
    expect(personalSnapshot).toMatchObject({
      duration: "38.125",
      source: "measurement_event_pit_edges",
      benchmark: "gross",
      empty: false,
    });
    expect(personalSnapshot.text).toContain("Laatste gemeten stop · bruto benchmark · niet in het strategiemodel.");
    expect(personalSnapshot.text).toContain("Bruto pitstraattijd, service inbegrepen. Geen netto raceverlies.");

    const calls = h.rpc.mock.calls.filter(([fn]) => fn === "pitwall_personal_pit_visits_v1");
    expect(calls).toEqual(
      expect.arrayContaining([
        ["pitwall_personal_pit_visits_v1", { p_device_id: "device-owner", p_limit: 5 }],
        ["pitwall_personal_pit_visits_v1", { p_device_id: "device-admin-a", p_limit: 5 }],
      ]),
    );
  });

  it("toont dezelfde expliciete lege sessie en diagnostiek op beide routes", async () => {
    h.feeds["device-owner"] = emptyFeed();
    h.feeds["device-admin-a"] = emptyFeed();

    const personal = renderPersonal();
    await waitFor(() => expect(personal.container.querySelector("[data-pit-benchmark-empty]")).not.toBeNull());
    const personalSnapshot = snapshot(personal);
    personal.unmount();

    const admin = await renderAdmin(/ADMIN-A/);
    await waitFor(() => expect(admin.container.querySelector("[data-pit-benchmark-empty]")).not.toBeNull());

    expect(snapshot(admin)).toEqual(personalSnapshot);
    expect(personalSnapshot.text).toContain("Nog geen afgeronde pitstop in deze sessie.");
    expect(personalSnapshot.text).toContain("2 bronflank(en) wachten nog op hun paar.");
    expect(personalSnapshot.text).toContain("1 flank(en) afgekeurd · clock_telemetry_gap");
  });

  it("wist de oude stop bij een devicewissel en negeert een laat antwoord", async () => {
    let resolveB: ((value: PersonalPitFeed) => void) | undefined;
    h.feeds["device-admin-b"] = new Promise<PersonalPitFeed>((resolve) => { resolveB = resolve; });

    const admin = await renderAdmin(/ADMIN-A/);
    await waitForStop(admin, "38.125");

    const deviceB = await screen.findByRole("button", { name: /ADMIN-B/ });
    fireEvent.click(deviceB);

    expect(admin.container.querySelector('[data-pit-duration="38.125"]')).toBeNull();
    await waitFor(() => expect(screen.getByText("Pitduur laden…")).toBeTruthy());
    expect(admin.container.querySelector('[data-pit-duration="38.125"]')).toBeNull();

    await act(async () => {
      resolveB?.(visitFeed(42.5, "pit-admin-b"));
      await Promise.resolve();
    });
    await waitForStop(admin, "42.5");
  });

  it("toont op beide routes dezelfde foutmelding zonder oude stop", async () => {
    h.feeds["device-owner"] = { error: "rpc down" };
    h.feeds["device-admin-a"] = { error: "rpc down" };

    const personal = renderPersonal();
    await waitFor(() => expect(personal.getByText("Pitduur kon niet worden geladen.")).toBeTruthy());
    expect(personal.container.querySelector("[data-pit-duration]")).toBeNull();
    personal.unmount();

    const admin = await renderAdmin(/ADMIN-A/);
    expect(await screen.findByText("Pitduur kon niet worden geladen.")).toBeTruthy();
    expect(admin.container.querySelector("[data-pit-duration]")).toBeNull();
  });
});
