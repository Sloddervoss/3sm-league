import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PitStrategyBlock } from "./PitStrategyBlock";
import type { PitwallStrategyRow } from "./pitwallHelpers";
import type { PitStopMeasurement } from "./strategy/types";

const strategy = {
  strategy_status: "ok",
  strategy_reason: null,
  fuel_laps_remaining: 8,
  fuel_to_add_litres: 20,
  valid_fuel_sample_count: 6,
} as unknown as PitwallStrategyRow;

const measured: PitStopMeasurement = {
  pitLaneSeconds: 62.4,
  sampleCount: 2,
  source: "measured",
  lastStopAt: "2026-11-21T12:00:38.000Z",
  lastStop: {
    entryAt: "2026-11-21T12:00:00.000Z",
    exitAt: "2026-11-21T12:00:38.000Z",
    seconds: 64.8,
  },
  stops: [],
};

describe("PitStrategyBlock gross benchmark", () => {
  it("shows the latest measured gross visit separately, with service included", () => {
    const view = render(<PitStrategyBlock strategy={strategy} driverName="Coureur" pitLoss={measured} />);
    expect(view.container.textContent).toContain("Pitstraat · mediaan (bruto)");
    expect(view.container.textContent).toContain("62.4 s");
    const last = view.container.querySelector("[data-pit-gross-benchmark='last-stop']");
    expect(last).not.toBeNull();
    expect(last?.getAttribute("data-pit-gross-seconds")).toBe("64.8");
    expect(last?.textContent).toContain("Laatste stop (bruto)");
    expect(last?.textContent).toContain("64.8 s");
    expect(view.container.textContent).not.toMatch(/netto verlies/i);
    expect(screen.getByTitle(/service inbegrepen · aparte benchmark, niet het strategiemodel/)).toBeTruthy();
  });

  it("does not invent a latest stop when only the median exists", () => {
    const view = render(
      <PitStrategyBlock
        strategy={strategy}
        driverName="Coureur"
        pitLoss={{ ...measured, lastStop: null }}
      />,
    );
    expect(view.container.querySelector("[data-pit-gross-benchmark='last-stop']")).toBeNull();
    expect(view.container.textContent).toContain("62.4 s");
  });
});
