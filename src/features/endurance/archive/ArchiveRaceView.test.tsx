import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EnduranceEvent } from "../core/types";
import type { EnduranceArchiveTeam } from "../repository/archiveRepository";
import type { EnduranceStintRow } from "../repository/stintsRepository";
import { ArchiveRaceView } from "./ArchiveRaceView";

afterEach(cleanup);

const event: EnduranceEvent = {
  id: "event-1",
  name: "6 uur van Spa",
  circuit: "Spa-Francorchamps",
  configuration: "Endurance",
  startAt: "2026-10-24T10:00:00.000Z",
  endAt: "2026-10-24T16:00:00.000Z",
  briefingStartAt: "2026-10-24T09:30:00.000Z",
  expectedEndAt: "2026-10-24T16:00:00.000Z",
  registrationDeadline: "2026-10-20T18:00:00.000Z",
  slots: [],
  classIds: [],
  selectedClassId: null,
  selectedCarId: null,
  maxDriversPerCar: 4,
  visibility: "invite_only",
  status: "completed",
  source: "manual",
  invitedUserIds: [],
  managerIds: [],
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-01T10:00:00.000Z",
};

const bravo: EnduranceArchiveTeam = {
  team_id: "team-bravo",
  team_name: "Bravo Racing",
  car_number: "7",
  laps: 140,
  best_lap_seconds: 93,
  stops: 1,
  drivers: ["Sam", "Noa"],
};

const alpha: EnduranceArchiveTeam = {
  team_id: "team-alpha",
  team_name: "Alpha Motorsport",
  car_number: null,
  laps: 120,
  best_lap_seconds: 95.5,
  stops: 2,
  drivers: ["Jaimy"],
};

const stint = (overrides: Partial<EnduranceStintRow>): EnduranceStintRow => ({
  id: "stint",
  event_id: "event-1",
  team_id: "team-bravo",
  driver_id: "driver-sam",
  original_start_at: "2026-10-24T10:00:00.000Z",
  original_end_at: "2026-10-24T11:00:00.000Z",
  actual_start_at: "2026-10-24T10:00:00.000Z",
  actual_end_at: "2026-10-24T11:00:00.000Z",
  expected_laps: 30,
  fuel_litres: 60,
  tyre_change: false,
  double_stint: false,
  notes: null,
  status: "completed",
  created_at: "2026-10-20T10:00:00.000Z",
  updated_at: "2026-10-24T11:00:00.000Z",
  ...overrides,
});

const names: Record<string, string> = { "driver-sam": "Sam", "driver-noa": "Noa", "driver-jaimy": "Jaimy" };
const nameOf = (id: string) => names[id];

const bravoStints = [
  stint({ id: "s1", actual_start_at: "2026-10-24T10:00:00.000Z", actual_end_at: "2026-10-24T11:30:00.000Z" }),
  stint({ id: "s2", driver_id: "driver-noa", actual_start_at: "2026-10-24T11:30:00.000Z", actual_end_at: "2026-10-24T12:00:00.000Z" }),
];

const alphaStints = [
  stint({
    id: "s3",
    team_id: "team-alpha",
    driver_id: "driver-jaimy",
    actual_start_at: "2026-10-24T12:00:00.000Z",
    actual_end_at: "2026-10-24T12:45:00.000Z",
  }),
];

describe("ArchiveRaceView — uitslag", () => {
  it("toont per team rondes, snelste ronde, stops en coureurs in uitslagvolgorde", () => {
    render(<ArchiveRaceView event={event} teams={[alpha, bravo]} stints={[...bravoStints, ...alphaStints]} nameOf={nameOf} onBack={vi.fn()} />);

    const rows = screen.getAllByRole("row");
    // Kop + twee teams; de snelste auto staat bovenaan, ook al komt hij later binnen.
    expect(rows).toHaveLength(3);
    expect(rows[1].textContent).toContain("Bravo Racing");
    expect(rows[1].textContent).toContain("140");
    expect(rows[1].textContent).toContain("1:33.00");
    expect(rows[1].textContent).toContain("Sam · Noa");
    expect(rows[2].textContent).toContain("Alpha Motorsport");
    expect(rows[2].textContent).toContain("1:35.50");
    expect(rows[2].textContent).toContain("Jaimy");
  });

  it("vat de race samen in de statistiekenstrook", () => {
    render(<ArchiveRaceView event={event} teams={[bravo, alpha]} stints={[...bravoStints, ...alphaStints]} nameOf={nameOf} onBack={vi.fn()} />);
    expect(screen.getByText("260")).toBeInTheDocument();
    expect(screen.getByText("alle teams samen")).toBeInTheDocument();
    expect(screen.getByText("snelste van de race")).toBeInTheDocument();
    // Snelste ronde van de race staat zowel in de strook als in de uitslagtabel.
    expect(screen.getAllByText("1:33.00").length).toBeGreaterThanOrEqual(2);
  });

  it("meldt het eerlijk als er geen telemetrie bewaard is", () => {
    const leeg: EnduranceArchiveTeam = { ...bravo, laps: 0, stops: 0, best_lap_seconds: null, drivers: [] };
    render(<ArchiveRaceView event={event} teams={[leeg]} stints={[]} nameOf={nameOf} onBack={vi.fn()} />);
    expect(screen.getByText(/Geen telemetrie bewaard voor deze race/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText(/Geen stints bewaard voor deze race/)).toBeInTheDocument();
  });

  it("toont een fout in plaats van een lege uitslag", () => {
    render(<ArchiveRaceView event={event} teams={[]} stints={[]} nameOf={nameOf} onBack={vi.fn()} error="RPC get_endurance_archive_summary faalde" />);
    expect(screen.getByRole("alert")).toHaveTextContent("RPC get_endurance_archive_summary faalde");
    expect(screen.getByText(/Dit is geen lege race/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("zegt dat de uitslag nog laadt", () => {
    render(<ArchiveRaceView event={event} teams={[]} stints={[]} nameOf={nameOf} onBack={vi.fn()} loading />);
    expect(screen.getByText("Uitslag laden…")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("ArchiveRaceView — stintverdeling", () => {
  it("toont per team de stintbalk met rijtijd per coureur", () => {
    render(<ArchiveRaceView event={event} teams={[bravo, alpha]} stints={[...bravoStints, ...alphaStints]} nameOf={nameOf} onBack={vi.fn()} />);

    expect(screen.getByRole("img", { name: "Stintverdeling Bravo Racing" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Stintverdeling Alpha Motorsport" })).toBeInTheDocument();
    expect(screen.getByText("2 stints · 2 u rijtijd")).toBeInTheDocument();
    expect(screen.getByText("1 stint · 1 u 30 min")).toBeInTheDocument();
    expect(screen.getByText("1 stint · 30 min")).toBeInTheDocument();
    expect(screen.getByText("1 stint · 45 min rijtijd")).toBeInTheDocument();
  });

  it("noemt een coureur zonder profiel niet bij naam", () => {
    render(<ArchiveRaceView
      event={event}
      teams={[bravo]}
      stints={[stint({ id: "x", driver_id: "driver-zonder-profiel" })]}
      nameOf={nameOf}
      onBack={vi.fn()}
    />);
    expect(screen.getAllByText("Onbekende coureur").length).toBeGreaterThanOrEqual(2);
  });

  it("gaat terug met de terugknop", () => {
    const onBack = vi.fn();
    render(<ArchiveRaceView event={event} teams={[bravo]} stints={bravoStints} nameOf={nameOf} onBack={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: /Terug naar archief/ }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
