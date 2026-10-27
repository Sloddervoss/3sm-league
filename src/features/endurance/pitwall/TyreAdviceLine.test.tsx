import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TyreAdviceLine } from "./TyreAdviceLine";
import type { TyreEstimate } from "./strategy/tyreGrade";

afterEach(cleanup);

/**
 * Vier graden, één vorm: een bereik in rondes. De tests eisen de letterlijke
 * regel en controleren daarnaast wat er níet meer mag staan: geen percentage
 * rest, geen tempo, geen `±`, geen "(geschat)" — het betrouwbaarheidswoord staat
 * in het label erboven, niet twee keer in hetzelfde blok.
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
  it("toont bij graad A het bereik in rondes tot de drempel", () => {
    const { container } = render(<TyreAdviceLine estimate={estimate()} />);
    expect(tekst(container)).toContain("11–14 rondes tot 40%");
    // Het percentage rest is weg: het zegt niets over het aantal rondes.
    expect(tekst(container)).not.toContain("62%");
    expect(tekst(container)).not.toContain("/r");
    expect(tekst(container)).not.toContain("±");
  });

  it("draagt het betrouwbaarheidswoord als attribuut, zodat de graad leesbaar blijft", () => {
    const { container } = render(<TyreAdviceLine estimate={estimate()} />);
    const regel = container.querySelector("[data-pitwall-tyre-grade]");
    expect(regel?.getAttribute("data-pitwall-tyre-confidence")).toBe("gemeten");
    expect(regel?.getAttribute("data-pitwall-tyre-grade")).toBe("A");
    // Het woord staat één keer in de regel: in de voorleesprefix, niet ook nog
    // eens als zichtbare tekst.
    expect((regel?.textContent?.match(/gemeten/g) ?? []).length).toBe(1);
  });

  it("gebruikt bij B dezelfde vorm, met het woord voorlopig", () => {
    const { container } = render(<TyreAdviceLine estimate={estimate({ grade: "B" })} />);
    expect(tekst(container)).toContain("11–14 rondes tot 40%");
    expect(container.querySelector("[data-pitwall-tyre-confidence]")?.getAttribute("data-pitwall-tyre-confidence")).toBe(
      "voorlopig",
    );
    // Geen tempo: bij B is de helling een schatting en geen meting.
    expect(tekst(container)).not.toContain("/r");
  });

  it("geeft het bereik een voorleeslabel dat als bereik klinkt", () => {
    const { container } = render(<TyreAdviceLine estimate={estimate({ grade: "B" })} />);
    const aria = Array.from(container.querySelectorAll("[aria-label]")).map((el) => el.getAttribute("aria-label"));
    expect(aria).toContain("11 tot 14 rondes");
  });

  it("valt terug op één rondes-getal als de band onbekend is", () => {
    const { container } = render(<TyreAdviceLine estimate={estimate({ lapsRange: null })} />);
    expect(tekst(container)).toContain("12 rondes tot 40%");
  });

  it("toont bij graad C geen rondes en geen tempo, wel de instructie", () => {
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
    expect(tekst(container)).toContain("rondes onbekend · wacht op stop");
    expect(tekst(container)).not.toContain("%");
    expect(tekst(container)).not.toContain("/r");
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
    expect(container.querySelector("[data-pitwall-tyre-confidence]")?.getAttribute("data-pitwall-tyre-confidence")).toBe(
      "plan",
    );
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
