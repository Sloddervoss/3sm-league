import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TyreFuelCompare } from "./TyreFuelCompare";
import type { TyreFuelComparison } from "./strategy/types";

afterEach(cleanup);

/**
 * De vergelijking: twee grenzen in dezelfde eenheid, met dezelfde getallen als
 * `lapsUntilPit`. Dit component rekent niets, dus wat er in gaat komt eruit —
 * en de test controleert dat de pijl en de zin bij dezelfde rij horen.
 */

const vergelijking = (banden: number | null, tank: number | null): TyreFuelComparison => ({
  tyres: { laps: banden, range: banden == null ? null : { low: 11, high: 14 }, limitPct: banden == null ? null : 40 },
  fuel: { laps: tank, range: tank == null ? null : { low: 14, high: 16 }, limitPct: 0 },
});

const rij = (container: HTMLElement, key: "tyres" | "fuel") =>
  container.querySelector(`[data-pitwall-constraint='${key}']`);

const zin = (container: HTMLElement) =>
  container.querySelector("[data-pitwall-binding-sentence]")?.textContent ?? "";

describe("TyreFuelCompare", () => {
  it("zet banden boven en tank onder, allebei in rondes", () => {
    const { container } = render(
      <TyreFuelCompare comparison={vergelijking(12, 15)} binding="tyres" laps={12} />,
    );
    expect(rij(container, "tyres")?.textContent).toContain("nog 12 rondes");
    expect(rij(container, "tyres")?.textContent).toContain("(11–14)");
    expect(rij(container, "tyres")?.textContent).toContain("tot 40%");
    expect(rij(container, "fuel")?.textContent).toContain("nog 15 rondes");
    expect(rij(container, "fuel")?.textContent).toContain("tot leeg");
  });

  it("markeert de bindende rij en zegt hetzelfde in de zin", () => {
    const { container } = render(
      <TyreFuelCompare comparison={vergelijking(12, 15)} binding="tyres" laps={12} />,
    );
    expect(rij(container, "tyres")?.getAttribute("data-pitwall-constraint-active")).toBe("true");
    expect(rij(container, "fuel")?.getAttribute("data-pitwall-constraint-active")).toBeNull();
    expect(zin(container)).toBe("banden zijn de grens; wissel bij de stop van r12");
  });

  it("zegt hoeveel langer de banden meegaan als de tank de grens is", () => {
    const { container } = render(
      <TyreFuelCompare comparison={vergelijking(15, 12)} binding="fuel" laps={12} />,
    );
    expect(rij(container, "fuel")?.getAttribute("data-pitwall-constraint-active")).toBe("true");
    expect(zin(container)).toBe("tank is de grens; banden gaan nog 3 rondes langer mee");
  });

  it("noemt bij gelijkstand beide en niet één van de twee", () => {
    const { container } = render(
      <TyreFuelCompare comparison={vergelijking(12, 12)} binding="both" laps={12} />,
    );
    expect(zin(container)).toBe("beide op dezelfde ronde; wissel bij de stop van r12");
    expect(rij(container, "tyres")?.getAttribute("data-pitwall-constraint-active")).toBe("true");
    expect(rij(container, "fuel")?.getAttribute("data-pitwall-constraint-active")).toBe("true");
  });

  it("zegt bij een onbekende band dat de tank de grens is en niet dat de banden ok zijn", () => {
    const { container } = render(
      <TyreFuelCompare comparison={vergelijking(null, 9)} binding="fuel" laps={9} />,
    );
    expect(rij(container, "tyres")?.textContent).toContain("onbekend");
    expect(zin(container)).toBe("tank is de grens; banden onbekend");
    expect(container.textContent).not.toContain("banden ok");
  });

  it("rendert niets als er geen grens is: één feit hoort in één regel", () => {
    const { container } = render(
      <TyreFuelCompare comparison={vergelijking(12, 15)} binding={null} laps={null} />,
    );
    expect(container.textContent).toBe("");
  });

  it("neemt het getal uit de kop over en rekent het niet opnieuw", () => {
    // De rijen zeggen 12 en 15; de zin gebruikt `laps`, het getal van de
    // beslissing. Zo kan de pijl niet iets anders beweren dan de kop.
    const { container } = render(
      <TyreFuelCompare comparison={vergelijking(12, 15)} binding="tyres" laps={12} />,
    );
    expect(zin(container)).toContain("r12");
    expect(rij(container, "tyres")?.textContent).toContain("nog 12 rondes");
  });
});
