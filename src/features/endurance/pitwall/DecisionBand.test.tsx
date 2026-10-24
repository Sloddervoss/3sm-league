import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DecisionBand } from "./DecisionBand";
import type { Advice } from "./strategy/types";

afterEach(cleanup);

const advice = (overrides: Partial<Advice> = {}): Advice => ({
  decision: "PIT_IN_LAPS",
  lapsUntilPit: 5,
  fuelToAddLitres: 42,
  confidence: "high",
  reasonCode: "in_window",
  reason: "Over 5 rondes naar binnen voor brandstof.",
  window: null,
  fuel: { perLap: 3, sigma: 0.02, samples: 10, rejected: 0, source: "measured" },
  pitLoss: null,
  lapsOnFuel: 6,
  lapsToFinish: 40,
  ...overrides,
});

describe("DecisionBand", () => {
  it("toont het advies als één regel met de deadline", () => {
    render(<DecisionBand advice={advice()} />);
    expect(screen.getByText("PIT OVER 5 RONDES")).toBeInTheDocument();
    expect(screen.getByText("Over 5 rondes naar binnen voor brandstof.")).toBeInTheDocument();
    expect(screen.getByText("42 L")).toBeInTheDocument();
  });

  it("zegt blijven buiten als de tank het haalt", () => {
    render(<DecisionBand advice={advice({ decision: "STAY_OUT", lapsUntilPit: null, reasonCode: "fuel_to_finish" })} />);
    expect(screen.getByText("BLIJF BUITEN")).toBeInTheDocument();
  });

  it("maakt van geen advies een rustige toestand met oorzaak", () => {
    render(
      <DecisionBand
        advice={advice({
          decision: "NO_ADVICE",
          lapsUntilPit: null,
          fuelToAddLitres: null,
          confidence: "none",
          reasonCode: "stale_telemetry",
          reason: "Telemetrie is 12 s oud; geen advies op verouderde cijfers.",
          lapsOnFuel: null,
        })}
      />,
    );
    expect(screen.getByText("GEEN ADVIES")).toBeInTheDocument();
    expect(screen.getByText(/12 s oud/)).toBeInTheDocument();
    // Geen lege vakjes bij een lege meting: de reden is dan de hele boodschap.
    expect(screen.queryByText("in de tank")).not.toBeInTheDocument();
    expect(screen.queryByText("zekerheid")).not.toBeInTheDocument();
  });

  it("toont een streepje in plaats van een verzonnen getal", () => {
    render(<DecisionBand advice={advice({ lapsOnFuel: null, fuelToAddLitres: null })} />);
    expect(screen.getAllByText("—")).toHaveLength(2);
  });
});
