import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DecisionBand } from "./DecisionBand";
import type { Advice, TyreFuelComparison } from "./strategy/types";
import type { TyreAdvice } from "./strategy/tyreWear";
import type { TyreEstimate } from "./strategy/tyreGrade";

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

/** Graad A met de getallen uit plan-03 T14(a): 62% · −1,8/r · nog 12. */
const estimate = (overrides: Partial<TyreEstimate> = {}): TyreEstimate => ({
  grade: "A",
  source: "server",
  weakest: "fl",
  restPct: 62,
  ratePerLap: 1.8,
  marginPp: 4,
  sigmaLaps: 1.1,
  lapsToThreshold: 12.22,
  lapsRange: { low: 11, high: 14 },
  pctRange: null,
  cause: null,
  causeLap: null,
  causeLaps: 21,
  limitPct: 40,
  samples: 1,
  ...overrides,
});

/** Twee grenzen in dezelfde eenheid: banden 12, tank 15. */
const tyreFuel = (banden = 12, tank = 15): TyreFuelComparison => ({
  tyres: { laps: banden, range: { low: 11, high: 14 }, limitPct: 40 },
  fuel: { laps: tank, range: { low: 14, high: 16 }, limitPct: 0 },
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
  binding: "fuel",
  tyreFuel: tyreFuel(12, 5),
  tyreEstimate: null,
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

  it("vat blijven buiten samen in één regel in plaats van twee rijen", () => {
    const { container } = render(
      <DecisionBand
        advice={advice({
          decision: "STAY_OUT",
          lapsUntilPit: null,
          lapsToFinish: 9,
          binding: null,
          tyreFuel: tyreFuel(12, 9),
          tyreEstimate: estimate(),
        })}
      />,
    );
    expect(container.querySelector("[data-pitwall-stay-out]")?.textContent).toBe(
      "banden 62% · tank 9 rondes · beide halen de finish (9 rondes)",
    );
    expect(container.querySelector("[data-pitwall-tyre-fuel]")).toBeNull();
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
          binding: null,
          tyreFuel: null,
        })}
      />,
    );
    expect(screen.getByText("GEEN ADVIES")).toBeInTheDocument();
    expect(screen.getByText(/12 s oud/)).toBeInTheDocument();
    // Geen lege vakjes bij een lege meting: de reden is dan de hele boodschap.
    expect(screen.queryByText("tanken")).not.toBeInTheDocument();
    expect(screen.queryByText("zekerheid tank")).not.toBeInTheDocument();
  });

  it("toont een streepje in plaats van een verzonnen getal", () => {
    render(<DecisionBand advice={advice({ fuelToAddLitres: null })} />);
    expect(screen.getAllByText("—")).toHaveLength(1);
  });

  it("toont de bandenrij met de graad en de regel die bij die graad hoort", () => {
    const { container } = render(<DecisionBand advice={advice({ tyres: tyres(), tyreEstimate: estimate() })} />);
    expect(screen.getByText("wisselen bij stop")).toBeInTheDocument();
    expect(screen.getByText("A · gemeten")).toBeInTheDocument();
    expect(container.querySelector("[data-pitwall-tyre-grade='A']")?.textContent).toContain(
      "62% · −1,8/r · nog 12 rondes tot 40%",
    );
  });

  it("toont bij graad D alleen de oorzaak en geen percentage", () => {
    const { container } = render(
      <DecisionBand
        advice={advice({
          tyres: tyres({ action: "NO_ADVICE", lapsRemaining: null }),
          tyreEstimate: estimate({
            grade: "D",
            restPct: null,
            ratePerLap: null,
            lapsToThreshold: null,
            lapsRange: null,
            limitPct: null,
            cause: "stalled_values",
            causeLap: 7,
          }),
        })}
      />,
    );
    expect(screen.getByText("geen bandenadvies")).toBeInTheDocument();
    expect(screen.getByText("D · geen meting")).toBeInTheDocument();
    expect(container.querySelector("[data-pitwall-tyre-grade='D']")?.textContent).toContain(
      "— · waarde staat stil sinds r7",
    );
  });

  it("houdt de invariant: het getal in de kop is het getal van de bindende rij", () => {
    const { container } = render(
      <DecisionBand
        advice={advice({
          decision: "PIT_IN_LAPS",
          lapsUntilPit: 12,
          reasonCode: "tyre_life",
          reason: "Banden zijn over 12 rondes op de grens van 40%.",
          tyres: tyres({ action: "CHANGE_BEFORE_PLANNED_STOP", lapsRemaining: 12 }),
          tyreEstimate: estimate(),
          binding: "tyres",
          tyreFuel: tyreFuel(12, 15),
        })}
      />,
    );

    expect(screen.getByText("PIT OVER 12 RONDES")).toBeInTheDocument();
    const bandenrij = container.querySelector("[data-pitwall-constraint='tyres']");
    const tankrij = container.querySelector("[data-pitwall-constraint='fuel']");
    expect(bandenrij?.getAttribute("data-pitwall-constraint-active")).toBe("true");
    expect(tankrij?.getAttribute("data-pitwall-constraint-active")).toBeNull();
    expect(bandenrij?.textContent).toContain("nog 12 rondes");
    // De zin komt uit dezelfde keuze als de pijl, dus hij kan het er niet mee oneens zijn.
    expect(container.querySelector("[data-pitwall-binding-sentence]")?.textContent).toBe(
      "banden zijn de grens; wissel bij de stop van r12",
    );
  });

  it("zegt bij een onbekende band dat de tank de grens is, niet dat de banden ok zijn", () => {
    const { container } = render(
      <DecisionBand
        advice={advice({
          decision: "PIT_IN_LAPS",
          lapsUntilPit: 5,
          binding: "fuel",
          tyreFuel: { tyres: { laps: null, range: null, limitPct: null }, fuel: { laps: 5, range: null, limitPct: 0 } },
          tyreEstimate: estimate({ grade: "C", pctRange: { low: 55, high: 70 }, limitPct: null, lapsToThreshold: null }),
          tyres: tyres({ action: "NO_ADVICE" }),
        })}
      />,
    );
    expect(container.querySelector("[data-pitwall-binding-sentence]")?.textContent).toBe(
      "tank is de grens; banden onbekend",
    );
    expect(screen.queryByText("banden ok")).not.toBeInTheDocument();
  });
});
