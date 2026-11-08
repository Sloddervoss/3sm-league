import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { parseOpponents } from "../../supabase/functions/_shared/opponents";
import { StandingsWidget } from "../features/endurance/pitwall/StandingsWidget";
import { deriveStandings } from "../features/endurance/pitwall/standings";

afterEach(cleanup);

const opponent = (fields: Record<string, unknown> = {}) => ({
  id: "car-007", carNumber: "007", driverName: "Test Driver", teamName: "Test Team",
  carClass: "GT3", carClassId: "17", position: 2, classPosition: 1,
  lap: 42, lapDistancePct: 0.5, gapToPlayerSeconds: -1.2, gapToLeaderSeconds: 2,
  lastLapSeconds: 92, bestLapSeconds: 91, inPit: false, speedKph: 200,
  connected: true, isPlayer: false, ...fields,
});

function timing(fields: Record<string, unknown> = {}) {
  const opponents = parseOpponents([opponent(fields)])!;
  return <StandingsWidget standings={deriveStandings({ opponents, position: { position: 3, classPosition: 2 } })} ownCarLabel="Eigen auto" ownCarNumber="42" />;
}

describe("ratings door de echte opponentparser naar de live timing", () => {
  it("toont iR en gekleurde SR naast de coureur en verwijdert K", () => {
    render(timing({ irating: 3240, safetyRating: 3.45, licenseClass: "A" }));
    expect(screen.getAllByRole("columnheader").map(h => h.textContent)).toEqual([
      "P", "#", "Coureur", "iR", "SR", "Klasse", "Laatste", "Beste", "Ronde", "Gap tot jou", "Pit",
    ]);
    expect(screen.getByText("3240")).toBeInTheDocument();
    expect(screen.getByText("A 3.45")).toHaveClass("text-sky-100");
    expect(screen.queryByText(/^K\d+$/)).not.toBeInTheDocument();
    const row = screen.getByText("Test Driver", { selector: "p" }).closest("tr")!;
    expect(row.cells).toHaveLength(11);
    expect(screen.getByText("GT3", { selector: "td span" }).closest("td")).toHaveAttribute("colspan", "11");
  });

  it("houdt een oudere connector bruikbaar met onbekende ratings", () => {
    const parsed = parseOpponents([opponent()])![0];
    expect(parsed.irating).toBeNull();
    expect(parsed.safetyRating).toBeNull();
    expect(parsed.licenseClass).toBeNull();
    render(timing());
    const cells = within(screen.getByText("Test Driver", { selector: "p" }).closest("tr")!).getAllByRole("cell");
    expect(cells[3]).toHaveTextContent("—");
    expect(cells[4]).toHaveTextContent("—");
    expect(cells[9]).toHaveTextContent("-1.2s");
  });

  it.each([
    { irating: -1, safetyRating: 5, licenseClass: "unknown" },
    { irating: Number.NaN, safetyRating: Number.POSITIVE_INFINITY, licenseClass: {} },
    { irating: 2400.5, safetyRating: -0.1, licenseClass: "toString" },
    { irating: 100001, safetyRating: "3.45", licenseClass: "constructor" },
  ])("leegt ongeldige ratings zonder tegenstander of timing te verliezen: %j", fields => {
    const parsed = parseOpponents([opponent(fields)])!;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ irating: null, safetyRating: null, licenseClass: null, lastLapSeconds: 92 });
  });

  it("vervangt de ratings bij een nieuwe coureur en wist ze als ze ontbreken", () => {
    const { rerender } = render(timing({ irating: 3240, safetyRating: 3.45, licenseClass: "A" }));
    rerender(timing({ driverName: "Next Driver", irating: 1940, safetyRating: 2.87, licenseClass: "B" }));
    expect(screen.queryByText("3240")).not.toBeInTheDocument();
    expect(screen.getByText("B 2.87")).toHaveClass("text-green-200");
    rerender(timing({ driverName: "Third Driver" }));
    expect(screen.queryByText("1940")).not.toBeInTheDocument();
    expect(screen.queryByText("B 2.87")).not.toBeInTheDocument();
  });

  it("behoudt 0.00 als echte Safety Rating en vult geen ontbrekende licentie in", () => {
    const { rerender } = render(timing({ safetyRating: 0, licenseClass: "R" }));
    expect(screen.getByText("R 0.00")).toBeInTheDocument();
    rerender(timing({ safetyRating: 3.45 }));
    expect(screen.queryByText("A 3.45")).not.toBeInTheDocument();
  });
});
