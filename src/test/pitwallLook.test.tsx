import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RaceTelemetryStrip } from "@/features/endurance/pitwall/RaceTelemetryStrip";
import { StandingsWidget } from "@/features/endurance/pitwall/StandingsWidget";
import { FuelPanel } from "@/features/endurance/pitwall/FuelPanel";
import { VehicleTelemetryPanel } from "@/features/endurance/pitwall/VehicleTelemetryPanel";
import { PacePanel } from "@/features/endurance/pitwall/PacePanel";
import { MySessionPanel } from "@/features/endurance/pitwall/MySessionPanel";
import { StintDriverPanel } from "@/features/endurance/pitwall/StintDriverPanel";
import { PitwallDashboard } from "@/features/endurance/pitwall/PitwallDashboard";
import { PitwallContextBar } from "@/features/endurance/pitwall/PitwallContextBar";
import { deriveStandings } from "@/features/endurance/pitwall/standings";
import type { PitwallStrategyRow, V3Normalized } from "@/features/endurance/pitwall/pitwallHelpers";
import { PitwallTab } from "@/features/endurance/pitwall/PitwallTab";
import type { EnduranceEvent } from "@/features/endurance/core/types";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isSuperAdmin: true, isEnduranceManager: true }) }));
vi.mock("@/features/endurance/core/ActorContext", () => ({
  useEnduranceActor: () => ({ actorId: "admin", displayName: (id: string) => id }),
}));
vi.mock("@/features/endurance/repository/pitwallRepository", () => ({
  listPitwallTeams: vi.fn(async () => [{ id: "demo-team", name: "3SM Demo Team" }]),
  fetchPitwallData: vi.fn(async () => ({ telemetry: null, strategy: null })),
}));
vi.mock("@/features/endurance/race-control/RaceControlPanel", () => ({
  RaceControlPanel: () => <div data-testid="control" />,
}));

afterEach(() => vi.clearAllMocks());

const v3: V3Normalized = {
  identity: { currentDriverName: "Vincent", carName: "Porsche 911 GT3 R", trackName: "Circuit de Spa-Francorchamps" },
  session: { isInCar: true, sessionTimeRemainingSeconds: 9692 },
  timing: { lastLapTimeSeconds: 92.412, bestLapTimeSeconds: 91.804, completedLaps: 103 },
  position: { position: 6, classPosition: 2, gapToLeaderSeconds: 42.8 },
  vehicle: {
    sector1Seconds: 31.482,
    sector2Seconds: 42.763,
    sector3Seconds: 28.917,
    speedKph: 210,
    rpm: 7000,
    gear: "4",
    tyreDataMode: "last_available",
    pressureUnit: "psi",
    temperatureUnit: "C",
    frontLeft: { wearPercent: 93, temperature: 83, pressure: 26 },
    frontRight: { wearPercent: 41, temperature: 88, pressure: 27 },
    rearLeft: { wearPercent: 78, temperature: 80, pressure: 25 },
    rearRight: null,
  } as V3Normalized["vehicle"],
};

const strategy: PitwallStrategyRow = {
  race_run_id: "rr",
  event_id: "event",
  team_id: "team",
  fuel_per_lap_litres: 3.12,
  race_fuel_per_lap_litres: 3.08,
  fuel_laps_remaining: 6.1,
  valid_fuel_sample_count: 47,
  current_stint_valid_sample_count: 12,
  current_fuel_stint: 3,
  last_completed_laps: 103,
  current_fuel_litres: 21.7,
  session_laps_remaining: 57,
  fuel_to_finish_litres: 280,
  fuel_sufficient_to_finish: true,
  strategy_status: "ready",
  strategy_reason: null,
  updated_at: new Date().toISOString(),
  fuel_to_add_litres: 72,
};

describe("KPI-strip — drie groepen, geen verzonnen noemers", () => {
  it("groepeert sectoren, rondetijd en positie en toont de bestaande waarden", () => {
    const view = render(<RaceTelemetryStrip v3={v3} live />);
    const sectoren = view.container.querySelector('[data-pitwall-kpi-group="sectoren"]');
    const rondetijd = view.container.querySelector('[data-pitwall-kpi-group="rondetijd"]');
    const positie = view.container.querySelector('[data-pitwall-kpi-group="positie"]');

    expect(sectoren).not.toBeNull();
    for (const group of [sectoren, rondetijd, positie]) {
      expect(group?.className).toContain("rounded-lg border");
    }
    expect(rondetijd).not.toBeNull();
    expect(positie).not.toBeNull();

    expect(within(sectoren as HTMLElement).getAllByText("—")).toHaveLength(3);
    expect(within(sectoren as HTMLElement).getByText("Sectoren · niet gecontroleerd")).toBeTruthy();

    expect(within(positie as HTMLElement).getByText("P6")).toBeTruthy();
    expect(within(positie as HTMLElement).getByText("K2")).toBeTruthy();
    expect(within(positie as HTMLElement).getByText("103")).toBeTruthy();
    expect(within(positie as HTMLElement).getByText("2:41:32")).toBeTruthy();
  });

  it("zet geen deelnemersaantal of totaalronden achter de positie", () => {
    const view = render(<RaceTelemetryStrip v3={v3} live />);
    expect(view.container.textContent).not.toMatch(/P6\s*\/\s*\d+/);
    expect(view.container.textContent).not.toMatch(/103\s*\/\s*\d+/);
  });

  it("toont streepjes in plaats van waarden als de feed niet live is", () => {
    const view = render(<RaceTelemetryStrip v3={v3} live={false} />);
    expect(view.container.textContent).not.toContain("P6");
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});

describe("Live timing — kolommen, klassesortering en de eigen rij", () => {
  const standings = deriveStandings(
    {
      position: { position: 2, classPosition: 1 },
      opponents: [
        { id: "p1", position: 1, classPosition: 1, carClass: "GT3", carNumber: "11", driverName: "M. vd Berg", teamName: "Apex Racing", lastLapSeconds: 91.2, bestLapSeconds: 90.9, gapToPlayerSeconds: -42.8, connected: true },
        { id: "player", position: 2, classPosition: 1, carClass: "GT3", carNumber: "45", driverName: "Vincent", teamName: "3SM Endurance", lastLapSeconds: 92.4, bestLapSeconds: 91.8, gapToPlayerSeconds: 0, isPlayer: true, connected: true },
        { id: "p3", position: 3, classPosition: 1, carClass: "LMP2", carNumber: "6", driverName: "M. Fischer", teamName: "Fischer Racing", lastLapSeconds: 93.0, bestLapSeconds: 92.5, gapToPlayerSeconds: 2.1, connected: true },
      ],
    },
    40,
    { p1: 0.2 },
  );

  it("toont coureur als hoofdregel en team als tweede regel", () => {
    render(<StandingsWidget standings={standings} ownCarLabel="3SM Endurance" ownCarNumber={null} live />);
    expect(screen.getAllByText("M. vd Berg").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Apex Racing").length).toBeGreaterThan(0);
  });

  it("markeert de eigen rij en laat P en K los", () => {
    const view = render(<StandingsWidget standings={standings} ownCarLabel="3SM Endurance" ownCarNumber={null} live />);
    const own = view.container.querySelector('[data-pitwall-own-row="true"]');
    expect(own).not.toBeNull();
    expect(own?.textContent).toContain("Vincent");
    expect(own?.textContent).toContain("3SM Endurance");
    expect(own?.textContent).toContain("P2");
    expect(own?.textContent).toContain("K1");
  });

  it("noemt de gap naar de bron: tot jou, niet achter de leider", () => {
    render(<StandingsWidget standings={standings} ownCarLabel="3SM Endurance" ownCarNumber={null} live />);
    expect(screen.getByText("Gap tot jou")).toBeTruthy();
    expect(screen.queryByText(/achter leider/i)).toBeNull();
  });

  it("houdt de klassesortering en toont de klassenkop met het aantal in beeld", () => {
    const view = render(<StandingsWidget standings={standings} ownCarLabel="3SM Endurance" ownCarNumber={null} live />);
    const rows = view.container.querySelectorAll("tbody tr[data-pitwall-own-row], tbody tr:not([data-pitwall-own-row])");
    expect(rows.length).toBeGreaterThan(0);
    expect(screen.getAllByText("GT3").length).toBeGreaterThan(0);
    expect(screen.getAllByText("LMP2").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/in beeld$/).length).toBeGreaterThan(0);
  });

  it("houdt alle timingrijen in een benoemd, toetsenbordbereikbaar scrollvlak", () => {
    render(<StandingsWidget standings={standings} ownCarLabel="3SM Endurance" ownCarNumber={null} live />);
    const region = screen.getByRole("region", { name: "Live timing — scrollbaar klassement" });
    expect(region.tabIndex).toBe(0);
    expect(region.className).toContain("pitwall-timing-scroll");
    expect(region.querySelectorAll("tbody tr[data-pitwall-own-row]")).toHaveLength(1);
    expect(within(region).getByText("Vincent")).toBeTruthy();
    expect(within(region).getByText("M. Fischer")).toBeTruthy();
    expect(screen.getByText(/Scroll voor alle rijen/)).toBeTruthy();
  });

  it("wacht netjes op tegenstanderdata", () => {
    render(<StandingsWidget standings={deriveStandings(null)} ownCarLabel="Mijn auto" ownCarNumber={null} live />);
    expect(screen.getByText("Wacht op tegenstanderdata…")).toBeTruthy();
  });
});

describe("Pace-paneel — één lijn, bestaande waarden", () => {
  it("toont de grafiek met de bestaande pacewaarden eronder", () => {
    const view = render(
      <PacePanel
        strategy={strategy}
        pace={{ lastLapSeconds: 92.4, bestLapSeconds: 91.8, stintAvgSeconds: 93.1, targetSeconds: 92.0 }}
        points={[
          { lap: 1, seconds: 92.4 },
          { lap: 2, seconds: 92.1 },
          { lap: 3, seconds: 92.6 },
        ]}
      />,
    );
    expect(view.container.querySelector("[data-pitwall-pace-graph]")).not.toBeNull();
    expect(view.container.querySelectorAll("[data-pitwall-pace-graph] circle")).toHaveLength(3);
    expect(view.container.querySelectorAll("[data-pitwall-pace-graph] line").length).toBeGreaterThanOrEqual(9);
    expect(screen.getByText("1:32.4")).toBeTruthy();
    expect(screen.getByText("1:31.8")).toBeTruthy();
    expect(screen.getByText("1:33.1")).toBeTruthy();
    expect(screen.getByText("1:32.0")).toBeTruthy();
  });

  it("werkt met de lap_samples van de testmodus", () => {
    const samples = [
      { lap: 12, seconds: 101.2 },
      { lap: 13, seconds: 100.8 },
      { lap: 14, seconds: 101.5 },
    ];
    const view = render(<PacePanel strategy={null} pace={null} points={samples} />);
    expect(view.container.querySelector("[data-pitwall-pace-graph]")).not.toBeNull();
    expect(view.container.querySelectorAll("[data-pitwall-pace-graph] circle")).toHaveLength(3);
    expect(view.container.querySelectorAll("[data-pitwall-pace-graph] line").length).toBeGreaterThanOrEqual(9);
  });
});

describe("Brandstof & stint — meting blijft meting", () => {
  it("toont de grote tankwaarde met range, verbruik, finish en meetbasis", () => {
    render(<FuelPanel strategy={strategy} />);
    expect(screen.getByText("21.7L")).toBeTruthy();
    expect(screen.getByText("6.1")).toBeTruthy();
    expect(screen.getByText("3.120 L/ronde")).toBeTruthy();
    expect(screen.getByText("280.0L")).toBeTruthy();
    expect(screen.getByText("Meetbasis: 47 geldige samples")).toBeTruthy();
  });

  it("toont in de testmodus alleen de tankinhoud en geen verzonnen strategie", () => {
    const deviceRow: PitwallStrategyRow = {
      ...strategy,
      fuel_per_lap_litres: null,
      race_fuel_per_lap_litres: null,
      fuel_laps_remaining: null,
      fuel_to_finish_litres: null,
      fuel_sufficient_to_finish: null,
      fuel_to_add_litres: null,
      valid_fuel_sample_count: 0,
      strategy_status: "insufficient_data",
    };
    render(<FuelPanel strategy={deviceRow} />);
    expect(screen.getByText("21.7L")).toBeTruthy();
    expect(screen.getByText("Alleen tankinhoud; verbruik en bereik vereisen een gebonden race.")).toBeTruthy();
    expect(screen.queryByText(/L\/ronde/)).toBeNull();
  });
});

describe("Banden — vier hoeken met alleen bekende eenheden", () => {
  it("toont het restpercentage als hoofdwaarde en temperatuur/druk kleiner", () => {
    const view = render(<VehicleTelemetryPanel v3={v3} live />);
    for (const corner of ["frontLeft", "frontRight", "rearLeft", "rearRight"]) {
      expect(view.container.querySelector(`[data-pitwall-tyre-corner="${corner}"]`)).not.toBeNull();
    }
    expect(screen.getByText("93%")).toBeTruthy();
    expect(screen.getByText("83.0 °C")).toBeTruthy();
    expect(screen.getByText("26.0 psi")).toBeTruthy();
    expect(screen.getByText("Laatst beschikbare bandenmeting")).toBeTruthy();
    // Onbekende hoek blijft een streepje, geen 0%.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("verzint geen eenheid als de bron die niet meegaf", () => {
    const zonderEenheid = { ...v3, vehicle: { ...v3.vehicle!, temperatureUnit: null, pressureUnit: null } } as V3Normalized;
    const view = render(<VehicleTelemetryPanel v3={zonderEenheid} live />);
    expect(view.container.textContent).not.toContain("°C");
    expect(view.container.textContent).not.toContain("psi");
  });
});

describe("Mijn sessie — de testmodus zonder endurance-rotatie", () => {
  it("toont rijder, auto en de vastgelegde rondes uit de sandbox", () => {
    render(
      <MySessionPanel
        driverName="Vincent"
        carName="Porsche 911 GT3 R"
        recordedLaps={18}
        fastestSeconds={91.8}
        medianSeconds={92.4}
      />,
    );
    expect(screen.getByText("Vincent")).toBeTruthy();
    expect(screen.getByText("Porsche 911 GT3 R")).toBeTruthy();
    expect(screen.getByText("18")).toBeTruthy();
    expect(screen.getByText("1:31.8")).toBeTruthy();
    expect(screen.getByText("1:32.4")).toBeTruthy();
    expect(screen.getByText("Sessie van dit apparaat; geen accounthistorie.")).toBeTruthy();
  });
});

describe("Coureur & wissel — alleen wanneer tyre_change dat zegt", () => {
  const stint = (over: Partial<import("@/features/endurance/pitwall/pitwallHelpers").PitwallPlannedStint>) => ({
    id: "s1",
    driver_id: "Vincent",
    original_start_at: new Date().toISOString(),
    original_end_at: new Date().toISOString(),
    actual_start_at: null,
    actual_end_at: null,
    expected_laps: 35,
    fuel_litres: 90,
    tyre_change: false,
    double_stint: false,
    status: "in_car",
    notes: null,
    ...over,
  });

  it("toont nu, volgende en daarna", () => {
    render(
      <StintDriverPanel
        strategy={strategy}
        currentStint={stint({})}
        driverName="Vincent"
        plannedStints={[stint({ id: "s2", driver_id: "Jason", tyre_change: true }), stint({ id: "s3", driver_id: "Ricky" })]}
      />,
    );
    expect(screen.getAllByText("Vincent").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Jason").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Ricky/).length).toBeGreaterThan(0);
  });

  it("zet de bandenwissel alleen neer als tyre_change waar is", () => {
    const met = render(
      <StintDriverPanel
        strategy={strategy}
        currentStint={stint({})}
        driverName="Vincent"
        plannedStints={[stint({ id: "s2", driver_id: "Jason", tyre_change: true })]}
      />,
    );
    expect(met.container.querySelector('[data-pitwall-tyre-change="true"]')).not.toBeNull();
    met.unmount();

    const zonder = render(
      <StintDriverPanel
        strategy={strategy}
        currentStint={stint({})}
        driverName="Vincent"
        plannedStints={[stint({ id: "s2", driver_id: "Jason", tyre_change: false })]}
      />,
    );
    expect(zonder.container.querySelector('[data-pitwall-tyre-change="true"]')).toBeNull();
  });
});

describe("Raster — circuit links, timing rechts, vier panelen", () => {
  it("zet het circuit voor de timing en de vier panelen in één rij", () => {
    const view = render(
      <PitwallDashboard
        kpi={<span>kpi</span>}
        decision={<span>band</span>}
        track={<span data-testid="track">track</span>}
        timing={<span data-testid="timing">timing</span>}
        panels={[<span key="1">p1</span>, <span key="2">p2</span>, <span key="3">p3</span>, <span key="4">p4</span>]}
      />,
    );
    const html = view.container.innerHTML;
    expect(html.indexOf('data-pitwall-col="track"')).toBeLessThan(html.indexOf('data-pitwall-col="timing"'));

    const row = view.container.querySelector('[data-pitwall-row="panels"]');
    expect(row?.className).toContain("md:grid-cols-2");
    expect(row?.className).toContain("xl:grid-cols-4");
    expect(row?.children.length).toBe(4);
  });

  it("toont de contextregel met verbindingsstatus", () => {
    render(<PitwallContextBar eyebrow="3SM · Endurance" title="6 uur van Spa" state="offline" items={[{ label: "Team", value: "3SM" }]} />);
    expect(screen.getByText("OFFLINE")).toBeTruthy();
    expect(screen.getByText("6 uur van Spa")).toBeTruthy();
  });
});

describe("Endurance-pitwall — hetzelfde raster, andere tweede paneel", () => {
  const renderTab = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/endurance/races/race?pitwallDemo=normal"]}>
          <PitwallTab event={{ id: "race", name: "6 uur van Spa", circuit: "Spa", configuration: "GP" } as EnduranceEvent} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  };

  it("toont coureur & wissel en niet mijn sessie", async () => {
    const view = renderTab();
    expect(await screen.findByText("Coureur & wissel")).toBeTruthy();
    expect(screen.queryByText("Mijn sessie")).toBeNull();
    // De vier onderpanelen staan er alle vier.
    for (const slot of ["pace", "driver", "fuel", "tyres"]) {
      expect(view.container.querySelector(`[data-pitwall-slot="${slot}"]`)).not.toBeNull();
    }
    // Circuit links, timing rechts.
    const html = view.container.innerHTML;
    expect(html.indexOf('data-pitwall-col="track"')).toBeLessThan(html.indexOf('data-pitwall-col="timing"'));
    view.unmount();
  });
});


describe("Aanvullende analyse", () => {
  it("houdt de ongewijzigde extra inhoud standaard ingeklapt na de vier panelen", () => {
    const view = render(<PitwallDashboard track={null} timing={null} panels={[1, 2, 3, 4]} extra={<p>Extra inhoud</p>} />);
    const disclosure = view.container.querySelector("details");
    expect(disclosure?.open).toBe(false);
    expect(disclosure?.querySelector("summary")?.textContent?.trim()).toBe("Meer analyse");
    expect(disclosure?.querySelector('[data-pitwall-extra]')?.textContent).toBe("Extra inhoud");
    expect(disclosure?.previousElementSibling?.getAttribute("data-pitwall-row")).toBe("panels");
  });

  it("toont geen lege uitklapper zonder aanvullende inhoud", () => {
    const view = render(<PitwallDashboard track={null} timing={null} panels={[]} />);
    expect(view.container.querySelector("details")).toBeNull();
  });
});
