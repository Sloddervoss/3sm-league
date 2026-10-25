import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DecisionBand } from "./DecisionBand";
import type { Advice } from "./strategy/types";
import type { TyreAdvice } from "./strategy/tyreWear";

afterEach(cleanup);

const tyres = (overrides: Partial<TyreAdvice> = {}): TyreAdvice => ({
  action: "CHANGE_AT_PLANNED_STOP",
  wearPerLap: 0.45,
  lapsRemaining: 24,
  weakestCorner: "fl",
  mustSurviveLaps: 18,
  horizon: "planned_stop",
  reliable: true,
  samples: 8,
  reasonCode: "change_at_planned_stop",
  reason: "Banden gaan nog 24 rondes mee (0,45 punt per ronde op linksvoor); de geplande stop is over 18, dus wisselen bij die stop.",
  ...overrides,
});

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
  tyres: null,
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

  it("toont het bandenadvies als tweede regel met de reden en het aantal rondes", () => {
    render(<DecisionBand advice={advice({ tyres: tyres() })} />);
    expect(screen.getByText("wisselen bij stop")).toBeInTheDocument();
    expect(screen.getByText(/0,45 punt per ronde op linksvoor/)).toBeInTheDocument();
    expect(screen.getByText("24 r")).toBeInTheDocument();
  });

  it("zegt dat er geen bandenadvies is als de slijtage stilstaat, met de oorzaak", () => {
    render(
      <DecisionBand
        advice={advice({
          tyres: tyres({
            action: "NO_ADVICE",
            wearPerLap: null,
            lapsRemaining: null,
            reliable: false,
            reasonCode: "stalled_values",
            reason: "Geen bandenadvies: de slijtagewaarde staat 7 rondes stil en verspringt daarna, dus de slijtage per ronde is niet te meten.",
          }),
        })}
      />,
    );
    expect(screen.getByText("geen bandenadvies")).toBeInTheDocument();
    expect(screen.getByText(/staat 7 rondes stil/)).toBeInTheDocument();
    // Geen getal waar geen meting is: de band levert dan geen vakje op.
    expect(screen.queryByText("banden")).not.toBeInTheDocument();
  });

  it("zet de band voor de brandstof als de wissel eerder moet", () => {
    render(
      <DecisionBand
        advice={advice({
          decision: "PIT_IN_LAPS",
          lapsUntilPit: 12,
          reasonCode: "tyre_life",
          reason: "Banden zijn over 12 rondes op (0,45 punt per ronde op linksvoor), 6 rondes vóór de geplande stop.",
          tyres: tyres({
            action: "CHANGE_BEFORE_PLANNED_STOP",
            lapsRemaining: 12,
            reasonCode: "tyre_life_before_stop",
            reason: "Banden zijn over 12 rondes op (0,45 punt per ronde op linksvoor), 6 rondes vóór de geplande stop.",
          }),
        })}
      />,
    );
    expect(screen.getByText("PIT OVER 12 RONDES")).toBeInTheDocument();
    expect(screen.getByText("wissel vóór stop")).toBeInTheDocument();
    expect(screen.getByText("12 r")).toBeInTheDocument();
  });
});
