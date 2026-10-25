import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TyreAdviceLine } from "./TyreAdviceLine";
import type { TyreEstimate } from "./strategy/tyreGrade";

afterEach(cleanup);

/**
 * Vier graden, vier vormen. De tests eisen de letterlijke regel uit
 * 3sm-bandenplan §4 en controleren daarnaast wat er níet mag staan: geen tempo
 * bij C of D, geen `±` bij A, geen puntgetal bij C.
 */

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

const tekst = (container: HTMLElement): string =>
  container.querySelector("[data-pitwall-tyre-grade]")?.textContent ?? "";

describe("TyreAdviceLine", () => {
  it("toont bij graad A een puntgetal, de helling en de rondes tot de drempel", () => {
    const { container } = render(<TyreAdviceLine estimate={estimate()} />);
    expect(tekst(container)).toContain("62% · −1,8/r · nog 12 rondes tot 40%");
    expect(tekst(container)).not.toContain("±");
    expect(tekst(container)).not.toContain("geschat");
    expect(container.querySelector("[data-pitwall-tyre-grade]")?.getAttribute("data-pitwall-tyre-grade")).toBe("A");
  });

  it("toont bij graad B het getal met marge en de rondes als bereik", () => {
    const { container } = render(<TyreAdviceLine estimate={estimate({ grade: "B" })} />);
    expect(tekst(container)).toContain("62% ±4 · 11–14 rondes (geschat)");
    // Geen tempo: bij B is de helling een schatting en geen meting.
    expect(tekst(container)).not.toContain("/r");
  });

  it("geeft het bereik en de marge een voorleeslabel", () => {
    const { container } = render(<TyreAdviceLine estimate={estimate({ grade: "B" })} />);
    const aria = Array.from(container.querySelectorAll("[aria-label]")).map((el) => el.getAttribute("aria-label"));
    expect(aria).toContain("plus of min 4 procent");
    expect(aria).toContain("11 tot 14 rondes");
  });

  it("toont bij graad C alleen een bereik, zonder tempo en zonder rondes", () => {
    const { container } = render(
      <TyreAdviceLine
        estimate={estimate({
          grade: "C",
          ratePerLap: null,
          marginPp: 11.8,
          lapsToThreshold: null,
          lapsRange: null,
          pctRange: { low: 55, high: 70 },
          limitPct: null,
        })}
      />,
    );
    expect(tekst(container)).toContain("55–70% · geschat · wacht op stop");
    expect(tekst(container)).not.toContain("/r");
    expect(tekst(container)).not.toContain("nog ");
    // Een bereik met een ± erop leest als een meting; C heeft geen verdeling.
    expect(tekst(container)).not.toContain("±");
  });

  it("toont bij graad D alleen de oorzaakregel", () => {
    const { container } = render(
      <TyreAdviceLine
        estimate={estimate({
          grade: "D",
          restPct: null,
          ratePerLap: null,
          marginPp: null,
          lapsToThreshold: null,
          lapsRange: null,
          limitPct: null,
          cause: "stalled_values",
          causeLap: 7,
        })}
      />,
    );
    expect(tekst(container)).toContain("— · waarde staat stil sinds r7");
    expect(tekst(container)).not.toContain("%");
    expect(tekst(container)).not.toContain("/r");
  });

  it("valt bij een ontbrekende meting terug op één oorzaakregel", () => {
    const { container } = render(
      <TyreAdviceLine estimate={estimate({ grade: "D", restPct: null, cause: null, causeLap: null })} />,
    );
    expect(tekst(container)).toContain("— · geen bandenmeting sinds de vorige stop");
  });

  it("rendert niets zonder schatting in plaats van een leeg getal", () => {
    const { container } = render(<TyreAdviceLine estimate={null} />);
    expect(container.textContent).toBe("");
  });
});
